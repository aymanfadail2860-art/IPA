"use client";

import { BookOpen } from "lucide-react";
import Link from "next/link";

import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { CopilotContext } from "@/components/copilot/copilot-context";
import { PageBreadcrumbs } from "@/components/shell/breadcrumbs";
import { EmptyState } from "@/components/states/empty-state";
import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { LEARNING_STATUS } from "@/config/domain-status";
import type { CourseModule, Product } from "@/types/domain";

/** Module overview. In phase 5 only one module has lesson content in the mock data. */
export function ModuleOverview({ product, courseModule }: { product: Product; courseModule: CourseModule }) {
  const status = LEARNING_STATUS[courseModule.status];
  return (
    <PageContainer className="max-w-4xl">
      <PageBreadcrumbs
        items={[
          { label: "Learn", href: "/learn" },
          { label: product.name, href: `/learn/${product.slug}` },
          { label: `Modul ${courseModule.number} · ${courseModule.title}` },
        ]}
      />
      <CopilotContext value={`${product.name} · Modul ${courseModule.number} · ${courseModule.title}`} />
      <PageHeader
        eyebrow={`${product.name} · Modul ${courseModule.number} af 11`}
        title={courseModule.title}
        actions={<StatusBadge status={status.status} label={status.label} />}
      />
      <EmptyState
        icon={BookOpen}
        title="Lektionerne i dette modul findes ikke i udviklingsdata"
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href="/learn/erhvervsansvar/daekninger">Se eksempel: Erhvervsansvar · Dækninger</Link>
          </Button>
        }
      >
        Grundplatformen indeholder én fuldt udfyldt lektion til vurdering af læsevisningen. Indholdet til de øvrige
        moduler oprettes i Admin → Læringsindhold i en senere fase.
      </EmptyState>
    </PageContainer>
  );
}
