import type { ItemDecision, RunView } from "@/shared/contracts";
import { BoxIcon, ExternalLinkIcon } from "@/components/icons";
import { ProductImage } from "@/components/product-image";
import { SectionPanel } from "@/components/section-panel";
import { StatusBadge, type BadgeTone } from "@/components/status-badge";
import { formatMoney } from "@/components/format";

const decisionTones: Record<ItemDecision["decision"], BadgeTone> = {
  ALLOW: "success",
  BLOCK: "danger",
  REVIEW: "warning",
};

export function OrderItems({ run }: { run: RunView }) {
  const order = run.proposedOrder;
  const decisions = new Map(run.verdict?.itemDecisions.map((decision) => [decision.itemId, decision]) ?? []);

  return (
    <SectionPanel
      title={run.replay ? "Recommended items" : "What Qwen recommends"}
      description={run.replay
        ? "Items selected for this demo, with the purpose and policy outcome for each."
        : "Items selected for your request, with the purpose and policy outcome for each."}
      icon={<BoxIcon />}
      testId="order-items"
      action={order ? <StatusBadge tone="neutral">{order.items.length} {order.items.length === 1 ? "item" : "items"}</StatusBadge> : null}
    >
      {!order ? (
        <div className="empty-state">
          <span className="empty-state-icon"><BoxIcon /></span>
          <strong>No proposed order yet</strong>
          <p>Items will appear here after the research stage produces a validated proposal.</p>
        </div>
      ) : (
        <>
          <ol className="item-list">
            {order.items.map((item) => {
              const itemDecision = decisions.get(item.id);
              const lineTotal = { ...item.unitPrice, amountMinor: item.unitPrice.amountMinor * item.quantity };
              return (
                <li key={item.id}>
                  <article className="item-card" id={`item-${item.id}`}>
                    <div className="item-card-main">
                      <div className={item.imageUrl ? "item-card-layout" : undefined}>
                        {item.imageUrl ? <ProductImage src={item.imageUrl} alt={item.name} /> : null}
                        <div className="item-card-content">
                          <div className="item-card-top">
                            <div>
                              <h3>{item.name}</h3>
                              <p className="item-store">{item.storeId} · Quantity {item.quantity}</p>
                            </div>
                            <div className="item-price">
                              <strong>{formatMoney(lineTotal)}</strong>
                              <span>{formatMoney(item.unitPrice)} each</span>
                            </div>
                          </div>
                          <p className="item-purpose">{item.purpose}</p>
                          <p className="item-description">{item.description}</p>
                          <div className="item-meta">
                            <a href={item.productUrl} target="_blank" rel="noreferrer">
                              View product source <ExternalLinkIcon />
                            </a>
                          </div>
                          <div className="item-decision-row">
                            <span className="item-decision-label">Policy decision</span>
                            <StatusBadge tone={itemDecision ? decisionTones[itemDecision.decision] : "neutral"} dot>
                              {itemDecision?.decision ?? "PENDING"}
                            </StatusBadge>
                          </div>
                        </div>
                      </div>
                    </div>
                    {itemDecision && itemDecision.reasons.length > 0 ? (
                      <ul className="item-reasons" aria-label={`Findings for ${item.name}`}>
                        {itemDecision.reasons.map((reason, index) => (
                          <li key={`${reason.code}-${index}`}><code>{reason.code}</code>{reason.message}</li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                </li>
              );
            })}
          </ol>
          <div className="order-totals">
            <div className="order-total">
              <span>Proposed total</span>
              <strong>{formatMoney(order.total)}</strong>
            </div>
            {run.approvedOrder ? (
              <div className="order-total order-total-approved">
                <span>Approved subset</span>
                <strong>{formatMoney(run.approvedOrder.total)}</strong>
              </div>
            ) : null}
          </div>
        </>
      )}
    </SectionPanel>
  );
}
