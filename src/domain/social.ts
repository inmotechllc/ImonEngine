export type SocialPlatform =
  | "facebook_page"
  | "meta_business"
  | "x"
  | "pinterest"
  | "gumroad"
  | "gmail_alias";

export type SocialProfileStatus = "live" | "planned" | "blocked";

export interface SocialProfileRecord {
  id: string;
  businessId: string;
  brandName: string;
  emailAlias: string;
  platform: SocialPlatform;
  handle?: string;
  profileUrl?: string;
  externalId?: string;
  status: SocialProfileStatus;
  blocker?: string;
  notes: string[];
  createdAt: string;
  updatedAt: string;
}
