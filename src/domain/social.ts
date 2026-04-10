export type SocialPlatform =
  | "facebook_page"
  | "meta_business"
  | "youtube_channel"
  | "instagram_account"
  | "x"
  | "pinterest"
  | "gumroad"
  | "gmail_alias";

export type SocialProfileStatus = "live" | "planned" | "blocked";

export type SocialProfileRole = "umbrella_brand" | "niche_lane" | "distribution" | "marketplace";

export interface SocialProfileRecord {
  id: string;
  businessId: string;
  brandName: string;
  emailAlias: string;
  platform: SocialPlatform;
  role?: SocialProfileRole;
  laneId?: string;
  laneName?: string;
  parentProfileId?: string;
  handle?: string;
  profileUrl?: string;
  externalId?: string;
  status: SocialProfileStatus;
  blocker?: string;
  notes: string[];
  createdAt: string;
  updatedAt: string;
}
