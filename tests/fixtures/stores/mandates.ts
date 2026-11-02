import { MandateSchema, type Mandate } from "@/shared/contracts";

export function coffeeMandate(): Mandate {
  return MandateSchema.parse({
    schemaVersion: "1",
    id: "99999999-9999-4999-8999-999999999999",
    goal: "Организуй кассу кофейни на базе планшета с печатью чеков",
    budget: { currency: "USD", amountMinor: 80000 },
    constraints: [{
      id: "single-counter",
      text: "Оборудование для одной кассы; итоговая сумма не должна превышать бюджет.",
      enforcement: "hard",
    }],
    createdAt: "2026-01-01T00:00:00.000Z",
  });
}

export function unmatchedMandate(): Mandate {
  return {
    ...coffeeMandate(),
    id: "88888888-8888-4888-8888-888888888888",
    goal: "Equip a small repair bench with a compatible soldering station",
  };
}
