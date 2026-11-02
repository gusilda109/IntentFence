import type {
  ApprovedOrder,
  Mandate,
  PaymentExecutionView,
  ProposedOrder,
  Verdict,
} from "@/shared/contracts";

export interface ActorPort {
  propose(mandate: Mandate): Promise<ProposedOrder>;
}

export interface SupervisorPort {
  evaluate(mandate: Mandate, proposedOrder: ProposedOrder): Promise<Verdict>;
}

export interface PaymentExecutorPort {
  execute(approvedOrder: ApprovedOrder): Promise<PaymentExecutionView>;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
