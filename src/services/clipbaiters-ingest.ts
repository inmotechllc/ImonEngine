import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import type {
  ClipBaitersApprovedSourceClass,
  ClipBaitersClipCandidate,
  ClipBaitersClipCandidateState,
  ClipBaitersClipMoment,
  ClipBaitersLaneRadarSnapshot,
  ClipBaitersLaneStoryBatch,
  ClipBaitersRightsBasis,
  ClipBaitersSourceFeedManifest,
  ClipBaitersToolCommandPreview,
  ClipBaitersTransformationReview,
  ClipBaitersTranscriptSegment
} from "../domain/clipbaiters.js";
import { ensureDir, writeJsonFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { FileStore } from "../storage/store.js";
import { ClipBaitersRadarService } from "./clipbaiters-radar.js";

const CLIPBAITERS_BUSINESS_ID = "clipbaiters-viral-moments";
const RIGHTS_BASIS_VALUES: ClipBaitersRightsBasis[] = [
  "official_government",
  "creator_authorized",
  "official_promo",
  "licensed",
  "manual_review_required"
];
const MAX_CLIP_DURATION_SECONDS = 57;

function nowIso(): string {
  return new Date().toISOString();
}

function toSentenceFragments(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((fragment) => fragment.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function clipText(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizeRightsBasis(value: unknown, fallback: ClipBaitersRightsBasis): ClipBaitersRightsBasis {
  return typeof value === "string" && RIGHTS_BASIS_VALUES.includes(value as ClipBaitersRightsBasis)
    ? (value as ClipBaitersRightsBasis)
    : fallback;
}

function laneScopedPath(filePath: string, laneId: string): string {
  const extension = path.extname(filePath);
  const basename = path.basename(filePath, extension);
  return path.join(path.dirname(filePath), `${basename}-${laneId}${extension}`);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export class ClipBaitersIngestService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {}

  async prepare(options?: {
    businessId?: string;
    laneId?: string;
    dryRun?: boolean;
  }): Promise<{
    businessId: string;
    businessName: string;
    laneId: string;
    laneName: string;
    dryRun: boolean;
    manifests: ClipBaitersSourceFeedManifest[];
    candidates: ClipBaitersClipCandidate[];
    radar: ClipBaitersLaneRadarSnapshot;
    stories: ClipBaitersLaneStoryBatch;
    artifacts: {
      clipCandidatesPath: string;
      clipCandidatesLanePath: string;
      sourceFeedDirectory: string;
    };
  }> {
    const businessId = options?.businessId ?? CLIPBAITERS_BUSINESS_ID;
    const laneId = options?.laneId ?? "clipbaiters-political";
    const dryRun = options?.dryRun ?? false;
    const business = await this.store.getManagedBusiness(businessId);
    if (!business) {
      throw new Error(`Managed business ${businessId} was not found.`);
    }

    const radarService = new ClipBaitersRadarService(this.config, this.store);
    const radarResult = await radarService.refresh({ businessId, laneId });
    const sourceFeedDirectory = path.join(this.config.outputDir, "source-feeds", "clipbaiters", businessId);
    const stateDirectory = path.join(this.config.stateDir, "clipbaiters", businessId);
    const clipCandidatesPath = path.join(stateDirectory, "clip-candidates.json");
    const clipCandidatesLanePath = laneScopedPath(clipCandidatesPath, laneId);
    await Promise.all([ensureDir(sourceFeedDirectory), ensureDir(stateDirectory)]);

    const manualManifests = await this.loadManualManifests({
      businessId,
      laneId,
      laneName: radarResult.radar.laneName,
      sourceFeedDirectory
    });
    const manifests =
      manualManifests.length > 0
        ? manualManifests
        : this.buildSyntheticManifests({
            businessId,
            laneId,
            laneName: radarResult.radar.laneName,
            radar: radarResult.radar,
            stories: radarResult.stories
          });
    const candidates = manifests.map((manifest, index) =>
      this.toClipCandidate({
        businessId,
        laneId,
        laneName: radarResult.radar.laneName,
        dryRun,
        manifest,
        radar: radarResult.radar,
        stories: radarResult.stories,
        index
      })
    );
    const state: ClipBaitersClipCandidateState = {
      businessId,
      laneId,
      generatedAt: nowIso(),
      dryRun,
      manifests,
      candidates
    };
    await Promise.all([
      writeJsonFile(clipCandidatesPath, state),
      writeJsonFile(clipCandidatesLanePath, state)
    ]);

    return {
      businessId,
      businessName: business.name,
      laneId,
      laneName: radarResult.radar.laneName,
      dryRun,
      manifests,
      candidates,
      radar: radarResult.radar,
      stories: radarResult.stories,
      artifacts: {
        clipCandidatesPath,
        clipCandidatesLanePath,
        sourceFeedDirectory
      }
    };
  }

  private async loadManualManifests(options: {
    businessId: string;
    laneId: string;
    laneName: string;
    sourceFeedDirectory: string;
  }): Promise<ClipBaitersSourceFeedManifest[]> {
    const entries = await readdir(options.sourceFeedDirectory, { withFileTypes: true });
    const manifests: ClipBaitersSourceFeedManifest[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const filePath = path.join(options.sourceFeedDirectory, entry.name);
      const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
      const records = Array.isArray(raw) ? raw : [raw];
      for (const record of records) {
        const manifest = this.normalizeManualManifest(record, options, entry.name);
        if (manifest) {
          manifests.push(manifest);
        }
      }
    }

    return manifests;
  }

  private normalizeManualManifest(
    raw: unknown,
    options: {
      businessId: string;
      laneId: string;
      laneName: string;
    },
    sourceFileName: string
  ): ClipBaitersSourceFeedManifest | null {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const record = raw as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const laneId = typeof record.laneId === "string" ? record.laneId : options.laneId;
    if (!title || laneId !== options.laneId) {
      return null;
    }

    const sourceUrl = typeof record.sourceUrl === "string" ? record.sourceUrl.trim() : undefined;
    const localMediaPath =
      typeof record.localMediaPath === "string" ? record.localMediaPath.trim() : undefined;
    const notes = Array.isArray(record.notes)
      ? record.notes.filter((note): note is string => typeof note === "string" && note.trim().length > 0)
      : [];
    const rightsBasis = normalizeRightsBasis(record.rightsBasis, "manual_review_required");
    const approvalState =
      typeof record.approvalState === "string" && record.approvalState === "approved"
        ? "approved"
        : rightsBasis === "manual_review_required"
          ? "review_required"
          : "approved";
    const mediaType =
      record.mediaType === "video" ||
      record.mediaType === "live_stream" ||
      record.mediaType === "brief" ||
      record.mediaType === "schedule"
        ? record.mediaType
        : localMediaPath
          ? "video"
          : sourceUrl
            ? "live_stream"
            : "brief";

    return {
      id:
        typeof record.id === "string" && record.id.trim().length > 0
          ? record.id
          : slugify(`${options.businessId}-${options.laneId}-${sourceFileName}-${title}`),
      businessId: options.businessId,
      laneId: options.laneId,
      laneName: options.laneName,
      origin: "manual_manifest",
      mediaType,
      title,
      sourceUrl,
      localMediaPath,
      sourceId: typeof record.sourceId === "string" ? record.sourceId : undefined,
      eventId: typeof record.eventId === "string" ? record.eventId : undefined,
      storyId: typeof record.storyId === "string" ? record.storyId : undefined,
      rightsBasis,
      approvalState,
      transcriptText:
        typeof record.transcriptText === "string" ? record.transcriptText.trim() : undefined,
      notes
    };
  }

  private buildSyntheticManifests(payload: {
    businessId: string;
    laneId: string;
    laneName: string;
    radar: ClipBaitersLaneRadarSnapshot;
    stories: ClipBaitersLaneStoryBatch;
  }): ClipBaitersSourceFeedManifest[] {
    const storyByEventId = new Map(payload.stories.stories.map((story) => [story.eventId, story]));
    return payload.radar.candidates.slice(0, 3).map((candidate, index) => {
      const story = storyByEventId.get(candidate.id);
      return {
        id: slugify(`${payload.businessId}-${payload.laneId}-story-brief-${index + 1}`),
        businessId: payload.businessId,
        laneId: payload.laneId,
        laneName: payload.laneName,
        origin: "story_brief",
        mediaType: "brief",
        title: story?.headline ?? candidate.title,
        sourceUrl: candidate.sourceUrl,
        sourceId: candidate.sourceId,
        eventId: candidate.id,
        storyId: story?.id,
        rightsBasis: story?.rightsBasis ?? "manual_review_required",
        approvalState: candidate.reviewRequired ? "review_required" : "approved",
        transcriptText: undefined,
        notes: [
          "Synthetic manifest generated from the current ClipBaiters radar because no manual approved-source JSON files were present.",
          candidate.summary
        ]
      };
    });
  }

  private toClipCandidate(payload: {
    businessId: string;
    laneId: string;
    laneName: string;
    dryRun: boolean;
    manifest: ClipBaitersSourceFeedManifest;
    radar: ClipBaitersLaneRadarSnapshot;
    stories: ClipBaitersLaneStoryBatch;
    index: number;
  }): ClipBaitersClipCandidate {
    const story = payload.manifest.storyId
      ? payload.stories.stories.find((candidate) => candidate.id === payload.manifest.storyId)
      : payload.manifest.eventId
        ? payload.stories.stories.find((candidate) => candidate.eventId === payload.manifest.eventId)
        : undefined;
    const radarCandidate = payload.manifest.eventId
      ? payload.radar.candidates.find((candidate) => candidate.id === payload.manifest.eventId)
      : undefined;
    const transcriptSegments = this.buildTranscriptSegments(payload.manifest, story, radarCandidate);
    const suggestedMoments = this.buildSuggestedMoments(transcriptSegments, radarCandidate, payload.index);
    const firstMoment = suggestedMoments[0] ?? {
      startSeconds: 0,
      endSeconds: 24
    };
    const clipHandle = slugify(`${payload.manifest.laneId}-${payload.manifest.title}`);
    const pipelinePreview = this.buildPipelinePreview({
      clipHandle,
      sourceUrl: payload.manifest.sourceUrl,
      localMediaPath: payload.manifest.localMediaPath,
      firstMomentStart: firstMoment.startSeconds,
      firstMomentEnd: firstMoment.endSeconds
    });
    const approvedSourceClass = this.approvedSourceClassFor(payload.manifest);
    const transformationReview = this.buildTransformationReview({
      laneId: payload.laneId,
      manifest: payload.manifest,
      sourceTitle: payload.manifest.title,
      sourceUrl: payload.manifest.sourceUrl,
      approvedSourceClass,
      transcriptSegments,
      suggestedMoments
    });

    return {
      id: slugify(`${payload.businessId}-${payload.laneId}-${payload.manifest.id}-candidate`),
      businessId: payload.businessId,
      laneId: payload.laneId,
      laneName: payload.laneName,
      status: suggestedMoments.length > 0 ? "prepared" : "blocked",
      dryRun: payload.dryRun,
      sourceTitle: payload.manifest.title,
      sourceUrl: payload.manifest.sourceUrl,
      localMediaPath: payload.manifest.localMediaPath,
      sourceId: payload.manifest.sourceId,
      eventId: payload.manifest.eventId,
      storyId: payload.manifest.storyId,
      manifestId: payload.manifest.id,
      rightsBasis: payload.manifest.rightsBasis,
      approvedSourceClass,
      approvalState: payload.manifest.approvalState,
      transcriptSource: payload.manifest.origin === "manual_manifest" ? "manual_manifest" : "story_brief",
      editorialAngle:
        story?.angle ??
        radarCandidate?.summary ??
        "Lead with context, isolate the strongest beat, and make the edit meaningfully transformed.",
      commentaryHook:
        story?.editorialHooks[0] ??
        radarCandidate?.notes[0] ??
        "Use one explanatory hook that gives the clip context before the reaction beat lands.",
      transformationReview,
      maxDurationSeconds: MAX_CLIP_DURATION_SECONDS,
      transcriptSegments,
      suggestedMoments,
      pipelinePreview,
      createdAt: nowIso(),
      notes: [
        ...payload.manifest.notes,
        payload.manifest.origin === "manual_manifest"
          ? "Transcript and clip moments were derived from a manual approved-source manifest."
          : "Transcript and clip moments were synthesized from the current story brief for dry-run planning.",
        payload.manifest.approvalState === "review_required"
          ? "Manual review is still required before download, clipping, or publishing."
          : "This source is marked approved for ingest planning."
      ]
    };
  }

  private buildTranscriptSegments(
    manifest: ClipBaitersSourceFeedManifest,
    story: ClipBaitersLaneStoryBatch["stories"][number] | undefined,
    radarCandidate: ClipBaitersLaneRadarSnapshot["candidates"][number] | undefined
  ): ClipBaitersTranscriptSegment[] {
    const seedText = manifest.transcriptText?.trim()
      ? manifest.transcriptText
      : [
          manifest.title,
          radarCandidate?.summary,
          story?.angle,
          ...(story?.editorialHooks ?? [])
        ]
          .filter((value): value is string => Boolean(value))
          .join(" ");
    const fragments = toSentenceFragments(seedText);
    const usableFragments = fragments.length > 0 ? fragments : [clipText(seedText || manifest.title, 120)];

    let cursor = 0;
    return usableFragments.slice(0, 18).map((fragment, index) => {
      const duration = Math.max(3, Math.min(8, Math.round(fragment.split(/\s+/).length * 0.45)));
      const segment: ClipBaitersTranscriptSegment = {
        id: slugify(`${manifest.id}-segment-${index + 1}`),
        index,
        startSeconds: cursor,
        endSeconds: cursor + duration,
        speaker: index === 0 ? "lead" : "narration",
        text: clipText(fragment, 140),
        confidence: manifest.origin === "manual_manifest" ? 0.88 : 0.62
      };
      cursor += duration;
      return segment;
    });
  }

  private buildSuggestedMoments(
    segments: ClipBaitersTranscriptSegment[],
    radarCandidate: ClipBaitersLaneRadarSnapshot["candidates"][number] | undefined,
    index: number
  ): ClipBaitersClipMoment[] {
    if (segments.length === 0) {
      return [];
    }

    const windows: Array<[number, number]> = [];
    for (let offset = 0; offset < Math.min(segments.length, 3); offset += 1) {
      const endIndex = Math.min(segments.length - 1, offset + 1);
      windows.push([offset, endIndex]);
    }

    return windows.map(([startIndex, endIndex], momentIndex) => {
      const windowSegments = segments.slice(startIndex, endIndex + 1);
      const startSeconds = windowSegments[0]?.startSeconds ?? 0;
      const endSeconds = windowSegments.at(-1)?.endSeconds ?? startSeconds + 6;
      return {
        id: slugify(`${segments[0]?.id ?? "moment"}-${momentIndex + 1}`),
        label: `Moment ${momentIndex + 1}`,
        startSeconds,
        endSeconds,
        reason:
          radarCandidate?.notes[momentIndex] ??
          `This beat keeps the strongest explanatory or reaction line near the front of the clip window.`,
        energyScore: Math.max(6, 9 - momentIndex),
        policyRisk: radarCandidate ? Math.max(3, radarCandidate.policyRisk - momentIndex) : 4 + index,
        captionLines: windowSegments.map((segment) => clipText(segment.text, 72))
      };
    });
  }

  private buildPipelinePreview(payload: {
    clipHandle: string;
    sourceUrl?: string;
    localMediaPath?: string;
    firstMomentStart: number;
    firstMomentEnd: number;
  }): ClipBaitersToolCommandPreview[] {
    const inputPath = payload.localMediaPath ?? `/state/input/${payload.clipHandle}.mp4`;
    return [
      {
        tool: "yt-dlp",
        command: payload.sourceUrl
          ? `yt-dlp "${payload.sourceUrl}" -o "/state/input/${payload.clipHandle}.%(ext)s"`
          : `yt-dlp "<approved-source-url>" -o "/state/input/${payload.clipHandle}.%(ext)s"`,
        note: payload.sourceUrl
          ? "Download only when the source is approved and the lane's review gate is clear."
          : "Placeholder download command for a future approved-source URL."
      },
      {
        tool: "whisper",
        command: `python3 -m whisper "${inputPath}" --language en --task transcribe --output_format json --output_dir /state/transcripts`,
        note: "Use Whisper or an equivalent transcription backend once the media file exists."
      },
      {
        tool: "ffmpeg",
        command: `ffmpeg -i "${inputPath}" -ss ${this.toClock(payload.firstMomentStart)} -to ${this.toClock(
          payload.firstMomentEnd
        )} -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" "/state/drafts/${payload.clipHandle}.mp4"`,
        note: "Clip preview command for the strongest candidate moment before captions are burned in."
      }
    ];
  }

  private toClock(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
      .toString()
      .padStart(2, "0");
    const minutes = Math.floor((seconds % 3600) / 60)
      .toString()
      .padStart(2, "0");
    const secs = Math.floor(seconds % 60)
      .toString()
      .padStart(2, "0");
    return `${hours}:${minutes}:${secs}`;
  }

  private approvedSourceClassFor(
    manifest: ClipBaitersSourceFeedManifest
  ): ClipBaitersApprovedSourceClass {
    switch (manifest.rightsBasis) {
      case "official_government":
        return "official_public_record";
      case "creator_authorized":
        return "creator_authorized_submission";
      case "official_promo":
        return "official_channel_upload";
      case "licensed":
        return "licensed_media_asset";
      case "manual_review_required":
      default:
        return manifest.origin === "story_brief" ? "synthetic_story_brief" : "official_channel_upload";
    }
  }

  private buildTransformationReview(payload: {
    laneId: string;
    manifest: ClipBaitersSourceFeedManifest;
    sourceTitle: string;
    sourceUrl?: string;
    approvedSourceClass: ClipBaitersApprovedSourceClass;
    transcriptSegments: ClipBaitersTranscriptSegment[];
    suggestedMoments: ClipBaitersClipMoment[];
  }): ClipBaitersTransformationReview {
    const transcriptDuration =
      payload.transcriptSegments.at(-1)?.endSeconds ?? payload.suggestedMoments[0]?.endSeconds ?? 0;
    const tactics = uniqueStrings([
      "context_hook",
      "caption_template",
      "reframe_crop",
      transcriptDuration > MAX_CLIP_DURATION_SECONDS ? "series_split" : "",
      payload.laneId === "clipbaiters-political" ? "voiceover_ready" : ""
    ]) as ClipBaitersTransformationReview["tactics"];
    const policyRiskScore = Math.max(
      payload.suggestedMoments[0]?.policyRisk ?? 4,
      payload.manifest.approvalState === "review_required" ? 7 : 0,
      payload.laneId === "clipbaiters-political" ? 8 : 0
    );

    return {
      approvedSourceClass: payload.approvedSourceClass,
      tactics,
      attributionText: payload.sourceUrl
        ? `Source: ${payload.sourceTitle} | ${payload.sourceUrl}`
        : `Source: ${payload.sourceTitle}`,
      rationale:
        payload.manifest.approvalState === "approved"
          ? "Use a context-first hook, burned-in captions, and reframed vertical editing before publish review."
          : "Keep the clip behind manual review until source rights and transformation evidence are explicitly approved.",
      policyRiskScore,
      automationEligible:
        payload.manifest.approvalState === "approved" &&
        payload.manifest.rightsBasis !== "manual_review_required" &&
        payload.laneId !== "clipbaiters-political"
    };
  }
}