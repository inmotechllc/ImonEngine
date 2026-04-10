import path from "node:path";
import type { AppConfig } from "../config.js";
import type { SocialProfileRecord } from "../domain/social.js";
import type {
  ClipBaitersChannelMetricProfile,
  ClipBaitersChannelMetricsState,
  ClipBaitersPublishingQueueItem,
  ClipBaitersUploadBatch
} from "../domain/clipbaiters.js";
import { ensureDir, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { FileStore } from "../storage/store.js";

function nowIso(): string {
  return new Date().toISOString();
}

export class ClipBaitersAnalyticsService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {}

  async capture(payload: {
    businessId: string;
    laneId?: string;
    laneName?: string;
    queue: ClipBaitersPublishingQueueItem[];
    batches: ClipBaitersUploadBatch[];
  }): Promise<{
    state: ClipBaitersChannelMetricsState;
    artifacts: {
      channelMetricsPath: string;
      channelMetricsMarkdownPath: string;
    };
  }> {
    const stateDirectory = path.join(this.config.stateDir, "clipbaiters", payload.businessId);
    const opsDirectory = path.join(this.config.opsDir, "clipbaiters", payload.businessId);
    const channelMetricsPath = path.join(stateDirectory, "channel-metrics.json");
    const channelMetricsMarkdownPath = path.join(opsDirectory, "channel-metrics.md");
    await Promise.all([ensureDir(stateDirectory), ensureDir(opsDirectory)]);

    const profiles = await this.store.getSocialProfiles();
    const laneGroups = payload.laneId
      ? [
          {
            laneId: payload.laneId,
            laneName: payload.laneName ?? payload.laneId,
            queue: payload.queue.filter((item) => item.laneId === payload.laneId)
          }
        ]
      : Array.from(
          payload.queue.reduce((groups, item) => {
            const existing = groups.get(item.laneId) ?? {
              laneId: item.laneId,
              laneName: item.laneName,
              queue: [] as ClipBaitersPublishingQueueItem[]
            };
            existing.queue.push(item);
            groups.set(item.laneId, existing);
            return groups;
          }, new Map<string, { laneId: string; laneName: string; queue: ClipBaitersPublishingQueueItem[] }>()).values()
        );

    const analyticsProfiles = laneGroups.flatMap((group) => {
      const laneProfiles = profiles.filter(
        (profile) =>
          profile.businessId === payload.businessId &&
          profile.platform === "youtube_channel" &&
          profile.laneId === group.laneId
      );
      return laneProfiles.length > 0
        ? laneProfiles.map((profile) => this.toMetricProfile(profile, group.queue, group.laneName))
        : [this.toFallbackMetricProfile(group.queue, group.laneId, group.laneName)];
    });

    const state: ClipBaitersChannelMetricsState = {
      businessId: payload.businessId,
      generatedAt: nowIso(),
      profiles: analyticsProfiles
    };

    await writeJsonFile(channelMetricsPath, state);
    await writeTextFile(channelMetricsMarkdownPath, this.toMarkdown(state, payload.batches));

    return {
      state,
      artifacts: {
        channelMetricsPath,
        channelMetricsMarkdownPath
      }
    };
  }

  private toMetricProfile(
    profile: SocialProfileRecord,
    queue: ClipBaitersPublishingQueueItem[],
    laneName: string
  ): ClipBaitersChannelMetricProfile {
    const scopedQueue = queue.filter((item) => item.channelProfileId === profile.id);
    return this.buildProfileSnapshot(
      {
        profileId: profile.id,
        platform: "youtube_channel",
        laneId: profile.laneId ?? scopedQueue[0]?.laneId ?? "",
        laneName,
        handleOrProfile: profile.handle ?? profile.profileUrl ?? profile.id
      },
      scopedQueue
    );
  }

  private toFallbackMetricProfile(
    queue: ClipBaitersPublishingQueueItem[],
    laneId: string,
    laneName: string
  ): ClipBaitersChannelMetricProfile {
    return this.buildProfileSnapshot(
      {
        platform: "youtube_channel",
        laneId,
        laneName,
        handleOrProfile: "unassigned-youtube-channel"
      },
      queue
    );
  }

  private buildProfileSnapshot(
    identity: Pick<
      ClipBaitersChannelMetricProfile,
      "profileId" | "platform" | "laneId" | "laneName" | "handleOrProfile"
    >,
    queue: ClipBaitersPublishingQueueItem[]
  ): ClipBaitersChannelMetricProfile {
    const policyEventCount = queue.filter((item) =>
      item.notes.some((note) => /claim|strike|policy/i.test(note))
    ).length;

    return {
      ...identity,
      queuedCount: queue.filter((item) => item.status === "blocked").length,
      scheduledCount: queue.filter((item) => Boolean(item.scheduledWindowLabel)).length,
      reviewRequiredCount: queue.filter((item) => item.reviewRequired).length,
      approvedCount: queue.filter((item) => item.status === "approved").length,
      renderReadyCount: queue.filter((item) => item.renderReady).length,
      liveCount: queue.filter((item) => item.status === "live").length,
      failedCount: queue.filter((item) => item.status === "failed").length,
      policyEventCount,
      watchTimeHours: 0,
      subscriberDelta: 0,
      lastPublishedAt: queue
        .map((item) => item.publishedAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1),
      nextScheduledFor: queue
        .filter((item) => Boolean(item.scheduledWindowLabel) && item.status !== "live" && item.status !== "failed")
        .map((item) => item.scheduledFor)
        .sort()
        .at(0),
      notes: [
        "Live YouTube analytics are not imported yet; counts reflect the repo-managed publish queue.",
        policyEventCount > 0
          ? `${policyEventCount} queue item(s) reference policy, claim, or strike notes.`
          : "No claim or strike events are recorded in the current queue state."
      ]
    };
  }

  private toMarkdown(state: ClipBaitersChannelMetricsState, batches: ClipBaitersUploadBatch[]): string {
    return [
      "# ClipBaiters Channel Metrics",
      "",
      `Generated at: ${state.generatedAt}`,
      `Upload batches: ${batches.length}`,
      "",
      ...state.profiles.map((profile) =>
        [
          `## ${profile.laneName} · ${profile.handleOrProfile}`,
          `- Platform: ${profile.platform}`,
          `- Queued: ${profile.queuedCount}`,
          `- Scheduled: ${profile.scheduledCount}`,
          `- Awaiting review: ${profile.reviewRequiredCount}`,
          `- Approved: ${profile.approvedCount}`,
          `- Render ready: ${profile.renderReadyCount}`,
          `- Live: ${profile.liveCount}`,
          `- Failed: ${profile.failedCount}`,
          `- Policy events: ${profile.policyEventCount}`,
          `- Watch time hours: ${profile.watchTimeHours}`,
          `- Subscriber delta: ${profile.subscriberDelta}`,
          ...(profile.lastPublishedAt ? [`- Last published at: ${profile.lastPublishedAt}`] : []),
          ...(profile.nextScheduledFor ? [`- Next scheduled for: ${profile.nextScheduledFor}`] : []),
          ...profile.notes.map((note) => `- Note: ${note}`),
          ""
        ].join("\n")
      )
    ].join("\n");
  }
}