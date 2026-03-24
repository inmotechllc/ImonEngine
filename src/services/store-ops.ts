import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import type { AppConfig } from "../config.js";
import type { AssetPackRecord, DigitalAssetType } from "../domain/digital-assets.js";
import type { BusinessLedgerEntry } from "../domain/engine.js";
import type {
  CatalogGrowthPolicy,
  CollectiveFundSnapshot,
  GrowthChannel,
  GrowthWorkItem,
  RevenueAllocationPolicy,
  RevenueAllocationSnapshot,
  SalesTransaction,
  SalesTransactionType
} from "../domain/store-ops.js";
import type { SocialProfileRecord } from "../domain/social.js";
import { writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { FileStore } from "../storage/store.js";

const DIGITAL_ASSET_STORE_ID = "imon-digital-asset-store";
const DIGITAL_ASSET_BRAND_NAME = "Imon";
const DEFAULT_CURRENCY = "USD";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_BRAND_NAMES: Record<string, string> = {
  "imon-digital-asset-store": "Imon",
  "imon-niche-content-sites": "Northbeam Atlas",
  "imon-faceless-social-brand": "Velora Echo",
  "imon-micro-saas-factory": "QuietPivot",
  "imon-pod-store": "Canvas Current",
  "auto-funding-agency": "Northline Growth Systems"
};

const GROWTH_CHANNEL_PRIORITY: Record<DigitalAssetType, GrowthChannel[]> = {
  wallpaper_pack: ["pinterest", "x", "facebook_page", "gumroad_update"],
  texture_pack: ["pinterest", "facebook_page", "gumroad_update", "x"],
  social_template_pack: ["facebook_page", "gumroad_update", "x", "pinterest"],
  icon_pack: ["x", "facebook_page", "gumroad_update", "pinterest"],
  ui_kit: ["facebook_page", "gumroad_update", "x", "pinterest"]
};

type CsvRow = Record<string, string>;

function nowIso(): string {
  return new Date().toISOString();
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseCsv(content: string): CsvRow[] {
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true
  }) as CsvRow[];
}

function parseAmount(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const normalized = value
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .replace(/\(([^)]+)\)/g, "-$1")
    .trim();

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value: string | undefined, fallback = nowIso()): string {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  return parsed.toISOString();
}

function pickField(row: CsvRow, candidates: string[]): string | undefined {
  const normalizedEntries = Object.entries(row).map(([key, value]) => [normalize(key), value] as const);
  for (const candidate of candidates) {
    const match = normalizedEntries.find(([key]) => key === normalize(candidate));
    if (match && `${match[1]}`.trim().length > 0) {
      return match[1];
    }
  }
  return undefined;
}

function rangeStart(days: number): string {
  return new Date(Date.now() - days * MS_PER_DAY).toISOString();
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function channelForAssetType(assetType: DigitalAssetType): GrowthChannel[] {
  return GROWTH_CHANNEL_PRIORITY[assetType];
}

function assetChannelPriority(assetType: DigitalAssetType): number {
  switch (assetType) {
    case "social_template_pack":
      return 0;
    case "icon_pack":
      return 1;
    case "texture_pack":
      return 2;
    case "wallpaper_pack":
      return 3;
    case "ui_kit":
      return 4;
  }
}

function titleCase(input: string): string {
  return input
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function defaultBrandNameForBusiness(businessId: string): string {
  const named = DEFAULT_BRAND_NAMES[businessId];
  if (named) {
    return named;
  }

  const stripped = businessId
    .replace(/^imon-/, "")
    .replace(/-store$/, "")
    .replace(/-factory$/, "")
    .replace(/-brand$/, "")
    .replace(/-sites$/, "")
    .replace(/-agency$/, "");

  return titleCase(stripped) || "Untitled Brand";
}

function composeGrowthCaption(pack: AssetPackRecord, channel: GrowthChannel): string {
  const cta =
    channel === "gumroad_update"
      ? "Now live in the storefront."
      : channel === "facebook_page"
        ? "See the full pack from the brand page."
        : "See the full pack on Gumroad.";
  return [
    pack.title,
    "",
    pack.shortDescription,
    "",
    cta,
    pack.productUrl ?? "Publish on Gumroad next"
  ].join("\n");
}

function chooseMarketingAsset(pack: AssetPackRecord, channel: GrowthChannel): string {
  const marketingRoot = path.join(path.dirname(path.dirname(pack.outputDir)), "marketing", pack.id);
  const preferredName = channel === "x" || channel === "gumroad_update" ? "teaser-landscape.png" : "teaser-square.png";
  const preferredPath = path.join(marketingRoot, preferredName);
  if (existsSync(preferredPath)) {
    return preferredPath;
  }

  const thumbnailPath = path.join(pack.outputDir, "covers", "thumbnail-square.png");
  if (channel !== "x" && channel !== "gumroad_update" && existsSync(thumbnailPath)) {
    return thumbnailPath;
  }

  const coversDir = path.join(pack.outputDir, "covers");
  if (existsSync(coversDir)) {
    const firstCover = readdirSync(coversDir)
      .filter((fileName) => /^cover-.*\.(png|jpe?g)$/i.test(fileName))
      .sort()[0];
    if (firstCover) {
      return path.join(coversDir, firstCover);
    }
  }

  return preferredPath;
}

function titleCandidate(brief: {
  niche: string;
  style: string;
  assetType: DigitalAssetType;
  audience: string;
}): string {
  const lead = brief.style.length > 0 ? brief.style.charAt(0).toUpperCase() + brief.style.slice(1) : "Curated";
  return `${lead} ${brief.niche}`.trim();
}

function buildGenericBrief(assetType: DigitalAssetType, index: number): {
  niche: string;
  assetType: DigitalAssetType;
  style: string;
  audience: string;
  packSize: number;
} {
  switch (assetType) {
    case "social_template_pack":
      return {
        niche: `Clean creator carousel templates volume ${index}`,
        assetType,
        style: "neutral editorial layouts with strong text hierarchy",
        audience: "solo creators and consultants",
        packSize: 24
      };
    case "icon_pack":
      return {
        niche: `Soft SaaS icon set volume ${index}`,
        assetType,
        style: "soft translucent system icons with muted contrast",
        audience: "indie builders and SaaS marketers",
        packSize: 72
      };
    case "texture_pack":
      return {
        niche: `Poster grain texture pack volume ${index}`,
        assetType,
        style: "matte fibers and soft print grain overlays",
        audience: "brand designers and creators",
        packSize: 28
      };
    case "wallpaper_pack":
      return {
        niche: `Low-noise desktop backgrounds volume ${index}`,
        assetType,
        style: "smoky neutral gradients with subtle geometry",
        audience: "operators, developers, and creator workspaces",
        packSize: 14
      };
    case "ui_kit":
      return {
        niche: `Minimal UI kit volume ${index}`,
        assetType,
        style: "restrained panels and utility-first dashboard patterns",
        audience: "indie builders and product designers",
        packSize: 18
      };
  }
}

function buildAlias(baseEmail: string, brandName: string): string {
  const [local, domain] = baseEmail.split("@");
  if (!local || !domain) {
    return baseEmail;
  }
  return `${local}+${slugify(brandName).replace(/-/g, "")}@${domain}`;
}

export interface SalesImportResult {
  imported: number;
  ledgerEntriesCreated: number;
}

export class StoreOpsService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {}

  async ensureSocialProfiles(
    businessId = DIGITAL_ASSET_STORE_ID,
    brandName = defaultBrandNameForBusiness(businessId)
  ): Promise<SocialProfileRecord[]> {
    const baseEmail = this.config.marketplaces.gumroadSellerEmail ?? "imonengine@gmail.com";
    const emailAlias = buildAlias(baseEmail, brandName);
    const now = nowIso();
    const existing = await this.store.getSocialProfiles();
    const current = existing.filter((profile) => profile.businessId === businessId);
    const byPlatform = new Map(current.map((profile) => [profile.platform, profile]));

    const brandHandle = slugify(brandName).replace(/-/g, "");
    const defaults: Array<Omit<SocialProfileRecord, "createdAt" | "updatedAt">> =
      businessId === DIGITAL_ASSET_STORE_ID
        ? [
            {
              id: `${businessId}-gmail-alias`,
              businessId,
              brandName,
              emailAlias,
              platform: "gmail_alias",
              handle: emailAlias,
              status: "live",
              notes: ["Alias routes into the primary ImonEngine Gmail inbox."]
            },
            {
              id: `${businessId}-gumroad`,
              businessId,
              brandName,
              emailAlias,
              platform: "gumroad",
              handle: "imonengine",
              profileUrl: this.config.marketplaces.gumroadProfileUrl
                ? `https://${this.config.marketplaces.gumroadProfileUrl.replace(/^https?:\/\//, "")}`
                : "https://imonengine.gumroad.com",
              status: "live",
              notes: [
                "Primary store for this business.",
                "This is the legacy first-business exception; future brands should not reuse the Imon name."
              ]
            },
            {
              id: `${businessId}-meta-business`,
              businessId,
              brandName,
              emailAlias,
              platform: "meta_business",
              externalId: "1042144572314434",
              profileUrl: "https://business.facebook.com/latest/home?nav_ref=bm_home_redirect&asset_id=1042144572314434",
              status: "live",
              notes: ["Signed-in Meta Business Suite workspace."]
            },
            {
              id: `${businessId}-facebook-page`,
              businessId,
              brandName,
              emailAlias,
              platform: "facebook_page",
              handle: "Imon",
              externalId: "61577389319663",
              profileUrl: "https://www.facebook.com/profile.php?id=61577389319663",
              status: "live",
              notes: ["Current Facebook Page for the digital asset store business."]
            },
            {
              id: `${businessId}-x`,
              businessId,
              brandName,
              emailAlias,
              platform: "x",
              handle: "imon",
              status: "blocked",
              blocker:
                "X signup reaches an Arkose Labs anti-bot challenge after form entry and should hand off to the owner for a manual solve when it appears.",
              notes: [
                "Use the alias email plus visual or simulated clicks for the normal signup flow.",
                "If Arkose appears, pause for a manual owner solve and then resume automation."
              ]
            },
            {
              id: `${businessId}-pinterest`,
              businessId,
              brandName,
              emailAlias,
              platform: "pinterest",
              handle: "imonengineimon",
              profileUrl: "https://www.pinterest.com/imonengineimon/",
              status: "live",
              notes: [
                "Pinterest business profile is live for the digital asset store.",
                "Primary board: Imon Digital Assets."
              ]
            }
          ]
        : [
            {
              id: `${businessId}-gmail-alias`,
              businessId,
              brandName,
              emailAlias,
              platform: "gmail_alias",
              handle: emailAlias,
              status: "live",
              notes: [
                "Alias routes into the primary ImonEngine Gmail inbox.",
                "Reserve ImonEngine and Imon for the parent system, not for this brand."
              ]
            },
            {
              id: `${businessId}-facebook-page`,
              businessId,
              brandName,
              emailAlias,
              platform: "facebook_page",
              handle: brandName,
              status: "planned",
              notes: [
                `Create a dedicated Facebook Page named ${brandName} under the parent Meta account.`,
                `Use ${emailAlias} for any related signup or verification emails.`
              ]
            },
            {
              id: `${businessId}-meta-business`,
              businessId,
              brandName,
              emailAlias,
              platform: "meta_business",
              status: "planned",
              notes: [
                `Add ${brandName} as its own Page/asset under the parent Meta account after the page exists.`,
                "Do not create a second personal Meta account for the brand."
              ]
            },
            {
              id: `${businessId}-x`,
              businessId,
              brandName,
              emailAlias,
              platform: "x",
              handle: brandHandle,
              status: "planned",
              notes: [
                `Use ${emailAlias} for signup and prefer visual input or simulated clicks instead of brittle DOM assumptions.`,
                "If Arkose appears, hand off to the owner for a manual solve and then resume automation."
              ]
            },
            {
              id: `${businessId}-pinterest`,
              businessId,
              brandName,
              emailAlias,
              platform: "pinterest",
              handle: `imonengine${brandHandle}`,
              status: "planned",
              notes: [
                `Create a dedicated Pinterest business profile for ${brandName} once the brand has enough creative inventory.`,
                `Default board suggestion: ${brandName} Digital Assets.`
              ]
            }
          ];

    const saved: SocialProfileRecord[] = [];
    for (const profile of defaults) {
      const existingProfile = byPlatform.get(profile.platform);
      const preserveLiveProfile = existingProfile?.status === "live";
      const next: SocialProfileRecord = {
        ...profile,
        createdAt: existingProfile?.createdAt ?? now,
        updatedAt: now,
        status: preserveLiveProfile ? existingProfile.status : profile.status,
        blocker: preserveLiveProfile ? existingProfile.blocker ?? profile.blocker : profile.blocker,
        handle: preserveLiveProfile ? existingProfile.handle ?? profile.handle : profile.handle ?? existingProfile?.handle,
        profileUrl: preserveLiveProfile
          ? existingProfile.profileUrl ?? profile.profileUrl
          : profile.profileUrl ?? existingProfile?.profileUrl,
        externalId: preserveLiveProfile
          ? existingProfile.externalId ?? profile.externalId
          : profile.externalId ?? existingProfile?.externalId,
        notes: preserveLiveProfile && existingProfile?.notes?.length ? existingProfile.notes : profile.notes
      };
      await this.store.saveSocialProfile(next);
      saved.push(next);
    }

    return saved.sort((left, right) => left.platform.localeCompare(right.platform));
  }

  async ensureCatalogPolicy(businessId = DIGITAL_ASSET_STORE_ID): Promise<CatalogGrowthPolicy> {
    const policies = await this.store.getGrowthPolicies();
    const existing = policies.find((policy) => policy.businessId === businessId);
    const next: CatalogGrowthPolicy = {
      id: `${businessId}-catalog-policy`,
      businessId,
      maxNewPacksPer7Days: this.config.storeOps.catalog.maxNewPacksPer7Days,
      maxPublishedPacks: this.config.storeOps.catalog.maxPublishedPacks,
      maxSharePerAssetType: this.config.storeOps.catalog.maxSharePerAssetType,
      maxOpenPackQueue: this.config.storeOps.catalog.maxOpenPackQueue,
      minPublishedByType: {
        social_template_pack: 2,
        icon_pack: 2,
        texture_pack: 2,
        wallpaper_pack: 2
      },
      updatedAt: nowIso()
    };

    const merged = existing
      ? {
          ...existing,
          ...next,
          minPublishedByType: {
            ...existing.minPublishedByType,
            ...next.minPublishedByType
          }
        }
      : next;
    await this.store.saveGrowthPolicy(merged);
    return merged;
  }

  async ensureAllocationPolicy(businessId = DIGITAL_ASSET_STORE_ID): Promise<RevenueAllocationPolicy> {
    const policies = await this.store.getAllocationPolicies();
    const existing = policies.find((policy) => policy.businessId === businessId);
    const next: RevenueAllocationPolicy = {
      id: `${businessId}-allocation-policy`,
      businessId,
      taxReserveRate: this.config.storeOps.finance.taxReserveRate,
      reinvestmentRate: this.config.storeOps.finance.reinvestmentRate,
      refundBufferRate: this.config.storeOps.finance.refundBufferRate,
      cashoutThreshold: this.config.storeOps.finance.cashoutThreshold,
      updatedAt: nowIso()
    };
    const merged = existing ? { ...existing, ...next } : next;
    await this.store.saveAllocationPolicy(merged);
    return merged;
  }

  async getCatalogControlState(
    packs: AssetPackRecord[],
    policy?: CatalogGrowthPolicy
  ): Promise<{
    policy: CatalogGrowthPolicy;
    openQueueCount: number;
    createdLast7Days: number;
    publishedCount: number;
    publishedLast7Days: number;
    publishedByType: Partial<Record<DigitalAssetType, number>>;
    canSeedMore: boolean;
    reasons: string[];
  }> {
    const activePolicy = policy ?? (await this.ensureCatalogPolicy());
    const openQueueCount = packs.filter((pack) => pack.status !== "published").length;
    const last7Start = Date.now() - 7 * MS_PER_DAY;
    const createdLast7Days = packs.filter((pack) => new Date(pack.createdAt).getTime() >= last7Start).length;
    const published = packs.filter((pack) => pack.status === "published");
    const publishedCount = published.length;
    const publishedLast7Days = published.filter((pack) => {
      const stamp = pack.publishedAt ?? pack.updatedAt;
      return new Date(stamp).getTime() >= last7Start;
    }).length;

    const publishedByType = published.reduce<Partial<Record<DigitalAssetType, number>>>((accumulator, pack) => {
      accumulator[pack.assetType] = (accumulator[pack.assetType] ?? 0) + 1;
      return accumulator;
    }, {});

    const reasons: string[] = [];
    if (openQueueCount >= activePolicy.maxOpenPackQueue) {
      reasons.push(`Open pack queue is at ${openQueueCount}/${activePolicy.maxOpenPackQueue}.`);
    }
    if (createdLast7Days >= activePolicy.maxNewPacksPer7Days) {
      reasons.push(
        `Created ${createdLast7Days} pack(s) in the last 7 days, hitting the ${activePolicy.maxNewPacksPer7Days} pack generation cap.`
      );
    }
    if (publishedLast7Days >= activePolicy.maxNewPacksPer7Days) {
      reasons.push(
        `Published ${publishedLast7Days} pack(s) in the last 7 days, hitting the ${activePolicy.maxNewPacksPer7Days} pack cap.`
      );
    }
    if (publishedCount >= activePolicy.maxPublishedPacks) {
      reasons.push(`Catalog already has ${publishedCount}/${activePolicy.maxPublishedPacks} published packs.`);
    }

    return {
      policy: activePolicy,
      openQueueCount,
      createdLast7Days,
      publishedCount,
      publishedLast7Days,
      publishedByType,
      canSeedMore: reasons.length === 0,
      reasons
    };
  }

  async getActiveGrowthChannels(
    businessId = DIGITAL_ASSET_STORE_ID
  ): Promise<Set<GrowthChannel>> {
    const profiles = await this.ensureSocialProfiles(businessId);
    const channels = new Set<GrowthChannel>();
    for (const profile of profiles) {
      if (profile.status !== "live") {
        continue;
      }
      if (profile.platform === "facebook_page") {
        channels.add("facebook_page");
      }
      if (profile.platform === "x") {
        channels.add("x");
      }
      if (profile.platform === "pinterest") {
        channels.add("pinterest");
      }
    }
    return channels;
  }

  selectNextAssetType(
    packs: AssetPackRecord[],
    policy: CatalogGrowthPolicy
  ): DigitalAssetType {
    const published = packs.filter((pack) => pack.status === "published");
    const publishedCount = Math.max(1, published.length);
    const counts = published.reduce<Record<DigitalAssetType, number>>(
      (accumulator, pack) => {
        accumulator[pack.assetType] += 1;
        return accumulator;
      },
      {
        wallpaper_pack: 0,
        icon_pack: 0,
        social_template_pack: 0,
        texture_pack: 0,
        ui_kit: 0
      }
    );

    const deficits = Object.entries(policy.minPublishedByType)
      .filter(([, minimum]) => typeof minimum === "number")
      .map(([assetType, minimum]) => ({
        assetType: assetType as DigitalAssetType,
        minimum: minimum as number,
        current: counts[assetType as DigitalAssetType] ?? 0
      }))
      .filter((item) => item.current < item.minimum)
      .sort((left, right) => left.current - right.current || assetChannelPriority(left.assetType) - assetChannelPriority(right.assetType));

    if (deficits.length > 0) {
      return deficits[0]!.assetType;
    }

    const viable = (Object.keys(counts) as DigitalAssetType[])
      .filter((assetType) => assetType !== "ui_kit")
      .map((assetType) => ({
        assetType,
        count: counts[assetType],
        share: counts[assetType] / publishedCount
      }))
      .sort((left, right) => left.share - right.share || left.count - right.count || assetChannelPriority(left.assetType) - assetChannelPriority(right.assetType));

    const underCap = viable.find((item) => item.share < policy.maxSharePerAssetType);
    return underCap?.assetType ?? viable[0]?.assetType ?? "wallpaper_pack";
  }

  nextBriefForCatalog(
    packs: AssetPackRecord[],
    policy: CatalogGrowthPolicy
  ): {
    niche: string;
    assetType: DigitalAssetType;
    style: string;
    audience: string;
    packSize: number;
  } {
    const nextType = this.selectNextAssetType(packs, policy);
    const seenTitles = new Set(packs.map((pack) => pack.title));
    const seenNiches = new Set(packs.map((pack) => pack.niche));
    let index = 1;
    while (index < 500) {
      const brief = buildGenericBrief(nextType, index);
      if (!seenNiches.has(brief.niche) && !seenTitles.has(titleCandidate(brief))) {
        return brief;
      }
      index += 1;
    }

    return buildGenericBrief(nextType, Date.now());
  }

  async refreshGrowthQueue(
    packs: AssetPackRecord[],
    businessId = DIGITAL_ASSET_STORE_ID
  ): Promise<GrowthWorkItem[]> {
    const activeChannels = await this.getActiveGrowthChannels(businessId);
    const published = packs
      .filter((pack) => pack.status === "published" && pack.productUrl)
      .sort((left, right) => assetChannelPriority(left.assetType) - assetChannelPriority(right.assetType));
    const existing = await this.store.getGrowthQueue();
    const existingById = new Map(existing.map((item) => [item.id, item]));
    const keep = [...new Map(existing.filter((item) => item.status === "posted").map((item) => [item.id, item])).values()];
    const queueDays = this.config.storeOps.growth.queueDays;
    const postsPerWeek = this.config.storeOps.growth.postsPerWeek;
    const start = new Date();
    start.setHours(9, 0, 0, 0);
    const planned: GrowthWorkItem[] = [];

    const channelSlots = published.flatMap((pack) =>
      channelForAssetType(pack.assetType)
        .filter((channel) => activeChannels.has(channel))
        .slice(0, 2)
        .map((channel) => ({ pack, channel }))
    );

    const slotCount = Math.min(postsPerWeek, channelSlots.length);
    for (let index = 0; index < slotCount; index += 1) {
      const slot = channelSlots[index % channelSlots.length];
      if (!slot) {
        continue;
      }
      const scheduled = new Date(start.getTime() + index * Math.max(1, Math.floor((queueDays * MS_PER_DAY) / slotCount)));
      const item: GrowthWorkItem = {
        id: slugify(`${slot.pack.id}-${slot.channel}-${scheduled.toISOString()}`),
        businessId,
        packId: slot.pack.id,
        channel: slot.channel,
        title: `${slot.pack.title} on ${slot.channel}`,
        caption: composeGrowthCaption(slot.pack, slot.channel),
        assetPath: chooseMarketingAsset(slot.pack, slot.channel),
        destinationUrl: slot.pack.productUrl ?? "",
        scheduledFor: scheduled.toISOString(),
        status: existingById.get(slugify(`${slot.pack.id}-${slot.channel}-${scheduled.toISOString()}`))?.status ?? "planned",
        notes: [
          "Generated by the repo-controlled store ops service.",
          "Use the signed-in browser session before marking as posted."
        ],
        createdAt:
          existingById.get(slugify(`${slot.pack.id}-${slot.channel}-${scheduled.toISOString()}`))?.createdAt ?? nowIso(),
        updatedAt: existingById.get(slugify(`${slot.pack.id}-${slot.channel}-${scheduled.toISOString()}`))?.updatedAt ?? nowIso()
      };
      planned.push(item);
    }

    const postedIds = new Set(keep.map((item) => item.id));
    const nextQueue = [...keep, ...planned.filter((item) => !postedIds.has(item.id))];
    await this.store.replaceGrowthQueue(nextQueue);
    return nextQueue;
  }

  async writeGrowthArtifacts(
    packs: AssetPackRecord[],
    queue: GrowthWorkItem[]
  ): Promise<{ jsonPath: string; markdownPath: string }> {
    const jsonPath = path.join(this.config.opsDir, "growth-queue.json");
    const markdownPath = path.join(this.config.opsDir, "growth-queue.md");
    await writeJsonFile(jsonPath, queue);

    const packMap = new Map(packs.map((pack) => [pack.id, pack]));
    const generatedAt = queue.map((item) => item.updatedAt).sort().at(-1) ?? nowIso();
    const markdown = [
      "# Growth Queue",
      "",
      `Generated at: ${generatedAt}`,
      "",
      ...queue
        .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor))
        .map((item) => {
          const pack = packMap.get(item.packId);
          return [
            `## ${item.title}`,
            `- Status: ${item.status}`,
            `- Scheduled for: ${item.scheduledFor}`,
            `- Pack: ${pack?.title ?? item.packId}`,
            `- Channel: ${item.channel}`,
            `- Asset: ${item.assetPath}`,
            `- Link: ${item.destinationUrl}`,
            "",
            "```text",
            item.caption,
            "```",
            ""
          ].join("\n");
        })
    ].join("\n");

    await writeTextFile(markdownPath, markdown);
    return { jsonPath, markdownPath };
  }

  async writeSocialArtifacts(
    profiles: SocialProfileRecord[]
  ): Promise<{ jsonPath: string; markdownPath: string }> {
    const jsonPath = path.join(this.config.opsDir, "social-profiles.json");
    const markdownPath = path.join(this.config.opsDir, "social-profiles.md");
    await writeJsonFile(jsonPath, profiles);
    const markdown = [
      "# Social Profiles",
      "",
      ...profiles.map((profile) =>
        [
          `## ${profile.platform}`,
          `- Brand: ${profile.brandName}`,
          `- Alias: ${profile.emailAlias}`,
          `- Status: ${profile.status}`,
          ...(profile.handle ? [`- Handle: ${profile.handle}`] : []),
          ...(profile.profileUrl ? [`- URL: ${profile.profileUrl}`] : []),
          ...(profile.blocker ? [`- Blocker: ${profile.blocker}`] : []),
          ...profile.notes.map((note) => `- Note: ${note}`),
          ""
        ].join("\n")
      )
    ].join("\n");
    await writeTextFile(markdownPath, markdown);
    return { jsonPath, markdownPath };
  }

  async importGumroadSales(csvPath: string, packs: AssetPackRecord[]): Promise<SalesImportResult> {
    const rows = parseCsv(await import("node:fs/promises").then((fs) => fs.readFile(csvPath, "utf8")));
    const importedAt = nowIso();
    let imported = 0;
    let ledgerEntriesCreated = 0;

    for (const row of rows) {
      const orderId = pickField(row, ["order id", "sale id", "id"]) ?? slugify(JSON.stringify(row));
      const productName = pickField(row, ["product name", "product", "name"]) ?? "Unknown Gumroad product";
      const pack = this.matchPackByTitle(packs, productName);
      const grossAmount = parseAmount(
        pickField(row, ["sale price", "amount", "price", "gross", "total"])
      );
      const feeAmount = Math.abs(parseAmount(pickField(row, ["fee", "fees", "gumroad fee"])));
      const payoutAmount = parseAmount(pickField(row, ["creator earnings", "net", "payout", "earnings"]));
      const occurredAt = parseDate(pickField(row, ["purchase date", "date", "created at", "timestamp"]));
      const currency = (pickField(row, ["currency"]) ?? DEFAULT_CURRENCY).toUpperCase();
      const statusText = normalize(
        `${pickField(row, ["status", "purchase status", "refund status"]) ?? ""} ${pickField(row, ["type"]) ?? ""}`
      );
      const isRefund = statusText.includes("refund") || statusText.includes("chargeback") || grossAmount < 0;
      const type: SalesTransactionType = isRefund ? "refund" : "sale";
      const gross = Math.abs(grossAmount);
      const netAmount = isRefund ? -Math.abs(gross || payoutAmount) : payoutAmount || Math.max(0, gross - feeAmount);

      const transaction: SalesTransaction = {
        id: slugify(`gumroad-${orderId}-${type}`),
        businessId: pack?.businessId ?? DIGITAL_ASSET_STORE_ID,
        packId: pack?.id,
        source: "gumroad",
        externalId: orderId,
        type,
        grossAmount: gross,
        feeAmount,
        netAmount,
        currency,
        counterparty: pickField(row, ["email", "customer email", "buyer email"]) ?? "Gumroad customer",
        note: productName,
        occurredAt,
        importedAt,
        metadata: {
          productName
        }
      };

      await this.store.saveSalesTransaction(transaction);
      imported += 1;

      const ledgerEntry: BusinessLedgerEntry = {
        id: `${transaction.id}-ledger`,
        businessId: transaction.businessId ?? DIGITAL_ASSET_STORE_ID,
        type: type === "refund" ? "cost" : "revenue",
        amount: Math.abs(netAmount),
        currency,
        source: "gumroad",
        note: `${type}: ${productName}`,
        recordedAt: occurredAt
      };
      await this.store.saveRevenueLedgerEntry(ledgerEntry);
      ledgerEntriesCreated += 1;
    }

    return { imported, ledgerEntriesCreated };
  }

  async importRelayTransactions(csvPath: string, defaultBusinessId = DIGITAL_ASSET_STORE_ID): Promise<SalesImportResult> {
    const rows = parseCsv(await import("node:fs/promises").then((fs) => fs.readFile(csvPath, "utf8")));
    const importedAt = nowIso();
    let imported = 0;
    let ledgerEntriesCreated = 0;

    for (const row of rows) {
      const description = pickField(row, ["description", "merchant name", "merchant", "details", "name"]) ?? "Relay transaction";
      const amount = parseAmount(pickField(row, ["amount", "amount (usd)", "debit", "credit"]));
      const occurredAt = parseDate(pickField(row, ["posted date", "date", "transaction date", "created at"]));
      const currency = (pickField(row, ["currency"]) ?? DEFAULT_CURRENCY).toUpperCase();
      const normalizedDescription = normalize(description);
      const inferredType: SalesTransactionType =
        amount > 0
          ? normalizedDescription.includes("gumroad")
            ? "payout"
            : "deposit"
          : /(meta|facebook|instagram|pinterest|linkedin|tiktok|ads)/.test(normalizedDescription)
            ? "ad_spend"
            : /(openai|chatgpt|canva|figma|shopify|printify|printful|gumroad)/.test(normalizedDescription)
              ? "tool_cost"
              : /transfer|ach|wire/.test(normalizedDescription)
                ? "transfer"
                : "tool_cost";
      const businessId = normalizedDescription.includes("gumroad") ? DIGITAL_ASSET_STORE_ID : defaultBusinessId;

      const transaction: SalesTransaction = {
        id: slugify(`relay-${description}-${occurredAt}-${amount}`),
        businessId,
        source: "relay",
        type: inferredType,
        grossAmount: Math.abs(amount),
        feeAmount: 0,
        netAmount: amount,
        currency,
        counterparty: "Relay",
        note: description,
        occurredAt,
        importedAt,
        metadata: {
          account: pickField(row, ["account", "account name"]) ?? ""
        }
      };

      await this.store.saveSalesTransaction(transaction);
      imported += 1;

      if (transaction.businessId && transaction.type !== "transfer") {
        const ledgerEntry: BusinessLedgerEntry = {
          id: `${transaction.id}-ledger`,
          businessId: transaction.businessId,
          type: amount >= 0 ? "revenue" : "cost",
          amount: Math.abs(amount),
          currency,
          source: "relay",
          note: description,
          recordedAt: occurredAt
        };
        await this.store.saveRevenueLedgerEntry(ledgerEntry);
        ledgerEntriesCreated += 1;
      }
    }

    return { imported, ledgerEntriesCreated };
  }

  async buildRevenueSnapshot(
    businessId = DIGITAL_ASSET_STORE_ID,
    days = 30
  ): Promise<RevenueAllocationSnapshot> {
    const policy = await this.ensureAllocationPolicy(businessId);
    const transactions = (await this.store.getSalesTransactions()).filter((transaction) => {
      return (
        transaction.businessId === businessId &&
        new Date(transaction.occurredAt).getTime() >= new Date(rangeStart(days)).getTime()
      );
    });

    const saleTransactions = transactions.filter((transaction) => transaction.type === "sale");
    const refundTransactions = transactions.filter((transaction) => transaction.type === "refund");
    const relayTransactions = transactions.filter((transaction) => transaction.source === "relay");

    const grossRevenue = roundCurrency(saleTransactions.reduce((sum, item) => sum + item.grossAmount, 0));
    const fees = roundCurrency(saleTransactions.reduce((sum, item) => sum + item.feeAmount, 0));
    const refunds = roundCurrency(refundTransactions.reduce((sum, item) => sum + Math.abs(item.netAmount), 0));
    const netRevenue = roundCurrency(Math.max(0, grossRevenue - fees - refunds));
    const relayDeposits = roundCurrency(
      relayTransactions.filter((item) => item.netAmount > 0).reduce((sum, item) => sum + item.netAmount, 0)
    );
    const relaySpend = roundCurrency(
      relayTransactions.filter((item) => item.netAmount < 0).reduce((sum, item) => sum + Math.abs(item.netAmount), 0)
    );
    const unmatchedRelayTransactions = relayTransactions.filter((item) => !item.businessId).length;

    const latestSignal =
      transactions
        .map((transaction) => transaction.importedAt || transaction.occurredAt)
        .sort()
        .at(-1) ?? nowIso();
    const snapshot: RevenueAllocationSnapshot = {
      id: `${businessId}-revenue-${latestSignal.replaceAll(":", "-")}`,
      businessId,
      windowStart: rangeStart(days),
      windowEnd: nowIso(),
      saleCount: saleTransactions.length,
      refundCount: refundTransactions.length,
      grossRevenue,
      fees,
      refunds,
      netRevenue,
      relayDeposits,
      relaySpend,
      unmatchedRelayTransactions,
      recommendations: {
        taxReserve: roundCurrency(netRevenue * policy.taxReserveRate),
        growthReinvestment: roundCurrency(netRevenue * policy.reinvestmentRate),
        refundBuffer: roundCurrency(netRevenue * policy.refundBufferRate),
        collectiveTransfer: roundCurrency(
          Math.max(
            0,
            netRevenue -
              roundCurrency(netRevenue * policy.taxReserveRate) -
              roundCurrency(netRevenue * policy.reinvestmentRate) -
              roundCurrency(netRevenue * policy.refundBufferRate)
          )
        ),
        ownerCashoutReady:
          Math.max(
            0,
            netRevenue -
              roundCurrency(netRevenue * policy.taxReserveRate) -
              roundCurrency(netRevenue * policy.reinvestmentRate) -
              roundCurrency(netRevenue * policy.refundBufferRate)
          ) >= policy.cashoutThreshold
      },
      generatedAt: latestSignal
    };

    await this.store.saveAllocationSnapshot(snapshot);
    return snapshot;
  }

  async writeRevenueArtifacts(snapshot: RevenueAllocationSnapshot, businessName: string): Promise<{
    jsonPath: string;
    markdownPath: string;
  }> {
    const jsonPath = path.join(this.config.opsDir, "revenue-report.json");
    const markdownPath = path.join(this.config.opsDir, "revenue-report.md");
    await writeJsonFile(jsonPath, snapshot);
    await writeTextFile(
      markdownPath,
      [
        `# Revenue Report: ${businessName}`,
        "",
        `Generated at: ${snapshot.generatedAt}`,
        `Window: ${snapshot.windowStart} -> ${snapshot.windowEnd}`,
        "",
        `- Gross revenue: $${snapshot.grossRevenue.toFixed(2)}`,
        `- Fees: $${snapshot.fees.toFixed(2)}`,
        `- Refunds: $${snapshot.refunds.toFixed(2)}`,
        `- Net revenue: $${snapshot.netRevenue.toFixed(2)}`,
        `- Relay deposits: $${snapshot.relayDeposits.toFixed(2)}`,
        `- Relay spend: $${snapshot.relaySpend.toFixed(2)}`,
        "",
        "## Recommended Allocation",
        `- Tax reserve: $${snapshot.recommendations.taxReserve.toFixed(2)}`,
        `- Brand growth reinvestment: $${snapshot.recommendations.growthReinvestment.toFixed(2)}`,
        `- Refund buffer: $${snapshot.recommendations.refundBuffer.toFixed(2)}`,
        `- Transfer to collective ImonEngine fund: $${snapshot.recommendations.collectiveTransfer.toFixed(2)}`,
        `- Business cashout threshold reached: ${snapshot.recommendations.ownerCashoutReady ? "yes" : "no"}`
      ].join("\n")
    );
    return { jsonPath, markdownPath };
  }

  async buildCollectiveFundSnapshot(days = 30): Promise<CollectiveFundSnapshot> {
    const policy = await this.ensureAllocationPolicy(DIGITAL_ASSET_STORE_ID);
    const latestByBusiness = new Map<string, RevenueAllocationSnapshot>();
    for (const snapshot of await this.store.getAllocationSnapshots()) {
      if (new Date(snapshot.generatedAt).getTime() < new Date(rangeStart(days)).getTime()) {
        continue;
      }
      const current = latestByBusiness.get(snapshot.businessId);
      if (!current || current.generatedAt.localeCompare(snapshot.generatedAt) < 0) {
        latestByBusiness.set(snapshot.businessId, snapshot);
      }
    }

    const contributingBusinesses = [...latestByBusiness.values()].map((snapshot) => ({
      businessId: snapshot.businessId,
      collectiveTransfer: snapshot.recommendations.collectiveTransfer,
      growthReinvestment: snapshot.recommendations.growthReinvestment
    }));
    const totalCollectiveTransfer = roundCurrency(
      contributingBusinesses.reduce((sum, item) => sum + item.collectiveTransfer, 0)
    );
    const totalGrowthReinvestment = roundCurrency(
      contributingBusinesses.reduce((sum, item) => sum + item.growthReinvestment, 0)
    );
    const sharedToolsReinvestmentCap = roundCurrency(totalCollectiveTransfer * policy.reinvestmentRate);
    const reserveAfterSharedReinvestment = roundCurrency(
      Math.max(0, totalCollectiveTransfer - sharedToolsReinvestmentCap)
    );
    const snapshot: CollectiveFundSnapshot = {
      id: `collective-fund-${nowIso().replaceAll(":", "-")}`,
      generatedAt: nowIso(),
      businessCount: contributingBusinesses.length,
      contributingBusinesses,
      totals: {
        collectiveTransfer: totalCollectiveTransfer,
        growthReinvestment: totalGrowthReinvestment
      },
      recommendations: {
        sharedToolsReinvestmentCap,
        reserveAfterSharedReinvestment,
        ownerCashoutReady: reserveAfterSharedReinvestment >= policy.cashoutThreshold
      }
    };
    await this.store.saveCollectiveSnapshot(snapshot);
    return snapshot;
  }

  async writeCollectiveArtifacts(snapshot: CollectiveFundSnapshot): Promise<{ jsonPath: string; markdownPath: string }> {
    const jsonPath = path.join(this.config.opsDir, "collective-fund-report.json");
    const markdownPath = path.join(this.config.opsDir, "collective-fund-report.md");
    await writeJsonFile(jsonPath, snapshot);
    await writeTextFile(
      markdownPath,
      [
        "# Collective ImonEngine Fund",
        "",
        `Generated at: ${snapshot.generatedAt}`,
        `Businesses contributing: ${snapshot.businessCount}`,
        "",
        "## Brand Contributions",
        ...snapshot.contributingBusinesses.map(
          (item) =>
            `- ${item.businessId}: collective transfer $${item.collectiveTransfer.toFixed(2)}, growth reinvestment $${item.growthReinvestment.toFixed(2)}`
        ),
        "",
        "## Collective Totals",
        `- Total collective transfer: $${snapshot.totals.collectiveTransfer.toFixed(2)}`,
        `- Total brand growth reinvestment: $${snapshot.totals.growthReinvestment.toFixed(2)}`,
        "",
        "## Shared Reinvestment Policy",
        `- Max shared reinvestment into cross-business tools: $${snapshot.recommendations.sharedToolsReinvestmentCap.toFixed(2)}`,
        `- Reserve remaining after shared reinvestment: $${snapshot.recommendations.reserveAfterSharedReinvestment.toFixed(2)}`,
        `- Collective cashout threshold reached: ${snapshot.recommendations.ownerCashoutReady ? "yes" : "no"}`
      ].join("\n")
    );
    return { jsonPath, markdownPath };
  }

  private matchPackByTitle(packs: AssetPackRecord[], title: string): AssetPackRecord | undefined {
    const normalizedTitle = normalize(title);
    return packs.find((pack) => normalize(pack.title) === normalizedTitle || normalizedTitle.includes(normalize(pack.title)));
  }
}
