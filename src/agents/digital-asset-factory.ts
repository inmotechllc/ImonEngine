import path from "node:path";
import type { AppConfig } from "../config.js";
import type { AssetPackBrief, AssetPackRecord, DigitalAssetType } from "../domain/digital-assets.js";
import { ensureDir, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { AIClient, AssetPackBlueprintSchema } from "../ai/client.js";
import { assetPackPrompt } from "../ai/prompts.js";
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
  },
  {
    niche: "Muted paper grain textures for brand designers",
    assetType: "texture_pack",
    style: "soft scanned paper and matte grain overlays",
    audience: "brand designers and digital creators",
    marketplace: "gumroad",
    packSize: 36
  },
  {
    niche: "Warm monochrome desktop backgrounds for creative studios",
    assetType: "wallpaper_pack",
    style: "warm gradients with soft shadow geometry",
    audience: "creative studios and indie marketers",
    marketplace: "gumroad",
    packSize: 18
  }
];

const REFINED_PACK_COPY: Record<
  string,
  {
    title: string;
    shortDescription: string;
    description: string;
  }
> = {
  "Minimal productivity desktop backgrounds": {
    title: "Minimal Productivity Desktop Background Pack",
    shortDescription: "A focused set of 24 clean 4K wallpapers built for productivity-minded desktops.",
    description: [
      "A 24-image wallpaper pack designed for clean workspaces, focus-heavy desktops, and low-distraction setups.",
      "The style stays minimal, modern, and easy to live with across monitors and laptop displays.",
      "Built for Gumroad as a fast-to-ship first product with clear visual value."
    ].join(" ")
  },
  "Neutral Instagram carousel templates for small creators": {
    title: "Neutral Instagram Carousel Template Pack",
    shortDescription:
      "A neutral carousel template pack for creators who want clean posts without custom design work.",
    description: [
      "A ready-to-use Instagram carousel template pack for creators, coaches, and solo businesses.",
      "The layouts use a restrained neutral palette so the pack feels premium instead of generic.",
      "Made for quick customization and fast publishing."
    ].join(" ")
  },
  "Soft glassmorphism icon set for indie builders": {
    title: "Glassmorphism Icon Set for Indie Builders",
    shortDescription:
      "A polished icon set for app builders who want soft glassmorphism without drawing from scratch.",
    description: [
      "An 80-icon bundle for indie builders, SaaS prototypes, and UI experiments.",
      "The set leans into soft glassmorphism so it feels modern without looking noisy.",
      "Ideal for landing pages, dashboards, and lightweight design systems."
    ].join(" ")
  },
  "Muted paper grain textures for brand designers": {
    title: "Muted Paper Grain Texture Pack",
    shortDescription:
      "A matte texture pack for brand designers who need quick depth overlays and neutral paper surfaces.",
    description: [
      "A set of soft scanned-paper and matte-grain textures for brand systems, poster mockups, and creator graphics.",
      "The pack stays muted and flexible so it works as an overlay instead of overpowering the composition.",
      "Built for fast drop-in use across Photoshop, Canva, Figma, and presentation decks."
    ].join(" ")
  },
  "Warm monochrome desktop backgrounds for creative studios": {
    title: "Warm Monochrome Desktop Background Pack",
    shortDescription:
      "A warm desktop wallpaper set for creative teams that want softer screens without clutter.",
    description: [
      "A desktop background pack built around warm gradients, gentle shadow geometry, and low-noise composition.",
      "Made for studio machines, client-facing setups, and calm workspaces that still feel designed.",
      "The visuals are restrained enough for daily use but polished enough to feel intentional."
    ].join(" ")
  }
};

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

function refinedTitle(pack: AssetPackRecord): string {
  return REFINED_PACK_COPY[pack.niche]?.title ?? pack.title;
}

function refinedShortDescription(pack: AssetPackRecord): string {
  return REFINED_PACK_COPY[pack.niche]?.shortDescription ?? pack.shortDescription;
}

function refinedDescription(pack: AssetPackRecord): string {
  return REFINED_PACK_COPY[pack.niche]?.description ?? pack.description;
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
      businessId: "imon-digital-asset-store",
      capability: "asset-blueprint",
      mode: "deep",
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

  async stagePack(id?: string): Promise<AssetPackRecord> {
    const packs = await this.store.getAssetPacks();
    const pack =
      (id ? packs.find((candidate) => candidate.id === id) : undefined) ??
      packs.find((candidate) => candidate.status === "planned");

    if (!pack) {
      throw new Error("No asset pack is available to stage.");
    }

    const next: AssetPackRecord = {
      ...pack,
      title: refinedTitle(pack),
      shortDescription: refinedShortDescription(pack),
      description: refinedDescription(pack),
      status: "producing",
      updatedAt: nowIso()
    };

    await this.store.saveAssetPack(next);
    await this.writePackArtifacts(next);
    await this.writeStageArtifacts(next);
    return next;
  }

  async publishPack(id: string, productUrl: string): Promise<AssetPackRecord> {
    const pack = await this.store.getAssetPack(id);
    if (!pack) {
      throw new Error(`Asset pack ${id} not found.`);
    }

    const publishedAt = nowIso();
    const next: AssetPackRecord = {
      ...pack,
      status: "published",
      productUrl,
      publishedAt,
      updatedAt: publishedAt
    };

    await this.store.saveAssetPack(next);
    await this.writePackArtifacts(next);
    return next;
  }

  async markReadyForUpload(id: string): Promise<AssetPackRecord> {
    const pack = await this.store.getAssetPack(id);
    if (!pack) {
      throw new Error(`Asset pack ${id} not found.`);
    }

    const next: AssetPackRecord = {
      ...pack,
      status: "ready_for_upload",
      updatedAt: nowIso()
    };

    await this.store.saveAssetPack(next);
    await this.writePackArtifacts(next);
    return next;
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
        ...(pack.productUrl ? [`Product URL: ${pack.productUrl}`] : []),
        ...(pack.publishedAt ? [`Published at: ${pack.publishedAt}`] : []),
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

  private async writeStageArtifacts(pack: AssetPackRecord): Promise<void> {
    const rawDir = path.join(pack.outputDir, "assets", "raw");
    const finalDir = path.join(pack.outputDir, "assets", "final");
    const coversDir = path.join(pack.outputDir, "covers");
    const gumroadDir = path.join(pack.outputDir, "gumroad");
    const promptsDir = path.join(pack.outputDir, "prompts");

    await Promise.all([
      ensureDir(rawDir),
      ensureDir(finalDir),
      ensureDir(coversDir),
      ensureDir(gumroadDir),
      ensureDir(promptsDir)
    ]);

    await writeTextFile(
      path.join(promptsDir, "generation-prompts.md"),
      [
        `# ${pack.title}`,
        "",
        "Use these prompts to generate or commission the first version of the pack.",
        "",
        ...pack.promptSeeds.map((prompt, index) => `${index + 1}. ${prompt}`),
        "",
        "## Output Targets",
        `- Pack size: ${pack.packSize}`,
        `- Audience: ${pack.audience}`,
        `- Style: ${pack.style}`,
        `- Marketplace: ${pack.marketplace}`
      ].join("\n")
    );

    await writeTextFile(
      path.join(gumroadDir, "product-draft.md"),
      [
        `# ${pack.title}`,
        "",
        `Suggested price: $${pack.suggestedPrice}`,
        `Price tests: ${pack.priceVariants.map((value) => `$${value}`).join(", ")}`,
        "",
        "## Short Description",
        pack.shortDescription,
        "",
        "## Full Description",
        pack.description,
        "",
        "## Deliverables",
        ...pack.deliverables.map((item) => `- ${item}`),
        "",
        "## Tags",
        pack.tags.join(", ")
      ].join("\n")
    );

    await writeTextFile(
      path.join(pack.outputDir, "production-plan.md"),
      [
        `# Production Plan: ${pack.title}`,
        "",
        "## Immediate Steps",
        "- Generate or source the final asset batch.",
        "- Export the product files into `assets/final/`.",
        "- Create 2 Gumroad cover images in `covers/`.",
        "- Add the final zip and screenshots into `gumroad/`.",
        "",
        "## Folder Rules",
        "- `assets/raw/`: loose source outputs and rejected candidates",
        "- `assets/final/`: cleaned deliverables that go into the product zip",
        "- `covers/`: Gumroad gallery images and thumbnails",
        "- `gumroad/`: final listing copy and the upload zip",
        "",
        "## Publish Checklist",
        ...pack.listingChecklist.map((item) => `- ${item}`)
      ].join("\n")
    );
  }
}
