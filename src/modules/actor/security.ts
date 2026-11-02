import { SecurityReportSchema, type SecurityReport } from "@/shared/contracts";

interface FindingInput {
  code: string;
  message: string;
}

const INSTRUCTION_PATTERN = /\b(ignore|override|add|include|conceal|hide|change|increase|reveal|call|disclose|required)\b/i;
const AGENT_PATTERN = /\b(autonomous|ai|shopping)?\s*agent\b|\bagent\s*:/i;
const OVERRIDE_PATTERN = /\b(ignore|override|disregard)\b[\s\S]{0,100}\b(mandate|system prompt|system policy|policy|instructions?)\b/i;
const ORDER_PATTERN = /\b(add|include|conceal|hide|increase|change)\b[\s\S]{0,120}\b(item|order|review|verdict|budget)\b/i;
const SECRET_OR_TOOL_PATTERN = /\b(reveal|expose|call|use)\b[\s\S]{0,100}\b(credentials?|secrets?|tokens?|transaction tool)\b/i;
const CSS_CONCEALMENT_PATTERN = /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0|\bhidden\s*=|\bhidden>|\bdata-agent-only\s*=/i;

const deduplicate = (findings: FindingInput[]): FindingInput[] => [
  ...new Map(findings.map((finding) => [finding.code, finding])).values(),
];

function scanInstructions(text: string, raw: boolean): FindingInput[] {
  const findings: FindingInput[] = [];
  const prefix = raw ? "RAW" : "VISIBLE";

  if (AGENT_PATTERN.test(text) && INSTRUCTION_PATTERN.test(text)) {
    findings.push({
      code: `${prefix}_AGENT_DIRECTED_INSTRUCTION`,
      message: `${raw ? "Raw HTML" : "Visible text"} contains instructions directed at an autonomous agent.`,
    });
  }
  if (OVERRIDE_PATTERN.test(text)) {
    findings.push({
      code: `${prefix}_MANDATE_OR_POLICY_OVERRIDE`,
      message: "Content attempts to override the mandate, policy, or higher-priority instructions.",
    });
  }
  if (ORDER_PATTERN.test(text)) {
    findings.push({
      code: `${prefix}_ORDER_OR_REVIEW_MANIPULATION`,
      message: "Content attempts to manipulate items, review, verdict, or budget.",
    });
  }
  if (SECRET_OR_TOOL_PATTERN.test(text)) {
    findings.push({
      code: `${prefix}_SECRET_OR_TOOL_REQUEST`,
      message: "Content requests secret disclosure or invocation of a transaction capability.",
    });
  }
  return findings;
}

export interface PageSecurityScan {
  report: SecurityReport;
  visibleFindings: readonly FindingInput[];
  rawFindings: readonly FindingInput[];
}

export function scanPageSecurity(rawHtml: string, visibleText: string, captureId: string): PageSecurityScan {
  const rawFindings = scanInstructions(rawHtml, true);
  const visibleFindings = scanInstructions(visibleText, false);

  if (CSS_CONCEALMENT_PATTERN.test(rawHtml)) {
    rawFindings.push({
      code: "RAW_CSS_OR_MACHINE_ONLY_CONCEALMENT",
      message: "Raw HTML contains CSS concealment, hidden content, or a machine-only block.",
    });
  }

  const comments = rawHtml.match(/<!--[\s\S]*?-->/g) ?? [];
  if (comments.length > 0) {
    rawFindings.push({
      code: "RAW_HTML_COMMENT",
      message: "Raw HTML contains comments that are excluded from visible text.",
    });
    if (comments.some((comment) => AGENT_PATTERN.test(comment) && INSTRUCTION_PATTERN.test(comment))) {
      rawFindings.push({
        code: "RAW_HTML_COMMENT_AGENT_INSTRUCTION",
        message: "An HTML comment contains an agent-directed instruction.",
      });
    }
  }

  const combined = deduplicate([...rawFindings, ...visibleFindings]);
  const report = SecurityReportSchema.parse({
    captureId,
    status: combined.length > 0 ? "QUARANTINED" : "CLEAN",
    findings: combined.slice(0, 50),
  });

  return {
    report,
    rawFindings: deduplicate(rawFindings),
    visibleFindings: deduplicate(visibleFindings),
  };
}
