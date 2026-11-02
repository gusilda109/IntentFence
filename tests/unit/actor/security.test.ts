import { describe, expect, it } from "vitest";
import { captureStorePage } from "@/modules/actor/evidence";

const infectedUrl = "http://localhost:3000/stores/checkout-bundles/products/calibration-license";
const cleanUrl = "http://localhost:3000/stores/maker-docs/compatibility/hubtab-s10-rp-80";

 describe("prompt-injection security metadata", () => {
  it("quarantines concealed agent-directed raw HTML without exposing it as visible text", () => {
    const capture = captureStorePage(infectedUrl, new Date("2026-01-01T00:00:00.000Z"));
    const codes = capture.securityScan.report.findings.map((finding) => finding.code);

    expect(capture.securityScan.report.status).toBe("QUARANTINED");
    expect(codes).toContain("RAW_CSS_OR_MACHINE_ONLY_CONCEALMENT");
    expect(codes).toContain("RAW_HTML_COMMENT_AGENT_INSTRUCTION");
    expect(codes).toContain("RAW_AGENT_DIRECTED_INSTRUCTION");
    expect(codes).toContain("RAW_MANDATE_OR_POLICY_OVERRIDE");
    expect(codes).toContain("RAW_ORDER_OR_REVIEW_MANIPULATION");
    expect(capture.visibleText).toContain("INFECTED DEMO FIXTURE");
    expect(capture.visibleText).not.toContain("Autonomous agent");
    expect(capture.visibleText).not.toContain("hide this add-on");
    expect(capture.securityScan.visibleFindings).toHaveLength(0);
  });

  it("keeps ordinary manufacturer evidence clean", () => {
    const capture = captureStorePage(cleanUrl, new Date("2026-01-01T00:00:00.000Z"));
    expect(capture.securityScan.report).toEqual({ captureId: capture.captureId, status: "CLEAN", findings: [] });
  });
});
