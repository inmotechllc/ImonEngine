import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import type {
  ClipBaitersDiscoveredVideo,
  ClipBaitersRightsBasis,
  ClipBaitersSourceRecord,
  ClipBaitersSourceRegistry,
  ClipBaitersSourceType,
  ClipBaitersSourceWatchlist,
  ClipBaitersSourceWatchlistState,
  ClipBaitersVideoDiscoveryState
} from "../domain/clipbaiters.js";
import type { SocialProfileRecord } from "../domain/social.js";
import { ensureDir, readJsonFile, writeJsonFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { FileStore } from "../storage/store.js";
import { ClipBaitersStudioService } from "./clipbaiters-studio.js";

const CLIPBAITERS_BUSINESS_ID = "clipbaiters-viral-moments";

type ManualSourceManifest = {
  id: string;
  businessId: string;
  laneId: string;
  title: string;
  sourceUrl?: string;
  rightsBasis: ClipBaitersRightsBasis;
  sourceType: ClipBaitersSourceType;
  transcriptText?: string;
  notes: string[];
  isLive: boolean;
  isUpcoming: boolean;
};

function nowIso(): string {
  return new Date().toISOString();
}

function clipText(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

function mergeById<T extends { id: string }>(existing: T[], next: T[]): T[] {
  const merged = new Map(existing.map((item) => [item.id, item] as const));
  for (const item of next) {
    merged.set(item.id, item);
  }
  return Array.from(merged.values()).sort((left, right) => left.id.localeCompare(right.id));
}

function watchlistKindForSource(sourceType: ClipBaitersSourceType): ClipBaitersSourceWatchlist["kind"] {
  switch (sourceType) {
    case "official_youtube":
    case "creator_authorized_channel":
      return "youtube_channel";
    case "official_calendar":
      return "official_calendar";
    case "manual_creator_brief":
      return "manual_brief";
    case "licensed_media_feed":
    case "press_junket_feed":
      return "licensed_feed";
    default:
      return "news_discovery";
  }
}

function normalizeRightsBasis(value: unknown): ClipBaitersRightsBasis {
  switch (value) {
    case "official_government":
    case "creator_authorized":
    case "official_promo":
    case "licensed":
      return value;
    default:
      return "manual_review_required";
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function sourceStatusFor(
  activeLaneIds: Set<string>,
  source: ClipBaitersSourceRecord
): ClipBaitersSourceWatchlist["status"] {
  if (source.status === "gated") {
    return "gated";
  }
  return activeLaneIds.has(source.laneId) ? "active" : "passive";
}

function discoverySummaryFor(
  laneName: string,
  source: ClipBaitersSourceRecord,
  watchlist: ClipBaitersSourceWatchlist
): string {
  switch (watchlist.kind) {
    case "youtube_channel":
      return `${laneName} should watch ${source.name} for new or live moments that can be skimmed before any heavier clip workflow runs.`;
    case "official_calendar":
      return `${source.name} exposes a scheduled event surface that can be queued for same-day skimming and commentary framing.`;
    case "manual_brief":
      return `${source.name} represents manual creator context and should outrank generic trend discovery when a brief is present.`;
    case "licensed_feed":
      return `${source.name} stays rights-aware and should only produce skims from approved official or licensed surfaces.`;
    default:
      return `${source.name} is a discovery-only feed for ${laneName}; use it to find context, then confirm the actual source before clipping.`;
  }
}

export class ClipBaitersCollectorService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {}

  async collect(options?: {
    businessId?: string;
    laneId?: string;
  }): Promise<{
    status: "blocked" | "ready";
    summary: string;
    watchlistState: ClipBaitersSourceWatchlistState;
    discoveryState: ClipBaitersVideoDiscoveryState;
    artifacts: {
      sourceWatchlistsPath: string;
      videoDiscoveryPath: string;
    };
  }> {
    const businessId = options?.businessId ?? CLIPBAITERS_BUSINESS_ID;
    const studio = new ClipBaitersStudioService(this.config, this.store);
    const { plan } = await studio.writePlan({ businessId });
    const business = await this.store.getManagedBusiness(businessId);
    if (!business) {
      throw new Error(`Managed business ${businessId} was not found.`);
    }

    const activeLaneIds = new Set(
      options?.laneId ? [options.laneId] : plan.laneRegistry.activeLaneIds
    );
    const socialProfiles = await this.store.getSocialProfiles();
    const sourceFeedDirectory = path.join(this.config.outputDir, "source-feeds", "clipbaiters", businessId);
    const stateDirectory = path.join(this.config.stateDir, "clipbaiters", businessId);
    const sourceWatchlistsPath = path.join(stateDirectory, "source-watchlists.json");
    const videoDiscoveryPath = path.join(stateDirectory, "video-discovery.json");
    await Promise.all([ensureDir(sourceFeedDirectory), ensureDir(stateDirectory)]);

    const manualManifests = await this.loadManualManifests(sourceFeedDirectory, activeLaneIds);
    const nextWatchlists = this.buildWatchlists({
      businessId,
      sourceRegistry: plan.sourceRegistry,
      socialProfiles,
      activeLaneIds
    });
    const nextDiscovery = this.buildDiscovery({
      businessId,
      businessName: business.name,
      sourceRegistry: plan.sourceRegistry,
      watchlists: nextWatchlists,
      manualManifests
    });

    const existingWatchlists = await readJsonFile<ClipBaitersSourceWatchlistState>(sourceWatchlistsPath, {
      businessId,
      generatedAt: nowIso(),
      watchlists: []
    });
    const existingDiscovery = await readJsonFile<ClipBaitersVideoDiscoveryState>(videoDiscoveryPath, {
      businessId,
      generatedAt: nowIso(),
      videos: []
    });

    const watchlistState: ClipBaitersSourceWatchlistState = {
      businessId,
      generatedAt: nowIso(),
      watchlists: mergeById(existingWatchlists.watchlists, nextWatchlists)
    };
    const discoveryState: ClipBaitersVideoDiscoveryState = {
      businessId,
      generatedAt: nowIso(),
      videos: mergeById(existingDiscovery.videos, nextDiscovery)
    };

    await writeJsonFile(sourceWatchlistsPath, watchlistState);
    await writeJsonFile(videoDiscoveryPath, discoveryState);

    const scopedDiscovery = discoveryState.videos.filter((video) => activeLaneIds.has(video.laneId));

    return {
      status: scopedDiscovery.length > 0 ? "ready" : "blocked",
      summary:
        scopedDiscovery.length > 0
          ? `ClipBaiters collection refreshed ${scopedDiscovery.length} discovery item(s) across ${activeLaneIds.size} lane(s).`
          : "ClipBaiters collection did not find any source-backed discovery items.",
      watchlistState,
      discoveryState,
      artifacts: {
        sourceWatchlistsPath,
        videoDiscoveryPath
      }
    };
  }

  private buildWatchlists(payload: {
    businessId: string;
    sourceRegistry: ClipBaitersSourceRegistry;
    socialProfiles: SocialProfileRecord[];
    activeLaneIds: Set<string>;
  }): ClipBaitersSourceWatchlist[] {
    const youtubeProfilesByLane = new Map(
      payload.socialProfiles
        .filter(
          (profile) =>
            profile.businessId === payload.businessId &&
            profile.platform === "youtube_channel" &&
            Boolean(profile.laneId)
        )
        .map((profile) => [profile.laneId!, profile] as const)
    );

    return uniqueById(
      payload.sourceRegistry.sources.map((source) => {
        const laneProfile = youtubeProfilesByLane.get(source.laneId);
        const kind = watchlistKindForSource(source.sourceType);
        return {
          id: slugify(`${payload.businessId}-${source.id}-watchlist`),
          businessId: payload.businessId,
          laneId: source.laneId,
          sourceId: source.id,
          name: source.name,
          kind,
          sourceType: source.sourceType,
          sourceUrl:
            kind === "youtube_channel"
              ? laneProfile?.profileUrl ?? source.sourceUrl
              : source.sourceUrl,
          externalId: kind === "youtube_channel" ? laneProfile?.externalId : undefined,
          status: sourceStatusFor(payload.activeLaneIds, source),
          notes: uniqueById(
            source.notes.map((note, index) => ({ id: `${source.id}-${index}`, note }))
          ).map((item) => item.note)
        };
      })
    );
  }

  private buildDiscovery(payload: {
    businessId: string;
    businessName: string;
    sourceRegistry: ClipBaitersSourceRegistry;
    watchlists: ClipBaitersSourceWatchlist[];
    manualManifests: ManualSourceManifest[];
  }): ClipBaitersDiscoveredVideo[] {
    const sourceById = new Map(payload.sourceRegistry.sources.map((source) => [source.id, source] as const));
    const discoveriesFromWatchlists = payload.watchlists
      .filter((watchlist) => watchlist.status !== "gated")
      .map((watchlist, index) => {
        const source = sourceById.get(watchlist.sourceId)!;
        return {
          id: slugify(`${watchlist.id}-discovery`),
          businessId: payload.businessId,
          laneId: watchlist.laneId,
          sourceId: watchlist.sourceId,
          watchlistId: watchlist.id,
          title: this.discoveryTitle(source, watchlist),
          summary: discoverySummaryFor(
            this.laneNameForSource(payload.sourceRegistry, source),
            source,
            watchlist
          ),
          sourceUrl: watchlist.sourceUrl,
          videoUrl: watchlist.kind === "youtube_channel" ? watchlist.sourceUrl : undefined,
          rightsBasis: source.rightsBasis,
          sourceType: source.sourceType,
          discoveredAt: nowIso(),
          publishedAt: this.discoveryPublishedAt(watchlist.kind, index),
          isLive: watchlist.kind === "youtube_channel",
          isUpcoming: watchlist.kind === "official_calendar" || watchlist.sourceType === "official_youtube",
          status: watchlist.status === "active" ? "queued_for_skim" : "watching",
          notes: [
            ...watchlist.notes,
            `Discovery feed anchored to ${watchlist.name}.`,
            watchlist.status === "active"
              ? "This watchlist is active and should flow into the skim queue."
              : "This watchlist is passive and should stay out of the autonomous publish cadence until activated."
          ]
        } satisfies ClipBaitersDiscoveredVideo;
      });

    const discoveriesFromManualManifests = payload.manualManifests.map((manifest) => ({
      id: slugify(`${manifest.id}-discovery`),
      businessId: payload.businessId,
      laneId: manifest.laneId,
      sourceId: slugify(`${manifest.laneId}-manual-source`),
      watchlistId: slugify(`${manifest.id}-manual-watchlist`),
      title: manifest.title,
      summary: clipText(manifest.transcriptText ?? manifest.notes[0] ?? `${payload.businessName} manual source feed item.`, 200),
      sourceUrl: manifest.sourceUrl,
      videoUrl: manifest.sourceUrl,
      rightsBasis: manifest.rightsBasis,
      sourceType: manifest.sourceType,
      discoveredAt: nowIso(),
      publishedAt: nowIso(),
      isLive: manifest.isLive,
      isUpcoming: manifest.isUpcoming,
      status: "queued_for_skim" as const,
      notes: [
        ...manifest.notes,
        "Manual source manifest detected in the ClipBaiters source-feeds directory."
      ]
    }));

    return uniqueById([...discoveriesFromManualManifests, ...discoveriesFromWatchlists]);
  }

  private discoveryTitle(
    source: ClipBaitersSourceRecord,
    watchlist: ClipBaitersSourceWatchlist
  ): string {
    switch (watchlist.kind) {
      case "youtube_channel":
        return `${source.name} watch window`;
      case "official_calendar":
        return `${source.name} upcoming official event`;
      case "manual_brief":
        return `${source.name} creator brief queue`;
      case "licensed_feed":
        return `${source.name} licensed surface check`;
      default:
        return `${source.name} discovery feed`;
    }
  }

  private discoveryPublishedAt(kind: ClipBaitersSourceWatchlist["kind"], index: number): string | undefined {
    const now = new Date();
    if (kind === "official_calendar") {
      return new Date(now.getTime() + (index + 1) * 60 * 60 * 1000).toISOString();
    }
    return now.toISOString();
  }

  private laneNameForSource(registry: ClipBaitersSourceRegistry, source: ClipBaitersSourceRecord): string {
    return (
      registry.sources.find((candidate) => candidate.id === source.id)?.laneId ?? source.laneId
    );
  }

  private async loadManualManifests(
    sourceFeedDirectory: string,
    laneIds: Set<string>
  ): Promise<ManualSourceManifest[]> {
    const entries = await readdir(sourceFeedDirectory, { withFileTypes: true });
    const manifests: ManualSourceManifest[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const filePath = path.join(sourceFeedDirectory, entry.name);
      const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
      const records = Array.isArray(raw) ? raw : [raw];
      for (const record of records) {
        const manifest = this.normalizeManualManifest(record, entry.name);
        if (manifest && laneIds.has(manifest.laneId)) {
          manifests.push(manifest);
        }
      }
    }

    return manifests;
  }

  private normalizeManualManifest(raw: unknown, sourceFileName: string): ManualSourceManifest | null {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const record = raw as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const laneId = typeof record.laneId === "string" ? record.laneId.trim() : "";
    if (!title || !laneId) {
      return null;
    }

    const notes = asStringArray(record.notes);
    const mediaType = typeof record.mediaType === "string" ? record.mediaType : undefined;
    return {
      id:
        typeof record.id === "string" && record.id.trim().length > 0
          ? record.id
          : slugify(`${laneId}-${sourceFileName}-${title}`),
      businessId: CLIPBAITERS_BUSINESS_ID,
      laneId,
      title,
      sourceUrl: typeof record.sourceUrl === "string" ? record.sourceUrl.trim() : undefined,
      rightsBasis: normalizeRightsBasis(record.rightsBasis),
      sourceType:
        mediaType === "live_stream"
          ? "official_youtube"
          : mediaType === "video"
            ? "official_youtube"
            : typeof record.sourceType === "string"
              ? (record.sourceType as ClipBaitersSourceType)
              : "manual_creator_brief",
      transcriptText:
        typeof record.transcriptText === "string" ? record.transcriptText.trim() : undefined,
      notes,
      isLive: mediaType === "live_stream",
      isUpcoming: mediaType === "schedule"
    };
  }
}