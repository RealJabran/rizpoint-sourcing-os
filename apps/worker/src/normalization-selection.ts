export type MappedUploadSheet = {
  id: string;
  sheetIndex: number;
  selectedHeaderRow: number | null;
};

export function selectMappedUploadSheet(
  sheets: MappedUploadSheet[],
): (MappedUploadSheet & { selectedHeaderRow: number }) | null {
  const selected = sheets.filter(
    (sheet): sheet is MappedUploadSheet & { selectedHeaderRow: number } =>
      sheet.selectedHeaderRow !== null,
  );
  return selected.length === 1 ? selected[0]! : null;
}
