export type LeadStage =
  | "prospecting"
  | "qualified"
  | "drafted"
  | "contacted"
  | "responded"
  | "won"
  | "lost"
  | "discarded";

export type LeadPipeline = "agency_client_acquisition" | "client_demand_generation";

const LEAD_PIPELINE_VALUES: LeadPipeline[] = [
  "agency_client_acquisition",
  "client_demand_generation"
];

type LeadPipelineLike = {
  pipeline?: string;
};

export function isLeadPipeline(value: string | undefined): value is LeadPipeline {
  return value !== undefined && LEAD_PIPELINE_VALUES.includes(value as LeadPipeline);
}

export function resolveLeadPipeline(lead: LeadPipelineLike): LeadPipeline {
  return isLeadPipeline(lead.pipeline) ? lead.pipeline : "agency_client_acquisition";
}

export function isAgencyClientAcquisitionLead(lead: LeadPipelineLike): boolean {
  return resolveLeadPipeline(lead) === "agency_client_acquisition";
}

export const LEAD_PROSPECTING_SCORE_MIN = 40;
export const LEAD_QUALIFIED_SCORE_MIN = 65;

export function stageFromLeadScore(score: number): LeadStage {
  if (score >= LEAD_QUALIFIED_SCORE_MIN) {
    return "qualified";
  }
  if (score >= LEAD_PROSPECTING_SCORE_MIN) {
    return "prospecting";
  }
  return "discarded";
}

export function leadReadyForAutomatedOutreach(
  lead: Pick<LeadRecord, "contact" | "score" | "stage">
): boolean {
  if (!lead.contact.email) {
    return false;
  }

  return lead.stage === "qualified" || stageFromLeadScore(lead.score) === "qualified";
}

export type BillingStatus =
  | "proposal"
  | "deposit_pending"
  | "paid"
  | "retainer_active"
  | "paused";

export type SiteStatus =
  | "not_started"
  | "in_progress"
  | "qa_failed"
  | "ready"
  | "deployed";

export type QaStatus = "pending" | "passed" | "failed";

export type ApprovalType =
  | "kyc"
  | "domain"
  | "marketplace"
  | "client_access"
  | "payment"
  | "compliance"
  | "email"
  | "manual";

export type ApprovalStatus = "open" | "waiting" | "completed";

export type OutreachSendChannel = "gmail_cdp" | "smtp";

export type OutreachSendStatus = "sent" | "failed";

export type LeadReplyDisposition = "positive" | "objection" | "neutral" | "unsubscribe";

export type LeadReplyRoute = "none" | "booked_call" | "intake_follow_up" | "do_not_contact";

export interface WebsiteQualitySignals {
  hasWebsite: boolean;
  hasHttps: boolean;
  mobileFriendly: boolean;
  clearOffer: boolean;
  callsToAction: boolean;
  pageSpeedBucket: "unknown" | "slow" | "average" | "fast";
  notes: string[];
}

export interface LeadContact {
  ownerName?: string;
  email?: string;
  phone?: string;
  website?: string;
}

export interface LeadTargetContext {
  market?: string;
  trade?: string;
  collectionArea?: string;
  sourceType?: string;
  targetIndustries: string[];
  targetServices: string[];
  offerSummary?: string;
  matchReasons: string[];
}

export interface LeadRecord {
  id: string;
  businessId?: string;
  pipeline?: LeadPipeline;
  businessName: string;
  niche: string;
  geo: string;
  source: string;
  contact: LeadContact;
  websiteQualitySignals: WebsiteQualitySignals;
  targetContext?: LeadTargetContext;
  score: number;
  scoreReasons: string[];
  stage: LeadStage;
  tags: string[];
  lastTouchAt?: string;
  createdAt: string;
  updatedAt: string;
}

export function normalizeLeadRecord(lead: LeadRecord): LeadRecord {
  return {
    ...lead,
    pipeline: resolveLeadPipeline(lead)
  };
}

export interface OfferConfig {
  id: string;
  name: string;
  audience: string;
  setupPrice: number;
  monthlyPrice: number;
  includedDeliverables: string[];
  upsells: string[];
  priceFloor: number;
  slaHours: number;
  active: boolean;
}

export interface ClientAssets {
  logoText?: string;
  brandColors?: string[];
  heroImageHint?: string;
  services?: string[];
  testimonials?: string[];
  reviews?: string[];
  proofBundle?: ProofBundle;
  handoffPackage?: HandoffPackage;
}

export interface DeploymentTarget {
  platform: "local-preview" | "cloudflare-pages" | "manual";
  previewPath?: string;
  productionUrl?: string;
}

export type ClientProvenance =
  | "legacy_unverified"
  | "external_inbound"
  | "external_outbound"
  | "internal_validation"
  | "internal_manual";

const CLIENT_PROVENANCE_VALUES: ClientProvenance[] = [
  "legacy_unverified",
  "external_inbound",
  "external_outbound",
  "internal_validation",
  "internal_manual"
];

function isClientProvenance(value: string | undefined): value is ClientProvenance {
  return value !== undefined && CLIENT_PROVENANCE_VALUES.includes(value as ClientProvenance);
}

export function clientProofEligibilityForProvenance(provenance: ClientProvenance): boolean {
  return provenance === "external_inbound" || provenance === "external_outbound";
}

export interface ClientJob {
  id: string;
  businessId?: string;
  leadId?: string;
  sourceSubmissionId?: string;
  provenance?: ClientProvenance;
  proofEligible?: boolean;
  clientName: string;
  niche: string;
  geo: string;
  primaryPhone: string;
  primaryEmail: string;
  offerId: string;
  siteStatus: SiteStatus;
  qaStatus: QaStatus;
  billingStatus: BillingStatus;
  formEndpoint?: string;
  deployment: DeploymentTarget;
  assets: ClientAssets;
  intakeNotes: string[];
  nextAction: string;
  createdAt: string;
  updatedAt: string;
}

export function resolveClientProvenance(
  client: Pick<ClientJob, "sourceSubmissionId" | "geo" | "intakeNotes" | "provenance">
): ClientProvenance {
  if (isClientProvenance(client.provenance)) {
    return client.provenance;
  }

  const loweredSubmissionId = client.sourceSubmissionId?.toLowerCase();
  const loweredGeo = client.geo.toLowerCase();
  const loweredNotes = client.intakeNotes.map((note) => note.toLowerCase());
  if (
    loweredSubmissionId?.includes("northline-validation") ||
    loweredNotes.some((note) => note.includes("source: northline-validation-page")) ||
    loweredNotes.some((note) => note.includes("current website:") && note.includes("/validation.html")) ||
    (loweredGeo.includes("northline") && loweredGeo.includes("validation"))
  ) {
    return "internal_validation";
  }

  return "legacy_unverified";
}

export function resolveClientProofEligible(
  client: Pick<
    ClientJob,
    "sourceSubmissionId" | "geo" | "intakeNotes" | "provenance" | "proofEligible"
  >
): boolean {
  const provenance = resolveClientProvenance(client);
  if (!clientProofEligibilityForProvenance(provenance)) {
    return false;
  }

  return client.proofEligible ?? true;
}

export function isInternalValidationClient(
  client: Pick<ClientJob, "sourceSubmissionId" | "geo" | "intakeNotes" | "provenance">
): boolean {
  return resolveClientProvenance(client) === "internal_validation";
}

export function clientCountsTowardExternalRevenue(
  client: Pick<ClientJob, "sourceSubmissionId" | "geo" | "intakeNotes" | "provenance">
): boolean {
  const provenance = resolveClientProvenance(client);
  return provenance === "external_inbound" || provenance === "external_outbound";
}

export function normalizeClientJob(client: ClientJob): ClientJob {
  const provenance = resolveClientProvenance(client);
  return {
    ...client,
    provenance,
    proofEligible: resolveClientProofEligible(client)
  };
}

export interface ApprovalTask {
  id: string;
  type: ApprovalType;
  actionNeeded: string;
  reason: string;
  ownerInstructions: string;
  notifyChannel: "email";
  relatedEntityType: "lead" | "client" | "account" | "workflow" | "business" | "engine";
  relatedEntityId: string;
  deadlineAt?: string;
  status: ApprovalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface OutreachDraft {
  id: string;
  leadId: string;
  subject: string;
  body: string;
  followUps: string[];
  complianceNotes: string[];
  approved: boolean;
  sendReceipts?: OutreachSendReceipt[];
  createdAt: string;
  updatedAt: string;
}

export interface OutreachSendReceipt {
  status: OutreachSendStatus;
  channel: OutreachSendChannel;
  recipient: string;
  attemptedAt: string;
  sentAt?: string;
  error?: string;
}

export interface LeadReplyClassification {
  disposition: LeadReplyDisposition;
  recommendedStage: LeadStage;
  nextAction: string;
  approvalRequired: boolean;
  route: LeadReplyRoute;
}

export interface LeadReplyRecord {
  id: string;
  businessId?: string;
  leadId: string;
  source: "manual_file" | "gmail_cdp" | "imap";
  externalThreadId?: string;
  externalMessageId?: string;
  fromAddress?: string;
  subject: string;
  body: string;
  receivedAt: string;
  syncedAt: string;
  classification: LeadReplyClassification;
  processedAt: string;
}

export interface ReviewResponseDraft {
  review: string;
  response: string;
}

export interface RetentionUpgradeOffer {
  targetTierId: string;
  label: string;
  summary: string;
  nextStep: string;
  paymentLinkKey?: AgencyPricingTierPaymentLinkKey;
  paymentLink?: string;
  couponLabel?: string;
  terms?: string;
}

export interface RetentionReport {
  clientId: string;
  createdAt: string;
  reviewResponses: ReviewResponseDraft[];
  updateSuggestions: string[];
  upsellCandidate: string;
  upgradeOffer?: RetentionUpgradeOffer;
}

export interface ProofBundleScreenshot {
  id: string;
  label: string;
  path: string;
  viewport: "desktop" | "mobile";
}

export interface ProofBundleRequestDraft {
  subject: string;
  body: string;
  targetUrl?: string;
}

export interface ProofBundlePublication {
  headline: string;
  summary: string;
  bullets: string[];
  testimonialQuote?: string;
}

export interface ProofBundle {
  clientId: string;
  businessId?: string;
  createdAt: string;
  clientName: string;
  siteStatus: SiteStatus;
  qaStatus: QaStatus;
  previewPath?: string;
  reportPath: string;
  qaReportPath?: string;
  retentionReportPath?: string;
  screenshots: ProofBundleScreenshot[];
  testimonialRequest: ProofBundleRequestDraft;
  reviewRequest: ProofBundleRequestDraft;
  publication: ProofBundlePublication;
}

export interface HandoffPackage {
  clientId: string;
  businessId?: string;
  createdAt: string;
  clientName: string;
  previewPath?: string;
  reportPath: string;
  readmePath: string;
  qaReportPath?: string;
  retentionReportPath?: string;
  proofBundlePath?: string;
  summary: string;
  includedArtifacts: string[];
  clientChecklist: string[];
  developerChecklist: string[];
}

export interface RunReport {
  id: string;
  generatedAt: string;
  pipelineCounts: Record<LeadStage, number>;
  replies: number;
  bookedCalls: number;
  closes: number;
  mrr: number;
  blockedApprovals: number;
  notes: string[];
  upsellCandidates: string[];
}

export interface ProspectImportRecord {
  businessName: string;
  niche: string;
  city: string;
  state: string;
  pipeline?: LeadPipeline;
  ownerName?: string;
  email?: string;
  phone?: string;
  website?: string;
  hasWebsite?: string | boolean;
  hasHttps?: string | boolean;
  mobileFriendly?: string | boolean;
  clearOffer?: string | boolean;
  callsToAction?: string | boolean;
  pageSpeedBucket?: string;
  market?: string;
  trade?: string;
  collectionArea?: string;
  sourceType?: string;
  targetIndustries?: string;
  targetServices?: string;
  offerSummary?: string;
  matchReasons?: string;
  notes?: string;
  tags?: string;
}

export interface SiteBuildResult {
  clientId: string;
  previewDir: string;
  htmlPath: string;
  cssPath: string;
}

export interface QaCheck {
  label: string;
  passed: boolean;
  detail: string;
}

export interface QaReport {
  clientId: string;
  createdAt: string;
  checks: QaCheck[];
  passed: boolean;
}

export interface AgencyProofPoint {
  stat: string;
  label: string;
  detail: string;
}

export interface AgencyTrustSignal {
  label: string;
  title: string;
  body: string;
}

export interface AgencyProofArtifact {
  label: string;
  title: string;
  body: string;
  items: string[];
}

export type AgencyPricingTierPaymentLinkKey =
  | "lead_generation"
  | "founding"
  | "standard"
  | "growth_upgrade";

const AGENCY_PRICING_TIER_PAYMENT_LINK_KEYS: AgencyPricingTierPaymentLinkKey[] = [
  "lead_generation",
  "founding",
  "standard",
  "growth_upgrade"
];

export function isAgencyPricingTierPaymentLinkKey(
  value: string | undefined
): value is AgencyPricingTierPaymentLinkKey {
  return (
    value !== undefined &&
    AGENCY_PRICING_TIER_PAYMENT_LINK_KEYS.includes(value as AgencyPricingTierPaymentLinkKey)
  );
}

export interface AgencyPricingTierCta {
  label: string;
  mode: "review" | "checkout";
  href?: string;
}

export interface AgencyPricingTierUpgradeOffer {
  label: string;
  terms: string;
  paymentLinkKey?: AgencyPricingTierPaymentLinkKey;
}

export interface AgencyPricingTier {
  id: string;
  label: string;
  amount: string;
  details: string;
  idealFor: string;
  includes: string[];
  paymentLinkKey?: AgencyPricingTierPaymentLinkKey;
  cta?: AgencyPricingTierCta;
  upgradeOffer?: AgencyPricingTierUpgradeOffer;
}

export interface AgencyProfile {
  name: string;
  headline: string;
  supportingCopy: string;
  audience: string;
  heroNote: string;
  industries: string[];
  differentiators: string[];
  proofPoints: AgencyProofPoint[];
  trustSignals: AgencyTrustSignal[];
  proofArtifacts: AgencyProofArtifact[];
  serviceStack: Array<{
    title: string;
    description: string;
  }>;
  process: Array<{
    step: string;
    title: string;
    body: string;
  }>;
  pricing: AgencyPricingTier[];
  faqs: Array<{
    question: string;
    answer: string;
  }>;
  closingNote: string;
}
