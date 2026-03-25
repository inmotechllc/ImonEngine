export type PodProductType =
  | "t_shirt"
  | "puzzle"
  | "canvas"
  | "poster"
  | "shorts"
  | "clock"
  | "tapestry"
  | "round_rug"
  | "mouse_pad"
  | "bag"
  | "phone_case"
  | "hoodie"
  | "sticker";

export type PodPostKind = "carousel" | "story" | "reel";

export type PodPostPlatform = "instagram_account" | "pinterest" | "facebook_page" | "shopify_store";

export type PodLaunchStatus = "planned" | "blocked" | "ready";

export interface PodStyleDossier {
  referenceDirectory: string;
  importedReferenceDirectory: string;
  fileCount: number;
  sampleFiles: string[];
  motifs: string[];
  signals: string[];
  commercialNotes: string[];
}

export interface PodDesignBrief {
  id: string;
  businessId: string;
  title: string;
  concept: string;
  prompt: string;
  styleNotes: string[];
  sampleReferenceFiles: string[];
  cadence: "starter" | "weekly";
}

export interface PodProductTemplate {
  type: PodProductType;
  label: string;
  merchandisingAngle: string;
}

export interface PodScheduledProduct {
  id: string;
  businessId: string;
  designId: string;
  designTitle: string;
  productType: PodProductType;
  productLabel: string;
  scheduledFor: string;
  dayPart: "morning" | "midday" | "evening";
  channel: "shopify_store";
  shopifyHandle: string;
  notes: string[];
}

export interface PodScheduledPost {
  id: string;
  businessId: string;
  designId: string;
  designTitle: string;
  productType?: PodProductType;
  productLabel?: string;
  scheduledFor: string;
  platform: PodPostPlatform;
  kind: PodPostKind;
  assetDirection: string;
  notes: string[];
}

export interface PodRoadblock {
  id: string;
  category: string;
  summary: string;
  requiredFromOwner: string[];
  continueAfterCompletion: string[];
}

export interface PodAutomationPlan {
  businessId: string;
  businessName: string;
  aliasEmail: string;
  status: PodLaunchStatus;
  generatedAt: string;
  launchWindow: {
    startsAt: string;
    endsAt: string;
    timezone: string;
    reason: string;
  };
  cadence: {
    starterDesignCount: number;
    weeklyNewDesigns: number;
    socialFeedPostsPerWeek: number;
    storiesOrReelsPerWeek: number;
    dailyProductAdds: number;
  };
  salesChannels: string[];
  socialChannels: string[];
  productTemplates: PodProductTemplate[];
  styleDossier: PodStyleDossier;
  starterDesigns: PodDesignBrief[];
  productSchedule: PodScheduledProduct[];
  socialSchedule: PodScheduledPost[];
  roadblocks: PodRoadblock[];
  nextAutomationSteps: string[];
}

