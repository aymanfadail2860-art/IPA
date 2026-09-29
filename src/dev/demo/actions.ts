"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { DEMO_ROLE_COOKIE, isDemoMode, parseDemoRole } from "./demo-mode";

/**
 * Switches the role the demo is viewed as (decision B-003). Development tool, not
 * authorization: it does nothing when a database is connected.
 */
export async function switchDemoRole(formData: FormData): Promise<void> {
  if (!isDemoMode()) redirect("/home");
  const role = parseDemoRole(String(formData.get("role") ?? ""));
  (await cookies()).set(DEMO_ROLE_COOKIE, role, { path: "/", sameSite: "lax", httpOnly: true });
  redirect("/home");
}
