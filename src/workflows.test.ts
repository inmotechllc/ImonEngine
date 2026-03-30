import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { DEFAULT_AGENCY_PROFILE, DEFAULT_OFFERS } from "./domain/defaults.js";
import type { ClientJob } from "./domain/contracts.js";
import { OrchestratorAgent } from "./agents/orchestrator.js";
import { SiteBuilderAgent } from "./agents/site-builder.js";
import { QaReviewerAgent } from "./agents/qa-reviewer.js";
import { ImonEngineAgent } from "./agents/imon-engine.js";
import { DigitalAssetFactoryAgent } from "./agents/digital-asset-factory.js";
import { StoreAutopilotAgent } from "./agents/store-autopilot.js";
import { FileStore } from "./storage/store.js";
import { AIClient } from "./openai/client.js";
import { ReplyHandlerAgent } from "./agents/reply-handler.js";
import { MicroSaasStudioService } from "./services/micro-saas-studio.js";
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
import { NorthlineOpsService } from "./services/northline-ops.js";
import { NorthlineSiteServer } from "./services/northline-site-server.js";
import { hashControlRoomPassword } from "./lib/control-room-auth.js";
import { exists, readJsonFile, readTextFile } from "./lib/fs.js";

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
  const storeAutopilot = new StoreAutopilotAgent(config, store, digitalAssetFactory, imonEngine);
  const storeOps = new StoreOpsService(config, store);
  const ventureStudio = new VentureStudioService(config, store);
  const northlineOps = new NorthlineOpsService(config, store);
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
    northlineOps,
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
  const nicheSiteNetwork = businesses.find((business) => business.id === "imon-niche-content-sites");
  const socialBrand = businesses.find((business) => business.id === "imon-faceless-social-brand");
  const agency = businesses.find((business) => business.id === "auto-funding-agency");

  assert.ok(engine);
  assert.equal(engine?.portfolio.trackedBusinesses, 6);
  assert.ok(digitalAssetStore);
  assert.equal(digitalAssetStore?.stage, "ready");
  assert.equal(nicheSiteNetwork?.stage, "deferred");
  assert.equal(socialBrand?.stage, "deferred");
  assert.ok(agency);
  assert.equal(agency?.name, "Northline Growth Systems");
  assert.equal(agency?.stage, "paused");
  assert.ok(report.nextLaunchCandidates.includes("imon-digital-asset-store"));
  assert.equal(report.businessCounts.deferred, 2);
  assert.equal(report.blockedBusinesses.includes("imon-faceless-social-brand"), false);
  assert.ok(report.recommendedConcurrency >= 1);
});

test("loadConfig prefers .env.example business values and ignores whitespace-only placeholders", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "auto-funding-env-"));
  const touchedKeys = [
    "NORTHLINE_SALES_EMAIL",
    "NORTHLINE_DOMAIN",
    "NORTHLINE_SITE_URL",
    "NORTHLINE_BOOKING_URL",
    "NORTHLINE_PRIMARY_SERVICE_AREA",
    "NORTHLINE_PHONE"
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
        "NORTHLINE_PHONE=(212) 555-0199"
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
        "NORTHLINE_PRIMARY_SERVICE_AREA= New York, NY"
      ].join("\n"),
      "utf8"
    );

    const config = await loadConfig(root);

    assert.equal(config.business.salesEmail, "contact@northlinegrowthsystems.com");
    assert.equal(config.business.domain, "northlinegrowthsystems.com");
    assert.equal(config.business.siteUrl, "https://northlinegrowthsystems.com");
    assert.equal(config.business.bookingUrl, "https://calendar.example.com/northline");
    assert.equal(config.business.primaryServiceArea, "New York, NY");
    assert.equal(config.business.phone, "(212) 555-0199");
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
  assert.match(await enginePage.text(), /Folder-Style Office Explorer/i);

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
  assert.match(await localEnginePage.text(), /Folder-Style Office Explorer/i);

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

  await localServer.close();
  await remoteServer.close();
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

test("northline ops creates a launch dossier with outbound sprint and config-driven blockers", async () => {
  const { imonEngine, northlineOps, store } = await setupWorkspace();
  await imonEngine.bootstrap();

  const result = await northlineOps.writePlan({
    businessId: "auto-funding-agency"
  });
  await imonEngine.sync();
  const updatedBusiness = await store.getManagedBusiness("auto-funding-agency");

  assert.equal(result.plan.businessName, "Northline Growth Systems");
  assert.equal(result.plan.outboundSprint.length, 10);
  assert.equal(result.plan.socialPlan.length, 6);
  assert.ok(result.plan.readiness.some((item) => item.id === "payment-collection"));
  assert.ok(result.plan.roadblocks.some((roadblock) => roadblock.category.includes("Payment")));
  assert.ok(result.plan.roadblocks.some((roadblock) => roadblock.category.includes("Public proof")));
  assert.ok(updatedBusiness);
  assert.equal(updatedBusiness?.stage, "paused");
  assert.ok(
    updatedBusiness?.launchBlockers.some((blocker) => blocker.includes("Stripe"))
  );
  assert.ok(
    updatedBusiness?.notes.some((note) => note.includes("runtime/ops/northline-growth-system"))
  );
});

test("northline ops treats hosted intake as launch-ready while leaving phone and GBP optional", async () => {
  const touchedKeys = [
    "NORTHLINE_DOMAIN",
    "NORTHLINE_SITE_URL",
    "NORTHLINE_SALES_EMAIL",
    "NORTHLINE_FACEBOOK_URL",
    "NORTHLINE_INSTAGRAM_URL",
    "NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING",
    "NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD",
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
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING = "https://buy.stripe.com/founding";
    process.env.NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD = "https://buy.stripe.com/standard";
    process.env.NORTHLINE_BOOKING_URL = "/book.html";
    process.env.NORTHLINE_LEAD_FORM_ACTION = "/api/northline-intake";
    delete process.env.NORTHLINE_PHONE;
    delete process.env.NORTHLINE_GOOGLE_BUSINESS_PROFILE_URL;
    delete process.env.NORTHLINE_GOOGLE_REVIEW_URL;

    const { imonEngine, northlineOps, store } = await setupWorkspace();
    await imonEngine.bootstrap();

    const result = await northlineOps.writePlan({
      businessId: "auto-funding-agency"
    });
    await imonEngine.sync();
    const updatedBusiness = await store.getManagedBusiness("auto-funding-agency");
    const contactReadiness = result.plan.readiness.find((item) => item.id === "contact-routing");
    const trustReadiness = result.plan.readiness.find((item) => item.id === "local-trust");

    assert.equal(result.plan.roadblocks.length, 0);
    assert.equal(contactReadiness?.status, "live");
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

test("northline site server accepts hosted intake submissions and stores notifications", async () => {
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

    const { config } = await setupWorkspace();
    await buildAgencySite(config, DEFAULT_AGENCY_PROFILE);

    server = new NorthlineSiteServer(config);
    const address = await server.listen();
    const baseUrl = `http://${address.host}:${address.port}`;

    const healthResponse = await fetch(`${baseUrl}/api/health`);
    const health = (await healthResponse.json()) as { status: string };
    const bookingPage = await fetch(`${baseUrl}/book.html`);
    const bookingHtml = await bookingPage.text();

    assert.equal(health.status, "ready");
    assert.equal(bookingPage.status, 200);
    assert.match(bookingHtml, /Book a teardown call/);

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
        primaryServices: "Emergency plumbing repair",
        preferredCallWindow: "Tue 1-3pm ET",
        contactPreference: "Call",
        website: "https://signalplumbing.com",
        leadGoal: "20 more booked calls",
        biggestLeak: "Weak CTA and slow response times",
        notes: "Wants a simple intake path",
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

    const stored = await readJsonFile<{ submissions: Array<{ businessName?: string; source?: string }> }>(
      submissionStorePath,
      { submissions: [] }
    );
    const latestNotification = await readTextFile(
      path.join(config.notificationDir, "northline-intake-latest.txt")
    );

    assert.equal(stored.submissions.length, 1);
    assert.equal(stored.submissions[0]?.businessName, "Signal Plumbing");
    assert.equal(stored.submissions[0]?.source, "northline-booking-page");
    assert.match(latestNotification, /Signal Plumbing/);
    assert.match(latestNotification, /Preferred call window: Tue 1-3pm ET/);
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

test("micro-saas studio creates a QuietPivot launch plan with product backlog, growth surfaces, and actionable blockers", async () => {
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
