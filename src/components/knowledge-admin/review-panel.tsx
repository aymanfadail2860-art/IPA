"use client";

import { CircleAlert, CircleCheck, ExternalLink, GitCompare, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { DisabledReason } from "@/components/common/disabled-reason";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { VersionDetail } from "@/lib/knowledge/admin-data";
import { CONFLICT_RULE_LABEL, GAP_KIND_LABEL, type AdminVersionRow, type ValidityGap } from "@/lib/knowledge/admin-types";
import { formatDate, formatValidTo } from "@/lib/format";
import {
  approveVersion,
  cancelReview,
  discardVersion,
  rejectVersion,
  requestReprocess,
  startReview,
  updateVersionMetadata,
  withdrawVersion,
  type ActionResult,
  type WithdrawalCategory,
} from "@/lib/knowledge/review-actions";
import { getOriginalDownloadUrl } from "@/lib/knowledge/upload-actions";

import { Field, FormError, SelectInput, TextArea, TextInput } from "./form";

function gapText(gap: ValidityGap): string {
  return `${GAP_KIND_LABEL[gap.kind]}: fra ${formatDate(gap.from)}${gap.to ? ` til og med ${formatValidTo(gap.to)}` : " og fremefter"}`;
}

/**
 * The right-hand side of the review screen (docs/04 §14.2, docs/07 §12): quality report,
 * metadata and the actions the user's permissions and the version's status allow.
 * "Godkend som autoritativ" is the only primary button and has its own confirmation.
 */
export function ReviewPanel({
  version,
  detail,
  withdrawalGaps,
  canWrite,
  canPublish,
}: {
  version: AdminVersionRow;
  detail: VersionDetail;
  withdrawalGaps: readonly ValidityGap[];
  canWrite: boolean;
  canPublish: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);
  const state = detail.reviewState;
  const report = (state?.qualityReport ?? {}) as {
    pages?: { read: number; total: number; without_text?: number[] };
    structure?: { recognized: boolean; headings: number };
    chunks?: { total: number; without_heading: number };
    tables?: { found: number; uncertain: number };
    normalization?: { header_footer_lines_removed: number; encoding_warnings: string[] };
  };

  function run(action: () => Promise<ActionResult>, after?: () => void) {
    setErrors([]);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return setErrors([result.error]);
      after?.();
      router.refresh();
    });
  }

  async function openOriginal() {
    const result = await getOriginalDownloadUrl(version.id);
    if (result.ok) window.open(result.url, "_blank", "noopener,noreferrer");
    else setErrors(result.errors);
  }

  const warnings = state?.warnings ?? [];
  const blockers = (state?.blockers ?? []).filter((blocker) => blocker.code !== "not_under_review");

  return (
    <div className="space-y-6">
      <Card className="space-y-3">
        <h2 className="text-heading-3">Kvalitetsrapport</h2>
        {state ? (
          <ul className="space-y-1.5 text-body">
            {report.pages ? (
              <Check ok={report.pages.read === report.pages.total}>
                {report.pages.read} af {report.pages.total} sider læst
                {report.pages.without_text?.length ? ` (uden tekst: side ${report.pages.without_text.join(", ")})` : ""}
              </Check>
            ) : null}
            {report.structure ? <Check ok={report.structure.recognized}>{report.structure.recognized ? `Struktur genkendt (${report.structure.headings} overskrifter)` : "Strukturen er ikke genkendt"}</Check> : null}
            {report.chunks ? <Check ok={report.chunks.without_heading === 0}>{report.chunks.total} chunks, {report.chunks.without_heading} uden overskriftskæde</Check> : null}
            {report.tables && report.tables.found > 0 ? <Check ok={report.tables.uncertain === 0}>{report.tables.found} tabeller, {report.tables.uncertain} med usikker struktur</Check> : null}
            {report.normalization ? <Check ok>{report.normalization.header_footer_lines_removed} sidehoved- og sidefodslinjer fjernet</Check> : null}
            {blockers.map((blocker) => (
              <li key={blocker.code} className="flex gap-2 text-error">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {blocker.message}
              </li>
            ))}
            {warnings.map((warning) => (
              <li key={warning.code} className="flex gap-2 text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {warning.message}
              </li>
            ))}
            {detail.conflictCandidates.map((candidate) => (
              <li key={`${candidate.rule}-${candidate.documentTitle}-${candidate.versionLabel}`} className="flex gap-2 text-knowledge-conflict">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                Konfliktkandidat: {CONFLICT_RULE_LABEL[candidate.rule]} — {candidate.documentTitle}
                {candidate.versionLabel ? `, version ${candidate.versionLabel}` : ""}
                {candidate.registered ? " (registreret)" : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-fg-secondary">Kvalitetsrapporten er klar, når den tekniske behandling er færdig.</p>
        )}
      </Card>

      <Card className="space-y-2 text-body">
        <h2 className="text-heading-3">Metadata</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-fg-secondary">Version</dt>
          <dd>{version.versionLabel ?? "—"}</dd>
          <dt className="text-fg-secondary">Gyldig fra</dt>
          <dd>{version.validFrom ? formatDate(version.validFrom) : "—"}</dd>
          <dt className="text-fg-secondary">Gyldig til</dt>
          <dd>{version.validTo ? `til og med ${formatValidTo(version.validTo)}` : "Ingen slutdato"}</dd>
          <dt className="text-fg-secondary">Sprog</dt>
          <dd>{version.language}</dd>
          <dt className="text-fg-secondary">Fil</dt>
          <dd className="break-all">{detail.metadata.originalFilename ?? "—"}</dd>
          <dt className="text-fg-secondary">Udtræk / chunker</dt>
          <dd className="font-mono text-caption">
            {detail.metadata.extractorVersion ?? "—"} · {detail.metadata.chunkerVersion ?? "—"}
          </dd>
          {detail.metadata.approvedAt ? (
            <>
              <dt className="text-fg-secondary">Godkendt</dt>
              <dd>{formatDate(detail.metadata.approvedAt)}</dd>
            </>
          ) : null}
          {detail.metadata.withdrawnAt ? (
            <>
              <dt className="text-fg-secondary">Deaktiveret</dt>
              <dd>
                {formatDate(detail.metadata.withdrawnAt)} — {detail.metadata.withdrawalReason}
              </dd>
            </>
          ) : null}
        </dl>
        <Button variant="link" size="sm" onClick={openOriginal}>
          <ExternalLink aria-hidden />
          Åbn original
        </Button>
        {detail.reviews.map((review) => (
          <p key={review.decidedAt} className="text-caption text-fg-secondary">
            {review.decision === "approved" ? "Godkendt" : "Afvist"} {formatDate(review.decidedAt)}
            {review.reason ? `: ${review.reason}` : ""}
          </p>
        ))}
      </Card>

      {canWrite && ["uploaded", "processing", "processing_failed", "processed", "rejected"].includes(version.status) ? (
        <MetadataForm version={version} onSave={(values) => run(() => updateVersionMetadata(version.id, values))} pending={pending} />
      ) : null}

      <FormError errors={errors} />

      <div className="flex flex-wrap gap-2">
        {version.status === "processed" && canPublish ? (
          <Button variant="secondary" loading={pending} onClick={() => run(() => startReview(version.id))}>
            Påbegynd review
          </Button>
        ) : null}
        {version.status === "under_review" && canPublish ? (
          <>
            {state?.canApprove ? (
              <ApproveDialog
                warnings={warnings}
                conflicts={detail.conflictCandidates}
                version={version}
                pending={pending}
                onApprove={(codes) => run(() => approveVersion(version.id, codes))}
              />
            ) : (
              <DisabledReason reason={blockers.map((blocker) => blocker.message).join(" ") || "Versionen kan ikke godkendes endnu."}>
                <Button variant="primary" disabled>
                  Godkend som autoritativ
                </Button>
              </DisabledReason>
            )}
            <ReasonDialog title="Afvis version" label="Begrundelse" action="Afvis" onConfirm={(reason) => run(() => rejectVersion(version.id, reason))} />
            <Button variant="ghost" loading={pending} onClick={() => run(() => cancelReview(version.id))}>
              Afbryd review
            </Button>
          </>
        ) : null}
        {/* A file rejected by the security examination is never processed again (8B-I5): upload a new version. */}
        {["processing_failed", "rejected"].includes(version.status) && canWrite && !version.security.startsWith("rejected_") ? (
          <Button variant="secondary" loading={pending} onClick={() => run(() => requestReprocess(version.id))}>
            Genbehandl
          </Button>
        ) : null}
        {["uploaded", "processing_failed", "processed", "rejected"].includes(version.status) && canWrite ? (
          <ReasonDialog
            title="Kassér version"
            description="Versionen har aldrig været publiceret. Den bevares som kasseret og indgår aldrig i vidensgrundlaget."
            action="Kassér"
            onConfirm={() => run(() => discardVersion(version.id))}
          />
        ) : null}
        {version.status === "published" && canPublish ? (
          <WithdrawDialog gaps={withdrawalGaps} onConfirm={(category, reason) => run(() => withdrawVersion(version.id, category, reason))} />
        ) : null}
      </div>
    </div>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  const Icon = ok ? CircleCheck : TriangleAlert;
  return (
    <li className={ok ? "flex gap-2 text-fg-primary" : "flex gap-2 text-warning"}>
      <Icon className={ok ? "mt-0.5 size-4 shrink-0 text-success" : "mt-0.5 size-4 shrink-0"} aria-hidden />
      <span>{children}</span>
    </li>
  );
}

function MetadataForm({
  version,
  onSave,
  pending,
}: {
  version: AdminVersionRow;
  onSave: (values: { versionLabel: string | null; language: string; validFrom: string | null; validTo: string | null }) => void;
  pending: boolean;
}) {
  const [values, setValues] = useState({ versionLabel: version.versionLabel ?? "", language: version.language, validFrom: version.validFrom ?? "", validTo: version.validTo ?? "" });
  return (
    <Card className="space-y-3">
      <h2 className="text-heading-3">Ret metadata</h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Versionsbetegnelse">
          <TextInput value={values.versionLabel} onChange={(event) => setValues({ ...values, versionLabel: event.target.value })} />
        </Field>
        <Field label="Sprog">
          <SelectInput value={values.language} onChange={(event) => setValues({ ...values, language: event.target.value })}>
            <option value="da">Dansk</option>
            <option value="en">Engelsk</option>
          </SelectInput>
        </Field>
        <Field label="Gyldig fra">
          <TextInput type="date" value={values.validFrom} onChange={(event) => setValues({ ...values, validFrom: event.target.value })} />
        </Field>
        <Field label="Gyldig til">
          <TextInput type="date" value={values.validTo} onChange={(event) => setValues({ ...values, validTo: event.target.value })} />
        </Field>
      </div>
      <Button
        variant="secondary"
        size="sm"
        loading={pending}
        onClick={() =>
          onSave({ versionLabel: values.versionLabel || null, language: values.language, validFrom: values.validFrom || null, validTo: values.validTo || null })
        }
      >
        Gem metadata
      </Button>
    </Card>
  );
}

/** "Godkend som autoritativ" — the consequence is summarized and the warnings are shown again (docs/04 §14.2). */
function ApproveDialog({
  version,
  warnings,
  conflicts,
  pending,
  onApprove,
}: {
  version: AdminVersionRow;
  warnings: readonly { code: string; message: string }[];
  /** Structural conflict candidates (docs/07 §11.2): a consequence of approving — shown neutrally, never blocking (B-11). */
  conflicts: VersionDetail["conflictCandidates"];
  pending: boolean;
  onApprove: (codes: string[]) => void;
}) {
  const self = `${version.documentTitle}${version.versionLabel ? `, version ${version.versionLabel}` : ""}`;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="primary">Godkend som autoritativ</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Godkend som autoritativ</DialogTitle>
          <DialogDescription>
            {version.documentTitle}
            {version.versionLabel ? `, version ${version.versionLabel}` : ""} bliver gældende grundlag for Copilot, Learn, Practice og Advise
            {version.validFrom ? ` fra ${formatDate(version.validFrom)}` : ""} for de brugere, der har adgang. En tidligere version bliver erstattet fra
            samme dato.
          </DialogDescription>
        </DialogHeader>
        {conflicts.length > 0 ? (
          <section aria-label="Konflikt mellem kilder" className="space-y-2 rounded-md border-l-4 border-l-knowledge-conflict bg-knowledge-conflict-subtle px-4 py-3 text-body">
            <p className="flex items-center gap-2 font-medium text-knowledge-conflict">
              <GitCompare className="size-4 shrink-0" aria-hidden />
              Godkendelsen skaber {conflicts.length === 1 ? "en konflikt" : `${conflicts.length} konflikter`} mellem kilder
            </p>
            <ul className="space-y-1">
              {conflicts.map((candidate) => (
                <li key={`${candidate.rule}-${candidate.documentTitle}-${candidate.versionLabel}`}>
                  {self} og {candidate.documentTitle}
                  {candidate.versionLabel ? `, version ${candidate.versionLabel}` : ""} — {CONFLICT_RULE_LABEL[candidate.rule].toLowerCase()}.
                </li>
              ))}
            </ul>
            <p className="text-fg-secondary">
              Begge kilder bevares, og rådgivere med adgang får begge vist. Systemet afgør ikke, hvilken kilde der gælder; konflikten lægges i
              konfliktkøen til faglig afgørelse.
            </p>
          </section>
        ) : null}
        {warnings.length > 0 ? (
          <ul className="space-y-1.5 text-body text-warning">
            {warnings.map((warning) => (
              <li key={warning.code} className="flex gap-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {warning.message}
              </li>
            ))}
          </ul>
        ) : null}
        <DialogFooter>
          <Button variant="primary" loading={pending} onClick={() => onApprove(warnings.map((warning) => warning.code))}>
            Godkend som autoritativ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReasonDialog({
  title,
  description,
  label,
  action,
  onConfirm,
}: {
  title: string;
  description?: string;
  /** When set, a reason is required. */
  label?: string;
  action: string;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">{action}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {label ? (
          <Field label={label}>
            <TextArea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} />
          </Field>
        ) : null}
        <DialogFooter>
          <Button
            variant="secondary"
            disabled={Boolean(label) && reason.trim().length === 0}
            onClick={() => {
              setOpen(false);
              onConfirm(reason);
            }}
          >
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Deaktivér" — shows whether the withdrawal leaves a gap in validity (B-006). */
function WithdrawDialog({ gaps, onConfirm }: { gaps: readonly ValidityGap[]; onConfirm: (category: WithdrawalCategory, reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<WithdrawalCategory>("invalid");
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive">Deaktivér</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deaktivér version</DialogTitle>
          <DialogDescription>Versionen fjernes straks fra al retrieval, også historisk. Den slettes ikke.</DialogDescription>
        </DialogHeader>
        {gaps.length > 0 ? (
          <div role="alert" className="space-y-1 rounded-md border border-warning/40 bg-warning-subtle px-3 py-2 text-body">
            <p className="font-medium">Deaktiveringen efterlader et hul i gyldigheden:</p>
            {gaps.map((gap) => (
              <p key={`${gap.from}-${gap.kind}`}>{gapText(gap)}</p>
            ))}
            <p className="text-fg-secondary">Forgængeren får ikke sin gyldighed tilbage. Hullet lukkes kun ved at publicere en ny version.</p>
          </div>
        ) : (
          <p className="text-body text-fg-secondary">Deaktiveringen efterlader intet hul i gyldigheden.</p>
        )}
        <Field label="Kategori">
          <SelectInput value={category} onChange={(event) => setCategory(event.target.value as WithdrawalCategory)}>
            <option value="invalid">Ugyldig (faglig fejl)</option>
            <option value="withdrawn_by_owner">Trukket tilbage af ejeren</option>
            <option value="other">Andet</option>
          </SelectInput>
        </Field>
        <Field label="Begrundelse">
          <TextArea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} />
        </Field>
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={reason.trim().length === 0}
            onClick={() => {
              setOpen(false);
              onConfirm(category, reason);
            }}
          >
            Deaktivér version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
