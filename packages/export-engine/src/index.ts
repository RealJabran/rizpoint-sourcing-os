export const EXPORT_ENGINE_VERSION = "export-engine/v1";
export type ExportCell = string | number | null | undefined;
export type ExportTable = Readonly<{
  sheetName: string;
  columns: readonly string[];
  rows: readonly (readonly ExportCell[])[];
}>;

/** Keep CSV/XLSX textual cells inert even when Excel ignores leading whitespace. */
export function safeSpreadsheetText(value: string): string {
  const first = value.trimStart().charAt(0);
  return ["=", "+", "-", "@"].includes(first) || /^[\t\r\n]/.test(value)
    ? `'${value}`
    : value;
}
export function exportCell(value: ExportCell): string | number {
  if (typeof value === "number") return value;
  return safeSpreadsheetText(value ?? "");
}
function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
export function toCsv(table: ExportTable): Uint8Array {
  const row = (cells: readonly ExportCell[]) =>
    cells.map((cell) => quote(String(exportCell(cell)))).join(",");
  return new TextEncoder().encode(
    `\uFEFF${row(table.columns)}\r\n${table.rows.map(row).join("\r\n")}\r\n`,
  );
}
export function xlsxPayload(tables: readonly ExportTable[]) {
  return tables.map((table) => ({
    sheet_name: table.sheetName.slice(0, 31),
    columns: table.columns,
    rows: table.rows.map((row) => row.map(exportCell)),
  }));
}
