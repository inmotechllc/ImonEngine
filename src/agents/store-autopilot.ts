import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { AppConfig } from "../config.js";
import type { AssetPackRecord, AssetPackStatus, DigitalAssetType } from "../domain/digital-assets.js";
import { exists, readJsonFile, readTextFile, writeJsonFile, writeTextFile } from "../lib/fs.js";
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
      productId: typeof publishResult.productId === "string" ? publishResult.productId : undefined
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

    const nextBrief = this.getNextContinuousBrief(packs);
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

  private phaseOneComplete(packs: AssetPackRecord[]): boolean {
    const publishedCount = packs.filter((pack) => pack.status === "published").length;
    const builtCount = packs.filter((pack) => READY_OR_PUBLISHED_STATUSES.includes(pack.status)).length;
    return publishedCount >= 2 && builtCount >= PHASE_ONE_TARGET_PACK_COUNT;
  }

  private getNextContinuousBrief(packs: AssetPackRecord[]): {
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

    const generatedWallpapers = packs.filter((pack) =>
      pack.niche.startsWith("Low-noise desktop backgrounds volume")
    ).length;

    return {
      niche: `Low-noise desktop backgrounds volume ${generatedWallpapers + 1}`,
      assetType: "wallpaper_pack",
      style: "smoky neutral gradients with subtle geometry",
      audience: "operators, developers, and creator workspaces",
      packSize: 14
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
      "- VPS sync helper: `scripts/sync_vps_repo.py`",
      "",
      "## Browser Recovery",
      "",
      "- Keep the signed-in automation browser open for Gumroad and Gmail access.",
      "- If the Playwright wrapper fails to reattach, recover the session with `python scripts/chrome_cdp.py list-tabs`.",
      "- Publish the next ready pack through the live browser session with `python scripts/publish_gumroad_product.py --pack-dir <pack-dir>`.",
      "- Use `python scripts/send_gmail_message.py --to ... --subject ... --body-file ...` for the final owner notification once Gmail is open.",
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
      "- Use the generated square teasers for X, LinkedIn, Pinterest Idea Pins, and Gumroad profile updates.",
      "- Rotate product focus weekly in this order:",
      ...activeTitles.map((title) => `  - ${title}`),
      "",
      "## Repurposing Workflow",
      "",
      "- Pull the first cover image from each pack.",
      "- Generate three teaser formats: landscape, square, and story.",
      "- Reuse `captions.md` as the base copy for social posts, Gumroad updates, and email blurbs.",
      "",
      "## No-Cost Channels",
      "",
      "- Gumroad profile updates",
      "- X posts with one featured asset and one CTA link",
      "- LinkedIn carousel teasers for the creator-template and icon products",
      "- Pinterest pins for wallpaper and texture packs",
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
          const channel =
            pack.assetType === "wallpaper_pack"
              ? "Pinterest + X"
              : pack.assetType === "icon_pack"
                ? "LinkedIn + X"
                : pack.assetType === "texture_pack"
                  ? "Pinterest + LinkedIn"
                  : "LinkedIn + Gumroad updates";
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
      "",
      "## Execution Model",
      "",
      "- The local task is the primary scheduler because it can reuse the signed-in browser session when needed.",
      "- The VPS cron job is optional and best for headless build and sync work.",
      "- `scripts/publish_gumroad_product.py` should only run on the local scheduler because it depends on the signed-in Gumroad browser session.",
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
