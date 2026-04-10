import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import nodemailer from "nodemailer";
import path from "node:path";
import { promisify } from "node:util";
import type { AppConfig } from "../config.js";
import {
  clientProofEligibilityForProvenance,
  isInternalValidationClient,
  type ApprovalTask,
  type BillingStatus,
  type ClientJob,
  type ClientProvenance,
  type LeadRecord,
  type LeadReplyClassification,
  type OutreachDraft,
  type OutreachSendReceipt,
  type RetentionReport
} from "../domain/contracts.js";
import type { BusinessRunStatus, ManagedBusiness } from "../domain/engine.js";
import type {
  NorthlineAutonomyArtifacts,
  NorthlineAutonomyDeliveryWorkItem,
  NorthlineAutonomyGateKind,
  NorthlineAutonomyIntakeWorkItem,
  NorthlineAutonomyManualGate,
  NorthlineAutonomyOutboundQueueItem,
  NorthlineAutonomyReplyWorkItem,
  NorthlineAutonomyRunResult,
  NorthlineAutonomySnapshot,
  NorthlineAutonomyState
} from "../domain/northline-autonomy.js";
import {
  DEFAULT_NORTHLINE_BUSINESS_ID,
  type NorthlineAutomationPlan,
  type ResolvedNorthlineBusinessProfile
} from "../domain/northline.js";
import { ensureDir, readJsonFile, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { OrchestratorAgent } from "../agents/orchestrator.js";
import type { Deployer } from "../agents/deployer.js";
import { ReplyHandlerAgent } from "../agents/reply-handler.js";
import { QaReviewerAgent } from "../agents/qa-reviewer.js";
import { SiteBuilderAgent } from "../agents/site-builder.js";
import { FileStore } from "../storage/store.js";
import { NorthlineOpsService } from "./northline-ops.js";
import {
  NorthlineProspectCollectorService,
  type NorthlineProspectCollectionRunResult
} from "./northline-prospect-collector.js";
import {
  NorthlineProspectSourcingService,
  type NorthlineProspectSourcingRunResult
} from "./northline-prospect-sourcing.js";
import {
  countNorthlineScopedActiveWorkItems,
  northlineLeadMatchesBusinessScope,
  northlineBusinessOpsDir,
  northlineBusinessStateFilePath,
  resolveNorthlineBusinessProfile
} from "./northline-business-profile.js";
import { processLeadReply } from "./lead-replies.js";

const NORTHLINE_BUSINESS_ID = DEFAULT_NORTHLINE_BUSINESS_ID;
const STATE_FILE = "northlineAutonomy.json";
const SUMMARY_JSON_FILE = "autonomy-summary.json";
const SUMMARY_MARKDOWN_FILE = "autonomy-summary.md";
const execFileAsync = promisify(execFile);
const PYTHON_COMMAND = process.platform === "win32" ? "python" : "python3";
const MIN_INBOX_SYNC_TIMEOUT_MS = 120000;
const INBOX_SYNC_TIMEOUT_MS_PER_CANDIDATE = 30000;

type NorthlineIntakePayload = {
  ownerName?: string;
  businessName?: string;
  email?: string;
  phone?: string;
  serviceArea?: string;
  primaryServices?: string;
  preferredCallWindow?: string;
  contactPreference?: string;
  website?: string;
  leadGoal?: string;
  biggestLeak?: string;
  notes?: string;
  source?: string;
};

type NorthlineIntakeSubmission = NorthlineIntakePayload & {
  id: string;
  receivedAt: string;
  remoteAddress?: string;
  userAgent?: string;
};

type NorthlineIntakeStore =
  | NorthlineIntakeSubmission[]
  | {
      submissions: NorthlineIntakeSubmission[];
      lastReceivedAt?: string;
    };

type IntakeSyncResult = {
  items: NorthlineAutonomyIntakeWorkItem[];
  manualGates: NorthlineAutonomyManualGate[];
  processedSubmissionIds: string[];
};

type QueueSyncResult<TItem> = {
  items: TItem[];
  manualGates: NorthlineAutonomyManualGate[];
};

type OutboundSendAttemptResult = {
  receipts: OutreachSendReceipt[];
  sentReceipt?: OutreachSendReceipt;
};

type NorthlineInboxSyncCandidate = {
  leadId: string;
  recipient: string;
  subject: string;
  sentAt: string;
};

type NorthlineInboxSyncScriptResult = {
  leadId: string;
  status: "reply_found" | "no_reply" | "error";
  recipient?: string;
  subject?: string;
  externalThreadId?: string;
  externalMessageId?: string;
  fromAddress?: string;
  body?: string;
  receivedAt?: string;
  reason?: string;
};

type NorthlineInboxSync = (
  candidates: NorthlineInboxSyncCandidate[],
  businessProfile: ResolvedNorthlineBusinessProfile
) => Promise<NorthlineInboxSyncScriptResult[]>;

type ReplySyncResult = {
  items: NorthlineAutonomyReplyWorkItem[];
  manualGates: NorthlineAutonomyManualGate[];
};

type NorthlineOutboundSender = (
  lead: LeadRecord,
  draft: OutreachDraft,
  businessProfile: ResolvedNorthlineBusinessProfile
) => Promise<OutboundSendAttemptResult>;

export interface NorthlineBillingAutomationRunResult {
  status: "success" | "blocked";
  summary: string;
  businessId: string;
  clientId: string;
  clientName: string;
  billingStatus: ClientJob["billingStatus"];
  previewPath?: string;
  siteStatus: ClientJob["siteStatus"];
  qaStatus: ClientJob["qaStatus"];
  handoffPackage?: {
    clientId: string;
    createdAt: string;
    reportPath: string;
    readmePath: string;
  };
  retentionReport?: Pick<RetentionReport, "clientId" | "createdAt" | "upsellCandidate" | "upgradeOffer">;
  warnings: string[];
  artifacts: {
    autonomySummaryPath: string;
    previewPath?: string;
    proofBundlePath?: string;
    proofScreenshotPaths: string[];
    handoffPackagePath?: string;
    productionUrl?: string;
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function compact(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[;,|]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isProposalStatus(status: BillingStatus): boolean {
  return status === "proposal" || status === "deposit_pending";
}

function isDeliveryEligible(status: BillingStatus): boolean {
  return status === "paid" || status === "retainer_active";
}

function sameMonth(leftIso: string, rightIso: string): boolean {
  return leftIso.slice(0, 7) === rightIso.slice(0, 7);
}

function summaryHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeIntakeStore(store: NorthlineIntakeStore): NorthlineIntakeSubmission[] {
  return Array.isArray(store) ? store : store.submissions;
}

function businessClient(client: ClientJob, businessId: string): boolean {
  return (client.businessId ?? NORTHLINE_BUSINESS_ID) === businessId;
}

function pushUnique(values: string[], nextValue: string | undefined): string[] {
  if (!nextValue || values.includes(nextValue)) {
    return values;
  }
  return [...values, nextValue];
}

function automatedReplySource(provider: AppConfig["northlineMail"]["inboxProvider"]): "gmail_cdp" | "imap" {
  return provider === "imap" ? "imap" : "gmail_cdp";
}

function proofMetadataFromSubmission(
  submission: Pick<NorthlineIntakeSubmission, "source">
): Pick<ClientJob, "provenance" | "proofEligible"> {
  const provenance: ClientProvenance =
    compact(submission.source)?.toLowerCase() === "northline-validation-page"
      ? "internal_validation"
      : "external_inbound";

  return {
    provenance,
    proofEligible: clientProofEligibilityForProvenance(provenance)
  };
}

export class NorthlineAutonomyService {
  private readonly outboundSender: NorthlineOutboundSender;
  private readonly inboxSync: NorthlineInboxSync;
  private readonly deployer?: Pick<Deployer, "deploy">;

  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore,
    private readonly northlineOps: NorthlineOpsService,
    private readonly prospectCollector: NorthlineProspectCollectorService,
    private readonly prospectSourcing: NorthlineProspectSourcingService,
    private readonly orchestrator: OrchestratorAgent,
    private readonly replyHandler: ReplyHandlerAgent,
    private readonly siteBuilder: SiteBuilderAgent,
    private readonly qaReviewer: QaReviewerAgent,
    options?: {
      outboundSender?: NorthlineOutboundSender;
      inboxSync?: NorthlineInboxSync;
      deployer?: Pick<Deployer, "deploy">;
    }
  ) {
    this.outboundSender =
      options?.outboundSender ??
      (async (lead, draft, businessProfile) => this.sendApprovedDraft(lead, draft, businessProfile));
    this.inboxSync =
      options?.inboxSync ??
      (async (candidates, businessProfile) => this.syncInboxCandidates(candidates, businessProfile));
    this.deployer = options?.deployer;
  }

  async applyBillingHandoff(options: {
    clientId: string;
    status: Extract<BillingStatus, "paid" | "retainer_active">;
    formEndpoint?: string;
    nextAction?: string;
    note?: string;
  }): Promise<{ client: ClientJob }> {
    const client = await this.store.getClient(options.clientId);
    if (!client) {
      throw new Error(`Client ${options.clientId} not found.`);
    }

    const updatedAt = nowIso();
    const nextAction =
      options.nextAction ??
      (options.status === "retainer_active"
        ? "Autonomous delivery and retention are unlocked."
        : "Autonomous build and QA are unlocked.");
    const intakeNotes = pushUnique(
      pushUnique(client.intakeNotes, options.note),
      `Billing handoff recorded ${updatedAt} with status ${options.status}.`
    );
    const nextClient: ClientJob = {
      ...client,
      billingStatus: options.status,
      formEndpoint: options.formEndpoint ?? client.formEndpoint,
      nextAction,
      intakeNotes,
      updatedAt
    };

    await this.store.saveClient(nextClient);
    await this.orchestrator
      .getAccountOps()
      .completeTask(this.billingTaskId(nextClient.id), "Billing handoff was recorded.");

    return {
      client: nextClient
    };
  }

  async runBillingAutomation(options: {
    clientId: string;
    status: Extract<BillingStatus, "paid" | "retainer_active">;
    formEndpoint?: string;
    stripeContext?: {
      customerEmail?: string;
      eventId: string;
      referenceId?: string;
      sessionId?: string;
    };
  }): Promise<NorthlineBillingAutomationRunResult> {
    const stripeNote = options.stripeContext
      ? [
          `Stripe checkout completed ${nowIso()} with status ${options.status}.`,
          `Event: ${options.stripeContext.eventId}.`,
          options.stripeContext.sessionId
            ? `Session: ${options.stripeContext.sessionId}.`
            : undefined,
          options.stripeContext.referenceId
            ? `Reference: ${options.stripeContext.referenceId}.`
            : undefined,
          options.stripeContext.customerEmail
            ? `Customer email: ${options.stripeContext.customerEmail}.`
            : undefined
        ]
          .filter((value): value is string => Boolean(value))
          .join(" ")
      : undefined;
    const handoff = await this.applyBillingHandoff({
      clientId: options.clientId,
      status: options.status,
      formEndpoint: options.formEndpoint,
      nextAction:
        options.status === "retainer_active"
          ? "Stripe payment confirmed. Autonomous delivery, client handoff packaging, and retention are unlocked."
          : "Stripe payment confirmed. Autonomous build, QA, and client handoff packaging are unlocked.",
      note: stripeNote
    });
    const businessId = handoff.client.businessId ?? NORTHLINE_BUSINESS_ID;
    const deliveryRun = await this.run({ businessId });
    const refreshedClient = (await this.store.getClient(options.clientId)) ?? handoff.client;
    const retentionReport =
      options.status === "retainer_active"
        ? this.latestRetentionReport(
            (await this.store.getRetentionReports()).filter(
              (report) => report.clientId === refreshedClient.id
            )
          )
        : undefined;
    const proofBundle = refreshedClient.assets.proofBundle;
    const handoffPackage = refreshedClient.assets.handoffPackage;
    const warnings: string[] = [];

    if (refreshedClient.qaStatus !== "passed") {
      warnings.push(`QA is ${refreshedClient.qaStatus}. Review runtime/reports for details.`);
    }
    if (refreshedClient.siteStatus === "qa_failed") {
      warnings.push("The preview build failed QA and needs a manual fix before handoff.");
    }
    if (refreshedClient.qaStatus === "passed" && !proofBundle) {
      warnings.push("Proof bundle was not generated for the delivered client.");
    }
    if (proofBundle && proofBundle.screenshots.length === 0) {
      warnings.push("Proof bundle is present, but screenshot capture is still missing.");
    }
    if (refreshedClient.qaStatus === "passed" && !handoffPackage) {
      warnings.push("Preview is QA-passed, but the client handoff package was not generated yet.");
    }
    if (options.status === "retainer_active" && !retentionReport) {
      warnings.push("Retention coverage was requested, but no retention report was generated.");
    }

    const deliveryCompleted =
      refreshedClient.qaStatus === "passed" &&
      proofBundle !== undefined &&
      proofBundle.screenshots.length > 0 &&
      handoffPackage !== undefined &&
      (options.status !== "retainer_active" || retentionReport !== undefined);
    const status: NorthlineBillingAutomationRunResult["status"] =
      warnings.length === 0 && deliveryCompleted ? "success" : "blocked";

    return {
      status,
      summary:
        status === "success"
          ? `Stripe payment for ${refreshedClient.clientName} advanced through build, QA, proof capture, and client handoff packaging automatically.`
          : `Stripe payment for ${refreshedClient.clientName} moved through the pipeline with follow-up items to review.`,
      businessId,
      clientId: refreshedClient.id,
      clientName: refreshedClient.clientName,
      billingStatus: refreshedClient.billingStatus,
      previewPath: refreshedClient.deployment.previewPath,
      siteStatus: refreshedClient.siteStatus,
      qaStatus: refreshedClient.qaStatus,
      handoffPackage: handoffPackage
        ? {
            clientId: handoffPackage.clientId,
            createdAt: handoffPackage.createdAt,
            reportPath: handoffPackage.reportPath,
            readmePath: handoffPackage.readmePath
          }
        : undefined,
      retentionReport: retentionReport
        ? {
            clientId: retentionReport.clientId,
            createdAt: retentionReport.createdAt,
            upsellCandidate: retentionReport.upsellCandidate,
            upgradeOffer: retentionReport.upgradeOffer
          }
        : undefined,
      warnings,
      artifacts: {
        autonomySummaryPath: deliveryRun.artifacts.summaryJsonPath,
        previewPath: refreshedClient.deployment.previewPath,
        proofBundlePath: proofBundle?.reportPath,
        proofScreenshotPaths: proofBundle?.screenshots.map((item) => item.path) ?? [],
        handoffPackagePath: handoffPackage?.reportPath,
        productionUrl: refreshedClient.deployment.productionUrl
      }
    };
  }

  async run(options?: {
    businessId?: string;
    notifyRoadblocks?: boolean;
  }): Promise<NorthlineAutonomyRunResult> {
    const businessId = options?.businessId ?? NORTHLINE_BUSINESS_ID;
    const business = await this.requireBusiness(businessId);
    const startedAt = nowIso();
    const state = await this.readState(business.id);
    const collectionResult = await this.prospectCollector.run({ businessId: business.id });
    const sourcingResult = await this.prospectSourcing.run({ businessId: business.id });

    await this.orchestrator.getAccountOps().ensureOperationalApprovals();

    const intakeResult = await this.syncHostedIntake(business, state);
    const drafted = await this.orchestrator.draftOutreach(10, { businessId: business.id });
    const outboundResult = await this.syncOutboundQueue(business);
    const replyResult = await this.syncReplyQueue(business);
    const deliveryResult = await this.syncDeliveryQueue(business.id);
    const hiddenValidationClientIds = await this.validationArtifactClientIds(business.id);
    const visibleIntakeResult = this.filterValidationIntakeResult(
      intakeResult,
      hiddenValidationClientIds
    );
    const visibleDeliveryResult = this.filterValidationDeliveryResult(
      deliveryResult,
      hiddenValidationClientIds
    );
    const planResult = await this.northlineOps.writePlan({ businessId: business.id });
    const promotionQueueResult = await this.northlineOps.refreshPromotionQueue({
      businessId: business.id,
      plan: planResult.plan
    });
    const generatedAt = nowIso();
    const notes = this.buildNotes(
      planResult.plan,
      collectionResult,
      sourcingResult,
      visibleIntakeResult,
      replyResult,
      outboundResult,
      visibleDeliveryResult,
      drafted
    );
    notes.push(
      promotionQueueResult.queuedItems.filter((item) => item.status === "planned").length > 0
        ? `Promotion queue active with ${promotionQueueResult.queuedItems.filter((item) => item.status === "planned").length} planned post(s) on ${promotionQueueResult.supportedPlatforms.join(", ")}.`
        : promotionQueueResult.unsupportedPlatforms.length > 0
          ? `Live social surfaces exist on ${promotionQueueResult.unsupportedPlatforms.join(", ")}, but those channels still need a repo publishing path.`
          : "Promotion queue is idle because no live supported social publishing surface is configured yet."
    );
    const manualGates = [
      ...visibleIntakeResult.manualGates,
      ...replyResult.manualGates,
      ...outboundResult.manualGates,
      ...visibleDeliveryResult.manualGates
    ].sort((left, right) => left.id.localeCompare(right.id));
    const roadblocks = planResult.plan.roadblocks.map((roadblock) => roadblock.summary);
    const snapshot: NorthlineAutonomySnapshot = {
      businessId: business.id,
      generatedAt,
      planStatus: planResult.plan.status,
      planOperatingMode: planResult.plan.operatingMode.current,
      status:
        sourcingResult.status === "blocked" ||
        roadblocks.length > 0 ||
        manualGates.some((gate) => gate.status !== "completed")
        ? "blocked"
        : "success",
      summary: this.buildSummary(
        collectionResult,
        sourcingResult,
        visibleIntakeResult,
        replyResult,
        outboundResult,
        visibleDeliveryResult
      ),
      notes,
      roadblocks,
      newIntakes: visibleIntakeResult.items,
      outboundQueue: outboundResult.items,
      replyQueue: replyResult.items,
      deliveryQueue: visibleDeliveryResult.items,
      manualGates
    };

    const report = await this.orchestrator.getReports().generateRunReport([
      `Northline autonomy: ${snapshot.summary}`,
      ...notes
    ]);
    const reportPath = path.join(this.config.reportDir, `${report.id}.json`);
    const statePath = this.statePath(business.id);
    const summaryJsonPath = this.summaryJsonPath(business.id);
    const summaryMarkdownPath = this.summaryMarkdownPath(business.id);
    const nextState: NorthlineAutonomyState = {
      businessId: business.id,
      processedSubmissionIds: [...new Set([...state.processedSubmissionIds, ...intakeResult.processedSubmissionIds])].slice(-1000),
      lastRunAt: generatedAt,
      lastRunStatus: snapshot.status,
      lastSummaryHash: summaryHash({
        planOperatingMode: snapshot.planOperatingMode,
        summary: snapshot.summary,
        roadblocks: snapshot.roadblocks,
        manualGates: snapshot.manualGates.map((gate) => ({ id: gate.id, status: gate.status })),
        intake: snapshot.newIntakes.map((item) => ({ id: item.submissionId, status: item.status })),
        outbound: snapshot.outboundQueue.map((item) => ({ id: item.draftId, status: item.status })),
        replies: snapshot.replyQueue.map((item) => ({ id: item.replyId, status: item.status })),
        delivery: snapshot.deliveryQueue.map((item) => ({ id: item.clientId, status: item.status }))
      }),
      lastSummaryNotifiedAt: state.lastSummaryNotifiedAt,
      updatedAt: generatedAt
    };

    let notificationPath: string | undefined;
    if (options?.notifyRoadblocks && nextState.lastSummaryHash !== state.lastSummaryHash) {
      const notification = await this.orchestrator.getAccountOps().notifyOwner(
        `[Northline Daily] ${snapshot.summary}`,
        this.notificationBody(planResult.plan, snapshot, reportPath),
        { fileName: "northline-daily-summary.txt" }
      );
      notificationPath = notification.path;
      nextState.lastSummaryNotifiedAt = generatedAt;
    }

    await writeJsonFile(statePath, nextState);
    await this.writeSummaryArtifacts(summaryJsonPath, summaryMarkdownPath, planResult.plan, snapshot, reportPath);
    await this.store.saveBusinessRun({
      id: `run-${business.id}-${generatedAt.replaceAll(":", "-")}`,
      businessId: business.id,
      startedAt,
      finishedAt: generatedAt,
      status: snapshot.status,
      summary: snapshot.summary
    });
    await this.refreshBusinessMetrics(business, snapshot);

    const artifacts: NorthlineAutonomyArtifacts = {
      statePath,
      summaryJsonPath,
      summaryMarkdownPath,
      notificationPath
    };

    return {
      status: snapshot.status,
      summary: snapshot.summary,
      details: [
        ...snapshot.notes,
        `Prospect collection summary: ${collectionResult.artifacts.summaryJsonPath}`,
        `Prospect sourcing summary: ${sourcingResult.artifacts.summaryJsonPath}`,
        `Promotion queue: ${promotionQueueResult.artifacts.jsonPath}`,
        `Run report: ${reportPath}`,
        `Autonomy summary: ${summaryJsonPath}`
      ],
      plan: planResult.plan,
      snapshot,
      artifacts
    };
  }

  async syncInbox(options?: {
    businessId?: string;
  }): Promise<{
    status: BusinessRunStatus;
    summary: string;
    items: NorthlineAutonomyReplyWorkItem[];
    manualGates: NorthlineAutonomyManualGate[];
  }> {
    const businessId = options?.businessId ?? NORTHLINE_BUSINESS_ID;
    const business = await this.requireBusiness(businessId);
    const result = await this.syncReplyQueue(business);
    const status: BusinessRunStatus =
      result.manualGates.some((gate) => gate.status !== "completed") ||
      result.items.some((item) => item.status === "error")
        ? "blocked"
        : "success";

    return {
      status,
      summary: this.replySyncSummary(result.items),
      items: result.items,
      manualGates: result.manualGates
    };
  }

  private async requireBusiness(id: string): Promise<ManagedBusiness> {
    const business =
      (await this.store.getManagedBusiness(id)) ??
      (await this.store.getManagedBusiness(NORTHLINE_BUSINESS_ID));
    if (!business) {
      throw new Error(`Managed business ${id} was not found.`);
    }
    return business;
  }

  private async readState(businessId: string): Promise<NorthlineAutonomyState> {
    return readJsonFile<NorthlineAutonomyState>(this.statePath(businessId), {
      businessId,
      processedSubmissionIds: [],
      updatedAt: nowIso()
    });
  }

  private statePath(businessId: string): string {
    return northlineBusinessStateFilePath(this.config, businessId, STATE_FILE);
  }

  private summaryJsonPath(businessId: string): string {
    return path.join(northlineBusinessOpsDir(this.config, businessId), SUMMARY_JSON_FILE);
  }

  private summaryMarkdownPath(businessId: string): string {
    return path.join(northlineBusinessOpsDir(this.config, businessId), SUMMARY_MARKDOWN_FILE);
  }

  private async validationArtifactClientIds(businessId: string): Promise<Set<string>> {
    const clients = await this.store.getClients();
    return new Set(
      clients
        .filter(
          (client) => businessClient(client, businessId) && isInternalValidationClient(client)
        )
        .map((client) => client.id)
    );
  }

  private filterValidationIntakeResult(
    result: IntakeSyncResult,
    hiddenClientIds: Set<string>
  ): IntakeSyncResult {
    return {
      ...result,
      items: result.items.filter(
        (item) => !item.clientId || !hiddenClientIds.has(item.clientId)
      ),
      manualGates: result.manualGates.filter(
        (gate) => !hiddenClientIds.has(gate.relatedEntityId)
      )
    };
  }

  private filterValidationDeliveryResult(
    result: QueueSyncResult<NorthlineAutonomyDeliveryWorkItem>,
    hiddenClientIds: Set<string>
  ): QueueSyncResult<NorthlineAutonomyDeliveryWorkItem> {
    return {
      items: result.items.filter((item) => !hiddenClientIds.has(item.clientId)),
      manualGates: result.manualGates.filter(
        (gate) => !hiddenClientIds.has(gate.relatedEntityId)
      )
    };
  }

  private billingTaskId(clientId: string): string {
    return `approval-northline-billing-handoff-${clientId}`;
  }

  private qaTaskId(clientId: string): string {
    return `approval-northline-qa-${clientId}`;
  }

  private deployTaskId(clientId: string): string {
    return `approval-northline-deploy-${clientId}`;
  }

  private outboundTaskId(draftId: string): string {
    return `approval-outbound-send-${draftId}`;
  }

  private replySyncTaskId(businessId: string): string {
    return `approval-northline-inbox-sync-${businessId}`;
  }

  private intakeReviewTaskId(submissionId: string): string {
    return `approval-northline-intake-review-${submissionId}`;
  }

  private async syncHostedIntake(
    business: ManagedBusiness,
    state: NorthlineAutonomyState
  ): Promise<IntakeSyncResult> {
    const stored = await readJsonFile<NorthlineIntakeStore>(this.config.northlineSite.submissionStorePath, {
      submissions: []
    });
    const submissions = normalizeIntakeStore(stored).sort((left, right) =>
      left.receivedAt.localeCompare(right.receivedAt)
    );
    const processedIds = new Set(state.processedSubmissionIds);
    const clients = (await this.store.getClients()).filter((client) => businessClient(client, business.id));
    const manualGates: NorthlineAutonomyManualGate[] = [];
    const items: NorthlineAutonomyIntakeWorkItem[] = [];
    const newlyProcessed: string[] = [];

    for (const submission of submissions) {
      if (
        processedIds.has(submission.id) ||
        clients.some((client) => client.sourceSubmissionId === submission.id)
      ) {
        const existingClient = clients.find((client) => client.sourceSubmissionId === submission.id);
        items.push({
          submissionId: submission.id,
          clientId: existingClient?.id,
          status: "duplicate",
          summary: `${submission.businessName ?? submission.ownerName ?? submission.id} is already tracked.`,
          notes: []
        });
        continue;
      }

      const missingFields = [
        !compact(submission.businessName) ? "business name" : undefined,
        !compact(submission.email) ? "email" : undefined,
        !compact(submission.phone) ? "phone" : undefined
      ].filter((value): value is string => Boolean(value));

      if (missingFields.length > 0) {
        const task = await this.orchestrator.getAccountOps().createOrUpdateTask(
          {
            id: this.intakeReviewTaskId(submission.id),
            type: "manual",
            actionNeeded: `Review incomplete Northline intake for ${submission.businessName ?? submission.ownerName ?? submission.id}`,
            reason: `The hosted intake is missing ${missingFields.join(", ")}, so the runner cannot create a proposal-stage client automatically.`,
            ownerInstructions:
              "Review the stored intake under runtime/state/northlineIntakeSubmissions.json, confirm the contact details, and create or update the proposal manually if needed.",
            relatedEntityType: "client",
            relatedEntityId: submission.id
          },
          { reopenCompleted: false }
        );
        if (task.status !== "completed") {
          manualGates.push(this.toManualGate(task, "owner_decision"));
        }
        items.push({
          submissionId: submission.id,
          status: "incomplete",
          summary: `${submission.businessName ?? submission.ownerName ?? submission.id} needs an owner review before it can become a tracked client.`,
          notes: [`Missing fields: ${missingFields.join(", ")}`]
        });
        newlyProcessed.push(submission.id);
        continue;
      }

      const matchedClient = this.findTrackedClient(clients, business.id, submission);
      if (matchedClient) {
        const updatedClient = this.mergeSubmissionIntoClient(matchedClient, submission);
        await this.store.saveClient(updatedClient);
        const index = clients.findIndex((candidate) => candidate.id === matchedClient.id);
        if (index >= 0) {
          clients[index] = updatedClient;
        }
        if (isProposalStatus(updatedClient.billingStatus)) {
          const task = await this.ensureBillingGate(updatedClient);
          if (task.status !== "completed") {
            manualGates.push(this.toManualGate(task, "owner_decision"));
          }
        }
        items.push({
          submissionId: submission.id,
          clientId: updatedClient.id,
          status: "updated",
          summary: `Updated the tracked Northline intake for ${updatedClient.clientName}.`,
          notes: ["Matched the existing record by business name or contact details."]
        });
        newlyProcessed.push(submission.id);
        continue;
      }

      const client = await this.createClientFromSubmission(submission, business.id, clients);
      await this.store.saveClient(client);
      clients.push(client);
        const task = await this.ensureBillingGate(client);
      if (task.status !== "completed") {
        manualGates.push(this.toManualGate(task, "owner_decision"));
      }
      items.push({
        submissionId: submission.id,
        clientId: client.id,
        status: "created",
        summary: `Created a proposal-stage Northline client for ${client.clientName}.`,
        notes: [
          `Billing is still ${client.billingStatus}.`,
          `Next action: ${client.nextAction}`
        ]
      });
      newlyProcessed.push(submission.id);
    }

    return {
      items,
      manualGates,
      processedSubmissionIds: newlyProcessed
    };
  }

  private findTrackedClient(
    clients: ClientJob[],
    businessId: string,
    submission: NorthlineIntakeSubmission
  ): ClientJob | undefined {
    const email = compact(submission.email)?.toLowerCase();
    const phone = compact(submission.phone)?.replace(/[^0-9+]/g, "");
    const businessName = slugify(submission.businessName ?? "");

    return clients.find((client) => {
      if (!businessClient(client, businessId)) {
        return false;
      }
      const clientPhone = client.primaryPhone.replace(/[^0-9+]/g, "");
      return (
        client.sourceSubmissionId === submission.id ||
        (email !== undefined && client.primaryEmail.toLowerCase() === email) ||
        (phone !== undefined && clientPhone === phone) ||
        slugify(client.clientName) === businessName
      );
    });
  }

  private async createClientFromSubmission(
    submission: NorthlineIntakeSubmission,
    businessId: string,
    clients: ClientJob[]
  ): Promise<ClientJob> {
    const baseId = slugify(submission.businessName ?? submission.ownerName ?? submission.id) || submission.id;
    let candidateId = baseId;
    let suffix = 1;
    while (clients.some((client) => client.id === candidateId)) {
      suffix += 1;
      candidateId = `${baseId}-${suffix}`;
    }

    const proofMetadata = proofMetadataFromSubmission(submission);

    return {
      id: candidateId,
      businessId,
      sourceSubmissionId: submission.id,
      provenance: proofMetadata.provenance,
      proofEligible: proofMetadata.proofEligible,
      clientName: compact(submission.businessName) ?? compact(submission.ownerName) ?? "Northline Intake",
      niche: "home services",
      geo:
        compact(submission.serviceArea) ??
        this.config.business.primaryServiceArea ??
        "Service area not provided",
      primaryPhone: compact(submission.phone) ?? "Phone not provided",
      primaryEmail: compact(submission.email) ?? "email-not-provided@example.invalid",
      offerId: "founding-offer",
      siteStatus: "not_started",
      qaStatus: "pending",
      billingStatus: "proposal",
      deployment: {
        platform: "local-preview"
      },
      assets: {
        logoText: compact(submission.businessName),
        services: splitList(submission.primaryServices)
      },
      intakeNotes: this.intakeNotes(submission),
      nextAction: "Confirm billing handoff and route delivery scope.",
      createdAt: submission.receivedAt,
      updatedAt: submission.receivedAt
    };
  }

  private mergeSubmissionIntoClient(
    client: ClientJob,
    submission: NorthlineIntakeSubmission
  ): ClientJob {
    const services = splitList(submission.primaryServices);
    const proofMetadata = proofMetadataFromSubmission(submission);
    const currentProofEligible = client.proofEligible === true;
    const nextProvenance = currentProofEligible
      ? client.provenance === "external_outbound"
        ? "external_outbound"
        : client.provenance ?? proofMetadata.provenance
      : proofMetadata.provenance;
    return {
      ...client,
      sourceSubmissionId: client.sourceSubmissionId ?? submission.id,
      provenance: nextProvenance,
      proofEligible: currentProofEligible ? true : proofMetadata.proofEligible,
      geo: compact(submission.serviceArea) ?? client.geo,
      primaryPhone: compact(submission.phone) ?? client.primaryPhone,
      primaryEmail: compact(submission.email) ?? client.primaryEmail,
      assets: {
        ...client.assets,
        logoText: client.assets.logoText ?? compact(submission.businessName),
        services:
          services.length > 0
            ? [...new Set([...(client.assets.services ?? []), ...services])]
            : client.assets.services
      },
      intakeNotes: [...new Set([...client.intakeNotes, ...this.intakeNotes(submission)])],
      updatedAt: nowIso()
    };
  }

  private intakeNotes(submission: NorthlineIntakeSubmission): string[] {
    return [
      `Northline intake ${submission.id} received ${submission.receivedAt}.`,
      compact(submission.website) ? `Current website: ${submission.website}` : undefined,
      compact(submission.leadGoal) ? `Lead goal: ${submission.leadGoal}` : undefined,
      compact(submission.biggestLeak) ? `Biggest leak: ${submission.biggestLeak}` : undefined,
      compact(submission.preferredCallWindow)
        ? `Preferred call window: ${submission.preferredCallWindow}`
        : undefined,
      compact(submission.contactPreference)
        ? `Contact preference: ${submission.contactPreference}`
        : undefined,
      compact(submission.notes) ? `Notes: ${submission.notes}` : undefined,
      compact(submission.source) ? `Source: ${submission.source}` : undefined
    ].filter((value): value is string => Boolean(value));
  }

  private async ensureBillingGate(client: ClientJob): Promise<ApprovalTask> {
    return this.orchestrator.getAccountOps().createOrUpdateTask(
      {
        id: this.billingTaskId(client.id),
        type: "manual",
        actionNeeded: `Confirm billing handoff for ${client.clientName}`,
        reason:
          "Northline can stage delivery automatically once the owner confirms whether the client is paid or on an active retainer.",
        ownerInstructions: [
          `Run npm run dev -- northline-billing-handoff --client ${client.id} --status paid once the setup fee is confirmed.`,
          `Use --status retainer_active if monthly retention is active now.`,
          "Pass --form-endpoint <url> in the same command when the client form endpoint is known so QA can pass on the first build."
        ].join(" "),
        relatedEntityType: "client",
        relatedEntityId: client.id
      },
      { reopenCompleted: false }
    );
  }

  private async closeLegacyDeployApproval(client: ClientJob, reason: string): Promise<void> {
    await this.orchestrator.getAccountOps().completeTask(this.deployTaskId(client.id), reason);
  }

  private latestRetentionReport(reports: RetentionReport[]): RetentionReport | undefined {
    return reports.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  }

  private async syncReplyQueue(
    business: ManagedBusiness
  ): Promise<ReplySyncResult> {
    const businessId = business.id;
    const businessProfile = resolveNorthlineBusinessProfile(this.config, business);
    const [drafts, leads] = await Promise.all([this.store.getOutreachDrafts(), this.store.getLeads()]);
    const candidates: NorthlineInboxSyncCandidate[] = drafts
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .flatMap((draft) => {
        const lead = leads.find((candidate) => candidate.id === draft.leadId);
        const sentReceipt = this.latestSuccessfulSendReceipt(draft);
        if (
          !lead ||
          !this.northlineLead(lead, businessId, businessProfile) ||
          !sentReceipt ||
          !lead.contact.email
        ) {
          return [];
        }
        if (!["contacted", "responded"].includes(lead.stage)) {
          return [];
        }
        return [
          {
            leadId: lead.id,
            recipient: lead.contact.email,
            subject: draft.subject,
            sentAt: sentReceipt.sentAt ?? sentReceipt.attemptedAt
          }
        ];
      });

    if (candidates.length === 0) {
      await this.orchestrator
        .getAccountOps()
        .completeTask(this.replySyncTaskId(businessId), "No contacted Northline threads are eligible for inbox sync yet.");
      return {
        items: [],
        manualGates: []
      };
    }

    let syncResults: NorthlineInboxSyncScriptResult[];
    try {
      syncResults = await this.inboxSync(candidates, businessProfile);
    } catch (error) {
      const inboxLabel = this.inboxProviderLabel();
      const task = await this.orchestrator.getAccountOps().createOrUpdateTask(
        {
          id: this.replySyncTaskId(businessId),
          type: "manual",
          actionNeeded: `Repair Northline inbox sync for ${business.name}`,
          reason:
            `Northline could not read replies from the ${inboxLabel} automatically, so reply-state automation is paused until the inbox path is repaired.`,
          ownerInstructions: this.inboxSyncFailureInstructions(businessProfile, this.formatOutboundError(error)),
          relatedEntityType: "business",
          relatedEntityId: businessId
        },
        { reopenCompleted: false }
      );

      return {
        items: [
          {
            leadId: businessId,
            replyId: this.replySyncTaskId(businessId),
            status: "error",
            summary: `Northline inbox sync failed before any replies could be processed for ${business.name}.`,
            nextAction: task.ownerInstructions
          }
        ],
        manualGates: [this.toManualGate(task, "owner_decision")]
      };
    }

    const items: NorthlineAutonomyReplyWorkItem[] = [];
    const syncErrors = syncResults.filter((result) => result.status === "error");

    for (const result of syncResults) {
      if (result.status === "no_reply") {
        continue;
      }

      const lead = leads.find((candidate) => candidate.id === result.leadId);
      if (result.status === "error" || !result.body || !lead) {
        items.push({
          leadId: result.leadId,
          replyId: `inbox-sync-error-${slugify(result.leadId)}`,
          externalThreadId: result.externalThreadId,
          status: "error",
          summary: lead
            ? `Inbox sync could not read the latest reply thread for ${lead.businessName}.`
            : `Inbox sync could not process a reply for ${result.leadId}.`,
          nextAction: result.reason ?? this.inboxSyncRepairAction(businessProfile)
        });
        continue;
      }

      const processed = await processLeadReply({
        store: this.store,
        replyHandler: this.replyHandler,
        leadId: result.leadId,
        message: result.body,
        subject: result.subject,
        source: automatedReplySource(this.config.northlineMail.inboxProvider),
        externalThreadId: result.externalThreadId,
        externalMessageId: result.externalMessageId,
        fromAddress: result.fromAddress,
        receivedAt: result.receivedAt
      });

      items.push({
        leadId: processed.lead.id,
        replyId: processed.reply.id,
        externalThreadId: processed.reply.externalThreadId,
        status: processed.duplicate ? "duplicate" : this.replyItemStatus(processed.classification),
        summary: processed.duplicate
          ? `${processed.lead.businessName} already has this synced reply recorded.`
          : this.replyItemSummary(processed.lead.businessName, processed.classification),
        nextAction: processed.classification.nextAction
      });
    }

    if (syncErrors.length > 0) {
      const inboxLabel = this.inboxProviderLabel();
      const task = await this.orchestrator.getAccountOps().createOrUpdateTask(
        {
          id: this.replySyncTaskId(businessId),
          type: "manual",
          actionNeeded: `Repair Northline inbox sync for ${business.name}`,
          reason:
            `Northline read some reply candidates, but one or more ${inboxLabel} lookups failed and need manual inspection before the inbox sync can be trusted.`,
          ownerInstructions: this.inboxSyncPartialFailureInstructions(businessProfile),
          relatedEntityType: "business",
          relatedEntityId: businessId
        },
        { reopenCompleted: false }
      );

      return {
        items,
        manualGates: [this.toManualGate(task, "owner_decision")]
      };
    }

    await this.orchestrator
      .getAccountOps()
      .completeTask(
        this.replySyncTaskId(businessId),
        `Northline inbox sync completed without ${this.inboxProviderLabel()} access errors.`
      );

    return {
      items,
      manualGates: []
    };
  }

  private async syncOutboundQueue(
    business: ManagedBusiness
  ): Promise<QueueSyncResult<NorthlineAutonomyOutboundQueueItem>> {
    const businessId = business.id;
    const businessProfile = resolveNorthlineBusinessProfile(this.config, business);
    const [drafts, leads, approvals] = await Promise.all([
      this.store.getOutreachDrafts(),
      this.store.getLeads(),
      this.store.getApprovals()
    ]);
    const manualGates: NorthlineAutonomyManualGate[] = [];
    const items: NorthlineAutonomyOutboundQueueItem[] = [];

    for (const draft of drafts.sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
      const lead = leads.find((candidate) => candidate.id === draft.leadId);
      if (!lead) {
        continue;
      }

      const taskId = this.outboundTaskId(draft.id);
      const existingTask = approvals.find((candidate) => candidate.id === taskId);
      if (!this.northlineLead(lead, businessId, businessProfile)) {
        await this.orchestrator
          .getAccountOps()
          .completeTask(taskId, "Lead is outside the business's current service area and is no longer queued.");
        items.push({
          draftId: draft.id,
          leadId: lead.id,
          approvalId: taskId,
          status: "completed",
          summary: `${lead.businessName} is outside ${business.name}'s current service area and is excluded from outbound automation.`
        });
        continue;
      }

      if (lead.stage !== "drafted") {
        await this.orchestrator
          .getAccountOps()
          .completeTask(taskId, "Lead moved beyond drafted, so outbound send follow-up is no longer pending.");
        items.push({
          draftId: draft.id,
          leadId: lead.id,
          approvalId: taskId,
          status: "completed",
          summary: `${lead.businessName} has moved beyond the draft queue.`
        });
        continue;
      }

      const latestSentReceipt = this.latestSuccessfulSendReceipt(draft);
      if (latestSentReceipt) {
        await this.store.saveLead({
          ...lead,
          stage: "contacted",
          lastTouchAt: latestSentReceipt.sentAt ?? latestSentReceipt.attemptedAt,
          updatedAt: nowIso()
        });
        await this.orchestrator
          .getAccountOps()
          .completeTask(taskId, "Outreach send was already recorded automatically.");
        items.push({
          draftId: draft.id,
          leadId: lead.id,
          approvalId: taskId,
          status: "completed",
          summary: `${lead.businessName} already has an automated outreach send receipt recorded.`
        });
        continue;
      }

      if (existingTask?.status === "completed") {
        await this.store.saveLead({
          ...lead,
          stage: "contacted",
          lastTouchAt: existingTask.updatedAt,
          updatedAt: nowIso()
        });
        items.push({
          draftId: draft.id,
          leadId: lead.id,
          approvalId: existingTask.id,
          status: "completed",
          summary: `${lead.businessName} was marked as sent from the manual outbound queue.`
        });
        continue;
      }

      if (!draft.approved) {
        items.push({
          draftId: draft.id,
          leadId: lead.id,
          status: "awaiting_compliance",
          summary: `${lead.businessName} is still waiting on outreach compliance review.`
        });
        continue;
      }

      const sendResult = await this.outboundSender(lead, draft, businessProfile);
      const nextDraft: OutreachDraft = {
        ...draft,
        sendReceipts: [...(draft.sendReceipts ?? []), ...sendResult.receipts],
        updatedAt: nowIso()
      };
      await this.store.saveOutreachDraft(nextDraft);

      if (sendResult.sentReceipt) {
        await this.store.saveLead({
          ...lead,
          stage: "contacted",
          lastTouchAt: sendResult.sentReceipt.sentAt ?? sendResult.sentReceipt.attemptedAt,
          updatedAt: nowIso()
        });
        await this.orchestrator
          .getAccountOps()
          .completeTask(taskId, `Outreach sent automatically via ${this.senderChannelLabel(sendResult.sentReceipt.channel)}.`);
        items.push({
          draftId: draft.id,
          leadId: lead.id,
          approvalId: taskId,
          status: "sent",
          summary: `${lead.businessName} was sent automatically via ${this.senderChannelLabel(sendResult.sentReceipt.channel)}.`
        });
        continue;
      }

      const latestFailure = this.latestSendReceipt(nextDraft);
      const task = await this.orchestrator.getAccountOps().createOrUpdateTask(
        {
          id: taskId,
          type: "manual",
          actionNeeded: `Resolve Northline outbound send for ${lead.businessName}`,
          reason:
            "Northline tried to send this approved outreach draft automatically from the VPS sender path, but delivery did not complete cleanly.",
          ownerInstructions: this.outboundFailureInstructions(draft.id, businessProfile, latestFailure?.error),
          relatedEntityType: "lead",
          relatedEntityId: lead.id
        },
        { reopenCompleted: false }
      );

      manualGates.push(this.toManualGate(task, "outbound_send"));
      items.push({
        draftId: draft.id,
        leadId: lead.id,
        approvalId: task.id,
        status: "awaiting_manual_send",
        summary: `${lead.businessName} still needs a manual send or sender fix after automatic delivery failed.`
      });
    }

    return {
      items,
      manualGates
    };
  }

  private async sendApprovedDraft(
    lead: LeadRecord,
    draft: OutreachDraft,
    businessProfile: ResolvedNorthlineBusinessProfile
  ): Promise<OutboundSendAttemptResult> {
    const recipient = compact(lead.contact.email);
    if (!recipient) {
      const channel = this.config.northlineMail.outboundChannel;
      return {
        receipts: [
          {
            status: "failed",
            channel,
            recipient: "missing-email",
            attemptedAt: nowIso(),
            error: `${lead.businessName} does not have an email address for automated outreach.`
          }
        ]
      };
    }

    if (this.config.northlineMail.outboundChannel === "smtp") {
      const smtpReceipt = await this.sendDraftViaSmtp(recipient, draft, businessProfile);
      return smtpReceipt.status === "sent"
        ? {
            receipts: [smtpReceipt],
            sentReceipt: smtpReceipt
          }
        : { receipts: [smtpReceipt] };
    }

    const receipts: OutreachSendReceipt[] = [];
    const gmailReceipt = await this.sendDraftViaGmailCdp(recipient, draft);
    receipts.push(gmailReceipt);
    if (gmailReceipt.status === "sent") {
      return {
        receipts,
        sentReceipt: gmailReceipt
      };
    }

    if (!this.config.smtp) {
      return { receipts };
    }

    const smtpReceipt = await this.sendDraftViaSmtp(recipient, draft, businessProfile);
    receipts.push(smtpReceipt);
    return smtpReceipt.status === "sent"
      ? {
          receipts,
          sentReceipt: smtpReceipt
        }
      : { receipts };
  }

  private async syncInboxCandidates(
    candidates: NorthlineInboxSyncCandidate[],
    businessProfile: ResolvedNorthlineBusinessProfile
  ): Promise<NorthlineInboxSyncScriptResult[]> {
    return this.config.northlineMail.inboxProvider === "imap"
      ? this.syncInboxViaImap(candidates, businessProfile)
      : this.syncInboxViaGmailCdp(candidates, businessProfile);
  }

  private async sendDraftViaGmailCdp(recipient: string, draft: OutreachDraft): Promise<OutreachSendReceipt> {
    const attemptedAt = nowIso();
    try {
      const scriptPath = path.join(this.config.projectRoot, "scripts", "send_gmail_message.py");
      const { stdout } = await execFileAsync(
        PYTHON_COMMAND,
        [scriptPath, "--to", recipient, "--subject", draft.subject, "--body", draft.body],
        {
          cwd: this.config.projectRoot,
          timeout: 120000
        }
      );
      const parsed = this.parseSenderOutput(stdout);
      if (parsed.status && parsed.status !== "ok") {
        return {
          status: "failed",
          channel: "gmail_cdp",
          recipient,
          attemptedAt,
          error: parsed.reason ?? "Gmail CDP sender returned a non-ok status."
        };
      }
      return {
        status: "sent",
        channel: "gmail_cdp",
        recipient,
        attemptedAt,
        sentAt: nowIso()
      };
    } catch (error) {
      return {
        status: "failed",
        channel: "gmail_cdp",
        recipient,
        attemptedAt,
        error: this.formatOutboundError(error)
      };
    }
  }

  private async sendDraftViaSmtp(
    recipient: string,
    draft: OutreachDraft,
    businessProfile: ResolvedNorthlineBusinessProfile
  ): Promise<OutreachSendReceipt> {
    const attemptedAt = nowIso();
    if (!this.config.smtp) {
      return {
        status: "failed",
        channel: "smtp",
        recipient,
        attemptedAt,
        error: "SMTP is not configured."
      };
    }

    try {
      const transporter = nodemailer.createTransport({
        host: this.config.smtp.host,
        port: this.config.smtp.port,
        secure: this.config.smtp.secure,
        auth: {
          user: this.config.smtp.user,
          pass: this.config.smtp.pass
        }
      });

      await transporter.sendMail({
        from: this.config.smtp.from,
        to: recipient,
        replyTo: businessProfile.salesEmail,
        subject: draft.subject,
        text: draft.body
      });

      return {
        status: "sent",
        channel: "smtp",
        recipient,
        attemptedAt,
        sentAt: nowIso()
      };
    } catch (error) {
      return {
        status: "failed",
        channel: "smtp",
        recipient,
        attemptedAt,
        error: this.formatOutboundError(error)
      };
    }
  }

  private async syncInboxViaGmailCdp(
    candidates: NorthlineInboxSyncCandidate[],
    businessProfile: ResolvedNorthlineBusinessProfile
  ): Promise<NorthlineInboxSyncScriptResult[]> {
    if (candidates.length === 0) {
      return [];
    }

    await ensureDir(this.config.opsDir);
    const tempDir = await mkdtemp(path.join(this.config.opsDir, "northline-inbox-sync-"));
    const specPath = path.join(tempDir, "request.json");

    try {
      await writeTextFile(
        specPath,
        JSON.stringify(
          {
            salesEmail: businessProfile.salesEmail,
            candidates
          },
          null,
          2
        )
      );
      const scriptPath = path.join(this.config.projectRoot, "scripts", "sync_northline_inbox.py");
      const timeout = Math.max(
        MIN_INBOX_SYNC_TIMEOUT_MS,
        candidates.length * INBOX_SYNC_TIMEOUT_MS_PER_CANDIDATE
      );
      const { stdout } = await execFileAsync(
        PYTHON_COMMAND,
        [scriptPath, "--spec-file", specPath],
        {
          cwd: this.config.projectRoot,
          timeout
        }
      );
      return this.parseInboxSyncOutput(stdout);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private async syncInboxViaImap(
    candidates: NorthlineInboxSyncCandidate[],
    businessProfile: ResolvedNorthlineBusinessProfile
  ): Promise<NorthlineInboxSyncScriptResult[]> {
    const imap = this.config.northlineMail.imap;
    if (!imap) {
      throw new Error("Northline IMAP inbox sync is selected but IMAP is not configured.");
    }

    await ensureDir(this.config.opsDir);
    const tempDir = await mkdtemp(path.join(this.config.opsDir, "northline-imap-sync-"));
    const specPath = path.join(tempDir, "request.json");

    try {
      await writeTextFile(
        specPath,
        JSON.stringify(
          {
            aliasAddress: this.config.northlineMail.aliasAddress || businessProfile.salesEmail,
            imap,
            candidates
          },
          null,
          2
        )
      );
      const scriptPath = path.join(this.config.projectRoot, "scripts", "sync_northline_inbox_imap.py");
      const timeout = Math.max(
        MIN_INBOX_SYNC_TIMEOUT_MS,
        candidates.length * INBOX_SYNC_TIMEOUT_MS_PER_CANDIDATE
      );
      const { stdout } = await execFileAsync(
        PYTHON_COMMAND,
        [scriptPath, "--spec-file", specPath],
        {
          cwd: this.config.projectRoot,
          timeout
        }
      );
      return this.parseInboxSyncOutput(stdout);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private latestSuccessfulSendReceipt(draft: OutreachDraft): OutreachSendReceipt | undefined {
    return [...(draft.sendReceipts ?? [])]
      .reverse()
      .find((receipt) => receipt.status === "sent");
  }

  private latestSendReceipt(draft: OutreachDraft): OutreachSendReceipt | undefined {
    return draft.sendReceipts && draft.sendReceipts.length > 0
      ? draft.sendReceipts[draft.sendReceipts.length - 1]
      : undefined;
  }

  private senderChannelLabel(channel: OutreachSendReceipt["channel"]): string {
    return channel === "smtp" ? "SMTP sender" : "Gmail CDP sender";
  }

  private inboxProviderLabel(): string {
    return this.config.northlineMail.inboxProvider === "imap" ? "IMAP inbox path" : "VPS Gmail session";
  }

  private inboxHelperCommand(): string {
    return this.config.northlineMail.inboxProvider === "imap"
      ? "python3 scripts/sync_northline_inbox_imap.py --help"
      : "python3 scripts/sync_northline_inbox.py --help";
  }

  private inboxSyncRepairAction(businessProfile: ResolvedNorthlineBusinessProfile): string {
    return this.config.northlineMail.inboxProvider === "imap"
      ? `Verify the IMAP mailbox credentials for ${businessProfile.salesEmail}, then rerun npm run dev -- northline-inbox-sync.`
      : `Inspect the VPS browser session for ${businessProfile.salesEmail} and rerun inbox sync.`;
  }

  private inboxSyncFailureInstructions(
    businessProfile: ResolvedNorthlineBusinessProfile,
    latestError: string
  ): string {
    const steps =
      this.config.northlineMail.inboxProvider === "imap"
        ? [
            `Verify the IMAP mailbox credentials for ${businessProfile.salesEmail}.`,
            `Run ${this.inboxHelperCommand()} to confirm the helper is available.`,
            "Rerun npm run dev -- northline-inbox-sync --business auto-funding-agency or northline-autonomy-run once the inbox path is reachable again."
          ]
        : [
            `Keep the VPS browser signed into ${businessProfile.salesEmail}.`,
            `Run ${this.inboxHelperCommand()} to confirm the helper is available.`,
            "Rerun npm run dev -- northline-inbox-sync --business auto-funding-agency or northline-autonomy-run once Gmail is reachable again."
          ];

    return [`Latest error: ${latestError}`, ...steps].join(" ");
  }

  private inboxSyncPartialFailureInstructions(
    businessProfile: ResolvedNorthlineBusinessProfile
  ): string {
    return this.config.northlineMail.inboxProvider === "imap"
      ? [
          "Inspect the latest reply-sync results in runtime/ops/northline-growth-system/autonomy-summary.json.",
          `Verify that ${businessProfile.salesEmail} is still available through the configured IMAP mailbox.`,
          "Rerun npm run dev -- northline-inbox-sync after the mailbox path is healthy again."
        ].join(" ")
      : [
          "Inspect the latest reply-sync results in runtime/ops/northline-growth-system/autonomy-summary.json.",
          `Keep the VPS Gmail session signed into ${businessProfile.salesEmail}.`,
          "Rerun npm run dev -- northline-inbox-sync after the thread path is healthy again."
        ].join(" ");
  }

  private parseInboxSyncOutput(stdout: string): NorthlineInboxSyncScriptResult[] {
    const trimmed = stdout.trim();
    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed) as {
        status?: string;
        results?: NorthlineInboxSyncScriptResult[];
        reason?: string;
      };
      if (parsed.status && parsed.status !== "ok") {
        throw new Error(parsed.reason ?? "Inbox sync returned a non-ok status.");
      }
      return Array.isArray(parsed.results) ? parsed.results : [];
    } catch (error) {
      throw new Error(this.formatOutboundError(error));
    }
  }

  private parseSenderOutput(stdout: string): {
    status?: string;
    reason?: string;
  } {
    const trimmed = stdout.trim();
    if (!trimmed) {
      return {};
    }

    try {
      const parsed = JSON.parse(trimmed) as {
        status?: string;
        reason?: string;
      };
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  private formatOutboundError(error: unknown): string {
    if (error && typeof error === "object") {
      const stdout =
        "stdout" in error && typeof error.stdout === "string" ? error.stdout.trim() : undefined;
      const stderr =
        "stderr" in error && typeof error.stderr === "string" ? error.stderr.trim() : undefined;
      const parsed = stdout ? this.parseSenderOutput(stdout) : {};
      if (parsed.reason) {
        return parsed.reason;
      }
      if (stderr) {
        return stderr;
      }
      if (stdout) {
        return stdout;
      }
    }

    return error instanceof Error ? error.message : String(error);
  }

  private replyItemStatus(
    classification: LeadReplyClassification
  ): NorthlineAutonomyReplyWorkItem["status"] {
    if (classification.recommendedStage === "lost") {
      return "lost";
    }
    if (classification.route === "booked_call") {
      return "booked_call";
    }
    if (classification.route === "intake_follow_up") {
      return "intake_follow_up";
    }
    if (classification.recommendedStage === "responded") {
      return "responded";
    }
    return "logged";
  }

  private replyItemSummary(
    businessName: string,
    classification: LeadReplyClassification
  ): string {
    switch (this.replyItemStatus(classification)) {
      case "booked_call":
        return `${businessName} replied and should move toward a booked call.`;
      case "intake_follow_up":
        return `${businessName} replied and should receive an intake or preview follow-up.`;
      case "lost":
        return `${businessName} asked to stop or unsubscribe and should be suppressed.`;
      case "responded":
        return `${businessName} replied and is now in the responded stage.`;
      default:
        return `${businessName} replied and was logged without a stage escalation.`;
    }
  }

  private replySyncSummary(items: NorthlineAutonomyReplyWorkItem[]): string {
    if (items.length === 0) {
      return "Northline inbox sync found no new replies.";
    }

    const summaryParts = [
      this.countSummary(
        items.filter((item) => ["logged", "responded", "booked_call", "intake_follow_up", "lost"].includes(item.status)).length,
        "inbound reply",
        "inbound replies"
      ),
      this.countSummary(
        items.filter((item) => item.status === "booked_call").length,
        "booked-call route",
        "booked-call routes"
      ),
      this.countSummary(
        items.filter((item) => item.status === "intake_follow_up").length,
        "intake follow-up route",
        "intake follow-up routes"
      ),
      this.countSummary(
        items.filter((item) => item.status === "lost").length,
        "unsubscribe route",
        "unsubscribe routes"
      ),
      this.countSummary(
        items.filter((item) => item.status === "error").length,
        "inbox sync error",
        "inbox sync errors"
      )
    ].filter((value): value is string => Boolean(value));

    return summaryParts.length > 0
      ? `Northline inbox sync refreshed: ${summaryParts.join(", ")}.`
      : "Northline inbox sync found no new replies.";
  }

  private outboundFailureInstructions(
    draftId: string,
    businessProfile: ResolvedNorthlineBusinessProfile,
    error?: string
  ): string {
    const steps = [
      `Review the latest send receipt for ${draftId} in runtime/state/outreach.json.`,
      this.config.northlineMail.outboundChannel === "smtp"
        ? `Verify the SMTP sender identity for ${businessProfile.salesEmail} and rerun npm run dev -- northline-autonomy-run --notify-roadblocks to retry the automatic sender.`
        : `Keep the VPS browser signed into ${businessProfile.salesEmail} and rerun npm run dev -- northline-autonomy-run --notify-roadblocks to retry the automatic sender.`,
      this.config.northlineMail.outboundChannel === "gmail_cdp" && this.config.smtp
        ? "SMTP fallback is configured, so verify those credentials too if Gmail is unavailable."
        : undefined,
      "If you send the message manually instead, mark this approval task completed so the lead moves from drafted to contacted."
    ].filter((value): value is string => Boolean(value));

    return error ? [`Latest sender error: ${error}`, ...steps].join(" ") : steps.join(" ");
  }

  private async syncDeliveryQueue(
    businessId: string
  ): Promise<QueueSyncResult<NorthlineAutonomyDeliveryWorkItem>> {
    const clients = (await this.store.getClients())
      .filter((client) => businessClient(client, businessId))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const retentionReports = await this.store.getRetentionReports();
    const manualGates: NorthlineAutonomyManualGate[] = [];
    const items: NorthlineAutonomyDeliveryWorkItem[] = [];

    for (const client of clients) {
      if (isProposalStatus(client.billingStatus)) {
        if (isInternalValidationClient(client)) {
          await this.orchestrator
            .getAccountOps()
            .completeTask(
              this.billingTaskId(client.id),
              "Internal validation clients do not require a customer-facing billing handoff approval."
            );
          await this.closeLegacyDeployApproval(
            client,
            "Internal validation artifacts do not reopen legacy production deploy approvals."
          );
          continue;
        }

        const task = await this.ensureBillingGate(client);
        await this.closeLegacyDeployApproval(
          client,
          "Northline delivery now ends in an automated client handoff package, so legacy production deploy approvals stay closed while billing is pending."
        );
        if (task.status !== "completed") {
          manualGates.push(this.toManualGate(task, "owner_decision"));
        }
        items.push({
          clientId: client.id,
          billingStatus: client.billingStatus,
          status: "waiting_billing",
          actions: ["Waiting on an explicit billing handoff before build work starts."],
          summary: `${client.clientName} is queued for billing confirmation.`
        });
        continue;
      }

      await this.orchestrator
        .getAccountOps()
        .completeTask(this.billingTaskId(client.id), "Billing handoff is no longer pending.");

      let current = client;
      const actions: string[] = [];
      let latestRetentionReport = this.latestRetentionReport(
        retentionReports.filter((report) => report.clientId === current.id)
      );
      let latestProofBundle = current.assets.proofBundle;
      if (isDeliveryEligible(current.billingStatus) && current.siteStatus === "not_started") {
        const build = await this.siteBuilder.buildClientSite(current);
        current = (await this.store.getClient(current.id)) ?? current;
        actions.push(`Built preview at ${build.previewDir}.`);
      }

      if (isDeliveryEligible(current.billingStatus) && current.qaStatus === "pending" && current.siteStatus === "ready") {
        const report = await this.qaReviewer.review(current);
        current = (await this.store.getClient(current.id)) ?? current;
        actions.push(report.passed ? "QA passed automatically." : "QA failed and needs a manual fix.");
      }

      if (current.qaStatus === "failed" || current.siteStatus === "qa_failed") {
        const task = await this.orchestrator.getAccountOps().createOrUpdateTask(
          {
            id: this.qaTaskId(current.id),
            type: "manual",
            actionNeeded: `Fix Northline QA blockers for ${current.clientName}`,
            reason:
              "The automated preview build finished, but QA still found a blocking issue that should be reviewed before the client handoff package is refreshed.",
            ownerInstructions:
              "Review the latest QA report under runtime/reports, fix the preview inputs or endpoint details, and rerun northline-autonomy-run or qa once the blocker is resolved.",
            relatedEntityType: "client",
            relatedEntityId: current.id
          },
          { reopenCompleted: false }
        );
        await this.closeLegacyDeployApproval(
          current,
          "Legacy production deploy approval closed because QA is blocked and Northline now ends in a client handoff package instead of a managed production deploy."
        );
        if (task.status !== "completed") {
          manualGates.push(this.toManualGate(task, "qa_stall"));
        }
        items.push({
          clientId: current.id,
          billingStatus: current.billingStatus,
          status: "qa_failed",
          actions: actions.length > 0 ? actions : ["QA is still waiting on a manual fix."],
          summary: `${current.clientName} is blocked on QA.`
        });
        continue;
      }

      await this.orchestrator
        .getAccountOps()
        .completeTask(this.qaTaskId(current.id), "QA is no longer stalled.");

      if (current.billingStatus === "retainer_active" && this.retentionDue(current.id, retentionReports)) {
        const report = await this.orchestrator.getReports().generateRetentionReport(current);
        latestRetentionReport = report;
        actions.push(
          report.upgradeOffer
            ? `Retention report refreshed with upsell: ${report.upsellCandidate}. Growth upgrade path: ${report.upgradeOffer.label}`
            : `Retention report refreshed with upsell: ${report.upsellCandidate}`
        );
      }

      if (
        current.qaStatus === "passed" &&
        (current.siteStatus === "ready" || current.siteStatus === "deployed") &&
        this.proofBundleDue(current, latestRetentionReport)
      ) {
        const proofBundle = await this.orchestrator
          .getReports()
          .generateProofBundle(current, { retentionReport: latestRetentionReport });
        current = (await this.store.getClient(current.id)) ?? current;
        latestProofBundle = current.assets.proofBundle ?? proofBundle;
        actions.push(
          `Proof bundle refreshed with ${proofBundle.screenshots.length} screenshot${proofBundle.screenshots.length === 1 ? "" : "s"}.`
        );
      } else {
        latestProofBundle = current.assets.proofBundle;
      }

      if (
        current.qaStatus === "passed" &&
        (current.siteStatus === "ready" || current.siteStatus === "deployed") &&
        this.handoffPackageDue(current, latestProofBundle, latestRetentionReport)
      ) {
        const handoffPackage = await this.orchestrator.getReports().generateHandoffPackage(current, {
          retentionReport: latestRetentionReport,
          proofBundle: latestProofBundle
        });
        current = (await this.store.getClient(current.id)) ?? current;
        actions.push(`Handoff package refreshed at ${handoffPackage.readmePath}.`);
      }

      if (
        current.qaStatus === "passed" &&
        (current.siteStatus === "ready" || current.siteStatus === "deployed" || current.assets.handoffPackage)
      ) {
        await this.closeLegacyDeployApproval(
          current,
          "Northline delivery now completes through an automated client handoff package instead of a managed production deploy."
        );
      }

      items.push({
        clientId: current.id,
        billingStatus: current.billingStatus,
        status: this.hasCompletedHandoff(current) ? "handoff_complete" : "stable",
        actions,
        summary: this.deliverySummary(current, actions)
      });
    }

    return {
      items,
      manualGates
    };
  }

  private northlineLead(
    lead: Pick<LeadRecord, "businessId" | "geo" | "targetContext">,
    businessId: string,
    businessProfile: Pick<ResolvedNorthlineBusinessProfile, "collectionAreas" | "primaryServiceArea">
  ): boolean {
    return northlineLeadMatchesBusinessScope(lead, businessId, businessProfile);
  }

  private retentionDue(clientId: string, reports: RetentionReport[]): boolean {
    const report = reports.find((candidate) => candidate.clientId === clientId);
    if (!report) {
      return true;
    }
    return !sameMonth(report.createdAt, nowIso());
  }

  private proofBundleDue(client: ClientJob, retentionReport?: RetentionReport): boolean {
    const bundle = client.assets.proofBundle;
    if (!bundle) {
      return true;
    }
    if (client.updatedAt > bundle.createdAt) {
      return true;
    }
    if (bundle.qaStatus !== client.qaStatus || bundle.siteStatus !== client.siteStatus) {
      return true;
    }
    if (bundle.previewPath !== client.deployment.previewPath) {
      return true;
    }
    if (client.deployment.previewPath && bundle.screenshots.length === 0) {
      return true;
    }
    if (retentionReport && (!bundle.retentionReportPath || retentionReport.createdAt > bundle.createdAt)) {
      return true;
    }
    return false;
  }

  private handoffPackageDue(
    client: ClientJob,
    proofBundle?: ClientJob["assets"]["proofBundle"],
    retentionReport?: RetentionReport
  ): boolean {
    const handoffPackage = client.assets.handoffPackage;
    if (!handoffPackage) {
      return true;
    }
    if (client.updatedAt > handoffPackage.createdAt) {
      return true;
    }
    if (handoffPackage.previewPath !== client.deployment.previewPath) {
      return true;
    }
    if (proofBundle && handoffPackage.proofBundlePath !== proofBundle.reportPath) {
      return true;
    }
    if (retentionReport && (!handoffPackage.retentionReportPath || retentionReport.createdAt > handoffPackage.createdAt)) {
      return true;
    }
    return false;
  }

  private hasCompletedHandoff(client: ClientJob): boolean {
    return client.qaStatus === "passed" && (client.assets.handoffPackage !== undefined || client.siteStatus === "deployed");
  }

  private toManualGate(task: ApprovalTask, kind: NorthlineAutonomyGateKind): NorthlineAutonomyManualGate {
    return {
      id: task.id,
      kind,
      status: task.status,
      relatedEntityId: task.relatedEntityId,
      summary: task.actionNeeded,
      instructions: task.ownerInstructions
    };
  }

  private buildSummary(
    collectionResult: NorthlineProspectCollectionRunResult,
    sourcingResult: NorthlineProspectSourcingRunResult,
    intakeResult: IntakeSyncResult,
    replyResult: ReplySyncResult,
    outboundResult: QueueSyncResult<NorthlineAutonomyOutboundQueueItem>,
    deliveryResult: QueueSyncResult<NorthlineAutonomyDeliveryWorkItem>
  ): string {
    const failedMarketCollections = collectionResult.marketResults.filter(
      (market) => market.status === "failed"
    ).length;
    const summaryParts = [
      this.countSummary(
        collectionResult.writtenFiles,
        "market feed refresh",
        "market feed refreshes"
      ),
      this.countSummary(
        sourcingResult.processedLeads,
        "sourced prospect",
        "sourced prospects"
      ),
      this.countSummary(intakeResult.items.filter((item) => item.status === "created").length, "new intake", "new intakes"),
      this.countSummary(
        replyResult.items.filter((item) => ["logged", "responded", "booked_call", "intake_follow_up", "lost"].includes(item.status)).length,
        "inbound reply",
        "inbound replies"
      ),
      this.countSummary(
        replyResult.items.filter((item) => item.status === "booked_call").length,
        "booked-call route",
        "booked-call routes"
      ),
      this.countSummary(
        replyResult.items.filter((item) => item.status === "intake_follow_up").length,
        "intake follow-up route",
        "intake follow-up routes"
      ),
      this.countSummary(
        replyResult.items.filter((item) => item.status === "error").length,
        "inbox sync error",
        "inbox sync errors"
      ),
      this.countSummary(
        outboundResult.items.filter((item) => item.status === "sent").length,
        "automated outbound send",
        "automated outbound sends"
      ),
      this.countSummary(
        outboundResult.items.filter((item) => item.status === "awaiting_manual_send").length,
        "outbound manual fallback",
        "outbound manual fallbacks"
      ),
      this.countSummary(
        deliveryResult.items.filter((item) => item.status === "waiting_billing").length,
        "billing handoff",
        "billing handoffs"
      ),
      this.countSummary(
        deliveryResult.items.filter((item) => item.actions.some((action) => action.startsWith("Built preview"))).length,
        "build",
        "builds"
      ),
      this.countSummary(
        deliveryResult.items.filter((item) => item.actions.some((action) => action.includes("QA passed"))).length,
        "QA pass",
        "QA passes"
      ),
      this.countSummary(
        deliveryResult.items.filter((item) => item.status === "qa_failed").length,
        "QA stall",
        "QA stalls"
      ),
      this.countSummary(
        deliveryResult.items.filter((item) => item.status === "handoff_complete").length,
        "handoff-complete client",
        "handoff-complete clients"
      ),
      this.countSummary(
        deliveryResult.items.filter((item) => item.actions.some((action) => action.startsWith("Retention report refreshed"))).length,
        "retention refresh",
        "retention refreshes"
      ),
      this.countSummary(
        deliveryResult.items.filter((item) => item.actions.some((action) => action.startsWith("Proof bundle refreshed"))).length,
        "proof bundle refresh",
        "proof bundle refreshes"
      ),
      this.countSummary(
        deliveryResult.items.filter((item) => item.actions.some((action) => action.startsWith("Handoff package refreshed"))).length,
        "handoff package refresh",
        "handoff package refreshes"
      ),
      this.countSummary(
        failedMarketCollections,
        "market collection failure",
        "market collection failures"
      ),
      this.countSummary(sourcingResult.failedFiles, "source file failure", "source file failures")
    ].filter((value): value is string => Boolean(value));

    if (summaryParts.length === 0) {
      return "Northline autonomy refreshed with no new work items.";
    }

    return `Northline autonomy refreshed: ${summaryParts.join(", ")}.`;
  }

  private buildNotes(
    plan: NorthlineAutomationPlan,
    collectionResult: NorthlineProspectCollectionRunResult,
    sourcingResult: NorthlineProspectSourcingRunResult,
    intakeResult: IntakeSyncResult,
    replyResult: ReplySyncResult,
    outboundResult: QueueSyncResult<NorthlineAutonomyOutboundQueueItem>,
    deliveryResult: QueueSyncResult<NorthlineAutonomyDeliveryWorkItem>,
    drafted: number
  ): string[] {
    const failedMarketCollections = collectionResult.marketResults.filter(
      (market) => market.status === "failed"
    ).length;
    const notes = [
      collectionResult.writtenFiles > 0
        ? `Collected ${collectionResult.collectedRecords} market prospect record(s) across ${collectionResult.writtenFiles} source feed(s).`
        : undefined,
      failedMarketCollections > 0
        ? `${failedMarketCollections} market collection(s) failed; review ${collectionResult.artifacts.summaryJsonPath}.`
        : undefined,
      sourcingResult.processedLeads > 0
        ? `Processed ${sourcingResult.processedLeads} sourced lead record(s) from ${sourcingResult.processedFiles} updated source file(s).`
        : undefined,
      sourcingResult.failedFiles > 0
        ? `${sourcingResult.failedFiles} prospect source file(s) failed; review ${sourcingResult.artifacts.summaryJsonPath}.`
        : undefined,
      drafted > 0 ? `Prepared ${drafted} new outreach draft(s).` : undefined,
      intakeResult.items.some((item) => item.status === "created")
        ? `Created ${intakeResult.items.filter((item) => item.status === "created").length} proposal-stage intake client(s).`
        : undefined,
      replyResult.items.some((item) => ["logged", "responded", "booked_call", "intake_follow_up", "lost"].includes(item.status))
        ? `Synced ${replyResult.items.filter((item) => ["logged", "responded", "booked_call", "intake_follow_up", "lost"].includes(item.status)).length} inbound reply record(s).`
        : undefined,
      replyResult.items.some((item) => item.status === "booked_call")
        ? `${replyResult.items.filter((item) => item.status === "booked_call").length} reply route(s) should move toward a booked call.`
        : undefined,
      replyResult.items.some((item) => item.status === "intake_follow_up")
        ? `${replyResult.items.filter((item) => item.status === "intake_follow_up").length} reply route(s) should move toward hosted intake or preview follow-up.`
        : undefined,
      replyResult.items.some((item) => item.status === "error")
        ? `${replyResult.items.filter((item) => item.status === "error").length} inbox sync item(s) failed and need inbox-path review.`
        : undefined,
      outboundResult.items.some((item) => item.status === "sent")
        ? `Automated ${outboundResult.items.filter((item) => item.status === "sent").length} outbound send(s) from the VPS sender path.`
        : undefined,
      outboundResult.items.some((item) => item.status === "awaiting_manual_send")
        ? `${outboundResult.items.filter((item) => item.status === "awaiting_manual_send").length} outbound draft(s) still need a manual send or sender fix.`
        : undefined,
      deliveryResult.items.some((item) => item.status === "waiting_billing")
        ? `${deliveryResult.items.filter((item) => item.status === "waiting_billing").length} client(s) are waiting on an explicit billing handoff.`
        : undefined,
      deliveryResult.items.some((item) => item.status === "qa_failed")
        ? `${deliveryResult.items.filter((item) => item.status === "qa_failed").length} client(s) are blocked on QA.`
        : undefined,
      deliveryResult.items.some((item) => item.actions.some((action) => action.startsWith("Proof bundle refreshed")))
        ? `${deliveryResult.items.filter((item) => item.actions.some((action) => action.startsWith("Proof bundle refreshed"))).length} client proof bundle(s) were refreshed for publication.`
        : undefined,
      deliveryResult.items.some((item) => item.actions.some((action) => action.startsWith("Handoff package refreshed")))
        ? `${deliveryResult.items.filter((item) => item.actions.some((action) => action.startsWith("Handoff package refreshed"))).length} client handoff package(s) were refreshed for delivery.`
        : undefined,
      plan.roadblocks.length > 0 ? `Northline still has ${plan.roadblocks.length} launch roadblock(s).` : undefined,
      plan.operatingMode.current === "autonomous"
        ? "Northline is running in autonomous VPS mode with only explicit exception checkpoints left manual."
        : `Northline remains in controlled launch mode with ${plan.operatingMode.promotionCriteria.filter((criterion) => criterion.status === "missing").length} autonomy promotion criterion or criteria still missing.`
    ].filter((value): value is string => Boolean(value));

    return notes;
  }

  private countSummary(count: number, singular: string, plural: string): string | undefined {
    if (count <= 0) {
      return undefined;
    }
    return `${count} ${count === 1 ? singular : plural}`;
  }

  private deliverySummary(client: ClientJob, actions: string[]): string {
    if (this.hasCompletedHandoff(client)) {
      return `${client.clientName} is packaged for client-managed publication handoff.`;
    }
    if (client.qaStatus === "passed") {
      return `${client.clientName} is moving through automated client handoff packaging.`;
    }
    if (actions.length > 0) {
      return `${client.clientName} advanced automatically: ${actions.join(" ")}`;
    }
    return `${client.clientName} has no new autonomous delivery actions this run.`;
  }

  private notificationBody(
    plan: NorthlineAutomationPlan,
    snapshot: NorthlineAutonomySnapshot,
    reportPath: string
  ): string {
    return [
      snapshot.summary,
      "",
      `Plan status: ${plan.status}`,
      `Operating mode: ${snapshot.planOperatingMode}`,
      `Run report: ${reportPath}`,
      `Autonomy summary: ${this.summaryJsonPath(snapshot.businessId)}`,
      "",
      "Roadblocks:",
      ...(snapshot.roadblocks.length > 0 ? snapshot.roadblocks.map((roadblock) => `- ${roadblock}`) : ["- None"]),
      "",
      "Manual gates:",
      ...(snapshot.manualGates.length > 0
        ? snapshot.manualGates.map((gate) => `- [${gate.kind}] ${gate.summary}: ${gate.instructions}`)
        : ["- None"]),
      "",
      "Notes:",
      ...(snapshot.notes.length > 0 ? snapshot.notes.map((note) => `- ${note}`) : ["- No additional notes."])
    ].join("\n");
  }

  private async writeSummaryArtifacts(
    summaryJsonPath: string,
    summaryMarkdownPath: string,
    plan: NorthlineAutomationPlan,
    snapshot: NorthlineAutonomySnapshot,
    reportPath: string
  ): Promise<void> {
    await ensureDir(path.dirname(summaryJsonPath));
    await writeJsonFile(summaryJsonPath, {
      plan,
      snapshot,
      reportPath
    });
    await writeTextFile(summaryMarkdownPath, this.summaryMarkdown(plan, snapshot, reportPath));
  }

  private summaryMarkdown(
    plan: NorthlineAutomationPlan,
    snapshot: NorthlineAutonomySnapshot,
    reportPath: string
  ): string {
    return [
      `# ${plan.businessName} Autonomy Summary`,
      "",
      `Generated at: ${snapshot.generatedAt}`,
      `Status: ${snapshot.status}`,
      `Operating mode: ${snapshot.planOperatingMode}`,
      `Summary: ${snapshot.summary}`,
      `Run report: ${reportPath}`,
      "",
      "## Operating Mode",
      `- ${plan.operatingMode.summary}`,
      ...plan.operatingMode.evidence.map((entry) => `- Evidence: ${entry}`),
      ...plan.operatingMode.scheduledAutomation.map((entry) => `- Scheduled automation: ${entry}`),
      ...plan.operatingMode.manualCheckpoints.map((entry) => `- Manual checkpoint: ${entry}`),
      ...plan.operatingMode.promotionCriteria.map(
        (criterion) => `- [${criterion.status}] ${criterion.label}: ${criterion.summary}`
      ),
      "",
      "## Roadblocks",
      ...(snapshot.roadblocks.length > 0 ? snapshot.roadblocks.map((roadblock) => `- ${roadblock}`) : ["- None"]),
      "",
      "## Manual Gates",
      ...(snapshot.manualGates.length > 0
        ? snapshot.manualGates.map(
            (gate) => `- [${gate.kind}] ${gate.summary} (${gate.status}) -> ${gate.instructions}`
          )
        : ["- None"]),
      "",
      "## Intake Queue",
      ...(snapshot.newIntakes.length > 0
        ? snapshot.newIntakes.map((item) => `- ${item.status}: ${item.summary}`)
        : ["- No intake changes this run."]),
      "",
      "## Outbound Queue",
      ...(snapshot.outboundQueue.length > 0
        ? snapshot.outboundQueue.map((item) => `- ${item.status}: ${item.summary}`)
        : ["- No outbound changes this run."]),
      "",
      "## Reply Queue",
      ...(snapshot.replyQueue.length > 0
        ? snapshot.replyQueue.map(
            (item) => `- ${item.status}: ${item.summary} -> ${item.nextAction}`
          )
        : ["- No reply changes this run."]),
      "",
      "## Delivery Queue",
      ...(snapshot.deliveryQueue.length > 0
        ? snapshot.deliveryQueue.map((item) => `- ${item.status}: ${item.summary}`)
        : ["- No delivery changes this run."]),
      "",
      "## Notes",
      ...(snapshot.notes.length > 0 ? snapshot.notes.map((note) => `- ${note}`) : ["- No additional notes."]),
      ""
    ].join("\n");
  }

  private async refreshBusinessMetrics(
    business: ManagedBusiness,
    snapshot: NorthlineAutonomySnapshot
  ): Promise<void> {
    const businessProfile = resolveNorthlineBusinessProfile(this.config, business);
    const [leads, clients] = await Promise.all([this.store.getLeads(), this.store.getClients()]);

    await this.store.saveManagedBusiness({
      ...business,
      metrics: {
        ...business.metrics,
        lastRunAt: snapshot.generatedAt,
        activeWorkItems: countNorthlineScopedActiveWorkItems(
          business.id,
          businessProfile,
          leads,
          clients
        )
      },
      updatedAt: snapshot.generatedAt
    });
  }
}