import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import type { AppConfig } from "../config.js";
import type { ManagedBusiness } from "../domain/engine.js";
import type { SocialProfileRecord } from "../domain/social.js";
import type {
  ClipBaitersAutomationPlan,
  ClipBaitersChannelSetup,
  ClipBaitersEventRadarState,
  ClipBaitersLaneDefinition,
  ClipBaitersLanePostureApproval,
  ClipBaitersLaneRegistry,
  ClipBaitersPlanStatus,
  ClipBaitersPublishHistoryState,
  ClipBaitersRoadblock,
  ClipBaitersRightsReviewApproval,
  ClipBaitersSourceRecord,
  ClipBaitersSourceRegistry,
  ClipBaitersStoryCandidateState
} from "../domain/clipbaiters.js";
import { ensureDir, readJsonFile, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { FileStore } from "../storage/store.js";
import { StoreOpsService } from "./store-ops.js";

const CLIPBAITERS_BUSINESS_ID = "clipbaiters-viral-moments";
const DEFAULT_ALIAS_EMAIL = "imonengine@gmail.com";
const execFileAsync = promisify(execFile);
const PYTHON_COMMAND = process.platform === "win32" ? "python" : "python3";
const CLIPBAITERS_RIGHTS_APPROVAL_REVIEW_LANES = ["clipbaiters-political", "clipbaiters-celebs"];
const CLIPBAITERS_RIGHTS_APPROVAL_GATED_LANES = [
  "clipbaiters-streaming",
  "clipbaiters-animated",
  "clipbaiters-celebs"
];
const NO_IMMEDIATE_OWNER_ACTION = "No immediate owner action is required right now.";
const CLIPBAITERS_LANE_POSTURE_APPROVAL_COMPLETE_REASON =
  "ClipBaiters lane posture approval is recorded for the current rollout set. Passive lanes remain documented and gated until their activation conditions change.";

type NotificationState = {
  signature?: string;
  notifiedAt?: string;
};

type ClipBaitersSocialProfile = SocialProfileRecord & {
  platform: "gmail_alias" | "facebook_page" | "youtube_channel";
};

type LaneSeed = Omit<ClipBaitersLaneDefinition, "targetPlatforms">;

const LANE_SEEDS: LaneSeed[] = [
  {
    id: "clipbaiters-political",
    name: "ClipBaitersPolitical",
    focus: "politics, government, elections, hearings, and official-news moments",
    editorialSummary: "Start here for the first editorial radar loop because the source surface is structured and time-sensitive.",
    rolloutStatus: "active",
    riskLevel: "high",
    reviewRequired: true,
    directRevenuePriority: 2,
    sourceTypes: ["google_news_rss", "gdelt", "official_calendar", "official_youtube"],
    notes: [
      "Treat this as a manual-review lane even when the radar becomes reliable.",
      "Keep the initial scope on U.S. English politics and government events."
    ]
  },
  {
    id: "clipbaiters-media",
    name: "ClipBaitersMedia",
    focus: "non-political news plus official film, television, and press surfaces that pass review",
    editorialSummary: "Run this as the second YouTube lane using official media channels only while rights-sensitive expansion stays explicitly gated.",
    rolloutStatus: "approval_required",
    riskLevel: "high",
    reviewRequired: true,
    directRevenuePriority: 4,
    sourceTypes: ["official_youtube", "press_junket_feed", "licensed_media_feed"],
    notes: [
      "Keep the active surface on official YouTube trailers, press, and network-owned uploads.",
      "Do not treat unofficial reposts, fan mirrors, or rumor channels as approved sources."
    ]
  },
  {
    id: "clipbaiters-animated",
    name: "ClipBaitersAnimated",
    focus: "animation and anime surfaces that stay rights-gated until an approved source policy exists",
    editorialSummary: "Keep the channel lane in the registry, but leave the source surface research-only until licensing or publisher approval is real.",
    rolloutStatus: "research_only",
    riskLevel: "high",
    reviewRequired: true,
    directRevenuePriority: 5,
    sourceTypes: ["licensed_media_feed", "official_youtube"],
    notes: [
      "This lane remains dormant for live sourcing until the rights posture changes.",
      "The main value in step 3 is preserving the audience split in planning and channel state."
    ]
  },
  {
    id: "clipbaiters-celebs",
    name: "ClipBaitersCelebs",
    focus: "celebrity interviews, press junkets, and official public clips that pass review",
    editorialSummary: "Use official interviews and public promotional clips only, and keep every story behind a context review.",
    rolloutStatus: "approval_required",
    riskLevel: "medium",
    reviewRequired: true,
    directRevenuePriority: 3,
    sourceTypes: ["press_junket_feed", "official_youtube"],
    notes: [
      "This lane can open after the political and media loops prove out.",
      "Do not widen the lane to rumor or gossip surfaces."
    ]
  },
  {
    id: "clipbaiters-streaming",
    name: "ClipBaitersStreaming",
    focus: "creator-authorized streaming and content-creator clipping services",
    editorialSummary: "Keep this as the first direct-revenue lane, but leave it out of the initial YouTube channel rollout until the political and media lanes are stable.",
    rolloutStatus: "approval_required",
    riskLevel: "medium",
    reviewRequired: true,
    directRevenuePriority: 1,
    sourceTypes: ["creator_authorized_channel", "manual_creator_brief", "official_youtube"],
    notes: [
      "Use creator-authorized sources only for the direct service lane.",
      "Keep the first monetization focus on retainers and event packages, not platform rev share.",
      "Bring this lane back into the active publish loop only after the current YouTube channels are stable."
    ]
  }
];

type SourceSeed = Omit<ClipBaitersSourceRecord, "id" | "businessId">;

const SOURCE_SEEDS: SourceSeed[] = [
  {
    laneId: "clipbaiters-political",
    name: "Google News Politics RSS",
    sourceType: "google_news_rss",
    sourceUrl: "https://news.google.com/rss/search?q=US+politics",
    rightsBasis: "manual_review_required",
    status: "active",
    trustScore: 7,
    updateCadence: "hourly",
    notes: ["Use this as a discovery layer only; never as a direct clip source."]
  },
  {
    laneId: "clipbaiters-political",
    name: "GDELT Political Monitor",
    sourceType: "gdelt",
    sourceUrl: "https://api.gdeltproject.org/api/v2/doc/doc",
    rightsBasis: "manual_review_required",
    status: "active",
    trustScore: 7,
    updateCadence: "hourly",
    notes: ["Use for trend detection and event urgency only."]
  },
  {
    laneId: "clipbaiters-political",
    name: "Official Government Calendars",
    sourceType: "official_calendar",
    rightsBasis: "official_government",
    status: "active",
    trustScore: 9,
    updateCadence: "daily",
    notes: ["White House, agency, committee, and campaign schedules are the safest first event surface."]
  },
  {
    laneId: "clipbaiters-political",
    name: "Official Government YouTube Streams",
    sourceType: "official_youtube",
    rightsBasis: "official_government",
    status: "active",
    trustScore: 9,
    updateCadence: "daily",
    notes: ["Use for upcoming stream discovery and later ingest candidates."]
  },
  {
    laneId: "clipbaiters-streaming",
    name: "Creator Authorized Channel Registry",
    sourceType: "creator_authorized_channel",
    rightsBasis: "creator_authorized",
    status: "active",
    trustScore: 9,
    updateCadence: "daily",
    notes: ["Treat this as the core roster for creator clipping service work."]
  },
  {
    laneId: "clipbaiters-streaming",
    name: "Creator Brief Drop Folder",
    sourceType: "manual_creator_brief",
    rightsBasis: "creator_authorized",
    status: "manual_only",
    trustScore: 10,
    updateCadence: "manual",
    notes: ["Manual briefs, event notes, and turnaround instructions land here before ingest exists."]
  },
  {
    laneId: "clipbaiters-streaming",
    name: "Creator Upcoming Streams",
    sourceType: "official_youtube",
    rightsBasis: "creator_authorized",
    status: "active",
    trustScore: 8,
    updateCadence: "daily",
    notes: ["Use upcoming stream schedules for event timing and watch windows."]
  },
  {
    laneId: "clipbaiters-celebs",
    name: "Official Press Junket Feeds",
    sourceType: "press_junket_feed",
    rightsBasis: "official_promo",
    status: "gated",
    trustScore: 7,
    updateCadence: "daily",
    notes: ["Unlock only after the review policy is approved for celebrity coverage."]
  },
  {
    laneId: "clipbaiters-celebs",
    name: "Official Interview Channels",
    sourceType: "official_youtube",
    rightsBasis: "official_promo",
    status: "gated",
    trustScore: 7,
    updateCadence: "daily",
    notes: ["Stay official-only to avoid gossip or claim-heavy surfaces."]
  },
  {
    laneId: "clipbaiters-media",
    name: "Official Trailer And Press Channels",
    sourceType: "official_youtube",
    rightsBasis: "official_promo",
    status: "active",
    trustScore: 7,
    updateCadence: "daily",
    notes: ["This is the safest active source layer for the media lane while broader licensing work stays deferred."]
  },
  {
    laneId: "clipbaiters-media",
    name: "Licensed Media Feed Placeholder",
    sourceType: "licensed_media_feed",
    rightsBasis: "licensed",
    status: "gated",
    trustScore: 8,
    updateCadence: "manual",
    notes: ["Use only after a real licensed feed or partner exists."]
  },
  {
    laneId: "clipbaiters-animated",
    name: "Licensed Animation Feed Placeholder",
    sourceType: "licensed_media_feed",
    rightsBasis: "licensed",
    status: "gated",
    trustScore: 8,
    updateCadence: "manual",
    notes: ["Keep this lane fully rights-gated in step 3."]
  }
];

function nowIso(): string {
  return new Date().toISOString();
}

function buildAlias(baseEmail: string, brandName: string): string {
  const [local, domain] = baseEmail.split("@");
  if (!local || !domain) {
    return baseEmail;
  }
  return `${local}+${slugify(brandName).replace(/-/g, "")}@${domain}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.name.localeCompare(right.name));
}

function isClipBaitersSocialProfile(profile: SocialProfileRecord): profile is ClipBaitersSocialProfile {
  return (
    profile.businessId === CLIPBAITERS_BUSINESS_ID &&
    (profile.platform === "gmail_alias" ||
      profile.platform === "facebook_page" ||
      profile.platform === "youtube_channel")
  );
}

export class ClipBaitersStudioService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {}

  async approveRightsReviewPolicy(options?: {
    businessId?: string;
    approvedBy?: string;
    note?: string;
  }): Promise<{
    approval: ClipBaitersRightsReviewApproval;
    artifacts: {
      approvalStatePath: string;
      approvalMarkdownPath: string;
    };
    plan: ClipBaitersAutomationPlan;
    planArtifacts: {
      planJsonPath: string;
      planMarkdownPath: string;
      laneRegistryPath: string;
      sourceRegistryPath: string;
      eventRadarPath: string;
      storyCandidatesPath: string;
      roadblocksPath: string;
      feedReadmePath: string;
      roadblockEmailPath?: string;
    };
  }> {
    const businessId = options?.businessId ?? CLIPBAITERS_BUSINESS_ID;
    const business =
      (await this.store.getManagedBusiness(businessId)) ??
      (await this.store.getManagedBusiness(CLIPBAITERS_BUSINESS_ID));
    if (!business) {
      throw new Error(`Managed business ${businessId} was not found.`);
    }
    if (business.id !== CLIPBAITERS_BUSINESS_ID) {
      throw new Error(`${business.name} is not the ClipBaiters managed business.`);
    }

    const approval = this.buildRightsReviewApproval(
      business,
      options?.approvedBy?.trim() || this.config.business.approvalEmail || "owner",
      options?.note?.trim()
    );
    const approvalStatePath = this.rightsReviewApprovalStatePath(business.id);
    const approvalMarkdownPath = this.rightsReviewApprovalMarkdownPath(business.id);
    await writeJsonFile(approvalStatePath, approval);
    await writeTextFile(approvalMarkdownPath, this.rightsReviewApprovalMarkdown(approval));

    const planResult = await this.writePlan({ businessId: business.id });
    return {
      approval,
      artifacts: {
        approvalStatePath,
        approvalMarkdownPath
      },
      plan: planResult.plan,
      planArtifacts: planResult.artifacts
    };
  }

  async approveLanePosturePolicy(options?: {
    businessId?: string;
    approvedBy?: string;
    note?: string;
  }): Promise<{
    approval: ClipBaitersLanePostureApproval;
    artifacts: {
      approvalStatePath: string;
      approvalMarkdownPath: string;
    };
    plan: ClipBaitersAutomationPlan;
    planArtifacts: {
      planJsonPath: string;
      planMarkdownPath: string;
      laneRegistryPath: string;
      sourceRegistryPath: string;
      eventRadarPath: string;
      storyCandidatesPath: string;
      roadblocksPath: string;
      feedReadmePath: string;
      roadblockEmailPath?: string;
    };
  }> {
    const businessId = options?.businessId ?? CLIPBAITERS_BUSINESS_ID;
    const business =
      (await this.store.getManagedBusiness(businessId)) ??
      (await this.store.getManagedBusiness(CLIPBAITERS_BUSINESS_ID));
    if (!business) {
      throw new Error(`Managed business ${businessId} was not found.`);
    }
    if (business.id !== CLIPBAITERS_BUSINESS_ID) {
      throw new Error(`${business.name} is not the ClipBaiters managed business.`);
    }

    const seedPlan = await this.writePlan({ businessId: business.id });
    const approval = this.buildLanePostureApproval(
      business,
      seedPlan.plan.laneRegistry,
      options?.approvedBy?.trim() || this.config.business.approvalEmail || "owner",
      options?.note?.trim()
    );
    const approvalStatePath = this.lanePostureApprovalStatePath(business.id);
    const approvalMarkdownPath = this.lanePostureApprovalMarkdownPath(business.id);
    await writeJsonFile(approvalStatePath, approval);
    await writeTextFile(approvalMarkdownPath, this.lanePostureApprovalMarkdown(approval));

    const planResult = await this.writePlan({ businessId: business.id });
    return {
      approval,
      artifacts: {
        approvalStatePath,
        approvalMarkdownPath
      },
      plan: planResult.plan,
      planArtifacts: planResult.artifacts
    };
  }

  async writePlan(options?: {
    businessId?: string;
    notifyRoadblocks?: boolean;
  }): Promise<{
    plan: ClipBaitersAutomationPlan;
    artifacts: {
      planJsonPath: string;
      planMarkdownPath: string;
      laneRegistryPath: string;
      sourceRegistryPath: string;
      eventRadarPath: string;
      storyCandidatesPath: string;
      roadblocksPath: string;
      feedReadmePath: string;
      roadblockEmailPath?: string;
    };
  }> {
    const businessId = options?.businessId ?? CLIPBAITERS_BUSINESS_ID;
    const business =
      (await this.store.getManagedBusiness(businessId)) ??
      (await this.store.getManagedBusiness(CLIPBAITERS_BUSINESS_ID));
    if (!business) {
      throw new Error(`Managed business ${businessId} was not found.`);
    }
    if (business.id !== CLIPBAITERS_BUSINESS_ID) {
      throw new Error(`${business.name} is not the ClipBaiters managed business.`);
    }

    const storeOps = new StoreOpsService(this.config, this.store);
    const socialProfiles = await storeOps.ensureSocialProfiles(business.id, business.name);
    const aliasEmail =
      socialProfiles.find((profile) => profile.platform === "gmail_alias")?.emailAlias ??
      buildAlias(this.config.marketplaces.gumroadSellerEmail ?? DEFAULT_ALIAS_EMAIL, business.name);

    const stateDirectory = path.join(this.config.stateDir, "clipbaiters", business.id);
    const opsDirectory = path.join(this.config.opsDir, "clipbaiters", business.id);
    const feedDirectory = path.join(this.config.outputDir, "source-feeds", "clipbaiters", business.id);
    await Promise.all([ensureDir(stateDirectory), ensureDir(opsDirectory), ensureDir(feedDirectory)]);

    const rightsReviewApproval = await this.loadRightsReviewApproval(business.id);
    const lanePostureApproval = await this.loadLanePostureApproval(business.id);
    const laneRegistry = this.buildLaneRegistry(business, aliasEmail);
    const sourceRegistry = this.buildSourceRegistry(business.id);
    const socialPresence = this.buildSocialPresence(socialProfiles);
    const roadblocks = this.buildRoadblocks(
      business.name,
      laneRegistry,
      sourceRegistry,
      socialPresence,
      rightsReviewApproval,
      lanePostureApproval
    );
    const plan: ClipBaitersAutomationPlan = {
      businessId: business.id,
      businessName: business.name,
      aliasEmail,
      status: this.planStatusFor(roadblocks),
      generatedAt: nowIso(),
      feedDirectory,
      stateDirectory,
      opsDirectory,
      primaryEditorialLaneId: laneRegistry.primaryEditorialLaneId,
      primaryRevenueLaneId: laneRegistry.primaryRevenueLaneId,
      laneRegistry,
      sourceRegistry,
      socialPresence,
      roadblocks,
      nextAutomationSteps: [
        "Refresh collection and skim runs across the active political and media lanes, then keep radar focused on political for the most structured editorial brief.",
        "Keep Celebs, Animated, and the creator-service streaming lane out of the active YouTube publish loop until their policy and workflow thresholds are explicit.",
        "Use the shared domain-backed recovery inbox for current YouTube channel ops and stage any future per-lane aliases only when those channel accounts exist.",
        "Drop any manual source exports or creator briefs into the ClipBaiters source-feeds directory before the ingest service exists.",
        "Treat the Streaming lane as the first direct-revenue path once creator-authorized source intake is operational, even while the active YouTube rollout stays focused on Media and Political."
      ]
    };

    const laneRegistryPath = path.join(stateDirectory, "lane-registry.json");
    const sourceRegistryPath = path.join(stateDirectory, "source-registry.json");
    const eventRadarPath = path.join(stateDirectory, "event-radar.json");
    const storyCandidatesPath = path.join(stateDirectory, "story-candidates.json");
    const planJsonPath = path.join(opsDirectory, "plan.json");
    const planMarkdownPath = path.join(opsDirectory, "plan.md");
    const roadblocksPath = path.join(opsDirectory, "roadblocks.json");
    const roadblockEmailPath = path.join(opsDirectory, "roadblock-email.md");
    const feedReadmePath = path.join(feedDirectory, "README.md");

    const existingRadar = await readJsonFile<ClipBaitersEventRadarState>(eventRadarPath, {
      businessId: business.id,
      generatedAt: nowIso(),
      lanes: []
    });
    const existingStories = await readJsonFile<ClipBaitersStoryCandidateState>(storyCandidatesPath, {
      businessId: business.id,
      generatedAt: nowIso(),
      lanes: []
    });

    await writeJsonFile(laneRegistryPath, laneRegistry);
    await writeJsonFile(sourceRegistryPath, sourceRegistry);
    await writeJsonFile(eventRadarPath, existingRadar);
    await writeJsonFile(storyCandidatesPath, existingStories);
    await writeJsonFile(planJsonPath, plan);
    await writeJsonFile(roadblocksPath, roadblocks);
    await writeTextFile(
      planMarkdownPath,
      this.toMarkdown(plan, rightsReviewApproval, lanePostureApproval)
    );
    if (roadblocks.length > 0) {
      await writeTextFile(roadblockEmailPath, await this.composeRoadblockEmail(plan));
    }
    await writeTextFile(feedReadmePath, this.feedReadme(business.name, feedDirectory));
    await this.updateBusinessState(
      business,
      plan,
      rightsReviewApproval,
      lanePostureApproval
    );
    await this.syncLanePostureApprovalTask(business, plan);
    if (options?.notifyRoadblocks && roadblocks.length > 0) {
      await this.maybeNotifyRoadblocks(plan, roadblockEmailPath);
    }

    return {
      plan,
      artifacts: {
        planJsonPath,
        planMarkdownPath,
        laneRegistryPath,
        sourceRegistryPath,
        eventRadarPath,
        storyCandidatesPath,
        roadblocksPath,
        feedReadmePath,
        roadblockEmailPath: roadblocks.length > 0 ? roadblockEmailPath : undefined
      }
    };
  }

  private buildLaneRegistry(business: ManagedBusiness, aliasEmail: string): ClipBaitersLaneRegistry {
    const activeLaneIds = uniqueStrings(
      this.config.clipbaiters.activeLaneIds.filter((laneId) =>
        LANE_SEEDS.some((lane) => lane.id === laneId)
      )
    );
    const activeLaneIdSet = new Set(activeLaneIds);

    return {
      businessId: business.id,
      businessName: business.name,
      aliasEmail,
      generatedAt: nowIso(),
      activeLaneIds,
      primaryEditorialLaneId: "clipbaiters-political",
      primaryRevenueLaneId: "clipbaiters-streaming",
      complianceNotes: [
        "Only rights-cleared, creator-authorized, official-government, official-promotional, or licensed source surfaces should move past the radar stage.",
        "Political, celebrity, and any ambiguous-rights lanes stay behind manual review even when automation expands.",
        "The lane registry keeps the future niches visible without forcing every niche into live sourcing on day one."
      ],
      lanes: LANE_SEEDS.map((lane) => ({
        ...lane,
        rolloutStatus:
          lane.rolloutStatus === "research_only"
            ? "research_only"
            : activeLaneIdSet.has(lane.id)
              ? "active"
              : lane.rolloutStatus,
        targetPlatforms: ["youtube_channel"]
      }))
    };
  }

  private buildSourceRegistry(businessId: string): ClipBaitersSourceRegistry {
    return {
      businessId,
      generatedAt: nowIso(),
      sources: sortByName(
        SOURCE_SEEDS.map((source) => ({
          ...source,
          id: slugify(`${businessId}-${source.laneId}-${source.name}`),
          businessId
        }))
      )
    };
  }

  private buildSocialPresence(profiles: SocialProfileRecord[]): ClipBaitersChannelSetup[] {
    return profiles
      .filter(isClipBaitersSocialProfile)
      .map((profile) => ({
        profileId: profile.id,
        businessId: profile.businessId,
        platform: profile.platform,
        status: profile.status,
        laneId: profile.laneId,
        laneName: profile.laneName,
        handleOrAlias: profile.handle ?? profile.emailAlias,
        profileUrl: profile.profileUrl,
        externalId: profile.externalId,
        purpose:
          profile.platform === "gmail_alias"
            ? "Shared approvals, notifications, and recovery alias for the whole lane."
            : profile.platform === "facebook_page"
              ? "Optional umbrella distribution or ad-reuse surface that stays deferred unless the YouTube loop needs it."
              : `Niche YouTube channel for ${profile.laneName ?? "the assigned lane"}.`,
        blocker: profile.blocker,
        nextSteps:
          profile.platform === "gmail_alias"
            ? ["Keep the alias routed into the main ImonEngine inbox."]
            : profile.platform === "facebook_page"
              ? [
                  profile.status === "live"
                    ? `Keep the umbrella Facebook Page mapped at ${profile.profileUrl ?? profile.handle ?? profile.id}.`
                    : `Create the umbrella Facebook Page ${profile.handle ?? profile.brandName} only when distribution reuse or later ads justify it.`,
                  "Do not block the YouTube-first rollout on this page."
                ]
              : [
                  profile.status === "live"
                    ? `Use the configured ${profile.laneName ?? profile.handle ?? "lane"} channel at ${profile.profileUrl ?? profile.handle ?? profile.id}.`
                    : `Create the ${profile.laneName ?? profile.handle ?? "lane"} YouTube channel in the shared signed-in browser profile.`,
                  `Keep ${profile.emailAlias} as the recovery alias for this channel.`
                ]
      }))
      .sort((left, right) => left.profileId.localeCompare(right.profileId));
  }

  private buildRoadblocks(
    businessName: string,
    laneRegistry: ClipBaitersLaneRegistry,
    sourceRegistry: ClipBaitersSourceRegistry,
    socialPresence: ClipBaitersChannelSetup[],
    rightsReviewApproval?: ClipBaitersRightsReviewApproval,
    lanePostureApproval?: ClipBaitersLanePostureApproval
  ): ClipBaitersRoadblock[] {
    const roadblocks: ClipBaitersRoadblock[] = [];
    const activeLaneIds = new Set(laneRegistry.activeLaneIds);
    const nonLiveChannels = socialPresence.filter(
      (profile) =>
        profile.platform === "youtube_channel" &&
        profile.status !== "live" &&
        Boolean(profile.laneId && activeLaneIds.has(profile.laneId))
    );
    const gatedLanes = laneRegistry.lanes.filter((lane) => lane.rolloutStatus !== "active");
    const lanePostureApproved = this.hasApprovedLanePosture(laneRegistry, lanePostureApproval);
    const activeSources = sourceRegistry.sources.filter((source) => source.status === "active");
    const manualOnlySources = sourceRegistry.sources.filter((source) => source.status === "manual_only");

    if (!rightsReviewApproval) {
      roadblocks.push({
        id: "rights-and-review-policy",
        category: "Rights and review policy",
        summary: `${businessName} still needs explicit owner signoff on the rights-cleared and creator-authorized source policy, plus the fair-use review checklist, before clips or creator service work can go live.`,
        requiredFromOwner: [
          "Approve the rights-cleared and creator-authorized source policy.",
          "Confirm the political and celebrity review checklist before any publishing flow is added."
        ],
        continueAfterCompletion: [
          "The radar output can graduate into the ingest and clip-draft pipeline.",
          "Creator-authorized streaming work can move toward fulfillment automation."
        ]
      });
    }

    if (nonLiveChannels.length > 0) {
      roadblocks.push({
        id: "youtube-channel-readiness",
        category: "YouTube channel readiness",
        summary: `${businessName} still has planned but not-yet-live niche YouTube channels, so the social split exists in state but not as a warmed public surface.`,
        requiredFromOwner: nonLiveChannels.flatMap((profile) => profile.nextSteps),
        continueAfterCompletion: [
          "Each lane can keep its own audience and upload queue.",
          "Later publishing automation can target real channels instead of placeholders."
        ]
      });
    }

    if (gatedLanes.length > 0 && !lanePostureApproved) {
      roadblocks.push({
        id: "rights-gated-lanes",
        category: "Lane activation policy",
        summary: lanePostureApproval
          ? `${businessName} changed its active-versus-gated lane posture after the last owner signoff, so ${gatedLanes.map((lane) => lane.name).join(", ")} need a fresh owner-approved lane posture before the business can be treated as operational.`
          : `${businessName} still keeps ${gatedLanes.map((lane) => lane.name).join(", ")} behind approval or research-only gates while the first editorial and monetization loops prove out, and the current lane posture is not yet explicitly signed off.`,
        requiredFromOwner: [
          "Approve the current active-versus-gated lane posture for the ClipBaiters rollout set.",
          "Keep the gated lanes dormant until their documented activation conditions and source posture are satisfied."
        ],
        continueAfterCompletion: [
          "The current rollout can stay narrow without pretending every lane is launch-ready now.",
          "Future lane changes will reopen this blocker only when the active-versus-gated posture actually changes."
        ]
      });
    }

    if (activeSources.length === 0 || manualOnlySources.length === 0) {
      roadblocks.push({
        id: "source-registry-depth",
        category: "Source registry depth",
        summary: `${businessName} now has a durable source registry, but the feed population is still mostly seeded policy data and manual folders instead of live ingest connectors.`,
        requiredFromOwner: [
          "Drop any creator-authorized briefs or exported schedule files into the ClipBaiters source-feeds directory.",
          "Keep the first live sourcing focused on official political calendars, official media channels, and creator-authorized streaming rosters."
        ],
        continueAfterCompletion: [
          "The radar can score real upcoming events instead of only seeded watch windows.",
          "Step 4 can attach concrete source provenance to clip jobs immediately."
        ]
      });
    }

    return roadblocks;
  }

  private planStatusFor(roadblocks: ClipBaitersRoadblock[]): ClipBaitersPlanStatus {
    return roadblocks.length > 0 ? "blocked" : "ready";
  }

  private async updateBusinessState(
    business: ManagedBusiness,
    plan: ClipBaitersAutomationPlan,
    rightsReviewApproval?: ClipBaitersRightsReviewApproval,
    lanePostureApproval?: ClipBaitersLanePostureApproval
  ): Promise<void> {
    const publishHistoryPath = path.join(
      this.config.stateDir,
      "clipbaiters",
      business.id,
      "publish-history.json"
    );
    const publishHistory = await readJsonFile<ClipBaitersPublishHistoryState>(publishHistoryPath, {
      businessId: business.id,
      generatedAt: nowIso(),
      entries: []
    });
    const hasLivePublishProof = publishHistory.entries.some((entry) => entry.status === "live");
    const nextStage =
      business.stage === "active" || hasLivePublishProof
        ? "active"
        : plan.roadblocks.length > 0
          ? "scaffolded"
          : "ready";

    await this.store.saveManagedBusiness({
      ...business,
      stage: nextStage,
      launchBlockers: plan.roadblocks.map((roadblock) => roadblock.summary),
      notes: [
        ...business.notes.filter(
          (note) =>
            !note.startsWith("ClipBaiters planning dossier refreshed") &&
            !note.startsWith("Primary alias:") &&
            !note.startsWith("Live publish proof:") &&
            !note.startsWith("Rights and fair-use approval:") &&
            !note.startsWith("Lane posture approval:") &&
            !note.includes("runtime/ops/clipbaiters/")
        ),
        `ClipBaiters planning dossier refreshed ${plan.generatedAt}.`,
        `Primary alias: ${plan.aliasEmail}.`,
        `Live publish proof: ${hasLivePublishProof ? "present" : "not yet recorded"}.`,
        rightsReviewApproval
          ? `Rights and fair-use approval: ${rightsReviewApproval.approvedAt} by ${rightsReviewApproval.approvedBy}.`
          : "Rights and fair-use approval: not yet recorded.",
        lanePostureApproval
          ? `Lane posture approval: ${lanePostureApproval.approvedAt} by ${lanePostureApproval.approvedBy}.`
          : "Lane posture approval: not yet recorded.",
        "The ClipBaiters planning dossier lives under runtime/ops/clipbaiters/clipbaiters-viral-moments."
      ],
      updatedAt: nowIso()
    });
  }

  private feedReadme(businessName: string, feedDirectory: string): string {
    return [
      "# ClipBaiters Source Feeds",
      "",
      `Business: ${businessName}`,
      `Directory: ${feedDirectory}`,
      "",
      "Drop manual source exports, creator briefs, schedule notes, or approved feed snapshots here until the ingest service is implemented.",
      "Keep every file tied to an approved source and a documented rights basis."
    ].join("\n");
  }

  private toMarkdown(
    plan: ClipBaitersAutomationPlan,
    rightsReviewApproval?: ClipBaitersRightsReviewApproval,
    lanePostureApproval?: ClipBaitersLanePostureApproval
  ): string {
    const laneLines = plan.laneRegistry.lanes.flatMap((lane) => [
      `### ${lane.name}`,
      `- Status: ${lane.rolloutStatus}`,
      `- Focus: ${lane.focus}`,
      `- Risk: ${lane.riskLevel}`,
      `- Review required: ${lane.reviewRequired ? "yes" : "no"}`,
      `- Source types: ${lane.sourceTypes.join(", ")}`,
      ...lane.notes.map((note) => `- Note: ${note}`),
      ""
    ]);
    const sourceLines = plan.sourceRegistry.sources.flatMap((source) => [
      `### ${source.name}`,
      `- Lane: ${source.laneId}`,
      `- Type: ${source.sourceType}`,
      `- Status: ${source.status}`,
      `- Rights basis: ${source.rightsBasis}`,
      `- Trust score: ${source.trustScore}/10`,
      ...(source.sourceUrl ? [`- URL: ${source.sourceUrl}`] : []),
      ...source.notes.map((note) => `- Note: ${note}`),
      ""
    ]);
    const socialLines = plan.socialPresence.flatMap((profile) => [
      `### ${profile.platform}${profile.laneName ? ` · ${profile.laneName}` : ""}`,
      `- Status: ${profile.status}`,
      `- Handle or alias: ${profile.handleOrAlias}`,
      `- Purpose: ${profile.purpose}`,
      ...(profile.blocker ? [`- Blocker: ${profile.blocker}`] : []),
      ...profile.nextSteps.map((step) => `- Next: ${step}`),
      ""
    ]);
    const roadblockLines =
      plan.roadblocks.length > 0
        ? plan.roadblocks.flatMap((roadblock) => [
            `### ${roadblock.category}`,
            `- Summary: ${roadblock.summary}`,
            ...roadblock.requiredFromOwner.map((item) => `- Required from owner: ${item}`),
            ...roadblock.continueAfterCompletion.map((item) => `- After completion: ${item}`),
            ""
          ])
        : ["- No roadblocks are currently detected.", ""];
    const rightsApprovalLines = rightsReviewApproval
      ? [
          `- Approved at: ${rightsReviewApproval.approvedAt}`,
          `- Approved by: ${rightsReviewApproval.approvedBy}`,
          `- Statement: ${rightsReviewApproval.statement}`,
          ...rightsReviewApproval.reviewChecklist.map((item) => `- Checklist: ${item}`),
          ""
        ]
      : ["- No owner signoff is currently recorded.", ""];
    const lanePostureLines = lanePostureApproval
      ? [
          `- Approved at: ${lanePostureApproval.approvedAt}`,
          `- Approved by: ${lanePostureApproval.approvedBy}`,
          `- Statement: ${lanePostureApproval.statement}`,
          `- Active lanes: ${lanePostureApproval.activeLaneIds.join(", ")}`,
          `- Still-gated lanes: ${lanePostureApproval.gatedLaneIds.join(", ")}`,
          ...lanePostureApproval.approvedLanes.flatMap((lane) => [
            `- ${lane.laneName}: ${lane.rolloutStatus}`,
            ...lane.activationCriteria.map((item) => `  - Activation criteria: ${item}`)
          ]),
          ""
        ]
      : ["- No owner signoff is currently recorded.", ""];

    return [
      "# ClipBaiters Planning Dossier",
      "",
      `Generated at: ${plan.generatedAt}`,
      `Status: ${plan.status}`,
      `Business: ${plan.businessName}`,
      `Alias: ${plan.aliasEmail}`,
      `Active lanes: ${plan.laneRegistry.activeLaneIds.join(", ")}`,
      `Primary editorial lane: ${plan.primaryEditorialLaneId}`,
      `Primary revenue lane: ${plan.primaryRevenueLaneId}`,
      `Source feed directory: ${plan.feedDirectory}`,
      "",
      "## Rights Policy Approval",
      ...rightsApprovalLines,
      "## Lane Posture Approval",
      ...lanePostureLines,
      "## Lane Registry",
      ...laneLines,
      "## Source Registry",
      ...sourceLines,
      "## Social Presence",
      ...socialLines,
      "## Roadblocks",
      ...roadblockLines,
      "## Next Automation Steps",
      ...plan.nextAutomationSteps.map((step) => `- ${step}`),
      ""
    ].join("\n");
  }

  private rightsReviewApprovalStatePath(businessId: string): string {
    return path.join(this.config.stateDir, "clipbaiters", businessId, "rights-review-approval.json");
  }

  private rightsReviewApprovalMarkdownPath(businessId: string): string {
    return path.join(this.config.opsDir, "clipbaiters", businessId, "rights-review-approval.md");
  }

  private lanePostureApprovalStatePath(businessId: string): string {
    return path.join(this.config.stateDir, "clipbaiters", businessId, "lane-posture-approval.json");
  }

  private lanePostureApprovalMarkdownPath(businessId: string): string {
    return path.join(this.config.opsDir, "clipbaiters", businessId, "lane-posture-approval.md");
  }

  private async loadRightsReviewApproval(
    businessId: string
  ): Promise<ClipBaitersRightsReviewApproval | undefined> {
    return (
      (await readJsonFile<ClipBaitersRightsReviewApproval | null>(
        this.rightsReviewApprovalStatePath(businessId),
        null
      )) ?? undefined
    );
  }

  private async loadLanePostureApproval(
    businessId: string
  ): Promise<ClipBaitersLanePostureApproval | undefined> {
    return (
      (await readJsonFile<ClipBaitersLanePostureApproval | null>(
        this.lanePostureApprovalStatePath(businessId),
        null
      )) ?? undefined
    );
  }

  private buildRightsReviewApproval(
    business: ManagedBusiness,
    approvedBy: string,
    note?: string
  ): ClipBaitersRightsReviewApproval {
    return {
      businessId: business.id,
      businessName: business.name,
      approvedAt: nowIso(),
      approvedBy,
      statement:
        "Approved for ClipBaiters to move only rights-cleared, creator-authorized, official, or licensed source material beyond discovery and into render or publish review, while keeping unresolved-rights, synthetic-brief, political, celebrity, and otherwise ambiguous items behind the manual-review rules already encoded in the repo.",
      allowedRightsBasis: ["official_government", "creator_authorized", "official_promo", "licensed"],
      approvedSourceClasses: [
        "official_public_record",
        "official_channel_upload",
        "creator_authorized_submission",
        "licensed_media_asset"
      ],
      reviewChecklist: [
        "Only official public record, official channel upload, creator-authorized submission, and licensed media asset sources may move beyond discovery.",
        "Synthetic story briefs, raw reposts, fan mirrors, and manual-review-required sources remain outside the live publish queue.",
        "Each clip must include explicit transformation evidence: context hook, caption template, reframing, attribution, and any multipart split or voiceover the lane requires.",
        "Each live upload must stay under 60 seconds per part or be split into ordered parts.",
        "Political, celebrity, and ambiguous-rights material remain manual-review gated before any upload.",
        "ClipBaitersStreaming, ClipBaitersAnimated, and ClipBaitersCelebs remain gated until their lane-specific source posture and channel readiness are approved."
      ],
      reviewRequiredLaneIds: CLIPBAITERS_RIGHTS_APPROVAL_REVIEW_LANES,
      gatedLaneIds: CLIPBAITERS_RIGHTS_APPROVAL_GATED_LANES,
      notes: uniqueStrings(
        [
          "This signoff clears only the rights-and-review-policy blocker; operational blockers remain in the launch checklist.",
          note ?? ""
        ].filter(Boolean)
      )
    };
  }

  private buildLanePostureApproval(
    business: ManagedBusiness,
    laneRegistry: ClipBaitersLaneRegistry,
    approvedBy: string,
    note?: string
  ): ClipBaitersLanePostureApproval {
    const activeLanes = laneRegistry.lanes.filter((lane) => lane.rolloutStatus === "active");
    const gatedLanes = laneRegistry.lanes.filter((lane) => lane.rolloutStatus !== "active");

    return {
      businessId: business.id,
      businessName: business.name,
      approvedAt: nowIso(),
      approvedBy,
      statement:
        `Approved to keep ${activeLanes.map((lane) => lane.name).join(", ")} as the current active rollout lanes for ClipBaiters while ${gatedLanes.map((lane) => lane.name).join(", ")} stay under their documented gated or research-only posture until those activation conditions change.`,
      laneStatusSignature: this.lanePostureSignature(laneRegistry),
      activeLaneIds: laneRegistry.activeLaneIds,
      gatedLaneIds: gatedLanes.map((lane) => lane.id),
      approvedLanes: laneRegistry.lanes.map((lane) => ({
        laneId: lane.id,
        laneName: lane.name,
        rolloutStatus: lane.rolloutStatus,
        approvedSourceTypes: lane.sourceTypes,
        activationCriteria: this.laneActivationCriteriaFor(lane),
        notes: lane.notes
      })),
      notes: uniqueStrings(
        [
          "This signoff clears only the rights-gated-lanes blocker for the current rollout set; queue, render, review, and channel blockers remain separate.",
          note ?? ""
        ].filter(Boolean)
      )
    };
  }

  private rightsReviewApprovalMarkdown(approval: ClipBaitersRightsReviewApproval): string {
    return [
      "# ClipBaiters Rights And Fair-Use Approval",
      "",
      `Business: ${approval.businessName}`,
      `Business id: ${approval.businessId}`,
      `Approved at: ${approval.approvedAt}`,
      `Approved by: ${approval.approvedBy}`,
      "",
      "## Approval Statement",
      approval.statement,
      "",
      "## Approved Rights Basis",
      ...approval.allowedRightsBasis.map((item) => `- ${item}`),
      "",
      "## Approved Source Classes",
      ...approval.approvedSourceClasses.map((item) => `- ${item}`),
      "",
      "## Review Checklist",
      ...approval.reviewChecklist.map((item) => `- ${item}`),
      "",
      "## Review-Gated Lanes",
      ...approval.reviewRequiredLaneIds.map((laneId) => `- ${laneId}`),
      "",
      "## Still-Gated Lanes",
      ...approval.gatedLaneIds.map((laneId) => `- ${laneId}`),
      "",
      "## Notes",
      ...approval.notes.map((item) => `- ${item}`),
      ""
    ].join("\n");
  }

  private lanePostureApprovalMarkdown(approval: ClipBaitersLanePostureApproval): string {
    return [
      "# ClipBaiters Lane Posture Approval",
      "",
      `Business: ${approval.businessName}`,
      `Business id: ${approval.businessId}`,
      `Approved at: ${approval.approvedAt}`,
      `Approved by: ${approval.approvedBy}`,
      `Lane signature: ${approval.laneStatusSignature}`,
      "",
      "## Approval Statement",
      approval.statement,
      "",
      "## Active Lanes",
      ...approval.activeLaneIds.map((laneId) => `- ${laneId}`),
      "",
      "## Still-Gated Lanes",
      ...approval.gatedLaneIds.map((laneId) => `- ${laneId}`),
      "",
      "## Approved Lane Posture",
      ...approval.approvedLanes.flatMap((lane) => [
        `### ${lane.laneName}`,
        `- Status: ${lane.rolloutStatus}`,
        `- Approved source types: ${lane.approvedSourceTypes.join(", ")}`,
        ...lane.activationCriteria.map((item) => `- Activation criteria: ${item}`),
        ...lane.notes.map((item) => `- Note: ${item}`),
        ""
      ]),
      "## Notes",
      ...approval.notes.map((item) => `- ${item}`),
      ""
    ].join("\n");
  }

  private lanePostureSignature(laneRegistry: ClipBaitersLaneRegistry): string {
    return createHash("sha1")
      .update(
        JSON.stringify({
          activeLaneIds: laneRegistry.activeLaneIds,
          lanes: laneRegistry.lanes.map((lane) => ({
            id: lane.id,
            rolloutStatus: lane.rolloutStatus,
            reviewRequired: lane.reviewRequired,
            sourceTypes: lane.sourceTypes
          }))
        })
      )
      .digest("hex");
  }

  private hasApprovedLanePosture(
    laneRegistry: ClipBaitersLaneRegistry,
    approval?: ClipBaitersLanePostureApproval
  ): boolean {
    return Boolean(
      approval && approval.laneStatusSignature === this.lanePostureSignature(laneRegistry)
    );
  }

  private laneActivationCriteriaFor(lane: ClipBaitersLaneDefinition): string[] {
    switch (lane.id) {
      case "clipbaiters-streaming":
        return [
          "Keep this lane out of the active YouTube publish loop until creator-authorized intake is operational and the current channel set is stable.",
          "Treat paid creator work as the first live operating surface before widening this lane into general publishing."
        ];
      case "clipbaiters-animated":
        return [
          "Keep this lane research-only until licensed or publisher-approved sources exist.",
          "Do not activate the lane from mirrors, fan uploads, or unlicensed reposts."
        ];
      case "clipbaiters-celebs":
        return [
          "Keep this lane official-only and context-review gated until the current media loop proves out.",
          "Do not widen the lane into rumor or gossip sources."
        ];
      default:
        return [
          lane.reviewRequired
            ? "Keep manual review in place before any upload or public publish step."
            : "Use the current live operating rules for this lane."
        ];
    }
  }

  private lanePostureApprovalTaskId(businessId: string): string {
    return `approval-clipbaiters-lane-posture-${businessId}`;
  }

  private async syncLanePostureApprovalTask(
    business: ManagedBusiness,
    plan: ClipBaitersAutomationPlan
  ): Promise<void> {
    const taskId = this.lanePostureApprovalTaskId(business.id);
    const existing = (await this.store.getApprovals()).find((approval) => approval.id === taskId);
    const lanePostureRoadblock = plan.roadblocks.find(
      (roadblock) => roadblock.id === "rights-gated-lanes"
    );

    if (!lanePostureRoadblock) {
      if (existing && existing.status !== "completed") {
        await this.store.saveApproval({
          ...existing,
          status: "completed",
          reason: CLIPBAITERS_LANE_POSTURE_APPROVAL_COMPLETE_REASON,
          ownerInstructions: NO_IMMEDIATE_OWNER_ACTION,
          updatedAt: nowIso()
        });
      }
      return;
    }

    const updatedAt = nowIso();
    await this.store.saveApproval({
      id: taskId,
      type: "compliance",
      actionNeeded: `Approve lane posture for ${business.name}`,
      reason: lanePostureRoadblock.summary,
      ownerInstructions:
        `Review the ClipBaiters lane posture statement, then run npm run dev -- clipbaiters-approve-lane-posture --business ${business.id} ` +
        "[--approved-by <name-or-email>] [--note <text>] or use the control-room approval action.",
      notifyChannel: "email",
      relatedEntityType: "business",
      relatedEntityId: business.id,
      status: existing?.status === "completed" ? "open" : existing?.status ?? "open",
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt
    });
  }

  private async maybeNotifyRoadblocks(plan: ClipBaitersAutomationPlan, bodyPath: string): Promise<boolean> {
    const recipient = this.config.business.approvalEmail?.trim();
    if (plan.roadblocks.length === 0 || !recipient || recipient === "owner@example.com") {
      return false;
    }

    const notificationPath = path.join(
      this.config.opsDir,
      "clipbaiters",
      plan.businessId,
      "roadblock-notification.json"
    );
    const signature = createHash("sha1")
      .update(JSON.stringify(plan.roadblocks.map((roadblock) => roadblock.summary)))
      .digest("hex");
    const previous = await readJsonFile<NotificationState>(notificationPath, {});
    const lastNotifiedAt = previous.notifiedAt ? new Date(previous.notifiedAt).getTime() : 0;
    const withinThrottleWindow = Date.now() - lastNotifiedAt < 6 * 60 * 60 * 1000;
    if (previous.signature === signature && withinThrottleWindow) {
      return false;
    }

    await execFileAsync(PYTHON_COMMAND, [
      path.join(this.config.projectRoot, "scripts", "send_gmail_message.py"),
      "--to",
      recipient,
      "--subject",
      `ImonEngine roadblock: ${plan.businessName} launch setup`,
      "--body-file",
      bodyPath
    ]);

    await writeJsonFile(notificationPath, {
      signature,
      notifiedAt: nowIso()
    } satisfies NotificationState);
    return true;
  }

  private async composeRoadblockEmail(plan: ClipBaitersAutomationPlan): Promise<string> {
    const ownership = await this.store.getWorkflowOwnershipRecord(
      "clipbaiters-youtube-channel-ops",
      plan.businessId
    );

    return [
      `ImonEngine reached a ClipBaiters roadblock for ${plan.businessName}.`,
      "",
      `Business: ${plan.businessName}`,
      ...(ownership ? [`Owning department: ${ownership.departmentName}`] : []),
      ...(ownership ? [`Owning position: ${ownership.positionName}`] : []),
      ...(ownership ? [`Owning workflow: ${ownership.workflowName} (${ownership.workflowId})`] : []),
      `Alias: ${plan.aliasEmail}`,
      `Status: ${plan.status}`,
      `Generated at: ${plan.generatedAt}`,
      "",
      "Roadblocks:",
      ...plan.roadblocks.flatMap((roadblock) => [
        `- ${roadblock.category}: ${roadblock.summary}`,
        ...roadblock.requiredFromOwner.map((line) => `  - Required from you: ${line}`),
        ...roadblock.continueAfterCompletion.map((line) => `  - After completion: ${line}`)
      ]),
      "",
      `Plan file: ${path.join(this.config.opsDir, "clipbaiters", plan.businessId, "plan.md")}`,
      this.config.engine.hostPrimaryIp
        ? `VPS browser: http://${this.config.engine.hostPrimaryIp}:6080/vnc.html?autoconnect=1&resize=scale`
        : "",
      "Keep the YouTube Studio sessions and the shared Chrome profile available while the remaining fair-use and source-policy blockers are cleared."
    ]
      .filter(Boolean)
      .join("\n");
  }
}