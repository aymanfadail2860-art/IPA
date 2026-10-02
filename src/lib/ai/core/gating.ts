import type { ProfileId } from "./types";

/**
 * Server-side gating (docs/08 §9, KRAV-ASS-001, B-015). Decided from the session state in the
 * database on every call — never from the user interface. Pure, so every rule is unit tested.
 *
 *   G1  Active Assessment attempt → ALL user-facing AI is locked.
 *   G2  Active AI roleplay        → all user-facing AI is locked EXCEPT the roleplay itself:
 *                                   practice.roleplay_turn for exactly the active session.
 *
 * The lock applies to AI, not to modules: Learn and Advise stay usable as modules (B-015).
 */

export interface GatingState {
  assessmentActive: boolean;
  roleplaySessionId: string | null;
}

export type GatingDecision =
  | { allowed: true }
  | { allowed: false; kind: "locked"; reason: "assessment_active" | "roleplay_active" }
  | { allowed: false; kind: "invalid_request"; reason: "no_active_roleplay" };

export function decideGating(profile: ProfileId, action: string, state: GatingState, roleplaySessionId?: string): GatingDecision {
  if (state.assessmentActive) return { allowed: false, kind: "locked", reason: "assessment_active" };
  const isRoleplayTurn = profile === "practice" && action === "roleplay_turn";
  if (state.roleplaySessionId) {
    if (isRoleplayTurn && roleplaySessionId === state.roleplaySessionId) return { allowed: true };
    return { allowed: false, kind: "locked", reason: "roleplay_active" };
  }
  // A roleplay line belongs to an active roleplay; without one there is nothing to answer.
  if (isRoleplayTurn) return { allowed: false, kind: "invalid_request", reason: "no_active_roleplay" };
  return { allowed: true };
}
