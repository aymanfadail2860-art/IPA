"use client";

import { MessagesSquare, PanelLeft, Plus, Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { Chip } from "@/components/common/chip";
import { CopilotAnswer } from "@/components/copilot/copilot-answer";
import { CopilotInput } from "@/components/copilot/copilot-input";
import { PendingQuestion } from "@/components/copilot/pending-question";
import { DocumentViewer } from "@/components/knowledge/document-viewer";
import { SourceCard } from "@/components/knowledge/source-card";
import { COPILOT_PAGE_INPUT_ID } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { BREAKPOINTS, useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import type { ConversationGroup, CopilotConversation, SourceReference } from "@/types/domain";

const GROUP_LABELS: Record<ConversationGroup, string> = {
  today: "I dag",
  earlier: "Tidligere",
  cases: "Fra kundecases",
};

function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onNew,
}: {
  conversations: readonly CopilotConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <nav aria-label="Samtaler" className="space-y-6">
      <Button variant="secondary" size="sm" className="w-full justify-start" onClick={onNew}>
        <Plus aria-hidden />
        Ny samtale
      </Button>
      {(Object.keys(GROUP_LABELS) as ConversationGroup[]).map((group) => {
        const items = conversations.filter((conversation) => conversation.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group}>
            <h2 className="mb-1.5 px-2 text-caption font-semibold tracking-wide text-fg-tertiary uppercase">
              {GROUP_LABELS[group]}
            </h2>
            <ul className="space-y-0.5">
              {items.map((conversation) => (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(conversation.id)}
                    aria-current={conversation.id === selectedId ? "true" : undefined}
                    className={cn(
                      "w-full cursor-pointer rounded-md px-2 py-2 text-left text-body transition-colors",
                      conversation.id === selectedId
                        ? "bg-accent-subtle font-medium text-fg-primary"
                        : "text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary",
                    )}
                  >
                    <span className="line-clamp-2">{conversation.title}</span>
                    {conversation.caseName ? (
                      <span className="mt-0.5 block text-caption text-fg-tertiary">{conversation.caseName}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

/**
 * Copilot full view (docs/04-ui-ux-design.md §8.1): conversations on the left, the
 * conversation in the middle written as professional text (not chat bubbles), and a
 * source column on the right that is always visible when there is an answer.
 */
export function CopilotWorkspace({
  conversations,
  exampleQuestions,
}: {
  conversations: readonly CopilotConversation[];
  exampleQuestions: readonly string[];
}) {
  const searchParams = useSearchParams();
  const initialQuestion = searchParams.get("q");
  const isWide = useMediaQuery(BREAKPOINTS.wide);
  const isDesktop = useMediaQuery(BREAKPOINTS.desktop);

  const [selectedId, setSelectedId] = useState<string | null>(initialQuestion ? null : (conversations[0]?.id ?? null));
  const [asked, setAsked] = useState<string[]>(initialQuestion ? [initialQuestion] : []);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [openDocument, setOpenDocument] = useState<SourceReference | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const conversation = conversations.find((entry) => entry.id === selectedId) ?? null;
  const latest = conversation?.exchanges.at(-1) ?? null;
  const sources = latest?.sources ?? [];

  function selectConversation(id: string) {
    setSelectedId(id);
    setAsked([]);
    setActiveSourceId(null);
    setOpenDocument(null);
    setHistoryOpen(false);
  }

  function newConversation() {
    setSelectedId(null);
    setAsked([]);
    setOpenDocument(null);
    setHistoryOpen(false);
    document.getElementById(COPILOT_PAGE_INPUT_ID)?.focus();
  }

  function selectSource(source: SourceReference) {
    setActiveSourceId(source.id);
    setOpenDocument(null);
    document.getElementById(`source-${source.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  const list = (
    <ConversationList
      conversations={conversations}
      selectedId={selectedId}
      onSelect={selectConversation}
      onNew={newConversation}
    />
  );

  const showSourceColumn = isDesktop && sources.length > 0;

  return (
    <div className="flex min-h-[calc(100dvh-var(--topbar-height))]">
      {isWide ? (
        <aside className="w-64 shrink-0 border-r border-border-subtle bg-surface-raised px-3 py-5">{list}</aside>
      ) : null}

      <section aria-label="Samtale" className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3 md:px-8">
          <h1 className="flex items-center gap-2 text-heading-3 text-fg-primary">
            <Sparkles className="size-4 text-ai-suggestion" aria-hidden />
            {conversation?.title ?? "Ny samtale"}
          </h1>
          {isWide ? null : (
            <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
              <SheetTrigger asChild>
                <Button variant="secondary" size="sm">
                  <PanelLeft aria-hidden />
                  Samtaler
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-80 bg-surface-raised p-4">
                <SheetTitle className="text-heading-3">Samtaler</SheetTitle>
                <SheetDescription className="sr-only">Samtalehistorik grupperet efter tid og kontekst</SheetDescription>
                {list}
              </SheetContent>
            </Sheet>
          )}
        </div>

        <div className="mx-auto w-full max-w-3xl flex-1 space-y-12 px-4 py-8 md:px-8">
          <p className="rounded-md bg-surface-sunken px-3 py-2 text-caption text-fg-secondary">
            Eksempelsamtaler med fiktive data. Copilot er ikke forbundet til vidensgrundlaget i denne udviklingsversion.
          </p>

          {conversation === null && asked.length === 0 ? (
            <div className="space-y-4">
              <p className="flex items-center gap-2 text-heading-2 text-fg-primary">
                <MessagesSquare className="size-5 text-fg-tertiary" aria-hidden />
                Hvad vil du vide?
              </p>
              <p className="text-body text-fg-secondary">
                Copilot svarer ud fra det godkendte vidensgrundlag og viser altid, hvad svaret bygger på. Eksempler på
                spørgsmål:
              </p>
              <ul className="flex flex-wrap gap-2">
                {exampleQuestions.map((question) => (
                  <li key={question}>
                    <Chip onClick={() => setAsked((items) => [...items, question])}>{question}</Chip>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {conversation?.exchanges.map((exchange) => (
            <CopilotAnswer
              key={exchange.id}
              exchange={exchange}
              activeSourceId={activeSourceId}
              onSelectSource={selectSource}
              inlineSources={!showSourceColumn}
              onFollowUp={(question) => setAsked((items) => [...items, question])}
            />
          ))}

          {asked.map((question, index) => (
            <PendingQuestion key={`${question}-${index}`} question={question} />
          ))}
        </div>

        <div className="sticky bottom-0 border-t border-border-subtle bg-surface-base/95 px-4 py-4 backdrop-blur-sm md:px-8">
          <div className="mx-auto max-w-3xl">
            <CopilotInput
              inputId={COPILOT_PAGE_INPUT_ID}
              label="Stil et opfølgende spørgsmål"
              placeholder={conversation ? "Stil et opfølgende spørgsmål" : "Stil et fagligt spørgsmål"}
              context={conversation?.context ?? null}
              onSubmit={(question) => setAsked((items) => [...items, question])}
            />
          </div>
        </div>
      </section>

      {showSourceColumn ? (
        <aside
          aria-label="Kilder"
          className="sticky top-[var(--topbar-height)] h-[calc(100dvh-var(--topbar-height))] w-80 shrink-0 overflow-y-auto border-l border-border-subtle bg-surface-raised px-4 py-5 xl:w-96"
        >
          {openDocument ? (
            <DocumentViewer source={openDocument} onBack={() => setOpenDocument(null)} />
          ) : (
            <div className="space-y-3">
              <h2 className="text-caption font-semibold tracking-wide text-fg-tertiary uppercase">Kilder</h2>
              {sources.map((source) => (
                <SourceCard
                  key={source.id}
                  source={source}
                  highlighted={activeSourceId === source.id}
                  onOpen={setOpenDocument}
                />
              ))}
            </div>
          )}
        </aside>
      ) : null}
    </div>
  );
}
