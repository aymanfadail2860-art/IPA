"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";
import {
  acceptPerformanceDeviation,
  acceptUncertainty,
  activateConfiguration,
  approveConfiguration,
  approveGateSet,
  requestReembedding,
  retireConfiguration,
  suspendConfiguration,
  type OperationsActionResult,
} from "@/lib/knowledge/operations-actions";
import {
  configurationActions,
  MIN_DEVIATION_JUSTIFICATION,
  MIN_RETIREMENT_REASON,
  MIN_ROOT_CAUSE_NOTE,
  MIN_SUSPENSION_REASON,
  MIN_UNCERTAINTY_JUSTIFICATION,
  type ConfigurationStatus,
  type OperationsConfiguration,
  type OperationsRun,
  type RetrievalOperationsView,
} from "@/lib/knowledge/operations-view";

import { Field, FormError, SelectInput, TextArea } from "./form";

const STATUS: Record<ConfigurationStatus, { label: string; tone: "success" | "warning" | "error" | "neutral" | "info" }> = {
  candidate: { label: "Kandidat", tone: "neutral" },
  approved: { label: "Godkendt", tone: "info" },
  active: { label: "Aktiv", tone: "success" },
  suspended: { label: "Suspenderet", tone: "error" },
  retired: { label: "Udfaset", tone: "neutral" },
};

const OUTCOME: Record<OperationsRun["outcome"], string> = {
  pass: "Bestået",
  pass_with_uncertainty: "Bestået med statistisk usikkerhed",
  insufficient_certainty: "Utilstrækkelig sikkerhed",
  fail: "Ikke bestået",
};

const short = (checksum: string) => `${checksum.slice(0, 12)}…`;

/**
 * Drift af retrieval (8B-I8 C2, docs/08b §10.2, §10.3): the human decisions of the 8B lifecycle.
 * Minimal on purpose — phase 14 (Admin) owns the finished screen. Every button asks for
 * confirmation, and for a justification where the database requires one; the database decides.
 * Evaluation results are only shown: they come from the evaluation publisher, never from here.
 */
export function RetrievalOperations({ view }: { view: RetrievalOperationsView | null }) {
  if (!view) return <Card className="text-body text-fg-secondary">Driftsoplysningerne kunne ikke læses fra databasen.</Card>;
  const empty = view.gateSets.length === 0 && view.configurations.length === 0 && view.measurements.length === 0 && view.candidateModels.length === 0;
  return (
    <div className="space-y-4">
      {empty ? <Card className="text-body text-fg-secondary">Der er endnu ingen registrerede evalueringer, konfigurationer eller kandidatmodeller.</Card> : null}

      {view.gateSets.length > 0 ? (
        <Card className="p-0">
          <h3 className="px-6 pt-4 text-heading-3">Gate-sæt</h3>
          <ul className="divide-y divide-border-subtle">
            {view.gateSets.map((gate) => (
              <li key={gate.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
                <span>
                  <span className="block font-mono text-mono text-fg-primary">{gate.label}</span>
                  <span className="block text-caption text-fg-secondary">
                    {gate.decision} · {short(gate.checksum)} · registreret {formatDate(gate.registeredAt)}
                  </span>
                </span>
                {gate.approved ? (
                  <StatusBadge status="success" label="Godkendt" />
                ) : (
                  <Decision
                    title="Godkend gate-sæt"
                    description={`${gate.label} (${gate.decision}) bliver grundlaget for at godkende konfigurationer. Tærsklerne kan ikke ændres her.`}
                    action="Godkend"
                    submit={() => approveGateSet({ confirmed: true, gateSetId: gate.id })}
                  />
                )}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {view.configurations.map((configuration) => (
        <ConfigurationCard key={configuration.id} configuration={configuration} />
      ))}

      {view.measurements.length > 0 ? (
        <Card className="p-0">
          <h3 className="px-6 pt-4 text-heading-3">Performance-afvigelser</h3>
          <ul className="divide-y divide-border-subtle">
            {view.measurements.map((measurement) => (
              <li key={measurement.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
                <span>
                  <span className="block font-mono text-mono text-fg-primary">{measurement.measurementId}</span>
                  <span className="block text-caption text-fg-secondary">
                    {measurement.configurationLabel} · målt {formatDate(measurement.measuredAt)} · afvigelser: {measurement.deviations.join(", ")}
                  </span>
                </span>
                {measurement.accepted ? (
                  <StatusBadge status="success" label="Godkendt" />
                ) : (
                  <Decision
                    title="Godkend performance-afvigelse"
                    description="Målene i målingen er ikke nået eller ikke målt. Godkendelsen gemmes med begrundelse og kan ikke trækkes tilbage."
                    action="Godkend afvigelse"
                    justification={{ label: "Begrundelse", minimum: MIN_DEVIATION_JUSTIFICATION }}
                    submit={(text) => acceptPerformanceDeviation({ confirmed: true, measurementId: measurement.id, justification: text })}
                  />
                )}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {view.candidateModels.length > 0 ? (
        <Card className="p-0">
          <h3 className="px-6 pt-4 text-heading-3">Kandidatmodeller</h3>
          <ul className="divide-y divide-border-subtle">
            {view.candidateModels.map((model) => (
              <li key={model.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
                <span>
                  <span className="block font-mono text-mono text-fg-primary">{model.label}</span>
                  <span className="block text-caption text-fg-secondary">
                    {model.embeddings} embeddings af {model.publishedChunks} publicerede chunks. Aktivering kræver fuld dækning.
                  </span>
                </span>
                <Decision
                  title="Start re-embedding"
                  description={`Workeren embedder alle chunks, der mangler en embedding med ${model.label}. Modellen bliver først aktiv, når en godkendt konfiguration for den aktiveres.`}
                  action="Start re-embedding"
                  submit={() => requestReembedding({ confirmed: true, modelId: model.id })}
                />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function ConfigurationCard({ configuration }: { configuration: OperationsConfiguration }) {
  const status = STATUS[configuration.status];
  const actions = configurationActions(configuration);
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span>
          <span className="block font-mono text-mono text-fg-primary">
            {configuration.label} v{configuration.version}
          </span>
          <span className="block text-caption text-fg-secondary">
            Fingeraftryk {short(configuration.fingerprint)}
            {configuration.tier ? ` · ${configuration.tier}` : ""} · status siden {formatDate(configuration.statusChangedAt)}
          </span>
          {configuration.suspensionReason ? <span className="block text-caption text-error">Suspenderet: {configuration.suspensionReason}</span> : null}
        </span>
        <StatusBadge status={status.tone} label={status.label} />
      </div>

      {configuration.runs.length > 0 ? (
        <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
          {configuration.runs.map((run) => (
            <li key={run.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
              <span>
                <span className="block font-mono text-caption text-fg-primary">{run.runId}</span>
                <span className="block text-caption text-fg-secondary">
                  {OUTCOME[run.outcome]} · {run.tier} · registreret {formatDate(run.registeredAt)}
                  {run.gateSetApproved ? "" : " · gate-sættet er ikke godkendt"}
                  {run.failures.length > 0 ? ` · ${run.failures.length} fejl` : ""}
                </span>
              </span>
              {run.outcome === "pass_with_uncertainty" ? (
                run.uncertaintyAccepted ? (
                  <StatusBadge status="success" label="Usikkerhed accepteret" />
                ) : (
                  <Decision
                    title="Acceptér statistisk usikkerhed"
                    description="Pilot-kørslen har bestået alle gates, men med statistisk usikkerhed i mindst én kvalitetsgate. Accepten gemmes med begrundelse og gælder kun denne kørsel."
                    action="Acceptér usikkerhed"
                    justification={{ label: "Begrundelse", minimum: MIN_UNCERTAINTY_JUSTIFICATION }}
                    submit={(text) => acceptUncertainty({ confirmed: true, runId: run.id, justification: text })}
                  />
                )
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-caption text-fg-secondary">Ingen registrerede kørsler.</p>
      )}

      <div className="flex flex-wrap gap-2">
        {actions.approve ? <ApproveDialog configuration={configuration} /> : null}
        {actions.activate ? (
          <Decision
            title="Aktivér konfiguration"
            description="Konfigurationen bliver den eneste i drift. En tidligere konfiguration udfases, og embedding-modellen skiftes i samme handling, hvis den er en anden. Databasen efterprøver alle betingelser igen."
            action="Aktivér"
            variant="primary"
            submit={() => activateConfiguration({ confirmed: true, configurationId: configuration.id })}
          />
        ) : null}
        {actions.suspend ? (
          <Decision
            title="Suspendér konfiguration"
            description="Retrieval giver straks kun udviklingsevidens, og der vælges ingen anden konfiguration automatisk."
            action="Suspendér"
            variant="destructive"
            justification={{ label: "Begrundelse", minimum: MIN_SUSPENSION_REASON }}
            submit={(text) => suspendConfiguration({ confirmed: true, configurationId: configuration.id, reason: text })}
          />
        ) : null}
        {actions.retire ? (
          <Decision
            title="Udfas konfiguration"
            description="Konfigurationen bevares med sin historik, men kan ikke længere godkendes eller aktiveres uden en ny kørsel."
            action="Udfas"
            justification={{ label: "Begrundelse", minimum: MIN_RETIREMENT_REASON }}
            submit={(text) => retireConfiguration({ confirmed: true, configurationId: configuration.id, reason: text })}
          />
        ) : null}
      </div>
    </Card>
  );
}

function useSubmit() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);
  const run = (action: () => Promise<OperationsActionResult>, done: () => void) => {
    setErrors([]);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return setErrors([result.error]);
      done();
      router.refresh();
    });
  };
  return { pending, errors, run, clear: () => setErrors([]) };
}

/** A decision with a confirmation and, when the database requires one, a justification. */
function Decision({
  title,
  description,
  action,
  variant = "secondary",
  justification,
  submit,
}: {
  title: string;
  description: string;
  action: string;
  variant?: "primary" | "secondary" | "destructive";
  justification?: { label: string; minimum: number };
  submit: (text: string) => Promise<OperationsActionResult>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const { pending, errors, run, clear } = useSubmit();
  const tooShort = justification ? text.trim().length < justification.minimum : false;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) clear();
      }}
      trigger={
        <Button variant={variant} size="sm">
          {action}
        </Button>
      }
      title={title}
      description={description}
      footer={
        <Button variant={variant} loading={pending} disabled={tooShort} onClick={() => run(() => submit(text), () => setOpen(false))}>
          Bekræft: {action.toLowerCase()}
        </Button>
      }
    >
      {justification ? (
        <Field label={justification.label} hint={`Mindst ${justification.minimum} tegn. Gemmes i auditloggen.`}>
          <TextArea value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} />
        </Field>
      ) : null}
      <FormError errors={errors} />
    </ConfirmDialog>
  );
}

/** Godkend: choose the registered run; every failure in its report needs a written root-cause note. */
function ApproveDialog({ configuration }: { configuration: OperationsConfiguration }) {
  const candidates = configuration.runs.filter((run) => run.outcome === "pass" || (run.outcome === "pass_with_uncertainty" && run.uncertaintyAccepted));
  const [open, setOpen] = useState(false);
  const [runId, setRunId] = useState(candidates[0]?.id ?? "");
  const [notes, setNotes] = useState<Record<string, string[]>>({});
  const { pending, errors, run, clear } = useSubmit();
  const selected = candidates.find((candidate) => candidate.id === runId);
  const current = notes[runId] ?? selected?.failures.map(() => "") ?? [];
  const incomplete = !selected || current.some((note) => note.trim().length < MIN_ROOT_CAUSE_NOTE);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) clear();
      }}
      trigger={
        <Button variant="primary" size="sm">
          Godkend
        </Button>
      }
      title="Godkend konfiguration"
      description="Godkendelsen bygger på en registreret kørsel. Databasen efterprøver kørslen, gate-sættet, fingeraftrykket og scope igen."
      footer={
        <Button
          variant="primary"
          loading={pending}
          disabled={incomplete}
          onClick={() => run(() => approveConfiguration({ confirmed: true, configurationId: configuration.id, runId, rootCauseNotes: current }), () => setOpen(false))}
        >
          Bekræft: godkend
        </Button>
      }
    >
      <Field label="Kørsel">
        <SelectInput value={runId} onChange={(event) => setRunId(event.target.value)}>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.runId} — {OUTCOME[candidate.outcome]}
            </option>
          ))}
        </SelectInput>
      </Field>
      {selected?.failures.map((failure, index) => (
        <Field
          key={`${runId}-${index}`}
          label={`Årsagsnote: ${failure.gate}${failure.caseId ? ` (${failure.caseId})` : ""}`}
          hint={`${failure.explanation} Mindst ${MIN_ROOT_CAUSE_NOTE} tegn.`}
        >
          <TextArea
            value={current[index] ?? ""}
            maxLength={2000}
            onChange={(event) => setNotes({ ...notes, [runId]: current.map((note, i) => (i === index ? event.target.value : note)) })}
          />
        </Field>
      ))}
      <FormError errors={errors} />
    </ConfirmDialog>
  );
}

function ConfirmDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  title: string;
  description: string;
  footer: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">{children}</div>
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
