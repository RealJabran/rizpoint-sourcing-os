"use client";

import { useEffect, useMemo, useState } from "react";

const targets = [
  "",
  "ASIN",
  "UPC",
  "EAN",
  "GTIN",
  "MPN",
  "ITEM_NUMBER",
  "DESCRIPTION",
  "BRAND",
  "UNIT_COST",
  "CURRENCY",
  "QUANTITY",
  "CASE_COUNT",
  "PACK_COUNT",
  "WEIGHT",
  "LENGTH",
  "WIDTH",
  "HEIGHT",
];

type Supplier = { id: string; code: string; name: string };
type ProfileMapping = {
  sourceIndex: number;
  sourceColumn: string;
  target: string;
  required: boolean;
};
type SheetProfile = {
  id: string;
  name: string;
  version: number;
  headerRow: number;
  mapping: ProfileMapping[];
};
type Sheet = {
  id: string;
  sheetIndex: number;
  name: string;
  rowCount: number;
  columnCount: number;
  headerCandidates: Array<{ row: number; score: number }>;
  columns: string[];
  preview: string[][];
  selectedHeaderRow: number | null;
};
type Upload = {
  id: string;
  status: string;
  rejectionCode: string | null;
  scan: {
    id: string;
    status: string;
    columnMappings: Array<{ sourceIndex: number; target: string }>;
    supplierRows: Array<{
      sourceRowNumber: number;
      warnings: Array<{ code: string; field: string | null }>;
    }>;
  } | null;
  sheets: Sheet[];
};

export default function UploadPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [profiles, setProfiles] = useState<SheetProfile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [sheetId, setSheetId] = useState("");
  const [headerRow, setHeaderRow] = useState(1);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/suppliers").then(async (response) => {
      if (response.ok) {
        const data = (await response.json()) as Supplier[];
        setSuppliers(data);
        if (data[0]) setSupplierId(data[0].id);
      }
    });
  }, []);
  useEffect(() => {
    if (!supplierId) return;
    void fetch(`/api/suppliers/${supplierId}/profiles`).then(
      async (response) => {
        if (response.ok) setProfiles((await response.json()) as SheetProfile[]);
      },
    );
  }, [supplierId]);
  const sheet = useMemo(
    () =>
      upload?.sheets.find((candidate) => candidate.id === sheetId) ??
      upload?.sheets[0] ??
      null,
    [upload, sheetId],
  );
  const columns = useMemo(
    () => sheet?.preview[headerRow - 1] ?? [],
    [headerRow, sheet],
  );

  async function refresh(uploadId: string): Promise<Upload> {
    const response = await fetch(`/api/uploads/${uploadId}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Unable to load upload status.");
    const next = (await response.json()) as Upload;
    setUpload(next);
    if (next.sheets[0] && !sheetId) {
      setSheetId(next.sheets[0].id);
      setHeaderRow(next.sheets[0].headerCandidates[0]?.row ?? 1);
      setMapping({});
    }
    if (["INSPECTING", "NORMALIZING"].includes(next.status))
      window.setTimeout(
        () =>
          void refresh(uploadId).catch((caught) =>
            setError(
              caught instanceof Error ? caught.message : "Polling failed.",
            ),
          ),
        700,
      );
    return next;
  }

  async function startUpload(): Promise<void> {
    if (!file || !supplierId) return;
    setError(null);
    try {
      const presign = await fetch("/api/uploads/presign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          supplierId,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        }),
      });
      if (!presign.ok) throw new Error("Unable to create upload.");
      const created = (await presign.json()) as {
        uploadId: string;
        uploadUrl: string;
      };
      const put = await fetch(created.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!put.ok) throw new Error("Object upload failed.");
      const inspect = await fetch(`/api/uploads/${created.uploadId}/inspect`, {
        method: "POST",
      });
      if (!inspect.ok) throw new Error("Unable to queue inspection.");
      await refresh(created.uploadId);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unexpected upload error.",
      );
    }
  }

  async function saveMapping(): Promise<void> {
    if (!upload?.scan || !sheet) return;
    const mappings = Object.entries(mapping)
      .filter(([, target]) => target)
      .map(([sourceIndex, target]) => ({
        sourceIndex: Number(sourceIndex),
        sourceColumn: columns[Number(sourceIndex)] ?? `Column ${sourceIndex}`,
        target,
        required: ["DESCRIPTION", "UNIT_COST"].includes(target),
      }));
    const response = await fetch(`/api/scans/${upload.scan.id}/mapping`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadSheetId: sheet.id, headerRow, mappings }),
    });
    if (!response.ok) {
      setError(((await response.json()) as { error: string }).error);
      return;
    }
    await refresh(upload.id);
  }

  async function saveVsiProfile(): Promise<void> {
    if (!upload?.scan || !sheet) return;
    const mappingRows = Object.entries(mapping)
      .filter(([, target]) => target)
      .map(([sourceIndex, target]) => ({
        sourceIndex: Number(sourceIndex),
        sourceColumn: columns[Number(sourceIndex)] ?? "",
        target,
        required: false,
      }));
    const response = await fetch(
      `/api/scans/${upload.scan.id}/mapping/save-profile`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "VSI default",
          headerRow,
          mapping: mappingRows,
        }),
      },
    );
    if (!response.ok) setError("Unable to save VSI profile.");
    else if (supplierId) {
      const refreshed = await fetch(`/api/suppliers/${supplierId}/profiles`);
      if (refreshed.ok) setProfiles((await refreshed.json()) as SheetProfile[]);
    }
  }

  function applyProfile(): void {
    const profile = profiles.find((candidate) => candidate.id === profileId);
    if (!profile || !sheet) return;
    const profileColumns = sheet.preview[profile.headerRow - 1];
    if (!profileColumns) {
      setError("The saved profile header is outside this file preview.");
      return;
    }
    const next: Record<number, string> = {};
    for (const mappingRow of profile.mapping) {
      const sourceIndex = profileColumns.findIndex(
        (column) =>
          column.trim().toLocaleLowerCase() ===
          mappingRow.sourceColumn.trim().toLocaleLowerCase(),
      );
      if (sourceIndex < 0) {
        setError(`Saved profile column not found: ${mappingRow.sourceColumn}`);
        return;
      }
      next[sourceIndex] = mappingRow.target;
    }
    setError(null);
    setHeaderRow(profile.headerRow);
    setMapping(next);
  }

  async function normalize(): Promise<void> {
    if (!upload?.scan) return;
    const response = await fetch(`/api/scans/${upload.scan.id}/normalize`, {
      method: "POST",
    });
    if (!response.ok) {
      setError("Scan is not ready to normalize.");
      return;
    }
    await refresh(upload.id);
  }

  return (
    <main>
      <h1>Upload and mapping</h1>
      <p>
        Upload a CSV, XLSX, or XLS catalog. Supplier data stays in private
        object storage.
      </p>
      <label>
        Supplier{" "}
        <select
          value={supplierId}
          onChange={(event) => {
            setSupplierId(event.target.value);
            setProfileId("");
          }}
        >
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.code} — {supplier.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Catalog file{" "}
        <input
          type="file"
          accept=".csv,.xls,.xlsx"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>
      <button
        type="button"
        onClick={() => void startUpload()}
        disabled={!file || !supplierId}
      >
        Upload and inspect
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {upload ? (
        <section>
          <h2>Upload status: {upload.status}</h2>
          {upload.rejectionCode ? (
            <p role="alert">Upload rejected: {upload.rejectionCode}</p>
          ) : null}
          {upload.sheets.length > 0 ? (
            <>
              <label>
                Sheet{" "}
                <select
                  value={sheet?.id ?? ""}
                  onChange={(event) => {
                    setSheetId(event.target.value);
                    const next = upload.sheets.find(
                      (candidate) => candidate.id === event.target.value,
                    );
                    setHeaderRow(next?.headerCandidates[0]?.row ?? 1);
                    setMapping({});
                  }}
                >
                  {upload.sheets.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name} ({candidate.rowCount} rows)
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Header row{" "}
                <input
                  type="number"
                  min="1"
                  max={sheet?.preview.length ?? 1}
                  value={headerRow}
                  onChange={(event) => {
                    setHeaderRow(Number(event.target.value));
                    setMapping({});
                  }}
                />
              </label>
              <table>
                <thead>
                  <tr>
                    {columns.map((column, index) => (
                      <th key={index}>
                        {column || `Column ${index + 1}`}
                        <select
                          value={mapping[index] ?? ""}
                          onChange={(event) =>
                            setMapping((current) => ({
                              ...current,
                              [index]: event.target.value,
                            }))
                          }
                        >
                          {targets.map((target) => (
                            <option key={target} value={target}>
                              {target || "Ignore"}
                            </option>
                          ))}
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(sheet?.preview ?? [])
                    .slice(headerRow, headerRow + 10)
                    .map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {columns.map((_, columnIndex) => (
                          <td key={columnIndex}>{row[columnIndex]}</td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
              <button type="button" onClick={() => void saveMapping()}>
                Save mapping
              </button>
              <button type="button" onClick={() => void saveVsiProfile()}>
                Save VSI profile
              </button>
              {profiles.length > 0 ? (
                <label>
                  Saved profile{" "}
                  <select
                    value={profileId}
                    onChange={(event) => setProfileId(event.target.value)}
                  >
                    <option value="">Select a profile</option>
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name} (v{profile.version ?? 1})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={applyProfile}
                    disabled={!profileId}
                  >
                    Apply profile
                  </button>
                </label>
              ) : null}
              <button
                type="button"
                onClick={() => void normalize()}
                disabled={upload.status !== "READY"}
              >
                Normalize rows
              </button>
              {upload.scan?.supplierRows.some(
                (row) => row.warnings.length > 0,
              ) ? (
                <section>
                  <h3>Normalization warnings</h3>
                  <ul>
                    {upload.scan.supplierRows.flatMap((row) =>
                      row.warnings.map((warning) => (
                        <li
                          key={`${row.sourceRowNumber}-${warning.code}-${warning.field ?? ""}`}
                        >
                          Row {row.sourceRowNumber}: {warning.code}
                          {warning.field ? ` (${warning.field})` : ""}
                        </li>
                      )),
                    )}
                  </ul>
                </section>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
