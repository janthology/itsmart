// Convert report records to plain spreadsheet cells. Strings are kept as
// strings (including leading '='), never formulas. The output library accepts
// null for empty cells and writes primitive numbers without stringifying them.
export function spreadsheetRows(rows: Record<string, unknown>[]): (string | number | boolean | null)[][] {
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  if (!columns.length) return [];
  return [columns, ...rows.map(row => columns.map(column => {
    const value = row[column];
    if (value == null) return null;
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    throw new Error(`Unsupported spreadsheet value in column ${column}`);
  }))];
}
