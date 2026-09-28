import type { Metadata } from "next";

import { requireSession } from "@/lib/auth/server-session";
import { notFound } from "next/navigation";

// PHASE 5: mock data only.
import { mockCourseModules, mockLesson, mockProducts } from "@/mocks";

import { LessonView } from "./lesson-view";
import { ModuleOverview } from "./module-overview";

async function resolve(props: PageProps<"/learn/[product]/[module]">) {
  const { product: productSlug, module: moduleSlug } = await props.params;
  const product = mockProducts.find((entry) => entry.slug === productSlug);
  const modules = product ? mockCourseModules(product) : [];
  const courseModule = modules.find((entry) => entry.slug === moduleSlug);
  return { product, modules, courseModule };
}

export async function generateMetadata(props: PageProps<"/learn/[product]/[module]">): Promise<Metadata> {
  const { product, courseModule } = await resolve(props);
  return { title: product && courseModule ? `${courseModule.title} · ${product.name}` : "Learn" };
}

export default async function ModulePage(props: PageProps<"/learn/[product]/[module]">) {
  await requireSession();
  const { product, modules, courseModule } = await resolve(props);
  if (!product || !courseModule) notFound();

  const hasLesson = product.slug === mockLesson.productSlug && courseModule.slug === mockLesson.moduleSlug;
  return hasLesson ? (
    <LessonView product={product} modules={modules} lesson={mockLesson} />
  ) : (
    <ModuleOverview product={product} courseModule={courseModule} />
  );
}
