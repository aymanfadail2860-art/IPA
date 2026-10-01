import { StatusBadge } from "@/components/status/status-badge";
import { publishedState, VERSION_STATUS, type AdminVersionRow } from "@/lib/knowledge/admin-types";
import { formatDate } from "@/lib/format";

/** Version status with the derived states of a published version (docs/07 §2.1, §3.3). */
export function VersionStatusBadge({ version, today }: { version: Pick<AdminVersionRow, "status" | "validFrom" | "validTo" | "supersededBy">; today: string }) {
  if (version.status !== "published") {
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
