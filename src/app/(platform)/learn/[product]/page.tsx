import type { Metadata } from "next";
import { notFound } from "next/navigation";

// PHASE 5: mock data only.
import { mockCourseModules, mockLesson, mockProducts } from "@/mocks";

import { ProductView } from "./product-view";

function findProduct(slug: string) {
  return mockProducts.find((product) => product.slug === slug);
}

export async function generateMetadata(props: PageProps<"/learn/[product]">): Promise<Metadata> {
  const { product } = await props.params;
  return { title: findProduct(product)?.name ?? "Learn" };
}

export default async function ProductPage(props: PageProps<"/learn/[product]">) {
  const { product: slug } = await props.params;
  const product = findProduct(slug);
  if (!product) notFound();
  return (
    <ProductView
      product={product}
      modules={mockCourseModules(product)}
      sources={product.slug === mockLesson.productSlug ? mockLesson.sources : []}
    />
  );
}
