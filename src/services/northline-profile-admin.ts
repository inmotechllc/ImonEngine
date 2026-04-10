import type { AppConfig } from "../config.js";
import {
  isAgencyPricingTierPaymentLinkKey,
  type AgencyProfile
} from "../domain/contracts.js";
import type { ManagedBusiness } from "../domain/engine.js";
import {
  DEFAULT_NORTHLINE_BUSINESS_ID,
  type NorthlineBusinessProfileConfig,
  type ResolvedNorthlineBusinessProfile
} from "../domain/northline.js";
import { readTextFile } from "../lib/fs.js";
import { FileStore } from "../storage/store.js";
import {
  northlineBusinessOpsDir,
  northlineBusinessSourceDir,
  northlineBusinessStateFilePath,
  pricingTierLabelForPaymentLinkKey,
  resolveNorthlineBusinessProfile
} from "./northline-business-profile.js";

type FetchLike = typeof fetch;

type PaymentLinkKey = "lead_generation" | "founding" | "standard" | "growth_upgrade";

type PaymentLinkStatus = "missing" | "invalid" | "configured" | "reachable" | "unreachable";

export interface NorthlinePaymentLinkCheck {
  key: PaymentLinkKey;
  required: boolean;
  url?: string;
  status: PaymentLinkStatus;
  detail: string;
  httpStatus?: number;
}

type PaymentLinkDefinition = {
  key: PaymentLinkKey;
  label: string;
  required: boolean;
  url?: string;
  missingDetail?: string;
};

export interface NorthlinePaymentReadinessResult {
  businessId: string;
  businessName: string;
  status: "ready" | "blocked";
  summary: string;
  checks: NorthlinePaymentLinkCheck[];
  probeAttempted: boolean;
  note: string;
}

export interface NorthlineProfileAdminResult {
  businessId: string;
  businessName: string;
  storedProfile?: NorthlineBusinessProfileConfig;
  resolvedProfile: ResolvedNorthlineBusinessProfile;
  runtimePaths: {
    opsDir: string;
    sourceDir: string;
    autonomyStatePath: string;
    collectionStatePath: string;
    sourcingStatePath: string;
  };
  paymentReadiness?: NorthlinePaymentReadinessResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compactString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return [...new Set(value.map((item) => compactString(item)).filter((item): item is string => Boolean(item)))];
}

function sanitizeProofPoints(value: unknown): AgencyProfile["proofPoints"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return undefined;
      }

      const stat = compactString(item.stat);
      const label = compactString(item.label);
      const detail = compactString(item.detail);
      if (!stat || !label || !detail) {
        return undefined;
      }

      return { stat, label, detail };
    })
    .filter((item): item is AgencyProfile["proofPoints"][number] => Boolean(item));
}

function sanitizeTrustSignals(value: unknown): AgencyProfile["trustSignals"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return undefined;
      }

      const label = compactString(item.label);
      const title = compactString(item.title);
      const body = compactString(item.body);
      if (!label || !title || !body) {
        return undefined;
      }

      return { label, title, body };
    })
    .filter((item): item is AgencyProfile["trustSignals"][number] => Boolean(item));
}

function sanitizeProofArtifacts(value: unknown): AgencyProfile["proofArtifacts"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return undefined;
      }

      const label = compactString(item.label);
      const title = compactString(item.title);
      const body = compactString(item.body);
      const items = stringArray(item.items) ?? [];
      if (!label || !title || !body) {
        return undefined;
      }

      return { label, title, body, items };
    })
    .filter((item): item is AgencyProfile["proofArtifacts"][number] => Boolean(item));
}

function hasSupportedStripeHost(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname.toLowerCase().includes("stripe.com");
  } catch {
    return false;
  }
}

function sanitizeServiceStack(value: unknown): AgencyProfile["serviceStack"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return undefined;
      }

      const title = compactString(item.title);
      const description = compactString(item.description);
      if (!title || !description) {
        return undefined;
      }

      return { title, description };
    })
    .filter((item): item is AgencyProfile["serviceStack"][number] => Boolean(item));
}

function sanitizeProcess(value: unknown): AgencyProfile["process"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return undefined;
      }

      const step = compactString(item.step);
      const title = compactString(item.title);
      const body = compactString(item.body);
      if (!step || !title || !body) {
        return undefined;
      }

      return { step, title, body };
    })
    .filter((item): item is AgencyProfile["process"][number] => Boolean(item));
}

function sanitizePricingCta(value: unknown): AgencyProfile["pricing"][number]["cta"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const label = compactString(value.label);
  const mode = value.mode === "review" || value.mode === "checkout" ? value.mode : undefined;
  const href = compactString(value.href);
  if (!label || !mode) {
    return undefined;
  }

  return {
    label,
    mode,
    href
  };
}

function sanitizePricingUpgradeOffer(
  value: unknown
): AgencyProfile["pricing"][number]["upgradeOffer"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const label = compactString(value.label);
  const terms = compactString(value.terms);
  const paymentLinkKey = compactString(value.paymentLinkKey);
  if (!label || !terms) {
    return undefined;
  }

  return {
    label,
    terms,
    paymentLinkKey: isAgencyPricingTierPaymentLinkKey(paymentLinkKey) ? paymentLinkKey : undefined
  };
}

function sanitizePricing(value: unknown): AgencyProfile["pricing"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .map((item): AgencyProfile["pricing"][number] | undefined => {
      if (!isRecord(item)) {
        return undefined;
      }

      const id = compactString(item.id);
      const label = compactString(item.label);
      const amount = compactString(item.amount);
      const details = compactString(item.details);
      const idealFor = compactString(item.idealFor);
      const includes = stringArray(item.includes);
      const paymentLinkKey = compactString(item.paymentLinkKey);
      const cta = sanitizePricingCta(item.cta);
      const upgradeOffer = sanitizePricingUpgradeOffer(item.upgradeOffer);
      if (!id || !label || !amount || !details || !idealFor || includes === undefined) {
        return undefined;
      }

      const next: AgencyProfile["pricing"][number] = {
        id,
        label,
        amount,
        details,
        idealFor,
        includes
      };

      if (isAgencyPricingTierPaymentLinkKey(paymentLinkKey)) {
        next.paymentLinkKey = paymentLinkKey;
      }
      if (cta) {
        next.cta = cta;
      }
      if (upgradeOffer) {
        next.upgradeOffer = upgradeOffer;
      }

      return next;
    })
    .filter((item): item is AgencyProfile["pricing"][number] => Boolean(item));
}

function sanitizeFaqs(value: unknown): AgencyProfile["faqs"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return undefined;
      }

      const question = compactString(item.question);
      const answer = compactString(item.answer);
      if (!question || !answer) {
        return undefined;
      }

      return { question, answer };
    })
    .filter((item): item is AgencyProfile["faqs"][number] => Boolean(item));
}

function sanitizeAgencyProfilePatch(value: unknown): Partial<AgencyProfile> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const next: Partial<AgencyProfile> = {};
  const name = compactString(value.name);
  const headline = compactString(value.headline);
  const supportingCopy = compactString(value.supportingCopy);
  const audience = compactString(value.audience);
  const heroNote = compactString(value.heroNote);
  const industries = stringArray(value.industries);
  const differentiators = stringArray(value.differentiators);
  const proofPoints = sanitizeProofPoints(value.proofPoints);
  const trustSignals = sanitizeTrustSignals(value.trustSignals);
  const proofArtifacts = sanitizeProofArtifacts(value.proofArtifacts);
  const serviceStack = sanitizeServiceStack(value.serviceStack);
  const process = sanitizeProcess(value.process);
  const pricing = sanitizePricing(value.pricing);
  const faqs = sanitizeFaqs(value.faqs);
  const closingNote = compactString(value.closingNote);

  if (name !== undefined) next.name = name;
  if (headline !== undefined) next.headline = headline;
  if (supportingCopy !== undefined) next.supportingCopy = supportingCopy;
  if (audience !== undefined) next.audience = audience;
  if (heroNote !== undefined) next.heroNote = heroNote;
  if (industries !== undefined) next.industries = industries;
  if (differentiators !== undefined) next.differentiators = differentiators;
  if (proofPoints !== undefined) next.proofPoints = proofPoints;
  if (trustSignals !== undefined) next.trustSignals = trustSignals;
  if (proofArtifacts !== undefined) next.proofArtifacts = proofArtifacts;
  if (serviceStack !== undefined) next.serviceStack = serviceStack;
  if (process !== undefined) next.process = process;
  if (pricing !== undefined) next.pricing = pricing;
  if (faqs !== undefined) next.faqs = faqs;
  if (closingNote !== undefined) next.closingNote = closingNote;

  return Object.keys(next).length > 0 ? next : undefined;
}

function unwrapProfilePatch(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("Northline profile patch must be a JSON object.");
  }

  if (isRecord(value.northlineProfile)) {
    return value.northlineProfile;
  }

  return value;
}

function sanitizeNorthlineProfilePatch(value: unknown): NorthlineBusinessProfileConfig {
  const source = unwrapProfilePatch(value);
  const next: NorthlineBusinessProfileConfig = {};

  const primaryServiceArea = compactString(source.primaryServiceArea);
  const collectionAreas = stringArray(source.collectionAreas);
  const collectionTrades = stringArray(source.collectionTrades);
  const targetIndustries = stringArray(source.targetIndustries);
  const targetServices = stringArray(source.targetServices);
  const offerSummary = compactString(source.offerSummary);
  const salesEmail = compactString(source.salesEmail);
  const siteUrl = compactString(source.siteUrl);
  const domain = compactString(source.domain);
  const bookingUrl = compactString(source.bookingUrl);
  const leadFormAction = compactString(source.leadFormAction);
  const stripeLeadGeneration = compactString(source.stripeLeadGeneration);
  const stripeFounding = compactString(source.stripeFounding);
  const stripeStandard = compactString(source.stripeStandard);
  const growthUpgrade = isRecord(source.growthUpgrade)
    ? {
        paymentLink: compactString(source.growthUpgrade.paymentLink),
        couponLabel: compactString(source.growthUpgrade.couponLabel),
        terms: compactString(source.growthUpgrade.terms)
      }
    : undefined;
  const stripeValidation = compactString(source.stripeValidation);
  const agencyProfile = sanitizeAgencyProfilePatch(source.agencyProfile);

  if (primaryServiceArea !== undefined) next.primaryServiceArea = primaryServiceArea;
  if (collectionAreas !== undefined) next.collectionAreas = collectionAreas;
  if (collectionTrades !== undefined) next.collectionTrades = collectionTrades;
  if (targetIndustries !== undefined) next.targetIndustries = targetIndustries;
  if (targetServices !== undefined) next.targetServices = targetServices;
  if (offerSummary !== undefined) next.offerSummary = offerSummary;
  if (salesEmail !== undefined) next.salesEmail = salesEmail;
  if (siteUrl !== undefined) next.siteUrl = siteUrl;
  if (domain !== undefined) next.domain = domain;
  if (bookingUrl !== undefined) next.bookingUrl = bookingUrl;
  if (leadFormAction !== undefined) next.leadFormAction = leadFormAction;
  if (stripeLeadGeneration !== undefined) next.stripeLeadGeneration = stripeLeadGeneration;
  if (stripeFounding !== undefined) next.stripeFounding = stripeFounding;
  if (stripeStandard !== undefined) next.stripeStandard = stripeStandard;
  if (growthUpgrade && Object.values(growthUpgrade).some((value) => value !== undefined)) {
    next.growthUpgrade = growthUpgrade;
  }
  if (stripeValidation !== undefined) next.stripeValidation = stripeValidation;
  if (agencyProfile !== undefined) next.agencyProfile = agencyProfile;

  if (Object.keys(next).length === 0) {
    throw new Error("Northline profile patch does not contain any supported fields.");
  }

  return next;
}

function mergeProfile(
  current: NorthlineBusinessProfileConfig | undefined,
  patch: NorthlineBusinessProfileConfig,
  replace: boolean
): NorthlineBusinessProfileConfig {
  if (replace) {
    return patch;
  }

  return {
    ...current,
    ...patch,
    growthUpgrade:
      current?.growthUpgrade || patch.growthUpgrade
        ? {
            ...current?.growthUpgrade,
            ...patch.growthUpgrade
          }
        : undefined,
    agencyProfile:
      current?.agencyProfile || patch.agencyProfile
        ? {
            ...current?.agencyProfile,
            ...patch.agencyProfile
          }
        : undefined
  };
}

export class NorthlineProfileAdminService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async inspect(options?: {
    businessId?: string;
    probePayments?: boolean;
  }): Promise<NorthlineProfileAdminResult> {
    const businessId = options?.businessId ?? DEFAULT_NORTHLINE_BUSINESS_ID;
    const business = await this.getBusiness(businessId);
    const resolvedProfile = resolveNorthlineBusinessProfile(this.config, business);

    return {
      businessId: resolvedProfile.businessId,
      businessName: resolvedProfile.businessName,
      storedProfile: business?.northlineProfile,
      resolvedProfile,
      runtimePaths: this.runtimePaths(resolvedProfile.businessId),
      paymentReadiness: options?.probePayments ? await this.checkPaymentReadiness(resolvedProfile, true) : undefined
    };
  }

  async updateFromFile(options: {
    businessId: string;
    filePath: string;
    replace?: boolean;
    probePayments?: boolean;
  }): Promise<NorthlineProfileAdminResult> {
    const business = await this.requireBusiness(options.businessId);
    const patch = sanitizeNorthlineProfilePatch(JSON.parse(await readTextFile(options.filePath)));
    const nextBusiness: ManagedBusiness = {
      ...business,
      northlineProfile: mergeProfile(business.northlineProfile, patch, Boolean(options.replace)),
      updatedAt: new Date().toISOString()
    };

    await this.store.saveManagedBusiness(nextBusiness);
    return this.inspect({
      businessId: nextBusiness.id,
      probePayments: options.probePayments
    });
  }

  async checkPayments(options?: {
    businessId?: string;
    probeLinks?: boolean;
  }): Promise<NorthlinePaymentReadinessResult> {
    const businessId = options?.businessId ?? DEFAULT_NORTHLINE_BUSINESS_ID;
    const business = await this.getBusiness(businessId);
    const resolvedProfile = resolveNorthlineBusinessProfile(this.config, business);
    return this.checkPaymentReadiness(resolvedProfile, options?.probeLinks !== false);
  }

  private async getBusiness(businessId: string): Promise<ManagedBusiness | undefined> {
    if (businessId === DEFAULT_NORTHLINE_BUSINESS_ID) {
      return (await this.store.getManagedBusiness(businessId)) ?? undefined;
    }

    return this.requireBusiness(businessId);
  }

  private async requireBusiness(businessId: string): Promise<ManagedBusiness> {
    const business = await this.store.getManagedBusiness(businessId);
    if (!business) {
      throw new Error(`Managed business ${businessId} was not found.`);
    }
    if (business.category !== "client_services_agency") {
      throw new Error(`${business.name} is not a Northline-compatible agency business.`);
    }
    return business;
  }

  private runtimePaths(businessId: string) {
    return {
      opsDir: northlineBusinessOpsDir(this.config, businessId),
      sourceDir: northlineBusinessSourceDir(this.config, businessId),
      autonomyStatePath: northlineBusinessStateFilePath(this.config, businessId, "northlineAutonomy.json"),
      collectionStatePath: northlineBusinessStateFilePath(this.config, businessId, "northlineProspectCollection.json"),
      sourcingStatePath: northlineBusinessStateFilePath(this.config, businessId, "northlineProspectSourcing.json")
    };
  }

  private async checkPaymentReadiness(
    profile: ResolvedNorthlineBusinessProfile,
    probeLinks: boolean
  ): Promise<NorthlinePaymentReadinessResult> {
    const leadGenerationLabel = pricingTierLabelForPaymentLinkKey(
      profile,
      "lead_generation",
      "Lead Generation"
    );
    const pilotLaunchLabel = pricingTierLabelForPaymentLinkKey(profile, "founding", "Pilot Launch");
    const growthSystemLabel = pricingTierLabelForPaymentLinkKey(profile, "standard", "Growth System");
    const growthUpgradeCopyConfigured = Boolean(
      profile.growthUpgrade?.couponLabel || profile.growthUpgrade?.terms
    );
    const checks = await Promise.all([
      this.checkPaymentLink(
        {
          key: "lead_generation",
          label: leadGenerationLabel,
          required: false,
          url: profile.stripeLeadGeneration,
          missingDetail:
            `${leadGenerationLabel} payment link is optional while the public CTA stays review-first. Add it only when Northline wants a dedicated smaller-step checkout.`
        },
        probeLinks
      ),
      this.checkPaymentLink(
        {
          key: "founding",
          label: pilotLaunchLabel,
          required: true,
          url: profile.stripeFounding
        },
        probeLinks
      ),
      this.checkPaymentLink(
        {
          key: "standard",
          label: growthSystemLabel,
          required: true,
          url: profile.stripeStandard
        },
        probeLinks
      ),
      this.checkPaymentLink(
        {
          key: "growth_upgrade",
          label: "Growth upgrade",
          required: false,
          url: profile.growthUpgrade?.paymentLink,
          missingDetail: growthUpgradeCopyConfigured
            ? "Growth upgrade checkout link is missing, but coupon label or terms are configured so the upgrade copy can still render until a dedicated discounted link is added."
            : undefined
        },
        probeLinks
      )
    ]);
    const readyStatus = probeLinks ? "reachable" : "configured";
    const ready = checks.filter((check) => check.required).every((check) => check.status === readyStatus);

    return {
      businessId: profile.businessId,
      businessName: profile.businessName,
      status: ready ? "ready" : "blocked",
      summary: ready
        ? probeLinks
          ? `Northline ${pilotLaunchLabel} and ${growthSystemLabel} payment links responded successfully and look ready for qualified checkout traffic.`
          : `Northline ${pilotLaunchLabel} and ${growthSystemLabel} payment links are configured for qualified checkout traffic.`
        : "Northline payment collection is not ready yet.",
      checks,
      probeAttempted: probeLinks,
      note:
        "This validates link configuration and optional HTTP reachability only. It does not replace completing a real Stripe checkout. Validation and proposal handoff still depend on a real Stripe session carrying the expected validation or client reference."
    };
  }

  private async checkPaymentLink(
    definition: PaymentLinkDefinition,
    probeLinks: boolean
  ): Promise<NorthlinePaymentLinkCheck> {
    const url = compactString(definition.url);
    if (!url) {
      return {
        key: definition.key,
        required: definition.required,
        status: "missing",
        detail: definition.missingDetail ?? `${definition.label} payment link is missing.`
      };
    }

    if (!hasSupportedStripeHost(url)) {
      return {
        key: definition.key,
        required: definition.required,
        url,
        status: "invalid",
        detail: `${definition.label} payment link must be an HTTPS Stripe URL.`
      };
    }

    if (!probeLinks) {
      return {
        key: definition.key,
        required: definition.required,
        url,
        status: "configured",
        detail: `${definition.label} payment link is configured.`
      };
    }

    try {
      let response = await this.fetchImpl(url, {
        method: "HEAD",
        redirect: "follow"
      });
      if (response.status >= 400) {
        response.body?.cancel().catch(() => undefined);
        response = await this.fetchImpl(url, {
          method: "GET",
          redirect: "follow"
        });
      }
      const reachable = response.status >= 200 && response.status < 400;
      response.body?.cancel().catch(() => undefined);

      return {
        key: definition.key,
        required: definition.required,
        url,
        status: reachable ? "reachable" : "unreachable",
        detail: reachable
          ? `${definition.label} payment link responded with HTTP ${response.status}.`
          : `${definition.label} payment link responded with HTTP ${response.status}.`,
        httpStatus: response.status
      };
    } catch (error) {
      return {
        key: definition.key,
        required: definition.required,
        url,
        status: "unreachable",
        detail:
          error instanceof Error
            ? `${definition.label} payment link probe failed: ${error.message}`
            : `${definition.label} payment link probe failed.`
      };
    }
  }
}