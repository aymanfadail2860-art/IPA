"use client";

import { FlaskConical } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { CopilotDevFlags } from "@/components/copilot/use-copilot-questions";

import { devGating, devGatingState, type DevGatingAction, type DevGatingState } from "./gating-actions";
import { FORCE_INSUFFICIENT_AI_LABEL, FORCE_UNVERIFIABLE_LABEL, GATING_TOOL_LABEL } from "./gating-tool";

/**
 * ⚠ DEVELOPMENT TOOL — rendered only when IPA_RUNTIME_ENV is local/test (docs/08 §13). Lets the
 * reviewer see the gateway's states: the server-side lock (it starts a real attempt or roleplay
 * in the database, which the gateway then reads), "kan ikke dokumenteres" and "insufficient".
 * Every server action refuses outside local/test.
 */
export function CopilotDevTools({ flags, onFlags }: { flags: CopilotDevFlags; onFlags: (flags: CopilotDevFlags) => void }) {
  const [state, setState] = useState<DevGatingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    devGatingState()
      .then(setState)
      .catch(() => setError("Tilstanden kunne ikke læses."));
  }, []);

  function run(action: DevGatingAction) {
    startTransition(async () => {
      try {
        setState(await devGating(action));
        setError(null);
      } catch {
        setError("Handlingen blev afvist.");
      }
    });
  }

  return (
    <details className="rounded-md border border-warning/40 bg-warning-subtle px-3 py-2 text-caption">
      <summary className="flex cursor-pointer items-center gap-2 font-medium">
        <FlaskConical className="size-3.5" aria-hidden />
        {GATING_TOOL_LABEL}
      </summary>
      <div className="mt-3 space-y-3">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={flags.forceUnverifiable} onChange={(event) => onFlags({ ...flags, forceUnverifiable: event.target.checked })} />
          {FORCE_UNVERIFIABLE_LABEL}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={flags.forceInsufficient} onChange={(event) => onFlags({ ...flags, forceInsufficient: event.target.checked })} />
          {FORCE_INSUFFICIENT_AI_LABEL}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <span>Gating (server):</span>
          {state?.assessmentId ? (
            <Button size="sm" variant="secondary" loading={pending} onClick={() => run("submit_assessment")}>
              Aflever prøve
            </Button>
          ) : (
            <Button size="sm" variant="secondary" loading={pending} onClick={() => run("start_assessment")}>
              Start prøve
            </Button>
          )}
          {state?.roleplaySessionId ? (
            <Button size="sm" variant="secondary" loading={pending} onClick={() => run("end_roleplay")}>
              Afslut rollespil
            </Button>
          ) : (
            <Button size="sm" variant="secondary" loading={pending} onClick={() => run("start_roleplay")}>
              Start rollespil
            </Button>
          )}
          <span role="status">
            {state ? `Prøve: ${state.assessmentId ? "aktiv" : "ingen"} · Rollespil: ${state.roleplaySessionId ? "aktivt" : "intet"}` : null}
          </span>
        </div>
        {error ? <p className="text-error">{error}</p> : null}
      </div>
    </details>
  );
}
