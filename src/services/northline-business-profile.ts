import path from "node:path";
import type { AppConfig } from "../config.js";
import {
  clientCountsTowardExternalRevenue,
  isAgencyClientAcquisitionLead,
  type ClientJob,
  type AgencyPricingTierPaymentLinkKey,
  type LeadRecord
} from "../domain/contracts.js";
import { DEFAULT_AGENCY_PROFILE } from "../domain/defaults.js";
import type {
  ResolvedNorthlineBusinessProfile,
  NorthlineBusinessProfileConfig,
  NorthlineGrowthUpgradeConfig,
  NorthlineTrade
} from "../domain/northline.js";
import {
  DEFAULT_NORTHLINE_BUSINESS_ID,
  NORTHLINE_NATIONWIDE_COLLECTION_AREA_ALIAS,
  NORTHLINE_NATIONWIDE_US_COLLECTION_AREAS,
  SUPPORTED_NORTHLINE_TRADES
} from "../domain/northline.js";
import { slugify, unique } from "../lib/text.js";

type NorthlineBusinessLike = {
  id?: string;
  name?: string;
  northlineProfile?: NorthlineBusinessProfileConfig;
};

const TRADE_ALIASES: Record<string, NorthlineTrade> = {
  plumbing: "plumbing",
  plumber: "plumbing",
  hvac: "hvac",
  heating: "hvac",
  cooling: "hvac",
  electrical: "electrical",
  electrician: "electrical",
  roofing: "roofing",
  roofer: "roofing",
  cleaning: "cleaning",
  cleaner: "cleaning"
};

const NATIONWIDE_US_COLLECTION_AREA_ALIASES = new Set([
  slugify(NORTHLINE_NATIONWIDE_COLLECTION_AREA_ALIAS),
  "nationwide",
  "nationwide-usa",
  "us",
  "usa",
  "united-states",
  "united-states-of-america"
]);

const US_STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "al",
  alaska: "ak",
  arizona: "az",
  arkansas: "ar",
  california: "ca",
  colorado: "co",
  connecticut: "ct",
  delaware: "de",
  florida: "fl",
  georgia: "ga",
  hawaii: "hi",
  idaho: "id",
  illinois: "il",
  indiana: "in",
  iowa: "ia",
  kansas: "ks",
  kentucky: "ky",
  louisiana: "la",
  maine: "me",
  maryland: "md",
  massachusetts: "ma",
  michigan: "mi",
  minnesota: "mn",
  mississippi: "ms",
  missouri: "mo",
  montana: "mt",
  nebraska: "ne",
  nevada: "nv",
  "new-hampshire": "nh",
  "new-jersey": "nj",
  "new-mexico": "nm",
  "new-york": "ny",
  "north-carolina": "nc",
  "north-dakota": "nd",
  ohio: "oh",
  oklahoma: "ok",
  oregon: "or",
  pennsylvania: "pa",
  "rhode-island": "ri",
  "south-carolina": "sc",
  "south-dakota": "sd",
  tennessee: "tn",
  texas: "tx",
  utah: "ut",
  vermont: "vt",
  virginia: "va",
  washington: "wa",
  "west-virginia": "wv",
  wisconsin: "wi",
  wyoming: "wy",
  "district-of-columbia": "dc",
  "washington-dc": "dc"
};

type NorthlineLeadAreaLike = Pick<LeadRecord, "geo" | "pipeline" | "targetContext">;
type NorthlineBusinessLeadAreaLike = Pick<LeadRecord, "businessId" | "geo" | "pipeline" | "targetContext">;
type ParsedAreaScope = {
  normalized: string;
  locality?: string;
  state?: string;
};

const NORTHLINE_ACTIVE_LEAD_STAGES = new Set<LeadRecord["stage"]>([
  "qualified",
  "drafted",
  "contacted",
  "responded"
]);

function compact(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return unique(
    values
      .map((value) => compact(value))
      .filter((value): value is string => Boolean(value))
  );
}

function placeholderSiteUrl(): string {
  return "https://example.com";
}

function placeholderSalesEmail(): string {
  return "sales@example.com";
}

function resolveGrowthUpgrade(
  override: NorthlineBusinessProfileConfig["growthUpgrade"] | undefined,
  fallback: NorthlineGrowthUpgradeConfig | undefined
): NorthlineGrowthUpgradeConfig | undefined {
  const paymentLink = compact(override?.paymentLink) ?? compact(fallback?.paymentLink);
  const couponLabel = compact(override?.couponLabel) ?? compact(fallback?.couponLabel);
  const terms = compact(override?.terms) ?? compact(fallback?.terms);

  if (!paymentLink && !couponLabel && !terms) {
    return undefined;
  }

  return {
    paymentLink,
    couponLabel,
    terms
  };
}

function normalizeTrades(values: string[]): NorthlineTrade[] {
  return unique(
    values
      .map((value) => TRADE_ALIASES[slugify(value)])
      .filter((value): value is NorthlineTrade => value !== undefined)
  );
}

function defaultTradesFromAgencyProfile(industries: string[]): NorthlineTrade[] {
  const trades = normalizeTrades(industries);
  return trades.length > 0 ? trades : [...SUPPORTED_NORTHLINE_TRADES];
}

function isNationwideUsCollectionArea(value: string): boolean {
  return NATIONWIDE_US_COLLECTION_AREA_ALIASES.has(slugify(value));
}

function expandCollectionAreas(values: string[], primaryServiceArea?: string): string[] {
  const expanded: Array<string | undefined> = [];

  for (const value of values) {
    if (isNationwideUsCollectionArea(value)) {
      expanded.push(primaryServiceArea, ...NORTHLINE_NATIONWIDE_US_COLLECTION_AREAS);
      continue;
    }

    expanded.push(value);
  }

  return uniqueStrings(expanded);
}

function normalizeStateToken(value: string | undefined): string | undefined {
  const trimmed = compact(value);
  const normalized = trimmed ? slugify(trimmed) : undefined;
  if (!normalized) {
    return undefined;
  }
  if (normalized.length === 2) {
    return normalized;
  }
  return US_STATE_NAME_TO_CODE[normalized];
}

function parseAreaScope(value: string | undefined): ParsedAreaScope | undefined {
  const trimmed = compact(value);
  if (!trimmed) {
    return undefined;
  }

  const parts = trimmed
    .split(",")
    .map((part) => compact(part))
    .filter((part): part is string => Boolean(part));
  const normalized = slugify(trimmed);

  if (parts.length >= 2) {
    const state = normalizeStateToken(parts[parts.length - 1]);
    const locality = slugify(parts.slice(0, -1).join(" "));
    return {
      normalized,
      locality: locality || undefined,
      state
    };
  }

  const state = normalizeStateToken(trimmed);
  if (state) {
    return {
      normalized,
      state
    };
  }

  return {
    normalized,
    locality: normalized
  };
}

function sameAreaScope(left: ParsedAreaScope, right: ParsedAreaScope): boolean {
  if (left.normalized === right.normalized) {
    return true;
  }

  if (left.state && right.state && left.state === right.state) {
    if (!left.locality || !right.locality) {
      return true;
    }
    return left.locality === right.locality;
  }

  return false;
}

export function northlineServiceAreaScope(
  profile: Pick<ResolvedNorthlineBusinessProfile, "collectionAreas" | "primaryServiceArea">
): string[] {
  if (profile.collectionAreas.length > 0) {
    return uniqueStrings(profile.collectionAreas);
  }
  return uniqueStrings([profile.primaryServiceArea]);
}

export function northlineLeadMatchesServiceArea(
  lead: NorthlineLeadAreaLike,
  profile: Pick<ResolvedNorthlineBusinessProfile, "collectionAreas" | "primaryServiceArea">
): boolean {
  const serviceAreas = northlineServiceAreaScope(profile)
    .map((area) => parseAreaScope(area))
    .filter((area): area is ParsedAreaScope => Boolean(area));

  if (serviceAreas.length === 0) {
    return true;
  }

  const leadAreas = uniqueStrings([
    lead.targetContext?.collectionArea,
    lead.targetContext?.market,
    lead.geo
  ])
    .map((area) => parseAreaScope(area))
    .filter((area): area is ParsedAreaScope => Boolean(area));

  if (leadAreas.length === 0) {
    return false;
  }

  return serviceAreas.some((serviceArea) => leadAreas.some((leadArea) => sameAreaScope(serviceArea, leadArea)));
}

export function northlineLeadMatchesBusinessScope(
  lead: NorthlineBusinessLeadAreaLike,
  businessId: string,
  profile: Pick<ResolvedNorthlineBusinessProfile, "collectionAreas" | "primaryServiceArea">
): boolean {
  return (lead.businessId ?? DEFAULT_NORTHLINE_BUSINESS_ID) === businessId &&
    isAgencyClientAcquisitionLead(lead) &&
    northlineLeadMatchesServiceArea(lead, profile);
}

export function countNorthlineScopedActiveWorkItems(
  businessId: string,
  profile: Pick<ResolvedNorthlineBusinessProfile, "collectionAreas" | "primaryServiceArea">,
  leads: LeadRecord[],
  clients: ClientJob[]
): number {
  return (
    leads.filter(
      (lead) =>
        northlineLeadMatchesBusinessScope(lead, businessId, profile) &&
        NORTHLINE_ACTIVE_LEAD_STAGES.has(lead.stage)
    ).length +
    clients.filter(
      (client) =>
        (client.businessId ?? DEFAULT_NORTHLINE_BUSINESS_ID) === businessId &&
        clientCountsTowardExternalRevenue(client) &&
        client.qaStatus !== "passed"
    ).length
  );
}

function resolveAgencyProfile(businessName: string, overrides?: Partial<typeof DEFAULT_AGENCY_PROFILE>) {
  return {
    ...DEFAULT_AGENCY_PROFILE,
    ...overrides,
    name: compact(overrides?.name) ?? businessName,
    headline: compact(overrides?.headline) ?? DEFAULT_AGENCY_PROFILE.headline,
    supportingCopy: compact(overrides?.supportingCopy) ?? DEFAULT_AGENCY_PROFILE.supportingCopy,
    audience: compact(overrides?.audience) ?? DEFAULT_AGENCY_PROFILE.audience,
    heroNote: compact(overrides?.heroNote) ?? DEFAULT_AGENCY_PROFILE.heroNote,
    industries:
      overrides?.industries && overrides.industries.length > 0
        ? [...overrides.industries]
        : [...DEFAULT_AGENCY_PROFILE.industries],
    differentiators:
      overrides?.differentiators && overrides.differentiators.length > 0
        ? [...overrides.differentiators]
        : [...DEFAULT_AGENCY_PROFILE.differentiators],
    proofPoints:
      overrides?.proofPoints && overrides.proofPoints.length > 0
        ? [...overrides.proofPoints]
        : [...DEFAULT_AGENCY_PROFILE.proofPoints],
    trustSignals:
      overrides?.trustSignals && overrides.trustSignals.length > 0
        ? [...overrides.trustSignals]
        : [...DEFAULT_AGENCY_PROFILE.trustSignals],
    serviceStack:
      overrides?.serviceStack && overrides.serviceStack.length > 0
        ? [...overrides.serviceStack]
        : [...DEFAULT_AGENCY_PROFILE.serviceStack],
    process:
      overrides?.process && overrides.process.length > 0
        ? [...overrides.process]
        : [...DEFAULT_AGENCY_PROFILE.process],
    pricing:
      overrides?.pricing && overrides.pricing.length > 0
        ? [...overrides.pricing]
        : [...DEFAULT_AGENCY_PROFILE.pricing],
    faqs:
      overrides?.faqs && overrides.faqs.length > 0
        ? [...overrides.faqs]
        : [...DEFAULT_AGENCY_PROFILE.faqs],
    closingNote: compact(overrides?.closingNote) ?? DEFAULT_AGENCY_PROFILE.closingNote
  };
}

export function isDefaultNorthlineBusiness(businessId: string): boolean {
  return businessId === DEFAULT_NORTHLINE_BUSINESS_ID;
}

export function northlineBusinessOpsDir(config: AppConfig, businessId: string): string {
  return isDefaultNorthlineBusiness(businessId)
    ? path.join(config.opsDir, "northline-growth-system")
    : path.join(config.opsDir, "northline-growth-system", slugify(businessId));
}

export function northlineBusinessSourceDir(config: AppConfig, businessId: string): string {
  return isDefaultNorthlineBusiness(businessId)
    ? config.northlineProspecting.sourceDir
    : path.join(config.northlineProspecting.sourceDir, slugify(businessId));
}

export function northlineBusinessStateFilePath(
  config: AppConfig,
  businessId: string,
  fileName: string
): string {
  return isDefaultNorthlineBusiness(businessId)
    ? path.join(config.stateDir, fileName)
    : path.join(config.stateDir, "northline", slugify(businessId), fileName);
}

export function resolveNorthlineBusinessProfile(
  config: AppConfig,
  business?: NorthlineBusinessLike
): ResolvedNorthlineBusinessProfile {
  const businessId = business?.id ?? DEFAULT_NORTHLINE_BUSINESS_ID;
  const businessName = compact(business?.name) ?? config.business.name ?? DEFAULT_AGENCY_PROFILE.name;
  const settings = business?.northlineProfile;
  const agencyProfile = resolveAgencyProfile(businessName, settings?.agencyProfile);
  const primaryServiceArea =
    compact(settings?.primaryServiceArea) ??
    (isDefaultNorthlineBusiness(businessId) ? compact(config.business.primaryServiceArea) : undefined);
  const configuredCollectionAreas = expandCollectionAreas(
    uniqueStrings(settings?.collectionAreas ?? []),
    primaryServiceArea
  );
  const fallbackCollectionAreas = isDefaultNorthlineBusiness(businessId)
    ? expandCollectionAreas(uniqueStrings(config.northlineProspecting.collectionAreas), primaryServiceArea)
    : [];
  const collectionAreas =
    configuredCollectionAreas.length > 0
      ? configuredCollectionAreas
      : fallbackCollectionAreas.length > 0
        ? fallbackCollectionAreas
        : primaryServiceArea
          ? [primaryServiceArea]
          : [];
  const collectionTrades =
    normalizeTrades(settings?.collectionTrades ?? []).length > 0
      ? normalizeTrades(settings?.collectionTrades ?? [])
      : isDefaultNorthlineBusiness(businessId)
        ? normalizeTrades(config.northlineProspecting.collectionTrades)
        : defaultTradesFromAgencyProfile(settings?.targetIndustries ?? agencyProfile.industries);
  const targetIndustries = uniqueStrings([
    ...(settings?.targetIndustries ?? agencyProfile.industries)
  ]);
  const targetServices = uniqueStrings([
    ...(settings?.targetServices ?? agencyProfile.serviceStack.map((item) => item.title))
  ]);
  const offerSummary =
    compact(settings?.offerSummary) ??
    compact(agencyProfile.supportingCopy) ??
    "Conversion-focused proof pages and intake systems for local operators.";

  return {
    businessId,
    businessName: agencyProfile.name,
    primaryServiceArea,
    collectionAreas,
    collectionTrades: collectionTrades.length > 0 ? collectionTrades : [...SUPPORTED_NORTHLINE_TRADES],
    targetIndustries: targetIndustries.length > 0 ? targetIndustries : [...agencyProfile.industries],
    targetServices,
    offerSummary,
    salesEmail:
      compact(settings?.salesEmail) ??
      (isDefaultNorthlineBusiness(businessId) ? config.business.salesEmail : placeholderSalesEmail()),
    siteUrl:
      compact(settings?.siteUrl) ??
      (isDefaultNorthlineBusiness(businessId) ? config.business.siteUrl : placeholderSiteUrl()),
    domain:
      compact(settings?.domain) ??
      (isDefaultNorthlineBusiness(businessId) ? compact(config.business.domain) : undefined),
    bookingUrl:
      compact(settings?.bookingUrl) ??
      (isDefaultNorthlineBusiness(businessId) ? compact(config.business.bookingUrl) : undefined),
    leadFormAction:
      compact(settings?.leadFormAction) ??
      (isDefaultNorthlineBusiness(businessId) ? compact(config.business.leadFormAction) : undefined),
    stripeLeadGeneration:
      compact(settings?.stripeLeadGeneration) ??
      (isDefaultNorthlineBusiness(businessId) ? compact(config.business.stripeLeadGeneration) : undefined),
    stripeFounding:
      compact(settings?.stripeFounding) ??
      (isDefaultNorthlineBusiness(businessId) ? compact(config.business.stripeFounding) : undefined),
    stripeStandard:
      compact(settings?.stripeStandard) ??
      (isDefaultNorthlineBusiness(businessId) ? compact(config.business.stripeStandard) : undefined),
    growthUpgrade: resolveGrowthUpgrade(
      settings?.growthUpgrade,
      isDefaultNorthlineBusiness(businessId) ? config.business.growthUpgrade : undefined
    ),
    stripeValidation:
      compact(settings?.stripeValidation) ??
      (isDefaultNorthlineBusiness(businessId) ? compact(config.business.stripeValidation) : undefined),
    sourceDir: northlineBusinessSourceDir(config, businessId),
    agencyProfile
  };
}

export function pricingTierLabelForPaymentLinkKey(
  profile: Pick<ResolvedNorthlineBusinessProfile, "agencyProfile">,
  paymentLinkKey: AgencyPricingTierPaymentLinkKey,
  fallback: string
): string {
  return (
    profile.agencyProfile.pricing.find((tier) => tier.paymentLinkKey === paymentLinkKey)?.label ??
    fallback
  );
}