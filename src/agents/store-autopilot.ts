import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { AppConfig } from "../config.js";
import type { AssetPackRecord, AssetPackStatus, DigitalAssetType } from "../domain/digital-assets.js";
import { exists, readJsonFile, readTextFile, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { StoreOpsService } from "../services/store-ops.js";
import { FileStore } from "../storage/store.js";
import { DigitalAssetFactoryAgent } from "./digital-asset-factory.js";
import { ImonEngineAgent } from "./imon-engine.js";

const execFileAsync = promisify(execFile);
const PYTHON_COMMAND = process.platform === "win32" ? "python" : "python3";
const READY_OR_PUBLISHED_STATUSES: AssetPackStatus[] = ["ready_for_upload", "published"];
const PHASE_ONE_TARGET_PACK_COUNT = 5;

const BUILDERS: Partial<Record<DigitalAssetType, string>> = {
  wallpaper_pack: "build_wallpaper_pack.py",
  social_template_pack: "build_social_template_pack.py",
  icon_pack: "build_icon_pack.py",
  texture_pack: "build_texture_pack.py"
};

const CONTINUOUS_BRIEFS: Array<{
  niche: string;
  assetType: DigitalAssetType;
  style: string;
  audience: string;
  packSize: number;
}> = [
  {
    niche: "Charcoal developer desktop backgrounds",
    assetType: "wallpaper_pack",
    style: "charcoal gradients with low-contrast geometry",
    audience: "developers and product teams",
    packSize: 16
  },
  {
    niche: "Stone paper textures for pitch decks",
    assetType: "texture_pack",
    style: "stone fibers and quiet grain overlays",
    audience: "consultants and pitch-deck designers",
    packSize: 24
  },
  {
    niche: "Blue haze desktop backgrounds for operators",
    assetType: "wallpaper_pack",
    style: "cool blue gradients with soft diffused shadows",
    audience: "operators and remote teams",
    packSize: 16
  },
  {
    niche: "Cream poster grain textures for creators",
    assetType: "texture_pack",
    style: "cream poster fibers and matte analog grain",
    audience: "content creators and brand designers",
    packSize: 24
  }
];

type AutopilotPhaseStatus = "pending" | "in_progress" | "completed";

interface AutopilotPhase {
  id: string;
  title: string;
  status: AutopilotPhaseStatus;
  goal: string;
}

interface BrowserSessionState {
  required: boolean;
  note: string;
}

interface AutopilotState {
  program: string;
  status: string;
  currentPhase: string;
  browserSession?: BrowserSessionState;
  phases: AutopilotPhase[];
  notes: string[];
}

interface JsonResult {
  [key: string]: unknown;
}

export interface AutopilotPublishResult {
  packId: string;
  title: string;
  productUrl: string;
  editUrl?: string;
  productId?: string;
  mediaChanged?: boolean;
  mediaAttempts?: number;
  contentChanged?: boolean;
  uploadAttempts?: number;
}

export interface AutopilotRunResult {
  phaseId: string;
  status: "progress" | "completed" | "blocked" | "idle";
  summary: string;
  details: string[];
  changed: boolean;
  phaseAdvanced?: boolean;
}

export class StoreAutopilotAgent {
  private readonly storeOps: StoreOpsService;
  private readonly docsDir: string;
  private readonly autopilotDir: string;
  private readonly statePath: string;
  private readonly logPath: string;
  private readonly runReportPath: string;
  private readonly gumroadStoreDocPath: string;
  private readonly localEnvExamplePath: string;

  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore,
    private readonly digitalAssetFactory: DigitalAssetFactoryAgent,
    private readonly imonEngine: ImonEngineAgent
  ) {
    this.storeOps = new StoreOpsService(config, store);
    this.docsDir = path.join(this.config.projectRoot, "docs");
    this.autopilotDir = path.join(this.docsDir, "autopilot");
    this.statePath = path.join(this.autopilotDir, "state.json");
    this.logPath = path.join(this.autopilotDir, "log.md");
    this.runReportPath = path.join(this.config.opsDir, "autopilot-last-run.json");
    this.gumroadStoreDocPath = path.join(this.docsDir, "gumroad-store.md");
    this.localEnvExamplePath = path.join(this.config.projectRoot, ".env.example");
  }

  async runOnce(): Promise<AutopilotRunResult> {
    const state = await this.readState();
    if (state.status === "completed") {
      const result: AutopilotRunResult = {
        phaseId: state.currentPhase,
        status: "idle",
        summary: "The repo-controlled autopilot has already completed its roadmap.",
        details: ["No further scheduled work is required."],
        changed: false
      };
      await this.writeRunReport(result);
      return result;
    }

    let result: AutopilotRunResult;
    switch (state.currentPhase) {
      case "phase-01-product-factory-expansion":
        result = await this.runPhaseOne(state);
        break;
      case "phase-02-store-conversion-automation":
        result = await this.runPhaseTwo(state);
        break;
      case "phase-03-growth-automation":
        result = await this.runPhaseThree(state);
        break;
      case "phase-04-autonomous-operations-hardening":
        result = await this.runPhaseFour(state);
        break;
      case "phase-05-final-review-and-notification":
        result = await this.runPhaseFive(state);
        break;
      case "phase-06-continuous-store-operations":
        result = await this.runPhaseSix(state);
        break;
      default:
        result = {
          phaseId: state.currentPhase,
          status: "blocked",
          summary: `No repo-native handler is implemented for ${state.currentPhase}.`,
          details: ["Update docs/autopilot/state.json or extend src/agents/store-autopilot.ts."],
          changed: false
        };
        break;
    }

    if (result.changed) {
      await this.imonEngine.sync();
      await this.imonEngine.writeVpsArtifacts();
    }

    if (result.changed || result.status !== "idle") {
      await this.appendLog(result);
    }
    await this.writeRunReport(result);
    return result;
  }

  private async runPhaseOne(state: AutopilotState): Promise<AutopilotRunResult> {
    const packs = await this.store.getAssetPacks();

    if (packs.length < PHASE_ONE_TARGET_PACK_COUNT) {
      const seeded = await this.digitalAssetFactory.seedStarterQueue();
      if (seeded.length > 0) {
        return {
          phaseId: state.currentPhase,
          status: "progress",
          summary: `Seeded ${seeded.length} additional Phase 1 pack briefs.`,
          details: seeded.map((pack) => `Created ${pack.id} (${pack.assetType}) at ${pack.outputDir}`),
          changed: true
        };
      }
    }

    const refreshedPacks = await this.store.getAssetPacks();
    if (this.phaseOneComplete(refreshedPacks)) {
      await this.advancePhase(state, state.currentPhase);
      return {
        phaseId: "phase-01-product-factory-expansion",
        status: "completed",
        summary: "Phase 1 is complete. Two products are live and three more packs are ready for upload.",
        details: refreshedPacks
          .filter((pack) => READY_OR_PUBLISHED_STATUSES.includes(pack.status))
          .map((pack) => `${pack.title}: ${pack.status}${pack.productUrl ? ` (${pack.productUrl})` : ""}`),
        changed: true,
        phaseAdvanced: true
      };
    }

    const producing = refreshedPacks.find((pack) => pack.status === "producing");
    if (producing) {
      const buildOutput = await this.buildPack(producing);
      return {
        phaseId: state.currentPhase,
        status: "progress",
        summary: `Built ${producing.title} and marked it ready for upload.`,
        details: [`Builder: ${path.basename(buildOutput.builderPath)}`, ...buildOutput.details],
        changed: true
      };
    }

    const planned = refreshedPacks.find((pack) => pack.status === "planned");
    if (planned) {
      const staged = await this.digitalAssetFactory.stagePack(planned.id);
      return {
        phaseId: state.currentPhase,
        status: "progress",
        summary: `Staged ${staged.title} for production.`,
        details: [`Pack id: ${staged.id}`, `Asset type: ${staged.assetType}`, `Output dir: ${staged.outputDir}`],
        changed: true
      };
    }

    const ready = refreshedPacks.filter((pack) => pack.status === "ready_for_upload");
    if (ready.length > 0) {
      return {
        phaseId: state.currentPhase,
        status: "idle",
        summary: `${ready.length} pack(s) are ready for Gumroad upload and waiting on a publish workflow.`,
        details: ready.map((pack) => `${pack.title} -> ${path.join(pack.outputDir, "gumroad")}`),
        changed: false
      };
    }

    return {
      phaseId: state.currentPhase,
      status: "blocked",
      summary: "Phase 1 could not find a safe next work unit.",
      details: [
        "No planned or producing packs were available.",
        "Check runtime/state/assetPacks.json for inconsistent statuses."
      ],
      changed: false
    };
  }

  private async runPhaseTwo(state: AutopilotState): Promise<AutopilotRunResult> {
    const packs = await this.store.getAssetPacks();
    const planPath = path.join(this.autopilotDir, "store-conversion-plan.md");
    const experimentPath = path.join(this.autopilotDir, "conversion-experiments.json");
    const changedFiles: string[] = [];

    if (await this.writeIfChanged(planPath, this.composeStoreConversionPlan(packs))) {
      changedFiles.push(planPath);
    }
    if (await this.writeJsonIfChanged(experimentPath, this.composeConversionExperiments(packs))) {
      changedFiles.push(experimentPath);
    }
    if (await this.writeIfChanged(this.gumroadStoreDocPath, this.composeGumroadStoreDoc(packs))) {
      changedFiles.push(this.gumroadStoreDocPath);
    }

    if (changedFiles.length > 0) {
      return {
        phaseId: state.currentPhase,
        status: "progress",
        summary: "Wrote the store conversion playbook, experiment matrix, and refreshed store documentation.",
        details: changedFiles.map((filePath) => `Updated ${filePath}`),
        changed: true
      };
    }

    await this.advancePhase(state, state.currentPhase);
    return {
      phaseId: "phase-02-store-conversion-automation",
      status: "completed",
      summary: "Phase 2 is complete. Conversion guidance and price-test planning are now durable repo assets.",
      details: [`Plan: ${planPath}`, `Experiment matrix: ${experimentPath}`, `Store doc: ${this.gumroadStoreDocPath}`],
      changed: true,
      phaseAdvanced: true
    };
  }

  private async runPhaseThree(state: AutopilotState): Promise<AutopilotRunResult> {
    const packs = await this.store.getAssetPacks();
    const growthDocPath = path.join(this.autopilotDir, "growth-workflows.md");
    const channelPath = path.join(this.autopilotDir, "free-channel-matrix.md");
    const marketingDir = path.join(this.config.outputDir, "marketing");
    const marketingManifestPath = path.join(marketingDir, "manifest.json");
    const changedFiles: string[] = [];

    if (await this.writeIfChanged(growthDocPath, this.composeGrowthWorkflows(packs))) {
      changedFiles.push(growthDocPath);
    }
    if (await this.writeIfChanged(channelPath, this.composeFreeChannelMatrix(packs))) {
      changedFiles.push(channelPath);
    }
    if (!(await exists(marketingManifestPath))) {
      const result = await this.runPythonScript("build_growth_assets.py", [
        "--state-file",
        path.join(this.config.stateDir, "assetPacks.json"),
        "--output-dir",
        marketingDir
      ]);
      changedFiles.push(`Generated marketing assets (${String(result.outputDir ?? marketingDir)})`);
    }

    if (changedFiles.length > 0) {
      return {
        phaseId: state.currentPhase,
        status: "progress",
        summary: "Generated repeatable growth workflows and repurposed promo assets for the store catalog.",
        details: changedFiles,
        changed: true
      };
    }

    await this.advancePhase(state, state.currentPhase);
    return {
      phaseId: "phase-03-growth-automation",
      status: "completed",
      summary: "Phase 3 is complete. Growth assets and free-channel workflows are in place.",
      details: [growthDocPath, channelPath, marketingManifestPath],
      changed: true,
      phaseAdvanced: true
    };
  }

  private async runPhaseFour(state: AutopilotState): Promise<AutopilotRunResult> {
    const runbookPath = path.join(this.autopilotDir, "operations-runbook.md");
    const schedulerDocPath = path.join(this.autopilotDir, "scheduler-notes.md");
    const changedFiles: string[] = [];

    if (await this.writeIfChanged(runbookPath, this.composeOperationsRunbook())) {
      changedFiles.push(runbookPath);
    }
    if (await this.writeIfChanged(schedulerDocPath, this.composeSchedulerNotes())) {
      changedFiles.push(schedulerDocPath);
    }
    if (await this.writeIfChanged(this.localEnvExamplePath, this.composeEnvExample())) {
      changedFiles.push(this.localEnvExamplePath);
    }

    if (changedFiles.length > 0) {
      return {
        phaseId: state.currentPhase,
        status: "progress",
        summary: "Documented the hardened operating model for local scheduling, VPS sync, and browser-dependent work.",
        details: changedFiles,
        changed: true
      };
    }

    await this.advancePhase(state, state.currentPhase);
    return {
      phaseId: "phase-04-autonomous-operations-hardening",
      status: "completed",
      summary: "Phase 4 is complete. Scheduler, sync, and operational handoff guidance are durable and synced.",
      details: [runbookPath, schedulerDocPath, this.localEnvExamplePath],
      changed: true,
      phaseAdvanced: true
    };
  }

  private async runPhaseFive(state: AutopilotState): Promise<AutopilotRunResult> {
    const packs = await this.store.getAssetPacks();
    const finalReviewPath = path.join(this.autopilotDir, "final-review.md");
    const finalEmailPath = path.join(this.autopilotDir, "final-email.md");
    const changedFiles: string[] = [];

    if (await this.writeIfChanged(finalReviewPath, this.composeFinalReview(packs, state))) {
      changedFiles.push(finalReviewPath);
    }
    if (await this.writeIfChanged(finalEmailPath, this.composeFinalEmail(packs))) {
      changedFiles.push(finalEmailPath);
    }

    if (changedFiles.length > 0) {
      return {
        phaseId: state.currentPhase,
        status: "progress",
        summary: "Prepared the final review package and completion email draft.",
        details: changedFiles,
        changed: true
      };
    }

    try {
      await this.runPythonScript("send_gmail_message.py", [
        "--to",
        "joshuabigaud@gmail.com",
        "--subject",
        "ImonEngine store autopilot complete",
        "--body-file",
        finalEmailPath
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        phaseId: state.currentPhase,
        status: "blocked",
        summary: "The final completion email could not be sent automatically.",
        details: ["Keep the signed-in Gmail browser session open and rerun this phase.", message],
        changed: false
      };
    }

    await this.advancePhase(state, state.currentPhase);
    return {
      phaseId: "phase-05-final-review-and-notification",
      status: "completed",
      summary: "Phase 5 is complete. The final review is written, the owner notification email was sent, and continuous store ops are active.",
      details: [finalReviewPath, finalEmailPath, "Sent Gmail notification to joshuabigaud@gmail.com"],
      changed: true,
      phaseAdvanced: true
    };
  }

  private async runPhaseSix(state: AutopilotState): Promise<AutopilotRunResult> {
    const packs = await this.store.getAssetPacks();
    const ready = packs.find((pack) => pack.status === "ready_for_upload");
    if (ready) {
      try {
        const published = await this.autopublishReadyPack(ready.id);
        const refreshedPacks = await this.store.getAssetPacks();
        await this.refreshStoreOpsArtifacts(refreshedPacks, true);
        return {
          phaseId: state.currentPhase,
          status: "progress",
          summary: `Published ${published.title} in continuous store-ops mode.`,
          details: [
            `Pack id: ${published.packId}`,
            `Product URL: ${published.productUrl}`,
            ...(published.editUrl ? [`Edit URL: ${published.editUrl}`] : []),
            ...(published.productId ? [`Product id: ${published.productId}`] : [])
          ],
          changed: true
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const fallback = await this.runContinuousQueueWork(packs, [
          `Auto-publish skipped for ${ready.title}: ${message}`
        ]);
        if (fallback) {
          return fallback;
        }

        return {
          phaseId: state.currentPhase,
          status: "blocked",
          summary: `${ready.title} is ready for upload, but the Gumroad publish workflow could not complete in this run.`,
          details: [message],
          changed: false
        };
      }
    }

    const opsRefresh = await this.refreshStoreOpsArtifacts(packs);
    if (opsRefresh) {
      return opsRefresh;
    }

    const growthExecution = await this.executeDueGrowthItem(packs);
    if (growthExecution) {
      return growthExecution;
    }

    const fallback = await this.runContinuousQueueWork(packs);
    if (fallback) {
      return fallback;
    }

    return {
      phaseId: state.currentPhase,
      status: "idle",
      summary: "Continuous store operations are caught up. No new brief was needed in this run.",
      details: [
        "Published and ready-for-upload packs remain documented.",
        "The next run will continue if a new brief is seeded or a staged pack appears."
      ],
      changed: false
    };
  }

  async autopublishReadyPack(packId?: string): Promise<AutopilotPublishResult> {
    const packs = await this.store.getAssetPacks();
    const pack =
      (packId ? packs.find((candidate) => candidate.id === packId) : undefined) ??
      packs.find((candidate) => candidate.status === "ready_for_upload");

    if (!pack) {
      throw new Error("No ready-for-upload asset pack is available to publish.");
    }

    const publishResult = await this.runPythonScript("publish_gumroad_product.py", ["--pack-dir", pack.outputDir]);
    const productUrl = String(publishResult.productUrl ?? "");
    if (!productUrl) {
      throw new Error("The Gumroad publish script did not return a product URL.");
    }

    const published = await this.digitalAssetFactory.publishPack(pack.id, productUrl);
    await this.refreshLiveCatalogDocs();

    return {
      packId: published.id,
      title: published.title,
      productUrl,
      editUrl: typeof publishResult.editUrl === "string" ? publishResult.editUrl : undefined,
      productId: typeof publishResult.productId === "string" ? publishResult.productId : undefined,
      mediaChanged: Boolean(publishResult.mediaChanged),
      mediaAttempts: typeof publishResult.mediaAttempts === "number" ? publishResult.mediaAttempts : undefined,
      contentChanged: Boolean(publishResult.contentChanged),
      uploadAttempts:
        typeof publishResult.uploadAttempts === "number" ? publishResult.uploadAttempts : undefined
    };
  }

  async repairPublishedPackMedia(packId?: string): Promise<AutopilotPublishResult> {
    const packs = await this.store.getAssetPacks();
    const pack =
      (packId ? packs.find((candidate) => candidate.id === packId) : undefined) ??
      packs.find((candidate) => candidate.status === "published" && candidate.productUrl);

    if (!pack) {
      throw new Error("No published asset pack with a product URL is available to repair.");
    }
    if (!pack.productUrl) {
      throw new Error(`Asset pack ${pack.id} does not have a Gumroad product URL yet.`);
    }

    const match = pack.productUrl.match(/\/l\/([^/?#]+)/);
    const productId = match?.[1];
    if (!productId) {
      throw new Error(`Could not determine a Gumroad product id from ${pack.productUrl}.`);
    }

    const repairResult = await this.runPythonScript("publish_gumroad_product.py", [
      "--pack-dir",
      pack.outputDir,
      "--product-id",
      productId,
      "--media-only"
    ]);

    return {
      packId: pack.id,
      title: pack.title,
      productUrl: String(repairResult.productUrl ?? pack.productUrl),
      editUrl: typeof repairResult.editUrl === "string" ? repairResult.editUrl : undefined,
      productId: typeof repairResult.productId === "string" ? repairResult.productId : productId,
      mediaChanged: Boolean(repairResult.mediaChanged),
      mediaAttempts: typeof repairResult.mediaAttempts === "number" ? repairResult.mediaAttempts : undefined,
      contentChanged: Boolean(repairResult.contentChanged),
      uploadAttempts:
        typeof repairResult.uploadAttempts === "number" ? repairResult.uploadAttempts : undefined
    };
  }

  async repairPublishedPackContent(packId?: string): Promise<AutopilotPublishResult> {
    const packs = await this.store.getAssetPacks();
    const pack =
      (packId ? packs.find((candidate) => candidate.id === packId) : undefined) ??
      packs.find((candidate) => candidate.status === "published" && candidate.productUrl);

    if (!pack) {
      throw new Error("No published asset pack with a product URL is available to repair.");
    }
    if (!pack.productUrl) {
      throw new Error(`Asset pack ${pack.id} does not have a Gumroad product URL yet.`);
    }

    const match = pack.productUrl.match(/\/l\/([^/?#]+)/);
    const productId = match?.[1];
    if (!productId) {
      throw new Error(`Could not determine a Gumroad product id from ${pack.productUrl}.`);
    }

    const repairResult = await this.runPythonScript("publish_gumroad_product.py", [
      "--pack-dir",
      pack.outputDir,
      "--product-id",
      productId,
      "--content-only"
    ]);

    return {
      packId: pack.id,
      title: pack.title,
      productUrl: String(repairResult.productUrl ?? pack.productUrl),
      editUrl: typeof repairResult.editUrl === "string" ? repairResult.editUrl : undefined,
      productId: typeof repairResult.productId === "string" ? repairResult.productId : productId,
      contentChanged: Boolean(repairResult.contentChanged),
      uploadAttempts:
        typeof repairResult.uploadAttempts === "number" ? repairResult.uploadAttempts : undefined
    };
  }

  private async runContinuousQueueWork(
    packs: AssetPackRecord[],
    leadingDetails: string[] = []
  ): Promise<AutopilotRunResult | null> {
    const producing = packs.find((pack) => pack.status === "producing");
    if (producing) {
      const buildOutput = await this.buildPack(producing);
      return {
        phaseId: "phase-06-continuous-store-operations",
        status: "progress",
        summary: `Built ${producing.title} in continuous store-ops mode.`,
        details: [...leadingDetails, `Builder: ${path.basename(buildOutput.builderPath)}`, ...buildOutput.details],
        changed: true
      };
    }

    const planned = packs.find((pack) => pack.status === "planned");
    if (planned) {
      const staged = await this.digitalAssetFactory.stagePack(planned.id);
      return {
        phaseId: "phase-06-continuous-store-operations",
        status: "progress",
        summary: `Staged ${staged.title} in continuous store-ops mode.`,
        details: [...leadingDetails, `Pack id: ${staged.id}`, `Asset type: ${staged.assetType}`, `Output dir: ${staged.outputDir}`],
        changed: true
      };
    }

    const catalogState = await this.storeOps.getCatalogControlState(packs);
    if (!catalogState.canSeedMore) {
      return {
        phaseId: "phase-06-continuous-store-operations",
        status: "idle",
        summary: "Catalog expansion is paused while the store catches up on growth and pacing constraints.",
        details: [...leadingDetails, ...catalogState.reasons],
        changed: false
      };
    }

    const nextBrief = this.getNextContinuousBrief(packs, catalogState.policy);
    if (nextBrief) {
      const created = await this.digitalAssetFactory.createPack({
        ...nextBrief,
        marketplace: "gumroad"
      });
      return {
        phaseId: "phase-06-continuous-store-operations",
        status: "progress",
        summary: `Seeded a new continuous pack brief: ${created.title}.`,
        details: [...leadingDetails, `Created ${created.id}`, `Asset type: ${created.assetType}`, `Output dir: ${created.outputDir}`],
        changed: true
      };
    }

    return null;
  }

  async publishGrowthPost(itemId: string): Promise<AutopilotRunResult> {
    const packs = await this.store.getAssetPacks();
    const result = await this.executeDueGrowthItem(packs, itemId);
    if (!result) {
      throw new Error(`Growth queue item ${itemId} was not found or is not eligible to publish.`);
    }
    return result;
  }

  private async executeDueGrowthItem(
    packs: AssetPackRecord[],
    itemId?: string
  ): Promise<AutopilotRunResult | null> {
    const queue = await this.store.getGrowthQueue();
    const now = new Date().toISOString();
    const due = [...queue]
      .filter((item) => item.status === "planned" && (itemId ? item.id === itemId : item.scheduledFor <= now))
      .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor))[0];

    if (!due) {
      return null;
    }

    try {
      const result = await this.runPythonScript("publish_growth_post.py", [
        "--queue-file",
        path.join(this.config.stateDir, "growthQueue.json"),
        "--social-profiles-file",
        path.join(this.config.stateDir, "socialProfiles.json"),
        "--item-id",
        due.id
      ]);

      const postedAt =
        typeof result.postedAt === "string" && result.postedAt.length > 0 ? result.postedAt : new Date().toISOString();
      await this.store.saveGrowthWorkItem({
        ...due,
        status: "posted",
        updatedAt: postedAt,
        notes: [
          ...due.notes,
          `Posted automatically on ${postedAt} via ${due.channel}.`,
          ...(typeof result.pageUrl === "string" && result.pageUrl.length > 0
            ? [`Automation page URL: ${result.pageUrl}`]
            : [])
        ]
      });

      const refreshedQueue = await this.store.getGrowthQueue();
      const artifacts = await this.storeOps.writeGrowthArtifacts(packs, refreshedQueue);

      return {
        phaseId: "phase-06-continuous-store-operations",
        status: "progress",
        summary: `Posted ${due.title} through the live ${due.channel} automation path.`,
        details: [
          `Growth item: ${due.id}`,
          `Scheduled for: ${due.scheduledFor}`,
          ...(typeof result.pageUrl === "string" && result.pageUrl.length > 0
            ? [`Automation page URL: ${result.pageUrl}`]
            : []),
          `Queue JSON: ${artifacts.jsonPath}`,
          `Queue Markdown: ${artifacts.markdownPath}`
        ],
        changed: true
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const skipped = /unsupported/i.test(message);
      const updatedAt = new Date().toISOString();
      await this.store.saveGrowthWorkItem({
        ...due,
        status: skipped ? "skipped" : due.status,
        updatedAt,
        notes: [...due.notes, `${skipped ? "Skipped" : "Attempted"} on ${updatedAt}: ${message}`]
      });
      const refreshedQueue = await this.store.getGrowthQueue();
      const artifacts = await this.storeOps.writeGrowthArtifacts(packs, refreshedQueue);

      return {
        phaseId: "phase-06-continuous-store-operations",
        status: skipped ? "progress" : "blocked",
        summary: skipped
          ? `Skipped ${due.title} because ${due.channel} is not a live automated channel yet.`
          : `Could not publish ${due.title} through the ${due.channel} automation path in this run.`,
        details: [message, `Queue JSON: ${artifacts.jsonPath}`, `Queue Markdown: ${artifacts.markdownPath}`],
        changed: true
      };
    }
  }

  private phaseOneComplete(packs: AssetPackRecord[]): boolean {
    const publishedCount = packs.filter((pack) => pack.status === "published").length;
    const builtCount = packs.filter((pack) => READY_OR_PUBLISHED_STATUSES.includes(pack.status)).length;
    return publishedCount >= 2 && builtCount >= PHASE_ONE_TARGET_PACK_COUNT;
  }

  private getNextContinuousBrief(
    packs: AssetPackRecord[],
    policy: Awaited<ReturnType<StoreOpsService["ensureCatalogPolicy"]>>
  ): {
    niche: string;
    assetType: DigitalAssetType;
    style: string;
    audience: string;
    packSize: number;
  } | null {
    const existingNiches = new Set(packs.map((pack) => pack.niche));
    const queued = CONTINUOUS_BRIEFS.find((brief) => !existingNiches.has(brief.niche));
    if (queued) {
      return queued;
    }

    return this.storeOps.nextBriefForCatalog(packs, policy);
  }

  private async refreshStoreOpsArtifacts(
    packs: AssetPackRecord[],
    force = false
  ): Promise<AutopilotRunResult | null> {
    await this.storeOps.ensureCatalogPolicy();
    await this.storeOps.ensureAllocationPolicy();
    const socialProfiles = await this.storeOps.ensureSocialProfiles();
    const socialArtifacts = await this.storeOps.writeSocialArtifacts(socialProfiles);

    const existingQueue = await this.store.getGrowthQueue();
    const publishedPacks = packs.filter((pack) => pack.status === "published" && pack.productUrl);
    const marketingRefresh = await this.refreshMarketingAssetsIfNeeded(publishedPacks, force);
    const plannedQueue = existingQueue.filter((item) => item.status === "planned");
    const knownPackIds = new Set(publishedPacks.map((pack) => pack.id));
    const queueHasUnknownPack = plannedQueue.some((item) => !knownPackIds.has(item.packId));
    const queueTooSmall =
      plannedQueue.length < Math.min(this.config.storeOps.growth.postsPerWeek, publishedPacks.length);
    const queueNeedsRefresh = force || queueHasUnknownPack || queueTooSmall;

    if (queueNeedsRefresh) {
      const before = JSON.stringify(existingQueue, null, 2);
      const nextQueue = await this.storeOps.refreshGrowthQueue(packs);
      const after = JSON.stringify(nextQueue, null, 2);
      const artifacts = await this.storeOps.writeGrowthArtifacts(packs, nextQueue);
      if (before !== after || force || marketingRefresh.refreshed) {
        return {
          phaseId: "phase-06-continuous-store-operations",
          status: "progress",
          summary: "Refreshed the store growth queue, social profile registry, and channel-ready promo assets.",
          details: [
            `Planned queue items: ${nextQueue.filter((item) => item.status === "planned").length}`,
            `Queue JSON: ${artifacts.jsonPath}`,
            `Queue Markdown: ${artifacts.markdownPath}`,
            `Social JSON: ${socialArtifacts.jsonPath}`,
            `Social Markdown: ${socialArtifacts.markdownPath}`,
            ...marketingRefresh.details
          ],
          changed: true
        };
      }
    }

    if (marketingRefresh.refreshed) {
      return {
        phaseId: "phase-06-continuous-store-operations",
        status: "progress",
        summary: "Regenerated growth promo assets and refreshed social profile artifacts.",
        details: [...marketingRefresh.details, `Social JSON: ${socialArtifacts.jsonPath}`, `Social Markdown: ${socialArtifacts.markdownPath}`],
        changed: true
      };
    }

    const transactions = await this.store.getSalesTransactions();
    if (transactions.length > 0) {
      const previousSnapshots = await this.store.getAllocationSnapshots();
      const previousLatestId = previousSnapshots
        .filter((snapshot) => snapshot.businessId === "imon-digital-asset-store")
        .sort((left, right) => left.generatedAt.localeCompare(right.generatedAt))
        .at(-1)?.id;
      const snapshot = await this.storeOps.buildRevenueSnapshot();
      const artifacts = await this.storeOps.writeRevenueArtifacts(snapshot, "Imon Digital Asset Store");
      const collective = await this.storeOps.buildCollectiveFundSnapshot();
      const collectiveArtifacts = await this.storeOps.writeCollectiveArtifacts(collective);
      if (previousLatestId !== snapshot.id || force) {
        return {
          phaseId: "phase-06-continuous-store-operations",
          status: "progress",
          summary: "Updated the brand and collective revenue allocation reports from imported Gumroad and Relay transactions.",
          details: [
            `Revenue JSON: ${artifacts.jsonPath}`,
            `Revenue Markdown: ${artifacts.markdownPath}`,
            `Collective JSON: ${collectiveArtifacts.jsonPath}`,
            `Collective Markdown: ${collectiveArtifacts.markdownPath}`,
            `Net revenue window: $${snapshot.netRevenue.toFixed(2)}`
          ],
          changed: true
        };
      }
    }

    return null;
  }

  private async refreshMarketingAssetsIfNeeded(
    publishedPacks: AssetPackRecord[],
    force: boolean
  ): Promise<{ refreshed: boolean; details: string[] }> {
    if (publishedPacks.length === 0) {
      return { refreshed: false, details: [] };
    }

    const marketingDir = path.join(this.config.outputDir, "marketing");
    const manifestPath = path.join(marketingDir, "manifest.json");
    const manifest = await readJsonFile<Array<{ packId?: string; landscape?: string; square?: string }>>(
      manifestPath,
      []
    );
    const manifestByPackId = new Map(
      manifest
        .filter((entry): entry is { packId: string; landscape?: string; square?: string } => typeof entry.packId === "string")
        .map((entry) => [entry.packId, entry])
    );

    let missingAssets = 0;
    for (const pack of publishedPacks) {
      const entry = manifestByPackId.get(pack.id);
      const hasSquare = typeof entry?.square === "string" && (await exists(entry.square));
      const hasLandscape = typeof entry?.landscape === "string" && (await exists(entry.landscape));
      if (!entry || !hasSquare || !hasLandscape) {
        missingAssets += 1;
      }
    }

    const needsRefresh = force || manifest.length < publishedPacks.length || missingAssets > 0;
    if (!needsRefresh) {
      return { refreshed: false, details: [] };
    }

    const result = await this.runPythonScript("build_growth_assets.py", [
      "--state-file",
      path.join(this.config.stateDir, "assetPacks.json"),
      "--output-dir",
      marketingDir
    ]);

    const assetCount =
      typeof result.assetCount === "number"
        ? result.assetCount
        : Number.parseInt(String(result.assetCount ?? publishedPacks.length), 10);

    return {
      refreshed: true,
      details: [
        `Marketing manifest: ${manifestPath}`,
        `Generated promo asset sets: ${Number.isFinite(assetCount) ? assetCount : publishedPacks.length}`,
        `Published packs in scope: ${publishedPacks.length}`
      ]
    };
  }

  private async buildPack(pack: AssetPackRecord): Promise<{ builderPath: string; details: string[] }> {
    const builderName = BUILDERS[pack.assetType];
    if (!builderName) {
      throw new Error(`No builder script is configured for asset type ${pack.assetType}.`);
    }

    const builderPath = path.join(this.config.projectRoot, "scripts", builderName);
    const { stdout, stderr } = await execFileAsync(PYTHON_COMMAND, [builderPath, "--pack-dir", pack.outputDir], {
      cwd: this.config.projectRoot,
      maxBuffer: 1024 * 1024 * 20
    });

    return { builderPath, details: this.collectStdoutDetails(stdout, stderr, `Builder completed for ${pack.id}.`) };
  }

  private async runPythonScript(scriptName: string, args: string[]): Promise<JsonResult> {
    const scriptPath = path.join(this.config.projectRoot, "scripts", scriptName);
    const { stdout, stderr } = await execFileAsync(PYTHON_COMMAND, [scriptPath, ...args], {
      cwd: this.config.projectRoot,
      maxBuffer: 1024 * 1024 * 20
    });

    const trimmedStdout = stdout.trim();
    const trimmedStderr = stderr.trim();
    if (trimmedStderr) {
      throw new Error(trimmedStderr);
    }
    if (!trimmedStdout) {
      return {};
    }

    try {
      return JSON.parse(trimmedStdout) as JsonResult;
    } catch {
      return { stdout: trimmedStdout };
    }
  }

  private collectStdoutDetails(stdout: string, stderr: string, fallback: string): string[] {
    const trimmedStdout = stdout.trim();
    const trimmedStderr = stderr.trim();

    if (trimmedStdout) {
      try {
        const parsed = JSON.parse(trimmedStdout) as JsonResult;
        return Object.entries(parsed).map(([key, value]) => `${key}: ${String(value)}`);
      } catch {
        return trimmedStdout.split(/\r?\n/);
      }
    }

    if (trimmedStderr) {
      return trimmedStderr.split(/\r?\n/);
    }

    return [fallback];
  }

  private async advancePhase(state: AutopilotState, currentPhaseId: string): Promise<void> {
    const currentIndex = state.phases.findIndex((phase) => phase.id === currentPhaseId);
    if (currentIndex < 0) {
      return;
    }

    state.phases = state.phases.map((phase, index) => {
      if (index < currentIndex) {
        return { ...phase, status: "completed" };
      }
      if (index === currentIndex) {
        return { ...phase, status: "completed" };
      }
      if (index === currentIndex + 1) {
        return { ...phase, status: "in_progress" };
      }
      return phase;
    });

    const nextPhase = state.phases[currentIndex + 1];
    state.currentPhase = nextPhase?.id ?? currentPhaseId;
    state.notes = [
      ...state.notes.filter((note) => !note.includes("repo-controlled autopilot runner")),
      "The repo-controlled autopilot runner now handles scheduled phase work without relying on the Codex desktop automation runner."
    ];
    await this.writeState(state);
  }

  private async completeProgram(state: AutopilotState): Promise<void> {
    state.status = "completed";
    state.phases = state.phases.map((phase) => ({ ...phase, status: "completed" }));
    await this.writeState(state);
  }

  private composeStoreConversionPlan(packs: AssetPackRecord[]): string {
    const live = packs.filter((pack) => pack.status === "published");
    const ready = packs.filter((pack) => pack.status === "ready_for_upload");
    return [
      "# Store Conversion Plan",
      "",
      "## Live Products",
      ...live.map((pack) => `- ${pack.title}: $${pack.suggestedPrice} (${pack.productUrl ?? "pending url"})`),
      "",
      "## Ready Queue",
      ...ready.map((pack) => `- ${pack.title}: upload from ${path.join(pack.outputDir, "gumroad")}`),
      "",
      "## Storefront Actions",
      "- Keep the `Products` section first on the Gumroad storefront.",
      "- Publish the icon pack next because it has the clearest B2B audience and the highest price point.",
      "- After the icon pack, publish the texture pack, then the warm wallpaper pack.",
      "- Use square thumbnails for profile/discovery and wide covers for product pages.",
      "",
      "## Conversion Tactics",
      "- Keep CTA text on Gumroad as `I want this!` until live data justifies a test.",
      "- Leave product ratings visible and keep adult content off for all current packs.",
      "- Use the receipt field to point buyers toward the next most relevant pack once the queue is live.",
      "- Promote bundles only after the fifth product is live so the catalog has enough depth.",
      "",
      "## Price Tests",
      ...packs.map((pack) => `- ${pack.title}: ${pack.priceVariants.map((value) => `$${value}`).join(" / ")}`),
      ""
    ].join("\n");
  }

  private composeConversionExperiments(packs: AssetPackRecord[]): JsonResult[] {
    return packs.map((pack) => ({
      packId: pack.id,
      title: pack.title,
      status: pack.status,
      suggestedPrice: pack.suggestedPrice,
      priceVariants: pack.priceVariants,
      primaryTags: pack.tags.slice(0, 4),
      experiment:
        pack.assetType === "icon_pack"
          ? "Test higher-price creative asset positioning."
          : "Test clean utility-first positioning with short benefit copy."
    }));
  }

  private composeGumroadStoreDoc(packs: AssetPackRecord[]): string {
    const live = packs.filter((pack) => pack.status === "published");
    const ready = packs.filter((pack) => pack.status === "ready_for_upload");

    return [
      "# Gumroad Store",
      "",
      "## Current Store State",
      "",
      "- Store URL: `https://imonengine.gumroad.com`",
      `- Seller email: \`${this.config.marketplaces.gumroadSellerEmail ?? "imonengine@gmail.com"}\``,
      "- Store name: `ImonEngine`",
      "- Profile bio: `Minimal wallpapers, creator templates, and AI-built digital assets for focused work and clean interfaces.`",
      "- Active storefront tab: `Store`",
      "- Active storefront section: `Products`",
      "",
      "## Live Products",
      "",
      ...live.flatMap((pack) => [
        `- Product: \`${pack.title}\``,
        `- Product URL: \`${pack.productUrl ?? "pending"}\``,
        `- Status: \`${pack.status}\``,
        `- Suggested price: \`$${pack.suggestedPrice}\``,
        `- Local pack dir: \`${pack.outputDir}\``,
        ""
      ]),
      "## Ready To Upload",
      "",
      ...ready.flatMap((pack) => [
        `- Product: \`${pack.title}\``,
        `- Status: \`${pack.status}\``,
        `- Upload dir: \`${path.join(pack.outputDir, "gumroad")}\``,
        `- Suggested price: \`$${pack.suggestedPrice}\``,
        ""
      ]),
      "## Repo-Controlled Autopilot",
      "",
      "- Primary local runner: `scripts/run_local_autopilot.ps1`",
      "- Install local schedule: `scripts/install-windows-autopilot.ps1`",
      "- VPS wrapper: `scripts/run_vps_autopilot.sh`",
      "- VPS cron installer: `scripts/install-vps-autopilot.sh`",
      "- Local Gumroad publisher: `scripts/publish_gumroad_product.py`",
      "- Local Facebook growth publisher: `scripts/publish_growth_post.py`",
      "- VPS sync helper: `scripts/sync_vps_repo.py`",
      "",
      "## Browser Recovery",
      "",
      "- Keep the signed-in automation browser open for Gumroad and Gmail access.",
      "- If the Playwright wrapper fails to reattach, recover the session with `python scripts/chrome_cdp.py list-tabs`.",
      "- Publish the next ready pack through the live browser session with `python scripts/publish_gumroad_product.py --pack-dir <pack-dir>`.",
      "- Use `python scripts/send_gmail_message.py --to ... --subject ... --body-file ...` for the final owner notification once Gmail is open.",
      "",
      "## Growth And Revenue Controls",
      "",
      "- Refresh queue + promo assets: `npm run dev -- growth-queue`",
      "- Publish due Facebook or Pinterest posts from the live queue with `python scripts/publish_growth_post.py --queue-file runtime/state/growthQueue.json --social-profiles-file runtime/state/socialProfiles.json --item-id <id>`",
      "- Refresh the social registry: `npm run dev -- social-profiles`",
      "- Import Gumroad CSV sales: `npm run dev -- import-gumroad-sales --file <csv>`",
      "- Import Relay CSV transactions: `npm run dev -- import-relay-transactions --file <csv> [--business imon-digital-asset-store]`",
      "- Build revenue report: `npm run dev -- revenue-report [--business imon-digital-asset-store] [--days 30]`",
      "- Build collective fund report: `npm run dev -- collective-fund-report [--days 30]`",
      "",
      "## Post-Publish Sync Flow",
      "",
      "1. Record the public product URL:",
      "",
      "```bash",
      "npm run dev -- publish-asset-pack --pack <id> --url <gumroad-url>",
      "```",
      "",
      "2. Refresh ImonEngine state:",
      "",
      "```bash",
      "npm run dev -- engine-sync",
      "```",
      "",
      "3. Refresh VPS-facing artifacts when needed:",
      "",
      "```bash",
      "npm run dev -- vps-artifacts",
      "```",
      ""
    ].join("\n");
  }

  private composeGrowthWorkflows(packs: AssetPackRecord[]): string {
    const activeTitles = packs
      .filter((pack) => READY_OR_PUBLISHED_STATUSES.includes(pack.status))
      .map((pack) => pack.title);

    return [
      "# Growth Workflows",
      "",
      "## Repeatable Traffic Workflow",
      "",
      "- Generate promo assets with `python scripts/build_growth_assets.py --state-file runtime/state/assetPacks.json --output-dir runtime/marketing`.",
      "- Use the generated square teasers for the live channel set first: Pinterest pins for texture and wallpaper packs, then Facebook Page posts from the signed-in `Imon` page.",
      "- Publish due Facebook or Pinterest posts with `python scripts/publish_growth_post.py --queue-file runtime/state/growthQueue.json --social-profiles-file runtime/state/socialProfiles.json --item-id <id>`.",
      "- For all future brands, reserve `ImonEngine` for the parent system and create a distinct creative brand name plus `imonengine+<brand>@gmail.com` alias before account signup.",
      "- X signup should use visual input or simulated clicks for the normal flow, then pause for a manual owner solve if Arkose appears.",
      "- Refresh the scheduled post queue with `npm run dev -- growth-queue`.",
      "- Rotate product focus weekly in this order:",
      ...activeTitles.map((title) => `  - ${title}`),
      "",
      "## Repurposing Workflow",
      "",
      "- Pull the first cover image from each pack.",
      "- Generate three teaser formats: landscape, square, and story.",
      "- Reuse `captions.md` as the base copy for Facebook posts, future X/Pinterest posts, and email blurbs.",
      "",
      "## No-Cost Channels",
      "",
      "- Facebook Page posts from the live `Imon` page",
      "- X posts with one featured asset and one CTA link once the X profile moves from blocked to live",
      "- Pinterest pins for wallpaper and texture packs from the live `Imon Digital Assets` board",
      ""
    ].join("\n");
  }

  private composeFreeChannelMatrix(packs: AssetPackRecord[]): string {
    return [
      "# Free Channel Matrix",
      "",
      "| Channel | Asset Type Fit | Workflow |",
      "| --- | --- | --- |",
      ...packs
        .filter((pack) => READY_OR_PUBLISHED_STATUSES.includes(pack.status))
        .map((pack) => {
          const channel = "Facebook Page now, X/Pinterest after signup blockers are cleared";
          return `| ${pack.title} | ${pack.assetType} | ${channel} |`;
        }),
      ""
    ].join("\n");
  }

  private composeOperationsRunbook(): string {
    return [
      "# Operations Runbook",
      "",
      "## Local Scheduler",
      "",
      "- Install with `powershell -ExecutionPolicy Bypass -File scripts/install-windows-autopilot.ps1`.",
      "- The scheduled task runs `scripts/run_local_autopilot.ps1` hourly.",
      "- The local runner executes one work unit, publishes one ready Gumroad pack when the signed-in browser is available, commits tracked changes, pushes to GitHub, and syncs the VPS when `IMON_ENGINE_VPS_PASSWORD` is set.",
      "- Due Facebook and Pinterest growth posts are executed from the local runner before new catalog seeding continues.",
      "- Browser-backed Facebook and Pinterest posting is handled by `scripts/publish_growth_post.py`.",
      "- Reserve `ImonEngine` and `Imon` for the parent system or the legacy first store only; every future business should get its own creative brand name and plus-tag alias.",
      "- X signup should prefer visual-input or simulated-click flows; if Arkose appears, hand the challenge to the owner and then resume automation after it is solved.",
      "- Catalog expansion is capped so the store cannot outrun its growth queue and channel bandwidth.",
      "- `growthQueue.json` is authored by the local scheduler and uploaded to the VPS as-is; the VPS should not regenerate it because the local browser host is the source of truth for posting cadence.",
      "- Revenue imports should flow through `npm run dev -- import-gumroad-sales` and `npm run dev -- import-relay-transactions` before reviewing `npm run dev -- revenue-report`.",
      "- Remaining post-reinvestment funds are modeled as transfers into the collective ImonEngine fund, and the same reinvestment percentage caps shared tool spend there.",
      "- Refresh the collective-fund artifact with `npm run dev -- collective-fund-report`.",
      "",
      "## VPS Scheduler",
      "",
      "- Install with `sudo bash scripts/install-vps-autopilot.sh` inside `/opt/imon-engine`.",
      "- The VPS runner is safe for headless phases and runtime sync work.",
      "- Browser-dependent tasks should stay on the local runner because the signed-in Gumroad and Gmail session lives there.",
      "",
      "## Runtime Rules",
      "",
      "- `runtime/` is local operational state and remains git-ignored.",
      "- Durable instructions belong in `docs/autopilot/` and tracked scripts belong in `scripts/`.",
      "- The authoritative secrets stay on the VPS `.env`; local scheduler-only sync secrets should be injected through local environment variables instead of tracked files.",
      ""
    ].join("\n");
  }

  private composeSchedulerNotes(): string {
    return [
      "# Scheduler Notes",
      "",
      "## Required Environment Variables For Local VPS Sync",
      "",
      "- `IMON_ENGINE_VPS_HOST`",
      "- `IMON_ENGINE_VPS_USER`",
      "- `IMON_ENGINE_VPS_PASSWORD`",
      "- `IMON_ENGINE_VPS_REPO_PATH`",
      "- `IMON_ENGINE_VPS_BRANCH`",
      "- `runtime/state/assetPacks.json`, `growthQueue.json`, `growthPolicies.json`, `allocationPolicies.json`, `allocationSnapshots.json`, `collectiveSnapshots.json`, `salesTransactions.json`, and `socialProfiles.json` are uploaded explicitly after each local run so store-ops state is mirrored to the VPS.",
      "",
      "## Execution Model",
      "",
      "- The local task is the primary scheduler because it can reuse the signed-in browser session when needed.",
      "- The VPS cron job is optional and best for headless build and sync work.",
      "- `scripts/publish_gumroad_product.py` should only run on the local scheduler because it depends on the signed-in Gumroad browser session.",
      "- `scripts/publish_growth_post.py` should only run on the local scheduler because it depends on the signed-in Meta and Pinterest browser session.",
      "- `runtime/state/growthQueue.json` should be uploaded from local and not regenerated on the VPS, so scheduled post ids stay aligned with the browser host.",
      "- `runtime/ops/social-profiles.md` is the current registry of live vs blocked channel accounts.",
      "- `runtime/state/growthQueue.json`, `runtime/ops/revenue-report.json`, and `runtime/ops/collective-fund-report.json` are the current store-ops control surfaces for growth pacing and reinvestment review.",
      "- If the browser is closed, the final-phase Gmail delivery will block until the session is reopened.",
      ""
    ].join("\n");
  }

  private async refreshLiveCatalogDocs(): Promise<void> {
    const packs = await this.store.getAssetPacks();
    await this.writeIfChanged(this.gumroadStoreDocPath, this.composeGumroadStoreDoc(packs));
  }

  private composeEnvExample(): string {
    return [
      "OPENAI_API_KEY=",
      "OPENAI_MODEL_FAST=gpt-4.1-mini",
      "OPENAI_MODEL_DEEP=gpt-5",
      "IMON_ENGINE_NAME=ImonEngine",
      "IMON_ENGINE_TIMEZONE=America/New_York",
      "IMON_ENGINE_HOST_LABEL=OpenClaw VPS",
      "IMON_ENGINE_HOST_PROVIDER=Contabo",
      "IMON_ENGINE_HOST_IP=158.220.99.144",
      "IMON_ENGINE_HOST_PASSWORD=",
      "IMON_ENGINE_MAX_CONCURRENT_BUSINESSES=2",
      "IMON_ENGINE_CPU_TARGET=0.7",
      "IMON_ENGINE_MEMORY_TARGET=0.75",
      "IMON_ENGINE_MIN_DISK_FREE_GB=40",
      "IMON_ENGINE_VPS_HOST=158.220.99.144",
      "IMON_ENGINE_VPS_USER=root",
      "IMON_ENGINE_VPS_PASSWORD=",
      "IMON_ENGINE_VPS_REPO_PATH=/opt/imon-engine",
      "IMON_ENGINE_VPS_BRANCH=main",
      "GUMROAD_SELLER_EMAIL=imonengine@gmail.com",
      "GUMROAD_USERNAME=imonengine",
      "GUMROAD_PROFILE_URL=imonengine.gumroad.com",
      "STORE_MAX_NEW_PACKS_7D=2",
      "STORE_MAX_PUBLISHED_PACKS=36",
      "STORE_MAX_ASSET_TYPE_SHARE=0.4",
      "STORE_MAX_OPEN_PACK_QUEUE=2",
      "STORE_POSTS_PER_WEEK=6",
      "STORE_GROWTH_QUEUE_DAYS=7",
      "STORE_TAX_RESERVE_RATE=0.2",
      "STORE_REINVESTMENT_RATE=0.35",
      "STORE_REFUND_BUFFER_RATE=0.1",
      "STORE_CASHOUT_THRESHOLD=100",
      "APPROVAL_EMAIL=owner@example.com",
      "BUSINESS_NAME=Imon Engine Automation",
      "BUSINESS_PHONE=(914) 714-0656",
      "BUSINESS_SALES_EMAIL=imonengine+sales@gmail.com",
      "BUSINESS_SITE_URL=https://example.com",
      "BUSINESS_DOMAIN=example.com",
      "STRIPE_PAYMENT_LINK_FOUNDING=",
      "STRIPE_PAYMENT_LINK_STANDARD=",
      "SMTP_HOST=",
      "SMTP_PORT=587",
      "SMTP_SECURE=false",
      "SMTP_USER=",
      "SMTP_PASS=",
      "SMTP_FROM=",
      "CLOUDFLARE_ACCOUNT_ID=",
      "CLOUDFLARE_API_TOKEN=",
      "CLOUDFLARE_PAGES_PROJECT=",
      ""
    ].join("\n");
  }

  private composeFinalReview(packs: AssetPackRecord[], state: AutopilotState): string {
    return [
      "# Final Review",
      "",
      `Program status: ${state.status}`,
      `Current phase: ${state.currentPhase}`,
      "",
      "## Catalog Summary",
      ...packs.map((pack) => `- ${pack.title}: ${pack.status}${pack.productUrl ? ` (${pack.productUrl})` : ""}`),
      "",
      "## Scheduler Summary",
      "- Local repo-controlled scheduler: `scripts/run_local_autopilot.ps1`",
      "- Windows task installer: `scripts/install-windows-autopilot.ps1`",
      "- VPS sync helper: `scripts/sync_vps_repo.py`",
      "- VPS cron installer: `scripts/install-vps-autopilot.sh`",
      "",
      "## Final Note",
      "- The only browser-dependent final action is the Gmail completion email.",
      ""
    ].join("\n");
  }

  private composeFinalEmail(packs: AssetPackRecord[]): string {
    const live = packs.filter((pack) => pack.status === "published");
    const ready = packs.filter((pack) => pack.status === "ready_for_upload");

    return [
      "ImonEngine store autopilot is complete.",
      "",
      `Live products: ${live.length}`,
      ...live.map((pack) => `- ${pack.title}: ${pack.productUrl ?? "published"}`),
      "",
      `Ready-to-upload products: ${ready.length}`,
      ...ready.map((pack) => `- ${pack.title}`),
      "",
      "The repo-controlled scheduler, VPS sync helper, growth asset generator, and phase documentation are all in place.",
      "",
      "This message was sent from the signed-in ImonEngine Gmail session."
    ].join("\n");
  }

  private async readState(): Promise<AutopilotState> {
    return readJsonFile<AutopilotState>(this.statePath, {
      program: "imonengine-store-autopilot",
      status: "inactive",
      currentPhase: "phase-01-product-factory-expansion",
      browserSession: {
        required: true,
        note: "Keep the signed-in ImonEngine browser session open for Gumroad and Gmail access."
      },
      phases: [],
      notes: []
    });
  }

  private async writeState(state: AutopilotState): Promise<void> {
    await writeJsonFile(this.statePath, state);
  }

  private async writeIfChanged(filePath: string, nextContent: string): Promise<boolean> {
    const current = (await exists(filePath)) ? await readTextFile(filePath) : "";
    if (current === nextContent) {
      return false;
    }
    await writeTextFile(filePath, nextContent);
    return true;
  }

  private async writeJsonIfChanged(filePath: string, nextValue: unknown): Promise<boolean> {
    const current = await readJsonFile<unknown>(filePath, null);
    const currentSerialized = `${JSON.stringify(current, null, 2)}\n`;
    const nextSerialized = `${JSON.stringify(nextValue, null, 2)}\n`;
    if (currentSerialized === nextSerialized) {
      return false;
    }
    await writeJsonFile(filePath, nextValue);
    return true;
  }

  private async appendLog(result: AutopilotRunResult): Promise<void> {
    const existing = await readTextFile(this.logPath);
    const timestamp = new Date().toISOString();
    const detailLines = result.details.map((detail) => `  - ${detail}`).join("\n");
    const entry = [`- ${timestamp} [${result.phaseId}] ${result.status.toUpperCase()}: ${result.summary}`, detailLines]
      .filter(Boolean)
      .join("\n");
    const next = `${existing.trimEnd()}\n${entry}\n`;
    await writeTextFile(this.logPath, next);
  }

  private async writeRunReport(result: AutopilotRunResult): Promise<void> {
    await writeJsonFile(this.runReportPath, {
      generatedAt: new Date().toISOString(),
      phaseId: result.phaseId,
      status: result.status,
      summary: result.summary,
      details: result.details,
      changed: result.changed,
      phaseAdvanced: result.phaseAdvanced ?? false
    });
  }
}
