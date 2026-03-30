import path from "node:path";
import type { AppConfig } from "../config.js";
import type { AgencyProfile } from "../domain/contracts.js";
import { writeTextFile } from "../lib/fs.js";

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
  stripeFounding?: string;
  stripeStandard?: string;
  socialLinks: SocialLink[];
  statuses: LaunchStatus[];
  roadblocks: string[];
};

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

function resolveSurface(config: AppConfig): Surface {
  const siteUrl = url(config.business.siteUrl);
  const bookingUrl = routeOrUrl(config.business.bookingUrl);
  const leadFormAction = routeOrUrl(config.business.leadFormAction);
  const stripeFounding = url(config.business.stripeFounding);
  const stripeStandard = url(config.business.stripeStandard);
  const salesEmail = email(config.business.salesEmail);
  const siteDomain = domain(config.business.domain);
  const phoneNumber = phone(config.business.phone);
  const primaryServiceArea = text(config.business.primaryServiceArea);
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
          ? "Both offers can take payment."
          : "One or both payment links are still missing.",
      blocking: true
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
    socialLinks: [
      facebookUrl ? { label: "Facebook", url: facebookUrl } : undefined,
      instagramUrl ? { label: "Instagram", url: instagramUrl } : undefined,
      linkedinUrl ? { label: "LinkedIn", url: linkedinUrl } : undefined
    ].filter((link): link is SocialLink => Boolean(link)),
    statuses,
    roadblocks,
    stripeFounding,
    stripeStandard
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
    <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=Cormorant+Garamond:wght@500;600;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="./styles.css" />
  </head>`;
}

function renderList(items: string[]): string {
  return items.map((item) => `<li>${html(item)}</li>`).join("");
}

function buildChecklist(profile: AgencyProfile, surface: Surface): string {
  const readiness = surface.statuses
    .map((status) => `- [${status.ready ? "x" : " "}] ${status.label}: ${status.detail}`)
    .join("\n");
  const roadblocks = surface.roadblocks.map((item) => `- [ ] ${item}`).join("\n");

  return [
    `# ${profile.name} Launch Checklist`,
    "",
    "## Repo Work Completed",
    "- Northline homepage, booking page, intake page, privacy page, and thank-you page are generated under runtime/agency-site/.",
    "- Offer copy, process, and FAQ copy are aligned with the proof page.",
    "- Managed-business state now carries explicit Northline launch blockers and owner actions.",
    "- The hosted intake path can point at a repo-owned VPS endpoint instead of an external form tool.",
    "- Social scaffolding now plans proof distribution surfaces for Northline.",
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
    "",
    "## Channel Sequence",
    "1. Publish the proof page and route replies into hosted intake or a booking link.",
    "2. Run outbound to 50-100 operators in one niche or metro.",
    "3. Convert the first three pilots and turn them into screenshots, testimonials, and teardown proof.",
    "4. Add Google Search or LSA-support landing pages after the close path is proven.",
    "5. Use Meta for remarketing or lead forms after there is traffic to retarget.",
    ""
  ].join("\n");
}

function buildCss(): string {
  return `:root {
  --ink: #f5efe6;
  --muted: rgba(245, 239, 230, 0.78);
  --line: rgba(245, 239, 230, 0.12);
  --accent: #f08a41;
  --bg: #07101d;
  --bg-soft: #0f1a2f;
  --panel: rgba(255, 255, 255, 0.04);
  --sans: "Sora", sans-serif;
  --serif: "Cormorant Garamond", serif;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  color: var(--ink);
  font-family: var(--sans);
  background:
    radial-gradient(circle at 15% 15%, rgba(240, 138, 65, 0.2), transparent 24%),
    radial-gradient(circle at 80% 18%, rgba(122, 151, 193, 0.16), transparent 26%),
    linear-gradient(160deg, #040914, var(--bg) 44%, var(--bg-soft));
}
body::before {
  content: "";
  position: fixed;
  inset: -20vh -20vw;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.03), transparent);
  pointer-events: none;
  animation: drift 18s linear infinite;
}
a { color: inherit; }
.frame, .site-footer { width: min(1180px, calc(100% - 2rem)); margin: 0 auto; }
.masthead, .subhead {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.2rem 0;
  backdrop-filter: blur(14px);
}
.brand, .nav, .footer-links, .social-links { display: flex; gap: 1rem; flex-wrap: wrap; }
.brand { text-decoration: none; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.84rem; }
.brand strong { font-size: 1rem; }
.nav a, .footer-links a, .social-links a { color: var(--muted); text-decoration: none; }
.page { padding-bottom: 4rem; }
.hero {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(320px, 0.85fr);
  gap: clamp(2rem, 4vw, 4rem);
  align-items: center;
  min-height: calc(100svh - 6rem);
  padding: 1rem 0 3.5rem;
}
.hero-copy > * { opacity: 0; transform: translateY(18px); animation: rise 680ms ease forwards; }
.hero-copy > :nth-child(2) { animation-delay: 80ms; }
.hero-copy > :nth-child(3) { animation-delay: 160ms; }
.hero-copy > :nth-child(4) { animation-delay: 240ms; }
.hero-copy > :nth-child(5) { animation-delay: 320ms; }
.hero-copy > :nth-child(6) { animation-delay: 400ms; }
.eyebrow, .index, .step-tag { margin: 0; color: #ffd3b0; text-transform: uppercase; letter-spacing: 0.22em; font-size: 0.72rem; }
h1, h2, h3 { margin: 0; font-family: var(--serif); line-height: 0.95; }
h1 { max-width: 10ch; font-size: clamp(3.4rem, 7vw, 6.8rem); }
h2 { font-size: clamp(2.4rem, 5vw, 4.2rem); }
h3 { font-size: clamp(1.55rem, 2.4vw, 2.15rem); }
p, li, input, textarea { color: var(--muted); line-height: 1.7; }
.actions { display: flex; gap: 0.9rem; flex-wrap: wrap; margin: 2rem 0; }
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 3rem;
  padding: 0.9rem 1.3rem;
  border-radius: 999px;
  border: 1px solid transparent;
  text-decoration: none;
  font-weight: 600;
  transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}
.button:hover { transform: translateY(-2px); box-shadow: 0 18px 40px rgba(0, 0, 0, 0.28); }
.primary { background: linear-gradient(135deg, var(--accent), #ffb06f); color: #09111d; }
.secondary, .ghost { border-color: rgba(255, 255, 255, 0.15); }
.meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}
.meta div, .proof-item, .contact-grid div { padding-top: 0.8rem; border-top: 1px solid var(--line); }
.meta span, .contact-grid dt { display: block; margin-bottom: 0.35rem; color: rgba(245, 239, 230, 0.56); font-size: 0.78rem; letter-spacing: 0.15em; text-transform: uppercase; }
.signal {
  position: relative;
  min-height: 33rem;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 2.2rem;
  background:
    linear-gradient(140deg, rgba(11, 21, 37, 0.88), rgba(7, 12, 22, 0.96)),
    radial-gradient(circle at 76% 20%, rgba(240, 138, 65, 0.2), transparent 24%);
}
.signal::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.06) 1px, transparent 1px);
  background-size: 4rem 4rem;
  opacity: 0.22;
}
.token, .signal-box, .card, .panel {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(12px);
}
.token {
  position: absolute;
  padding: 0.5rem 0.8rem;
  border-radius: 999px;
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  animation: float 8s ease-in-out infinite;
}
.token:nth-child(1) { top: 12%; left: 10%; }
.token:nth-child(2) { top: 24%; right: 14%; animation-delay: 1.2s; }
.token:nth-child(3) { top: 48%; left: 20%; animation-delay: 2.1s; }
.token:nth-child(4) { top: 60%; right: 16%; animation-delay: 3s; }
.token:nth-child(5) { top: 74%; left: 34%; animation-delay: 4s; }
.signal-box {
  position: absolute;
  right: 1.4rem;
  bottom: 1.4rem;
  width: min(21rem, calc(100% - 2.8rem));
  padding: 1.3rem;
  border-radius: 1.4rem;
}
.proof, .section { padding: 4rem 0; }
.proof { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }
.section-head, .split, .closing, .subhero, .grid { display: grid; gap: 2rem; }
.section-head { grid-template-columns: minmax(0, 0.72fr) minmax(0, 0.9fr); margin-bottom: 2rem; align-items: end; }
.stack, .prices, .faq, .steps { display: grid; gap: 1rem; }
.row, .step, .price, .faq-item, .card, .panel {
  padding: 1.35rem;
  border-radius: 1.5rem;
}
.row, .step { display: grid; grid-template-columns: 5rem minmax(0, 1fr); gap: 1rem; }
.row:hover, .price:hover, .panel:hover { border-color: rgba(240, 138, 65, 0.32); transform: translateY(-2px); }
.row, .price, .panel { transition: transform 160ms ease, border-color 160ms ease; }
.split { grid-template-columns: minmax(0, 0.9fr) minmax(0, 0.75fr); }
.prices, .faq { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.steps { border-left: 1px solid transparent; }
.price ul, .panel ul { margin: 0; padding-left: 1.1rem; }
.faq-item summary { cursor: pointer; font-weight: 600; }
.faq-item summary::-webkit-details-marker { display: none; }
.closing { grid-template-columns: minmax(0, 0.86fr) minmax(18rem, 0.7fr); }
.contact-grid { display: grid; gap: 1rem; }
.contact-grid dd { margin: 0; }
.site-footer {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.2rem 0 2.4rem;
  border-top: 1px solid var(--line);
  color: rgba(245, 239, 230, 0.62);
}
.subhero, .grid { grid-template-columns: minmax(0, 0.95fr) minmax(18rem, 0.7fr); margin-bottom: 2rem; }
.form { display: grid; gap: 1rem; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
label { display: grid; gap: 0.45rem; }
input, textarea {
  width: 100%;
  padding: 0.95rem 1rem;
  border-radius: 1rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  font-family: inherit;
}
textarea { min-height: 8.5rem; resize: vertical; }
.feedback { min-height: 1.2rem; color: #ffd3b0; }
@keyframes drift { 0% { transform: translateX(0); } 50% { transform: translateX(2vw); } 100% { transform: translateX(0); } }
@keyframes rise { to { opacity: 1; transform: translateY(0); } }
@keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
@media (max-width: 980px) {
  .hero, .meta, .proof, .section-head, .split, .prices, .faq, .closing, .subhero, .grid, .form-grid { grid-template-columns: 1fr; }
  .masthead, .subhead { position: static; }
}
@media (max-width: 640px) {
  .frame, .site-footer { width: min(100%, calc(100% - 1.25rem)); }
  .hero { min-height: auto; }
  .row, .step { grid-template-columns: 1fr; }
  .button { width: 100%; }
}`;
}

function intakeScript(surface: Surface): string {
  if (surface.leadFormAction || !surface.salesEmail) {
    return "";
  }
  return `<script>
const form = document.querySelector("[data-intake-form]");
const feedback = document.querySelector("[data-feedback]");
if (form) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const subject = encodeURIComponent("Northline intake: " + (data.get("businessName") || "New operator"));
    const body = encodeURIComponent([
      "Owner name: " + (data.get("ownerName") || ""),
      "Business: " + (data.get("businessName") || ""),
      "Email: " + (data.get("email") || ""),
      "Phone: " + (data.get("phone") || ""),
      "Service area: " + (data.get("serviceArea") || ""),
      "Primary services: " + (data.get("primaryServices") || ""),
      "Website: " + (data.get("website") || ""),
      "Lead goal: " + (data.get("leadGoal") || ""),
      "",
      "Biggest leak:",
      String(data.get("biggestLeak") || ""),
      "",
      "Notes:",
      String(data.get("notes") || "")
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
if (form) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const subject = encodeURIComponent("Northline booking request: " + (data.get("businessName") || "New operator"));
    const body = encodeURIComponent([
      "Owner name: " + (data.get("ownerName") || ""),
      "Business: " + (data.get("businessName") || ""),
      "Email: " + (data.get("email") || ""),
      "Phone: " + (data.get("phone") || ""),
      "Service area: " + (data.get("serviceArea") || ""),
      "Primary services: " + (data.get("primaryServices") || ""),
      "Website: " + (data.get("website") || ""),
      "Preferred call window: " + (data.get("preferredCallWindow") || ""),
      "Contact preference: " + (data.get("contactPreference") || ""),
      "Review goal: " + (data.get("leadGoal") || ""),
      "",
      "Biggest leak:",
      String(data.get("biggestLeak") || ""),
      "",
      "Notes:",
      String(data.get("notes") || "")
    ].join("\\n"));
    window.location.href = "mailto:${html(surface.salesEmail)}?subject=" + subject + "&body=" + body;
    if (feedback) {
      feedback.textContent = "Your mail app should open with the booking request drafted.";
    }
  });
}
</script>`;
}

export async function buildAgencySite(config: AppConfig, profile: AgencyProfile): Promise<string> {
  const outputDir = path.join(config.outputDir, "agency-site");
  const htmlPath = path.join(outputDir, "index.html");
  const cssPath = path.join(outputDir, "styles.css");
  const faviconPath = path.join(outputDir, "favicon.svg");
  const intakePath = path.join(outputDir, "intake.html");
  const bookPath = path.join(outputDir, "book.html");
  const privacyPath = path.join(outputDir, "privacy.html");
  const thankYouPath = path.join(outputDir, "thank-you.html");
  const checklistPath = path.join(outputDir, "launch-checklist.md");

  const surface = resolveSurface(config);
  const primaryHref = surface.bookingUrl ?? "./intake.html";
  const primaryLabel = surface.bookingUrl ? "Book Strategy Call" : "Start Intake";
  const secondaryHref = surface.stripeFounding ?? "#pricing";
  const secondaryLabel = surface.stripeFounding ? "Reserve Pilot" : "See Pilot Offer";
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
          <a href="#services">Services</a>
          <a href="#workflow">Workflow</a>
          <a href="#pricing">Pricing</a>
          <a href="./book.html">Book</a>
          <a href="./intake.html">Intake</a>
        </nav>
      </header>

      <main class="page">
        <section class="hero">
          <div class="hero-copy">
            <p class="eyebrow">${html(profile.name)}</p>
            <h1>${html(profile.headline)}</h1>
            <p>${html(profile.supportingCopy)}</p>
            <p>${html(profile.heroNote)}</p>
            <div class="actions">
              <a class="button primary" href="${html(primaryHref)}">${html(primaryLabel)}</a>
              <a class="button secondary" href="${html(secondaryHref)}">${html(secondaryLabel)}</a>
              <a class="button ghost" href="./intake.html">Send Operator Intake</a>
            </div>
            <div class="meta">
              <div><span>Focus</span><strong>${html(profile.audience)}</strong></div>
              <div><span>Service area</span><strong>${html(surface.primaryServiceArea ?? "Set NORTHLINE_PRIMARY_SERVICE_AREA before launch.")}</strong></div>
              <div><span>Motion</span><strong>Proof page and hosted intake first. Ads after the close path works.</strong></div>
            </div>
          </div>

          <div class="signal" aria-hidden="true">
            ${profile.industries.map((item) => `<div class="token">${html(item)}</div>`).join("")}
            <div class="signal-box">
              <p class="eyebrow">Northline installs</p>
              <ul>${profile.serviceStack.map((item) => `<li>${html(item.title)}</li>`).join("")}</ul>
            </div>
          </div>
        </section>

        <section class="proof">
          ${profile.proofPoints
            .map((item) => `<div class="proof-item"><strong>${html(item)}</strong><p>Designed to move small operators quickly without turning into a bloated retainer.</p></div>`)
            .join("")}
        </section>

        <section class="section" id="services">
          <div class="section-head">
            <div>
              <p class="eyebrow">Service stack</p>
              <h2>Northline fixes the part between click and dispatch.</h2>
            </div>
            <p>The offer stays narrow on purpose: clearer first page, faster intake routing, better missed-call recovery, and a stronger follow-up loop once the rebuild ships.</p>
          </div>
          <div class="stack">
            ${profile.serviceStack
              .map(
                (item, index) => `<article class="row card"><p class="index">${String(index + 1).padStart(2, "0")}</p><div><h3>${html(item.title)}</h3><p>${html(item.description)}</p></div></article>`
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
              <h2>Pilot first. Broader system once the close path is working.</h2>
            </div>
            <p>The first tier is built to prove movement quickly. The second is for operators who already have demand and need more landing pages, review support, and monthly optimization.</p>
          </div>
          <div class="prices">
            ${profile.pricing
              .map((tier, index) => {
                const tierHref = index === 0 ? surface.stripeFounding ?? "./intake.html" : surface.stripeStandard ?? "./intake.html";
                const tierLabel = index === 0 ? (surface.stripeFounding ? "Reserve Pilot" : "Request Pilot") : surface.stripeStandard ? "Start Growth System" : "Request Growth System";
                return `<article class="price card"><p class="eyebrow">${html(tier.label)}</p><h3>${html(tier.amount)}</h3><p>${html(tier.details)}</p><p>${html(tier.idealFor)}</p><ul>${renderList(tier.includes)}</ul><a class="button secondary" href="${html(tierHref)}">${html(tierLabel)}</a></article>`;
              })
              .join("")}
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
          <div class="faq">
            ${profile.faqs.map((item) => `<details class="faq-item card"><summary>${html(item.question)}</summary><p>${html(item.answer)}</p></details>`).join("")}
          </div>
        </section>

        <section class="section closing">
          <div>
            <p class="eyebrow">Next step</p>
            <h2>Northline starts with the leak you can already see.</h2>
            <p>${html(profile.closingNote)}</p>
            <div class="actions">
              <a class="button primary" href="${html(primaryHref)}">${html(primaryLabel)}</a>
              <a class="button secondary" href="./intake.html">Send Intake Instead</a>
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
        <a href="./book.html">Book</a>
        <a href="./intake.html">Intake</a>
        <a href="./privacy.html">Privacy</a>
        <a href="./thank-you.html">Thank you</a>
      </div>
    </footer>

    <script type="application/ld+json">${jsonLd}</script>
  </body>
</html>`;

  const intake = `<!doctype html>
<html lang="en">
  ${head(`${profile.name} Intake`, `Operator intake for ${profile.name}.`, surface.siteUrl ? `${surface.siteUrl}/intake` : undefined)}
  <body>
    <div class="frame">
      <header class="subhead">
        <a class="brand" href="./index.html"><strong>Northline</strong><span>Growth Systems</span></a>
        <nav class="nav">
          <a href="./index.html">Home</a>
          <a href="./book.html">Book</a>
          <a href="./privacy.html">Privacy</a>
        </nav>
      </header>
      <main class="page">
        <section class="subhero">
          <div>
            <p class="eyebrow">Operator intake</p>
            <h1>Send the basics so Northline can see where the funnel is leaking.</h1>
            <p>${html(profile.supportingCopy)}</p>
          </div>
          <aside class="panel">
            <p class="eyebrow">Submission mode</p>
            <p>${html(surface.leadFormAction ? "This form is connected to a live endpoint." : "No live endpoint is configured yet, so submit opens a drafted email.")}</p>
            <a class="button secondary" href="${html(surface.bookingUrl ?? "./book.html")}">Book a strategy call instead</a>
          </aside>
        </section>

        <section class="grid">
          <div class="panel">
            <form class="form" data-intake-form ${surface.leadFormAction ? `action="${html(surface.leadFormAction)}" method="post"` : 'method="post"'}>
              <div class="form-grid">
                <label>Owner name<input name="ownerName" required /></label>
                <label>Business name<input name="businessName" required /></label>
                <label>Email<input name="email" type="email" required /></label>
                <label>Phone<input name="phone" type="tel" required /></label>
                <label>Service area<input name="serviceArea" required /></label>
                <label>Monthly lead goal<input name="leadGoal" /></label>
              </div>
              <label>Primary services<input name="primaryServices" required /></label>
              <label>Current website<input name="website" type="url" placeholder="https://..." /></label>
              <label>Biggest conversion leak<textarea name="biggestLeak" required></textarea></label>
              <label>Anything else Northline should know<textarea name="notes"></textarea></label>
              <input type="hidden" name="source" value="northline-website-intake" />
              <button class="button primary" type="submit">Submit Intake</button>
              <p class="feedback" data-feedback></p>
            </form>
          </div>
          <aside class="panel">
            <p class="eyebrow">Send enough to move</p>
            <ul>${renderList([
              "The main job type you want to book more often",
              "The cities or neighborhoods that matter first",
              "Your current phone and form-routing setup",
              "Any live ads, GBP profile, or review workflow",
              "What owners or dispatch complain about most in the current site"
            ])}</ul>
          </aside>
        </section>
      </main>
    </div>
    ${intakeScript(surface)}
  </body>
</html>`;

  const booking = `<!doctype html>
<html lang="en">
  ${head(`${profile.name} Booking`, `Book a teardown call with ${profile.name}.`, surface.siteUrl ? `${surface.siteUrl}/book` : undefined)}
  <body>
    <div class="frame">
      <header class="subhead">
        <a class="brand" href="./index.html"><strong>Northline</strong><span>Growth Systems</span></a>
        <nav class="nav">
          <a href="./index.html">Home</a>
          <a href="./intake.html">Intake</a>
          <a href="./privacy.html">Privacy</a>
        </nav>
      </header>
      <main class="page">
        <section class="subhero">
          <div>
            <p class="eyebrow">Booking</p>
            <h1>Book a teardown call if you want Northline to walk the leak live.</h1>
            <p>Use this when a direct call is the fastest path. If you would rather skip the call, the hosted intake still works.</p>
          </div>
          <aside class="panel">
            <p class="eyebrow">Best fit</p>
            <ul>${renderList([
              "You already have traffic but the first page is not converting.",
              "You want Northline to review one specific leak live.",
              "You need a short decision call before a pilot starts."
            ])}</ul>
            <a class="button secondary" href="./intake.html">Prefer async intake?</a>
          </aside>
        </section>

        <section class="grid">
          <div class="panel">
            <form class="form" data-booking-form ${surface.leadFormAction ? `action="${html(surface.leadFormAction)}" method="post"` : 'method="post"'}>
              <div class="form-grid">
                <label>Owner name<input name="ownerName" required /></label>
                <label>Business name<input name="businessName" required /></label>
                <label>Email<input name="email" type="email" required /></label>
                <label>Phone<input name="phone" type="tel" required /></label>
                <label>Service area<input name="serviceArea" required /></label>
                <label>Preferred call window<input name="preferredCallWindow" placeholder="Tue 1-3pm ET" required /></label>
              </div>
              <label>Primary services<input name="primaryServices" required /></label>
              <label>Website<input name="website" type="url" placeholder="https://..." /></label>
              <label>Preferred contact method<input name="contactPreference" placeholder="Call, text, or email" /></label>
              <label>What should Northline review on the call?<input name="leadGoal" placeholder="Homepage, ads landing page, missed-call routing..." required /></label>
              <label>Biggest leak right now<textarea name="biggestLeak" required></textarea></label>
              <label>Anything else Northline should know<textarea name="notes"></textarea></label>
              <input type="hidden" name="source" value="northline-booking-page" />
              <button class="button primary" type="submit">Request Call</button>
              <p class="feedback" data-booking-feedback></p>
            </form>
          </div>
          <aside class="panel">
            <p class="eyebrow">Call outcome</p>
            <ul>${renderList([
              "One clear diagnosis of the leak worth fixing first",
              "A yes or no decision on the pilot scope",
              "A direct next step into Stripe or the hosted intake queue"
            ])}</ul>
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
          <a href="./book.html">Book</a>
          <a href="./intake.html">Intake</a>
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
            <p>The next move should be a reply, a teardown, or a booking link. Keep the process direct and keep the close path simple.</p>
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
  await writeTextFile(checklistPath, buildChecklist(profile, surface));
  return htmlPath;
}
