import { format } from "./gates.ts";
import type { EvaluationReport } from "./runner.ts";
import type { MetricValue } from "./types.ts";

/** The human-readable report (Markdown, Danish). The JSON report is the record; this is a view of it. */

const VERDICT: Record<EvaluationReport["verdict"], string> = { pass: "BESTÅET", fail: "IKKE BESTÅET", uncertain: "USIKKER" };

const HARD_GATE_NAMES: Record<string, string> = {
  H1: "Uautoriseret retrieval",
  H2: "Metadatalæk",
  H3: "Gyldighedsbrud",
  H4: "Filterbrud",
  H5: "Skjult konflikt",
  H6: "Udviklingsevidens / forkert konfiguration",
  H7: "Isolation og integritet",
};

const QUALITY_GATE_NAMES: Record<string, string> = {
  Q1: "Source Recall@K",
  Q2: "Passage Recall@K",
  Q3: "MRR@K",
  Q4: "Korrekt afvisning",
  Q5: "Falsk afvisning",
  Q6: "Distraktor-indtrængen",
  Q7: "Rerankerens bidrag",
};

function metricRow(name: string, metric: MetricValue): string {
  const count = metric.numerator !== null ? `${metric.numerator}/${metric.denominator}` : `n = ${metric.denominator}`;
  const interval = metric.interval ? `[${format(metric.interval.lower)}; ${format(metric.interval.upper)}]` : "—";
  return `| ${name} | ${format(metric.value)} | ${count} | ${interval} |`;
}

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function renderMarkdown(report: EvaluationReport): string {
  const m = report.metrics;
  const lines = [
    `# Retrieval-evaluering — ${VERDICT[report.verdict]}`,
    "",
    `> ${report.production.reason}`,
    "",
    "## Kørsel",
    "",
    "| | |",
    "|---|---|",
    `| Kørsel | \`${report.runId}\` |`,
    `| Tidspunkt | ${report.startedAt} – ${report.finishedAt} |`,
    `| Motor / rapportskema | ${report.engine} / ${report.reportSchema} |`,
    `| Sæt | ${report.evalSet.setId} v${report.evalSet.version} (skema ${report.evalSet.caseSchema}), checksum \`${report.evalSet.checksum}\` |`,
    `| Gate-sæt | ${report.gateSet.id} v${report.gateSet.version} (${report.gateSet.decision}), K = ${report.gateSet.k}, checksum \`${report.gateSet.checksum}\` |`,
    `| Konfiguration | ${report.configuration.label} — adapter "${report.configuration.adapter}", miljø "${report.configuration.environment}" |`,
    `| Fingeraftryk | erklæret \`${report.configuration.declaredFingerprint}\`, runtime \`${report.configuration.runtimeFingerprint}\` (${report.configuration.matches ? "matcher" : "MATCHER IKKE"}) |`,
    `| Korpus | før \`${report.corpus.checksumBefore}\`, efter \`${report.corpus.checksumAfter}\` |`,
    `| Spørgsmål | ${report.evalSet.activeCases} aktive, ${report.evalSet.retiredCases} udgået; dev ${report.evalSet.bySplit.dev}, holdout ${report.evalSet.bySplit.holdout} |`,
    `| Tier | ${report.tier} |`,
    `| Gyldig | ${report.valid ? "ja" : "nej"} |`,
    "",
    "**Fordeling på typer:** " + Object.entries(report.evalSet.byType).map(([type, count]) => `${type} ${count}`).join(", "),
    "",
  ];
  if (report.invalidReasons.length > 0) {
    lines.push("**Kørslen er ugyldig:**", "", ...report.invalidReasons.map((reason) => `- ${reason}`), "");
  }
  lines.push(
    "## Hårde gates (nul tolerance)",
    "",
    "| Gate | | Brud | Status |",
    "|---|---|---|---|",
    ...report.hardGates.map((gate) => `| ${gate.id} | ${HARD_GATE_NAMES[gate.id]} | ${gate.violations} | ${gate.status === "pass" ? "bestået" : "**IKKE BESTÅET**"} |`),
    "",
    "## Kvalitetsgates",
    "",
    "| Gate | | Værdi | Krav | Status | Usikker |",
    "|---|---|---|---|---|---|",
    ...report.qualityGates.map(
      (gate) =>
        `| ${gate.id} | ${QUALITY_GATE_NAMES[gate.id]} | ${format(gate.value)} | ${gate.comparator === "not_lower" ? "ikke lavere end uden reranker" : `${gate.comparator === ">=" ? "≥" : "≤"} ${format(gate.threshold)}`} | ${gate.status === "pass" ? "bestået" : "**IKKE BESTÅET**"} | ${gate.uncertain ? "**usikker**" : "—"} |`,
    ),
    "",
    ...report.qualityGates.map((gate) => `- ${gate.id}: ${gate.explanation}`),
    "",
    "## Metrikker",
    "",
    "| Metrik | Værdi | Antal | Wilson 95 % |",
    "|---|---|---|---|",
    metricRow("Source Recall@K", m.source_recall_at_k),
    metricRow("Passage Recall@K", m.passage_recall_at_k),
    metricRow("MRR@K", m.mrr_at_k),
    metricRow("Korrekt afvisning", m.correct_abstention),
    metricRow("Falsk afvisning", m.false_abstention),
    metricRow("Distraktor-indtrængen", m.distractor_intrusion),
    metricRow("Source Recall@1 (rapporteres)", m.informational.source_recall_at_1),
    metricRow("Source Recall@3 (rapporteres)", m.informational.source_recall_at_3),
    metricRow("Full Coverage@K (rapporteres)", m.informational.full_coverage_at_k),
    metricRow("nDCG@K (rapporteres)", m.informational.ndcg_at_k),
    "",
    `**Uden reranker:** Passage Recall ${format(report.rerankerComparison.withoutReranker.passage_recall_at_k)}, MRR ${format(report.rerankerComparison.withoutReranker.mrr_at_k)}${report.rerankerComparison.available ? "" : " (ikke tilgængelig)"}.`,
    "",
    "## Minimum pr. type",
    "",
    "| Type | Antal | Mindst | |",
    "|---|---|---|---|",
    ...report.minimums.map((minimum) => `| ${minimum.label} | ${minimum.actual} | ${minimum.minimum} | ${minimum.met ? "ok" : "**for få**"} |`),
    "",
    "## Fejl",
    "",
  );
  if (report.failures.length === 0) lines.push("Ingen.", "");
  else {
    lines.push(
      "Hver fejl skal have en skriftlig årsagsnote, før en konfiguration kan godkendes (docs/08b §4.4, pilot-regel 3).",
      "",
      "| Spørgsmål | Gate | Forklaring | Årsagsnote |",
      "|---|---|---|---|",
      ...report.failures.map((failure) => `| ${failure.caseId ?? "(kørsel)"} | ${failure.gate} | ${cell(failure.explanation)} | mangler |`),
      "",
    );
  }
  lines.push(`Resultat-checksum \`${report.checksums.results}\` · rapport-checksum \`${report.checksums.report}\``, "");
  return lines.join("\n");
}
