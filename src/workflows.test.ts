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

  return { root, config, store, orchestrator, siteBuilder, qaReviewer, replyHandler };
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
