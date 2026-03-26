import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
import { PodStudioService } from "./services/pod-studio.js";
import { OfficeDashboardService } from "./services/office-dashboard.js";
import { StoreOpsService } from "./services/store-ops.js";
import { VentureStudioService } from "./services/venture-studio.js";
import { exists, readTextFile } from "./lib/fs.js";

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
  const podStudio = new PodStudioService(config, store);
  const officeDashboard = new OfficeDashboardService(config, store);

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
    ventureStudio,
    podStudio,
    officeDashboard
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

test("organization control plane sync creates blueprints, workflow ownership, and office views", async () => {
  const { store, imonEngine, officeDashboard } = await setupWorkspace();
  await imonEngine.bootstrap();

  const officeSnapshot = await imonEngine.syncOrganization();
  const dashboardArtifacts = await officeDashboard.writeDashboard();
  const engineBlueprint = await store.getOrganizationBlueprint("org-engine-imon-engine");
  const digitalStoreBlueprint = await store.getOrganizationBlueprint(
    "org-business-imon-digital-asset-store"
  );
  const workflowOwner = await store.getWorkflowOwnershipRecord(
    "store-autopilot",
    "imon-digital-asset-store"
  );

  assert.ok(engineBlueprint);
  assert.ok(digitalStoreBlueprint);
  assert.ok(workflowOwner);
  assert.equal(workflowOwner?.departmentName, "Operations");
  assert.equal(workflowOwner?.positionName, "Operations Manager");
  assert.ok(officeSnapshot.executiveView.businesses.length >= 5);
  assert.ok(
    officeSnapshot.businessViews.some((view) => view.businessId === "imon-digital-asset-store")
  );
  assert.equal(await exists(dashboardArtifacts.htmlPath), true);
  const dashboardHtml = await readTextFile(dashboardArtifacts.htmlPath);
  assert.ok(dashboardHtml.includes("ImonEngine"));
  assert.ok(dashboardHtml.includes("Business Offices"));
  assert.ok(dashboardHtml.includes("Task Inspector"));
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

test("store ops cap new pack generation based on recent creation volume", async () => {
  const { storeOps } = await setupWorkspace();
  const now = new Date().toISOString();
  const packs = [
    { id: "p1", assetType: "wallpaper_pack", status: "published", niche: "One", title: "One", createdAt: now, updatedAt: now, publishedAt: now },
    { id: "p2", assetType: "texture_pack", status: "ready_for_upload", niche: "Two", title: "Two", createdAt: now, updatedAt: now },
    { id: "p3", assetType: "icon_pack", status: "planned", niche: "Three", title: "Three", createdAt: now, updatedAt: now }
  ] as any;

  const policy = await storeOps.ensureCatalogPolicy();
  const control = await storeOps.getCatalogControlState(packs, { ...policy, maxNewPacksPer7Days: 2, maxOpenPackQueue: 5 });

  assert.equal(control.createdLast7Days, 3);
  assert.equal(control.canSeedMore, false);
  assert.ok(control.reasons.some((reason) => reason.includes("pack generation cap")));
});

test("store ops reserve Imon for the parent system and scaffold distinct future brand aliases", async () => {
  const { storeOps } = await setupWorkspace();

  const profiles = await storeOps.ensureSocialProfiles("imon-pod-store");
  const gmailAlias = profiles.find((profile) => profile.platform === "gmail_alias");
  const facebookPage = profiles.find((profile) => profile.platform === "facebook_page");
  const instagramProfiles = profiles.filter((profile) => profile.platform === "instagram_account");

  assert.equal(gmailAlias?.brandName, "Imonic");
  assert.equal(gmailAlias?.emailAlias, "imonengine+imonic@gmail.com");
  assert.equal(facebookPage?.status, "planned");
  assert.ok(facebookPage?.notes.some((note) => note.includes("umbrella Facebook Page")));
  assert.equal(instagramProfiles.length, 1);
  assert.equal(instagramProfiles[0]?.role, "umbrella_brand");
  assert.equal(instagramProfiles[0]?.emailAlias, "imonengine+imonic@gmail.com");
  assert.ok(instagramProfiles[0]?.notes.some((note) => note.includes("primary Instagram account")));
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
  assert.equal(relayResult.ledgerEntriesCreated, 0);
  assert.equal(snapshot.saleCount, 1);
  assert.equal(snapshot.grossRevenue, 9);
  assert.equal(snapshot.fees, 1);
  assert.equal(snapshot.relayDeposits, 8);
  assert.equal(snapshot.relaySpend, 2.5);
  assert.equal(snapshot.dataQuality.verifiedTransactions, 1);
  assert.equal(snapshot.dataQuality.inferredTransactions, 2);
  assert.equal(snapshot.dataQuality.excludedFromAllocationCount, 2);
  assert.equal(snapshot.dataQuality.verifiedNetRevenue, 8);
  assert.equal(snapshot.dataQuality.inferredCosts, 2.5);
  assert.equal(snapshot.recommendations.basedOnVerifiedDataOnly, true);
  assert.equal(snapshot.recommendations.growthReinvestment, 2.8);
  assert.equal(snapshot.recommendations.collectiveTransfer, 2.8);
  assert.equal(collective.businessCount, 1);
  assert.equal(collective.totals.collectiveTransfer, 2.8);
  assert.equal(collective.recommendations.basedOnVerifiedDataOnly, true);
  assert.equal(collective.dataQuality.businessesWithExcludedData, 1);
  assert.ok(profiles.some((profile) => profile.platform === "facebook_page" && profile.status === "live"));
  assert.ok(profiles.some((profile) => profile.platform === "x" && profile.status === "blocked"));
  assert.ok(report.monthlyRevenue > 0);
  assert.equal(report.monthlyCosts, 1);
});

test("venture studio builds weekly launch windows and brand blueprints from the live template", async () => {
  const { imonEngine, storeOps, ventureStudio } = await setupWorkspace();
  await imonEngine.bootstrap();
  await storeOps.ensureSocialProfiles();
  await storeOps.ensureSocialProfiles("imon-pod-store", "Imonic");

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
  assert.equal(snapshot.createdBrandCount, 1);
  assert.ok(firstWindow);
  assert.equal(firstWindowWeekday, "Mon");
  assert.ok(firstWindowHour >= 7 && firstWindowHour <= 8);
  assert.ok(podBlueprint);
  assert.equal(podBlueprint?.businessName, "Imonic");
  assert.equal(podBlueprint?.aliasEmail, "imonengine+imonic@gmail.com");
  assert.equal(podBlueprint?.orgStructure.blueprintId, "org-business-imon-pod-store");
  assert.ok(
    podBlueprint?.orgStructure.departments.some(
      (department) => department.name === "Merchandising"
    )
  );
  assert.ok(
    podBlueprint?.orgStructure.workflowOwnership.some(
      (owner) => owner.workflowId === "pod-planning"
    )
  );
  assert.equal(podBlueprint?.socialArchitecture.facebookStrategy, "umbrella_brand");
  assert.equal(podBlueprint?.socialArchitecture.instagramStrategy, "single_brand");
  assert.equal(podBlueprint?.socialArchitecture.niches.length, 1);
  assert.ok(snapshot.policy.socialRules.some((rule) => rule.includes("umbrella brand")));
  assert.equal(snapshot.policy.systemReinvestmentCapRate, 0.35);
  assert.ok(snapshot.capitalExperimentTracks.every((track) => track.stage !== "live_ops"));
});

test("task routing enforces business memory scope and least-privilege tools", async () => {
  const { imonEngine } = await setupWorkspace();
  await imonEngine.bootstrap();

  const routed = await imonEngine.routeTask({
    workflowId: "store-autopilot",
    businessId: "imon-digital-asset-store",
    title: "Refresh store queue",
    summary: "Refresh the digital asset store growth queue and artifacts.",
    requestedTools: ["scheduler", "growth-queue", "money_movement"]
  });

  assert.equal(routed.envelope.businessId, "imon-digital-asset-store");
  assert.ok(routed.envelope.allowedTools.includes("scheduler"));
  assert.ok(routed.envelope.allowedTools.includes("growth-queue"));
  assert.ok(!routed.envelope.allowedTools.includes("money_movement"));
  assert.ok(
    routed.envelope.allowedMemoryNamespaces.every(
      (namespace) =>
        namespace.includes("business/imon-digital-asset-store") &&
        !namespace.includes("business/imon-pod-store")
    )
  );
  assert.equal(routed.approvalRoute.riskLevel, "low");
});

test("pod studio creates an Imonic launch plan with deduplicated products and actionable roadblocks", async () => {
  const { root, imonEngine, podStudio, store } = await setupWorkspace();
  await imonEngine.bootstrap();

  const referenceDir = path.join(root, "tdc");
  await mkdir(referenceDir, { recursive: true });
  await writeFile(path.join(referenceDir, "bear-pop.png"), "img", "utf8");
  await writeFile(path.join(referenceDir, "candy-castle.png"), "img", "utf8");
  await writeFile(path.join(referenceDir, "abstract-tiger.png"), "img", "utf8");
  await writeFile(path.join(referenceDir, "fox-static.png"), "img", "utf8");
  await writeFile(path.join(referenceDir, "rabbit-orbit.png"), "img", "utf8");

  const result = await podStudio.writePlan({
    businessId: "imon-pod-store",
    referenceDirectory: referenceDir
  });
  const combinations = new Set(result.plan.productSchedule.map((item) => `${item.designId}:${item.productType}`));
  const storyTargets = result.plan.socialSchedule
    .filter((item) => item.kind === "story" || item.kind === "reel")
    .map((item) => `${item.designId}:${item.productType ?? ""}`);
  const updatedBusiness = await store.getManagedBusiness("imon-pod-store");

  assert.equal(result.plan.businessName, "Imonic");
  assert.equal(result.plan.aliasEmail, "imonengine+imonic@gmail.com");
  assert.equal(result.plan.starterDesigns.length, 5);
  assert.equal(result.plan.cadence.weeklyNewDesigns, 1);
  assert.equal(result.plan.productSchedule.length, combinations.size);
  assert.equal(new Set(storyTargets).size, storyTargets.length);
  assert.ok(result.plan.roadblocks.some((roadblock) => roadblock.category.includes("Shopify")));
  assert.ok(result.plan.roadblocks.some((roadblock) => roadblock.category.includes("POD vendor")));
  assert.ok(updatedBusiness);
  assert.equal(updatedBusiness?.name, "Imonic");
  assert.ok(updatedBusiness?.launchBlockers.some((blocker) => blocker.includes("Shopify")));
});
