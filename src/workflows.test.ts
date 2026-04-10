import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { DEFAULT_AGENCY_PROFILE, DEFAULT_OFFERS } from "./domain/defaults.js";
import type {
  ClientJob,
  HandoffPackage,
  LeadRecord,
  OutreachDraft,
  OutreachSendReceipt,
  ProofBundle
} from "./domain/contracts.js";
import { OrchestratorAgent } from "./agents/orchestrator.js";
import { Deployer } from "./agents/deployer.js";
import { QualifierAgent } from "./agents/qualifier.js";
import { SiteBuilderAgent } from "./agents/site-builder.js";
import { QaReviewerAgent } from "./agents/qa-reviewer.js";
import { ImonEngineAgent } from "./agents/imon-engine.js";
import { DigitalAssetFactoryAgent } from "./agents/digital-asset-factory.js";
import { StoreAutopilotAgent } from "./agents/store-autopilot.js";
import { FileStore } from "./storage/store.js";
import { AIClient } from "./ai/client.js";
import { ReplyHandlerAgent } from "./agents/reply-handler.js";
import { ClipBaitersAutonomyService } from "./services/clipbaiters-autonomy.js";
import { ClipBaitersCollectorService } from "./services/clipbaiters-collector.js";
import { ClipBaitersDealsService } from "./services/clipbaiters-deals.js";
import { ClipBaitersIntakeService } from "./services/clipbaiters-intake.js";
import { ClipBaitersMonetizationService } from "./services/clipbaiters-monetization.js";
import { ClipBaitersPublisherService } from "./services/clipbaiters-publisher.js";
import { ClipBaitersRadarService } from "./services/clipbaiters-radar.js";
import { ClipBaitersSkimmerService } from "./services/clipbaiters-skimmer.js";
import { ClipBaitersStudioService } from "./services/clipbaiters-studio.js";
import { MicroSaasStudioService } from "./services/micro-saas-studio.js";
import { NorthlineAutonomyService } from "./services/northline-autonomy.js";
import { NorthlineProspectCollectorService } from "./services/northline-prospect-collector.js";
import { NorthlineProspectSourcingService } from "./services/northline-prospect-sourcing.js";
import { PodStudioService } from "./services/pod-studio.js";
import { ControlRoomServer } from "./services/control-room-server.js";
import { ControlRoomLocalServer } from "./services/control-room-local-server.js";
import { ControlRoomSnapshotService } from "./services/control-room-snapshot.js";
import { normalizeControlRoomSnapshot } from "./services/control-room-snapshot-compat.js";
import { OfficeDashboardService } from "./services/office-dashboard.js";
import { OfficeChatService } from "./services/office-chat.js";
import { officeTemplateProfileForCategory } from "./services/office-templates.js";
import { buildAgencySite } from "./services/agency-site.js";
import { buildStorefrontSite } from "./services/storefront-site.js";
import { StoreOpsService } from "./services/store-ops.js";
import { VentureStudioService } from "./services/venture-studio.js";
import { NorthlineProfileAdminService } from "./services/northline-profile-admin.js";
import { NorthlineOpsService } from "./services/northline-ops.js";
import {
  northlineLeadMatchesServiceArea,
  resolveNorthlineBusinessProfile
} from "./services/northline-business-profile.js";
import { NorthlineSiteServer } from "./services/northline-site-server.js";
import { NorthlineValidationService } from "./services/northline-validation.js";
import { NorthlineDepartmentSmokeService } from "./services/northline-department-smoke.js";
import { processLeadReply } from "./services/lead-replies.js";
import { createClientFromBrief } from "./index.js";
import { hashControlRoomPassword, verifyControlRoomPassword } from "./lib/control-room-auth.js";
import { exists, readJsonFile, readTextFile, writeJsonFile } from "./lib/fs.js";

async function setupWorkspace(options?: {
  prospectCollectorFetch?: typeof fetch;
  prospectCollectorAi?: AIClient;
  profileAdminFetch?: typeof fetch;
  outboundSender?: (
    lead: LeadRecord,
    draft: OutreachDraft
  ) => Promise<{
    receipts: OutreachSendReceipt[];
    sentReceipt?: OutreachSendReceipt;
  }>;
  inboxSync?: (
    candidates: Array<{
      leadId: string;
      recipient: string;
      subject: string;
      sentAt: string;
    }>
  ) => Promise<
    Array<{
      leadId: string;
      status: "reply_found" | "no_reply" | "error";
      recipient?: string;
      subject?: string;
      externalThreadId?: string;
      externalMessageId?: string;
      fromAddress?: string;
      body?: string;
      receivedAt?: string;
      reason?: string;
    }>
  >;
  deployer?: (client: ClientJob, store: FileStore) => Promise<string>;
}) {
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
  const storeAutopilot = new StoreAutopilotAgent(config, store, digitalAssetFactory, imonEngine);
  const storeOps = new StoreOpsService(config, store);
  const ventureStudio = new VentureStudioService(config, store);
  const clipbaitersStudio = new ClipBaitersStudioService(config, store);
  const clipbaitersCollector = new ClipBaitersCollectorService(config, store);
  const clipbaitersDeals = new ClipBaitersDealsService(config, store);
  const clipbaitersSkimmer = new ClipBaitersSkimmerService(config, store);
  const clipbaitersRadar = new ClipBaitersRadarService(config, store);
  const clipbaitersAutonomy = new ClipBaitersAutonomyService(config, store);
  const clipbaitersPublisher = new ClipBaitersPublisherService(config, store, orchestrator);
  const clipbaitersIntake = new ClipBaitersIntakeService(config, store);
  const clipbaitersMonetization = new ClipBaitersMonetizationService(config, store, orchestrator);
  const northlineOps = new NorthlineOpsService(config, store);
  const northlineProfileAdmin = new NorthlineProfileAdminService(
    config,
    store,
    options?.profileAdminFetch ?? fetch
  );
  const northlineProspectCollector = new NorthlineProspectCollectorService(
    config,
    store,
    options?.prospectCollectorFetch ?? fetch,
    options?.prospectCollectorAi ?? ai
  );
  const northlineProspectSourcing = new NorthlineProspectSourcingService(config, store, orchestrator);
  const defaultOutboundSender =
    options?.outboundSender ??
    (async (lead: LeadRecord) => {
      const attemptedAt = new Date().toISOString();
      const receipt: OutreachSendReceipt = lead.contact.email
        ? {
            status: "sent",
            channel: "gmail_cdp",
            recipient: lead.contact.email,
            attemptedAt,
            sentAt: attemptedAt
          }
        : {
            status: "failed",
            channel: "gmail_cdp",
            recipient: "missing-email",
            attemptedAt,
            error: `${lead.businessName} does not have an email address for automated outreach.`
          };

      return receipt.status === "sent"
        ? {
            receipts: [receipt],
            sentReceipt: receipt
          }
        : {
            receipts: [receipt]
          };
    });
  const northlineAutonomy = new NorthlineAutonomyService(
    config,
    store,
    northlineOps,
    northlineProspectCollector,
    northlineProspectSourcing,
    orchestrator,
    replyHandler,
    siteBuilder,
    qaReviewer,
    {
      outboundSender: async (lead, draft) => defaultOutboundSender(lead, draft),
      inboxSync: options?.inboxSync,
      deployer: options?.deployer
        ? {
            deploy: (client) => options.deployer!(client, store)
          }
        : undefined
    }
  );
  const northlineValidation = new NorthlineValidationService(config, store, northlineAutonomy);
  const microSaasStudio = new MicroSaasStudioService(config, store);
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
    storeAutopilot,
    storeOps,
    ventureStudio,
    clipbaitersStudio,
    clipbaitersCollector,
    clipbaitersDeals,
    clipbaitersSkimmer,
    clipbaitersRadar,
    clipbaitersAutonomy,
    clipbaitersPublisher,
    clipbaitersIntake,
    clipbaitersMonetization,
    northlineOps,
    northlineProfileAdmin,
    northlineProspectCollector,
    northlineProspectSourcing,
    northlineAutonomy,
    northlineValidation,
    microSaasStudio,
    podStudio,
    officeDashboard
  };
}

function legacySnapshotFrom(liveSnapshot: any): any {
  return {
    ...liveSnapshot,
    officeTree: undefined,
    departmentWorkspaces: undefined,
    departmentExecutionItems: undefined,
    executiveView: {
      id: liveSnapshot.executiveView.id,
      engineId: liveSnapshot.executiveView.engineId,
      generatedAt: liveSnapshot.executiveView.generatedAt,
      title: liveSnapshot.executiveView.title,
      summary: liveSnapshot.executiveView.summary,
      businesses: liveSnapshot.executiveView.businesses,
      alerts: liveSnapshot.executiveView.alerts,
      approvalsWaiting: liveSnapshot.executiveView.approvalsWaiting
    },
    businesses: liveSnapshot.businesses.map((business: any) => ({
      ...business,
      templateProfile: undefined,
      departmentWorkspaces: undefined,
      office: business.office
        ? {
            id: business.office.id,
            engineId: business.office.engineId,
            businessId: business.office.businessId,
            generatedAt: business.office.generatedAt,
            title: business.office.title,
            summary: business.office.summary,
            departments: business.office.departments,
            alerts: business.office.alerts
          }
        : undefined
    }))
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
  assert.ok(saved.every((lead) => lead.pipeline === "agency_client_acquisition"));
  assert.ok(saved.some((lead) => lead.stage === "qualified"));
  assert.ok(saved.some((lead) => lead.stage === "discarded" || lead.stage === "prospecting"));
});

test("qualifier derives stage from score even when the model returns an inconsistent stage", async () => {
  const ai = {
    generateJson: async () => ({
      data: {
        score: 75,
        scoreReasons: ["High-fit target with public email."],
        stage: "prospecting"
      },
      source: "openai" as const
    })
  } as unknown as AIClient;
  const qualifier = new QualifierAgent(ai);
  const lead: LeadRecord = {
    id: "stage-normalization-lead",
    businessId: "auto-funding-agency",
    businessName: "Stage Normalization HVAC",
    niche: "home services",
    geo: "Queens, NY",
    source: "northline-feed:test.json",
    contact: {
      ownerName: "Alex",
      email: "alex@example.com",
      phone: "(555) 555-0101",
      website: "https://example.com"
    },
    websiteQualitySignals: {
      hasWebsite: true,
      hasHttps: true,
      mobileFriendly: false,
      clearOffer: false,
      callsToAction: false,
      pageSpeedBucket: "slow",
      notes: []
    },
    targetContext: {
      market: "New York, NY",
      trade: "hvac",
      collectionArea: "New York, NY",
      sourceType: "auto-osm",
      targetIndustries: ["HVAC"],
      targetServices: ["Hosted intake and missed-call recovery"],
      offerSummary: "Northline helps HVAC operators tighten the close path.",
      matchReasons: ["Public email available."]
    },
    score: 0,
    scoreReasons: [],
    stage: "prospecting",
    tags: ["hvac"],
    createdAt: "2026-04-07T00:00:00.000Z",
    updatedAt: "2026-04-07T00:00:00.000Z"
  };

  const scored = await qualifier.scoreLead(lead);

  assert.equal(scored.score, 75);
  assert.equal(scored.stage, "qualified");
});

test("ai config preserves legacy OpenAI fallbacks and route overrides during the NVIDIA migration", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-route-map-legacy-"));
  const touchedKeys = [
    "AI_PROVIDER_NVIDIA_API_KEY",
    "NVIDIA_API_KEY",
    "AI_PROVIDER_OPENAI_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_MODEL_FAST",
    "OPENAI_MODEL_DEEP"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  try {
    delete process.env.AI_PROVIDER_NVIDIA_API_KEY;
    process.env.NVIDIA_API_KEY = "nvidia-preview-key";
    delete process.env.AI_PROVIDER_OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "legacy-openai-key";
    process.env.OPENAI_MODEL_FAST = "legacy-fast";
    process.env.OPENAI_MODEL_DEEP = "legacy-deep";

    const config = await loadConfig(root);
    const ai = new AIClient(config);
    const assetBlueprintRoute = ai.describeRoute({
      businessId: "imon-digital-asset-store",
      capability: "asset-blueprint",
      mode: "fast"
    });
    const inheritedClipbaitersRoute = ai.describeRoute({
      businessId: "clipbaiters-viral-moments",
      capability: "office-chat",
      mode: "fast"
    });

    assert.equal(config.ai.providers.openai.apiKey, "legacy-openai-key");
    assert.equal(config.ai.providers.nvidia.apiKey, "nvidia-preview-key");
    assert.equal(config.ai.providers.nvidia.baseUrl, "https://integrate.api.nvidia.com/v1");
    assert.equal(config.ai.routeModelOverrides.fast, "legacy-fast");
    assert.equal(config.ai.routeModelOverrides.deep, "legacy-deep");
    assert.ok(assetBlueprintRoute);
    assert.equal(assetBlueprintRoute.routeId, "imon-digital-asset-store.asset-blueprint");
    assert.equal(assetBlueprintRoute.sharedRouteId, "deep");
    assert.equal(assetBlueprintRoute.provider, "nvidia");
    assert.equal(assetBlueprintRoute.providerLabel, "NVIDIA API Catalog");
    assert.equal(assetBlueprintRoute.model, "legacy-deep");
    assert.equal(assetBlueprintRoute.available, true);
    assert.ok(inheritedClipbaitersRoute);
    assert.equal(inheritedClipbaitersRoute.routeId, "clipbaiters-viral-moments.office-chat");
    assert.equal(inheritedClipbaitersRoute.sharedRouteId, "fast");
    assert.equal(inheritedClipbaitersRoute.provider, "nvidia");
    assert.equal(inheritedClipbaitersRoute.model, "legacy-fast");
  } finally {
    for (const key of touchedKeys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
});

test("loadConfig derives a control-room password hash from host password fallback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "control-room-fallback-auth-"));
  const touchedKeys = [
    "CONTROL_ROOM_PASSWORD_HASH",
    "IMON_ENGINE_HOST_PASSWORD",
    "IMON_ENGINE_VPS_PASSWORD"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  try {
    delete process.env.CONTROL_ROOM_PASSWORD_HASH;
    process.env.IMON_ENGINE_HOST_PASSWORD = "fallback-control-room-pass";
    delete process.env.IMON_ENGINE_VPS_PASSWORD;

    const config = await loadConfig(root);

    assert.ok(config.controlRoom.passwordHash);
    assert.equal(
      await verifyControlRoomPassword(
        "fallback-control-room-pass",
        config.controlRoom.passwordHash ?? ""
      ),
      true
    );
  } finally {
    for (const key of touchedKeys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
});

test("draftOutreach picks high-score prospecting leads with email and skips no-email leads", async () => {
  const { store, orchestrator } = await setupWorkspace();
  const withEmail: LeadRecord = {
    id: "high-score-prospecting-email",
    businessId: "auto-funding-agency",
    businessName: "Email Ready Plumbing",
    niche: "home services",
    geo: "Brooklyn, NY",
    source: "northline-feed:test.json",
    contact: {
      ownerName: "Casey",
      email: "casey@example.com",
      phone: "(555) 555-0102",
      website: "https://email-ready.example.com"
    },
    websiteQualitySignals: {
      hasWebsite: true,
      hasHttps: false,
      mobileFriendly: false,
      clearOffer: false,
      callsToAction: false,
      pageSpeedBucket: "slow",
      notes: []
    },
    targetContext: {
      market: "New York, NY",
      trade: "plumbing",
      collectionArea: "New York, NY",
      sourceType: "auto-osm",
      targetIndustries: ["Plumbing"],
      targetServices: ["Proof page rebuild"],
      offerSummary: "Northline helps plumbing operators tighten the close path.",
      matchReasons: ["Public email available."]
    },
    score: 78,
    scoreReasons: ["Strong target fit."],
    stage: "prospecting",
    tags: ["plumbing"],
    createdAt: "2026-04-07T00:00:00.000Z",
    updatedAt: "2026-04-07T00:00:00.000Z"
  };
  const withoutEmail: LeadRecord = {
    ...withEmail,
    id: "high-score-prospecting-no-email",
    businessName: "Phone Only Roofing",
    contact: {
      ownerName: "Jordan",
      phone: "(555) 555-0103",
      website: "https://phone-only.example.com"
    },
    score: 85,
    tags: ["roofing"]
  };

  await store.saveLead(withEmail);
  await store.saveLead(withoutEmail);

  const drafted = await orchestrator.draftOutreach(10, { businessId: "auto-funding-agency" });
  const drafts = await store.getOutreachDrafts();
  const updatedWithEmail = await store.getLead(withEmail.id);
  const updatedWithoutEmail = await store.getLead(withoutEmail.id);

  assert.equal(drafted, 1);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.leadId, withEmail.id);
  assert.equal(updatedWithEmail?.stage, "drafted");
  assert.equal(updatedWithoutEmail?.stage, "prospecting");
});

test("draftOutreach ignores leads outside the business service area", async () => {
  const { store, orchestrator, imonEngine } = await setupWorkspace();
  await imonEngine.bootstrap();
  const baseBusiness = await store.getManagedBusiness("auto-funding-agency");
  const now = "2026-04-07T00:00:00.000Z";

  assert.ok(baseBusiness);

  await store.saveManagedBusiness({
    ...baseBusiness,
    id: "hudson-cleaning",
    name: "Hudson Cleaning",
    northlineProfile: {
      ...(baseBusiness.northlineProfile ?? {}),
      collectionAreas: ["New York"],
      collectionTrades: ["cleaning"],
      targetIndustries: ["Cleaning"],
      targetServices: ["Follow-up and trust loop"],
      agencyProfile: {
        ...(baseBusiness.northlineProfile?.agencyProfile ?? DEFAULT_AGENCY_PROFILE),
        name: "Hudson Cleaning",
        industries: ["Cleaning"]
      }
    },
    createdAt: now,
    updatedAt: now
  });

  const localTargetContext: LeadRecord["targetContext"] = {
    market: "Albany, NY",
    trade: "cleaning",
    collectionArea: "Albany, NY",
    sourceType: "auto-osm",
    targetIndustries: ["Cleaning"],
    targetServices: ["Follow-up and trust loop"],
    offerSummary: "Northline helps cleaning operators tighten the close path.",
    matchReasons: ["Public email available."]
  };

  const localLead: LeadRecord = {
    id: "albany-clean-team",
    businessId: "hudson-cleaning",
    businessName: "Albany Clean Team",
    niche: "home services",
    geo: "Albany, NY",
    source: "northline-feed:test.json",
    contact: {
      ownerName: "Morgan",
      email: "morgan@albanyclean.example.com",
      phone: "(555) 555-0110",
      website: "https://albanyclean.example.com"
    },
    websiteQualitySignals: {
      hasWebsite: true,
      hasHttps: true,
      mobileFriendly: false,
      clearOffer: false,
      callsToAction: false,
      pageSpeedBucket: "slow",
      notes: []
    },
    targetContext: localTargetContext,
    score: 79,
    scoreReasons: ["Strong local target fit."],
    stage: "prospecting",
    tags: ["cleaning"],
    createdAt: now,
    updatedAt: now
  };
  const remoteLead: LeadRecord = {
    ...localLead,
    id: "la-clean-team",
    businessName: "LA Clean Team",
    geo: "Los Angeles, CA",
    contact: {
      ownerName: "Riley",
      email: "riley@laclean.example.com",
      phone: "(555) 555-0111",
      website: "https://laclean.example.com"
    },
    targetContext: {
      ...localTargetContext,
      market: "Los Angeles, CA",
      collectionArea: "Los Angeles, CA"
    }
  };

  await store.saveLead(localLead);
  await store.saveLead(remoteLead);

  const drafted = await orchestrator.draftOutreach(10, { businessId: "hudson-cleaning" });
  const drafts = await store.getOutreachDrafts();

  assert.equal(drafted, 1);
  assert.ok(drafts.some((draft) => draft.leadId === localLead.id));
  assert.ok(!drafts.some((draft) => draft.leadId === remoteLead.id));
});

test("draftOutreach ignores Northline client-demand leads", async () => {
  const { store, orchestrator } = await setupWorkspace();
  const now = "2026-04-07T00:00:00.000Z";

  const acquisitionLead: LeadRecord = {
    id: "qualified-plumber-acquisition",
    businessId: "auto-funding-agency",
    pipeline: "agency_client_acquisition",
    businessName: "Qualified Plumber Acquisition",
    niche: "home services",
    geo: "Akron, OH",
    source: "northline-feed:test.json",
    contact: {
      ownerName: "Casey",
      email: "casey@qualifiedplumber.com",
      phone: "(555) 555-0102",
      website: "https://qualifiedplumber.example.com"
    },
    websiteQualitySignals: {
      hasWebsite: true,
      hasHttps: true,
      mobileFriendly: false,
      clearOffer: false,
      callsToAction: false,
      pageSpeedBucket: "slow",
      notes: []
    },
    targetContext: {
      market: "Akron, OH",
      trade: "plumbing",
      collectionArea: "Akron, OH",
      sourceType: "auto-osm",
      targetIndustries: ["Plumbing"],
      targetServices: ["Proof page rebuild"],
      offerSummary: "Northline helps plumbing operators tighten the close path.",
      matchReasons: ["Public email available."]
    },
    score: 78,
    scoreReasons: ["Strong target fit."],
    stage: "qualified",
    tags: ["plumbing"],
    createdAt: now,
    updatedAt: now
  };
  const clientDemandLead: LeadRecord = {
    ...acquisitionLead,
    id: "qualified-plumber-client-demand",
    pipeline: "client_demand_generation",
    businessName: "Qualified Plumber Client Demand",
    source: "client-demand-feed:test.json"
  };

  await store.saveLead(acquisitionLead);
  await store.saveLead(clientDemandLead);

  const drafted = await orchestrator.draftOutreach(10, { businessId: "auto-funding-agency" });
  const drafts = await store.getOutreachDrafts();

  assert.equal(drafted, 1);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.leadId, acquisitionLead.id);
  assert.ok(!drafts.some((draft) => draft.leadId === clientDemandLead.id));
});

test("northline prospect sourcing processes changed feed files once and skips unchanged reruns", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "northline-source-"));
  const sourceDir = path.join(root, "sources");
  const touchedKeys = ["NORTHLINE_PROSPECT_SOURCE_DIR"] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  try {
    process.env.NORTHLINE_PROSPECT_SOURCE_DIR = sourceDir;
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      path.join(sourceDir, "batch-a.csv"),
      [
        "businessName,niche,city,state,ownerName,email,phone,website,hasWebsite,hasHttps,mobileFriendly,clearOffer,callsToAction,pageSpeedBucket,notes,tags",
        "Signal Plumbing,home services,Akron,OH,Chris,chris@signalplumbing.com,(330) 555-0101,http://signalplumbing.com,true,false,false,false,false,slow,Old site,priority",
        "Lakefront HVAC,home services,Cleveland,OH,Maya,maya@lakefronthvac.com,(216) 555-0110,https://lakefronthvac.com,true,true,false,false,false,average,Weak CTA,hvac"
      ].join("\n"),
      "utf8"
    );

    const { northlineProspectSourcing, store, config } = await setupWorkspace();
    const first = await northlineProspectSourcing.run();
    const second = await northlineProspectSourcing.run();
    const leads = await store.getLeads();
    const summary = await readJsonFile<{ processedLeads: number; processedFiles: number }>(
      path.join(config.opsDir, "northline-growth-system", "prospect-sourcing-summary.json"),
      { processedLeads: 0, processedFiles: 0 }
    );

    assert.equal(first.processedFiles, 1);
    assert.equal(first.processedLeads, 2);
    assert.equal(second.processedFiles, 0);
    assert.equal(second.skippedFiles, 1);
    assert.equal(leads.length, 2);
    assert.equal(summary.processedLeads, 0);
    assert.equal(summary.processedFiles, 0);
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("northline prospect collector writes deterministic OSM source feeds", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "northline-collect-"));
  const sourceDir = path.join(root, "sources");
  const touchedKeys = [
    "NORTHLINE_PROSPECT_SOURCE_DIR",
    "NORTHLINE_PROSPECT_COLLECTION_AREAS",
    "NORTHLINE_PROSPECT_COLLECTION_TRADES",
    "NORTHLINE_PROSPECT_COLLECTION_INTERVAL_HOURS",
    "NORTHLINE_PROSPECT_COLLECTION_MAX_RECORDS_PER_TRADE"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));
  const requests: string[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
    requests.push(url);

    if (url.startsWith("https://nominatim.openstreetmap.org/search")) {
      return new Response(
        JSON.stringify([
          {
            display_name: "Akron, Summit County, Ohio, United States",
            boundingbox: ["41.0200", "41.1200", "-81.6200", "-81.4200"],
            address: {
              city: "Akron",
              state: "Ohio",
              state_code: "OH"
            }
          }
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url === "https://overpass-api.de/api/interpreter") {
      return new Response("gateway timeout", {
        status: 504,
        statusText: "Gateway Timeout"
      });
    }

    if (url === "https://lz4.overpass-api.de/api/interpreter") {
      return new Response(
        JSON.stringify({
          elements: [
            {
              type: "node",
              id: 101,
              tags: {
                name: "Summit Ridge Plumbing",
                craft: "plumber",
                "addr:city": "Akron",
                "addr:state": "OH",
                "contact:phone": "(330) 555-0180",
                website: "http://summitridgeplumbing.com"
              }
            },
            {
              type: "node",
              id: 102,
              tags: {
                name: "Lake Effect HVAC",
                craft: "hvac",
                "addr:city": "Akron",
                "addr:state": "OH",
                email: "dispatch@lakeeffecthvac.com",
                website: "https://lakeeffecthvac.com"
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    throw new Error(`Unexpected collector request: ${url}`);
  };

  try {
    process.env.NORTHLINE_PROSPECT_SOURCE_DIR = sourceDir;
    process.env.NORTHLINE_PROSPECT_COLLECTION_AREAS = "Akron, OH";
    process.env.NORTHLINE_PROSPECT_COLLECTION_TRADES = "plumbing;hvac";
    process.env.NORTHLINE_PROSPECT_COLLECTION_INTERVAL_HOURS = "24";
    process.env.NORTHLINE_PROSPECT_COLLECTION_MAX_RECORDS_PER_TRADE = "5";

    const { northlineProspectCollector, config } = await setupWorkspace({
      prospectCollectorFetch: mockFetch
    });
    const result = await northlineProspectCollector.run({ force: true });
    const feed = await readJsonFile<{
      market: string;
      records: Array<{ businessName: string; city: string; state: string; tags: string }>;
    }>(path.join(sourceDir, "auto-osm-akron-oh.json"), {
      market: "",
      records: []
    });
    const summary = await readJsonFile<{ collectedRecords: number; writtenFiles: number }>(
      path.join(config.opsDir, "northline-growth-system", "prospect-collection-summary.json"),
      { collectedRecords: 0, writtenFiles: 0 }
    );

    assert.equal(result.status, "success");
    assert.equal(result.writtenFiles, 1);
    assert.equal(result.collectedRecords, 2);
    assert.equal(feed.market, "Akron, OH");
    assert.equal(feed.records.length, 2);
    assert.ok(feed.records.some((record) => record.businessName === "Summit Ridge Plumbing"));
    assert.ok(feed.records.some((record) => record.businessName === "Lake Effect HVAC"));
    assert.equal(summary.collectedRecords, 2);
    assert.equal(summary.writtenFiles, 1);
    assert.equal(requests.length, 3);
    assert.ok(requests.includes("https://overpass-api.de/api/interpreter"));
    assert.ok(requests.includes("https://lz4.overpass-api.de/api/interpreter"));
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("northline prospect collector supplements free-source feeds with public web-search leads", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "northline-collect-web-search-"));
  const sourceDir = path.join(root, "sources");
  const touchedKeys = [
    "NORTHLINE_PROSPECT_SOURCE_DIR",
    "NORTHLINE_PROSPECT_COLLECTION_AREAS",
    "NORTHLINE_PROSPECT_COLLECTION_TRADES",
    "NORTHLINE_PROSPECT_COLLECTION_INTERVAL_HOURS",
    "NORTHLINE_PROSPECT_COLLECTION_MAX_RECORDS_PER_TRADE"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));
  const mockFetch: typeof fetch = async (input) => {
    const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;

    if (url.startsWith("https://nominatim.openstreetmap.org/search")) {
      return new Response(
        JSON.stringify([
          {
            display_name: "Akron, Summit County, Ohio, United States",
            boundingbox: ["41.0200", "41.1200", "-81.6200", "-81.4200"],
            address: {
              city: "Akron",
              state: "Ohio",
              state_code: "OH"
            }
          }
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url === "https://overpass-api.de/api/interpreter") {
      return new Response(
        JSON.stringify({
          elements: [
            {
              type: "node",
              id: 201,
              tags: {
                name: "Summit Ridge Plumbing",
                craft: "plumber",
                "addr:city": "Akron",
                "addr:state": "OH",
                "contact:phone": "(330) 555-0180",
                website: "http://summitridgeplumbing.com"
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    throw new Error(`Unexpected collector request: ${url}`);
  };
  const prospectCollectorAi = {
    get enabled() {
      return true;
    },
    describeRoute: () => ({
      provider: "openai" as const,
      model: "gpt-5",
      description: "Research route",
      routeId: "auto-funding-agency.prospect-research",
      sharedRouteId: "research" as const,
      businessId: "auto-funding-agency",
      capabilityId: "prospect-research",
      status: "active" as const,
      providerLabel: "OpenAI",
      available: true
    }),
    researchText: async () => ({
      text: JSON.stringify({
        records: [
          {
            businessName: "Rapid Response Plumbing",
            trade: "plumbing",
            city: "Akron",
            state: "OH",
            email: "hello@rapidresponseplumbing.com",
            website: "https://rapidresponseplumbing.com",
            sourceType: "official_site",
            sourceUrl: "https://rapidresponseplumbing.com",
            matchReason: "Recent emergency plumbing pages and public contact details are live.",
            notes: "Public site appears active and service-specific."
          }
        ]
      }),
      source: "openai" as const
    })
  } as unknown as AIClient;

  try {
    process.env.NORTHLINE_PROSPECT_SOURCE_DIR = sourceDir;
    process.env.NORTHLINE_PROSPECT_COLLECTION_AREAS = "Akron, OH";
    process.env.NORTHLINE_PROSPECT_COLLECTION_TRADES = "plumbing";
    process.env.NORTHLINE_PROSPECT_COLLECTION_INTERVAL_HOURS = "24";
    process.env.NORTHLINE_PROSPECT_COLLECTION_MAX_RECORDS_PER_TRADE = "5";

    const { northlineProspectCollector, config } = await setupWorkspace({
      prospectCollectorFetch: mockFetch,
      prospectCollectorAi
    });
    const result = await northlineProspectCollector.run({ force: true });
    const feed = await readJsonFile<{
      records: Array<{ businessName: string; sourceType?: string; notes?: string; tags?: string }>;
    }>(path.join(sourceDir, "auto-osm-akron-oh.json"), {
      records: []
    });
    const summary = await readJsonFile<{ attribution?: string }>(
      path.join(config.opsDir, "northline-growth-system", "prospect-collection-summary.json"),
      {}
    );

    assert.equal(result.status, "success");
    assert.equal(result.collectedRecords, 2);
    assert.ok(feed.records.some((record) => record.businessName === "Summit Ridge Plumbing"));
    const webRecord = feed.records.find((record) => record.businessName === "Rapid Response Plumbing");
    assert.equal(webRecord?.sourceType, "northline-web-search:official-site");
    assert.match(webRecord?.notes ?? "", /Source URL: https:\/\/rapidresponseplumbing\.com/);
    assert.match(webRecord?.tags ?? "", /web-search/);
    assert.match(summary.attribution ?? "", /web search/i);
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("northline prospect collector falls back cleanly when public web research stalls", async () => {
  const mockFetch: typeof fetch = async (input) => {
    const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;

    if (url.startsWith("https://nominatim.openstreetmap.org/search")) {
      return new Response(
        JSON.stringify([
          {
            display_name: "Akron, Summit County, Ohio, United States",
            boundingbox: ["41.0200", "41.1200", "-81.6200", "-81.4200"],
            address: {
              city: "Akron",
              state: "Ohio",
              state_code: "OH"
            }
          }
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url === "https://overpass-api.de/api/interpreter") {
      return new Response(
        JSON.stringify({
          elements: [
            {
              type: "node",
              id: 401,
              tags: {
                name: "Summit Ridge Plumbing",
                craft: "plumber",
                "addr:city": "Akron",
                "addr:state": "OH",
                email: "dispatch@summitridgeplumbing.com",
                phone: "(330) 555-0110",
                website: "https://summitridgeplumbing.com"
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    throw new Error(`Unexpected collector timeout test request: ${url}`);
  };

  const stalledAi = {
    get enabled() {
      return true;
    },
    describeRoute: () => ({
      provider: "openai" as const,
      model: "gpt-5",
      description: "Research route",
      routeId: "auto-funding-agency.prospect-research",
      sharedRouteId: "research" as const,
      businessId: "auto-funding-agency",
      capabilityId: "prospect-research",
      status: "active" as const,
      providerLabel: "OpenAI",
      available: true
    }),
    researchText: async () =>
      new Promise<{ text: string; source: "openai" | "fallback" }>(() => undefined)
  } as unknown as AIClient;

  const { config, store, imonEngine } = await setupWorkspace();
  await imonEngine.bootstrap();
  const business = await store.getManagedBusiness("auto-funding-agency");
  assert.ok(business);

  const now = new Date().toISOString();
  await store.saveManagedBusiness({
    ...business,
    northlineProfile: {
      ...business.northlineProfile,
      collectionAreas: ["Akron, OH"],
      collectionTrades: ["plumbing"]
    },
    updatedAt: now
  });

  const collector = new NorthlineProspectCollectorService(config, store, mockFetch, stalledAi, {
    requestMs: 100,
    webResearchMs: 5
  });
  const result = await collector.run({ force: true });
  const feed = await readJsonFile<{
    records: Array<{ businessName: string; sourceType?: string }>;
  }>(path.join(config.northlineProspecting.sourceDir, "auto-osm-akron-oh.json"), {
    records: []
  });

  assert.equal(result.status, "success");
  assert.equal(result.writtenFiles, 1);
  assert.equal(result.collectedRecords, 1);
  assert.equal(feed.records.length, 1);
  assert.equal(feed.records[0]?.businessName, "Summit Ridge Plumbing");
  assert.equal(feed.records[0]?.sourceType, "northline-osm-overpass");
});

test("northline uses the selected business profile for planning, collection, sourcing, and outreach", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "northline-custom-business-"));
  const sourceDir = path.join(root, "sources");
  const customBusinessId = "roofline-growth-systems";
  const touchedKeys = [
    "NORTHLINE_PROSPECT_SOURCE_DIR",
    "AI_PROVIDER_OPENAI_API_KEY",
    "OPENAI_API_KEY"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));
  const mockFetch: typeof fetch = async (input) => {
    const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;

    if (url.startsWith("https://nominatim.openstreetmap.org/search")) {
      return new Response(
        JSON.stringify([
          {
            display_name: "Cleveland, Cuyahoga County, Ohio, United States",
            boundingbox: ["41.3900", "41.5600", "-81.8500", "-81.5300"],
            address: {
              city: "Cleveland",
              state: "Ohio",
              state_code: "OH"
            }
          }
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url === "https://overpass-api.de/api/interpreter") {
      return new Response(
        JSON.stringify({
          elements: [
            {
              type: "node",
              id: 301,
              tags: {
                name: "Storm Shield Roofing",
                craft: "roofer",
                "addr:city": "Cleveland",
                "addr:state": "OH",
                email: "hello@stormshieldroofing.com",
                phone: "(216) 555-0107",
                website: "http://stormshieldroofing.com"
              }
            },
            {
              type: "node",
              id: 302,
              tags: {
                name: "Lakefront Plumbing",
                craft: "plumber",
                "addr:city": "Cleveland",
                "addr:state": "OH",
                email: "dispatch@lakefrontplumbing.com",
                phone: "(216) 555-0108",
                website: "https://lakefrontplumbing.com"
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    throw new Error(`Unexpected custom-business collector request: ${url}`);
  };

  try {
    process.env.NORTHLINE_PROSPECT_SOURCE_DIR = sourceDir;
    delete process.env.AI_PROVIDER_OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const { imonEngine, northlineOps, northlineProspectCollector, northlineProspectSourcing, orchestrator, store, config } =
      await setupWorkspace({ prospectCollectorFetch: mockFetch });
    await imonEngine.bootstrap();
    const baseBusiness = await store.getManagedBusiness("auto-funding-agency");
    assert.ok(baseBusiness);

    const now = new Date().toISOString();
    await store.saveManagedBusiness({
      ...baseBusiness,
      id: customBusinessId,
      name: "Roofline Growth Systems",
      orgBlueprintId: `org-business-${customBusinessId}`,
      stage: "ready",
      northlineProfile: {
        ...baseBusiness.northlineProfile,
        primaryServiceArea: "Cleveland, OH",
        collectionAreas: ["Cleveland, OH"],
        collectionTrades: ["roofing"],
        targetIndustries: ["Roofing"],
        targetServices: ["Storm repair landing pages", "Emergency intake routing"],
        offerSummary: "storm-response landing pages and intake routing for roofing operators",
        salesEmail: "hello@rooflinegrowth.com",
        siteUrl: "https://rooflinegrowth.com",
        domain: "rooflinegrowth.com",
        agencyProfile: {
          ...(baseBusiness.northlineProfile?.agencyProfile ?? DEFAULT_AGENCY_PROFILE),
          name: "Roofline Growth Systems",
          headline: "Roofline builds storm-response pages and intake flows for roofing contractors.",
          audience: "Built for roofing contractors dealing with storm-response demand and weak intake routing.",
          industries: ["Roofing"]
        }
      },
      createdAt: now,
      updatedAt: now
    });

    const planResult = await northlineOps.writePlan({ businessId: customBusinessId });
    assert.deepEqual(planResult.plan.collectionAreas, ["Cleveland, OH"]);
    assert.deepEqual(planResult.plan.collectionTrades, ["roofing"]);
    assert.deepEqual(planResult.plan.targetIndustries, ["Roofing"]);
    assert.ok(planResult.artifacts.planJsonPath.endsWith(`/northline-growth-system/${customBusinessId}/plan.json`));

    const collectionResult = await northlineProspectCollector.run({
      businessId: customBusinessId,
      force: true
    });
    const feed = await readJsonFile<{
      businessId: string;
      targetIndustries: string[];
      records: Array<{ businessName: string; trade?: string; targetIndustries?: string; offerSummary?: string }>;
    }>(path.join(sourceDir, customBusinessId, "auto-osm-cleveland-oh.json"), {
      businessId: "",
      targetIndustries: [],
      records: []
    });

    assert.equal(collectionResult.writtenFiles, 1);
    assert.equal(collectionResult.collectedRecords, 1);
    assert.equal(collectionResult.artifacts.statePath, path.join(config.stateDir, "northline", customBusinessId, "northlineProspectCollection.json"));
    assert.equal(collectionResult.artifacts.summaryJsonPath, path.join(config.opsDir, "northline-growth-system", customBusinessId, "prospect-collection-summary.json"));
    assert.equal(feed.businessId, customBusinessId);
    assert.deepEqual(feed.targetIndustries, ["Roofing"]);
    assert.equal(feed.records.length, 1);
    assert.equal(feed.records[0]?.businessName, "Storm Shield Roofing");
    assert.equal(feed.records[0]?.trade, "roofing");

    const sourcingResult = await northlineProspectSourcing.run({ businessId: customBusinessId });
    const lead = (await store.getLeads()).find((candidate) => candidate.id === "storm-shield-roofing");
    assert.equal(sourcingResult.processedLeads, 1);
    assert.equal(sourcingResult.artifacts.statePath, path.join(config.stateDir, "northline", customBusinessId, "northlineProspectSourcing.json"));
    assert.ok(lead);
    assert.equal(lead?.businessId, customBusinessId);
    assert.equal(lead?.targetContext?.trade, "roofing");
    assert.deepEqual(lead?.targetContext?.targetIndustries, ["Roofing"]);
    assert.ok(lead?.scoreReasons.some((reason) => reason.includes("Roofing")));

    const draftedCount = await orchestrator.draftOutreach(5, { businessId: customBusinessId });
    const draft = (await store.getOutreachDrafts()).find((candidate) => candidate.leadId === "storm-shield-roofing");
    assert.equal(draftedCount, 1);
    assert.ok(draft);
    assert.ok(draft?.body.includes("storm-response landing pages and intake routing for roofing operators"));
    assert.ok(draft?.body.includes("Roofline Growth Systems"));
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("northline profile admin updates payment links and payment readiness for a managed business", async () => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "northline-profile-admin-"));
  const profilePath = path.join(profileDir, "roofline-profile.json");
  const customBusinessId = "roofline-growth-systems";
  const customProofPoints = [
    {
      stat: "24 hrs",
      label: "Storm callback triage",
      detail: "Roofline routes urgent storm-response leads into one queue with a same-day next-step reply."
    }
  ];
  const customTrustSignals = [
    {
      label: "Storm demand",
      title: "Operators see the next step before they pay.",
      body: "Roofline replies with the diagnosis, pilot fit, and whether to book, approve, or hold for missing info."
    }
  ];
  const customProofArtifacts = [
    {
      label: "Storm sample",
      title: "What Roofline flags in the first review",
      body: "The first review is a short teardown for roofing operators dealing with storm-response demand.",
      items: [
        "Headline does not mention storm-response work",
        "CTA is buried below generic copy",
        "After-hours intake is not routing to the right person"
      ]
    }
  ];
  const customPricing = [
    {
      id: "lead-generation",
      label: "Lead Generation",
      amount: "$399 setup + $149/mo",
      details: "A leaner first paid step for one storm-response path.",
      idealFor: "Roofing operators that need the shortest path into paid cleanup.",
      includes: ["Lead page refresh", "Hosted intake routing"],
      paymentLinkKey: "lead_generation",
      cta: {
        label: "Start with leak review",
        mode: "review",
        href: "./intake.html"
      },
      upgradeOffer: {
        label: "Upgrade to Growth System",
        terms: "Apply the configured storm-response upgrade checkout after fit is confirmed.",
        paymentLinkKey: "growth_upgrade"
      }
    }
  ];
  const paymentRequests: Array<{ method: string; url: string }> = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
    paymentRequests.push({
      method: init?.method ?? "GET",
      url
    });
    return new Response(null, { status: 200 });
  };

  const { imonEngine, northlineOps, northlineProfileAdmin, store, config } = await setupWorkspace({
    profileAdminFetch: mockFetch
  });
  await imonEngine.bootstrap();
  const baseBusiness = await store.getManagedBusiness("auto-funding-agency");
  assert.ok(baseBusiness);

  const now = new Date().toISOString();
  await store.saveManagedBusiness({
    ...baseBusiness,
    id: customBusinessId,
    name: "Roofline Growth Systems",
    orgBlueprintId: `org-business-${customBusinessId}`,
    stage: "ready",
    northlineProfile: {
      ...baseBusiness.northlineProfile
    },
    createdAt: now,
    updatedAt: now
  });

  await writeFile(
    profilePath,
    JSON.stringify(
      {
        northlineProfile: {
          primaryServiceArea: "Cleveland, OH",
          collectionAreas: ["Cleveland, OH"],
          collectionTrades: ["roofing"],
          targetIndustries: ["Roofing"],
          targetServices: ["Storm repair landing pages", "Emergency intake routing"],
          offerSummary: "storm-response landing pages and intake routing for roofing operators",
          salesEmail: "hello@rooflinegrowth.com",
          siteUrl: "https://rooflinegrowth.com",
          domain: "rooflinegrowth.com",
          bookingUrl: "https://rooflinegrowth.com/book",
          leadFormAction: "https://rooflinegrowth.com/api/intake",
          stripeLeadGeneration: "https://buy.stripe.com/test_lead_generation_roofline",
          stripeFounding: "https://buy.stripe.com/test_founding_roofline",
          stripeStandard: "https://buy.stripe.com/test_standard_roofline",
          growthUpgrade: {
            paymentLink: "https://buy.stripe.com/test_growth_upgrade_roofline",
            couponLabel: "Storm response upgrade",
            terms: "Apply within 14 days of the Lead Generation launch."
          },
          agencyProfile: {
            name: "Roofline Growth Systems",
            headline: "Roofline builds storm-response pages and intake flows for roofing contractors.",
            audience: "Built for roofing contractors dealing with storm-response demand and weak intake routing.",
            industries: ["Roofing"],
            proofPoints: customProofPoints,
            trustSignals: customTrustSignals,
            proofArtifacts: customProofArtifacts,
            pricing: customPricing
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const profileResult = await northlineProfileAdmin.updateFromFile({
    businessId: customBusinessId,
    filePath: profilePath,
    probePayments: true
  });
  const updatedBusiness = await store.getManagedBusiness(customBusinessId);
  const planResult = await northlineOps.writePlan({ businessId: customBusinessId });
  const paymentReadiness = planResult.plan.readiness.find((item) => item.id === "payment-collection");

  assert.ok(updatedBusiness?.northlineProfile);
  assert.equal(updatedBusiness?.northlineProfile?.salesEmail, "hello@rooflinegrowth.com");
  assert.equal(
    updatedBusiness?.northlineProfile?.stripeLeadGeneration,
    "https://buy.stripe.com/test_lead_generation_roofline"
  );
  assert.equal(updatedBusiness?.northlineProfile?.stripeFounding, "https://buy.stripe.com/test_founding_roofline");
  assert.equal(updatedBusiness?.northlineProfile?.stripeStandard, "https://buy.stripe.com/test_standard_roofline");
  assert.equal(
    updatedBusiness?.northlineProfile?.growthUpgrade?.paymentLink,
    "https://buy.stripe.com/test_growth_upgrade_roofline"
  );
  assert.equal(updatedBusiness?.northlineProfile?.growthUpgrade?.couponLabel, "Storm response upgrade");
  assert.deepEqual(updatedBusiness?.northlineProfile?.agencyProfile?.proofPoints, customProofPoints);
  assert.deepEqual(updatedBusiness?.northlineProfile?.agencyProfile?.trustSignals, customTrustSignals);
  assert.deepEqual(updatedBusiness?.northlineProfile?.agencyProfile?.proofArtifacts, customProofArtifacts);
  assert.deepEqual(updatedBusiness?.northlineProfile?.agencyProfile?.pricing, customPricing);
  assert.equal(profileResult.paymentReadiness?.status, "ready");
  assert.ok(profileResult.paymentReadiness?.checks.every((check) => check.status === "reachable"));
  assert.deepEqual(
    profileResult.paymentReadiness?.checks.map((check) => check.key),
    ["lead_generation", "founding", "standard", "growth_upgrade"]
  );
  assert.equal(profileResult.resolvedProfile.stripeFounding, "https://buy.stripe.com/test_founding_roofline");
  assert.equal(profileResult.resolvedProfile.stripeStandard, "https://buy.stripe.com/test_standard_roofline");
  assert.equal(
    profileResult.resolvedProfile.stripeLeadGeneration,
    "https://buy.stripe.com/test_lead_generation_roofline"
  );
  assert.equal(
    profileResult.resolvedProfile.growthUpgrade?.paymentLink,
    "https://buy.stripe.com/test_growth_upgrade_roofline"
  );
  assert.deepEqual(profileResult.resolvedProfile.agencyProfile.proofPoints, customProofPoints);
  assert.deepEqual(profileResult.resolvedProfile.agencyProfile.trustSignals, customTrustSignals);
  assert.deepEqual(profileResult.resolvedProfile.agencyProfile.proofArtifacts, customProofArtifacts);
  assert.deepEqual(profileResult.resolvedProfile.agencyProfile.pricing, customPricing);
  assert.equal(
    profileResult.runtimePaths.opsDir,
    path.join(config.opsDir, "northline-growth-system", customBusinessId)
  );
  assert.equal(
    profileResult.runtimePaths.sourceDir,
    path.join(config.northlineProspecting.sourceDir, customBusinessId)
  );
  assert.equal(paymentReadiness?.status, "live");
  assert.ok(!planResult.plan.roadblocks.some((roadblock) => roadblock.category.includes("Payment")));
  assert.deepEqual(
    paymentRequests.map((request) => request.method),
    ["HEAD", "HEAD", "HEAD", "HEAD"]
  );
  assert.ok(paymentRequests.every((request) => request.url.startsWith("https://buy.stripe.com/")));
});

test("northline payment readiness keeps lead generation optional while the public path stays review-first", async () => {
  const { imonEngine, northlineOps, northlineProfileAdmin, store } = await setupWorkspace();
  await imonEngine.bootstrap();
  const baseBusiness = await store.getManagedBusiness("auto-funding-agency");
  assert.ok(baseBusiness);

  await store.saveManagedBusiness({
    ...baseBusiness,
    updatedAt: new Date().toISOString(),
    northlineProfile: {
      ...baseBusiness.northlineProfile,
      stripeLeadGeneration: undefined,
      stripeFounding: "https://buy.stripe.com/test_founding_ready",
      stripeStandard: "https://buy.stripe.com/test_standard_ready"
    }
  });

  const planResult = await northlineOps.writePlan({ businessId: "auto-funding-agency" });
  const paymentReadiness = planResult.plan.readiness.find((item) => item.id === "payment-collection");
  const paymentCheck = await northlineProfileAdmin.checkPayments({
    businessId: "auto-funding-agency",
    probeLinks: false
  });

  assert.equal(paymentReadiness?.status, "live");
  assert.ok(
    paymentReadiness?.evidence.some((entry) => entry.includes("optional") && entry.includes("Lead Generation"))
  );
  assert.equal(paymentCheck.status, "ready");
  assert.equal(paymentCheck.checks.find((check) => check.key === "lead_generation")?.required, false);
  assert.equal(paymentCheck.checks.find((check) => check.key === "lead_generation")?.status, "missing");
});

test("northline phase 4 defaults keep the pricing ladder review-first and resolve payment fallbacks", async () => {
  const touchedKeys = [
    "NORTHLINE_STRIPE_PAYMENT_LINK_LEAD_GENERATION",
    "NORTHLINE_STRIPE_PAYMENT_LINK_GROWTH_UPGRADE",
    "NORTHLINE_GROWTH_UPGRADE_COUPON_LABEL",
    "NORTHLINE_GROWTH_UPGRADE_COUPON_TERMS"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  process.env.NORTHLINE_STRIPE_PAYMENT_LINK_LEAD_GENERATION = "https://buy.stripe.com/test_env_lead_generation";
  process.env.NORTHLINE_STRIPE_PAYMENT_LINK_GROWTH_UPGRADE = "https://buy.stripe.com/test_env_growth_upgrade";
  process.env.NORTHLINE_GROWTH_UPGRADE_COUPON_LABEL = "Lead Gen to Growth";
  process.env.NORTHLINE_GROWTH_UPGRADE_COUPON_TERMS = "Apply within 30 days of the initial launch.";

  try {
    const { config, store } = await setupWorkspace();
    const offers = await store.getOffers();
    const leadGenerationOffer = offers.find((offer) => offer.id === "lead-generation-offer");
    const profile = resolveNorthlineBusinessProfile(config);

    assert.ok(leadGenerationOffer);
    assert.equal(leadGenerationOffer?.setupPrice, 349);
    assert.equal(leadGenerationOffer?.monthlyPrice, 149);
    assert.deepEqual(
      DEFAULT_AGENCY_PROFILE.pricing.map((tier) => tier.id),
      ["lead-generation", "pilot-launch", "growth-system"]
    );
    assert.equal(DEFAULT_AGENCY_PROFILE.pricing[0]?.cta?.label, "Get leak review");
    assert.equal(DEFAULT_AGENCY_PROFILE.pricing[1]?.cta?.label, "See if the pilot fits");
    assert.equal(DEFAULT_AGENCY_PROFILE.pricing[0]?.paymentLinkKey, "lead_generation");
    assert.equal(DEFAULT_AGENCY_PROFILE.pricing[0]?.upgradeOffer?.paymentLinkKey, "growth_upgrade");
    assert.equal(profile.stripeLeadGeneration, "https://buy.stripe.com/test_env_lead_generation");
    assert.equal(profile.growthUpgrade?.paymentLink, "https://buy.stripe.com/test_env_growth_upgrade");
    assert.equal(profile.growthUpgrade?.couponLabel, "Lead Gen to Growth");
    assert.equal(profile.growthUpgrade?.terms, "Apply within 30 days of the initial launch.");
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("resolveNorthlineBusinessProfile expands nationwide collection areas and keeps the home market first", async () => {
  const touchedKeys = ["NORTHLINE_PRIMARY_SERVICE_AREA", "NORTHLINE_PROSPECT_COLLECTION_AREAS"] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));
  const root = await mkdtemp(path.join(os.tmpdir(), "auto-funding-"));

  process.env.NORTHLINE_PRIMARY_SERVICE_AREA = "Albany, NY";
  process.env.NORTHLINE_PROSPECT_COLLECTION_AREAS = "nationwide:us";

  try {
    const config = await loadConfig(root);
    const envProfile = resolveNorthlineBusinessProfile(config);
    const storedProfile = resolveNorthlineBusinessProfile(config, {
      id: "auto-funding-agency",
      name: "Northline Growth Systems",
      northlineProfile: {
        collectionAreas: ["nationwide:us"]
      }
    });

    assert.equal(envProfile.collectionAreas[0], "Albany, NY");
    assert.equal(storedProfile.collectionAreas[0], "Albany, NY");
    assert.deepEqual(storedProfile.collectionAreas, envProfile.collectionAreas);
    assert.ok(envProfile.collectionAreas.includes("Los Angeles, CA"));
    assert.ok(envProfile.collectionAreas.includes("Chicago, IL"));
    assert.ok(envProfile.collectionAreas.includes("Houston, TX"));
    assert.ok(envProfile.collectionAreas.includes("Seattle, WA"));
    assert.equal(envProfile.collectionAreas.filter((area) => area === "Albany, NY").length, 1);
    assert.ok(envProfile.collectionAreas.length >= 51);
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("northlineLeadMatchesServiceArea honors local and state-level area scope", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "auto-funding-area-scope-"));
  const config = await loadConfig(root);
  const profile = resolveNorthlineBusinessProfile(config, {
    id: "hudson-cleaning",
    name: "Hudson Cleaning",
    northlineProfile: {
      collectionAreas: ["New York"]
    }
  });

  assert.equal(
    northlineLeadMatchesServiceArea(
      {
        geo: "Albany, NY",
        targetContext: {
          market: "Albany, NY",
          collectionArea: "Albany, NY",
          targetIndustries: [],
          targetServices: [],
          matchReasons: []
        }
      },
      profile
    ),
    true
  );
  assert.equal(
    northlineLeadMatchesServiceArea(
      {
        geo: "Los Angeles, CA",
        targetContext: {
          market: "Los Angeles, CA",
          collectionArea: "Los Angeles, CA",
          targetIndustries: [],
          targetServices: [],
          matchReasons: []
        }
      },
      profile
    ),
    false
  );
});

test("buildAgencySite uses Northline surface overrides for payment links", async () => {
  const { config, store } = await setupWorkspace();
  const now = new Date().toISOString();
  const proofDir = path.join(config.outputDir, "roofline-proof");
  const screenshotPath = path.join(proofDir, "roofline-proof-home-desktop.png");
  await mkdir(proofDir, { recursive: true });
  await writeFile(screenshotPath, "proof-fixture");

  await store.saveClient({
    id: "roofline-proof-client",
    businessId: "auto-funding-agency",
    sourceSubmissionId: "northline-intake-1714400000000-roofline-heating",
    provenance: "external_inbound",
    proofEligible: true,
    clientName: "Roofline Heating",
    niche: "home services",
    geo: "Cleveland, OH",
    primaryPhone: "(216) 444-0102",
    primaryEmail: "dispatch@rooflineheating.com",
    offerId: "founding-offer",
    siteStatus: "ready",
    qaStatus: "passed",
    billingStatus: "paid",
    deployment: {
      platform: "local-preview",
      previewPath: proofDir
    },
    assets: {},
    intakeNotes: ["Hosted Northline intake converted into a paid proof client."],
    nextAction: "Published proof is live.",
    createdAt: now,
    updatedAt: now
  });

  await store.saveProofBundle({
    clientId: "roofline-proof-client",
    businessId: "auto-funding-agency",
    createdAt: now,
    clientName: "Roofline Heating",
    siteStatus: "ready",
    qaStatus: "passed",
    previewPath: proofDir,
    reportPath: path.join(config.reportDir, "roofline-proof-bundle.json"),
    screenshots: [
      {
        id: "roofline-proof-home-desktop",
        label: "Desktop homepage",
        path: screenshotPath,
        viewport: "desktop"
      }
    ],
    testimonialRequest: {
      subject: "Roofline testimonial request",
      body: "Share the result in one sentence."
    },
    reviewRequest: {
      subject: "Roofline review request",
      body: "Please leave a quick review."
    },
    publication: {
      headline: "Roofline Heating tightened the first page and follow-up path.",
      summary: "Recent hosted delivery so the broader monthly path can render once real work exists.",
      bullets: ["Pilot fix shipped", "Follow-up path tightened"]
    }
  });

  const shuffledPricingProfile = {
    ...DEFAULT_AGENCY_PROFILE,
    pricing: [
      DEFAULT_AGENCY_PROFILE.pricing[2]!,
      DEFAULT_AGENCY_PROFILE.pricing[0]!,
      DEFAULT_AGENCY_PROFILE.pricing[1]!
    ]
  };

  await buildAgencySite(config, shuffledPricingProfile, {
    siteUrl: "https://rooflinegrowth.com",
    salesEmail: "hello@rooflinegrowth.com",
    primaryServiceArea: "Cleveland, OH",
    stripeLeadGeneration: "https://buy.stripe.com/roofline_lead_generation",
    stripeFounding: "https://buy.stripe.com/roofline_founding",
    stripeStandard: "https://buy.stripe.com/roofline_standard",
    growthUpgrade: {
      paymentLink: "https://buy.stripe.com/roofline_growth_upgrade",
      couponLabel: "Lead Gen to Growth",
      terms: "Apply within 30 days of the first launch."
    },
    stripeValidation: "https://buy.stripe.com/roofline_validation"
  });

  const html = await readTextFile(path.join(config.outputDir, "agency-site", "index.html"));
  const validationHtml = await readTextFile(
    path.join(config.outputDir, "agency-site", "validation.html")
  );

  assert.match(html, /https:\/\/buy\.stripe\.com\/roofline_founding/);
  assert.match(html, /https:\/\/buy\.stripe\.com\/roofline_standard/);
  assert.match(html, /https:\/\/buy\.stripe\.com\/roofline_growth_upgrade/);
  assert.match(
    html,
    /data-tier-id="lead-generation"[\s\S]*data-tier-id="pilot-launch"[\s\S]*data-tier-id="growth-system"/
  );
  assert.match(html, /Get leak review/);
  assert.match(html, /See if the pilot fits/);
  assert.match(html, /Book growth review/);
  assert.doesNotMatch(html, /What Northline shows first/);
  assert.doesNotMatch(html, /id="proof"/);
  assert.doesNotMatch(html, /id="client-proof"/);
  assert.doesNotMatch(html, /Delivered client work/);
  assert.match(html, /data-tier-id="pilot-launch"[\s\S]*Reserve Pilot Launch/);
  assert.match(html, /data-tier-id="growth-system"[\s\S]*Start Growth System/);
  assert.match(html, /Lead Gen to Growth/);
  assert.match(html, /Apply within 30 days of the first launch\./);
  assert.match(html, /data-upgrade-panel/);
  assert.doesNotMatch(html, /data-retainer-hold/);
  assert.doesNotMatch(html, /System Check/);
  assert.match(html, /hello@rooflinegrowth\.com/);
  assert.match(html, /Cleveland, OH/);
  assert.match(validationHtml, /northline-validation-run --submission/);
  assert.match(validationHtml, /https:\/\/buy\.stripe\.com\/roofline_validation/);
  assert.match(validationHtml, /northline-validation-status/);
  assert.match(validationHtml, /Persisted status/);
  assert.match(validationHtml, /client_reference_id/);
  assert.match(validationHtml, /Continue to \$1 checkout/);
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
  assert.equal(reply.recommendedStage, "responded");
  assert.equal(reply.route, "intake_follow_up");
});

test("manual reply processing stores routed lead reply records", async () => {
  const { store, replyHandler } = await setupWorkspace();
  const now = new Date().toISOString();
  await store.saveLead({
    id: "reply-route-plumbing",
    businessName: "Reply Route Plumbing",
    niche: "home services",
    geo: "Akron, OH",
    source: "test",
    contact: {
      ownerName: "Chris",
      email: "chris@replyrouteplumbing.com",
      phone: "(330) 555-0141",
      website: "https://replyrouteplumbing.com"
    },
    websiteQualitySignals: {
      hasWebsite: true,
      hasHttps: true,
      mobileFriendly: true,
      clearOffer: true,
      callsToAction: true,
      pageSpeedBucket: "average",
      notes: []
    },
    score: 80,
    scoreReasons: ["Reply testing"],
    stage: "contacted",
    tags: ["priority"],
    createdAt: now,
    updatedAt: now
  });

  const processed = await processLeadReply({
    store,
    replyHandler,
    leadId: "reply-route-plumbing",
    message: "Call me tomorrow afternoon, this looks interesting.",
    subject: "Re: Reply Route Plumbing",
    source: "manual_file",
    receivedAt: now
  });

  const updatedLead = await store.getLead("reply-route-plumbing");
  const replies = await store.getLeadReplies();

  assert.equal(processed.classification.route, "booked_call");
  assert.equal(updatedLead?.stage, "responded");
  assert.ok(updatedLead?.tags.includes("reply-route-booked-call"));
  assert.equal(replies.length, 1);
  assert.equal(replies[0]?.classification.route, "booked_call");
  assert.equal(replies[0]?.subject, "Re: Reply Route Plumbing");
});

test("lead-generation retention reporting includes the Growth upgrade artifact", async () => {
  const touchedKeys = [
    "NORTHLINE_STRIPE_PAYMENT_LINK_GROWTH_UPGRADE",
    "NORTHLINE_GROWTH_UPGRADE_COUPON_LABEL",
    "NORTHLINE_GROWTH_UPGRADE_COUPON_TERMS"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  process.env.NORTHLINE_STRIPE_PAYMENT_LINK_GROWTH_UPGRADE = "https://buy.stripe.com/test_phase4_growth_upgrade";
  process.env.NORTHLINE_GROWTH_UPGRADE_COUPON_LABEL = "Lead Gen to Growth";
  process.env.NORTHLINE_GROWTH_UPGRADE_COUPON_TERMS =
    "Apply within 30 days of the Lead Generation launch.";

  try {
    const { store, siteBuilder, qaReviewer, orchestrator } = await setupWorkspace();
    const now = new Date().toISOString();
    const client: ClientJob = {
      id: "sunrise-plumbing",
      clientName: "Sunrise Plumbing & Drain",
      niche: "home services",
      geo: "Akron, OH",
      primaryPhone: "(330) 555-0180",
      primaryEmail: "dispatch@sunriseplumbingdrain.com",
      offerId: "lead-generation-offer",
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
    assert.equal(retention.upgradeOffer?.targetTierId, "growth-system");
    assert.equal(retention.upgradeOffer?.label, "Upgrade to Growth System");
    assert.equal(retention.upgradeOffer?.paymentLinkKey, "growth_upgrade");
    assert.equal(
      retention.upgradeOffer?.paymentLink,
      "https://buy.stripe.com/test_phase4_growth_upgrade"
    );
    assert.equal(retention.upgradeOffer?.couponLabel, "Lead Gen to Growth");
    assert.equal(
      retention.upgradeOffer?.terms,
      "Apply within 30 days of the Lead Generation launch."
    );
    assert.ok(retention.upgradeOffer?.summary.includes("Growth System"));
    assert.ok(retention.upgradeOffer?.nextStep.includes("checkout"));
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("ImonEngine seeds the portfolio and produces a resource-aware report", async () => {
  const { store, imonEngine } = await setupWorkspace();

  const report = await imonEngine.bootstrap();
  const engine = await store.getEngineState();
  const businesses = await store.getManagedBusinesses();
  const digitalAssetStore = businesses.find((business) => business.id === "imon-digital-asset-store");
  const nicheSiteNetwork = businesses.find((business) => business.id === "imon-niche-content-sites");
  const socialBrand = businesses.find((business) => business.id === "imon-faceless-social-brand");
  const clipbaiters = businesses.find((business) => business.id === "clipbaiters-viral-moments");
  const agency = businesses.find((business) => business.id === "auto-funding-agency");

  assert.ok(engine);
  assert.equal(engine?.portfolio.trackedBusinesses, 7);
  assert.ok(digitalAssetStore);
  assert.equal(digitalAssetStore?.stage, "ready");
  assert.equal(nicheSiteNetwork?.stage, "deferred");
  assert.equal(socialBrand?.stage, "deferred");
  assert.equal(clipbaiters?.stage, "scaffolded");
  assert.equal(clipbaiters?.approvalType, "compliance");
  assert.ok(agency);
  assert.equal(agency?.name, "Northline Growth Systems");
  assert.equal(agency?.stage, "paused");
  assert.ok(report.nextLaunchCandidates.includes("imon-digital-asset-store"));
  assert.equal(report.businessCounts.deferred, 2);
  assert.equal(report.blockedBusinesses.includes("imon-faceless-social-brand"), false);
  assert.ok(report.recommendedConcurrency >= 1);
});

test("ImonEngine excludes internal Northline validation records from revenue and acquisition work", async () => {
  const { store, imonEngine } = await setupWorkspace();
  await imonEngine.bootstrap();
  const now = new Date().toISOString();

  await store.saveLead({
    id: "northline-acquisition-work-item",
    businessId: "auto-funding-agency",
    pipeline: "agency_client_acquisition",
    businessName: "Northline Acquisition Work Item",
    niche: "home services",
    geo: "Cleveland, OH",
    source: "northline-feed:test.json",
    contact: {
      ownerName: "Alex",
      email: "alex@northline-acquisition.example.com",
      phone: "(216) 555-0109",
      website: "https://northline-acquisition.example.com"
    },
    websiteQualitySignals: {
      hasWebsite: true,
      hasHttps: true,
      mobileFriendly: false,
      clearOffer: false,
      callsToAction: false,
      pageSpeedBucket: "slow",
      notes: []
    },
    targetContext: {
      market: "Cleveland, OH",
      trade: "hvac",
      collectionArea: "Cleveland, OH",
      sourceType: "auto-osm",
      targetIndustries: ["HVAC"],
      targetServices: ["Lead follow-up"],
      offerSummary: "Northline helps HVAC operators tighten the close path.",
      matchReasons: ["Public email available."]
    },
    score: 82,
    scoreReasons: ["Strong target fit."],
    stage: "qualified",
    tags: ["hvac"],
    createdAt: now,
    updatedAt: now
  });
  await store.saveLead({
    id: "northline-client-demand-work-item",
    businessId: "auto-funding-agency",
    pipeline: "client_demand_generation",
    businessName: "Northline Client Demand Work Item",
    niche: "home services",
    geo: "Cleveland, OH",
    source: "client-demand-feed:test.json",
    contact: {
      ownerName: "Taylor",
      email: "taylor@northline-client-demand.example.com",
      phone: "(216) 555-0110",
      website: "https://northline-client-demand.example.com"
    },
    websiteQualitySignals: {
      hasWebsite: true,
      hasHttps: true,
      mobileFriendly: false,
      clearOffer: false,
      callsToAction: false,
      pageSpeedBucket: "slow",
      notes: []
    },
    targetContext: {
      market: "Cleveland, OH",
      trade: "hvac",
      collectionArea: "Cleveland, OH",
      sourceType: "client-demand-feed",
      targetIndustries: ["HVAC"],
      targetServices: ["Booked service calls"],
      offerSummary: "Demand-generation leads for an already-signed operator.",
      matchReasons: ["Homeowner demand request."]
    },
    score: 86,
    scoreReasons: ["Qualified demand request."],
    stage: "qualified",
    tags: ["hvac"],
    createdAt: now,
    updatedAt: now
  });

  await store.saveClient({
    id: "northline-real-customer",
    businessId: "auto-funding-agency",
    provenance: "external_outbound",
    proofEligible: true,
    clientName: "Northline Real Customer",
    niche: "home services",
    geo: "Cleveland, OH",
    primaryPhone: "(216) 555-0111",
    primaryEmail: "owner@northline-real-customer.example.com",
    offerId: "founding-offer",
    siteStatus: "not_started",
    qaStatus: "pending",
    billingStatus: "retainer_active",
    deployment: {
      platform: "local-preview"
    },
    assets: {
      logoText: "Northline Real Customer"
    },
    intakeNotes: ["Real outbound-sourced customer."],
    nextAction: "Build preview",
    createdAt: now,
    updatedAt: now
  });
  await store.saveClient({
    id: "northline-validation-rehearsal",
    businessId: "auto-funding-agency",
    provenance: "internal_validation",
    proofEligible: false,
    clientName: "Northline Validation Rehearsal",
    niche: "home services",
    geo: "Northline controlled launch validation",
    primaryPhone: "(216) 555-0112",
    primaryEmail: "ops+validation@example.invalid",
    offerId: "standard-offer",
    siteStatus: "not_started",
    qaStatus: "pending",
    billingStatus: "retainer_active",
    deployment: {
      platform: "local-preview"
    },
    assets: {
      logoText: "Northline Validation Rehearsal"
    },
    intakeNotes: ["Source: northline-validation-page"],
    nextAction: "Internal rehearsal only",
    createdAt: now,
    updatedAt: now
  });

  const report = await imonEngine.sync();
  const agency = await store.getManagedBusiness("auto-funding-agency");

  assert.equal(agency?.metrics.currentMonthlyRevenue, 199);
  assert.equal(agency?.metrics.activeWorkItems, 2);
  assert.equal(report.monthlyRevenue, 199);
});

test("ImonEngine scopes Northline active work to the current service area", async () => {
  const { store, imonEngine } = await setupWorkspace();
  await imonEngine.bootstrap();
  const now = new Date().toISOString();
  const northline = await store.getManagedBusiness("auto-funding-agency");

  assert.ok(northline);

  await store.saveManagedBusiness({
    ...northline,
    northlineProfile: {
      ...(northline.northlineProfile ?? {}),
      collectionAreas: ["New York, NY"]
    },
    updatedAt: now
  });

  await store.saveLead({
    id: "northline-in-scope-work-item",
    businessId: "auto-funding-agency",
    pipeline: "agency_client_acquisition",
    businessName: "Northline In Scope Work Item",
    niche: "home services",
    geo: "Queens, NY",
    source: "northline-feed:test.json",
    contact: {
      ownerName: "Morgan",
      email: "morgan@northline-inscope.example.com",
      phone: "(555) 555-0121",
      website: "https://northline-inscope.example.com"
    },
    websiteQualitySignals: {
      hasWebsite: true,
      hasHttps: true,
      mobileFriendly: false,
      clearOffer: false,
      callsToAction: false,
      pageSpeedBucket: "slow",
      notes: []
    },
    targetContext: {
      market: "New York, NY",
      trade: "plumbing",
      collectionArea: "New York, NY",
      sourceType: "auto-osm",
      targetIndustries: ["Plumbing"],
      targetServices: ["Proof page rebuild"],
      offerSummary: "Northline helps plumbing operators tighten the close path.",
      matchReasons: ["Public email available."]
    },
    score: 82,
    scoreReasons: ["Strong target fit."],
    stage: "qualified",
    tags: ["plumbing"],
    createdAt: now,
    updatedAt: now
  });

  await store.saveLead({
    id: "northline-out-of-scope-work-item",
    businessId: "auto-funding-agency",
    pipeline: "agency_client_acquisition",
    businessName: "Northline Out Of Scope Work Item",
    niche: "home services",
    geo: "Houston, TX",
    source: "northline-feed:test.json",
    contact: {
      ownerName: "Riley",
      email: "riley@northline-outofscope.example.com",
      phone: "(555) 555-0122",
      website: "https://northline-outofscope.example.com"
    },
    websiteQualitySignals: {
      hasWebsite: true,
      hasHttps: true,
      mobileFriendly: false,
      clearOffer: false,
      callsToAction: false,
      pageSpeedBucket: "slow",
      notes: []
    },
    targetContext: {
      market: "Houston, TX",
      trade: "plumbing",
      collectionArea: "Houston, TX",
      sourceType: "auto-osm",
      targetIndustries: ["Plumbing"],
      targetServices: ["Proof page rebuild"],
      offerSummary: "Northline helps plumbing operators tighten the close path.",
      matchReasons: ["Public email available."]
    },
    score: 84,
    scoreReasons: ["Strong target fit."],
    stage: "qualified",
    tags: ["plumbing"],
    createdAt: now,
    updatedAt: now
  });

  const report = await imonEngine.sync();
  const updatedBusiness = await store.getManagedBusiness("auto-funding-agency");

  assert.equal(updatedBusiness?.metrics.activeWorkItems, 1);
  assert.equal(report.monthlyRevenue, 0);
});

test("loadConfig prefers .env.example business values and supports Northline mail defaults", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "auto-funding-env-"));
  const touchedKeys = [
    "NORTHLINE_SALES_EMAIL",
    "NORTHLINE_DOMAIN",
    "NORTHLINE_SITE_URL",
    "NORTHLINE_BOOKING_URL",
    "NORTHLINE_PRIMARY_SERVICE_AREA",
    "INBOX_PROVIDER",
    "IMAP_HOST",
    "IMAP_USER",
    "IMAP_PASS",
    "IMAP_PORT",
    "IMAP_SECURE",
    "OUTBOUND_CHANNEL",
    "NORTHLINE_INBOX_PROVIDER",
    "NORTHLINE_IMAP_HOST",
    "NORTHLINE_IMAP_USER",
    "NORTHLINE_IMAP_PASS",
    "NORTHLINE_IMAP_PORT",
    "NORTHLINE_IMAP_SECURE",
    "NORTHLINE_IMAP_MAILBOX",
    "NORTHLINE_OUTBOUND_CHANNEL",
    "NORTHLINE_INBOX_ALIAS_FILTER",
    "NORTHLINE_ZOHO_APP_PASS",
    "NORTHLINE_PHONE",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_FROM",
    "NORTHLINE_SMTP_FROM"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  try {
    for (const key of touchedKeys) {
      delete process.env[key];
    }

    await writeFile(
      path.join(root, ".env"),
      [
        "NORTHLINE_SALES_EMAIL=legacy@example.com",
        "NORTHLINE_BOOKING_URL=https://calendar.example.com/northline",
        "NORTHLINE_PHONE=(212) 555-0199",
        "SMTP_HOST=smtppro.zoho.com",
        "SMTP_PORT=465",
        "SMTP_SECURE=true",
        "SMTP_USER=mailer@example.com",
        "SMTP_FROM=Legacy Sender <legacy@example.com>"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(root, ".env.example"),
      [
        "NORTHLINE_SALES_EMAIL=contact@northlinegrowthsystems.com",
        "NORTHLINE_DOMAIN=northlinegrowthsystems.com",
        "NORTHLINE_SITE_URL=https://northlinegrowthsystems.com",
        "NORTHLINE_BOOKING_URL= ",
        "NORTHLINE_PRIMARY_SERVICE_AREA= New York, NY",
        "INBOX_PROVIDER=imap",
        "IMAP_HOST=imappro.zoho.com",
        "IMAP_USER=shared-zoho@example.com",
        "IMAP_PORT=993",
        "NORTHLINE_INBOX_ALIAS_FILTER=contact@northlinegrowthsystems.com",
        "NORTHLINE_ZOHO_APP_PASS=test-app-secret",
        "NORTHLINE_IMAP_MAILBOX=INBOX",
        "NORTHLINE_SMTP_FROM=Northline Growth Systems <contact@northlinegrowthsystems.com>"
      ].join("\n"),
      "utf8"
    );

    const config = await loadConfig(root);

    assert.equal(config.business.salesEmail, "contact@northlinegrowthsystems.com");
    assert.equal(config.business.domain, "northlinegrowthsystems.com");
    assert.equal(config.business.siteUrl, "https://northlinegrowthsystems.com");
    assert.equal(config.business.bookingUrl, "https://calendar.example.com/northline");
    assert.equal(config.business.primaryServiceArea, "New York, NY");
    assert.deepEqual(config.northlineProspecting.collectionAreas, ["New York, NY"]);
    assert.ok(config.northlineProspecting.collectionTrades.includes("plumbing"));
    assert.equal(config.business.phone, "(212) 555-0199");
    assert.equal(config.smtp?.host, "smtppro.zoho.com");
    assert.equal(config.smtp?.user, "mailer@example.com");
    assert.equal(config.smtp?.pass, "test-app-secret");
    assert.equal(
      config.smtp?.from,
      "Northline Growth Systems <contact@northlinegrowthsystems.com>"
    );
    assert.equal(config.northlineMail.inboxProvider, "imap");
    assert.equal(config.northlineMail.outboundChannel, "smtp");
    assert.equal(config.northlineMail.aliasAddress, "contact@northlinegrowthsystems.com");
    assert.equal(config.northlineMail.imap?.host, "imappro.zoho.com");
    assert.equal(config.northlineMail.imap?.port, 993);
    assert.equal(config.northlineMail.imap?.secure, true);
    assert.equal(config.northlineMail.imap?.user, "shared-zoho@example.com");
    assert.equal(config.northlineMail.imap?.pass, "test-app-secret");
    assert.equal(config.northlineMail.imap?.mailbox, "INBOX");
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
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
  const officeHandoffs = await store.getOfficeHandoffs();
  const executionItems = await store.getDepartmentExecutionItems();

  assert.ok(engineBlueprint);
  assert.ok(digitalStoreBlueprint);
  assert.ok(workflowOwner);
  assert.equal(workflowOwner?.departmentName, "Operations");
  assert.equal(workflowOwner?.positionName, "Operations Manager");
  assert.equal(officeSnapshot.officeTree.scope, "engine");
  assert.ok(officeSnapshot.officeTree.children.length >= 5);
  assert.ok(officeSnapshot.executiveView.businesses.length >= 5);
  assert.ok(
    officeSnapshot.businessViews.some((view) => view.businessId === "imon-digital-asset-store")
  );
  assert.equal(
    officeSnapshot.businessViews.find(
      (view) => view.businessId === "imon-digital-asset-store"
    )?.templateProfile,
    "catalog_store"
  );
  assert.ok(
    officeSnapshot.departmentWorkspaces.some(
      (workspace) =>
        workspace.businessId === "imon-digital-asset-store" &&
        workspace.executionItems.length > 0
    )
  );
  assert.ok(officeHandoffs.length > 0);
  assert.ok(executionItems.length > 0);
  assert.equal(await exists(dashboardArtifacts.htmlPath), true);
  const dashboardHtml = await readTextFile(dashboardArtifacts.htmlPath);
  assert.ok(dashboardHtml.includes("ImonEngine"));
  assert.ok(dashboardHtml.includes("Folder-Style Office Explorer"));
  assert.ok(dashboardHtml.includes("Office Explorer"));
  assert.ok(dashboardHtml.includes("Detail"));
});

test("organization control plane surfaces Northline runtime work inside service-business departments", async () => {
  const { config, imonEngine, northlineOps, store } = await setupWorkspace();
  await imonEngine.bootstrap();

  const createdAt = "2026-04-06T03:15:00.000Z";
  const updatedAt = "2026-04-06T03:32:31.000Z";
  const proofBundle: ProofBundle = {
    clientId: "northline-client-stable",
    businessId: "auto-funding-agency",
    createdAt: updatedAt,
    clientName: "Stable Service Co",
    siteStatus: "deployed",
    qaStatus: "passed",
    previewPath: path.join(config.previewDir, "northline-client-stable"),
    reportPath: path.join(config.reportDir, "northline-client-stable-proof.md"),
    screenshots: [
      {
        id: "proof-shot-1",
        label: "Homepage hero",
        path: path.join(config.reportDir, "northline-client-stable-desktop.png"),
        viewport: "desktop"
      }
    ],
    testimonialRequest: {
      subject: "Can we quote your result?",
      body: "We would like to quote the result from this launch."
    },
    reviewRequest: {
      subject: "Would you leave a review?",
      body: "Please share a short review of the launch."
    },
    publication: {
      headline: "Stable Service Co launch",
      summary: "Northline rebuilt the lead path and shipped the handoff package.",
      bullets: ["Launch shipped", "Proof bundle packaged"],
      testimonialQuote: "The new page tightened up how leads come in."
    }
  };
  const handoffPackage: HandoffPackage = {
    clientId: "northline-client-stable",
    businessId: "auto-funding-agency",
    createdAt: updatedAt,
    clientName: "Stable Service Co",
    previewPath: path.join(config.previewDir, "northline-client-stable"),
    reportPath: path.join(config.reportDir, "northline-client-stable-handoff.md"),
    readmePath: path.join(config.reportDir, "northline-client-stable-readme.md"),
    proofBundlePath: path.join(config.reportDir, "northline-client-stable-proof.md"),
    summary: "Stable Service Co handoff package",
    includedArtifacts: ["preview", "handoff-readme", "proof-bundle"],
    clientChecklist: ["Review the proof bundle"],
    developerChecklist: ["Confirm the live URL after handoff"]
  };

  await store.saveLead({
    id: "northline-lead-1",
    businessId: "auto-funding-agency",
    businessName: "Pending Prospect LLC",
    niche: "plumbing",
    geo: "New York, NY",
    source: "northline-source",
    contact: {
      ownerName: "Maya Prospect",
      email: "maya@example.com",
      phone: "(212) 555-0101",
      website: "https://pendingprospect.example.com"
    },
    websiteQualitySignals: {
      hasWebsite: true,
      hasHttps: true,
      mobileFriendly: false,
      clearOffer: false,
      callsToAction: false,
      pageSpeedBucket: "slow",
      notes: ["Weak mobile CTA"]
    },
    score: 74,
    scoreReasons: ["Weak CTA", "Strong local fit"],
    stage: "drafted",
    tags: ["northline"],
    createdAt,
    updatedAt
  });
  await store.saveOutreachDraft({
    id: "northline-draft-1",
    leadId: "northline-lead-1",
    subject: "Quick idea for your homepage",
    body: "We found a missed-call leak on your current lead path.",
    followUps: ["Follow up in 2 days"],
    complianceNotes: ["Needs compliance review before send"],
    approved: false,
    createdAt,
    updatedAt
  });

  await store.saveClient({
    id: "northline-client-open",
    businessId: "auto-funding-agency",
    provenance: "external_outbound",
    proofEligible: true,
    clientName: "Open Delivery Co",
    niche: "hvac",
    geo: "New York, NY",
    primaryPhone: "(212) 555-0102",
    primaryEmail: "ops@opendelivery.example.com",
    offerId: "lead-generation-offer",
    siteStatus: "qa_failed",
    qaStatus: "failed",
    billingStatus: "paid",
    deployment: {
      platform: "local-preview",
      previewPath: path.join(config.previewDir, "northline-client-open")
    },
    assets: {
      services: ["Homepage cleanup"]
    },
    intakeNotes: ["Northline outbound pilot"],
    nextAction: "Fix QA blockers and rerun delivery",
    createdAt,
    updatedAt
  });
  await store.saveClient({
    id: "northline-client-stable",
    businessId: "auto-funding-agency",
    provenance: "external_outbound",
    proofEligible: true,
    clientName: "Stable Service Co",
    niche: "electrical",
    geo: "New York, NY",
    primaryPhone: "(212) 555-0103",
    primaryEmail: "owner@stableservice.example.com",
    offerId: "founding-offer",
    siteStatus: "deployed",
    qaStatus: "passed",
    billingStatus: "retainer_active",
    deployment: {
      platform: "cloudflare-pages",
      previewPath: path.join(config.previewDir, "northline-client-stable"),
      productionUrl: "https://stableservice.example.com"
    },
    assets: {
      services: ["Homepage rebuild", "Follow-up cleanup"],
      proofBundle: proofBundle,
      handoffPackage: handoffPackage
    },
    intakeNotes: ["Northline delivered external client"],
    nextAction: "Monitor monthly performance",
    createdAt,
    updatedAt
  });
  await store.saveProofBundle(proofBundle);
  await store.saveRetentionReport({
    clientId: "northline-client-stable",
    createdAt: updatedAt,
    reviewResponses: [
      {
        review: "The new path is much easier to follow.",
        response: "Appreciate the review."
      }
    ],
    updateSuggestions: ["Add one more service-area proof block"],
    upsellCandidate: "Growth System upgrade"
  });

  await writeFile(
    path.join(config.stateDir, "northlineValidationConfirmations.json"),
    `${JSON.stringify(
      {
        confirmations: [
          {
            submissionId: "northline-validation-success-1",
            lastStripeCompletedAt: updatedAt,
            lastResult: {
              businessId: "auto-funding-agency",
              status: "success"
            }
          }
        ]
      },
      null,
      2
    )}\n`
  );

  const planResult = await northlineOps.writePlan({ businessId: "auto-funding-agency" });
  await northlineOps.refreshPromotionQueue({ businessId: "auto-funding-agency" });
  await mkdir(path.join(config.opsDir, "northline-growth-system"), { recursive: true });
  await writeFile(
    path.join(config.reportDir, "northline-test-run.json"),
    `${JSON.stringify({ id: "northline-test-run" }, null, 2)}\n`
  );
  await writeFile(
    path.join(config.opsDir, "northline-growth-system", "autonomy-summary.json"),
    `${JSON.stringify(
      {
        plan: planResult.plan,
        snapshot: {
          businessId: "auto-funding-agency",
          generatedAt: updatedAt,
          planStatus: planResult.plan.status,
          planOperatingMode: planResult.plan.operatingMode.current,
          status: "blocked",
          summary: "Northline has live delivery and reply work plus one manual gate.",
          notes: ["Manual send review still open."],
          roadblocks: [],
          newIntakes: [
            {
              submissionId: "northline-intake-1",
              clientId: "northline-client-open",
              status: "created",
              summary: "New intake promoted into the client queue.",
              notes: ["Promoted from hosted intake"]
            }
          ],
          outboundQueue: [
            {
              draftId: "northline-draft-1",
              leadId: "northline-lead-1",
              approvalId: "approval-outbound-1",
              status: "awaiting_compliance",
              summary: "Pending Prospect LLC is waiting on outreach compliance review."
            }
          ],
          replyQueue: [
            {
              leadId: "northline-lead-1",
              replyId: "northline-reply-1",
              status: "intake_follow_up",
              summary: "Pending Prospect LLC replied and needs intake follow-up.",
              nextAction: "Send the intake link"
            }
          ],
          deliveryQueue: [
            {
              clientId: "northline-client-open",
              billingStatus: "paid",
              status: "qa_failed",
              actions: ["Fix hero spacing"],
              summary: "Open Delivery Co is blocked by QA fixes."
            },
            {
              clientId: "northline-client-stable",
              billingStatus: "retainer_active",
              status: "stable",
              actions: ["Monitor monthly optimization"],
              summary: "Stable Service Co is in stable retainer mode."
            }
          ],
          manualGates: [
            {
              id: "manual-gate-1",
              kind: "outbound_send",
              status: "open",
              relatedEntityId: "northline-lead-1",
              summary: "Resolve outbound send review for Pending Prospect LLC.",
              instructions: "Review the draft and approve the outbound send path."
            }
          ]
        },
        reportPath: path.join(config.reportDir, "northline-test-run.json")
      },
      null,
      2
    )}\n`
  );

  const officeSnapshot = await imonEngine.syncOrganization();
  const northlineWorkspaces = officeSnapshot.departmentWorkspaces.filter(
    (workspace) => workspace.businessId === "auto-funding-agency"
  );
  const northlineExecutionItems = northlineWorkspaces.flatMap(
    (workspace) => workspace.executionItems
  );
  const northlineItemsByTitle = new Map(
    northlineExecutionItems.map((item) => [item.title, item])
  );
  const governanceItem = northlineItemsByTitle.get("Business Governance");
  const businessOpsItem = northlineItemsByTitle.get("Business Operations");
  const growthItem = northlineItemsByTitle.get("Growth Publishing");
  const analyticsItem = northlineItemsByTitle.get("Analytics Reporting");
  const deliveryItem = northlineItemsByTitle.get("Client Delivery Production");
  const financeItem = northlineItemsByTitle.get("Business Finance Reporting");
  const supportItem = northlineItemsByTitle.get("Support And QA");

  assert.equal(northlineWorkspaces.length, 7);
  assert.ok(
    northlineWorkspaces.every(
      (workspace) => workspace.workers.length > 0 && workspace.executionItems.length > 0
    )
  );
  assert.deepEqual(
    northlineExecutionItems.map((item) => item.title).sort(),
    [
      "Analytics Reporting",
      "Business Finance Reporting",
      "Business Governance",
      "Business Operations",
      "Client Delivery Production",
      "Growth Publishing",
      "Support And QA"
    ].sort()
  );

  assert.equal(governanceItem?.assignedWorkerLabel, "General Manager / Brand Director");
  assert.ok(
    governanceItem?.artifacts.some((artifact) => artifact.includes("Operating mode:"))
  );
  assert.ok(
    governanceItem?.metrics.some((metric) => metric.includes("Validation confirmations: 1"))
  );
  assert.equal(businessOpsItem?.status, "blocked");
  assert.equal(businessOpsItem?.assignedWorkerLabel, "Operations Manager");
  assert.ok(
    businessOpsItem?.artifacts.some((artifact) =>
      artifact.includes("Autonomy status: blocked")
    )
  );
  assert.ok(
    businessOpsItem?.metrics.some((metric) => metric.includes("Manual gates: 1"))
  );
  assert.equal(growthItem?.assignedWorkerLabel, "Growth And Marketing Manager");
  assert.ok(
    growthItem?.metrics.some((metric) => metric.includes("Pending send: 1"))
  );
  assert.ok(
    growthItem?.artifacts.some((artifact) => artifact.includes("Outbound queue: 1 item"))
  );
  assert.equal(analyticsItem?.assignedWorkerLabel, "Analytics And Research Lead");
  assert.ok(
    analyticsItem?.artifacts.some((artifact) => artifact.includes("Proof assets ready:"))
  );
  assert.ok(
    analyticsItem?.metrics.some((metric) => metric.includes("Retention reports: 1"))
  );
  assert.equal(deliveryItem?.status, "blocked");
  assert.equal(deliveryItem?.assignedWorkerLabel, "Product / Content Lead");
  assert.ok(
    deliveryItem?.artifacts.some((artifact) => artifact.includes("Proof bundles: 1"))
  );
  assert.ok(
    deliveryItem?.blockers.some((blocker) => blocker.includes("QA blockers remain"))
  );
  assert.ok(
    financeItem?.artifacts.some((artifact) =>
      artifact.includes("Validation confirmations: 1")
    )
  );
  assert.equal(financeItem?.assignedWorkerLabel, "Finance Lead");
  assert.ok(
    financeItem?.metrics.some((metric) => metric.includes("Paid: 2"))
  );
  assert.equal(supportItem?.assignedWorkerLabel, "Customer Support And QA Lead");
  assert.ok(
    supportItem?.artifacts.some((artifact) => artifact.includes("QA backlog: 1"))
  );
  assert.ok(
    supportItem?.metrics.some((metric) => metric.includes("Stable clients: 1"))
  );
});

test("task routing maps Northline department workflows to the correct workers and scopes", async () => {
  const { imonEngine, store } = await setupWorkspace();
  await imonEngine.bootstrap();

  const workflowCases = [
    {
      workflowId: "business-governance",
      expectedDepartment: "Executive / Management",
      expectedPosition: "General Manager / Brand Director",
      expectedRiskLevel: "high",
      expectedPublicFacing: true,
      expectedMoneyMovement: true,
      expectedVerifiedFinancialData: true,
      requestedTools: ["business-registry", "approvals", "scheduler"],
      allowedTools: ["business-registry", "approvals"],
      deniedTools: ["scheduler"]
    },
    {
      workflowId: "business-ops",
      expectedDepartment: "Operations",
      expectedPosition: "Operations Manager",
      expectedRiskLevel: "low",
      expectedPublicFacing: false,
      expectedMoneyMovement: false,
      expectedVerifiedFinancialData: false,
      requestedTools: ["scheduler", "runtime-ops", "money_movement"],
      allowedTools: ["scheduler", "runtime-ops"],
      deniedTools: ["money_movement"]
    },
    {
      workflowId: "growth-publishing",
      expectedDepartment: "Marketing / Growth",
      expectedPosition: "Growth And Marketing Manager",
      expectedRiskLevel: "medium",
      expectedPublicFacing: true,
      expectedMoneyMovement: false,
      expectedVerifiedFinancialData: false,
      requestedTools: ["growth-queue", "social-posting", "org-control-plane"],
      allowedTools: ["growth-queue", "social-posting"],
      deniedTools: ["org-control-plane"]
    },
    {
      workflowId: "product-production",
      expectedDepartment: "Product / Content",
      expectedPosition: "Product / Content Lead",
      expectedRiskLevel: "low",
      expectedPublicFacing: false,
      expectedMoneyMovement: false,
      expectedVerifiedFinancialData: false,
      requestedTools: ["qa", "reports", "growth-queue"],
      allowedTools: ["qa", "reports"],
      deniedTools: ["growth-queue"]
    },
    {
      workflowId: "finance-allocation-reporting",
      expectedDepartment: "Finance",
      expectedPosition: "Finance Lead",
      expectedRiskLevel: "high",
      expectedPublicFacing: false,
      expectedMoneyMovement: true,
      expectedVerifiedFinancialData: true,
      requestedTools: ["revenue-report", "collective-fund-report", "public_post"],
      allowedTools: ["revenue-report", "collective-fund-report"],
      deniedTools: ["public_post"]
    },
    {
      workflowId: "analytics-reporting",
      expectedDepartment: "Analytics / Research",
      expectedPosition: "Analytics And Research Lead",
      expectedRiskLevel: "low",
      expectedPublicFacing: false,
      expectedMoneyMovement: false,
      expectedVerifiedFinancialData: false,
      requestedTools: ["reports", "analytics", "public_post"],
      allowedTools: ["reports", "analytics"],
      deniedTools: ["public_post"]
    },
    {
      workflowId: "support-qa",
      expectedDepartment: "Customer Support / QA",
      expectedPosition: "Customer Support And QA Lead",
      expectedRiskLevel: "medium",
      expectedPublicFacing: true,
      expectedMoneyMovement: false,
      expectedVerifiedFinancialData: false,
      requestedTools: ["support", "qa", "growth-queue"],
      allowedTools: ["support", "qa"],
      deniedTools: ["growth-queue"]
    }
  ] as const;

  const routed = await Promise.all(
    workflowCases.map((workflow) =>
      imonEngine.routeTask({
        workflowId: workflow.workflowId,
        businessId: "auto-funding-agency",
        title: `Northline ${workflow.expectedDepartment} readiness drill`,
        summary: `Validate ${workflow.expectedDepartment} routing and worker scope for Northline.`,
        requestedTools: [...workflow.requestedTools]
      })
    )
  );
  const savedEnvelopes = new Set((await store.getTaskEnvelopes()).map((task) => task.id));

  for (const [index, workflow] of workflowCases.entries()) {
    const result = routed[index]!;

    assert.equal(result.owner?.workflowId, workflow.workflowId);
    assert.equal(result.owner?.departmentName, workflow.expectedDepartment);
    assert.equal(result.owner?.positionName, workflow.expectedPosition);
    assert.equal(result.envelope.departmentId, result.owner?.departmentId);
    assert.equal(result.envelope.positionId, result.owner?.positionId);
    assert.equal(result.approvalRoute.riskLevel, workflow.expectedRiskLevel);
    assert.equal(result.envelope.publicFacing, workflow.expectedPublicFacing);
    assert.equal(result.envelope.moneyMovement, workflow.expectedMoneyMovement);
    assert.equal(
      result.envelope.requiresVerifiedFinancialData,
      workflow.expectedVerifiedFinancialData
    );
    assert.ok(savedEnvelopes.has(result.envelope.id));
    assert.ok(
      result.envelope.allowedMemoryNamespaces.every(
        (namespace) =>
          namespace.includes("business/auto-funding-agency") &&
          !namespace.includes("business/imon-digital-asset-store") &&
          !namespace.includes("business/imon-pod-store")
      )
    );

    for (const tool of workflow.allowedTools) {
      assert.ok(result.envelope.allowedTools.includes(tool));
    }
    for (const tool of workflow.deniedTools) {
      assert.ok(!result.envelope.allowedTools.includes(tool));
    }
  }
});

test("northline department smoke runs concurrent internal drills and restores task state", async () => {
  const { config, imonEngine, store } = await setupWorkspace();
  await imonEngine.bootstrap();

  const smokeService = new NorthlineDepartmentSmokeService(config, store, imonEngine);
  const baselineTaskEnvelopes = await store.getTaskEnvelopes();
  const baselineAuditRecords = await store.getOrgAuditRecords();

  const result = await smokeService.run({ businessId: "auto-funding-agency" });

  assert.ok(result.status === "passed" || result.status === "attention");
  assert.equal(result.businessOffice.departmentCount, 7);
  assert.equal(result.departments.length, 7);
  assert.equal(result.routeDrills.attempted, 7);
  assert.equal(result.routeDrills.passed, 7);
  assert.equal(result.routeDrills.failed, 0);
  assert.equal(result.routeDrills.restoredState, true);
  assert.ok(result.departments.every((department) => department.routeDrill.status === "passed"));
  assert.deepEqual(await store.getTaskEnvelopes(), baselineTaskEnvelopes);
  assert.deepEqual(await store.getOrgAuditRecords(), baselineAuditRecords);
  assert.equal(await exists(result.artifacts.jsonPath), true);
  assert.equal(await exists(result.artifacts.markdownPath), true);

  const savedReport = await readJsonFile(result.artifacts.jsonPath, null as any);
  assert.equal(savedReport.businessId, "auto-funding-agency");
  assert.equal(savedReport.routeDrills.passed, 7);
  assert.equal(savedReport.departments.length, 7);
});

test("office template profiles map business categories into reusable office templates", () => {
  assert.equal(
    officeTemplateProfileForCategory("digital_asset_store"),
    "catalog_store"
  );
  assert.equal(
    officeTemplateProfileForCategory("print_on_demand_store"),
    "catalog_store"
  );
  assert.equal(
    officeTemplateProfileForCategory("niche_content_site"),
    "audience_brand"
  );
  assert.equal(
    officeTemplateProfileForCategory("faceless_social_brand"),
    "audience_brand"
  );
  assert.equal(
    officeTemplateProfileForCategory("micro_saas_factory"),
    "product_business"
  );
  assert.equal(
    officeTemplateProfileForCategory("client_services_agency"),
    "service_business"
  );
});

test("control-room snapshot and static export share the same source payload", async () => {
  const { imonEngine, officeDashboard, config, store } = await setupWorkspace();
  await imonEngine.bootstrap();
  await imonEngine.sync();

  const snapshotService = new ControlRoomSnapshotService(config, store);
  const liveSnapshot = await snapshotService.buildSnapshot();
  const artifacts = await officeDashboard.writeDashboard();
  const exportedSnapshot = await readJsonFile(artifacts.dataPath, null as any);

  assert.equal(exportedSnapshot.engineId, liveSnapshot.engineId);
  assert.equal(exportedSnapshot.fingerprint, liveSnapshot.fingerprint);
  assert.equal(exportedSnapshot.businesses.length, liveSnapshot.businesses.length);
  assert.equal(exportedSnapshot.executiveView.id, liveSnapshot.executiveView.id);
  assert.equal(exportedSnapshot.officeTree.id, liveSnapshot.officeTree.id);
  assert.equal(
    exportedSnapshot.departmentWorkspaces.length,
    liveSnapshot.departmentWorkspaces.length
  );
});

test("control-room compatibility upgrade restores folder views from legacy snapshots", async () => {
  const { imonEngine, config, store } = await setupWorkspace();
  await imonEngine.bootstrap();
  await imonEngine.sync();

  const snapshotService = new ControlRoomSnapshotService(config, store);
  const liveSnapshot = await snapshotService.buildSnapshot();
  const legacySnapshot = legacySnapshotFrom(liveSnapshot);

  const upgraded = normalizeControlRoomSnapshot(legacySnapshot);
  const upgradedBusiness = upgraded.businesses.find(
    (business) => business.id === "imon-digital-asset-store"
  );
  const upgradedWorkspace = upgraded.departmentWorkspaces[0];

  assert.equal(upgraded.officeTree.scope, "engine");
  assert.ok(
    upgraded.executiveView.workers.some((worker) => worker.workerType === "engine_orchestrator")
  );
  assert.ok(upgraded.executiveView.handoffs.length >= upgraded.businesses.length);
  assert.ok(upgradedBusiness?.departmentWorkspaces.length);
  assert.ok(
    upgradedBusiness?.office?.workers.some((worker) => worker.workerType === "brand_orchestrator")
  );
  assert.ok(upgradedWorkspace);
  assert.ok(upgradedWorkspace.executionItems.length > 0);
});

test("local control-room app upgrades legacy remote snapshots before rendering", async () => {
  const { imonEngine, config, store } = await setupWorkspace();
  await imonEngine.bootstrap();
  await imonEngine.sync();

  const liveSnapshot = await new ControlRoomSnapshotService(config, store).buildSnapshot();
  const legacySnapshot = legacySnapshotFrom(liveSnapshot);

  const remoteServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (url.pathname === "/login" && req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      if (params.get("password") !== "legacy-pass") {
        res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("bad password");
        return;
      }
      res.writeHead(303, {
        Location: params.get("next") ?? "/",
        "Set-Cookie": "legacy_control_room=ok; Path=/; HttpOnly"
      });
      res.end();
      return;
    }

    if ((req.headers.cookie ?? "").includes("legacy_control_room=ok") === false) {
      res.writeHead(303, { Location: "/login" });
      res.end();
      return;
    }

    if (url.pathname === "/api/control-room/snapshot") {
      const body = `${JSON.stringify(legacySnapshot, null, 2)}\n`;
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body)
      });
      res.end(body);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("missing");
  });

  await new Promise<void>((resolve) => {
    remoteServer.listen(0, "127.0.0.1", () => resolve());
  });
  const remoteAddress = remoteServer.address();
  assert.ok(remoteAddress && typeof remoteAddress === "object");

  config.controlRoom.local.bindHost = "127.0.0.1";
  config.controlRoom.local.port = 0;
  config.controlRoom.local.remoteUrl = `http://${remoteAddress.address}:${remoteAddress.port}`;
  config.controlRoom.local.tunnelEnabled = false;

  const localServer = new ControlRoomLocalServer(config);
  const localAddress = await localServer.listen();
  const localBaseUrl = `http://${localAddress.host}:${localAddress.port}`;

  try {
    const localLogin = await fetch(`${localBaseUrl}/login`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        password: "legacy-pass",
        next: "/engine"
      })
    });
    assert.equal(localLogin.status, 303);

    const localEnginePage = await fetch(`${localBaseUrl}/engine`);
    assert.equal(localEnginePage.status, 200);
    assert.match(await localEnginePage.text(), /Business Offices/i);

    const snapshotResponse = await fetch(`${localBaseUrl}/api/control-room/snapshot`);
    assert.equal(snapshotResponse.status, 200);
    const snapshot = await snapshotResponse.json();
    assert.equal(snapshot.officeTree.scope, "engine");
    assert.ok(snapshot.departmentWorkspaces.length > 0);

    const firstWorkspace = snapshot.departmentWorkspaces[0];
    assert.ok(firstWorkspace);
    const departmentResponse = await fetch(
      `${localBaseUrl}/api/control-room/department/${firstWorkspace.businessId}/${firstWorkspace.departmentId}`
    );
    assert.equal(departmentResponse.status, 200);
    const department = await departmentResponse.json();
    assert.equal(department.id, firstWorkspace.id);
  } finally {
    await localServer.close();
    await new Promise<void>((resolve, reject) => {
      remoteServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

test("office chat persists separate threads and report history for engine, business, and department scopes", async () => {
  const { imonEngine, config, store } = await setupWorkspace();
  await imonEngine.bootstrap();
  await imonEngine.sync();

  const chat = new OfficeChatService(config, store);
  const snapshotService = new ControlRoomSnapshotService(config, store);
  const snapshot = await snapshotService.buildSnapshot();
  const business =
    snapshot.businesses.find((entry) => entry.stage !== "deferred" && entry.office) ??
    snapshot.businesses.find((entry) => entry.office);
  assert.ok(business);
  const workspace = business!.departmentWorkspaces[0];
  assert.ok(workspace);

  const engineChat = await chat.getChat({ scope: "engine" });
  assert.ok(engineChat.thread.id.startsWith("office-chat-thread-"));
  const engineReport = await chat.submitMessage(
    { scope: "engine" },
    "Summarize profits and growth across the full system."
  );
  assert.equal(engineReport.thread.id, engineChat.thread.id);
  assert.ok(engineReport.actions.some((action) => action.kind === "generate_report"));
  assert.ok(engineReport.reports.length >= 1);

  const reloadedEngineChat = await chat.getChat({ scope: "engine" });
  assert.equal(reloadedEngineChat.thread.id, engineChat.thread.id);
  assert.ok(reloadedEngineChat.thread.summary.length > 0);
  assert.ok(reloadedEngineChat.summary.lastMessagePreview.length > 0);

  const businessChat = await chat.getChat({ scope: "business", businessId: business!.id });
  const departmentChat = await chat.getChat({
    scope: "department",
    businessId: workspace!.businessId,
    departmentId: workspace!.departmentId
  });
  assert.notEqual(businessChat.thread.id, engineChat.thread.id);
  assert.notEqual(departmentChat.thread.id, businessChat.thread.id);

  const refreshedSnapshot = await snapshotService.buildSnapshot();
  assert.equal(refreshedSnapshot.executiveView.chatSummary?.reportCount, 1);
});

test("office chat creates confirmable business scaffolds and applies or dismisses them", async () => {
  const { imonEngine, config, store } = await setupWorkspace();
  await imonEngine.bootstrap();
  await imonEngine.sync();

  const chat = new OfficeChatService(config, store);
  const dismissedDraft = await chat.submitMessage(
    { scope: "engine" },
    'Create a new business called "Harbor Template Vault" for marketplace design bundles.'
  );
  const dismissAction = dismissedDraft.actions.find(
    (action) => action.kind === "create_business_scaffold_draft"
  );
  assert.ok(dismissAction);
  const dismissed = await chat.dismissAction(dismissAction!.id);
  assert.equal(
    dismissed.actions.find((action) => action.id === dismissAction!.id)?.status,
    "dismissed"
  );

  const appliedDraft = await chat.submitMessage(
    { scope: "engine" },
    'Create a new business called "Cedar Service Signals" for local home service reporting.'
  );
  const applyAction = [...appliedDraft.actions].reverse().find(
    (action) =>
      action.kind === "create_business_scaffold_draft" &&
      action.status === "awaiting_confirmation"
  );
  assert.ok(applyAction);
  const applied = await chat.applyAction(applyAction!.id);
  assert.ok(applied.actions.some((action) => action.kind === "apply_business_scaffold_draft"));

  const created = await store.getManagedBusiness("cedar-service-signals");
  assert.ok(created);
  assert.equal(created?.stage, "deferred");
});

test("office chat routes risky work, persists operating config, and falls back to internal market summaries", async () => {
  const { imonEngine, config, store } = await setupWorkspace();
  await imonEngine.bootstrap();
  await imonEngine.sync();

  const chat = new OfficeChatService(config, store);
  const snapshot = await new ControlRoomSnapshotService(config, store).buildSnapshot();
  const business =
    snapshot.businesses.find((entry) => entry.stage !== "deferred" && entry.office) ??
    snapshot.businesses.find((entry) => entry.office);
  assert.ok(business);
  const workspace = business!.departmentWorkspaces[0];
  assert.ok(workspace);

  const routedBusinessChat = await chat.submitMessage(
    { scope: "business", businessId: business!.id },
    "Coordinate growth and finance to publish a launch campaign with reporting handoff notes."
  );
  const routedAction = routedBusinessChat.actions.find((action) => action.kind === "route_task");
  assert.ok(routedAction);
  assert.equal(routedAction?.status, "routed");
  const taskEnvelopes = await store.getTaskEnvelopes();
  assert.ok(taskEnvelopes.some((task) => task.id === routedAction?.taskEnvelopeIds[0]));

  const directiveChat = await chat.submitMessage(
    {
      scope: "department",
      businessId: workspace!.businessId,
      departmentId: workspace!.departmentId
    },
    "Add a prompt directive to favor bolder utility-first concepts and sharper hooks."
  );
  assert.ok(
    directiveChat.operatingConfig.promptDirectives.some((directive) =>
      directive.includes("bolder utility-first concepts")
    )
  );

  const scheduleChat = await chat.submitMessage(
    {
      scope: "department",
      businessId: workspace!.businessId,
      departmentId: workspace!.departmentId
    },
    "Update the posting schedule to Tuesdays and Fridays at 9 AM Eastern."
  );
  const scheduleOverride = scheduleChat.operatingConfig.scheduleOverride;
  assert.ok(scheduleOverride);
  assert.ok((scheduleOverride.cadence ?? "").includes("Tuesdays"));
  assert.ok(scheduleOverride.preferredWindows.includes("9 AM"));

  const briefChat = await chat.submitMessage(
    {
      scope: "department",
      businessId: workspace!.businessId,
      departmentId: workspace!.departmentId
    },
    "Create a worker brief to produce three fresh design concepts for the next campaign."
  );
  assert.ok(
    briefChat.actions.some(
      (action) => action.kind === "create_execution_brief" && action.status === "routed"
    )
  );

  const marketChat = await chat.submitMessage(
    { scope: "business", businessId: business!.id },
    "Generate market data and competitor trends for this business."
  );
  const latestReport = marketChat.reports.at(-1);
  assert.ok(latestReport);
  const markdown = await readTextFile(latestReport!.markdownPath);
  assert.match(markdown, /internal signals only/i);
});

test("control-room server enforces auth and serves page, api, and stream routes", async () => {
  const { imonEngine, config, store } = await setupWorkspace();
  await imonEngine.bootstrap();
  await imonEngine.sync();

  config.controlRoom.bindHost = "127.0.0.1";
  config.controlRoom.port = 0;
  config.controlRoom.sessionSecret = "test-control-room-secret";
  config.controlRoom.passwordHash = await hashControlRoomPassword("control-room-pass");

  const server = new ControlRoomServer(config, store);
  const address = await server.listen();
  const baseUrl = `http://${address.host}:${address.port}`;

  const unauthenticated = await fetch(`${baseUrl}/`, {
    redirect: "manual"
  });
  assert.equal(unauthenticated.status, 303);
  assert.equal(unauthenticated.headers.get("location")?.startsWith("/login"), true);

  const loginPage = await fetch(`${baseUrl}/login`);
  assert.equal(loginPage.status, 200);
  assert.match(await loginPage.text(), /Owner password/i);

  const login = await fetch(`${baseUrl}/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      password: "control-room-pass",
      next: "/"
    })
  });
  assert.equal(login.status, 303);
  const cookie = login.headers.get("set-cookie");
  assert.ok(cookie?.includes("control_room_session="));

  const businessPage = await fetch(`${baseUrl}/business/imon-digital-asset-store`, {
    headers: {
      cookie: cookie ?? ""
    }
  });
  assert.equal(businessPage.status, 200);
  assert.match(await businessPage.text(), /ImonEngine Control Room/i);

  const enginePage = await fetch(`${baseUrl}/engine`, {
    headers: {
      cookie: cookie ?? ""
    }
  });
  assert.equal(enginePage.status, 200);
  const enginePageHtml = await enginePage.text();
  assert.match(enginePageHtml, /Folder-Style Office Explorer/i);
  assert.match(enginePageHtml, /Approval Actions/i);

  const snapshotResponse = await fetch(`${baseUrl}/api/control-room/snapshot`, {
    headers: {
      cookie: cookie ?? ""
    }
  });
  assert.equal(snapshotResponse.status, 200);
  const snapshot = await snapshotResponse.json();
  assert.equal(snapshot.engineName, "ImonEngine");
  assert.equal(snapshot.officeTree.scope, "engine");

  const engineChatResponse = await fetch(`${baseUrl}/api/control-room/chat/engine`, {
    headers: {
      cookie: cookie ?? ""
    }
  });
  assert.equal(engineChatResponse.status, 200);
  const engineChat = await engineChatResponse.json();
  assert.ok(engineChat.thread.id.startsWith("office-chat-thread-"));

  const engineChatPost = await fetch(`${baseUrl}/api/control-room/chat/engine`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: cookie ?? ""
    },
    body: JSON.stringify({
      message: "Summarize profits and growth for the full system."
    })
  });
  assert.equal(engineChatPost.status, 200);
  const postedEngineChat = await engineChatPost.json();
  assert.ok(
    postedEngineChat.actions.some((action: { kind: string }) => action.kind === "generate_report")
  );

  const firstWorkspace = snapshot.departmentWorkspaces[0];
  assert.ok(firstWorkspace);
  const departmentResponse = await fetch(
    `${baseUrl}/api/control-room/department/${firstWorkspace.businessId}/${firstWorkspace.departmentId}`,
    {
      headers: {
        cookie: cookie ?? ""
      }
    }
  );
  assert.equal(departmentResponse.status, 200);
  const department = await departmentResponse.json();
  assert.equal(department.id, firstWorkspace.id);
  assert.ok(Array.isArray(department.executionItems));

  const healthResponse = await fetch(`${baseUrl}/api/control-room/health`);
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.authConfigured, true);

  const streamResponse = await fetch(`${baseUrl}/api/control-room/stream`, {
    headers: {
      cookie: cookie ?? ""
    }
  });
  assert.equal(streamResponse.status, 200);
  const reader = streamResponse.body?.getReader();
  const firstChunk = await reader?.read();
  const textChunk = firstChunk?.value
    ? Buffer.from(firstChunk.value).toString("utf8")
    : "";
  assert.match(textChunk, /event: snapshot/);
  await reader?.cancel();
  await server.close();
});

test("control-room server command routes mutate state through the control plane", async () => {
  const { imonEngine, config, store } = await setupWorkspace();
  await imonEngine.bootstrap();
  await imonEngine.sync();

  config.controlRoom.bindHost = "127.0.0.1";
  config.controlRoom.port = 0;
  config.controlRoom.sessionSecret = "test-control-room-secret";
  config.controlRoom.passwordHash = await hashControlRoomPassword("control-room-pass");

  const server = new ControlRoomServer(config, store);
  const address = await server.listen();
  const baseUrl = `http://${address.host}:${address.port}`;

  const login = await fetch(`${baseUrl}/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      password: "control-room-pass",
      next: "/"
    })
  });
  const cookie = login.headers.get("set-cookie") ?? "";

  const activate = await fetch(`${baseUrl}/api/control-room/commands/activate-business`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie
    },
    body: JSON.stringify({ businessId: "imon-digital-asset-store" })
  });
  assert.equal(activate.status, 200);
  const activatedBody = await activate.json();
  assert.equal(activatedBody.business.stage, "active");

  const routeTask = await fetch(`${baseUrl}/api/control-room/commands/route-task`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie
    },
    body: JSON.stringify({
      businessId: "imon-digital-asset-store",
      workflowId: "store-autopilot",
      title: "Operator review",
      summary: "Inspect the next launch queue for duplicate offers.",
      riskLevel: "medium"
    })
  });
  assert.equal(routeTask.status, 200);
  const routedBody = await routeTask.json();
  assert.equal(routedBody.routed.envelope.businessId, "imon-digital-asset-store");
  assert.ok(routedBody.routed.envelope.departmentId);
  assert.ok(routedBody.routed.envelope.positionId);

  const resolveRightsApproval = await fetch(
    `${baseUrl}/api/control-room/commands/resolve-approval`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie
      },
      body: JSON.stringify({
        approvalId: "approval-clipbaiters-viral-moments",
        approvedBy: "owner@example.org"
      })
    }
  );
  assert.equal(resolveRightsApproval.status, 200);
  const resolvedRightsBody = await resolveRightsApproval.json();
  assert.equal(resolvedRightsBody.handledBy, "clipbaiters-rights-policy");

  const resolveLaneApproval = await fetch(
    `${baseUrl}/api/control-room/commands/resolve-approval`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie
      },
      body: JSON.stringify({
        approvalId: "approval-clipbaiters-lane-posture-clipbaiters-viral-moments",
        approvedBy: "owner@example.org"
      })
    }
  );
  assert.equal(resolveLaneApproval.status, 200);
  const resolvedLaneBody = await resolveLaneApproval.json();
  assert.equal(resolvedLaneBody.handledBy, "clipbaiters-lane-posture");

  const pause = await fetch(`${baseUrl}/api/control-room/commands/pause-business`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie
    },
    body: JSON.stringify({ businessId: "imon-digital-asset-store" })
  });
  assert.equal(pause.status, 200);
  const pausedBody = await pause.json();
  assert.equal(pausedBody.business.stage, "paused");

  const approvals = await store.getApprovals();
  assert.equal(
    approvals.find((task) => task.id === "approval-clipbaiters-viral-moments")?.status,
    "completed"
  );
  assert.equal(
    approvals.find((task) => task.id === "approval-clipbaiters-lane-posture-clipbaiters-viral-moments")?.status,
    "completed"
  );

  await server.close();
});

test("local control-room app signs into the VPS control room and proxies read/write actions", async () => {
  const { imonEngine, config, store } = await setupWorkspace();
  await imonEngine.bootstrap();
  await imonEngine.sync();

  config.controlRoom.bindHost = "127.0.0.1";
  config.controlRoom.port = 0;
  config.controlRoom.sessionSecret = "test-control-room-secret";
  config.controlRoom.passwordHash = await hashControlRoomPassword("control-room-pass");

  const remoteServer = new ControlRoomServer(config, store);
  const remoteAddress = await remoteServer.listen();
  const remoteBaseUrl = `http://${remoteAddress.host}:${remoteAddress.port}`;

  config.controlRoom.local.bindHost = "127.0.0.1";
  config.controlRoom.local.port = 0;
  config.controlRoom.local.remoteUrl = remoteBaseUrl;
  config.controlRoom.local.tunnelEnabled = false;

  const localServer = new ControlRoomLocalServer(config);
  const localAddress = await localServer.listen();
  const localBaseUrl = `http://${localAddress.host}:${localAddress.port}`;

  const localLogin = await fetch(`${localBaseUrl}/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      password: "control-room-pass",
      next: "/"
    })
  });
  assert.equal(localLogin.status, 303);

  const localHome = await fetch(`${localBaseUrl}/`);
  assert.equal(localHome.status, 200);
  assert.match(await localHome.text(), /Local Operator App/i);

  const localEnginePage = await fetch(`${localBaseUrl}/engine`);
  assert.equal(localEnginePage.status, 200);
  const localEngineHtml = await localEnginePage.text();
  assert.match(localEngineHtml, /Folder-Style Office Explorer/i);
  assert.match(localEngineHtml, /Approval Actions/i);

  const snapshotResponse = await fetch(`${localBaseUrl}/api/control-room/snapshot`);
  assert.equal(snapshotResponse.status, 200);
  const snapshot = await snapshotResponse.json();
  assert.equal(snapshot.engineName, "ImonEngine");
  assert.equal(snapshot.officeTree.scope, "engine");

  const engineChatResponse = await fetch(`${localBaseUrl}/api/control-room/chat/engine`);
  assert.equal(engineChatResponse.status, 200);
  const engineChat = await engineChatResponse.json();
  assert.ok(engineChat.thread.id.startsWith("office-chat-thread-"));

  const engineChatPost = await fetch(`${localBaseUrl}/api/control-room/chat/engine`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: "Summarize profits and growth for the full system."
    })
  });
  assert.equal(engineChatPost.status, 200);
  const postedEngineChat = await engineChatPost.json();
  assert.ok(
    postedEngineChat.actions.some((action: { kind: string }) => action.kind === "generate_report")
  );

  const firstWorkspace = snapshot.departmentWorkspaces[0];
  assert.ok(firstWorkspace);
  const departmentResponse = await fetch(
    `${localBaseUrl}/api/control-room/department/${firstWorkspace.businessId}/${firstWorkspace.departmentId}`
  );
  assert.equal(departmentResponse.status, 200);
  const department = await departmentResponse.json();
  assert.equal(department.id, firstWorkspace.id);
  assert.ok(Array.isArray(department.executionItems));

  const commandResponse = await fetch(`${localBaseUrl}/api/control-room/commands/engine-sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: "{}"
  });
  assert.equal(commandResponse.status, 200);
  const commandBody = await commandResponse.json();
  assert.equal(commandBody.status, "ok");
  assert.ok(commandBody.report.recommendedConcurrency >= 1);

  const resolveApprovalResponse = await fetch(
    `${localBaseUrl}/api/control-room/commands/resolve-approval`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        approvalId: "approval-clipbaiters-viral-moments",
        approvedBy: "owner@example.org"
      })
    }
  );
  assert.equal(resolveApprovalResponse.status, 200);
  const resolveApprovalBody = await resolveApprovalResponse.json();
  assert.equal(resolveApprovalBody.handledBy, "clipbaiters-rights-policy");

  await localServer.close();
  await remoteServer.close();
});

test("local control-room app still serves the login page when tunnel bootstrap fails", async () => {
  const touchedKeys = ["IMON_ENGINE_VPS_HOST", "IMON_ENGINE_VPS_PASSWORD", "IMON_ENGINE_HOST_PASSWORD"] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  try {
    for (const key of touchedKeys) {
      delete process.env[key];
    }

    const { imonEngine, config, store } = await setupWorkspace();
    await imonEngine.bootstrap();
    await imonEngine.sync();

    config.projectRoot = process.cwd();
    config.controlRoom.bindHost = "127.0.0.1";
    config.controlRoom.port = 41779;
    config.controlRoom.local.bindHost = "127.0.0.1";
    config.controlRoom.local.port = 0;
    config.controlRoom.local.remoteUrl = `http://127.0.0.1:${config.controlRoom.local.tunnelLocalPort}`;
    config.controlRoom.local.tunnelEnabled = true;

    const localServer = new ControlRoomLocalServer(config);
    const localAddress = await localServer.listen();
    const localBaseUrl = `http://${localAddress.host}:${localAddress.port}`;

    const loginPage = await fetch(`${localBaseUrl}/login`);
    assert.equal(loginPage.status, 200);
    const loginHtml = await loginPage.text();
    assert.match(loginHtml, /Control Room Login/i);
    assert.match(loginHtml, /could not open the VPS tunnel/i);

    const loginAttempt = await fetch(`${localBaseUrl}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        password: "control-room-pass",
        next: "/"
      })
    });
    assert.equal(loginAttempt.status, 503);
    assert.match(await loginAttempt.text(), /IMON_ENGINE_VPS_HOST or IMON_ENGINE_VPS_PASSWORD is missing/i);

    await localServer.close();
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("control-room health degrades cleanly when the office snapshot is missing", async () => {
  const { config, store } = await setupWorkspace();
  const snapshotService = new ControlRoomSnapshotService(config, store);
  const health = await snapshotService.getHealthReport();

  assert.equal(health.status, "degraded");
  assert.equal(health.snapshotReady, false);
  assert.ok(health.issues.some((issue) => issue.includes("office snapshot")));
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

test("store ops allow one reserve brief when the catalog queue is empty", async () => {
  const { storeOps } = await setupWorkspace();
  const now = new Date().toISOString();
  const packs = [
    { id: "p1", assetType: "wallpaper_pack", status: "published", niche: "One", title: "One", createdAt: now, updatedAt: now, publishedAt: now },
    { id: "p2", assetType: "texture_pack", status: "published", niche: "Two", title: "Two", createdAt: now, updatedAt: now, publishedAt: now },
    { id: "p3", assetType: "icon_pack", status: "published", niche: "Three", title: "Three", createdAt: now, updatedAt: now, publishedAt: now }
  ] as any;

  const policy = await storeOps.ensureCatalogPolicy();
  const control = await storeOps.getCatalogControlState(packs, { ...policy, maxNewPacksPer7Days: 2, maxOpenPackQueue: 2 });

  assert.equal(control.openQueueCount, 0);
  assert.equal(control.createdLast7Days, 3);
  assert.equal(control.publishedLast7Days, 3);
  assert.equal(control.canSeedMore, true);
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

test("store ops scaffold ClipBaiters with one alias, one optional Facebook placeholder, and five niche YouTube channels", async () => {
  const { storeOps } = await setupWorkspace();

  const profiles = await storeOps.ensureSocialProfiles("clipbaiters-viral-moments");
  const gmailAlias = profiles.find((profile) => profile.platform === "gmail_alias");
  const facebookPage = profiles.find((profile) => profile.platform === "facebook_page");
  const youtubeChannels = profiles.filter((profile) => profile.platform === "youtube_channel");

  assert.equal(gmailAlias?.brandName, "ClipBaiters - Viral Moments");
  assert.equal(gmailAlias?.emailAlias, "imonengine+clipbaitersviralmoments@gmail.com");
  assert.equal(facebookPage?.status, "planned");
  assert.ok(facebookPage?.notes.some((note) => note.includes("optional umbrella Facebook Page")));
  assert.equal(youtubeChannels.length, 5);
  assert.deepEqual(
    youtubeChannels.map((profile) => profile.laneId).sort(),
    [
      "clipbaiters-animated",
      "clipbaiters-celebs",
      "clipbaiters-media",
      "clipbaiters-political",
      "clipbaiters-streaming"
    ]
  );
  assert.ok(youtubeChannels.every((profile) => profile.role === "niche_lane"));
  assert.ok(youtubeChannels.every((profile) => profile.emailAlias === gmailAlias?.emailAlias));
  assert.ok(youtubeChannels.every((profile) => profile.parentProfileId === gmailAlias?.id));
  assert.equal(profiles.filter((profile) => profile.platform === "instagram_account").length, 0);
  assert.equal(profiles.filter((profile) => profile.platform === "meta_business").length, 0);
});

test("store ops hydrate ClipBaiters channel bindings and active lanes from env without adding account sprawl", async () => {
  const touchedKeys = [
    "CLIPBAITERS_SHARED_ALIAS_EMAIL",
    "CLIPBAITERS_FACEBOOK_PAGE_URL",
    "CLIPBAITERS_FACEBOOK_PAGE_ID",
    "CLIPBAITERS_YOUTUBE_POLITICAL_CHANNEL_URL",
    "CLIPBAITERS_YOUTUBE_POLITICAL_CHANNEL_ID",
    "CLIPBAITERS_YOUTUBE_MEDIA_CHANNEL_URL",
    "CLIPBAITERS_YOUTUBE_MEDIA_CHANNEL_ID",
    "CLIPBAITERS_ACTIVE_LANES"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  try {
    process.env.CLIPBAITERS_SHARED_ALIAS_EMAIL = "clips@example.com";
    process.env.CLIPBAITERS_FACEBOOK_PAGE_URL = "https://www.facebook.com/profile.php?id=61500000000000";
    process.env.CLIPBAITERS_FACEBOOK_PAGE_ID = "61500000000000";
    process.env.CLIPBAITERS_YOUTUBE_POLITICAL_CHANNEL_URL = "https://www.youtube.com/@clipbaiterspolitical";
    process.env.CLIPBAITERS_YOUTUBE_POLITICAL_CHANNEL_ID = "UCpolitical123";
    process.env.CLIPBAITERS_YOUTUBE_MEDIA_CHANNEL_URL = "https://www.youtube.com/@clipbaitersmedia";
    process.env.CLIPBAITERS_YOUTUBE_MEDIA_CHANNEL_ID = "UCmedia123";
    process.env.CLIPBAITERS_ACTIVE_LANES = "clipbaiters-political,clipbaiters-media";

    const { imonEngine, storeOps, clipbaitersStudio } = await setupWorkspace();
    await imonEngine.bootstrap();
    const profiles = await storeOps.ensureSocialProfiles("clipbaiters-viral-moments");
    const planResult = await clipbaitersStudio.writePlan({ businessId: "clipbaiters-viral-moments" });
    const plan = planResult.plan;
    const gmailAlias = profiles.find((profile) => profile.platform === "gmail_alias");
    const facebookPage = profiles.find((profile) => profile.platform === "facebook_page");
    const politicalChannel = profiles.find(
      (profile) => profile.platform === "youtube_channel" && profile.laneId === "clipbaiters-political"
    );
    const mediaChannel = profiles.find(
      (profile) => profile.platform === "youtube_channel" && profile.laneId === "clipbaiters-media"
    );
    const streamingChannel = profiles.find(
      (profile) => profile.platform === "youtube_channel" && profile.laneId === "clipbaiters-streaming"
    );

    assert.equal(gmailAlias?.emailAlias, "clips@example.com");
    assert.equal(facebookPage?.status, "live");
    assert.equal(facebookPage?.profileUrl, "https://www.facebook.com/profile.php?id=61500000000000");
    assert.equal(facebookPage?.externalId, "61500000000000");
    assert.equal(politicalChannel?.status, "live");
    assert.equal(politicalChannel?.profileUrl, "https://www.youtube.com/@clipbaiterspolitical");
    assert.equal(politicalChannel?.externalId, "UCpolitical123");
    assert.equal(politicalChannel?.handle, "clipbaiterspolitical");
    assert.equal(mediaChannel?.status, "live");
    assert.equal(mediaChannel?.profileUrl, "https://www.youtube.com/@clipbaitersmedia");
    assert.equal(mediaChannel?.externalId, "UCmedia123");
    assert.equal(streamingChannel?.status, "planned");
    assert.deepEqual(plan.laneRegistry.activeLaneIds, ["clipbaiters-political", "clipbaiters-media"]);
    assert.ok(
      plan.socialPresence.some(
        (profile) =>
          profile.platform === "youtube_channel" &&
          profile.laneId === "clipbaiters-political" &&
          profile.profileUrl === "https://www.youtube.com/@clipbaiterspolitical"
      )
    );
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("store ops promote Northline social profiles to live when public URLs are configured", async () => {
  const touchedKeys = ["NORTHLINE_FACEBOOK_URL", "NORTHLINE_INSTAGRAM_URL"] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  try {
    process.env.NORTHLINE_FACEBOOK_URL = "https://www.facebook.com/profile.php?id=61577559887468";
    process.env.NORTHLINE_INSTAGRAM_URL = "https://www.instagram.com/northlinegrowth/";

    const { storeOps } = await setupWorkspace();
    const profiles = await storeOps.ensureSocialProfiles("auto-funding-agency");
    const metaBusiness = profiles.find((profile) => profile.platform === "meta_business");
    const facebookPage = profiles.find((profile) => profile.platform === "facebook_page");
    const instagramAccount = profiles.find((profile) => profile.platform === "instagram_account");

    assert.equal(metaBusiness?.status, "live");
    assert.equal(metaBusiness?.externalId, "1042144572314434");
    assert.equal(facebookPage?.status, "live");
    assert.equal(facebookPage?.profileUrl, "https://www.facebook.com/profile.php?id=61577559887468");
    assert.equal(facebookPage?.externalId, "61577559887468");
    assert.equal(instagramAccount?.status, "live");
    assert.equal(instagramAccount?.profileUrl, "https://www.instagram.com/northlinegrowth/");
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("store ops refreshGrowthQueue future-dates newly planned growth posts", async () => {
  const { storeOps, imonEngine } = await setupWorkspace();
  await imonEngine.bootstrap();
  await storeOps.ensureSocialProfiles();
  const now = new Date().toISOString();
  const startedAt = Date.now();
  const queue = await storeOps.refreshGrowthQueue([
    {
      id: "published-pack",
      businessId: "imon-digital-asset-store",
      marketplace: "gumroad",
      niche: "Paper textures",
      assetType: "texture_pack",
      style: "quiet matte grain",
      audience: "brand designers",
      title: "Paper Texture Pack",
      shortDescription: "A quiet texture pack for brand work.",
      description: "A quiet texture pack for brand work.",
      packSize: 24,
      suggestedPrice: 12,
      priceVariants: [9, 12, 15],
      tags: ["texture"],
      deliverables: ["24 textures"],
      promptSeeds: ["Seed"],
      productionChecklist: ["Build"],
      listingChecklist: ["Publish"],
      outputDir: "C:\\temp\\pack",
      status: "published",
      productUrl: "https://example.com/paper-texture-pack",
      createdAt: now,
      updatedAt: now,
      publishedAt: now
    }
  ] as any);

  const planned = queue.filter((item) => item.status === "planned");
  assert.ok(planned.length > 0);
  assert.ok(planned.every((item) => new Date(item.scheduledFor).getTime() > startedAt));
});

test("store ops refreshGrowthQueue preserves planned work for other businesses", async () => {
  const { storeOps, store, imonEngine } = await setupWorkspace();
  await imonEngine.bootstrap();
  await storeOps.ensureSocialProfiles();
  const now = new Date().toISOString();

  await store.saveGrowthWorkItem({
    id: "northline-promo-item",
    businessId: "auto-funding-agency",
    packId: "auto-funding-agency-social-post-1",
    channel: "facebook_page",
    title: "Northline promo",
    caption: "Northline promo caption",
    assetPath: "",
    destinationUrl: "https://northlinegrowthsystems.com/book.html",
    scheduledFor: "2026-04-06T14:00:00.000Z",
    status: "planned",
    notes: ["Generated from the Northline social plan."],
    createdAt: now,
    updatedAt: now
  });

  await storeOps.refreshGrowthQueue([
    {
      id: "published-pack",
      businessId: "imon-digital-asset-store",
      marketplace: "gumroad",
      niche: "Paper textures",
      assetType: "texture_pack",
      style: "quiet matte grain",
      audience: "brand designers",
      title: "Paper Texture Pack",
      shortDescription: "A quiet texture pack for brand work.",
      description: "A quiet texture pack for brand work.",
      packSize: 24,
      suggestedPrice: 12,
      priceVariants: [9, 12, 15],
      tags: ["texture"],
      deliverables: ["24 textures"],
      promptSeeds: ["Seed"],
      productionChecklist: ["Build"],
      listingChecklist: ["Publish"],
      outputDir: "C:\\temp\\pack",
      status: "published",
      productUrl: "https://example.com/paper-texture-pack",
      createdAt: now,
      updatedAt: now,
      publishedAt: now
    }
  ] as any);

  const refreshedQueue = await store.getGrowthQueue();
  assert.ok(refreshedQueue.some((item) => item.id === "northline-promo-item"));
});

test("northline ops seed the shared growth queue with Facebook-ready promotion posts", async () => {
  const touchedKeys = [
    "NORTHLINE_SITE_URL",
    "NORTHLINE_BOOKING_URL",
    "NORTHLINE_FACEBOOK_URL",
    "NORTHLINE_INSTAGRAM_URL"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  try {
    process.env.NORTHLINE_SITE_URL = "https://northlinegrowthsystems.com";
    process.env.NORTHLINE_BOOKING_URL = "/book.html";
    process.env.NORTHLINE_FACEBOOK_URL = "https://www.facebook.com/profile.php?id=61577559887468";
    process.env.NORTHLINE_INSTAGRAM_URL = "https://www.instagram.com/northlinegrowth/";

    const { imonEngine, northlineOps, store } = await setupWorkspace();
    await imonEngine.bootstrap();

    const result = await northlineOps.refreshPromotionQueue({ businessId: "auto-funding-agency" });
    const queue = await store.getGrowthQueue();
    const plannedPosts = result.queuedItems.filter((item) => item.status === "planned");

    assert.ok(plannedPosts.length > 0);
    assert.ok(plannedPosts.some((item) => item.channel === "facebook_page"));
    assert.ok(plannedPosts.some((item) => item.channel === "instagram_account"));
    assert.ok(plannedPosts.every((item) => item.destinationUrl === "https://northlinegrowthsystems.com/book.html"));
    assert.ok(plannedPosts.every((item) => item.notes.includes("Generated from the Northline social plan.")));
    assert.ok(plannedPosts.every((item) => item.assetPath.length > 0));
    assert.ok(plannedPosts.every((item) => item.assetUrl?.startsWith("https://northlinegrowthsystems.com/social/") ?? false));
    assert.ok((await Promise.all(plannedPosts.map((item) => exists(item.assetPath)))).every(Boolean));
    assert.ok(queue.some((item) => item.businessId === "auto-funding-agency" && item.channel === "facebook_page"));
    assert.ok(queue.some((item) => item.businessId === "auto-funding-agency" && item.channel === "instagram_account"));
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("store autopilot refreshes stale attempted growth items instead of leaving them as the active queue", async () => {
  const { root, config, store, storeOps, storeAutopilot, imonEngine } = await setupWorkspace();
  await imonEngine.bootstrap();
  await storeOps.ensureSocialProfiles();
  const now = new Date().toISOString();
  const publishedPack = {
    id: "published-pack",
    businessId: "imon-digital-asset-store",
    marketplace: "gumroad",
    niche: "Paper textures",
    assetType: "texture_pack",
    style: "quiet matte grain",
    audience: "brand designers",
    title: "Paper Texture Pack",
    shortDescription: "A quiet texture pack for brand work.",
    description: "A quiet texture pack for brand work.",
    packSize: 24,
    suggestedPrice: 12,
    priceVariants: [9, 12, 15],
    tags: ["texture"],
    deliverables: ["24 textures"],
    promptSeeds: ["Seed"],
    productionChecklist: ["Build"],
    listingChecklist: ["Publish"],
    outputDir: path.join(config.assetStoreDir, "published-pack"),
    status: "published",
    productUrl: "https://example.com/paper-texture-pack",
    createdAt: now,
    updatedAt: now,
    publishedAt: now
  } as any;
  await store.saveAssetPack(publishedPack);

  const marketingDir = path.join(config.outputDir, "marketing", publishedPack.id);
  await mkdir(marketingDir, { recursive: true });
  await writeFile(path.join(marketingDir, "teaser-square.png"), "img", "utf8");
  await writeFile(path.join(marketingDir, "teaser-landscape.png"), "img", "utf8");
  await writeFile(
    path.join(config.outputDir, "marketing", "manifest.json"),
    JSON.stringify(
      [
        {
          packId: publishedPack.id,
          square: path.join(marketingDir, "teaser-square.png"),
          landscape: path.join(marketingDir, "teaser-landscape.png")
        }
      ],
      null,
      2
    ),
    "utf8"
  );

  await store.saveGrowthWorkItem({
    id: "stale-facebook-item",
    businessId: "imon-digital-asset-store",
    packId: publishedPack.id,
    channel: "facebook_page",
    title: "Paper Texture Pack on facebook_page",
    caption: "caption",
    assetPath: path.join(marketingDir, "teaser-square.png"),
    destinationUrl: publishedPack.productUrl,
    scheduledFor: "2026-03-01T13:00:00.000Z",
    status: "planned",
    notes: [
      "Generated by the repo-controlled store ops service.",
      "Attempted on 2026-03-01T13:09:00.000Z: Timed out waiting for browser condition."
    ],
    createdAt: "2026-03-01T12:00:00.000Z",
    updatedAt: "2026-03-01T13:09:00.000Z"
  });

  const result = await (storeAutopilot as any).refreshStoreOpsArtifacts([publishedPack]);
  const refreshedQueue = await store.getGrowthQueue();

  assert.ok(result);
  assert.match(result.summary, /Refreshed the store growth queue/i);
  assert.ok(result.details.some((detail: string) => detail.includes("Rescheduled stale attempted queue items")));
  assert.ok(refreshedQueue.every((item) => item.id !== "stale-facebook-item"));
  assert.ok(refreshedQueue.filter((item) => item.status === "planned").every((item) => item.scheduledFor > now));
  assert.ok(await exists(path.join(root, "runtime", "storefront-site", "index.html")));
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

test("buildStorefrontSite creates an owned catalog surface with Gumroad checkout links and deployment notes", async () => {
  process.env.IMON_STORE_SITE_URL = "https://store.example.com";
  process.env.IMON_STORE_EMAIL_CAPTURE_ACTION = "https://forms.example.com/imon";
  process.env.IMON_STORE_EMAIL_CAPTURE_EMAIL = "store@example.com";
  process.env.NORTHLINE_SALES_EMAIL = "northline@example.com";

  try {
    const { config, store, imonEngine, digitalAssetFactory, storeOps } = await setupWorkspace();
    await imonEngine.bootstrap();
    await storeOps.ensureSocialProfiles();
    const seeded = await digitalAssetFactory.seedStarterQueue();
    await digitalAssetFactory.publishPack(seeded[0]!.id, "https://imonengine.gumroad.com/l/test-pack");

    const result = await buildStorefrontSite(config, store);
    const html = await readTextFile(result.htmlPath);
    const notes = await readTextFile(result.notesPath);
    const catalog = await readJsonFile<any>(result.catalogPath, null);
    const sitemap = await readTextFile(result.sitemapPath!);

    assert.equal(result.captureMode, "form");
    assert.equal(result.publishedCount, 1);
    assert.equal(config.storefront.emailCaptureEmail, "store@example.com");
    assert.ok(html.includes("View on Gumroad"));
    assert.ok(html.includes("Get launch notes"));
    assert.ok(notes.includes("Storefront Deployment Notes"));
    assert.equal(catalog.products.length, 1);
    assert.ok(sitemap.includes("https://store.example.com"));
  } finally {
    delete process.env.IMON_STORE_SITE_URL;
    delete process.env.IMON_STORE_EMAIL_CAPTURE_ACTION;
    delete process.env.IMON_STORE_EMAIL_CAPTURE_EMAIL;
    delete process.env.NORTHLINE_SALES_EMAIL;
  }
});

test("venture studio builds weekly launch windows and brand blueprints from the live template", async () => {
  const { imonEngine, storeOps, ventureStudio } = await setupWorkspace();
  await imonEngine.bootstrap();
  await storeOps.ensureSocialProfiles();
  await storeOps.ensureSocialProfiles("imon-pod-store", "Imonic");

  const snapshot = await ventureStudio.buildSnapshot();
  const clipbaitersBlueprint = snapshot.blueprints.find(
    (blueprint) => blueprint.businessId === "clipbaiters-viral-moments"
  );
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
  assert.ok(clipbaitersBlueprint);
  assert.equal(clipbaitersBlueprint?.socialArchitecture.instagramStrategy, "deferred");
  assert.equal(
    clipbaitersBlueprint?.socialArchitecture.accountPlan.find((plan) => plan.platform === "youtube_channel")?.quantity,
    5
  );
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

test("clipbaiters studio writes a lane registry, source registry, and planning dossier", async () => {
  const { imonEngine, clipbaitersStudio, store } = await setupWorkspace();
  await imonEngine.bootstrap();

  const result = await clipbaitersStudio.writePlan({
    businessId: "clipbaiters-viral-moments"
  });
  const updatedBusiness = await store.getManagedBusiness("clipbaiters-viral-moments");
  const planMarkdown = await readTextFile(result.artifacts.planMarkdownPath);

  assert.equal(result.plan.businessName, "ClipBaiters - Viral Moments");
  assert.equal(result.plan.primaryEditorialLaneId, "clipbaiters-political");
  assert.equal(result.plan.primaryRevenueLaneId, "clipbaiters-streaming");
  assert.deepEqual(result.plan.laneRegistry.activeLaneIds, ["clipbaiters-political", "clipbaiters-media"]);
  assert.equal(result.plan.laneRegistry.lanes.length, 5);
  assert.ok(result.plan.socialPresence.some((profile) => profile.platform === "gmail_alias"));
  assert.ok(
    result.plan.socialPresence.some(
      (profile) => profile.platform === "youtube_channel" && profile.laneId === "clipbaiters-political"
    )
  );
  assert.ok(result.plan.roadblocks.some((roadblock) => roadblock.id === "rights-and-review-policy"));
  assert.ok(await exists(result.artifacts.planJsonPath));
  assert.ok(await exists(result.artifacts.laneRegistryPath));
  assert.ok(await exists(result.artifacts.sourceRegistryPath));
  assert.ok(await exists(result.artifacts.feedReadmePath));
  assert.ok(planMarkdown.includes("ClipBaiters Planning Dossier"));
  assert.ok(planMarkdown.includes("ClipBaitersMedia"));
  assert.ok(planMarkdown.includes("ClipBaitersStreaming"));
  assert.equal(updatedBusiness?.stage, "scaffolded");
  assert.ok(
    updatedBusiness?.launchBlockers.some((blocker) => blocker.includes("rights-cleared and creator-authorized"))
  );
  assert.ok(
    updatedBusiness?.notes.some((note) => note.includes("runtime/ops/clipbaiters/clipbaiters-viral-moments"))
  );
});

test("clipbaiters policy approval writes artifacts and closes the business approval task", async () => {
  const { imonEngine, clipbaitersStudio, store } = await setupWorkspace();
  await imonEngine.bootstrap();

  const result = await clipbaitersStudio.approveRightsReviewPolicy({
    businessId: "clipbaiters-viral-moments",
    approvedBy: "owner@example.org"
  });
  await imonEngine.sync();

  const updatedBusiness = await store.getManagedBusiness("clipbaiters-viral-moments");
  const approvals = await store.getApprovals();
  const businessApproval = approvals.find((task) => task.id === "approval-clipbaiters-viral-moments");
  const approvalMarkdown = await readTextFile(result.artifacts.approvalMarkdownPath);

  assert.ok(await exists(result.artifacts.approvalStatePath));
  assert.ok(await exists(result.artifacts.approvalMarkdownPath));
  assert.equal(result.plan.businessName, "ClipBaiters - Viral Moments");
  assert.ok(!result.plan.roadblocks.some((roadblock) => roadblock.id === "rights-and-review-policy"));
  assert.ok(approvalMarkdown.includes("ClipBaiters Rights And Fair-Use Approval"));
  assert.ok(approvalMarkdown.includes("owner@example.org"));
  assert.ok(
    !(updatedBusiness?.launchBlockers ?? []).some((blocker) => blocker.includes("rights-cleared and creator-authorized"))
  );
  assert.ok((updatedBusiness?.launchBlockers ?? []).length > 0);
  assert.equal(businessApproval?.status, "completed");
  assert.equal(
    businessApproval?.reason,
    "ClipBaiters rights and fair-use approval is recorded. Remaining launch blockers stay in the launch checklist until they are resolved."
  );
});

test("clipbaiters lane posture approval writes artifacts and clears the gated-lanes blocker", async () => {
  const { imonEngine, clipbaitersStudio, store } = await setupWorkspace();
  await imonEngine.bootstrap();

  await clipbaitersStudio.approveRightsReviewPolicy({
    businessId: "clipbaiters-viral-moments",
    approvedBy: "owner@example.org"
  });
  await imonEngine.sync();

  const result = await clipbaitersStudio.approveLanePosturePolicy({
    businessId: "clipbaiters-viral-moments",
    approvedBy: "owner@example.org",
    note: "Keep the current rollout narrow until new source posture work is complete."
  });
  await imonEngine.sync();

  const updatedBusiness = await store.getManagedBusiness("clipbaiters-viral-moments");
  const approvals = await store.getApprovals();
  const laneApprovalTask = approvals.find(
    (task) => task.id === "approval-clipbaiters-lane-posture-clipbaiters-viral-moments"
  );
  const approvalMarkdown = await readTextFile(result.artifacts.approvalMarkdownPath);
  const planMarkdown = await readTextFile(result.planArtifacts.planMarkdownPath);

  assert.ok(await exists(result.artifacts.approvalStatePath));
  assert.ok(await exists(result.artifacts.approvalMarkdownPath));
  assert.ok(!result.plan.roadblocks.some((roadblock) => roadblock.id === "rights-gated-lanes"));
  assert.ok(approvalMarkdown.includes("ClipBaiters Lane Posture Approval"));
  assert.ok(approvalMarkdown.includes("owner@example.org"));
  assert.ok(approvalMarkdown.includes("clipbaiters-streaming"));
  assert.ok(
    !(updatedBusiness?.launchBlockers ?? []).some((blocker) => blocker.includes("active-versus-gated lane posture"))
  );
  assert.ok(planMarkdown.includes("## Lane Posture Approval"));
  assert.ok(planMarkdown.includes("owner@example.org"));
  assert.equal(laneApprovalTask?.status, "completed");
  assert.equal(
    laneApprovalTask?.reason,
    "ClipBaiters lane posture approval is recorded for the current rollout set. Passive lanes remain documented and gated until their activation conditions change."
  );
});

test("clipbaiters radar ranks political events and writes a daily brief", async () => {
  const { imonEngine, clipbaitersRadar } = await setupWorkspace();
  await imonEngine.bootstrap();

  const result = await clipbaitersRadar.refresh({
    businessId: "clipbaiters-viral-moments",
    laneId: "clipbaiters-political"
  });
  const dailyBrief = await readTextFile(result.artifacts.dailyBriefPath);
  const radarState = await readJsonFile<any>(result.artifacts.eventRadarPath, null);
  const storyState = await readJsonFile<any>(result.artifacts.storyCandidatesPath, null);

  assert.equal(result.status, "ready");
  assert.equal(result.radar.laneId, "clipbaiters-political");
  assert.ok(result.radar.candidates.length >= 3);
  assert.ok(result.radar.candidates.every((candidate) => candidate.reviewRequired));
  assert.ok(result.radar.candidates[0]!.score >= result.radar.candidates.at(-1)!.score);
  assert.ok(result.stories.stories.length >= 1);
  assert.ok(result.stories.stories.every((story) => story.status === "briefed"));
  assert.ok(dailyBrief.includes("ClipBaiters Daily Brief"));
  assert.ok(dailyBrief.includes("ClipBaitersPolitical"));
  assert.equal(radarState?.businessId, "clipbaiters-viral-moments");
  assert.ok(radarState?.lanes.some((lane: any) => lane.laneId === "clipbaiters-political"));
  assert.equal(storyState?.businessId, "clipbaiters-viral-moments");
  assert.ok(storyState?.lanes.some((lane: any) => lane.laneId === "clipbaiters-political"));
});

test("clipbaiters collector writes watchlists and discovery for active lanes", async () => {
  const { imonEngine, clipbaitersCollector } = await setupWorkspace();
  await imonEngine.bootstrap();

  const result = await clipbaitersCollector.collect({
    businessId: "clipbaiters-viral-moments",
    laneId: "clipbaiters-political"
  });
  const watchlistState = await readJsonFile<any>(result.artifacts.sourceWatchlistsPath, null);
  const discoveryState = await readJsonFile<any>(result.artifacts.videoDiscoveryPath, null);

  assert.equal(result.status, "ready");
  assert.ok(result.watchlistState.watchlists.some((watchlist) => watchlist.laneId === "clipbaiters-political"));
  assert.ok(result.discoveryState.videos.some((video) => video.laneId === "clipbaiters-political"));
  assert.equal(watchlistState?.businessId, "clipbaiters-viral-moments");
  assert.ok(
    watchlistState?.watchlists.some(
      (watchlist: any) =>
        watchlist.laneId === "clipbaiters-political" && watchlist.sourceType === "official_youtube"
    )
  );
  assert.equal(discoveryState?.businessId, "clipbaiters-viral-moments");
  assert.ok(discoveryState?.videos.every((video: any) => video.status === "queued_for_skim" || video.status === "watching"));
});

test("clipbaiters skimmer converts discovery into ranked skim summaries", async () => {
  const { imonEngine, clipbaitersSkimmer } = await setupWorkspace();
  await imonEngine.bootstrap();

  const result = await clipbaitersSkimmer.skim({
    businessId: "clipbaiters-viral-moments",
    laneId: "clipbaiters-political"
  });
  const skimState = await readJsonFile<any>(result.artifacts.skimSummariesPath, null);

  assert.equal(result.status, "ready");
  assert.ok(result.skimState.summaries.length > 0);
  assert.ok(result.skimState.summaries.every((summary) => summary.recommendedMoments.length >= 3));
  assert.ok(result.skimState.summaries.every((summary) => typeof summary.score === "number" && summary.score >= 1));
  assert.equal(skimState?.businessId, "clipbaiters-viral-moments");
  assert.ok(skimState?.summaries.some((summary: any) => summary.laneId === "clipbaiters-political"));
});

test("clipbaiters autonomy drafts clip packages from approved source manifests", async () => {
  const { config, imonEngine, clipbaitersAutonomy } = await setupWorkspace();
  await imonEngine.bootstrap();

  const businessId = "clipbaiters-viral-moments";
  const laneId = "clipbaiters-political";
  const sourceFeedDirectory = path.join(config.outputDir, "source-feeds", "clipbaiters", businessId);
  const manifestPath = path.join(sourceFeedDirectory, "approved-hearing-source.json");
  await mkdir(sourceFeedDirectory, { recursive: true });
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        id: "approved-hearing-source",
        laneId,
        title: "Budget hearing exchange turns on the oversight question",
        sourceUrl: "https://example.com/official-hearing",
        rightsBasis: "official_government",
        approvalState: "approved",
        transcriptText:
          "The committee chair sets the context for the budget dispute. The witness answers with the key line that changes the tone of the hearing. The closing exchange lands on the accountability point.",
        notes: ["Approved editorial source for dry-run ingest testing."]
      },
      null,
      2
    ),
    "utf8"
  );

  const result = await clipbaitersAutonomy.run({
    businessId,
    laneId,
    dryRun: true
  });
  const autonomyMarkdown = await readTextFile(result.artifacts.autonomyMarkdownPath);
  const clipCandidatesState = await readJsonFile<any>(result.artifacts.clipCandidatesPath, null);
  const clipJobsState = await readJsonFile<any>(result.artifacts.clipJobsPath, null);
  const firstJob = clipJobsState?.jobs?.[0];

  assert.equal(result.snapshot.status, "ready");
  assert.equal(result.snapshot.dryRun, true);
  assert.equal(result.snapshot.sourceManifestCount, 1);
  assert.ok(result.snapshot.tooling.some((tool) => tool.tool === "ffmpeg"));
  assert.ok(result.snapshot.manualGates.some((gate) => gate.includes("Dry run only")));
  assert.ok(await exists(result.artifacts.autonomyJsonPath));
  assert.ok(await exists(result.artifacts.autonomyMarkdownPath));
  assert.ok(await exists(result.artifacts.clipCandidatesPath));
  assert.ok(await exists(result.artifacts.clipJobsPath));
  assert.ok(await exists(result.artifacts.draftClipsDirectory));
  assert.ok(clipCandidatesState?.manifests.some((manifest: any) => manifest.origin === "manual_manifest"));
  assert.ok(
    clipCandidatesState?.candidates.every(
      (candidate: any) => candidate.transcriptSource === "manual_manifest" && candidate.approvalState === "approved"
    )
  );
  assert.ok(clipJobsState?.jobs.length >= 1);
  assert.equal(firstJob?.status, "drafted");
  assert.equal(firstJob?.reviewRequired, false);
  assert.ok(firstJob?.renderPlan.some((step: any) => step.tool === "ffmpeg"));
  assert.ok(await exists(firstJob.outputFiles.briefJsonPath));
  assert.ok(await exists(firstJob.outputFiles.captionSrtPath));
  assert.ok(await exists(firstJob.outputFiles.notesMarkdownPath));
  assert.ok(autonomyMarkdown.includes("ClipBaiters Autonomy Run"));
  assert.ok(autonomyMarkdown.includes("Dry run: yes"));
  assert.ok((await readTextFile(firstJob.outputFiles.captionSrtPath)).includes("-->"));
  assert.ok((await readTextFile(firstJob.outputFiles.notesMarkdownPath)).includes("Clip Draft Notes"));
});

test("clipbaiters publish queues political clips behind a manual review gate", async () => {
  const { config, imonEngine, clipbaitersPublisher, store, storeOps } = await setupWorkspace();
  await imonEngine.bootstrap();

  const businessId = "clipbaiters-viral-moments";
  const laneId = "clipbaiters-political";
  const sourceFeedDirectory = path.join(config.outputDir, "source-feeds", "clipbaiters", businessId);
  await storeOps.ensureSocialProfiles(businessId);
  await mkdir(sourceFeedDirectory, { recursive: true });
  await writeFile(
    path.join(sourceFeedDirectory, "publish-review-source.json"),
    JSON.stringify(
      {
        id: "publish-review-source",
        laneId,
        title: "Committee hearing exchange on oversight and spending",
        sourceUrl: "https://example.com/official-hearing-review",
        rightsBasis: "official_government",
        approvalState: "approved",
        transcriptText:
          "The chair opens with the budget context. The witness gives the line that reframes the exchange. The closing response lands on the accountability question.",
        notes: ["Approved for political publish-queue dry-run testing."]
      },
      null,
      2
    ),
    "utf8"
  );

  const channel = (await store.getSocialProfiles()).find(
    (profile) =>
      profile.businessId === businessId &&
      profile.platform === "youtube_channel" &&
      profile.laneId === laneId
  );
  assert.ok(channel);
  await store.saveSocialProfile({
    ...channel!,
    status: "live",
    handle: "clipbaiterspolitical",
    profileUrl: "https://youtube.com/@clipbaiterspolitical",
    externalId: "UCclipbaiterspolitical",
    updatedAt: new Date().toISOString()
  });

  const result = await clipbaitersPublisher.run({
    businessId,
    laneId,
    dryRun: true
  });
  const publishingQueue = await readJsonFile<any>(result.artifacts.publishingQueuePath, null);
  const uploadBatches = await readJsonFile<any>(result.artifacts.uploadBatchesPath, null);
  const channelMetrics = await readJsonFile<any>(result.artifacts.channelMetricsPath, null);
  const reviewQueue = await readTextFile(result.artifacts.reviewQueuePath);

  assert.equal(result.snapshot.status, "review_gated");
  assert.equal(result.snapshot.dryRun, true);
  assert.ok(result.snapshot.queueItemCount >= 1);
  assert.ok(result.snapshot.reviewRequiredCount >= 1);
  assert.ok(result.snapshot.manualGates.some((gate) => gate.kind === "political_sensitivity"));
  assert.ok(await exists(result.artifacts.publishingQueuePath));
  assert.ok(await exists(result.artifacts.uploadBatchesPath));
  assert.ok(await exists(result.artifacts.reviewQueuePath));
  assert.ok(await exists(result.artifacts.channelMetricsPath));
  assert.ok(await exists(result.artifacts.channelMetricsMarkdownPath));
  assert.ok(publishingQueue?.items.some((item: any) => item.status === "awaiting_review"));
  assert.ok(publishingQueue?.items.every((item: any) => item.channelStatus === "live"));
  assert.equal(uploadBatches?.batches?.[0]?.status, "review_required");
  assert.ok(channelMetrics?.profiles.some((profile: any) => profile.reviewRequiredCount >= 1));
  assert.ok(reviewQueue.includes("ClipBaiters Review Queue"));
  assert.ok(reviewQueue.includes("awaiting_review"));
});

test("clipbaiters autonomy supports all active lanes with lane-scoped artifacts", async () => {
  const { config, imonEngine, clipbaitersAutonomy } = await setupWorkspace();
  await imonEngine.bootstrap();

  const result = await clipbaitersAutonomy.run({
    businessId: "clipbaiters-viral-moments",
    allActiveLanes: true,
    dryRun: true
  });

  assert.equal(result.snapshot.laneId, "all-active-lanes");
  assert.ok(result.snapshot.clipJobCount >= 1);
  assert.ok(await exists(result.artifacts.dailySummaryPath!));
  assert.ok(
    await exists(
      path.join(
        config.stateDir,
        "clipbaiters",
        "clipbaiters-viral-moments",
        "clip-candidates-clipbaiters-political.json"
      )
    )
  );
  assert.ok(
    await exists(
      path.join(
        config.stateDir,
        "clipbaiters",
        "clipbaiters-viral-moments",
        "clip-jobs-clipbaiters-media.json"
      )
    )
  );
  assert.ok((await readTextFile(result.artifacts.autonomyMarkdownPath)).includes("All Active Lanes"));
});

test("clipbaiters publish supports all active lanes and writes a daily summary", async () => {
  const { imonEngine, clipbaitersPublisher, store, storeOps } = await setupWorkspace();
  await imonEngine.bootstrap();
  await storeOps.ensureSocialProfiles("clipbaiters-viral-moments");

  for (const laneId of ["clipbaiters-political", "clipbaiters-media"]) {
    const channel = (await store.getSocialProfiles()).find(
      (profile) =>
        profile.businessId === "clipbaiters-viral-moments" &&
        profile.platform === "youtube_channel" &&
        profile.laneId === laneId
    );
    assert.ok(channel);
    await store.saveSocialProfile({
      ...channel!,
      status: "live",
      handle: laneId === "clipbaiters-political" ? "clipbaiterspolitical" : "clipbaitersmedia",
      profileUrl:
        laneId === "clipbaiters-political"
          ? "https://youtube.com/@clipbaiterspolitical"
          : "https://youtube.com/@clipbaitersmedia",
      externalId: laneId === "clipbaiters-political" ? "UCclipbaiterspolitical" : "UCclipbaitersmedia",
      updatedAt: new Date().toISOString()
    });
  }

  const result = await clipbaitersPublisher.run({
    businessId: "clipbaiters-viral-moments",
    allActiveLanes: true,
    dryRun: true
  });
  const dailySummary = await readTextFile(result.artifacts.dailySummaryPath!);
  const publishHistory = await readJsonFile<any>(result.artifacts.publishHistoryPath, null);

  assert.equal(result.snapshot.laneId, "all-active-lanes");
  assert.ok(result.queueState.items.some((item) => item.laneId === "clipbaiters-political"));
  assert.ok(result.queueState.items.some((item) => item.laneId === "clipbaiters-media"));
  assert.ok(result.channelMetrics.profiles.some((profile) => profile.laneId === "clipbaiters-media"));
  assert.ok(dailySummary.includes("ClipBaiters Daily Summary"));
  assert.ok(dailySummary.includes("Creator Deals"));
  assert.ok(publishHistory?.entries.length >= result.queueState.items.length);
});

test("clipbaiters deals source creators, draft outreach, and materialize paid leads into creator orders", async () => {
  const { clipbaitersDeals, imonEngine } = await setupWorkspace();
  await imonEngine.bootstrap();

  const sourced = await clipbaitersDeals.sourceCreators({ businessId: "clipbaiters-viral-moments" });
  assert.ok(sourced.leadState.leads.length > 0);

  const paidLead = {
    ...sourced.leadState.leads[0]!,
    status: "paid" as const,
    contactEmail: "creator@example.com",
    sourceChannelUrl: "https://www.youtube.com/@creatorstream",
    quotedPriceUsd: 450,
    updatedAt: new Date().toISOString()
  };
  await writeJsonFile(sourced.artifacts.creatorLeadsPath, {
    ...sourced.leadState,
    generatedAt: new Date().toISOString(),
    leads: [paidLead, ...sourced.leadState.leads.slice(1)]
  });

  const drafted = await clipbaitersDeals.draftCreatorOutreach({ businessId: "clipbaiters-viral-moments" });
  const report = await clipbaitersDeals.report({ businessId: "clipbaiters-viral-moments" });
  const dealsMarkdown = await readTextFile(report.artifacts.creatorDealsReportPath);

  assert.ok(drafted.outreachState.drafts.length > 0);
  assert.ok(report.ordersState.orders.some((order) => order.creatorName === paidLead.creatorName));
  assert.ok(dealsMarkdown.includes("ClipBaiters Creator Deals"));
  assert.ok(dealsMarkdown.includes(paidLead.creatorName));
});

test("clipbaiters monetization syncs creator orders, opens approvals, and writes revenue state", async () => {
  const touchedKeys = [
    "CLIPBAITERS_STREAMING_PAYMENT_LINK_RETAINER",
    "CLIPBAITERS_STREAMING_PAYMENT_LINK_EVENT_PACK",
    "CLIPBAITERS_STREAMING_PAYMENT_LINK_RUSH_PACK"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  try {
    process.env.CLIPBAITERS_STREAMING_PAYMENT_LINK_RETAINER = "https://buy.stripe.com/clipbaiters-retainer";
    delete process.env.CLIPBAITERS_STREAMING_PAYMENT_LINK_EVENT_PACK;
    process.env.CLIPBAITERS_STREAMING_PAYMENT_LINK_RUSH_PACK = "https://buy.stripe.com/clipbaiters-rush";

    const { config, imonEngine, clipbaitersIntake, clipbaitersMonetization, store } = await setupWorkspace();
    await imonEngine.bootstrap();

    const businessId = "clipbaiters-viral-moments";
    const intakeDirectory = path.join(
      config.outputDir,
      "source-feeds",
      "clipbaiters",
      businessId,
      "creator-orders"
    );
    await mkdir(intakeDirectory, { recursive: true });
    await writeFile(
      path.join(intakeDirectory, "creator-paid-order.json"),
      JSON.stringify(
        {
          id: "creator-paid-order",
          creatorName: "Streamer One",
          creatorHandle: "@streamerone",
          contactEmail: "streamer@example.com",
          offerId: "clipbaiters-streaming-event-pack",
          quotedPriceUsd: 450,
          paymentStatus: "paid",
          creatorAuthorizationConfirmed: true,
          sourceChannelUrl: "https://youtube.com/@streamerone",
          requestedDeliverables: ["3 short clips from the launch stream"],
          scheduledAt: "2026-04-08T20:00:00.000Z",
          notes: ["Manual creator order manifest used by the monetization workflow test."],
          deliveryArtifacts: []
        },
        null,
        2
      ),
      "utf8"
    );

    await clipbaitersIntake.sync({ businessId });
    const result = await clipbaitersMonetization.run({ businessId });
    const offersState = await readJsonFile<any>(result.artifacts.creatorOffersPath, null);
    const ordersState = await readJsonFile<any>(result.artifacts.creatorOrdersPath, null);
    const revenueState = await readJsonFile<any>(result.artifacts.revenueSnapshotsPath, null);
    const monetizationReport = await readTextFile(result.artifacts.monetizationReportPath);
    const approvals = await store.getApprovals();

    assert.equal(result.snapshot.status, "blocked");
    assert.equal(result.snapshot.offerCount, 3);
    assert.equal(result.snapshot.orderCount, 1);
    assert.equal(result.snapshot.paidOrderCount, 1);
    assert.equal(result.snapshot.deliveredOrderCount, 0);
    assert.equal(result.snapshot.openApprovalCount, 2);
    assert.equal(result.ordersState.orders.length, 1);
    assert.equal(result.revenueState.snapshots.at(-1)?.paidRevenueUsd, 450);
    assert.equal(result.revenueState.snapshots.at(-1)?.deliveryBacklogUsd, 450);
    assert.ok(offersState?.offers.some((offer: any) => offer.id === "clipbaiters-streaming-event-pack"));
    assert.ok(
      offersState?.offers.some(
        (offer: any) => offer.id === "clipbaiters-streaming-event-pack" && offer.status === "approval_required"
      )
    );
    assert.ok(
      ordersState?.orders.some(
        (order: any) => order.id === "creator-paid-order" && order.paymentStatus === "paid" && order.status === "paid"
      )
    );
    assert.equal(revenueState?.snapshots?.at(-1)?.bookedRevenueUsd, 450);
    assert.equal(revenueState?.snapshots?.at(-1)?.paidRevenueUsd, 450);
    assert.equal(revenueState?.snapshots?.at(-1)?.deliveredRevenueUsd, 0);
    assert.ok(monetizationReport.includes("ClipBaiters Monetization Report"));
    assert.ok(monetizationReport.includes("creator-paid-order"));
    assert.ok(monetizationReport.includes("Missing payment link"));
    assert.ok(
      approvals.some(
        (task) => task.id === "approval-clipbaiters-payment-link-clipbaiters-streaming-event-pack" && task.status === "open"
      )
    );
    assert.ok(
      approvals.some((task) => task.id === "approval-clipbaiters-delivery-creator-paid-order" && task.status === "open")
    );
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("clipbaiters org sync surfaces control-plane lanes, checklist artifacts, and VPS cadence", async () => {
  const touchedKeys = [
    "CLIPBAITERS_STREAMING_PAYMENT_LINK_RETAINER",
    "CLIPBAITERS_STREAMING_PAYMENT_LINK_EVENT_PACK",
    "CLIPBAITERS_STREAMING_PAYMENT_LINK_RUSH_PACK"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  try {
    process.env.CLIPBAITERS_STREAMING_PAYMENT_LINK_RETAINER = "https://buy.stripe.com/clipbaiters-retainer";
    process.env.CLIPBAITERS_STREAMING_PAYMENT_LINK_EVENT_PACK = "https://buy.stripe.com/clipbaiters-event-pack";
    process.env.CLIPBAITERS_STREAMING_PAYMENT_LINK_RUSH_PACK = "https://buy.stripe.com/clipbaiters-rush";

    const {
      config,
      imonEngine,
      clipbaitersStudio,
      clipbaitersRadar,
      clipbaitersAutonomy,
      clipbaitersPublisher,
      clipbaitersMonetization,
      store,
      storeOps
    } = await setupWorkspace();
    await imonEngine.bootstrap();

    const businessId = "clipbaiters-viral-moments";
    const laneId = "clipbaiters-political";
    const sourceFeedDirectory = path.join(config.outputDir, "source-feeds", "clipbaiters", businessId);

    await clipbaitersStudio.writePlan({ businessId });
    await storeOps.ensureSocialProfiles(businessId);
    await mkdir(sourceFeedDirectory, { recursive: true });
    await writeFile(
      path.join(sourceFeedDirectory, "org-sync-political-source.json"),
      JSON.stringify(
        {
          id: "org-sync-political-source",
          laneId,
          title: "Official debate exchange sets up the headline clip moment",
          sourceUrl: "https://example.com/official-debate-source",
          rightsBasis: "official_government",
          approvalState: "approved",
          transcriptText:
            "The moderator frames the policy dispute. The candidate lands the line that becomes the clip hook. The response keeps the exchange within a public-record rights basis.",
          notes: ["Approved source manifest for ClipBaiters org-sync coverage."]
        },
        null,
        2
      ),
      "utf8"
    );

    const channel = (await store.getSocialProfiles()).find(
      (profile) =>
        profile.businessId === businessId &&
        profile.platform === "youtube_channel" &&
        profile.laneId === laneId
    );
    assert.ok(channel);
    await store.saveSocialProfile({
      ...channel!,
      status: "live",
      handle: "clipbaiterspolitical",
      profileUrl: "https://youtube.com/@clipbaiterspolitical",
      externalId: "UCclipbaiterspolitical",
      updatedAt: new Date().toISOString()
    });

    await clipbaitersRadar.refresh({ businessId, laneId });
    await clipbaitersAutonomy.run({ businessId, laneId, dryRun: true });
    await clipbaitersPublisher.run({ businessId, laneId, dryRun: true });
    await clipbaitersMonetization.run({ businessId });

    const officeSnapshot = await imonEngine.syncOrganization();
    const vpsArtifacts = await imonEngine.writeVpsArtifacts();
    const workflowOwner = await store.getWorkflowOwnershipRecord("clipbaiters-publish", businessId);
    const launchChecklistPath = path.join(config.opsDir, "clipbaiters", businessId, "launch-checklist.md");
    const launchChecklist = await readTextFile(launchChecklistPath);
    const officeViewsState = await readJsonFile<any>(path.join(config.opsDir, "office-views.json"), null);
    const orgControlPlaneState = await readJsonFile<any>(
      path.join(config.opsDir, "org-control-plane.json"),
      null
    );
    const syncScript = await readTextFile(vpsArtifacts.syncScriptPath);
    const cronSpec = await readTextFile(vpsArtifacts.cronPath);
    const publishExecution = officeSnapshot.departmentWorkspaces
      .flatMap((workspace) => workspace.executionItems)
      .find(
        (item) => item.businessId === businessId && item.workflowId === "clipbaiters-publish"
      );

    assert.ok(workflowOwner);
    assert.equal(workflowOwner?.workflowName, "ClipBaiters Review-Gated Publishing");
    assert.equal(workflowOwner?.positionName, "Growth And Marketing Manager");
    assert.ok(officeSnapshot.businessViews.some((view) => view.businessId === businessId));
    assert.ok(
      officeSnapshot.departmentWorkspaces.some(
        (workspace) =>
          workspace.businessId === businessId &&
          workspace.executionItems.some((item) => item.workflowId === "clipbaiters-radar")
      )
    );
    assert.ok(publishExecution);
    assert.ok(
      publishExecution?.artifacts.some((artifact) => artifact.includes("review-queue.md"))
    );
    assert.equal(await exists(launchChecklistPath), true);
    assert.ok(launchChecklist.includes("ClipBaiters Launch Checklist"));
    assert.ok(
      launchChecklist.includes(
        "clipbaiters-collect --business clipbaiters-viral-moments"
      )
    );
    assert.ok(
      launchChecklist.includes(
        "clipbaiters-skim --business clipbaiters-viral-moments"
      )
    );
    assert.ok(
      launchChecklist.includes(
        "clipbaiters-publish --business clipbaiters-viral-moments --all-active-lanes --dry-run"
      )
    );
    assert.ok(
      officeViewsState?.businessViews.some(
        (view: any) => view.businessId === businessId
      )
    );
    assert.ok(
      orgControlPlaneState?.workflowOwnership.some(
        (owner: any) =>
          owner.businessId === businessId && owner.workflowId === "clipbaiters-radar"
      )
    );
    assert.ok(
      orgControlPlaneState?.workflowOwnership.some(
        (owner: any) =>
          owner.businessId === businessId && owner.workflowId === "clipbaiters-youtube-channel-ops"
      )
    );
    assert.ok(
      syncScript.includes(
        "clipbaiters-collect --business clipbaiters-viral-moments"
      )
    );
    assert.ok(
      syncScript.includes(
        "clipbaiters-skim --business clipbaiters-viral-moments"
      )
    );
    assert.ok(
      syncScript.includes(
        "clipbaiters-autonomy-run --business clipbaiters-viral-moments --all-active-lanes --dry-run"
      )
    );
    assert.ok(
      syncScript.includes(
        "clipbaiters-monetization-report --business clipbaiters-viral-moments"
      )
    );
    assert.ok(cronSpec.includes("ClipBaiters review-gated automation"));
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("northline ops creates a launch dossier with outbound sprint and config-driven blockers", async () => {
  const { imonEngine, northlineOps, store } = await setupWorkspace();
  await imonEngine.bootstrap();

  const result = await northlineOps.writePlan({
    businessId: "auto-funding-agency"
  });
  await imonEngine.sync();
  const updatedBusiness = await store.getManagedBusiness("auto-funding-agency");

  assert.equal(result.plan.businessName, "Northline Growth Systems");
  assert.equal(result.plan.operatingMode.current, "controlled_launch");
  assert.equal(result.plan.operatingMode.promotionCriteria.length, 5);
  assert.equal(result.plan.outboundSprint.length, 10);
  assert.equal(result.plan.socialPlan.length, 6);
  assert.ok(result.plan.readiness.some((item) => item.id === "payment-collection"));
  assert.ok(result.plan.readiness.some((item) => item.id === "validation-proof"));
  assert.ok(result.plan.roadblocks.some((roadblock) => roadblock.category.includes("Payment")));
  assert.ok(result.plan.roadblocks.some((roadblock) => roadblock.category.includes("Public proof")));
  assert.ok(
    result.plan.roadblocks.some((roadblock) => roadblock.category.includes("Controlled launch"))
  );
  assert.ok(updatedBusiness);
  assert.equal(updatedBusiness?.stage, "paused");
  assert.ok(
    updatedBusiness?.launchBlockers.some((blocker) => blocker.includes("Stripe"))
  );
  assert.ok(
    updatedBusiness?.notes.some((note) => note.includes("runtime/ops/northline-growth-system"))
  );
});

test("account ops completes stale direct-billing approvals when the active Northline lane is already configured", async () => {
  const touchedKeys = [
    "NORTHLINE_DOMAIN",
    "NORTHLINE_SALES_EMAIL",
    "NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING",
    "NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "SMTP_USER",
    "SMTP_PASS",
    "NORTHLINE_SMTP_FROM",
    "SMTP_FROM"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  try {
    process.env.NORTHLINE_DOMAIN = "northlinegrowthsystems.com";
    process.env.NORTHLINE_SALES_EMAIL = "contact@northlinegrowthsystems.com";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING = "https://buy.stripe.com/founding";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD = "https://buy.stripe.com/standard";
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.NORTHLINE_SMTP_FROM;
    delete process.env.SMTP_FROM;

    const { imonEngine, orchestrator, store } = await setupWorkspace();
    await imonEngine.bootstrap();

    const northlineBusiness = await store.getManagedBusiness("auto-funding-agency");
    assert.ok(northlineBusiness);

    const now = new Date().toISOString();
    await store.saveManagedBusiness({
      ...northlineBusiness!,
      stage: "active",
      updatedAt: now
    });

    await store.saveApproval({
      id: "approval-payment-links",
      type: "payment",
      actionNeeded: "Add Stripe Payment Links for founding and standard offers",
      reason: "Stale waiting task",
      ownerInstructions: "Update the Northline Stripe env vars.",
      relatedEntityType: "account",
      relatedEntityId: "stripe",
      notifyChannel: "email",
      status: "waiting",
      createdAt: now,
      updatedAt: now
    });
    await store.saveApproval({
      id: "approval-sales-inbox",
      type: "email",
      actionNeeded: "Connect a real sales inbox on the business domain",
      reason: "Stale waiting task",
      ownerInstructions: "Update the Northline sales inbox.",
      relatedEntityType: "account",
      relatedEntityId: "sales-email",
      notifyChannel: "email",
      status: "waiting",
      createdAt: now,
      updatedAt: now
    });
    await store.saveApproval({
      id: "approval-smtp-setup",
      type: "email",
      actionNeeded: "Connect SMTP settings for live approval notifications",
      reason: "Stale waiting task",
      ownerInstructions: "Update the SMTP env vars.",
      relatedEntityType: "account",
      relatedEntityId: "smtp",
      notifyChannel: "email",
      status: "waiting",
      createdAt: now,
      updatedAt: now
    });

    const openTasks = await orchestrator.getAccountOps().ensureOperationalApprovals();
    const approvals = await store.getApprovals();
    const paymentTask = approvals.find((task) => task.id === "approval-payment-links");
    const salesTask = approvals.find((task) => task.id === "approval-sales-inbox");
    const smtpTask = approvals.find((task) => task.id === "approval-smtp-setup");

    assert.equal(openTasks.length, 0);
    assert.equal(paymentTask?.status, "completed");
    assert.match(paymentTask?.reason ?? "", /configured for the active direct-billing lane/i);
    assert.equal(paymentTask?.ownerInstructions, "No immediate owner action is required right now.");
    assert.equal(salesTask?.status, "completed");
    assert.match(salesTask?.reason ?? "", /branded sales inbox is configured/i);
    assert.equal(salesTask?.ownerInstructions, "No immediate owner action is required right now.");
    assert.equal(smtpTask?.status, "waiting");
    assert.match(smtpTask?.reason ?? "", /optional .* controlled launch/i);
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("account ops does not overwrite a completed approval when reopenCompleted is false", async () => {
  const touchedKeys = [
    "NORTHLINE_DOMAIN",
    "NORTHLINE_SALES_EMAIL",
    "NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING",
    "NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "SMTP_USER",
    "SMTP_PASS",
    "NORTHLINE_SMTP_FROM",
    "SMTP_FROM"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  try {
    process.env.NORTHLINE_DOMAIN = "northlinegrowthsystems.com";
    process.env.NORTHLINE_SALES_EMAIL = "contact@northlinegrowthsystems.com";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING = "https://buy.stripe.com/founding";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD = "https://buy.stripe.com/standard";
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.NORTHLINE_SMTP_FROM;
    delete process.env.SMTP_FROM;

    const { imonEngine, orchestrator, store } = await setupWorkspace();
    await imonEngine.bootstrap();

    const northlineBusiness = await store.getManagedBusiness("auto-funding-agency");
    assert.ok(northlineBusiness);

    const now = new Date().toISOString();
    await store.saveManagedBusiness({
      ...northlineBusiness!,
      stage: "active",
      updatedAt: now
    });

    await store.saveApproval({
      id: "approval-smtp-setup",
      type: "email",
      actionNeeded: "Connect SMTP settings for live approval notifications",
      reason: "SMTP is configured for live approval notifications.",
      ownerInstructions: "No immediate owner action is required right now.",
      relatedEntityType: "account",
      relatedEntityId: "smtp",
      notifyChannel: "email",
      status: "completed",
      createdAt: now,
      updatedAt: now
    });

    await orchestrator.getAccountOps().ensureOperationalApprovals();
    const approvals = await store.getApprovals();
    const smtpTask = approvals.find((task) => task.id === "approval-smtp-setup");

    assert.equal(smtpTask?.status, "completed");
    assert.equal(smtpTask?.reason, "SMTP is configured for live approval notifications.");
    assert.equal(smtpTask?.ownerInstructions, "No immediate owner action is required right now.");
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("northline ops keeps the lane blocked until a Stripe-backed validation success is recorded", async () => {
  const touchedKeys = [
    "NORTHLINE_DOMAIN",
    "NORTHLINE_SITE_URL",
    "NORTHLINE_SALES_EMAIL",
    "NORTHLINE_FACEBOOK_URL",
    "NORTHLINE_INSTAGRAM_URL",
    "NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING",
    "NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD",
    "NORTHLINE_STRIPE_PAYMENT_LINK_VALIDATION",
    "NORTHLINE_BOOKING_URL",
    "NORTHLINE_LEAD_FORM_ACTION"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  try {
    process.env.NORTHLINE_DOMAIN = "northlinegrowthsystems.com";
    process.env.NORTHLINE_SITE_URL = "https://northlinegrowthsystems.com";
    process.env.NORTHLINE_SALES_EMAIL = "contact@northlinegrowthsystems.com";
    process.env.NORTHLINE_FACEBOOK_URL = "https://facebook.com/northlinegrowth";
    process.env.NORTHLINE_INSTAGRAM_URL = "https://instagram.com/northlinegrowth";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING = "https://buy.stripe.com/founding";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD = "https://buy.stripe.com/standard";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_VALIDATION = "https://buy.stripe.com/validation";
    process.env.NORTHLINE_BOOKING_URL = "/book.html";
    process.env.NORTHLINE_LEAD_FORM_ACTION = "/api/northline-intake";

    const { imonEngine, northlineOps } = await setupWorkspace();
    await imonEngine.bootstrap();

    const result = await northlineOps.writePlan({
      businessId: "auto-funding-agency"
    });
    const validationReadiness = result.plan.readiness.find((item) => item.id === "validation-proof");
    const validationPromotionCriterion = result.plan.operatingMode.promotionCriteria.find(
      (criterion) => criterion.id === "validation-charge"
    );

    assert.equal(validationReadiness?.status, "planned");
    assert.equal(result.plan.operatingMode.current, "controlled_launch");
    assert.equal(validationPromotionCriterion?.status, "missing");
    assert.ok(
      result.plan.roadblocks.some((roadblock) => roadblock.category.includes("Controlled launch"))
    );
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("northline ops treats hosted intake as launch-ready once validation proof exists while leaving phone and GBP optional", async () => {
  const touchedKeys = [
    "NORTHLINE_DOMAIN",
    "NORTHLINE_SITE_URL",
    "NORTHLINE_SALES_EMAIL",
    "NORTHLINE_FACEBOOK_URL",
    "NORTHLINE_INSTAGRAM_URL",
    "NORTHLINE_STRIPE_PAYMENT_LINK_LEAD_GENERATION",
    "NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING",
    "NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD",
    "NORTHLINE_STRIPE_PAYMENT_LINK_VALIDATION",
    "NORTHLINE_PHONE",
    "NORTHLINE_BOOKING_URL",
    "NORTHLINE_LEAD_FORM_ACTION",
    "NORTHLINE_GOOGLE_BUSINESS_PROFILE_URL",
    "NORTHLINE_GOOGLE_REVIEW_URL"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  try {
    process.env.NORTHLINE_DOMAIN = "northlinegrowthsystems.com";
    process.env.NORTHLINE_SITE_URL = "https://northlinegrowthsystems.com";
    process.env.NORTHLINE_SALES_EMAIL = "contact@northlinegrowthsystems.com";
    process.env.NORTHLINE_FACEBOOK_URL = "https://facebook.com/northlinegrowth";
    process.env.NORTHLINE_INSTAGRAM_URL = "https://instagram.com/northlinegrowth";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_LEAD_GENERATION = "https://buy.stripe.com/lead_generation";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING = "https://buy.stripe.com/founding";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD = "https://buy.stripe.com/standard";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_VALIDATION = "https://buy.stripe.com/validation";
    process.env.NORTHLINE_BOOKING_URL = "/book.html";
    process.env.NORTHLINE_LEAD_FORM_ACTION = "/api/northline-intake";
    delete process.env.NORTHLINE_PHONE;
    delete process.env.NORTHLINE_GOOGLE_BUSINESS_PROFILE_URL;
    delete process.env.NORTHLINE_GOOGLE_REVIEW_URL;

    const { config, imonEngine, northlineOps, store } = await setupWorkspace();
    await imonEngine.bootstrap();

    const now = new Date().toISOString();
    await writeFile(
      path.join(config.stateDir, "northlineValidationConfirmations.json"),
      JSON.stringify(
        {
          confirmations: [
            {
              submissionId: "northline-validation-success",
              token: "token",
              createdAt: now,
              lastConfirmedAt: now,
              lastStripeCompletedAt: now,
              lastResult: {
                businessId: "auto-funding-agency",
                status: "success"
              }
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const result = await northlineOps.writePlan({
      businessId: "auto-funding-agency"
    });
    await imonEngine.sync();
    const updatedBusiness = await store.getManagedBusiness("auto-funding-agency");
    const contactReadiness = result.plan.readiness.find((item) => item.id === "contact-routing");
    const trustReadiness = result.plan.readiness.find((item) => item.id === "local-trust");
    const validationReadiness = result.plan.readiness.find((item) => item.id === "validation-proof");
    const validationPromotionCriterion = result.plan.operatingMode.promotionCriteria.find(
      (criterion) => criterion.id === "validation-charge"
    );

    assert.equal(result.plan.roadblocks.length, 0);
    assert.equal(result.plan.operatingMode.current, "controlled_launch");
    assert.equal(contactReadiness?.status, "live");
    assert.equal(validationReadiness?.status, "live");
    assert.equal(validationPromotionCriterion?.status, "met");
    assert.ok(trustReadiness);
    assert.notEqual(trustReadiness?.status, "live");
    assert.ok(updatedBusiness);
    assert.equal(updatedBusiness?.stage, "ready");
    assert.deepEqual(updatedBusiness?.launchBlockers ?? [], []);
    assert.ok(
      updatedBusiness?.ownerActions.some((action) => action.includes("Start the outbound sprint"))
    );
    assert.ok(
      !(updatedBusiness?.ownerActions.some((action) => action.includes("Set NORTHLINE_PHONE")) ?? false)
    );
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("northline ops promotes the lane to autonomous mode once the phase 6 cohort criteria are met", async () => {
  const touchedKeys = [
    "NORTHLINE_DOMAIN",
    "NORTHLINE_SITE_URL",
    "NORTHLINE_SALES_EMAIL",
    "NORTHLINE_FACEBOOK_URL",
    "NORTHLINE_INSTAGRAM_URL",
    "NORTHLINE_STRIPE_PAYMENT_LINK_LEAD_GENERATION",
    "NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING",
    "NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD",
    "NORTHLINE_STRIPE_PAYMENT_LINK_VALIDATION",
    "NORTHLINE_BOOKING_URL",
    "NORTHLINE_LEAD_FORM_ACTION"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  try {
    process.env.NORTHLINE_DOMAIN = "northlinegrowthsystems.com";
    process.env.NORTHLINE_SITE_URL = "https://northlinegrowthsystems.com";
    process.env.NORTHLINE_SALES_EMAIL = "contact@northlinegrowthsystems.com";
    process.env.NORTHLINE_FACEBOOK_URL = "https://facebook.com/northlinegrowth";
    process.env.NORTHLINE_INSTAGRAM_URL = "https://instagram.com/northlinegrowth";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_LEAD_GENERATION = "https://buy.stripe.com/lead_generation";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING = "https://buy.stripe.com/founding";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD = "https://buy.stripe.com/standard";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_VALIDATION = "https://buy.stripe.com/validation";
    process.env.NORTHLINE_BOOKING_URL = "/book.html";
    process.env.NORTHLINE_LEAD_FORM_ACTION = "/api/northline-intake";

    const { config, imonEngine, northlineOps, store } = await setupWorkspace();
    await imonEngine.bootstrap();

    const now = new Date("2026-04-03T18:00:00.000Z");
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();

    await writeFile(
      path.join(config.stateDir, "northlineValidationConfirmations.json"),
      JSON.stringify(
        {
          confirmations: [
            {
              submissionId: "northline-validation-success",
              lastConfirmedAt: sixDaysAgo,
              lastStripeCompletedAt: sevenDaysAgo,
              lastResult: {
                businessId: "auto-funding-agency",
                status: "success"
              }
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    for (const [index, clientId] of ["pilot-one", "pilot-two", "pilot-three"].entries()) {
      const deployedAt = new Date(now.getTime() - index * 24 * 60 * 60 * 1000).toISOString();
      await store.saveClient({
        id: clientId,
        businessId: "auto-funding-agency",
        provenance: "external_outbound",
        proofEligible: true,
        clientName: `Pilot ${index + 1}`,
        niche: "home services",
        geo: "Cleveland, OH",
        primaryPhone: `(216) 555-01${10 + index}`,
        primaryEmail: `${clientId}@example.com`,
        offerId: "founding-offer",
        siteStatus: "deployed",
        qaStatus: "passed",
        billingStatus: index === 2 ? "retainer_active" : "paid",
        formEndpoint: `https://hooks.example.com/forms/${clientId}`,
        deployment: {
          platform: "cloudflare-pages",
          productionUrl: `https://${clientId}.example.com`
        },
        assets: {
          logoText: `Pilot ${index + 1}`,
          testimonials: index === 0 ? ["Closed more calls after the rebuild."] : [],
          reviews: index === 1 ? ["Strong follow-up and cleaner intake."] : [],
          proofBundle: {
            clientId,
            businessId: "auto-funding-agency",
            createdAt: deployedAt,
            clientName: `Pilot ${index + 1}`,
            siteStatus: "deployed",
            qaStatus: "passed",
            reportPath: path.join(config.reportDir, `${clientId}-proof-bundle.json`),
            screenshots: [
              {
                id: `${clientId}-desktop`,
                label: "Homepage desktop",
                path: path.join(config.outputDir, `${clientId}-desktop.png`),
                viewport: "desktop"
              }
            ],
            testimonialRequest: {
              subject: "Testimonial",
              body: "Share the result in one sentence."
            },
            reviewRequest: {
              subject: "Review",
              body: "Please leave a review.",
              targetUrl: "https://g.page/r/example/review"
            },
            publication: {
              headline: `Pilot ${index + 1} proof`,
              summary: "Delivered proof asset bundle.",
              bullets: ["New CTA", "Improved intake routing"],
              testimonialQuote: index === 0 ? "Closed more calls after the rebuild." : undefined
            }
          }
        },
        intakeNotes: ["Proof cohort client"],
        nextAction: "Delivery complete",
        createdAt: deployedAt,
        updatedAt: deployedAt
      });
    }

    await store.saveLead({
      id: "reply-loop-lead",
      businessId: "auto-funding-agency",
      businessName: "Northline Growth Systems",
      niche: "home services",
      geo: "Cleveland, OH",
      source: "manual",
      contact: {
        ownerName: "Chris",
        email: "dispatch@example.com"
      },
      websiteQualitySignals: {
        hasWebsite: true,
        hasHttps: true,
        mobileFriendly: true,
        clearOffer: false,
        callsToAction: false,
        pageSpeedBucket: "slow",
        notes: ["Weak CTA"]
      },
      score: 88,
      scoreReasons: ["Weak CTA"],
      stage: "responded",
      tags: ["northline"],
      createdAt: eightDaysAgo,
      updatedAt: sixDaysAgo
    });
    await store.saveOutreachDraft({
      id: "reply-loop-draft",
      leadId: "reply-loop-lead",
      subject: "Northline teardown",
      body: "Short teardown note.",
      followUps: [],
      complianceNotes: [],
      approved: true,
      sendReceipts: [
        {
          status: "sent",
          channel: "smtp",
          recipient: "dispatch@example.com",
          attemptedAt: eightDaysAgo,
          sentAt: eightDaysAgo
        }
      ],
      createdAt: eightDaysAgo,
      updatedAt: eightDaysAgo
    });
    await store.saveLeadReply({
      id: "lead-reply-reply-loop",
      businessId: "auto-funding-agency",
      leadId: "reply-loop-lead",
      source: "imap",
      externalThreadId: "thread-1",
      externalMessageId: "message-1",
      fromAddress: "dispatch@example.com",
      subject: "Re: Northline teardown",
      body: "Interested. Let us know next steps.",
      receivedAt: sixDaysAgo,
      syncedAt: sixDaysAgo,
      classification: {
        disposition: "positive",
        recommendedStage: "responded",
        nextAction: "Book a call.",
        approvalRequired: false,
        route: "booked_call"
      },
      processedAt: sixDaysAgo
    });

    const result = await northlineOps.writePlan({
      businessId: "auto-funding-agency"
    });
    const updatedBusiness = await store.getManagedBusiness("auto-funding-agency");

    assert.equal(result.plan.operatingMode.current, "autonomous");
    assert.ok(result.plan.operatingMode.promotionCriteria.every((criterion) => criterion.status === "met"));
    assert.equal(result.plan.roadblocks.length, 0);
    assert.ok(
      updatedBusiness?.ownerActions.some((action) => action.includes("Keep the VPS wrappers running"))
    );
    assert.ok(
      updatedBusiness?.notes.some((note) => note.includes("Northline operating mode: autonomous"))
    );
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("northline ops excludes legacy, manual, and validation-only clients from proof metrics", async () => {
  const { config, imonEngine, northlineOps, store } = await setupWorkspace();
  await imonEngine.bootstrap();
  const now = new Date().toISOString();

  await store.saveClient({
    id: "legacy-sunrise",
    leadId: "summit-ridge-plumbing",
    clientName: "Legacy Sunrise Plumbing",
    niche: "home services",
    geo: "Akron, OH",
    primaryPhone: "(330) 555-0180",
    primaryEmail: "dispatch@legacysunrise.com",
    offerId: "founding-offer",
    siteStatus: "ready",
    qaStatus: "passed",
    billingStatus: "paid",
    deployment: {
      platform: "local-preview",
      previewPath: path.join(config.outputDir, "legacy-sunrise")
    },
    assets: {
      testimonials: ["Closed more calls after the rebuild."],
      reviews: ["Strong follow-up and clearer intake."],
      proofBundle: {
        clientId: "legacy-sunrise",
        createdAt: now,
        clientName: "Legacy Sunrise Plumbing",
        siteStatus: "ready",
        qaStatus: "passed",
        previewPath: path.join(config.outputDir, "legacy-sunrise"),
        reportPath: path.join(config.reportDir, "legacy-sunrise-proof-bundle.json"),
        screenshots: [
          {
            id: "legacy-sunrise-home-desktop",
            label: "Desktop homepage",
            path: path.join(config.outputDir, "legacy-sunrise-home-desktop.png"),
            viewport: "desktop"
          }
        ],
        testimonialRequest: {
          subject: "Testimonial",
          body: "Share the result in one sentence."
        },
        reviewRequest: {
          subject: "Review",
          body: "Please leave a quick review."
        },
        publication: {
          headline: "Legacy Sunrise proof",
          summary: "Legacy Northline pilot proof bundle.",
          bullets: ["New CTA", "Cleaner intake route"],
          testimonialQuote: "Closed more calls after the rebuild."
        }
      }
    },
    intakeNotes: ["Legacy Northline pilot"],
    nextAction: "Client handoff package is next.",
    createdAt: now,
    updatedAt: now
  });

  await store.saveClient({
    id: "internal-manual-preview",
    businessId: "auto-funding-agency",
    provenance: "internal_manual",
    proofEligible: false,
    clientName: "Internal Manual Preview",
    niche: "home services",
    geo: "Akron, OH",
    primaryPhone: "(330) 555-0191",
    primaryEmail: "ops+manual-preview@example.invalid",
    offerId: "founding-offer",
    siteStatus: "ready",
    qaStatus: "passed",
    billingStatus: "paid",
    deployment: {
      platform: "local-preview",
      previewPath: path.join(config.outputDir, "internal-manual-preview")
    },
    assets: {
      testimonials: ["Manual fixture testimonial that should not count."],
      reviews: ["Manual fixture review that should not count."],
      proofBundle: {
        clientId: "internal-manual-preview",
        businessId: "auto-funding-agency",
        createdAt: now,
        clientName: "Internal Manual Preview",
        siteStatus: "ready",
        qaStatus: "passed",
        previewPath: path.join(config.outputDir, "internal-manual-preview"),
        reportPath: path.join(config.reportDir, "internal-manual-preview-proof-bundle.json"),
        screenshots: [
          {
            id: "internal-manual-preview-home-desktop",
            label: "Desktop homepage",
            path: path.join(config.outputDir, "internal-manual-preview-home-desktop.png"),
            viewport: "desktop"
          }
        ],
        testimonialRequest: {
          subject: "Manual testimonial",
          body: "Manual-only testimonial request."
        },
        reviewRequest: {
          subject: "Manual review",
          body: "Manual-only review request."
        },
        publication: {
          headline: "Internal manual preview",
          summary: "Internal-only fixture proof bundle.",
          bullets: ["Manual fixture", "Not part of proof cohort"],
          testimonialQuote: "Manual fixture testimonial that should not count."
        }
      }
    },
    intakeNotes: ["Internal manual fixture"],
    nextAction: "Internal manual preview only.",
    createdAt: now,
    updatedAt: now
  });

  await store.saveClient({
    id: "northline-validation-artifact",
    businessId: "auto-funding-agency",
    sourceSubmissionId: "northline-validation-artifact",
    clientName: "Northline Validation Artifact",
    niche: "home services",
    geo: "Northline controlled launch validation",
    primaryPhone: "+1-555-0101",
    primaryEmail: "ops+northline-validation@example.invalid",
    offerId: "founding-offer",
    siteStatus: "ready",
    qaStatus: "passed",
    billingStatus: "retainer_active",
    deployment: {
      platform: "local-preview",
      previewPath: path.join(config.outputDir, "northline-validation-artifact")
    },
    assets: {
      proofBundle: {
        clientId: "northline-validation-artifact",
        businessId: "auto-funding-agency",
        createdAt: now,
        clientName: "Northline Validation Artifact",
        siteStatus: "ready",
        qaStatus: "passed",
        previewPath: path.join(config.outputDir, "northline-validation-artifact"),
        reportPath: path.join(config.reportDir, "northline-validation-artifact-proof-bundle.json"),
        screenshots: [
          {
            id: "northline-validation-artifact-home-desktop",
            label: "Desktop homepage",
            path: path.join(config.outputDir, "northline-validation-artifact-home-desktop.png"),
            viewport: "desktop"
          }
        ],
        testimonialRequest: {
          subject: "Validation testimonial",
          body: "Validation-only testimonial request."
        },
        reviewRequest: {
          subject: "Validation review",
          body: "Validation-only review request."
        },
        publication: {
          headline: "Validation artifact",
          summary: "Internal validation artifact.",
          bullets: ["Validation checkout", "Hosted handoff"]
        }
      }
    },
    intakeNotes: [
      "Source: northline-validation-page",
      "Current website: https://northlinegrowthsystems.com/validation.html"
    ],
    nextAction: "Internal validation artifact",
    createdAt: now,
    updatedAt: now
  });

  const result = await northlineOps.writePlan({
    businessId: "auto-funding-agency"
  });
  const pilotClients = result.plan.proofAssets.find((item) => item.id === "pilot-clients");
  const proofMixCriterion = result.plan.operatingMode.promotionCriteria.find(
    (criterion) => criterion.id === "proof-mix"
  );

  assert.equal(pilotClients?.evidence[0], "Tracked Northline clients: 0");
  assert.equal(proofMixCriterion?.status, "missing");
  assert.ok(
    proofMixCriterion?.evidence.some((evidence) =>
      evidence.includes("Proof bundles with screenshots: 0")
    )
  );
  assert.ok(
    proofMixCriterion?.evidence.some((evidence) =>
      evidence.includes("Clients carrying testimonial snippets or proof quotes: 0")
    )
  );
  assert.ok(
    proofMixCriterion?.evidence.some((evidence) =>
      evidence.includes("Stored review snippets: 0; review-request drafts in proof bundles: 0")
    )
  );
});

test("northline site server accepts hosted intake submissions, stores notifications, and queues autonomy", async () => {
  const touchedKeys = [
    "NORTHLINE_SITE_URL",
    "NORTHLINE_DOMAIN",
    "NORTHLINE_SALES_EMAIL",
    "NORTHLINE_LEAD_FORM_ACTION",
    "NORTHLINE_SITE_BIND_HOST",
    "NORTHLINE_SITE_PORT",
    "NORTHLINE_SUBMISSION_STORE_PATH"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));
  let server: NorthlineSiteServer | undefined;

  try {
    const submissionDir = await mkdtemp(path.join(os.tmpdir(), "northline-intake-"));
    const submissionStorePath = path.join(submissionDir, "submissions.json");

    process.env.NORTHLINE_SITE_URL = "https://northlinegrowthsystems.com";
    process.env.NORTHLINE_DOMAIN = "northlinegrowthsystems.com";
    process.env.NORTHLINE_SALES_EMAIL = "contact@northlinegrowthsystems.com";
    process.env.NORTHLINE_BOOKING_URL = "/book.html";
    process.env.NORTHLINE_LEAD_FORM_ACTION = "/api/northline-intake";
    process.env.NORTHLINE_SITE_BIND_HOST = "127.0.0.1";
    process.env.NORTHLINE_SITE_PORT = "0";
    process.env.NORTHLINE_SUBMISSION_STORE_PATH = submissionStorePath;

    const { config, imonEngine, northlineAutonomy, store } = await setupWorkspace();
    await imonEngine.bootstrap();
    await buildAgencySite(config, DEFAULT_AGENCY_PROFILE);

    server = new NorthlineSiteServer(config, {
      onSubmissionStored: async () => {
        await northlineAutonomy.run();
      }
    });
    const address = await server.listen();
    const baseUrl = `http://${address.host}:${address.port}`;

    const healthResponse = await fetch(`${baseUrl}/api/health`);
    const health = (await healthResponse.json()) as { status: string };
    const homePage = await fetch(`${baseUrl}/`);
    const homeHtml = await homePage.text();
    const bookingPage = await fetch(`${baseUrl}/book.html`);
    const bookingHtml = await bookingPage.text();
    const intakePage = await fetch(`${baseUrl}/intake.html`);
    const intakeHtml = await intakePage.text();

    assert.equal(health.status, "ready");
    assert.equal(homePage.status, 200);
    assert.equal(bookingPage.status, 200);
    assert.equal(intakePage.status, 200);
    assert.match(homeHtml, /Get leak review/);
    assert.match(homeHtml, /Need to talk through one urgent leak first\?/);
    assert.doesNotMatch(homeHtml, /See the reply window, first-pass deliverable, and next step before pricing/);
    assert.doesNotMatch(homeHtml, /Northline earns the next step with a clear reply window, a practical first-pass deliverable, and honest fit language before pricing asks for commitment/);
    assert.match(homeHtml, /Review first\. Ship the first fix second\. Open monthly support only after proof exists\./);
    assert.match(homeHtml, /Checkout only after Northline confirms the first paid fix and fit\./);
    assert.doesNotMatch(homeHtml, /System Check/);
    assert.match(
      homeHtml,
      /Start with the leak review\. Book the live review only if you need a short call before Northline points to the next fix\./
    );
    assert.match(bookingHtml, /Book a 15-minute live review if you want Northline to point at the leak with you/);
    assert.match(bookingHtml, /name="pageUrl"/);
    assert.match(bookingHtml, /name="reviewWindow"/);
    assert.match(bookingHtml, /Request Live Review/);
    assert.doesNotMatch(bookingHtml, /Top jobs you want more of/);
    assert.doesNotMatch(bookingHtml, /Main service area/);
    assert.doesNotMatch(bookingHtml, /name="jobType"/);
    assert.doesNotMatch(bookingHtml, /name="bestOutcome"/);
    assert.match(intakeHtml, /Send the page and the main leak\. Northline will tell you what to fix first/);
    assert.match(intakeHtml, /Northline replies within one business day/);
    assert.match(intakeHtml, /name="pageUrl"/);
    assert.match(intakeHtml, /name="targetArea"/);
    assert.match(intakeHtml, /name="targetJobs"/);
    assert.match(intakeHtml, /Send Leak Review/);
    assert.doesNotMatch(intakeHtml, /Best case outcome in the next 90 days/);
    assert.doesNotMatch(intakeHtml, /name="leadGoal"/);
    assert.doesNotMatch(intakeHtml, /name="responseGap"/);

    const submissionResponse = await fetch(`${baseUrl}/api/northline-intake`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        contactName: "Chris",
        businessName: "Signal Plumbing",
        email: "dispatch@signalplumbing.com",
        phone: "(330) 555-0101",
        targetArea: "Akron, OH",
        targetJobs: "Emergency plumbing repair",
        reviewWindow: "Tue 1-3pm ET",
        pageUrl: "https://signalplumbing.com",
        mainProblem: "Weak CTA and slow response times",
        source: "northline-booking-page"
      }).toString(),
      redirect: "manual"
    });
    const submissionBody = (await submissionResponse.json()) as {
      status: string;
      submissionId: string;
      storedCount: number;
    };

    assert.equal(submissionResponse.status, 200);
    assert.equal(submissionBody.status, "ok");
    assert.equal(submissionBody.storedCount, 1);
    await server.waitForAutomation();

    const stored = await readJsonFile<{
      submissions: Array<{
        ownerName?: string;
        businessName?: string;
        source?: string;
        serviceArea?: string;
        primaryServices?: string;
        preferredCallWindow?: string;
        website?: string;
        leadGoal?: string;
        biggestLeak?: string;
      }>;
    }>(
      submissionStorePath,
      { submissions: [] }
    );
    const latestNotification = await readTextFile(
      path.join(config.notificationDir, "northline-intake-latest.txt")
    );
    const promotedClient = await store.getClient("signal-plumbing");
    const approvals = await store.getApprovals();
    const billingApproval = approvals.find(
      (task) => task.id === "approval-northline-billing-handoff-signal-plumbing"
    );

    assert.equal(stored.submissions.length, 1);
    assert.equal(stored.submissions[0]?.ownerName, "Chris");
    assert.equal(stored.submissions[0]?.businessName, "Signal Plumbing");
    assert.equal(stored.submissions[0]?.source, "northline-booking-page");
    assert.equal(stored.submissions[0]?.serviceArea, "Akron, OH");
    assert.equal(stored.submissions[0]?.primaryServices, "Emergency plumbing repair");
    assert.equal(stored.submissions[0]?.preferredCallWindow, "Tue 1-3pm ET");
    assert.equal(stored.submissions[0]?.website, "https://signalplumbing.com");
    assert.equal(stored.submissions[0]?.leadGoal, undefined);
    assert.equal(stored.submissions[0]?.biggestLeak, "Weak CTA and slow response times");
    assert.match(latestNotification, /Signal Plumbing/);
    assert.match(latestNotification, /Best outcome: Not provided/);
    assert.match(latestNotification, /Preferred call window: Tue 1-3pm ET/);
    assert.match(latestNotification, /Website: https:\/\/signalplumbing\.com/);
    assert.match(latestNotification, /Booked-job leak:/);
    assert.ok(promotedClient);
    assert.equal(promotedClient?.sourceSubmissionId, submissionBody.submissionId);
    assert.equal(promotedClient?.billingStatus, "proposal");
    assert.equal(promotedClient?.provenance, "external_inbound");
    assert.equal(promotedClient?.proofEligible, true);
    assert.equal(billingApproval?.status, "open");
  } finally {
    if (server) {
      await server.close();
    }
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("northline validation run promotes a validation intake through build, QA, and client handoff packaging", async () => {
  const touchedKeys = [
    "NORTHLINE_SITE_URL",
    "NORTHLINE_DOMAIN",
    "NORTHLINE_SALES_EMAIL",
    "NORTHLINE_BOOKING_URL",
    "NORTHLINE_LEAD_FORM_ACTION",
    "NORTHLINE_SUBMISSION_STORE_PATH",
    "NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING",
    "NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD",
    "NORTHLINE_STRIPE_PAYMENT_LINK_VALIDATION"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  try {
    const submissionDir = await mkdtemp(path.join(os.tmpdir(), "northline-validation-run-"));
    const submissionStorePath = path.join(submissionDir, "submissions.json");
    const receivedAt = new Date().toISOString();

    process.env.NORTHLINE_SITE_URL = "https://northlinegrowthsystems.com";
    process.env.NORTHLINE_DOMAIN = "northlinegrowthsystems.com";
    process.env.NORTHLINE_SALES_EMAIL = "contact@northlinegrowthsystems.com";
    process.env.NORTHLINE_BOOKING_URL = "/book.html";
    process.env.NORTHLINE_LEAD_FORM_ACTION = "/api/northline-intake";
    process.env.NORTHLINE_SUBMISSION_STORE_PATH = submissionStorePath;
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING = "https://buy.stripe.com/founding";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD = "https://buy.stripe.com/standard";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_VALIDATION = "https://buy.stripe.com/validation";

    const { imonEngine, northlineAutonomy, store, config } = await setupWorkspace();
    await imonEngine.bootstrap();
    const validation = new NorthlineValidationService(config, store, northlineAutonomy);

    await writeFile(
      submissionStorePath,
      JSON.stringify(
        {
          submissions: [
            {
              id: "northline-validation-1",
              receivedAt,
              ownerName: "Chris",
              businessName: "Signal Plumbing",
              email: "dispatch@signalplumbing.com",
              phone: "(330) 555-0101",
              serviceArea: "Akron, OH",
              primaryServices: "Emergency plumbing repair; Drain cleaning",
              preferredCallWindow: "Tue 1-3pm ET",
              contactPreference: "Call",
              website: "https://signalplumbing.com",
              leadGoal: "Validate the full Northline post-purchase pipeline",
              biggestLeak: "Hosted intake, validation checkout, billing handoff, preview build, QA, client handoff packaging, and retention artifacts.",
              notes: "Temporary $1 validation before wider launch.",
              source: "northline-validation-page"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const result = await validation.run({
      submissionId: "northline-validation-1",
      status: "retainer_active",
      formEndpoint: "https://hooks.example.com/forms/signal-plumbing"
    });
    const client = await store.getClient(result.clientId);
    const retentionReports = await store.getRetentionReports();
    const retention = retentionReports.find((report) => report.clientId === result.clientId);

    assert.equal(result.status, "success");
    assert.equal(result.submissionId, "northline-validation-1");
    assert.equal(result.billingStatus, "retainer_active");
    assert.equal(result.siteStatus, "ready");
    assert.equal(result.qaStatus, "passed");
    assert.ok(result.handoffPackage);
    assert.ok(result.previewPath);
    assert.ok(result.artifacts.previewPath);
    assert.equal(result.warnings.length, 0);
    assert.ok(client);
    assert.equal(client?.sourceSubmissionId, "northline-validation-1");
    assert.equal(client?.formEndpoint, "https://hooks.example.com/forms/signal-plumbing");
    assert.equal(client?.provenance, "internal_validation");
    assert.equal(client?.proofEligible, false);
    assert.ok(retention);
    assert.ok(result.retentionReport);
    assert.ok(result.proofBundle);
    assert.equal(result.proofBundle?.screenshotCount, 2);
    assert.ok(await exists(result.artifacts.autonomySummaryPath));
    assert.ok(await exists(result.artifacts.previewPath ?? ""));
    assert.ok(await exists(result.artifacts.proofBundlePath ?? ""));
    assert.ok(await exists(result.artifacts.handoffPackagePath ?? ""));
    assert.equal(result.artifacts.proofScreenshotPaths.length, 2);
    assert.ok(await exists(result.artifacts.proofScreenshotPaths[0] ?? ""));
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("northline site server confirms validation checkout through a hosted handoff", async () => {
  const touchedKeys = [
    "NORTHLINE_SITE_URL",
    "NORTHLINE_DOMAIN",
    "NORTHLINE_SALES_EMAIL",
    "NORTHLINE_BOOKING_URL",
    "NORTHLINE_LEAD_FORM_ACTION",
    "NORTHLINE_SITE_BIND_HOST",
    "NORTHLINE_SITE_PORT",
    "NORTHLINE_SUBMISSION_STORE_PATH",
    "NORTHLINE_STRIPE_PAYMENT_LINK_VALIDATION"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));
  let server: NorthlineSiteServer | undefined;

  try {
    const submissionDir = await mkdtemp(path.join(os.tmpdir(), "northline-validation-site-"));
    const submissionStorePath = path.join(submissionDir, "submissions.json");

    process.env.NORTHLINE_SITE_URL = "https://northlinegrowthsystems.com";
    process.env.NORTHLINE_DOMAIN = "northlinegrowthsystems.com";
    process.env.NORTHLINE_SALES_EMAIL = "contact@northlinegrowthsystems.com";
    process.env.NORTHLINE_BOOKING_URL = "/book.html";
    process.env.NORTHLINE_LEAD_FORM_ACTION = "/api/northline-intake";
    process.env.NORTHLINE_SITE_BIND_HOST = "127.0.0.1";
    process.env.NORTHLINE_SITE_PORT = "0";
    process.env.NORTHLINE_SUBMISSION_STORE_PATH = submissionStorePath;
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_VALIDATION = "https://buy.stripe.com/validation";

    const { config, imonEngine, northlineAutonomy, northlineValidation, store } = await setupWorkspace();
    await imonEngine.bootstrap();
    await buildAgencySite(config, DEFAULT_AGENCY_PROFILE);

    server = new NorthlineSiteServer(config, {
      onSubmissionStored: async () => {
        await northlineAutonomy.run();
      },
      onValidationConfirmed: async (request) => northlineValidation.run(request)
    });
    const address = await server.listen();
    const baseUrl = `http://${address.host}:${address.port}`;

    const validationPage = await fetch(`${baseUrl}/validation.html`);
    const validationHtml = await validationPage.text();

    assert.equal(validationPage.status, 200);
    assert.match(validationHtml, /Confirm paid handoff/);
    assert.match(validationHtml, /CLI fallback/);
    assert.match(validationHtml, /Submit the validation intake first/i);
    assert.doesNotMatch(validationHtml, /Preview \$1 checkout/);

    const submissionResponse = await fetch(`${baseUrl}/api/northline-intake`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        ownerName: "Chris",
        businessName: "Signal Plumbing",
        email: "dispatch@signalplumbing.com",
        phone: "(330) 555-0101",
        serviceArea: "Akron, OH",
        primaryServices: "Emergency plumbing repair; Drain cleaning",
        preferredCallWindow: "Tue 1-3pm ET",
        contactPreference: "Call",
        website: "https://signalplumbing.com",
        leadGoal: "Validate the full Northline post-purchase pipeline",
        biggestLeak:
          "Hosted intake, validation checkout, billing handoff, preview build, QA, client handoff packaging, and retention artifacts.",
        notes: "Temporary $1 validation before wider launch.",
        source: "northline-validation-page"
      }).toString()
    });
    const submissionBody = (await submissionResponse.json()) as {
      status: string;
      submissionId: string;
      validationConfirmation?: {
        autoHandoffEnabled?: boolean;
        checkoutReference?: string;
        confirmationToken?: string;
        statusEndpoint?: string;
      };
    };

    assert.equal(submissionResponse.status, 200);
    assert.equal(submissionBody.status, "ok");
    assert.ok(submissionBody.validationConfirmation?.confirmationToken);
    assert.equal(submissionBody.validationConfirmation?.autoHandoffEnabled, false);
    assert.equal(
      submissionBody.validationConfirmation?.checkoutReference,
      `validation:${submissionBody.submissionId}`
    );
    assert.equal(
      submissionBody.validationConfirmation?.statusEndpoint,
      "/api/northline-validation-status"
    );
    await server.waitForAutomation();

    const statusBeforeResponse = await fetch(
      `${baseUrl}/api/northline-validation-status?` +
        new URLSearchParams({
          submissionId: submissionBody.submissionId,
          confirmationToken: submissionBody.validationConfirmation?.confirmationToken ?? ""
        }).toString()
    );
    const statusBeforeBody = (await statusBeforeResponse.json()) as {
      status: string;
      autoHandoffEnabled: boolean;
      confirmation: {
        createdAt?: string;
        lastConfirmedAt?: string;
        lastResult?: { status: string };
      };
    };

    assert.equal(statusBeforeResponse.status, 200);
    assert.equal(statusBeforeBody.status, "ok");
    assert.equal(statusBeforeBody.autoHandoffEnabled, false);
    assert.ok(statusBeforeBody.confirmation.createdAt);
    assert.equal(statusBeforeBody.confirmation.lastConfirmedAt, undefined);
    assert.equal(statusBeforeBody.confirmation.lastResult, undefined);

    const confirmResponse = await fetch(`${baseUrl}/api/northline-validation-confirm`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        submissionId: submissionBody.submissionId,
        confirmationToken: submissionBody.validationConfirmation?.confirmationToken,
        status: "retainer_active",
        formEndpoint: "https://hooks.example.com/forms/signal-plumbing"
      })
    });
    const confirmBody = (await confirmResponse.json()) as {
      status: string;
      result: {
        status: string;
        clientId: string;
        billingStatus: string;
        siteStatus: string;
        qaStatus: string;
        handoffPackage?: { readmePath: string };
        retentionReport?: { clientId: string };
        warnings: string[];
      };
    };

    const client = await store.getClient(confirmBody.result.clientId);
    const confirmationState = await readJsonFile<{
      confirmations: Array<{
        submissionId: string;
        lastConfirmedAt?: string;
        lastResult?: { clientId: string; status: string };
      }>;
    }>(path.join(config.stateDir, "northlineValidationConfirmations.json"), {
      confirmations: []
    });

    assert.equal(confirmResponse.status, 200);
    assert.equal(confirmBody.status, "ok");
    assert.equal(confirmBody.result.status, "success");
    assert.equal(confirmBody.result.billingStatus, "retainer_active");
    assert.equal(confirmBody.result.siteStatus, "ready");
    assert.equal(confirmBody.result.qaStatus, "passed");
    assert.ok(confirmBody.result.handoffPackage?.readmePath);
    assert.ok(confirmBody.result.retentionReport);
    assert.equal(confirmBody.result.warnings.length, 0);
    assert.ok(client);
    assert.equal(client?.formEndpoint, "https://hooks.example.com/forms/signal-plumbing");
    const statusAfterResponse = await fetch(
      `${baseUrl}/api/northline-validation-status?` +
        new URLSearchParams({
          submissionId: submissionBody.submissionId,
          confirmationToken: submissionBody.validationConfirmation?.confirmationToken ?? ""
        }).toString()
    );
    const statusAfterBody = (await statusAfterResponse.json()) as {
      status: string;
      autoHandoffEnabled: boolean;
      confirmation: {
        lastConfirmedAt?: string;
        lastResult?: { clientId: string; status: string };
      };
    };

    assert.equal(statusAfterResponse.status, 200);
    assert.equal(statusAfterBody.status, "ok");
    assert.equal(statusAfterBody.autoHandoffEnabled, false);
    assert.equal(statusAfterBody.confirmation.lastResult?.status, "success");
    assert.equal(statusAfterBody.confirmation.lastResult?.clientId, confirmBody.result.clientId);
    assert.ok(statusAfterBody.confirmation.lastConfirmedAt);
    assert.equal(
      confirmationState.confirmations.find(
        (record) => record.submissionId === submissionBody.submissionId
      )?.lastResult?.clientId,
      confirmBody.result.clientId
    );
    assert.equal(
      confirmationState.confirmations.find(
        (record) => record.submissionId === submissionBody.submissionId
      )?.lastResult?.status,
      "success"
    );
    assert.ok(
      confirmationState.confirmations.find(
        (record) => record.submissionId === submissionBody.submissionId
      )?.lastConfirmedAt
    );
  } finally {
    if (server) {
      await server.close();
    }
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("create-client generated-brand helper forces internal rehearsal metadata", async () => {
  const { root, store } = await setupWorkspace();
  const briefPath = path.join(root, "generated-brand-brief.json");

  await writeFile(
    briefPath,
    JSON.stringify(
      {
        businessId: "auto-funding-agency",
        clientName: "Queens Boiler Team",
        niche: "HVAC",
        geo: "Queens, NY",
        primaryPhone: "(347) 555-0199",
        primaryEmail: "ops@queensboilerteam.com",
        provenance: "external_outbound",
        proofEligible: true,
        intakeNotes: ["Stress-test the Northline rehearsal path."]
      },
      null,
      2
    ),
    "utf8"
  );

  const client = await createClientFromBrief(store, briefPath, { generatedBrand: true });
  const saved = await store.getClient(client.id);

  assert.equal(client.provenance, "internal_manual");
  assert.equal(client.proofEligible, false);
  assert.ok(
    client.intakeNotes.includes(
      "Generated brand rehearsal. Keep this record internal-only and non-proof-eligible until an operator deliberately reclassifies it."
    )
  );
  assert.equal(saved?.provenance, "internal_manual");
  assert.equal(saved?.proofEligible, false);
});

test("northline site server auto-confirms validation checkout from a Stripe webhook", async () => {
  const touchedKeys = [
    "NORTHLINE_SITE_URL",
    "NORTHLINE_DOMAIN",
    "NORTHLINE_SALES_EMAIL",
    "NORTHLINE_BOOKING_URL",
    "NORTHLINE_LEAD_FORM_ACTION",
    "NORTHLINE_SITE_BIND_HOST",
    "NORTHLINE_SITE_PORT",
    "NORTHLINE_SUBMISSION_STORE_PATH",
    "NORTHLINE_STRIPE_PAYMENT_LINK_VALIDATION",
    "NORTHLINE_STRIPE_WEBHOOK_SECRET"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));
  let server: NorthlineSiteServer | undefined;

  try {
    const submissionDir = await mkdtemp(path.join(os.tmpdir(), "northline-validation-webhook-"));
    const submissionStorePath = path.join(submissionDir, "submissions.json");

    process.env.NORTHLINE_SITE_URL = "https://northlinegrowthsystems.com";
    process.env.NORTHLINE_DOMAIN = "northlinegrowthsystems.com";
    process.env.NORTHLINE_SALES_EMAIL = "contact@northlinegrowthsystems.com";
    process.env.NORTHLINE_BOOKING_URL = "/book.html";
    process.env.NORTHLINE_LEAD_FORM_ACTION = "/api/northline-intake";
    process.env.NORTHLINE_SITE_BIND_HOST = "127.0.0.1";
    process.env.NORTHLINE_SITE_PORT = "0";
    process.env.NORTHLINE_SUBMISSION_STORE_PATH = submissionStorePath;
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_VALIDATION = "https://buy.stripe.com/validation";
    process.env.NORTHLINE_STRIPE_WEBHOOK_SECRET = "whsec_test_validation";

    const { config, imonEngine, northlineAutonomy, northlineValidation, store } = await setupWorkspace();
    await imonEngine.bootstrap();
    await buildAgencySite(config, DEFAULT_AGENCY_PROFILE);

    server = new NorthlineSiteServer(config, {
      onSubmissionStored: async () => {
        await northlineAutonomy.run();
      },
      onValidationConfirmed: async (request) => northlineValidation.run(request)
    });
    const address = await server.listen();
    const baseUrl = `http://${address.host}:${address.port}`;

    const submissionResponse = await fetch(`${baseUrl}/api/northline-intake`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        ownerName: "Chris",
        businessName: "Signal Plumbing",
        email: "dispatch@signalplumbing.com",
        phone: "(330) 555-0101",
        serviceArea: "Akron, OH",
        primaryServices: "Emergency plumbing repair; Drain cleaning",
        preferredCallWindow: "Tue 1-3pm ET",
        contactPreference: "Call",
        website: "https://signalplumbing.com",
        leadGoal: "Validate the full Northline post-purchase pipeline",
        biggestLeak:
          "Hosted intake, validation checkout, billing handoff, preview build, QA, client handoff packaging, and retention artifacts.",
        notes: "Temporary $1 validation before wider launch.",
        source: "northline-validation-page"
      }).toString()
    });
    const submissionBody = (await submissionResponse.json()) as {
      status: string;
      submissionId: string;
      validationConfirmation?: {
        autoHandoffEnabled?: boolean;
        checkoutReference?: string;
        confirmationToken?: string;
      };
    };

    assert.equal(submissionResponse.status, 200);
    assert.equal(submissionBody.status, "ok");
    assert.equal(submissionBody.validationConfirmation?.autoHandoffEnabled, true);
    assert.equal(
      submissionBody.validationConfirmation?.checkoutReference,
      `validation:${submissionBody.submissionId}`
    );
    await server.waitForAutomation();

    const event = {
      id: "evt_validation_completed",
      type: "checkout.session.completed",
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      data: {
        object: {
          id: "cs_validation_completed",
          client_reference_id: submissionBody.validationConfirmation?.checkoutReference,
          customer_details: {
            email: "dispatch@signalplumbing.com"
          },
          payment_status: "paid",
          status: "complete"
        }
      }
    };
    const rawBody = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac(
      "sha256",
      process.env.NORTHLINE_STRIPE_WEBHOOK_SECRET ?? ""
    )
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");

    const webhookResponse = await fetch(`${baseUrl}/api/northline-stripe-webhook`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Stripe-Signature": `t=${timestamp},v1=${signature}`
      },
      body: rawBody
    });
    const webhookBody = (await webhookResponse.json()) as {
      status: string;
      eventId: string;
      result: {
        status: string;
        clientId: string;
        billingStatus: string;
        siteStatus: string;
        qaStatus: string;
        handoffPackage?: { readmePath: string };
        retentionReport?: { clientId: string };
      };
      submissionId: string;
    };

    const duplicateWebhookResponse = await fetch(`${baseUrl}/api/northline-stripe-webhook`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Stripe-Signature": `t=${timestamp},v1=${signature}`
      },
      body: rawBody
    });
    const duplicateWebhookBody = (await duplicateWebhookResponse.json()) as {
      status: string;
      eventId: string;
    };

    const client = await store.getClient(webhookBody.result.clientId);
    const confirmationState = await readJsonFile<{
      confirmations: Array<{
        submissionId: string;
        lastConfirmedAt?: string;
        lastResult?: { clientId: string; status: string };
        lastStripeCompletedAt?: string;
        lastStripeCustomerEmail?: string;
        lastStripeEventId?: string;
        lastStripeReferenceId?: string;
        lastStripeSessionId?: string;
      }>;
      processedStripeEventIds?: string[];
    }>(path.join(config.stateDir, "northlineValidationConfirmations.json"), {
      confirmations: [],
      processedStripeEventIds: []
    });
    const statusResponse = await fetch(
      `${baseUrl}/api/northline-validation-status?` +
        new URLSearchParams({
          submissionId: submissionBody.submissionId,
          confirmationToken: submissionBody.validationConfirmation?.confirmationToken ?? ""
        }).toString()
    );
    const statusBody = (await statusResponse.json()) as {
      status: string;
      autoHandoffEnabled: boolean;
      confirmation: {
        lastConfirmedAt?: string;
        lastResult?: { clientId: string; status: string };
        lastStripeCompletedAt?: string;
        lastStripeCustomerEmail?: string;
        lastStripeEventId?: string;
        lastStripeReferenceId?: string;
        lastStripeSessionId?: string;
      };
    };

    assert.equal(webhookResponse.status, 200);
    assert.equal(webhookBody.status, "ok");
    assert.equal(webhookBody.eventId, event.id);
    assert.equal(webhookBody.submissionId, submissionBody.submissionId);
    assert.equal(webhookBody.result.status, "success");
    assert.equal(webhookBody.result.billingStatus, "retainer_active");
    assert.equal(webhookBody.result.siteStatus, "ready");
    assert.equal(webhookBody.result.qaStatus, "passed");
    assert.ok(webhookBody.result.handoffPackage?.readmePath);
    assert.ok(webhookBody.result.retentionReport);
    assert.equal(duplicateWebhookResponse.status, 200);
    assert.equal(duplicateWebhookBody.status, "duplicate");
    assert.equal(duplicateWebhookBody.eventId, event.id);
    assert.ok(client);
    assert.equal(client?.formEndpoint, "https://northlinegrowthsystems.com/api/northline-intake");
    assert.equal(statusResponse.status, 200);
    assert.equal(statusBody.status, "ok");
    assert.equal(statusBody.autoHandoffEnabled, true);
    assert.equal(statusBody.confirmation.lastResult?.status, "success");
    assert.equal(statusBody.confirmation.lastResult?.clientId, webhookBody.result.clientId);
    assert.equal(statusBody.confirmation.lastStripeEventId, event.id);
    assert.equal(
      statusBody.confirmation.lastStripeReferenceId,
      submissionBody.validationConfirmation?.checkoutReference
    );
    assert.equal(statusBody.confirmation.lastStripeSessionId, "cs_validation_completed");
    assert.equal(
      statusBody.confirmation.lastStripeCustomerEmail,
      "dispatch@signalplumbing.com"
    );
    assert.ok(statusBody.confirmation.lastStripeCompletedAt);
    assert.ok(statusBody.confirmation.lastConfirmedAt);
    assert.equal(
      confirmationState.confirmations.find(
        (record) => record.submissionId === submissionBody.submissionId
      )?.lastResult?.status,
      "success"
    );
    assert.equal(
      confirmationState.confirmations.find(
        (record) => record.submissionId === submissionBody.submissionId
      )?.lastResult?.clientId,
      webhookBody.result.clientId
    );
    assert.equal(
      confirmationState.confirmations.find(
        (record) => record.submissionId === submissionBody.submissionId
      )?.lastStripeEventId,
      event.id
    );
    assert.equal(
      confirmationState.confirmations.find(
        (record) => record.submissionId === submissionBody.submissionId
      )?.lastStripeReferenceId,
      submissionBody.validationConfirmation?.checkoutReference
    );
    assert.equal(
      confirmationState.confirmations.find(
        (record) => record.submissionId === submissionBody.submissionId
      )?.lastStripeSessionId,
      "cs_validation_completed"
    );
    assert.equal(
      confirmationState.confirmations.find(
        (record) => record.submissionId === submissionBody.submissionId
      )?.lastStripeCustomerEmail,
      "dispatch@signalplumbing.com"
    );
    assert.ok(
      confirmationState.confirmations.find(
        (record) => record.submissionId === submissionBody.submissionId
      )?.lastStripeCompletedAt
    );
    assert.ok(
      confirmationState.confirmations.find(
        (record) => record.submissionId === submissionBody.submissionId
      )?.lastConfirmedAt
    );
    assert.ok(confirmationState.processedStripeEventIds?.includes(event.id));
  } finally {
    if (server) {
      await server.close();
    }
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("hosted Northline Stripe webhook promotes proposal clients outside the validation page", async () => {
  const touchedKeys = [
    "NORTHLINE_SITE_URL",
    "NORTHLINE_DOMAIN",
    "NORTHLINE_SALES_EMAIL",
    "NORTHLINE_BOOKING_URL",
    "NORTHLINE_LEAD_FORM_ACTION",
    "NORTHLINE_SITE_BIND_HOST",
    "NORTHLINE_SITE_PORT",
    "NORTHLINE_STRIPE_WEBHOOK_SECRET",
    "NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING",
    "NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD",
    "NORTHLINE_STRIPE_PAYMENT_LINK_GROWTH_UPGRADE",
    "NORTHLINE_GROWTH_UPGRADE_COUPON_LABEL",
    "NORTHLINE_GROWTH_UPGRADE_COUPON_TERMS"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));
  let server: NorthlineSiteServer | undefined;

  try {
    process.env.NORTHLINE_SITE_URL = "https://northlinegrowthsystems.com";
    process.env.NORTHLINE_DOMAIN = "northlinegrowthsystems.com";
    process.env.NORTHLINE_SALES_EMAIL = "contact@northlinegrowthsystems.com";
    process.env.NORTHLINE_BOOKING_URL = "/book.html";
    process.env.NORTHLINE_LEAD_FORM_ACTION = "/api/northline-intake";
    process.env.NORTHLINE_SITE_BIND_HOST = "127.0.0.1";
    process.env.NORTHLINE_SITE_PORT = "0";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING = "https://buy.stripe.com/founding";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD = "https://buy.stripe.com/standard";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_GROWTH_UPGRADE = "https://buy.stripe.com/proposal_growth_upgrade";
    process.env.NORTHLINE_GROWTH_UPGRADE_COUPON_LABEL = "Proposal upgrade";
    process.env.NORTHLINE_GROWTH_UPGRADE_COUPON_TERMS =
      "Apply within 21 days of the Lead Generation launch.";
    process.env.NORTHLINE_STRIPE_WEBHOOK_SECRET = "whsec_test_proposal";

    const { config, imonEngine, northlineAutonomy, store } = await setupWorkspace();
    await imonEngine.bootstrap();
    await buildAgencySite(config, DEFAULT_AGENCY_PROFILE);

    const now = new Date().toISOString();
    await store.saveClient({
      id: "signal-plumbing",
      businessId: "auto-funding-agency",
      clientName: "Signal Plumbing",
      niche: "home services",
      geo: "Akron, OH",
      primaryPhone: "(330) 555-0101",
      primaryEmail: "dispatch@signalplumbing.com",
      offerId: "lead-generation-offer",
      siteStatus: "not_started",
      qaStatus: "pending",
      billingStatus: "proposal",
      deployment: {
        platform: "local-preview"
      },
      assets: {
        logoText: "Signal Plumbing",
        services: ["Emergency plumbing repair", "Drain cleaning"]
      },
      intakeNotes: [],
      nextAction: "Confirm billing",
      createdAt: now,
      updatedAt: now
    });

    server = new NorthlineSiteServer(config, {
      onSubmissionStored: async () => {
        await northlineAutonomy.run();
      },
      onProposalPaymentCompleted: async (request) => northlineAutonomy.runBillingAutomation(request)
    });
    const address = await server.listen();
    const baseUrl = `http://${address.host}:${address.port}`;

    const event = {
      id: "evt_proposal_completed",
      type: "checkout.session.completed",
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      data: {
        object: {
          id: "cs_proposal_completed",
          client_reference_id: "client:signal-plumbing:retainer_active",
          customer_details: {
            email: "dispatch@signalplumbing.com"
          },
          metadata: {
            northlineFormEndpoint: "https://northlinegrowthsystems.com/api/northline-intake"
          },
          payment_status: "paid",
          status: "complete"
        }
      }
    };
    const rawBody = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac(
      "sha256",
      process.env.NORTHLINE_STRIPE_WEBHOOK_SECRET ?? ""
    )
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");

    const webhookResponse = await fetch(`${baseUrl}/api/northline-stripe-webhook`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Stripe-Signature": `t=${timestamp},v1=${signature}`
      },
      body: rawBody
    });
    const webhookBody = (await webhookResponse.json()) as {
      status: string;
      eventId: string;
      clientId: string;
      result: {
        status: string;
        clientId: string;
        billingStatus: string;
        siteStatus: string;
        qaStatus: string;
        handoffPackage?: { readmePath: string };
        retentionReport?: {
          clientId: string;
          upgradeOffer?: {
            paymentLink?: string;
            couponLabel?: string;
            terms?: string;
          };
        };
      };
    };

    const duplicateWebhookResponse = await fetch(`${baseUrl}/api/northline-stripe-webhook`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Stripe-Signature": `t=${timestamp},v1=${signature}`
      },
      body: rawBody
    });
    const duplicateWebhookBody = (await duplicateWebhookResponse.json()) as {
      status: string;
      eventId: string;
    };

    const client = await store.getClient("signal-plumbing");

    assert.equal(webhookResponse.status, 200);
    assert.equal(webhookBody.status, "ok");
    assert.equal(webhookBody.eventId, event.id);
    assert.equal(webhookBody.clientId, "signal-plumbing");
    assert.equal(webhookBody.result.status, "success");
    assert.equal(webhookBody.result.clientId, "signal-plumbing");
    assert.equal(webhookBody.result.billingStatus, "retainer_active");
    assert.equal(webhookBody.result.siteStatus, "ready");
    assert.equal(webhookBody.result.qaStatus, "passed");
    assert.ok(webhookBody.result.handoffPackage?.readmePath);
    assert.ok(webhookBody.result.retentionReport);
    assert.equal(
      webhookBody.result.retentionReport?.upgradeOffer?.paymentLink,
      "https://buy.stripe.com/proposal_growth_upgrade"
    );
    assert.equal(webhookBody.result.retentionReport?.upgradeOffer?.couponLabel, "Proposal upgrade");
    assert.equal(
      webhookBody.result.retentionReport?.upgradeOffer?.terms,
      "Apply within 21 days of the Lead Generation launch."
    );
    assert.equal(duplicateWebhookResponse.status, 200);
    assert.equal(duplicateWebhookBody.status, "duplicate");
    assert.equal(duplicateWebhookBody.eventId, event.id);
    assert.equal(client?.billingStatus, "retainer_active");
    assert.equal(client?.formEndpoint, "https://northlinegrowthsystems.com/api/northline-intake");
    assert.ok(client?.intakeNotes.some((note) => note.includes("evt_proposal_completed")));
  } finally {
    if (server) {
      await server.close();
    }
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("northline autonomy turns hosted intake and drafted outbound into tracked work", async () => {
  const touchedKeys = [
    "NORTHLINE_SITE_URL",
    "NORTHLINE_DOMAIN",
    "NORTHLINE_SALES_EMAIL",
    "NORTHLINE_BOOKING_URL",
    "NORTHLINE_LEAD_FORM_ACTION",
    "NORTHLINE_SUBMISSION_STORE_PATH"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  try {
    const submissionDir = await mkdtemp(path.join(os.tmpdir(), "northline-autonomy-intake-"));
    const submissionStorePath = path.join(submissionDir, "submissions.json");
    process.env.NORTHLINE_SITE_URL = "https://northlinegrowthsystems.com";
    process.env.NORTHLINE_DOMAIN = "northlinegrowthsystems.com";
    process.env.NORTHLINE_SALES_EMAIL = "contact@northlinegrowthsystems.com";
    process.env.NORTHLINE_BOOKING_URL = "/book.html";
    process.env.NORTHLINE_LEAD_FORM_ACTION = "/api/northline-intake";
    process.env.NORTHLINE_SUBMISSION_STORE_PATH = submissionStorePath;

    const { imonEngine, northlineAutonomy, store, config } = await setupWorkspace();
    await imonEngine.bootstrap();
    const now = new Date().toISOString();

    await store.saveLead({
      id: "signal-plumbing-lead",
      businessId: "auto-funding-agency",
      businessName: "Signal Plumbing",
      niche: "home services",
      geo: "Akron, OH",
      source: "manual-test",
      contact: {
        ownerName: "Chris",
        email: "dispatch@signalplumbing.com",
        phone: "(330) 555-0101",
        website: "https://signalplumbing.com"
      },
      websiteQualitySignals: {
        hasWebsite: true,
        hasHttps: true,
        mobileFriendly: false,
        clearOffer: false,
        callsToAction: false,
        pageSpeedBucket: "slow",
        notes: ["Weak CTA"]
      },
      score: 88,
      scoreReasons: ["Weak CTA", "Has reachable contact info"],
      stage: "qualified",
      tags: ["northline"],
      createdAt: now,
      updatedAt: now
    });

    await writeFile(
      submissionStorePath,
      JSON.stringify(
        {
          submissions: [
            {
              id: "northline-intake-1",
              receivedAt: now,
              ownerName: "Chris",
              businessName: "Signal Plumbing",
              email: "dispatch@signalplumbing.com",
              phone: "(330) 555-0101",
              serviceArea: "Akron, OH",
              primaryServices: "Emergency plumbing repair; Drain cleaning",
              preferredCallWindow: "Tue 1-3pm ET",
              contactPreference: "Call",
              website: "https://signalplumbing.com",
              leadGoal: "20 more booked calls",
              biggestLeak: "Weak CTA and slow response times",
              notes: "Needs a simple intake path",
              source: "northline-intake-page"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const result = await northlineAutonomy.run();
    const createdClient = await store.getClient("signal-plumbing");
    const updatedLead = await store.getLead("signal-plumbing-lead");
    const draft = (await store.getOutreachDrafts()).find((candidate) => candidate.leadId === "signal-plumbing-lead");
    const approvals = await store.getApprovals();
    const autonomyState = await readJsonFile<{ processedSubmissionIds: string[] }>(
      path.join(config.stateDir, "northlineAutonomy.json"),
      { processedSubmissionIds: [] }
    );
    const autonomySummary = await readJsonFile<{ snapshot: { summary: string; planOperatingMode: string } }>(
      path.join(config.opsDir, "northline-growth-system", "autonomy-summary.json"),
      { snapshot: { summary: "", planOperatingMode: "" } }
    );

    assert.ok(createdClient);
    assert.equal(createdClient?.sourceSubmissionId, "northline-intake-1");
    assert.equal(createdClient?.billingStatus, "proposal");
    assert.equal(createdClient?.provenance, "external_inbound");
    assert.equal(createdClient?.proofEligible, true);
    assert.equal(updatedLead?.stage, "contacted");
    assert.equal(draft?.sendReceipts?.[0]?.status, "sent");
    assert.ok(result.snapshot.newIntakes.some((item) => item.status === "created"));
    assert.ok(result.snapshot.outboundQueue.some((item) => item.status === "sent"));
    assert.ok(
      approvals.some((task) => task.id === "approval-northline-billing-handoff-signal-plumbing")
    );
    assert.ok(
      !approvals.some((task) => task.id === "approval-outbound-send-signal-plumbing-lead-draft")
    );
    assert.ok(autonomyState.processedSubmissionIds.includes("northline-intake-1"));
    assert.equal(autonomySummary.snapshot.summary, result.summary);
    assert.equal(autonomySummary.snapshot.planOperatingMode, result.plan.operatingMode.current);
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("northline autonomy sources prospects before drafting outreach", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "northline-autonomy-source-"));
  const sourceDir = path.join(root, "sources");
  const touchedKeys = ["NORTHLINE_PROSPECT_SOURCE_DIR"] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  try {
    process.env.NORTHLINE_PROSPECT_SOURCE_DIR = sourceDir;
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      path.join(sourceDir, "batch-a.csv"),
      [
        "businessName,niche,city,state,ownerName,email,phone,website,hasWebsite,hasHttps,mobileFriendly,clearOffer,callsToAction,pageSpeedBucket,notes,tags",
        "Summit Ridge Plumbing,home services,Akron,OH,Chris,chris@summitridgeplumbing.com,(330) 555-0180,http://summitridgeplumbing.com,true,false,false,false,false,slow,No HTTPS; buried CTA,priority"
      ].join("\n"),
      "utf8"
    );

    const { imonEngine, northlineAutonomy, store } = await setupWorkspace();
    await imonEngine.bootstrap();
    const result = await northlineAutonomy.run();
    const leads = await store.getLeads();

    assert.ok(leads.some((lead) => lead.id === "summit-ridge-plumbing"));
    assert.equal((await store.getLead("summit-ridge-plumbing"))?.stage, "contacted");
    assert.ok(result.summary.includes("sourced prospect"));
    assert.ok(result.snapshot.outboundQueue.some((item) => item.status === "sent"));
    assert.ok(result.details.some((detail) => detail.includes("Prospect sourcing summary")));
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("northline autonomy collects prospects before sourcing and drafting outreach", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "northline-autonomy-collect-"));
  const sourceDir = path.join(root, "sources");
  const touchedKeys = [
    "NORTHLINE_PROSPECT_SOURCE_DIR",
    "NORTHLINE_PROSPECT_COLLECTION_AREAS",
    "NORTHLINE_PROSPECT_COLLECTION_TRADES",
    "NORTHLINE_PROSPECT_COLLECTION_INTERVAL_HOURS",
    "NORTHLINE_PROSPECT_COLLECTION_MAX_RECORDS_PER_TRADE"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));
  const mockFetch: typeof fetch = async (input, init) => {
    const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;

    if (url.startsWith("https://nominatim.openstreetmap.org/search")) {
      return new Response(
        JSON.stringify([
          {
            display_name: "Akron, Summit County, Ohio, United States",
            boundingbox: ["41.0200", "41.1200", "-81.6200", "-81.4200"],
            address: {
              city: "Akron",
              state: "Ohio",
              state_code: "OH"
            }
          }
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url === "https://overpass-api.de/api/interpreter") {
      return new Response(
        JSON.stringify({
          elements: [
            {
              type: "node",
              id: 201,
              tags: {
                name: "Beacon Plumbing",
                craft: "plumber",
                "addr:city": "Akron",
                "addr:state": "OH",
                email: "hello@beaconplumbing.com",
                phone: "(330) 555-0121",
                website: "http://beaconplumbing.com"
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    throw new Error(`Unexpected autonomy collector request: ${url}`);
  };

  try {
    process.env.NORTHLINE_PROSPECT_SOURCE_DIR = sourceDir;
    process.env.NORTHLINE_PROSPECT_COLLECTION_AREAS = "Akron, OH";
    process.env.NORTHLINE_PROSPECT_COLLECTION_TRADES = "plumbing";
    process.env.NORTHLINE_PROSPECT_COLLECTION_INTERVAL_HOURS = "24";
    process.env.NORTHLINE_PROSPECT_COLLECTION_MAX_RECORDS_PER_TRADE = "5";

    const { imonEngine, northlineAutonomy, store, config } = await setupWorkspace({
      prospectCollectorFetch: mockFetch
    });
    await imonEngine.bootstrap();
    const result = await northlineAutonomy.run();
    const leads = await store.getLeads();
    const collectionSummary = await readJsonFile<{ writtenFiles: number; collectedRecords: number }>(
      path.join(config.opsDir, "northline-growth-system", "prospect-collection-summary.json"),
      { writtenFiles: 0, collectedRecords: 0 }
    );

    assert.ok(leads.some((lead) => lead.id === "beacon-plumbing"));
    assert.ok(result.summary.includes("market feed refresh"));
    assert.ok(result.summary.includes("sourced prospect"));
    assert.ok(result.snapshot.outboundQueue.some((item) => item.status === "sent"));
    assert.ok(result.details.some((detail) => detail.includes("Prospect collection summary")));
    assert.equal(collectionSummary.writtenFiles, 1);
    assert.equal(collectionSummary.collectedRecords, 1);
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("northline autonomy keeps scoped active work metrics in sync with in-scope leads", async () => {
  const { imonEngine, northlineAutonomy, store } = await setupWorkspace();
  await imonEngine.bootstrap();
  const now = new Date().toISOString();
  const northline = await store.getManagedBusiness("auto-funding-agency");

  assert.ok(northline);

  await store.saveManagedBusiness({
    ...northline,
    northlineProfile: {
      ...(northline.northlineProfile ?? {}),
      collectionAreas: ["New York, NY"]
    },
    updatedAt: now
  });

  await store.saveLead({
    id: "northline-autonomy-metric-lead",
    businessId: "auto-funding-agency",
    pipeline: "agency_client_acquisition",
    businessName: "Northline Autonomy Metric Lead",
    niche: "home services",
    geo: "Brooklyn, NY",
    source: "northline-feed:test.json",
    contact: {
      ownerName: "Avery",
      phone: "(555) 555-0197",
      website: "https://northline-autonomy-metric.example.com"
    },
    websiteQualitySignals: {
      hasWebsite: true,
      hasHttps: true,
      mobileFriendly: false,
      clearOffer: false,
      callsToAction: false,
      pageSpeedBucket: "slow",
      notes: []
    },
    targetContext: {
      market: "New York, NY",
      trade: "plumbing",
      collectionArea: "New York, NY",
      sourceType: "auto-osm",
      targetIndustries: ["Plumbing"],
      targetServices: ["Proof page rebuild"],
      offerSummary: "Northline helps plumbing operators tighten the close path.",
      matchReasons: ["Local target."]
    },
    score: 82,
    scoreReasons: ["Strong target fit."],
    stage: "qualified",
    tags: ["plumbing"],
    createdAt: now,
    updatedAt: now
  });

  const result = await northlineAutonomy.run();
  const updatedBusiness = await store.getManagedBusiness("auto-funding-agency");

  assert.equal(updatedBusiness?.metrics.activeWorkItems, 1);
  assert.equal(updatedBusiness?.metrics.lastRunAt, result.snapshot.generatedAt);
});

test("northline autonomy falls back to a manual send gate when the automated sender fails", async () => {
  const { imonEngine, northlineAutonomy, store } = await setupWorkspace({
    outboundSender: async (lead) => ({
      receipts: [
        {
          status: "failed",
          channel: "gmail_cdp",
          recipient: lead.contact.email ?? "missing-email",
          attemptedAt: new Date().toISOString(),
          error: "Gmail is not signed in in the automation browser session."
        }
      ]
    })
  });
  await imonEngine.bootstrap();
  const now = new Date().toISOString();

  await store.saveLead({
    id: "manual-fallback-lead",
    businessId: "auto-funding-agency",
    businessName: "Manual Fallback Plumbing",
    niche: "home services",
    geo: "Akron, OH",
    source: "manual-test",
    contact: {
      ownerName: "Chris",
      email: "dispatch@manualfallbackplumbing.com",
      phone: "(330) 555-0199",
      website: "https://manualfallbackplumbing.com"
    },
    websiteQualitySignals: {
      hasWebsite: true,
      hasHttps: true,
      mobileFriendly: false,
      clearOffer: false,
      callsToAction: false,
      pageSpeedBucket: "slow",
      notes: ["Weak CTA"]
    },
    score: 88,
    scoreReasons: ["Weak CTA", "Has reachable contact info"],
    stage: "qualified",
    tags: ["northline"],
    createdAt: now,
    updatedAt: now
  });

  const result = await northlineAutonomy.run();
  const updatedLead = await store.getLead("manual-fallback-lead");
  const draft = (await store.getOutreachDrafts()).find((candidate) => candidate.leadId === "manual-fallback-lead");
  const approvals = await store.getApprovals();

  assert.equal(updatedLead?.stage, "drafted");
  assert.equal(draft?.sendReceipts?.at(-1)?.status, "failed");
  assert.match(draft?.sendReceipts?.at(-1)?.error ?? "", /not signed in/i);
  assert.ok(result.snapshot.outboundQueue.some((item) => item.status === "awaiting_manual_send"));
  assert.ok(result.snapshot.manualGates.some((gate) => gate.kind === "outbound_send"));
  assert.ok(approvals.some((task) => task.id === "approval-outbound-send-manual-fallback-lead-draft"));
});

test("northline autonomy syncs inbox replies and deduplicates thread messages", async () => {
  const replyReceivedAt = new Date().toISOString();
  const { imonEngine, northlineAutonomy, store } = await setupWorkspace({
    inboxSync: async (candidates) =>
      candidates.some((candidate) => candidate.leadId === "reply-sync-lead")
        ? [
            {
              leadId: "reply-sync-lead",
              status: "reply_found",
              recipient: "dispatch@replysyncplumbing.com",
              subject: "Re: Reply Sync Plumbing: quick website conversion fixes",
              externalThreadId: "thread-1",
              externalMessageId: "message-1",
              fromAddress: "dispatch@replysyncplumbing.com",
              body: "Send me pricing and the intake link.",
              receivedAt: replyReceivedAt
            }
          ]
        : []
  });
  await imonEngine.bootstrap();
  const now = new Date().toISOString();

  await store.saveLead({
    id: "reply-sync-lead",
    businessId: "auto-funding-agency",
    businessName: "Reply Sync Plumbing",
    niche: "home services",
    geo: "Akron, OH",
    source: "phase-3-test",
    contact: {
      ownerName: "Chris",
      email: "dispatch@replysyncplumbing.com",
      phone: "(330) 555-0201",
      website: "https://replysyncplumbing.com"
    },
    websiteQualitySignals: {
      hasWebsite: true,
      hasHttps: true,
      mobileFriendly: false,
      clearOffer: false,
      callsToAction: false,
      pageSpeedBucket: "average",
      notes: ["Weak CTA"]
    },
    score: 90,
    scoreReasons: ["Has reachable contact info"],
    stage: "contacted",
    tags: ["northline"],
    lastTouchAt: now,
    createdAt: now,
    updatedAt: now
  });
  await store.saveOutreachDraft({
    id: "reply-sync-lead-draft",
    leadId: "reply-sync-lead",
    subject: "Reply Sync Plumbing: quick website conversion fixes",
    body: "Hi there",
    followUps: [],
    complianceNotes: [],
    approved: true,
    sendReceipts: [
      {
        status: "sent",
        channel: "gmail_cdp",
        recipient: "dispatch@replysyncplumbing.com",
        attemptedAt: now,
        sentAt: now
      }
    ],
    createdAt: now,
    updatedAt: now
  });

  const first = await northlineAutonomy.run();
  const firstLead = await store.getLead("reply-sync-lead");
  const firstReplies = await store.getLeadReplies();

  assert.equal(firstLead?.stage, "responded");
  assert.ok(firstLead?.tags.includes("reply-route-intake-follow-up"));
  assert.equal(firstReplies.length, 1);
  assert.equal(firstReplies[0]?.classification.route, "intake_follow_up");
  assert.ok(first.snapshot.replyQueue.some((item) => item.status === "intake_follow_up"));
  assert.match(first.summary, /inbound reply/i);

  const second = await northlineAutonomy.run();
  const secondReplies = await store.getLeadReplies();

  assert.equal(secondReplies.length, 1);
  assert.ok(second.snapshot.replyQueue.some((item) => item.status === "duplicate"));
});

test("northline autonomy records IMAP reply sources when the inbox provider is IMAP", async () => {
  const touchedKeys = ["INBOX_PROVIDER", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "NORTHLINE_ZOHO_APP_PASS"] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  try {
    process.env.INBOX_PROVIDER = "imap";
    process.env.SMTP_HOST = "smtppro.zoho.com";
    process.env.SMTP_USER = "ops@example.com";
    process.env.NORTHLINE_ZOHO_APP_PASS = "imap-test-secret";

    const replyReceivedAt = new Date().toISOString();
    const { imonEngine, northlineAutonomy, store } = await setupWorkspace({
      inboxSync: async (candidates) =>
        candidates.some((candidate) => candidate.leadId === "imap-reply-lead")
          ? [
              {
                leadId: "imap-reply-lead",
                status: "reply_found",
                recipient: "dispatch@imapreplyplumbing.com",
                subject: "Re: IMAP Reply Plumbing: quick website conversion fixes",
                externalThreadId: "imap-thread-1",
                externalMessageId: "imap-message-1",
                fromAddress: "dispatch@imapreplyplumbing.com",
                body: "Please send the intake link.",
                receivedAt: replyReceivedAt
              }
            ]
          : []
    });
    await imonEngine.bootstrap();
    const now = new Date().toISOString();

    await store.saveLead({
      id: "imap-reply-lead",
      businessId: "auto-funding-agency",
      businessName: "IMAP Reply Plumbing",
      niche: "home services",
      geo: "Akron, OH",
      source: "phase-3-test",
      contact: {
        ownerName: "Chris",
        email: "dispatch@imapreplyplumbing.com",
        phone: "(330) 555-0202",
        website: "https://imapreplyplumbing.com"
      },
      websiteQualitySignals: {
        hasWebsite: true,
        hasHttps: true,
        mobileFriendly: false,
        clearOffer: false,
        callsToAction: false,
        pageSpeedBucket: "average",
        notes: ["Weak CTA"]
      },
      score: 90,
      scoreReasons: ["Has reachable contact info"],
      stage: "contacted",
      tags: ["northline"],
      lastTouchAt: now,
      createdAt: now,
      updatedAt: now
    });
    await store.saveOutreachDraft({
      id: "imap-reply-lead-draft",
      leadId: "imap-reply-lead",
      subject: "IMAP Reply Plumbing: quick website conversion fixes",
      body: "Hi there",
      followUps: [],
      complianceNotes: [],
      approved: true,
      sendReceipts: [
        {
          status: "sent",
          channel: "smtp",
          recipient: "dispatch@imapreplyplumbing.com",
          attemptedAt: now,
          sentAt: now
        }
      ],
      createdAt: now,
      updatedAt: now
    });

    await northlineAutonomy.run();
    const replies = await store.getLeadReplies();

    assert.equal(replies.length, 1);
    assert.equal(replies[0]?.source, "imap");
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("northline billing handoff marks proposal work as paid and clears the billing gate", async () => {
  const { northlineAutonomy, store } = await setupWorkspace();
  const now = new Date().toISOString();
  await store.saveClient({
    id: "harbor-heating",
    businessId: "auto-funding-agency",
    clientName: "Harbor Heating",
    niche: "home services",
    geo: "Buffalo, NY",
    primaryPhone: "(716) 555-0102",
    primaryEmail: "hello@harborheating.com",
    offerId: "founding-offer",
    siteStatus: "not_started",
    qaStatus: "pending",
    billingStatus: "proposal",
    deployment: {
      platform: "local-preview"
    },
    assets: {},
    intakeNotes: [],
    nextAction: "Confirm billing",
    createdAt: now,
    updatedAt: now
  });
  await store.saveApproval({
    id: "approval-northline-billing-handoff-harbor-heating",
    type: "manual",
    actionNeeded: "Confirm billing handoff for Harbor Heating",
    reason: "Pending owner confirmation.",
    ownerInstructions: "Use the billing handoff command.",
    notifyChannel: "email",
    relatedEntityType: "client",
    relatedEntityId: "harbor-heating",
    status: "open",
    createdAt: now,
    updatedAt: now
  });

  await northlineAutonomy.applyBillingHandoff({
    clientId: "harbor-heating",
    status: "paid",
    formEndpoint: "https://hooks.example.com/forms/harbor-heating"
  });

  const updated = await store.getClient("harbor-heating");
  const approval = (await store.getApprovals()).find(
    (task) => task.id === "approval-northline-billing-handoff-harbor-heating"
  );

  assert.equal(updated?.billingStatus, "paid");
  assert.equal(updated?.formEndpoint, "https://hooks.example.com/forms/harbor-heating");
  assert.equal(approval?.status, "completed");
});

test("northline autonomy auto-builds paid clients, runs QA, and packages the client handoff", async () => {
  const touchedKeys = [
    "NORTHLINE_SITE_URL",
    "NORTHLINE_DOMAIN",
    "NORTHLINE_SALES_EMAIL",
    "NORTHLINE_BOOKING_URL",
    "NORTHLINE_LEAD_FORM_ACTION",
    "NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING",
    "NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD",
    "NORTHLINE_STRIPE_PAYMENT_LINK_GROWTH_UPGRADE",
    "NORTHLINE_GROWTH_UPGRADE_COUPON_LABEL",
    "NORTHLINE_GROWTH_UPGRADE_COUPON_TERMS"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  try {
    process.env.NORTHLINE_SITE_URL = "https://northlinegrowthsystems.com";
    process.env.NORTHLINE_DOMAIN = "northlinegrowthsystems.com";
    process.env.NORTHLINE_SALES_EMAIL = "contact@northlinegrowthsystems.com";
    process.env.NORTHLINE_BOOKING_URL = "/book.html";
    process.env.NORTHLINE_LEAD_FORM_ACTION = "/api/northline-intake";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING = "https://buy.stripe.com/founding";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD = "https://buy.stripe.com/standard";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_GROWTH_UPGRADE = "https://buy.stripe.com/autonomy_growth_upgrade";
    process.env.NORTHLINE_GROWTH_UPGRADE_COUPON_LABEL = "Autonomy upgrade";
    process.env.NORTHLINE_GROWTH_UPGRADE_COUPON_TERMS =
      "Apply within 30 days of the Lead Generation launch.";

    const { config, imonEngine, northlineAutonomy, store } = await setupWorkspace();
    await imonEngine.bootstrap();
    const now = new Date().toISOString();

    await store.saveClient({
      id: "lighthouse-hvac",
      businessId: "auto-funding-agency",
      sourceSubmissionId: "northline-intake-1714400000000-lighthouse-hvac",
      provenance: "external_inbound",
      proofEligible: true,
      clientName: "Lighthouse HVAC",
      niche: "home services",
      geo: "Cleveland, OH",
      primaryPhone: "(216) 444-0103",
      primaryEmail: "hello@lighthousehvac.com",
      offerId: "lead-generation-offer",
      siteStatus: "not_started",
      qaStatus: "pending",
      billingStatus: "retainer_active",
      formEndpoint: "https://hooks.example.com/forms/lighthouse-hvac",
      deployment: {
        platform: "local-preview"
      },
      assets: {
        logoText: "Lighthouse HVAC",
        services: ["AC repair", "Furnace tune-ups", "Emergency HVAC service"],
        testimonials: ["Fast scheduling and clear updates."],
        reviews: ["Would recommend them again."]
      },
      intakeNotes: ["Focus on emergency AC repair"],
      nextAction: "Autonomous delivery is unlocked",
      createdAt: now,
      updatedAt: now
    });

    const result = await northlineAutonomy.run();
    const updatedClient = await store.getClient("lighthouse-hvac");
    const retention = (await store.getRetentionReports()).find(
      (report) => report.clientId === "lighthouse-hvac"
    );
    const proofBundle = updatedClient?.assets.proofBundle;
    const handoffPackage = updatedClient?.assets.handoffPackage;
    const agencySitePath = await buildAgencySite(config, DEFAULT_AGENCY_PROFILE);
    const agencySiteHtml = await readTextFile(agencySitePath);
    const handoffReadme = handoffPackage?.readmePath
      ? await readTextFile(handoffPackage.readmePath)
      : "";

    assert.equal(updatedClient?.siteStatus, "ready");
    assert.equal(updatedClient?.qaStatus, "passed");
    assert.ok(result.snapshot.deliveryQueue.some((item) => item.clientId === "lighthouse-hvac"));
    assert.ok(
      result.snapshot.deliveryQueue.some(
        (item) => item.clientId === "lighthouse-hvac" && item.status === "handoff_complete"
      )
    );
    assert.ok(retention);
    assert.equal(retention?.upgradeOffer?.paymentLink, "https://buy.stripe.com/autonomy_growth_upgrade");
    assert.equal(retention?.upgradeOffer?.couponLabel, "Autonomy upgrade");
    assert.ok(proofBundle);
    assert.ok(handoffPackage);
    assert.equal(proofBundle?.screenshots.length, 2);
    assert.ok(await exists(proofBundle?.reportPath ?? ""));
    assert.ok(await exists(handoffPackage?.reportPath ?? ""));
    assert.ok(await exists(handoffPackage?.readmePath ?? ""));
    assert.match(handoffReadme, /## Start here/);
    assert.match(handoffReadme, /## Fastest publish path/);
    assert.match(handoffReadme, /## Send this to your web person/);
    assert.match(handoffReadme, /## If you do not have a developer/);
    assert.match(handoffReadme, /## Growth upgrade path/);
    assert.match(handoffReadme, /Autonomy upgrade/);
    assert.match(handoffReadme, /https:\/\/buy\.stripe\.com\/autonomy_growth_upgrade/);
    assert.match(handoffReadme, /approved preview export/i);
    assert.doesNotMatch(agencySiteHtml, /What Northline shows first/);
    assert.doesNotMatch(agencySiteHtml, /id="proof"/);
    assert.doesNotMatch(agencySiteHtml, /id="client-proof"/);
    assert.doesNotMatch(agencySiteHtml, /Lighthouse HVAC/);
    assert.ok(
      await exists(path.join(config.outputDir, "agency-site", "proof", "lighthouse-hvac", "home-desktop.png"))
    );
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("buildAgencySite only publishes proof from real external delivered clients", async () => {
  const touchedKeys = [
    "NORTHLINE_SITE_URL",
    "NORTHLINE_DOMAIN",
    "NORTHLINE_SALES_EMAIL",
    "NORTHLINE_BOOKING_URL",
    "NORTHLINE_LEAD_FORM_ACTION"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  try {
    process.env.NORTHLINE_SITE_URL = "https://northlinegrowthsystems.com";
    process.env.NORTHLINE_DOMAIN = "northlinegrowthsystems.com";
    process.env.NORTHLINE_SALES_EMAIL = "contact@northlinegrowthsystems.com";
    process.env.NORTHLINE_BOOKING_URL = "/book.html";
    process.env.NORTHLINE_LEAD_FORM_ACTION = "/api/northline-intake";

    const { config, imonEngine, store } = await setupWorkspace();
    await imonEngine.bootstrap();
    const now = new Date().toISOString();

    const legacyScreenshotPath = path.join(config.outputDir, "legacy-sunrise-home-desktop.png");
    const validationScreenshotPath = path.join(
      config.outputDir,
      "northline-validation-artifact-home-desktop.png"
    );
    const manualScreenshotPath = path.join(config.outputDir, "internal-manual-preview-home-desktop.png");
    await writeFile(legacyScreenshotPath, "legacy proof screenshot");
    await writeFile(validationScreenshotPath, "validation proof screenshot");
    await writeFile(manualScreenshotPath, "manual proof screenshot");

    const legacyProofBundle = {
      clientId: "legacy-sunrise",
      createdAt: now,
      clientName: "Legacy Sunrise Plumbing",
      siteStatus: "ready",
      qaStatus: "passed",
      previewPath: path.join(config.outputDir, "legacy-sunrise"),
      reportPath: path.join(config.reportDir, "legacy-sunrise-proof-bundle.json"),
      screenshots: [
        {
          id: "legacy-sunrise-home-desktop",
          label: "Desktop homepage",
          path: legacyScreenshotPath,
          viewport: "desktop"
        }
      ],
      testimonialRequest: {
        subject: "Legacy testimonial",
        body: "Share the result in one sentence."
      },
      reviewRequest: {
        subject: "Legacy review",
        body: "Please leave a quick review."
      },
      publication: {
        headline: "Legacy Sunrise proof",
        summary: "Legacy Northline pilot proof bundle.",
        bullets: ["New CTA", "Cleaner intake route"],
        testimonialQuote: "Closed more calls after the rebuild."
      }
    } satisfies NonNullable<ClientJob["assets"]["proofBundle"]>;

    const validationProofBundle = {
      clientId: "northline-validation-artifact",
      businessId: "auto-funding-agency",
      createdAt: now,
      clientName: "Northline Validation Artifact",
      siteStatus: "ready",
      qaStatus: "passed",
      previewPath: path.join(config.outputDir, "northline-validation-artifact"),
      reportPath: path.join(config.reportDir, "northline-validation-artifact-proof-bundle.json"),
      screenshots: [
        {
          id: "northline-validation-artifact-home-desktop",
          label: "Desktop homepage",
          path: validationScreenshotPath,
          viewport: "desktop"
        }
      ],
      testimonialRequest: {
        subject: "Validation testimonial",
        body: "Validation-only testimonial request."
      },
      reviewRequest: {
        subject: "Validation review",
        body: "Validation-only review request."
      },
      publication: {
        headline: "Validation artifact",
        summary: "Internal validation artifact.",
        bullets: ["Validation checkout", "Hosted handoff"]
      }
    } satisfies NonNullable<ClientJob["assets"]["proofBundle"]>;

    const manualProofBundle = {
      clientId: "internal-manual-preview",
      businessId: "auto-funding-agency",
      createdAt: now,
      clientName: "Internal Manual Preview",
      siteStatus: "ready",
      qaStatus: "passed",
      previewPath: path.join(config.outputDir, "internal-manual-preview"),
      reportPath: path.join(config.reportDir, "internal-manual-preview-proof-bundle.json"),
      screenshots: [
        {
          id: "internal-manual-preview-home-desktop",
          label: "Desktop homepage",
          path: manualScreenshotPath,
          viewport: "desktop"
        }
      ],
      testimonialRequest: {
        subject: "Manual testimonial",
        body: "Manual-only testimonial request."
      },
      reviewRequest: {
        subject: "Manual review",
        body: "Manual-only review request."
      },
      publication: {
        headline: "Internal manual preview",
        summary: "Internal-only fixture proof bundle.",
        bullets: ["Manual fixture", "Not part of proof cohort"],
        testimonialQuote: "Manual fixture testimonial that should not count."
      }
    } satisfies NonNullable<ClientJob["assets"]["proofBundle"]>;

    await store.saveClient({
      id: "legacy-sunrise",
      businessId: "auto-funding-agency",
      sourceSubmissionId: "northline-intake-1714400000000-legacy-sunrise-plumbing",
      provenance: "external_inbound",
      proofEligible: true,
      clientName: "Legacy Sunrise Plumbing",
      niche: "home services",
      geo: "Akron, OH",
      primaryPhone: "(330) 444-0105",
      primaryEmail: "dispatch@legacysunrise.com",
      offerId: "founding-offer",
      siteStatus: "ready",
      qaStatus: "passed",
      billingStatus: "paid",
      deployment: {
        platform: "local-preview",
        previewPath: path.join(config.outputDir, "legacy-sunrise")
      },
      assets: {
        proofBundle: legacyProofBundle
      },
      intakeNotes: ["Hosted Northline client converted from a real intake."],
      nextAction: "Client handoff package is next.",
      createdAt: now,
      updatedAt: now
    });
    await store.saveProofBundle(legacyProofBundle);

    await store.saveClient({
      id: "northline-validation-artifact",
      businessId: "auto-funding-agency",
      sourceSubmissionId: "northline-validation-artifact",
      clientName: "Northline Validation Artifact",
      niche: "home services",
      geo: "Northline controlled launch validation",
      primaryPhone: "+1-555-0101",
      primaryEmail: "ops+northline-validation@example.invalid",
      offerId: "founding-offer",
      siteStatus: "ready",
      qaStatus: "passed",
      billingStatus: "retainer_active",
      deployment: {
        platform: "local-preview",
        previewPath: path.join(config.outputDir, "northline-validation-artifact")
      },
      assets: {
        proofBundle: validationProofBundle
      },
      intakeNotes: [
        "Source: northline-validation-page",
        "Current website: https://northlinegrowthsystems.com/validation.html"
      ],
      nextAction: "Internal validation artifact",
      createdAt: now,
      updatedAt: now
    });
    await store.saveProofBundle(validationProofBundle);

    await store.saveClient({
      id: "internal-manual-preview",
      businessId: "auto-funding-agency",
      provenance: "internal_manual",
      proofEligible: false,
      clientName: "Internal Manual Preview",
      niche: "home services",
      geo: "Akron, OH",
      primaryPhone: "(330) 555-0191",
      primaryEmail: "ops+manual-preview@example.invalid",
      offerId: "founding-offer",
      siteStatus: "ready",
      qaStatus: "passed",
      billingStatus: "paid",
      deployment: {
        platform: "local-preview",
        previewPath: path.join(config.outputDir, "internal-manual-preview")
      },
      assets: {
        proofBundle: manualProofBundle
      },
      intakeNotes: ["Internal manual fixture"],
      nextAction: "Internal manual preview only.",
      createdAt: now,
      updatedAt: now
    });
    await store.saveProofBundle(manualProofBundle);

    const agencySitePath = await buildAgencySite(config, DEFAULT_AGENCY_PROFILE);
    const agencySiteHtml = await readTextFile(agencySitePath);

    assert.doesNotMatch(agencySiteHtml, /id="client-proof"/);
    assert.doesNotMatch(agencySiteHtml, /Legacy Sunrise Plumbing/);
    assert.doesNotMatch(agencySiteHtml, /Northline Validation Artifact/);
    assert.doesNotMatch(agencySiteHtml, /Internal Manual Preview/);
    assert.ok(
      await exists(
        path.join(config.outputDir, "agency-site", "proof", "legacy-sunrise", "legacy-sunrise-home-desktop.png")
      )
    );
    assert.equal(
      await exists(
        path.join(
          config.outputDir,
          "agency-site",
          "proof",
          "northline-validation-artifact",
          "northline-validation-artifact-home-desktop.png"
        )
      ),
      false
    );
    assert.equal(
      await exists(
        path.join(
          config.outputDir,
          "agency-site",
          "proof",
          "internal-manual-preview",
          "internal-manual-preview-home-desktop.png"
        )
      ),
      false
    );
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("northline autonomy hides validation artifacts from billing and handoff queues", async () => {
  const { config, imonEngine, northlineAutonomy, store } = await setupWorkspace();
  await imonEngine.bootstrap();
  const now = new Date().toISOString();

  await store.saveApproval({
    id: "approval-northline-billing-handoff-validation-proposal",
    type: "manual",
    actionNeeded: "Confirm billing handoff for Northline Validation Proposal",
    reason: "Validation fixture approval should be cleared during the autonomy pass.",
    ownerInstructions: "Validation fixtures should not stay in the live billing queue.",
    relatedEntityType: "client",
    relatedEntityId: "validation-proposal",
    notifyChannel: "email",
    status: "open",
    createdAt: now,
    updatedAt: now
  });

  await store.saveClient({
    id: "sunrise-plumbing",
    leadId: "summit-ridge-plumbing",
    clientName: "Sunrise Plumbing & Drain",
    niche: "home services",
    geo: "Akron, OH",
    primaryPhone: "(330) 555-0180",
    primaryEmail: "dispatch@sunriseplumbingdrain.com",
    offerId: "founding-offer",
    siteStatus: "ready",
    qaStatus: "passed",
    billingStatus: "paid",
    deployment: {
      platform: "local-preview",
      previewPath: path.join(config.outputDir, "sunrise-plumbing")
    },
    assets: {
      proofBundle: {
        clientId: "sunrise-plumbing",
        createdAt: now,
        clientName: "Sunrise Plumbing & Drain",
        siteStatus: "ready",
        qaStatus: "passed",
        previewPath: path.join(config.outputDir, "sunrise-plumbing"),
        reportPath: path.join(config.reportDir, "sunrise-plumbing-proof-bundle.json"),
        screenshots: [
          {
            id: "sunrise-plumbing-home-desktop",
            label: "Desktop homepage",
            path: path.join(config.outputDir, "sunrise-plumbing-home-desktop.png"),
            viewport: "desktop"
          }
        ],
        testimonialRequest: {
          subject: "Testimonial",
          body: "Share the result in one sentence."
        },
        reviewRequest: {
          subject: "Review",
          body: "Please leave a quick review."
        },
        publication: {
          headline: "Sunrise Plumbing proof",
          summary: "Delivered pilot proof bundle.",
          bullets: ["New CTA", "Cleaner intake route"]
        }
      }
    },
    intakeNotes: ["Legacy Northline pilot"],
    nextAction: "Client handoff package is next.",
    createdAt: now,
    updatedAt: now
  });

  await store.saveClient({
    id: "validation-proposal",
    businessId: "auto-funding-agency",
    sourceSubmissionId: "northline-validation-proposal",
    clientName: "Northline Validation Proposal",
    niche: "home services",
    geo: "Northline validation lane",
    primaryPhone: "+1-555-0100",
    primaryEmail: "ops+northline-validation-proposal@example.invalid",
    offerId: "founding-offer",
    siteStatus: "not_started",
    qaStatus: "pending",
    billingStatus: "proposal",
    deployment: {
      platform: "local-preview"
    },
    assets: {},
    intakeNotes: [
      "Source: northline-validation-page",
      "Current website: https://northlinegrowthsystems.com/validation.html"
    ],
    nextAction: "Internal validation artifact",
    createdAt: now,
    updatedAt: now
  });

  await store.saveClient({
    id: "validation-ready",
    businessId: "auto-funding-agency",
    sourceSubmissionId: "northline-validation-ready",
    clientName: "Northline Validation Ready",
    niche: "home services",
    geo: "Northline controlled launch validation",
    primaryPhone: "+1-555-0101",
    primaryEmail: "ops+northline-validation-ready@example.invalid",
    offerId: "founding-offer",
    siteStatus: "ready",
    qaStatus: "passed",
    billingStatus: "retainer_active",
    deployment: {
      platform: "local-preview",
      previewPath: path.join(config.outputDir, "validation-ready")
    },
    assets: {
      proofBundle: {
        clientId: "validation-ready",
        businessId: "auto-funding-agency",
        createdAt: now,
        clientName: "Northline Validation Ready",
        siteStatus: "ready",
        qaStatus: "passed",
        previewPath: path.join(config.outputDir, "validation-ready"),
        reportPath: path.join(config.reportDir, "validation-ready-proof-bundle.json"),
        screenshots: [
          {
            id: "validation-ready-home-desktop",
            label: "Desktop homepage",
            path: path.join(config.outputDir, "validation-ready-home-desktop.png"),
            viewport: "desktop"
          }
        ],
        testimonialRequest: {
          subject: "Validation testimonial",
          body: "Validation-only testimonial request."
        },
        reviewRequest: {
          subject: "Validation review",
          body: "Validation-only review request."
        },
        publication: {
          headline: "Validation ready",
          summary: "Internal validation artifact.",
          bullets: ["Validation checkout", "Hosted handoff"]
        }
      }
    },
    intakeNotes: [
      "Source: northline-validation-page",
      "Current website: https://northlinegrowthsystems.com/validation.html"
    ],
    nextAction: "Internal validation artifact",
    createdAt: now,
    updatedAt: now
  });

  const result = await northlineAutonomy.run();
  const approvals = await store.getApprovals();
  const validationBillingApproval = approvals.find(
    (task) => task.id === "approval-northline-billing-handoff-validation-proposal"
  );

  assert.ok(
    result.snapshot.deliveryQueue.some(
      (item) => item.clientId === "sunrise-plumbing" && item.status === "handoff_complete"
    )
  );
  assert.ok(
    !result.snapshot.deliveryQueue.some((item) => item.clientId === "validation-proposal")
  );
  assert.ok(!result.snapshot.deliveryQueue.some((item) => item.clientId === "validation-ready"));
  assert.ok(
    !result.snapshot.manualGates.some((gate) => gate.relatedEntityId === "validation-proposal")
  );
  assert.ok(
    !result.snapshot.manualGates.some((gate) => gate.relatedEntityId === "validation-ready")
  );
  assert.equal(validationBillingApproval?.status, "completed");
  assert.doesNotMatch(result.summary, /billing handoff/i);
  assert.match(result.summary, /1 handoff-complete client/i);
});

test("northline autonomy resolves stale preview paths before QA and proof refresh", async () => {
  const { config, imonEngine, northlineAutonomy, siteBuilder, store } = await setupWorkspace();
  await imonEngine.bootstrap();
  const now = new Date().toISOString();
  const clientId = "legacy-preview-sunrise";
  const livePreviewDir = path.join(config.previewDir, clientId);
  const stalePreviewPath = `C:\\AIWorkspace\\Projects\\Auto-Funding\\runtime\\previews\\${clientId}`;

  const client: ClientJob = {
    id: clientId,
    businessId: "auto-funding-agency",
    provenance: "external_outbound",
    proofEligible: true,
    clientName: "Legacy Preview Sunrise",
    niche: "home services",
    geo: "Akron, OH",
    primaryPhone: "(330) 444-0180",
    primaryEmail: "dispatch@legacypreviewsunrise.com",
    offerId: "founding-offer",
    siteStatus: "not_started",
    qaStatus: "pending",
    billingStatus: "paid",
    formEndpoint: "https://hooks.example.com/forms/legacy-preview-sunrise",
    deployment: {
      platform: "local-preview"
    },
    assets: {
      logoText: "Legacy Preview Sunrise",
      services: ["Emergency plumbing repair", "Drain cleaning"],
      testimonials: ["Fast dispatch and clear communication."],
      reviews: ["Great service and easy scheduling."]
    },
    intakeNotes: ["Legacy host preview path should resolve on the current machine."],
    nextAction: "Client handoff package is next.",
    createdAt: now,
    updatedAt: now
  };

  await store.saveClient(client);
  await siteBuilder.buildClientSite(client);
  const builtClient = await store.getClient(clientId);
  await store.saveClient({
    ...builtClient!,
    siteStatus: "ready",
    qaStatus: "pending",
    billingStatus: "paid",
    deployment: {
      ...builtClient!.deployment,
      previewPath: stalePreviewPath
    },
    updatedAt: new Date().toISOString()
  });

  const result = await northlineAutonomy.run();
  const updatedClient = await store.getClient(clientId);
  const proofBundle = updatedClient?.assets.proofBundle;
  const handoffPackage = updatedClient?.assets.handoffPackage;
  const proofCriterion = result.plan.operatingMode.promotionCriteria.find(
    (criterion) => criterion.id === "proof-mix"
  );
  const writtenPlan = await readJsonFile<{
    operatingMode: {
      promotionCriteria: Array<{
        id: string;
        status: string;
        evidence: string[];
      }>;
    };
  }>(path.join(config.opsDir, "northline-growth-system", "plan.json"), {
    operatingMode: {
      promotionCriteria: []
    }
  });
  const writtenProofCriterion = writtenPlan.operatingMode.promotionCriteria.find(
    (criterion) => criterion.id === "proof-mix"
  );
  const agencySitePath = await buildAgencySite(config, DEFAULT_AGENCY_PROFILE);
  const agencySiteHtml = await readTextFile(agencySitePath);

  assert.equal(updatedClient?.deployment.previewPath, livePreviewDir);
  assert.equal(updatedClient?.qaStatus, "passed");
  assert.equal(updatedClient?.siteStatus, "ready");
  assert.equal(proofBundle?.previewPath, livePreviewDir);
  assert.equal(proofBundle?.screenshots.length, 2);
  assert.equal(handoffPackage?.previewPath, livePreviewDir);
  assert.ok(await exists(handoffPackage?.reportPath ?? ""));
  assert.ok(await exists(handoffPackage?.readmePath ?? ""));
  assert.equal(proofCriterion?.status, "met");
  assert.match(proofCriterion?.evidence[0] ?? "", /Proof bundles with screenshots: 1/);
  assert.equal(writtenProofCriterion?.status, "met");
  assert.match(writtenProofCriterion?.evidence[0] ?? "", /Proof bundles with screenshots: 1/);
  assert.ok(
    result.snapshot.deliveryQueue.some(
      (item) => item.clientId === clientId && item.status === "handoff_complete"
    )
  );
  assert.doesNotMatch(agencySiteHtml, /id="client-proof"/);
  assert.doesNotMatch(agencySiteHtml, /Legacy Preview Sunrise/);
  assert.ok(
    await exists(path.join(config.outputDir, "agency-site", "proof", clientId, "home-desktop.png"))
  );
});

test("northline autonomy packages the client handoff even when a legacy deploy approval is already completed", async () => {
  const touchedKeys = [
    "NORTHLINE_SITE_URL",
    "NORTHLINE_DOMAIN",
    "NORTHLINE_SALES_EMAIL",
    "NORTHLINE_BOOKING_URL",
    "NORTHLINE_LEAD_FORM_ACTION",
    "NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING",
    "NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  try {
    process.env.NORTHLINE_SITE_URL = "https://northlinegrowthsystems.com";
    process.env.NORTHLINE_DOMAIN = "northlinegrowthsystems.com";
    process.env.NORTHLINE_SALES_EMAIL = "contact@northlinegrowthsystems.com";
    process.env.NORTHLINE_BOOKING_URL = "/book.html";
    process.env.NORTHLINE_LEAD_FORM_ACTION = "/api/northline-intake";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING = "https://buy.stripe.com/founding";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD = "https://buy.stripe.com/standard";

    const { imonEngine, northlineAutonomy, store } = await setupWorkspace({
      deployer: async (client, clientStore) => {
        const productionUrl = `https://${client.id}.pages.dev`;
        await clientStore.saveClient({
          ...client,
          siteStatus: "deployed",
          deployment: {
            platform: "cloudflare-pages",
            previewPath: client.deployment.previewPath,
            productionUrl
          },
          updatedAt: new Date().toISOString()
        });
        return productionUrl;
      }
    });
    await imonEngine.bootstrap();
    const now = new Date().toISOString();

    await store.saveClient({
      id: "approved-hvac",
      businessId: "auto-funding-agency",
      clientName: "Approved HVAC",
      niche: "home services",
      geo: "Cleveland, OH",
      primaryPhone: "(216) 555-0104",
      primaryEmail: "hello@approvedhvac.com",
      offerId: "founding-offer",
      siteStatus: "not_started",
      qaStatus: "pending",
      billingStatus: "retainer_active",
      formEndpoint: "https://hooks.example.com/forms/approved-hvac",
      deployment: {
        platform: "local-preview"
      },
      assets: {
        logoText: "Approved HVAC",
        services: ["AC repair", "Emergency furnace service"]
      },
      intakeNotes: [],
      nextAction: "Legacy deploy approval is already recorded",
      createdAt: now,
      updatedAt: now
    });
    await store.saveApproval({
      id: "approval-northline-deploy-approved-hvac",
      type: "manual",
      actionNeeded: "Approve production deploy for Approved HVAC",
      reason: "Owner approved deploy early.",
      ownerInstructions: "Run the deployer on the next autonomy pass.",
      notifyChannel: "email",
      relatedEntityType: "client",
      relatedEntityId: "approved-hvac",
      status: "completed",
      createdAt: now,
      updatedAt: now
    });

    const result = await northlineAutonomy.run();
    const updatedClient = await store.getClient("approved-hvac");
    const handoffPackage = updatedClient?.assets.handoffPackage;
    const deployApproval = (await store.getApprovals()).find(
      (task) => task.id === "approval-northline-deploy-approved-hvac"
    );

    assert.equal(updatedClient?.siteStatus, "ready");
    assert.ok(handoffPackage);
    assert.equal(deployApproval?.status, "completed");
    assert.ok(
      result.snapshot.deliveryQueue.some(
        (item) => item.clientId === "approved-hvac" && item.status === "handoff_complete"
      )
    );
    assert.ok(
      !result.snapshot.manualGates.some((gate) => gate.relatedEntityId === "approved-hvac")
    );
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("deployer resolves stale preview paths against the current preview dir", async () => {
  const { config, orchestrator, store } = await setupWorkspace();
  const now = new Date().toISOString();
  const clientId = "legacy-deploy-sunrise";
  const livePreviewDir = path.join(config.previewDir, clientId);
  const stalePreviewPath = `C:\\AIWorkspace\\Projects\\Auto-Funding\\runtime\\previews\\${clientId}`;

  await mkdir(livePreviewDir, { recursive: true });
  await writeFile(
    path.join(livePreviewDir, "index.html"),
    "<!doctype html><html><body><h1>Legacy Deploy Sunrise</h1></body></html>",
    "utf8"
  );
  await writeFile(path.join(livePreviewDir, "styles.css"), "body { color: #10212f; }", "utf8");

  const client: ClientJob = {
    id: clientId,
    businessId: "auto-funding-agency",
    clientName: "Legacy Deploy Sunrise",
    niche: "home services",
    geo: "Akron, OH",
    primaryPhone: "(330) 555-0180",
    primaryEmail: "dispatch@legacydeploysunrise.com",
    offerId: "founding-offer",
    siteStatus: "ready",
    qaStatus: "passed",
    billingStatus: "paid",
    formEndpoint: "https://hooks.example.com/forms/legacy-deploy-sunrise",
    deployment: {
      platform: "local-preview",
      previewPath: stalePreviewPath
    },
    assets: {
      logoText: "Legacy Deploy Sunrise"
    },
    intakeNotes: ["Legacy host preview path should resolve on the current machine."],
    nextAction: "Client handoff package is next.",
    createdAt: now,
    updatedAt: now
  };

  await store.saveClient(client);

  const deployer = new Deployer(config, store, orchestrator.getAccountOps());
  const resolvedPreviewPath = await deployer.deploy(client);
  const updatedClient = await store.getClient(clientId);
  const cloudflareApproval = (await store.getApprovals()).find(
    (task) => task.id === "approval-cloudflare-access"
  );

  assert.equal(resolvedPreviewPath, livePreviewDir);
  assert.equal(updatedClient?.deployment.previewPath, livePreviewDir);
  assert.equal(cloudflareApproval?.status, "open");
});

test("northline autonomy closes legacy deploy approvals when QA is blocked", async () => {
  const { imonEngine, northlineAutonomy, store } = await setupWorkspace();
  await imonEngine.bootstrap();
  const now = new Date().toISOString();

  await store.saveClient({
    id: "blocked-roofing",
    businessId: "auto-funding-agency",
    clientName: "Blocked Roofing",
    niche: "home services",
    geo: "Buffalo, NY",
    primaryPhone: "(716) 555-0108",
    primaryEmail: "hello@blockedroofing.com",
    offerId: "founding-offer",
    siteStatus: "qa_failed",
    qaStatus: "failed",
    billingStatus: "paid",
    formEndpoint: "https://hooks.example.com/forms/blocked-roofing",
    deployment: {
      platform: "local-preview"
    },
    assets: {
      logoText: "Blocked Roofing"
    },
    intakeNotes: [],
    nextAction: "Fix QA blockers",
    createdAt: now,
    updatedAt: now
  });
  await store.saveApproval({
    id: "approval-northline-deploy-blocked-roofing",
    type: "manual",
    actionNeeded: "Approve production deploy for Blocked Roofing",
    reason: "Old deploy gate should be cleared.",
    ownerInstructions: "Wait for QA.",
    notifyChannel: "email",
    relatedEntityType: "client",
    relatedEntityId: "blocked-roofing",
    status: "open",
    createdAt: now,
    updatedAt: now
  });

  const result = await northlineAutonomy.run();
  const approvals = await store.getApprovals();
  const deployApproval = approvals.find(
    (task) => task.id === "approval-northline-deploy-blocked-roofing"
  );
  const qaApproval = approvals.find((task) => task.id === "approval-northline-qa-blocked-roofing");

  assert.equal(deployApproval?.status, "completed");
  assert.equal(qaApproval?.status, "open");
  assert.ok(
    result.snapshot.manualGates.some(
      (gate) => gate.relatedEntityId === "blocked-roofing" && gate.kind === "qa_stall"
    )
  );
  assert.ok(
    !result.snapshot.manualGates.some((gate) => gate.relatedEntityId === "blocked-roofing" && gate.kind !== "qa_stall")
  );
});

test("northline autonomy packages a fourth pilot handoff without opening deploy approvals", async () => {
  const touchedKeys = [
    "NORTHLINE_SITE_URL",
    "NORTHLINE_DOMAIN",
    "NORTHLINE_SALES_EMAIL",
    "NORTHLINE_BOOKING_URL",
    "NORTHLINE_LEAD_FORM_ACTION",
    "NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING",
    "NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD",
    "NORTHLINE_AUTO_DEPLOY_ENABLED",
    "NORTHLINE_AUTO_DEPLOY_MIN_COMPLETED_DELIVERIES",
    "NORTHLINE_AUTO_DEPLOY_REQUIRE_ZERO_QA_BLOCKERS"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  try {
    process.env.NORTHLINE_SITE_URL = "https://northlinegrowthsystems.com";
    process.env.NORTHLINE_DOMAIN = "northlinegrowthsystems.com";
    process.env.NORTHLINE_SALES_EMAIL = "contact@northlinegrowthsystems.com";
    process.env.NORTHLINE_BOOKING_URL = "/book.html";
    process.env.NORTHLINE_LEAD_FORM_ACTION = "/api/northline-intake";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING = "https://buy.stripe.com/founding";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD = "https://buy.stripe.com/standard";
    process.env.NORTHLINE_AUTO_DEPLOY_ENABLED = "true";
    process.env.NORTHLINE_AUTO_DEPLOY_MIN_COMPLETED_DELIVERIES = "3";
    process.env.NORTHLINE_AUTO_DEPLOY_REQUIRE_ZERO_QA_BLOCKERS = "true";

    const { imonEngine, northlineAutonomy, store } = await setupWorkspace({
      deployer: async (client, clientStore) => {
        const productionUrl = `https://${client.id}.pages.dev`;
        await clientStore.saveClient({
          ...client,
          siteStatus: "deployed",
          deployment: {
            platform: "cloudflare-pages",
            previewPath: client.deployment.previewPath,
            productionUrl
          },
          updatedAt: new Date().toISOString()
        });
        return productionUrl;
      }
    });
    await imonEngine.bootstrap();
    const now = new Date().toISOString();

    for (const clientId of ["pilot-one", "pilot-two", "pilot-three"]) {
      await store.saveClient({
        id: clientId,
        businessId: "auto-funding-agency",
        clientName: clientId,
        niche: "home services",
        geo: "Cleveland, OH",
        primaryPhone: "(216) 555-0199",
        primaryEmail: `${clientId}@example.com`,
        offerId: "founding-offer",
        siteStatus: "deployed",
        qaStatus: "passed",
        billingStatus: "paid",
        formEndpoint: "https://hooks.example.com/forms/completed",
        deployment: {
          platform: "cloudflare-pages",
          previewPath: `/tmp/${clientId}`,
          productionUrl: `https://${clientId}.pages.dev`
        },
        assets: {
          logoText: clientId
        },
        intakeNotes: [],
        nextAction: "Delivered",
        createdAt: now,
        updatedAt: now
      });
    }

    await store.saveClient({
      id: "pilot-four",
      businessId: "auto-funding-agency",
      clientName: "Pilot Four",
      niche: "home services",
      geo: "Cleveland, OH",
      primaryPhone: "(216) 555-0106",
      primaryEmail: "hello@pilotfour.com",
      offerId: "founding-offer",
      siteStatus: "not_started",
      qaStatus: "pending",
      billingStatus: "retainer_active",
      formEndpoint: "https://hooks.example.com/forms/pilot-four",
      deployment: {
        platform: "local-preview"
      },
      assets: {
        logoText: "Pilot Four",
        services: ["Emergency HVAC", "Seasonal maintenance"]
      },
      intakeNotes: [],
      nextAction: "Proof cohort is satisfied",
      createdAt: now,
      updatedAt: now
    });

    const result = await northlineAutonomy.run();
    const updatedClient = await store.getClient("pilot-four");
    const handoffPackage = updatedClient?.assets.handoffPackage;
    const deployApproval = (await store.getApprovals()).find(
      (task) => task.id === "approval-northline-deploy-pilot-four"
    );

    assert.equal(updatedClient?.siteStatus, "ready");
    assert.ok(handoffPackage);
    assert.equal(deployApproval, undefined);
    assert.ok(
      result.snapshot.deliveryQueue.some(
        (item) => item.clientId === "pilot-four" && item.status === "handoff_complete"
      )
    );
    assert.ok(
      !result.snapshot.manualGates.some((gate) => gate.relatedEntityId === "pilot-four")
    );
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("micro-saas studio creates a QuietPivot launch plan with product backlog, growth surfaces, and actionable blockers", async () => {
  const touchedKeys = [
    "NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING",
    "NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD",
    "NORTHLINE_DOMAIN",
    "NORTHLINE_SITE_URL",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_PAGES_PROJECT",
    "META_PAGE_ID",
    "META_PAGE_ACCESS_TOKEN"
  ] as const;
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));

  try {
    for (const key of touchedKeys) {
      delete process.env[key];
    }

    const { imonEngine, microSaasStudio, store } = await setupWorkspace();
    await imonEngine.bootstrap();

    const result = await microSaasStudio.writePlan({
      businessId: "imon-micro-saas-factory"
    });
    await imonEngine.sync();
    const updatedBusiness = await store.getManagedBusiness("imon-micro-saas-factory");
    const primaryProduct = result.plan.productBacklog.find(
      (product) => product.id === result.plan.primaryProductId
    );

    assert.equal(result.plan.businessName, "QuietPivot Labs");
    assert.equal(result.plan.aliasEmail, "imonengine+quietpivotlabs@gmail.com");
    assert.equal(primaryProduct?.productName, "QuietPivot Signal Ledger");
    assert.equal(result.plan.productBacklog.length, 3);
    assert.ok(
      result.plan.socialPresence.some(
        (profile) =>
          profile.platform === "instagram_account" && profile.laneId === "insight-dashboards"
      )
    );
    assert.ok(
      result.plan.roadblocks.some((roadblock) => roadblock.category.includes("Payment"))
    );
    assert.ok(
      result.plan.roadblocks.some((roadblock) => roadblock.category.includes("Launch domain"))
    );
    assert.ok(
      result.plan.roadblocks.some((roadblock) => roadblock.category.includes("Social"))
    );
    assert.ok(updatedBusiness);
    assert.equal(updatedBusiness?.name, "QuietPivot Labs");
    assert.ok(
      updatedBusiness?.launchBlockers.some((blocker) => blocker.includes("Stripe checkout links"))
    );
    assert.ok(
      updatedBusiness?.notes.some((note) => note.includes("runtime/ops/micro-saas-businesses/"))
    );
    assert.equal(
      updatedBusiness?.notes.filter((note) => note.startsWith("Primary alias:")).length,
      1
    );
  } finally {
    for (const key of touchedKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
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
