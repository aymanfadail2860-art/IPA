"use client";

/**
 * ⚠ DEVELOPMENT ONLY — visual test tool, NOT access control.
 * Switches the mock session between Rådgiver, Leder and Administrator.
 * Removed when real authentication and permission checks are introduced.
 */
import { ChevronUp, FlaskConical } from "lucide-react";
import { useState } from "react";

import { MOCK_ROLE_LABELS, type MockRoleId } from "@/mocks/sessions";

import { DEV_TOOLS_ENABLED } from "./dev-tools";
import { useDevRole } from "./dev-session-provider";

const ROLES: MockRoleId[] = ["advisor", "leader", "administrator"];

export function RoleSwitcher() {
  const { role, setRole } = useDevRole();
  const [expanded, setExpanded] = useState(false);
  if (!DEV_TOOLS_ENABLED) return null;

  return (
    <aside
      aria-label="Udviklingsværktøj: rolle-switcher"
      className="fixed bottom-4 left-4 z-40 max-w-[calc(100vw-2rem)] rounded-lg border-2 border-warning bg-warning-subtle shadow-md lg:bottom-20 print:hidden"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="dev-role-switcher"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full cursor-pointer items-center gap-1.5 px-3 py-1.5 text-caption font-semibold text-warning"
      >
        <FlaskConical className="size-3.5" aria-hidden />
        DEV · {MOCK_ROLE_LABELS[role]}
        <ChevronUp className={expanded ? "size-3.5" : "size-3.5 rotate-180"} aria-hidden />
      </button>
      <div id="dev-role-switcher" hidden={!expanded} className="border-t border-warning/40 p-3">
        <p className="mb-2 text-caption text-fg-primary">Udviklingsværktøj · ikke adgangskontrol</p>
        <fieldset>
          <legend className="sr-only">Vis platformen som</legend>
          <div className="flex gap-1" role="radiogroup">
            {ROLES.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={role === id}
                onClick={() => setRole(id)}
                className="cursor-pointer rounded-md px-2.5 py-1 text-label text-fg-primary hover:bg-surface-raised aria-checked:bg-brand aria-checked:text-fg-inverse"
              >
                {MOCK_ROLE_LABELS[id]}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
    </aside>
  );
}
