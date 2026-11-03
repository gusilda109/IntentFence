import { z } from "zod";

// Keep the same validation as Zod's UUID/date-time formats without emitting
// format + pattern together: some OpenAI-compatible xgrammar providers reject it.
const UUID_PATTERN = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
const ISO_DATE_TIME_PATTERN = /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|([+-](?:[01]\d|2[0-3]):[0-5]\d)))$/;

export const IdSchema = z.string().regex(UUID_PATTERN);
export const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const IsoDateTimeSchema = z.string().regex(ISO_DATE_TIME_PATTERN);
export const TextSchema = (max: number) => z.string().trim().min(1).max(max);
const UrlSchema = z.string().max(2_048).refine((value) => URL.canParse(value), "Invalid URL");
const HttpsUrlSchema = UrlSchema.refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}, "Invalid HTTPS URL");

export const MoneySchema = z.object({
  currency: z.literal("USD"),
  amountMinor: z.number().int().nonnegative().max(10_000_000),
}).strict();

export const MandateConstraintSchema = z.object({
  id: TextSchema(100),
  text: TextSchema(500),
  enforcement: z.enum(["hard", "soft"]),
}).strict();

export const MandateSchema = z.object({
  schemaVersion: z.literal("1"),
  id: IdSchema,
  goal: TextSchema(2_000),
  budget: MoneySchema,
  constraints: z.array(MandateConstraintSchema).max(20),
  createdAt: IsoDateTimeSchema,
}).strict();

export const EvidenceClaimSchema = z.object({
  kind: z.enum(["necessity", "compatibility", "incompatibility", "price", "feature", "risk"]),
  text: TextSchema(1_000),
}).strict();

export const EvidenceSourceSchema = z.object({
  storeId: TextSchema(100),
  publisherId: TextSchema(100),
  url: UrlSchema,
  sourceClass: z.enum(["seller", "aggregator", "manufacturer", "independent_reference", "user"]),
}).strict();

export const EvidenceSchema = z.object({
  schemaVersion: z.literal("1"),
  id: IdSchema,
  captureId: TextSchema(100),
  itemId: IdSchema.optional(),
  source: EvidenceSourceSchema,
  locator: TextSchema(500),
  excerpt: TextSchema(4_000),
  claims: z.array(EvidenceClaimSchema).min(1).max(20),
  contentHash: HashSchema,
  retrievedAt: IsoDateTimeSchema,
}).strict();

export const CompatibilityClaimSchema = z.object({
  withItemId: IdSchema.nullable(),
  requirement: TextSchema(1_000),
  evidenceIds: z.array(IdSchema).min(1).max(20),
}).strict();

export const ProposedOrderItemSchema = z.object({
  id: IdSchema,
  storeId: TextSchema(100),
  productUrl: UrlSchema,
  imageUrl: HttpsUrlSchema.optional(),
  name: TextSchema(120),
  description: TextSchema(1_000),
  quantity: z.number().int().min(1).max(20),
  unitPrice: MoneySchema,
  purpose: TextSchema(1_000),
  necessityEvidenceIds: z.array(IdSchema).min(1).max(20),
  compatibility: z.array(CompatibilityClaimSchema).max(20),
}).strict();

export const ProposedOrderSchema = z.object({
  schemaVersion: z.literal("1"),
  id: IdSchema,
  mandateId: IdSchema,
  items: z.array(ProposedOrderItemSchema).min(1).max(20),
  evidenceIds: z.array(IdSchema).min(1).max(100),
  total: MoneySchema,
  assumptions: z.array(TextSchema(500)).max(20),
  createdAt: IsoDateTimeSchema,
}).strict();

export const PolicyFindingSchema = z.object({
  code: z.enum([
    "BUDGET_EXCEEDED",
    "MANDATE_CONFLICT",
    "INSUFFICIENT_NECESSITY",
    "SELLER_ONLY_NECESSITY",
    "INSUFFICIENT_COMPATIBILITY",
    "INCOMPATIBLE",
    "PROMPT_INJECTION",
    "UNTRUSTED_EVIDENCE",
    "INVALID_ARITHMETIC",
    "UNMET_DEPENDENCY",
    "OTHER",
  ]),
  severity: z.enum(["info", "warning", "critical"]),
  message: TextSchema(1_000),
  itemId: IdSchema.optional(),
  evidenceIds: z.array(IdSchema).max(20),
}).strict();

export const ItemDecisionSchema = z.object({
  itemId: IdSchema,
  decision: z.enum(["ALLOW", "BLOCK", "REVIEW"]),
  reasons: z.array(PolicyFindingSchema).max(20),
}).strict();

export const VerdictSchema = z.object({
  schemaVersion: z.literal("1"),
  id: IdSchema,
  mandateId: IdSchema,
  proposedOrderId: IdSchema,
  decision: z.enum(["ALLOW", "BLOCK", "REVIEW", "PARTIAL_ALLOW"]),
  itemDecisions: z.array(ItemDecisionSchema).min(1).max(20),
  findings: z.array(PolicyFindingSchema).max(50),
  summary: TextSchema(2_000),
  policyVersion: TextSchema(100),
  inputHash: HashSchema,
  evaluatedAt: IsoDateTimeSchema,
}).strict();

export const ApprovedOrderItemSchema = z.object({
  sourceItemId: IdSchema,
  storeId: TextSchema(100),
  productUrl: UrlSchema,
  name: TextSchema(120),
  quantity: z.number().int().min(1).max(20),
  unitPrice: MoneySchema,
}).strict();

export const ApprovedOrderSchema = z.object({
  schemaVersion: z.literal("1"),
  id: IdSchema,
  mandateId: IdSchema,
  proposedOrderId: IdSchema,
  verdictId: IdSchema,
  verdictDecision: z.enum(["ALLOW", "PARTIAL_ALLOW"]),
  items: z.array(ApprovedOrderItemSchema).min(1).max(20),
  total: MoneySchema,
  approvalHash: HashSchema,
  idempotencyKey: IdSchema,
  createdAt: IsoDateTimeSchema,
}).strict();

export const RunStatusSchema = z.enum([
  "ACTOR_RUNNING",
  "PROPOSED",
  "SUPERVISOR_RUNNING",
  "BLOCKED",
  "REVIEW_REQUIRED",
  "APPROVED",
  "PAYMENT_PENDING",
  "PAYPAL_CREATED",
  "PAYMENT_RETRYABLE",
  "PAYMENT_UNKNOWN",
]);

export const SecurityFindingSchema = z.object({
  code: TextSchema(100),
  message: TextSchema(1_000),
}).strict();

export const SecurityReportSchema = z.object({
  captureId: TextSchema(100),
  status: z.enum(["CLEAN", "QUARANTINED"]),
  findings: z.array(SecurityFindingSchema).max(50),
}).strict();

export const EvidenceRecordSchema = z.object({
  evidence: EvidenceSchema,
  security: SecurityReportSchema,
}).strict();

export const PaymentExecutionViewSchema = z.object({
  status: z.enum(["PAYMENT_PENDING", "PAYPAL_CREATED", "PAYMENT_RETRYABLE", "PAYMENT_UNKNOWN"]),
  paypalOrderId: TextSchema(200).optional(),
  paypalStatus: TextSchema(100).optional(),
  approveUrl: UrlSchema.optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  errorCode: TextSchema(100).optional(),
}).strict();

export const CatalogSourceSchema = z.enum(["fixtures", "channel3"]);
export type CatalogSource = z.infer<typeof CatalogSourceSchema>;

export const RunViewSchema = z.object({
  id: IdSchema,
  status: RunStatusSchema,
  mandate: MandateSchema,
  catalogSource: CatalogSourceSchema,
  proposedOrder: ProposedOrderSchema.nullable(),
  evidence: z.array(EvidenceRecordSchema),
  verdict: VerdictSchema.nullable(),
  approvedOrder: ApprovedOrderSchema.nullable(),
  payment: PaymentExecutionViewSchema.nullable(),
  replay: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).strict();

export const CreateRunInputSchema = z.object({
  goal: TextSchema(2_000),
  budget: z.number().int().positive().max(10_000_000),
  constraints: z.array(z.object({
    text: TextSchema(500),
    enforcement: z.enum(["hard", "soft"]),
  }).strict()).max(20),
  catalogSource: CatalogSourceSchema.default("fixtures"),
}).strict();

export type Money = z.infer<typeof MoneySchema>;
export type MandateConstraint = z.infer<typeof MandateConstraintSchema>;
export type Mandate = z.infer<typeof MandateSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;
export type SecurityReport = z.infer<typeof SecurityReportSchema>;
export type ProposedOrderItem = z.infer<typeof ProposedOrderItemSchema>;
export type ProposedOrder = z.infer<typeof ProposedOrderSchema>;
export type PolicyFinding = z.infer<typeof PolicyFindingSchema>;
export type ItemDecision = z.infer<typeof ItemDecisionSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type ApprovedOrderItem = z.infer<typeof ApprovedOrderItemSchema>;
export type ApprovedOrder = z.infer<typeof ApprovedOrderSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type PaymentExecutionView = z.infer<typeof PaymentExecutionViewSchema>;
export type RunView = z.infer<typeof RunViewSchema>;
export type CreateRunInput = z.infer<typeof CreateRunInputSchema>;
