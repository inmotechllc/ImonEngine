import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { DEFAULT_OFFERS } from "./domain/defaults.js";
import type { ClientJob } from "./domain/contracts.js";
import { OrchestratorAgent } from "./agents/orchestrator.js";
import { SiteBuilderAgent } from "./agents/site-builder.js";
import { QaReviewerAgent } from "./agents/qa-reviewer.js";
import { ImonEngineAgent } from "./agents/imon-engine.js";
import { DigitalAssetFactoryAgent } from "./agents/digital-asset-factory.js";
import { FileStore } from "./storage/store.js";
import { AIClient } from "./openai/client.js";
import { ReplyHandlerAgent } from "./agents/reply-handler.js";
import { StoreOpsService } from "./services/store-ops.js";
import { VentureStudioService } from "./services/venture-studio.js";

async function setupWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "auto-funding-"));
  const config = await loadConfig(root);
  const store = new FileStore(config.stateDir);
  await store.init();

  for (const offer of DEFAULT_OFFERS) {
    await store.saveOffer(offer);
  }

  const ai = new AIClient(config);
  const orchestrator = new OrchestratorAgent(config, store, ai);
  const siteBuilder = new SiteBuilderAgent(ai, config, store);
  const qaReviewer = new QaReviewerAgent(config, store);
  const replyHandler = new ReplyHandlerAgent(ai);
  const imonEngine = new ImonEngineAgent(config, store);
  const digitalAssetFactory = new DigitalAssetFactoryAgent(config, store, ai);
  const storeOps = new StoreOpsService(config, store);
  const ventureStudio = new VentureStudioService(config, store);

  return {
    root,
    config,
    store,
    orchestrator,
    siteBuilder,
    qaReviewer,
    replyHandler,
    imonEngine,
    digitalAssetFactory,
    storeOps,
    ventureStudio
  };
}

test("prospecting imports leads with scores and stages", async () => {
  const { root, store, orchestrator } = await setupWorkspace();
  const csvPath = path.join(root, "prospects.csv");
  await writeFile(
    csvPath,
    [
      "businessName,niche,city,state,ownerName,email,phone,website,hasWebsite,hasHttps,mobileFriendly,clearOffer,callsToAction,pageSpeedBucket,notes,tags",
      "Signal Plumbing,home services,Akron,OH,Chris,chris@signalplumbing.com,(330) 555-0101,http://signalplumbing.com,true,false,false,false,false,slow,\"Old site; buried CTA\",priority",
      "No Contact Roofers,home services,Akron,OH,,,,,false,false,false,false,false,unknown,\"No contact details available\",roofing"
    ].join("\n"),
    "utf8"
  );

  const leads = await orchestrator.prospect(csvPath);
  const saved = await store.getLeads();

  assert.equal(leads.length, 2);
  assert.equal(saved.length, 2);
  assert.ok(saved[0]?.scoreReasons.length);
  assert.ok(saved.some((lead) => lead.stage === "qualified"));
  assert.ok(saved.some((lead) => lead.stage === "discarded" || lead.stage === "prospecting"));
});

test("outreach draft and reply handling stay compliant", async () => {
  const { store, orchestrator, replyHandler } = await setupWorkspace();
  const now = new Date().toISOString();
  await store.saveLead({
    id: "signal-plumbing",
    businessName: "Signal Plumbing",
    niche: "home services",
    geo: "Akron, OH",
    source: "test",
    contact: {
      ownerName: "Chris",
      email: "chris@signalplumbing.com",
      phone: "(330) 555-0101",
      website: "http://signalplumbing.com"
    },
    websiteQualitySignals: {
      hasWebsite: true,
      hasHttps: false,
      mobileFriendly: false,
      clearOffer: false,
      callsToAction: false,
      pageSpeedBucket: "slow",
      notes: ["Old site", "No CTA"]
    },
    score: 82,
    scoreReasons: ["Weak mobile experience", "Email is public"],
    stage: "qualified",
    tags: ["priority"],
    createdAt: now,
    updatedAt: now
  });

  const draftedCount = await orchestrator.draftOutreach(5);
  const drafts = await store.getOutreachDrafts();
  const reply = await replyHandler.classify("Send me the preview and pricing.");

  assert.equal(draftedCount, 1);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.approved, true);
  assert.equal(reply.disposition, "positive");
});

test("client build, QA, and retention reporting work end to end", async () => {
  const { store, siteBuilder, qaReviewer, orchestrator } = await setupWorkspace();
  const now = new Date().toISOString();
  const client: ClientJob = {
    id: "sunrise-plumbing",
    clientName: "Sunrise Plumbing & Drain",
    niche: "home services",
    geo: "Akron, OH",
    primaryPhone: "(330) 555-0180",
    primaryEmail: "dispatch@sunriseplumbingdrain.com",
    offerId: "founding-offer",
    siteStatus: "not_started",
    qaStatus: "pending",
    billingStatus: "retainer_active",
    formEndpoint: "https://hooks.example.com/forms/sunrise-plumbing",
    deployment: {
      platform: "local-preview"
    },
    assets: {
      logoText: "Sunrise Plumbing",
      services: ["Emergency plumbing repair", "Drain cleaning", "Water heater installation"],
      testimonials: ["Fast dispatch and clear communication."],
      reviews: ["Great service and easy scheduling."]
    },
    intakeNotes: ["Direct local tone", "Highlight emergency repair"],
    nextAction: "Booked optimization review",
    createdAt: now,
    updatedAt: now
  };

  await store.saveClient(client);
  await siteBuilder.buildClientSite(client);
  const refreshed = await store.getClient(client.id);
  assert.ok(refreshed);
  const qa = await qaReviewer.review(refreshed!);
  const retention = await orchestrator.getReports().generateRetentionReport(refreshed!);

  assert.equal(qa.passed, true);
  assert.ok(retention.updateSuggestions.length >= 2);
  assert.ok(retention.upsellCandidate.length > 0);
});

test("ImonEngine seeds the portfolio and produces a resource-aware report", async () => {
  const { store, imonEngine } = await setupWorkspace();

  const report = await imonEngine.bootstrap();
  const engine = await store.getEngineState();
  const businesses = await store.getManagedBusinesses();
  const digitalAssetStore = businesses.find((business) => business.id === "imon-digital-asset-store");
  const agency = businesses.find((business) => business.id === "auto-funding-agency");

  assert.ok(engine);
  assert.equal(engine?.portfolio.trackedBusinesses, 6);
  assert.ok(digitalAssetStore);
  assert.equal(digitalAssetStore?.stage, "ready");
  assert.ok(agency);
  assert.equal(agency?.stage, "paused");
  assert.ok(report.nextLaunchCandidates.includes("imon-digital-asset-store"));
  assert.ok(report.recommendedConcurrency >= 1);
});

test("digital asset factory seeds Gumroad starter packs", async () => {
  const { store, imonEngine, digitalAssetFactory } = await setupWorkspace();
  await imonEngine.bootstrap();

  const created = await digitalAssetFactory.seedStarterQueue();
  const packs = await store.getAssetPacks();

  assert.equal(created.length, 5);
  assert.equal(packs.length, 5);
  assert.ok(packs.every((pack) => pack.marketplace === "gumroad"));
  assert.ok(packs.every((pack) => pack.listingChecklist.length >= 4));
});

test("digital asset factory stages the first pack for production", async () => {
  const { store, imonEngine, digitalAssetFactory } = await setupWorkspace();
  await imonEngine.bootstrap();
  await digitalAssetFactory.seedStarterQueue();

  const staged = await digitalAssetFactory.stagePack();
  const saved = await store.getAssetPack(staged.id);

  assert.ok(saved);
  assert.equal(saved?.status, "producing");
  assert.equal(saved?.title, "Minimal Productivity Desktop Background Pack");
});

test("store ops rebalance the next asset type instead of endlessly picking wallpapers", async () => {
  const { storeOps } = await setupWorkspace();
  const now = new Date().toISOString();
  const packs = [
    { id: "w1", assetType: "wallpaper_pack", status: "published", niche: "Wall 1", title: "Wall 1", productUrl: "https://example.com/1", publishedAt: now },
    { id: "w2", assetType: "wallpaper_pack", status: "published", niche: "Wall 2", title: "Wall 2", productUrl: "https://example.com/2", publishedAt: now },
    { id: "w3", assetType: "wallpaper_pack", status: "published", niche: "Wall 3", title: "Wall 3", productUrl: "https://example.com/3", publishedAt: now },
    { id: "w4", assetType: "wallpaper_pack", status: "published", niche: "Wall 4", title: "Wall 4", productUrl: "https://example.com/4", publishedAt: now },
    { id: "t1", assetType: "texture_pack", status: "published", niche: "Texture 1", title: "Texture 1", productUrl: "https://example.com/5", publishedAt: now }
  ] as any;

  const policy = await storeOps.ensureCatalogPolicy();
  const nextType = storeOps.selectNextAssetType(packs, { ...policy, maxNewPacksPer7Days: 10 });

  assert.notEqual(nextType, "wallpaper_pack");
});

test("store ops reserve Imon for the parent system and scaffold distinct future brand aliases", async () => {
  const { storeOps } = await setupWorkspace();

  const profiles = await storeOps.ensureSocialProfiles("imon-pod-store");
  const gmailAlias = profiles.find((profile) => profile.platform === "gmail_alias");
  const xProfile = profiles.find((profile) => profile.platform === "x");

  assert.equal(gmailAlias?.brandName, "Canvas Current");
  assert.equal(gmailAlias?.emailAlias, "imonengine+canvascurrent@gmail.com");
  assert.equal(xProfile?.status, "planned");
  assert.ok(xProfile?.notes.some((note) => note.includes("simulated clicks")));
  assert.ok(xProfile?.notes.some((note) => note.includes("manual solve")));
});

test("store ops import Gumroad and Relay data into a revenue snapshot", async () => {
  const { root, store, imonEngine, digitalAssetFactory, storeOps } = await setupWorkspace();
  await imonEngine.bootstrap();
  const packs = await digitalAssetFactory.seedStarterQueue();
  const first = await digitalAssetFactory.publishPack(
    packs[0]!.id,
    "https://imonengine.gumroad.com/l/test-product"
  );

  const gumroadCsv = path.join(root, "gumroad-sales.csv");
  const relayCsv = path.join(root, "relay.csv");
  await writeFile(
    gumroadCsv,
    [
      "Order ID,Product Name,Sale Price,Fee,Creator Earnings,Purchase Date,Currency,Email",
      `sale-1,${first.title},9,1,8,2026-03-24,USD,buyer@example.com`
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    relayCsv,
    [
      "Posted Date,Description,Amount,Account",
      "2026-03-24,Gumroad payout,8.00,Relay Operating",
      "2026-03-24,Meta Ads,-2.50,Relay Operating"
    ].join("\n"),
    "utf8"
  );

  const gumroadResult = await storeOps.importGumroadSales(gumroadCsv, [first]);
  const relayResult = await storeOps.importRelayTransactions(relayCsv);
  const snapshot = await storeOps.buildRevenueSnapshot();
  const collective = await storeOps.buildCollectiveFundSnapshot();
  const profiles = await storeOps.ensureSocialProfiles();
  const report = await imonEngine.sync();

  assert.equal(gumroadResult.imported, 1);
  assert.equal(relayResult.imported, 2);
  assert.equal(snapshot.saleCount, 1);
  assert.equal(snapshot.grossRevenue, 9);
  assert.equal(snapshot.fees, 1);
  assert.equal(snapshot.relayDeposits, 8);
  assert.equal(snapshot.relaySpend, 2.5);
  assert.equal(snapshot.recommendations.growthReinvestment, 2.8);
  assert.equal(snapshot.recommendations.collectiveTransfer, 2.8);
  assert.equal(collective.businessCount, 1);
  assert.equal(collective.totals.collectiveTransfer, 2.8);
  assert.ok(profiles.some((profile) => profile.platform === "facebook_page" && profile.status === "live"));
  assert.ok(profiles.some((profile) => profile.platform === "x" && profile.status === "blocked"));
  assert.ok(report.monthlyRevenue > 0);
});

test("venture studio builds weekly launch windows and brand blueprints from the live template", async () => {
  const { imonEngine, storeOps, ventureStudio } = await setupWorkspace();
  await imonEngine.bootstrap();
  await storeOps.ensureSocialProfiles();
  await storeOps.ensureSocialProfiles("imon-pod-store", "Canvas Current");

  const snapshot = await ventureStudio.buildSnapshot();
  const podBlueprint = snapshot.blueprints.find((blueprint) => blueprint.businessId === "imon-pod-store");
  const firstWindow = snapshot.launchWindows[0];
  const firstWindowInNy = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false
  }).formatToParts(new Date(firstWindow!.startsAt));
  const firstWindowWeekday = firstWindowInNy.find((part) => part.type === "weekday")?.value;
  const firstWindowHour = Number(firstWindowInNy.find((part) => part.type === "hour")?.value ?? "0");

  assert.equal(snapshot.nextLaunchMode, "weekly");
  assert.equal(snapshot.createdBrandCount, 2);
  assert.ok(firstWindow);
  assert.equal(firstWindowWeekday, "Mon");
  assert.ok(firstWindowHour >= 7 && firstWindowHour <= 8);
  assert.ok(podBlueprint);
  assert.equal(podBlueprint?.businessName, "Canvas Current");
  assert.equal(podBlueprint?.aliasEmail, "imonengine+canvascurrent@gmail.com");
  assert.equal(snapshot.policy.systemReinvestmentCapRate, 0.35);
  assert.ok(snapshot.capitalExperimentTracks.every((track) => track.stage !== "live_ops"));
});
