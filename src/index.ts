import path from "node:path";
import { DEFAULT_AGENCY_PROFILE, DEFAULT_OFFERS } from "./domain/defaults.js";
import {
  clientProofEligibilityForProvenance,
  type ClientJob,
  type LeadRecord,
  type OfferConfig
} from "./domain/contracts.js";
import { loadConfig } from "./config.js";
import { Logger } from "./lib/logger.js";
import { hashControlRoomPassword } from "./lib/control-room-auth.js";
import { readJsonFile, readTextFile } from "./lib/fs.js";
import { slugify } from "./lib/text.js";
import { AIClient } from "./ai/client.js";
import { FileStore } from "./storage/store.js";
import { OrchestratorAgent } from "./agents/orchestrator.js";
import { SiteBuilderAgent } from "./agents/site-builder.js";
import { QaReviewerAgent } from "./agents/qa-reviewer.js";
import { Deployer } from "./agents/deployer.js";
import { ReplyHandlerAgent } from "./agents/reply-handler.js";
import { ImonEngineAgent } from "./agents/imon-engine.js";
import { DigitalAssetFactoryAgent } from "./agents/digital-asset-factory.js";
import { StoreAutopilotAgent } from "./agents/store-autopilot.js";
import { buildAgencySite } from "./services/agency-site.js";
import { OfficeDashboardService } from "./services/office-dashboard.js";
import { ControlRoomServer } from "./services/control-room-server.js";
import { ControlRoomLocalServer } from "./services/control-room-local-server.js";
import { MicroSaasStudioService } from "./services/micro-saas-studio.js";
import { NorthlineAutonomyService } from "./services/northline-autonomy.js";
import { NorthlineProfileAdminService } from "./services/northline-profile-admin.js";
import { NorthlineOpsService } from "./services/northline-ops.js";
import { NorthlineProspectCollectorService } from "./services/northline-prospect-collector.js";
import { NorthlineProspectSourcingService } from "./services/northline-prospect-sourcing.js";
import { NorthlineSiteServer } from "./services/northline-site-server.js";
import { NorthlineValidationService } from "./services/northline-validation.js";
import { NorthlineDepartmentSmokeService } from "./services/northline-department-smoke.js";
import { ClipBaitersAutonomyService } from "./services/clipbaiters-autonomy.js";
import { ClipBaitersCollectorService } from "./services/clipbaiters-collector.js";
import { ClipBaitersDealsService } from "./services/clipbaiters-deals.js";
import { ClipBaitersIntakeService } from "./services/clipbaiters-intake.js";
import { ClipBaitersMonetizationService } from "./services/clipbaiters-monetization.js";
import { ClipBaitersPublisherService } from "./services/clipbaiters-publisher.js";
import { ClipBaitersRadarService } from "./services/clipbaiters-radar.js";
import { ClipBaitersSkimmerService } from "./services/clipbaiters-skimmer.js";
import { ClipBaitersStudioService } from "./services/clipbaiters-studio.js";
import { resolveNorthlineBusinessProfile } from "./services/northline-business-profile.js";
import { processLeadReply } from "./services/lead-replies.js";
import { PodAutonomyService } from "./services/pod-autonomy.js";
import { PodStudioService } from "./services/pod-studio.js";
import { buildStorefrontSite } from "./services/storefront-site.js";
import { StoreOpsService } from "./services/store-ops.js";
import { VentureStudioService } from "./services/venture-studio.js";

interface Flags {
  [key: string]: string | boolean | undefined;
}

interface ClientBrief {
  id?: string;
  businessId?: string;
  leadId?: string;
  provenance?: ClientJob["provenance"];
  proofEligible?: boolean;
  clientName: string;
  niche: string;
  geo: string;
  primaryPhone: string;
  primaryEmail: string;
  offerId?: string;
  formEndpoint?: string;
  billingStatus?: ClientJob["billingStatus"];
  assets?: ClientJob["assets"];
  intakeNotes?: string[];
  nextAction?: string;
}

type CreateClientOptions = {
  generatedBrand?: boolean;
};

const GENERATED_BRAND_INTAKE_NOTE =
  "Generated brand rehearsal. Keep this record internal-only and non-proof-eligible until an operator deliberately reclassifies it.";

async function resolveDefaultNorthlineProfile(store: FileStore, config: Awaited<ReturnType<typeof loadConfig>>) {
  const business = await store.getManagedBusiness("auto-funding-agency");
  return resolveNorthlineBusinessProfile(config, business);
}

function agencySiteOverridesFromNorthlineProfile(profile: Awaited<ReturnType<typeof resolveDefaultNorthlineProfile>>) {
  return {
    bookingUrl: profile.bookingUrl,
    domain: profile.domain,
    leadFormAction: profile.leadFormAction,
    primaryServiceArea: profile.primaryServiceArea,
    salesEmail: profile.salesEmail,
    siteUrl: profile.siteUrl,
    stripeFounding: profile.stripeFounding,
    stripeStandard: profile.stripeStandard,
    stripeValidation: profile.stripeValidation
  };
}

const logger = new Logger();

function parseFlags(args: string[]): { command: string; flags: Flags } {
  const [command = "help", ...rest] = args;
  const flags: Flags = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token?.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }

    flags[key] = next;
    index += 1;
  }

  return { command, flags };
}

async function seedOffers(store: FileStore): Promise<void> {
  const existing = await store.getOffers();
  const existingIds = new Set(existing.map((offer) => offer.id));

  for (const offer of DEFAULT_OFFERS) {
    const next: OfferConfig =
      existing.find((item) => item.id === offer.id) ?? offer;
    if (!existingIds.has(offer.id) || JSON.stringify(next) !== JSON.stringify(offer)) {
      await store.saveOffer({ ...next, ...offer });
    }
  }
}

function usage(): string {
  return [
    "Usage:",
    "  npm run dev -- bootstrap",
    "  npm run dev -- prospect --input examples/prospects/home-services.csv",
    "  npm run dev -- daily-run --input examples/prospects/home-services.csv",
    "  npm run dev -- create-client --brief examples/briefs/sunrise-plumbing.json",
    "  npm run dev -- create-client --brief examples/briefs/northline-generated-brand-template.json --generated-brand",
    "  npm run dev -- build-site --client sunrise-plumbing",
    "  npm run dev -- qa --client sunrise-plumbing",
    "  npm run dev -- deploy --client sunrise-plumbing",
    "  npm run dev -- retain --client sunrise-plumbing",
    "  npm run dev -- businesses",
    "  npm run dev -- engine-sync",
    "  npm run dev -- engine-report",
    "  npm run dev -- org-sync",
    "  npm run dev -- org-report [--business <id>]",
    "  npm run dev -- office-views",
    "  npm run dev -- office-dashboard",
    "  npm run dev -- control-room-build",
    "  npm run dev -- control-room-serve",
    "  npm run dev -- control-room-local",
    "  npm run dev -- control-room-health",
    "  npm run dev -- control-room-password-hash --password <value>",
    "  npm run dev -- route-task --title <text> --summary <text> [--workflow <id>] [--business <id>] [--risk low|medium|high]",
    "  npm run dev -- activate-business --business imon-digital-asset-store",
    "  npm run dev -- pause-business --business imon-digital-asset-store",
    "  npm run dev -- vps-artifacts",
    "  npm run dev -- seed-asset-packs",
    "  npm run dev -- stage-asset-pack --pack <id>",
    "  npm run dev -- ready-asset-pack --pack <id>",
    "  npm run dev -- publish-asset-pack --pack <id> --url <gumroad-url>",
    "  npm run dev -- autopublish-asset-pack --pack <id>",
    "  npm run dev -- repair-asset-pack-media --pack <id>",
    "  npm run dev -- repair-asset-pack-content --pack <id>",
    "  npm run dev -- growth-queue",
    "  npm run dev -- publish-growth-post --item <id>",
    "  npm run dev -- import-gumroad-sales --file <csv>",
    "  npm run dev -- import-relay-transactions --file <csv> [--business imon-digital-asset-store]",
    "  npm run dev -- revenue-report [--business imon-digital-asset-store] [--days 30]",
    "  npm run dev -- collective-fund-report [--days 30]",
    "  npm run dev -- build-storefront-site",
    "  npm run dev -- social-profiles [--business <id>] [--all]",
    "  npm run dev -- venture-studio [--business <id>]",
    "  npm run dev -- clipbaiters-plan [--business clipbaiters-viral-moments] [--notify-roadblocks]",
    "  npm run dev -- clipbaiters-approve-policy [--business clipbaiters-viral-moments] [--approved-by <name-or-email>] [--note <text>]",
    "  npm run dev -- clipbaiters-approve-lane-posture [--business clipbaiters-viral-moments] [--approved-by <name-or-email>] [--note <text>]",
    "  npm run dev -- clipbaiters-collect [--business clipbaiters-viral-moments] [--lane clipbaiters-political]",
    "  npm run dev -- clipbaiters-skim [--business clipbaiters-viral-moments] [--lane clipbaiters-political]",
    "  npm run dev -- clipbaiters-radar [--business clipbaiters-viral-moments] [--lane clipbaiters-political]",
    "  npm run dev -- clipbaiters-autonomy-run [--business clipbaiters-viral-moments] [--lane clipbaiters-political] [--all-active-lanes] [--dry-run]",
    "  npm run dev -- clipbaiters-publish [--business clipbaiters-viral-moments] [--lane clipbaiters-political] [--all-active-lanes] [--dry-run]",
    "  npm run dev -- clipbaiters-intake [--business clipbaiters-viral-moments] [--file <json>]",
    "  npm run dev -- clipbaiters-source-creators [--business clipbaiters-viral-moments]",
    "  npm run dev -- clipbaiters-draft-creator-outreach [--business clipbaiters-viral-moments]",
    "  npm run dev -- clipbaiters-deals-report [--business clipbaiters-viral-moments]",
    "  npm run dev -- clipbaiters-monetization-report [--business clipbaiters-viral-moments]",
    "  npm run dev -- northline-plan [--business auto-funding-agency]",
    "  npm run dev -- northline-promotion-queue [--business auto-funding-agency]",
    "  npm run dev -- northline-profile-show [--business auto-funding-agency] [--probe-payments]",
    "  npm run dev -- northline-profile-update --business <id> --file <json> [--replace] [--skip-payment-probe]",
    "  npm run dev -- northline-payment-check [--business auto-funding-agency] [--skip-probe]",
    "  npm run dev -- northline-department-smoke [--business auto-funding-agency] [--skip-route-drills]",
    "  npm run dev -- northline-collect-prospects [--business auto-funding-agency] [--force]",
    "  npm run dev -- northline-source-prospects [--business auto-funding-agency]",
    "  npm run dev -- northline-inbox-sync [--business auto-funding-agency]",
    "  npm run dev -- northline-autonomy-run [--business auto-funding-agency] [--notify-roadblocks]",
    "  npm run dev -- northline-billing-handoff --client <id> --status paid|retainer_active [--form-endpoint <url>] [--next-action <text>]",
    "  npm run dev -- northline-validation-run [--business auto-funding-agency] [--submission latest|<id>] [--status paid|retainer_active] [--form-endpoint <url>]",
    "  npm run dev -- northline-site-serve",
    "  npm run dev -- northline-site-health",
    "  npm run dev -- micro-saas-plan [--business imon-micro-saas-factory] [--notify-roadblocks]",
    "  npm run dev -- pod-plan --business imon-pod-store --reference-dir <path> [--notify-roadblocks]",
    "  npm run dev -- pod-autonomy --business imon-pod-store --reference-dir <path> [--notify-roadblocks]",
    "  npm run dev -- autopilot-run-once",
    "  npm run dev -- asset-packs",
    "  npm run dev -- approvals",
    "  npm run dev -- report",
    "  npm run dev -- build-agency-site"
  ].join("\n");
}

async function buildContext() {
  const config = await loadConfig();
  const store = new FileStore(config.stateDir);
  await store.init();
  await seedOffers(store);
  const ai = new AIClient(config);
  const orchestrator = new OrchestratorAgent(config, store, ai);
  const siteBuilder = new SiteBuilderAgent(ai, config, store);
  const qaReviewer = new QaReviewerAgent(config, store);
  const deployer = new Deployer(config, store, orchestrator.getAccountOps());
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
  const northlineProfileAdmin = new NorthlineProfileAdminService(config, store);
  const northlineProspectCollector = new NorthlineProspectCollectorService(config, store, fetch, ai);
  const northlineProspectSourcing = new NorthlineProspectSourcingService(config, store, orchestrator);
  const northlineDepartmentSmoke = new NorthlineDepartmentSmokeService(config, store, imonEngine);
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
      deployer
    }
  );
  const northlineValidation = new NorthlineValidationService(config, store, northlineAutonomy);
  const microSaasStudio = new MicroSaasStudioService(config, store);
  const podStudio = new PodStudioService(config, store);
  const podAutonomy = new PodAutonomyService(config, store, podStudio, storeOps);
  const officeDashboard = new OfficeDashboardService(config, store);
  const controlRoomServer = new ControlRoomServer(config, store);
  const controlRoomLocalServer = new ControlRoomLocalServer(config);
  let northlineSiteBootstrapPromise: Promise<void> | undefined;
  const ensureNorthlineSiteReady = async (): Promise<void> => {
    northlineSiteBootstrapPromise ??= imonEngine.bootstrap().then(() => undefined);
    await northlineSiteBootstrapPromise;
  };
  const northlineSiteServer = new NorthlineSiteServer(config, {
    onSubmissionStored: async () => {
      await ensureNorthlineSiteReady();
      await northlineAutonomy.run();
    },
    onProposalPaymentCompleted: async (request) => {
      await ensureNorthlineSiteReady();
      return northlineAutonomy.runBillingAutomation(request);
    },
    onValidationConfirmed: async (request) => {
      await ensureNorthlineSiteReady();
      return northlineValidation.run(request);
    }
  });

  return {
    config,
    store,
    ai,
    orchestrator,
    siteBuilder,
    qaReviewer,
    deployer,
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
    northlineDepartmentSmoke,
    northlineAutonomy,
    northlineValidation,
    microSaasStudio,
    podStudio,
    podAutonomy,
    officeDashboard,
    controlRoomServer,
    controlRoomLocalServer,
    northlineSiteServer
  };
}

export async function createClientFromBrief(
  store: FileStore,
  briefPath: string,
  options: CreateClientOptions = {}
): Promise<ClientJob> {
  const brief = await readJsonFile<ClientBrief>(path.resolve(briefPath), {} as ClientBrief);
  const now = new Date().toISOString();
  const generatedBrand = options.generatedBrand === true;
  const provenance = generatedBrand ? "internal_manual" : brief.provenance ?? "internal_manual";
  const intakeNotes = brief.intakeNotes ?? [];
  const nextIntakeNotes =
    generatedBrand && !intakeNotes.includes(GENERATED_BRAND_INTAKE_NOTE)
      ? [GENERATED_BRAND_INTAKE_NOTE, ...intakeNotes]
      : intakeNotes;
  const client: ClientJob = {
    id: brief.id ?? slugify(brief.clientName),
    businessId: brief.businessId ?? "auto-funding-agency",
    leadId: brief.leadId,
    provenance,
    proofEligible: generatedBrand
      ? false
      : clientProofEligibilityForProvenance(provenance) && (brief.proofEligible ?? true),
    clientName: brief.clientName,
    niche: brief.niche,
    geo: brief.geo,
    primaryPhone: brief.primaryPhone,
    primaryEmail: brief.primaryEmail,
    offerId: brief.offerId ?? "founding-offer",
    siteStatus: "not_started",
    qaStatus: "pending",
    billingStatus: brief.billingStatus ?? "deposit_pending",
    formEndpoint: brief.formEndpoint,
    deployment: {
      platform: "local-preview"
    },
    assets: brief.assets ?? {},
    intakeNotes: nextIntakeNotes,
    nextAction: brief.nextAction ?? "Send preview for review",
    createdAt: now,
    updatedAt: now
  };

  await store.saveClient(client);
  if (client.leadId) {
    const lead = await store.getLead(client.leadId);
    if (lead) {
      await store.saveLead({
        ...lead,
        stage: "won",
        updatedAt: now
      });
    }
  }
  return client;
}

async function handleReply(store: FileStore, replyHandler: ReplyHandlerAgent, leadId: string, messageFile: string) {
  const message = await readTextFile(path.resolve(messageFile));
  const result = await processLeadReply({
    store,
    replyHandler,
    leadId,
    message,
    subject: path.basename(messageFile),
    source: "manual_file"
  });
  logger.info(
    `${result.lead.businessName}: ${result.classification.disposition}/${result.classification.route} -> ${result.classification.nextAction}`
  );
}

async function main(): Promise<void> {
  const { command, flags } = parseFlags(process.argv.slice(2));
  const {
    config,
    store,
    orchestrator,
    siteBuilder,
    qaReviewer,
    deployer,
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
    northlineDepartmentSmoke,
    northlineAutonomy,
    northlineValidation,
    microSaasStudio,
    podStudio,
    podAutonomy,
    officeDashboard,
    controlRoomServer,
    controlRoomLocalServer,
    northlineSiteServer
  } =
    await buildContext();

  switch (command) {
    case "bootstrap": {
      await imonEngine.bootstrap();
      await orchestrator.getAccountOps().ensureOperationalApprovals();
      const defaultNorthlineProfile = await resolveDefaultNorthlineProfile(store, config);
      await buildAgencySite(
        config,
        defaultNorthlineProfile.agencyProfile,
        agencySiteOverridesFromNorthlineProfile(defaultNorthlineProfile)
      );
      await orchestrator.getReports().generateRunReport(["Bootstrap completed.", "ImonEngine portfolio seeded."]);
      await imonEngine.writeVpsArtifacts();
      await ventureStudio.writeArtifacts();
      logger.info(
        "Seeded offers, bootstrapped ImonEngine, generated approval tasks, built the agency site, and refreshed venture-studio artifacts."
      );
      break;
    }
    case "prospect": {
      const input = String(flags.input ?? "");
      if (!input) {
        throw new Error("Missing --input for prospect command.");
      }
      const leads = await orchestrator.prospect(input);
      logger.info(`Imported and scored ${leads.length} leads.`);
      break;
    }
    case "northline-source-prospects": {
      const businessId = typeof flags.business === "string" ? flags.business : "auto-funding-agency";
      const result = await northlineProspectSourcing.run({ businessId });
      logger.info(`${result.status.toUpperCase()}: ${result.summary}`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "daily-run": {
      const input = typeof flags.input === "string" ? flags.input : undefined;
      await orchestrator.dailyRun(input);
      logger.info("Daily run completed.");
      break;
    }
    case "create-client": {
      const brief = String(flags.brief ?? "");
      if (!brief) {
        throw new Error("Missing --brief for create-client command.");
      }
      const client = await createClientFromBrief(store, brief, {
        generatedBrand: Boolean(flags["generated-brand"])
      });
      logger.info(`Client ${client.clientName} created with id ${client.id}.`);
      break;
    }
    case "build-site": {
      const clientId = String(flags.client ?? "");
      const client = await store.getClient(clientId);
      if (!client) {
        throw new Error(`Client ${clientId} not found.`);
      }
      const result = await siteBuilder.buildClientSite(client);
      logger.info(`Built preview at ${result.previewDir}`);
      break;
    }
    case "qa": {
      const clientId = String(flags.client ?? "");
      const client = await store.getClient(clientId);
      if (!client) {
        throw new Error(`Client ${clientId} not found.`);
      }
      const report = await qaReviewer.review(client);
      logger.info(`QA ${report.passed ? "passed" : "failed"} for ${client.clientName}.`);
      break;
    }
    case "deploy": {
      const clientId = String(flags.client ?? "");
      const client = await store.getClient(clientId);
      if (!client) {
        throw new Error(`Client ${clientId} not found.`);
      }
      const target = await deployer.deploy(client);
      logger.info(`Deploy target: ${target}`);
      break;
    }
    case "retain": {
      const clientId = String(flags.client ?? "");
      const client = await store.getClient(clientId);
      if (!client) {
        throw new Error(`Client ${clientId} not found.`);
      }
      const report = await orchestrator.getReports().generateRetentionReport(client);
      logger.info(
        report.upgradeOffer
          ? `Retention report created with upsell: ${report.upsellCandidate}. Growth upgrade path: ${report.upgradeOffer.label}`
          : `Retention report created with upsell: ${report.upsellCandidate}`
      );
      break;
    }
    case "handle-reply": {
      const leadId = String(flags.lead ?? "");
      const messageFile = String(flags["message-file"] ?? "");
      if (!leadId || !messageFile) {
        throw new Error("Missing --lead or --message-file for handle-reply command.");
      }
      await handleReply(store, replyHandler, leadId, messageFile);
      break;
    }
    case "approvals": {
      const approvals = await store.getApprovals();
      console.log(JSON.stringify(approvals, null, 2));
      break;
    }
    case "businesses": {
      const businesses = await imonEngine.getPortfolioBusinesses();
      console.log(JSON.stringify(businesses, null, 2));
      break;
    }
    case "engine-sync": {
      const report = await imonEngine.sync();
      await ventureStudio.writeArtifacts();
      logger.info(
        `Engine synced. ${report.businessCounts.active} active, ${report.businessCounts.ready} ready, recommended concurrency ${report.recommendedConcurrency}.`
      );
      break;
    }
    case "engine-report": {
      const report = await imonEngine.sync();
      console.log(JSON.stringify(report, null, 2));
      break;
    }
    case "org-sync": {
      await imonEngine.sync();
      const snapshot = await imonEngine.getLatestOfficeSnapshot();
      logger.info("Organization control plane synced.");
      console.log(JSON.stringify(snapshot ?? null, null, 2));
      break;
    }
    case "org-report": {
      await imonEngine.sync();
      const businessId = typeof flags.business === "string" ? flags.business : undefined;
      const blueprint = businessId
        ? await store.getOrganizationBlueprint(`org-business-${businessId}`)
        : await store.getOrganizationBlueprint("org-engine-imon-engine");
      const officeSnapshot = await imonEngine.getLatestOfficeSnapshot();
      console.log(
        JSON.stringify(
          businessId
            ? {
                blueprint,
                businessOffice: officeSnapshot?.businessViews.find((view) => view.businessId === businessId) ?? null
              }
            : {
                blueprint,
                executiveOffice: officeSnapshot?.executiveView ?? null
              },
          null,
          2
        )
      );
      break;
    }
    case "office-views": {
      await imonEngine.sync();
      const snapshot = await imonEngine.getLatestOfficeSnapshot();
      console.log(JSON.stringify(snapshot ?? null, null, 2));
      break;
    }
    case "office-dashboard": {
      await imonEngine.sync();
      const artifacts = await officeDashboard.writeDashboard();
      logger.info(`Office dashboard refreshed at ${artifacts.htmlPath}.`);
      console.log(JSON.stringify(artifacts, null, 2));
      break;
    }
    case "control-room-build": {
      await imonEngine.sync();
      const artifacts = await officeDashboard.writeDashboard();
      logger.info(`Control-room export refreshed at ${artifacts.htmlPath}.`);
      console.log(JSON.stringify(artifacts, null, 2));
      break;
    }
    case "control-room-serve": {
      await imonEngine.sync();
      const address = await controlRoomServer.listen();
      logger.info(
        `Control room listening on http://${address.host}:${address.port} (private VPS mode).`
      );
      process.once("SIGINT", () => {
        void controlRoomServer.close();
      });
      process.once("SIGTERM", () => {
        void controlRoomServer.close();
      });
      await new Promise(() => {});
      break;
    }
    case "control-room-local": {
      const address = await controlRoomLocalServer.listen();
      logger.info(
        `Local control room listening on http://${address.host}:${address.port} and proxying the VPS control plane.`
      );
      process.once("SIGINT", () => {
        void controlRoomLocalServer.close();
      });
      process.once("SIGTERM", () => {
        void controlRoomLocalServer.close();
      });
      await new Promise(() => {});
      break;
    }
    case "control-room-health": {
      const health = await controlRoomServer.getHealth();
      console.log(JSON.stringify(health, null, 2));
      break;
    }
    case "control-room-password-hash": {
      const password = String(flags.password ?? "");
      if (!password) {
        throw new Error("Missing --password for control-room-password-hash.");
      }
      console.log(await hashControlRoomPassword(password));
      break;
    }
    case "route-task": {
      const title = String(flags.title ?? "");
      const summary = String(flags.summary ?? "");
      if (!title || !summary) {
        throw new Error("Missing --title or --summary for route-task command.");
      }
      const risk =
        typeof flags.risk === "string" &&
        ["low", "medium", "high"].includes(flags.risk)
          ? (flags.risk as "low" | "medium" | "high")
          : undefined;
      const actionClasses =
        typeof flags["action-classes"] === "string"
          ? flags["action-classes"]
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean)
          : undefined;
      const requestedTools =
        typeof flags.tools === "string"
          ? flags.tools
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean)
          : undefined;
      const routed = await imonEngine.routeTask({
        workflowId: typeof flags.workflow === "string" ? flags.workflow : undefined,
        businessId: typeof flags.business === "string" ? flags.business : undefined,
        departmentId: typeof flags.department === "string" ? flags.department : undefined,
        positionId: typeof flags.position === "string" ? flags.position : undefined,
        title,
        summary,
        riskLevel: risk,
        actionClasses: actionClasses as any,
        publicFacing: flags["public-facing"] === true ? true : undefined,
        moneyMovement: flags["money-movement"] === true ? true : undefined,
        requiresVerifiedFinancialData:
          flags["requires-verified-financial-data"] === true ? true : undefined,
        requestedTools
      });
      logger.info(`Routed task ${routed.envelope.id}.`);
      console.log(JSON.stringify(routed, null, 2));
      break;
    }
    case "activate-business": {
      const businessId = String(flags.business ?? "");
      if (!businessId) {
        throw new Error("Missing --business for activate-business command.");
      }
      const business = await imonEngine.activateBusiness(businessId);
      logger.info(`Activated ${business.name}.`);
      break;
    }
    case "pause-business": {
      const businessId = String(flags.business ?? "");
      if (!businessId) {
        throw new Error("Missing --business for pause-business command.");
      }
      const business = await imonEngine.pauseBusiness(businessId);
      logger.info(`Paused ${business.name}.`);
      break;
    }
    case "vps-artifacts": {
      const artifacts = await imonEngine.writeVpsArtifacts();
      const ventureArtifacts = await ventureStudio.writeArtifacts();
      logger.info(`Wrote VPS artifacts to ${artifacts.manifestPath} and venture snapshot to ${ventureArtifacts.snapshotJsonPath}`);
      break;
    }
    case "seed-asset-packs": {
      const created = await digitalAssetFactory.seedStarterQueue();
      if (created.length === 0) {
        await digitalAssetFactory.refreshArtifacts();
        logger.info("Asset pack queue already exists. Refreshed artifacts.");
      } else {
        logger.info(`Seeded ${created.length} asset packs for the Gumroad launch queue.`);
      }
      break;
    }
    case "asset-packs": {
      const packs = await store.getAssetPacks();
      console.log(JSON.stringify(packs, null, 2));
      break;
    }
    case "stage-asset-pack": {
      const packId = typeof flags.pack === "string" ? flags.pack : undefined;
      const pack = await digitalAssetFactory.stagePack(packId);
      logger.info(`Staged ${pack.title} at ${pack.outputDir}`);
      break;
    }
    case "ready-asset-pack": {
      const packId = String(flags.pack ?? "");
      if (!packId) {
        throw new Error("Missing --pack for ready-asset-pack command.");
      }
      const pack = await digitalAssetFactory.markReadyForUpload(packId);
      logger.info(`Marked ${pack.title} as ready for upload.`);
      break;
    }
    case "publish-asset-pack": {
      const packId = String(flags.pack ?? "");
      const productUrl = String(flags.url ?? "");
      if (!packId || !productUrl) {
        throw new Error("Missing --pack or --url for publish-asset-pack command.");
      }
      const pack = await digitalAssetFactory.publishPack(packId, productUrl);
      logger.info(`Recorded published asset pack ${pack.title} at ${pack.productUrl}`);
      break;
    }
    case "autopublish-asset-pack": {
      const packId = typeof flags.pack === "string" ? flags.pack : undefined;
      const result = await storeAutopilot.autopublishReadyPack(packId);
      logger.info(`Auto-published ${result.title} at ${result.productUrl}`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "repair-asset-pack-media": {
      const packId = typeof flags.pack === "string" ? flags.pack : undefined;
      const result = await storeAutopilot.repairPublishedPackMedia(packId);
      logger.info(
        `Repaired Gumroad media for ${result.title} at ${result.productUrl} (${result.mediaAttempts ?? 0} upload attempt(s)).`
      );
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "repair-asset-pack-content": {
      const packId = typeof flags.pack === "string" ? flags.pack : undefined;
      const result = await storeAutopilot.repairPublishedPackContent(packId);
      logger.info(
        `Repaired Gumroad content for ${result.title} at ${result.productUrl} (${result.uploadAttempts ?? 0} upload attempt(s)).`
      );
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "autopilot-run-once": {
      const result = await storeAutopilot.runOnce();
      await ventureStudio.writeArtifacts();
      logger.info(`${result.status.toUpperCase()}: ${result.summary}`);
      if (result.details.length > 0) {
        console.log(JSON.stringify(result, null, 2));
      }
      break;
    }
    case "growth-queue": {
      const packs = await store.getAssetPacks();
      const queue = await storeOps.refreshGrowthQueue(packs);
      const artifacts = await storeOps.writeGrowthArtifacts(packs, queue);
      logger.info(`Growth queue refreshed with ${queue.length} item(s).`);
      console.log(JSON.stringify({ queueItems: queue.length, ...artifacts }, null, 2));
      break;
    }
    case "publish-growth-post": {
      const itemId = String(flags.item ?? "");
      if (!itemId) {
        throw new Error("Missing --item for publish-growth-post command.");
      }
      const result = await storeAutopilot.publishGrowthPost(itemId);
      logger.info(`${result.status.toUpperCase()}: ${result.summary}`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "import-gumroad-sales": {
      const filePath = String(flags.file ?? "");
      if (!filePath) {
        throw new Error("Missing --file for import-gumroad-sales command.");
      }
      const packs = await store.getAssetPacks();
      const result = await storeOps.importGumroadSales(path.resolve(filePath), packs);
      logger.info(`Imported ${result.imported} Gumroad transaction(s).`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "import-relay-transactions": {
      const filePath = String(flags.file ?? "");
      if (!filePath) {
        throw new Error("Missing --file for import-relay-transactions command.");
      }
      const businessId =
        typeof flags.business === "string" ? flags.business : "imon-digital-asset-store";
      const result = await storeOps.importRelayTransactions(path.resolve(filePath), businessId);
      logger.info(`Imported ${result.imported} Relay transaction(s).`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "revenue-report": {
      const businessId =
        typeof flags.business === "string" ? flags.business : "imon-digital-asset-store";
      const days = Number(flags.days ?? "30");
      const snapshot = await storeOps.buildRevenueSnapshot(businessId, days);
      const business = await store.getManagedBusiness(businessId);
      const artifacts = await storeOps.writeRevenueArtifacts(snapshot, business?.name ?? businessId);
      logger.info(`Revenue report generated for ${business?.name ?? businessId}.`);
      console.log(JSON.stringify({ snapshot, artifacts }, null, 2));
      break;
    }
    case "collective-fund-report": {
      const days = Number(flags.days ?? "30");
      const snapshot = await storeOps.buildCollectiveFundSnapshot(days);
      const artifacts = await storeOps.writeCollectiveArtifacts(snapshot);
      logger.info("Collective ImonEngine fund report generated.");
      console.log(JSON.stringify({ snapshot, artifacts }, null, 2));
      break;
    }
    case "build-storefront-site": {
      const result = await buildStorefrontSite(config, store);
      logger.info(`Owned storefront generated at ${result.htmlPath}.`);
      if (result.roadblocks.length > 0) {
        logger.info(`Remaining storefront roadblocks: ${result.roadblocks.length}`);
      }
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "social-profiles": {
      const businessId = typeof flags.business === "string" ? flags.business : undefined;
      const profiles = businessId
        ? await storeOps.ensureSocialProfiles(businessId)
        : await storeOps.scaffoldPortfolioSocialProfiles();
      const artifacts = await storeOps.writeSocialArtifacts(profiles);
      logger.info(`Social profile registry refreshed with ${profiles.length} profile(s).`);
      console.log(JSON.stringify({ profiles, artifacts }, null, 2));
      break;
    }
    case "venture-studio": {
      const snapshot = await ventureStudio.buildSnapshot();
      const artifacts = await ventureStudio.writeArtifacts(snapshot);
      const businessId = typeof flags.business === "string" ? flags.business : undefined;
      logger.info(`Venture studio snapshot refreshed in ${artifacts.snapshotJsonPath}.`);
      console.log(
        JSON.stringify(
          businessId
            ? {
                blueprint: snapshot.blueprints.find((blueprint) => blueprint.businessId === businessId) ?? null,
                policy: snapshot.policy,
                launchWindows: snapshot.launchWindows
              }
            : { snapshot, artifacts },
          null,
          2
        )
      );
      break;
    }
    case "clipbaiters-plan": {
      const businessId =
        typeof flags.business === "string" ? flags.business : "clipbaiters-viral-moments";
      const result = await clipbaitersStudio.writePlan({
        businessId,
        notifyRoadblocks: flags["notify-roadblocks"] === true
      });
      logger.info(`ClipBaiters planning dossier refreshed for ${result.plan.businessName}.`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "clipbaiters-approve-policy": {
      const businessId =
        typeof flags.business === "string" ? flags.business : "clipbaiters-viral-moments";
      const result = await clipbaitersStudio.approveRightsReviewPolicy({
        businessId,
        approvedBy: typeof flags["approved-by"] === "string" ? flags["approved-by"] : undefined,
        note: typeof flags.note === "string" ? flags.note : undefined
      });
      await imonEngine.sync();
      logger.info(`ClipBaiters rights policy approved for ${result.plan.businessName}.`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "clipbaiters-approve-lane-posture": {
      const businessId =
        typeof flags.business === "string" ? flags.business : "clipbaiters-viral-moments";
      const result = await clipbaitersStudio.approveLanePosturePolicy({
        businessId,
        approvedBy: typeof flags["approved-by"] === "string" ? flags["approved-by"] : undefined,
        note: typeof flags.note === "string" ? flags.note : undefined
      });
      await imonEngine.sync();
      logger.info(`ClipBaiters lane posture approved for ${result.plan.businessName}.`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "clipbaiters-collect": {
      const businessId =
        typeof flags.business === "string" ? flags.business : "clipbaiters-viral-moments";
      const laneId = typeof flags.lane === "string" ? flags.lane : undefined;
      const result = await clipbaitersCollector.collect({ businessId, laneId });
      logger.info(result.summary);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "clipbaiters-skim": {
      const businessId =
        typeof flags.business === "string" ? flags.business : "clipbaiters-viral-moments";
      const laneId = typeof flags.lane === "string" ? flags.lane : undefined;
      const result = await clipbaitersSkimmer.skim({ businessId, laneId });
      logger.info(result.summary);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "clipbaiters-radar": {
      const businessId =
        typeof flags.business === "string" ? flags.business : "clipbaiters-viral-moments";
      const laneId = typeof flags.lane === "string" ? flags.lane : "clipbaiters-political";
      const result = await clipbaitersRadar.refresh({ businessId, laneId });
      logger.info(result.summary);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "clipbaiters-autonomy-run": {
      const businessId =
        typeof flags.business === "string" ? flags.business : "clipbaiters-viral-moments";
      const laneId = typeof flags.lane === "string" ? flags.lane : "clipbaiters-political";
      const result = await clipbaitersAutonomy.run({
        businessId,
        laneId,
        dryRun: Boolean(flags["dry-run"]),
        allActiveLanes: Boolean(flags["all-active-lanes"])
      });
      logger.info(`${result.snapshot.status.toUpperCase()}: ${result.snapshot.summary}`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "clipbaiters-publish": {
      const businessId =
        typeof flags.business === "string" ? flags.business : "clipbaiters-viral-moments";
      const laneId = typeof flags.lane === "string" ? flags.lane : "clipbaiters-political";
      const result = await clipbaitersPublisher.run({
        businessId,
        laneId,
        dryRun: Boolean(flags["dry-run"]),
        allActiveLanes: Boolean(flags["all-active-lanes"])
      });
      logger.info(`${result.snapshot.status.toUpperCase()}: ${result.snapshot.summary}`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "clipbaiters-intake": {
      const businessId =
        typeof flags.business === "string" ? flags.business : "clipbaiters-viral-moments";
      const manifestFile = typeof flags.file === "string" ? path.resolve(flags.file) : undefined;
      const result = await clipbaitersIntake.sync({
        businessId,
        manifestFile
      });
      logger.info(`ClipBaiters creator intake refreshed with ${result.ordersState.orders.length} order(s).`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "clipbaiters-source-creators": {
      const businessId =
        typeof flags.business === "string" ? flags.business : "clipbaiters-viral-moments";
      const result = await clipbaitersDeals.sourceCreators({ businessId });
      logger.info(`ClipBaiters creator leads refreshed with ${result.leadState.leads.length} lead(s).`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "clipbaiters-draft-creator-outreach": {
      const businessId =
        typeof flags.business === "string" ? flags.business : "clipbaiters-viral-moments";
      const result = await clipbaitersDeals.draftCreatorOutreach({ businessId });
      logger.info(`ClipBaiters outreach drafts refreshed with ${result.outreachState.drafts.length} draft(s).`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "clipbaiters-deals-report": {
      const businessId =
        typeof flags.business === "string" ? flags.business : "clipbaiters-viral-moments";
      const result = await clipbaitersDeals.report({ businessId });
      logger.info(result.snapshot.summary);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "clipbaiters-monetization-report": {
      const businessId =
        typeof flags.business === "string" ? flags.business : "clipbaiters-viral-moments";
      const result = await clipbaitersMonetization.run({ businessId });
      logger.info(`${result.snapshot.status.toUpperCase()}: ${result.snapshot.summary}`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "northline-plan": {
      const businessId = typeof flags.business === "string" ? flags.business : "auto-funding-agency";
      const result = await northlineOps.writePlan({ businessId });
      logger.info(`Northline launch system refreshed for ${result.plan.businessName}.`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "northline-promotion-queue": {
      const businessId = typeof flags.business === "string" ? flags.business : "auto-funding-agency";
      const result = await northlineOps.refreshPromotionQueue({ businessId });
      logger.info(`Northline promotion queue refreshed for ${result.businessName}.`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "northline-profile-show": {
      const businessId = typeof flags.business === "string" ? flags.business : "auto-funding-agency";
      const result = await northlineProfileAdmin.inspect({
        businessId,
        probePayments: Boolean(flags["probe-payments"])
      });
      logger.info(`Loaded Northline profile for ${result.businessName}.`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "northline-profile-update": {
      const businessId = String(flags.business ?? "");
      const filePath = typeof flags.file === "string" ? flags.file : undefined;
      if (!businessId) {
        throw new Error("Missing --business for northline-profile-update command.");
      }
      if (!filePath) {
        throw new Error("Missing --file for northline-profile-update command.");
      }
      const result = await northlineProfileAdmin.updateFromFile({
        businessId,
        filePath: path.resolve(filePath),
        replace: Boolean(flags.replace),
        probePayments: !Boolean(flags["skip-payment-probe"])
      });
      logger.info(`Updated Northline profile for ${result.businessName}.`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "northline-payment-check": {
      const businessId = typeof flags.business === "string" ? flags.business : "auto-funding-agency";
      const result = await northlineProfileAdmin.checkPayments({
        businessId,
        probeLinks: !Boolean(flags["skip-probe"])
      });
      logger.info(`${result.status.toUpperCase()}: ${result.summary}`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "northline-department-smoke": {
      const businessId = typeof flags.business === "string" ? flags.business : "auto-funding-agency";
      await imonEngine.sync();
      const result = await northlineDepartmentSmoke.run({
        businessId,
        routeDrills: !Boolean(flags["skip-route-drills"])
      });
      logger.info(`${result.status.toUpperCase()}: ${result.summary}`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "northline-collect-prospects": {
      const businessId = typeof flags.business === "string" ? flags.business : "auto-funding-agency";
      const result = await northlineProspectCollector.run({
        businessId,
        force: Boolean(flags.force)
      });
      logger.info(`${result.status.toUpperCase()}: ${result.summary}`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "northline-autonomy-run": {
      const businessId = typeof flags.business === "string" ? flags.business : "auto-funding-agency";
      const result = await northlineAutonomy.run({
        businessId,
        notifyRoadblocks: Boolean(flags["notify-roadblocks"])
      });
      logger.info(`${result.status.toUpperCase()}: ${result.summary}`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "northline-inbox-sync": {
      const businessId = typeof flags.business === "string" ? flags.business : "auto-funding-agency";
      const result = await northlineAutonomy.syncInbox({ businessId });
      logger.info(`${result.status.toUpperCase()}: ${result.summary}`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "northline-billing-handoff": {
      const clientId = String(flags.client ?? "");
      const status = String(flags.status ?? "paid");
      if (!clientId) {
        throw new Error("Missing --client for northline-billing-handoff command.");
      }
      if (status !== "paid" && status !== "retainer_active") {
        throw new Error("Northline billing handoff status must be paid or retainer_active.");
      }
      const result = await northlineAutonomy.applyBillingHandoff({
        clientId,
        status,
        formEndpoint:
          typeof flags["form-endpoint"] === "string" ? flags["form-endpoint"] : undefined,
        nextAction:
          typeof flags["next-action"] === "string" ? flags["next-action"] : undefined
      });
      logger.info(`Billing handoff recorded for ${result.client.clientName}.`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "northline-validation-run": {
      const businessId = typeof flags.business === "string" ? flags.business : "auto-funding-agency";
      const submissionId = typeof flags.submission === "string" ? flags.submission : undefined;
      const status =
        typeof flags.status === "string" && (flags.status === "paid" || flags.status === "retainer_active")
          ? flags.status
          : undefined;
      const result = await northlineValidation.run({
        businessId,
        submissionId,
        status,
        formEndpoint:
          typeof flags["form-endpoint"] === "string" ? flags["form-endpoint"] : undefined
      });
      logger.info(`${result.status.toUpperCase()}: ${result.summary}`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "northline-site-serve": {
      const defaultNorthlineProfile = await resolveDefaultNorthlineProfile(store, config);
      await buildAgencySite(
        config,
        defaultNorthlineProfile.agencyProfile,
        agencySiteOverridesFromNorthlineProfile(defaultNorthlineProfile)
      );
      const address = await northlineSiteServer.listen();
      logger.info(`Northline site listening on http://${address.host}:${address.port}.`);
      process.once("SIGINT", () => {
        void northlineSiteServer.close();
      });
      process.once("SIGTERM", () => {
        void northlineSiteServer.close();
      });
      await new Promise(() => {});
      break;
    }
    case "northline-site-health": {
      console.log(JSON.stringify(await northlineSiteServer.getHealth(), null, 2));
      break;
    }
    case "micro-saas-plan": {
      const businessId = typeof flags.business === "string" ? flags.business : "imon-micro-saas-factory";
      const result = await microSaasStudio.writePlan({
        businessId,
        notifyRoadblocks: Boolean(flags["notify-roadblocks"])
      });
      logger.info(`Micro-SaaS launch plan refreshed for ${result.plan.businessName}.`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "pod-plan": {
      const businessId = typeof flags.business === "string" ? flags.business : "imon-pod-store";
      const referenceDirectory = typeof flags["reference-dir"] === "string" ? flags["reference-dir"] : undefined;
      const result = await podStudio.writePlan({
        businessId,
        referenceDirectory,
        notifyRoadblocks: Boolean(flags["notify-roadblocks"])
      });
      logger.info(`POD launch plan refreshed for ${result.plan.businessName}.`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "pod-autonomy": {
      const businessId = typeof flags.business === "string" ? flags.business : "imon-pod-store";
      const referenceDirectory = typeof flags["reference-dir"] === "string" ? flags["reference-dir"] : undefined;
      const result = await podAutonomy.writeOperatingSystem({
        businessId,
        referenceDirectory,
        notifyRoadblocks: Boolean(flags["notify-roadblocks"])
      });
      logger.info(`Imonic autonomy system refreshed for ${result.plan.businessName}.`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "report": {
      const reports = await store.getReports();
      console.log(JSON.stringify(reports.at(-1) ?? null, null, 2));
      break;
    }
    case "build-agency-site": {
      const defaultNorthlineProfile = await resolveDefaultNorthlineProfile(store, config);
      const output = await buildAgencySite(
        config,
        defaultNorthlineProfile.agencyProfile,
        agencySiteOverridesFromNorthlineProfile(defaultNorthlineProfile)
      );
      logger.info(`Agency site generated at ${output}`);
      break;
    }
    default: {
      console.log(usage());
      break;
    }
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  });
}
