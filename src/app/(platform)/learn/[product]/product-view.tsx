"use client";

import { ArrowRight, CircleCheck, CircleDashed, CircleDot, RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";

import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Section } from "@/components/common/section";
import { CopilotContext } from "@/components/copilot/copilot-context";
import { SourceCard } from "@/components/knowledge/source-card";
import { PageBreadcrumbs } from "@/components/shell/breadcrumbs";
import { useShell } from "@/components/shell/shell-context";
import { EmptyState } from "@/components/states/empty-state";
import { QualitySignal } from "@/components/knowledge/quality-signal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LEARNING_STATUS } from "@/config/domain-status";
import { cn } from "@/lib/utils";
import type { CourseModule, Product, SourceReference } from "@/types/domain";

const MODULE_ICON = { completed: CircleCheck, inProgress: CircleDot, notStarted: CircleDashed } as const;

/** Product front page: the learning path's eleven modules, documents and Copilot (§7.1). */
export function ProductView({
  product,
  modules,
  sources,
}: {
  product: Product;
  modules: readonly CourseModule[];
  sources: readonly SourceReference[];
}) {
  const { openCopilot } = useShell();
  const current = modules.find((module) => module.status === "inProgress");

  return (
    <PageContainer>
      <PageBreadcrumbs items={[{ label: "Learn", href: "/learn" }, { label: "Produktbibliotek", href: "/learn" }, { label: product.name }]} />
      <CopilotContext value={product.name} />
      <PageHeader
        display
        eyebrow={product.category}
        title={product.name}
        description={product.summary}
        actions={
          <>
            <Button variant="secondary" onClick={openCopilot}>
              <Sparkles className="text-ai-suggestion" aria-hidden />
              Spørg om produktet
            </Button>
            {current ? (
              <Button asChild variant="primary">
                <Link href={`/learn/${product.slug}/daekninger`}>
                  Fortsæt modul {current.number} <ArrowRight aria-hidden />
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {product.changeNotice ? (
        <QualitySignal
          tone="info"
          title={`Grundlaget er ændret: ${product.changeNotice}`}
          detail="Moduler, der bygger på de ændrede dokumenter, bliver markeret, når den nye version gælder."
        />
      ) : null}

      <div className="grid gap-10 lg:grid-cols-3">
        <Section title="Produktforløb" description="Elleve moduler i fast rækkefølge. Du kan springe mellem dem." className="lg:col-span-2">
          <ol className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-surface-raised">
            {modules.map((module) => {
              const Icon = MODULE_ICON[module.status];
              const status = LEARNING_STATUS[module.status];
              return (
                <li key={module.slug}>
                  <Link
                    href={`/learn/${product.slug}/${module.slug}`}
                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-surface-base"
                  >
                    <Icon
                      className={cn(
                        "size-5 shrink-0",
                        module.status === "completed" && "text-success",
                        module.status === "inProgress" && "text-brand",
                        module.status === "notStarted" && "text-fg-tertiary",
                      )}
                      aria-hidden
                    />
                    <span className="tabular w-6 shrink-0 text-label text-fg-tertiary">{module.number}</span>
                    <span className="flex-1 text-body font-medium text-fg-primary">{module.title}</span>
                    <span className="hidden text-caption text-fg-secondary sm:block">
                      {module.completedLessons} af {module.lessonCount} {module.lessonCount === 1 ? "del" : "lektioner"}
                    </span>
                    <span className="sr-only">, {status.label}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </Section>

        <Section title="Dokumenter bag forløbet">
          {sources.length > 0 ? (
            <div className="space-y-3">
              {sources.map((source) => (
                <SourceCard key={source.id} source={source} />
              ))}
            </div>
          ) : (
            <EmptyState icon={RefreshCw} title="Ingen dokumenter tilknyttet endnu">
              Dokumenterne vises her, når produktets grundlag er godkendt i Knowledge Base.
            </EmptyState>
          )}
          <Card className="p-5">
            <p className="text-body text-fg-secondary">
              Forløbet bygger udelukkende på godkendte dokumentversioner. Ændres et dokument, markeres de berørte moduler.
            </p>
          </Card>
        </Section>
      </div>
    </PageContainer>
  );
}
