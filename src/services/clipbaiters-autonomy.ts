import { spawn } from "node:child_process";
import path from "node:path";
import type { AppConfig } from "../config.js";
import type {
  ClipBaitersAutonomySnapshot,
  ClipBaitersClipJobState,
  ClipBaitersToolingStatus
} from "../domain/clipbaiters.js";
import { ensureDir, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { FileStore } from "../storage/store.js";
import { ClipBaitersEditorService } from "./clipbaiters-editor.js";
import { ClipBaitersIngestService } from "./clipbaiters-ingest.js";
import { ClipBaitersRendererService } from "./clipbaiters-renderer.js";
import { ClipBaitersStudioService } from "./clipbaiters-studio.js";

const CLIPBAITERS_BUSINESS_ID = "clipbaiters-viral-moments";

function nowIso(): string {
  return new Date().toISOString();
}

function laneScopedPath(filePath: string, laneId: string): string {
  const extension = path.extname(filePath);
  const basename = path.basename(filePath, extension);
  return path.join(path.dirname(filePath), `${basename}-${laneId}${extension}`);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export class ClipBaitersAutonomyService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {}

  async run(options?: {
    businessId?: string;
    laneId?: string;
    dryRun?: boolean;
    allActiveLanes?: boolean;
  }): Promise<{
    snapshot: ClipBaitersAutonomySnapshot;
    artifacts: {
      autonomyJsonPath: string;
      autonomyMarkdownPath: string;
      clipCandidatesPath: string;
      clipJobsPath: string;
      draftClipsDirectory: string;
      dailySummaryPath?: string;
    };
  }> {
    const businessId = options?.businessId ?? CLIPBAITERS_BUSINESS_ID;
    const dryRun = options?.dryRun ?? false;
    if (options?.allActiveLanes) {
      return this.runAllActiveLanes({ businessId, dryRun });
    }

    const laneId = options?.laneId ?? "clipbaiters-political";
    return this.runLane({
      businessId,
      laneId,
      dryRun,
      persistAggregateArtifacts: true
    });
  }

  private async runAllActiveLanes(payload: {
    businessId: string;
    dryRun: boolean;
  }): Promise<{
    snapshot: ClipBaitersAutonomySnapshot;
    artifacts: {
      autonomyJsonPath: string;
      autonomyMarkdownPath: string;
      clipCandidatesPath: string;
      clipJobsPath: string;
      draftClipsDirectory: string;
      dailySummaryPath: string;
    };
  }> {
    const business = await this.store.getManagedBusiness(payload.businessId);
    if (!business) {
      throw new Error(`Managed business ${payload.businessId} was not found.`);
    }

    const studio = new ClipBaitersStudioService(this.config, this.store);
    const { plan } = await studio.writePlan({ businessId: payload.businessId });
    const laneIds = plan.laneRegistry.activeLaneIds;
    const laneResults = [] as Array<Awaited<ReturnType<ClipBaitersAutonomyService["runLane"]>>>;
    for (const laneId of laneIds) {
      laneResults.push(
        await this.runLane({
          businessId: payload.businessId,
          laneId,
          dryRun: payload.dryRun,
          persistAggregateArtifacts: false
        })
      );
    }

    const stateDirectory = path.join(this.config.stateDir, "clipbaiters", payload.businessId);
    const opsDirectory = path.join(this.config.opsDir, "clipbaiters", payload.businessId);
    const autonomyJsonPath = path.join(opsDirectory, "autonomy-run.json");
    const autonomyMarkdownPath = path.join(opsDirectory, "autonomy-run.md");
    const dailySummaryPath = path.join(opsDirectory, "daily-summary.md");
    await Promise.all([ensureDir(stateDirectory), ensureDir(opsDirectory)]);

    const tooling = laneResults[0]?.snapshot.tooling ?? [];
    const renderedClipCount = laneResults.reduce((sum, result) => sum + result.snapshot.renderedClipCount, 0);
    const renderBlockedCount = laneResults.reduce((sum, result) => sum + result.snapshot.renderBlockedCount, 0);
    const snapshot: ClipBaitersAutonomySnapshot = {
      businessId: payload.businessId,
      businessName: business.name,
      laneId: "all-active-lanes",
      laneName: "All Active Lanes",
      generatedAt: nowIso(),
      status: laneResults.some((result) => result.snapshot.status === "ready") ? "ready" : "blocked",
      dryRun: payload.dryRun,
      sourceManifestCount: laneResults.reduce((sum, result) => sum + result.snapshot.sourceManifestCount, 0),
      candidateCount: laneResults.reduce((sum, result) => sum + result.snapshot.candidateCount, 0),
      clipJobCount: laneResults.reduce((sum, result) => sum + result.snapshot.clipJobCount, 0),
      renderedClipCount,
      renderBlockedCount,
      tooling,
      manualGates: uniqueStrings(
        laneResults.flatMap((result) =>
          result.snapshot.manualGates.map((gate) => `${result.snapshot.laneName}: ${gate}`)
        )
      ),
      summary: payload.dryRun
        ? `ClipBaiters autonomy refreshed ${laneResults.reduce((sum, result) => sum + result.snapshot.clipJobCount, 0)} draft package(s) across ${laneResults.length} active lane(s).`
        : `ClipBaiters autonomy rendered ${renderedClipCount} clip(s) with ${renderBlockedCount} blocked job(s) across ${laneResults.length} active lane(s).`,
      nextStep: payload.dryRun
        ? "Review the per-lane autonomy summaries, then refresh the all-active-lanes publish queue to stage review and upload readiness."
        : renderedClipCount > 0
          ? "Review the rendered clip packages, then refresh the all-active-lanes publish queue for scheduling and upload gating."
          : "Resolve the render blockers recorded in the per-lane autonomy summaries before another non-dry-run pass.",
      artifactPaths: uniqueStrings([
        autonomyJsonPath,
        autonomyMarkdownPath,
        dailySummaryPath,
        ...laneResults.flatMap((result) => result.snapshot.artifactPaths)
      ])
    };

    await Promise.all([
      writeJsonFile(autonomyJsonPath, snapshot),
      writeTextFile(autonomyMarkdownPath, this.toAggregateMarkdown(snapshot, laneResults)),
      writeTextFile(dailySummaryPath, this.toDailySummary(snapshot, laneResults))
    ]);

    return {
      snapshot,
      artifacts: {
        autonomyJsonPath,
        autonomyMarkdownPath,
        clipCandidatesPath: path.join(stateDirectory, "clip-candidates.json"),
        clipJobsPath: path.join(stateDirectory, "clip-jobs.json"),
        draftClipsDirectory: path.join(opsDirectory, "draft-clips"),
        dailySummaryPath
      }
    };
  }

  private async runLane(payload: {
    businessId: string;
    laneId: string;
    dryRun: boolean;
    persistAggregateArtifacts: boolean;
  }): Promise<{
    snapshot: ClipBaitersAutonomySnapshot;
    artifacts: {
      autonomyJsonPath: string;
      autonomyMarkdownPath: string;
      clipCandidatesPath: string;
      clipJobsPath: string;
      draftClipsDirectory: string;
    };
  }> {
    const businessId = payload.businessId;
    const laneId = payload.laneId;
    const dryRun = payload.dryRun;
    const business = await this.store.getManagedBusiness(businessId);
    if (!business) {
      throw new Error(`Managed business ${businessId} was not found.`);
    }

    const ingestService = new ClipBaitersIngestService(this.config, this.store);
    const ingest = await ingestService.prepare({ businessId, laneId, dryRun });
    const editorService = new ClipBaitersEditorService(this.config, this.store);
    const drafted = await editorService.draft({
      businessId,
      businessName: ingest.businessName,
      laneId,
      laneName: ingest.laneName,
      dryRun,
      candidates: ingest.candidates
    });
    const tooling = await this.inspectTooling();
    const manualGates = this.buildManualGates({
      dryRun,
      laneName: ingest.laneName,
      sourceFeedDirectory: ingest.artifacts.sourceFeedDirectory,
      manifests: ingest.manifests.length,
      tooling
    });

    const stateDirectory = path.join(this.config.stateDir, "clipbaiters", businessId);
    const opsDirectory = path.join(this.config.opsDir, "clipbaiters", businessId);
    const autonomyJsonPath = path.join(opsDirectory, "autonomy-run.json");
    const autonomyMarkdownPath = path.join(opsDirectory, "autonomy-run.md");
    const autonomyLaneJsonPath = laneScopedPath(autonomyJsonPath, laneId);
    const autonomyLaneMarkdownPath = laneScopedPath(autonomyMarkdownPath, laneId);
    await Promise.all([ensureDir(stateDirectory), ensureDir(opsDirectory)]);

    let jobs = drafted.jobs;
    let renderedClipCount = 0;
    let renderBlockedCount = jobs.filter((job) => job.status === "blocked").length;
    let renderArtifactPaths: string[] = [];

    if (!dryRun && jobs.length > 0) {
      const missingTools = tooling.filter((tool) => !tool.available);
      if (missingTools.length === 0) {
        const rendererService = new ClipBaitersRendererService(this.config, this.store);
        const renderResult = await rendererService.render({ jobs });
        jobs = renderResult.jobs;
        renderedClipCount = renderResult.renderedCount;
        renderBlockedCount = renderResult.blockedCount;
        renderArtifactPaths = renderResult.artifactPaths;
      } else {
        const toolSummary = missingTools.map((tool) => tool.tool).join(", ");
        const gate = `Render execution was skipped because required tools are unavailable: ${toolSummary}.`;
        manualGates.push(gate);
        jobs = jobs.map((job) => ({
          ...job,
          status: "blocked",
          notes: [...job.notes, gate]
        }));
        renderBlockedCount = jobs.length;
      }

      const renderedState: ClipBaitersClipJobState = {
        businessId,
        laneId,
        generatedAt: nowIso(),
        dryRun,
        jobs
      };
      await Promise.all([
        writeJsonFile(drafted.artifacts.clipJobsPath, renderedState),
        writeJsonFile(drafted.artifacts.clipJobsLanePath, renderedState)
      ]);
    }

    const snapshot: ClipBaitersAutonomySnapshot = {
      businessId,
      businessName: business.name,
      laneId,
      laneName: ingest.laneName,
      generatedAt: nowIso(),
      status: dryRun ? (jobs.length > 0 ? "ready" : "blocked") : renderedClipCount > 0 ? "ready" : "blocked",
      dryRun,
      sourceManifestCount: ingest.manifests.length,
      candidateCount: ingest.candidates.length,
      clipJobCount: jobs.length,
      renderedClipCount,
      renderBlockedCount,
      tooling,
      manualGates,
      summary:
        dryRun
          ? jobs.length > 0
            ? `${ingest.laneName} autonomy refreshed ${ingest.candidates.length} clip candidate(s) into ${jobs.length} draft package(s).`
            : `${ingest.laneName} autonomy did not produce any draft packages.`
          : renderedClipCount > 0
            ? `${ingest.laneName} autonomy rendered ${renderedClipCount} final clip(s) from ${jobs.length} prepared job(s).`
            : `${ingest.laneName} autonomy did not render any final clips.`,
      nextStep: dryRun
        ? `Review the draft packages, add approved source manifests to ${ingest.artifacts.sourceFeedDirectory}, then rerun without --dry-run once toolchain and review gates are ready.`
        : renderedClipCount > 0
          ? `Review the rendered clip packages in ${drafted.artifacts.draftClipsDirectory} before any publish step.`
          : `Resolve the render blockers in ${autonomyLaneMarkdownPath} before another non-dry-run pass.`,
      artifactPaths: uniqueStrings([
        ingest.artifacts.clipCandidatesPath,
        ingest.artifacts.clipCandidatesLanePath,
        drafted.artifacts.clipJobsPath,
        drafted.artifacts.clipJobsLanePath,
        drafted.artifacts.draftClipsDirectory,
        autonomyLaneJsonPath,
        autonomyLaneMarkdownPath,
        ...renderArtifactPaths,
        ...(payload.persistAggregateArtifacts ? [autonomyJsonPath, autonomyMarkdownPath] : [])
      ])
    };

    await Promise.all([
      writeJsonFile(autonomyLaneJsonPath, snapshot),
      writeTextFile(
        autonomyLaneMarkdownPath,
        this.toMarkdown(snapshot, ingest.artifacts.clipCandidatesLanePath, drafted.artifacts.clipJobsLanePath)
      )
    ]);
    if (payload.persistAggregateArtifacts) {
      await Promise.all([
        writeJsonFile(autonomyJsonPath, snapshot),
        writeTextFile(
          autonomyMarkdownPath,
          this.toMarkdown(snapshot, ingest.artifacts.clipCandidatesPath, drafted.artifacts.clipJobsPath)
        )
      ]);
    }

    return {
      snapshot,
      artifacts: {
        autonomyJsonPath: payload.persistAggregateArtifacts ? autonomyJsonPath : autonomyLaneJsonPath,
        autonomyMarkdownPath: payload.persistAggregateArtifacts ? autonomyMarkdownPath : autonomyLaneMarkdownPath,
        clipCandidatesPath: payload.persistAggregateArtifacts ? ingest.artifacts.clipCandidatesPath : ingest.artifacts.clipCandidatesLanePath,
        clipJobsPath: payload.persistAggregateArtifacts ? drafted.artifacts.clipJobsPath : drafted.artifacts.clipJobsLanePath,
        draftClipsDirectory: drafted.artifacts.draftClipsDirectory
      }
    };
  }

  private buildManualGates(payload: {
    dryRun: boolean;
    laneName: string;
    sourceFeedDirectory: string;
    manifests: number;
    tooling: ClipBaitersToolingStatus[];
  }): string[] {
    const gates = [
      `${payload.laneName} still requires a manual editorial review before any publish or upload step.`,
      payload.manifests > 0
        ? `Manual source manifests were detected in ${payload.sourceFeedDirectory}; verify each source before live ingest.`
        : `No manual source manifests were detected in ${payload.sourceFeedDirectory}; the current run uses synthetic story-brief inputs.`
    ];
    if (payload.dryRun) {
      gates.push("Dry run only: no source download, ffmpeg render, or external transcription command was executed.");
    }
    for (const tool of payload.tooling.filter((candidate) => !candidate.available)) {
      gates.push(`${tool.tool} is not available on the current host. ${tool.note}`);
    }
    return gates;
  }

  private async inspectTooling(): Promise<ClipBaitersToolingStatus[]> {
    return Promise.all([
      this.inspectTool("ffmpeg", ["-version"], "Install ffmpeg on the worker host before live clip rendering."),
      this.inspectTool("yt-dlp", ["--version"], "Install yt-dlp on the worker host before approved-source downloads."),
      this.inspectTool(
        "python3",
        ["-m", "whisper", "--help"],
        "Install Whisper or configure another transcription backend before live transcripts."
      )
    ]).then((results) => [
      { tool: "ffmpeg", ...results[0] },
      { tool: "yt-dlp", ...results[1] },
      { tool: "whisper", ...results[2] }
    ]);
  }

  private inspectTool(
    command: string,
    args: string[],
    note: string
  ): Promise<Omit<ClipBaitersToolingStatus, "tool">> {
    return new Promise((resolve) => {
      const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", () => {
        resolve({ available: false, note });
      });
      child.on("close", (code) => {
        const line = (stdout || stderr).split(/\r?\n/).find((value) => value.trim().length > 0);
        resolve({
          available: code === 0,
          version: code === 0 ? line?.trim() : undefined,
          note
        });
      });
    });
  }

  private toMarkdown(
    snapshot: ClipBaitersAutonomySnapshot,
    clipCandidatesPath: string,
    clipJobsPath: string
  ): string {
    return [
      "# ClipBaiters Autonomy Run",
      "",
      `Generated at: ${snapshot.generatedAt}`,
      `Business: ${snapshot.businessName}`,
      `Lane: ${snapshot.laneName}`,
      `Status: ${snapshot.status}`,
      `Dry run: ${snapshot.dryRun ? "yes" : "no"}`,
      `Source manifests: ${snapshot.sourceManifestCount}`,
      `Clip candidates: ${snapshot.candidateCount}`,
      `Clip jobs: ${snapshot.clipJobCount}`,
      `Rendered clips: ${snapshot.renderedClipCount}`,
      `Render blocked: ${snapshot.renderBlockedCount}`,
      `Clip candidate state: ${clipCandidatesPath}`,
      `Clip job state: ${clipJobsPath}`,
      "",
      "## Tooling",
      ...snapshot.tooling.map(
        (tool) => `- ${tool.tool}: ${tool.available ? tool.version ?? "available" : "missing"} (${tool.note})`
      ),
      "",
      "## Manual Gates",
      ...snapshot.manualGates.map((gate) => `- ${gate}`),
      "",
      "## Next Step",
      `- ${snapshot.nextStep}`,
      ""
    ].join("\n");
  }

  private toAggregateMarkdown(
    snapshot: ClipBaitersAutonomySnapshot,
    laneResults: Array<Awaited<ReturnType<ClipBaitersAutonomyService["runLane"]>>>
  ): string {
    return [
      "# ClipBaiters Autonomy Run",
      "",
      `Generated at: ${snapshot.generatedAt}`,
      `Business: ${snapshot.businessName}`,
      `Lane scope: ${snapshot.laneName}`,
      `Status: ${snapshot.status}`,
      `Dry run: ${snapshot.dryRun ? "yes" : "no"}`,
      `Source manifests: ${snapshot.sourceManifestCount}`,
      `Clip candidates: ${snapshot.candidateCount}`,
      `Clip jobs: ${snapshot.clipJobCount}`,
      `Rendered clips: ${snapshot.renderedClipCount}`,
      `Render blocked: ${snapshot.renderBlockedCount}`,
      "",
      "## Active Lane Summaries",
      ...laneResults.flatMap((result) => [
        `### ${result.snapshot.laneName}`,
        `- Status: ${result.snapshot.status}`,
        `- Source manifests: ${result.snapshot.sourceManifestCount}`,
        `- Clip candidates: ${result.snapshot.candidateCount}`,
        `- Clip jobs: ${result.snapshot.clipJobCount}`,
        `- Rendered clips: ${result.snapshot.renderedClipCount}`,
        `- Render blocked: ${result.snapshot.renderBlockedCount}`,
        `- Summary: ${result.snapshot.summary}`,
        `- Artifact: ${result.artifacts.autonomyMarkdownPath}`,
        ""
      ]),
      "## Manual Gates",
      ...snapshot.manualGates.map((gate) => `- ${gate}`),
      "",
      "## Next Step",
      `- ${snapshot.nextStep}`,
      ""
    ].join("\n");
  }

  private toDailySummary(
    snapshot: ClipBaitersAutonomySnapshot,
    laneResults: Array<Awaited<ReturnType<ClipBaitersAutonomyService["runLane"]>>>
  ): string {
    return [
      "# ClipBaiters Daily Summary",
      "",
      `Generated at: ${snapshot.generatedAt}`,
      `Business: ${snapshot.businessName}`,
      `Scope: ${snapshot.laneName}`,
      "",
      "## Lane Stages",
      ...laneResults.flatMap((result) => [
        `### ${result.snapshot.laneName}`,
        "- Collect and skim: refreshed through the radar-backed autonomy pass.",
        `- Draft: ${result.snapshot.clipJobCount} clip job(s).`,
        `- Rendered: ${result.snapshot.renderedClipCount} clip(s).`,
        `- Review: ${result.snapshot.manualGates.length} manual gate(s).`,
        `- Status: ${result.snapshot.status}.`,
        ""
      ]),
      "## Summary",
      `- ${snapshot.summary}`,
      `- ${snapshot.nextStep}`,
      ""
    ].join("\n");
  }
}