"use client";

import { ArrowLeft, ArrowRight, CircleCheck, CircleDashed, CircleDot, Quote, Sparkles } from "lucide-react";
import Link from "next/link";

import { CopilotContext } from "@/components/copilot/copilot-context";
import { SourceCard } from "@/components/knowledge/source-card";
import { CalloutBox } from "@/components/learn/callout-box";
import { PageBreadcrumbs } from "@/components/shell/breadcrumbs";
import { useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { CourseModule, LearningStatus, Lesson, Product } from "@/types/domain";

const STATUS_ICON: Record<LearningStatus, typeof CircleCheck> = {
  completed: CircleCheck,
  inProgress: CircleDot,
  notStarted: CircleDashed,
};

const STATUS_SR: Record<LearningStatus, string> = {
  completed: "gennemført",
  inProgress: "i gang",
  notStarted: "ikke påbegyndt",
};

function StatusIcon({ status }: { status: LearningStatus }) {
  const Icon = STATUS_ICON[status];
  return (
    <Icon
      className={cn(
        "size-4 shrink-0",
        status === "completed" && "text-success",
        status === "inProgress" && "text-brand",
        status === "notStarted" && "text-fg-tertiary",
      )}
      aria-hidden
    />
  );
}

/**
 * Lesson view (docs/04-ui-ux-design.md §7.3): the whole path on the left (the sequence is
 * visible but the user may jump), the reading experience in the middle with
 * text.body.reading and limited line length, and "on this page" + sources on the right.
 */
export function LessonView({
  product,
  modules,
  lesson,
}: {
  product: Product;
  modules: readonly CourseModule[];
  lesson: Lesson;
}) {
  const { openCopilot } = useShell();
  const headings = lesson.blocks.filter((block) => block.type === "heading");
  const context = `${product.name} · Modul ${lesson.moduleNumber} · ${lesson.moduleTitle}`;

  const sources = (
    <div className="space-y-3">
      {lesson.sources.map((source) => (
        <SourceCard key={source.id} source={source} />
      ))}
    </div>
  );

  return (
    <div className="flex">
      <PageBreadcrumbs
        items={[
          { label: "Learn", href: "/learn" },
          { label: product.name, href: `/learn/${product.slug}` },
          { label: `Modul ${lesson.moduleNumber} · ${lesson.moduleTitle}`, href: `/learn/${product.slug}/${lesson.moduleSlug}` },
          { label: lesson.title },
        ]}
      />
      <CopilotContext value={context} />

      {/* Left rail: the whole learning path */}
      <nav
        aria-label="Produktforløb"
        className="sticky top-[var(--topbar-height)] hidden h-[calc(100dvh-var(--topbar-height))] w-64 shrink-0 overflow-y-auto border-r border-border-subtle bg-surface-raised px-3 py-6 @6xl/main:block"
      >
        <p className="mb-3 px-2 text-caption font-semibold tracking-wide text-fg-tertiary uppercase">Forløb</p>
        <ol className="space-y-0.5">
          {modules.map((module) => (
            <li key={module.slug}>
              <Link
                href={`/learn/${product.slug}/${module.slug}`}
                aria-current={module.slug === lesson.moduleSlug ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-body",
                  module.slug === lesson.moduleSlug
                    ? "bg-accent-subtle font-medium text-fg-primary"
                    : "text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary",
                )}
              >
                <StatusIcon status={module.status} />
                <span className="tabular w-5 text-label text-fg-tertiary">{module.number}</span>
                <span className="truncate">{module.title}</span>
                <span className="sr-only">, {STATUS_SR[module.status]}</span>
              </Link>
              {module.slug === lesson.moduleSlug ? (
                <ol className="mt-0.5 mb-1 ml-9 space-y-0.5 border-l border-border-subtle pl-2">
                  {lesson.lessons.map((entry) => (
                    <li
                      key={entry.number}
                      aria-current={entry.number === lesson.lessonNumber ? "step" : undefined}
                      className={cn(
                        "flex items-center gap-2 rounded-sm px-1.5 py-1 text-label",
                        entry.number === lesson.lessonNumber ? "font-medium text-fg-primary" : "text-fg-secondary",
                      )}
                    >
                      <StatusIcon status={entry.status} />
                      <span className="truncate">{entry.title}</span>
                      <span className="sr-only">, {STATUS_SR[entry.status]}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          ))}
        </ol>
      </nav>

      {/* Reading area */}
      <article className="min-w-0 flex-1 px-4 py-8 md:px-10 lg:py-12">
        <div className="measure mx-auto">
          <p className="text-label text-fg-tertiary">
            Modul {lesson.moduleNumber} · {lesson.moduleTitle} · Lektion {lesson.lessonNumber} af {lesson.lessonCount}
          </p>
          <h1 className="mt-2 text-heading-1 text-fg-primary">{lesson.title}</h1>

          <div className="mt-4 flex flex-wrap gap-2 @4xl/main:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="secondary" size="sm">
                  <Quote aria-hidden />
                  Kilder ({lesson.sources.length})
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto rounded-t-lg bg-surface-raised p-4">
                <SheetTitle className="text-heading-3">Kilder til lektionen</SheetTitle>
                <SheetDescription className="text-body text-fg-secondary">
                  Dokumentversionerne, lektionens indhold hviler på.
                </SheetDescription>
                {sources}
              </SheetContent>
            </Sheet>
            <Button variant="secondary" size="sm" onClick={openCopilot}>
              <Sparkles className="text-ai-suggestion" aria-hidden />
              Spørg om denne side
            </Button>
          </div>

          <div className="mt-8 text-reading text-fg-primary">
            {lesson.blocks.map((block, index) => {
              if (block.type === "heading") {
                return (
                  <h2 key={index} id={block.id} className="mt-10 mb-3 scroll-mt-24 text-heading-2 text-fg-primary">
                    {block.text}
                  </h2>
                );
              }
              if (block.type === "callout") {
                return (
                  <CalloutBox key={index} variant={block.variant}>
                    {block.text}
                  </CalloutBox>
                );
              }
              return (
                <p key={index} className="mb-5">
                  {block.text}
                </p>
              );
            })}
          </div>

          <nav aria-label="Lektioner" className="mt-12 flex items-center justify-between border-t border-border-subtle pt-6">
            <Button variant="ghost" asChild>
              <Link href={`/learn/${product.slug}/produktforstaaelse`}>
                <ArrowLeft aria-hidden />
                Forrige
              </Link>
            </Button>
            <Button variant="primary" asChild>
              <Link href={`/learn/${product.slug}/undtagelser`}>
                Næste
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </nav>
        </div>
      </article>

      {/* Right panel: on this page, sources, ask about this page */}
      <aside
        aria-label="På denne side og kilder"
        className="sticky top-[var(--topbar-height)] hidden h-[calc(100dvh-var(--topbar-height))] w-80 shrink-0 space-y-8 overflow-y-auto border-l border-border-subtle bg-surface-raised px-5 py-8 @4xl/main:block"
      >
        <nav aria-label="På denne side">
          <p className="mb-2 text-caption font-semibold tracking-wide text-fg-tertiary uppercase">På denne side</p>
          <ul className="space-y-1">
            {headings.map((heading) =>
              heading.type === "heading" ? (
                <li key={heading.id}>
                  <a href={`#${heading.id}`} className="text-body text-fg-secondary hover:text-fg-primary hover:underline">
                    {heading.text}
                  </a>
                </li>
              ) : null,
            )}
          </ul>
        </nav>
        <section aria-labelledby="lesson-sources">
          <h2 id="lesson-sources" className="mb-3 text-caption font-semibold tracking-wide text-fg-tertiary uppercase">
            Kilder
          </h2>
          {sources}
        </section>
        <Button variant="secondary" className="w-full" onClick={openCopilot}>
          <Sparkles className="text-ai-suggestion" aria-hidden />
          Spørg om denne side
        </Button>
      </aside>
    </div>
  );
}
