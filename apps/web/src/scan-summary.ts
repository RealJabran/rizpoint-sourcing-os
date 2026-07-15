export type ScanSummary = {
  id: string;
  jobType: string;
  status: string;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  supplier: { code: string; name: string } | null;
  upload: {
    originalFilename: string;
    status: string;
    malwareStatus: string;
  } | null;
  _count: { supplierRows: number };
};

type PersistedScanSummary = Omit<
  ScanSummary,
  "createdAt" | "updatedAt" | "completedAt"
> & {
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export function toScanSummary(scan: PersistedScanSummary): ScanSummary {
  return {
    id: scan.id,
    jobType: scan.jobType,
    status: scan.status,
    attemptCount: scan.attemptCount,
    createdAt: scan.createdAt.toISOString(),
    updatedAt: scan.updatedAt.toISOString(),
    completedAt: scan.completedAt?.toISOString() ?? null,
    supplier: scan.supplier,
    upload: scan.upload,
    _count: scan._count,
  };
}
