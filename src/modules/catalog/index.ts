import "server-only";
import type { CatalogSource } from "@/shared/contracts";
import { Channel3CatalogProvider } from "./channel3";
import { FixtureCatalogProvider } from "./fixtures";
import type { CatalogProvider } from "./types";

export function createCatalogProvider(source: CatalogSource): CatalogProvider {
  return source === "channel3" ? new Channel3CatalogProvider() : new FixtureCatalogProvider();
}

export { Channel3CatalogProvider } from "./channel3";
export { Channel3Client, Channel3Error } from "./channel3-client";
export { FixtureCatalogProvider } from "./fixtures";
export type { CatalogCandidate, CatalogProductSnapshot, CatalogProvider } from "./types";
