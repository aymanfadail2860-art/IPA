import type { Metadata } from "next";
import { Suspense } from "react";

import { LoadingState } from "@/components/states/loading-state";
import { aiDevToolsAllowed } from "@/dev/ai/gating-tool";
import { isDemoMode } from "@/dev/demo/demo-mode";
import { requireSession } from "@/lib/auth/server-session";
// Demo without a database: fixed mock answers. With a database: no mock data — every question
// goes through the AI Gateway (docs/08 §13).
import { mockCopilotConversations, mockCopilotDemoExamples, mockCopilotExampleQuestions } from "@/mocks";

import { CopilotWorkspace } from "./copilot-workspace";

export const metadata: Metadata = { title: "Copilot" };

export default async function CopilotPage() {
  await requireSession();
  const demo = isDemoMode();
  return (
    <Suspense fallback={<LoadingState className="p-8" />}>
      <CopilotWorkspace
        mode={demo ? "demo" : "live"}
        conversations={demo ? mockCopilotConversations : []}
        exampleQuestions={demo ? mockCopilotDemoExamples : mockCopilotExampleQuestions}
        devTools={!demo && aiDevToolsAllowed()}
      />
    </Suspense>
  );
}
