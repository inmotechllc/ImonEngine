import path from "node:path";
import { DEFAULT_AGENCY_PROFILE, DEFAULT_OFFERS } from "./domain/defaults.js";
import type { ClientJob, LeadRecord, OfferConfig } from "./domain/contracts.js";
import { loadConfig } from "./config.js";
import { Logger } from "./lib/logger.js";
import { readJsonFile, readTextFile } from "./lib/fs.js";
import { slugify } from "./lib/text.js";
import { AIClient } from "./openai/client.js";
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
import { StoreOpsService } from "./services/store-ops.js";

interface Flags {
  [key: string]: string | boolean | undefined;
}

interface ClientBrief {
  id?: string;
  businessId?: string;
  leadId?: string;
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
    "  npm run dev -- build-site --client sunrise-plumbing",
    "  npm run dev -- qa --client sunrise-plumbing",
    "  npm run dev -- deploy --client sunrise-plumbing",
    "  npm run dev -- retain --client sunrise-plumbing",
    "  npm run dev -- businesses",
    "  npm run dev -- engine-sync",
    "  npm run dev -- engine-report",
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
    "  npm run dev -- import-gumroad-sales --file <csv>",
    "  npm run dev -- import-relay-transactions --file <csv> [--business imon-digital-asset-store]",
    "  npm run dev -- revenue-report [--business imon-digital-asset-store] [--days 30]",
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
    storeOps
  };
}

async function createClientFromBrief(store: FileStore, briefPath: string): Promise<ClientJob> {
  const brief = await readJsonFile<ClientBrief>(path.resolve(briefPath), {} as ClientBrief);
  const now = new Date().toISOString();
  const client: ClientJob = {
    id: brief.id ?? slugify(brief.clientName),
    businessId: brief.businessId ?? "auto-funding-agency",
    leadId: brief.leadId,
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
    intakeNotes: brief.intakeNotes ?? [],
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
  const lead = await store.getLead(leadId);
  if (!lead) {
    throw new Error(`Lead ${leadId} not found.`);
  }

  const message = await readTextFile(path.resolve(messageFile));
  const result = await replyHandler.classify(message);
  const updated: LeadRecord = {
    ...lead,
    stage: result.recommendedStage,
    lastTouchAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await store.saveLead(updated);
  logger.info(`${lead.businessName}: ${result.disposition} -> ${result.nextAction}`);
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
    storeOps
  } =
    await buildContext();

  switch (command) {
    case "bootstrap": {
      await imonEngine.bootstrap();
      await orchestrator.getAccountOps().ensureOperationalApprovals();
      await buildAgencySite(config, DEFAULT_AGENCY_PROFILE);
      await orchestrator.getReports().generateRunReport(["Bootstrap completed.", "ImonEngine portfolio seeded."]);
      await imonEngine.writeVpsArtifacts();
      logger.info(
        "Seeded offers, bootstrapped ImonEngine, generated approval tasks, built the agency site, and wrote initial reports."
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
      const client = await createClientFromBrief(store, brief);
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
      logger.info(`Retention report created with upsell: ${report.upsellCandidate}`);
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
      logger.info(`Wrote VPS artifacts to ${artifacts.manifestPath}`);
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
    case "report": {
      const reports = await store.getReports();
      console.log(JSON.stringify(reports.at(-1) ?? null, null, 2));
      break;
    }
    case "build-agency-site": {
      const output = await buildAgencySite(config, DEFAULT_AGENCY_PROFILE);
      logger.info(`Agency site generated at ${output}`);
      break;
    }
    default: {
      console.log(usage());
      break;
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(message);
  process.exitCode = 1;
});
