import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import type { AppConfig } from "../config.js";
import type { ApprovalTask } from "../domain/contracts.js";
import type { ManagedBusiness } from "../domain/engine.js";
import type {
  ClipBaitersChannelMetricsState,
  ClipBaitersClipCandidate,
  ClipBaitersClipCandidateState,
  ClipBaitersClipJob,
  ClipBaitersClipJobState,
  ClipBaitersCreatorLeadState,
  ClipBaitersCreatorOutreachState,
  ClipBaitersPublishHistoryEntry,
  ClipBaitersPublishHistoryState,
  ClipBaitersPublishManualGate,
  ClipBaitersPublishSnapshot,
  ClipBaitersPostingScheduleAllocation,
  ClipBaitersPostingScheduleState,
  ClipBaitersPublishingQueueItem,
  ClipBaitersPublishingQueueState,
  ClipBaitersReviewGateKind,
  ClipBaitersUploadBatch,
  ClipBaitersUploadBatchState
} from "../domain/clipbaiters.js";
import type { SocialProfileRecord } from "../domain/social.js";
import {
  ensureDir,
  exists,
  readJsonFile,
  writeJsonFile,
  writeTextFile
} from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import type { OrchestratorAgent } from "../agents/orchestrator.js";
import { FileStore } from "../storage/store.js";
import { ClipBaitersAnalyticsService } from "./clipbaiters-analytics.js";
import { ClipBaitersAutonomyService } from "./clipbaiters-autonomy.js";
import { ClipBaitersStudioService } from "./clipbaiters-studio.js";

const CLIPBAITERS_BUSINESS_ID = "clipbaiters-viral-moments";

type LanePublishComputation = {
  laneId: string;
  laneName: string;
  channelProfile: SocialProfileRecord | undefined;
  manualGates: ClipBaitersPublishManualGate[];
  queueItems: ClipBaitersPublishingQueueItem[];
  queueState: ClipBaitersPublishingQueueState;
  uploadBatches: ClipBaitersUploadBatchState;
  publishHistoryEntries: ClipBaitersPublishHistoryEntry[];
  artifacts: {
    publishingQueuePath: string;
    uploadBatchesPath: string;
    reviewQueuePath: string;
  };
};

function nowIso(): string {
  return new Date().toISOString();
}

function clipText(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function laneScopedPath(filePath: string, laneId: string): string {
  const extension = path.extname(filePath);
  const basename = path.basename(filePath, extension);
  return path.join(path.dirname(filePath), `${basename}-${laneId}${extension}`);
}

function mergeById<T extends { id: string }>(existing: T[], next: T[]): T[] {
  const merged = new Map(existing.map((item) => [item.id, item] as const));
  for (const item of next) {
    merged.set(item.id, item);
  }
  return Array.from(merged.values()).sort((left, right) => left.id.localeCompare(right.id));
}

export class ClipBaitersPublisherService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore,
    private readonly orchestrator: OrchestratorAgent
  ) {}

  async run(options?: {
    businessId?: string;
    laneId?: string;
    dryRun?: boolean;
    allActiveLanes?: boolean;
  }): Promise<{
    snapshot: ClipBaitersPublishSnapshot;
    queueState: ClipBaitersPublishingQueueState;
    uploadBatches: ClipBaitersUploadBatchState;
    channelMetrics: ClipBaitersChannelMetricsState;
    artifacts: {
      publishingQueuePath: string;
      postingSchedulePath: string;
      uploadBatchesPath: string;
      reviewQueuePath: string;
      channelMetricsPath: string;
      channelMetricsMarkdownPath: string;
      publishHistoryPath: string;
      dailySummaryPath?: string;
    };
  }> {
    const businessId = options?.businessId ?? CLIPBAITERS_BUSINESS_ID;
    const dryRun = options?.dryRun ?? false;
    const business = await this.store.getManagedBusiness(businessId);
    if (!business) {
      throw new Error(`Managed business ${businessId} was not found.`);
    }

    if (options?.allActiveLanes) {
      return this.runAllActiveLanes({ businessId, businessName: business.name, dryRun });
    }

    const laneId = options?.laneId ?? "clipbaiters-political";
    const laneResult = await this.buildLanePublishComputation({
      businessId,
      businessName: business.name,
      laneId,
      dryRun,
      refreshAutonomy: true
    });
    const scheduled = await this.applyPostingSchedule({
      business,
      laneResults: [laneResult]
    });
    const scheduledLaneResult = scheduled.laneResults[0]!;
    await this.persistLaneArtifacts([scheduledLaneResult]);

    const stateDirectory = path.join(this.config.stateDir, "clipbaiters", businessId);
    const opsDirectory = path.join(this.config.opsDir, "clipbaiters", businessId);
    const publishingQueuePath = path.join(stateDirectory, "publishing-queue.json");
    const uploadBatchesPath = path.join(opsDirectory, "upload-batches.json");
    const reviewQueuePath = path.join(opsDirectory, "review-queue.md");
    const publishHistoryPath = path.join(stateDirectory, "publish-history.json");

    await Promise.all([
      ensureDir(stateDirectory),
      ensureDir(opsDirectory),
      writeJsonFile(publishingQueuePath, scheduledLaneResult.queueState),
      writeJsonFile(uploadBatchesPath, scheduledLaneResult.uploadBatches),
      writeTextFile(
        reviewQueuePath,
        this.toReviewMarkdown(
          scheduledLaneResult.queueItems,
          scheduledLaneResult.uploadBatches.batches[0] ??
            this.emptyBatch(businessId, laneId, scheduledLaneResult.laneName, dryRun),
          scheduledLaneResult.manualGates
        )
      )
    ]);

    const analytics = new ClipBaitersAnalyticsService(this.config, this.store);
    const channelMetricsResult = await analytics.capture({
      businessId,
      laneId,
      laneName: scheduledLaneResult.laneName,
      queue: scheduledLaneResult.queueItems,
      batches: scheduledLaneResult.uploadBatches.batches
    });
    await this.writePublishHistory(
      publishHistoryPath,
      businessId,
      scheduledLaneResult.publishHistoryEntries
    );

    const snapshot = this.toSnapshot({
      businessId,
      businessName: business.name,
      laneId,
      laneName: scheduledLaneResult.laneName,
      dryRun,
      channelProfile: scheduledLaneResult.channelProfile,
      queueItems: scheduledLaneResult.queueItems,
      manualGates: scheduledLaneResult.manualGates,
      reviewQueuePath,
      uploadBatchesPath,
      channelMetricsPath: channelMetricsResult.artifacts.channelMetricsPath
    });

    return {
      snapshot,
      queueState: scheduledLaneResult.queueState,
      uploadBatches: scheduledLaneResult.uploadBatches,
      channelMetrics: channelMetricsResult.state,
      artifacts: {
        publishingQueuePath,
        postingSchedulePath: scheduled.schedulePath,
        uploadBatchesPath,
        reviewQueuePath,
        channelMetricsPath: channelMetricsResult.artifacts.channelMetricsPath,
        channelMetricsMarkdownPath: channelMetricsResult.artifacts.channelMetricsMarkdownPath,
        publishHistoryPath
      }
    };
  }

  private async runAllActiveLanes(payload: {
    businessId: string;
    businessName: string;
    dryRun: boolean;
  }): Promise<{
    snapshot: ClipBaitersPublishSnapshot;
    queueState: ClipBaitersPublishingQueueState;
    uploadBatches: ClipBaitersUploadBatchState;
    channelMetrics: ClipBaitersChannelMetricsState;
    artifacts: {
      publishingQueuePath: string;
      postingSchedulePath: string;
      uploadBatchesPath: string;
      reviewQueuePath: string;
      channelMetricsPath: string;
      channelMetricsMarkdownPath: string;
      publishHistoryPath: string;
      dailySummaryPath: string;
    };
  }> {
    const business = await this.store.getManagedBusiness(payload.businessId);
    if (!business) {
      throw new Error(`Managed business ${payload.businessId} was not found.`);
    }

    const studio = new ClipBaitersStudioService(this.config, this.store);
    const { plan } = await studio.writePlan({ businessId: payload.businessId });
    const autonomy = new ClipBaitersAutonomyService(this.config, this.store);
    await autonomy.run({
      businessId: payload.businessId,
      dryRun: payload.dryRun,
      allActiveLanes: true
    });

    const laneResults: LanePublishComputation[] = [];
    for (const laneId of plan.laneRegistry.activeLaneIds) {
      const laneName = plan.laneRegistry.lanes.find((lane) => lane.id === laneId)?.name ?? laneId;
      laneResults.push(
        await this.buildLanePublishComputation({
          businessId: payload.businessId,
          businessName: payload.businessName,
          laneId,
          dryRun: payload.dryRun,
          refreshAutonomy: false,
          laneName
        })
      );
    }
    const scheduled = await this.applyPostingSchedule({
      business,
      laneResults
    });
    const scheduledLaneResults = scheduled.laneResults;
    await this.persistLaneArtifacts(scheduledLaneResults);

    const generatedAt = nowIso();
    const allQueueItems = scheduledLaneResults.flatMap((result) => result.queueItems);
    const allBatches = scheduledLaneResults.flatMap((result) => result.uploadBatches.batches);
    const queueState: ClipBaitersPublishingQueueState = {
      businessId: payload.businessId,
      laneId: "all-active-lanes",
      generatedAt,
      dryRun: payload.dryRun,
      items: allQueueItems
    };
    const uploadBatches: ClipBaitersUploadBatchState = {
      businessId: payload.businessId,
      laneId: "all-active-lanes",
      generatedAt,
      dryRun: payload.dryRun,
      batches: allBatches
    };

    const stateDirectory = path.join(this.config.stateDir, "clipbaiters", payload.businessId);
    const opsDirectory = path.join(this.config.opsDir, "clipbaiters", payload.businessId);
    const publishingQueuePath = path.join(stateDirectory, "publishing-queue.json");
    const uploadBatchesPath = path.join(opsDirectory, "upload-batches.json");
    const reviewQueuePath = path.join(opsDirectory, "review-queue.md");
    const publishHistoryPath = path.join(stateDirectory, "publish-history.json");
    const dailySummaryPath = path.join(opsDirectory, "daily-summary.md");

    await Promise.all([
      ensureDir(stateDirectory),
      ensureDir(opsDirectory),
      writeJsonFile(publishingQueuePath, queueState),
      writeJsonFile(uploadBatchesPath, uploadBatches),
      writeTextFile(reviewQueuePath, this.toAggregateReviewMarkdown(laneResults))
    ]);

    const analytics = new ClipBaitersAnalyticsService(this.config, this.store);
    const channelMetricsResult = await analytics.capture({
      businessId: payload.businessId,
      queue: allQueueItems,
      batches: allBatches
    });
    const publishHistoryState = await this.writePublishHistory(
      publishHistoryPath,
      payload.businessId,
      laneResults.flatMap((result) => result.publishHistoryEntries)
    );

    const creatorLeadsPath = path.join(stateDirectory, "creator-leads.json");
    const creatorOutreachPath = path.join(stateDirectory, "creator-outreach.json");
    const [creatorLeads, creatorOutreach] = await Promise.all([
      readJsonFile<ClipBaitersCreatorLeadState | null>(creatorLeadsPath, null),
      readJsonFile<ClipBaitersCreatorOutreachState | null>(creatorOutreachPath, null)
    ]);

    await writeTextFile(
      dailySummaryPath,
      this.toDailySummary({
        businessName: payload.businessName,
        laneResults: scheduledLaneResults,
        channelMetrics: channelMetricsResult.state,
        publishHistory: publishHistoryState,
        creatorLeadCount: creatorLeads?.leads.length ?? 0,
        creatorOutreachDraftCount: creatorOutreach?.drafts.length ?? 0
      })
    );

    const snapshot = this.toAggregateSnapshot({
      businessId: payload.businessId,
      businessName: payload.businessName,
      dryRun: payload.dryRun,
      laneResults: scheduledLaneResults,
      reviewQueuePath,
      uploadBatchesPath,
      channelMetricsPath: channelMetricsResult.artifacts.channelMetricsPath,
      dailySummaryPath
    });

    return {
      snapshot,
      queueState,
      uploadBatches,
      channelMetrics: channelMetricsResult.state,
      artifacts: {
        publishingQueuePath,
        postingSchedulePath: scheduled.schedulePath,
        uploadBatchesPath,
        reviewQueuePath,
        channelMetricsPath: channelMetricsResult.artifacts.channelMetricsPath,
        channelMetricsMarkdownPath: channelMetricsResult.artifacts.channelMetricsMarkdownPath,
        publishHistoryPath,
        dailySummaryPath
      }
    };
  }

  private async buildLanePublishComputation(payload: {
    businessId: string;
    businessName: string;
    laneId: string;
    dryRun: boolean;
    refreshAutonomy: boolean;
    laneName?: string;
  }): Promise<LanePublishComputation> {
    const profiles = await this.store.getSocialProfiles();
    let preparedClipJobsPath = laneScopedPath(
      path.join(this.config.stateDir, "clipbaiters", payload.businessId, "clip-jobs.json"),
      payload.laneId
    );
    let preparedClipCandidatesPath = laneScopedPath(
      path.join(this.config.stateDir, "clipbaiters", payload.businessId, "clip-candidates.json"),
      payload.laneId
    );
    let resolvedLaneName = payload.laneName ?? payload.laneId;

    if (payload.refreshAutonomy) {
      const autonomy = new ClipBaitersAutonomyService(this.config, this.store);
      const autonomyResult = await autonomy.run({
        businessId: payload.businessId,
        laneId: payload.laneId,
        dryRun: payload.dryRun
      });
      preparedClipJobsPath = autonomyResult.artifacts.clipJobsPath;
      preparedClipCandidatesPath = autonomyResult.artifacts.clipCandidatesPath;
      resolvedLaneName = autonomyResult.snapshot.laneName;
    }

    const [jobsState, candidatesState] = await Promise.all([
      readJsonFile<ClipBaitersClipJobState | null>(preparedClipJobsPath, null),
      readJsonFile<ClipBaitersClipCandidateState | null>(preparedClipCandidatesPath, null)
    ]);

    const jobs = jobsState?.jobs ?? [];
    const candidateById = new Map(
      (candidatesState?.candidates ?? []).map((candidate) => [candidate.id, candidate] as const)
    );
    resolvedLaneName = jobs[0]?.laneName ?? resolvedLaneName;
    const channelProfile = this.resolveChannelProfile(profiles, payload.businessId, payload.laneId);
    const generatedAt = nowIso();
    const stateDirectory = path.join(this.config.stateDir, "clipbaiters", payload.businessId);
    const opsDirectory = path.join(this.config.opsDir, "clipbaiters", payload.businessId);
    const publishingQueuePath = laneScopedPath(path.join(stateDirectory, "publishing-queue.json"), payload.laneId);
    const uploadBatchesPath = laneScopedPath(path.join(opsDirectory, "upload-batches.json"), payload.laneId);
    const reviewQueuePath = laneScopedPath(path.join(opsDirectory, "review-queue.md"), payload.laneId);

    await Promise.all([ensureDir(stateDirectory), ensureDir(opsDirectory)]);

    const manualGates: ClipBaitersPublishManualGate[] = [];
    const queueItems: ClipBaitersPublishingQueueItem[] = [];
    const publishHistoryEntries: ClipBaitersPublishHistoryEntry[] = [];

    for (const [index, job] of jobs.entries()) {
      const candidate = candidateById.get(job.candidateId);
      const renderReady = job.status === "rendered" && (await exists(job.renderArtifacts.renderedVideoPath));
      const policyBlocks = this.publishPolicyBlocks({
        laneId: payload.laneId,
        job,
        candidate,
        dryRun: payload.dryRun,
        renderReady
      });
      const reviewRequired = this.requiresManualReview(payload.laneId, job, candidate);
      const gate = reviewRequired
        ? await this.ensureReviewGate(job, candidate, channelProfile, resolvedLaneName)
        : undefined;
      if (gate) {
        manualGates.push(gate);
      }

      const scheduledFor = new Date(Date.now() + index * 30 * 60 * 1000).toISOString();
      const queueItem = this.toQueueItem({
        businessId: payload.businessId,
        laneId: payload.laneId,
        laneName: resolvedLaneName,
        job,
        candidate,
        channelProfile,
        dryRun: payload.dryRun,
        renderReady,
        policyBlocks,
        scheduledFor,
        status: this.queueItemStatus(channelProfile, gate, reviewRequired, policyBlocks),
        approvalId: gate?.id,
        reviewRequired
      });
      const uploadAttempt = await this.maybeAttemptLiveUpload({
        queueItem,
        job,
        channelProfile,
        dryRun: payload.dryRun
      });
      const nextQueueItem: ClipBaitersPublishingQueueItem = {
        ...queueItem,
        status: uploadAttempt.queueStatus,
        videoUrl: uploadAttempt.videoUrl,
        publishedAt: uploadAttempt.publishedAt,
        notes: [...queueItem.notes, ...uploadAttempt.notes]
      };
      queueItems.push(nextQueueItem);
      publishHistoryEntries.push(
        this.toPublishHistoryEntry({
          businessId: payload.businessId,
          laneId: payload.laneId,
          queueItemId: nextQueueItem.id,
          clipJobId: job.id,
          status: uploadAttempt.historyStatus,
          command: uploadAttempt.command,
          publishedAt: uploadAttempt.publishedAt,
          notes: uploadAttempt.notes
        })
      );
    }

    const queueState: ClipBaitersPublishingQueueState = {
      businessId: payload.businessId,
      laneId: payload.laneId,
      generatedAt,
      dryRun: payload.dryRun,
      items: queueItems
    };
    const uploadBatch = this.toUploadBatch({
      businessId: payload.businessId,
      laneId: payload.laneId,
      laneName: resolvedLaneName,
      dryRun: payload.dryRun,
      channelProfile,
      generatedAt,
      items: queueItems
    });
    const uploadBatches: ClipBaitersUploadBatchState = {
      businessId: payload.businessId,
      laneId: payload.laneId,
      generatedAt,
      dryRun: payload.dryRun,
      batches: [uploadBatch]
    };

    await Promise.all([
      writeJsonFile(publishingQueuePath, queueState),
      writeJsonFile(uploadBatchesPath, uploadBatches),
      writeTextFile(reviewQueuePath, this.toReviewMarkdown(queueItems, uploadBatch, manualGates))
    ]);

    return {
      laneId: payload.laneId,
      laneName: resolvedLaneName,
      channelProfile,
      manualGates,
      queueItems,
      queueState,
      uploadBatches,
      publishHistoryEntries,
      artifacts: {
        publishingQueuePath,
        uploadBatchesPath,
        reviewQueuePath
      }
    };
  }

  private async persistLaneArtifacts(results: LanePublishComputation[]): Promise<void> {
    await Promise.all(
      results.flatMap((result) => [
        writeJsonFile(result.artifacts.publishingQueuePath, result.queueState),
        writeJsonFile(result.artifacts.uploadBatchesPath, result.uploadBatches),
        writeTextFile(
          result.artifacts.reviewQueuePath,
          this.toReviewMarkdown(
            result.queueItems,
            result.uploadBatches.batches[0] ??
              this.emptyBatch(result.queueState.businessId, result.laneId, result.laneName, result.queueState.dryRun),
            result.manualGates
          )
        )
      ])
    );
  }

  private async applyPostingSchedule(payload: {
    business: ManagedBusiness;
    laneResults: LanePublishComputation[];
  }): Promise<{
    laneResults: LanePublishComputation[];
    scheduleState: ClipBaitersPostingScheduleState;
    schedulePath: string;
  }> {
    const schedulePath = path.join(this.config.stateDir, "clipbaiters", payload.business.id, "posting-schedule.json");
    const timezone = payload.business.schedule.timezone;
    const dailyPostCap = Math.max(1, payload.business.schedule.maxRunsPerDay);
    const preferredWindows = payload.business.schedule.preferredWindows;
    const existingState = await readJsonFile<ClipBaitersPostingScheduleState>(
      schedulePath,
      this.defaultPostingScheduleState(payload.business)
    );
    const queueItems = payload.laneResults.flatMap((result) => result.queueItems);
    const queueItemById = new Map(queueItems.map((item) => [item.id, item] as const));
    const existingByQueueId = new Map(existingState.allocations.map((allocation) => [allocation.queueItemId, allocation] as const));
    const retainedHistory = existingState.allocations.filter(
      (allocation) => !queueItemById.has(allocation.queueItemId) && allocation.status !== "planned"
    );
    const reusablePlannedAllocations: ClipBaitersPostingScheduleAllocation[] = [];
    for (const item of queueItems) {
      const allocation = existingByQueueId.get(item.id);
      if (allocation && allocation.status === "planned") {
        reusablePlannedAllocations.push(allocation);
      }
    }
    const plannedAllocations = [...reusablePlannedAllocations];
    const allocated = new Map<string, ClipBaitersPostingScheduleAllocation>();

    for (const allocation of reusablePlannedAllocations) {
      const item = queueItemById.get(allocation.queueItemId);
      if (!item) {
        continue;
      }
      allocated.set(allocation.queueItemId, this.reconcileAllocation(allocation, item));
    }

    const eligibleItems = this.orderItemsForSchedule(
      queueItems.filter((item) => item.status === "approved" || item.status === "awaiting_review")
    );
    for (const item of eligibleItems) {
      if (allocated.has(item.id)) {
        continue;
      }
      const allocation = this.nextAllocationFor({
        businessId: payload.business.id,
        dailyPostCap,
        item,
        plannedAllocations,
        preferredWindows,
        timezone
      });
      plannedAllocations.push(allocation);
      allocated.set(item.id, allocation);
    }

    for (const item of queueItems.filter((candidate) => !allocated.has(candidate.id))) {
      const existingAllocation = existingByQueueId.get(item.id);
      if (existingAllocation) {
        allocated.set(item.id, this.reconcileAllocation(existingAllocation, item));
      }
    }

    const allocationByQueueId = new Map(
      [...allocated.values()].map((allocation) => [allocation.queueItemId, allocation] as const)
    );
    const laneResults = payload.laneResults.map((result) => {
      const queueItems = result.queueItems
        .map((item) => {
          const allocation = allocationByQueueId.get(item.id);
          if (!allocation) {
            return item;
          }
          return {
            ...item,
            scheduledFor: allocation.scheduledFor,
            scheduledWindowLabel: allocation.windowLabel
          };
        })
        .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor));
      const uploadBatches = {
        ...result.uploadBatches,
        generatedAt: nowIso(),
        batches: result.uploadBatches.batches.map((batch) => ({
          ...batch,
          scheduledFor: queueItems[0]?.scheduledFor ?? batch.scheduledFor,
          updatedAt: nowIso()
        }))
      };

      return {
        ...result,
        queueItems,
        queueState: {
          ...result.queueState,
          generatedAt: nowIso(),
          items: queueItems
        },
        uploadBatches
      };
    });

    const scheduleState: ClipBaitersPostingScheduleState = {
      businessId: payload.business.id,
      generatedAt: nowIso(),
      timezone,
      dailyPostCap,
      preferredWindows,
      allocations: [...retainedHistory, ...allocated.values()].sort((left, right) =>
        left.scheduledFor.localeCompare(right.scheduledFor)
      )
    };

    await writeJsonFile(schedulePath, scheduleState);
    return {
      laneResults,
      scheduleState,
      schedulePath
    };
  }

  private defaultPostingScheduleState(business: ManagedBusiness): ClipBaitersPostingScheduleState {
    return {
      businessId: business.id,
      generatedAt: nowIso(),
      timezone: business.schedule.timezone,
      dailyPostCap: Math.max(1, business.schedule.maxRunsPerDay),
      preferredWindows: business.schedule.preferredWindows,
      allocations: []
    };
  }

  private orderItemsForSchedule(items: ClipBaitersPublishingQueueItem[]): ClipBaitersPublishingQueueItem[] {
    const laneBuckets = new Map<string, ClipBaitersPublishingQueueItem[]>();
    for (const item of [...items].sort((left, right) => this.queueSortOrder(left, right))) {
      const bucket = laneBuckets.get(item.laneId) ?? [];
      bucket.push(item);
      laneBuckets.set(item.laneId, bucket);
    }

    const laneIds = [...laneBuckets.keys()].sort((left, right) => left.localeCompare(right));
    const ordered: ClipBaitersPublishingQueueItem[] = [];
    while (laneIds.some((laneId) => (laneBuckets.get(laneId)?.length ?? 0) > 0)) {
      for (const laneId of laneIds) {
        const next = laneBuckets.get(laneId)?.shift();
        if (next) {
          ordered.push(next);
        }
      }
    }
    return ordered;
  }

  private queueSortOrder(
    left: ClipBaitersPublishingQueueItem,
    right: ClipBaitersPublishingQueueItem
  ): number {
    const leftSeries = left.seriesPart?.seriesId ?? left.id;
    const rightSeries = right.seriesPart?.seriesId ?? right.id;
    if (leftSeries === rightSeries) {
      return (left.seriesPart?.partNumber ?? 1) - (right.seriesPart?.partNumber ?? 1);
    }
    return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
  }

  private nextAllocationFor(payload: {
    businessId: string;
    dailyPostCap: number;
    item: ClipBaitersPublishingQueueItem;
    plannedAllocations: ClipBaitersPostingScheduleAllocation[];
    preferredWindows: string[];
    timezone: string;
  }): ClipBaitersPostingScheduleAllocation {
    const now = new Date();
    for (let dayOffset = 0; dayOffset < 30; dayOffset += 1) {
      const day = this.zonedDayString(new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000), payload.timezone);
      const dayAllocations = payload.plannedAllocations.filter((allocation) => allocation.day === day);
      if (dayAllocations.length >= payload.dailyPostCap) {
        continue;
      }

      for (const windowLabel of this.windowSequenceForDay(payload.preferredWindows, day)) {
        if (dayAllocations.some((allocation) => allocation.windowLabel === windowLabel)) {
          continue;
        }
        const scheduledFor = this.toZonedIso(
          day,
          this.randomizedWindowTime(payload.item.id, day, windowLabel),
          payload.timezone
        );
        if (new Date(scheduledFor).getTime() <= now.getTime() + 5 * 60 * 1000) {
          continue;
        }

        return {
          id: slugify(`${payload.item.id}-${day}-${windowLabel}`),
          businessId: payload.businessId,
          queueItemId: payload.item.id,
          clipJobId: payload.item.clipJobId,
          laneId: payload.item.laneId,
          laneName: payload.item.laneName,
          timezone: payload.timezone,
          day,
          windowLabel,
          scheduledFor,
          status: "planned",
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
      }
    }

    throw new Error(`Unable to allocate a posting window for ${payload.item.id}.`);
  }

  private reconcileAllocation(
    allocation: ClipBaitersPostingScheduleAllocation,
    item: ClipBaitersPublishingQueueItem
  ): ClipBaitersPostingScheduleAllocation {
    return {
      ...allocation,
      laneId: item.laneId,
      laneName: item.laneName,
      status:
        item.status === "live"
          ? "published"
          : item.status === "failed"
            ? "failed"
            : item.status === "blocked"
              ? "skipped"
              : "planned",
      publishedAt: item.publishedAt,
      updatedAt: nowIso()
    };
  }

  private windowSequenceForDay(preferredWindows: string[], day: string): string[] {
    if (preferredWindows.length === 0) {
      return ["09:00-11:00"];
    }
    const rotation = this.hashMod(day, preferredWindows.length);
    return [...preferredWindows.slice(rotation), ...preferredWindows.slice(0, rotation)];
  }

  private randomizedWindowTime(queueItemId: string, day: string, windowLabel: string): string {
    const [start, end] = this.parseWindow(windowLabel);
    const durationMinutes = Math.max(10, end - start);
    const offsetMinutes = 5 + this.hashMod(`${queueItemId}:${day}:${windowLabel}`, Math.max(1, durationMinutes - 10));
    const scheduledMinutes = start + offsetMinutes;
    const hours = Math.floor(scheduledMinutes / 60)
      .toString()
      .padStart(2, "0");
    const minutes = Math.floor(scheduledMinutes % 60)
      .toString()
      .padStart(2, "0");
    return `${hours}:${minutes}`;
  }

  private parseWindow(windowLabel: string): [number, number] {
    const [start = "09:00", end = "11:00"] = windowLabel.split("-");
    const [startHour = 9, startMinute = 0] = start
      .split(":")
      .map((value) => Number.parseInt(value, 10));
    const [endHour = 11, endMinute = 0] = end
      .split(":")
      .map((value) => Number.parseInt(value, 10));
    return [startHour * 60 + startMinute, endHour * 60 + endMinute];
  }

  private hashMod(value: string, modulo: number): number {
    const hash = createHash("sha1").update(value).digest("hex").slice(0, 8);
    return Number.parseInt(hash, 16) % modulo;
  }

  private zonedDayString(date: Date, timezone: string): string {
    const parts = this.zonedParts(date, timezone);
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  private toZonedIso(day: string, time: string, timezone: string): string {
    const [year = 1970, month = 1, date = 1] = day
      .split("-")
      .map((value) => Number.parseInt(value, 10));
    const [hours = 9, minutes = 0] = time
      .split(":")
      .map((value) => Number.parseInt(value, 10));
    let target = new Date(Date.UTC(year, month - 1, date, hours, minutes));

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = this.zonedParts(target, timezone);
      const currentLocalAsUtc = Date.UTC(
        Number.parseInt(parts.year, 10),
        Number.parseInt(parts.month, 10) - 1,
        Number.parseInt(parts.day, 10),
        Number.parseInt(parts.hour, 10),
        Number.parseInt(parts.minute, 10)
      );
      const desiredLocalAsUtc = Date.UTC(year, month - 1, date, hours, minutes);
      target = new Date(target.getTime() + (desiredLocalAsUtc - currentLocalAsUtc));
    }

    return target.toISOString();
  }

  private zonedParts(
    date: Date,
    timezone: string
  ): Record<"year" | "month" | "day" | "hour" | "minute", string> {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(date);

    return {
      year: parts.find((part) => part.type === "year")?.value ?? "1970",
      month: parts.find((part) => part.type === "month")?.value ?? "01",
      day: parts.find((part) => part.type === "day")?.value ?? "01",
      hour: parts.find((part) => part.type === "hour")?.value ?? "00",
      minute: parts.find((part) => part.type === "minute")?.value ?? "00"
    };
  }

  private resolveChannelProfile(
    profiles: SocialProfileRecord[],
    businessId: string,
    laneId: string
  ): SocialProfileRecord | undefined {
    return profiles.find(
      (profile) =>
        profile.businessId === businessId &&
        profile.platform === "youtube_channel" &&
        profile.laneId === laneId
    );
  }

  private requiresManualReview(
    laneId: string,
    job: ClipBaitersClipJob,
    candidate: ClipBaitersClipCandidate | undefined
  ): boolean {
    return (
      laneId === "clipbaiters-political" ||
      laneId === "clipbaiters-celebs" ||
      job.reviewRequired ||
      candidate?.approvalState === "review_required" ||
      candidate?.rightsBasis === "manual_review_required"
    );
  }

  private publishPolicyBlocks(payload: {
    laneId: string;
    job: ClipBaitersClipJob;
    candidate: ClipBaitersClipCandidate | undefined;
    dryRun: boolean;
    renderReady: boolean;
  }): string[] {
    const blocks: string[] = [];
    const clipDuration = payload.job.clipWindow.endSeconds - payload.job.clipWindow.startSeconds;

    if (!payload.candidate) {
      blocks.push("Candidate metadata is missing for this publish item.");
    }
    if (!payload.job.approvedSourceClass) {
      blocks.push("Approved source class is missing.");
    }
    if (payload.job.approvedSourceClass === "synthetic_story_brief") {
      blocks.push("Synthetic story briefs cannot move into the publish queue.");
    }
    if (clipDuration > 59) {
      blocks.push(`Clip duration ${clipDuration}s exceeds the short-form publish cap.`);
    }
    if (payload.job.transformationReview.tactics.length === 0) {
      blocks.push("Transformation tactics are missing.");
    }
    if (!payload.job.editDecision.attributionText.trim()) {
      blocks.push("Attribution text is missing.");
    }
    if (!payload.job.transformationReview.attributionText.trim()) {
      blocks.push("Transformation review attribution evidence is missing.");
    }
    if (
      payload.candidate?.approvalState === "review_required" ||
      payload.candidate?.rightsBasis === "manual_review_required"
    ) {
      blocks.push("Source approval is still unresolved for publish.");
    }
    if (!payload.dryRun && !payload.renderReady) {
      blocks.push("Rendered MP4 is missing for live publish.");
    }
    if (payload.laneId === "clipbaiters-media" && payload.job.transformationReview.policyRiskScore >= 9) {
      blocks.push("Policy risk remains too high for unattended media-lane publish.");
    }

    return blocks;
  }

  private async ensureReviewGate(
    job: ClipBaitersClipJob,
    candidate: ClipBaitersClipCandidate | undefined,
    channelProfile: SocialProfileRecord | undefined,
    laneName: string
  ): Promise<ClipBaitersPublishManualGate> {
    const task = await this.orchestrator.getAccountOps().createOrUpdateTask(
      {
        id: this.reviewTaskId(job.id),
        type: "compliance",
        actionNeeded: `Review ClipBaiters upload for ${job.workingTitle}`,
        reason: `${laneName} clips stay behind a manual review gate before any YouTube upload is treated as publish-ready.`,
        ownerInstructions: this.reviewInstructions(job, candidate, channelProfile),
        relatedEntityType: "workflow",
        relatedEntityId: job.id
      },
      { reopenCompleted: false }
    );

    return this.toManualGate(task, this.reviewKind(job, candidate));
  }

  private reviewTaskId(jobId: string): string {
    return `approval-clipbaiters-publish-${jobId}`;
  }

  private reviewKind(
    job: ClipBaitersClipJob,
    candidate: ClipBaitersClipCandidate | undefined
  ): ClipBaitersReviewGateKind {
    if (job.laneId === "clipbaiters-political") {
      return "political_sensitivity";
    }
    if (job.reviewRequired || candidate?.rightsBasis === "manual_review_required") {
      return "rights_review";
    }
    return "editorial_review";
  }

  private reviewInstructions(
    job: ClipBaitersClipJob,
    candidate: ClipBaitersClipCandidate | undefined,
    channelProfile: SocialProfileRecord | undefined
  ): string {
    return [
      `Review the clip draft at ${job.outputPackageDir}.`,
      `Confirm the title, description, thumbnail text, and attribution against ${candidate?.sourceUrl ?? job.sourceTitle}.`,
      `Check the source rights basis (${candidate?.rightsBasis ?? job.rightsBasis}), approved source class (${job.approvedSourceClass}), and transformation tactics (${job.transformationReview.tactics.join(", ")}).`,
      channelProfile?.status === "live"
        ? `The target YouTube channel is live at ${channelProfile.profileUrl ?? channelProfile.handle ?? channelProfile.id}.`
        : `The target YouTube channel is still ${channelProfile?.status ?? "missing"}; bring it live before any upload attempt.`,
      job.seriesPart
        ? `Confirm ${job.seriesPart.label} stays in sequence within series ${job.seriesPart.seriesId}.`
        : "Confirm the clip stays as a single short-form item.",
      "Mark this approval completed only after editorial context, attribution, transformation evidence, and lane policy checks are finished."
    ].join(" ");
  }

  private toManualGate(task: ApprovalTask, kind: ClipBaitersReviewGateKind): ClipBaitersPublishManualGate {
    return {
      id: task.id,
      kind,
      status: task.status,
      relatedEntityId: task.relatedEntityId,
      summary: task.actionNeeded,
      instructions: task.ownerInstructions
    };
  }

  private queueItemStatus(
    channelProfile: SocialProfileRecord | undefined,
    gate: ClipBaitersPublishManualGate | undefined,
    reviewRequired: boolean,
    policyBlocks: string[]
  ): ClipBaitersPublishingQueueItem["status"] {
    if (policyBlocks.length > 0) {
      return "blocked";
    }
    if (!channelProfile || channelProfile.status !== "live") {
      return "blocked";
    }
    if (reviewRequired && gate?.status !== "completed") {
      return "awaiting_review";
    }
    return "approved";
  }

  private toQueueItem(payload: {
    businessId: string;
    laneId: string;
    laneName: string;
    job: ClipBaitersClipJob;
    candidate: ClipBaitersClipCandidate | undefined;
    channelProfile: SocialProfileRecord | undefined;
    dryRun: boolean;
    renderReady: boolean;
    policyBlocks: string[];
    scheduledFor: string;
    status: ClipBaitersPublishingQueueItem["status"];
    approvalId?: string;
    reviewRequired: boolean;
  }): ClipBaitersPublishingQueueItem {
    const title = payload.job.headlineOptions[0] ?? payload.job.workingTitle;
    const description = [
      payload.job.description,
      payload.candidate?.sourceUrl ? `Source URL: ${payload.candidate.sourceUrl}` : undefined,
      `Rights basis: ${payload.candidate?.rightsBasis ?? payload.job.rightsBasis}.`,
      `Approved source class: ${payload.candidate?.approvedSourceClass ?? payload.job.approvedSourceClass}.`,
      `Transformation tactics: ${payload.job.transformationReview.tactics.join(", ")}.`,
      "Target surface: YouTube Shorts review queue.",
      payload.dryRun
        ? "Dry run only: no browser upload command was executed."
        : "Only rendered, policy-cleared clips can attempt the YouTube Studio upload helper."
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n\n");
    const thumbnailText = this.thumbnailText(payload.job, payload.laneName);
    const generatedAt = nowIso();

    return {
      id: slugify(`${payload.job.id}-publish`),
      businessId: payload.businessId,
      laneId: payload.laneId,
      laneName: payload.laneName,
      clipJobId: payload.job.id,
      channelProfileId: payload.channelProfile?.id,
      channelHandle: payload.channelProfile?.handle,
      channelStatus: payload.channelProfile?.status ?? "missing",
      dryRun: payload.dryRun,
      status: payload.status,
      reviewRequired: payload.reviewRequired,
      approvalId: payload.approvalId,
      sourceTitle: payload.job.sourceTitle,
      title,
      description,
      tags: this.tags(payload.job, payload.laneName),
      thumbnailText,
      sourceUrl: payload.candidate?.sourceUrl,
      rightsBasis: payload.candidate?.rightsBasis ?? payload.job.rightsBasis,
      approvedSourceClass: payload.candidate?.approvedSourceClass ?? payload.job.approvedSourceClass,
      transformationTactics: payload.job.transformationReview.tactics,
      automationEligible: payload.job.automationEligible,
      renderReady: payload.renderReady,
      renderedVideoPath: payload.renderReady ? payload.job.renderArtifacts.renderedVideoPath : undefined,
      seriesPart: payload.job.seriesPart,
      scheduledFor: payload.scheduledFor,
      createdAt: generatedAt,
      updatedAt: generatedAt,
      notes: [
        ...payload.job.notes,
        payload.channelProfile?.status === "live"
          ? `Resolved live channel ${payload.channelProfile.handle ?? payload.channelProfile.id}.`
          : `Channel is ${payload.channelProfile?.status ?? "missing"}; upload stays blocked until the lane is live on YouTube.`,
        payload.reviewRequired
          ? "Manual editorial review is still required before this upload can move forward."
          : "No lane-level manual review is pending for this upload item.",
        payload.renderReady
          ? `Rendered clip ready at ${payload.job.renderArtifacts.renderedVideoPath}.`
          : payload.dryRun
            ? "Render readiness was not required because this publish pass is dry-run only."
            : "Rendered clip is not ready for live upload yet.",
        ...payload.policyBlocks.map((block) => `Policy block: ${block}`)
      ]
    };
  }

  private thumbnailText(job: ClipBaitersClipJob, laneName: string): string[] {
    const emphasis = job.editDecision.emphasisWords.slice(0, 3).join(" ").toUpperCase();
    return [clipText(job.workingTitle, 48), emphasis || laneName.toUpperCase()];
  }

  private tags(job: ClipBaitersClipJob, laneName: string): string[] {
    return [
      laneName,
      "shorts",
      ...job.editDecision.emphasisWords.slice(0, 4),
      ...job.headlineOptions
        .flatMap((option) => option.split(/\W+/))
        .filter((token) => token.length > 4)
        .slice(0, 4)
    ].map((token) => token.toLowerCase());
  }

  private toUploadBatch(payload: {
    businessId: string;
    laneId: string;
    laneName: string;
    dryRun: boolean;
    channelProfile: SocialProfileRecord | undefined;
    generatedAt: string;
    items: ClipBaitersPublishingQueueItem[];
  }): ClipBaitersUploadBatch {
    const reviewRequiredCount = payload.items.filter((item) => item.reviewRequired).length;
    const approvedCount = payload.items.filter((item) => item.status === "approved").length;
    const liveCount = payload.items.filter((item) => item.status === "live").length;
    const failedCount = payload.items.filter((item) => item.status === "failed").length;
    const publishingCount = payload.items.filter((item) => item.status === "publishing").length;
    const status =
      payload.items.length === 0
        ? "blocked"
        : payload.items.some((item) => item.status === "blocked")
          ? "blocked"
          : reviewRequiredCount > 0
            ? "review_required"
            : liveCount > 0
              ? "live"
              : publishingCount > 0
                ? "publishing"
                : approvedCount > 0
                  ? "approved"
                  : failedCount > 0
                    ? "failed"
                    : "draft";

    return {
      id: slugify(`${payload.businessId}-${payload.laneId}-upload-batch`),
      businessId: payload.businessId,
      laneId: payload.laneId,
      laneName: payload.laneName,
      dryRun: payload.dryRun,
      channelProfileId: payload.channelProfile?.id,
      status,
      queueItemIds: payload.items.map((item) => item.id),
      reviewRequiredCount,
      approvedCount,
      liveCount,
      failedCount,
      scheduledFor: payload.items[0]?.scheduledFor ?? payload.generatedAt,
      createdAt: payload.generatedAt,
      updatedAt: payload.generatedAt,
      notes: [
        payload.dryRun
          ? "Dry run only: upload batch created without calling a browser-backed publishing helper."
          : "Upload batch is prepared for YouTube Studio execution when a rendered MP4 and a live channel are both present.",
        payload.channelProfile?.status === "live"
          ? "The target YouTube channel is marked live in the social registry."
          : "The target YouTube channel is not live yet, so this batch stays blocked."
      ]
    };
  }

  private toReviewMarkdown(
    queueItems: ClipBaitersPublishingQueueItem[],
    uploadBatch: ClipBaitersUploadBatch,
    manualGates: ClipBaitersPublishManualGate[]
  ): string {
    return [
      "# ClipBaiters Review Queue",
      "",
      `Generated at: ${uploadBatch.updatedAt}`,
      `Batch status: ${uploadBatch.status}`,
      `Queue items: ${queueItems.length}`,
      "",
      "## Upload Batch",
      `- Batch id: ${uploadBatch.id}`,
      `- Review required: ${uploadBatch.reviewRequiredCount}`,
      `- Approved: ${uploadBatch.approvedCount}`,
      `- Live: ${uploadBatch.liveCount}`,
      `- Failed: ${uploadBatch.failedCount}`,
      ...uploadBatch.notes.map((note) => `- Note: ${note}`),
      "",
      "## Queue Items",
      ...queueItems.map((item) =>
        [
          `### ${item.title}`,
          `- Status: ${item.status}`,
          `- Channel status: ${item.channelStatus}`,
          ...(item.channelHandle ? [`- Channel handle: ${item.channelHandle}`] : []),
          `- Source: ${item.sourceTitle}`,
          `- Approved source class: ${item.approvedSourceClass}`,
          `- Render ready: ${item.renderReady ? "yes" : "no"}`,
          `- Transformation tactics: ${item.transformationTactics.join(", ")}`,
          ...(item.sourceUrl ? [`- Source URL: ${item.sourceUrl}`] : []),
          `- Scheduled for: ${item.scheduledFor}`,
          `- Thumbnail text: ${item.thumbnailText.join(" | ")}`,
          `- Tags: ${item.tags.join(", ")}`,
          ...item.notes.map((note) => `- Note: ${note}`),
          ""
        ].join("\n")
      ),
      "## Manual Gates",
      ...(manualGates.length > 0
        ? manualGates.map((gate) =>
            [
              `### ${gate.summary}`,
              `- Kind: ${gate.kind}`,
              `- Status: ${gate.status}`,
              `- Related entity: ${gate.relatedEntityId}`,
              `- Instructions: ${gate.instructions}`,
              ""
            ].join("\n")
          )
        : ["- No manual review gates are open for the current batch.", ""])
    ].join("\n");
  }

  private toAggregateReviewMarkdown(results: LanePublishComputation[]): string {
    return [
      "# ClipBaiters Review Queue",
      "",
      `Generated at: ${nowIso()}`,
      `Lanes: ${results.map((result) => result.laneName).join(", ")}`,
      "",
      ...results.flatMap((result) => [
        `## ${result.laneName}`,
        `- Queue items: ${result.queueItems.length}`,
        `- Batch status: ${result.uploadBatches.batches[0]?.status ?? "blocked"}`,
        `- Review gates: ${result.manualGates.length}`,
        ...(result.queueItems.length > 0
          ? result.queueItems.flatMap((item) => [
              `### ${item.title}`,
              `- Status: ${item.status}`,
              `- Channel status: ${item.channelStatus}`,
              `- Source: ${item.sourceTitle}`,
              `- Approved source class: ${item.approvedSourceClass}`,
              `- Render ready: ${item.renderReady ? "yes" : "no"}`,
              ...item.notes.map((note) => `- Note: ${note}`),
              ""
            ])
          : ["- No queue items were generated.", ""]),
        ...(result.manualGates.length > 0
          ? result.manualGates.map((gate) => `- Gate: ${gate.summary} (${gate.status})`)
          : ["- No manual review gates are open for this lane."]),
        ""
      ])
    ].join("\n");
  }

  private toSnapshot(payload: {
    businessId: string;
    businessName: string;
    laneId: string;
    laneName: string;
    dryRun: boolean;
    channelProfile: SocialProfileRecord | undefined;
    queueItems: ClipBaitersPublishingQueueItem[];
    manualGates: ClipBaitersPublishManualGate[];
    reviewQueuePath: string;
    uploadBatchesPath: string;
    channelMetricsPath: string;
  }): ClipBaitersPublishSnapshot {
    const reviewRequiredCount = payload.queueItems.filter((item) => item.reviewRequired).length;
    const approvedCount = payload.queueItems.filter((item) => item.status === "approved").length;
    const liveCount = payload.queueItems.filter((item) => item.status === "live").length;
    const failedCount = payload.queueItems.filter((item) => item.status === "failed").length;
    const channelStatus = payload.channelProfile?.status ?? "missing";
    const status =
      payload.queueItems.length === 0 || payload.queueItems.some((item) => item.status === "blocked")
        ? "blocked"
        : reviewRequiredCount > 0
          ? "review_gated"
          : "ready";

    const summary =
      status === "blocked"
        ? `${payload.laneName} publishing queue is blocked until the YouTube channel is live, rendered clips exist for uploadable lanes, and any remaining review gates are cleared.`
        : status === "review_gated"
          ? `${payload.laneName} publishing queued ${payload.queueItems.length} clip(s) and is waiting on ${reviewRequiredCount} manual review gate(s).`
          : `${payload.laneName} publishing queued ${payload.queueItems.length} approved clip(s) for the next upload batch.`;

    const nextStep =
      status === "blocked"
        ? `Bring the target YouTube channel live in runtime/state/socialProfiles.json, confirm a rendered MP4 exists for uploadable lanes, then review ${payload.reviewQueuePath} before rerunning the publish command.`
        : status === "review_gated"
          ? `Complete the open review approvals, then rerun the publish command to refresh ${payload.uploadBatchesPath}.`
          : payload.dryRun
            ? `Review ${payload.uploadBatchesPath} and ${payload.channelMetricsPath}, then rerun without --dry-run on an eligible lane when the upload helper and rendered clips are ready.`
            : `Use the approved upload batch as the live YouTube Studio handoff for uploadable lanes and keep high-risk lanes review-gated.`;

    return {
      businessId: payload.businessId,
      businessName: payload.businessName,
      laneId: payload.laneId,
      laneName: payload.laneName,
      generatedAt: nowIso(),
      status,
      dryRun: payload.dryRun,
      queueItemCount: payload.queueItems.length,
      reviewRequiredCount,
      approvedCount,
      liveCount,
      failedCount,
      channelProfileId: payload.channelProfile?.id,
      channelStatus,
      manualGates: payload.manualGates,
      summary,
      nextStep,
      artifactPaths: [payload.reviewQueuePath, payload.uploadBatchesPath, payload.channelMetricsPath]
    };
  }

  private toAggregateSnapshot(payload: {
    businessId: string;
    businessName: string;
    dryRun: boolean;
    laneResults: LanePublishComputation[];
    reviewQueuePath: string;
    uploadBatchesPath: string;
    channelMetricsPath: string;
    dailySummaryPath: string;
  }): ClipBaitersPublishSnapshot {
    const queueItems = payload.laneResults.flatMap((result) => result.queueItems);
    const manualGates = payload.laneResults.flatMap((result) => result.manualGates);
    const hasMissingChannel = payload.laneResults.some((result) => !result.channelProfile);
    const channelStatus = payload.laneResults.every((result) => result.channelProfile?.status === "live")
      ? "live"
      : hasMissingChannel
        ? "missing"
        : payload.laneResults[0]?.channelProfile?.status ?? "missing";
    const reviewRequiredCount = queueItems.filter((item) => item.reviewRequired).length;
    const approvedCount = queueItems.filter((item) => item.status === "approved").length;
    const liveCount = queueItems.filter((item) => item.status === "live").length;
    const failedCount = queueItems.filter((item) => item.status === "failed").length;
    const status =
      queueItems.length === 0 || queueItems.some((item) => item.status === "blocked")
        ? "blocked"
        : reviewRequiredCount > 0
          ? "review_gated"
          : "ready";

    return {
      businessId: payload.businessId,
      businessName: payload.businessName,
      laneId: "all-active-lanes",
      laneName: "All Active Lanes",
      generatedAt: nowIso(),
      status,
      dryRun: payload.dryRun,
      queueItemCount: queueItems.length,
      reviewRequiredCount,
      approvedCount,
      liveCount,
      failedCount,
      channelStatus,
      manualGates,
      summary: `ClipBaiters publishing refreshed ${queueItems.length} queued clip(s) across ${payload.laneResults.length} active lane(s).`,
      nextStep:
        status === "blocked"
          ? `Review ${payload.dailySummaryPath} and ${payload.reviewQueuePath} to clear blocked lanes before another publish pass.`
          : status === "review_gated"
            ? `Complete the open review gates, then rerun the all-active-lanes publish pass.`
            : `Review the aggregate upload batches and publish history for live-uploadable streaming clips while keeping risky lanes gated.`,
      artifactPaths: [
        payload.reviewQueuePath,
        payload.uploadBatchesPath,
        payload.channelMetricsPath,
        payload.dailySummaryPath
      ]
    };
  }

  private emptyBatch(
    businessId: string,
    laneId: string,
    laneName: string,
    dryRun: boolean
  ): ClipBaitersUploadBatch {
    const generatedAt = nowIso();
    return {
      id: slugify(`${businessId}-${laneId}-upload-batch`),
      businessId,
      laneId,
      laneName,
      dryRun,
      status: "blocked",
      queueItemIds: [],
      reviewRequiredCount: 0,
      approvedCount: 0,
      liveCount: 0,
      failedCount: 0,
      scheduledFor: generatedAt,
      createdAt: generatedAt,
      updatedAt: generatedAt,
      notes: ["No queue items were available for this lane."]
    };
  }

  private async maybeAttemptLiveUpload(payload: {
    queueItem: ClipBaitersPublishingQueueItem;
    job: ClipBaitersClipJob;
    channelProfile: SocialProfileRecord | undefined;
    dryRun: boolean;
  }): Promise<{
    queueStatus: ClipBaitersPublishingQueueItem["status"];
    historyStatus: ClipBaitersPublishHistoryEntry["status"];
    command?: string;
    videoUrl?: string;
    publishedAt?: string;
    notes: string[];
  }> {
    if (payload.dryRun) {
      return {
        queueStatus: payload.queueItem.status,
        historyStatus: "skipped",
        notes: ["Dry run only: no live upload attempt was made."]
      };
    }
    if (payload.queueItem.status !== "approved") {
      return {
        queueStatus: payload.queueItem.status,
        historyStatus: payload.queueItem.status === "blocked" ? "blocked" : "skipped",
        notes: ["Upload attempt skipped because the queue item is not yet approved."]
      };
    }
    if (!this.config.clipbaiters.activeLaneIds.includes(payload.queueItem.laneId)) {
      return {
        queueStatus: payload.queueItem.status,
        historyStatus: "skipped",
        notes: ["Only the currently active ClipBaiters YouTube lanes are eligible for controlled live upload in the current phase."]
      };
    }
    if (!payload.channelProfile || payload.channelProfile.status !== "live") {
      return {
        queueStatus: "blocked",
        historyStatus: "blocked",
        notes: ["The target channel is not live, so the YouTube Studio upload helper was not invoked."]
      };
    }

    const videoPath = path.join(payload.job.outputPackageDir, `${payload.job.id}.mp4`);
    const uploadScriptPath = path.join(this.config.projectRoot, "scripts", "youtube_studio_upload.py");
    const metadataPath = path.join(payload.job.outputPackageDir, "upload-metadata.json");
    const args = [
      uploadScriptPath,
      "--video",
      videoPath,
      "--metadata",
      metadataPath,
      ...(payload.channelProfile.profileUrl ? ["--channel-url", payload.channelProfile.profileUrl] : []),
      ...(payload.channelProfile.handle ? ["--channel-handle", payload.channelProfile.handle] : [])
    ];
    const command = ["python3", ...args].join(" ");

    await writeJsonFile(metadataPath, {
      queueItemId: payload.queueItem.id,
      title: payload.queueItem.title,
      description: payload.queueItem.description,
      tags: payload.queueItem.tags,
      scheduledFor: payload.queueItem.scheduledFor,
      channelHandle: payload.channelProfile.handle,
      channelUrl: payload.channelProfile.profileUrl
    });

    if (!(await exists(uploadScriptPath))) {
      return {
        queueStatus: "blocked",
        historyStatus: "blocked",
        command,
        notes: ["scripts/youtube_studio_upload.py is missing, so live upload could not start."]
      };
    }
    if (!(await exists(videoPath))) {
      return {
        queueStatus: "blocked",
        historyStatus: "blocked",
        command,
        notes: [`Rendered video ${videoPath} is missing, so live upload could not start.`]
      };
    }

    return new Promise((resolve) => {
      const child = spawn("python3", args, {
        cwd: this.config.projectRoot,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        resolve({
          queueStatus: "failed",
          historyStatus: "failed",
          command,
          notes: [`Upload helper failed to start: ${error.message}`]
        });
      });
      child.on("close", (code) => {
        if (code !== 0) {
          resolve({
            queueStatus: "failed",
            historyStatus: "failed",
            command,
            notes: [stderr.trim() || stdout.trim() || "Upload helper exited with a failure status."]
          });
          return;
        }

        try {
          const parsed = JSON.parse(stdout || "{}") as {
            status?: string;
            videoUrl?: string;
            publishedAt?: string;
            notes?: string[];
          };
          resolve({
            queueStatus: parsed.status === "live" ? "live" : "publishing",
            historyStatus: parsed.status === "live" ? "live" : "publishing",
            command,
            videoUrl: parsed.videoUrl,
            publishedAt: parsed.publishedAt,
            notes: parsed.notes ?? ["Upload helper completed without additional notes."]
          });
        } catch {
          resolve({
            queueStatus: "publishing",
            historyStatus: "publishing",
            command,
            notes: ["Upload helper completed but did not return structured JSON; treating the upload as in progress."]
          });
        }
      });
    });
  }

  private toPublishHistoryEntry(payload: {
    businessId: string;
    laneId: string;
    queueItemId: string;
    clipJobId: string;
    status: ClipBaitersPublishHistoryEntry["status"];
    command?: string;
    publishedAt?: string;
    notes: string[];
  }): ClipBaitersPublishHistoryEntry {
    return {
      id: slugify(`${payload.queueItemId}-publish-history`),
      businessId: payload.businessId,
      laneId: payload.laneId,
      queueItemId: payload.queueItemId,
      clipJobId: payload.clipJobId,
      status: payload.status,
      command: payload.command,
      publishedAt: payload.publishedAt,
      createdAt: nowIso(),
      notes: payload.notes
    };
  }

  private async writePublishHistory(
    publishHistoryPath: string,
    businessId: string,
    entries: ClipBaitersPublishHistoryEntry[]
  ): Promise<ClipBaitersPublishHistoryState> {
    const existing = await readJsonFile<ClipBaitersPublishHistoryState>(publishHistoryPath, {
      businessId,
      generatedAt: nowIso(),
      entries: []
    });
    const state: ClipBaitersPublishHistoryState = {
      businessId,
      generatedAt: nowIso(),
      entries: mergeById(existing.entries, entries)
    };
    await writeJsonFile(publishHistoryPath, state);
    return state;
  }

  private toDailySummary(payload: {
    businessName: string;
    laneResults: LanePublishComputation[];
    channelMetrics: ClipBaitersChannelMetricsState;
    publishHistory: ClipBaitersPublishHistoryState;
    creatorLeadCount: number;
    creatorOutreachDraftCount: number;
  }): string {
    return [
      "# ClipBaiters Daily Summary",
      "",
      `Generated at: ${nowIso()}`,
      `Business: ${payload.businessName}`,
      "",
      "## Lane Stages",
      ...payload.laneResults.flatMap((result) => {
        const liveCount = result.queueItems.filter((item) => item.status === "live").length;
        const uploadableCount = result.queueItems.filter((item) => item.status === "approved").length;
        return [
          `### ${result.laneName}`,
          "- Collect: source collection already refreshed into watchlists and discovery.",
          "- Skim: ranked skim summaries already feed the radar state.",
          `- Draft: ${result.queueItems.length} queue item(s) sourced from the current draft jobs.`,
          `- Review: ${result.manualGates.length} manual gate(s).`,
          `- Upload: ${uploadableCount} approved item(s), ${liveCount} live item(s).`,
          ""
        ];
      }),
      "## Creator Deals",
      `- Leads tracked: ${payload.creatorLeadCount}`,
      `- Outreach drafts: ${payload.creatorOutreachDraftCount}`,
      "",
      "## Queue Metrics",
      ...payload.channelMetrics.profiles.map((profile) =>
        `- ${profile.laneName}: approved ${profile.approvedCount}, live ${profile.liveCount}, review ${profile.reviewRequiredCount}`
      ),
      "",
      "## Upload History",
      `- Entries tracked: ${payload.publishHistory.entries.length}`,
      `- Live uploads: ${payload.publishHistory.entries.filter((entry) => entry.status === "live").length}`,
      `- Failed uploads: ${payload.publishHistory.entries.filter((entry) => entry.status === "failed").length}`,
      ""
    ].join("\n");
  }
}