import path from "node:path";
import type { AppConfig } from "../config.js";
import type { AssetPackBrief, AssetPackRecord, DigitalAssetType } from "../domain/digital-assets.js";
import { writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { AIClient, AssetPackBlueprintSchema } from "../openai/client.js";
import { assetPackPrompt } from "../openai/prompts.js";
import { FileStore } from "../storage/store.js";

const STARTER_BRIEFS: AssetPackBrief[] = [
  {
    niche: "Minimal productivity desktop backgrounds",
    assetType: "wallpaper_pack",
    style: "clean gradients with subtle depth",
    audience: "remote workers and productivity enthusiasts",
    marketplace: "gumroad",
    packSize: 24
  },
  {
    niche: "Neutral Instagram carousel templates for small creators",
    assetType: "social_template_pack",
    style: "editorial beige and monochrome layouts",
    audience: "solo creators and consultants",
    marketplace: "gumroad",
    packSize: 30
  },
  {
    niche: "Soft glassmorphism icon set for indie builders",
    assetType: "icon_pack",
    style: "soft translucent surfaces with muted accents",
    audience: "indie hackers and app designers",
    marketplace: "gumroad",
    packSize: 80
  }
];

function nowIso(): string {
  return new Date().toISOString();
}

function defaultDeliverables(assetType: DigitalAssetType, packSize: number): string[] {
  switch (assetType) {
    case "wallpaper_pack":
      return [
        `${packSize} wallpaper variants in 4K`,
        "Preview contact sheet",
        "Commercial-use license summary"
      ];
    case "social_template_pack":
      return [
        `${packSize} editable post or carousel templates`,
        "Cover image set for Gumroad listing",
        "Quick-start usage guide"
      ];
    case "icon_pack":
      return [
        `${packSize} icons in SVG and PNG`,
        "Preview board image",
        "License and usage notes"
      ];
    case "texture_pack":
      return [
        `${packSize} seamless textures`,
        "Preview sheet",
        "Usage notes"
      ];
    case "ui_kit":
      return [
        `${packSize} screens or components`,
        "Preview deck",
        "Setup notes"
      ];
  }
}

function fallbackBlueprint(brief: AssetPackBrief) {
  const normalizedStyle = brief.style.replace(/\s+/g, " ").trim();
  const capitalizedStyle =
    normalizedStyle.length > 0
      ? normalizedStyle.charAt(0).toUpperCase() + normalizedStyle.slice(1)
      : "Curated";
  const baseTitle = `${capitalizedStyle} ${brief.niche}`;
  return {
    title: baseTitle.trim(),
    shortDescription: `A ${brief.packSize}-piece ${brief.assetType.replaceAll("_", " ")} bundle for ${brief.audience}.`,
    description: `A focused ${brief.marketplace} pack built around ${brief.niche.toLowerCase()}, styled with ${brief.style}, and designed for ${brief.audience}.`,
    suggestedPrice: brief.assetType === "icon_pack" ? 19 : 12,
    priceVariants: brief.assetType === "icon_pack" ? [15, 19, 24] : [9, 12, 15],
    tags: [
      brief.marketplace,
      brief.assetType.replaceAll("_", " "),
      brief.niche.split(" ")[0]?.toLowerCase() ?? "assets",
      brief.audience.split(" ")[0]?.toLowerCase() ?? "creators",
      "digital download",
      "ai assets"
    ],
    deliverables: defaultDeliverables(brief.assetType, brief.packSize),
    promptSeeds: [
      `Create a ${brief.style} ${brief.assetType.replaceAll("_", " ")} aligned to ${brief.niche.toLowerCase()}.`,
      `Generate a cohesive variation set for ${brief.audience} with strong product-preview contrast.`,
      `Produce a cover image for a Gumroad listing featuring ${brief.niche.toLowerCase()}.`,
      `Create one alternate pricing-test thumbnail for the same pack.`
    ],
    productionChecklist: [
      "Generate the full asset batch and remove weak outputs.",
      "Export deliverables into a clean folder structure.",
      "Create at least two Gumroad cover images.",
      "Zip the pack and confirm filenames are consistent."
    ],
    listingChecklist: [
      "Upload the zip file to Gumroad.",
      "Add the short description and full description.",
      "Set the first price point and save the alternate test prices in notes.",
      "Publish and record the product URL in the ledger."
    ]
  };
}

export class DigitalAssetFactoryAgent {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore,
    private readonly ai: AIClient
  ) {}

  async seedStarterQueue(): Promise<AssetPackRecord[]> {
    const existing = await this.store.getAssetPacks();
    const existingByBrief = new Set(existing.map((pack) => `${pack.marketplace}:${pack.niche}`));
    const created: AssetPackRecord[] = [];

    for (const brief of STARTER_BRIEFS) {
      const key = `${brief.marketplace}:${brief.niche}`;
      if (existingByBrief.has(key)) {
        continue;
      }

      created.push(await this.createPack(brief));
    }

    return created;
  }

  async createPack(brief: AssetPackBrief): Promise<AssetPackRecord> {
    const generated = await this.ai.generateJson({
      schema: AssetPackBlueprintSchema,
      prompt: assetPackPrompt(brief),
      mode: "fast",
      fallback: () => fallbackBlueprint(brief)
    });

    const createdAt = nowIso();
    const id = slugify(`${brief.marketplace}-${generated.data.title}`);
    const outputDir = path.join(this.config.assetStoreDir, id);
    const pack: AssetPackRecord = {
      id,
      businessId: "imon-digital-asset-store",
      marketplace: brief.marketplace,
      niche: brief.niche,
      assetType: brief.assetType,
      style: brief.style,
      audience: brief.audience,
      title: generated.data.title,
      shortDescription: generated.data.shortDescription,
      description: generated.data.description,
      packSize: brief.packSize,
      suggestedPrice: generated.data.suggestedPrice,
      priceVariants: generated.data.priceVariants,
      tags: generated.data.tags,
      deliverables: generated.data.deliverables,
      promptSeeds: generated.data.promptSeeds,
      productionChecklist: generated.data.productionChecklist,
      listingChecklist: generated.data.listingChecklist,
      outputDir,
      status: "planned",
      createdAt,
      updatedAt: createdAt
    };

    await this.store.saveAssetPack(pack);
    await this.writePackArtifacts(pack);
    return pack;
  }

  async refreshArtifacts(): Promise<AssetPackRecord[]> {
    const packs = await this.store.getAssetPacks();
    for (const pack of packs) {
      await this.writePackArtifacts(pack);
    }
    return packs;
  }

  private async writePackArtifacts(pack: AssetPackRecord): Promise<void> {
    await writeJsonFile(path.join(pack.outputDir, "manifest.json"), pack);
    await writeTextFile(
      path.join(pack.outputDir, "listing.md"),
      [
        `# ${pack.title}`,
        "",
        `Marketplace: ${pack.marketplace}`,
        `Status: ${pack.status}`,
        `Suggested price: $${pack.suggestedPrice}`,
        `Price test points: ${pack.priceVariants.map((value) => `$${value}`).join(", ")}`,
        "",
        "## Summary",
        pack.shortDescription,
        "",
        "## Description",
        pack.description,
        "",
        "## Deliverables",
        ...pack.deliverables.map((item) => `- ${item}`),
        "",
        "## Tags",
        pack.tags.map((tag) => `\`${tag}\``).join(", "),
        "",
        "## Prompt Seeds",
        ...pack.promptSeeds.map((item) => `- ${item}`),
        "",
        "## Production Checklist",
        ...pack.productionChecklist.map((item) => `- ${item}`),
        "",
        "## Listing Checklist",
        ...pack.listingChecklist.map((item) => `- ${item}`)
      ].join("\n")
    );
  }
}
