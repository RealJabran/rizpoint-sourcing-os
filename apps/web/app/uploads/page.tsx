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
  inspectionRecoveryState,
  safeDisplayFilename,
  suggestMapping,
  uploadErrorMessage,
  uploadStatusLabel,
} from "@/src/phase-one";
import { scanStatusPresentation } from "@/src/components/dashboard-state";

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
    status: string;
    checkpoints: Array<{ stage: string }>;
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
  const [mappingSubmitting, setMappingSubmitting] = useState(false);
  const [scanSubmitting, setScanSubmitting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pollTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    },
    [],
  );
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
  const recovery = inspectionRecoveryState(
    upload?.status ?? "",
    upload?.scan?.status,
    upload?.rejectionCode ?? null,
  );
  const calculationPersisted = Boolean(
    upload?.scan?.checkpoints.some(({ stage }) => stage === "CALCULATE"),
  );
  const workflowStatus = scanStatusPresentation(upload?.scan?.status ?? "");
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
    const shouldRefresh =
      ["INSPECTING", "NORMALIZING"].includes(next.status) &&
      inspectionRecoveryState(
        next.status,
        next.scan?.status,
        next.rejectionCode,
      ) !== "MANUAL_RETRY";
    const workflowActive = [
      "NORMALIZING",
      "MATCHING",
      "ENRICHING",
      "CALCULATING",
    ].includes(next.scan?.status ?? "");
    const awaitingNextStage =
      next.status === "COMPLETED" &&
      !next.scan?.checkpoints.some(({ stage }) => stage === "CALCULATE") &&
      !["FAILED_RETRYABLE", "FAILED_FINAL"].includes(next.scan?.status ?? "");
    if (shouldRefresh || workflowActive || awaitingNextStage) {
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
      pollTimer.current = window.setTimeout(
        () =>
          void refresh(id).catch(() =>
            setError(
              "We could not refresh scan progress. Retry from this step.",
            ),
          ),
        700,
      );
    }
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
    if (!upload?.scan || !sheet || safety.length || mappingSubmitting) return;
    setError(null);
    setMappingSubmitting(true);
    const mappings = Object.entries(mapping)
      .filter(([, target]) => target)
      .map(([sourceIndex, target]) => ({
        sourceIndex: Number(sourceIndex),
        sourceColumn:
          columns[Number(sourceIndex)] || `Column ${Number(sourceIndex) + 1}`,
        target,
        required: ["DESCRIPTION", "UNIT_COST"].includes(target),
      }));
    try {
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
    } catch {
      setError(
        "The mapping request could not reach RizPoint. Your selections are still here; retry confirmation.",
      );
    } finally {
      setMappingSubmitting(false);
    }
  }
  async function startScan() {
    if (!upload?.scan || scanSubmitting) return;
    setError(null);
    setScanSubmitting(true);
    try {
      const response = await fetch(`/api/scans/${upload.scan.id}/start`, {
        method: "POST",
      });
      if (!response.ok) {
        setError(uploadErrorMessage(await responseError(response)));
        return;
      }
      await refresh(upload.id);
    } catch {
      setError(
        "RizPoint could not start or resume processing. The saved checkpoint is unchanged; retry this action.",
      );
    } finally {
      setScanSubmitting(false);
    }
  }
  async function retryInspection() {
    if (!upload) return;
    setError(null);
    const response = await fetch(`/api/uploads/${upload.id}/inspect`, {
      method: "POST",
    });
    if (!response.ok) {
      setError(uploadErrorMessage(await responseError(response)));
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
                {uploadStatusLabel(upload.status)}
              </Badge>
              {upload.rejectionCode ? (
                <Alert
                  tone={recovery === "AUTOMATIC_RETRY" ? "warning" : "danger"}
                  title={
                    recovery === "AUTOMATIC_RETRY"
                      ? "Inspection retrying"
                      : "Catalog inspection needs attention"
                  }
                >
                  {uploadErrorMessage(upload.rejectionCode)}
                </Alert>
              ) : null}
              {recovery === "AUTOMATIC_RETRY" ? (
                <Alert tone="warning" title="Retrying in the background">
                  The original private object and checkpoint are retained. Keep
                  this page open while the worker retries safely.
                </Alert>
              ) : null}
              {recovery === "MANUAL_RETRY" ? (
                <Alert tone="danger" title="Inspection stopped after retries">
                  The catalog is still private and has not been normalized. When
                  the scanner is available, retry this same inspection without
                  uploading another copy.
                  <div className="page-actions">
                    <Button
                      type="button"
                      onClick={() => void retryInspection()}
                    >
                      Retry inspection
                    </Button>
                  </div>
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
                processing advances through normalization, matching, fixture
                enrichment, and deterministic calculation. Retries resume from
                persisted checkpoints without duplicating rows or provider
                calls.
              </p>
              {upload.scan ? (
                <div className="scan-run-status" aria-live="polite">
                  <div>
                    <strong>{workflowStatus.label}</strong>
                    <span>
                      {calculationPersisted
                        ? "Analysis results are persisted."
                        : "RizPoint will keep this workflow resumable at every completed stage."}
                    </span>
                  </div>
                  <Progress
                    value={workflowStatus.progress}
                    label="Catalog processing progress"
                  />
                </div>
              ) : null}
              <div className="page-actions">
                <Button
                  type="button"
                  onClick={() => void saveMapping()}
                  disabled={
                    mappingSubmitting ||
                    !Object.values(mapping).some(Boolean) ||
                    safety.length > 0
                  }
                  loading={mappingSubmitting}
                >
                  {upload.status === "READY"
                    ? "Mapping confirmed"
                    : "Confirm mapping"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void startScan()}
                  disabled={
                    scanSubmitting ||
                    upload.status !== "READY" ||
                    safety.length > 0
                  }
                  loading={scanSubmitting}
                >
                  Start scan
                </Button>
                {["FAILED_RETRYABLE", "FAILED_FINAL"].includes(
                  upload.scan?.status ?? "",
                ) && upload.status !== "REJECTED" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void startScan()}
                    loading={scanSubmitting}
                  >
                    Retry processing
                  </Button>
                ) : null}
                {calculationPersisted && upload.scan ? (
                  <ButtonLink href={`/scans/${upload.scan.id}/analysis`}>
                    Open analysis
                  </ButtonLink>
                ) : null}
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
