import type { SocialPlatform, SocialProfileStatus } from "./social.js";

export type ClipBaitersPlanStatus = "blocked" | "review_gated" | "ready";

export type ClipBaitersLaneStatus = "active" | "approval_required" | "research_only";

export type ClipBaitersRiskLevel = "low" | "medium" | "high";

export type ClipBaitersSourceType =
  | "google_news_rss"
  | "gdelt"
  | "official_calendar"
  | "official_youtube"
  | "creator_authorized_channel"
  | "manual_creator_brief"
  | "press_junket_feed"
  | "licensed_media_feed";

export type ClipBaitersRightsBasis =
  | "official_government"
  | "creator_authorized"
  | "official_promo"
  | "licensed"
  | "manual_review_required";

export type ClipBaitersSourceStatus = "active" | "gated" | "manual_only";

export type ClipBaitersRadarStatus = "planned" | "watching" | "review_required" | "research_only";

export type ClipBaitersStoryStatus = "briefed" | "watching" | "blocked";

export interface ClipBaitersLaneDefinition {
  id: string;
  name: string;
  focus: string;
  editorialSummary: string;
  rolloutStatus: ClipBaitersLaneStatus;
  riskLevel: ClipBaitersRiskLevel;
  reviewRequired: boolean;
  directRevenuePriority: number;
  targetPlatforms: Array<Extract<SocialPlatform, "youtube_channel" | "facebook_page">>;
  sourceTypes: ClipBaitersSourceType[];
  notes: string[];
}

export interface ClipBaitersLaneRegistry {
  businessId: string;
  businessName: string;
  aliasEmail: string;
  generatedAt: string;
  activeLaneIds: string[];
  primaryEditorialLaneId: string;
  primaryRevenueLaneId: string;
  complianceNotes: string[];
  lanes: ClipBaitersLaneDefinition[];
}

export interface ClipBaitersSourceRecord {
  id: string;
  businessId: string;
  laneId: string;
  name: string;
  sourceType: ClipBaitersSourceType;
  sourceUrl?: string;
  rightsBasis: ClipBaitersRightsBasis;
  status: ClipBaitersSourceStatus;
  trustScore: number;
  updateCadence: string;
  notes: string[];
}

export interface ClipBaitersSourceRegistry {
  businessId: string;
  generatedAt: string;
  sources: ClipBaitersSourceRecord[];
}

export type ClipBaitersWatchlistKind =
  | "youtube_channel"
  | "official_calendar"
  | "manual_brief"
  | "licensed_feed"
  | "news_discovery";

export type ClipBaitersWatchlistStatus = "active" | "passive" | "gated";

export interface ClipBaitersSourceWatchlist {
  id: string;
  businessId: string;
  laneId: string;
  sourceId: string;
  name: string;
  kind: ClipBaitersWatchlistKind;
  sourceType: ClipBaitersSourceType;
  sourceUrl?: string;
  externalId?: string;
  status: ClipBaitersWatchlistStatus;
  notes: string[];
}

export interface ClipBaitersSourceWatchlistState {
  businessId: string;
  generatedAt: string;
  watchlists: ClipBaitersSourceWatchlist[];
}

export type ClipBaitersDiscoveryStatus = "watching" | "queued_for_skim" | "skipped";

export interface ClipBaitersDiscoveredVideo {
  id: string;
  businessId: string;
  laneId: string;
  sourceId: string;
  watchlistId: string;
  title: string;
  summary: string;
  sourceUrl?: string;
  videoUrl?: string;
  rightsBasis: ClipBaitersRightsBasis;
  sourceType: ClipBaitersSourceType;
  discoveredAt: string;
  publishedAt?: string;
  isLive: boolean;
  isUpcoming: boolean;
  status: ClipBaitersDiscoveryStatus;
  notes: string[];
}

export interface ClipBaitersVideoDiscoveryState {
  businessId: string;
  generatedAt: string;
  videos: ClipBaitersDiscoveredVideo[];
}

export type ClipBaitersSkimStatus = "ready" | "blocked" | "watching";

export interface ClipBaitersSkimSummary {
  id: string;
  businessId: string;
  laneId: string;
  discoveryId: string;
  sourceId: string;
  title: string;
  summary: string;
  transcriptExcerpt?: string;
  recommendedMoments: string[];
  score: number;
  reviewRequired: boolean;
  status: ClipBaitersSkimStatus;
  notes: string[];
}

export interface ClipBaitersSkimSummaryState {
  businessId: string;
  generatedAt: string;
  summaries: ClipBaitersSkimSummary[];
}

export interface ClipBaitersChannelSetup {
  profileId: string;
  businessId: string;
  platform: Extract<SocialPlatform, "gmail_alias" | "facebook_page" | "youtube_channel">;
  status: SocialProfileStatus;
  laneId?: string;
  laneName?: string;
  handleOrAlias: string;
  profileUrl?: string;
  externalId?: string;
  purpose: string;
  blocker?: string;
  nextSteps: string[];
}

export interface ClipBaitersRoadblock {
  id: string;
  category: string;
  summary: string;
  requiredFromOwner: string[];
  continueAfterCompletion: string[];
}

export interface ClipBaitersAutomationPlan {
  businessId: string;
  businessName: string;
  aliasEmail: string;
  status: ClipBaitersPlanStatus;
  generatedAt: string;
  feedDirectory: string;
  stateDirectory: string;
  opsDirectory: string;
  primaryEditorialLaneId: string;
  primaryRevenueLaneId: string;
  laneRegistry: ClipBaitersLaneRegistry;
  sourceRegistry: ClipBaitersSourceRegistry;
  socialPresence: ClipBaitersChannelSetup[];
  roadblocks: ClipBaitersRoadblock[];
  nextAutomationSteps: string[];
}

export interface ClipBaitersEventRadarCandidate {
  id: string;
  businessId: string;
  laneId: string;
  sourceId: string;
  sourceName: string;
  sourceUrl?: string;
  title: string;
  summary: string;
  eventDate: string;
  discoveredAt: string;
  immediacy: number;
  novelty: number;
  emotionalCharge: number;
  clipPotential: number;
  policyRisk: number;
  sourceTrust: number;
  score: number;
  status: ClipBaitersRadarStatus;
  reviewRequired: boolean;
  notes: string[];
}

export interface ClipBaitersLaneRadarSnapshot {
  laneId: string;
  laneName: string;
  generatedAt: string;
  candidateCount: number;
  candidates: ClipBaitersEventRadarCandidate[];
}

export interface ClipBaitersEventRadarState {
  businessId: string;
  generatedAt: string;
  lanes: ClipBaitersLaneRadarSnapshot[];
}

export interface ClipBaitersStoryCandidate {
  id: string;
  businessId: string;
  laneId: string;
  eventId: string;
  headline: string;
  angle: string;
  rightsBasis: ClipBaitersRightsBasis;
  sourceIds: string[];
  recommendedClipMoments: string[];
  editorialHooks: string[];
  reviewRequired: boolean;
  status: ClipBaitersStoryStatus;
  notes: string[];
  createdAt: string;
}

export interface ClipBaitersLaneStoryBatch {
  laneId: string;
  laneName: string;
  generatedAt: string;
  stories: ClipBaitersStoryCandidate[];
}

export interface ClipBaitersStoryCandidateState {
  businessId: string;
  generatedAt: string;
  lanes: ClipBaitersLaneStoryBatch[];
}

export type ClipBaitersApprovedSourceClass =
  | "official_public_record"
  | "official_channel_upload"
  | "creator_authorized_submission"
  | "licensed_media_asset"
  | "synthetic_story_brief";

export type ClipBaitersTransformationTactic =
  | "context_hook"
  | "caption_template"
  | "reframe_crop"
  | "speed_adjustment"
  | "series_split"
  | "voiceover_ready";

export interface ClipBaitersTransformationReview {
  approvedSourceClass: ClipBaitersApprovedSourceClass;
  tactics: ClipBaitersTransformationTactic[];
  attributionText: string;
  rationale: string;
  policyRiskScore: number;
  automationEligible: boolean;
}

export interface ClipBaitersRightsReviewApproval {
  businessId: string;
  businessName: string;
  approvedAt: string;
  approvedBy: string;
  statement: string;
  allowedRightsBasis: Array<Exclude<ClipBaitersRightsBasis, "manual_review_required">>;
  approvedSourceClasses: Array<Exclude<ClipBaitersApprovedSourceClass, "synthetic_story_brief">>;
  reviewChecklist: string[];
  reviewRequiredLaneIds: string[];
  gatedLaneIds: string[];
  notes: string[];
}

export interface ClipBaitersLanePostureApprovalLane {
  laneId: string;
  laneName: string;
  rolloutStatus: ClipBaitersLaneStatus;
  approvedSourceTypes: ClipBaitersSourceType[];
  activationCriteria: string[];
  notes: string[];
}

export interface ClipBaitersLanePostureApproval {
  businessId: string;
  businessName: string;
  approvedAt: string;
  approvedBy: string;
  statement: string;
  laneStatusSignature: string;
  activeLaneIds: string[];
  gatedLaneIds: string[];
  approvedLanes: ClipBaitersLanePostureApprovalLane[];
  notes: string[];
}

export interface ClipBaitersSeriesPart {
  seriesId: string;
  partNumber: number;
  totalParts: number;
  label: string;
}

export type ClipBaitersFeedOrigin = "manual_manifest" | "story_brief";

export type ClipBaitersMediaType = "video" | "live_stream" | "brief" | "schedule";

export type ClipBaitersManifestApprovalState = "approved" | "review_required";

export type ClipBaitersTranscriptSource = "manual_manifest" | "story_brief";

export type ClipBaitersClipCandidateStatus = "prepared" | "blocked";

export type ClipBaitersClipJobStatus = "drafted" | "rendered" | "blocked";

export interface ClipBaitersSourceFeedManifest {
  id: string;
  businessId: string;
  laneId: string;
  laneName?: string;
  origin: ClipBaitersFeedOrigin;
  mediaType: ClipBaitersMediaType;
  title: string;
  sourceUrl?: string;
  localMediaPath?: string;
  sourceId?: string;
  eventId?: string;
  storyId?: string;
  rightsBasis: ClipBaitersRightsBasis;
  approvalState: ClipBaitersManifestApprovalState;
  transcriptText?: string;
  notes: string[];
}

export interface ClipBaitersTranscriptSegment {
  id: string;
  index: number;
  startSeconds: number;
  endSeconds: number;
  speaker: string;
  text: string;
  confidence: number;
}

export interface ClipBaitersClipMoment {
  id: string;
  label: string;
  startSeconds: number;
  endSeconds: number;
  reason: string;
  energyScore: number;
  policyRisk: number;
  captionLines: string[];
}

export interface ClipBaitersToolCommandPreview {
  tool: "yt-dlp" | "ffmpeg" | "whisper";
  command: string;
  note: string;
}

export interface ClipBaitersClipCandidate {
  id: string;
  businessId: string;
  laneId: string;
  laneName: string;
  status: ClipBaitersClipCandidateStatus;
  dryRun: boolean;
  sourceTitle: string;
  sourceUrl?: string;
  localMediaPath?: string;
  sourceId?: string;
  eventId?: string;
  storyId?: string;
  manifestId: string;
  rightsBasis: ClipBaitersRightsBasis;
  approvedSourceClass: ClipBaitersApprovedSourceClass;
  approvalState: ClipBaitersManifestApprovalState;
  transcriptSource: ClipBaitersTranscriptSource;
  editorialAngle: string;
  commentaryHook: string;
  transformationReview: ClipBaitersTransformationReview;
  seriesPart?: ClipBaitersSeriesPart;
  maxDurationSeconds: number;
  transcriptSegments: ClipBaitersTranscriptSegment[];
  suggestedMoments: ClipBaitersClipMoment[];
  pipelinePreview: ClipBaitersToolCommandPreview[];
  createdAt: string;
  notes: string[];
}

export interface ClipBaitersClipCandidateState {
  businessId: string;
  laneId: string;
  generatedAt: string;
  dryRun: boolean;
  manifests: ClipBaitersSourceFeedManifest[];
  candidates: ClipBaitersClipCandidate[];
}

export interface ClipBaitersCaptionTrackCue {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface ClipBaitersEditDecision {
  aspectRatio: "9:16";
  reframingStrategy: string;
  captionStyle: string;
  templateName: string;
  speedAdjustmentPercent: number;
  voiceoverRequired: boolean;
  attributionText: string;
  openingBeat: string;
  endingBeat: string;
  emphasisWords: string[];
}

export interface ClipBaitersRenderArtifacts {
  sourceMediaPath?: string;
  transcriptJsonPath?: string;
  renderedVideoPath: string;
  attributionTextPath: string;
  renderLogPath: string;
}

export interface ClipBaitersClipJob {
  id: string;
  businessId: string;
  laneId: string;
  laneName: string;
  candidateId: string;
  status: ClipBaitersClipJobStatus;
  dryRun: boolean;
  sourceTitle: string;
  sourceUrl?: string;
  localMediaPath?: string;
  workingTitle: string;
  headlineOptions: string[];
  description: string;
  rightsBasis: ClipBaitersRightsBasis;
  approvedSourceClass: ClipBaitersApprovedSourceClass;
  reviewRequired: boolean;
  transformationReview: ClipBaitersTransformationReview;
  automationEligible: boolean;
  seriesPart?: ClipBaitersSeriesPart;
  clipWindow: {
    startSeconds: number;
    endSeconds: number;
  };
  editDecision: ClipBaitersEditDecision;
  captionTrack: ClipBaitersCaptionTrackCue[];
  renderPlan: ClipBaitersToolCommandPreview[];
  renderArtifacts: ClipBaitersRenderArtifacts;
  outputPackageDir: string;
  outputFiles: {
    briefJsonPath: string;
    captionSrtPath: string;
    notesMarkdownPath: string;
    voiceoverTextPath: string;
  };
  renderedAt?: string;
  createdAt: string;
  notes: string[];
}

export interface ClipBaitersClipJobState {
  businessId: string;
  laneId: string;
  generatedAt: string;
  dryRun: boolean;
  jobs: ClipBaitersClipJob[];
}

export interface ClipBaitersToolingStatus {
  tool: "ffmpeg" | "yt-dlp" | "whisper";
  available: boolean;
  version?: string;
  note: string;
}

export interface ClipBaitersAutonomySnapshot {
  businessId: string;
  businessName: string;
  laneId: string;
  laneName: string;
  generatedAt: string;
  status: "blocked" | "ready";
  dryRun: boolean;
  sourceManifestCount: number;
  candidateCount: number;
  clipJobCount: number;
  renderedClipCount: number;
  renderBlockedCount: number;
  tooling: ClipBaitersToolingStatus[];
  manualGates: string[];
  summary: string;
  nextStep: string;
  artifactPaths: string[];
}

export type ClipBaitersPublishingQueueStatus =
  | "blocked"
  | "awaiting_review"
  | "approved"
  | "publishing"
  | "live"
  | "failed";

export type ClipBaitersUploadBatchStatus =
  | "draft"
  | "review_required"
  | "approved"
  | "publishing"
  | "live"
  | "failed"
  | "blocked";

export type ClipBaitersReviewGateKind =
  | "editorial_review"
  | "rights_review"
  | "political_sensitivity";

export interface ClipBaitersPublishingQueueItem {
  id: string;
  businessId: string;
  laneId: string;
  laneName: string;
  clipJobId: string;
  channelProfileId?: string;
  channelHandle?: string;
  channelStatus: SocialProfileStatus | "missing";
  dryRun: boolean;
  status: ClipBaitersPublishingQueueStatus;
  reviewRequired: boolean;
  approvalId?: string;
  sourceTitle: string;
  title: string;
  description: string;
  tags: string[];
  thumbnailText: string[];
  sourceUrl?: string;
  rightsBasis: ClipBaitersRightsBasis;
  approvedSourceClass: ClipBaitersApprovedSourceClass;
  transformationTactics: ClipBaitersTransformationTactic[];
  automationEligible: boolean;
  renderReady: boolean;
  renderedVideoPath?: string;
  seriesPart?: ClipBaitersSeriesPart;
  scheduledWindowLabel?: string;
  scheduledFor: string;
  videoUrl?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  notes: string[];
}

export interface ClipBaitersPublishingQueueState {
  businessId: string;
  laneId: string;
  generatedAt: string;
  dryRun: boolean;
  items: ClipBaitersPublishingQueueItem[];
}

export interface ClipBaitersUploadBatch {
  id: string;
  businessId: string;
  laneId: string;
  laneName: string;
  dryRun: boolean;
  channelProfileId?: string;
  status: ClipBaitersUploadBatchStatus;
  queueItemIds: string[];
  reviewRequiredCount: number;
  approvedCount: number;
  liveCount: number;
  failedCount: number;
  scheduledFor: string;
  createdAt: string;
  updatedAt: string;
  notes: string[];
}

export interface ClipBaitersUploadBatchState {
  businessId: string;
  laneId: string;
  generatedAt: string;
  dryRun: boolean;
  batches: ClipBaitersUploadBatch[];
}

export type ClipBaitersPublishHistoryStatus =
  | "skipped"
  | "publishing"
  | "live"
  | "failed"
  | "blocked";

export interface ClipBaitersPublishHistoryEntry {
  id: string;
  businessId: string;
  laneId: string;
  queueItemId: string;
  clipJobId: string;
  status: ClipBaitersPublishHistoryStatus;
  command?: string;
  publishedAt?: string;
  createdAt: string;
  notes: string[];
}

export interface ClipBaitersPublishHistoryState {
  businessId: string;
  generatedAt: string;
  entries: ClipBaitersPublishHistoryEntry[];
}

export interface ClipBaitersPublishManualGate {
  id: string;
  kind: ClipBaitersReviewGateKind;
  status: "open" | "waiting" | "completed";
  relatedEntityId: string;
  summary: string;
  instructions: string;
}

export interface ClipBaitersChannelMetricProfile {
  profileId?: string;
  platform: Extract<SocialPlatform, "youtube_channel" | "facebook_page">;
  laneId: string;
  laneName: string;
  handleOrProfile: string;
  queuedCount: number;
  scheduledCount: number;
  reviewRequiredCount: number;
  approvedCount: number;
  renderReadyCount: number;
  liveCount: number;
  failedCount: number;
  policyEventCount: number;
  watchTimeHours: number;
  subscriberDelta: number;
  lastPublishedAt?: string;
  nextScheduledFor?: string;
  notes: string[];
}

export interface ClipBaitersChannelMetricsState {
  businessId: string;
  generatedAt: string;
  profiles: ClipBaitersChannelMetricProfile[];
}

export type ClipBaitersPublishStatus = "blocked" | "review_gated" | "ready";

export interface ClipBaitersPublishSnapshot {
  businessId: string;
  businessName: string;
  laneId: string;
  laneName: string;
  generatedAt: string;
  status: ClipBaitersPublishStatus;
  dryRun: boolean;
  queueItemCount: number;
  reviewRequiredCount: number;
  approvedCount: number;
  liveCount: number;
  failedCount: number;
  channelProfileId?: string;
  channelStatus: SocialProfileStatus | "missing";
  manualGates: ClipBaitersPublishManualGate[];
  summary: string;
  nextStep: string;
  artifactPaths: string[];
}

export type ClipBaitersPostingScheduleAllocationStatus =
  | "planned"
  | "published"
  | "skipped"
  | "failed";

export interface ClipBaitersPostingScheduleAllocation {
  id: string;
  businessId: string;
  queueItemId: string;
  clipJobId: string;
  laneId: string;
  laneName: string;
  timezone: string;
  day: string;
  windowLabel: string;
  scheduledFor: string;
  status: ClipBaitersPostingScheduleAllocationStatus;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClipBaitersPostingScheduleState {
  businessId: string;
  generatedAt: string;
  timezone: string;
  dailyPostCap: number;
  preferredWindows: string[];
  allocations: ClipBaitersPostingScheduleAllocation[];
}

export type ClipBaitersCreatorOfferBillingModel = "monthly" | "per_event" | "one_time";

export type ClipBaitersCreatorOfferStatus = "payment_link_ready" | "approval_required";

export interface ClipBaitersCreatorOffer {
  id: string;
  businessId: string;
  laneId: string;
  laneName: string;
  name: string;
  summary: string;
  billingModel: ClipBaitersCreatorOfferBillingModel;
  priceUsd: number;
  currency: string;
  deliveryWindowHours: number;
  paymentLink?: string;
  status: ClipBaitersCreatorOfferStatus;
  deliverables: string[];
  notes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ClipBaitersCreatorOfferState {
  businessId: string;
  generatedAt: string;
  offers: ClipBaitersCreatorOffer[];
}

export type ClipBaitersCreatorOrderPaymentStatus = "pending" | "paid";

export type ClipBaitersCreatorLeadStatus =
  | "prospect"
  | "contacted"
  | "interested"
  | "quoted"
  | "paid"
  | "active"
  | "paused"
  | "closed_lost";

export interface ClipBaitersCreatorLead {
  id: string;
  businessId: string;
  laneId: string;
  creatorName: string;
  creatorHandle?: string;
  contactEmail?: string;
  sourceChannelUrl?: string;
  status: ClipBaitersCreatorLeadStatus;
  offerId?: string;
  quotedPriceUsd?: number;
  lastContactAt?: string;
  lastStatusAt?: string;
  notes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ClipBaitersCreatorLeadState {
  businessId: string;
  generatedAt: string;
  leads: ClipBaitersCreatorLead[];
}

export type ClipBaitersCreatorOutreachChannel = "shared_gmail" | "manual";

export type ClipBaitersCreatorOutreachStatus =
  | "drafted"
  | "ready_to_send"
  | "sent"
  | "manual_send_required";

export interface ClipBaitersCreatorOutreachDraft {
  id: string;
  businessId: string;
  leadId: string;
  laneId: string;
  creatorName: string;
  channel: ClipBaitersCreatorOutreachChannel;
  status: ClipBaitersCreatorOutreachStatus;
  subject: string;
  body: string;
  toEmail?: string;
  offerId?: string;
  paymentLink?: string;
  createdAt: string;
  updatedAt: string;
  notes: string[];
}

export interface ClipBaitersCreatorOutreachState {
  businessId: string;
  generatedAt: string;
  drafts: ClipBaitersCreatorOutreachDraft[];
}

export type ClipBaitersCreatorOrderStatus =
  | "pending_payment"
  | "paid"
  | "in_delivery"
  | "delivered"
  | "blocked";

export interface ClipBaitersCreatorOrderIntakeManifest {
  id?: string;
  laneId?: string;
  creatorName: string;
  creatorHandle?: string;
  contactEmail?: string;
  offerId?: string;
  quotedPriceUsd?: number;
  paymentStatus?: ClipBaitersCreatorOrderPaymentStatus | string;
  status?: ClipBaitersCreatorOrderStatus | string;
  paidAt?: string;
  scheduledAt?: string;
  deliveredAt?: string;
  turnaroundHours?: number;
  creatorAuthorizationConfirmed?: boolean;
  sourceChannelUrl?: string;
  requestedDeliverables?: string[];
  deliveryArtifacts?: string[];
  notes?: string[];
  createdAt?: string;
}

export interface ClipBaitersCreatorOrder {
  id: string;
  businessId: string;
  laneId: string;
  laneName: string;
  creatorName: string;
  creatorHandle?: string;
  contactEmail?: string;
  offerId: string;
  offerName: string;
  quotedPriceUsd: number;
  currency: string;
  paymentStatus: ClipBaitersCreatorOrderPaymentStatus;
  status: ClipBaitersCreatorOrderStatus;
  paidAt?: string;
  scheduledAt?: string;
  deliveredAt?: string;
  turnaroundHours: number;
  creatorAuthorizationConfirmed: boolean;
  sourceChannelUrl?: string;
  requestedDeliverables: string[];
  intakeSourcePath: string;
  deliveryArtifacts: string[];
  notes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ClipBaitersCreatorOrderState {
  businessId: string;
  generatedAt: string;
  intakeDirectory: string;
  intakeReadmePath: string;
  orders: ClipBaitersCreatorOrder[];
}

export interface ClipBaitersRevenueOfferBreakdown {
  offerId: string;
  offerName: string;
  orderCount: number;
  paidOrderCount: number;
  deliveredOrderCount: number;
  bookedRevenueUsd: number;
  paidRevenueUsd: number;
  deliveredRevenueUsd: number;
}

export interface ClipBaitersRevenueSnapshot {
  id: string;
  businessId: string;
  laneId: string;
  laneName: string;
  generatedAt: string;
  currency: string;
  orderCount: number;
  paidOrderCount: number;
  deliveredOrderCount: number;
  bookedRevenueUsd: number;
  paidRevenueUsd: number;
  deliveredRevenueUsd: number;
  pendingCollectionUsd: number;
  deliveryBacklogUsd: number;
  offers: ClipBaitersRevenueOfferBreakdown[];
  notes: string[];
}

export interface ClipBaitersRevenueSnapshotState {
  businessId: string;
  generatedAt: string;
  snapshots: ClipBaitersRevenueSnapshot[];
}

export type ClipBaitersMonetizationStatus = "blocked" | "review_gated" | "ready";

export interface ClipBaitersMonetizationSnapshot {
  businessId: string;
  businessName: string;
  laneId: string;
  laneName: string;
  generatedAt: string;
  status: ClipBaitersMonetizationStatus;
  offerCount: number;
  configuredPaymentLinks: number;
  orderCount: number;
  paidOrderCount: number;
  deliveredOrderCount: number;
  openApprovalCount: number;
  summary: string;
  nextStep: string;
  artifactPaths: string[];
}

export interface ClipBaitersDealsSnapshot {
  businessId: string;
  businessName: string;
  laneId: string;
  laneName: string;
  generatedAt: string;
  leadCount: number;
  outreachDraftCount: number;
  activeCount: number;
  paidCount: number;
  prospectCount: number;
  summary: string;
  nextStep: string;
  artifactPaths: string[];
}