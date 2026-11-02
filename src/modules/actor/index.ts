import "server-only";
import { MandateSchema, type EvidenceRecord, type Mandate, type ProposedOrder } from "@/shared/contracts";
import type { ActorPort } from "@/shared/ports";
import type { CatalogSource } from "@/shared/contracts";
import { createCatalogProvider, type CatalogProvider } from "@/modules/catalog";
import { runDeterministicChannel3Actor } from "./channel3";
import { runLiveActor } from "./live";
import {
  createCoffeeReplay,
  createIncompatibilityReplay,
  isCoffeeReplayGoal,
  isIncompatibilityReplayGoal,
} from "./replay";
import { ActorEvidenceSession } from "./session";
import { validateProposedOrder } from "./validation";

export interface Actor extends ActorPort {
  getEvidence(mandateId: string): Promise<EvidenceRecord[]>;
}

export interface CreateActorOptions {
  mode?: "live" | "replay";
  model?: string;
  catalogSource?: CatalogSource;
  catalogProvider?: CatalogProvider;
}

export function createActor(options: CreateActorOptions = {}): Actor {
  const mode = options.mode ?? "live";
  const catalogSource = options.catalogSource ?? "fixtures";
  const provider = options.catalogProvider ?? createCatalogProvider(catalogSource);
  const session = new ActorEvidenceSession();

  return {
    async propose(mandateInput: Mandate): Promise<ProposedOrder> {
      const mandate = MandateSchema.parse(mandateInput);
      if (catalogSource === "channel3") {
        return mode === "live"
          ? runLiveActor(mandate, session, options.model, provider)
          : runDeterministicChannel3Actor(mandate, session, provider);
      }
      if (mode === "live") return runLiveActor(mandate, session, options.model, provider);

      const replay = isIncompatibilityReplayGoal(mandate)
        ? createIncompatibilityReplay(mandate)
        : isCoffeeReplayGoal(mandate)
          ? createCoffeeReplay(mandate)
          : undefined;
      if (!replay) {
        throw new Error("No saved replay exists for this open goal; use live mode for a new goal");
      }
      session.saveReplayRecords(mandate.id, replay.evidence);
      return validateProposedOrder(mandate, replay.proposal, session.list(mandate.id));
    },

    async getEvidence(mandateId: string): Promise<EvidenceRecord[]> {
      return session.list(mandateId);
    },
  };
}
