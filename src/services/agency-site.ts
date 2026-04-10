import { copyFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import {
  resolveClientProofEligible,
  resolveClientProvenance,
  AgencyPricingTier,
  AgencyPricingTierPaymentLinkKey,
  AgencyProfile,
  ClientJob,
  ProofBundle
} from "../domain/contracts.js";
import { ensureDir, exists, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { FileStore } from "../storage/store.js";

type LaunchStatus = {
  label: string;
  ready: boolean;
  detail: string;
  blocking: boolean;
};

type SocialLink = {
  label: string;
  url: string;
};

type Surface = {
  bookingUrl?: string;
  domain?: string;
  googleBusinessProfileUrl?: string;
  googleReviewUrl?: string;
  leadFormAction?: string;
  phone?: string;
  primaryServiceArea?: string;
  salesEmail?: string;
  siteUrl?: string;
  stripeLeadGeneration?: string;
  stripeFounding?: string;
  stripeStandard?: string;
  growthUpgrade?: {
    paymentLink?: string;
    couponLabel?: string;
    terms?: string;
  };
  stripeValidation?: string;
  socialLinks: SocialLink[];
  statuses: LaunchStatus[];
  roadblocks: string[];
};

type PublishedProofCard = {
  clientName: string;
  headline: string;
  summary: string;
  bullets: string[];
  testimonialQuote?: string;
  screenshots: Array<{
    label: string;
    url: string;
  }>;
};

type PublishedProofState = {
  cards: PublishedProofCard[];
  hasRealSignup: boolean;
};

export type AgencySiteSurfaceOverrides = {
  bookingUrl?: string;
  domain?: string;
  leadFormAction?: string;
  primaryServiceArea?: string;
  salesEmail?: string;
  siteUrl?: string;
  stripeLeadGeneration?: string;
  stripeFounding?: string;
  stripeStandard?: string;
  growthUpgrade?: {
    paymentLink?: string;
    couponLabel?: string;
    terms?: string;
  };
  stripeValidation?: string;
};

const PRICING_TIER_DISPLAY_ORDER = ["lead-generation", "pilot-launch", "growth-system"] as const;

function text(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function placeholder(value: string): boolean {
  return /example\.(com|org|net)/i.test(value) || value.includes("555");
}

function url(value?: string): string | undefined {
  const trimmed = text(value);
  if (!trimmed || placeholder(trimmed) || !/^https?:\/\//i.test(trimmed)) {
    return undefined;
  }
  return trimmed.replace(/\/+$/, "");
}

function routeOrUrl(value?: string): string | undefined {
  const trimmed = text(value);
  if (!trimmed || placeholder(trimmed)) {
    return undefined;
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("./")) {
    return trimmed;
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return undefined;
  }
  return trimmed.replace(/\/+$/, "");
}

function domain(value?: string): string | undefined {
  const trimmed = text(value)?.toLowerCase();
  if (!trimmed || placeholder(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function email(value?: string): string | undefined {
  const trimmed = text(value)?.toLowerCase();
  if (!trimmed || !trimmed.includes("@") || placeholder(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function phone(value?: string): string | undefined {
  const trimmed = text(value);
  if (!trimmed || placeholder(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function brandedInbox(address?: string, host?: string): boolean {
  return Boolean(address && host && address.endsWith(`@${host}`));
}

function html(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveSurface(config: AppConfig, overrides?: AgencySiteSurfaceOverrides): Surface {
  const siteUrl = url(overrides?.siteUrl ?? config.business.siteUrl);
  const bookingUrl = routeOrUrl(overrides?.bookingUrl ?? config.business.bookingUrl);
  const leadFormAction = routeOrUrl(overrides?.leadFormAction ?? config.business.leadFormAction);
  const stripeLeadGeneration = url(overrides?.stripeLeadGeneration ?? config.business.stripeLeadGeneration);
  const stripeFounding = url(overrides?.stripeFounding ?? config.business.stripeFounding);
  const stripeStandard = url(overrides?.stripeStandard ?? config.business.stripeStandard);
  const growthUpgrade = {
    paymentLink: url(overrides?.growthUpgrade?.paymentLink ?? config.business.growthUpgrade?.paymentLink),
    couponLabel: text(overrides?.growthUpgrade?.couponLabel ?? config.business.growthUpgrade?.couponLabel),
    terms: text(overrides?.growthUpgrade?.terms ?? config.business.growthUpgrade?.terms)
  };
  const stripeValidation = url(overrides?.stripeValidation ?? config.business.stripeValidation);
  const salesEmail = email(overrides?.salesEmail ?? config.business.salesEmail);
  const siteDomain = domain(overrides?.domain ?? config.business.domain);
  const phoneNumber = phone(config.business.phone);
  const primaryServiceArea = text(overrides?.primaryServiceArea ?? config.business.primaryServiceArea);
  const googleBusinessProfileUrl = url(config.business.googleBusinessProfileUrl);
  const googleReviewUrl = url(config.business.googleReviewUrl);
  const facebookUrl = url(config.business.facebookUrl);
  const instagramUrl = url(config.business.instagramUrl);
  const linkedinUrl = url(config.business.linkedinUrl);
  const inboxReady = brandedInbox(salesEmail, siteDomain);

  const statuses: LaunchStatus[] = [
    {
      label: "Public proof page URL",
      ready: Boolean(siteUrl),
      detail: siteUrl ? `Connected: ${siteUrl}` : "Missing NORTHLINE_SITE_URL.",
      blocking: true
    },
    {
      label: "Branded sales inbox",
      ready: inboxReady,
      detail: inboxReady ? "Connected" : "Still using a generic inbox or missing domain.",
      blocking: true
    },
    {
      label: "Primary intake route",
      ready: Boolean(leadFormAction || bookingUrl),
      detail:
        leadFormAction
          ? `Hosted intake route is live: ${leadFormAction}`
          : bookingUrl
            ? `Booking route is live: ${bookingUrl}`
            : "Missing both NORTHLINE_LEAD_FORM_ACTION and NORTHLINE_BOOKING_URL.",
      blocking: true
    },
    {
      label: "Stripe payment links",
      ready: Boolean(stripeFounding && stripeStandard),
      detail:
        stripeFounding && stripeStandard
          ? stripeLeadGeneration
            ? "Configured Northline payment paths can take payment."
            : "Pilot Launch and Growth System checkout links are live. Lead Generation can stay review-first until a smaller-step checkout is needed."
          : "One or more required qualified-checkout payment links are still missing.",
      blocking: true
    },
    {
      label: "Growth upgrade path",
      ready: Boolean(growthUpgrade.paymentLink || growthUpgrade.couponLabel || growthUpgrade.terms),
      detail:
        growthUpgrade.paymentLink
          ? "Dedicated Growth upgrade checkout is configured."
          : growthUpgrade.couponLabel || growthUpgrade.terms
            ? "Growth upgrade copy is configured without a dedicated discounted checkout link yet."
            : "Optional. Add Growth upgrade checkout or coupon copy when Lead Generation clients should see the upgrade path.",
      blocking: false
    },
    {
      label: "Booking link",
      ready: Boolean(bookingUrl),
      detail:
        bookingUrl
          ? "Connected."
          : "Optional for the faceless pipeline. Add NORTHLINE_BOOKING_URL if you want calls alongside hosted intake.",
      blocking: false
    },
    {
      label: "Validation checkout link",
      ready: Boolean(stripeValidation),
      detail:
        stripeValidation
          ? "Temporary system-check page can run a $1 validation checkout."
          : "Optional. Add NORTHLINE_STRIPE_PAYMENT_LINK_VALIDATION when you want to test the full post-purchase pipeline.",
      blocking: false
    },
    {
      label: "Sales phone",
      ready: Boolean(phoneNumber),
      detail:
        phoneNumber
          ? "Connected."
          : "Optional for the remote outbound model. Add NORTHLINE_PHONE later if you want a call-forwarding line.",
      blocking: false
    },
    {
      label: "Google Business Profile and review link",
      ready: Boolean(googleBusinessProfileUrl && googleReviewUrl),
      detail:
        googleBusinessProfileUrl && googleReviewUrl
          ? "Connected"
          : "Optional. Add these later if Northline shifts into local SEO or review ops.",
      blocking: false
    },
    {
      label: "Northline social surfaces",
      ready: Boolean(facebookUrl || instagramUrl || linkedinUrl),
      detail:
        facebookUrl || instagramUrl || linkedinUrl
          ? "At least one proof-distribution surface is present."
          : "Optional. Add Facebook, Instagram, or LinkedIn when you want public proof distribution.",
      blocking: false
    }
  ];

  const roadblocks = statuses
    .filter((status) => status.blocking && !status.ready)
    .map((status) => status.label);

  return {
    bookingUrl,
    domain: siteDomain,
    googleBusinessProfileUrl,
    googleReviewUrl,
    leadFormAction,
    phone: phoneNumber,
    primaryServiceArea,
    salesEmail,
    siteUrl,
    stripeLeadGeneration,
    socialLinks: [
      facebookUrl ? { label: "Facebook", url: facebookUrl } : undefined,
      instagramUrl ? { label: "Instagram", url: instagramUrl } : undefined,
      linkedinUrl ? { label: "LinkedIn", url: linkedinUrl } : undefined
    ].filter((link): link is SocialLink => Boolean(link)),
    statuses,
    roadblocks,
    growthUpgrade,
    stripeFounding,
    stripeStandard,
    stripeValidation
  };
}

function pricingTierDisplayRank(id: string): number {
  const rank = PRICING_TIER_DISPLAY_ORDER.indexOf(
    id as (typeof PRICING_TIER_DISPLAY_ORDER)[number]
  );
  return rank === -1 ? PRICING_TIER_DISPLAY_ORDER.length : rank;
}

function orderPricingTiers(pricing: AgencyPricingTier[]): AgencyPricingTier[] {
  return pricing
    .map((tier, index) => ({ tier, index }))
    .sort((left, right) => {
      const rankDifference = pricingTierDisplayRank(left.tier.id) - pricingTierDisplayRank(right.tier.id);
      return rankDifference !== 0 ? rankDifference : left.index - right.index;
    })
    .map((entry) => entry.tier);
}

function paymentLinkForKey(
  surface: Surface,
  key?: AgencyPricingTierPaymentLinkKey
): string | undefined {
  switch (key) {
    case "lead_generation":
      return surface.stripeLeadGeneration;
    case "founding":
      return surface.stripeFounding;
    case "standard":
      return surface.stripeStandard;
    case "growth_upgrade":
      return surface.growthUpgrade?.paymentLink;
    default:
      return undefined;
  }
}

function defaultReviewHrefForTier(tierId: string, primaryHref: string, bookHref: string): string {
  return tierId === "growth-system" ? bookHref : primaryHref;
}

function reviewHrefForTier(
  tier: AgencyPricingTier,
  primaryHref: string,
  bookHref: string
): string {
  return routeOrUrl(tier.cta?.href) ?? defaultReviewHrefForTier(tier.id, primaryHref, bookHref);
}

function reviewLabelForTier(tier: AgencyPricingTier): string {
  return text(tier.cta?.label) ?? (tier.id === "growth-system" ? "Book growth review" : "Get leak review");
}

function qualificationNoteForTier(tier: AgencyPricingTier): string {
  switch (tier.id) {
    case "lead-generation":
      return "Start here when Northline still needs to review the homepage, CTA path, and follow-up leak before anyone prices the broader build.";
    case "pilot-launch":
      return "This is the first implementation hold once Northline confirms the page, CTA path, and first fix are specific enough to ship honestly.";
    case "growth-system":
      return "Keep this later and smaller in the journey. It only makes sense once the first fix is live and Northline has real delivered proof behind the monthly ask.";
    default:
      return "Use the review path first so Northline confirms fit before anyone treats checkout like discovery.";
  }
}

function checkoutActionLabelForTier(tier: AgencyPricingTier): string {
  switch (tier.id) {
    case "lead-generation":
      return "Start Lead Generation";
    case "pilot-launch":
      return "Reserve Pilot Launch";
    case "growth-system":
      return "Start Growth System";
    default:
      return `Start ${tier.label}`;
  }
}

function checkoutRequestLabelForTier(tier: AgencyPricingTier): string {
  switch (tier.id) {
    case "lead-generation":
      return "Request Lead Generation";
    case "pilot-launch":
      return "Request Pilot Launch";
    case "growth-system":
      return "Request Growth System";
    default:
      return `Request ${tier.label}`;
  }
}

function checkoutDetailForTier(tier: AgencyPricingTier): string {
  switch (tier.id) {
    case "lead-generation":
      return "Use this after the leak review confirms a narrow first paid step is enough to tighten the page and intake path.";
    case "pilot-launch":
      return "Use this after Northline confirms the pilot is the right first implementation and the slot should be held now.";
    case "growth-system":
      return "Use this only after the first fix proves out and Northline has real delivered proof behind the broader monthly scope.";
    default:
      return "Use checkout only after Northline confirms fit, scope, and the next deliverable.";
  }
}

function resolveGrowthUpgradePanel(
  pricingTiers: AgencyPricingTier[],
  surface: Surface
): {
  title: string;
  couponLabel?: string;
  terms?: string;
  href?: string;
} | undefined {
  const sourceTier = pricingTiers.find((tier) => tier.upgradeOffer);
  const upgradeOffer = sourceTier?.upgradeOffer;
  if (!upgradeOffer) {
    return undefined;
  }

  return {
    title: upgradeOffer.label,
    couponLabel: surface.growthUpgrade?.couponLabel,
    terms: surface.growthUpgrade?.terms ?? upgradeOffer.terms,
    href: paymentLinkForKey(surface, upgradeOffer.paymentLinkKey) ?? surface.growthUpgrade?.paymentLink
  };
}

function head(title: string, description: string, siteUrl?: string): string {
  return `<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${html(title)}</title>
    <meta name="description" content="${html(description)}" />
    ${siteUrl ? `<meta property="og:url" content="${html(siteUrl)}" />` : ""}
    ${siteUrl ? `<link rel="canonical" href="${html(siteUrl)}" />` : '<meta name="robots" content="noindex, nofollow" />'}
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="./styles.css" />
  </head>`;
}

function renderList(items: string[]): string {
  return items.map((item) => `<li>${html(item)}</li>`).join("");
}

function hasPublicContactSignals(client: Pick<ClientJob, "primaryEmail" | "primaryPhone">): boolean {
  const normalizedEmail = client.primaryEmail.trim().toLowerCase();
  return (
    normalizedEmail.length > 0 &&
    !normalizedEmail.endsWith(".invalid") &&
    !placeholder(normalizedEmail) &&
    !placeholder(client.primaryPhone)
  );
}

function isRealHostedSignup(client: ClientJob): boolean {
  return (
    resolveClientProvenance(client) === "external_inbound" &&
    resolveClientProofEligible(client) &&
    hasPublicContactSignals(client) &&
    client.sourceSubmissionId?.startsWith("northline-intake-") === true
  );
}

function isPublicProofClient(client: ClientJob): boolean {
  const provenance = resolveClientProvenance(client);
  return (
    resolveClientProofEligible(client) &&
    hasPublicContactSignals(client) &&
    (provenance === "external_inbound" || provenance === "external_outbound") &&
    (client.billingStatus === "paid" || client.billingStatus === "retainer_active")
  );
}

async function resolvePublishedProofState(
  config: AppConfig,
  outputDir: string
): Promise<PublishedProofState> {
  const store = new FileStore(config.stateDir);
  const clients = await store.getClients();
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const hasRealSignup = clients.some((client) => isRealHostedSignup(client));
  const proofBundles = (await store.getProofBundles())
    .filter((bundle) => {
      const client = clientById.get(bundle.clientId);
      return (
        client !== undefined &&
        isPublicProofClient(client) &&
        bundle.qaStatus === "passed" &&
        (bundle.siteStatus === "ready" || bundle.siteStatus === "deployed")
      );
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 3);
  const cards: PublishedProofCard[] = [];

  for (const bundle of proofBundles) {
    const screenshots = await publishProofScreenshots(bundle, outputDir);
    if (screenshots.length === 0) {
      continue;
    }

    cards.push({
      clientName: bundle.clientName,
      headline: bundle.publication.headline,
      summary: bundle.publication.summary,
      bullets: bundle.publication.bullets,
      testimonialQuote: bundle.publication.testimonialQuote,
      screenshots
    });
  }

  return {
    cards,
    hasRealSignup
  };
}

async function publishProofScreenshots(
  bundle: ProofBundle,
  outputDir: string
): Promise<PublishedProofCard["screenshots"]> {
  const screenshots: PublishedProofCard["screenshots"] = [];

  for (const screenshot of bundle.screenshots.slice(0, 2)) {
    if (!(await exists(screenshot.path))) {
      continue;
    }

    const targetDir = path.join(outputDir, "proof", slugify(bundle.clientId));
    const fileName = path.basename(screenshot.path);
    const targetPath = path.join(targetDir, fileName);
    await ensureDir(targetDir);
    await copyFile(screenshot.path, targetPath);
    screenshots.push({
      label: screenshot.label,
      url: `./proof/${slugify(bundle.clientId)}/${fileName}`
    });
  }

  return screenshots;
}

function buildChecklist(profile: AgencyProfile, surface: Surface, publishedProof: PublishedProofCard[]): string {
  const readiness = surface.statuses
    .map((status) => `- [${status.ready ? "x" : " "}] ${status.label}: ${status.detail}`)
    .join("\n");
  const roadblocks = surface.roadblocks.map((item) => `- [ ] ${item}`).join("\n");
  const publishedProofLine =
    publishedProof.length > 0
      ? `- [x] Delivered-client proof bundles currently generated: ${publishedProof.length}`
      : "- [ ] Generate at least one delivered-client proof bundle with screenshots before opening the broader Growth System path.";
  const validationFlow = [
    surface.stripeValidation
      ? `- [ ] Open /validation.html, submit the temporary validation intake, and complete the $1 checkout at ${surface.stripeValidation}`
      : "- [ ] Add NORTHLINE_STRIPE_PAYMENT_LINK_VALIDATION or northlineProfile.stripeValidation before you run the temporary $1 validation checkout.",
    "- [ ] After the checkout succeeds, return to /validation.html and trigger the hosted billing handoff. If the hosted callback is unavailable, use the CLI fallback shown on the page.",
    "- [ ] Review the validation preview, QA result, handoff package, and retention artifact before you send ads or cold traffic."
  ].join("\n");

  return [
    `# ${profile.name} Launch Checklist`,
    "",
    "## Repo Work Completed",
    "- Northline homepage, booking page, intake page, privacy page, and thank-you page are generated under runtime/agency-site/.",
    "- Homepage CTA hierarchy now points cold operators to one primary intake step before pricing or checkout asks.",
    "- Homepage proof sections stay hidden on the public page; delivered-client proof still gates the later Growth System path through repo-owned proof bundles.",
    "- Homepage pricing now keeps Lead Generation as the smaller review-first offer, Pilot Launch as the first implementation hold, and Growth System off the public ladder until delivered-client proof exists.",
    "- Qualified checkout now starts at Pilot Launch, and the later Growth System plus upgrade copy only appear once delivered-client proof exists.",
    "- Direct checkout now sits in a lower qualified-buyer block instead of on the first pricing cards, so cold traffic is pushed into leak review before any paid hold.",
    "- Booking and intake forms now ask for the minimum details Northline needs to diagnose the booked-job leak and reply with the next step.",
    "- Managed-business state still carries explicit Northline launch blockers and owner actions.",
    "",
    "## Current Readiness",
    readiness,
    "",
    "## Owner Roadblocks",
    roadblocks || "- [x] No config-driven roadblocks remain.",
    "",
    "## Manual Proof Tasks",
    "- [ ] Close the first three real operators before turning on broad paid traffic.",
    "- [ ] Collect three testimonials or review quotes and publish them on the site or social proof surfaces.",
    "- [ ] Capture before-and-after screenshots for one homepage, one landing page, and one intake or follow-up workflow.",
    publishedProofLine,
    "",
    "## Validation Flow",
    validationFlow,
    "",
    "## Channel Sequence",
    "1. Publish the proof page and route replies into hosted intake or a booking link.",
    "2. Run outbound to 50-100 operators in one niche or metro.",
    "3. Convert the first three externally won clients and turn them into screenshots, testimonials, and teardown proof.",
    "4. Add Google Search or LSA-support landing pages after the close path is proven.",
    "5. Use Meta for remarketing or lead forms after there is traffic to retarget.",
    ""
  ].join("\n");
}

function buildCss(): string {
  return `:root {
  --bg: #08111d;
  --bg-soft: #10233b;
  --surface: rgba(10, 20, 34, 0.76);
  --surface-soft: rgba(255, 255, 255, 0.05);
  --text: #f6efe6;
  --muted: rgba(246, 239, 230, 0.74);
  --line: rgba(255, 255, 255, 0.12);
  --accent: #d98547;
  --accent-soft: #efc4a0;
  --mint: #a9c6bc;
  --shadow: 0 26px 70px rgba(0, 0, 0, 0.34);
  --sans: "Manrope", sans-serif;
  --serif: "Fraunces", serif;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  color: var(--text);
  font-family: var(--sans);
  background:
    radial-gradient(circle at 12% 12%, rgba(217, 133, 71, 0.18), transparent 22%),
    radial-gradient(circle at 84% 16%, rgba(169, 198, 188, 0.14), transparent 22%),
    linear-gradient(160deg, #040913 0%, var(--bg) 48%, var(--bg-soft) 100%);
}
body::before {
  content: "";
  position: fixed;
  inset: -12vh -12vw;
  pointer-events: none;
  background:
    linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.03), transparent),
    radial-gradient(circle at center, rgba(255, 255, 255, 0.02), transparent 58%);
  animation: drift 20s linear infinite;
}
a { color: inherit; }
[hidden] { display: none !important; }
.frame, .site-footer { width: min(1200px, calc(100% - 2rem)); margin: 0 auto; }
.masthead, .subhead {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 0;
  backdrop-filter: blur(18px);
  background: linear-gradient(180deg, rgba(8, 17, 29, 0.86), rgba(8, 17, 29, 0.38));
}
.brand, .nav, .footer-links, .social-links, .hero-badges { display: flex; gap: 0.85rem; flex-wrap: wrap; }
.brand {
  text-decoration: none;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.84rem;
  align-items: center;
}
.brand strong { font-size: 1rem; }
.nav a, .footer-links a, .social-links a, .ops-link {
  color: var(--muted);
  text-decoration: none;
  transition: color 160ms ease;
}
.nav a:hover, .footer-links a:hover, .social-links a:hover, .ops-link:hover { color: var(--text); }
.inline-link {
  color: var(--text);
  text-decoration: underline;
  text-decoration-color: rgba(217, 133, 71, 0.58);
  text-underline-offset: 0.18rem;
}
.page { padding-bottom: 4.5rem; }
.subhead + .page { padding-top: 0.8rem; }
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.02fr) minmax(320px, 0.9fr);
  gap: clamp(1.75rem, 3vw, 3rem);
  align-items: center;
  min-height: clamp(34rem, 74svh, 42rem);
  padding: 0.9rem 0 2.2rem;
}
.hero.hero-solo {
  grid-template-columns: minmax(0, 1fr);
  min-height: auto;
}
.hero-copy {
  display: grid;
  align-content: start;
  gap: 0.9rem;
}
.hero-copy > * { opacity: 0; transform: translateY(18px); animation: rise 680ms ease forwards; }
.hero-copy > :nth-child(2) { animation-delay: 70ms; }
.hero-copy > :nth-child(3) { animation-delay: 140ms; }
.hero-copy > :nth-child(4) { animation-delay: 210ms; }
.hero-copy > :nth-child(5) { animation-delay: 280ms; }
.hero-copy > :nth-child(6) { animation-delay: 350ms; }
.hero-copy > :nth-child(7) { animation-delay: 420ms; }
.hero-copy > p { margin: 0; }
.eyebrow, .index, .step-tag, .pill, .code-label {
  margin: 0;
  color: var(--accent-soft);
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-size: 0.72rem;
}
.pill {
  display: inline-flex;
  align-items: center;
  padding: 0.45rem 0.8rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(246, 239, 230, 0.84);
}
h1, h2, h3 { margin: 0; font-family: var(--serif); line-height: 0.95; letter-spacing: -0.03em; }
h1 { max-width: 9ch; font-size: clamp(3rem, 5.8vw, 5.3rem); }
h2 { font-size: clamp(2.2rem, 4.7vw, 4rem); }
h3 { font-size: clamp(1.45rem, 2.1vw, 2rem); }
p, li, input, textarea, button { color: var(--muted); line-height: 1.66; }
.lead {
  max-width: 42rem;
  color: rgba(246, 239, 230, 0.9);
  font-size: clamp(1rem, 1.6vw, 1.16rem);
}
.hero-note {
  max-width: 34rem;
  color: rgba(246, 239, 230, 0.78);
}
.action-note {
  margin: 0.6rem 0 0;
  color: rgba(246, 239, 230, 0.72);
}
.mobile-proof-strip { display: none; }
.mobile-proof-strip {
  gap: 0.8rem;
}
.mobile-proof-card, .mobile-trades {
  padding: 0.9rem 1rem;
  border-radius: 1.2rem;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.04);
}
.mobile-proof-card strong {
  display: block;
  margin-top: 0.3rem;
  color: var(--text);
  font-size: 1.2rem;
}
.mobile-proof-card p:last-child, .mobile-trades p { margin-bottom: 0; }
.mobile-trades { grid-column: 1 / -1; }
.mobile-trades .token-cloud { margin-top: 0.75rem; }
.hero-points {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}
.point, .proof-item, .workflow-card, .signal-card, .trust-card, .contact-grid div {
  padding: 1rem 1.1rem;
  border-radius: 1.35rem;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.04);
}
.point strong, .proof-item strong { display: block; margin-top: 0.5rem; color: var(--text); }
.proof-item strong {
  margin-top: 0.3rem;
  font-size: clamp(1.65rem, 3vw, 2.45rem);
}
.point p, .workflow-card p:last-child, .signal-card p:last-child { margin-bottom: 0; }
.actions { display: flex; gap: 0.9rem; flex-wrap: wrap; margin: 1.6rem 0 1rem; }
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 3rem;
  padding: 0.9rem 1.3rem;
  border-radius: 999px;
  border: 1px solid transparent;
  text-decoration: none;
  font-weight: 700;
  color: var(--text);
  background: transparent;
  transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
}
.button:hover { transform: translateY(-2px); box-shadow: var(--shadow); }
.button.is-disabled,
.button[aria-disabled="true"],
.button:disabled {
  opacity: 0.4;
  pointer-events: none;
}
.primary { background: linear-gradient(135deg, var(--accent), #f0ae74); color: #09111d; }
.secondary, .ghost {
  border-color: rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.03);
}
.meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}
.meta div, .contact-grid div { padding-top: 0.9rem; border-top: 1px solid var(--line); }
.meta span, .contact-grid dt {
  display: block;
  margin-bottom: 0.35rem;
  color: rgba(246, 239, 230, 0.56);
  font-size: 0.78rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.meta strong { color: var(--text); font-size: 1rem; line-height: 1.5; }
.signal {
  position: relative;
  overflow: hidden;
  min-height: auto;
  border-radius: 1.9rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background:
    linear-gradient(155deg, rgba(9, 18, 31, 0.94), rgba(8, 14, 24, 0.96)),
    radial-gradient(circle at 84% 14%, rgba(217, 133, 71, 0.18), transparent 22%);
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.28);
}
.signal::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
  background-size: 5rem 5rem;
  opacity: 0.11;
}
.signal-shell { position: relative; z-index: 1; display: grid; gap: 0.95rem; padding: 1.15rem; min-height: 100%; }
.signal-grid, .stack, .prices, .faq, .proof, .workflow-grid, .trust-grid, .proof-summary, .published-proof-grid, .proof-gallery, .checkout-option-list { display: grid; gap: 1rem; }
.signal-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.token-cloud { display: flex; flex-wrap: wrap; gap: 0.8rem; }
.token {
  display: inline-flex;
  align-items: center;
  padding: 0.55rem 0.9rem;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-size: 0.8rem;
  animation: float 8s ease-in-out infinite;
}
.token:nth-child(2) { animation-delay: 1s; }
.token:nth-child(3) { animation-delay: 2s; }
.token:nth-child(4) { animation-delay: 3s; }
.token:nth-child(5) { animation-delay: 4s; }
.signal-box, .card, .panel {
  padding: 1.2rem;
  border-radius: 1.5rem;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(14px);
}
.signal-box { margin-top: auto; }
.signal-box p { margin-bottom: 0; }
.signal-brief {
  padding-top: 0.95rem;
  border-top: 1px solid var(--line);
}
.signal-brief h3 { margin-top: 0.25rem; }
.signal-brief p:last-child { margin-bottom: 0; }
.signal-brief ul {
  margin: 0.75rem 0 0;
  padding-left: 1rem;
}
.signal-fit {
  display: grid;
  gap: 0.85rem;
  padding-top: 0.95rem;
  border-top: 1px solid var(--line);
}
.signal-fit p { margin: 0; }
.signal-copy { color: rgba(246, 239, 230, 0.82); }
.signal-note {
  padding-top: 0.85rem;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(246, 239, 230, 0.72);
}
.signal-note span {
  display: block;
  margin-bottom: 0.35rem;
  color: var(--accent-soft);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-size: 0.72rem;
}
.artifact-card ul {
  margin: 0.9rem 0 0;
  padding-left: 1.1rem;
}
.artifact-card li { color: rgba(246, 239, 230, 0.82); }
.signal-box ul, .price ul, .panel ul, .workflow-card ul { margin: 0.9rem 0 0; padding-left: 1.1rem; }
.proof, .section { padding: 3rem 0; }
.proof { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.proof-summary { grid-template-columns: minmax(0, 0.94fr) minmax(0, 1.06fr); align-items: start; }
.trust-grid { grid-template-columns: 1fr; }
.published-proof-grid { grid-template-columns: 1fr; }
.published-proof { display: grid; grid-template-columns: minmax(0, 0.96fr) minmax(0, 1.04fr); gap: 1.25rem; align-items: start; }
.proof-gallery { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.proof-shot { margin: 0; }
.proof-shot img {
  width: 100%;
  display: block;
  border-radius: 1rem;
  border: 1px solid var(--line);
  background: rgba(10, 20, 34, 0.82);
  box-shadow: var(--shadow);
}
.proof-shot figcaption { margin-top: 0.55rem; color: var(--muted); font-size: 0.92rem; }
.proof-quote {
  margin: 0;
  padding: 1rem 1.1rem;
  border-left: 3px solid var(--accent);
  border-radius: 0.9rem;
  background: rgba(255, 255, 255, 0.04);
  color: var(--accent-soft);
}
.proof-item, .trust-card {
  padding: 0.95rem 0 0;
  border: 0;
  border-top: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
}
.trust-card h3 { margin-top: 0.35rem; }
.trust-card p:last-child { margin-bottom: 0; }
.section-head, .split, .closing, .subhero, .grid, .validation-layout { display: grid; }
.section-head {
  grid-template-columns: minmax(0, 0.78fr) minmax(0, 0.9fr);
  gap: 1.35rem;
  margin-bottom: 1.55rem;
  align-items: start;
}
.stack {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 1.4rem;
  row-gap: 1.25rem;
}
.row, .step {
  display: grid;
  grid-template-columns: 3.8rem minmax(0, 1fr);
  gap: 1rem;
}
.row, .step, .price, .faq-item, .panel, .workflow-card, .signal-card {
  transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
}
.price:hover, .workflow-card:hover, .signal-card:hover {
  transform: translateY(-2px);
  border-color: rgba(217, 133, 71, 0.34);
}
.row.card {
  padding: 1rem 0 0;
  border: 0;
  border-top: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
  backdrop-filter: none;
}
.stack .row:nth-child(-n + 2) {
  padding-top: 0;
  border-top: 0;
}
.index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 3rem;
  height: 3rem;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.03);
}
.split {
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 0.76fr);
  gap: 1.6rem;
}
.steps { display: grid; gap: 1rem; }
.step-tag { color: var(--mint); }
.workflow-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.workflow-card ul li { color: rgba(246, 239, 230, 0.8); }
.prices, .faq { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.pricing-stack {
  display: grid;
  gap: 1rem;
}
.pricing-note {
  margin-top: 0.25rem;
}
.price-qualification {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--line);
}
.price-qualification p:last-child { margin-bottom: 0; }
.checkout-gate {
  display: grid;
  gap: 1.25rem;
}
.qualification-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.88fr) minmax(0, 1fr);
  gap: 1rem;
}
.checkout-actions {
  display: flex;
  gap: 0.9rem;
  flex-wrap: wrap;
  margin-top: 1rem;
}
.checkout-option-list {
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  margin-top: 1rem;
}
.checkout-option {
  display: grid;
  gap: 0.8rem;
  align-content: start;
  width: 100%;
  padding: 1rem;
  border-radius: 1.2rem;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
}
.checkout-option h4 { margin: 0.2rem 0 0; }
.checkout-option p { margin: 0; }
.checkout-option .button { width: 100%; margin-top: auto; }
.checkout-upgrade h4 { margin: 0.2rem 0 0; }
.upgrade-coupon {
  margin: 0.45rem 0 0;
  color: var(--accent-soft);
  font-weight: 700;
  letter-spacing: 0.04em;
}
.checkout-upgrade .button { margin-top: 0.85rem; }
.faq-item summary { cursor: pointer; font-weight: 700; color: var(--text); }
.faq-item summary::-webkit-details-marker { display: none; }
.closing {
  grid-template-columns: minmax(0, 0.88fr) minmax(17rem, 0.68fr);
  gap: 1.6rem;
}
.contact-grid { display: grid; gap: 1rem; }
.contact-grid dd { margin: 0; color: var(--text); }
.subhero, .grid {
  grid-template-columns: minmax(0, 1fr) minmax(17rem, 0.62fr);
  gap: 1.35rem;
  margin-bottom: 1.5rem;
  align-items: start;
}
.subhero h1 {
  max-width: 11ch;
  font-size: clamp(2.6rem, 4.7vw, 4.25rem);
}
.validation-layout { grid-template-columns: minmax(0, 1fr) minmax(22rem, 0.82fr); }
.validation-steps, .form, .form-grid { display: grid; gap: 1rem; }
.form-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.panel-lean {
  display: grid;
  gap: 0.85rem;
}
.panel-lean > * { margin: 0; }
.detail-stack {
  display: grid;
  gap: 0.85rem;
  padding-top: 0.9rem;
  border-top: 1px solid var(--line);
}
.detail-stack p { margin: 0; }
.support-note {
  padding-top: 0.9rem;
  border-top: 1px solid var(--line);
  color: rgba(246, 239, 230, 0.82);
}
.panel-callout {
  margin-top: 1rem;
  padding: 0.95rem 1rem;
  border-radius: 1.1rem;
  border: 1px solid rgba(169, 198, 188, 0.2);
  background: rgba(169, 198, 188, 0.08);
}
.panel-callout p:last-child { margin-bottom: 0; }
.panel-cta { margin-top: 0.25rem; }
label { display: grid; gap: 0.45rem; }
input, textarea {
  width: 100%;
  padding: 0.95rem 1rem;
  border-radius: 1rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  font-family: inherit;
  color: var(--text);
}
textarea { min-height: 8rem; resize: vertical; }
.feedback { min-height: 1.2rem; color: var(--accent-soft); }
.success-note {
  margin-top: 1rem;
  padding: 1rem 1.05rem;
  border-radius: 1.2rem;
  border: 1px solid rgba(169, 198, 188, 0.28);
  background: rgba(169, 198, 188, 0.08);
}
.success-note ul {
  margin: 0.75rem 0 0;
  padding-left: 1.1rem;
}
.code-line {
  margin: 0.55rem 0 0;
  padding: 0.9rem 1rem;
  border-radius: 1rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.18);
  color: rgba(246, 239, 230, 0.94);
  font-family: "IBM Plex Mono", "Cascadia Code", monospace;
  font-size: 0.88rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.site-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 1.4rem 0 2.5rem;
  border-top: 1px solid var(--line);
  color: rgba(246, 239, 230, 0.6);
}
.ops-link { font-size: 0.82rem; letter-spacing: 0.12em; text-transform: uppercase; }
@keyframes drift { 0% { transform: translateX(0); } 50% { transform: translateX(2vw); } 100% { transform: translateX(0); } }
@keyframes rise { to { opacity: 1; transform: translateY(0); } }
@keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
@media (max-width: 1100px) {
  .hero, .section-head, .split, .closing, .subhero, .grid, .validation-layout, .proof-summary, .qualification-grid, .published-proof { grid-template-columns: 1fr; }
  .workflow-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .checkout-option-list { grid-template-columns: 1fr; }
}
@media (max-width: 980px) {
  .masthead, .subhead { position: static; }
  .subhead + .page { padding-top: 0; }
  .meta, .hero-points, .proof, .stack, .signal-grid, .prices, .faq, .form-grid { grid-template-columns: 1fr; }
  .stack .row:nth-child(-n + 2) {
    padding-top: 1rem;
    border-top: 1px solid var(--line);
  }
  .stack .row:first-child {
    padding-top: 0;
    border-top: 0;
  }
  .hero {
    min-height: auto;
    padding: 0.75rem 0 2.2rem;
  }
  .signal { min-height: auto; }
}
@media (max-width: 760px) {
  .frame, .site-footer { width: min(100%, calc(100% - 1.25rem)); }
  .row, .step { grid-template-columns: 1fr; }
  .workflow-grid, .proof-gallery { grid-template-columns: 1fr; }
  .hero {
    gap: 1.15rem;
    padding: 0.3rem 0 1.75rem;
  }
  .hero-copy { gap: 0.8rem; }
  h1 { max-width: 9ch; font-size: clamp(2.45rem, 10vw, 3.45rem); }
  .hero-note, .subhero p { line-height: 1.6; }
  .mobile-proof-strip {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .hero-points { display: none; }
  .meta { gap: 0.75rem; }
  .section-head, .subhero, .grid { gap: 1rem; }
  .section-head { margin-bottom: 1.3rem; }
  .signal-shell, .signal-box, .card, .panel { padding: 1.05rem; }
  .section, .proof { padding: 2.35rem 0; }
  .actions { margin: 1.05rem 0 0.65rem; }
}
@media (max-width: 640px) {
  .button { width: 100%; }
  .mobile-proof-strip { grid-template-columns: 1fr; }
  .nav { gap: 0.55rem; }
  .nav a, .footer-links a, .social-links a, .ops-link { font-size: 0.88rem; }
  .lead { font-size: 1rem; }
  .subhero h1 { max-width: 12ch; font-size: clamp(1.95rem, 8.2vw, 2.75rem); }
  .panel-callout { padding: 0.85rem 0.9rem; }
  .site-footer { flex-direction: column; align-items: flex-start; }
}`;
}

function intakeScript(surface: Surface): string {
  if (surface.leadFormAction || !surface.salesEmail) {
    return "";
  }
  return `<script>
const form = document.querySelector("[data-intake-form]");
const feedback = document.querySelector("[data-feedback]");
const readFirst = (data, keys) => {
  for (const key of keys) {
    const value = data.get(key);
    if (value) return String(value);
  }
  return "";
};
if (form) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const subject = encodeURIComponent("Northline intake: " + (data.get("businessName") || "New operator"));
    const body = encodeURIComponent([
      "Owner name: " + readFirst(data, ["contactName", "operatorName", "ownerName"]),
      "Business: " + (data.get("businessName") || ""),
      "Email: " + (data.get("email") || ""),
      "Phone: " + (data.get("phone") || ""),
      "Service area: " + readFirst(data, ["targetArea", "coverageArea", "serviceArea"]),
      "Primary services: " + readFirst(data, ["targetJobs", "jobType", "primaryServices"]),
      "Website: " + readFirst(data, ["pageUrl", "website"]),
      "",
      "Booked-job leak:",
      readFirst(data, ["mainProblem", "responseGap", "biggestLeak"])
    ].join("\\n"));
    window.location.href = "mailto:${html(surface.salesEmail)}?subject=" + subject + "&body=" + body;
    if (feedback) {
      feedback.textContent = "Your mail app should open with the intake drafted.";
    }
  });
}
</script>`;
}

function bookingScript(surface: Surface): string {
  if (surface.leadFormAction || !surface.salesEmail) {
    return "";
  }
  return `<script>
const form = document.querySelector("[data-booking-form]");
const feedback = document.querySelector("[data-booking-feedback]");
const readFirst = (data, keys) => {
  for (const key of keys) {
    const value = data.get(key);
    if (value) return String(value);
  }
  return "";
};
if (form) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const subject = encodeURIComponent("Northline booking request: " + (data.get("businessName") || "New operator"));
    const body = encodeURIComponent([
      "Owner name: " + readFirst(data, ["contactName", "operatorName", "ownerName"]),
      "Business: " + (data.get("businessName") || ""),
      "Email: " + (data.get("email") || ""),
      "Phone: " + (data.get("phone") || ""),
      "Website: " + readFirst(data, ["pageUrl", "website"]),
      "Preferred review window: " + readFirst(data, ["reviewWindow", "callWindow", "preferredCallWindow"]),
      "",
      "Booked-job leak:",
      readFirst(data, ["mainProblem", "responseGap", "biggestLeak"])
    ].join("\\n"));
    window.location.href = "mailto:${html(surface.salesEmail)}?subject=" + subject + "&body=" + body;
    if (feedback) {
      feedback.textContent = "Your mail app should open with the booking request drafted.";
    }
  });
}
</script>`;
}

function validationScript(surface: Surface): string {
  const action = surface.leadFormAction ?? "/api/northline-intake";
  const checkoutUrl = surface.stripeValidation ?? "";
  const actionLiteral = JSON.stringify(action);
  const checkoutUrlLiteral = JSON.stringify(checkoutUrl);

  return `<script>
const validationForm = document.querySelector("[data-validation-form]");
const validationFeedback = document.querySelector("[data-validation-feedback]");
const validationSuccess = document.querySelector("[data-validation-success]");
const validationSummary = document.querySelector("[data-validation-summary]");
const validationCommand = document.querySelector("[data-validation-command]");
const validationCommandBlock = document.querySelector("[data-validation-command-block]");
const validationCheckout = document.querySelector("[data-validation-checkout]");
const validationConfirm = document.querySelector("[data-validation-confirm]");
const validationStatusPanel = document.querySelector("[data-validation-status-panel]");
const validationStatusSummary = document.querySelector("[data-validation-status-summary]");
const validationStatusDetails = document.querySelector("[data-validation-status-details]");
const validationResult = document.querySelector("[data-validation-result]");
const validationResultSummary = document.querySelector("[data-validation-result-summary]");
const validationResultDetails = document.querySelector("[data-validation-result-details]");
const validationResultWarnings = document.querySelector("[data-validation-result-warnings]");
const validationStateKey = "northline-validation-state";
const validationEndpoint = "/api/northline-validation-confirm";
const validationStatusEndpoint = "/api/northline-validation-status";
const validationFormAction = ${actionLiteral};
const checkoutBaseUrl = ${checkoutUrlLiteral};

function loadValidationState() {
  try {
    const raw = window.localStorage.getItem(validationStateKey);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveValidationState(state) {
  try {
    window.localStorage.setItem(validationStateKey, JSON.stringify(state));
  } catch {}
}

function commandFor(submissionId) {
  return submissionId ? "npm run dev -- northline-validation-run --submission " + submissionId : "";
}

function checkoutHrefFor(state) {
  if (!checkoutBaseUrl) {
    return "#";
  }
  try {
    const url = new URL(checkoutBaseUrl, window.location.href);
    const submissionId = typeof state.submissionId === "string" ? state.submissionId : "";
    const checkoutReference =
      typeof state.checkoutReference === "string" && state.checkoutReference
        ? state.checkoutReference
        : submissionId
          ? "validation:" + submissionId
          : "";
    const checkoutEmail =
      typeof state.checkoutEmail === "string" && state.checkoutEmail ? state.checkoutEmail : "";
    if (checkoutReference) {
      url.searchParams.set("client_reference_id", checkoutReference);
    }
    if (checkoutEmail && !url.searchParams.has("prefilled_email")) {
      url.searchParams.set("prefilled_email", checkoutEmail);
    }
    return url.toString();
  } catch {
    return checkoutBaseUrl;
  }
}

function resultDetails(result) {
  if (!result) {
    return "";
  }
  return [
    "Billing: " + result.billingStatus,
    "Site: " + result.siteStatus,
    "QA: " + result.qaStatus,
    result.previewPath ? "Preview: " + result.previewPath : ""
  ].filter(Boolean).join(" | ");
}

function renderWarnings(result) {
  if (!validationResultWarnings) {
    return;
  }
  validationResultWarnings.innerHTML = "";
  const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
  validationResultWarnings.hidden = warnings.length === 0;
  for (const warning of warnings) {
    const item = document.createElement("li");
    item.textContent = warning;
    validationResultWarnings.appendChild(item);
  }
}

function statusSummaryFor(state) {
  const submissionId = typeof state.submissionId === "string" ? state.submissionId : "";
  if (!submissionId) {
    return "";
  }
  if (state.result) {
    return "Submission " + submissionId + " has a persisted hosted validation result.";
  }
  if (typeof state.lastStripeCompletedAt === "string" && state.lastStripeCompletedAt) {
    return state.autoHandoffEnabled
      ? "Stripe recorded the validation checkout. Northline will finish the hosted handoff automatically."
      : "Stripe recorded the validation checkout. Use the hosted confirm button or the CLI fallback to continue.";
  }
  return state.autoHandoffEnabled
    ? "Submission " + submissionId + " is stored. Complete the $1 checkout and this page will sync the hosted handoff automatically."
    : "Submission " + submissionId + " is stored. Complete the $1 checkout, then confirm the paid handoff here or use the CLI fallback.";
}

function statusDetails(state) {
  const submissionId = typeof state.submissionId === "string" ? state.submissionId : "";
  if (!submissionId) {
    return "";
  }
  return [
    "Submission: " + submissionId,
    "Auto handoff: " + (state.autoHandoffEnabled ? "armed" : "manual fallback only"),
    typeof state.checkoutReference === "string" && state.checkoutReference
      ? "Checkout reference: " + state.checkoutReference
      : "Checkout reference: validation:" + submissionId,
    typeof state.lastStripeCompletedAt === "string" && state.lastStripeCompletedAt
      ? "Stripe completion: " + state.lastStripeCompletedAt
      : "Stripe completion: waiting for payment",
    typeof state.lastStripeCustomerEmail === "string" && state.lastStripeCustomerEmail
      ? "Stripe customer: " + state.lastStripeCustomerEmail
      : "Stripe customer: not recorded yet",
    typeof state.lastStripeSessionId === "string" && state.lastStripeSessionId
      ? "Stripe session: " + state.lastStripeSessionId
      : "Stripe session: not recorded yet",
    typeof state.lastConfirmedAt === "string" && state.lastConfirmedAt
      ? "Hosted handoff recorded: " + state.lastConfirmedAt
      : "Hosted handoff recorded: waiting"
  ].join("\n");
}

function renderValidationState(state) {
  const submissionId = typeof state.submissionId === "string" ? state.submissionId : "";
  const confirmationToken = typeof state.confirmationToken === "string" ? state.confirmationToken : "";
  const result = state.result;
  if (validationSuccess) {
    validationSuccess.hidden = !submissionId;
  }
  if (validationSummary) {
    validationSummary.textContent = statusSummaryFor(state);
  }
  if (validationCommand) {
    validationCommand.textContent = commandFor(submissionId);
  }
  if (validationCommandBlock) {
    validationCommandBlock.hidden = !submissionId;
  }
  if (validationCheckout) {
    if (checkoutBaseUrl && submissionId) {
      validationCheckout.href = checkoutHrefFor(state);
      validationCheckout.setAttribute("aria-disabled", "false");
      validationCheckout.classList.remove("is-disabled");
    } else {
      validationCheckout.href = "#";
      validationCheckout.setAttribute("aria-disabled", "true");
      validationCheckout.classList.add("is-disabled");
    }
  }
  if (validationConfirm) {
    validationConfirm.disabled = !submissionId || !confirmationToken;
    validationConfirm.setAttribute(
      "aria-disabled",
      String(!submissionId || !confirmationToken)
    );
  }
  if (validationStatusPanel) {
    validationStatusPanel.hidden = !submissionId;
  }
  if (validationStatusSummary) {
    validationStatusSummary.textContent = statusSummaryFor(state);
  }
  if (validationStatusDetails) {
    validationStatusDetails.textContent = statusDetails(state);
  }
  if (validationResult) {
    validationResult.hidden = !result;
  }
  if (validationResultSummary) {
    validationResultSummary.textContent = result ? result.summary : "";
  }
  if (validationResultDetails) {
    validationResultDetails.textContent = resultDetails(result);
  }
  renderWarnings(result);
}

let validationState = loadValidationState();
renderValidationState(validationState);

async function refreshValidationStatus(options) {
  if (!validationState.submissionId || !validationState.confirmationToken) {
    return;
  }

  const priorResult = validationState.result;
  const priorStripeCompletedAt = validationState.lastStripeCompletedAt;
  const endpoint =
    typeof validationState.statusEndpoint === "string" && validationState.statusEndpoint
      ? validationState.statusEndpoint
      : validationStatusEndpoint;
  const params = new URLSearchParams({
    submissionId: validationState.submissionId,
    confirmationToken: validationState.confirmationToken
  });

  try {
    const response = await fetch(endpoint + "?" + params.toString(), {
      headers: {
        "Accept": "application/json"
      }
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || "Hosted validation status lookup failed.");
    }
    validationState = {
      ...validationState,
      autoHandoffEnabled: Boolean(payload.autoHandoffEnabled),
      lastConfirmedAt:
        payload.confirmation?.lastConfirmedAt || validationState.lastConfirmedAt,
      lastStripeCompletedAt:
        payload.confirmation?.lastStripeCompletedAt || validationState.lastStripeCompletedAt,
      lastStripeCustomerEmail:
        payload.confirmation?.lastStripeCustomerEmail || validationState.lastStripeCustomerEmail,
      lastStripeEventId:
        payload.confirmation?.lastStripeEventId || validationState.lastStripeEventId,
      lastStripeLivemode:
        typeof payload.confirmation?.lastStripeLivemode === "boolean"
          ? payload.confirmation.lastStripeLivemode
          : validationState.lastStripeLivemode,
      lastStripeReferenceId:
        payload.confirmation?.lastStripeReferenceId || validationState.lastStripeReferenceId,
      lastStripeSessionId:
        payload.confirmation?.lastStripeSessionId || validationState.lastStripeSessionId,
      result: payload.confirmation?.lastResult || validationState.result
    };
    saveValidationState(validationState);
    renderValidationState(validationState);

    if (!options?.quiet && validationFeedback) {
      if (!priorResult && validationState.result) {
        validationFeedback.textContent = validationState.result.status === "success"
          ? "Hosted validation handoff completed. Review the generated artifacts below."
          : "Hosted validation handoff finished with follow-up items. Review the persisted result below.";
      } else if (!priorStripeCompletedAt && validationState.lastStripeCompletedAt) {
        validationFeedback.textContent = validationState.autoHandoffEnabled
          ? "Stripe checkout recorded. Northline is running the hosted handoff automatically."
          : "Stripe checkout recorded. Use the hosted confirm button or the CLI fallback to continue.";
      }
    }
  } catch (error) {
    if (!options?.quiet && validationFeedback) {
      validationFeedback.textContent = error instanceof Error ? error.message : "Hosted validation status lookup failed.";
    }
  }
}

if (validationState.submissionId && validationState.confirmationToken) {
  void refreshValidationStatus({ quiet: true });
}

window.addEventListener("focus", () => {
  void refreshValidationStatus({ quiet: true });
});

if (validationForm) {
  validationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (validationFeedback) {
      validationFeedback.textContent = "Submitting validation intake...";
    }
    try {
      const formData = new FormData(validationForm);
      const body = new URLSearchParams();
      formData.forEach((value, key) => {
        if (typeof value === "string") {
          body.append(key, value);
        }
      });
      const response = await fetch(validationFormAction, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
        },
        body: body.toString()
      });
      const payload = await response.json();
      if (!response.ok || !payload.submissionId) {
        throw new Error(payload.message || "Validation intake did not return a submission id.");
      }
      validationState = {
        submissionId: payload.submissionId,
        autoHandoffEnabled: Boolean(payload.validationConfirmation?.autoHandoffEnabled),
        checkoutEmail: formData.get("email") || "",
        checkoutReference:
          payload.validationConfirmation?.checkoutReference || "validation:" + payload.submissionId,
        confirmationToken: payload.validationConfirmation?.confirmationToken || "",
        confirmationEndpoint: payload.validationConfirmation?.endpoint || validationEndpoint,
        lastConfirmedAt: undefined,
        lastStripeCompletedAt: undefined,
        lastStripeCustomerEmail: undefined,
        lastStripeEventId: undefined,
        lastStripeReferenceId: undefined,
        lastStripeSessionId: undefined,
        result: undefined,
        statusEndpoint: payload.validationConfirmation?.statusEndpoint || validationStatusEndpoint
      };
      saveValidationState(validationState);
      renderValidationState(validationState);
      if (validationFeedback) {
        validationFeedback.textContent = payload.validationConfirmation?.confirmationToken
          ? validationState.autoHandoffEnabled
            ? "Validation intake stored. Complete the checkout and this page will sync the hosted handoff automatically."
            : "Validation intake stored. Complete the checkout, then return here and confirm the paid handoff."
          : "Validation intake stored. Complete the checkout, then use the CLI fallback shown below.";
      }
      void refreshValidationStatus({ quiet: true });
    } catch (error) {
      if (validationFeedback) {
        validationFeedback.textContent = error instanceof Error ? error.message : "Validation intake failed.";
      }
    }
  });
}

if (validationConfirm) {
  validationConfirm.addEventListener("click", async () => {
    if (!validationState.submissionId || !validationState.confirmationToken) {
      return;
    }
    validationConfirm.disabled = true;
    validationConfirm.setAttribute("aria-disabled", "true");
    if (validationFeedback) {
      validationFeedback.textContent = "Running hosted validation handoff...";
    }
    try {
      const response = await fetch(validationState.confirmationEndpoint || validationEndpoint, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          submissionId: validationState.submissionId,
          confirmationToken: validationState.confirmationToken,
          status: "retainer_active"
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.result) {
        throw new Error(payload.message || "Hosted validation handoff failed.");
      }
      validationState = {
        ...validationState,
        lastConfirmedAt: new Date().toISOString(),
        result: payload.result
      };
      saveValidationState(validationState);
      renderValidationState(validationState);
      if (validationFeedback) {
        validationFeedback.textContent = payload.result.status === "success"
          ? "Hosted validation handoff completed. Review the generated artifacts below."
          : "Hosted validation handoff finished with follow-up items. Review the result below.";
      }
    } catch (error) {
      if (validationFeedback) {
        validationFeedback.textContent = error instanceof Error ? error.message : "Hosted validation handoff failed.";
      }
    } finally {
      renderValidationState(validationState);
      void refreshValidationStatus({ quiet: true });
    }
  });
}
</script>`;
}

export async function buildAgencySite(
  config: AppConfig,
  profile: AgencyProfile,
  overrides?: AgencySiteSurfaceOverrides
): Promise<string> {
  const outputDir = path.join(config.outputDir, "agency-site");
  const htmlPath = path.join(outputDir, "index.html");
  const cssPath = path.join(outputDir, "styles.css");
  const faviconPath = path.join(outputDir, "favicon.svg");
  const intakePath = path.join(outputDir, "intake.html");
  const bookPath = path.join(outputDir, "book.html");
  const privacyPath = path.join(outputDir, "privacy.html");
  const thankYouPath = path.join(outputDir, "thank-you.html");
  const validationPath = path.join(outputDir, "validation.html");
  const checklistPath = path.join(outputDir, "launch-checklist.md");

  const surface = resolveSurface(config, overrides);
  const publishedProof = (await resolvePublishedProofState(config, outputDir)).cards;
  const hasDeliveredClientProof = publishedProof.length > 0;
  const primaryHref = "./intake.html";
  const primaryLabel = "Get leak review";
  const bookHref = surface.bookingUrl ?? "./book.html";
  const pricingTiers = orderPricingTiers(profile.pricing);
  const publicPricingTiers = pricingTiers.filter(
    (tier) => tier.id !== "growth-system" || hasDeliveredClientProof
  );
  const qualifiedCheckoutTiers = pricingTiers.filter((tier) => {
    if (!tier.paymentLinkKey || tier.paymentLinkKey === "growth_upgrade") {
      return false;
    }

    if (tier.id === "lead-generation") {
      return false;
    }

    if (tier.id === "growth-system") {
      return hasDeliveredClientProof;
    }

    return true;
  });
  const growthUpgradePanel = hasDeliveredClientProof
    ? resolveGrowthUpgradePanel(pricingTiers, surface)
    : undefined;
  const heroPoints = [
    {
      label: "Leak 1",
      title: "Weak homepage",
      body: "Northline rewrites the first screen so homeowners immediately see the service, the next step, and the clearest way to contact you."
    },
    {
      label: "Leak 2",
      title: "Missed calls and quote forms",
      body: "Northline tightens the path from page to phone to follow-up so leads stop dying after hours or after one missed callback."
    },
    {
      label: "Leak 3",
      title: "No clear next step",
      body: "Northline keeps one obvious action live so visitors know whether to call, request help, or wait for a reply."
    }
  ];
  const deliveryTracks = [
    {
      label: "Leak review",
      title: "You get a clear read on what is blocking booked jobs.",
      body: "Northline looks at the homepage, quote path, missed calls, and after-hours follow-up so the first recommendation is specific.",
      checks: [
        "Northline starts with your current page and lead path",
        "You hear whether the next step is a live review or the pilot",
        "You know what Northline would fix first"
      ]
    },
    {
      label: "Pilot build",
      title: "Northline fixes the first page and lead path first.",
      body: "The first pass focuses on the page, CTA, quote request flow, and missed-call recovery that should move more traffic into booked work.",
      checks: [
        "Homepage and CTA are rewritten around the jobs you want",
        "Quote requests and calls are easier to answer",
        "The first fix stays narrow enough to launch quickly"
      ]
    },
    {
      label: "Launch",
      title: "Every lead gets a clearer next step.",
      body: "Northline helps the site, the call path, and the follow-up message work together so visitors know what to do and you know what to say back.",
      checks: [
        "Visitors see one clear action",
        "Follow-up guidance is easier for dispatch or the owner to use",
        "The launch closes obvious gaps before more expansion"
      ]
    },
    {
      label: "Monthly cleanup",
      title: "Monthly work comes later, not before the first win.",
      body: "Northline keeps the retained path later in the journey so monthly work only starts after the first fix is live and the buyer can see real delivery proof.",
      checks: [
        "Monthly work stays tied to booked jobs, not vanity metrics",
        "The first fix is already live before the retainer expands",
        "Proof and follow-up get stronger after launch"
      ]
    }
  ];
  const checkoutChecks = [
    "Northline has already reviewed the page, CTA path, and missed-call or follow-up leak.",
    "You know whether the next paid step is the pilot implementation or a later monthly scope.",
    "If Growth System is on the table, the first fix is already live and Northline has real delivered proof to point to."
  ];
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    name: profile.name,
    description: profile.supportingCopy,
    url: surface.siteUrl,
    email: surface.salesEmail,
    telephone: surface.phone,
    areaServed: surface.primaryServiceArea,
    serviceType: profile.serviceStack.map((item) => item.title),
    sameAs: surface.socialLinks.map((item) => item.url)
  });

  const home = `<!doctype html>
<html lang="en">
  ${head(profile.name, profile.supportingCopy, surface.siteUrl)}
  <body>
    <div class="frame">
      <header class="masthead">
        <a class="brand" href="./index.html"><strong>Northline</strong><span>Growth Systems</span></a>
        <nav class="nav">
          <a href="#delivery">What you get</a>
          <a href="#services">What gets fixed</a>
          <a href="#workflow">How it works</a>
          <a href="#pricing">Pricing</a>
        </nav>
      </header>

      <main class="page">
        <section class="hero hero-solo">
          <div class="hero-copy">
            <div class="hero-badges">
              <p class="eyebrow">${html(profile.name)}</p>
              <span class="pill">For small home-service teams with demand already coming in</span>
            </div>
            <h1>${html(profile.headline)}</h1>
            <p class="lead">${html(profile.supportingCopy)}</p>
            <div class="actions">
              <a class="button primary" href="${html(primaryHref)}">${html(primaryLabel)}</a>
            </div>
            <p class="action-note">Need to talk through one urgent leak first? <a class="inline-link" href="${html(bookHref)}">Book a live review</a>.</p>
            <p class="hero-note">${html(profile.heroNote)}</p>
            <div class="hero-points">
              ${heroPoints
                .map(
                  (item) => `<article class="point"><p class="eyebrow">${html(item.label)}</p><strong>${html(item.title)}</strong><p>${html(item.body)}</p></article>`
                )
                .join("")}
            </div>
            <div class="meta">
              <div><span>Focus</span><strong>${html(profile.audience)}</strong></div>
              <div><span>Service area</span><strong>${html(surface.primaryServiceArea ?? "Set NORTHLINE_PRIMARY_SERVICE_AREA before launch.")}</strong></div>
              <div><span>Next step</span><strong>Start with the leak review. Book the live review only if you need a short call before Northline points to the next fix.</strong></div>
            </div>
          </div>
        </section>

        <section class="section" id="services">
          <div class="section-head">
            <div>
              <p class="eyebrow">Service stack</p>
              <h2>Northline fixes the stretch between a site visit, a missed call, and a booked job.</h2>
            </div>
            <p>The offer stays narrow on purpose: a clearer homepage, tighter lead routing, fewer lost quote requests, and stronger after-hours follow-up.</p>
          </div>
          <div class="stack">
            ${profile.serviceStack
              .map(
                (item, index) => `<article class="row card"><p class="index">${String(index + 1).padStart(2, "0")}</p><div><h3>${html(item.title)}</h3><p>${html(item.description)}</p></div></article>`
              )
              .join("")}
          </div>
        </section>

        <section class="section" id="delivery">
          <div class="section-head">
            <div>
              <p class="eyebrow">What you get</p>
              <h2>Each step answers a buyer question.</h2>
            </div>
            <p>Northline shows what happens after you ask for help: how the leak gets reviewed, what gets fixed first, when you hear back, and how monthly cleanup works.</p>
          </div>
          <div class="workflow-grid">
            ${deliveryTracks
              .map(
                (item) => `<article class="workflow-card card"><p class="eyebrow">${html(item.label)}</p><h3>${html(item.title)}</h3><p>${html(item.body)}</p><ul>${renderList(item.checks)}</ul></article>`
              )
              .join("")}
          </div>
        </section>

        <section class="section split" id="workflow">
          <div>
            <p class="eyebrow">Workflow</p>
            <h2>Northline keeps the first month simple.</h2>
            <p>Small operators do not need a long consulting project to tighten a weak funnel. The first pass should be fast, visible, and easy to approve.</p>
            <ul>${renderList(profile.differentiators)}</ul>
          </div>
          <div class="steps">
            ${profile.process
              .map(
                (item) => `<article class="step"><p class="step-tag">${html(item.step)}</p><div><h3>${html(item.title)}</h3><p>${html(item.body)}</p></div></article>`
              )
              .join("")}
          </div>
        </section>

        <section class="section" id="pricing">
          <div class="section-head">
            <div>
              <p class="eyebrow">Pricing</p>
              <h2>Review first. Ship the first fix second. Open monthly support only after proof exists.</h2>
            </div>
            <p>Cold traffic should start with the leak review. Lead Generation stays the smaller first paid step, Pilot Launch is the first qualified checkout, and Growth System stays off the public ladder until Northline has real delivered proof to show.</p>
          </div>
          <div class="pricing-stack">
            <div class="prices">
              ${publicPricingTiers
                .map((tier) => {
                  const reviewHref = reviewHrefForTier(tier, primaryHref, bookHref);
                  const reviewLabel = reviewLabelForTier(tier);
                  const qualificationNote = qualificationNoteForTier(tier);
                  return `<article class="price card" data-tier-id="${html(tier.id)}"><p class="eyebrow">${html(tier.label)}</p><h3>${html(tier.amount)}</h3><p>${html(tier.details)}</p><p>${html(tier.idealFor)}</p><ul>${renderList(tier.includes)}</ul><div class="price-qualification"><p class="eyebrow">Start here</p><p>${html(qualificationNote)}</p></div><a class="button secondary" href="${html(reviewHref)}">${html(reviewLabel)}</a></article>`;
                })
                .join("")}
            </div>
            ${!hasDeliveredClientProof
              ? `<div class="pricing-note card" data-retainer-hold><p class="eyebrow">Growth System stays later</p><h3>Northline keeps the broader monthly path off the public ladder until a real delivered fix exists.</h3><p>The first public yes should be the leak review or the pilot. Retained work only makes sense once the first implementation is live and Northline has proof-backed reasons to expand.</p></div>`
              : ""}
            <div class="checkout-gate card">
              <div class="section-head">
                <div>
                  <p class="eyebrow">Qualified next step</p>
                  <h3>Checkout only after Northline confirms the first paid fix and fit.</h3>
                </div>
                <p>If Northline has not reviewed the page yet, use the leak review first. Pilot Launch is the first public checkout hold, and Growth System stays lower and later until real delivered proof exists.</p>
              </div>
              <div class="qualification-grid">
                <article class="panel">
                  <p class="eyebrow">Use checkout when</p>
                  <ul>${renderList(checkoutChecks)}</ul>
                  <div class="panel-callout">
                    <p class="eyebrow">If that is not true yet</p>
                    <p>Start with the leak review for the fastest async path, or book the live review if you want Northline to walk the issue with you before scope is priced. Keep the broader monthly ask for later.</p>
                  </div>
                </article>
                <article class="panel">
                  <p class="eyebrow">Reserve once fit is confirmed</p>
                  <p>These checkout links stay lower on purpose. Northline only wants them in front of buyers who already understand the first deliverable and why it is the right next move.</p>
                  <div class="checkout-option-list">
                    ${qualifiedCheckoutTiers
                      .map((tier) => {
                        const checkoutHref = paymentLinkForKey(surface, tier.paymentLinkKey);
                        const reviewHref = reviewHrefForTier(tier, primaryHref, bookHref);
                        const checkoutReady = Boolean(checkoutHref);
                        const actionHref = checkoutHref ?? reviewHref;
                        const actionLabel = checkoutReady
                          ? checkoutActionLabelForTier(tier)
                          : checkoutRequestLabelForTier(tier);
                        const buttonClass = tier.id === "lead-generation" ? "button primary" : "button secondary";
                        return `<article class="checkout-option" data-tier-id="${html(tier.id)}"><div><p class="eyebrow">${html(tier.label)}</p><h4>${html(tier.amount)}</h4></div><p>${html(checkoutDetailForTier(tier))}</p><a class="${buttonClass}" href="${html(actionHref)}">${html(actionLabel)}</a></article>`;
                      })
                      .join("")}
                  </div>
                  ${growthUpgradePanel
                    ? `<div class="panel-callout checkout-upgrade" data-upgrade-panel><p class="eyebrow">After the first win</p><h4>${html(growthUpgradePanel.title)}</h4>${growthUpgradePanel.couponLabel ? `<p class="upgrade-coupon">${html(growthUpgradePanel.couponLabel)}</p>` : ""}<p>${html(growthUpgradePanel.terms ?? "Northline confirms the upgrade terms after the Lead Generation fit review.")}</p>${growthUpgradePanel.href ? `<a class="button secondary" href="${html(growthUpgradePanel.href)}">Open Growth upgrade checkout</a>` : ""}</div>`
                    : ""}
                  <p class="action-note">Need Northline to confirm the fit first? <a class="inline-link" href="${html(primaryHref)}">Start with the leak review</a> or <a class="inline-link" href="${html(bookHref)}">book the live review</a>.</p>
                </article>
              </div>
            </div>
          </div>
        </section>

        <section class="section">
          <div class="section-head">
            <div>
              <p class="eyebrow">FAQ</p>
              <h2>Questions operators usually ask before they commit.</h2>
            </div>
            <p>Northline should feel straightforward for small teams, so scope, timing, and the order of operations stay obvious up front.</p>
          </div>
          <div class="faq" id="faq">
            ${profile.faqs.map((item) => `<details class="faq-item card"><summary>${html(item.question)}</summary><p>${html(item.answer)}</p></details>`).join("")}
          </div>
        </section>

        <section class="section closing">
          <div>
            <p class="eyebrow">Next step</p>
            <h2>Start with the leak that is already costing booked jobs.</h2>
            <p>${html(profile.closingNote)}</p>
            <div class="actions">
              <a class="button primary" href="${html(primaryHref)}">${html(primaryLabel)}</a>
              <a class="button secondary" href="${html(bookHref)}">Book live review</a>
            </div>
            ${surface.socialLinks.length > 0 ? `<div class="social-links">${surface.socialLinks.map((item) => `<a href="${html(item.url)}">${html(item.label)}</a>`).join("")}</div>` : ""}
          </div>
          <dl class="contact-grid">
            ${surface.salesEmail ? `<div><dt>Email</dt><dd>${html(surface.salesEmail)}</dd></div>` : ""}
            ${surface.phone ? `<div><dt>Phone</dt><dd>${html(surface.phone)}</dd></div>` : ""}
            ${surface.primaryServiceArea ? `<div><dt>Primary service area</dt><dd>${html(surface.primaryServiceArea)}</dd></div>` : ""}
            ${surface.googleBusinessProfileUrl ? `<div><dt>Google Business Profile</dt><dd><a href="${html(surface.googleBusinessProfileUrl)}">View profile</a></dd></div>` : ""}
            ${surface.googleReviewUrl ? `<div><dt>Review link</dt><dd><a href="${html(surface.googleReviewUrl)}">Request a review</a></dd></div>` : ""}
          </dl>
        </section>
      </main>
    </div>

    <footer class="site-footer">
      <span>${html(profile.name)}</span>
      <div class="footer-links">
        <a href="./book.html">Live Review</a>
        <a href="./intake.html">Leak Review</a>
        <a href="./privacy.html">Privacy</a>
        <a href="./thank-you.html">Thank you</a>
      </div>
    </footer>

    <script type="application/ld+json">${jsonLd}</script>
  </body>
</html>`;

  const intake = `<!doctype html>
<html lang="en">
  ${head(`${profile.name} Leak Review`, `Send the page and the main leak to ${profile.name}.`, surface.siteUrl ? `${surface.siteUrl}/intake` : undefined)}
  <body>
    <div class="frame">
      <header class="subhead">
        <a class="brand" href="./index.html"><strong>Northline</strong><span>Growth Systems</span></a>
        <nav class="nav">
          <a href="./index.html">Home</a>
          <a href="./book.html">Live Review</a>
          <a href="./privacy.html">Privacy</a>
        </nav>
      </header>
      <main class="page">
        <section class="subhero">
          <div>
            <p class="eyebrow">Async leak review</p>
            <h1>Send the page and the main leak. Northline will tell you what to fix first.</h1>
            <p>Use this when you want a fast answer without scheduling a call. Northline checks the page, the quote path, and the missed-call gap, then tells you the fastest next fix.</p>
          </div>
          <aside class="panel panel-lean">
            <p class="eyebrow">What comes back</p>
            <ul>${renderList([
              "The first thing costing calls or quote requests right now.",
              "The 48-hour fix Northline would ship first.",
              "The clearest next step: leak-review follow-up, live review, or pilot."
            ])}</ul>
            <div class="detail-stack">
              <div>
                <p class="eyebrow">Reply window</p>
                <p>Northline replies within one business day with either the leak review, a live-review recommendation, or one request for missing detail.</p>
              </div>
              <div>
                <p class="eyebrow">What gets checked</p>
                <p>Homepage message, call CTA placement, quote-path friction, and after-hours follow-up gaps.</p>
              </div>
            </div>
            <a class="button secondary panel-cta" href="${html(bookHref)}">Need a live review instead?</a>
          </aside>
        </section>

        <section class="grid">
          <div class="panel">
            <form class="form" data-intake-form ${surface.leadFormAction ? `action="${html(surface.leadFormAction)}" method="post"` : 'method="post"'}>
              <div class="form-grid">
                <label>Business name<input name="businessName" required /></label>
                <label>Your name<input name="contactName" required /></label>
                <label>Email<input name="email" type="email" required /></label>
                <label>Phone<input name="phone" type="tel" required /></label>
                <label>Current page or website<input name="pageUrl" type="url" placeholder="https://..." required /></label>
                <label>Main service area<input name="targetArea" placeholder="Akron, OH" /></label>
              </div>
              <label>Best jobs to book more of<input name="targetJobs" placeholder="Emergency plumbing repair, drain cleaning" /></label>
              <label>What looks broken right now?<textarea name="mainProblem" required></textarea></label>
              <input type="hidden" name="source" value="northline-website-intake" />
              <button class="button primary" type="submit">Send Leak Review</button>
              <p class="feedback" data-feedback></p>
            </form>
          </div>
          <aside class="panel panel-lean">
            <p class="eyebrow">Sample first-pass handoff</p>
            <ul>${renderList([
              "Headline rewrite to match the jobs you actually want more of.",
              "One CTA or quote-path change to stop the first drop-off.",
              "A missed-call or after-hours follow-up fix if calls are dying off the page."
            ])}</ul>
            <div class="support-note">
              <p class="eyebrow">Best fit</p>
              <p>Owner-led plumbing, HVAC, electrical, roofing, and cleaning teams that already have traffic but need clearer conversion from it.</p>
            </div>
          </aside>
        </section>
      </main>
    </div>
    ${intakeScript(surface)}
  </body>
</html>`;

  const booking = `<!doctype html>
<html lang="en">
  ${head(`${profile.name} Live Review`, `Book a short live review with ${profile.name}.`, surface.siteUrl ? `${surface.siteUrl}/book` : undefined)}
  <body>
    <div class="frame">
      <header class="subhead">
        <a class="brand" href="./index.html"><strong>Northline</strong><span>Growth Systems</span></a>
        <nav class="nav">
          <a href="./index.html">Home</a>
          <a href="./intake.html">Leak Review</a>
          <a href="./privacy.html">Privacy</a>
        </nav>
      </header>
      <main class="page">
        <section class="subhero">
          <div>
            <p class="eyebrow">Live review</p>
            <h1>Book a 15-minute live review if you want Northline to point at the leak with you.</h1>
            <p>Use this when you want Northline to look at one urgent leak with you live. If the async leak review is enough, Northline says so instead of stretching the process into a longer call.</p>
          </div>
          <aside class="panel panel-lean">
            <p class="eyebrow">What gets reviewed</p>
            <ul>${renderList([
              "The first-screen message and call CTA.",
              "The quote path or form friction blocking replies.",
              "The missed-call or after-hours follow-up gap."
            ])}</ul>
            <div class="detail-stack">
              <div>
                <p class="eyebrow">What you leave with</p>
                <p>One fix worth shipping first, whether the pilot makes sense, and the fastest next step after the call.</p>
              </div>
            </div>
            <a class="button secondary panel-cta" href="./intake.html">Need the async leak review instead?</a>
          </aside>
        </section>

        <section class="grid">
          <div class="panel">
            <form class="form" data-booking-form ${surface.leadFormAction ? `action="${html(surface.leadFormAction)}" method="post"` : 'method="post"'}>
              <div class="form-grid">
                <label>Business name<input name="businessName" required /></label>
                <label>Your name<input name="contactName" required /></label>
                <label>Email<input name="email" type="email" required /></label>
                <label>Phone<input name="phone" type="tel" required /></label>
                <label>Page to review<input name="pageUrl" type="url" placeholder="https://..." required /></label>
                <label>Preferred review window<input name="reviewWindow" placeholder="Tue 1-3pm ET" required /></label>
              </div>
              <label>What should Northline look at first?<textarea name="mainProblem" required></textarea></label>
              <input type="hidden" name="source" value="northline-booking-page" />
              <button class="button primary" type="submit">Request Live Review</button>
              <p class="feedback" data-booking-feedback></p>
            </form>
          </div>
          <aside class="panel panel-lean">
            <p class="eyebrow">If a call is not needed</p>
            <ul>${renderList([
              "Northline will push you back to the async leak review instead of padding the process.",
              "You still get the fastest next step for the page, CTA, or missed-call issue.",
              "The pilot only comes up after the leak is clear enough to price."
            ])}</ul>
            <div class="support-note">
              <p class="eyebrow">Best fit</p>
              <p>Businesses that already have traffic or referrals coming in but need help turning the first visit into a booked call or quote request.</p>
            </div>
          </aside>
        </section>
      </main>
    </div>
    ${bookingScript(surface)}
  </body>
</html>`;

  const privacy = `<!doctype html>
<html lang="en">
  ${head(`${profile.name} Privacy`, `Privacy notice for ${profile.name}.`, surface.siteUrl ? `${surface.siteUrl}/privacy` : undefined)}
  <body>
    <div class="frame">
      <header class="subhead">
        <a class="brand" href="./index.html"><strong>Northline</strong><span>Growth Systems</span></a>
        <nav class="nav">
          <a href="./index.html">Home</a>
          <a href="./book.html">Live Review</a>
          <a href="./intake.html">Leak Review</a>
        </nav>
      </header>
      <main class="page">
        <section class="subhero">
          <div>
            <p class="eyebrow">Privacy</p>
            <h1>Northline uses intake data to qualify and deliver work, not to build a data warehouse.</h1>
            <p>This is a launch-ready baseline notice. Review it with counsel before running scaled paid acquisition or collecting regulated data.</p>
          </div>
        </section>
        <section class="grid">
          <article class="panel"><p class="eyebrow">Collected</p><ul>${renderList(["Name, company, phone, email, service area, website, and intake notes", "Commercial details needed to scope proposals, previews, and delivery", "Basic analytics or attribution signals if tools are connected later"])}</ul></article>
          <article class="panel"><p class="eyebrow">Used for</p><ul>${renderList(["Fit checks and operator communication", "Teardowns, proposals, previews, and client delivery", "Payment, reviews, retention, and monthly optimization work"])}</ul></article>
          <article class="panel"><p class="eyebrow">Tools</p><ul>${renderList(["Email and scheduling providers", "Payment processors", "Hosting, analytics, and CRM tools connected during launch or delivery"])}</ul></article>
          <article class="panel"><p class="eyebrow">Contact</p><ul>${renderList([
            surface.salesEmail ? `Email: ${surface.salesEmail}` : "Set NORTHLINE_SALES_EMAIL before publishing.",
            surface.phone ? `Phone: ${surface.phone}` : "Phone is optional for Northline's remote outbound model.",
            surface.siteUrl ? `Site: ${surface.siteUrl}` : "Set NORTHLINE_SITE_URL before publishing."
          ])}</ul></article>
        </section>
      </main>
    </div>
  </body>
</html>`;

  const thankYou = `<!doctype html>
<html lang="en">
  ${head(`Thanks | ${profile.name}`, `Thanks for contacting ${profile.name}.`, surface.siteUrl)}
  <body>
    <div class="frame">
      <main class="page">
        <section class="subhero">
          <div>
            <p class="eyebrow">Thanks</p>
            <h1>Northline has what it needs to review the intake.</h1>
            <p>Northline reviews the request, replies with the next step, and points you to either a live teardown, the pilot scope, or a request for missing details. Keep the process direct and keep the close path simple.</p>
            <div class="actions">
              <a class="button primary" href="./index.html">Back to home</a>
              <a class="button secondary" href="./intake.html">Send another intake</a>
            </div>
          </div>
        </section>
      </main>
    </div>
  </body>
</html>`;

  const validation = `<!doctype html>
<html lang="en">
  ${head(`${profile.name} Validation`, `Temporary validation page for ${profile.name}.`)}
  <body>
    <div class="frame">
      <header class="subhead">
        <a class="brand" href="./index.html"><strong>Northline</strong><span>Growth Systems</span></a>
        <nav class="nav">
          <a href="./index.html">Home</a>
          <a href="./intake.html">Intake</a>
          <a href="./book.html">Book</a>
        </nav>
      </header>
      <main class="page">
        <section class="subhero">
          <div>
            <p class="eyebrow">Pipeline validation</p>
            <h1>Run one low-risk Northline purchase before you send real traffic.</h1>
            <p>Use this temporary page to validate hosted intake capture, the $1 checkout path, billing handoff, preview build, QA, client handoff packaging, and retention artifacts.</p>
          </div>
          <aside class="panel">
            <p class="eyebrow">What this page is for</p>
            <ul>${renderList([
              "Self-test the full post-purchase workflow before you launch ads or publish broad outbound.",
              "Confirm the intake, billing handoff, build, QA, and handoff packaging steps all fire in the order you expect.",
              "Lock the Stripe checkout behind a stored validation intake so the webhook can keep the hosted submission reference.",
              "Disable or remove the page once the validation pass is complete."
            ])}</ul>
            ${surface.stripeValidation
              ? `<p>Submit the validation intake first. The $1 checkout button unlocks only after the page stores the hosted submission and mints the Stripe checkout reference.</p>`
              : `<p>Add NORTHLINE_STRIPE_PAYMENT_LINK_VALIDATION or northlineProfile.stripeValidation to activate the checkout step.</p>`}
          </aside>
        </section>

        <section class="validation-layout">
          <div class="panel">
            <form class="form" data-validation-form>
              <div class="form-grid">
                <label>Owner name<input name="ownerName" required /></label>
                <label>Business name<input name="businessName" required /></label>
                <label>Email<input name="email" type="email" required /></label>
                <label>Phone<input name="phone" type="tel" required /></label>
                <label>Service area<input name="serviceArea" required /></label>
                <label>Current website<input name="website" type="url" placeholder="https://..." /></label>
              </div>
              <label>Primary services<input name="primaryServices" value="Northline validation run" required /></label>
              <label>Validation goal<input name="leadGoal" value="Validate the full Northline post-purchase pipeline" required /></label>
              <label>What should this run verify?<textarea name="biggestLeak" required>Hosted intake, validation checkout, billing handoff, preview build, QA, client handoff packaging, and retention artifacts.</textarea></label>
              <label>Notes<textarea name="notes">Temporary $1 ops validation before Northline publishes wider outbound or ads.</textarea></label>
              <input type="hidden" name="source" value="northline-validation-page" />
              <button class="button primary" type="submit">Create Validation Intake</button>
              <p class="feedback" data-validation-feedback></p>
              <div class="success-note" data-validation-success hidden>
                <p class="eyebrow">Submission stored</p>
                <p data-validation-summary></p>
                <div data-validation-command-block hidden>
                  <p class="code-label">CLI fallback</p>
                  <pre class="code-line" data-validation-command></pre>
                </div>
                <div class="actions">
                  <a class="button secondary${surface.stripeValidation ? "" : " is-disabled"}" data-validation-checkout href="${html(surface.stripeValidation ?? "#")}" rel="nofollow"${surface.stripeValidation ? "" : ' aria-disabled="true"'}>Continue to $1 checkout</a>
                  <button class="button primary" type="button" data-validation-confirm disabled aria-disabled="true">Confirm paid handoff</button>
                </div>
                <div class="panel-callout" data-validation-status-panel hidden>
                  <p class="eyebrow">Persisted status</p>
                  <p data-validation-status-summary></p>
                  <pre class="code-line" data-validation-status-details></pre>
                </div>
                <div class="panel-callout" data-validation-result hidden>
                  <p class="eyebrow">Latest hosted result</p>
                  <p data-validation-result-summary></p>
                  <pre class="code-line" data-validation-result-details></pre>
                  <ul data-validation-result-warnings hidden></ul>
                </div>
              </div>
            </form>
          </div>
          <aside class="validation-steps">
            <article class="panel">
              <p class="eyebrow">Step 1</p>
              <h3>Store the validation intake.</h3>
              <p>Keep this in the same hosted intake system Northline uses for real operators so the promotion flow is not bypassed.</p>
            </article>
            <article class="panel">
              <p class="eyebrow">Step 2</p>
              <h3>Complete the $1 checkout.</h3>
              <p>Use the checkout button that appears only after Step 1 succeeds. That button carries the hosted submission reference Stripe needs so the webhook can persist the handoff state here automatically.</p>
            </article>
            <article class="panel">
              <p class="eyebrow">Step 3</p>
              <h3>Confirm the paid handoff.</h3>
              <p>Use the hosted confirmation button only when you need to force the manual fallback. Otherwise, let the persisted status panel show the Stripe event and hosted result without dropping back to the shell.</p>
            </article>
            <article class="panel">
              <p class="eyebrow">Step 4</p>
              <h3>Review every artifact.</h3>
              <p>Open the preview, inspect the QA result, confirm the handoff package exists, and verify the retention artifact if you ran the validation as a retainer.</p>
            </article>
          </aside>
        </section>
      </main>
    </div>
    ${validationScript(surface)}
  </body>
</html>`;

  const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Northline">
  <defs>
    <linearGradient id="g" x1="0%" x2="100%" y1="0%" y2="100%">
      <stop offset="0%" stop-color="#f08a41" />
      <stop offset="100%" stop-color="#ffd3b0" />
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="16" fill="#07101d" />
  <path d="M16 46V18h8l16 18V18h8v28h-8L24 28v18z" fill="url(#g)" />
</svg>`;

  await writeTextFile(htmlPath, home);
  await writeTextFile(cssPath, buildCss());
  await writeTextFile(faviconPath, favicon);
  await writeTextFile(intakePath, intake);
  await writeTextFile(bookPath, booking);
  await writeTextFile(privacyPath, privacy);
  await writeTextFile(thankYouPath, thankYou);
  await writeTextFile(validationPath, validation);
  await writeTextFile(checklistPath, buildChecklist(profile, surface, publishedProof));
  return htmlPath;
}
