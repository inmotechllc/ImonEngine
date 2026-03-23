import path from "node:path";
import type { AppConfig } from "../config.js";
import type { ClientJob, SiteBuildResult } from "../domain/contracts.js";
import { writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { AIClient, SiteCopySchema } from "../openai/client.js";
import { siteCopyPrompt } from "../openai/prompts.js";
import { FileStore } from "../storage/store.js";

const FALLBACK_COLORS = ["#0f172a", "#d97706", "#f6efe7", "#fff9f0"];

export class SiteBuilderAgent {
  constructor(
    private readonly ai: AIClient,
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {}

  async buildClientSite(client: ClientJob): Promise<SiteBuildResult> {
    const generated = await this.ai.generateJson({
      schema: SiteCopySchema,
      prompt: siteCopyPrompt(client),
      mode: "deep",
      fallback: () => this.fallbackCopy(client)
    });

    const slug = slugify(client.id);
    const previewDir = path.join(this.config.previewDir, slug);
    const htmlPath = path.join(previewDir, "index.html");
    const cssPath = path.join(previewDir, "styles.css");
    const colors =
      client.assets.brandColors && client.assets.brandColors.length >= 3
        ? client.assets.brandColors
        : FALLBACK_COLORS;

    const html = this.renderHtml(client, generated.data, colors);
    const css = this.renderCss(colors);

    await writeTextFile(htmlPath, html);
    await writeTextFile(cssPath, css);
    await writeJsonFile(path.join(previewDir, "site-data.json"), generated.data);

    await this.store.saveClient({
      ...client,
      siteStatus: "ready",
      qaStatus: "pending",
      deployment: {
        platform: "local-preview",
        previewPath: previewDir
      },
      updatedAt: new Date().toISOString()
    });

    return {
      clientId: client.id,
      previewDir,
      htmlPath,
      cssPath
    };
  }

  private fallbackCopy(client: ClientJob) {
    const services =
      client.assets.services && client.assets.services.length > 0
        ? client.assets.services
        : ["Emergency service calls", "Repairs and replacements", "Routine maintenance"];

    return {
      heroHeadline: `${client.clientName} books more local jobs with a cleaner call-to-action path`,
      heroCopy:
        "Built for mobile-first homeowners who want to call fast, trust the crew, and know exactly what happens next.",
      serviceBullets: services,
      proofStrip: [
        `${client.geo} coverage`,
        "Clear phone and form CTA flow",
        "Built for call-heavy local traffic"
      ],
      processSteps: [
        "Customer sees a clear service offer and taps to call or request service.",
        "Lead capture routes to the right inbox and phone line.",
        "Follow-up assets keep the next step moving if the call is missed."
      ],
      faq: [
        {
          question: "How fast can this launch?",
          answer: "The first preview is built for speed and can typically be reviewed within a few days."
        },
        {
          question: "Can the form route into an existing inbox?",
          answer: "Yes. The page can post to your current inbox, CRM, or a webhook once access is available."
        },
        {
          question: "Will this work on mobile?",
          answer: "The layout is optimized for mobile first because local-service leads often convert on phones."
        }
      ]
    };
  }

  private renderHtml(
    client: ClientJob,
    copy: Awaited<ReturnType<SiteBuilderAgent["fallbackCopy"]>>,
    colors: string[]
  ): string {
    const services = copy.serviceBullets.map((service) => `<li>${service}</li>`).join("");
    const proof = copy.proofStrip.map((item) => `<span>${item}</span>`).join("");
    const steps = copy.processSteps
      .map((step, index) => `<article><strong>0${index + 1}</strong><p>${step}</p></article>`)
      .join("");
    const faq = copy.faq
      .map(
        (item) =>
          `<details><summary>${item.question}</summary><p>${item.answer}</p></details>`
      )
      .join("");
    const testimonials = (client.assets.testimonials ?? [
      "Professional, fast, and easy to reach.",
      "The new layout makes it obvious what we do and how to contact us.",
      "Calls are easier to route now."
    ])
      .map((quote) => `<blockquote>${quote}</blockquote>`)
      .join("");

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${client.clientName} | ${client.geo}</title>
    <meta name="description" content="${copy.heroCopy}" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Newsreader:opsz,wght@6..72,500;6..72,700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="./styles.css" />
    <style>
      :root {
        --brand-900: ${colors[0]};
        --brand-700: ${colors[1]};
        --paper: ${colors[2]};
        --paper-alt: ${colors[3]};
      }
    </style>
  </head>
  <body>
    <div class="background-orb orb-left"></div>
    <div class="background-orb orb-right"></div>
    <header class="topbar">
      <div class="brand">
        <span class="eyebrow">${client.assets.logoText ?? client.clientName}</span>
        <strong>${client.geo}</strong>
      </div>
      <a class="phone-link" href="tel:${client.primaryPhone.replace(/[^0-9+]/g, "")}">${client.primaryPhone}</a>
    </header>
    <main>
      <section class="hero">
        <div>
          <p class="eyebrow">Local service leads, without the clutter</p>
          <h1>${copy.heroHeadline}</h1>
          <p class="hero-copy">${copy.heroCopy}</p>
          <div class="hero-actions">
            <a class="button button-primary" href="tel:${client.primaryPhone.replace(/[^0-9+]/g, "")}">Call ${client.primaryPhone}</a>
            <a class="button button-secondary" href="#request-service">Request Service</a>
          </div>
          <div class="proof-strip">${proof}</div>
        </div>
        <aside class="hero-card">
          <span class="eyebrow">What this page fixes</span>
          <ul>${services}</ul>
        </aside>
      </section>

      <section class="section split">
        <div>
          <p class="eyebrow">Process</p>
          <h2>Built to move homeowners from doubt to action</h2>
        </div>
        <div class="steps">${steps}</div>
      </section>

      <section class="section testimonials">
        <p class="eyebrow">Trust</p>
        <h2>Language that sounds like a real crew, not a generic template</h2>
        <div class="quote-grid">${testimonials}</div>
      </section>

      <section class="section faq">
        <p class="eyebrow">Questions</p>
        <h2>Answers before the customer needs to ask</h2>
        ${faq}
      </section>

      <section class="section request-service" id="request-service">
        <div>
          <p class="eyebrow">Book service</p>
          <h2>Route the lead to the right place the first time</h2>
          <p>Use the form for non-emergency requests or call directly for urgent help.</p>
        </div>
        <form action="${client.formEndpoint ?? ""}" method="post">
          <label>
            Name
            <input type="text" name="name" required />
          </label>
          <label>
            Phone
            <input type="tel" name="phone" required />
          </label>
          <label>
            Service Needed
            <textarea name="details" rows="4" required></textarea>
          </label>
          <button type="submit">Request Service</button>
        </form>
      </section>
    </main>
  </body>
</html>`;
  }

  private renderCss(colors: string[]): string {
    return `:root {
  color-scheme: light;
  --ink: ${colors[0]};
  --accent: ${colors[1]};
  --paper: ${colors[2]};
  --paper-alt: ${colors[3]};
  --card: rgba(255,255,255,0.84);
  --border: rgba(15, 23, 42, 0.12);
  --shadow: 0 24px 60px rgba(15, 23, 42, 0.12);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: "Space Grotesk", system-ui, sans-serif;
  background:
    radial-gradient(circle at top left, rgba(217, 119, 6, 0.22), transparent 35%),
    linear-gradient(135deg, var(--paper) 0%, var(--paper-alt) 100%);
  color: var(--ink);
  min-height: 100vh;
}

.background-orb {
  position: fixed;
  width: 20rem;
  height: 20rem;
  border-radius: 999px;
  filter: blur(24px);
  opacity: 0.22;
  z-index: -1;
}

.orb-left {
  top: 0;
  left: -4rem;
  background: rgba(15, 23, 42, 0.35);
}

.orb-right {
  right: -3rem;
  bottom: 5rem;
  background: rgba(217, 119, 6, 0.4);
}

.topbar,
main {
  width: min(1120px, calc(100% - 2rem));
  margin: 0 auto;
}

.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.2rem 0 0;
}

.brand,
.phone-link {
  background: rgba(255,255,255,0.78);
  backdrop-filter: blur(18px);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.85rem 1.1rem;
  box-shadow: var(--shadow);
}

.brand {
  display: flex;
  gap: 0.8rem;
  align-items: center;
}

.phone-link {
  color: var(--ink);
  text-decoration: none;
  font-weight: 700;
}

.hero {
  display: grid;
  grid-template-columns: 1.4fr 0.9fr;
  gap: 2rem;
  padding: 4rem 0 2rem;
  align-items: center;
}

.eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 0.76rem;
  font-weight: 700;
  color: var(--accent);
}

h1,
h2 {
  font-family: "Newsreader", Georgia, serif;
  line-height: 0.95;
  margin: 0 0 1rem;
}

h1 {
  font-size: clamp(3rem, 8vw, 5.4rem);
  max-width: 12ch;
}

h2 {
  font-size: clamp(2.2rem, 4vw, 3.4rem);
  max-width: 12ch;
}

.hero-copy,
.section p,
details p,
blockquote {
  font-size: 1.05rem;
  line-height: 1.7;
}

.hero-actions {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  margin: 2rem 0;
}

.button,
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  padding: 0.95rem 1.35rem;
  text-decoration: none;
  font-weight: 700;
  cursor: pointer;
  border: 0;
}

.button-primary,
button {
  background: var(--ink);
  color: white;
}

.button-secondary {
  background: rgba(255,255,255,0.78);
  color: var(--ink);
  border: 1px solid var(--border);
}

.proof-strip {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.proof-strip span,
.hero-card li,
.steps article,
blockquote,
details,
form,
.section {
  background: var(--card);
  backdrop-filter: blur(18px);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
}

.proof-strip span {
  padding: 0.65rem 0.95rem;
  border-radius: 999px;
}

.hero-card {
  padding: 1.5rem;
  border-radius: 2rem;
  background: linear-gradient(180deg, rgba(255,255,255,0.96), rgba(255,255,255,0.72));
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
}

.hero-card ul {
  display: grid;
  gap: 0.9rem;
  list-style: none;
  padding: 0;
  margin: 1.25rem 0 0;
}

.hero-card li {
  padding: 1rem;
  border-radius: 1.2rem;
}

.section {
  border-radius: 2rem;
  padding: 2rem;
  margin: 2rem 0;
}

.split {
  display: grid;
  grid-template-columns: 0.9fr 1.1fr;
  gap: 1.5rem;
}

.steps {
  display: grid;
  gap: 1rem;
}

.steps article {
  border-radius: 1.2rem;
  padding: 1.1rem;
}

.steps strong {
  color: var(--accent);
  font-size: 1.2rem;
}

.quote-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(3, 1fr);
}

blockquote {
  margin: 0;
  padding: 1.25rem;
  border-radius: 1.2rem;
}

.faq {
  display: grid;
  gap: 1rem;
}

details {
  padding: 1rem 1.1rem;
  border-radius: 1rem;
}

summary {
  cursor: pointer;
  font-weight: 700;
}

.request-service {
  display: grid;
  grid-template-columns: 0.95fr 1.05fr;
  gap: 1.5rem;
}

form {
  display: grid;
  gap: 1rem;
  padding: 1.5rem;
  border-radius: 1.5rem;
}

label {
  display: grid;
  gap: 0.45rem;
  font-weight: 600;
}

input,
textarea {
  width: 100%;
  border-radius: 1rem;
  border: 1px solid rgba(15, 23, 42, 0.14);
  padding: 0.95rem 1rem;
  font: inherit;
  background: rgba(255,255,255,0.9);
}

@media (max-width: 840px) {
  .hero,
  .split,
  .request-service,
  .quote-grid {
    grid-template-columns: 1fr;
  }

  h1 {
    max-width: none;
  }
}
`;
  }
}
