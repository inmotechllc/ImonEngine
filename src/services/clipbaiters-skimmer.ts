import path from "node:path";
import type { AppConfig } from "../config.js";
import type {
  ClipBaitersDiscoveredVideo,
  ClipBaitersSkimSummary,
  ClipBaitersSkimSummaryState
} from "../domain/clipbaiters.js";
import { readJsonFile, writeJsonFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { FileStore } from "../storage/store.js";
import { ClipBaitersCollectorService } from "./clipbaiters-collector.js";
import { ClipBaitersStudioService } from "./clipbaiters-studio.js";

const CLIPBAITERS_BUSINESS_ID = "clipbaiters-viral-moments";

function nowIso(): string {
  return new Date().toISOString();
}

function clipText(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function mergeById<T extends { id: string }>(existing: T[], next: T[]): T[] {
  const merged = new Map(existing.map((item) => [item.id, item] as const));
  for (const item of next) {
    merged.set(item.id, item);
  }
  return Array.from(merged.values()).sort((left, right) => left.id.localeCompare(right.id));
}

export class ClipBaitersSkimmerService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {}

  async skim(options?: {
    businessId?: string;
    laneId?: string;
  }): Promise<{
    status: "blocked" | "ready";
    summary: string;
    skimState: ClipBaitersSkimSummaryState;
    artifacts: {
      skimSummariesPath: string;
      videoDiscoveryPath: string;
    };
  }> {
    const businessId = options?.businessId ?? CLIPBAITERS_BUSINESS_ID;
    const collector = new ClipBaitersCollectorService(this.config, this.store);
    const collected = await collector.collect({ businessId, laneId: options?.laneId });
    const studio = new ClipBaitersStudioService(this.config, this.store);
    const { plan } = await studio.writePlan({ businessId });
    const laneIds = new Set(options?.laneId ? [options.laneId] : plan.laneRegistry.activeLaneIds);
    const summaries = collected.discoveryState.videos
      .filter((video) => laneIds.has(video.laneId))
      .map((video) => this.toSummary(video, plan.laneRegistry.lanes.find((lane) => lane.id === video.laneId)?.reviewRequired ?? true));

    const stateDirectory = path.join(this.config.stateDir, "clipbaiters", businessId);
    const skimSummariesPath = path.join(stateDirectory, "skim-summaries.json");
    const existing = await readJsonFile<ClipBaitersSkimSummaryState>(skimSummariesPath, {
      businessId,
      generatedAt: nowIso(),
      summaries: []
    });
    const skimState: ClipBaitersSkimSummaryState = {
      businessId,
      generatedAt: nowIso(),
      summaries: mergeById(existing.summaries, summaries)
    };
    await writeJsonFile(skimSummariesPath, skimState);

    return {
      status: summaries.length > 0 ? "ready" : "blocked",
      summary:
        summaries.length > 0
          ? `ClipBaiters skim refreshed ${summaries.length} skim summary item(s).`
          : "ClipBaiters skim did not produce any summaries.",
      skimState,
      artifacts: {
        skimSummariesPath,
        videoDiscoveryPath: collected.artifacts.videoDiscoveryPath
      }
    };
  }

  private toSummary(video: ClipBaitersDiscoveredVideo, reviewRequired: boolean): ClipBaitersSkimSummary {
    const transcriptExcerpt = clipText(video.summary, 220);
    const recommendedMoments = [
      `Open with the context line behind ${clipText(video.title, 60)}.`,
      video.isLive
        ? "Pull the first reaction or tension beat after the setup lands."
        : "Pull the sharpest beat that still preserves the official context.",
      video.laneId === "clipbaiters-streaming"
        ? "End on the payoff moment that would matter to the creator or the audience recap."
        : "End on the explanatory beat that keeps the clip transformed instead of stripped of context."
    ];
    const baseScore =
      (video.isLive ? 3 : 0) +
      (video.isUpcoming ? 2 : 0) +
      (video.status === "queued_for_skim" ? 2 : 0) +
      (video.rightsBasis === "creator_authorized" || video.rightsBasis === "official_government" ? 2 : 0);

    return {
      id: slugify(`${video.id}-skim`),
      businessId: video.businessId,
      laneId: video.laneId,
      discoveryId: video.id,
      sourceId: video.sourceId,
      title: video.title,
      summary: clipText(video.summary, 180),
      transcriptExcerpt,
      recommendedMoments,
      score: Math.max(1, Math.min(10, baseScore + (reviewRequired ? 1 : 2))),
      reviewRequired,
      status: reviewRequired ? "watching" : "ready",
      notes: [
        ...video.notes,
        reviewRequired
          ? "Manual review is still required before moving this skim toward a publishable clip draft."
          : "This skim is eligible for the next autonomy stage once the lane remains active."
      ]
    };
  }
}