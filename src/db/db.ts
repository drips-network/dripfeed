import type { PoolClient, QueryResult, QueryResultRow } from 'pg';

import {
  formatQualifiedTable,
  parseQualifiedTable,
  validateIdentifier,
} from '../utils/sqlValidation.js';

/**
 * Insert a row, or update **all** provided columns when a conflict occurs.
 *
 * Replayable: running with the same inputs yields the same persisted state, excluding DB-managed side effects.
 */
export async function upsert<T extends QueryResultRow = QueryResultRow>({
  client,
  table,
  data,
  conflictColumns,
}: {
  client: PoolClient;
  table: string;
  data: Record<string, unknown>;
  conflictColumns: string[];
}): Promise<QueryResult<T>> {
  const { tableSql } = parseAndValidateTable(table);
  const columns = extractAndValidateColumns(table, data);

  if (conflictColumns.length === 0) {
    throw new Error(`[${table}] conflictColumns cannot be empty`);
  }

  const uniqueConflictColumns = deduplicateAndValidateColumns(conflictColumns);

  const values = columns.map((col) => data[col]);
  const placeholders = generatePlaceholders(columns.length);
  const updateSet = buildDataUpdateSet(columns);

  return client.query<T>(
    `
      INSERT INTO ${tableSql} (${quoteColumns(columns).join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (${quoteColumns(uniqueConflictColumns).join(', ')})
      DO UPDATE SET ${updateSet}
      RETURNING *
    `.trim(),
    values,
  );
}

/**
 * Insert a row, or update only a **subset** of columns when a conflict occurs.
 *
 * Replayable: running with the same inputs yields the same persisted state, excluding DB-managed side effects.
 */
export async function upsertPartial<
  T extends QueryResultRow = QueryResultRow,
  I extends Record<string, unknown> = Record<string, unknown>,
  C extends keyof I = keyof I,
  K extends keyof I = keyof I,
  Schema extends Record<string, unknown> = I,
  Computed extends Extract<keyof Schema, string> = Extract<keyof Schema, string>,
>({
  client,
  table,
  data,
  conflictColumns,
  updateColumns,
  computedColumns,
}: {
  client: PoolClient;
  table: string;
  data: I;
  conflictColumns: C[];
  updateColumns: K[];
  computedColumns?: Partial<Record<Computed, string>>;
}): Promise<QueryResult<T>> {
  const { tableSql } = parseAndValidateTable(table);
  const columns = extractAndValidateColumns(table, data as Record<string, unknown>);
  const computedCols = Object.keys(computedColumns ?? {}) as Computed[];

  if (conflictColumns.length === 0) {
    throw new Error(`[${table}] conflictColumns cannot be empty`);
  }

  if (updateColumns.length === 0 && computedCols.length === 0) {
    throw new Error(`[${table}] updateColumns and computedColumns cannot both be empty`);
  }

  validateColumnSubset(table, updateColumns.map(String), columns, 'updateColumns');
  validateNoOverlap(table, computedCols, columns);

  const uniqueConflictColumns = deduplicateValidateAndSortColumns(conflictColumns);
  const uniqueUpdateColumns = deduplicateValidateAndSortColumns(updateColumns);

  const values = columns.map((col) => data[col as keyof I]);
  const placeholders = generatePlaceholders(columns.length);

  const dataUpdateSet = buildDataUpdateSet(uniqueUpdateColumns);
  const computedUpdateSet =
    computedCols.length > 0 ? buildComputedUpdateSet(computedCols, computedColumns!) : '';
  const updatedAtSet = '"updated_at" = NOW()';

  const updateSet = [dataUpdateSet, computedUpdateSet, updatedAtSet].filter(Boolean).join(', ');

  return client.query<T>(
    `
      INSERT INTO ${tableSql} (${quoteColumns(columns).join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (${quoteColumns(uniqueConflictColumns).join(', ')})
      DO UPDATE SET ${updateSet}
      RETURNING *
    `.trim(),
    values,
  );
}

/**
 * Update existing rows, modifying only the specified columns.
 *
 * Replayable: running with the same inputs yields the same persisted state, excluding DB-managed side effects.
 */
export async function update<
  T extends QueryResultRow = QueryResultRow,
  I extends Record<string, unknown> = Record<string, unknown>,
  W extends keyof I = keyof I,
  U extends keyof I = keyof I,
  Schema extends Record<string, unknown> = I,
  C extends Extract<keyof Schema, string> = Extract<keyof Schema, string>,
>({
  client,
  table,
  data,
  whereColumns,
  updateColumns,
  computedColumns,
}: {
  client: PoolClient;
  table: string;
  data: I;
  whereColumns: W[];
  updateColumns: U[];
  computedColumns?: Partial<Record<C, string>>;
}): Promise<QueryResult<T>> {
  const { tableSql } = parseAndValidateTable(table);
  const columns = extractAndValidateColumns(table, data as Record<string, unknown>);
  const computedCols = Object.keys(computedColumns ?? {}) as C[];

  if (whereColumns.length === 0) {
    throw new Error(`[${table}] whereColumns cannot be empty`);
  }

  if (updateColumns.length === 0 && computedCols.length === 0) {
    throw new Error(`[${table}] updateColumns and computedColumns cannot both be empty`);
  }

  validateColumnSubset(table, whereColumns.map(String), columns, 'whereColumns');
  validateColumnSubset(table, updateColumns.map(String), columns, 'updateColumns');
  validateNoOverlap(table, computedCols, columns);

  const uniqueWhereColumns = deduplicateValidateAndSortColumns(whereColumns);
  const uniqueUpdateColumns = deduplicateValidateAndSortColumns(updateColumns);

  const values = columns.map((col) => data[col as keyof I]);
  const paramIndexMap = generateParamIndexMap(columns);

  const whereClause = buildWhereClause(uniqueWhereColumns, paramIndexMap);

  const dataUpdateSet = uniqueUpdateColumns
    .map((col) => `${quoteColumn(col)} = $${paramIndexMap.get(col)}`)
    .join(', ');

  const computedUpdateSet =
    computedCols.length > 0 ? buildComputedUpdateSet(computedCols, computedColumns!) : '';
  const updatedAtSet = '"updated_at" = NOW()';

  const updateSet = [dataUpdateSet, computedUpdateSet, updatedAtSet].filter(Boolean).join(', ');

  return client.query<T>(
    `
      UPDATE ${tableSql}
      SET ${updateSet}
      WHERE ${whereClause}
      RETURNING *
    `.trim(),
    values,
  );
}

/**
 * Quote a column name for SQL.
 */
function quoteColumn(col: string): string {
  return `"${col}"`;
}

/**
 * Quote multiple column names.
 */
function quoteColumns(cols: string[]): string[] {
  return cols.map(quoteColumn);
}

/**
 * Parse and validate table, return both raw and formatted SQL.
 */
function parseAndValidateTable(table: string): {
  qualifiedTable: ReturnType<typeof parseQualifiedTable>;
  tableSql: string;
} {
  const qualifiedTable = parseQualifiedTable(table);
  const tableSql = formatQualifiedTable(qualifiedTable);
  return { qualifiedTable, tableSql };
}

/**
 * Extract, sort, and validate columns from data; check for undefined values.
 */
function extractAndValidateColumns(table: string, data: Record<string, unknown>): string[] {
  const columns = Object.keys(data).sort();

  if (columns.length === 0) {
    throw new Error(`[${table}] Cannot insert with empty data`);
  }

  columns.forEach(validateIdentifier);

  const invalidColumns = columns.filter((col) => data[col] === undefined);
  if (invalidColumns.length > 0) {
    throw new Error(`[${table}] Cannot insert: columns [${invalidColumns.join(', ')}] have undefined values`);
  }

  return columns;
}

/**
 * Validate that provided columns exist in data.
 */
function validateColumnSubset(
  table: string,
  columnNames: string[],
  dataColumns: string[],
  columnSetName: string,
): void {
  const invalid = columnNames.filter((col) => !dataColumns.includes(col));
  if (invalid.length > 0) {
    throw new Error(
      `[${table}] ${columnSetName} contains columns not in data: ${invalid.join(', ')}`,
    );
  }
}

/**
 * Validate that computed columns don't overlap with data columns.
 */
function validateNoOverlap(table: string, computedCols: string[], dataColumns: string[]): void {
  const overlapping = computedCols.filter((col) => dataColumns.includes(col));
  if (overlapping.length > 0) {
    throw new Error(
      `[${table}] computedColumns cannot overlap with data columns: ${overlapping.join(', ')}`,
    );
  }
}

/**
 * Deduplicate and validate a list of column names.
 */
function deduplicateAndValidateColumns(columnNames: string[]): string[] {
  const unique = Array.from(new Set(columnNames));
  unique.forEach(validateIdentifier);
  return unique;
}

/**
 * Deduplicate, validate, and sort a list of column names.
 */
function deduplicateValidateAndSortColumns(columnNames: (string | number | symbol)[]): string[] {
  const unique = Array.from(new Set(columnNames.map(String))).sort();
  unique.forEach(validateIdentifier);
  return unique;
}

/**
 * Generate SQL placeholders ($1, $2, etc.).
 */
function generatePlaceholders(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `$${i + 1}`);
}

/**
 * Generate parameter index map for WHERE/UPDATE clauses.
 */
function generateParamIndexMap(columns: string[]): Map<string, number> {
  return new Map(columns.map((col, idx) => [col, idx + 1]));
}

/**
 * Build UPDATE SET clauses from data columns using EXCLUDED.
 */
function buildDataUpdateSet(columns: string[]): string {
  return columns.map((col) => `${quoteColumn(col)} = EXCLUDED.${quoteColumn(col)}`).join(', ');
}

/**
 * Build UPDATE SET clauses for computed columns (direct SQL expressions).
 *
 * WARNING: Computed column values are raw SQL expressions.
 * All identifiers must be properly quoted to prevent SQL injection.
 * Use double quotes for schema/table/column names (e.g., "schema"."type").
 */
function buildComputedUpdateSet(
  columns: string[],
  computedColumns: Partial<Record<string, string>>,
): string {
  columns.forEach((col) => {
    const expression = computedColumns[col];
    if (!expression) {
      throw new Error(`Missing expression for computed column: ${col}`);
    }
    // Detect unquoted identifiers: word.word pattern not surrounded by quotes.
    // This catches common injection patterns like: schema.typename or table.column.
    if (/(?:^|[^"])(\w+)\.(\w+)(?:[^"]|$)/.test(expression)) {
      throw new Error(
        `Computed column "${col}" contains unquoted identifier. ` +
          `All schema/table/column names must be quoted (e.g., "schema"."type").`,
      );
    }
  });

  return columns.map((col) => `${quoteColumn(col)} = ${computedColumns[col]}`).join(', ');
}

/**
 * Build WHERE clause from columns and parameter index map.
 */
function buildWhereClause(columns: string[], paramIndexMap: Map<string, number>): string {
  return columns.map((col) => `${quoteColumn(col)} = $${paramIndexMap.get(col)}`).join(' AND ');
}
