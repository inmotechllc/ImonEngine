import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import type { AppConfig } from "../config.js";
import type { ManagedBusiness } from "../domain/engine.js";
import type {
  MicroSaasAdExperiment,
  MicroSaasAutomationPlan,
  MicroSaasChannelSetup,
  MicroSaasIncomeCapability,
  MicroSaasLaunchTask,
  MicroSaasPricingOption,
  MicroSaasProductBrief,
  MicroSaasRoadblock,
  MicroSaasSocialPost
} from "../domain/micro-saas.js";
import type { SocialProfileRecord } from "../domain/social.js";
import { ensureDir, readJsonFile, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { FileStore } from "../storage/store.js";
import { StoreOpsService } from "./store-ops.js";

const execFileAsync = promisify(execFile);
const PYTHON_COMMAND = process.platform === "win32" ? "python" : "python3";
const QUIETPIVOT_BUSINESS_ID = "imon-micro-saas-factory";
const TZ = "America/New_York";
const DAY_PART_WINDOWS = {
  morning: { startHour: 8, endHour: 10 },
  midday: { startHour: 12, endHour: 14 },
  evening: { startHour: 18, endHour: 20 }
} as const;

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

type ProductSeed = Omit<MicroSaasProductBrief, "id" | "businessId">;

const PRODUCT_SEEDS: ProductSeed[] = [
  {
    laneId: "insight-dashboards",
    laneName: "Insight Dashboards",
    productName: "QuietPivot Signal Ledger",
    suggestedSlug: "signal-ledger",
    stage: "primary_mvp",
    audience: "Gumroad-first creators, digital sellers, and solo operators who need verified cash clarity.",
    problem:
      "Most solo operators make reinvestment and cashout decisions from noisy payout deposits instead of verified revenue after fees, refunds, and bank drift.",
    promise:
      "Turn raw marketplace exports into a verified revenue dashboard with allocation guidance, payout visibility, and weekly operator summaries.",
    pricing: [
      {
        label: "Beta waitlist",
        amount: "$0",
        cadence: "beta",
        notes: ["Use this to validate demand before opening paid access."]
      },
      {
        label: "Operator plan",
        amount: "$19",
        cadence: "monthly",
        notes: ["Monthly plan for recurring CSV imports, weekly summaries, and allocation recommendations."]
      },
      {
        label: "Lifetime pilot",
        amount: "$149",
        cadence: "one_time",
        notes: ["Use sparingly for the first five power users who provide setup feedback."]
      }
    ],
    differentiators: [
      "Separates verified revenue from inferred bank activity instead of merging them into one misleading dashboard.",
      "Starts with CSV imports and proof assets you already know how to generate from the existing store-ops modules.",
      "Frames growth decisions around cash discipline, not vanity analytics."
    ],
    mvpFeatures: [
      "CSV import for Gumroad sales exports with verified versus excluded-data labels.",
      "Net revenue snapshot with tax reserve, reinvestment, refund buffer, and collective-transfer guidance.",
      "Basic payout reconciliation view between verified storefront activity and observed bank movement.",
      "Weekly operator summary artifact that can be emailed or exported."
    ],
    launchAssets: [
      "Waitlist landing page with one proof screenshot and one sample allocation table.",
      "Import template and walkthrough copy.",
      "Three-email beta sequence: invite, onboarding, and activation reminder.",
      "One founder thread, one Facebook proof post, and one Insight Dashboards carousel."
    ],
    telemetryEvents: [
      "landing_view",
      "waitlist_signup",
      "sample_report_view",
      "csv_import_started",
      "csv_import_completed",
      "report_generated",
      "upgrade_clicked"
    ],
    successMetrics: [
      "25 qualified waitlist signups in the first 30 days.",
      "5 activated users who complete at least one CSV import.",
      "3 paid conversions from activated users.",
      "Support load under 20 minutes per activated customer per week."
    ],
    implementationAssets: [
      "src/services/store-ops.ts",
      "src/domain/store-ops.ts",
      "src/storage/store.ts",
      "src/services/reports.ts"
    ]
  },
  {
    laneId: "creator-ops",
    laneName: "Creator Ops",
    productName: "QuietPivot Launch Frame",
    suggestedSlug: "launch-frame",
    stage: "backup_mvp",
    audience: "Creators, consultants, and solo operators packaging digital offers without an ops team.",
    problem:
      "Offer launches stall because landing page copy, launch posts, pricing hooks, and CTA sequencing all get rebuilt from scratch every time.",
    promise:
      "Convert one product brief into a lean launch kit with landing-page structure, CTA variants, social hooks, and follow-up prompts.",
    pricing: [
      {
        label: "Waitlist",
        amount: "$0",
        cadence: "beta",
        notes: ["Capture demand before adding automation depth."]
      },
      {
        label: "Starter",
        amount: "$49",
        cadence: "one_time",
        notes: ["One-time template bundle for early users who only need a launch kit."]
      },
      {
        label: "Studio",
        amount: "$12",
        cadence: "monthly",
        notes: ["Monthly plan after recurring launch-kit regeneration is stable."]
      }
    ],
    differentiators: [
      "Grounds launch assets in real workflow outputs instead of generic content prompts.",
      "Fits the same solo-operator audience already served by QuietPivot's organic content lanes.",
      "Can reuse landing-copy and checklist patterns already present in the repo."
    ],
    mvpFeatures: [
      "Offer brief intake with audience, problem, CTA, and proof prompts.",
      "Landing-page section outline with hero, proof strip, FAQ, and CTA matrix.",
      "Launch-post variants for X, Facebook, and Instagram.",
      "Launch checklist with operator review gates."
    ],
    launchAssets: [
      "Landing page explaining the one-brief-to-launch-kit promise.",
      "Before/after launch checklist screenshot.",
      "Creator Ops carousel and short walkthrough clip.",
      "A simple onboarding template that asks for the user's current offer."
    ],
    telemetryEvents: [
      "landing_view",
      "waitlist_signup",
      "brief_started",
      "brief_completed",
      "launch_kit_generated",
      "checkout_clicked"
    ],
    successMetrics: [
      "15 creator waitlist signups.",
      "5 completed briefs.",
      "3 generated launch kits reviewed positively by users."
    ],
    implementationAssets: [
      "src/agents/site-builder.ts",
      "src/services/venture-studio.ts",
      "src/lib/text.ts"
    ]
  },
  {
    laneId: "workflow-agents",
    laneName: "Workflow Agents",
    productName: "QuietPivot QueuePilot",
    suggestedSlug: "queuepilot",
    stage: "future_candidate",
    audience: "Solo operators and tiny teams who lose leads or customer tasks between inboxes and ad-hoc notes.",
    problem:
      "Inbound requests go stale because there is no lightweight queue, triage rule-set, or response drafting loop anchored to one place.",
    promise:
      "Turn inbound requests into a prioritized queue with suggested next actions, response drafts, and follow-up checkpoints.",
    pricing: [
      {
        label: "Waitlist",
        amount: "$0",
        cadence: "beta",
        notes: ["Validate whether the demand is stronger than Launch Frame before building deeper."]
      },
      {
        label: "Ops",
        amount: "$29",
        cadence: "monthly",
        notes: ["Monthly plan once queue routing and draft quality are stable."]
      }
    ],
    differentiators: [
      "Built from workflow routing and reply handling patterns already used inside the repo.",
      "Targets one painful operator problem instead of becoming a broad helpdesk.",
      "Pairs naturally with the Workflow Agents Instagram lane."
    ],
    mvpFeatures: [
      "Simple intake capture and task queue.",
      "Priority labels and next-action suggestions.",
      "Response draft suggestions with approval checkpoints.",
      "Follow-up reminders for aging items."
    ],
    launchAssets: [
      "Explainer landing page focused on saved follow-up time.",
      "Workflow Agents reel showing before/after queue cleanup.",
      "One-page setup guide."
    ],
    telemetryEvents: [
      "landing_view",
      "waitlist_signup",
      "queue_item_created",
      "response_draft_generated",
      "followup_scheduled"
    ],
    successMetrics: [
      "10 workflow-agent waitlist signups.",
      "3 users who test queue setup end to end.",
      "2 users who return for a second session in one week."
    ],
    implementationAssets: [
      "src/agents/orchestrator.ts",
      "src/agents/reply-handler.ts",
      "src/agents/account-ops.ts"
    ]
  }
];

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

function mondayLaunchWindow(reference = new Date()): { startsAt: string; endsAt: string; reason: string } {
  const parts = zonedParts(reference, TZ);
  const candidate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0));
  const daysUntilMonday = parts.weekday === 1 ? 0 : (8 - parts.weekday) % 7;
  candidate.setUTCDate(candidate.getUTCDate() + daysUntilMonday);
  const launchMinute = pick(0, 30, "quietpivot-launch-minute");
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
  const durationMinutes = pick(60, 95, "quietpivot-launch-duration");
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60000);
  return {
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    reason: "QuietPivot launches should start inside the approved Monday 7-9am New York window."
  };
}

function dateAtDayPart(
  baseDate: Date,
  dayOffset: number,
  dayPart: keyof typeof DAY_PART_WINDOWS,
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

function buildAlias(baseEmail: string, brandName: string): string {
  const [local, domain] = baseEmail.split("@");
  if (!local || !domain) {
    return baseEmail;
  }
  return `${local}+${slugify(brandName).replace(/-/g, "")}@${domain}`;
}

function isPlaceholderEmail(value: string | undefined): boolean {
  if (!value || !value.includes("@")) {
    return true;
  }
  return /@(example\.com|example\.org|example\.net)$/i.test(value);
}

function isPlaceholderDomain(value: string | undefined): boolean {
  if (!value) {
    return true;
  }
  return /(^example\.com$|^example\.org$|^example\.net$)/i.test(value);
}

function isPlaceholderUrl(value: string | undefined): boolean {
  if (!value) {
    return true;
  }
  return /example\.(com|org|net)/i.test(value);
}

function hasAnalyticsConfiguration(): boolean {
  return Boolean(process.env.GOOGLE_ANALYTICS_MEASUREMENT_ID) || Boolean(process.env.POSTHOG_API_KEY && process.env.POSTHOG_HOST);
}

function hasMetaAdsConfiguration(): boolean {
  return Boolean(process.env.META_PAGE_ID && process.env.META_AD_ACCOUNT_ID && process.env.META_ACCESS_TOKEN);
}

function profilePurpose(profile: SocialProfileRecord): string {
  switch (profile.platform) {
    case "gmail_alias":
      return "Receive signup codes, support replies, and platform notifications for the QuietPivot umbrella.";
    case "meta_business":
      return "Hold the umbrella Meta asset, page access, and future ad-account permissions.";
    case "facebook_page":
      return "Publish founder notes, proof posts, and future retargeting or lead-ad traffic.";
    case "youtube_channel":
      return profile.role === "niche_lane"
        ? `Reserve a video-first surface for ${profile.laneName ?? "the assigned niche"} without creating extra off-platform identity sprawl.`
        : "Reserve an umbrella video distribution surface for launch clips or proof assets.";
    case "instagram_account":
      return profile.role === "niche_lane"
        ? `Publish lane-specific proof and hooks for ${profile.laneName ?? "the assigned niche"}.`
        : "Publish umbrella QuietPivot proof assets and launch clips.";
    case "x":
      return "Ship text-first launch notes, proof threads, and founder commentary.";
    case "pinterest":
      return "Optional long-tail creative discovery surface.";
    case "gumroad":
      return "Marketplace storefront for digital products when a QuietPivot offer needs one-off checkout.";
  }
}

function profileNextSteps(profile: SocialProfileRecord): string[] {
  switch (profile.platform) {
    case "meta_business":
      return [
        `Add ${profile.brandName} to the parent Meta Business portfolio using ${profile.emailAlias}.`,
        "Keep the asset tied to the umbrella brand instead of creating one Page per niche."
      ];
    case "facebook_page":
      return [
        `Create the umbrella Facebook Page for ${profile.brandName} using ${profile.emailAlias}.`,
        "Use the Page for proof posts, organic distribution, and the future Meta ad account."
      ];
    case "youtube_channel":
      return [
        `Create the YouTube channel ${profile.handle ?? profile.laneName ?? profile.brandName} inside the shared signed-in browser profile and keep ${profile.emailAlias} as the recovery alias.`,
        "Use one channel per lane and keep short-form publishing or automation deferred until the review workflow is ready."
      ];
    case "instagram_account":
      return [
        `Create the Instagram account ${profile.handle ?? profile.emailAlias} using ${profile.emailAlias}.`,
        "Point the bio CTA to the waitlist or primary launch page for the matching lane."
      ];
    case "x":
      return [
        `Create the X account ${profile.handle ?? profile.emailAlias} using ${profile.emailAlias}.`,
        "If Arkose appears, solve it manually and then resume the launch schedule."
      ];
    case "gmail_alias":
      return [
        "Keep the alias routed into the main ImonEngine inbox.",
        "Use it for signup codes and support notifications only."
      ];
    default:
      return [...profile.notes];
  }
}

export class MicroSaasStudioService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {}

  async writePlan(options?: {
    businessId?: string;
    notifyRoadblocks?: boolean;
  }): Promise<{
    plan: MicroSaasAutomationPlan;
    artifacts: {
      planJsonPath: string;
      planMarkdownPath: string;
      productBacklogPath: string;
      launchCalendarPath: string;
      socialPresencePath: string;
      socialSchedulePath: string;
      paidGrowthPlanPath: string;
      incomeStackPath: string;
      roadblocksPath: string;
      legalChecklistPath: string;
      roadblockEmailPath?: string;
    };
    notified: boolean;
  }> {
    const businessId = options?.businessId ?? QUIETPIVOT_BUSINESS_ID;
    const business =
      (await this.store.getManagedBusiness(businessId)) ??
      (await this.store.getManagedBusiness(QUIETPIVOT_BUSINESS_ID));
    if (!business) {
      throw new Error(`Managed business ${businessId} was not found.`);
    }
    if (business.category !== "micro_saas_factory") {
      throw new Error(`${business.name} is not a micro-SaaS business.`);
    }

    const storeOps = new StoreOpsService(this.config, this.store);
    const baseEmail = this.config.marketplaces.gumroadSellerEmail ?? "imonengine@gmail.com";
    const aliasEmail = buildAlias(baseEmail, business.name);
    const baseDir = path.join(this.config.opsDir, "micro-saas-businesses", business.id);
    await ensureDir(baseDir);

    const socialProfiles = await storeOps.ensureSocialProfiles(business.id, business.name);
    await storeOps.ensureAllocationPolicy(business.id);

    const productBacklog = this.buildProductBacklog(business.id);
    const primaryProduct = productBacklog.find((product) => product.stage === "primary_mvp") ?? productBacklog[0];
    if (!primaryProduct) {
      throw new Error("QuietPivot product backlog could not be built.");
    }

    const launchWindow = mondayLaunchWindow();
    const launchCalendar = this.buildLaunchCalendar(business.id, productBacklog, launchWindow.startsAt);
    const socialPresence = this.buildSocialPresence(socialProfiles);
    const socialSchedule = this.buildSocialSchedule(business.id, productBacklog, socialProfiles, launchWindow.startsAt);
    const paidGrowthPlan = this.buildPaidGrowthPlan(business.id, productBacklog);
    const incomeStack = this.buildIncomeStack(aliasEmail);
    const roadblocks = this.buildRoadblocks(business.name, socialPresence, incomeStack, paidGrowthPlan);

    const plan: MicroSaasAutomationPlan = {
      businessId: business.id,
      businessName: business.name,
      aliasEmail,
      status: roadblocks.length > 0 ? "blocked" : "ready",
      generatedAt: nowIso(),
      launchWindow: {
        ...launchWindow,
        timezone: TZ
      },
      cadence: {
        weeklyBuilds: 3,
        weeklyLaunchPosts: 4,
        weeklyExperimentReviews: 2,
        dailySupportChecks: 1
      },
      primaryProductId: primaryProduct.id,
      productBacklog,
      launchCalendar,
      socialPresence,
      socialSchedule,
      paidGrowthPlan,
      incomeStack,
      roadblocks,
      nextAutomationSteps: [
        `Start with ${primaryProduct.productName} because it reuses the store-ops reporting stack that already exists in this repo.`,
        "Keep QuietPivot's public brand at the umbrella level, then route niche experiments through the lane-specific Instagram accounts.",
        "Use organic proof content first; only unlock Meta lead ads after the landing page, analytics, and ad-account credentials are live.",
        "Use verified export inputs for revenue reporting once QuietPivot starts collecting money.",
        "Rerun the QuietPivot plan after each external blocker is cleared so the launch state and instructions stay current."
      ]
    };

    const artifacts = await this.writeArtifacts(baseDir, plan);
    await this.updateBusinessState(business, plan);
    const notified = options?.notifyRoadblocks
      ? await this.maybeNotifyRoadblocks(plan, artifacts.roadblockEmailPath ?? path.join(baseDir, "roadblock-email.md"))
      : false;

    return {
      plan,
      artifacts,
      notified
    };
  }

  private buildProductBacklog(businessId: string): MicroSaasProductBrief[] {
    return PRODUCT_SEEDS.map((seed) => ({
      ...seed,
      id: slugify(`${businessId}-${seed.productName}`),
      businessId
    }));
  }

  private buildLaunchCalendar(
    businessId: string,
    products: MicroSaasProductBrief[],
    launchStartsAt: string
  ): MicroSaasLaunchTask[] {
    const fallbackProduct = products[0];
    if (!fallbackProduct) {
      return [];
    }

    const primary = products.find((product) => product.stage === "primary_mvp") ?? fallbackProduct;
    const creatorOps = products.find((product) => product.laneId === "creator-ops") ?? products[1] ?? primary;
    const workflowAgents = products.find((product) => product.laneId === "workflow-agents") ?? products[2] ?? primary;
    const launchDate = new Date(launchStartsAt);

    const seeds = [
      {
        product: primary,
        dayOffset: 0,
        dayPart: "morning" as const,
        department: "Product Ops",
        workflowId: "product-ops",
        title: `Publish waitlist landing page for ${primary.productName}`,
        output: "Landing page, waitlist CTA, and proof screenshot slot.",
        dependencies: ["Real domain and hosting", "Analytics snippet selected"],
        notes: ["Use the primary MVP first; do not broaden the offer before you see waitlist signal."]
      },
      {
        product: primary,
        dayOffset: 1,
        dayPart: "midday" as const,
        department: "Analytics / Research",
        workflowId: "analytics-reporting",
        title: `Generate the sample proof asset for ${primary.productName}`,
        output: "One sample allocation report and one import walkthrough visual.",
        dependencies: ["Core reporting logic re-used from store-ops"],
        notes: ["The proof asset should make verified versus inferred data obvious."]
      },
      {
        product: primary,
        dayOffset: 2,
        dayPart: "evening" as const,
        department: "Growth / Marketing",
        workflowId: "growth-publishing",
        title: `Publish the founder launch thread for ${primary.productName}`,
        output: "One X thread and one proof-oriented Facebook post.",
        dependencies: ["Umbrella Facebook Page", "Umbrella X account"],
        notes: ["Lead with the problem and one proof screenshot, not with vague AI claims."]
      },
      {
        product: primary,
        dayOffset: 3,
        dayPart: "midday" as const,
        department: "Growth / Marketing",
        workflowId: "growth-publishing",
        title: `Publish the Insight Dashboards carousel for ${primary.productName}`,
        output: "One Instagram carousel with three slides: problem, proof, CTA.",
        dependencies: ["Insight Dashboards Instagram account"],
        notes: ["Route the CTA to the waitlist landing page."]
      },
      {
        product: primary,
        dayOffset: 4,
        dayPart: "morning" as const,
        department: "Customer Support / QA",
        workflowId: "support-qa",
        title: "Prepare intake, FAQ, and support macros",
        output: "Reply macros for waitlist questions, refund policy questions, and demo requests.",
        dependencies: ["Support inbox or alias routing"],
        notes: ["Keep the support language short and operational."]
      },
      {
        product: primary,
        dayOffset: 5,
        dayPart: "morning" as const,
        department: "Product Ops",
        workflowId: "product-ops",
        title: `Ship the beta import flow for ${primary.productName}`,
        output: "CSV upload path, sample import, and report generation checkpoint.",
        dependencies: ["Primary product landing page", "Analytics events wired"],
        notes: ["Support live beta before thinking about recurring billing."]
      },
      {
        product: primary,
        dayOffset: 6,
        dayPart: "evening" as const,
        department: "Analytics / Research",
        workflowId: "analytics-reporting",
        title: `Review the first week of signal for ${primary.productName}`,
        output: "Waitlist count, activation rate, and top support questions.",
        dependencies: ["Analytics configured", "At least one launch week completed"],
        notes: ["Decide whether to keep pushing this MVP or shift energy to Launch Frame."]
      },
      {
        product: creatorOps,
        dayOffset: 7,
        dayPart: "morning" as const,
        department: "Product / Content",
        workflowId: "content-production",
        title: `Draft the backup landing page for ${creatorOps.productName}`,
        output: "Backup MVP landing copy and offer positioning.",
        dependencies: ["Primary MVP launched"],
        notes: ["Only ship this if primary traction is weak or creator demand is stronger."]
      },
      {
        product: creatorOps,
        dayOffset: 8,
        dayPart: "evening" as const,
        department: "Growth / Marketing",
        workflowId: "growth-publishing",
        title: `Publish the Creator Ops teaser post for ${creatorOps.productName}`,
        output: "One Creator Ops carousel or reel.",
        dependencies: ["Creator Ops Instagram account"],
        notes: ["Use a one-brief-to-launch-kit hook."]
      },
      {
        product: workflowAgents,
        dayOffset: 9,
        dayPart: "evening" as const,
        department: "Growth / Marketing",
        workflowId: "growth-publishing",
        title: `Publish the Workflow Agents teaser for ${workflowAgents.productName}`,
        output: "One short before/after workflow clip.",
        dependencies: ["Workflow Agents Instagram account"],
        notes: ["Show saved follow-up time, not abstract automation language."]
      },
      {
        product: primary,
        dayOffset: 10,
        dayPart: "midday" as const,
        department: "Growth / Marketing",
        workflowId: "growth-planning",
        title: `Prepare the paid-growth creative kit for ${primary.productName}`,
        output: "One lead-ad static, one retargeting static, and one copy matrix.",
        dependencies: ["Meta ad account", "Meta access token", "Organic proof post"],
        notes: ["Do not spend until the page, token, analytics, and landing page are all live."]
      },
      {
        product: primary,
        dayOffset: 11,
        dayPart: "morning" as const,
        department: "Customer Support / QA",
        workflowId: "support-qa",
        title: `Run payment and onboarding QA for ${primary.productName}`,
        output: "Manual QA pass across waitlist, checkout, confirmation, and support routing.",
        dependencies: ["Stripe links or checkout live", "Support inbox ready"],
        notes: ["Block launch if checkout and support do not connect cleanly."]
      }
    ];

    return seeds.map((seed) => ({
      id: slugify(`${businessId}-${seed.title}-${seed.dayOffset}`),
      businessId,
      productId: seed.product.id,
      scheduledFor: dateAtDayPart(launchDate, seed.dayOffset, seed.dayPart, `${businessId}-${seed.title}`),
      dayPart: seed.dayPart,
      department: seed.department,
      workflowId: seed.workflowId,
      title: seed.title,
      output: seed.output,
      dependencies: seed.dependencies,
      notes: seed.notes
    }));
  }

  private buildSocialPresence(profiles: SocialProfileRecord[]): MicroSaasChannelSetup[] {
    return profiles
      .map((profile) => ({
        profileId: profile.id,
        businessId: profile.businessId,
        platform: profile.platform,
        status: profile.status,
        role: profile.role,
        laneId: profile.laneId,
        laneName: profile.laneName,
        handleOrAlias: profile.handle ?? profile.emailAlias,
        purpose: profilePurpose(profile),
        blocker: profile.blocker,
        nextSteps: profileNextSteps(profile)
      }))
      .sort((left, right) => left.profileId.localeCompare(right.profileId));
  }

  private buildSocialSchedule(
    businessId: string,
    products: MicroSaasProductBrief[],
    profiles: SocialProfileRecord[],
    launchStartsAt: string
  ): MicroSaasSocialPost[] {
    const launchDate = new Date(launchStartsAt);
    const primary = products.find((product) => product.stage === "primary_mvp") ?? products[0];
    const creatorOps = products.find((product) => product.laneId === "creator-ops") ?? primary;
    const workflowAgents = products.find((product) => product.laneId === "workflow-agents") ?? primary;
    const xProfile = profiles.find((profile) => profile.platform === "x");
    const facebookPage = profiles.find((profile) => profile.platform === "facebook_page");
    const insightInstagram = profiles.find(
      (profile) => profile.platform === "instagram_account" && profile.laneId === "insight-dashboards"
    );
    const creatorInstagram = profiles.find(
      (profile) => profile.platform === "instagram_account" && profile.laneId === "creator-ops"
    );
    const workflowInstagram = profiles.find(
      (profile) => profile.platform === "instagram_account" && profile.laneId === "workflow-agents"
    );

    const posts: Array<
      Omit<MicroSaasSocialPost, "scheduledFor">
      & { dayOffset: number; dayPart: "morning" | "midday" | "evening" }
    > = [];

    if (xProfile && primary) {
      posts.push({
        id: slugify(`${businessId}-${primary.id}-x-thread-launch`),
        businessId,
        productId: primary.id,
        profileId: xProfile.id,
        laneId: primary.laneId,
        platform: "x",
        dayOffset: 2,
        dayPart: "evening",
        format: "thread",
        hook: "Stop guessing net revenue from bank deposits. QuietPivot Signal Ledger keeps verified revenue separate from noise.",
        cta: `Invite operators to join the /${primary.suggestedSlug} waitlist.`,
        notes: ["Lead with one concrete screenshot or proof table.", "Keep the CTA singular."]
      });
      posts.push({
        id: slugify(`${businessId}-${primary.id}-x-proof`),
        businessId,
        productId: primary.id,
        profileId: xProfile.id,
        laneId: primary.laneId,
        platform: "x",
        dayOffset: 9,
        dayPart: "evening",
        format: "thread",
        hook: "One verified export can change how an operator decides what to reinvest next.",
        cta: `Point to the sample report and /${primary.suggestedSlug} waitlist.`,
        notes: ["Use this as a proof follow-up, not as a generic teaser."]
      });
    }

    if (facebookPage && primary) {
      posts.push({
        id: slugify(`${businessId}-${primary.id}-facebook-proof`),
        businessId,
        productId: primary.id,
        profileId: facebookPage.id,
        laneId: primary.laneId,
        platform: "facebook_page",
        dayOffset: 3,
        dayPart: "midday",
        format: "static_post",
        hook: "QuietPivot Labs is building a verified revenue dashboard for solo operators who need clean payout visibility.",
        cta: `Point the Page audience to /${primary.suggestedSlug}.`,
        notes: ["Use one proof visual and one short founder caption."]
      });
      posts.push({
        id: slugify(`${businessId}-${primary.id}-facebook-beta`),
        businessId,
        productId: primary.id,
        profileId: facebookPage.id,
        laneId: primary.laneId,
        platform: "facebook_page",
        dayOffset: 11,
        dayPart: "midday",
        format: "static_post",
        hook: "Beta access is opening for operators who want verified allocation guidance instead of spreadsheet drift.",
        cta: `Use the Page CTA to send traffic to /${primary.suggestedSlug}.`,
        notes: ["Only run this when the landing page and onboarding path are live."]
      });
    }

    if (insightInstagram && primary) {
      posts.push({
        id: slugify(`${businessId}-${primary.id}-instagram-insight`),
        businessId,
        productId: primary.id,
        profileId: insightInstagram.id,
        laneId: primary.laneId,
        platform: "instagram_account",
        dayOffset: 4,
        dayPart: "midday",
        format: "carousel",
        hook: "Most creators treat bank deposits like profit. Slide through what changes when revenue is verified first.",
        cta: `Invite viewers to join /${primary.suggestedSlug}.`,
        notes: ["Three-slide format: problem, proof, CTA."]
      });
    }

    if (creatorInstagram && creatorOps) {
      posts.push({
        id: slugify(`${businessId}-${creatorOps.id}-instagram-creator`),
        businessId,
        productId: creatorOps.id,
        profileId: creatorInstagram.id,
        laneId: creatorOps.laneId,
        platform: "instagram_account",
        dayOffset: 8,
        dayPart: "evening",
        format: "carousel",
        hook: "One offer brief should be enough to spin up a real launch kit.",
        cta: `Invite creators to the /${creatorOps.suggestedSlug} waitlist.`,
        notes: ["Show one page section, one social hook, and one CTA block."]
      });
    }

    if (workflowInstagram && workflowAgents) {
      posts.push({
        id: slugify(`${businessId}-${workflowAgents.id}-instagram-workflow`),
        businessId,
        productId: workflowAgents.id,
        profileId: workflowInstagram.id,
        laneId: workflowAgents.laneId,
        platform: "instagram_account",
        dayOffset: 10,
        dayPart: "evening",
        format: "reel",
        hook: "What changes when inbound chaos becomes one prioritized queue with next actions?",
        cta: `Send viewers to the /${workflowAgents.suggestedSlug} waitlist.`,
        notes: ["Use a before/after queue view or simple text-only screen animation."]
      });
    }

    return posts
      .map((post) => ({
        ...post,
        scheduledFor: dateAtDayPart(launchDate, post.dayOffset, post.dayPart, post.id)
      }))
      .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor));
  }

  private buildPaidGrowthPlan(
    businessId: string,
    products: MicroSaasProductBrief[]
  ): MicroSaasAdExperiment[] {
    const fallbackProduct = products[0];
    if (!fallbackProduct) {
      return [];
    }

    const primary = products.find((product) => product.stage === "primary_mvp") ?? fallbackProduct;
    const creatorOps = products.find((product) => product.laneId === "creator-ops") ?? primary;
    const metaReady =
      hasMetaAdsConfiguration() &&
      hasAnalyticsConfiguration() &&
      Boolean(this.config.business.siteUrl) &&
      !isPlaceholderUrl(this.config.business.siteUrl);
    const blocker = metaReady
      ? undefined
      : "Meta paid growth is blocked until the Page id, ad account id, access token, analytics, and real landing page are all configured.";

    return [
      {
        id: slugify(`${businessId}-${primary.id}-meta-lead-ads`),
        businessId,
        channel: "meta_ads",
        status: metaReady ? "ready" : "blocked",
        productId: primary.id,
        objective: "Capture beta waitlist signups from operators who already sell digital products.",
        audience: "Solo creators, Gumroad-first sellers, and digital product operators with recurring export or payout friction.",
        offer: `${primary.productName} beta waitlist`,
        assetNeeds: [
          "One proof screenshot from the sample report",
          "One static comparison graphic: verified revenue vs noisy deposits",
          "One short form explaining what happens after signup"
        ],
        launchCriteria: [
          "Real landing page and form are live.",
          "Meta Page, ad account, and access token are configured.",
          "Analytics can measure landing views and waitlist signups."
        ],
        blocker
      },
      {
        id: slugify(`${businessId}-${creatorOps.id}-meta-retargeting`),
        businessId,
        channel: "meta_ads",
        status: metaReady ? "planned" : "blocked",
        productId: creatorOps.id,
        objective: "Retarget creator-facing visitors after the first QuietPivot proof content starts attracting traffic.",
        audience: "Visitors who viewed the primary MVP page or engaged with QuietPivot creator-ops content.",
        offer: `${creatorOps.productName} backup waitlist`,
        assetNeeds: [
          "One creator-ops carousel frame",
          "One concise retargeting headline",
          "One backup CTA path"
        ],
        launchCriteria: [
          "The primary MVP has at least one proof post and one landing page live.",
          "Meta paid growth is configured and analytics are collecting baseline traffic.",
          "Creator Ops landing page exists."
        ],
        blocker
      }
    ];
  }

  private buildIncomeStack(aliasEmail: string): MicroSaasIncomeCapability[] {
    const hasPaymentLinks = Boolean(this.config.business.stripeFounding && this.config.business.stripeStandard);
    const hasLaunchSurface =
      !isPlaceholderDomain(this.config.business.domain) &&
      !isPlaceholderUrl(this.config.business.siteUrl) &&
      Boolean(this.config.cloudflare);
    const hasSupportInbox = !isPlaceholderEmail(this.config.business.salesEmail);
    const hasApprovalInbox = !isPlaceholderEmail(this.config.business.approvalEmail);
    const analyticsConfigured = hasAnalyticsConfiguration();

    return [
      {
        id: "payment-collection",
        area: "Payment collection",
        status: hasPaymentLinks ? "live" : "blocked",
        summary: "Collect money with lightweight checkout before building a full recurring-billing surface.",
        evidence: [hasPaymentLinks ? "Checkout links are configured." : "Checkout links are missing."],
        nextSteps: [
          "Create one beta or founding checkout and one standard checkout in Stripe.",
          "Save them to STRIPE_PAYMENT_LINK_FOUNDING and STRIPE_PAYMENT_LINK_STANDARD."
        ]
      },
      {
        id: "launch-surface",
        area: "Launch domain and hosting",
        status: hasLaunchSurface ? "live" : "blocked",
        summary: "Host QuietPivot landing pages on a real domain so social traffic and ads have somewhere stable to convert.",
        evidence: [
          !isPlaceholderDomain(this.config.business.domain)
            ? `Domain configured: ${this.config.business.domain}`
            : "Domain is still placeholder or missing.",
          !isPlaceholderUrl(this.config.business.siteUrl)
            ? `Site URL configured: ${this.config.business.siteUrl}`
            : "Site URL is still placeholder or missing.",
          this.config.cloudflare ? "Cloudflare Pages credentials are present." : "Cloudflare Pages credentials are missing."
        ],
        nextSteps: [
          "Point QuietPivot at a real domain or subdomain.",
          "Set BUSINESS_DOMAIN and BUSINESS_SITE_URL.",
          "Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and CLOUDFLARE_PAGES_PROJECT."
        ]
      },
      {
        id: "support-routing",
        area: "Support and owner routing",
        status: hasSupportInbox && hasApprovalInbox ? (this.config.smtp ? "live" : "planned") : "blocked",
        summary: "Route support and owner actions through a real inbox instead of placeholder addresses.",
        evidence: [
          hasSupportInbox ? `Support inbox configured from ${aliasEmail}.` : "Support inbox is missing or still placeholder.",
          hasApprovalInbox ? "Owner approval inbox is configured." : "Owner approval inbox is missing or still placeholder.",
          this.config.smtp ? "SMTP is configured for automated notices." : "SMTP is not configured."
        ],
        nextSteps: [
          "Set BUSINESS_SALES_EMAIL to a monitored inbox on the launch domain.",
          "Set APPROVAL_EMAIL for owner-facing escalation notices.",
          "Add SMTP_* values if you want automatic outbound notifications."
        ]
      },
      {
        id: "analytics-telemetry",
        area: "Analytics and telemetry",
        status: analyticsConfigured ? "live" : "blocked",
        summary: "Measure landing views, waitlist signups, activation, and checkout clicks before spending on growth.",
        evidence: [analyticsConfigured ? "An analytics destination is configured." : "Neither GA nor PostHog is configured."],
        nextSteps: [
          "Either set GOOGLE_ANALYTICS_MEASUREMENT_ID or set POSTHOG_API_KEY and POSTHOG_HOST.",
          "Instrument landing_view, waitlist_signup, activation, and checkout_clicked."
        ]
      },
      {
        id: "revenue-attribution",
        area: "Verified revenue attribution",
        status: "live",
        summary: "QuietPivot can reuse the existing verified-versus-inferred reporting discipline once sales exports exist.",
        evidence: [
          "Business-level allocation policy can already be created in the file-backed store.",
          "The repo already has CSV import and revenue report primitives."
        ],
        nextSteps: [
          "Import verified sales exports once QuietPivot starts collecting money.",
          "Keep inferred bank movement out of reinvestment and cashout decisions."
        ]
      },
      {
        id: "legal-pages",
        area: "Legal pages and refund posture",
        status: "planned",
        summary: "Legal copy still needs a human review before QuietPivot takes live payments.",
        evidence: ["A legal checklist is generated with the plan, but not yet approved by the owner."],
        nextSteps: [
          "Review the generated legal checklist.",
          "Publish Terms, Privacy, Refunds, and Contact pages on the launch domain before opening paid access."
        ]
      }
    ];
  }

  private buildRoadblocks(
    businessName: string,
    socialPresence: MicroSaasChannelSetup[],
    incomeStack: MicroSaasIncomeCapability[],
    paidGrowthPlan: MicroSaasAdExperiment[]
  ): MicroSaasRoadblock[] {
    const roadblocks: MicroSaasRoadblock[] = [];
    const capabilityMap = new Map(incomeStack.map((capability) => [capability.id, capability]));
    const socialProfilesNeedingCreation = socialPresence.filter(
      (profile) => ["facebook_page", "instagram_account", "x"].includes(profile.platform) && profile.status !== "live"
    );
    const paidGrowthBlocked = paidGrowthPlan.some((plan) => plan.status === "blocked");

    const paymentCollection = capabilityMap.get("payment-collection");
    if (paymentCollection?.status === "blocked") {
      roadblocks.push({
        id: "payment-collection",
        category: "Payment collection",
        summary: `${businessName} cannot collect paid beta or subscription revenue yet because Stripe checkout links are still missing.`,
        requiredFromOwner: paymentCollection.nextSteps,
        continueAfterCompletion: [
          "The primary MVP can move from waitlist-only to paid beta.",
          "Paid growth and onboarding QA can target a real checkout path."
        ]
      });
    }

    const launchSurface = capabilityMap.get("launch-surface");
    if (launchSurface?.status === "blocked") {
      roadblocks.push({
        id: "launch-surface",
        category: "Launch domain and hosting",
        summary: `${businessName} still lacks a real domain or hosting target, so landing pages and waitlist capture do not have a durable public surface yet.`,
        requiredFromOwner: launchSurface.nextSteps,
        continueAfterCompletion: [
          "QuietPivot landing pages can ship publicly.",
          "Organic and paid traffic can route into one stable conversion surface."
        ]
      });
    }

    const supportRouting = capabilityMap.get("support-routing");
    if (supportRouting?.status === "blocked") {
      roadblocks.push({
        id: "support-routing",
        category: "Support and owner routing",
        summary: `${businessName} still relies on placeholder or incomplete inbox routing, so customer replies and owner escalations are not safely wired for a paid product business.`,
        requiredFromOwner: supportRouting.nextSteps,
        continueAfterCompletion: [
          "Support macros and owner escalations can flow through a real inbox.",
          "Launch QA can verify the full reply and escalation path."
        ]
      });
    }

    const analyticsTelemetry = capabilityMap.get("analytics-telemetry");
    if (analyticsTelemetry?.status === "blocked") {
      roadblocks.push({
        id: "analytics-telemetry",
        category: "Analytics and telemetry",
        summary: `${businessName} cannot measure waitlist, activation, or checkout performance yet because no analytics destination is configured.`,
        requiredFromOwner: analyticsTelemetry.nextSteps,
        continueAfterCompletion: [
          "QuietPivot can compare landing views, signups, and activation instead of guessing.",
          "Meta ads can launch with measurable conversion events."
        ]
      });
    }

    if (socialProfilesNeedingCreation.length > 0) {
      const uniquePlatforms = [...new Set(socialProfilesNeedingCreation.map((profile) => profile.platform))].join(", ");
      roadblocks.push({
        id: "social-presence",
        category: "Social presence",
        summary: `${businessName} has scaffolded but not-yet-live social surfaces across ${uniquePlatforms}, so the growth schedule cannot actually publish yet.`,
        requiredFromOwner: socialProfilesNeedingCreation.flatMap((profile) => profile.nextSteps),
        continueAfterCompletion: [
          "QuietPivot can start the organic content schedule immediately.",
          "The umbrella Facebook Page can also seed future paid growth audiences."
        ]
      });
    }

    if (paidGrowthBlocked) {
      roadblocks.push({
        id: "paid-growth",
        category: "Paid growth configuration",
        summary: `${businessName} cannot run Meta ads yet because the ad account, page token, analytics, or landing-page prerequisites are still incomplete.`,
        requiredFromOwner: [
          "Set META_PAGE_ID, META_AD_ACCOUNT_ID, and META_ACCESS_TOKEN.",
          "Keep the QuietPivot Page attached to the parent Meta Business portfolio.",
          "Only enable spending after the landing page and analytics are live."
        ],
        continueAfterCompletion: [
          "QuietPivot can test lead ads and retargeting against the primary MVP.",
          "Ad spend can be tied back to measured landing and waitlist signals."
        ]
      });
    }

    return roadblocks;
  }

  private async writeArtifacts(baseDir: string, plan: MicroSaasAutomationPlan): Promise<{
    planJsonPath: string;
    planMarkdownPath: string;
    productBacklogPath: string;
    launchCalendarPath: string;
    socialPresencePath: string;
    socialSchedulePath: string;
    paidGrowthPlanPath: string;
    incomeStackPath: string;
    roadblocksPath: string;
    legalChecklistPath: string;
    roadblockEmailPath?: string;
  }> {
    const planJsonPath = path.join(baseDir, "plan.json");
    const planMarkdownPath = path.join(baseDir, "plan.md");
    const productBacklogPath = path.join(baseDir, "product-backlog.json");
    const launchCalendarPath = path.join(baseDir, "launch-calendar.json");
    const socialPresencePath = path.join(baseDir, "social-presence.json");
    const socialSchedulePath = path.join(baseDir, "social-schedule.json");
    const paidGrowthPlanPath = path.join(baseDir, "paid-growth-plan.json");
    const incomeStackPath = path.join(baseDir, "income-stack.json");
    const roadblocksPath = path.join(baseDir, "roadblocks.json");
    const legalChecklistPath = path.join(baseDir, "legal-checklist.md");
    const roadblockEmailPath = path.join(baseDir, "roadblock-email.md");

    await writeJsonFile(planJsonPath, plan);
    await writeJsonFile(productBacklogPath, plan.productBacklog);
    await writeJsonFile(launchCalendarPath, plan.launchCalendar);
    await writeJsonFile(socialPresencePath, plan.socialPresence);
    await writeJsonFile(socialSchedulePath, plan.socialSchedule);
    await writeJsonFile(paidGrowthPlanPath, plan.paidGrowthPlan);
    await writeJsonFile(incomeStackPath, plan.incomeStack);
    await writeJsonFile(roadblocksPath, plan.roadblocks);
    await writeTextFile(planMarkdownPath, this.toMarkdown(plan));
    await writeTextFile(legalChecklistPath, this.legalChecklist(plan));
    if (plan.roadblocks.length > 0) {
      await writeTextFile(roadblockEmailPath, await this.composeRoadblockEmail(plan));
    }

    return {
      planJsonPath,
      planMarkdownPath,
      productBacklogPath,
      launchCalendarPath,
      socialPresencePath,
      socialSchedulePath,
      paidGrowthPlanPath,
      incomeStackPath,
      roadblocksPath,
      legalChecklistPath,
      roadblockEmailPath: plan.roadblocks.length > 0 ? roadblockEmailPath : undefined
    };
  }

  private async updateBusinessState(
    business: ManagedBusiness,
    plan: MicroSaasAutomationPlan
  ): Promise<void> {
    const nextStage = plan.roadblocks.length > 0 ? "scaffolded" : "ready";
    await this.store.saveManagedBusiness({
      ...business,
      stage: business.stage === "active" ? "active" : nextStage,
      launchBlockers: plan.roadblocks.map((roadblock) => roadblock.summary),
      notes: [
        ...business.notes.filter(
          (note) =>
            !note.startsWith("QuietPivot plan refreshed") &&
            !note.startsWith("Primary alias:") &&
            !note.includes("launch dossier lives under runtime/ops/micro-saas-businesses/")
        ),
        `QuietPivot plan refreshed ${plan.generatedAt}.`,
        `Primary alias: ${plan.aliasEmail}.`,
        "The QuietPivot launch dossier lives under runtime/ops/micro-saas-businesses/imon-micro-saas-factory."
      ],
      updatedAt: nowIso()
    });
  }

  private async maybeNotifyRoadblocks(plan: MicroSaasAutomationPlan, bodyPath: string): Promise<boolean> {
    if (plan.roadblocks.length === 0) {
      return false;
    }
    const recipient = this.config.business.approvalEmail?.trim();
    if (!recipient || recipient === "owner@example.com") {
      return false;
    }

    const notificationPath = path.join(
      this.config.opsDir,
      "micro-saas-businesses",
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

  private async composeRoadblockEmail(plan: MicroSaasAutomationPlan): Promise<string> {
    const ownership = await this.store.getWorkflowOwnershipRecord("product-ops", plan.businessId);
    return [
      `ImonEngine reached a launch roadblock for ${plan.businessName}.`,
      "",
      `Business: ${plan.businessName}`,
      ...(ownership ? [`Owning department: ${ownership.departmentName}`] : []),
      ...(ownership ? [`Owning position: ${ownership.positionName}`] : []),
      ...(ownership ? [`Owning workflow: ${ownership.workflowName} (${ownership.workflowId})`] : []),
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
      `Plan file: ${path.join(this.config.opsDir, "micro-saas-businesses", plan.businessId, "plan.md")}`,
      this.config.engine.hostPrimaryIp
        ? `VPS browser: http://${this.config.engine.hostPrimaryIp}:6080/vnc.html?autoconnect=1&resize=scale`
        : "",
      "Keep the required Facebook, Instagram, X, Stripe, and hosting sessions accessible while the remaining launch setup is completed."
    ]
      .filter(Boolean)
      .join("\n");
  }

  private legalChecklist(plan: MicroSaasAutomationPlan): string {
    const primary =
      plan.productBacklog.find((product) => product.id === plan.primaryProductId) ?? plan.productBacklog[0];
    return [
      `# ${plan.businessName} Legal Checklist`,
      "",
      `Primary MVP: ${primary?.productName ?? "Unknown"}`,
      `Generated at: ${plan.generatedAt}`,
      "",
      "Review these before taking paid traffic or payments:",
      "- Publish a Privacy Policy that covers analytics, waitlist collection, CSV uploads, and support email handling.",
      "- Publish Terms of Service that define acceptable use, payment terms, and support limits.",
      "- Publish a Refund Policy that matches the actual beta or subscription offer.",
      "- Publish a Contact page tied to the monitored QuietPivot support inbox.",
      "- Confirm that uploaded customer data is only used for the stated product workflow and is not retained longer than necessary.",
      "- Confirm that marketing claims match the product's real capabilities and current support scope.",
      "",
      "Owner action:",
      "- Review the final public copy yourself or with counsel before opening paid access."
    ].join("\n");
  }

  private toMarkdown(plan: MicroSaasAutomationPlan): string {
    const primary =
      plan.productBacklog.find((product) => product.id === plan.primaryProductId) ?? plan.productBacklog[0];
    return [
      `# ${plan.businessName} Micro-SaaS Launch Plan`,
      "",
      `Generated at: ${plan.generatedAt}`,
      `Alias: ${plan.aliasEmail}`,
      `Status: ${plan.status}`,
      `Primary MVP: ${primary?.productName ?? "Unknown"}`,
      "",
      "## Launch Window",
      `- Starts at: ${plan.launchWindow.startsAt}`,
      `- Ends at: ${plan.launchWindow.endsAt}`,
      `- Timezone: ${plan.launchWindow.timezone}`,
      `- Reason: ${plan.launchWindow.reason}`,
      "",
      "## Cadence",
      `- Weekly builds: ${plan.cadence.weeklyBuilds}`,
      `- Weekly launch posts: ${plan.cadence.weeklyLaunchPosts}`,
      `- Weekly experiment reviews: ${plan.cadence.weeklyExperimentReviews}`,
      `- Daily support checks: ${plan.cadence.dailySupportChecks}`,
      "",
      "## Product Backlog",
      ...plan.productBacklog.flatMap((product) => [
        `### ${product.productName}`,
        `- Stage: ${product.stage}`,
        `- Lane: ${product.laneName}`,
        `- Slug: /${product.suggestedSlug}`,
        `- Audience: ${product.audience}`,
        `- Problem: ${product.problem}`,
        `- Promise: ${product.promise}`,
        ...product.pricing.map((price) => `- Pricing: ${price.label} ${price.amount} (${price.cadence})`),
        ...product.differentiators.map((item) => `- Differentiator: ${item}`),
        ...product.mvpFeatures.map((item) => `- MVP feature: ${item}`),
        ...product.launchAssets.map((item) => `- Launch asset: ${item}`),
        ...product.telemetryEvents.map((item) => `- Telemetry event: ${item}`),
        ...product.successMetrics.map((item) => `- Success metric: ${item}`),
        ...product.implementationAssets.map((item) => `- Reuse asset: ${item}`),
        ""
      ]),
      "## Launch Calendar",
      ...plan.launchCalendar.map(
        (task) =>
          `- ${task.scheduledFor}: ${task.title} [${task.department} / ${task.workflowId}] -> ${task.output}`
      ),
      "",
      "## Social Presence",
      ...plan.socialPresence.flatMap((profile) => [
        `### ${profile.platform}${profile.laneName ? ` · ${profile.laneName}` : ""}`,
        `- Status: ${profile.status}`,
        `- Handle or alias: ${profile.handleOrAlias}`,
        `- Purpose: ${profile.purpose}`,
        ...(profile.blocker ? [`- Blocker: ${profile.blocker}`] : []),
        ...profile.nextSteps.map((step) => `- Next step: ${step}`),
        ""
      ]),
      "## Social Schedule",
      ...plan.socialSchedule.map(
        (post) =>
          `- ${post.scheduledFor}: ${post.platform} ${post.format} for ${post.productId} -> ${post.hook} CTA: ${post.cta}`
      ),
      "",
      "## Paid Growth Plan",
      ...plan.paidGrowthPlan.flatMap((experiment) => [
        `### ${experiment.id}`,
        `- Status: ${experiment.status}`,
        `- Objective: ${experiment.objective}`,
        `- Audience: ${experiment.audience}`,
        `- Offer: ${experiment.offer}`,
        ...(experiment.blocker ? [`- Blocker: ${experiment.blocker}`] : []),
        ...experiment.assetNeeds.map((item) => `- Asset need: ${item}`),
        ...experiment.launchCriteria.map((item) => `- Launch criterion: ${item}`),
        ""
      ]),
      "## Income Stack",
      ...plan.incomeStack.flatMap((capability) => [
        `### ${capability.area}`,
        `- Status: ${capability.status}`,
        `- Summary: ${capability.summary}`,
        ...capability.evidence.map((item) => `- Evidence: ${item}`),
        ...capability.nextSteps.map((item) => `- Next step: ${item}`),
        ""
      ]),
      "## Roadblocks",
      ...(plan.roadblocks.length > 0
        ? plan.roadblocks.flatMap((roadblock) => [
            `### ${roadblock.category}`,
            `- ${roadblock.summary}`,
            ...roadblock.requiredFromOwner.map((item) => `- Required from you: ${item}`),
            ...roadblock.continueAfterCompletion.map((item) => `- After completion: ${item}`),
            ""
          ])
        : ["- No roadblocks are currently detected.", ""]),
      "## Next Automation Steps",
      ...plan.nextAutomationSteps.map((step) => `- ${step}`),
      ""
    ].join("\n");
  }
}
