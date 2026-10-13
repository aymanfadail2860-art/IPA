import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { BETA_HIDDEN_AREAS } from "@/config/navigation";

/**
 * Beta L2 (B-035, docs/beta.md §1) — the areas outside the beta's scope are hidden ON THE SERVER,
 * not only in the menu: every page of a hidden area asks requireArea first (a 404 before any data
 * is loaded), every server action of one asks sessionInArea, and the shared layout and Home load
 * no customer cases on the beta. The route test (routes.integration.test.ts) checks the running
 * app; these static checks keep a new page or action from skipping the guard.
 */

const ROOT = path.resolve(__dirname, "../..");
const PLATFORM = path.join(ROOT, "src/app/(platform)");
const read = (file: string) => fs.readFileSync(file, "utf8");
const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

function filesOf(area: string, pattern: RegExp): string[] {
  const dir = path.join(PLATFORM, area);
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

describe("hidden areas are refused on the server", () => {
  it("the hidden areas are exactly the platform's Advise, Analytics and Min profil routes", () => {
    expect(Object.keys(BETA_HIDDEN_AREAS).sort()).toEqual(["advise", "analytics", "profile"]);
    for (const area of Object.keys(BETA_HIDDEN_AREAS)) expect(fs.existsSync(path.join(PLATFORM, area)), area).toBe(true);
  });

  it("every page of a hidden area asks requireArea for its own area before anything else", () => {
    let pages = 0;
    for (const area of Object.keys(BETA_HIDDEN_AREAS)) {
      for (const file of filesOf(area, /^page\.tsx$/)) {
        pages += 1;
        const code = strip(read(file));
        const body = code.slice(code.indexOf("export default async function"));
        expect(body, file).toMatch(new RegExp(`^export default async function \\w+\\([^)]*\\)[^{]*\\{\\s*(?:const session = )?await requireArea\\("${area}"\\);`));
        expect(code, file).not.toMatch(/\brequireSession\(/);
      }
    }
    // advise, advise/[caseId], analytics, profile.
    expect(pages).toBe(4);
  });

  it("every server action of a hidden area asks sessionInArea — an action is reachable without the page", () => {
    let actions = 0;
    for (const area of Object.keys(BETA_HIDDEN_AREAS)) {
      for (const file of filesOf(area, /\.(ts|tsx)$/)) {
        const code = strip(read(file));
        if (!/^["']use server["']/m.test(code)) continue;
        for (const match of code.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{([^\n]*\n){0,3}/g)) {
          actions += 1;
          expect(match[0], `${file} ${match[1]}`).toMatch(new RegExp(`await sessionInArea\\("${area}"\\)`));
        }
        expect(code, file).not.toMatch(/\bgetServerSession\(/);
      }
    }
    expect(actions).toBeGreaterThan(0);
  });

  it("the proxy answers 404 for a hidden area to every signed-in user — before any rendering or server action", () => {
    const proxy = strip(read(path.join(ROOT, "src/proxy.ts")));
    expect(proxy).toMatch(/if \(signedIn && isHiddenInBeta\(request\.nextUrl\.pathname\)\) \{\s*return NextResponse\.rewrite\(new URL\("\/_ipa\/not-found", request\.url\), \{ status: 404 \}\);\s*\}\s*return response;/);
    // After the session check (an anonymous visitor is still sent to /login) and only past the demo's early return.
    expect(proxy.indexOf("if (isDemoMode())")).toBeLessThan(proxy.indexOf("isHiddenInBeta(request"));
    expect(proxy.indexOf("if (!signedIn && !isPublic)")).toBeLessThan(proxy.indexOf("isHiddenInBeta(request"));
    expect(fs.existsSync(path.join(ROOT, "src/app/_ipa"))).toBe(false);
  });

  it("requireArea answers 404 for a hidden area; sessionInArea answers no session", () => {
    const code = strip(read(path.join(ROOT, "src/lib/auth/server-session.ts")));
    expect(code).toMatch(/export async function requireArea\(area: string\): Promise<Session> \{\s*const session = await requireSession\(\);\s*if \(!isAreaAvailable\(area, surfaceOf\(session\)\)\) notFound\(\);\s*return session;\s*\}/);
    expect(code).toMatch(/export async function sessionInArea\(area: string\): Promise<Session \| null> \{\s*const session = await getServerSession\(\);\s*return session && isAreaAvailable\(area, surfaceOf\(session\)\) \? session : null;\s*\}/);
  });

  it("customer cases are loaded only where Advise exists (never on the beta)", () => {
    for (const file of ["src/app/(platform)/layout.tsx", "src/app/(platform)/home/page.tsx"]) {
      const code = strip(read(path.join(ROOT, file)));
      expect(code, file).toMatch(/isAreaAvailable\("advise", (surfaceOf\(session\)|surface)\) && hasPermission\(session\.grants, "advise\.case\.read"\) \? await listMyCases\(\) : \[\]/);
      expect(code.match(/listMyCases\(\)/g), file).toHaveLength(1);
    }
  });

  it("the shell offers no way into a hidden area on the beta: navigation, search and the user menu ask the surface", () => {
    expect(strip(read(path.join(ROOT, "src/components/shell/sidebar-nav.tsx")))).toMatch(/groupedNavItems\(session\.grants, surfaceOf\(session\)\)/);
    expect(strip(read(path.join(ROOT, "src/components/shell/global-search.tsx")))).toMatch(/searchEntriesForUser\(\{ entries, cases, isAdmin, surface: surfaceOf\(session\) \}\)/);
    const menu = strip(read(path.join(ROOT, "src/components/shell/user-menu.tsx")));
    expect(menu).toMatch(/const profileAvailable = isAreaAvailable\("profile", surfaceOf\(session\)\);/);
    expect(menu).toMatch(/\{profileAvailable \? \(/);
  });

  it("Home offers no entry into a hidden area: the team card, the cases and the profile link ask the surface", () => {
    const home = strip(read(path.join(ROOT, "src/app/(platform)/home/home-view.tsx")));
    expect(home).toMatch(/const isLeader = isAreaAvailable\("analytics", surface\) && hasPermission\(grants, "analytics\.team\.read", "team"\);/);
    expect(home).toMatch(/const canSeeCases = isAreaAvailable\("advise", surface\) && hasPermission\(grants, "advise\.case\.read"\);/);
    expect(home).toMatch(/\{isAreaAvailable\("profile", surface\) \? \(\s*<Link href="\/profile"/);
    // Every link into a hidden area sits behind one of those three guards.
    expect(home.match(/href=\{?["`]\/(advise|analytics|profile)/g)).toHaveLength(5);
    expect(home).toMatch(/\{isLeader \? \([\s\S]*?href="\/analytics"/);
    expect(home).toMatch(/\{canSeeCases \? \([\s\S]*?href="\/advise"[\s\S]*?href="\/advise"[\s\S]*?href=\{`\/advise\/\$\{entry\.id\}`\}/);
  });
});
