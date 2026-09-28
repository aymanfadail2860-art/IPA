import { cn } from "@/lib/utils";

/** Max content width — professional text does not stretch across wide screens (§3.2). */
export function PageContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto w-full max-w-[var(--content-max-width)] space-y-10 px-4 py-8 md:px-8 lg:py-10", className)}>
      {children}
    </div>
  );
}
