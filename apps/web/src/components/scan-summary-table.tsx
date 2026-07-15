import Link from "next/link";
import { Badge, Progress } from "./ui";
import {
  relativeTimestamp,
  scanDisplayName,
  scanStatusPresentation,
  type ScanSummary,
} from "./dashboard-state";

export function ScanSummaryTable({ scans }: { scans: ScanSummary[] }) {
  return (
    <div className="scan-table-wrap">
      <table className="scan-table">
        <thead>
          <tr>
            <th scope="col">Catalog scan</th>
            <th scope="col">Supplier</th>
            <th scope="col">Status</th>
            <th scope="col">Rows</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {scans.map((scan) => {
            const status = scanStatusPresentation(scan.status);
            const completed =
              scan.status === "COMPLETED" || scan.status === "PARTIAL_SUCCESS";
            return (
              <tr key={scan.id}>
                <td>
                  <strong>{scanDisplayName(scan)}</strong>
                  <small>Scan {scan.id.slice(-8)}</small>
                </td>
                <td>{scan.supplier?.name ?? "Local diagnostic"}</td>
                <td>
                  <Badge tone={status.tone}>{status.label}</Badge>
                  <Progress
                    value={status.progress}
                    label={`${status.label} progress`}
                  />
                </td>
                <td>{scan._count.supplierRows || "—"}</td>
                <td>
                  <span>{relativeTimestamp(scan.updatedAt)}</span>
                  {completed ? (
                    <Link
                      className="table-link"
                      href={`/scans/${scan.id}/analysis`}
                    >
                      Open analysis
                    </Link>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
