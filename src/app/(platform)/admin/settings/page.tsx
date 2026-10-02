import type { Metadata } from "next";

import { AccessDenied } from "@/components/common/access-denied";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Section } from "@/components/common/section";
import { RetrievalStatus } from "@/components/knowledge-admin/retrieval-status";
import { StatusBadge } from "@/components/status/status-badge";
import { Card } from "@/components/ui/card";
import { ADMIN_REQUIREMENT } from "@/config/navigation";
import { SHORTCUTS } from "@/config/shortcuts";
import { isDemoMode } from "@/dev/demo/demo-mode";
import { meetsRequirement } from "@/lib/auth/permissions";
import { authorize } from "@/lib/auth/server-session";
import { embeddingSettings } from "@/lib/knowledge/admin-data";
import { SETTINGS_MANAGE } from "@/lib/knowledge/admin-requirements";
import { getRetrievalAvailability } from "@/lib/knowledge/retrieval";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Systemindstillinger · Admin" };

const RETENTION_CATEGORIES = ["AI-samtaler", "Retrieval-logs", "Kundecases", "Læringsdata", "Assessment-data", "Analytics-hændelser", "Audit-logs"];

const MODEL_STATUS: Record<string, string> = { active: "Aktiv", candidate: "Kandidat", retired: "Udfaset" };

export default async function AdminSettingsPage() {
  const session = await authorize(ADMIN_REQUIREMENT);
  if (!session) return <AccessDenied />;
  const showEmbedding = !isDemoMode() && meetsRequirement(session.grants, SETTINGS_MANAGE);
  const [embedding, availability] = showEmbedding ? await Promise.all([embeddingSettings(), getRetrievalAvailability()]) : [null, null];

  return (
    <PageContainer>
      <PageHeader title="Systemindstillinger" />
      <div className="grid gap-10 xl:grid-cols-2">
        <Section title="Tastaturgenveje" description="Defineret ét sted som konfiguration og kan slås fra organisationsbredt.">
          <Card className="p-0">
            <ul className="divide-y divide-border-subtle">
              {Object.values(SHORTCUTS).map((shortcut) => (
                <li key={shortcut.id} className="flex items-center justify-between gap-3 px-6 py-3">
                  <span className="text-body text-fg-primary">{shortcut.description}</span>
                  <span className="flex items-center gap-3">
                    <kbd className="rounded-sm border border-border-subtle bg-surface-sunken px-1.5 font-mono text-caption">⌘/Ctrl + {shortcut.key.toUpperCase()}</kbd>
                    <StatusBadge status={shortcut.enabled ? "success" : "neutral"} label={shortcut.enabled ? "Slået til" : "Slået fra"} />
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
        <Section title="Retention pr. datakategori" description="Hver kategori får sin egen politik. Perioderne er endnu ikke fastlagt.">
          <Card className="p-0">
            <ul className="divide-y divide-border-subtle">
              {RETENTION_CATEGORIES.map((category) => (
                <li key={category} className="flex items-center justify-between gap-3 px-6 py-3">
                  <span className="text-body text-fg-primary">{category}</span>
                  <StatusBadge status="neutral" label="Ikke fastlagt" />
                </li>
              ))}
            </ul>
          </Card>
        </Section>
        {embedding ? (
          <Section title="Embedding og retrieval" description="Kun visning. Udbyder og model er konfiguration og er endnu ikke valgt til produktion.">
            {availability ? <RetrievalStatus availability={availability} /> : null}
            <Card className="mt-4 p-0">
              <ul className="divide-y divide-border-subtle">
                {embedding.models.length === 0 ? <li className="px-6 py-3 text-body text-fg-secondary">Ingen modeller registreret.</li> : null}
                {embedding.models.map((model) => (
                  <li key={model.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
                    <span>
                      <span className="block font-mono text-mono text-fg-primary">{model.label}</span>
                      <span className="block text-caption text-fg-secondary">
                        {model.dimensions} dimensioner · {model.embeddings} embeddings af {embedding.publishedChunks} publicerede chunks
                        {model.activatedAt ? ` · aktiveret ${formatDate(model.activatedAt)}` : ""}
                      </span>
                    </span>
                    <StatusBadge status={model.status === "active" ? "success" : "neutral"} label={MODEL_STATUS[model.status] ?? model.status} />
                  </li>
                ))}
              </ul>
            </Card>
          </Section>
        ) : null}
      </div>
    </PageContainer>
  );
}
