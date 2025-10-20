import type { PoolClient, QueryResult, QueryResultRow } from 'pg';

import {
  formatQualifiedTable,
  parseQualifiedTable,
  validateIdentifier,
} from '../utils/sqlValidation.js';

/**
 * Insert a row, or update **all provided columns** when a conflict occurs.
 *
 * Replayable: running with the same inputs yields the same persisted state, excluding DB-managed side effects.
 *
 * @typeParam T - Expected row shape in the `QueryResult`.
 * @param params.client - PostgreSQL client.
 * @param params.table - Target table name.
 * @param params.data - Column–value map to insert; all keys become update targets on conflict.
 * @param params.conflictColumns - Columns defining the conflict target.
 * @returns Raw `QueryResult` from `pg`.
 * @throws If inputs are empty/invalid or identifier validation fails.
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
  const qualifiedTable = parseQualifiedTable(table);
  const tableSql = formatQualifiedTable(qualifiedTable);
  const columns = Object.keys(data).sort();

  if (columns.length === 0) {
    throw new Error(`[${table}] Cannot upsert with empty data`);
  }

  if (conflictColumns.length === 0) {
    throw new Error(`[${table}] conflictColumns cannot be empty`);
  }

  columns.forEach(validateIdentifier);
  const uniqueConflictColumns = Array.from(new Set(conflictColumns));
  uniqueConflictColumns.forEach(validateIdentifier);

  const values = columns.map((col) => data[col]);

  if (values.some((v) => v === undefined)) {
    throw new Error(`[${table}] Cannot upsert: data contains undefined values`);
  }
  const placeholders = values.map((_, i) => `$${i + 1}`);
  const updateSet = columns.map((col) => `"${col}" = EXCLUDED."${col}"`).join(', ');

  return client.query<T>(
    `
      INSERT INTO ${tableSql} (${columns.map((c) => `"${c}"`).join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (${uniqueConflictColumns.map((c) => `"${c}"`).join(', ')})
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
 *
 * @typeParam T - Expected row shape in the `QueryResult`.
 * @typeParam I - Data shape, keys constrain `conflictColumns` and `updateColumns`.
 * @typeParam C - Keys from `I` that define the conflict target.
 * @typeParam K - Keys from `I` that will be updated on conflict.
 * @typeParam Schema - Full table schema type for validating computed column names.
 * @typeParam Computed - Column names for computed values (constrained to Schema keys).
 * @param client - PostgreSQL client.
 * @param table - Target table name.
 * @param data - Full column–value map to insert.
 * @param conflictColumns - Columns defining the conflict target.
 * @param updateColumns - Subset of `data` keys to update on conflict.
 * @param computedColumns - Map of column names to SQL expressions for computed values.
 * @returns Raw `QueryResult` from `pg`.
 * @throws If inputs are empty/invalid or identifier validation fails.
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
  const qualifiedTable = parseQualifiedTable(table);
  const tableSql = formatQualifiedTable(qualifiedTable);
  const columns = Object.keys(data).sort();
  const computedCols = Object.keys(computedColumns ?? {}) as Computed[];

  if (columns.length === 0) {
    throw new Error(`[${table}] Cannot upsert with empty data`);
  }

  if (conflictColumns.length === 0) {
    throw new Error(`[${table}] conflictColumns cannot be empty`);
  }

  if (updateColumns.length === 0 && computedCols.length === 0) {
    throw new Error(`[${table}] updateColumns and computedColumns cannot both be empty`);
  }

  const invalidColumns = updateColumns.filter((col) => !columns.includes(String(col)));
  if (invalidColumns.length > 0) {
    throw new Error(
      `[${table}] updateColumns contains columns not in data: ${invalidColumns.join(', ')}`,
    );
  }

  const overlappingColumns = computedCols.filter((col) => columns.includes(col));
  if (overlappingColumns.length > 0) {
    throw new Error(
      `[${table}] computedColumns cannot overlap with data columns: ${overlappingColumns.join(', ')}`,
    );
  }

  columns.forEach(validateIdentifier);
  computedCols.forEach(validateIdentifier);
  const uniqueConflictColumns = Array.from(new Set(conflictColumns.map(String))).sort();
  uniqueConflictColumns.forEach(validateIdentifier);
  const uniqueUpdateColumns = Array.from(new Set(updateColumns.map(String))).sort();
  uniqueUpdateColumns.forEach(validateIdentifier);

  const values = columns.map((col) => data[col as keyof I]);

  if (values.some((v) => v === undefined)) {
    throw new Error(`[${table}] Cannot upsert: data contains undefined values`);
  }
  const placeholders = values.map((_, i) => `$${i + 1}`);

  const dataUpdateSet = uniqueUpdateColumns.map((col) => `"${col}" = EXCLUDED."${col}"`).join(', ');
  const computedUpdateSet = computedCols
    .map((col) => `"${col}" = ${computedColumns![col]}`)
    .join(', ');
  const updatedAtSet = '"updated_at" = NOW()';

  const updateSet = [dataUpdateSet, computedUpdateSet, updatedAtSet].filter(Boolean).join(', ');

  return client.query<T>(
    `
      INSERT INTO ${tableSql} (${columns.map((c) => `"${c}"`).join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (${uniqueConflictColumns.map((c) => `"${c}"`).join(', ')})
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
 *
 * @typeParam T - Expected row shape in the `QueryResult`.
 * @typeParam I - Data shape, keys constrain `whereColumns` and `updateColumns`.
 * @typeParam W - Keys from `I` that define the WHERE clause.
 * @typeParam U - Keys from `I` that will be updated.
 * @typeParam Schema - Full table schema type for validating computed column names.
 * @typeParam C - Column names for computed values (constrained to Schema keys).
 * @param client - PostgreSQL client.
 * @param table - Target table name.
 * @param data - Full column–value map containing both WHERE and UPDATE values.
 * @param whereColumns - Columns for the WHERE clause (e.g., primary key).
 * @param updateColumns - Subset of `data` keys to update.
 * @param computedColumns - Map of column names to SQL expressions for computed values.
 * @returns Raw `QueryResult` from `pg`.
 * @throws If inputs are empty/invalid or identifier validation fails.
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
  const qualifiedTable = parseQualifiedTable(table);
  const tableSql = formatQualifiedTable(qualifiedTable);
  const columns = Object.keys(data).sort();
  const computedCols = Object.keys(computedColumns ?? {}) as C[];

  if (columns.length === 0) {
    throw new Error(`[${table}] Cannot update with empty data`);
  }

  if (whereColumns.length === 0) {
    throw new Error(`[${table}] whereColumns cannot be empty`);
  }

  if (updateColumns.length === 0 && computedCols.length === 0) {
    throw new Error(`[${table}] updateColumns and computedColumns cannot both be empty`);
  }

  const invalidWhereColumns = whereColumns.filter((col) => !columns.includes(String(col)));
  if (invalidWhereColumns.length > 0) {
    throw new Error(
      `[${table}] whereColumns contains columns not in data: ${invalidWhereColumns.join(', ')}`,
    );
  }

  const invalidUpdateColumns = updateColumns.filter((col) => !columns.includes(String(col)));
  if (invalidUpdateColumns.length > 0) {
    throw new Error(
      `[${table}] updateColumns contains columns not in data: ${invalidUpdateColumns.join(', ')}`,
    );
  }

  const overlappingColumns = computedCols.filter((col) => columns.includes(col));
  if (overlappingColumns.length > 0) {
    throw new Error(
      `[${table}] computedColumns cannot overlap with data columns: ${overlappingColumns.join(', ')}`,
    );
  }

  columns.forEach(validateIdentifier);
  computedCols.forEach(validateIdentifier);
  const uniqueWhereColumns = Array.from(new Set(whereColumns.map(String))).sort();
  uniqueWhereColumns.forEach(validateIdentifier);
  const uniqueUpdateColumns = Array.from(new Set(updateColumns.map(String))).sort();
  uniqueUpdateColumns.forEach(validateIdentifier);

  const values = columns.map((col) => data[col as keyof I]);

  if (values.some((v) => v === undefined)) {
    throw new Error(`[${table}] Cannot update: data contains undefined values`);
  }

  const paramIndexMap = new Map(columns.map((col, idx) => [col, idx + 1]));

  const whereClause = uniqueWhereColumns
    .map((col) => `"${col}" = $${paramIndexMap.get(col)}`)
    .join(' AND ');

  const dataUpdateSet = uniqueUpdateColumns
    .map((col) => `"${col}" = $${paramIndexMap.get(col)}`)
    .join(', ');

  const computedUpdateSet = computedCols
    .map((col) => `"${col}" = ${computedColumns![col]}`)
    .join(', ');
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
