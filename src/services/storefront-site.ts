import path from "node:path";
import type { AppConfig } from "../config.js";
import type { AssetPackRecord } from "../domain/digital-assets.js";
import type { SocialProfileRecord } from "../domain/social.js";
import { exists, readJsonFile, readTextFile, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { FileStore } from "../storage/store.js";

const DIGITAL_ASSET_STORE_ID = "imon-digital-asset-store";

export interface StorefrontBuildResult {
  outputDir: string;
  htmlPath: string;
  cssPath: string;
  catalogPath: string;
  robotsPath: string;
  sitemapPath?: string;
  notesPath: string;
  publishedCount: number;
  captureMode: "form" | "email_link";
  roadblocks: string[];
  changed: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function jsonScript(value: unknown): string {
  return JSON.stringify(value).replace(/<\/script/gi, "<\\/script");
}

function socialLabel(platform: SocialProfileRecord["platform"]): string {
  switch (platform) {
    case "gumroad":
      return "Gumroad";
    case "facebook_page":
      return "Facebook";
    case "youtube_channel":
      return "YouTube";
    case "pinterest":
      return "Pinterest";
    case "instagram_account":
      return "Instagram";
    case "x":
      return "X";
    case "meta_business":
      return "Meta Business";
    case "gmail_alias":
      return "Email";
  }
}

function normalizePublicUrl(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function assetTypeLabel(pack: AssetPackRecord): string {
  return pack.assetType.replace(/_/g, " ");
}

function canonicalizeSiteUrl(siteUrl?: string): string | undefined {
  const normalized = normalizePublicUrl(siteUrl);
  if (!normalized) {
    return undefined;
  }
  return normalized.replace(/\/+$/, "");
}

function packRoute(canonicalSiteUrl: string | undefined, pack: AssetPackRecord): string | undefined {
  if (!canonicalSiteUrl) {
    return undefined;
  }
  return `${canonicalSiteUrl}/#${slugify(pack.id)}`;
}

function renderProductCard(pack: AssetPackRecord): string {
  const tagList = pack.tags.slice(0, 4).map((tag) => `<li>${escapeHtml(tag)}</li>`).join("");
  return [
    `<article class="product-card" id="${escapeHtml(slugify(pack.id))}">`,
    `<p class="eyebrow">${escapeHtml(assetTypeLabel(pack))}</p>`,
    `<div class="product-head">`,
    `<h3>${escapeHtml(pack.title)}</h3>`,
    `<p class="price">$${pack.suggestedPrice.toFixed(0)}</p>`,
    `</div>`,
    `<p class="product-copy">${escapeHtml(pack.shortDescription)}</p>`,
    `<ul class="tag-list">${tagList}</ul>`,
    `<div class="product-actions">`,
    `<a class="button primary" href="${escapeHtml(pack.productUrl ?? "#")}" target="_blank" rel="noreferrer">View on Gumroad</a>`,
    `<span class="deliverable-count">${pack.deliverables.length} deliverables</span>`,
    `</div>`,
    `</article>`
  ].join("");
}

function renderChannelLinks(profiles: SocialProfileRecord[]): string {
  const links = profiles
    .filter((profile) => profile.status === "live" && profile.profileUrl)
    .map(
      (profile) =>
        `<li><a href="${escapeHtml(normalizePublicUrl(profile.profileUrl) ?? "#")}" target="_blank" rel="noreferrer">${escapeHtml(
          socialLabel(profile.platform)
        )}</a></li>`
    )
    .join("");

  return links.length > 0 ? `<ul class="channel-list">${links}</ul>` : `<p class="muted">No public channels are live yet.</p>`;
}

function renderCapturePanel(config: AppConfig): {
  html: string;
  mode: "form" | "email_link";
} {
  if (config.storefront.emailCaptureAction) {
    return {
      mode: "form",
      html: [
        `<form class="capture-form" method="post" action="${escapeHtml(config.storefront.emailCaptureAction)}">`,
        `<label class="sr-only" for="email">Email</label>`,
        `<input id="email" name="email" type="email" placeholder="you@example.com" required />`,
        `<input type="hidden" name="source" value="${DIGITAL_ASSET_STORE_ID}" />`,
        `<button type="submit">Get launch notes</button>`,
        `</form>`,
        `<p class="capture-copy">Collect launch updates, new drops, and limited bundle notices through the configured form endpoint.</p>`
      ].join("")
    };
  }

  const subject = encodeURIComponent("Imon Digital Asset Store updates");
  return {
    mode: "email_link",
    html: [
      `<a class="button primary" href="mailto:${escapeHtml(config.storefront.emailCaptureEmail)}?subject=${subject}">Join by email</a>`,
      `<p class="capture-copy">The signup module is ready, but it still needs a live form action. Until then, replies go to ${escapeHtml(
        config.storefront.emailCaptureEmail
      )}.</p>`
    ].join("")
  };
}

async function writeTextIfChanged(filePath: string, content: string): Promise<boolean> {
  const current = (await exists(filePath)) ? await readTextFile(filePath) : "";
  if (current === content) {
    return false;
  }
  await writeTextFile(filePath, content);
  return true;
}

async function writeJsonIfChanged(filePath: string, value: unknown): Promise<boolean> {
  const current = await readJsonFile<unknown>(filePath, null);
  const currentSerialized = `${JSON.stringify(current, null, 2)}\n`;
  const nextSerialized = `${JSON.stringify(value, null, 2)}\n`;
  if (currentSerialized === nextSerialized) {
    return false;
  }
  await writeJsonFile(filePath, value);
  return true;
}

export async function buildStorefrontSite(
  config: AppConfig,
  store: FileStore
): Promise<StorefrontBuildResult> {
  const outputDir = path.join(config.outputDir, "storefront-site");
  const htmlPath = path.join(outputDir, "index.html");
  const cssPath = path.join(outputDir, "styles.css");
  const catalogPath = path.join(outputDir, "catalog.json");
  const robotsPath = path.join(outputDir, "robots.txt");
  const notesPath = path.join(outputDir, "deployment-notes.md");
  const sitemapPath = path.join(outputDir, "sitemap.xml");
  const canonicalSiteUrl = canonicalizeSiteUrl(config.storefront.siteUrl);
  const packs = (await store.getAssetPacks())
    .filter((pack) => pack.businessId === DIGITAL_ASSET_STORE_ID && pack.status === "published" && pack.productUrl)
    .sort((left, right) => {
      const leftKey = left.publishedAt ?? left.updatedAt ?? left.createdAt;
      const rightKey = right.publishedAt ?? right.updatedAt ?? right.createdAt;
      return rightKey.localeCompare(leftKey);
    });
  const profiles = (await store.getSocialProfiles())
    .filter((profile) => profile.businessId === DIGITAL_ASSET_STORE_ID)
    .sort((left, right) => left.platform.localeCompare(right.platform));
  const liveProfiles = profiles.filter((profile) => profile.status === "live" && profile.profileUrl);
  const storeBusiness = await store.getManagedBusiness(DIGITAL_ASSET_STORE_ID);
  const capturePanel = renderCapturePanel(config);
  const generatedAt =
    [
      storeBusiness?.updatedAt,
      ...packs.map((pack) => pack.updatedAt ?? pack.publishedAt ?? pack.createdAt),
      ...profiles.map((profile) => profile.updatedAt ?? profile.createdAt)
    ]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .sort()
      .at(-1) ?? new Date().toISOString();
  const startingPrice = packs.reduce<number | undefined>((minimum, pack) => {
    if (minimum === undefined) {
      return pack.suggestedPrice;
    }
    return Math.min(minimum, pack.suggestedPrice);
  }, undefined);
  const catalog = {
    generatedAt,
    businessId: DIGITAL_ASSET_STORE_ID,
    businessName: storeBusiness?.name ?? "Imon Digital Asset Store",
    storeUrl: normalizePublicUrl(config.marketplaces.gumroadProfileUrl),
    liveChannels: liveProfiles.map((profile) => ({
      platform: profile.platform,
      label: socialLabel(profile.platform),
      url: normalizePublicUrl(profile.profileUrl)
    })),
    products: packs.map((pack) => ({
      id: pack.id,
      title: pack.title,
      assetType: pack.assetType,
      shortDescription: pack.shortDescription,
      suggestedPrice: pack.suggestedPrice,
      productUrl: pack.productUrl,
      publishedAt: pack.publishedAt ?? pack.updatedAt ?? pack.createdAt,
      tags: pack.tags
    }))
  };

  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Store",
        name: storeBusiness?.name ?? "Imon Digital Asset Store",
        description:
          "Digital downloads for creators, operators, and product teams, with checkout handled through Gumroad.",
        ...(canonicalSiteUrl ? { url: canonicalSiteUrl } : {}),
        ...(normalizePublicUrl(config.marketplaces.gumroadProfileUrl)
          ? { sameAs: [normalizePublicUrl(config.marketplaces.gumroadProfileUrl)] }
          : {})
      },
      ...packs.map((pack) => ({
        "@type": "Product",
        name: pack.title,
        description: pack.shortDescription,
        category: assetTypeLabel(pack),
        offers: {
          "@type": "Offer",
          priceCurrency: "USD",
          price: pack.suggestedPrice.toFixed(2),
          availability: "https://schema.org/InStock",
          url: pack.productUrl
        },
        ...(packRoute(canonicalSiteUrl, pack) ? { url: packRoute(canonicalSiteUrl, pack) } : {})
      }))
    ]
  };

  const heroStoreLink = normalizePublicUrl(config.marketplaces.gumroadProfileUrl) ?? packs[0]?.productUrl ?? "#catalog";
  const productCards =
    packs.length > 0
      ? packs.map((pack) => renderProductCard(pack)).join("")
      : `<article class="product-card empty"><h3>No published packs yet</h3><p>The owned storefront is ready. Publish the next pack to populate the catalog automatically.</p></article>`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(storeBusiness?.name ?? "Imon Digital Asset Store")}</title>
    <meta
      name="description"
      content="An owned storefront for the Imon Digital Asset Store with catalog pages, Gumroad checkout links, and a configurable email capture surface."
    />
    ${canonicalSiteUrl ? `<link rel="canonical" href="${escapeHtml(canonicalSiteUrl)}" />` : ""}
    <meta property="og:title" content="${escapeHtml(storeBusiness?.name ?? "Imon Digital Asset Store")}" />
    <meta
      property="og:description"
      content="Browse the published Imon catalog, jump to Gumroad checkout, and join the release list for new drops."
    />
    ${canonicalSiteUrl ? `<meta property="og:url" content="${escapeHtml(canonicalSiteUrl)}" />` : ""}
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="./styles.css" />
    <script type="application/ld+json">${jsonScript(schema)}</script>
  </head>
  <body>
    <main class="page-shell">
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">Owned catalog surface</p>
          <h1>Digital assets with instant checkout and a cleaner discovery layer.</h1>
          <p class="lede">
            This storefront mirrors the published Imon catalog, sends buyers to Gumroad for payment and delivery,
            and gives the business a place to collect launch updates outside the marketplace.
          </p>
          <div class="hero-actions">
            <a class="button primary" href="${escapeHtml(heroStoreLink)}" target="_blank" rel="noreferrer">Open Gumroad store</a>
            <a class="button secondary" href="#catalog">Browse published packs</a>
          </div>
          <dl class="hero-stats">
            <div>
              <dt>Published packs</dt>
              <dd>${packs.length}</dd>
            </div>
            <div>
              <dt>Live channels</dt>
              <dd>${liveProfiles.length}</dd>
            </div>
            <div>
              <dt>Starting price</dt>
              <dd>${startingPrice !== undefined ? `$${startingPrice.toFixed(0)}` : "TBD"}</dd>
            </div>
            <div>
              <dt>Payments</dt>
              <dd>Gumroad checkout</dd>
            </div>
          </dl>
        </div>
        <aside class="hero-panel">
          <p class="eyebrow">Visibility stack</p>
          <h2>Search-ready packaging plus live channel routes.</h2>
          <p class="panel-copy">
            The generated storefront includes product schema, robots guidance, and a sitemap when a site URL is configured.
            It also keeps public channel links close to the catalog so paid or free traffic has a real landing surface.
          </p>
          ${renderChannelLinks(liveProfiles)}
        </aside>
      </section>

      <section class="section-head" id="catalog">
        <p class="eyebrow">Catalog</p>
        <h2>Published products</h2>
        <p>Every card links straight to Gumroad for payment acceptance, fulfillment, and license delivery.</p>
      </section>
      <section class="product-grid">
        ${productCards}
      </section>

      <section class="split-panel">
        <article class="panel">
          <p class="eyebrow">Discovery</p>
          <h2>What is already set up</h2>
          <ul class="bullet-list">
            <li>Product schema is embedded for each published pack.</li>
            <li>A catalog JSON feed is generated for downstream tooling and imports.</li>
            <li>Robots guidance is written on every build, and a sitemap is generated when STORE_SITE_URL is configured.</li>
            <li>Marketplace checkout is delegated to Gumroad, so payment collection is already wired on the live product pages.</li>
          </ul>
        </article>
        <article class="panel" id="email-signup">
          <p class="eyebrow">Email capture</p>
          <h2>Collect launch updates outside the marketplace.</h2>
          ${capturePanel.html}
        </article>
      </section>
    </main>
  </body>
</html>`;

  const css = `:root {
  --ink: #09121b;
  --muted: #5f6c77;
  --paper: #f4efe6;
  --panel: rgba(255, 251, 245, 0.76);
  --line: rgba(9, 18, 27, 0.14);
  --accent: #c45f24;
  --accent-soft: rgba(196, 95, 36, 0.14);
  --shadow: 0 24px 70px rgba(9, 18, 27, 0.14);
}

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  color: var(--ink);
  font-family: "IBM Plex Sans", system-ui, sans-serif;
  background:
    radial-gradient(circle at top left, rgba(196, 95, 36, 0.24), transparent 34%),
    radial-gradient(circle at 85% 15%, rgba(9, 18, 27, 0.12), transparent 24%),
    linear-gradient(160deg, #f8f4ec, #ece3d5 55%, #f5f1ea 100%);
}

.page-shell {
  width: min(1200px, calc(100% - 2rem));
  margin: 0 auto;
  padding: 2rem 0 4rem;
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(320px, 0.7fr);
  gap: 1.5rem;
  align-items: stretch;
  min-height: 70vh;
}

.hero-copy,
.hero-panel,
.panel,
.product-card {
  border: 1px solid var(--line);
  border-radius: 1.6rem;
  background: var(--panel);
  backdrop-filter: blur(18px);
  box-shadow: var(--shadow);
}

.hero-copy,
.hero-panel,
.panel {
  padding: 1.6rem;
}

.eyebrow {
  margin: 0 0 0.7rem;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-size: 0.78rem;
  font-weight: 700;
}

h1,
h2,
h3 {
  margin: 0;
  font-family: "Fraunces", Georgia, serif;
  line-height: 0.95;
}

h1 {
  font-size: clamp(3rem, 8vw, 6rem);
  max-width: 11ch;
}

h2 {
  font-size: clamp(2rem, 5vw, 3.25rem);
  max-width: 12ch;
}

h3 {
  font-size: 1.8rem;
}

.lede,
.panel-copy,
.product-copy,
.capture-copy,
.section-head p,
.bullet-list li,
.channel-list a,
.deliverable-count {
  font-size: 1.02rem;
  line-height: 1.75;
}

.hero-actions,
.product-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.9rem;
  margin-top: 1.6rem;
  align-items: center;
}

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 3.2rem;
  padding: 0.9rem 1.3rem;
  border-radius: 999px;
  font-weight: 700;
  text-decoration: none;
}

.button.primary,
.capture-form button {
  border: none;
  background: var(--ink);
  color: #ffffff;
}

.button.secondary {
  color: var(--ink);
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.38);
}

.hero-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  margin: 2rem 0 0;
}

.hero-stats div {
  padding-top: 0.8rem;
  border-top: 1px solid var(--line);
}

.hero-stats dt {
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--muted);
}

.hero-stats dd {
  margin: 0.45rem 0 0;
  font-size: 1.6rem;
  font-weight: 700;
}

.channel-list,
.bullet-list,
.tag-list {
  margin: 1.2rem 0 0;
  padding-left: 1.15rem;
}

.channel-list li,
.bullet-list li {
  margin: 0.35rem 0;
}

.channel-list a {
  color: inherit;
}

.section-head {
  margin: 4rem 0 1.25rem;
}

.product-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.2rem;
}

.product-card {
  padding: 1.4rem;
}

.product-card.empty {
  grid-column: 1 / -1;
}

.product-head {
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  align-items: baseline;
}

.price {
  margin: 0;
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--accent);
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0;
  list-style: none;
}

.tag-list li {
  padding: 0.42rem 0.7rem;
  border-radius: 999px;
  background: var(--accent-soft);
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.deliverable-count,
.muted {
  color: var(--muted);
}

.split-panel {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.2rem;
  margin-top: 1.4rem;
}

.capture-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.8rem;
  margin-top: 1rem;
}

.capture-form input {
  width: 100%;
  min-height: 3.2rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.82);
  padding: 0 1rem;
  font: inherit;
}

.capture-form button {
  border-radius: 999px;
  padding: 0 1.3rem;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 980px) {
  .hero,
  .split-panel,
  .product-grid {
    grid-template-columns: 1fr;
  }

  .hero {
    min-height: auto;
  }
}

@media (max-width: 640px) {
  .page-shell {
    width: min(100%, calc(100% - 1rem));
    padding-top: 1rem;
  }

  .hero-stats,
  .capture-form {
    grid-template-columns: 1fr;
  }
}`;

  const roadblocks: string[] = [];
  if (!canonicalSiteUrl) {
    roadblocks.push("Set STORE_SITE_URL before publishing so canonical metadata and sitemap generation target the real domain.");
  }
  if (!config.storefront.emailCaptureAction) {
    roadblocks.push("Set STORE_EMAIL_CAPTURE_ACTION to turn the email module into a working signup form instead of a mailto fallback.");
  }
  if (!config.cloudflare) {
    roadblocks.push("Cloudflare Pages credentials are not configured in this environment, so the owned storefront cannot be published automatically from this workspace.");
  }
  if (!process.env.META_PAGE_ACCESS_TOKEN) {
    roadblocks.push("META_PAGE_ACCESS_TOKEN is not configured, so Facebook posting still depends on the signed-in browser flow instead of the stable Graph API path.");
  }

  const robots = canonicalSiteUrl
    ? [`User-agent: *`, `Allow: /`, `Sitemap: ${canonicalSiteUrl}/sitemap.xml`, ``].join("\n")
    : [`User-agent: *`, `Allow: /`, `# Set STORE_SITE_URL before public publish so a real sitemap can be advertised.`, ``].join("\n");

  const sitemap = canonicalSiteUrl
    ? [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
        `  <url>`,
        `    <loc>${escapeHtml(canonicalSiteUrl)}</loc>`,
        `    <changefreq>daily</changefreq>`,
        `    <priority>1.0</priority>`,
        `  </url>`,
        ...packs.map((pack) =>
          [
            `  <url>`,
            `    <loc>${escapeHtml(packRoute(canonicalSiteUrl, pack) ?? canonicalSiteUrl)}</loc>`,
            `    <changefreq>weekly</changefreq>`,
            `    <priority>0.8</priority>`,
            `  </url>`
          ].join("\n")
        ),
        `</urlset>`,
        ``
      ].join("\n")
    : undefined;

  const notes = [
    `# Storefront Deployment Notes`,
    ``,
    `Generated at: ${generatedAt}`,
    ``,
    `- Output dir: ${outputDir}`,
    `- Published products: ${packs.length}`,
    `- Capture mode: ${capturePanel.mode}`,
    `- Gumroad store: ${normalizePublicUrl(config.marketplaces.gumroadProfileUrl) ?? "not configured"}`,
    ``,
    `## Remaining roadblocks`,
    ...(roadblocks.length > 0 ? roadblocks.map((item) => `- ${item}`) : ["- No immediate publish blockers were detected in config."])
  ].join("\n");

  const changed = (
    await Promise.all([
      writeJsonIfChanged(catalogPath, catalog),
      writeTextIfChanged(htmlPath, html),
      writeTextIfChanged(cssPath, css),
      writeTextIfChanged(robotsPath, robots),
      writeTextIfChanged(notesPath, notes),
      sitemap ? writeTextIfChanged(sitemapPath, sitemap) : Promise.resolve(false)
    ])
  ).some(Boolean);

  return {
    outputDir,
    htmlPath,
    cssPath,
    catalogPath,
    robotsPath,
    sitemapPath: sitemap ? sitemapPath : undefined,
    notesPath,
    publishedCount: packs.length,
    captureMode: capturePanel.mode,
    roadblocks,
    changed
  };
}
