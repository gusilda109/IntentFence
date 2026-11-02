import type { ReactNode } from "react";

interface SectionPanelProps {
  title: string;
  description?: string;
  eyebrow?: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
  className?: string;
}

export function SectionPanel({
  title,
  description,
  eyebrow,
  icon,
  action,
  children,
  testId,
  className = "",
}: SectionPanelProps) {
  return (
    <section className={`panel ${className}`} data-testid={testId}>
      <div className="panel-header">
        <div className="panel-heading-group">
          <span className="panel-icon">{icon}</span>
          <div>
            {eyebrow ? <p className="panel-eyebrow">{eyebrow}</p> : null}
            <h2 className="panel-title">{title}</h2>
            {description ? <p className="panel-description">{description}</p> : null}
          </div>
        </div>
        {action ? <div className="panel-action">{action}</div> : null}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}
