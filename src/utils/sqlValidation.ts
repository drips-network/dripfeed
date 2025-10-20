/**
 * Validates SQL identifier to prevent SQL injection.
 * Allows alphanumeric characters, underscores, and dollar signs.
 * Must start with letter or underscore.
 * Disallows double-quotes to prevent quote escaping attacks.
 */
export function validateIdentifier(identifier: string): string {
  if (!identifier || typeof identifier !== 'string') {
    throw new Error('SQL identifier must be a non-empty string.');
  }
  if (identifier.trim() === '') {
    throw new Error('SQL identifier cannot be empty or whitespace-only.');
  }
  if (identifier.length > 63) {
    throw new Error('SQL identifier exceeds PostgreSQL limit (63 characters).');
  }
  if (identifier.includes('"')) {
    throw new Error(`Invalid SQL identifier: ${identifier}. Cannot contain double-quotes.`);
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_$]*$/.test(identifier)) {
    throw new Error(
      `Invalid SQL identifier: ${identifier}. Must start with letter or underscore, and contain only letters, digits, underscores, or dollar signs.`,
    );
  }
  return identifier;
}

/**
 * Validates schema name to prevent SQL injection.
 */
export function validateSchemaName(schema: string): string {
  return validateIdentifier(schema);
}

/**
 * Parses and validates a potentially schema-qualified table reference.
 * Supports both "table" and "schema.table" formats.
 * Each segment is validated independently to prevent injection.
 *
 * @param input - Table reference, optionally schema-qualified.
 * @returns Validated schema and table segments.
 * @throws If input has invalid format or fails identifier validation.
 */
export function parseQualifiedTable(input: string): {
  schema?: string;
  table: string;
} {
  const parts = input.split('.');

  if (parts.length > 2) {
    throw new Error(`Invalid table reference: "${input}" has too many parts`);
  }

  if (parts.length === 2) {
    const schema = parts[0];
    const table = parts[1];
    if (!schema || !table) {
      throw new Error(`Invalid table reference: "${input}" has empty segments`);
    }
    return {
      schema: validateIdentifier(schema),
      table: validateIdentifier(table),
    };
  }

  const table = parts[0];
  if (!table) {
    throw new Error(`Invalid table reference: "${input}" is empty`);
  }
  return {
    table: validateIdentifier(table),
  };
}

/**
 * Formats a validated qualified table reference for safe SQL interpolation.
 * Wraps each segment in double quotes per PostgreSQL identifier rules.
 *
 * @param parsed - Validated schema and table segments.
 * @returns Properly quoted SQL identifier.
 */
export function formatQualifiedTable(parsed: { schema?: string; table: string }): string {
  return parsed.schema ? `"${parsed.schema}"."${parsed.table}"` : `"${parsed.table}"`;
}
