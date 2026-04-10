import type { AgencyProfile, OfferConfig } from "./contracts.js";

export const DEFAULT_NORTHLINE_BUSINESS_ID = "auto-funding-agency";

export const NORTHLINE_NATIONWIDE_COLLECTION_AREA_ALIAS = "nationwide:us";

// One primary metro per state plus DC keeps nationwide collection broad without exploding the market set.
export const NORTHLINE_NATIONWIDE_US_COLLECTION_AREAS = [
  "Birmingham, AL",
  "Anchorage, AK",
  "Phoenix, AZ",
  "Little Rock, AR",
  "Los Angeles, CA",
  "Denver, CO",
  "Hartford, CT",
  "Wilmington, DE",
  "Washington, DC",
  "Jacksonville, FL",
  "Atlanta, GA",
  "Honolulu, HI",
  "Boise, ID",
  "Chicago, IL",
  "Indianapolis, IN",
  "Des Moines, IA",
  "Wichita, KS",
  "Louisville, KY",
  "New Orleans, LA",
  "Portland, ME",
  "Baltimore, MD",
  "Boston, MA",
  "Detroit, MI",
  "Minneapolis, MN",
  "Jackson, MS",
  "Kansas City, MO",
  "Billings, MT",
  "Omaha, NE",
  "Las Vegas, NV",
  "Manchester, NH",
  "Newark, NJ",
  "Albuquerque, NM",
  "New York, NY",
  "Charlotte, NC",
  "Fargo, ND",
  "Columbus, OH",
  "Oklahoma City, OK",
  "Portland, OR",
  "Philadelphia, PA",
  "Providence, RI",
  "Charleston, SC",
  "Sioux Falls, SD",
  "Nashville, TN",
  "Houston, TX",
  "Salt Lake City, UT",
  "Burlington, VT",
  "Virginia Beach, VA",
  "Seattle, WA",
  "Charleston, WV",
  "Milwaukee, WI",
  "Cheyenne, WY"
] as const;

export const SUPPORTED_NORTHLINE_TRADES = [
  "plumbing",
  "hvac",
  "electrical",
  "roofing",
  "cleaning"
] as const;

export type NorthlineTrade = (typeof SUPPORTED_NORTHLINE_TRADES)[number];

export interface NorthlineGrowthUpgradeConfig {
  paymentLink?: string;
  couponLabel?: string;
  terms?: string;
}

export interface NorthlineBusinessProfileConfig {
  primaryServiceArea?: string;
  collectionAreas?: string[];
  collectionTrades?: string[];
  targetIndustries?: string[];
  targetServices?: string[];
  offerSummary?: string;
  salesEmail?: string;
  siteUrl?: string;
  domain?: string;
  bookingUrl?: string;
  leadFormAction?: string;
  stripeLeadGeneration?: string;
  stripeFounding?: string;
  stripeStandard?: string;
  growthUpgrade?: NorthlineGrowthUpgradeConfig;
  stripeValidation?: string;
  agencyProfile?: Partial<AgencyProfile>;
}

export interface ResolvedNorthlineBusinessProfile {
  businessId: string;
  businessName: string;
  primaryServiceArea?: string;
  collectionAreas: string[];
  collectionTrades: NorthlineTrade[];
  targetIndustries: string[];
  targetServices: string[];
  offerSummary: string;
  salesEmail: string;
  siteUrl: string;
  domain?: string;
  bookingUrl?: string;
  leadFormAction?: string;
  stripeLeadGeneration?: string;
  stripeFounding?: string;
  stripeStandard?: string;
  growthUpgrade?: NorthlineGrowthUpgradeConfig;
  stripeValidation?: string;
  sourceDir: string;
  agencyProfile: AgencyProfile;
}

export type NorthlinePlanStatus = "blocked" | "ready";

export type NorthlineOperatingMode = "controlled_launch" | "autonomous";

export type NorthlinePromotionCriterionStatus = "met" | "missing";

export type NorthlineCapabilityStatus = "live" | "planned" | "blocked";

export type NorthlineDayPart = "morning" | "midday" | "evening";

export interface NorthlineReadinessItem {
  id: string;
  area: string;
  status: NorthlineCapabilityStatus;
  summary: string;
  evidence: string[];
  nextSteps: string[];
}

export interface NorthlineSprintTask {
  id: string;
  businessId: string;
  scheduledFor: string;
  dayPart: NorthlineDayPart;
  phase: "setup" | "research" | "sales" | "follow_up" | "conversion" | "proof";
  title: string;
  output: string;
  notes: string[];
}

export interface NorthlineSocialPost {
  id: string;
  businessId: string;
  platform: "facebook_page" | "instagram_account" | "linkedin";
  scheduledFor: string;
  dayPart: NorthlineDayPart;
  angle: string;
  cta: string;
  notes: string[];
}

export interface NorthlineProofAsset {
  id: string;
  area: string;
  status: "ready" | "missing";
  summary: string;
  evidence: string[];
  nextSteps: string[];
}

export interface NorthlineRoadblock {
  id: string;
  category: string;
  summary: string;
  requiredFromOwner: string[];
  continueAfterCompletion: string[];
}

export interface NorthlinePromotionCriterion {
  id: string;
  label: string;
  status: NorthlinePromotionCriterionStatus;
  summary: string;
  evidence: string[];
  nextSteps: string[];
}

export interface NorthlineOperatingModeState {
  current: NorthlineOperatingMode;
  summary: string;
  evidence: string[];
  scheduledAutomation: string[];
  manualCheckpoints: string[];
  promotionCriteria: NorthlinePromotionCriterion[];
}

export interface NorthlineAutomationPlan {
  businessId: string;
  businessName: string;
  generatedAt: string;
  status: NorthlinePlanStatus;
  primaryServiceArea?: string;
  collectionAreas: string[];
  collectionTrades: string[];
  targetIndustries: string[];
  targetServices: string[];
  offerSummary: string;
  salesEmail: string;
  siteUrl: string;
  offerStack: OfferConfig[];
  operatingMode: NorthlineOperatingModeState;
  readiness: NorthlineReadinessItem[];
  outboundSprint: NorthlineSprintTask[];
  socialPlan: NorthlineSocialPost[];
  proofAssets: NorthlineProofAsset[];
  roadblocks: NorthlineRoadblock[];
  nextAutomationSteps: string[];
}
