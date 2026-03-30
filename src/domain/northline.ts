import type { OfferConfig } from "./contracts.js";

export type NorthlinePlanStatus = "blocked" | "ready";

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

export interface NorthlineAutomationPlan {
  businessId: string;
  businessName: string;
  generatedAt: string;
  status: NorthlinePlanStatus;
  primaryServiceArea?: string;
  salesEmail: string;
  siteUrl: string;
  offerStack: OfferConfig[];
  readiness: NorthlineReadinessItem[];
  outboundSprint: NorthlineSprintTask[];
  socialPlan: NorthlineSocialPost[];
  proofAssets: NorthlineProofAsset[];
  roadblocks: NorthlineRoadblock[];
  nextAutomationSteps: string[];
}
