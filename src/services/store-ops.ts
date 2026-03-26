import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import type { AppConfig } from "../config.js";
import { DEFAULT_MANAGED_BUSINESSES } from "../domain/defaults.js";
import type { AssetPackRecord, DigitalAssetType } from "../domain/digital-assets.js";
import type { BusinessCategory, BusinessLedgerEntry, ManagedBusiness } from "../domain/engine.js";
import type {
  CatalogGrowthPolicy,
  CollectiveFundSnapshot,
  GrowthChannel,
  GrowthWorkItem,
  RevenueDataQualitySummary,
  RevenueAllocationPolicy,
  RevenueAllocationSnapshot,
  SalesTransaction,
  SalesTransactionType,
  SalesTransactionVerificationStatus
} from "../domain/store-ops.js";
import type { SocialProfileRecord, SocialProfileRole, SocialPlatform } from "../domain/social.js";
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
  "imon-pod-store": "Imonic",
  "auto-funding-agency": "Northline Growth Systems"
};

const DEFAULT_BUSINESS_SEEDS = new Map(DEFAULT_MANAGED_BUSINESSES.map((seed) => [seed.id, seed]));

const STRATEGIC_FACEBOOK_CATEGORIES = new Set<BusinessCategory>([
  "faceless_social_brand",
  "micro_saas_factory",
  "print_on_demand_store"
]);

const PINTEREST_FIT_CATEGORIES = new Set<BusinessCategory>([
  "digital_asset_store",
  "niche_content_site",
  "print_on_demand_store"
]);

const X_FIT_CATEGORIES = new Set<BusinessCategory>([
  "digital_asset_store",
  "niche_content_site",
  "faceless_social_brand",
  "micro_saas_factory"
]);

type SocialLaneSeed = {
  id: string;
  name: string;
  focus: string;
};

type SocialBlueprint = {
  umbrellaBrandName: string;
  umbrellaAliasEmail: string;
  umbrellaHandleStem: string;
  instagramLimitPerDevice: number;
  defaults: Array<Omit<SocialProfileRecord, "createdAt" | "updatedAt">>;
};

const CATEGORY_INSTAGRAM_LANES: Partial<Record<BusinessCategory, SocialLaneSeed[]>> = {
  faceless_social_brand: [
    { id: "visual-explainers", name: "Visual Explainers", focus: "hook-first explainers and pattern breakdown clips" },
    { id: "operator-habits", name: "Operator Habits", focus: "routines, systems, and productivity content" },
    { id: "trend-remixes", name: "Trend Remixes", focus: "trend-aware remixes adapted to the umbrella brand voice" }
  ],
  micro_saas_factory: [
    { id: "workflow-agents", name: "Workflow Agents", focus: "small tools that remove repetitive workflow friction" },
    { id: "creator-ops", name: "Creator Ops", focus: "utilities for creators, consultants, and solo operators" },
    { id: "insight-dashboards", name: "Insight Dashboards", focus: "light analytics and visibility tools" }
  ],
  print_on_demand_store: [
    { id: "abstract-art", name: "Abstract Art", focus: "modern abstract art and atmospheric compositions" },
    { id: "sacred-symbols", name: "Sacred Symbols", focus: "religious and spiritual symbol sets presented respectfully" },
    { id: "graphic-tees", name: "Graphic Tees", focus: "statement graphics and typographic apparel motifs" },
    { id: "childrens-designs", name: "Children's Designs", focus: "playful illustrations and kid-friendly patterns" }
  ]
};

const BUSINESS_INSTAGRAM_LANES: Partial<Record<string, SocialLaneSeed[]>> = {
  "imon-faceless-social-brand": CATEGORY_INSTAGRAM_LANES.faceless_social_brand ?? [],
  "imon-micro-saas-factory": CATEGORY_INSTAGRAM_LANES.micro_saas_factory ?? [],
  "imon-pod-store": []
};

const PLATFORM_SORT_ORDER: Record<SocialPlatform, number> = {
  gmail_alias: 0,
  gumroad: 1,
  meta_business: 2,
  facebook_page: 3,
  instagram_account: 4,
  pinterest: 5,
  x: 6
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

function resolveTransactionVerificationStatus(
  transaction: Pick<SalesTransaction, "verificationStatus" | "source">
): SalesTransactionVerificationStatus {
  if (transaction.verificationStatus) {
    return transaction.verificationStatus;
  }

  if (transaction.source === "gumroad") {
    return "verified";
  }

  if (transaction.source === "relay") {
    return "inferred";
  }

  return "manual_unverified";
}

function isVerifiedTransaction(transaction: SalesTransaction): boolean {
  return resolveTransactionVerificationStatus(transaction) === "verified";
}

function isInferredTransaction(transaction: SalesTransaction): boolean {
  return resolveTransactionVerificationStatus(transaction) === "inferred";
}

function isManualUnverifiedTransaction(transaction: SalesTransaction): boolean {
  return resolveTransactionVerificationStatus(transaction) === "manual_unverified";
}

function isTrustedLedgerSource(source: string): boolean {
  return source === "gumroad";
}

function resolveRevenueDataQuality(snapshot: RevenueAllocationSnapshot): RevenueDataQualitySummary {
  return (
    snapshot.dataQuality ?? {
      verifiedTransactions: snapshot.saleCount + snapshot.refundCount,
      inferredTransactions: 0,
      manualUnverifiedTransactions: 0,
      excludedFromAllocationCount: 0,
      verifiedNetRevenue: snapshot.netRevenue,
      inferredNetRevenue: 0,
      verifiedCosts: snapshot.fees + snapshot.refunds,
      inferredCosts: 0,
      observedRelayDeposits: snapshot.relayDeposits,
      observedRelaySpend: snapshot.relaySpend,
      warnings: [
        "Legacy snapshot without explicit data-quality metadata. Treat it as verified only if it came from trusted marketplace exports."
      ]
    }
  );
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

function dedupeNotes(...groups: Array<string[] | undefined>): string[] {
  return [...new Set(groups.flatMap((group) => group ?? []).filter(Boolean))];
}

function mergeProfileNotes(
  profile: Omit<SocialProfileRecord, "createdAt" | "updatedAt">,
  existingProfile?: SocialProfileRecord
): string[] {
  if (profile.status === "planned") {
    return profile.notes ?? [];
  }

  if (!existingProfile?.notes?.length) {
    return profile.notes ?? [];
  }

  const identityChanged =
    existingProfile.brandName !== profile.brandName ||
    existingProfile.emailAlias !== profile.emailAlias ||
    existingProfile.handle !== profile.handle ||
    existingProfile.laneName !== profile.laneName;

  if (!identityChanged) {
    return dedupeNotes(profile.notes, existingProfile.notes);
  }

  const staleTokens = [
    existingProfile.brandName,
    existingProfile.emailAlias,
    existingProfile.handle,
    existingProfile.laneName
  ].filter((value): value is string => Boolean(value));

  const preservedNotes = existingProfile.notes.filter(
    (note) => !staleTokens.some((token) => note.includes(token))
  );
  return dedupeNotes(profile.notes, preservedNotes);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function sortProfiles(left: SocialProfileRecord, right: SocialProfileRecord): number {
  const platformOrder = PLATFORM_SORT_ORDER[left.platform] - PLATFORM_SORT_ORDER[right.platform];
  if (platformOrder !== 0) {
    return platformOrder;
  }
  const roleOrder = `${left.role ?? ""}`.localeCompare(`${right.role ?? ""}`);
  if (roleOrder !== 0) {
    return roleOrder;
  }
  return left.id.localeCompare(right.id);
}

function instagramLanesForBusiness(businessId: string, category?: BusinessCategory): SocialLaneSeed[] {
  return BUSINESS_INSTAGRAM_LANES[businessId] ?? (category ? CATEGORY_INSTAGRAM_LANES[category] ?? [] : []);
}

function defaultBusinessSeed(businessId: string): Pick<ManagedBusiness, "id" | "name" | "category"> | undefined {
  const seed = DEFAULT_BUSINESS_SEEDS.get(businessId);
  if (!seed) {
    return undefined;
  }
  return {
    id: seed.id,
    name: seed.name,
    category: seed.category
  };
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

  private async resolveBusinessProfile(
    businessId: string,
    brandName: string
  ): Promise<Pick<ManagedBusiness, "id" | "name" | "category">> {
    const stored = await this.store.getManagedBusiness(businessId);
    const fallback = defaultBusinessSeed(businessId);
    return {
      id: businessId,
      name: stored?.name ?? fallback?.name ?? brandName,
      category: stored?.category ?? fallback?.category ?? "digital_asset_store"
    };
  }

  private buildSocialBlueprint(
    business: Pick<ManagedBusiness, "id" | "name" | "category">,
    brandName: string,
    baseEmail: string
  ): SocialBlueprint {
    const umbrellaBrandName = business.id === DIGITAL_ASSET_STORE_ID ? DIGITAL_ASSET_BRAND_NAME : brandName;
    const umbrellaAliasEmail = buildAlias(baseEmail, umbrellaBrandName);
    const umbrellaHandleStem = slugify(umbrellaBrandName).replace(/-/g, "");

    if (business.id === DIGITAL_ASSET_STORE_ID) {
      return {
        umbrellaBrandName,
        umbrellaAliasEmail,
        umbrellaHandleStem,
        instagramLimitPerDevice: 10,
        defaults: [
          {
            id: `${business.id}-gmail-alias`,
            businessId: business.id,
            brandName,
            emailAlias: umbrellaAliasEmail,
            platform: "gmail_alias",
            role: "umbrella_brand",
            handle: umbrellaAliasEmail,
            status: "live",
            notes: ["Alias routes into the primary ImonEngine Gmail inbox."]
          },
          {
            id: `${business.id}-gumroad`,
            businessId: business.id,
            brandName,
            emailAlias: umbrellaAliasEmail,
            platform: "gumroad",
            role: "marketplace",
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
            id: `${business.id}-meta-business`,
            businessId: business.id,
            brandName,
            emailAlias: umbrellaAliasEmail,
            platform: "meta_business",
            role: "umbrella_brand",
            externalId: "1042144572314434",
            profileUrl: "https://business.facebook.com/latest/home?nav_ref=bm_home_redirect&asset_id=1042144572314434",
            status: "live",
            notes: ["Signed-in Meta Business Suite workspace."]
          },
          {
            id: `${business.id}-facebook-page`,
            businessId: business.id,
            brandName,
            emailAlias: umbrellaAliasEmail,
            platform: "facebook_page",
            role: "umbrella_brand",
            handle: "Imon",
            externalId: "61577389319663",
            profileUrl: "https://www.facebook.com/profile.php?id=61577389319663",
            status: "live",
            notes: [
              "Current Facebook Page for the digital asset store business.",
              "Legacy exception: this page already exists and can stay attached to the first store."
            ]
          },
          {
            id: `${business.id}-x`,
            businessId: business.id,
            brandName,
            emailAlias: umbrellaAliasEmail,
            platform: "x",
            role: "distribution",
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
            id: `${business.id}-pinterest`,
            businessId: business.id,
            brandName,
            emailAlias: umbrellaAliasEmail,
            platform: "pinterest",
            role: "distribution",
            handle: "imonengineimon",
            profileUrl: "https://www.pinterest.com/imonengineimon/",
            status: "live",
            notes: [
              "Pinterest business profile is live for the digital asset store.",
              "Primary board: Imon Digital Assets."
            ]
          }
        ]
      };
    }

    const defaults: Array<Omit<SocialProfileRecord, "createdAt" | "updatedAt">> = [
      {
        id: `${business.id}-gmail-alias`,
        businessId: business.id,
        brandName,
        emailAlias: umbrellaAliasEmail,
        platform: "gmail_alias",
        role: "umbrella_brand",
        handle: umbrellaAliasEmail,
        status: "live",
        notes: [
          "Alias routes into the primary ImonEngine Gmail inbox.",
          "Reserve ImonEngine and Imon for the parent system, not for this brand."
        ]
      }
    ];

    const umbrellaRootProfileId = STRATEGIC_FACEBOOK_CATEGORIES.has(business.category)
      ? `${business.id}-facebook-page`
      : `${business.id}-gmail-alias`;

    if (STRATEGIC_FACEBOOK_CATEGORIES.has(business.category)) {
      defaults.push(
        {
          id: `${business.id}-meta-business`,
          businessId: business.id,
          brandName,
          emailAlias: umbrellaAliasEmail,
          platform: "meta_business",
          role: "umbrella_brand",
          status: "planned",
          notes: [
            `Add ${brandName} to the parent Meta Business portfolio as an umbrella asset instead of creating a new personal account.`,
            "Use this shared asset to support future Page, ad-account, and app-level permissions for the umbrella business."
          ]
        },
        {
          id: `${business.id}-facebook-page`,
          businessId: business.id,
          brandName,
          emailAlias: umbrellaAliasEmail,
          platform: "facebook_page",
          role: "umbrella_brand",
          handle: brandName,
          status: "planned",
          notes: [
            `Create a single umbrella Facebook Page named ${brandName} under the parent Meta account.`,
            "Use this page sparingly and strategically for scalable offers, umbrella ad campaigns, or Shopify/POD lanes."
          ]
        }
      );
    }

    const instagramLanes = instagramLanesForBusiness(business.id, business.category);
    if (instagramLanes.length > 0) {
      defaults.push(
        ...instagramLanes.map((lane) => {
          const laneBrandName = `${brandName} ${lane.name}`;
          const laneAlias = buildAlias(baseEmail, laneBrandName);
          const laneHandle = slugify(laneBrandName).replace(/-/g, "");
          return {
            id: `${business.id}-instagram-${lane.id}`,
            businessId: business.id,
            brandName,
            emailAlias: laneAlias,
            platform: "instagram_account" as const,
            role: "niche_lane" as SocialProfileRole,
            laneId: lane.id,
            laneName: lane.name,
            parentProfileId: umbrellaRootProfileId,
            handle: laneHandle,
            status: "planned" as const,
            notes: [
              `Create a niche Instagram account for ${lane.name} using ${laneAlias}.`,
              `This lane focuses on ${lane.focus}.`,
              "Keep niche Instagram clusters under ten accounts per device or browser profile before rotating to a fresh environment."
            ]
          };
        })
      );
    } else {
      defaults.push({
        id: `${business.id}-instagram-core`,
        businessId: business.id,
        brandName,
        emailAlias: umbrellaAliasEmail,
        platform: "instagram_account",
        role: "umbrella_brand",
        parentProfileId: umbrellaRootProfileId,
        handle: umbrellaHandleStem,
        status: "planned",
        notes: [
          `Create a primary Instagram account for ${brandName} using ${umbrellaAliasEmail}.`,
          "Keep the account attached to the umbrella brand until there is a strong reason to split it into niche handles."
        ]
      });
    }

    if (X_FIT_CATEGORIES.has(business.category)) {
      defaults.push({
        id: `${business.id}-x`,
        businessId: business.id,
        brandName,
        emailAlias: umbrellaAliasEmail,
        platform: "x",
        role: "distribution",
        handle: umbrellaHandleStem,
        status: "planned",
        notes: [
          `Use ${umbrellaAliasEmail} for signup and prefer visual input or simulated clicks instead of brittle DOM assumptions.`,
          "If Arkose appears, hand off to the owner for a manual solve and then resume automation."
        ]
      });
    }

    if (PINTEREST_FIT_CATEGORIES.has(business.category)) {
      defaults.push({
        id: `${business.id}-pinterest`,
        businessId: business.id,
        brandName,
        emailAlias: umbrellaAliasEmail,
        platform: "pinterest",
        role: "distribution",
        handle: `imonengine${umbrellaHandleStem}`.slice(0, 30),
        status: "planned",
        notes: [
          `Create a Pinterest business profile for ${brandName} once the brand has enough creative inventory.`,
          `Default board suggestion: ${brandName} Collections.`
        ]
      });
    }

    return {
      umbrellaBrandName,
      umbrellaAliasEmail,
      umbrellaHandleStem,
      instagramLimitPerDevice: 10,
      defaults
    };
  }

  async ensureSocialProfiles(
    businessId = DIGITAL_ASSET_STORE_ID,
    brandName = defaultBrandNameForBusiness(businessId)
  ): Promise<SocialProfileRecord[]> {
    const baseEmail = this.config.marketplaces.gumroadSellerEmail ?? "imonengine@gmail.com";
    const business = await this.resolveBusinessProfile(businessId, brandName);
    const now = nowIso();
    const existing = await this.store.getSocialProfiles();
    const current = existing.filter((profile) => profile.businessId === businessId);
    const byId = new Map(current.map((profile) => [profile.id, profile]));
    const blueprint = this.buildSocialBlueprint(business, brandName, baseEmail);
    const defaults = blueprint.defaults;

    const saved: SocialProfileRecord[] = [];
    for (const profile of defaults) {
      const existingProfile = byId.get(profile.id);
      const next: SocialProfileRecord = {
        ...existingProfile,
        ...profile,
        createdAt: existingProfile?.createdAt ?? now,
        updatedAt: now,
        status: existingProfile?.status ?? profile.status,
        blocker: existingProfile?.blocker ?? profile.blocker,
        profileUrl: existingProfile?.profileUrl ?? profile.profileUrl,
        externalId: existingProfile?.externalId ?? profile.externalId,
        notes: mergeProfileNotes(profile, existingProfile)
      };
      saved.push(next);
    }

    const remainder = existing.filter((profile) => profile.businessId !== businessId);
    await this.store.replaceSocialProfiles([...remainder, ...saved].sort(sortProfiles));
    return saved.sort(sortProfiles);
  }

  async scaffoldPortfolioSocialProfiles(): Promise<SocialProfileRecord[]> {
    const managed = await this.store.getManagedBusinesses();
    const businessIndex = new Map(managed.map((business) => [business.id, business.name]));
    const businessIds = uniqueStrings([
      DIGITAL_ASSET_STORE_ID,
      ...DEFAULT_MANAGED_BUSINESSES.map((business) => business.id),
      ...managed.map((business) => business.id)
    ]);

    const allProfiles: SocialProfileRecord[] = [];
    for (const businessId of businessIds) {
      const brandName = businessIndex.get(businessId) ?? defaultBrandNameForBusiness(businessId);
      const profiles = await this.ensureSocialProfiles(businessId, brandName);
      allProfiles.push(...profiles);
    }

    return allProfiles.sort(sortProfiles);
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
      ...profiles
        .sort(sortProfiles)
        .map((profile) =>
        [
          `## ${profile.brandName} · ${profile.platform}${profile.laneName ? ` · ${profile.laneName}` : ""}`,
          `- Brand: ${profile.brandName}`,
          `- Alias: ${profile.emailAlias}`,
          `- Status: ${profile.status}`,
          ...(profile.role ? [`- Role: ${profile.role}`] : []),
          ...(profile.laneName ? [`- Lane: ${profile.laneName}`] : []),
          ...(profile.parentProfileId ? [`- Parent profile: ${profile.parentProfileId}`] : []),
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
        verificationStatus: "verified",
        classificationMethod: "direct_export",
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
        verificationStatus: "inferred",
        classificationMethod: "description_inference",
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

      if (transaction.businessId && transaction.type !== "transfer" && isVerifiedTransaction(transaction)) {
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
    const windowStart = rangeStart(days);
    const windowStartTime = new Date(windowStart).getTime();
    const allTransactions = await this.store.getSalesTransactions();
    const transactions = allTransactions.filter(
      (transaction) =>
        transaction.businessId === businessId && new Date(transaction.occurredAt).getTime() >= windowStartTime
    );

    const verifiedTransactions = transactions.filter(isVerifiedTransaction);
    const inferredTransactions = transactions.filter(isInferredTransaction);
    const manualUnverifiedTransactions = transactions.filter(isManualUnverifiedTransaction);
    const excludedFromAllocationTransactions = transactions.filter((transaction) => !isVerifiedTransaction(transaction));
    const saleTransactions = verifiedTransactions.filter((transaction) => transaction.type === "sale");
    const refundTransactions = verifiedTransactions.filter((transaction) => transaction.type === "refund");
    const relayTransactions = transactions.filter((transaction) => transaction.source === "relay");

    const grossRevenue = roundCurrency(saleTransactions.reduce((sum, item) => sum + item.grossAmount, 0));
    const fees = roundCurrency(
      saleTransactions.reduce((sum, item) => sum + item.feeAmount, 0) +
        verifiedTransactions
          .filter((transaction) => transaction.type === "fee")
          .reduce((sum, item) => sum + Math.max(Math.abs(item.netAmount), item.feeAmount), 0)
    );
    const refunds = roundCurrency(refundTransactions.reduce((sum, item) => sum + Math.abs(item.netAmount), 0));
    const netRevenue = roundCurrency(Math.max(0, grossRevenue - fees - refunds));
    const relayDeposits = roundCurrency(
      relayTransactions.filter((item) => item.netAmount > 0).reduce((sum, item) => sum + item.netAmount, 0)
    );
    const relaySpend = roundCurrency(
      relayTransactions.filter((item) => item.netAmount < 0).reduce((sum, item) => sum + Math.abs(item.netAmount), 0)
    );
    const unmatchedRelayTransactions = allTransactions.filter(
      (transaction) =>
        transaction.source === "relay" &&
        !transaction.businessId &&
        new Date(transaction.occurredAt).getTime() >= windowStartTime
    ).length;
    const inferredNetRevenue = roundCurrency(
      excludedFromAllocationTransactions
        .filter((transaction) => transaction.type === "sale")
        .reduce((sum, transaction) => sum + Math.max(0, transaction.netAmount), 0)
    );
    const verifiedCosts = roundCurrency(
      refunds +
        fees +
        verifiedTransactions
          .filter((transaction) => transaction.source === "relay" && transaction.netAmount < 0)
          .reduce((sum, transaction) => sum + Math.abs(transaction.netAmount), 0)
    );
    const inferredCosts = roundCurrency(
      excludedFromAllocationTransactions.reduce((sum, transaction) => {
        if (transaction.type === "refund") {
          return sum + Math.abs(transaction.netAmount);
        }
        if (transaction.netAmount < 0) {
          return sum + Math.abs(transaction.netAmount);
        }
        return sum + Math.max(0, transaction.feeAmount);
      }, 0)
    );
    const dataQuality: RevenueDataQualitySummary = {
      verifiedTransactions: verifiedTransactions.length,
      inferredTransactions: inferredTransactions.length,
      manualUnverifiedTransactions: manualUnverifiedTransactions.length,
      excludedFromAllocationCount: excludedFromAllocationTransactions.length,
      verifiedNetRevenue: netRevenue,
      inferredNetRevenue,
      verifiedCosts,
      inferredCosts,
      observedRelayDeposits: relayDeposits,
      observedRelaySpend: relaySpend,
      warnings: [
        ...(verifiedTransactions.length === 0
          ? ["No verified marketplace transactions were available in this window, so all allocation outputs remain at zero."]
          : []),
        ...(excludedFromAllocationTransactions.length > 0
          ? [
              `Excluded ${excludedFromAllocationTransactions.length} inferred or unverified transaction(s) from earnings and reinvestment calculations.`
            ]
          : []),
        ...(relayTransactions.some((transaction) => !isVerifiedTransaction(transaction))
          ? [
              "Relay cash movement is shown as observed bank activity only. Inferred Relay classifications are not used to calculate earnings or reinvestment."
            ]
          : []),
        ...(manualUnverifiedTransactions.length > 0
          ? ["Manual transactions remain excluded until they are replaced with verified exports or explicitly verified entries."]
          : []),
        "Revenue allocations and growth recommendations use verified marketplace data only."
      ]
    };

    const latestSignal =
      transactions
        .map((transaction) => transaction.importedAt || transaction.occurredAt)
        .sort()
        .at(-1) ?? nowIso();
    const snapshot: RevenueAllocationSnapshot = {
      id: `${businessId}-revenue-${latestSignal.replaceAll(":", "-")}`,
      businessId,
      windowStart,
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
          ) >= policy.cashoutThreshold,
        basedOnVerifiedDataOnly: true
      },
      dataQuality,
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
    const dataQuality = resolveRevenueDataQuality(snapshot);
    await writeJsonFile(jsonPath, snapshot);
    await writeTextFile(
      markdownPath,
      [
        `# Revenue Report: ${businessName}`,
        "",
        `Generated at: ${snapshot.generatedAt}`,
        `Window: ${snapshot.windowStart} -> ${snapshot.windowEnd}`,
        "",
        "## Verified Earnings Used By Imon",
        `- Verified gross revenue: $${snapshot.grossRevenue.toFixed(2)}`,
        `- Verified fees: $${snapshot.fees.toFixed(2)}`,
        `- Verified refunds: $${snapshot.refunds.toFixed(2)}`,
        `- Verified net revenue: $${snapshot.netRevenue.toFixed(2)}`,
        "",
        "## Observed Bank Activity",
        `- Relay deposits observed: $${snapshot.relayDeposits.toFixed(2)}`,
        `- Relay spend observed: $${snapshot.relaySpend.toFixed(2)}`,
        `- Unmatched Relay transactions in window: ${snapshot.unmatchedRelayTransactions}`,
        "",
        "## Data Quality Guardrails",
        `- Verified transactions: ${dataQuality.verifiedTransactions}`,
        `- Inferred transactions excluded from allocations: ${dataQuality.inferredTransactions}`,
        `- Manual/unverified transactions excluded from allocations: ${dataQuality.manualUnverifiedTransactions}`,
        `- Inferred net revenue excluded: $${dataQuality.inferredNetRevenue.toFixed(2)}`,
        `- Inferred costs excluded: $${dataQuality.inferredCosts.toFixed(2)}`,
        ...dataQuality.warnings.map((warning) => `- Warning: ${warning}`),
        "",
        "## Recommended Allocation",
        `- Recommendations use verified data only: ${snapshot.recommendations.basedOnVerifiedDataOnly ? "yes" : "no"}`,
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
    const policies = await this.store.getAllocationPolicies();
    const policiesByBusiness = new Map(policies.map((candidate) => [candidate.businessId, candidate]));
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

    const contributingBusinesses = [...latestByBusiness.values()].map((snapshot) => {
      const dataQuality = resolveRevenueDataQuality(snapshot);
      const businessPolicy = policiesByBusiness.get(snapshot.businessId) ?? policy;
      const taxReserve = roundCurrency(dataQuality.verifiedNetRevenue * businessPolicy.taxReserveRate);
      const growthReinvestment = roundCurrency(dataQuality.verifiedNetRevenue * businessPolicy.reinvestmentRate);
      const refundBuffer = roundCurrency(dataQuality.verifiedNetRevenue * businessPolicy.refundBufferRate);
      const collectiveTransfer = roundCurrency(
        Math.max(0, dataQuality.verifiedNetRevenue - taxReserve - growthReinvestment - refundBuffer)
      );
      return {
        businessId: snapshot.businessId,
        collectiveTransfer,
        growthReinvestment,
        verifiedNetRevenue: dataQuality.verifiedNetRevenue,
        excludedFromAllocationCount: dataQuality.excludedFromAllocationCount
      };
    });
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
        ownerCashoutReady: reserveAfterSharedReinvestment >= policy.cashoutThreshold,
        basedOnVerifiedDataOnly: true
      },
      dataQuality: {
        businessesWithVerifiedRevenue: contributingBusinesses.filter((item) => item.verifiedNetRevenue > 0).length,
        businessesWithExcludedData: contributingBusinesses.filter((item) => item.excludedFromAllocationCount > 0).length,
        warnings: [
          ...(contributingBusinesses.some((item) => item.excludedFromAllocationCount > 0)
            ? [
                "Collective transfers exclude inferred or unverified business-level transactions until those records are verified."
              ]
            : []),
          "Shared tool reinvestment caps are computed from verified business transfers only."
        ]
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
            `- ${item.businessId}: verified net revenue $${item.verifiedNetRevenue.toFixed(2)}, collective transfer $${item.collectiveTransfer.toFixed(2)}, growth reinvestment $${item.growthReinvestment.toFixed(2)}, excluded transactions ${item.excludedFromAllocationCount}`
        ),
        "",
        "## Collective Totals",
        `- Total collective transfer: $${snapshot.totals.collectiveTransfer.toFixed(2)}`,
        `- Total brand growth reinvestment: $${snapshot.totals.growthReinvestment.toFixed(2)}`,
        "",
        "## Data Quality Guardrails",
        `- Businesses with verified revenue: ${snapshot.dataQuality.businessesWithVerifiedRevenue}`,
        `- Businesses with excluded inferred/unverified data: ${snapshot.dataQuality.businessesWithExcludedData}`,
        ...snapshot.dataQuality.warnings.map((warning) => `- Warning: ${warning}`),
        "",
        "## Shared Reinvestment Policy",
        `- Recommendations use verified data only: ${snapshot.recommendations.basedOnVerifiedDataOnly ? "yes" : "no"}`,
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
