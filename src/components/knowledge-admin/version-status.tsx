import { StatusBadge } from "@/components/status/status-badge";
import { publishedState, SECURITY_STATUS, VERSION_STATUS, type AdminVersionRow, type SecurityStatus } from "@/lib/knowledge/admin-types";
import { formatDate } from "@/lib/format";

/**
 * Version status with the derived states of a published version (docs/07 §2.1, §3.3). Before
 * processing, the security examination is the status that matters (8B-I5): a version that has
 * not been released shows its security category instead.
 */
export function VersionStatusBadge({
  version,
  today,
}: {
  version: Pick<AdminVersionRow, "status" | "validFrom" | "validTo" | "supersededBy"> & { security?: SecurityStatus };
  today: string;
}) {
  if (version.status !== "published") {
    const beforeProcessing = version.status === "uploaded" || version.status === "processing" || version.status === "processing_failed";
    if (beforeProcessing && version.security && version.security !== "released") return <SecurityStatusBadge security={version.security} />;
    const { label, status } = VERSION_STATUS[version.status];
    return <StatusBadge status={status} label={label} />;
  }
  const state = publishedState(version, today);
  const label =
    state.key === "future" && version.validFrom
      ? `Godkendt — gældende fra ${formatDate(version.validFrom)}`
      : state.key === "historical"
        ? "Historisk"
        : version.supersededBy
          ? "Aktiv — erstattes"
          : "Aktiv";
  return <StatusBadge status={state.status} label={label} />;
}

/** The security examination of the original — the category only, never a finding (8B-I5). */
export function SecurityStatusBadge({ security }: { security: SecurityStatus }) {
  const { label, status } = SECURITY_STATUS[security];
  return <StatusBadge status={status} label={label} />;
}
