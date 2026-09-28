"use client";

import { ChevronDown, FileText, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { AvatarStack, InitialsAvatar } from "@/components/common/avatar-stack";
import { Section } from "@/components/common/section";
import { CopilotContext } from "@/components/copilot/copilot-context";
import { StepRail, workAreaStateLabel } from "@/components/data/step-rail";
import { Timeline } from "@/components/data/timeline";
import { AIRequestTrigger } from "@/components/knowledge/ai-request-trigger";
import { AISuggestion } from "@/components/knowledge/ai-suggestion";
import { QualitySignal } from "@/components/knowledge/quality-signal";
import { SourceCard } from "@/components/knowledge/source-card";
import { ValidatedConclusion } from "@/components/knowledge/validated-conclusion";
import { WorkingNote } from "@/components/knowledge/working-note";
import { PageBreadcrumbs } from "@/components/shell/breadcrumbs";
import { useShell } from "@/components/shell/shell-context";
import { EmptyState } from "@/components/states/empty-state";
import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CASE_STATUS } from "@/config/domain-status";
import { useSession } from "@/lib/auth/session";
import type { CaseContentItem, CustomerCase } from "@/types/domain";

const TODAY = () => new Date().toISOString().slice(0, 10);

/**
 * Case workspace (docs/04-ui-ux-design.md §10). Four kinds of content appear side by side
 * and must never be confused: authoritative case information, validated conclusions,
 * AI suggestions (dashed, tinted, labelled) and working notes.
 *
 * PHASE 5: all state is local and mock; nothing is saved.
 */
export function CaseWorkspace({ customerCase, areaId }: { customerCase: CustomerCase; areaId: string }) {
  const router = useRouter();
  const { user } = useSession();
  const { openCopilot } = useShell();
  const selectId = useId();

  const area = customerCase.workAreas.find((entry) => entry.id === areaId)!;
  const isSummary = area.id === "opsummering";
  const status = CASE_STATUS[customerCase.status];

  const [requested, setRequested] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<CaseContentItem[]>([]);
  const [rejected, setRejected] = useState<CaseContentItem[]>([]);
  const [conclusions, setConclusions] = useState<CaseContentItem[]>([...customerCase.conclusions]);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [note, setNote] = useState(customerCase.note);

  const hrefFor = (target: { id: string }) => `/advise/${customerCase.id}?area=${target.id}`;

  function requestSuggestions() {
    setLoading(true);
    // Mock only: shows the prepared example suggestions. No AI is called in phase 5.
    window.setTimeout(() => {
      setSuggestions([...customerCase.onDemandSuggestions]);
      setRequested(true);
      setLoading(false);
    }, 600);
  }

  function accept(item: CaseContentItem, text = item.text) {
    setSuggestions((list) => list.filter((entry) => entry.id !== item.id));
    setConclusions((list) => [...list, { ...item, text, validatedBy: user.name, validatedAt: TODAY() }]);
    setEditing(null);
  }

  function reject(item: CaseContentItem) {
    setSuggestions((list) => list.filter((entry) => entry.id !== item.id));
    setRejected((list) => [...list, item]);
  }

  function undoValidation(item: CaseContentItem) {
    setConclusions((list) => list.filter((entry) => entry.id !== item.id));
    setSuggestions((list) => [...list, { ...item, validatedBy: undefined, validatedAt: undefined }]);
  }

  const caseSources = [
    ...new Map(
      [...customerCase.conclusions, ...customerCase.onDemandSuggestions]
        .flatMap((item) => item.sources ?? [])
        .map((source) => [source.id, source]),
    ).values(),
  ];

  return (
    <div className="flex min-h-[calc(100dvh-var(--topbar-height))] flex-col @5xl/main:flex-row">
      <PageBreadcrumbs items={[{ label: "Advise", href: "/advise" }, { label: customerCase.companyName }, { label: area.name }]} />
      <CopilotContext value={`${customerCase.companyName} · ${area.name}`} />

      {/* Left: case identity + step rail (select on smaller screens) */}
      <aside
        aria-label="Kundecase"
        className="shrink-0 border-b border-border-subtle bg-surface-raised px-4 py-5 @5xl/main:sticky @5xl/main:top-[var(--topbar-height)] @5xl/main:h-[calc(100dvh-var(--topbar-height))] @5xl/main:w-64 @5xl/main:overflow-y-auto @5xl/main:border-r @5xl/main:border-b-0 @5xl/main:px-3"
      >
        <div className="mb-5 px-2">
          <h1 className="text-heading-3 text-fg-primary">{customerCase.companyName}</h1>
          <p className="text-caption text-fg-secondary">
            {customerCase.industry} · {customerCase.employees}
          </p>
          <StatusBadge className="mt-2" status={status.status} label={status.label} />
        </div>
        <div className="hidden @5xl/main:block">
          <StepRail areas={customerCase.workAreas} currentId={area.id} hrefFor={hrefFor} />
        </div>
        <div className="px-2 @5xl/main:hidden">
          <label htmlFor={selectId} className="mb-1 block text-label text-fg-secondary">
            Arbejdsområde
          </label>
          <select
            id={selectId}
            value={area.id}
            onChange={(event) => router.push(hrefFor({ id: event.target.value }))}
            className="h-10 w-full rounded-md border border-border-strong/60 bg-surface-raised px-3 text-body"
          >
            {customerCase.workAreas.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name} — {workAreaStateLabel(entry.state)}
                {entry.openItems ? ` (${entry.openItems} åbne)` : ""}
              </option>
            ))}
          </select>
        </div>
      </aside>

      {/* Middle: the active work area */}
      <div className="min-w-0 flex-1 px-4 py-8 md:px-8">
        <div className="mx-auto max-w-3xl space-y-10">
          <header>
            <p className="text-label text-fg-tertiary">Arbejdsområde</p>
            <h2 className="text-heading-1 text-fg-primary">{area.name}</h2>
          </header>

          {!isSummary && customerCase.signals.length > 0 ? (
            <div className="space-y-3" aria-label="Kvalitetssignaler">
              {customerCase.signals.map((signal) => (
                <QualitySignal
                  key={signal.id}
                  tone={signal.tone}
                  title={signal.title}
                  detail={signal.detail}
                  action={signal.targetAreaId ? { label: signal.actionLabel, href: hrefFor({ id: signal.targetAreaId }) } : { label: signal.actionLabel }}
                />
              ))}
            </div>
          ) : null}

          <Section title="Sagsinformation" description="Autoritative oplysninger, sagen hviler på.">
            {customerCase.facts.length > 0 ? (
              <dl className="grid gap-x-8 gap-y-4 rounded-lg border border-border-subtle bg-surface-raised p-6 sm:grid-cols-2">
                {customerCase.facts.map((fact) => (
                  <div key={fact.label}>
                    <dt className="text-label text-fg-secondary">{fact.label}</dt>
                    <dd className="text-body text-fg-primary">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <EmptyState title="Ingen sagsinformation endnu">Oplysninger om virksomheden registreres i Virksomhedsprofil.</EmptyState>
            )}
          </Section>

          <Section title="Validerede konklusioner">
            {conclusions.length > 0 ? (
              <div className="space-y-4">
                {conclusions.map((item) => (
                  <ValidatedConclusion
                    key={item.id}
                    title={item.title}
                    validatedBy={item.validatedBy ?? user.name}
                    validatedAt={item.validatedAt ?? TODAY()}
                    sources={item.sources}
                    onUndo={isSummary ? undefined : () => undoValidation(item)}
                  >
                    <p>{item.text}</p>
                  </ValidatedConclusion>
                ))}
              </div>
            ) : (
              <EmptyState title="Ingen validerede konklusioner">
                En konklusion opstår, når du accepterer et forslag eller skriver din egen vurdering.
              </EmptyState>
            )}
          </Section>

          {isSummary ? (
            <Section title="Grundlag" description="De dokumentversioner, sagens konklusioner hviler på.">
              <div className="space-y-3">
                {caseSources.map((source) => (
                  <SourceCard key={source.id} source={source} />
                ))}
              </div>
              <p className="text-caption text-fg-secondary">
                Opsummeringen indeholder kun validerede konklusioner og autoritativ sagsinformation. AI-forslag og
                arbejdsnoter kan ikke komme med.
              </p>
            </Section>
          ) : (
            <>
              <Section title="Forslag til vurdering">
                {!requested ? (
                  <AIRequestTrigger
                    label="Bed om forslag"
                    description={`AI-forslag til ${area.name.toLowerCase()} vises først, når du beder om dem. Tænk selv først — brug AI som sparring.`}
                    loading={loading}
                    onRequest={requestSuggestions}
                  />
                ) : suggestions.length > 0 ? (
                  <div className="space-y-4">
                    {suggestions.map((item) =>
                      editing?.id === item.id ? (
                        <div key={item.id} className="space-y-3 rounded-lg border border-border-strong/60 bg-surface-raised p-5">
                          <label htmlFor={`edit-${item.id}`} className="text-label font-semibold text-fg-primary">
                            Redigér før accept: {item.title}
                          </label>
                          <textarea
                            id={`edit-${item.id}`}
                            value={editing.text}
                            onChange={(event) => setEditing({ id: item.id, text: event.target.value })}
                            rows={4}
                            className="w-full rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-body"
                          />
                          <div className="flex gap-2">
                            <Button size="sm" variant="primary" onClick={() => accept(item, editing.text)}>
                              Acceptér redigeret
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                              Annullér
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <AISuggestion
                          key={item.id}
                          title={item.title}
                          sources={item.sources}
                          onAccept={() => accept(item)}
                          onEditAndAccept={() => setEditing({ id: item.id, text: item.text })}
                          onReject={() => reject(item)}
                        >
                          <p>{item.text}</p>
                        </AISuggestion>
                      ),
                    )}
                  </div>
                ) : (
                  <EmptyState icon={Sparkles} title="Alle forslag er vurderet">
                    Accepterede forslag står under validerede konklusioner.
                  </EmptyState>
                )}
                <p className="text-caption text-fg-tertiary">Eksempelforslag med fiktive data. Der kaldes ingen AI i denne udviklingsversion.</p>
              </Section>

              {rejected.length > 0 ? (
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="group">
                      <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" aria-hidden />
                      Forkastede forslag ({rejected.length})
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-2">
                    <p className="text-caption text-fg-secondary">
                      Kun synligt for sagens deltagere. Indgår ikke i sagen eller opsummeringen.
                    </p>
                    <ul className="space-y-2">
                      {rejected.map((item) => (
                        <li key={item.id} className="rounded-md bg-surface-sunken px-4 py-3 text-body text-fg-secondary">
                          <span className="font-medium">Forkastet:</span> {item.title}
                        </li>
                      ))}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              ) : null}

              <WorkingNote value={note} onChange={setNote} />
            </>
          )}
        </div>
      </div>

      {/* Right: case metadata */}
      <aside
        aria-label="Sagen"
        className="shrink-0 space-y-8 border-t border-border-subtle bg-surface-raised px-5 py-6 @5xl/main:sticky @5xl/main:top-[var(--topbar-height)] @5xl/main:h-[calc(100dvh-var(--topbar-height))] @5xl/main:w-80 @5xl/main:overflow-y-auto @5xl/main:border-t-0 @5xl/main:border-l"
      >
        <section aria-labelledby="case-owner" className="space-y-3">
          <h2 id="case-owner" className="text-caption font-semibold tracking-wide text-fg-tertiary uppercase">
            Sagen
          </h2>
          <div className="flex items-center gap-3">
            <InitialsAvatar initials={customerCase.owner.initials} name={customerCase.owner.name} />
            <div>
              <p className="text-body font-medium text-fg-primary">{customerCase.owner.name}</p>
              <p className="text-caption text-fg-secondary">Ejer</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-body text-fg-secondary">Delt med {customerCase.participants.length - 1}</span>
            <AvatarStack people={customerCase.participants.filter((person) => person.access !== "Ejer")} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-body text-fg-secondary">Status</span>
            <StatusBadge status={status.status} label={status.label} />
          </div>
        </section>

        {customerCase.signals.length > 0 ? (
          <section aria-labelledby="case-attention" className="space-y-2">
            <h2 id="case-attention" className="text-caption font-semibold tracking-wide text-fg-tertiary uppercase">
              Opmærksomhedspunkter
            </h2>
            <ul className="space-y-1.5">
              {customerCase.signals.map((signal) => (
                <li key={signal.id}>
                  <StatusBadge status={signal.tone} label={signal.title} className="whitespace-normal" />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="case-sources" className="space-y-2">
          <h2 id="case-sources" className="text-caption font-semibold tracking-wide text-fg-tertiary uppercase">
            Kilder i sagen
          </h2>
          <p className="flex items-center gap-2 text-body text-fg-primary">
            <FileText className="size-4 text-fg-secondary" aria-hidden />
            {customerCase.sourceDocuments} dokumenter
          </p>
        </section>

        {customerCase.history.length > 0 ? (
          <section aria-labelledby="case-history" className="space-y-3">
            <h2 id="case-history" className="text-caption font-semibold tracking-wide text-fg-tertiary uppercase">
              Historik
            </h2>
            <Timeline items={customerCase.history.map((entry) => ({ at: entry.at, text: entry.text }))} showTime />
          </section>
        ) : null}

        <Button variant="secondary" className="w-full" onClick={openCopilot}>
          <Sparkles className="text-ai-suggestion" aria-hidden />
          Spørg Copilot om sagen
        </Button>
      </aside>
    </div>
  );
}
