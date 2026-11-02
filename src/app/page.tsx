import { MandateForm } from "@/components/mandate-form";
import { EvidenceIcon, LockIcon, VerdictIcon } from "@/components/icons";

const reviewSteps = [
  {
    icon: <EvidenceIcon />,
    number: "01",
    title: "Research with receipts",
    text: "Every proposed item stays connected to captured evidence, publisher identity, and a security report.",
  },
  {
    icon: <VerdictIcon />,
    number: "02",
    title: "Policy before payment",
    text: "Necessity, compatibility, dependencies, and budget are evaluated before any order can be created.",
  },
  {
    icon: <LockIcon />,
    number: "03",
    title: "A narrow payment boundary",
    text: "Only an approved snapshot reaches the executor. Sandbox order creation never means captured payment.",
  },
];

export default function Home() {
  return (
    <main className="page-shell home-page">
      <section className="hero-grid" aria-labelledby="hero-title">
        <div className="hero-copy-column">
          <p className="eyebrow"><span className="eyebrow-line" /> Autonomous, not unbounded</p>
          <h1 id="hero-title" className="hero-title">A purchase should prove it belongs.</h1>
          <p className="hero-copy">
            Define the outcome and the limits. IntentFence researches the order, tests every item against trusted evidence, and keeps PayPal behind a deterministic approval boundary.
          </p>
          <div className="hero-assurances" aria-label="Platform assurances">
            <span>Open-ended goals</span>
            <span>Item-level verdicts</span>
            <span>No capture</span>
          </div>
        </div>
        <MandateForm />
      </section>

      <section className="review-section" aria-labelledby="review-title">
        <div className="review-section-heading">
          <p className="eyebrow">One accountable review</p>
          <h2 id="review-title">From intent to a defensible order.</h2>
        </div>
        <div className="review-steps">
          {reviewSteps.map((step) => (
            <article className="review-step" key={step.number}>
              <div className="review-step-top">
                <span className="review-step-icon">{step.icon}</span>
                <span className="review-step-number">{step.number}</span>
              </div>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
