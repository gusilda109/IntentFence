import { MandateForm } from "@/components/mandate-form";
import { EvidenceIcon, LockIcon, VerdictIcon } from "@/components/icons";

const reviewSteps = [
  {
    icon: <EvidenceIcon />,
    number: "01",
    title: "We research the options",
    text: "Tell us the outcome, not a product list. Live research uses Qwen to explore suitable products; demo mode uses a ready-made catalog.",
  },
  {
    icon: <VerdictIcon />,
    number: "02",
    title: "You get clear decisions, with evidence",
    text: "See why each item fits, what it costs, and which constraints shaped the recommendation—before you decide what to do next.",
  },
  {
    icon: <LockIcon />,
    number: "03",
    title: "You stay in control",
    text: "Review the proposed order and choose the next step. PayPal Sandbox order creation never automatically captures a payment.",
  },
];

export default function Home() {
  return (
    <main className="page-shell home-page">
      <section className="hero-grid" aria-labelledby="hero-title">
        <div className="hero-copy-column">
          <p className="eyebrow"><span className="eyebrow-line" /> Your goal, your spending limits</p>
          <h1 id="hero-title" className="hero-title">What can we help you buy?</h1>
          <p className="hero-copy">
            Tell us what you need and how much you want to spend. We’ll research the options, explain every decision, and keep spending within your limits.
          </p>
          <div className="hero-assurances" aria-label="Purchase assurances">
            <span>You set the limits</span>
            <span>Every decision is explained</span>
            <span>No automatic payment capture</span>
          </div>
        </div>
        <MandateForm />
      </section>

      <section className="review-section" aria-labelledby="review-title">
        <div className="review-section-heading">
          <p className="eyebrow">From your goal to a confident choice</p>
          <h2 id="review-title">How it works</h2>
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
