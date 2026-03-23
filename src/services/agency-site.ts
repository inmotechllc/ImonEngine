import path from "node:path";
import type { AppConfig } from "../config.js";
import type { AgencyProfile } from "../domain/contracts.js";
import { writeTextFile } from "../lib/fs.js";

export async function buildAgencySite(config: AppConfig, profile: AgencyProfile): Promise<string> {
  const outputDir = path.join(config.outputDir, "agency-site");
  const htmlPath = path.join(outputDir, "index.html");
  const cssPath = path.join(outputDir, "styles.css");

  const pricingCards = profile.pricing
    .map(
      (tier) => `<article class="price-card"><p class="eyebrow">${tier.label}</p><h3>${tier.amount}</h3><p>${tier.details}</p></article>`
    )
    .join("");
  const differentiators = profile.differentiators.map((item) => `<li>${item}</li>`).join("");
  const proofPoints = profile.proofPoints.map((item) => `<li>${item}</li>`).join("");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${profile.name}</title>
    <meta name="description" content="${profile.supportingCopy}" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Newsreader:opsz,wght@6..72,500;6..72,700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <div>
          <p class="eyebrow">AI-operated local growth systems</p>
          <h1>${profile.headline}</h1>
          <p class="lede">${profile.supportingCopy}</p>
          <div class="actions">
            <a href="mailto:${config.business.salesEmail}" class="button primary">Book Intro</a>
            <a href="${config.business.stripeFounding ?? "#pricing"}" class="button secondary">See Founding Offer</a>
          </div>
        </div>
        <aside class="card">
          <p class="eyebrow">Built for cash flow first</p>
          <ul>${proofPoints}</ul>
        </aside>
      </section>

      <section class="grid">
        <div class="panel">
          <p class="eyebrow">Why this wins</p>
          <h2>Productized work that still looks tailored</h2>
          <ul>${differentiators}</ul>
        </div>
        <div class="panel" id="pricing">
          <p class="eyebrow">Pricing</p>
          <div class="pricing-grid">${pricingCards}</div>
        </div>
      </section>
    </main>
  </body>
</html>`;

  const css = `:root {
  --ink: #09111f;
  --accent: #cb5c1a;
  --paper: #f7f2e9;
  --paper-deep: #ece2cf;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  color: var(--ink);
  font-family: "Space Grotesk", system-ui, sans-serif;
  background:
    radial-gradient(circle at top right, rgba(203, 92, 26, 0.24), transparent 30%),
    linear-gradient(145deg, var(--paper), var(--paper-deep));
}

.shell {
  width: min(1120px, calc(100% - 2rem));
  margin: 0 auto;
  padding: 2rem 0 4rem;
}

.hero {
  display: grid;
  grid-template-columns: 1.25fr 0.75fr;
  gap: 1.5rem;
  align-items: center;
  min-height: 70vh;
}

.eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-weight: 700;
  color: var(--accent);
  font-size: 0.78rem;
}

h1, h2, h3 {
  font-family: "Newsreader", Georgia, serif;
  line-height: 0.95;
  margin: 0 0 1rem;
}

h1 { font-size: clamp(3rem, 8vw, 6rem); max-width: 10ch; }
h2 { font-size: clamp(2rem, 4vw, 3.4rem); }
h3 { font-size: 2rem; }

.lede, li, .price-card p {
  font-size: 1.05rem;
  line-height: 1.7;
}

.actions {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  margin-top: 2rem;
}

.button {
  text-decoration: none;
  border-radius: 999px;
  padding: 0.95rem 1.35rem;
  font-weight: 700;
}

.primary {
  background: var(--ink);
  color: white;
}

.secondary {
  border: 1px solid rgba(9, 17, 31, 0.15);
  color: var(--ink);
}

.card, .panel, .price-card {
  background: rgba(255,255,255,0.74);
  backdrop-filter: blur(18px);
  border: 1px solid rgba(9, 17, 31, 0.12);
  border-radius: 1.6rem;
  box-shadow: 0 24px 60px rgba(9, 17, 31, 0.12);
}

.card, .panel {
  padding: 1.5rem;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
}

.pricing-grid {
  display: grid;
  gap: 1rem;
}

.price-card {
  padding: 1.2rem;
}

ul {
  margin: 1rem 0 0;
  padding-left: 1.2rem;
}

@media (max-width: 840px) {
  .hero, .grid {
    grid-template-columns: 1fr;
  }
}
`;

  await writeTextFile(htmlPath, html);
  await writeTextFile(cssPath, css);
  return htmlPath;
}
