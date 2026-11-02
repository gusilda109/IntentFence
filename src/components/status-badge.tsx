import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "paypal";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "badge-neutral",
  success: "badge-success",
  warning: "badge-warning",
  danger: "badge-danger",
  info: "badge-info",
  paypal: "badge-paypal",
};

interface StatusBadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
}

export function StatusBadge({ children, tone = "neutral", dot = false, className = "" }: StatusBadgeProps) {
  return (
    <span className={`badge ${toneClasses[tone]} ${className}`}>
      {dot ? <span className="badge-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
