import path from "node:path";
import type { AppConfig } from "../config.js";
import type {
  ClipBaitersDiscoveredVideo,
  ClipBaitersEventRadarCandidate,
  ClipBaitersEventRadarState,
  ClipBaitersLaneDefinition,
  ClipBaitersLaneRadarSnapshot,
  ClipBaitersLaneRegistry,
  ClipBaitersLaneStoryBatch,
  ClipBaitersSkimSummary,
  ClipBaitersSourceRecord,
  ClipBaitersStoryCandidate,
  ClipBaitersStoryCandidateState,
  ClipBaitersVideoDiscoveryState
} from "../domain/clipbaiters.js";
import { readJsonFile, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { FileStore } from "../storage/store.js";
import { ClipBaitersSkimmerService } from "./clipbaiters-skimmer.js";
import { ClipBaitersStudioService } from "./clipbaiters-studio.js";

const CLIPBAITERS_BUSINESS_ID = "clipbaiters-viral-moments";

function nowIso(): string {
  return new Date().toISOString();
}

function calculateScore(candidate: Omit<ClipBaitersEventRadarCandidate, "score">): number {
  const weighted =
    candidate.immediacy * 0.25 +
    candidate.novelty * 0.18 +
    candidate.emotionalCharge * 0.15 +
    candidate.clipPotential * 0.22 +
    candidate.sourceTrust * 0.2 -
    candidate.policyRisk * 0.1;
  return Math.round(weighted * 100) / 100;
}

function mergeLaneSnapshots<T extends { laneId: string }>(
  existing: T[],
  next: T
): T[] {
  return [...existing.filter((item) => item.laneId !== next.laneId), next].sort((left, right) =>
    left.laneId.localeCompare(right.laneId)
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class ClipBaitersRadarService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {}

  async refresh(options?: {
    businessId?: string;
    laneId?: string;
  }): Promise<{
    status: "blocked" | "ready";
    summary: string;
    radar: ClipBaitersLaneRadarSnapshot;
    stories: ClipBaitersLaneStoryBatch;
    artifacts: {
      eventRadarPath: string;
      storyCandidatesPath: string;
      dailyBriefPath: string;
    };
  }> {
    const businessId = options?.businessId ?? CLIPBAITERS_BUSINESS_ID;
    const laneId = options?.laneId ?? "clipbaiters-political";
    const studio = new ClipBaitersStudioService(this.config, this.store);
    const { plan } = await studio.writePlan({ businessId });
    const lane = plan.laneRegistry.lanes.find((item) => item.id === laneId);
    if (!lane) {
      throw new Error(`ClipBaiters lane ${laneId} was not found.`);
    }

    const stateDirectory = path.join(this.config.stateDir, "clipbaiters", plan.businessId);
    const opsDirectory = path.join(this.config.opsDir, "clipbaiters", plan.businessId);
    const eventRadarPath = path.join(stateDirectory, "event-radar.json");
    const storyCandidatesPath = path.join(stateDirectory, "story-candidates.json");
    const dailyBriefPath = path.join(opsDirectory, "daily-brief.md");

    const eligibleSources = plan.sourceRegistry.sources.filter(
      (source) => source.laneId === lane.id && source.status !== "gated"
    );
    const skimmer = new ClipBaitersSkimmerService(this.config, this.store);
    if (eligibleSources.length === 0) {
      const emptyRadar: ClipBaitersLaneRadarSnapshot = {
        laneId: lane.id,
        laneName: lane.name,
        generatedAt: nowIso(),
        candidateCount: 0,
        candidates: []
      };
      const emptyStories: ClipBaitersLaneStoryBatch = {
        laneId: lane.id,
        laneName: lane.name,
        generatedAt: nowIso(),
        stories: []
      };
      await writeTextFile(
        dailyBriefPath,
        [
          "# ClipBaiters Daily Brief",
          "",
          `Lane: ${lane.name}`,
          "",
          `No eligible sources are active for ${lane.name} yet.`
        ].join("\n")
      );
      return {
        status: "blocked",
        summary: `${lane.name} has no eligible sources yet.`,
        radar: emptyRadar,
        stories: emptyStories,
        artifacts: {
          eventRadarPath,
          storyCandidatesPath,
          dailyBriefPath
        }
      };
    }

    const skimResult = await skimmer.skim({ businessId, laneId: lane.id });
    const discoveryState = await readJsonFile<ClipBaitersVideoDiscoveryState>(skimResult.artifacts.videoDiscoveryPath, {
      businessId: plan.businessId,
      generatedAt: nowIso(),
      videos: []
    });
    const discoveryById = new Map(
      discoveryState.videos
        .filter((item) => item.laneId === lane.id)
        .map((item) => [item.id, item] as const)
    );
    const sourceById = new Map(eligibleSources.map((source) => [source.id, source] as const));
    const laneSummaries = skimResult.skimState.summaries
      .filter((summary) => summary.laneId === lane.id)
      .map((summary) => ({
        summary,
        discovery: discoveryById.get(summary.discoveryId)
      }))
      .filter(
        (
          item
        ): item is {
          summary: ClipBaitersSkimSummary;
          discovery: ClipBaitersDiscoveredVideo;
        } => Boolean(item.discovery)
      );

    const generatedAt = nowIso();
    if (laneSummaries.length === 0) {
      const emptyRadar: ClipBaitersLaneRadarSnapshot = {
        laneId: lane.id,
        laneName: lane.name,
        generatedAt,
        candidateCount: 0,
        candidates: []
      };
      const emptyStories: ClipBaitersLaneStoryBatch = {
        laneId: lane.id,
        laneName: lane.name,
        generatedAt,
        stories: []
      };
      const existingRadar = await readJsonFile<ClipBaitersEventRadarState>(eventRadarPath, {
        businessId: plan.businessId,
        generatedAt,
        lanes: []
      });
      const existingStories = await readJsonFile<ClipBaitersStoryCandidateState>(storyCandidatesPath, {
        businessId: plan.businessId,
        generatedAt,
        lanes: []
      });
      await writeJsonFile(eventRadarPath, {
        businessId: plan.businessId,
        generatedAt,
        lanes: mergeLaneSnapshots(existingRadar.lanes, emptyRadar)
      });
      await writeJsonFile(storyCandidatesPath, {
        businessId: plan.businessId,
        generatedAt,
        lanes: mergeLaneSnapshots(existingStories.lanes, emptyStories)
      });
      await writeTextFile(
        dailyBriefPath,
        [
          "# ClipBaiters Daily Brief",
          "",
          `Generated at: ${generatedAt}`,
          `Lane: ${lane.name}`,
          "",
          `No skim-ready discovery items were found for ${lane.name}.`
        ].join("\n")
      );
      return {
        status: "blocked",
        summary: skimResult.summary,
        radar: emptyRadar,
        stories: emptyStories,
        artifacts: {
          eventRadarPath,
          storyCandidatesPath,
          dailyBriefPath
        }
      };
    }

    const candidates = laneSummaries
      .map(({ summary, discovery }) =>
        this.buildCandidate(
          lane,
          sourceById.get(summary.sourceId) ?? eligibleSources[0]!,
          discovery,
          summary
        )
      )
      .sort((left, right) => right.score - left.score || left.eventDate.localeCompare(right.eventDate));
    const radar: ClipBaitersLaneRadarSnapshot = {
      laneId: lane.id,
      laneName: lane.name,
      generatedAt,
      candidateCount: candidates.length,
      candidates
    };
    const stories: ClipBaitersLaneStoryBatch = {
      laneId: lane.id,
      laneName: lane.name,
      generatedAt,
      stories: candidates.slice(0, 3).map((candidate, index) => {
        const match = laneSummaries.find(({ summary }) => summary.discoveryId === candidate.id || summary.sourceId === candidate.sourceId);
        return this.buildStoryCandidate(lane, candidate, index, match?.summary, match?.discovery);
      })
    };

    const existingRadar = await readJsonFile<ClipBaitersEventRadarState>(eventRadarPath, {
      businessId: plan.businessId,
      generatedAt,
      lanes: []
    });
    const existingStories = await readJsonFile<ClipBaitersStoryCandidateState>(storyCandidatesPath, {
      businessId: plan.businessId,
      generatedAt,
      lanes: []
    });
    const nextRadar: ClipBaitersEventRadarState = {
      businessId: plan.businessId,
      generatedAt,
      lanes: mergeLaneSnapshots(existingRadar.lanes, radar)
    };
    const nextStories: ClipBaitersStoryCandidateState = {
      businessId: plan.businessId,
      generatedAt,
      lanes: mergeLaneSnapshots(existingStories.lanes, stories)
    };

    await writeJsonFile(eventRadarPath, nextRadar);
    await writeJsonFile(storyCandidatesPath, nextStories);
    await writeTextFile(dailyBriefPath, this.toDailyBrief(plan.laneRegistry, lane, eligibleSources, radar, stories));

    return {
      status: "ready",
      summary: `${lane.name} radar refreshed with ${candidates.length} candidate(s) and ${stories.stories.length} story brief(s) from collector-backed skims.`,
      radar,
      stories,
      artifacts: {
        eventRadarPath,
        storyCandidatesPath,
        dailyBriefPath
      }
    };
  }

  private buildCandidate(
    lane: ClipBaitersLaneDefinition,
    source: ClipBaitersSourceRecord,
    discovery: ClipBaitersDiscoveredVideo,
    skim: ClipBaitersSkimSummary
  ): ClipBaitersEventRadarCandidate {
    const immediacy = clamp((discovery.isLive ? 9 : discovery.isUpcoming ? 8 : 6) + (skim.score >= 8 ? 1 : 0), 1, 10);
    const novelty = clamp(
      skim.score + (discovery.sourceType === "google_news_rss" || discovery.sourceType === "gdelt" ? 1 : 0),
      1,
      10
    );
    const emotionalCharge = clamp((lane.id === "clipbaiters-streaming" ? 6 : 7) + (discovery.isLive ? 1 : 0), 1, 10);
    const clipPotential = clamp(skim.recommendedMoments.length + skim.score, 1, 10);
    const basePolicyRisk = lane.reviewRequired ? 7 : 4;
    const policyRisk = clamp(
      basePolicyRisk + (discovery.rightsBasis === "manual_review_required" ? 2 : 0) - (discovery.rightsBasis === "creator_authorized" ? 1 : 0),
      1,
      10
    );
    const baseCandidate: Omit<ClipBaitersEventRadarCandidate, "score"> = {
      id: discovery.id,
      businessId: CLIPBAITERS_BUSINESS_ID,
      laneId: lane.id,
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: discovery.sourceUrl ?? source.sourceUrl,
      title: skim.title,
      summary: skim.summary,
      eventDate: discovery.publishedAt ?? discovery.discoveredAt,
      discoveredAt: discovery.discoveredAt,
      immediacy,
      novelty,
      emotionalCharge,
      clipPotential,
      policyRisk,
      sourceTrust: source.trustScore,
      status: lane.rolloutStatus === "active" ? (lane.reviewRequired ? "review_required" : "watching") : "research_only",
      reviewRequired: lane.reviewRequired,
      notes: uniqueNotes([
        ...skim.notes,
        ...skim.recommendedMoments.map((moment) => `Skim moment: ${moment}`),
        `Source basis: ${discovery.rightsBasis}.`,
        discovery.isLive ? "Live source detected; prioritize rapid context capture." : "Use the discovery summary to stage the next clip brief.",
        lane.reviewRequired ? "Manual review is still required before any later ingest or publishing step." : ""
      ])
    };
    return {
      ...baseCandidate,
      score: calculateScore(baseCandidate)
    };
  }

  private buildStoryCandidate(
    lane: ClipBaitersLaneDefinition,
    candidate: ClipBaitersEventRadarCandidate,
    index: number,
    skim?: ClipBaitersSkimSummary,
    discovery?: ClipBaitersDiscoveredVideo
  ): ClipBaitersStoryCandidate {
    return {
      id: slugify(`${candidate.id}-story-${index + 1}`),
      businessId: candidate.businessId,
      laneId: candidate.laneId,
      eventId: candidate.id,
      headline: `${lane.name}: ${candidate.title}`,
      angle:
        lane.id === "clipbaiters-streaming"
          ? "Frame the brief around the creator-approved payoff moment, the stream context, and the delivery turnaround promise."
          : "Frame the brief around official context, what changed, and one transformation hook that justifies commentary packaging.",
      rightsBasis: discovery?.rightsBasis ?? (lane.id === "clipbaiters-streaming" ? "creator_authorized" : "manual_review_required"),
      sourceIds: [candidate.sourceId],
      recommendedClipMoments:
        skim?.recommendedMoments ?? [
          "Open with the line, reaction, or exchange most likely to travel out of context.",
          "Keep one supporting beat that explains why the moment matters.",
          "End with a commentary or framing beat that makes the edit materially transformed."
        ],
      editorialHooks: [
        "Why this moment is spiking right now",
        "What the audience should understand before they reshare it",
        lane.id === "clipbaiters-streaming"
          ? "How this clip serves the creator's growth or recap goals"
          : "What changed from the last comparable event"
      ],
      reviewRequired: lane.reviewRequired,
      status: lane.rolloutStatus === "active" ? "briefed" : "blocked",
      notes: candidate.notes,
      createdAt: nowIso()
    };
  }

  private toDailyBrief(
    laneRegistry: ClipBaitersLaneRegistry,
    lane: ClipBaitersLaneDefinition,
    sources: ClipBaitersSourceRecord[],
    radar: ClipBaitersLaneRadarSnapshot,
    stories: ClipBaitersLaneStoryBatch
  ): string {
    return [
      "# ClipBaiters Daily Brief",
      "",
      `Generated at: ${radar.generatedAt}`,
      `Business: ${laneRegistry.businessName}`,
      `Lane: ${lane.name}`,
      `Alias: ${laneRegistry.aliasEmail}`,
      `Review required: ${lane.reviewRequired ? "yes" : "no"}`,
      `Active lanes: ${laneRegistry.activeLaneIds.join(", ")}`,
      `Eligible sources: ${sources.map((source) => source.name).join(", ")}`,
      "",
      "## Top Radar Candidates",
      ...(radar.candidates.length > 0
        ? radar.candidates.flatMap((candidate, index) => [
            `### ${index + 1}. ${candidate.title}`,
            `- Event date: ${candidate.eventDate}`,
            `- Score: ${candidate.score}`,
            `- Source: ${candidate.sourceName}`,
            `- Summary: ${candidate.summary}`,
            `- Signals: immediacy ${candidate.immediacy}, novelty ${candidate.novelty}, emotional charge ${candidate.emotionalCharge}, clip potential ${candidate.clipPotential}, policy risk ${candidate.policyRisk}`,
            ...candidate.notes.map((note) => `- Note: ${note}`),
            ""
          ])
        : ["- No candidates were generated.", ""]),
      "## Story Briefs",
      ...(stories.stories.length > 0
        ? stories.stories.flatMap((story) => [
            `### ${story.headline}`,
            `- Status: ${story.status}`,
            `- Angle: ${story.angle}`,
            `- Review required: ${story.reviewRequired ? "yes" : "no"}`,
            ...story.editorialHooks.map((hook) => `- Hook: ${hook}`),
            ...story.recommendedClipMoments.map((moment) => `- Clip moment: ${moment}`),
            ""
          ])
        : ["- No story briefs are ready yet.", ""])
    ].join("\n");
  }
}

function uniqueNotes(notes: string[]): string[] {
  return [...new Set(notes.filter(Boolean))];
}