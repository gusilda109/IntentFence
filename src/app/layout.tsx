import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { PlusIcon, ShieldCheckIcon } from "@/components/icons";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "IntentFence — Policy-gated purchasing",
    template: "%s · IntentFence",
  },
  description: "Evidence-backed purchase review with deterministic PayPal Sandbox order controls.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="site-header-inner">
            <Link href="/" className="brand" aria-label="IntentFence home">
              <span className="brand-mark"><ShieldCheckIcon /></span>
              <span className="brand-copy">
                <strong>IntentFence</strong>
                <span>Policy-gated purchasing</span>
              </span>
            </Link>
            <Link href="/" className="header-link">
              <PlusIcon />
              <span>New mandate</span>
            </Link>
          </div>
        </header>
        {children}
        <footer className="site-footer">
          <span>IntentFence MVP</span>
          <span aria-hidden="true">·</span>
          <span>PayPal Orders v2 Sandbox</span>
          <span aria-hidden="true">·</span>
          <span>No capture</span>
        </footer>
      </body>
    </html>
  );
}
