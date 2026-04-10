import path from "node:path";
import type { AppConfig } from "../config.js";
import type { BusinessCategory, ManagedBusiness } from "../domain/engine.js";
import type {
  CapitalExperimentTrack,
  VentureAgentRole,
  VentureBlueprint,
  VentureCadencePlan,
  VentureFacebookStrategy,
  VentureInstagramStrategy,
  VentureLaunchMode,
  VentureLaunchWindow,
  VentureNicheLane,
  VentureRangeTarget,
  VentureRiskMode,
  VentureSocialArchitecture,
  VentureStartupPhase,
  VentureStudioSnapshot
} from "../domain/venture.js";
import { ensureDir, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { FileStore } from "../storage/store.js";
import { buildBusinessOrgTemplate, summarizeOrgTemplate } from "./org-templates.js";

const TEMPLATE_SOURCE_BUSINESS_ID = "imon-digital-asset-store";
const CLIPBAITERS_BUSINESS_ID = "clipbaiters-viral-moments";
const PRE_SLOWDOWN_BRAND_COUNT = 5;
const TZ = "America/New_York";
const EXCLUDED_BUSINESS_IDS = new Set(["auto-funding-agency"]);

type RangeShape = Omit<VentureRangeTarget, "selected">;
type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};
type CategoryProfile = {
  medium: string;
  riskMode: VentureRiskMode;
  stack: string[];
  signups: string[];
  growth: string[];
  cadence: {
    coreOutput: RangeShape;
    feedPosts: RangeShape;
    storiesOrReels: RangeShape;
    activeDays: RangeShape;
    notes: string[];
  };
};

type NicheSeed = {
  id: string;
  name: string;
  focus: string;
};

const CATEGORY_PROFILES: Record<BusinessCategory, CategoryProfile> = {
  digital_asset_store: {
    medium: "Digital products and downloadable creative goods",
    riskMode: "live_ops",
    stack: ["generation workflow", "marketplace", "social channels", "payout exports"],
    signups: ["marketplace", "brand socials", "payout path", "analytics"],
    growth: ["preview-led content", "bundles and cross-sells", "marketplace optimization", "free organic distribution"],
    cadence: {
      coreOutput: { label: "products", minimum: 2, maximum: 5, period: "per week" },
      feedPosts: { label: "feed posts", minimum: 1, maximum: 5, period: "per week" },
      storiesOrReels: { label: "stories or reels", minimum: 1, maximum: 3, period: "per day" },
      activeDays: { label: "active days", minimum: 5, maximum: 7, period: "per week" },
      notes: ["Randomize inside allowed ranges each week.", "Promote new outputs before general brand content."]
    }
  },
  niche_content_site: {
    medium: "SEO content sites, affiliate pages, and lead magnets",
    riskMode: "live_ops",
    stack: ["publishing stack", "analytics", "affiliate programs", "light social distribution"],
    signups: ["domain", "hosting", "analytics", "affiliate networks"],
    growth: ["keyword clusters", "update loops", "internal linking", "social distribution"],
    cadence: {
      coreOutput: { label: "core outputs", minimum: 1, maximum: 3, period: "per week" },
      feedPosts: { label: "distribution posts", minimum: 1, maximum: 4, period: "per week" },
      storiesOrReels: { label: "supporting clips", minimum: 0, maximum: 2, period: "per day" },
      activeDays: { label: "active days", minimum: 3, maximum: 6, period: "per week" },
      notes: ["Treat outputs as articles, updates, or lead magnets.", "Do not outrun quality review."]
    }
  },
  faceless_social_brand: {
    medium: "Short-form social content and audience-first media products",
    riskMode: "review_required",
    stack: ["social accounts", "creative generation", "browser automation", "link hub"],
    signups: ["Meta page", "Pinterest", "X", "TikTok or YouTube"],
    growth: ["hook testing", "posting windows", "community replies", "offer promotion after trust exists"],
    cadence: {
      coreOutput: { label: "core outputs", minimum: 1, maximum: 5, period: "per week" },
      feedPosts: { label: "feed posts", minimum: 1, maximum: 5, period: "per week" },
      storiesOrReels: { label: "stories or reels", minimum: 1, maximum: 3, period: "per day" },
      activeDays: { label: "active days", minimum: 5, maximum: 7, period: "per week" },
      notes: ["Keep feed posting to one post per day maximum.", "Use human-like timing and interaction."]
    }
  },
  micro_saas_factory: {
    medium: "Narrow software offers, subscriptions, and utilities",
    riskMode: "review_required",
    stack: ["landing pages", "billing", "support inbox", "analytics", "feature telemetry"],
    signups: ["payment processor", "support inbox", "domain", "hosting"],
    growth: ["problem-specific positioning", "launch content", "waitlist capture", "retention loops"],
    cadence: {
      coreOutput: { label: "core outputs", minimum: 1, maximum: 3, period: "per week" },
      feedPosts: { label: "product posts", minimum: 1, maximum: 4, period: "per week" },
      storiesOrReels: { label: "supporting clips", minimum: 0, maximum: 2, period: "per day" },
      activeDays: { label: "active days", minimum: 3, maximum: 6, period: "per week" },
      notes: ["Outputs can be features, launches, or onboarding improvements.", "Paid growth waits until support is stable."]
    }
  },
  print_on_demand_store: {
    medium: "Physical products built from automated design and merchandising",
    riskMode: "review_required",
    stack: ["POD vendor", "storefront", "mockups", "social channels", "fulfillment settings"],
    signups: ["POD vendor", "storefront", "bank payout path", "brand socials"],
    growth: ["theme testing", "mockup-led merchandising", "organic product promotion", "paid growth after conversion proof"],
    cadence: {
      coreOutput: { label: "products", minimum: 1, maximum: 3, period: "per week" },
      feedPosts: { label: "feed posts", minimum: 1, maximum: 5, period: "per week" },
      storiesOrReels: { label: "stories or reels", minimum: 1, maximum: 3, period: "per day" },
      activeDays: { label: "active days", minimum: 5, maximum: 7, period: "per week" },
      notes: ["Create multi-format mockups for every design.", "Do not scale spend before the store converts."]
    }
  },
  client_services_agency: {
    medium: "Service delivery, lead generation, and managed client work",
    riskMode: "review_required",
    stack: ["prospecting", "outreach", "delivery", "billing", "reporting"],
    signups: ["payment processor", "sending inbox", "calendar", "delivery stack"],
    growth: ["qualified outreach", "proof loops", "referrals", "retention and upsells"],
    cadence: {
      coreOutput: { label: "core outputs", minimum: 1, maximum: 3, period: "per week" },
      feedPosts: { label: "authority posts", minimum: 1, maximum: 3, period: "per week" },
      storiesOrReels: { label: "supporting clips", minimum: 0, maximum: 2, period: "per day" },
      activeDays: { label: "active days", minimum: 3, maximum: 6, period: "per week" },
      notes: ["Outputs can be proposals, proof assets, or client deliverables.", "Keep a human review gate for commitments."]
    }
  }
};

const CATEGORY_NICHE_TEMPLATES: Partial<Record<BusinessCategory, NicheSeed[]>> = {
  faceless_social_brand: [
    { id: "visual-explainers", name: "Visual Explainers", focus: "short explainers, pattern breakdowns, and hook-first concept clips" },
    { id: "operator-habits", name: "Operator Habits", focus: "systems, routines, and workflow content for ambitious operators" },
    { id: "trend-remixes", name: "Trend Remixes", focus: "trend-aware remixes that adapt proven formats to the umbrella brand voice" }
  ],
  micro_saas_factory: [
    { id: "workflow-agents", name: "Workflow Agents", focus: "small tools that remove repetitive task friction" },
    { id: "creator-ops", name: "Creator Ops", focus: "utilities for creators, consultants, and solo operators" },
    { id: "insight-dashboards", name: "Insight Dashboards", focus: "light analytics and visibility tools around recurring business questions" }
  ],
  print_on_demand_store: [
    { id: "abstract-art", name: "Abstract Art", focus: "modern abstract art and atmospheric compositions" },
    { id: "sacred-symbols", name: "Sacred Symbols", focus: "religious and spiritual symbol collections presented respectfully" },
    { id: "graphic-tees", name: "Graphic Tees", focus: "statement graphics and typographic apparel motifs" },
    { id: "childrens-designs", name: "Children's Designs", focus: "playful illustrations and kid-friendly pattern sets" }
  ]
};

const BUSINESS_PROFILE_OVERRIDES: Partial<Record<string, CategoryProfile>> = {
  [CLIPBAITERS_BUSINESS_ID]: {
    medium: "Rights-aware short-form clipping and creator-first viral moment packaging",
    riskMode: "review_required",
    stack: ["trend and event radar", "approved source intake", "transcription and clip editing", "browser automation"],
    signups: ["ImonEngine Gmail alias", "manual YouTube channels", "optional umbrella Facebook page"],
    growth: ["event forecasting", "creator clipping retainers", "commentary-led packaging", "policy-safe publishing"],
    cadence: {
      coreOutput: { label: "approved clip packages", minimum: 1, maximum: 5, period: "per day" },
      feedPosts: { label: "published clips", minimum: 0, maximum: 3, period: "per day" },
      storiesOrReels: { label: "short-form repackages", minimum: 0, maximum: 2, period: "per day" },
      activeDays: { label: "active days", minimum: 5, maximum: 7, period: "per week" },
      notes: [
        "Do not auto-publish political or rights-sensitive clips without a human review gate.",
        "Cadence is constrained by approved-source quality, not by a blind posting quota."
      ]
    }
  }
};

const BUSINESS_NICHE_TEMPLATES: Partial<Record<string, NicheSeed[]>> = {
  "imon-pod-store": [],
  "imon-faceless-social-brand": CATEGORY_NICHE_TEMPLATES.faceless_social_brand ?? [],
  "imon-micro-saas-factory": CATEGORY_NICHE_TEMPLATES.micro_saas_factory ?? []
};

const BUSINESS_SINGLE_BRAND_INSTAGRAM = new Set<string>(["imon-pod-store"]);

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

function buildAlias(baseEmail: string, brandName: string): string {
  const [local, domain] = baseEmail.split("@");
  return local && domain ? `${local}+${slugify(brandName).replace(/-/g, "")}@${domain}` : baseEmail;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function weekKey(date: Date): string {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayIndex = Math.floor((date.getTime() - start) / 86400000);
  return `${date.getUTCFullYear()}-w${Math.floor(dayIndex / 7)}`;
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
  const weekday = weekdayMap[weekdayLabel] ?? 0;
  return {
    year: Number(entries.get("year") ?? "0"),
    month: Number(entries.get("month") ?? "1"),
    day: Number(entries.get("day") ?? "1"),
    hour: Number(entries.get("hour") ?? "0"),
    minute: Number(entries.get("minute") ?? "0"),
    second: Number(entries.get("second") ?? "0"),
    weekday
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

function utcParts(date: Date): Omit<ZonedDateParts, "weekday"> {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds()
  };
}

function launchMode(createdBrandCount: number): VentureLaunchMode {
  return createdBrandCount >= PRE_SLOWDOWN_BRAND_COUNT ? "monthly" : "weekly";
}

function launchDate(base: Date, mode: VentureLaunchMode, offset: number): Date {
  const baseParts = zonedParts(base, TZ);
  const candidate = new Date(
    Date.UTC(baseParts.year, baseParts.month - 1, baseParts.day, baseParts.hour, baseParts.minute, baseParts.second)
  );
  if (mode === "weekly") {
    const day = candidate.getUTCDay();
    const daysUntilMonday = day === 1 ? 0 : (8 - day) % 7;
    candidate.setUTCDate(candidate.getUTCDate() + daysUntilMonday + offset * 7);
  } else {
    candidate.setUTCDate(1);
    candidate.setUTCMonth(candidate.getUTCMonth() + offset);
    while (candidate.getUTCDay() !== 1) {
      candidate.setUTCDate(candidate.getUTCDate() + 1);
    }
  }
  const minutes = pick(0, 119, `${mode}-${offset}-start`);
  candidate.setUTCHours(7, 0, 0, 0);
  candidate.setUTCMinutes(minutes);
  return zonedDateTimeToUtc(utcParts(candidate), TZ);
}

function target(range: RangeShape, seed: string): VentureRangeTarget {
  return { ...range, selected: pick(range.minimum, range.maximum, seed) };
}

function scoreComposite(business: ManagedBusiness): number {
  const supportPenalty = { low: 10, medium: 22, high: 35 }[business.supportLoad];
  const riskPenalty = { low: 8, medium: 20, high: 35 }[business.complianceRisk];
  return business.automationPotential * 10 + Math.round(business.metrics.targetMonthlyRevenue / 30) - business.setupComplexity * 10 - business.humanSetupHours * 2 - supportPenalty - riskPenalty;
}

function phasesFor(business: ManagedBusiness, aliasEmail: string): VentureStartupPhase[] {
  return [
    {
      id: `${business.id}-opportunity`,
      title: "Opportunity framing",
      goals: ["Score the niche for automation fit, sales potential, and support load.", "Define success metrics and stop-loss rules before launching."],
      heuristics: ["Use the current store as the starting template.", "Prefer low-support lanes first."],
      completionSignals: ["A niche and first offer are selected.", "The lane has a reason to exist inside the portfolio."]
    },
    {
      id: `${business.id}-identity`,
      title: "Identity and account surface",
      goals: [`Create a distinct brand and alias such as ${aliasEmail}.`, "Provision the minimum account stack and isolate it in a browser profile or container."],
      heuristics: ["Reserve ImonEngine for the parent system.", "Use visual input or simulated clicks when signup flows become brittle."],
      completionSignals: ["Brand handle and alias exist.", "Any manual challenge is documented."]
    },
    {
      id: `${business.id}-production`,
      title: "Core production loop",
      goals: ["Automate the minimum viable production workflow.", "Wire monetization, analytics, and payout tracking into ImonEngine."],
      heuristics: ["Prefer broad reusable workflow blocks over brittle exact steps.", "Keep QA before publishing."],
      completionSignals: ["The first sellable or publishable output exists.", "Revenue can be attributed to the lane."]
    },
    {
      id: `${business.id}-growth`,
      title: "Organic growth loop",
      goals: ["Post and distribute inside the approved ranges.", "Find the first repeatable acquisition signal before paid growth."],
      heuristics: ["Randomize volume and timing inside allowed ranges.", "Use free or owned channels first."],
      completionSignals: ["A weekly growth rhythm exists.", "The lane has at least one repeatable acquisition loop."]
    },
    {
      id: `${business.id}-reinvestment`,
      title: "Reinvestment and learning transfer",
      goals: ["Reinvest a capped share of brand profit into growth.", "Feed remaining profit and learnings into the parent system."],
      heuristics: ["Brand and system reinvestment caps should match.", "Pause tactics that burn time or money without learning."],
      completionSignals: ["Brand and collective allocation rules are enforced.", "Reusable learnings are documented."]
    }
  ];
}

function rolesFor(business: ManagedBusiness, aliasEmail: string): VentureAgentRole[] {
  return [
    {
      id: `${business.id}-strategist`,
      name: "Venture Strategist",
      mission: "Research and score the lane before launch.",
      outputs: ["niche thesis", "selection scorecard", "stop-loss rules"],
      autonomyRules: ["Prefer automation-friendly lanes first.", "Do not create accounts without a launch thesis."]
    },
    {
      id: `${business.id}-launch-ops`,
      name: "Launch Ops Agent",
      mission: "Create the brand surface, alias, and account stack.",
      outputs: [aliasEmail, "signup checklist", "browser or container setup notes"],
      autonomyRules: ["Use distinct brand names.", "If Arkose or similar appears, pause for manual completion."]
    },
    {
      id: `${business.id}-production`,
      name: "Production Agent",
      mission: "Build and QA the lane's sellable or publishable outputs.",
      outputs: ["publish-ready outputs", "QA notes", "automation scripts"],
      autonomyRules: ["Stay inside the weekly randomized output range.", "Favor repeatable scripts."]
    },
    {
      id: `${business.id}-growth`,
      name: "Growth Agent",
      mission: "Find posting windows, hooks, and free distribution methods.",
      outputs: ["weekly cadence", "organic growth experiments", "channel findings"],
      autonomyRules: ["One feed post per day maximum.", "Use free/owned channels before paid growth."]
    },
    {
      id: `${business.id}-finance`,
      name: "Finance And Allocation Agent",
      mission: "Track revenue and enforce reinvestment rules.",
      outputs: ["brand allocation report", "collective transfer summary", "tooling recommendations"],
      autonomyRules: ["Brand and system reinvestment caps must match.", "No live capital-market activity until policy gates are met."]
    }
  ];
}

function nicheSeedsForBusiness(business: ManagedBusiness): NicheSeed[] {
  return BUSINESS_NICHE_TEMPLATES[business.id] ?? CATEGORY_NICHE_TEMPLATES[business.category] ?? [];
}

function profileForBusiness(business: ManagedBusiness): CategoryProfile {
  return BUSINESS_PROFILE_OVERRIDES[business.id] ?? CATEGORY_PROFILES[business.category];
}

function socialArchitectureForBusiness(
  business: ManagedBusiness,
  baseEmail: string
): VentureSocialArchitecture {
  const legacyStore = business.id === TEMPLATE_SOURCE_BUSINESS_ID;
  const scalableUmbrella = new Set<BusinessCategory>([
    "faceless_social_brand",
    "micro_saas_factory",
    "print_on_demand_store"
  ]);
  const umbrellaBrandName = legacyStore ? "Imon" : business.name;
  const umbrellaAliasEmail = buildAlias(baseEmail, umbrellaBrandName);
  const umbrellaHandleStem = slugify(umbrellaBrandName).replace(/-/g, "");

  if (business.id === CLIPBAITERS_BUSINESS_ID) {
    return {
      umbrellaBrandName,
      umbrellaAliasEmail,
      umbrellaHandleStem,
      facebookStrategy: "avoid_by_default",
      instagramStrategy: "deferred",
      maxInstagramAccountsPerDevice: 0,
      niches: [],
      accountPlan: [
        {
          platform: "gmail_alias",
          ownership: "minimal",
          quantity: 1,
          aliasPattern: umbrellaAliasEmail,
          purpose: "Receive approval notices, source confirmations, and platform recovery mail for the umbrella brand.",
          notes: ["All notifications still route into the primary ImonEngine inbox."]
        },
        {
          platform: "youtube_channel",
          ownership: "niche_lane",
          quantity: 5,
          aliasPattern: "Use the shared ImonEngine Chrome profile and manual channel separation; do not create extra niche alias emails.",
          purpose: "Create the five niche YouTube channels that separate audiences without creating off-platform identity sprawl.",
          notes: [
            "Channel creation stays manual in the signed-in ImonEngine browser profile during the initial launch stages.",
            "The niche roster lands in the dedicated ClipBaiters workflow, not as separate off-platform alias accounts."
          ]
        }
      ],
      notes: [
        "ClipBaiters uses one umbrella alias for approvals and platform recovery, while niche separation happens on YouTube channels.",
        "Defer Instagram and TikTok until the YouTube editing, review, and proof loops are stable.",
        "Only add an umbrella Facebook Page later if distribution or ad reuse clearly justifies it."
      ]
    };
  }

  const facebookStrategy: VentureFacebookStrategy = legacyStore
    ? "legacy_live"
    : scalableUmbrella.has(business.category)
      ? "umbrella_brand"
      : "avoid_by_default";
  const instagramStrategy: VentureInstagramStrategy = BUSINESS_SINGLE_BRAND_INSTAGRAM.has(business.id)
    ? "single_brand"
    : scalableUmbrella.has(business.category)
      ? "niche_accounts"
      : "single_brand";
  const nicheSeeds = nicheSeedsForBusiness(business);
  const niches: VentureNicheLane[] =
    instagramStrategy === "niche_accounts"
      ? nicheSeeds.map((lane) => {
          const laneBrandName = `${umbrellaBrandName} ${lane.name}`;
          return {
            id: `${business.id}-${lane.id}`,
            name: lane.name,
            focus: lane.focus,
            aliasEmail: buildAlias(baseEmail, laneBrandName),
            handleStem: slugify(laneBrandName).replace(/-/g, ""),
            notes: [
              "Use this lane as a niche-specific Instagram identity under the umbrella brand.",
              "Route signup codes and recovery emails through the plus-tag alias."
            ]
          };
        })
      : [
          {
            id: `${business.id}-core`,
            name: `${umbrellaBrandName} Core`,
            focus: "the main brand identity for the lane",
            aliasEmail: umbrellaAliasEmail,
            handleStem: umbrellaHandleStem,
            notes: ["Use the umbrella brand directly instead of splitting it into multiple niche identities."]
          }
        ];

  const accountPlan = [
    {
      platform: "gmail_alias",
      ownership: "minimal" as const,
      quantity: 1,
      aliasPattern: umbrellaAliasEmail,
      purpose: "Receive signup codes, platform alerts, and support notifications for the brand.",
      notes: ["All aliases still route into the primary ImonEngine inbox."]
    },
    ...(facebookStrategy !== "avoid_by_default"
      ? [
          {
            platform: "meta_business",
            ownership: "umbrella_brand" as const,
            quantity: 1,
            aliasPattern: umbrellaAliasEmail,
            purpose: "Manage the umbrella Facebook asset, ad access, and future test users.",
            notes: ["Prefer one umbrella Meta portfolio asset per scalable business instead of one page per niche."]
          },
          {
            platform: "facebook_page",
            ownership: "umbrella_brand" as const,
            quantity: 1,
            aliasPattern: umbrellaAliasEmail,
            purpose: "Run ads and public Facebook content for the umbrella brand across all attached niches.",
            notes: ["Use Facebook sparingly and strategically for scalable umbrellas, the parent system, or Shopify/POD lanes."]
          }
        ]
      : []),
    {
      platform: "instagram_account",
      ownership: instagramStrategy === "niche_accounts" ? ("niche_lane" as const) : ("umbrella_brand" as const),
      quantity: instagramStrategy === "niche_accounts" ? niches.length : 1,
      aliasPattern:
        instagramStrategy === "niche_accounts"
          ? `${umbrellaAliasEmail.replace("@", "+<niche>@")}`
          : umbrellaAliasEmail,
      purpose:
        instagramStrategy === "niche_accounts"
          ? "Create alternate Instagram identities for each niche beneath the umbrella brand."
          : "Maintain a single Instagram identity for the brand when niche splitting is unnecessary.",
      notes: [
        "Instagram niche accounts should use plus-tag aliases tied to the brand and niche name.",
        "Keep the total under 10 Instagram accounts per device or browser environment before rotating to another isolated profile."
      ]
    },
    ...(business.category === "digital_asset_store" || business.category === "print_on_demand_store"
      ? [
          {
            platform: "pinterest",
            ownership: "umbrella_brand" as const,
            quantity: 1,
            aliasPattern: umbrellaAliasEmail,
            purpose: "Drive evergreen discovery for visual products and collections.",
            notes: ["Pinterest stays useful for digital asset previews, mockups, and POD catalog discovery."]
          }
        ]
      : []),
    ...(business.category !== "print_on_demand_store"
      ? [
          {
            platform: "x",
            ownership: "umbrella_brand" as const,
            quantity: 1,
            aliasPattern: umbrellaAliasEmail,
            purpose: "Test hook-driven text and media distribution when the platform trusts the account.",
            notes: ["Use simulated clicks or visual input during signup, then pause for manual completion if Arkose appears."]
          }
        ]
      : [])
  ];

  return {
    umbrellaBrandName,
    umbrellaAliasEmail,
    umbrellaHandleStem,
    facebookStrategy,
    instagramStrategy,
    maxInstagramAccountsPerDevice: 10,
    niches,
    accountPlan,
    notes: uniqueStrings([
      legacyStore
        ? "This is the legacy first store, so the existing Imon brand and Facebook Page remain active."
        : "ImonEngine is the parent system name and should not be reused as the public brand for this business.",
      facebookStrategy === "umbrella_brand"
        ? "Use one Facebook Page at the umbrella level, then route multiple niches through that ad and content surface."
        : "Avoid creating a new Facebook Page until the lane proves it benefits from a shared paid-growth surface.",
      instagramStrategy === "niche_accounts"
        ? "Create separate Instagram accounts per niche using plus-tag aliases so the umbrella brand can test multiple angles without spawning extra Facebook Pages."
        : "Use one Instagram account for the brand until there is clear evidence that niche splitting improves reach or conversion."
    ])
  };
}

function capitalTracks(reinvestmentRate: number): CapitalExperimentTrack[] {
  return [
    {
      id: "paper-equities",
      name: "Paper Equities Lab",
      stage: "paper_only",
      thesis: "Test systematic stock ideas in simulation before using live operating capital.",
      gates: ["30+ days of positive operating profit.", "A paper strategy beats a passive benchmark.", `Shared tool spend stays below ${Math.round(reinvestmentRate * 100)}% of collective free cash.`],
      allowedActions: ["paper trades only", "signal logging", "strategy review"]
    },
    {
      id: "paper-crypto",
      name: "Paper Crypto Lab",
      stage: "paper_only",
      thesis: "Test crypto market strategies in simulation without risking brand cash flow.",
      gates: ["No live deployment without explicit review.", "Collective reserves must remain positive after operating needs."],
      allowedActions: ["paper trades only", "API research", "journaled experiments"]
    },
    {
      id: "mining-viability",
      name: "Mining Viability Review",
      stage: "review_required",
      thesis: "Treat mining as an ROI study, not an automatic VPS workload.",
      gates: ["Current VPS must not be repurposed for mining.", "Hardware economics must beat simpler business reinvestment uses."],
      allowedActions: ["cost modeling", "vendor research", "hardware ROI analysis"]
    }
  ];
}

export class VentureStudioService {
  constructor(private readonly config: AppConfig, private readonly store: FileStore) {}

  async buildSnapshot(): Promise<VentureStudioSnapshot> {
    const businesses = (await this.store.getManagedBusinesses()).sort((left, right) => left.launchPriority - right.launchPriority);
    const profiles = await this.store.getSocialProfiles();
    const createdBrandIds = new Set(
      profiles
        .filter(
          (profile) =>
            profile.status !== "planned" &&
            profile.platform !== "gmail_alias" &&
            !EXCLUDED_BUSINESS_IDS.has(profile.businessId)
        )
        .map((profile) => profile.businessId)
    );
    for (const business of businesses) {
      if (business.stage === "active" && !EXCLUDED_BUSINESS_IDS.has(business.id)) {
        createdBrandIds.add(business.id);
      }
    }
    const createdBrandCount = createdBrandIds.size;
    const template = businesses.find((business) => business.id === TEMPLATE_SOURCE_BUSINESS_ID) ?? businesses[0];
    if (!template) {
      throw new Error("No managed businesses are available for venture-studio planning.");
    }
    const baseEmail = this.config.marketplaces.gumroadSellerEmail ?? "imonengine@gmail.com";
    const now = new Date();
    const mode = launchMode(createdBrandCount);
    const blueprints = businesses.filter((business) => business.id !== "auto-funding-agency").map((business) => {
      const profile = profileForBusiness(business);
      const socialArchitecture = socialArchitectureForBusiness(business, baseEmail);
      const aliasEmail = socialArchitecture.umbrellaAliasEmail;
      const cadenceSeed = `${business.id}-${weekKey(now)}`;
      const cadence: VentureCadencePlan = {
        coreOutput: target(profile.cadence.coreOutput, `${cadenceSeed}-core`),
        feedPosts: target(profile.cadence.feedPosts, `${cadenceSeed}-feed`),
        storiesOrReels: target(profile.cadence.storiesOrReels, `${cadenceSeed}-stories`),
        activeDays: target(profile.cadence.activeDays, `${cadenceSeed}-days`),
        notes: profile.cadence.notes
      };
      const handleStem = socialArchitecture.umbrellaHandleStem;
      const composite = scoreComposite(business);
      const blueprint: VentureBlueprint = {
        businessId: business.id,
        businessName: business.name,
        category: business.category,
        launchPriority: business.launchPriority,
        stage: business.stage,
        medium: profile.medium,
        aliasEmail,
        handleStem,
        templateSourceBusinessId: template.id,
        selectionScore: {
          automationFit: business.automationPotential * 10,
          revenuePotential: Math.round(business.metrics.targetMonthlyRevenue / 30),
          growthSurface: Math.max(0, 100 - business.setupComplexity * 8),
          startupBurden: business.setupComplexity * 10 + business.humanSetupHours * 2,
          riskPenalty: business.complianceRisk === "high" ? 35 : business.complianceRisk === "medium" ? 20 : 8,
          composite
        },
        stack: [...business.platforms, ...profile.stack],
        signupTargets: uniqueStrings([
          ...profile.signups,
          ...(socialArchitecture.facebookStrategy === "umbrella_brand" ? ["umbrella Facebook page"] : []),
          ...(socialArchitecture.instagramStrategy === "niche_accounts"
            ? ["niche Instagram accounts"]
            : socialArchitecture.instagramStrategy === "single_brand"
              ? ["brand Instagram account"]
              : [])
        ]),
        startupPhases: phasesFor(business, aliasEmail),
        cadence,
        growthFocus: profile.growth,
        orgStructure: {
          blueprintId: `org-business-${business.id}`,
          ...summarizeOrgTemplate(buildBusinessOrgTemplate(business.category, business.id))
        },
        socialArchitecture,
        reinvestment: {
          brandRate: this.config.storeOps.finance.reinvestmentRate,
          collectiveCapRate: this.config.storeOps.finance.reinvestmentRate,
          cashoutThreshold: this.config.storeOps.finance.cashoutThreshold,
          rules: [
            "Reinvest brand profit only when it improves learning or sales velocity.",
            "Move remaining post-reinvestment profit into the collective ImonEngine fund.",
            "Shared-tool spend at the system level cannot exceed the same reinvestment rate used by brands."
          ]
        },
        riskPolicy: {
          mode: profile.riskMode,
          guardrails: [
            "Randomize volume and timing inside approved ranges.",
            "Use free or owned channels first.",
            profile.riskMode === "live_ops" ? "This lane can go live once accounts, payouts, and QA are stable." : "Keep a review checkpoint before scaling spend or publishing volume."
          ]
        },
        agentRoles: rolesFor(business, aliasEmail)
      };
      return blueprint;
    });

    return {
      generatedAt: new Date().toISOString(),
      systemName: this.config.engine.name,
      createdBrandCount,
      nextLaunchMode: mode,
      templateSource: {
        businessId: template.id,
        businessName: template.name,
        lessons: [
          "Start with automation-friendly monetization and low-support distribution.",
          "Use the live store as the template for payout tracking, social account handling, and reinvestment loops.",
          "Keep browser-dependent automation in persistent local or virtual-display sessions.",
          "Use umbrella Facebook surfaces only when multiple niches can share the same scalable acquisition engine."
        ]
      },
      broadPlan: [
        "Learn from the live store template before launching a new lane.",
        "Score candidate businesses by automation fit, speed to first sale, growth surface, and support burden.",
        "Launch one new brand per approved window, weekly at first and monthly after five created brands.",
        "Use broad startup phases so each lane can choose tactics without breaking system policy.",
        "Funnel scalable niches into one umbrella brand when they can share a Facebook page, ad account, or storefront backend.",
        "Reinvest a capped share of brand profit back into the brand and move the remainder into the collective system fund.",
        "Keep capital-market experiments paper-only until operating businesses create real reserves."
      ],
      policy: {
        templateSourceBusinessId: template.id,
        systemReinvestmentCapRate: this.config.storeOps.finance.reinvestmentRate,
        creationRules: {
          preSlowdownBrandCount: PRE_SLOWDOWN_BRAND_COUNT,
          weeklyLaunchDay: "Monday",
          monthlyLaunchRule: "First Monday of the month",
          launchWindowLocal: "07:00-09:00 America/New_York",
          oneNewBrandPerWindow: true
        },
        socialRules: [
          "Reserve Facebook Pages for umbrella brands, the parent system, and physical or otherwise scalable storefronts.",
          "When a business can support multiple niches, funnel them into one umbrella brand and give each niche its own plus-tag Instagram identity.",
          "ClipBaiters is the current exception: it starts with manual niche YouTube channels and a single umbrella alias instead of off-platform niche alias clusters.",
          "Keep Instagram niche clusters to ten accounts or fewer per device or browser environment before moving to a fresh profile."
        ],
        cadenceRules: [
          "Use a random number inside each allowed range for products, posts, and stories every week.",
          "Feed posts stay capped at one per day maximum.",
          "Stories and reels can run up to three times per day, five to seven days per week, when the lane benefits from short-form repetition."
        ],
        capitalRules: [
          `Brand reinvestment is capped at ${Math.round(this.config.storeOps.finance.reinvestmentRate * 100)}% of net profit.`,
          "Remaining post-reinvestment profit feeds the collective ImonEngine fund.",
          "Live capital strategies stay paper-only until profitable operating businesses fund a reserve and simulation results hold up."
        ]
      },
      launchWindows: Array.from({ length: 6 }, (_, index) => {
        const startsAt = launchDate(now, mode, index);
        const endsAt = new Date(startsAt.getTime() + pick(45, 90, `${mode}-${index}-duration`) * 60000);
        return {
          id: `launch-window-${mode}-${index + 1}`,
          mode,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          timezone: TZ,
          reason: mode === "weekly" ? "Fewer than five created brands exist, so launches stay weekly." : "Five or more created brands exist, so launches slow to monthly."
        } satisfies VentureLaunchWindow;
      }),
      blueprints,
      capitalExperimentTracks: capitalTracks(this.config.storeOps.finance.reinvestmentRate)
    };
  }

  async writeArtifacts(snapshot?: VentureStudioSnapshot): Promise<{
    snapshotJsonPath: string;
    snapshotMarkdownPath: string;
    calendarJsonPath: string;
    calendarMarkdownPath: string;
    blueprintDirPath: string;
  }> {
    const nextSnapshot = snapshot ?? (await this.buildSnapshot());
    const snapshotJsonPath = path.join(this.config.opsDir, "venture-studio.json");
    const snapshotMarkdownPath = path.join(this.config.opsDir, "venture-studio.md");
    const calendarJsonPath = path.join(this.config.opsDir, "venture-calendar.json");
    const calendarMarkdownPath = path.join(this.config.opsDir, "venture-calendar.md");
    const blueprintDirPath = path.join(this.config.opsDir, "venture-blueprints");
    await writeJsonFile(snapshotJsonPath, nextSnapshot);
    await writeTextFile(snapshotMarkdownPath, this.toSnapshotMarkdown(nextSnapshot));
    await writeJsonFile(calendarJsonPath, nextSnapshot.launchWindows);
    await writeTextFile(calendarMarkdownPath, this.toCalendarMarkdown(nextSnapshot));
    await ensureDir(blueprintDirPath);
    await Promise.all(
      nextSnapshot.blueprints.flatMap((blueprint) => [
        writeJsonFile(path.join(blueprintDirPath, `${blueprint.businessId}.json`), blueprint),
        writeTextFile(path.join(blueprintDirPath, `${blueprint.businessId}.md`), this.toBlueprintMarkdown(blueprint))
      ])
    );
    return { snapshotJsonPath, snapshotMarkdownPath, calendarJsonPath, calendarMarkdownPath, blueprintDirPath };
  }

  private toSnapshotMarkdown(snapshot: VentureStudioSnapshot): string {
    return [
      "# Venture Studio",
      "",
      `Generated at: ${snapshot.generatedAt}`,
      `Created brands: ${snapshot.createdBrandCount}`,
      `Current launch mode: ${snapshot.nextLaunchMode}`,
      "",
      "## Broad Plan",
      ...snapshot.broadPlan.map((item, index) => `${index + 1}. ${item}`),
      "",
      "## Policy",
      `- Template source: ${snapshot.templateSource.businessName} (${snapshot.templateSource.businessId})`,
      `- Brand creation window: ${snapshot.policy.creationRules.launchWindowLocal}`,
      `- Slowdown threshold: ${snapshot.policy.creationRules.preSlowdownBrandCount} created brands`,
      `- Brand/system reinvestment cap: ${Math.round(snapshot.policy.systemReinvestmentCapRate * 100)}%`,
      ...snapshot.policy.socialRules.map((rule) => `- ${rule}`),
      ...snapshot.policy.cadenceRules.map((rule) => `- ${rule}`),
      "",
      "## Business Blueprints",
      ...snapshot.blueprints.flatMap((blueprint) => [
        `### ${blueprint.businessName}`,
        `- Alias: ${blueprint.aliasEmail}`,
        `- Medium: ${blueprint.medium}`,
        `- Risk mode: ${blueprint.riskPolicy.mode}`,
        `- Composite score: ${blueprint.selectionScore.composite}`,
        `- Facebook strategy: ${blueprint.socialArchitecture.facebookStrategy}`,
        `- Instagram strategy: ${blueprint.socialArchitecture.instagramStrategy} (${blueprint.socialArchitecture.niches.length} lane(s))`,
        `- Departments: ${blueprint.orgStructure.departments.length}`,
        `- Workflow owners: ${blueprint.orgStructure.workflowOwnership.length}`,
        `- This week's randomized cadence: ${blueprint.cadence.coreOutput.selected} ${blueprint.cadence.coreOutput.label} ${blueprint.cadence.coreOutput.period}; ${blueprint.cadence.feedPosts.selected} ${blueprint.cadence.feedPosts.label} ${blueprint.cadence.feedPosts.period}; ${blueprint.cadence.storiesOrReels.selected} ${blueprint.cadence.storiesOrReels.label} ${blueprint.cadence.storiesOrReels.period}.`,
        "- Startup phases:",
        ...blueprint.startupPhases.map((phase) => `  - ${phase.title}`),
        ""
      ]),
      "## Capital Experiment Tracks",
      ...snapshot.capitalExperimentTracks.flatMap((track) => [
        `### ${track.name}`,
        `- Stage: ${track.stage}`,
        `- Thesis: ${track.thesis}`,
        ...track.gates.map((gate) => `- Gate: ${gate}`),
        ""
      ])
    ].join("\n");
  }

  private toCalendarMarkdown(snapshot: VentureStudioSnapshot): string {
    return [
      "# Venture Launch Calendar",
      "",
      `Generated at: ${snapshot.generatedAt}`,
      "",
      ...snapshot.launchWindows.flatMap((window) => [
        `## ${window.id}`,
        `- Mode: ${window.mode}`,
        `- Starts at: ${window.startsAt}`,
        `- Ends at: ${window.endsAt}`,
        `- Timezone: ${window.timezone}`,
        `- Reason: ${window.reason}`,
        ""
      ])
    ].join("\n");
  }

  private toBlueprintMarkdown(blueprint: VentureBlueprint): string {
    return [
      `# ${blueprint.businessName}`,
      "",
      `- Business id: ${blueprint.businessId}`,
      `- Category: ${blueprint.category}`,
      `- Medium: ${blueprint.medium}`,
      `- Alias: ${blueprint.aliasEmail}`,
      `- Handle stem: ${blueprint.handleStem}`,
      `- Template source: ${blueprint.templateSourceBusinessId}`,
      `- Risk mode: ${blueprint.riskPolicy.mode}`,
      `- Launch priority: ${blueprint.launchPriority}`,
      `- Selection score: ${blueprint.selectionScore.composite}`,
      "",
      "## Stack",
      ...blueprint.stack.map((item) => `- ${item}`),
      "",
      "## Signup Targets",
      ...blueprint.signupTargets.map((item) => `- ${item}`),
      "",
      "## Startup Phases",
      ...blueprint.startupPhases.flatMap((phase) => [
        `### ${phase.title}`,
        ...phase.goals.map((goal) => `- Goal: ${goal}`),
        ...phase.heuristics.map((heuristic) => `- Heuristic: ${heuristic}`),
        ...phase.completionSignals.map((signal) => `- Completion signal: ${signal}`),
        ""
      ]),
      "## This Week's Randomized Cadence",
      `- ${blueprint.cadence.coreOutput.selected} ${blueprint.cadence.coreOutput.label} ${blueprint.cadence.coreOutput.period}`,
      `- ${blueprint.cadence.feedPosts.selected} ${blueprint.cadence.feedPosts.label} ${blueprint.cadence.feedPosts.period}`,
      `- ${blueprint.cadence.storiesOrReels.selected} ${blueprint.cadence.storiesOrReels.label} ${blueprint.cadence.storiesOrReels.period}`,
      `- ${blueprint.cadence.activeDays.selected} ${blueprint.cadence.activeDays.label} ${blueprint.cadence.activeDays.period}`,
      ...blueprint.cadence.notes.map((note) => `- Note: ${note}`),
      "",
      "## Growth Focus",
      ...blueprint.growthFocus.map((item) => `- ${item}`),
      "",
      "## Org Structure",
      `- Blueprint id: ${blueprint.orgStructure.blueprintId}`,
      ...blueprint.orgStructure.departments.flatMap((department) => [
        `### ${department.name}`,
        `- Purpose: ${department.purpose}`,
        ...department.positionTitles.map((title) => `- Position: ${title}`),
        ""
      ]),
      "### Workflow Ownership",
      ...blueprint.orgStructure.workflowOwnership.map(
        (owner) =>
          `- ${owner.workflowName}: ${owner.departmentKind} / ${owner.positionTitle} (${owner.allowedModelTier})`
      ),
      "### Approval Model",
      ...blueprint.orgStructure.approvalModel.map((line) => `- ${line}`),
      "",
      "## Social Architecture",
      `- Umbrella brand: ${blueprint.socialArchitecture.umbrellaBrandName}`,
      `- Umbrella alias: ${blueprint.socialArchitecture.umbrellaAliasEmail}`,
      `- Facebook strategy: ${blueprint.socialArchitecture.facebookStrategy}`,
      `- Instagram strategy: ${blueprint.socialArchitecture.instagramStrategy}`,
      `- Max Instagram accounts per device: ${blueprint.socialArchitecture.maxInstagramAccountsPerDevice}`,
      ...blueprint.socialArchitecture.notes.map((note) => `- Note: ${note}`),
      "",
      "### Social Account Plan",
      ...blueprint.socialArchitecture.accountPlan.flatMap((plan) => [
        `- ${plan.platform}: ${plan.quantity} (${plan.ownership})`,
        `  Purpose: ${plan.purpose}`,
        `  Alias pattern: ${plan.aliasPattern}`,
        ...plan.notes.map((note) => `  Note: ${note}`)
      ]),
      "",
      ...(blueprint.socialArchitecture.niches.length > 0
        ? [
            "### Niche Lanes",
            ...blueprint.socialArchitecture.niches.flatMap((lane) => [
              `- ${lane.name}`,
              `  Focus: ${lane.focus}`,
              `  Alias: ${lane.aliasEmail}`,
              `  Handle stem: ${lane.handleStem}`,
              ...lane.notes.map((note) => `  Note: ${note}`)
            ]),
            ""
          ]
        : []),
      "",
      "## Reinvestment Rules",
      `- Brand reinvestment cap: ${Math.round(blueprint.reinvestment.brandRate * 100)}%`,
      `- Collective reinvestment cap: ${Math.round(blueprint.reinvestment.collectiveCapRate * 100)}%`,
      `- Cashout threshold: $${blueprint.reinvestment.cashoutThreshold}`,
      ...blueprint.reinvestment.rules.map((rule) => `- ${rule}`),
      "",
      "## Risk Guardrails",
      ...blueprint.riskPolicy.guardrails.map((rule) => `- ${rule}`),
      "",
      "## Agent Roles",
      ...blueprint.agentRoles.flatMap((role) => [
        `### ${role.name}`,
        `- Mission: ${role.mission}`,
        ...role.outputs.map((output) => `- Output: ${output}`),
        ...role.autonomyRules.map((rule) => `- Rule: ${rule}`),
        ""
      ])
    ].join("\n");
  }
}
