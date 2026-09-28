"use client";

import { ArrowRight, Library, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Chip } from "@/components/common/chip";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Section } from "@/components/common/section";
import { ProgressIndicator } from "@/components/data/progress-indicator";
import { EmptyState } from "@/components/states/empty-state";
import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle, InteractiveCard } from "@/components/ui/card";
import { LEARNING_STATUS } from "@/config/domain-status";
import type { LearningStatus, Product, ProductCategory } from "@/types/domain";

const CATEGORIES: ProductCategory[] = ["Ansvar", "Ting", "Person", "Særlige risici"];
const STATUSES: LearningStatus[] = ["inProgress", "notStarted", "completed"];

/** Product card: typography and air carry the card — no decorative images (§7.2). */
function ProductCard({ product }: { product: Product }) {
  const status = LEARNING_STATUS[product.status];
  return (
    <InteractiveCard href={`/learn/${product.slug}`} className="flex h-full flex-col">
      <p className="text-caption text-fg-tertiary">{product.category}</p>
      <CardTitle className="mt-1">{product.name}</CardTitle>
      <CardDescription className="mt-1 flex-1">{product.summary}</CardDescription>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <StatusBadge
          status={status.status}
          label={product.status === "inProgress" && product.currentModule ? `I gang · modul ${product.currentModule} af 11` : status.label}
        />
        {product.changeNotice ? (
          <span className="inline-flex items-center gap-1.5 text-label text-warning">
            <RefreshCw className="size-3.5" aria-hidden />
            Grundlag ændret
            <span className="sr-only">: {product.changeNotice}</span>
          </span>
        ) : null}
      </div>
    </InteractiveCard>
  );
}

export function LearnOverview({
  products,
  progression,
}: {
  products: readonly Product[];
  progression: { pathsInProgress: number; pathsCompleted: number; pathsAssigned: number; overallPercent: number };
}) {
  const [category, setCategory] = useState<ProductCategory | null>(null);
  const [status, setStatus] = useState<LearningStatus | null>(null);
  const inProgress = products.filter((product) => product.status === "inProgress");
  const filtered = products.filter(
    (product) => (!category || product.category === category) && (!status || product.status === status),
  );

  return (
    <PageContainer>
      <PageHeader
        display
        title="Learn"
        description="Faglig viden om erhvervsforsikringsprodukter — fra produktforståelse og dækninger til acceptregler og rådgivning."
      />

      <Section title="Mine læringsforløb">
        <div className="grid gap-4 md:grid-cols-2">
          {inProgress.map((product) => (
            <Card key={product.slug}>
              <p className="text-caption text-fg-tertiary">{product.category}</p>
              <CardTitle className="mt-1">{product.name}</CardTitle>
              <ProgressIndicator
                className="mt-4"
                label={`Modul ${product.currentModule} af 11`}
                value={(product.currentModule ?? 1) - 1}
                max={11}
                valueText={`${(product.currentModule ?? 1) - 1} af 11 gennemført`}
              />
              <Button asChild variant="secondary" size="sm" className="mt-4">
                <Link href={`/learn/${product.slug}`}>
                  Fortsæt <ArrowRight aria-hidden />
                </Link>
              </Button>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Produktbibliotek" description="Vælg et produkt for at se produktforløbet med de elleve moduler.">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div role="group" aria-label="Filtrér på kategori" className="flex flex-wrap gap-2">
            <Chip selected={category === null} onClick={() => setCategory(null)}>
              Alle kategorier
            </Chip>
            {CATEGORIES.map((entry) => (
              <Chip key={entry} selected={category === entry} onClick={() => setCategory(category === entry ? null : entry)}>
                {entry}
              </Chip>
            ))}
          </div>
          <div role="group" aria-label="Filtrér på status" className="flex flex-wrap gap-2">
            {STATUSES.map((entry) => (
              <Chip key={entry} selected={status === entry} onClick={() => setStatus(status === entry ? null : entry)}>
                {LEARNING_STATUS[entry].label}
              </Chip>
            ))}
          </div>
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            icon={Library}
            title="Ingen produkter matcher filtrene"
            action={
              <Button variant="secondary" size="sm" onClick={() => { setCategory(null); setStatus(null); }}>
                Nulstil filtre
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((product) => (
              <li key={product.slug}>
                <ProductCard product={product} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Progression">
        <Card className="grid gap-6 md:grid-cols-3">
          <div>
            <p className="tabular text-heading-1">{progression.pathsInProgress}</p>
            <p className="text-body text-fg-secondary">forløb i gang</p>
          </div>
          <div>
            <p className="tabular text-heading-1">
              {progression.pathsCompleted} af {progression.pathsAssigned}
            </p>
            <p className="text-body text-fg-secondary">tildelte forløb gennemført</p>
          </div>
          <ProgressIndicator label="Samlet progression" value={progression.overallPercent} valueText={`${progression.overallPercent} %`} />
        </Card>
      </Section>
    </PageContainer>
  );
}
