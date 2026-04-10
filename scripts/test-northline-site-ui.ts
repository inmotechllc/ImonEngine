import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { chromium, type Browser, type Page, type ViewportSize } from "playwright";
import { loadConfig } from "../src/config.js";
import { DEFAULT_AGENCY_PROFILE } from "../src/domain/defaults.js";
import { readJsonFile } from "../src/lib/fs.js";
import { buildAgencySite } from "../src/services/agency-site.js";
import { NorthlineSiteServer } from "../src/services/northline-site-server.js";

type PageReport = {
  name: string;
  url: string;
  viewport: ViewportSize;
  title: string;
  metaDescription: string | null;
  h1: string;
  ctas: string[];
  formLabels: string[];
  overflow: boolean;
  sectionIds: string[];
};

type Scenario = {
  name: string;
  path: string;
  viewport: ViewportSize;
  assertPage: (page: Page) => Promise<void>;
  prepare?: (page: Page) => Promise<void>;
  afterScreenshot?: (page: Page) => Promise<void>;
};

const OUTPUT_DIR = path.resolve("output", "playwright");
const HOME_DESKTOP: ViewportSize = { width: 1440, height: 1200 };
const MOBILE: ViewportSize = { width: 390, height: 844 };

const SURFACE = {
  siteUrl: "https://northlinegrowthsystems.com",
  salesEmail: "contact@northlinegrowthsystems.com",
  primaryServiceArea: "Akron, OH",
  bookingUrl: "/book.html",
  leadFormAction: "/api/northline-intake",
  stripeLeadGeneration: "https://buy.stripe.com/test_northline_lead_generation",
  stripeFounding: "https://buy.stripe.com/test_northline_founding",
  stripeStandard: "https://buy.stripe.com/test_northline_standard",
  growthUpgrade: {
    paymentLink: "https://buy.stripe.com/test_northline_growth_upgrade",
    couponLabel: "Lead Gen to Growth",
    terms: "Apply within 30 days of the first launch."
  },
  stripeValidation: "https://buy.stripe.com/test_northline_validation"
} as const;

async function setupSite() {
  const root = await mkdtemp(path.join(os.tmpdir(), "auto-funding-northline-ui-"));
  const config = await loadConfig(root);
  config.northlineSite.bindHost = "127.0.0.1";
  config.northlineSite.port = 0;

  await buildAgencySite(config, DEFAULT_AGENCY_PROFILE, SURFACE);

  const server = new NorthlineSiteServer(config);
  const address = await server.listen();
  const baseUrl = `http://${address.host}:${address.port}`;

  return {
    server,
    baseUrl,
    submissionStorePath: config.northlineSite.submissionStorePath
  };
}

async function text(page: Page, selector: string): Promise<string> {
  return ((await page.locator(selector).textContent()) ?? "").trim().replace(/\s+/g, " ");
}

async function fillBookingForm(page: Page): Promise<void> {
  await page.locator('input[name="businessName"]').fill("Signal Plumbing");
  await page.locator('input[name="contactName"]').fill("Chris");
  await page.locator('input[name="email"]').fill("dispatch@signalplumbing.com");
  await page.locator('input[name="phone"]').fill("(330) 555-0101");
  await page.locator('input[name="pageUrl"]').fill("https://signalplumbing.com");
  await page.locator('input[name="reviewWindow"]').fill("Tue 1-3pm ET");
  await page.locator('textarea[name="mainProblem"]').fill("Weak CTA, slow replies, and missed after-hours calls.");
}

async function fillIntakeForm(page: Page): Promise<void> {
  await page.locator('input[name="businessName"]').fill("Signal Plumbing");
  await page.locator('input[name="contactName"]').fill("Chris");
  await page.locator('input[name="email"]').fill("dispatch@signalplumbing.com");
  await page.locator('input[name="phone"]').fill("(330) 555-0101");
  await page.locator('input[name="pageUrl"]').fill("https://signalplumbing.com");
  await page.locator('input[name="targetArea"]').fill("Akron, OH");
  await page.locator('input[name="targetJobs"]').fill("Emergency plumbing repair and water heater installs");
  await page.locator('textarea[name="mainProblem"]').fill("The homepage buries the CTA and nobody follows up fast after missed calls.");
}

async function collectReport(page: Page, name: string, url: string, viewport: ViewportSize): Promise<PageReport> {
  return page.evaluate(
    ({ targetName, targetUrl, targetViewport }) => ({
      name: targetName,
      url: targetUrl,
      viewport: targetViewport,
      title: document.title,
      metaDescription: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? null,
      h1: document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      ctas: Array.from(document.querySelectorAll("a, button"))
        .map((element) => element.textContent?.replace(/\s+/g, " ").trim() ?? "")
        .filter(Boolean),
      formLabels: Array.from(document.querySelectorAll("label"))
        .map((label) => label.textContent?.replace(/\s+/g, " ").trim() ?? "")
        .filter(Boolean),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 4,
      sectionIds: Array.from(document.querySelectorAll("section[id]"))
        .map((section) => section.id)
        .filter(Boolean)
    }),
    {
      targetName: name,
      targetUrl: url,
      targetViewport: viewport
    }
  );
}

async function runScenario(browser: Browser, baseUrl: string, scenario: Scenario): Promise<PageReport> {
  const page = await browser.newPage({ viewport: scenario.viewport });

  try {
    await page.goto(`${baseUrl}${scenario.path}`, { waitUntil: "domcontentloaded" });
    await page.locator("h1").waitFor();
    await scenario.assertPage(page);

    if (scenario.prepare) {
      await scenario.prepare(page);
    }

    const report = await collectReport(page, scenario.name, `${baseUrl}${scenario.path}`, scenario.viewport);
    assert.equal(report.overflow, false, `${scenario.name} should not overflow horizontally`);

    await page.screenshot({
      path: path.join(OUTPUT_DIR, `${scenario.name}.png`),
      fullPage: true,
      timeout: 120000
    });

    if (scenario.afterScreenshot) {
      await scenario.afterScreenshot(page);
    }

    return report;
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  const { server, baseUrl, submissionStorePath } = await setupSite();
  await mkdir(OUTPUT_DIR, { recursive: true });

  let browser: Browser | undefined;

  try {
    browser = await chromium.launch({ headless: true });

    const scenarios: Scenario[] = [
      {
        name: "home-desktop",
        path: "/",
        viewport: HOME_DESKTOP,
        assertPage: async (page) => {
          assert.equal(await text(page, "h1"), DEFAULT_AGENCY_PROFILE.headline);
          assert.equal(await page.locator(".hero-copy .actions .button").count(), 1);
          assert.equal(await text(page, ".hero-copy .actions .button"), "Get leak review");
          assert.match(await text(page, ".hero-copy .action-note"), /Book a live review/i);
          assert.equal(await page.locator(".signal").count(), 0);
          assert.equal(await page.locator("#proof").count(), 0);
          assert.equal(await page.locator("#pricing .price-qualification").count(), 2);
          assert.equal(await page.locator('#pricing .price[data-tier-id="lead-generation"]').count(), 1);
          assert.equal(await page.locator('#pricing .price[data-tier-id="growth-system"]').count(), 0);
          assert.equal(await text(page, '#pricing .price[data-tier-id="lead-generation"] .button'), "Get leak review");
          assert.equal(await text(page, '#pricing .price[data-tier-id="pilot-launch"] .button'), "See if the pilot fits");
          assert.equal(await page.locator("#pricing .checkout-option").count(), 1);
          assert.equal(await text(page, '#pricing .checkout-option[data-tier-id="pilot-launch"] a'), "Reserve Pilot Launch");
          assert.equal(await page.locator("#pricing [data-upgrade-panel]").count(), 0);
          assert.equal(await page.locator("#pricing [data-retainer-hold]").count(), 1);
          assert.equal(await text(page, "#pricing .checkout-gate h3"), "Checkout only after Northline confirms the first paid fix and fit.");
        }
      },
      {
        name: "home-mobile",
        path: "/",
        viewport: MOBILE,
        assertPage: async (page) => {
          assert.equal(await text(page, "h1"), DEFAULT_AGENCY_PROFILE.headline);
          assert.equal(await text(page, ".hero-copy .actions .button"), "Get leak review");
          assert.equal(await page.locator(".mobile-proof-strip").count(), 0);
          assert.equal(await page.locator("#pricing .price").count(), 2);
          assert.equal(await page.locator("#pricing [data-retainer-hold]").count(), 1);
          assert.equal(
            await text(page, ".meta div:last-child strong"),
            "Start with the leak review. Book the live review only if you need a short call before Northline points to the next fix."
          );
        }
      },
      {
        name: "book-desktop",
        path: "/book.html",
        viewport: HOME_DESKTOP,
        assertPage: async (page) => {
          assert.equal(await text(page, "h1"), "Book a 15-minute live review if you want Northline to point at the leak with you.");
          assert.equal(await page.locator('input[name="pageUrl"]').count(), 1);
          assert.equal(await page.locator('input[name="reviewWindow"]').count(), 1);
          assert.equal(await page.locator('textarea[name="mainProblem"]').count(), 1);
          assert.equal(await page.locator('input[name="jobType"]').count(), 0);
          assert.equal(await page.locator('input[name="bestOutcome"]').count(), 0);
          assert.equal(await page.locator('input[name="contactPreference"]').count(), 0);
          assert.equal(await text(page, 'button[type="submit"]'), "Request Live Review");
        },
        prepare: fillBookingForm
      },
      {
        name: "book-mobile",
        path: "/book.html",
        viewport: MOBILE,
        assertPage: async (page) => {
          assert.equal(await text(page, "h1"), "Book a 15-minute live review if you want Northline to point at the leak with you.");
          assert.equal(await page.locator('textarea[name="mainProblem"]').count(), 1);
          assert.match(await text(page, ".subhero .panel"), /What gets reviewed|One fix worth shipping first/i);
        },
        prepare: fillBookingForm
      },
      {
        name: "intake-desktop",
        path: "/intake.html",
        viewport: HOME_DESKTOP,
        assertPage: async (page) => {
          assert.equal(await text(page, "h1"), "Send the page and the main leak. Northline will tell you what to fix first.");
          assert.equal(await page.locator('input[name="pageUrl"]').count(), 1);
          assert.equal(await page.locator('input[name="targetArea"]').count(), 1);
          assert.equal(await page.locator('input[name="targetJobs"]').count(), 1);
          assert.equal(await page.locator('textarea[name="mainProblem"]').count(), 1);
          assert.equal(await page.locator('input[name="jobType"]').count(), 0);
          assert.equal(await page.locator('input[name="leadGoal"]').count(), 0);
          assert.equal(await text(page, 'button[type="submit"]'), "Send Leak Review");
        },
        prepare: fillIntakeForm,
        afterScreenshot: async (page) => {
          await Promise.all([
            page.waitForURL(/thank-you\.html$/),
            page.getByRole("button", { name: "Send Leak Review" }).click()
          ]);
          assert.equal(await text(page, "h1"), "Northline has what it needs to review the intake.");
        }
      },
      {
        name: "intake-mobile",
        path: "/intake.html",
        viewport: MOBILE,
        assertPage: async (page) => {
          assert.equal(await text(page, "h1"), "Send the page and the main leak. Northline will tell you what to fix first.");
          const calloutText = ((await page.locator(".grid > aside .support-note").textContent()) ?? "").replace(/\s+/g, " ");
          assert.match(calloutText, /Owner-led plumbing|need clearer conversion from it/i);
        },
        prepare: fillIntakeForm
      }
    ];

    const pages: PageReport[] = [];
    for (const scenario of scenarios) {
      pages.push(await runScenario(browser, baseUrl, scenario));
    }

    const stored = await readJsonFile<{
      submissions: Array<{
        ownerName?: string;
        businessName?: string;
        serviceArea?: string;
        primaryServices?: string;
        preferredCallWindow?: string;
        website?: string;
        leadGoal?: string;
        biggestLeak?: string;
        source?: string;
      }>;
    }>(submissionStorePath, { submissions: [] });

    assert.equal(stored.submissions.length, 1);
    assert.equal(stored.submissions[0]?.ownerName, "Chris");
    assert.equal(stored.submissions[0]?.businessName, "Signal Plumbing");
    assert.equal(stored.submissions[0]?.serviceArea, "Akron, OH");
    assert.equal(stored.submissions[0]?.primaryServices, "Emergency plumbing repair and water heater installs");
    assert.equal(stored.submissions[0]?.preferredCallWindow, undefined);
    assert.equal(stored.submissions[0]?.website, "https://signalplumbing.com");
    assert.equal(stored.submissions[0]?.leadGoal, undefined);
    assert.match(stored.submissions[0]?.biggestLeak ?? "", /missed calls/i);
    assert.equal(stored.submissions[0]?.source, "northline-website-intake");

    await writeFile(
      path.join(OUTPUT_DIR, "report.json"),
      `${JSON.stringify(
        {
          base: baseUrl,
          pages,
          storedSubmission: stored.submissions[0] ?? null
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    console.log("Northline site UI regression passed.");
  } finally {
    await browser?.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});