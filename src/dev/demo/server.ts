import "server-only";

import { cookies } from "next/headers";

import { DEMO_ROLE_COOKIE, parseDemoRole, type DemoRole } from "./demo-mode";

/** The role the demo is currently viewed as (demo mode only, decision B-003). */
export async function readDemoRole(): Promise<DemoRole> {
  return parseDemoRole((await cookies()).get(DEMO_ROLE_COOKIE)?.value);
}
