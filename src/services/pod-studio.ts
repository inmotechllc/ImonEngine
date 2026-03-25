import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { AppConfig } from "../config.js";
import type { ManagedBusiness } from "../domain/engine.js";
import type {
  PodAutomationPlan,
  PodDesignBrief,
  PodPostKind,
  PodRoadblock,
  PodScheduledPost,
  PodScheduledProduct,
  PodStyleDossier,
  PodProductTemplate,
  PodProductType
} from "../domain/pod.js";
import { ensureDir, readJsonFile, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { FileStore } from "../storage/store.js";

const execFileAsync = promisify(execFile);
const PYTHON_COMMAND = process.platform === "win32" ? "python" : "python3";
const IMONIC_BUSINESS_ID = "imon-pod-store";
const TZ = "America/New_York";
const STARTER_DESIGN_COUNT = 5;
const WEEKLY_NEW_DESIGNS = 1;
const DAILY_PRODUCT_ADDS = 1;
const COPIED_REFERENCE_LIMIT = 6;
const PRODUCT_SCHEDULE_DAYS = 21;
const SOCIAL_WEEKS = 2;
const DAY_PART_WINDOWS = {
  morning: { startHour: 9, endHour: 11 },
  midday: { startHour: 12, endHour: 14 },
  evening: { startHour: 18, endHour: 21 }
} as const;

const PRODUCT_TEMPLATES: PodProductTemplate[] = [
  { type: "t_shirt", label: "T-Shirt", merchandisingAngle: "hero graphic apparel" },
  { type: "puzzle", label: "Puzzle", merchandisingAngle: "detail-rich collectible format" },
  { type: "canvas", label: "Canvas", merchandisingAngle: "wall-art hero piece" },
  { type: "poster", label: "Poster", merchandisingAngle: "entry-level wall-art print" },
  { type: "shorts", label: "Shorts", merchandisingAngle: "statement all-over print apparel" },
  { type: "clock", label: "Clock", merchandisingAngle: "functional decor accent" },
  { type: "tapestry", label: "Tapestry", merchandisingAngle: "large-room centerpiece" },
  { type: "round_rug", label: "Round Rug", merchandisingAngle: "floor statement piece" },
  { type: "mouse_pad", label: "Mouse Pad", merchandisingAngle: "desk-accessory conversion item" },
  { type: "bag", label: "Bag", merchandisingAngle: "portable everyday canvas" },
  { type: "phone_case", label: "Phone Case", merchandisingAngle: "high-frequency impulse-buy accessory" },
  { type: "hoodie", label: "Hoodie", merchandisingAngle: "premium apparel placement" },
  { type: "sticker", label: "Sticker", merchandisingAngle: "low-ticket entry item" }
];

const DESIGN_CONCEPTS = [
  {
    title: "Prism Aviator Bear",
    concept: "an original hype-styled bear portrait with geometric shards and luxury streetwear energy"
  },
  {
    title: "Candy Citadel Crew",
    concept: "a stacked candy-color fantasy city with original mascot characters and drippy surreal forms"
  },
  {
    title: "Signal Bloom Tiger",
    concept: "an original tiger character wrapped in abstract confetti shards, bold shadows, and pop-art balance"
  },
  {
    title: "Orbit Courier Rabbit",
    concept: "a playful rabbit courier with layered accessories, clean silhouette, and bright gradient accents"
  },
  {
    title: "Dream Static Fox",
    concept: "a centered fox illustration with soft abstract fragments, iconic eyewear, and print-friendly negative space"
  }
] as const;

type NotificationState = {
  signature?: string;
  notifiedAt?: string;
};

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function pick(minimum: number, maximum: number, seed: string): number {
  if (maximum <= minimum) {
    return minimum;
  }
  return minimum + (hashSeed(seed) % (maximum - minimum + 1));
}

function shuffle<T>(values: T[], seed: string): T[] {
  const next = [...values];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = hashSeed(`${seed}-${index}`) % (index + 1);
    const current = next[index];
    next[index] = next[swapIndex]!;
    next[swapIndex] = current!;
  }
  return next;
}

function zonedParts(date: Date, timeZone: string): ZonedDateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short"
  });
  const entries = new Map(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  const weekdayLabel = entries.get("weekday") ?? "Sun";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };
  return {
    year: Number(entries.get("year") ?? "0"),
    month: Number(entries.get("month") ?? "1"),
    day: Number(entries.get("day") ?? "1"),
    hour: Number(entries.get("hour") ?? "0"),
    minute: Number(entries.get("minute") ?? "0"),
    second: Number(entries.get("second") ?? "0"),
    weekday: weekdayMap[weekdayLabel] ?? 0
  };
}

function utcGuess(parts: Omit<ZonedDateParts, "weekday">): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function timezoneOffsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  return utcGuess(parts) - date.getTime();
}

function zonedDateTimeToUtc(parts: Omit<ZonedDateParts, "weekday">, timeZone: string): Date {
  const guess = utcGuess(parts);
  const offset = timezoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess - offset);
}

function buildAlias(baseEmail: string, brandName: string): string {
  const [local, domain] = baseEmail.split("@");
  if (!local || !domain) {
    return baseEmail;
  }
  return `${local}+${slugify(brandName).replace(/-/g, "")}@${domain}`;
}

function imageExtensions(): Set<string> {
  return new Set([".png", ".jpg", ".jpeg", ".webp"]);
}

async function collectImageFiles(directory: string): Promise<string[]> {
  if (!existsSync(directory)) {
    return [];
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectImageFiles(fullPath)));
      continue;
    }
    if (imageExtensions().has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function stopwords(): Set<string> {
  return new Set([
    "joshuabigaud",
    "abstract",
    "cartoon",
    "design",
    "background",
    "v",
    "png",
    "jpeg",
    "jpg",
    "webp",
    "upscaled",
    "with",
    "and",
    "the",
    "for",
    "2d"
  ]);
}

function extractMotifs(files: string[]): string[] {
  const counts = new Map<string, number>();
  for (const filePath of files) {
    const stem = path.basename(filePath, path.extname(filePath)).toLowerCase();
    for (const token of stem.split(/[^a-z0-9]+/).filter(Boolean)) {
      if (token.length < 4 || stopwords().has(token)) {
        continue;
      }
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([token]) => token);
}

function mondayLaunchWindow(reference = new Date()): { startsAt: string; endsAt: string; reason: string } {
  const parts = zonedParts(reference, TZ);
  const candidate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0));
  const weekday = parts.weekday;
  const daysUntilMonday = weekday === 1 ? 0 : (8 - weekday) % 7;
  candidate.setUTCDate(candidate.getUTCDate() + daysUntilMonday);
  const launchMinute = pick(0, 30, "imonic-launch-minute");
  const startsAt = zonedDateTimeToUtc(
    {
      year: candidate.getUTCFullYear(),
      month: candidate.getUTCMonth() + 1,
      day: candidate.getUTCDate(),
      hour: 7,
      minute: launchMinute,
      second: 0
    },
    TZ
  );
  const durationMinutes = pick(65, 95, "imonic-launch-duration");
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60000);
  return {
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    reason: "Launch execution should begin in the approved Monday 7-9am New York window."
  };
}

function dateAtDayPart(baseDate: Date, dayOffset: number, dayPart: keyof typeof DAY_PART_WINDOWS, seed: string): string {
  const local = zonedParts(baseDate, TZ);
  const base = new Date(Date.UTC(local.year, local.month - 1, local.day, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + dayOffset);
  const window = DAY_PART_WINDOWS[dayPart];
  const hour = pick(window.startHour, window.endHour, `${seed}-hour`);
  const minute = pick(0, 59, `${seed}-minute`);
  return zonedDateTimeToUtc(
    {
      year: base.getUTCFullYear(),
      month: base.getUTCMonth() + 1,
      day: base.getUTCDate(),
      hour,
      minute,
      second: 0
    },
    TZ
  ).toISOString();
}

function dayPartFor(seed: string): keyof typeof DAY_PART_WINDOWS {
  const order: Array<keyof typeof DAY_PART_WINDOWS> = ["morning", "midday", "evening"];
  return order[hashSeed(seed) % order.length]!;
}

export class PodStudioService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {}

  async writePlan(options?: {
    businessId?: string;
    referenceDirectory?: string;
    notifyRoadblocks?: boolean;
  }): Promise<{
    plan: PodAutomationPlan;
    artifacts: {
      planJsonPath: string;
      planMarkdownPath: string;
      productSchedulePath: string;
      socialSchedulePath: string;
      styleDossierPath: string;
      roadblocksPath: string;
      importedReferenceDirectory: string;
      roadblockEmailPath?: string;
    };
    notified: boolean;
  }> {
    const businessId = options?.businessId ?? IMONIC_BUSINESS_ID;
    const business = (await this.store.getManagedBusiness(businessId)) ?? (await this.store.getManagedBusiness(IMONIC_BUSINESS_ID));
    if (!business) {
      throw new Error(`Managed business ${businessId} was not found.`);
    }

    const baseEmail = this.config.marketplaces.gumroadSellerEmail ?? "imonengine@gmail.com";
    const aliasEmail = buildAlias(baseEmail, business.name);
    const baseDir = path.join(this.config.opsDir, "pod-businesses", businessId);
    const importedReferenceDirectory = path.join(baseDir, "style-references", "imported");
    await ensureDir(baseDir);
    await ensureDir(importedReferenceDirectory);

    const referenceDirectory =
      options?.referenceDirectory && existsSync(options.referenceDirectory)
        ? path.resolve(options.referenceDirectory)
        : importedReferenceDirectory;
    const styleDossier = await this.buildStyleDossier(referenceDirectory, importedReferenceDirectory);
    const launchWindow = mondayLaunchWindow();
    const starterDesigns = this.buildStarterDesigns(business.id, styleDossier);
    const cadence = {
      starterDesignCount: STARTER_DESIGN_COUNT,
      weeklyNewDesigns: WEEKLY_NEW_DESIGNS,
      socialFeedPostsPerWeek: pick(3, 5, `${business.id}-feed-posts`),
      storiesOrReelsPerWeek: pick(3, 5, `${business.id}-stories`),
      dailyProductAdds: DAILY_PRODUCT_ADDS
    };
    const productSchedule = this.buildProductSchedule(business, starterDesigns, launchWindow.startsAt);
    const socialSchedule = this.buildSocialSchedule(business, productSchedule, cadence.socialFeedPostsPerWeek, cadence.storiesOrReelsPerWeek);
    const roadblocks = this.buildRoadblocks(styleDossier, business.name);

    const plan: PodAutomationPlan = {
      businessId: business.id,
      businessName: business.name,
      aliasEmail,
      status: roadblocks.length > 0 ? "blocked" : "ready",
      generatedAt: nowIso(),
      launchWindow: {
        ...launchWindow,
        timezone: TZ
      },
      cadence,
      salesChannels: ["Shopify", "Printify or Printful"],
      socialChannels: ["Instagram", "Pinterest", "Facebook Page"],
      productTemplates: PRODUCT_TEMPLATES,
      styleDossier,
      starterDesigns,
      productSchedule,
      socialSchedule,
      roadblocks,
      nextAutomationSteps: [
        "Use the imported style dossier as the art direction source for the first five launch designs.",
        "Publish one new Shopify product per day from the deduplicated schedule, but keep feed posts to three-to-five per week.",
        "Use Shopify product mockups for carousels and keep one story or reel maximum per product.",
        "Generate one new original design per week after the five-design starter bank is live.",
        "If a platform challenge or store credential blocker appears, stop and notify the owner with explicit next steps."
      ]
    };

    const artifacts = await this.writeArtifacts(baseDir, plan);
    await this.updateBusinessState(business, plan, roadblocks);
    const notified = options?.notifyRoadblocks
      ? await this.maybeNotifyRoadblocks(plan, artifacts.roadblockEmailPath ?? path.join(baseDir, "roadblock-email.md"))
      : false;

    return {
      plan,
      artifacts,
      notified
    };
  }

  private async buildStyleDossier(referenceDirectory: string, importedReferenceDirectory: string): Promise<PodStyleDossier> {
    const sourceFiles = await collectImageFiles(referenceDirectory);
    await ensureDir(importedReferenceDirectory);

    const copiedFiles: string[] = [];
    for (const filePath of sourceFiles.slice(0, COPIED_REFERENCE_LIMIT)) {
      const destination = path.join(importedReferenceDirectory, path.basename(filePath));
      if (path.resolve(filePath) !== path.resolve(destination)) {
        await copyFile(filePath, destination);
      }
      copiedFiles.push(destination);
    }

    return {
      referenceDirectory,
      importedReferenceDirectory,
      fileCount: sourceFiles.length,
      sampleFiles: copiedFiles.map((filePath) => path.basename(filePath)),
      motifs: extractMotifs(sourceFiles),
      signals: [
        "Saturated cartoon-vector illustration with strong silhouette separation.",
        "Heavy outline treatment and clean print-friendly negative space.",
        "Centered hero subjects or whimsical stacked scenes with bold contrast.",
        "Abstract geometric shards, paint drips, and playful accent fragments.",
        "Original character energy only; avoid franchise characters, logos, or trademarked iconography."
      ],
      commercialNotes: [
        "Lead with canvas, poster, tapestry, and puzzle formats for detail-heavy pieces.",
        "Use apparel and accessories selectively when the design still reads at smaller sizes.",
        "Keep flat backgrounds or contained negative space so mockups stay legible on POD products."
      ]
    };
  }

  private buildStarterDesigns(businessId: string, styleDossier: PodStyleDossier): PodDesignBrief[] {
    const motifHint = styleDossier.motifs.slice(0, 4).join(", ");
    return DESIGN_CONCEPTS.slice(0, STARTER_DESIGN_COUNT).map((concept, index) => ({
      id: `${businessId}-starter-design-${index + 1}`,
      businessId,
      title: concept.title,
      concept: concept.concept,
      prompt: [
        concept.concept,
        "original digital illustration for print-on-demand merchandise",
        "bold vector-cartoon rendering, rich color, thick linework, centered composition",
        "clean background or contained negative space for canvas, poster, and apparel mockups",
        motifHint ? `visual motifs inspired by the reference set: ${motifHint}` : "",
        "no copyrighted characters, no brand logos, no direct franchise likenesses"
      ]
        .filter(Boolean)
        .join(", "),
      styleNotes: styleDossier.signals,
      sampleReferenceFiles: styleDossier.sampleFiles.slice(0, 3),
      cadence: "starter"
    }));
  }

  private buildProductSchedule(
    business: ManagedBusiness,
    starterDesigns: PodDesignBrief[],
    launchStartsAt: string
  ): PodScheduledProduct[] {
    const launchDate = new Date(launchStartsAt);
    const assignments = starterDesigns.flatMap((design, index) => {
      const shuffledTemplates = shuffle(PRODUCT_TEMPLATES, `${business.id}-${design.id}-templates`);
      const takeCount = pick(6, 9, `${business.id}-${design.id}-count`);
      return shuffledTemplates.slice(0, takeCount).map((template, templateIndex) => ({
        design,
        template,
        seed: `${business.id}-${design.id}-${template.type}-${index}-${templateIndex}`
      }));
    });

    const queue = shuffle(assignments, `${business.id}-product-queue`);
    const used = new Set<string>();
    const scheduled: PodScheduledProduct[] = [];

    for (let dayOffset = 0; dayOffset < PRODUCT_SCHEDULE_DAYS && queue.length > 0; dayOffset += 1) {
      const next = queue.find((candidate) => !used.has(`${candidate.design.id}:${candidate.template.type}`));
      if (!next) {
        break;
      }
      used.add(`${next.design.id}:${next.template.type}`);
      const dayPart = dayPartFor(`${next.seed}-daypart`);
      const scheduledFor = dateAtDayPart(launchDate, dayOffset, dayPart, `${next.seed}-scheduled`);
      scheduled.push({
        id: slugify(`${business.id}-${next.design.id}-${next.template.type}-${scheduledFor}`),
        businessId: business.id,
        designId: next.design.id,
        designTitle: next.design.title,
        productType: next.template.type,
        productLabel: next.template.label,
        scheduledFor,
        dayPart,
        channel: "shopify_store",
        shopifyHandle: slugify(`${next.design.title}-${next.template.label}`),
        notes: [
          "Create only if this design/product pair does not already exist in Shopify.",
          "Use Shopify-generated mockups for carousel slides when available."
        ]
      });
    }

    return scheduled;
  }

  private buildSocialSchedule(
    business: ManagedBusiness,
    productSchedule: PodScheduledProduct[],
    feedPostsPerWeek: number,
    storiesOrReelsPerWeek: number
  ): PodScheduledPost[] {
    const schedule: PodScheduledPost[] = [];
    const weekCount = SOCIAL_WEEKS;
    const productByDay = new Map<string, PodScheduledProduct>();
    for (const product of productSchedule) {
      productByDay.set(product.scheduledFor.slice(0, 10), product);
    }

    const usedStoryTargets = new Set<string>();
    for (let weekIndex = 0; weekIndex < weekCount; weekIndex += 1) {
      const weekProducts = productSchedule.slice(weekIndex * 7, weekIndex * 7 + 7);
      const feedTargets = shuffle(weekProducts, `${business.id}-feed-${weekIndex}`).slice(
        0,
        Math.min(feedPostsPerWeek, weekProducts.length)
      );
      for (const product of feedTargets) {
        schedule.push({
          id: slugify(`${business.id}-${product.id}-carousel`),
          businessId: business.id,
          designId: product.designId,
          designTitle: product.designTitle,
          productType: product.productType,
          productLabel: product.productLabel,
          scheduledFor: product.scheduledFor,
          platform: "instagram_account",
          kind: "carousel",
          assetDirection: "Use Shopify-generated mockups plus one flat design slide.",
          notes: [
            "Only publish if this exact product has not already been posted as a carousel.",
            "Pick the CTA around the product format and room or use-case context."
          ]
        });
      }

      const storyTargets = shuffle(feedTargets, `${business.id}-story-${weekIndex}`).slice(
        0,
        Math.min(storiesOrReelsPerWeek, feedTargets.length)
      );
      for (const product of storyTargets) {
        const key = `${product.designId}:${product.productType}`;
        if (usedStoryTargets.has(key)) {
          continue;
        }
        usedStoryTargets.add(key);
        const kind: PodPostKind = hashSeed(`${business.id}-${product.id}-secondary`) % 2 === 0 ? "story" : "reel";
        const platform = kind === "reel" ? "instagram_account" : "facebook_page";
        const scheduledFor = dateAtDayPart(
          new Date(product.scheduledFor),
          0,
          kind === "reel" ? "evening" : "midday",
          `${business.id}-${product.id}-${kind}`
        );
        schedule.push({
          id: slugify(`${business.id}-${product.id}-${kind}`),
          businessId: business.id,
          designId: product.designId,
          designTitle: product.designTitle,
          productType: product.productType,
          productLabel: product.productLabel,
          scheduledFor,
          platform,
          kind,
          assetDirection:
            kind === "reel"
              ? "Use a slow zoom across the mockup stack or a single design reveal."
              : "Use one product page capture or one mockup frame only.",
          notes: [
            "Do not create more than one story or reel for the same product.",
            "If the product was not published successfully in Shopify, skip this promotion item."
          ]
        });
      }
    }

    return schedule.sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor));
  }

  private buildRoadblocks(styleDossier: PodStyleDossier, businessName: string): PodRoadblock[] {
    const roadblocks: PodRoadblock[] = [];

    if (styleDossier.fileCount === 0) {
      roadblocks.push({
        id: "reference-art-missing",
        category: "Reference style kit",
        summary: "The style reference directory is empty, so Imon cannot anchor Imonic art generation to the expected visual style yet.",
        requiredFromOwner: [
          "Populate the reference folder with a representative set of prior designs or sync the imported reference kit to the VPS.",
          "Rerun the Imonic POD plan once those files exist."
        ],
        continueAfterCompletion: [
          "Imon will rebuild the style dossier and starter design prompts from the new reference set.",
          "The product and social schedules will then remain tied to the updated art direction."
        ]
      });
    }

    if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      roadblocks.push({
        id: "shopify-admin-setup",
        category: "Shopify store setup",
        summary: `${businessName} needs an active Shopify store domain and Admin API access token before daily product publishing can start.`,
        requiredFromOwner: [
          "Create the Shopify trial store for Imonic and leave it logged into the VPS Chrome profile.",
          "Create or install the Shopify app/access method used for Admin API product creation.",
          "Save `SHOPIFY_STORE_DOMAIN` and `SHOPIFY_ADMIN_ACCESS_TOKEN` in `/opt/imon-engine/.env`."
        ],
        continueAfterCompletion: [
          "Imon can begin creating deduplicated Shopify products from the queued design and product schedule.",
          "Carousel posting can then use Shopify-generated mockups instead of manual placeholders."
        ]
      });
    }

    if (!process.env.PRINTIFY_API_TOKEN && !process.env.PRINTFUL_API_TOKEN) {
      roadblocks.push({
        id: "pod-vendor-setup",
        category: "POD vendor integration",
        summary: "A POD vendor connection is required before Imon can turn designs into physical products.",
        requiredFromOwner: [
          "Connect at least one POD vendor account, such as Printify or Printful.",
          "Save the vendor API token in `/opt/imon-engine/.env` as `PRINTIFY_API_TOKEN` or `PRINTFUL_API_TOKEN`.",
          "If the vendor requires browser setup, leave the account signed into the VPS Chrome profile."
        ],
        continueAfterCompletion: [
          "Imon can map the scheduled products onto the vendor catalog and start building product records for Shopify.",
          "The same design/product pair will stay deduplicated across vendor and Shopify publishing."
        ]
      });
    }

    if (!process.env.META_PAGE_ID) {
      roadblocks.push({
        id: "meta-page-missing",
        category: "Meta page configuration",
        summary: "The umbrella Facebook page id is still missing for the Imonic brand.",
        requiredFromOwner: [
          "Create or confirm the umbrella Meta Page for Imonic inside the existing Meta Business portfolio.",
          "Save the resulting page id as `META_PAGE_ID` in `/opt/imon-engine/.env` if Imonic will share the active page-token flow."
        ],
        continueAfterCompletion: [
          "Imon can route Facebook growth publishing through the API-backed page configuration.",
          "The page can then support future ad-account work for the whole Imonic umbrella."
        ]
      });
    }

    return roadblocks;
  }

  private async writeArtifacts(baseDir: string, plan: PodAutomationPlan): Promise<{
    planJsonPath: string;
    planMarkdownPath: string;
    productSchedulePath: string;
    socialSchedulePath: string;
    styleDossierPath: string;
    roadblocksPath: string;
    importedReferenceDirectory: string;
    roadblockEmailPath?: string;
  }> {
    const planJsonPath = path.join(baseDir, "plan.json");
    const planMarkdownPath = path.join(baseDir, "plan.md");
    const productSchedulePath = path.join(baseDir, "product-schedule.json");
    const socialSchedulePath = path.join(baseDir, "social-schedule.json");
    const styleDossierPath = path.join(baseDir, "style-dossier.json");
    const roadblocksPath = path.join(baseDir, "roadblocks.json");
    const roadblockEmailPath = path.join(baseDir, "roadblock-email.md");

    await writeJsonFile(planJsonPath, plan);
    await writeJsonFile(productSchedulePath, plan.productSchedule);
    await writeJsonFile(socialSchedulePath, plan.socialSchedule);
    await writeJsonFile(styleDossierPath, plan.styleDossier);
    await writeJsonFile(roadblocksPath, plan.roadblocks);
    await writeTextFile(planMarkdownPath, this.toMarkdown(plan));
    if (plan.roadblocks.length > 0) {
      await writeTextFile(roadblockEmailPath, this.composeRoadblockEmail(plan));
    }

    return {
      planJsonPath,
      planMarkdownPath,
      productSchedulePath,
      socialSchedulePath,
      styleDossierPath,
      roadblocksPath,
      importedReferenceDirectory: plan.styleDossier.importedReferenceDirectory,
      roadblockEmailPath: plan.roadblocks.length > 0 ? roadblockEmailPath : undefined
    };
  }

  private async updateBusinessState(
    business: ManagedBusiness,
    plan: PodAutomationPlan,
    roadblocks: PodRoadblock[]
  ): Promise<void> {
    const nextStage = roadblocks.length > 0 ? "scaffolded" : "ready";
    await this.store.saveManagedBusiness({
      ...business,
      name: plan.businessName,
      stage: business.stage === "active" ? "active" : nextStage,
      launchBlockers: roadblocks.map((roadblock) => roadblock.summary),
      notes: [
        ...business.notes.filter((note) => !note.startsWith("Imonic plan refreshed")),
        `Imonic plan refreshed ${plan.generatedAt}.`,
        `Primary alias: ${plan.aliasEmail}.`,
        "The POD launch dossier lives under runtime/ops/pod-businesses/imon-pod-store."
      ],
      updatedAt: nowIso()
    });
  }

  private async maybeNotifyRoadblocks(plan: PodAutomationPlan, bodyPath: string): Promise<boolean> {
    if (plan.roadblocks.length === 0) {
      return false;
    }
    const recipient = this.config.business.approvalEmail?.trim();
    if (!recipient || recipient === "owner@example.com") {
      return false;
    }

    const notificationPath = path.join(
      this.config.opsDir,
      "pod-businesses",
      plan.businessId,
      "roadblock-notification.json"
    );
    const signature = createHash("sha1")
      .update(JSON.stringify(plan.roadblocks.map((roadblock) => roadblock.summary)))
      .digest("hex");
    const previous = await readJsonFile<NotificationState>(notificationPath, {});
    const lastNotifiedAt = previous.notifiedAt ? new Date(previous.notifiedAt).getTime() : 0;
    const withinThrottleWindow = Date.now() - lastNotifiedAt < 6 * 60 * 60 * 1000;
    if (previous.signature === signature && withinThrottleWindow) {
      return false;
    }

    await execFileAsync(PYTHON_COMMAND, [
      path.join(this.config.projectRoot, "scripts", "send_gmail_message.py"),
      "--to",
      recipient,
      "--subject",
      `ImonEngine roadblock: ${plan.businessName} launch setup`,
      "--body-file",
      bodyPath
    ]);

    await writeJsonFile(notificationPath, {
      signature,
      notifiedAt: nowIso()
    } satisfies NotificationState);
    return true;
  }

  private composeRoadblockEmail(plan: PodAutomationPlan): string {
    return [
      `ImonEngine reached a launch roadblock for ${plan.businessName}.`,
      "",
      `Business: ${plan.businessName}`,
      `Alias: ${plan.aliasEmail}`,
      `Status: ${plan.status}`,
      `Generated at: ${plan.generatedAt}`,
      "",
      "Roadblocks:",
      ...plan.roadblocks.flatMap((roadblock) => [
        `- ${roadblock.category}: ${roadblock.summary}`,
        ...roadblock.requiredFromOwner.map((line) => `  - Required from you: ${line}`),
        ...roadblock.continueAfterCompletion.map((line) => `  - After completion: ${line}`)
      ]),
      "",
      `Plan file: ${path.join(this.config.opsDir, "pod-businesses", plan.businessId, "plan.md")}`,
      this.config.engine.hostPrimaryIp
        ? `VPS browser: http://${this.config.engine.hostPrimaryIp}:6080/vnc.html?autoconnect=1&resize=scale`
        : "",
      "Leave the required Shopify, POD vendor, and social accounts signed into the VPS Chrome profile when you finish."
    ]
      .filter(Boolean)
      .join("\n");
  }

  private toMarkdown(plan: PodAutomationPlan): string {
    return [
      `# ${plan.businessName} POD Launch Plan`,
      "",
      `Generated at: ${plan.generatedAt}`,
      `Alias: ${plan.aliasEmail}`,
      `Status: ${plan.status}`,
      "",
      "## Launch Window",
      `- Starts at: ${plan.launchWindow.startsAt}`,
      `- Ends at: ${plan.launchWindow.endsAt}`,
      `- Timezone: ${plan.launchWindow.timezone}`,
      `- Reason: ${plan.launchWindow.reason}`,
      "",
      "## Cadence",
      `- Starter designs: ${plan.cadence.starterDesignCount}`,
      `- Weekly new designs: ${plan.cadence.weeklyNewDesigns}`,
      `- Daily product adds: ${plan.cadence.dailyProductAdds}`,
      `- Feed posts per week: ${plan.cadence.socialFeedPostsPerWeek}`,
      `- Stories or reels per week: ${plan.cadence.storiesOrReelsPerWeek}`,
      "",
      "## Style Dossier",
      `- Reference directory: ${plan.styleDossier.referenceDirectory}`,
      `- Imported reference directory: ${plan.styleDossier.importedReferenceDirectory}`,
      `- Reference file count: ${plan.styleDossier.fileCount}`,
      `- Sample files: ${plan.styleDossier.sampleFiles.join(", ") || "none"}`,
      `- Motifs: ${plan.styleDossier.motifs.join(", ") || "none detected"}`,
      ...plan.styleDossier.signals.map((signal) => `- Signal: ${signal}`),
      ...plan.styleDossier.commercialNotes.map((note) => `- Commercial note: ${note}`),
      "",
      "## Starter Designs",
      ...plan.starterDesigns.flatMap((design) => [
        `### ${design.title}`,
        `- Concept: ${design.concept}`,
        `- Prompt: ${design.prompt}`,
        ...design.styleNotes.map((note) => `- Style note: ${note}`),
        `- Sample references: ${design.sampleReferenceFiles.join(", ") || "none"}`,
        ""
      ]),
      "## Product Queue",
      ...plan.productSchedule.map(
        (product) =>
          `- ${product.scheduledFor}: ${product.designTitle} -> ${product.productLabel} (${product.dayPart}, handle ${product.shopifyHandle})`
      ),
      "",
      "## Social Queue",
      ...plan.socialSchedule.map(
        (post) =>
          `- ${post.scheduledFor}: ${post.kind} on ${post.platform} for ${post.designTitle}${post.productLabel ? ` (${post.productLabel})` : ""}`
      ),
      "",
      "## Roadblocks",
      ...(plan.roadblocks.length > 0
        ? plan.roadblocks.flatMap((roadblock) => [
            `### ${roadblock.category}`,
            `- ${roadblock.summary}`,
            ...roadblock.requiredFromOwner.map((line) => `- Required from you: ${line}`),
            ...roadblock.continueAfterCompletion.map((line) => `- After completion: ${line}`),
            ""
          ])
        : ["- No launch blockers are currently detected.", ""]),
      "## Next Automation Steps",
      ...plan.nextAutomationSteps.map((step) => `- ${step}`),
      ""
    ].join("\n");
  }
}
