"use client";

import { Maximize2, Minimize2, Sparkles, SquareArrowOutUpRight, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BREAKPOINTS, useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import type { CopilotConversation } from "@/types/domain";

import { useShell } from "../shell/shell-context";
import { CopilotAnswer } from "./copilot-answer";
import { CopilotInput } from "./copilot-input";
import { PendingQuestion } from "./pending-question";

const PANEL_INPUT_ID = "copilot-panel-input";

function PanelBody({
  conversation,
  onClose,
  showWidthToggle,
}: {
  conversation: CopilotConversation;
  onClose: () => void;
  showWidthToggle: boolean;
}) {
  const { copilotContext, copilotWide, setCopilotWide } = useShell();
  const [contextRemoved, setContextRemoved] = useState(false);
  const [asked, setAsked] = useState<string[]>([]);
  const effectiveContext = contextRemoved ? null : (copilotContext ?? conversation.context ?? null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-[var(--topbar-height)] shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-4">
        <p className="flex items-center gap-2 text-heading-3 text-fg-primary">
          <Sparkles className="size-4 text-ai-suggestion" aria-hidden />
          Copilot
        </p>
        <div className="flex items-center gap-1">
          {showWidthToggle ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={copilotWide ? "Gør panelet smallere" : "Udvid panelet til halv skærm"}
                  onClick={() => setCopilotWide(!copilotWide)}
                >
                  {copilotWide ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{copilotWide ? "Smallere panel" : "Halv skærm"}</TooltipContent>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" asChild>
                <Link href="/copilot" aria-label="Fortsæt i fuld Copilot-visning" onClick={onClose}>
                  <SquareArrowOutUpRight aria-hidden />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fuld visning</TooltipContent>
          </Tooltip>
          <Button variant="ghost" size="icon-sm" aria-label="Luk Copilot" onClick={onClose}>
            <X aria-hidden />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-4 py-5">
        <p className="rounded-md bg-surface-sunken px-3 py-2 text-caption text-fg-secondary">
          Eksempelsamtale · fiktive data. Copilot er ikke forbundet til vidensgrundlaget endnu.
        </p>
        {conversation.exchanges.map((exchange) => (
          <CopilotAnswer
            key={exchange.id}
            exchange={exchange}
            inlineSources
            compact
            onFollowUp={(question) => setAsked((list) => [...list, question])}
          />
        ))}
        {asked.map((question, index) => (
          <PendingQuestion key={`${question}-${index}`} question={question} compact />
        ))}
      </div>

      <div className="shrink-0 border-t border-border-subtle p-3">
        <CopilotInput
          inputId={PANEL_INPUT_ID}
          context={effectiveContext}
          onRemoveContext={() => setContextRemoved(true)}
          placeholder="Stil et fagligt spørgsmål"
          onSubmit={(question) => setAsked((list) => [...list, question])}
        />
      </div>
    </div>
  );
}

/**
 * Global Copilot (docs/04-ui-ux-design.md §15). On desktop it is a side panel that PUSHES
 * the content aside, so the current context stays visible. Below the desktop breakpoint
 * it opens as an overlay (tablet) or full screen (mobile).
 */
export function CopilotPanel({ conversation }: { conversation: CopilotConversation }) {
  const { copilotOpen, closeCopilot, copilotWide } = useShell();
  const isDesktop = useMediaQuery(BREAKPOINTS.desktop);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Remember what had focus when the panel opened, focus the input, restore on close.
  useEffect(() => {
    if (!copilotOpen || !isDesktop) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => document.getElementById(PANEL_INPUT_ID)?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      returnFocusRef.current?.focus?.();
    };
  }, [copilotOpen, isDesktop]);

  if (isDesktop) {
    if (!copilotOpen) return null;
    return (
      <aside
        aria-label="Copilot"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            closeCopilot();
          }
        }}
        className={cn(
          "sticky top-0 h-dvh shrink-0 border-l border-border-subtle bg-surface-raised",
          copilotWide ? "w-[50vw]" : "w-[var(--context-panel-width)]",
        )}
      >
        <PanelBody conversation={conversation} onClose={closeCopilot} showWidthToggle />
      </aside>
    );
  }

  return (
    <Sheet open={copilotOpen} onOpenChange={(open) => (open ? undefined : closeCopilot())}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 p-0 sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById(PANEL_INPUT_ID)?.focus();
        }}
      >
        <SheetTitle className="sr-only">Copilot</SheetTitle>
        <SheetDescription className="sr-only">Stil faglige spørgsmål uden at forlade siden.</SheetDescription>
        <PanelBody conversation={conversation} onClose={closeCopilot} showWidthToggle={false} />
      </SheetContent>
    </Sheet>
  );
}
