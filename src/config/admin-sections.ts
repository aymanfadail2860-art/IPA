import {
  BookOpen,
  FileText,
  KeyRound,
  Layers,
  LayoutDashboard,
  Library,
  Network,
  Package,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";

/** Admin secondary navigation (docs/04-ui-ux-design.md §14). */
export interface AdminSection {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { id: "overview", label: "Oversigt", href: "/admin", icon: LayoutDashboard },
  { id: "products", label: "Produkter", href: "/admin/products", icon: Package },
  { id: "documents", label: "Dokumenter", href: "/admin/documents", icon: FileText },
  { id: "knowledge-base", label: "Knowledge Base", href: "/admin/knowledge-base", icon: Library },
  { id: "learning-content", label: "Læringsindhold", href: "/admin/learning-content", icon: BookOpen },
  { id: "users", label: "Brugere", href: "/admin/users", icon: Users },
  { id: "teams", label: "Teams", href: "/admin/teams", icon: Network },
  { id: "permissions", label: "Permissions", href: "/admin/permissions", icon: KeyRound },
  { id: "versions", label: "Versioner", href: "/admin/versions", icon: Layers },
  { id: "settings", label: "Systemindstillinger", href: "/admin/settings", icon: SlidersHorizontal },
];

export function adminSectionById(id: string): AdminSection | undefined {
  return ADMIN_SECTIONS.find((section) => section.id === id);
}
