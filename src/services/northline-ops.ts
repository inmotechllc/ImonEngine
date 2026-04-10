import path from "node:path";
import type { AppConfig } from "../config.js";
import {
  isInternalValidationClient,
  resolveClientProofEligible,
  type ClientJob,
  type OfferConfig
} from "../domain/contracts.js";
import { DEFAULT_AGENCY_PROFILE, DEFAULT_OFFERS } from "../domain/defaults.js";
import type { ManagedBusiness } from "../domain/engine.js";
import type {
  NorthlineAutomationPlan,
  NorthlineDayPart,
  NorthlineOperatingModeState,
  NorthlineProofAsset,
  NorthlinePromotionCriterion,
  NorthlineReadinessItem,
  ResolvedNorthlineBusinessProfile,
  NorthlineRoadblock,
  NorthlineSocialPost,
  NorthlineSprintTask
} from "../domain/northline.js";
import type { GrowthChannel, GrowthWorkItem } from "../domain/store-ops.js";
import type { SocialProfileRecord } from "../domain/social.js";
import { ensureDir, readJsonFile, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { FileStore } from "../storage/store.js";
import {
  northlineLeadMatchesBusinessScope,
  northlineBusinessOpsDir,
  pricingTierLabelForPaymentLinkKey,
  resolveNorthlineBusinessProfile
} from "./northline-business-profile.js";
import { StoreOpsService } from "./store-ops.js";

const NORTHLINE_BUSINESS_ID = "auto-funding-agency";
const TZ = "America/New_York";
const NORTHLINE_PROMOTION_NOTE = "Generated from the Northline social plan.";
const DAY_PART_WINDOWS = {
  morning: { startHour: 8, endHour: 10 },
  midday: { startHour: 12, endHour: 14 },
  evening: { startHour: 17, endHour: 19 }
} as const;
const OFFER_STACK_ORDER = new Map(DEFAULT_OFFERS.map((offer, index) => [offer.id, index]));

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

type NorthlineState = {
  brandedInboxReady: boolean;
  bookingReady: boolean;
  clientCount: number;
  deliveredClientCount: number;
  domainReady: boolean;
  gbpReady: boolean;
  leadFormReady: boolean;
  latestDeliveredClientCount: number;
  latestDeliveredQaStallCount: number;
  longestReplyLoopDays: number;
  ownerApprovalReady: boolean;
  paidDeliveredClientCount: number;
  phoneReady: boolean;
  proofBundleCount: number;
  reviewRequestCount: number;
  reviewSnippetCount: number;
  reviewReady: boolean;
  sendAndReplyLoopCount: number;
  salesEmail: string;
  screenshotBundleCount: number;
  siteReady: boolean;
  smtpReady: boolean;
  socialPlatformsLive: string[];
  socialPlatformsScaffolded: string[];
  leadGenerationLinkReady: boolean;
  stripeReady: boolean;
  growthUpgradeLinkReady: boolean;
  testimonialCount: number;
  testimonialSnippetCount: number;
  validationLatestStripeCompletedAt?: string;
  validationLatestSuccessfulRunAt?: string;
  validationLinkReady: boolean;
  validationSuccessfulRuns: number;
};

type NorthlineValidationConfirmationRecord = {
  lastConfirmedAt?: string;
  lastResult?: {
    businessId?: string;
    status?: string;
  };
  lastStripeCompletedAt?: string;
  submissionId: string;
};

type NorthlineValidationConfirmationStore = {
  confirmations?: NorthlineValidationConfirmationRecord[];
};

type NorthlineValidationProofState = {
  latestStripeCompletedAt?: string;
  latestSuccessfulRunAt?: string;
  successfulRuns: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function businessClient(client: ClientJob, businessId: string): boolean {
  return (client.businessId ?? NORTHLINE_BUSINESS_ID) === businessId;
}

function trackedProofClient(client: ClientJob, businessId: string): boolean {
  return businessClient(client, businessId) && resolveClientProofEligible(client);
}

function hasCompletedClientHandoff(client: ClientJob): boolean {
  return client.qaStatus === "passed" && (client.assets.handoffPackage !== undefined || client.siteStatus === "deployed");
}

function deliverySortTimestamp(client: ClientJob): string {
  return client.assets.handoffPackage?.createdAt ?? client.updatedAt;
}

function sortOfferStack(offers: OfferConfig[]): OfferConfig[] {
  return [...offers].sort((left, right) => {
    const leftOrder = OFFER_STACK_ORDER.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = OFFER_STACK_ORDER.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    if (left.setupPrice !== right.setupPrice) {
      return left.setupPrice - right.setupPrice;
    }
    return left.name.localeCompare(right.name);
  });
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

function startOfNextBusinessDay(reference = new Date()): Date {
  const parts = zonedParts(reference, TZ);
  const base = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0));
  let dayOffset = 1;
  while (true) {
    const candidate = new Date(base);
    candidate.setUTCDate(base.getUTCDate() + dayOffset);
    const weekday = zonedParts(candidate, TZ).weekday;
    if (weekday !== 0 && weekday !== 6) {
      return candidate;
    }
    dayOffset += 1;
  }
}

function dateAtDayPart(
  baseDate: Date,
  dayOffset: number,
  dayPart: NorthlineDayPart,
  seed: string
): string {
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

function isPlaceholderDomain(value: string | undefined): boolean {
  if (!value) {
    return true;
  }
  return /^example\.(com|org|net)$/i.test(value.trim());
}

function isPlaceholderEmail(value: string | undefined): boolean {
  if (!value || !value.includes("@")) {
    return true;
  }
  const trimmed = value.trim().toLowerCase();
  return /@(example\.com|example\.org|example\.net)$/.test(trimmed);
}

function isPlaceholderUrl(value: string | undefined): boolean {
  if (!value) {
    return true;
  }
  const trimmed = value.trim();
  return !/^https?:\/\//i.test(trimmed) || /example\.(com|org|net)/i.test(trimmed);
}

function normalizePublicUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed.replace(/^\/+/, "")}`;
}

function resolvePublicUrl(baseUrl: string | undefined, value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("./")) {
    const normalizedBase = normalizePublicUrl(baseUrl);
    if (!normalizedBase) {
      return undefined;
    }
    try {
      return new URL(trimmed, normalizedBase).toString();
    } catch {
      return undefined;
    }
  }
  return normalizePublicUrl(trimmed);
}

function isPlaceholderRouteOrUrl(value: string | undefined): boolean {
  if (!value) {
    return true;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("./")) {
    return false;
  }
  return isPlaceholderUrl(trimmed);
}

function isPlaceholderEndpoint(value: string | undefined): boolean {
  if (!value) {
    return true;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("./")) {
    return false;
  }
  return isPlaceholderUrl(trimmed);
}

function isPlaceholderPhone(value: string | undefined): boolean {
  if (!value) {
    return true;
  }
  return value.includes("555");
}

function isBrandedInbox(email: string | undefined, domain: string | undefined): boolean {
  if (isPlaceholderEmail(email) || isPlaceholderDomain(domain)) {
    return false;
  }
  return email!.trim().toLowerCase().endsWith(`@${domain!.trim().toLowerCase()}`);
}

function capabilityStatus(completed: number, total: number): "live" | "planned" | "blocked" {
  if (completed >= total) {
    return "live";
  }
  if (completed <= 0) {
    return "blocked";
  }
  return "planned";
}

function formatList(items: string[]): string {
  if (items.length === 0) {
    return "";
  }
  if (items.length === 1) {
    return items[0]!;
  }
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function latestIso(values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right))
    .at(-1);
}

function sortIsoDescending(left: { updatedAt: string }, right: { updatedAt: string }): number {
  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
}

function ageInDays(timestamp: string, reference = new Date()): number {
  const parsed = new Date(timestamp).getTime();
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return Math.max(0, Math.floor((reference.getTime() - parsed) / (24 * 60 * 60 * 1000)));
}

function platformLabel(platform: NorthlineSocialPost["platform"]): string {
  switch (platform) {
    case "facebook_page":
      return "Facebook";
    case "instagram_account":
      return "Instagram";
    case "linkedin":
      return "LinkedIn";
  }
}

function dayPartLabel(dayPart: NorthlineDayPart): string {
  switch (dayPart) {
    case "morning":
      return "Morning";
    case "midday":
      return "Midday";
    case "evening":
      return "Evening";
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeSiteOrigin(value: string | undefined): string | undefined {
  const normalized = normalizePublicUrl(value);
  if (!normalized) {
    return undefined;
  }
  try {
    return new URL(normalized).origin;
  } catch {
    return undefined;
  }
}

function teaserLabel(platform: GrowthChannel): string {
  switch (platform) {
    case "facebook_page":
      return "Facebook";
    case "instagram_account":
      return "Instagram";
    case "gumroad_update":
      return "Gumroad";
    case "linkedin":
      return "LinkedIn";
    case "pinterest":
      return "Pinterest";
    case "x":
      return "X";
  }
}

function teaserSupportLine(profile: ResolvedNorthlineBusinessProfile): string {
  const services = profile.targetServices.length > 0 ? profile.targetServices.slice(0, 3) : profile.targetIndustries;
  if (services.length === 0) {
    return `Built for ${profile.primaryServiceArea ?? "home-service operators"}.`;
  }
  return `Built for ${services.join(", ")} teams in ${profile.primaryServiceArea ?? "the current market"}.`;
}

async function renderNorthlinePromotionTeaser(
  outputPath: string,
  post: NorthlineSocialPost,
  profile: ResolvedNorthlineBusinessProfile
): Promise<void> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  const siteUrl = normalizePublicUrl(profile.siteUrl)?.replace(/^https?:\/\//i, "") ?? profile.businessName;
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      :root {
        color-scheme: light;
        --ink: #132735;
        --muted: #587183;
        --paper: #f4efe7;
        --accent: #de5f3c;
        --accent-soft: rgba(222, 95, 60, 0.14);
        --line: rgba(19, 39, 53, 0.12);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: Georgia, "Times New Roman", serif;
        background:
          radial-gradient(circle at top left, rgba(222, 95, 60, 0.20), transparent 34%),
          linear-gradient(160deg, #fcf7f0 0%, #efe4d3 100%);
        color: var(--ink);
      }
      .frame {
        position: relative;
        width: 100%;
        min-height: 100vh;
        padding: 78px;
        overflow: hidden;
      }
      .frame::before,
      .frame::after {
        content: "";
        position: absolute;
        border-radius: 999px;
        background: var(--accent-soft);
      }
      .frame::before {
        width: 320px;
        height: 320px;
        right: -80px;
        top: -100px;
      }
      .frame::after {
        width: 260px;
        height: 260px;
        left: -90px;
        bottom: -90px;
      }
      .card {
        position: relative;
        z-index: 1;
        min-height: 100%;
        padding: 54px;
        border: 1px solid var(--line);
        border-radius: 40px;
        background: rgba(255, 252, 247, 0.88);
        display: grid;
        grid-template-rows: auto 1fr auto;
        gap: 38px;
      }
      .eyebrow {
        margin: 0;
        font: 600 26px/1.2 "Helvetica Neue", Arial, sans-serif;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--muted);
      }
      h1 {
        margin: 0;
        max-width: 900px;
        font-size: 88px;
        line-height: 0.98;
        letter-spacing: -0.04em;
      }
      .support {
        margin: 0;
        max-width: 820px;
        font: 500 34px/1.3 "Helvetica Neue", Arial, sans-serif;
        color: var(--muted);
      }
      .footer {
        display: flex;
        justify-content: space-between;
        align-items: end;
        gap: 24px;
      }
      .cta {
        display: inline-flex;
        align-items: center;
        padding: 18px 28px;
        border-radius: 999px;
        background: var(--ink);
        color: #fff;
        font: 600 24px/1.1 "Helvetica Neue", Arial, sans-serif;
      }
      .meta {
        text-align: right;
        font: 600 22px/1.35 "Helvetica Neue", Arial, sans-serif;
        color: var(--muted);
      }
      .meta strong {
        display: block;
        margin-bottom: 8px;
        color: var(--ink);
        font-size: 24px;
      }
    </style>
  </head>
  <body>
    <main class="frame">
      <section class="card">
        <header>
          <p class="eyebrow">${escapeHtml(profile.businessName)} · ${escapeHtml(teaserLabel(post.platform))}</p>
        </header>
        <div>
          <h1>${escapeHtml(post.angle)}</h1>
          <p class="support">${escapeHtml(teaserSupportLine(profile))}</p>
        </div>
        <footer class="footer">
          <div class="cta">${escapeHtml(post.cta)}</div>
          <div class="meta">
            <strong>${escapeHtml(profile.businessName)}</strong>
            <span>${escapeHtml(siteUrl)}</span>
          </div>
        </footer>
      </section>
    </main>
  </body>
</html>`;

  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.screenshot({ path: outputPath, type: "png" });
  } finally {
    await page.close();
    await browser.close();
  }
}

async function buildNorthlinePromotionAsset(
  config: AppConfig,
  post: NorthlineSocialPost,
  profile: ResolvedNorthlineBusinessProfile
): Promise<{ assetPath: string; assetUrl?: string }> {
  const siteOrigin = normalizeSiteOrigin(profile.siteUrl);
  const publicRoot = path.join(config.outputDir, "agency-site");
  const publicDir = path.join(publicRoot, "social");
  await ensureDir(publicDir);

  const fileName = `${slugify(`${profile.businessId}-${post.platform}-${post.id}-${post.angle}`)}.png`;
  const assetPath = path.join(publicDir, fileName);
  await renderNorthlinePromotionTeaser(assetPath, post, profile);

  return {
    assetPath,
    assetUrl: siteOrigin ? `${siteOrigin}/social/${fileName}` : undefined
  };
}

function isManagedNorthlinePromotionItem(item: GrowthWorkItem, businessId: string): boolean {
  return item.businessId === businessId && item.notes.some((note) => note === NORTHLINE_PROMOTION_NOTE);
}

function buildNorthlinePromotionCaption(
  post: NorthlineSocialPost,
  profile: ResolvedNorthlineBusinessProfile
): string {
  return [
    post.angle,
    "",
    profile.offerSummary,
    profile.primaryServiceArea ? `Built for ${profile.primaryServiceArea} home-service operators.` : undefined,
    post.cta
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function resolveNorthlinePromotionDestination(
  post: NorthlineSocialPost,
  profile: ResolvedNorthlineBusinessProfile
): string {
  const siteUrl = normalizePublicUrl(profile.siteUrl);
  const bookingUrl = resolvePublicUrl(siteUrl, profile.bookingUrl);
  const intakeUrl = siteUrl ? new URL("/intake.html", siteUrl).toString() : undefined;

  if (/book/i.test(post.cta) && bookingUrl) {
    return bookingUrl;
  }
  if (/intake/i.test(post.cta) && intakeUrl) {
    return intakeUrl;
  }
  return bookingUrl ?? intakeUrl ?? siteUrl ?? "";
}

export class NorthlineOpsService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {}

  async writePlan(options?: { businessId?: string }): Promise<{
    plan: NorthlineAutomationPlan;
    artifacts: {
      planJsonPath: string;
      planMarkdownPath: string;
      readinessPath: string;
      outboundSprintPath: string;
      socialPlanPath: string;
      proofAssetsPath: string;
      roadblocksPath: string;
    };
  }> {
    const businessId = options?.businessId ?? NORTHLINE_BUSINESS_ID;
    const business =
      (await this.store.getManagedBusiness(businessId)) ??
      (await this.store.getManagedBusiness(NORTHLINE_BUSINESS_ID));
    if (!business) {
      throw new Error(`Managed business ${businessId} was not found.`);
    }
    if (business.category !== "client_services_agency") {
      throw new Error(`${business.name} is not a Northline-compatible agency business.`);
    }

    const resolvedProfile = resolveNorthlineBusinessProfile(this.config, business);
    const baseDir = northlineBusinessOpsDir(this.config, business.id);
    await ensureDir(baseDir);

    const [offers, clients] = await Promise.all([this.store.getOffers(), this.store.getClients()]);
    const activeOffers = sortOfferStack(offers.filter((offer) => offer.active));
    const northlineClients = clients.filter((client) => trackedProofClient(client, business.id));

    const storeOps = new StoreOpsService(this.config, this.store);
    const socialProfiles = await storeOps.ensureSocialProfiles(business.id, business.name);
    await storeOps.writeSocialArtifacts(await this.store.getSocialProfiles());
    const outboundSprintPath = path.join(baseDir, "outbound-sprint.md");

    const state = await this.buildState(business.id, northlineClients, socialProfiles, resolvedProfile);
    const readiness = this.buildReadiness(business.id, state, socialProfiles, resolvedProfile);
    const outboundSprint = this.buildOutboundSprint(business.id, resolvedProfile);
    const socialPlan = this.buildSocialPlan(business.id, state);
    const proofAssets = this.buildProofAssets(state, resolvedProfile);
    const roadblocks = this.buildRoadblocks(business.name, state, readiness);
    const operatingMode = this.buildOperatingMode(business.id, business.name, state);
    const missingPromotionCriteria = operatingMode.promotionCriteria.filter(
      (criterion) => criterion.status === "missing"
    ).length;

    const plan: NorthlineAutomationPlan = {
      businessId: business.id,
      businessName: business.name,
      generatedAt: nowIso(),
      status: roadblocks.length > 0 ? "blocked" : "ready",
      primaryServiceArea: resolvedProfile.primaryServiceArea,
      collectionAreas: resolvedProfile.collectionAreas,
      collectionTrades: resolvedProfile.collectionTrades,
      targetIndustries: resolvedProfile.targetIndustries,
      targetServices: resolvedProfile.targetServices,
      offerSummary: resolvedProfile.offerSummary,
      salesEmail: resolvedProfile.salesEmail,
      siteUrl: resolvedProfile.siteUrl,
      offerStack: activeOffers,
      operatingMode,
      readiness,
      outboundSprint,
      socialPlan,
      proofAssets,
      roadblocks,
      nextAutomationSteps: [
        `Use ${outboundSprintPath} as the first 7-day operating rhythm.`,
        operatingMode.current === "autonomous"
          ? `Keep ${business.name} on the VPS cadence and interrupt the lane only for the explicit manual checkpoints.`
          : `${business.name} remains in controlled launch mode until the autonomy promotion criteria are met (${missingPromotionCriteria} still missing).`,
        business.id === NORTHLINE_BUSINESS_ID
          ? "Do not buy traffic or remove the remaining manual launch gates until the proof page, branded inbox, intake path, payment links, and one Stripe-backed /validation.html success are all live."
          : "Do not buy traffic until the proof page, branded inbox, intake path, and payment links are live.",
        "Convert the first delivery into a screenshot set, testimonial, and review request within 24 hours of client approval.",
        "Use the tracked client brief template at examples/briefs/northline-pilot-template.json for the first explicitly external proof account.",
        operatingMode.current === "controlled_launch"
          ? `Keep ${resolvedProfile.businessName} focused on ${resolvedProfile.targetIndustries.join(", ")} until the first three proof assets exist.`
          : `Keep ${resolvedProfile.businessName} focused on exception handling, proof publication review, and live payment authorization while the VPS runner handles the routine lane work.`
      ]
    };

    const artifacts = await this.writeArtifacts(baseDir, plan);
    await this.updateBusinessState(business, plan);

    return {
      plan,
      artifacts
    };
  }

  async refreshPromotionQueue(options?: {
    businessId?: string;
    plan?: NorthlineAutomationPlan;
  }): Promise<{
    businessId: string;
    businessName: string;
    livePlatforms: string[];
    supportedPlatforms: GrowthChannel[];
    unsupportedPlatforms: string[];
    queuedItems: GrowthWorkItem[];
    artifacts: {
      jsonPath: string;
      markdownPath: string;
    };
  }> {
    const businessId = options?.businessId ?? NORTHLINE_BUSINESS_ID;
    const business =
      (await this.store.getManagedBusiness(businessId)) ??
      (await this.store.getManagedBusiness(NORTHLINE_BUSINESS_ID));
    if (!business) {
      throw new Error(`Managed business ${businessId} was not found.`);
    }
    if (business.category !== "client_services_agency") {
      throw new Error(`${business.name} is not a Northline-compatible agency business.`);
    }

    const plan = options?.plan ?? (await this.writePlan({ businessId: business.id })).plan;
    const resolvedProfile = resolveNorthlineBusinessProfile(this.config, business);
    const storeOps = new StoreOpsService(this.config, this.store);
    const socialProfiles = await storeOps.ensureSocialProfiles(business.id, business.name);
    await storeOps.writeSocialArtifacts(await this.store.getSocialProfiles());

    const livePlatforms = [
      ...new Set(socialProfiles.filter((profile) => profile.status === "live").map((profile) => `${profile.platform}`))
    ];
    const supportedPlatforms: GrowthChannel[] = ["facebook_page", "instagram_account"];
    const unsupportedPlatforms = [
      ...new Set(
        plan.socialPlan
          .map((post) => post.platform)
          .filter(
            (platform) =>
              livePlatforms.includes(platform) &&
              platform !== "facebook_page" &&
              platform !== "instagram_account"
          )
      )
    ];
    const supportedPosts = plan.socialPlan.filter(
      (post): post is NorthlineSocialPost & { platform: "facebook_page" | "instagram_account" } =>
        livePlatforms.includes(post.platform) &&
        (post.platform === "facebook_page" || post.platform === "instagram_account")
    );

    const existingQueue = await this.store.getGrowthQueue();
    const existingById = new Map(existingQueue.map((item) => [item.id, item]));
    const keep = existingQueue.filter(
      (item) => !isManagedNorthlinePromotionItem(item, business.id) || item.status === "posted"
    );

    const generatedItems = await Promise.all(
      supportedPosts.map(async (post) => {
        const id = slugify(`${business.id}-${post.platform}-${post.scheduledFor}-${post.angle}`);
        const existingItem = existingById.get(id);
        const asset = await buildNorthlinePromotionAsset(this.config, post, resolvedProfile);
        return {
          id,
          businessId: business.id,
          packId: post.id,
          channel: post.platform,
          title: `${business.name} promotion · ${platformLabel(post.platform)} · ${post.angle}`,
          caption: buildNorthlinePromotionCaption(post, resolvedProfile),
          assetPath: asset.assetPath,
          assetUrl: asset.assetUrl,
          destinationUrl: resolveNorthlinePromotionDestination(post, resolvedProfile),
          scheduledFor: post.scheduledFor,
          status: existingItem?.status ?? "planned",
          notes: [
            NORTHLINE_PROMOTION_NOTE,
            `Generated for ${platformLabel(post.platform)} during the ${dayPartLabel(post.dayPart).toLowerCase()} window.`,
            ...post.notes,
            "Publish through the shared growth queue worker or the publish-growth-post command."
          ],
          createdAt: existingItem?.createdAt ?? nowIso(),
          updatedAt: nowIso()
        } satisfies GrowthWorkItem;
      })
    );

    const keepIds = new Set(keep.map((item) => item.id));
    const nextQueue = [...keep, ...generatedItems.filter((item) => !keepIds.has(item.id))].sort(
      (left, right) => left.scheduledFor.localeCompare(right.scheduledFor) || left.id.localeCompare(right.id)
    );

    await this.store.replaceGrowthQueue(nextQueue);
    const artifacts = await storeOps.writeGrowthArtifacts(await this.store.getAssetPacks(), nextQueue);

    return {
      businessId: business.id,
      businessName: business.name,
      livePlatforms,
      supportedPlatforms,
      unsupportedPlatforms,
      queuedItems: nextQueue.filter((item) => isManagedNorthlinePromotionItem(item, business.id)),
      artifacts
    };
  }

  private async buildState(
    businessId: string,
    clients: Awaited<ReturnType<FileStore["getClients"]>>,
    socialProfiles: SocialProfileRecord[],
    profile: ResolvedNorthlineBusinessProfile
  ): Promise<NorthlineState> {
    const [approvals, outreachDrafts, leadReplies, leads] = await Promise.all([
      this.store.getApprovals(),
      this.store.getOutreachDrafts(),
      this.store.getLeadReplies(),
      this.store.getLeads()
    ]);
    const proofBundleCount = clients.filter((client) => client.assets.proofBundle !== undefined).length;
    const screenshotBundleCount = clients.filter(
      (client) => (client.assets.proofBundle?.screenshots.length ?? 0) > 0
    ).length;
    const testimonialCount = clients.reduce(
      (sum, client) =>
        sum +
        (client.assets.testimonials?.length ?? 0) +
        (client.assets.reviews?.length ?? 0),
      0
    );
    const testimonialSnippetCount = clients.filter(
      (client) =>
        (client.assets.testimonials?.length ?? 0) > 0 ||
        Boolean(client.assets.proofBundle?.publication.testimonialQuote)
    ).length;
    const reviewSnippetCount = clients.reduce(
      (sum, client) => sum + (client.assets.reviews?.length ?? 0),
      0
    );
    const reviewRequestCount = clients.filter(
      (client) => Boolean(client.assets.proofBundle?.reviewRequest.body?.trim())
    ).length;
    const validationProof = await this.readValidationProofState(businessId);
    const deliveredClientCount = clients.filter(
      (client) => client.qaStatus === "passed" || hasCompletedClientHandoff(client)
    ).length;
    const paidDeliveredClients = clients
      .filter(
        (client) =>
          ["paid", "retainer_active"].includes(client.billingStatus) && hasCompletedClientHandoff(client)
      )
      .sort(
        (left, right) =>
          new Date(deliverySortTimestamp(right)).getTime() -
          new Date(deliverySortTimestamp(left)).getTime()
      );
    const latestDeliveredClientIds = paidDeliveredClients.slice(0, 3).map((client) => client.id);
    const latestDeliveredQaStallCount = approvals.filter(
      (task) =>
        latestDeliveredClientIds.includes(task.relatedEntityId) &&
        task.id === `approval-northline-qa-${task.relatedEntityId}` &&
        task.status !== "completed"
    ).length;
    const businessLeadIds = new Set(
      leads.filter((lead) => northlineLeadMatchesBusinessScope(lead, businessId, profile)).map((lead) => lead.id)
    );
    const sendAndReplyLoopWindows = outreachDrafts
      .filter((draft) => businessLeadIds.has(draft.leadId))
      .map((draft) => {
        const firstAutomatedSend = [...(draft.sendReceipts ?? [])]
          .filter((receipt) => receipt.status === "sent")
          .map((receipt) => receipt.sentAt ?? receipt.attemptedAt)
          .filter((timestamp): timestamp is string => Boolean(timestamp))
          .sort()
          .at(0);
        const latestReply = leadReplies
          .filter((reply) => reply.leadId === draft.leadId && reply.source !== "manual_file")
          .map((reply) => reply.receivedAt)
          .sort()
          .at(-1);
        if (!firstAutomatedSend || !latestReply) {
          return undefined;
        }
        return {
          leadId: draft.leadId,
          ageDays: ageInDays(firstAutomatedSend)
        };
      })
      .filter(
        (
          window
        ): window is {
          leadId: string;
          ageDays: number;
        } => Boolean(window)
      );
    const socialPlatformsScaffolded = [
      ...new Set(
        socialProfiles
          .filter((profile) => ["facebook_page", "instagram_account"].includes(profile.platform))
          .map((profile) => profile.platform)
      )
    ];
    const socialPlatformsLive = [
      !isPlaceholderUrl(this.config.business.facebookUrl) ? "facebook_page" : undefined,
      !isPlaceholderUrl(this.config.business.instagramUrl) ? "instagram_account" : undefined,
      !isPlaceholderUrl(this.config.business.linkedinUrl) ? "linkedin" : undefined
    ].filter((platform): platform is string => Boolean(platform));

    return {
      brandedInboxReady: isBrandedInbox(profile.salesEmail, profile.domain),
      bookingReady: !isPlaceholderRouteOrUrl(profile.bookingUrl),
      clientCount: clients.length,
      deliveredClientCount,
      domainReady: !isPlaceholderDomain(profile.domain),
      gbpReady: !isPlaceholderUrl(this.config.business.googleBusinessProfileUrl),
      leadFormReady: !isPlaceholderEndpoint(profile.leadFormAction),
      latestDeliveredClientCount: latestDeliveredClientIds.length,
      latestDeliveredQaStallCount,
      longestReplyLoopDays: sendAndReplyLoopWindows.reduce(
        (highest, window) => Math.max(highest, window.ageDays),
        0
      ),
      ownerApprovalReady: !isPlaceholderEmail(this.config.business.approvalEmail),
      paidDeliveredClientCount: paidDeliveredClients.length,
      phoneReady: !isPlaceholderPhone(this.config.business.phone),
      proofBundleCount,
      reviewRequestCount,
      reviewSnippetCount,
      reviewReady: !isPlaceholderUrl(this.config.business.googleReviewUrl),
      sendAndReplyLoopCount: sendAndReplyLoopWindows.length,
      salesEmail: profile.salesEmail,
      screenshotBundleCount,
      siteReady: !isPlaceholderUrl(profile.siteUrl),
      smtpReady: Boolean(this.config.smtp),
      socialPlatformsLive,
      socialPlatformsScaffolded,
      leadGenerationLinkReady: !isPlaceholderUrl(profile.stripeLeadGeneration),
      stripeReady:
        !isPlaceholderUrl(profile.stripeFounding) &&
        !isPlaceholderUrl(profile.stripeStandard),
      growthUpgradeLinkReady: !isPlaceholderUrl(profile.growthUpgrade?.paymentLink),
      testimonialCount,
      testimonialSnippetCount,
      validationLatestStripeCompletedAt: validationProof.latestStripeCompletedAt,
      validationLatestSuccessfulRunAt: validationProof.latestSuccessfulRunAt,
      validationLinkReady: !isPlaceholderUrl(profile.stripeValidation),
      validationSuccessfulRuns: validationProof.successfulRuns
    };
  }

  private buildReadiness(
    businessId: string,
    state: NorthlineState,
    socialProfiles: SocialProfileRecord[],
    profile: ResolvedNorthlineBusinessProfile
  ): NorthlineReadinessItem[] {
    const publicSurfaceCompleted = [state.siteReady].filter(Boolean).length;
    const contactPathReady = state.bookingReady || state.leadFormReady;
    const contactCompleted = [state.brandedInboxReady, contactPathReady].filter(Boolean).length;
    const trustCompleted = [state.gbpReady, state.reviewReady, state.socialPlatformsLive.length > 0].filter(Boolean)
      .length;
    const publicSurfaceNextSteps = [
      !state.siteReady ? "Set NORTHLINE_SITE_URL to the public proof-page URL or VPS-hosted page." : undefined
    ].filter((step): step is string => Boolean(step));
    const contactRoutingNextSteps = [
      !state.brandedInboxReady ? "Set NORTHLINE_SALES_EMAIL to a branded Northline inbox." : undefined,
      !contactPathReady
        ? "Set NORTHLINE_LEAD_FORM_ACTION to /api/northline-intake or another live endpoint, or set NORTHLINE_BOOKING_URL to a calendar link."
        : undefined
    ].filter((step): step is string => Boolean(step));
    const paymentNextSteps = [
      isPlaceholderUrl(profile.stripeFounding)
        ? "Set NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING."
        : undefined,
      isPlaceholderUrl(profile.stripeStandard)
        ? "Set NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD."
        : undefined,
      isPlaceholderUrl(profile.growthUpgrade?.paymentLink) &&
      !profile.growthUpgrade?.couponLabel &&
      !profile.growthUpgrade?.terms
        ? "Optionally set NORTHLINE_STRIPE_PAYMENT_LINK_GROWTH_UPGRADE or configure growthUpgrade coupon copy for the Lead Generation to Growth System upgrade path."
        : undefined
    ].filter((step): step is string => Boolean(step));
    const localTrustNextSteps = [
      !state.gbpReady ? "Set NORTHLINE_GOOGLE_BUSINESS_PROFILE_URL." : undefined,
      !state.reviewReady ? "Set NORTHLINE_GOOGLE_REVIEW_URL." : undefined,
      state.socialPlatformsLive.length === 0
        ? "Set NORTHLINE_FACEBOOK_URL, NORTHLINE_INSTAGRAM_URL, and optionally NORTHLINE_LINKEDIN_URL."
        : undefined
    ].filter((step): step is string => Boolean(step));
    const ownerRoutingNextSteps = [
      !state.ownerApprovalReady ? "Set APPROVAL_EMAIL to the owner inbox." : undefined,
      !state.smtpReady ? "Add SMTP_* values if you want automated approval and roadblock notifications." : undefined
    ].filter((step): step is string => Boolean(step));

    const validationReadiness: NorthlineReadinessItem[] =
      businessId === NORTHLINE_BUSINESS_ID
        ? [
            {
              id: "validation-proof",
              area: "Controlled launch proof-of-life",
              status:
                state.validationSuccessfulRuns > 0
                  ? "live"
                  : state.validationLinkReady
                    ? "planned"
                    : "blocked",
              summary:
                "Northline should record one real /validation.html Stripe checkout plus a successful hosted result before the controlled launch is treated as proven.",
              evidence: [
                state.validationLinkReady
                  ? "Validation payment link is configured."
                  : "Validation payment link is missing.",
                state.validationSuccessfulRuns > 0
                  ? `Successful Stripe-backed validation runs recorded: ${state.validationSuccessfulRuns}. Latest success: ${state.validationLatestSuccessfulRunAt ?? "Recorded without a confirmation timestamp."}`
                  : state.validationLatestStripeCompletedAt
                    ? `A Stripe checkout was recorded at ${state.validationLatestStripeCompletedAt}, but the hosted validation result is not marked successful yet.`
                    : "No successful Stripe-backed validation run is recorded yet."
              ],
              nextSteps: [
                !state.validationLinkReady ? "Set NORTHLINE_STRIPE_PAYMENT_LINK_VALIDATION." : undefined,
                state.validationSuccessfulRuns === 0
                  ? "Complete one real /validation.html checkout and confirm the hosted status panel records both the Stripe event and a successful validation result."
                  : undefined
              ].filter((step): step is string => Boolean(step))
            }
          ]
        : [];

    const readiness: NorthlineReadinessItem[] = [
      {
        id: "public-surface",
        area: "Public proof page",
        status: capabilityStatus(publicSurfaceCompleted, 1),
        summary: "Northline needs one public proof page before cold outbound, referrals, and Stripe links have something credible to point at.",
        evidence: [
          state.siteReady
            ? `Proof page configured: ${profile.siteUrl}`
            : "Proof page URL is still placeholder or missing.",
          state.domainReady
            ? `Inbox domain available: ${profile.domain}`
            : "Custom inbox domain is still placeholder or missing."
        ],
        nextSteps: publicSurfaceNextSteps
      },
      {
        id: "contact-routing",
        area: "Contact routing",
        status: capabilityStatus(contactCompleted, 2),
        summary: "Operators should be able to reach a branded inbox and choose either a booking link or a live hosted intake form.",
        evidence: [
          state.brandedInboxReady
            ? `Branded inbox ready: ${profile.salesEmail}`
            : "Inbox is missing or not on the Northline domain.",
          state.bookingReady
            ? `Booking URL configured: ${profile.bookingUrl}`
            : state.leadFormReady
              ? "Booking URL is still missing, but the hosted intake path is live."
              : "Booking URL is still missing.",
          state.leadFormReady
            ? `Lead form action configured: ${profile.leadFormAction}`
            : state.bookingReady
              ? "Lead form action is still missing, but the booking route is live."
              : "Lead form action is still missing."
        ],
        nextSteps: contactRoutingNextSteps
      },
      {
        id: "payment-collection",
        area: "Payment collection",
        status: state.stripeReady ? "live" : "blocked",
        summary:
          `Northline keeps the public ladder review-first. ${pricingTierLabelForPaymentLinkKey(profile, "founding", "Pilot Launch")} and ${pricingTierLabelForPaymentLinkKey(profile, "standard", "Growth System")} are the required qualified checkout paths, while ${pricingTierLabelForPaymentLinkKey(profile, "lead_generation", "Lead Generation")} can stay review-first until Northline wants a dedicated smaller-step checkout link.`,
        evidence: [
          !isPlaceholderUrl(profile.stripeLeadGeneration)
            ? `${pricingTierLabelForPaymentLinkKey(profile, "lead_generation", "Lead Generation")} payment link is configured.`
            : `${pricingTierLabelForPaymentLinkKey(profile, "lead_generation", "Lead Generation")} payment link is optional and not configured yet.`,
          !isPlaceholderUrl(profile.stripeFounding)
            ? `${pricingTierLabelForPaymentLinkKey(profile, "founding", "Pilot Launch")} payment link is configured.`
            : `${pricingTierLabelForPaymentLinkKey(profile, "founding", "Pilot Launch")} payment link is missing.`,
          !isPlaceholderUrl(profile.stripeStandard)
            ? `${pricingTierLabelForPaymentLinkKey(profile, "standard", "Growth System")} payment link is configured.`
            : `${pricingTierLabelForPaymentLinkKey(profile, "standard", "Growth System")} payment link is missing.`,
          !isPlaceholderUrl(profile.growthUpgrade?.paymentLink)
            ? "Growth upgrade payment link is configured."
            : profile.growthUpgrade?.couponLabel || profile.growthUpgrade?.terms
              ? "Growth upgrade coupon copy is configured without a dedicated discounted payment link yet."
              : "Growth upgrade path is not configured yet."
        ],
        nextSteps: paymentNextSteps
      },
      ...validationReadiness,
      {
        id: "local-trust",
        area: "Optional trust layers",
        status: capabilityStatus(trustCompleted, 3),
        summary: "Social proof, Google Business Profile, and review capture help later, but they do not block the faceless outbound pipeline.",
        evidence: [
          state.gbpReady
            ? `Google Business Profile URL configured: ${this.config.business.googleBusinessProfileUrl}`
            : "Google Business Profile URL is missing.",
          state.reviewReady
            ? `Review request URL configured: ${this.config.business.googleReviewUrl}`
            : "Review request URL is missing.",
          state.socialPlatformsLive.length > 0
            ? `Live social surfaces: ${state.socialPlatformsLive.join(", ")}`
            : socialProfiles.length > 0 || state.socialPlatformsScaffolded.length > 0
              ? `Social scaffolding exists for: ${state.socialPlatformsScaffolded.join(", ")}`
              : "No Northline social surfaces are live yet."
        ],
        nextSteps: localTrustNextSteps
      },
      {
        id: "owner-routing",
        area: "Owner routing and notifications",
        status: state.ownerApprovalReady && state.smtpReady ? "live" : state.ownerApprovalReady ? "planned" : "blocked",
        summary: "Owner approvals can stay manual at first, but escalation routing should be explicit.",
        evidence: [
          state.ownerApprovalReady
            ? `Approval inbox configured: ${this.config.business.approvalEmail}`
            : "Approval inbox is still missing or placeholder.",
          state.smtpReady ? "SMTP is configured for automatic notices." : "SMTP is not configured."
        ],
        nextSteps: ownerRoutingNextSteps
      }
    ];

    return readiness;
  }

  private buildOutboundSprint(
    businessId: string,
    profile: ResolvedNorthlineBusinessProfile
  ): NorthlineSprintTask[] {
    const baseDate = startOfNextBusinessDay();
    const tasks: Array<{
      dayOffset: number;
      dayPart: NorthlineDayPart;
      phase: NorthlineSprintTask["phase"];
      title: string;
      output: string;
      notes: string[];
    }> = [
      {
        dayOffset: 0,
        dayPart: "morning",
        phase: "setup",
        title: "Lock the ICP, service area, and first offer lane",
        output: "One-page operator profile and one metro or territory target",
        notes: [
          `Stay inside ${profile.targetIndustries.join(", ")} for the first outbound batch.`,
          "Do not broaden the niche until three proof assets exist."
        ]
      },
      {
        dayOffset: 0,
        dayPart: "midday",
        phase: "research",
        title: "Build the first 25-account prospect list",
        output: "Prospect batch A with owner contact, site URL, and top friction notes",
        notes: [
          "Pull one niche in one geography only.",
          "Capture website, phone number, GBP link if present, and review count."
        ]
      },
      {
        dayOffset: 1,
        dayPart: "morning",
        phase: "sales",
        title: "Draft teardown notes for batch A",
        output: "25 personalized observations tied to homepage, CTA, review, or missed-call friction",
        notes: [
          "Lead with one visible leak, not a full audit.",
          "Keep each teardown observation specific enough that it cannot be mistaken for spam."
        ]
      },
      {
        dayOffset: 1,
        dayPart: "evening",
        phase: "sales",
        title: "Send the first 10 teardown emails",
        output: "Outbound batch A1",
        notes: [
          "Send only fully personalized messages.",
          "Route replies into intake or booking immediately."
        ]
      },
      {
        dayOffset: 2,
        dayPart: "midday",
        phase: "sales",
        title: "Send the remaining 15 teardown emails",
        output: "Outbound batch A2",
        notes: [
          "Reuse the same core offer, but keep the friction note account-specific.",
          "Book calls before offering a full rebuild scope."
        ]
      },
      {
        dayOffset: 3,
        dayPart: "morning",
        phase: "follow_up",
        title: "Send follow-up one to batch A",
        output: "First follow-up pass",
        notes: [
          "Reference the original teardown note.",
          "Move the CTA toward intake or booking, not a long pitch."
        ]
      },
      {
        dayOffset: 4,
        dayPart: "morning",
        phase: "research",
        title: "Build the second 25-account prospect list",
        output: "Prospect batch B",
        notes: [
          "Repeat the same niche and geography.",
          "Tighten the list based on what did and did not reply from batch A."
        ]
      },
      {
        dayOffset: 5,
        dayPart: "evening",
        phase: "sales",
        title: "Send the second outbound batch",
        output: "Outbound batch B",
        notes: [
          "Use the best-performing subject line and teardown angle from batch A.",
          "Do not change the offer and geography at the same time."
        ]
      },
      {
        dayOffset: 6,
        dayPart: "midday",
        phase: "conversion",
        title: "Book calls and convert replies into active intake",
        output: "Qualified intake queue and next-step decisions",
        notes: [
          "Every positive reply should end in either a booked call or a submitted intake.",
          "Discard leads that only want free consulting."
        ]
      },
      {
        dayOffset: 7,
        dayPart: "morning",
        phase: "proof",
        title: "Convert the first delivery into proof",
        output: "One screenshot set, one testimonial request, and one review ask",
        notes: [
          "Proof should ship immediately after a visible client win.",
          "One delivered pilot should produce multiple trust assets."
        ]
      }
    ];

    return tasks.map((task, index) => ({
      id: `${businessId}-outbound-sprint-${index + 1}`,
      businessId,
      scheduledFor: dateAtDayPart(baseDate, task.dayOffset, task.dayPart, `${businessId}-${index + 1}`),
      dayPart: task.dayPart,
      phase: task.phase,
      title: task.title,
      output: task.output,
      notes: task.notes
    }));
  }

  private buildSocialPlan(
    businessId: string,
    state: NorthlineState
  ): NorthlineSocialPost[] {
    const baseDate = startOfNextBusinessDay();
    const primaryCta = state.bookingReady
      ? "Book a strategy call."
      : state.leadFormReady
        ? "Send the operator intake."
        : "Reply for a teardown review.";
    const platforms: Array<NorthlineSocialPost["platform"]> =
      state.socialPlatformsLive.includes("facebook_page") ||
      state.socialPlatformsLive.includes("instagram_account") ||
      state.socialPlatformsLive.includes("linkedin")
        ? [
            state.socialPlatformsLive.includes("linkedin") ? "linkedin" : undefined,
            state.socialPlatformsLive.includes("facebook_page") ? "facebook_page" : undefined,
            state.socialPlatformsLive.includes("instagram_account") ? "instagram_account" : undefined
          ].filter((platform): platform is NorthlineSocialPost["platform"] => Boolean(platform))
        : ["linkedin", "facebook_page", "instagram_account"];

    const seeds: Array<{
      dayOffset: number;
      dayPart: NorthlineDayPart;
      platform: NorthlineSocialPost["platform"];
      angle: string;
      cta: string;
      notes: string[];
    }> = [
      {
        dayOffset: 0,
        dayPart: "evening",
        platform: platforms[0] ?? "linkedin",
        angle: "Three homepage leaks that cost home-service operators booked jobs",
        cta: primaryCta,
        notes: ["Use one screenshot or a text-led post.", "Keep the point of view direct and local."]
      },
      {
        dayOffset: 2,
        dayPart: "midday",
        platform: platforms[1] ?? "facebook_page",
        angle: "Why Northline fixes the close path before anyone buys more traffic",
        cta: primaryCta,
        notes: ["Frame this around wasted clicks, missed calls, and weak CTAs."]
      },
      {
        dayOffset: 3,
        dayPart: "evening",
        platform: platforms[2] ?? "instagram_account",
        angle: "Missed-call recovery matters more than most operators think",
        cta: primaryCta,
        notes: ["Carousel or short reel format is fine.", "Use one practical script or screenshot."]
      },
      {
        dayOffset: 5,
        dayPart: "midday",
        platform: platforms[0] ?? "linkedin",
        angle: "The simplest review loop a plumbing or HVAC operator can actually keep running",
        cta: primaryCta,
        notes: ["Focus on operational simplicity, not vague reputation language."]
      },
      {
        dayOffset: 7,
        dayPart: "evening",
        platform: platforms[1] ?? "facebook_page",
        angle: "What a good landing page should do in the first five seconds on mobile",
        cta: primaryCta,
        notes: ["Use a before-and-after crop once a live client exists."]
      },
      {
        dayOffset: 9,
        dayPart: "midday",
        platform: platforms[2] ?? "instagram_account",
        angle: "Northline pilot slots stay small on purpose",
        cta: primaryCta,
        notes: ["This is a trust post, not a hype post.", "Reinforce fast delivery and limited scope."]
      }
    ];

    return seeds.map((seed, index) => ({
      id: `${businessId}-social-post-${index + 1}`,
      businessId,
      platform: seed.platform,
      scheduledFor: dateAtDayPart(baseDate, seed.dayOffset, seed.dayPart, `${businessId}-social-${index + 1}`),
      dayPart: seed.dayPart,
      angle: seed.angle,
      cta: seed.cta,
      notes: seed.notes
    }));
  }

  private buildOperatingMode(
    businessId: string,
    businessName: string,
    state: NorthlineState
  ): NorthlineOperatingModeState {
    const promotionCriteria: NorthlinePromotionCriterion[] = [
      {
        id: "validation-charge",
        label: "One successful real validation charge",
        status: state.validationSuccessfulRuns >= 1 ? "met" : "missing",
        summary: "Autonomous mode should only start after one real /validation.html checkout is recorded end to end.",
        evidence: [
          `Successful validation confirmations: ${state.validationSuccessfulRuns}`,
          state.validationLatestSuccessfulRunAt
            ? `Latest successful hosted validation result: ${state.validationLatestSuccessfulRunAt}`
            : "No successful hosted validation result is recorded yet."
        ],
        nextSteps: [
          state.validationSuccessfulRuns >= 1
            ? undefined
            : "Complete one real /validation.html checkout and confirm the hosted validation status records a successful result."
        ].filter((step): step is string => Boolean(step))
      },
      {
        id: "paid-pilot-deliveries",
        label: "Three paid explicitly external clients delivered end to end",
        status: state.paidDeliveredClientCount >= 3 ? "met" : "missing",
        summary:
          "Northline should not promote beyond controlled launch until three explicitly external clients have actually moved through paid delivery and client handoff.",
        evidence: [
          `Paid or retainer-active explicitly external clients with a completed handoff package: ${state.paidDeliveredClientCount}`,
          `QA-passed or handed-off clients tracked: ${state.deliveredClientCount}`
        ],
        nextSteps: [
          state.paidDeliveredClientCount >= 3
            ? undefined
            : "Keep the first cohort narrow and move three paid explicitly external clients all the way through client handoff before treating the lane as autonomous."
        ].filter((step): step is string => Boolean(step))
      },
      {
        id: "qa-stability",
        label: "Zero unresolved QA-stall tasks across the latest three deliveries",
        status:
          state.latestDeliveredClientCount >= 3 && state.latestDeliveredQaStallCount === 0
            ? "met"
            : "missing",
        summary: "The latest three paid deliveries should be free of open QA-stall approvals before the lane is promoted.",
        evidence: [
          `Latest paid deliveries available for this check: ${state.latestDeliveredClientCount}`,
          `Open QA-stall approvals across the latest paid deliveries: ${state.latestDeliveredQaStallCount}`
        ],
        nextSteps: [
          state.latestDeliveredClientCount >= 3 && state.latestDeliveredQaStallCount === 0
            ? undefined
            : "Close the current QA-stall approvals and keep the last three paid deliveries clean before removing the controlled-launch label."
        ].filter((step): step is string => Boolean(step))
      },
      {
        id: "vps-send-reply-loop",
        label: "One working VPS send-and-reply loop for at least 7 days",
        status: state.longestReplyLoopDays >= 7 ? "met" : "missing",
        summary: "Autonomous mode needs proof that the VPS outbound sender and inbox sync path work over time, not only on a same-day smoke test.",
        evidence: [
          `Lead threads with both an automated send receipt and an automated inbox-synced reply: ${state.sendAndReplyLoopCount}`,
          `Longest observed VPS send-to-now window with a reply on the same lead: ${state.longestReplyLoopDays} day(s)`
        ],
        nextSteps: [
          state.longestReplyLoopDays >= 7
            ? undefined
            : "Keep the VPS outbound sender and inbox sync healthy until at least one sent lead also has an automated synced reply on a thread that has stayed active for seven days."
        ].filter((step): step is string => Boolean(step))
      },
      {
        id: "proof-mix",
        label: "Published proof mix: screenshot set, testimonial snippet, and review ask or result",
        status:
          state.screenshotBundleCount > 0 &&
          state.testimonialSnippetCount > 0 &&
          (state.reviewSnippetCount > 0 || state.reviewRequestCount > 0)
            ? "met"
            : "missing",
        summary:
          "Northline should graduate only after the external proof cohort carries a real screenshot set, testimonial language, and a review ask or result.",
        evidence: [
          `Proof bundles with screenshots: ${state.screenshotBundleCount}`,
          `Clients carrying testimonial snippets or proof quotes: ${state.testimonialSnippetCount}`,
          `Stored review snippets: ${state.reviewSnippetCount}; review-request drafts in proof bundles: ${state.reviewRequestCount}`
        ],
        nextSteps: [
          state.screenshotBundleCount > 0 &&
          state.testimonialSnippetCount > 0 &&
          (state.reviewSnippetCount > 0 || state.reviewRequestCount > 0)
            ? undefined
            : "Publish at least one screenshot bundle, one testimonial snippet, and one review ask or review result before treating the lane as autonomous."
        ].filter((step): step is string => Boolean(step))
      }
    ];
    const metCount = promotionCriteria.filter((criterion) => criterion.status === "met").length;
    const current =
      promotionCriteria.every((criterion) => criterion.status === "met")
        ? "autonomous"
        : "controlled_launch";

    return {
      current,
      summary:
        current === "autonomous"
          ? `${businessName} has met the proof-cohort criteria for autonomous VPS operation.`
          : `${businessName} stays in controlled launch mode until the explicit external proof cohort and VPS reliability criteria are met.`,
      evidence: [
        `Promotion criteria met: ${metCount}/${promotionCriteria.length}.`,
        `Current validation confirmations: ${state.validationSuccessfulRuns}.`,
        `Paid handed-off explicitly external clients: ${state.paidDeliveredClientCount}.`
      ],
      scheduledAutomation: [
        `scripts/imon-engine-sync.sh runs npm run dev -- engine-sync and npm run dev -- northline-autonomy-run --business ${businessId} --notify-roadblocks.`,
        "scripts/install-cron.sh installs the shared wrapper on a 30-minute VPS cadence.",
        `scripts/run_vps_autopilot.sh runs the same Northline pass for ${businessId} inside the wider VPS work unit.`
      ],
      manualCheckpoints: [
        "Live payment authorization still stays manual.",
        "Disputed or ambiguous replies still require human review.",
        "Public proof publication review stays manual before a new client artifact is promoted broadly.",
        "Client-managed publish troubleshooting stays manual when a handoff needs host-specific intervention."
      ],
      promotionCriteria
    };
  }

  private buildProofAssets(
    state: NorthlineState,
    profile: ResolvedNorthlineBusinessProfile
  ): NorthlineProofAsset[] {
    return [
      {
        id: "pilot-clients",
        area: "External proof client count",
        status: state.clientCount >= 3 ? "ready" : "missing",
        summary:
          "Northline should close the first three explicitly external clients before broad paid acquisition starts.",
        evidence: [`Tracked Northline clients: ${state.clientCount}`],
        nextSteps: [
          "Use the outbound sprint to close the first three operators in one niche and geography.",
          "Avoid expanding the offer while pilot delivery is still proving itself."
        ]
      },
      {
        id: "delivery-screenshots",
        area: "Before and after screenshots",
        status: state.screenshotBundleCount > 0 ? "ready" : "missing",
        summary: "Each delivered explicitly external client should create homepage, CTA, and review-loop screenshots.",
        evidence: [
          `Proof bundles with captured screenshots: ${state.screenshotBundleCount}`,
          `Handed-off or QA-passed Northline clients: ${state.deliveredClientCount}`
        ],
        nextSteps: [
          "Refresh the client proof bundle after QA passes so desktop and mobile screenshots are captured.",
          "Publish one homepage or CTA path screenshot set on the hosted proof page."
        ]
      },
      {
        id: "testimonial-bank",
        area: "Testimonials and review snippets",
        status: state.testimonialCount >= 3 ? "ready" : "missing",
        summary: "Northline needs real language from operators, not only internal claims.",
        evidence: [
          `Stored testimonial or review snippets across client assets: ${state.testimonialCount}`,
          `Proof bundles packaged for publication: ${state.proofBundleCount}`
        ],
        nextSteps: [
          "Request a written testimonial immediately after the first visible win.",
          "Store review snippets inside the client asset record or the live site."
        ]
      },
      {
        id: "public-proof-page",
        area: "Public proof page",
        status: state.siteReady ? "ready" : "missing",
        summary: "Northline needs a lightweight public page where outbound prospects can verify the offer and convert.",
        evidence: [
          state.siteReady
            ? `Hosted proof page: ${profile.siteUrl}`
            : "Hosted proof page URL is still missing.",
          `Published proof bundles ready for the site: ${state.proofBundleCount}`
        ],
        nextSteps: [
          "Keep the hosted proof page live and current with Stripe links and intake routing.",
          "Publish before-and-after screenshots and testimonial snippets there as soon as the first pilot ships."
        ]
      },
      {
        id: "distribution-surfaces",
        area: "Proof distribution surfaces",
        status: state.socialPlatformsLive.length > 0 || state.siteReady ? "ready" : "missing",
        summary: "Proof only compounds if Northline has a place to publish it, whether that is the site, social, or both.",
        evidence: [
          state.socialPlatformsLive.length > 0
            ? `Live proof surfaces: ${state.socialPlatformsLive.join(", ")}`
            : state.siteReady
              ? `Hosted proof page: ${profile.siteUrl}`
              : "No live proof page or social surface is configured."
        ],
        nextSteps: [
          "Publish every proof asset on the hosted page, a live social surface, or both.",
          "Set at least one of NORTHLINE_FACEBOOK_URL, NORTHLINE_INSTAGRAM_URL, or NORTHLINE_LINKEDIN_URL if you want social distribution early."
        ]
      }
    ];
  }

  private buildRoadblocks(
    businessName: string,
    state: NorthlineState,
    readiness: NorthlineReadinessItem[]
  ): NorthlineRoadblock[] {
    const roadblocks: NorthlineRoadblock[] = [];
    const readinessMap = new Map(readiness.map((item) => [item.id, item]));

    const publicSurface = readinessMap.get("public-surface");
    if (publicSurface && publicSurface.status !== "live") {
      if (!state.siteReady) {
        roadblocks.push({
          id: "public-surface",
          category: "Public proof page",
          summary: `${businessName} still needs a public proof page before outbound and checkout links have a credible destination.`,
          requiredFromOwner: publicSurface.nextSteps,
          continueAfterCompletion: [
            "Northline can send cold outbound and referrals to one hosted proof page.",
            "The checkout links and intake path can live behind one consistent public surface."
          ]
        });
      }
    }

    const contactRouting = readinessMap.get("contact-routing");
    if (contactRouting && contactRouting.status !== "live") {
      const missing: string[] = [];
      if (!state.brandedInboxReady) {
        missing.push("branded inbox");
      }
      if (!state.bookingReady && !state.leadFormReady) {
        missing.push("booking link or lead-form endpoint");
      }
      roadblocks.push({
        id: "contact-routing",
        category: "Contact routing",
        summary: `${businessName} still needs ${formatList(missing)} before replies and paid traffic can convert cleanly.`,
        requiredFromOwner: contactRouting.nextSteps,
        continueAfterCompletion: [
          "Reply traffic can move into a tracked intake path.",
          "Northline can route leads into either booking or intake without manual patchwork."
        ]
      });
    }

    const paymentCollection = readinessMap.get("payment-collection");
    if (paymentCollection && paymentCollection.status !== "live") {
      roadblocks.push({
        id: "payment-collection",
        category: "Payment collection",
        summary: `${businessName} cannot collect setup fees or retainers yet because one or both Stripe links are still missing.`,
        requiredFromOwner: paymentCollection.nextSteps,
        continueAfterCompletion: [
          "Northline can move from proposal to paid client delivery without manual invoicing workarounds.",
          "The site and outbound follow-up can link directly to live payment collection."
        ]
      });
    }

    const validationProof = readinessMap.get("validation-proof");
    if (validationProof && validationProof.status !== "live") {
      roadblocks.push({
        id: "validation-proof",
        category: "Controlled launch proof-of-life",
        summary: `${businessName} still needs one real /validation.html system check before the controlled launch can be treated as proven.`,
        requiredFromOwner: validationProof.nextSteps,
        continueAfterCompletion: [
          "Northline will have one real money-movement proof point recorded in the hosted validation store.",
          "The launch dossier can distinguish a live configured site from a live validated lane."
        ]
      });
    }

    const localTrust = readinessMap.get("local-trust");
    if (localTrust && localTrust.status !== "live" && localTrust.nextSteps.length > 0) {
      // Optional layer only; keep it visible in readiness but do not block launch.
    }

    return roadblocks;
  }

  private async writeArtifacts(
    baseDir: string,
    plan: NorthlineAutomationPlan
  ): Promise<{
    planJsonPath: string;
    planMarkdownPath: string;
    readinessPath: string;
    outboundSprintPath: string;
    socialPlanPath: string;
    proofAssetsPath: string;
    roadblocksPath: string;
  }> {
    const planJsonPath = path.join(baseDir, "plan.json");
    const planMarkdownPath = path.join(baseDir, "plan.md");
    const readinessPath = path.join(baseDir, "readiness.json");
    const outboundSprintPath = path.join(baseDir, "outbound-sprint.md");
    const socialPlanPath = path.join(baseDir, "social-plan.json");
    const proofAssetsPath = path.join(baseDir, "proof-assets.json");
    const roadblocksPath = path.join(baseDir, "roadblocks.json");

    await writeJsonFile(planJsonPath, plan);
    await writeJsonFile(readinessPath, plan.readiness);
    await writeTextFile(planMarkdownPath, this.toMarkdown(plan));
    await writeTextFile(outboundSprintPath, this.outboundSprintMarkdown(plan));
    await writeJsonFile(socialPlanPath, plan.socialPlan);
    await writeJsonFile(proofAssetsPath, plan.proofAssets);
    await writeJsonFile(roadblocksPath, plan.roadblocks);

    return {
      planJsonPath,
      planMarkdownPath,
      readinessPath,
      outboundSprintPath,
      socialPlanPath,
      proofAssetsPath,
      roadblocksPath
    };
  }

  private async updateBusinessState(
    business: ManagedBusiness,
    plan: NorthlineAutomationPlan
  ): Promise<void> {
    const nextStage = business.stage === "active" ? "active" : plan.roadblocks.length > 0 ? "paused" : "ready";
    const steadyStateOwnerActions =
      plan.operatingMode.current === "autonomous"
        ? [
            "Keep the VPS wrappers running and intervene only on the explicit manual checkpoints.",
            "Authorize live payments, disputed or ambiguous replies, public proof publication, and any exception rollback decisions.",
            "Use the autonomy summary to review exceptions instead of treating the lane like a daily manual checklist."
          ]
        : [
            "Start the outbound sprint and close the first three explicitly external operators.",
            "Turn each delivery into screenshots, testimonials, and public proof on the hosted page or social surfaces.",
            "Add optional trust layers like booking, phone, Google Business Profile, reviews, and SMTP only when they support the live funnel."
          ];
    const ownerActions =
      plan.roadblocks.length > 0
        ? [...new Set(plan.roadblocks.flatMap((roadblock) => roadblock.requiredFromOwner))]
        : steadyStateOwnerActions;
    const notes = [
      ...business.notes.filter(
        (note) =>
          !note.startsWith("Northline plan refreshed") &&
          !note.startsWith("Northline operating mode:") &&
          !note.startsWith("Current sales inbox:") &&
          !note.includes("runtime/ops/northline-growth-system")
      ),
      `Northline plan refreshed ${plan.generatedAt}.`,
      `Northline operating mode: ${plan.operatingMode.current}.`,
      `Current sales inbox: ${plan.salesEmail}.`,
      `The Northline launch dossier lives under ${
        business.id === NORTHLINE_BUSINESS_ID
          ? "runtime/ops/northline-growth-system"
          : `runtime/ops/northline-growth-system/${business.id}`
      }.`
    ];
    await this.store.saveManagedBusiness({
      ...business,
      stage: nextStage,
      ownerActions,
      launchBlockers: plan.roadblocks.map((roadblock) => roadblock.summary),
      notes: [...new Set(notes)],
      updatedAt: nowIso()
    });
  }

  private offerLine(offer: OfferConfig): string {
    return `${offer.name}: $${offer.setupPrice} setup + $${offer.monthlyPrice}/mo for ${offer.audience}.`;
  }

  private async readValidationProofState(businessId: string): Promise<NorthlineValidationProofState> {
    if (businessId !== NORTHLINE_BUSINESS_ID) {
      return {
        successfulRuns: 0
      };
    }

    const store = await readJsonFile<NorthlineValidationConfirmationStore>(
      path.join(this.config.stateDir, "northlineValidationConfirmations.json"),
      { confirmations: [] }
    );
    const confirmations = store.confirmations ?? [];
    const successful = confirmations.filter(
      (record) => record.lastStripeCompletedAt && record.lastResult?.status === "success"
    );

    return {
      latestStripeCompletedAt: latestIso(confirmations.map((record) => record.lastStripeCompletedAt)),
      latestSuccessfulRunAt: latestIso(
        successful.map((record) => record.lastConfirmedAt ?? record.lastStripeCompletedAt)
      ),
      successfulRuns: successful.length
    };
  }

  private toMarkdown(plan: NorthlineAutomationPlan): string {
    return [
      `# ${plan.businessName} Growth System`,
      "",
      `Generated at: ${plan.generatedAt}`,
      `Status: ${plan.status}`,
      `Operating mode: ${plan.operatingMode.current}`,
      `Primary service area: ${plan.primaryServiceArea ?? "Not configured yet"}`,
      `Collection areas: ${plan.collectionAreas.join(", ") || "Not configured yet"}`,
      `Collection trades: ${plan.collectionTrades.join(", ") || "Not configured yet"}`,
      `Target industries: ${plan.targetIndustries.join(", ") || "Not configured yet"}`,
      `Target services: ${plan.targetServices.join(", ") || "Not configured yet"}`,
      `Offer summary: ${plan.offerSummary}`,
      `Sales inbox: ${plan.salesEmail}`,
      `Site URL: ${plan.siteUrl}`,
      "",
      "## Operating Mode",
      `- Current mode: ${plan.operatingMode.current}`,
      `- Summary: ${plan.operatingMode.summary}`,
      ...plan.operatingMode.evidence.map((entry) => `- Evidence: ${entry}`),
      ...plan.operatingMode.scheduledAutomation.map((entry) => `- Scheduled automation: ${entry}`),
      ...plan.operatingMode.manualCheckpoints.map((entry) => `- Manual checkpoint: ${entry}`),
      ...plan.operatingMode.promotionCriteria.flatMap((criterion) => [
        `### ${criterion.label}`,
        `- Status: ${criterion.status}`,
        `- Summary: ${criterion.summary}`,
        ...criterion.evidence.map((entry) => `- Evidence: ${entry}`),
        ...criterion.nextSteps.map((entry) => `- Next step: ${entry}`),
        ""
      ]),
      "## Offer Stack",
      ...plan.offerStack.map((offer) => `- ${this.offerLine(offer)}`),
      "",
      "## Readiness",
      ...plan.readiness.flatMap((item) => [
        `### ${item.area}`,
        `- Status: ${item.status}`,
        `- Summary: ${item.summary}`,
        ...item.evidence.map((entry) => `- Evidence: ${entry}`),
        ...item.nextSteps.map((entry) => `- Next step: ${entry}`),
        ""
      ]),
      "## Outbound Sprint",
      ...plan.outboundSprint.map(
        (task) =>
          `- ${task.scheduledFor}: [${task.phase}] ${task.title} -> ${task.output}`
      ),
      "",
      "## Social Plan",
      ...plan.socialPlan.map(
        (post) =>
          `- ${post.scheduledFor}: ${platformLabel(post.platform)} -> ${post.angle} CTA: ${post.cta}`
      ),
      "",
      "## Proof Assets",
      ...plan.proofAssets.flatMap((asset) => [
        `### ${asset.area}`,
        `- Status: ${asset.status}`,
        `- Summary: ${asset.summary}`,
        ...asset.evidence.map((entry) => `- Evidence: ${entry}`),
        ...asset.nextSteps.map((entry) => `- Next step: ${entry}`),
        ""
      ]),
      "## Roadblocks",
      ...(plan.roadblocks.length > 0
        ? plan.roadblocks.flatMap((roadblock) => [
            `### ${roadblock.category}`,
            `- ${roadblock.summary}`,
            ...roadblock.requiredFromOwner.map((entry) => `- Required from you: ${entry}`),
            ...roadblock.continueAfterCompletion.map((entry) => `- After completion: ${entry}`),
            ""
          ])
        : ["- No Northline roadblocks are currently detected.", ""]),
      "## Next Automation Steps",
      ...plan.nextAutomationSteps.map((step) => `- ${step}`),
      ""
    ].join("\n");
  }

  private outboundSprintMarkdown(plan: NorthlineAutomationPlan): string {
    return [
      `# ${plan.businessName} Outbound Sprint`,
      "",
      `Generated at: ${plan.generatedAt}`,
      "",
      ...plan.outboundSprint.flatMap((task) => [
        `## ${task.title}`,
        `- When: ${task.scheduledFor} (${dayPartLabel(task.dayPart)})`,
        `- Phase: ${task.phase}`,
        `- Output: ${task.output}`,
        ...task.notes.map((note) => `- Note: ${note}`),
        ""
      ])
    ].join("\n");
  }
}
