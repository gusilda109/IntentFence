import { captureStorePage } from "@/modules/actor/evidence";
import { listCatalog } from "@/modules/demo-stores";
import type { CatalogProvider } from "./types";

export class FixtureCatalogProvider implements CatalogProvider {
  readonly source = "fixtures" as const;

  async discover(): ReturnType<CatalogProvider["discover"]> {
    return listCatalog().map((entry) => ({
      capture: captureStorePage(entry.url),
      title: entry.title,
      kind: entry.kind,
    }));
  }

  async validateSelection(): Promise<void> {
    // Local immutable fixtures require no remote revalidation.
  }
}
