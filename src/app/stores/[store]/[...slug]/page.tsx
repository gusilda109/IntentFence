import { notFound } from "next/navigation";
import {
  STORE_PAGES,
  extractBodyHtml,
  getStorePageByPath,
} from "@/modules/demo-stores";

export const dynamicParams = false;

export function generateStaticParams() {
  return STORE_PAGES.map((page) => ({
    store: page.storeId,
    slug: page.slug.split("/"),
  }));
}

export default async function DemoStoreFixturePage({
  params,
}: {
  params: Promise<{ store: string; slug: string[] }>;
}) {
  const { store, slug } = await params;
  let page;
  try {
    page = getStorePageByPath(store, slug);
  } catch {
    notFound();
  }
  if (!page) notFound();

  return <div data-capture-id={page.captureId} dangerouslySetInnerHTML={{ __html: extractBodyHtml(page.rawHtml) }} />;
}
