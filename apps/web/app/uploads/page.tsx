"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/src/components/page-header";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  Progress,
  SelectControl,
} from "@/src/components/ui";
import {
  mappingSafetyIssues,
  normalizationWarningMessage,
  safeDisplayFilename,
  suggestMapping,
  uploadErrorMessage,
} from "@/src/phase-one";

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
type Sheet = {
  id: string;
  name: string;
  rowCount: number;
  headerCandidates: Array<{ row: number }>;
  preview: string[][];
};
type Upload = {
  id: string;
  originalFilename: string;
  status: string;
  rejectionCode: string | null;
  scan: {
    id: string;
    supplierRows: Array<{
      sourceRowNumber: number;
      warnings: Array<{ code: string; field: string | null }>;
    }>;
  } | null;
  sheets: Sheet[];
};
const steps = [
  "Supplier",
  "Upload",
  "Sheet",
  "Mapping",
  "Data quality",
  "Start scan",
];

export default function UploadPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [marketplace, setMarketplace] = useState("US");
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [sheetId, setSheetId] = useState("");
  const [headerRow, setHeaderRow] = useState(1);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void fetch("/api/suppliers").then(async (r) => {
      if (r.ok) {
        const value = (await r.json()) as Supplier[];
        setSuppliers(value);
        setSupplierId(value[0]?.id ?? "");
      }
    });
  }, []);
  const sheet = useMemo(
    () =>
      upload?.sheets.find((s) => s.id === sheetId) ?? upload?.sheets[0] ?? null,
    [upload, sheetId],
  );
  const columns = useMemo(
    () => sheet?.preview[headerRow - 1] ?? [],
    [headerRow, sheet],
  );
  const samples = useMemo(
    () => sheet?.preview.slice(headerRow, headerRow + 8) ?? [],
    [headerRow, sheet],
  );
  const safety = useMemo(
    () => mappingSafetyIssues(mapping, samples),
    [mapping, samples],
  );
  const step = !upload
    ? file
      ? 1
      : 0
    : upload.status === "INSPECTING"
      ? 2
      : !sheet
        ? 2
        : !Object.keys(mapping).length
          ? 3
          : upload.status === "READY"
            ? 4
            : upload.status === "COMPLETED"
              ? 5
              : 2;

  async function refresh(id: string) {
    const response = await fetch(`/api/uploads/${id}`, { cache: "no-store" });
    if (!response.ok) throw new Error("UPLOAD_STATUS_UNAVAILABLE");
    const next = (await response.json()) as Upload;
    setUpload(next);
    if (next.sheets[0] && !sheetId) {
      setSheetId(next.sheets[0].id);
      setHeaderRow(next.sheets[0].headerCandidates[0]?.row ?? 1);
    }
    if (["INSPECTING", "NORMALIZING"].includes(next.status))
      window.setTimeout(
        () =>
          void refresh(id).catch(() =>
            setError(
              "We could not refresh scan progress. Retry from this step.",
            ),
          ),
        700,
      );
  }
  function choose(next: File | null) {
    setFile(next);
    setUpload(null);
    setMapping({});
    setError(null);
    setIdempotencyKey(next ? crypto.randomUUID() : null);
  }
  async function uploadCatalog() {
    if (!file || !supplierId) return;
    const key = idempotencyKey ?? crypto.randomUUID();
    setIdempotencyKey(key);
    try {
      const presign = await fetch("/api/uploads/presign", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({
          supplierId,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        }),
      });
      if (!presign.ok) throw new Error(await responseError(presign));
      const created = (await presign.json()) as {
        uploadId: string;
        uploadUrl: string;
      };
      const put = await fetch(created.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!put.ok) throw new Error("UPLOAD_OBJECT_MISSING");
      const inspect = await fetch(`/api/uploads/${created.uploadId}/inspect`, {
        method: "POST",
      });
      if (!inspect.ok) throw new Error(await responseError(inspect));
      await refresh(created.uploadId);
    } catch (caught) {
      setError(
        uploadErrorMessage(
          caught instanceof Error ? caught.message : "INVALID_UPLOAD",
        ),
      );
    }
  }
  function applySuggestions() {
    const next: Record<number, string> = {};
    columns.forEach((column, index) => {
      const suggestion = suggestMapping(column);
      if (suggestion) next[index] = suggestion.target;
    });
    setMapping(next);
  }
  async function saveMapping() {
    if (!upload?.scan || !sheet || safety.length) return;
    const mappings = Object.entries(mapping)
      .filter(([, target]) => target)
      .map(([sourceIndex, target]) => ({
        sourceIndex: Number(sourceIndex),
        sourceColumn: columns[Number(sourceIndex)] || `Column ${sourceIndex}`,
        target,
        required: ["DESCRIPTION", "UNIT_COST"].includes(target),
      }));
    const response = await fetch(`/api/scans/${upload.scan.id}/mapping`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadSheetId: sheet.id, headerRow, mappings }),
    });
    if (!response.ok) {
      setError(uploadErrorMessage(await responseError(response)));
      return;
    }
    await refresh(upload.id);
  }
  async function startScan() {
    if (!upload?.scan) return;
    const response = await fetch(`/api/scans/${upload.scan.id}/normalize`, {
      method: "POST",
    });
    if (!response.ok) {
      setError(
        "This scan is not ready to start. Review mapping and data-quality blockers, then retry.",
      );
      return;
    }
    await refresh(upload.id);
  }
  return (
    <main className="guided-scan-page">
      <PageHeader
        title="New catalog scan"
        description="Map supplier data before matching or financial analysis begins."
        actions={
          <ButtonLink href="/scans" variant="secondary">
            Scan list
          </ButtonLink>
        }
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: "New scan" }]}
      />
      <ol className="scan-stepper" aria-label="Catalog scan steps">
        {steps.map((name, index) => (
          <li
            key={name}
            className={index <= step ? "scan-stepper__active" : ""}
          >
            <span>{index + 1}</span>
            {name}
          </li>
        ))}
      </ol>
      {error ? (
        <Alert tone="danger" title="Action needed">
          {error}{" "}
          <Button
            type="button"
            variant="quiet"
            size="sm"
            onClick={() => setError(null)}
          >
            Dismiss
          </Button>
        </Alert>
      ) : null}
      <Card className="wizard-card">
        <section>
          <h2>1. Supplier and marketplace</h2>
          <div className="wizard-fields">
            <label>
              Supplier
              <SelectControl
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </SelectControl>
            </label>
            <label>
              Marketplace
              <SelectControl
                value={marketplace}
                onChange={(e) => setMarketplace(e.target.value)}
              >
                <option value="US">Amazon United States</option>
              </SelectControl>
              <small>
                Marketplace selection guides later enrichment; it does not
                change source catalog values.
              </small>
            </label>
          </div>
        </section>
        <section>
          <h2>2. Upload and validation</h2>
          <p>
            CSV, XLSX, or XLS up to 50 MiB. The original stays in private object
            storage; RizPoint never uses the filename as an object key.
          </p>
          <div
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              choose(e.dataTransfer.files[0] ?? null);
            }}
          >
            <strong>Drop a catalog here</strong>
            <span>or</span>
            <Button
              type="button"
              variant="secondary"
              onClick={() => input.current?.click()}
            >
              Choose catalog file
            </Button>
            <input
              ref={input}
              className="sr-only"
              type="file"
              accept=".csv,.xls,.xlsx"
              onChange={(e) => choose(e.target.files?.[0] ?? null)}
            />
          </div>
          {file ? (
            <div className="file-summary">
              <Badge tone="info">Selected</Badge>
              <strong>{safeDisplayFilename(file.name)}</strong>
              <span>
                {(file.size / 1024 / 1024).toFixed(2)} MiB • {marketplace}
              </span>
              <Button
                type="button"
                size="sm"
                onClick={() => void uploadCatalog()}
                disabled={!supplierId}
              >
                Upload and inspect
              </Button>
            </div>
          ) : null}
        </section>
        {upload ? (
          <>
            <section>
              <h2>3. Sheet and header selection</h2>
              <Badge
                tone={
                  upload.status === "REJECTED"
                    ? "danger"
                    : upload.status === "READY"
                      ? "success"
                      : "info"
                }
              >
                {upload.status}
              </Badge>
              {upload.rejectionCode ? (
                <Alert tone="danger" title="Catalog rejected">
                  {uploadErrorMessage(upload.rejectionCode)}
                </Alert>
              ) : null}
              {upload.status === "INSPECTING" ? (
                <>
                  <p>Inspecting workbook safely…</p>
                  <Progress value={45} label="Workbook inspection" />
                </>
              ) : null}
              {sheet ? (
                <div className="wizard-fields">
                  <label>
                    Worksheet
                    <SelectControl
                      value={sheet.id}
                      onChange={(e) => {
                        setSheetId(e.target.value);
                        const next = upload.sheets.find(
                          (s) => s.id === e.target.value,
                        );
                        setHeaderRow(next?.headerCandidates[0]?.row ?? 1);
                        setMapping({});
                      }}
                    >
                      {upload.sheets.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.rowCount} rows)
                        </option>
                      ))}
                    </SelectControl>
                  </label>
                  <label>
                    Header row
                    <input
                      className="rp-input"
                      type="number"
                      min="1"
                      max={sheet.preview.length}
                      value={headerRow}
                      onChange={(e) => {
                        setHeaderRow(Number(e.target.value));
                        setMapping({});
                      }}
                    />
                  </label>
                </div>
              ) : null}
            </section>
            {sheet ? (
              <section>
                <div className="section-heading">
                  <div>
                    <h2>4. Column mapping</h2>
                    <p>
                      Suggestions are based only on column labels. Confirm every
                      mapping before saving.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={applySuggestions}
                  >
                    Apply suggestions
                  </Button>
                </div>
                <div className="preview-wrap">
                  <table className="mapping-table">
                    <thead>
                      <tr>
                        {columns.map((column, index) => {
                          const suggestion = suggestMapping(column);
                          return (
                            <th key={index}>
                              <span>{column || `Column ${index + 1}`}</span>
                              <SelectControl
                                value={mapping[index] ?? ""}
                                onChange={(e) =>
                                  setMapping((current) => ({
                                    ...current,
                                    [index]: e.target.value,
                                  }))
                                }
                              >
                                {targets.map((target) => (
                                  <option key={target} value={target}>
                                    {target || "Ignore"}
                                  </option>
                                ))}
                              </SelectControl>
                              {suggestion ? (
                                <small>
                                  Suggested {suggestion.target} •{" "}
                                  {Math.round(suggestion.confidence * 100)}%
                                </small>
                              ) : (
                                <small>No suggestion</small>
                              )}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {samples.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {columns.map((_, index) => (
                            <td key={index}>{row[index] || "—"}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
            <section>
              <h2>5. Data-quality and PackGuard review</h2>
              {safety.length ? (
                <Alert tone="blocked" title="Financial safety blocker">
                  <ul>
                    {safety.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </Alert>
              ) : (
                <Alert tone="info" title="Mapping ready for confirmation">
                  Identifier strings, including leading-zero UPC/EAN values,
                  remain text throughout ingestion. Verify price unit, currency,
                  quantity, case, and pack values in the preview.
                </Alert>
              )}
              <ul className="risk-list">
                <li>
                  ASIN / UPC / EAN / title / supplier SKU: confirm identifiers
                  map to the intended columns.
                </li>
                <li>
                  Price and currency: use unit cost, not a case price, unless
                  case/pack is mapped.
                </li>
                <li>
                  Case and pack: non-whole sample conversions block financial
                  analysis until corrected.
                </li>
                <li>
                  Brand, model, and size: keep available for later contradiction
                  review.
                </li>
              </ul>
            </section>
            <section>
              <h2>6. Confirm and start scan</h2>
              <p>
                Saving mapping creates a resumable checkpoint. Starting
                normalization is idempotent; retries do not duplicate rows or
                provider calls.
              </p>
              <div className="page-actions">
                <Button
                  type="button"
                  onClick={() => void saveMapping()}
                  disabled={!Object.keys(mapping).length || safety.length > 0}
                >
                  Confirm mapping
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void startScan()}
                  disabled={upload.status !== "READY" || safety.length > 0}
                >
                  Start scan
                </Button>
              </div>
              {upload.scan?.supplierRows.some((row) => row.warnings.length) ? (
                <Alert tone="warning" title="Normalization warnings">
                  {upload.scan.supplierRows
                    .flatMap((row) =>
                      row.warnings.map(
                        (w) =>
                          `Row ${row.sourceRowNumber}: ${normalizationWarningMessage(w.code)}${w.field ? ` (${w.field})` : ""}`,
                      ),
                    )
                    .slice(0, 12)
                    .map((w) => (
                      <div key={w}>{w}</div>
                    ))}
                </Alert>
              ) : null}
            </section>
          </>
        ) : null}
      </Card>
    </main>
  );
}
async function responseError(response: Response) {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return body?.error ?? "INVALID_UPLOAD";
}
