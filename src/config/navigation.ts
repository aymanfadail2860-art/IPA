import {
  BriefcaseBusiness,
  ChartColumn,
  ClipboardCheck,
  Dumbbell,
  GraduationCap,
  House,
  Settings,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import { meetsRequirement, type PermissionGrant, type PermissionRequirement } from "@/lib/auth/permissions";

import { isAreaAvailable, type Surface } from "./beta-surface";

/** Admin is shown to — and served to — users with at least one administrative permission. */
export const ADMIN_REQUIREMENT: PermissionRequirement = {
  anyOf: ["knowledge.document.write", "knowledge.version.publish", "identity.user.manage", "system.settings.manage"],
};

export const ANALYTICS_REQUIREMENT: PermissionRequirement = { anyOf: ["analytics.team.read"] };

export type NavGroupId = "work" | "insight" | "personal";

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  group: NavGroupId;
  /** Items whose requirement is not met are not rendered at all — never shown locked. */
  requires?: PermissionRequirement;
}

/**
 * Main navigation (docs/04-ui-ux-design.md §4). Three groups separated by space:
 * work areas, insight, personal/administration.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: "home", label: "Home", href: "/home", icon: House, group: "work" },
  { id: "learn", label: "Learn", href: "/learn", icon: GraduationCap, group: "work" },
  { id: "copilot", label: "Copilot", href: "/copilot", icon: Sparkles, group: "work" },
  { id: "practice", label: "Practice", href: "/practice", icon: Dumbbell, group: "work" },
  { id: "advise", label: "Advise", href: "/advise", icon: BriefcaseBusiness, group: "work" },
  { id: "assessment", label: "Assessment", href: "/assessment", icon: ClipboardCheck, group: "work" },
  {
    id: "analytics",
    label: "Analytics",
    href: "/analytics",
    icon: ChartColumn,
    group: "insight",
    requires: ANALYTICS_REQUIREMENT,
  },
  { id: "profile", label: "Min profil", href: "/profile", icon: UserRound, group: "personal" },
  {
    id: "admin",
    label: "Admin",
    href: "/admin",
    icon: Settings,
    group: "personal",
    requires: ADMIN_REQUIREMENT,
  },
];

export { BETA_HIDDEN_AREAS, isAreaAvailable, surfaceOf, type Surface } from "./beta-surface";

/** Whether a link target leads into an area this surface hides (for search entries and links). */
export function isHrefAvailable(href: string, surface: Surface): boolean {
  const item = navItemForPath(href.split(/[?#]/)[0]!);
  return item ? isAreaAvailable(item.id, surface) : true;
}

export const NAV_GROUP_ORDER: readonly NavGroupId[] = ["work", "insight", "personal"];

export const NAV_GROUP_LABELS: Record<NavGroupId, string> = {
  work: "Arbejdsområder",
  insight: "Indsigt",
  personal: "Personligt og forvaltning",
};

export function visibleNavItems(grants: readonly PermissionGrant[], surface: Surface): NavItem[] {
  return NAV_ITEMS.filter((item) => isAreaAvailable(item.id, surface) && meetsRequirement(grants, item.requires));
}

export function groupedNavItems(grants: readonly PermissionGrant[], surface: Surface) {
  const visible = visibleNavItems(grants, surface);
  return NAV_GROUP_ORDER.map((group) => ({
    group,
    label: NAV_GROUP_LABELS[group],
    items: visible.filter((item) => item.group === group),
  })).filter((entry) => entry.items.length > 0);
}

export function navItemForPath(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
}

export function canAccessPath(pathname: string, grants: readonly PermissionGrant[], surface: Surface): boolean {
  const item = navItemForPath(pathname);
  return item ? isAreaAvailable(item.id, surface) && meetsRequirement(grants, item.requires) : true;
}
