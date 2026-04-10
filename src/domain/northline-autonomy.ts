import type { ApprovalStatus, BillingStatus } from "./contracts.js";
import type { BusinessRunStatus } from "./engine.js";
import type { NorthlineAutomationPlan } from "./northline.js";

export type NorthlineAutonomyGateKind =
  | "outbound_send"
  | "qa_stall"
  | "owner_decision";

export interface NorthlineAutonomyState {
  businessId: string;
  processedSubmissionIds: string[];
  lastRunAt?: string;
  lastRunStatus?: BusinessRunStatus;
  lastSummaryHash?: string;
  lastSummaryNotifiedAt?: string;
  updatedAt: string;
}

export interface NorthlineAutonomyIntakeWorkItem {
  submissionId: string;
  clientId?: string;
  status: "created" | "updated" | "incomplete" | "duplicate";
  summary: string;
  notes: string[];
}

export interface NorthlineAutonomyOutboundQueueItem {
  draftId: string;
  leadId: string;
  approvalId?: string;
  status: "awaiting_compliance" | "awaiting_manual_send" | "sent" | "completed";
  summary: string;
}

export interface NorthlineAutonomyReplyWorkItem {
  leadId: string;
  replyId: string;
  externalThreadId?: string;
  status:
    | "logged"
    | "responded"
    | "booked_call"
    | "intake_follow_up"
    | "lost"
    | "duplicate"
    | "error";
  summary: string;
  nextAction: string;
}

export interface NorthlineAutonomyDeliveryWorkItem {
  clientId: string;
  billingStatus: BillingStatus;
  status:
    | "waiting_billing"
    | "qa_failed"
    | "handoff_complete"
    | "stable";
  actions: string[];
  summary: string;
}

export interface NorthlineAutonomyManualGate {
  id: string;
  kind: NorthlineAutonomyGateKind;
  status: ApprovalStatus;
  relatedEntityId: string;
  summary: string;
  instructions: string;
}

export interface NorthlineAutonomySnapshot {
  businessId: string;
  generatedAt: string;
  planStatus: NorthlineAutomationPlan["status"];
  planOperatingMode: NorthlineAutomationPlan["operatingMode"]["current"];
  status: BusinessRunStatus;
  summary: string;
  notes: string[];
  roadblocks: string[];
  newIntakes: NorthlineAutonomyIntakeWorkItem[];
  outboundQueue: NorthlineAutonomyOutboundQueueItem[];
  replyQueue: NorthlineAutonomyReplyWorkItem[];
  deliveryQueue: NorthlineAutonomyDeliveryWorkItem[];
  manualGates: NorthlineAutonomyManualGate[];
}

export interface NorthlineAutonomyArtifacts {
  statePath: string;
  summaryJsonPath: string;
  summaryMarkdownPath: string;
  notificationPath?: string;
}

export interface NorthlineAutonomyRunResult {
  status: BusinessRunStatus;
  summary: string;
  details: string[];
  plan: NorthlineAutomationPlan;
  snapshot: NorthlineAutonomySnapshot;
  artifacts: NorthlineAutonomyArtifacts;
}