export type DigitalAssetType =
  | "wallpaper_pack"
  | "icon_pack"
  | "social_template_pack"
  | "texture_pack"
  | "ui_kit";

export type AssetPackStatus = "planned" | "producing" | "ready_for_upload" | "published";

export interface AssetPackBrief {
  niche: string;
  assetType: DigitalAssetType;
  style: string;
  audience: string;
  marketplace: "gumroad";
  packSize: number;
}

export interface AssetPackRecord {
  id: string;
  businessId: string;
  marketplace: "gumroad";
  niche: string;
  assetType: DigitalAssetType;
  style: string;
  audience: string;
  title: string;
  shortDescription: string;
  description: string;
  packSize: number;
  suggestedPrice: number;
  priceVariants: number[];
  tags: string[];
  deliverables: string[];
  promptSeeds: string[];
  productionChecklist: string[];
  listingChecklist: string[];
  outputDir: string;
  status: AssetPackStatus;
  createdAt: string;
  updatedAt: string;
}
