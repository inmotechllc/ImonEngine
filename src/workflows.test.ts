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

  return {
    root,
    config,
    store,
    orchestrator,
    siteBuilder,
    qaReviewer,
    replyHandler,
    imonEngine,
    digitalAssetFactory
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
