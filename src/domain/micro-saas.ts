import type { SocialPlatform, SocialProfileStatus, SocialProfileRole } from "./social.js";

export type MicroSaasPlanStatus = "planned" | "blocked" | "ready";

export type MicroSaasProductStage = "primary_mvp" | "backup_mvp" | "future_candidate";

export type MicroSaasBillingCadence = "beta" | "monthly" | "annual" | "one_time";

export type MicroSaasLaunchDayPart = "morning" | "midday" | "evening";

export type MicroSaasSocialFormat = "carousel" | "thread" | "static_post" | "reel";

export type MicroSaasAdChannel = "meta_ads";

export interface MicroSaasPricingOption {
  label: string;
  amount: string;
  cadence: MicroSaasBillingCadence;
  notes: string[];
}

export interface MicroSaasProductBrief {
  id: string;
  businessId: string;
  laneId: string;
  laneName: string;
  productName: string;
  suggestedSlug: string;
  stage: MicroSaasProductStage;
  audience: string;
  problem: string;
  promise: string;
  pricing: MicroSaasPricingOption[];
  differentiators: string[];
  mvpFeatures: string[];
  launchAssets: string[];
  telemetryEvents: string[];
  successMetrics: string[];
  implementationAssets: string[];
}

export interface MicroSaasLaunchTask {
  id: string;
  businessId: string;
  productId: string;
  scheduledFor: string;
  dayPart: MicroSaasLaunchDayPart;
  department: string;
  workflowId: string;
  title: string;
  output: string;
  dependencies: string[];
  notes: string[];
}

export interface MicroSaasChannelSetup {
  profileId: string;
  businessId: string;
  platform: SocialPlatform;
  status: SocialProfileStatus;
  role?: SocialProfileRole;
  laneId?: string;
  laneName?: string;
  handleOrAlias: string;
  purpose: string;
  blocker?: string;
  nextSteps: string[];
}

export interface MicroSaasSocialPost {
  id: string;
  businessId: string;
  productId: string;
  profileId: string;
  laneId?: string;
  platform: Extract<SocialPlatform, "facebook_page" | "instagram_account" | "x">;
  scheduledFor: string;
  dayPart: MicroSaasLaunchDayPart;
  format: MicroSaasSocialFormat;
  hook: string;
  cta: string;
  notes: string[];
}

export interface MicroSaasAdExperiment {
  id: string;
  businessId: string;
  channel: MicroSaasAdChannel;
  status: "planned" | "blocked" | "ready";
  productId: string;
  objective: string;
  audience: string;
  offer: string;
  assetNeeds: string[];
  launchCriteria: string[];
  blocker?: string;
}

export interface MicroSaasIncomeCapability {
  id: string;
  area: string;
  status: "live" | "planned" | "blocked";
  summary: string;
  evidence: string[];
  nextSteps: string[];
}

export interface MicroSaasRoadblock {
  id: string;
  category: string;
  summary: string;
  requiredFromOwner: string[];
  continueAfterCompletion: string[];
}

export interface MicroSaasAutomationPlan {
  businessId: string;
  businessName: string;
  aliasEmail: string;
  status: MicroSaasPlanStatus;
  generatedAt: string;
  launchWindow: {
    startsAt: string;
    endsAt: string;
    timezone: string;
    reason: string;
  };
  cadence: {
    weeklyBuilds: number;
    weeklyLaunchPosts: number;
    weeklyExperimentReviews: number;
    dailySupportChecks: number;
  };
  primaryProductId: string;
  productBacklog: MicroSaasProductBrief[];
  launchCalendar: MicroSaasLaunchTask[];
  socialPresence: MicroSaasChannelSetup[];
  socialSchedule: MicroSaasSocialPost[];
  paidGrowthPlan: MicroSaasAdExperiment[];
  incomeStack: MicroSaasIncomeCapability[];
  roadblocks: MicroSaasRoadblock[];
  nextAutomationSteps: string[];
}
