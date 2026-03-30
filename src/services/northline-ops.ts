import path from "node:path";
import type { AppConfig } from "../config.js";
import type { OfferConfig } from "../domain/contracts.js";
import { DEFAULT_AGENCY_PROFILE } from "../domain/defaults.js";
import type { ManagedBusiness } from "../domain/engine.js";
import type {
  NorthlineAutomationPlan,
  NorthlineDayPart,
  NorthlineProofAsset,
  NorthlineReadinessItem,
  NorthlineRoadblock,
  NorthlineSocialPost,
  NorthlineSprintTask
} from "../domain/northline.js";
import type { SocialProfileRecord } from "../domain/social.js";
import { ensureDir, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { FileStore } from "../storage/store.js";
import { StoreOpsService } from "./store-ops.js";

const NORTHLINE_BUSINESS_ID = "auto-funding-agency";
const TZ = "America/New_York";
const DAY_PART_WINDOWS = {
  morning: { startHour: 8, endHour: 10 },
  midday: { startHour: 12, endHour: 14 },
  evening: { startHour: 17, endHour: 19 }
} as const;

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
  ownerApprovalReady: boolean;
  phoneReady: boolean;
  reviewReady: boolean;
  salesEmail: string;
  siteReady: boolean;
  smtpReady: boolean;
  socialPlatformsLive: string[];
  socialPlatformsScaffolded: string[];
  stripeReady: boolean;
  testimonialCount: number;
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

    const baseDir = path.join(this.config.opsDir, "northline-growth-system");
    await ensureDir(baseDir);

    const [offers, clients] = await Promise.all([this.store.getOffers(), this.store.getClients()]);
    const activeOffers = offers.filter((offer) => offer.active);
    const northlineClients = clients.filter((client) => client.businessId === business.id);

    const storeOps = new StoreOpsService(this.config, this.store);
    const socialProfiles = await storeOps.ensureSocialProfiles(business.id, business.name);
    await storeOps.writeSocialArtifacts(await this.store.getSocialProfiles());

    const state = this.buildState(northlineClients, socialProfiles);
    const readiness = this.buildReadiness(state, socialProfiles);
    const outboundSprint = this.buildOutboundSprint(business.id);
    const socialPlan = this.buildSocialPlan(business.id, state);
    const proofAssets = this.buildProofAssets(state);
    const roadblocks = this.buildRoadblocks(business.name, state, readiness);

    const plan: NorthlineAutomationPlan = {
      businessId: business.id,
      businessName: business.name,
      generatedAt: nowIso(),
      status: roadblocks.length > 0 ? "blocked" : "ready",
      primaryServiceArea: this.config.business.primaryServiceArea?.trim() || undefined,
      salesEmail: this.config.business.salesEmail,
      siteUrl: this.config.business.siteUrl,
      offerStack: activeOffers,
      readiness,
      outboundSprint,
      socialPlan,
      proofAssets,
      roadblocks,
      nextAutomationSteps: [
        `Use ${path.join(this.config.opsDir, "northline-growth-system", "outbound-sprint.md")} as the first 7-day operating rhythm.`,
        "Do not buy traffic until the proof page, branded inbox, intake path, and payment links are live.",
        "Convert the first delivery into a screenshot set, testimonial, and review request within 24 hours of client approval.",
        "Use the tracked client brief template at examples/briefs/northline-pilot-template.json for the first pilot account.",
        `Keep Northline focused on ${DEFAULT_AGENCY_PROFILE.industries.join(", ")} until the first three proof assets exist.`
      ]
    };

    const artifacts = await this.writeArtifacts(baseDir, plan);
    await this.updateBusinessState(business, plan);

    return {
      plan,
      artifacts
    };
  }

  private buildState(
    clients: Awaited<ReturnType<FileStore["getClients"]>>,
    socialProfiles: SocialProfileRecord[]
  ): NorthlineState {
    const testimonialCount = clients.reduce(
      (sum, client) =>
        sum +
        (client.assets.testimonials?.length ?? 0) +
        (client.assets.reviews?.length ?? 0),
      0
    );
    const deliveredClientCount = clients.filter(
      (client) => ["ready", "deployed"].includes(client.siteStatus) || client.qaStatus === "passed"
    ).length;
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
      brandedInboxReady: isBrandedInbox(this.config.business.salesEmail, this.config.business.domain),
      bookingReady: !isPlaceholderRouteOrUrl(this.config.business.bookingUrl),
      clientCount: clients.length,
      deliveredClientCount,
      domainReady: !isPlaceholderDomain(this.config.business.domain),
      gbpReady: !isPlaceholderUrl(this.config.business.googleBusinessProfileUrl),
      leadFormReady: !isPlaceholderEndpoint(this.config.business.leadFormAction),
      ownerApprovalReady: !isPlaceholderEmail(this.config.business.approvalEmail),
      phoneReady: !isPlaceholderPhone(this.config.business.phone),
      reviewReady: !isPlaceholderUrl(this.config.business.googleReviewUrl),
      salesEmail: this.config.business.salesEmail,
      siteReady: !isPlaceholderUrl(this.config.business.siteUrl),
      smtpReady: Boolean(this.config.smtp),
      socialPlatformsLive,
      socialPlatformsScaffolded,
      stripeReady:
        !isPlaceholderUrl(this.config.business.stripeFounding) &&
        !isPlaceholderUrl(this.config.business.stripeStandard),
      testimonialCount
    };
  }

  private buildReadiness(
    state: NorthlineState,
    socialProfiles: SocialProfileRecord[]
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
      isPlaceholderUrl(this.config.business.stripeFounding)
        ? "Set NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING."
        : undefined,
      isPlaceholderUrl(this.config.business.stripeStandard)
        ? "Set NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD."
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

    return [
      {
        id: "public-surface",
        area: "Public proof page",
        status: capabilityStatus(publicSurfaceCompleted, 1),
        summary: "Northline needs one public proof page before cold outbound, referrals, and Stripe links have something credible to point at.",
        evidence: [
          state.siteReady
            ? `Proof page configured: ${this.config.business.siteUrl}`
            : "Proof page URL is still placeholder or missing.",
          state.domainReady
            ? `Inbox domain available: ${this.config.business.domain}`
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
            ? `Branded inbox ready: ${this.config.business.salesEmail}`
            : "Inbox is missing or not on the Northline domain.",
          state.bookingReady
            ? `Booking URL configured: ${this.config.business.bookingUrl}`
            : state.leadFormReady
              ? "Booking URL is still missing, but the hosted intake path is live."
              : "Booking URL is still missing.",
          state.leadFormReady
            ? `Lead form action configured: ${this.config.business.leadFormAction}`
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
        summary: "Northline needs both Stripe links live before setup fees or retainers can be collected cleanly.",
        evidence: [
          !isPlaceholderUrl(this.config.business.stripeFounding)
            ? "Founding offer payment link is configured."
            : "Founding offer payment link is missing.",
          !isPlaceholderUrl(this.config.business.stripeStandard)
            ? "Standard offer payment link is configured."
            : "Standard offer payment link is missing."
        ],
        nextSteps: paymentNextSteps
      },
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
  }

  private buildOutboundSprint(businessId: string): NorthlineSprintTask[] {
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
          `Stay inside ${DEFAULT_AGENCY_PROFILE.industries.join(", ")} for the first outbound batch.`,
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

  private buildProofAssets(state: NorthlineState): NorthlineProofAsset[] {
    return [
      {
        id: "pilot-clients",
        area: "Pilot client count",
        status: state.clientCount >= 3 ? "ready" : "missing",
        summary: "Northline should win the first three pilot operators before broad paid acquisition starts.",
        evidence: [`Tracked Northline clients: ${state.clientCount}`],
        nextSteps: [
          "Use the outbound sprint to close the first three operators in one niche and geography.",
          "Avoid expanding the offer while pilot delivery is still proving itself."
        ]
      },
      {
        id: "delivery-screenshots",
        area: "Before and after screenshots",
        status: state.deliveredClientCount > 0 ? "ready" : "missing",
        summary: "Each delivered pilot should create homepage, CTA, and review-loop screenshots.",
        evidence: [`Delivered or QA-passed Northline clients: ${state.deliveredClientCount}`],
        nextSteps: [
          "Save one homepage before-and-after pair.",
          "Save one landing page or CTA path screenshot set."
        ]
      },
      {
        id: "testimonial-bank",
        area: "Testimonials and review snippets",
        status: state.testimonialCount >= 3 ? "ready" : "missing",
        summary: "Northline needs real language from operators, not only internal claims.",
        evidence: [`Stored testimonial or review snippets across client assets: ${state.testimonialCount}`],
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
            ? `Hosted proof page: ${this.config.business.siteUrl}`
            : "Hosted proof page URL is still missing."
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
              ? `Hosted proof page: ${this.config.business.siteUrl}`
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
          "Northline can move from proposal to paid pilot without manual invoicing workarounds.",
          "The site and outbound follow-up can link directly to live payment collection."
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
    const steadyStateOwnerActions = [
      "Start the outbound sprint and close the first three pilot operators.",
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
          !note.startsWith("Current sales inbox:") &&
          !note.includes("runtime/ops/northline-growth-system")
      ),
      `Northline plan refreshed ${plan.generatedAt}.`,
      `Current sales inbox: ${plan.salesEmail}.`,
      "The Northline launch dossier lives under runtime/ops/northline-growth-system."
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

  private toMarkdown(plan: NorthlineAutomationPlan): string {
    return [
      `# ${plan.businessName} Growth System`,
      "",
      `Generated at: ${plan.generatedAt}`,
      `Status: ${plan.status}`,
      `Primary service area: ${plan.primaryServiceArea ?? "Not configured yet"}`,
      `Sales inbox: ${plan.salesEmail}`,
      `Site URL: ${plan.siteUrl}`,
      "",
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
