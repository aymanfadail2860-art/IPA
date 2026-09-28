import type { Metadata } from "next";

import { requireSession } from "@/lib/auth/server-session";
import { Suspense } from "react";

import { LoadingState } from "@/components/states/loading-state";
// PHASE 5: mock conversations only — no AI integration.
import { mockCopilotConversations, mockCopilotExampleQuestions } from "@/mocks";

import { CopilotWorkspace } from "./copilot-workspace";

export const metadata: Metadata = { title: "Copilot" };

export default async function CopilotPage() {
  await requireSession();
  return (
    <Suspense fallback={<LoadingState className="p-8" />}>
      <CopilotWorkspace conversations={mockCopilotConversations} exampleQuestions={mockCopilotExampleQuestions} />
    </Suspense>
  );
}
