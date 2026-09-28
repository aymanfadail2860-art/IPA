"use client";

import { BriefcaseBusiness, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AvatarStack } from "@/components/common/avatar-stack";
import { DisabledReason } from "@/components/common/disabled-reason";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Section } from "@/components/common/section";
import { DataTable, type DataTableColumn } from "@/components/data/data-table";
import { EmptyState } from "@/components/states/empty-state";
import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { CASE_STATUS } from "@/config/domain-status";
import { hasPermission } from "@/lib/auth/permissions";
import { useSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import type { CustomerCase } from "@/types/domain";

const columns: DataTableColumn<CustomerCase>[] = [
  {
    id: "company",
    header: "Virksomhed",
    sortValue: (row) => row.companyName,
    cell: (row) => (
      <Link href={`/advise/${row.id}`} className="font-medium text-fg-primary hover:underline">
        {row.companyName}
        <span className="block text-caption font-normal text-fg-tertiary">{row.industry}</span>
      </Link>
    ),
  },
  {
    id: "area",
    header: "Arbejdsområde",
    cell: (row) => row.workAreas.find((area) => area.id === row.currentAreaId)?.name,
  },
  {
    id: "status",
    header: "Status",
    sortValue: (row) => CASE_STATUS[row.status].label,
    cell: (row) => <StatusBadge status={CASE_STATUS[row.status].status} label={CASE_STATUS[row.status].label} />,
  },
  {
    id: "participants",
    header: "Delt med",
    cell: (row) => <AvatarStack people={row.participants} />,
  },
  {
    id: "updated",
    header: "Opdateret",
    sortValue: (row) => row.updatedAt,
    cell: (row) => <span className="text-fg-secondary">{formatDate(row.updatedAt)}</span>,
  },
];

/** Case overview (Sagsoversigt). Access to a case is granted per case, never through the role. */
export function AdviseOverview({ cases }: { cases: readonly CustomerCase[] }) {
  const { grants } = useSession();
  const router = useRouter();
  const canRead = hasPermission(grants, "advise.case.read");
  const open = cases.filter((entry) => entry.status !== "closed");
  const closed = cases.filter((entry) => entry.status === "closed");

  return (
    <PageContainer>
      <PageHeader
        display
        title="Advise"
        description="Dit arbejdsværktøj til rådgivning på reelle kundecases. AI foreslår — du afgør."
        actions={
          <DisabledReason reason="Oprettelse af kundecases kræver database og adgangsstyring, som bygges i en senere fase.">
            <Button variant="primary" disabled>
              <Plus aria-hidden />
              Opret kundecase
            </Button>
          </DisabledReason>
        }
      />

      {canRead ? (
        <>
          <Section title="Mine sager">
            <DataTable
              caption="Mine kundecases"
              columns={columns}
              rows={open}
              getRowId={(row) => row.id}
              getRowLabel={(row) => row.companyName}
              rowActions={[{ label: "Åbn sag", onSelect: (row) => router.push(`/advise/${row.id}`) }]}
              emptyState={<EmptyState icon={BriefcaseBusiness} title="Ingen aktive sager">Opret en kundecase for at komme i gang.</EmptyState>}
            />
          </Section>
          <Section title="Afsluttede">
            <DataTable
              caption="Afsluttede kundecases"
              columns={columns}
              rows={closed}
              getRowId={(row) => row.id}
              getRowLabel={(row) => row.companyName}
              emptyState={<EmptyState title="Ingen afsluttede sager" />}
            />
          </Section>
        </>
      ) : (
        <EmptyState icon={BriefcaseBusiness} title="Du har ingen kundecases">
          Adgang til en kundecase gives pr. sag — til sagens ejer og de brugere, sagen er delt med.
        </EmptyState>
      )}
    </PageContainer>
  );
}
