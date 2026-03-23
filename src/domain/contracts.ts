export type LeadStage =
  | "prospecting"
  | "qualified"
  | "drafted"
  | "contacted"
  | "responded"
  | "won"
  | "lost"
  | "discarded";

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

export interface LeadRecord {
  id: string;
  businessName: string;
  niche: string;
  geo: string;
  source: string;
  contact: LeadContact;
  websiteQualitySignals: WebsiteQualitySignals;
  score: number;
  scoreReasons: string[];
  stage: LeadStage;
  tags: string[];
  lastTouchAt?: string;
  createdAt: string;
  updatedAt: string;
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
}

export interface DeploymentTarget {
  platform: "local-preview" | "cloudflare-pages" | "manual";
  previewPath?: string;
  productionUrl?: string;
}

export interface ClientJob {
  id: string;
  leadId?: string;
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

export interface ApprovalTask {
  id: string;
  type: ApprovalType;
  actionNeeded: string;
  reason: string;
  ownerInstructions: string;
  notifyChannel: "email";
  relatedEntityType: "lead" | "client" | "account" | "workflow";
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
  createdAt: string;
  updatedAt: string;
}

export interface ReviewResponseDraft {
  review: string;
  response: string;
}

export interface RetentionReport {
  clientId: string;
  createdAt: string;
  reviewResponses: ReviewResponseDraft[];
  updateSuggestions: string[];
  upsellCandidate: string;
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

export interface AgencyProfile {
  name: string;
  headline: string;
  supportingCopy: string;
  pricing: Array<{ label: string; amount: string; details: string }>;
  differentiators: string[];
  proofPoints: string[];
}
