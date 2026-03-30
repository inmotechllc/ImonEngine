import { createHash } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { ApprovalTask } from "../domain/contracts.js";
import type { ControlRoomHealthReport, ControlRoomSnapshot } from "../domain/control-room.js";
import type { EngineOverviewReport, ImonEngineState, ManagedBusiness } from "../domain/engine.js";
import type {
  OfficeChatAction,
  OfficeChatMessage,
  OfficeChatThread,
  OfficeOperatingConfig,
  OfficeReportArtifact,
  OfficeViewSnapshot,
  OrgAuditRecord,
  TaskEnvelope,
  WorkflowOwnershipRecord
} from "../domain/org.js";
import type {
  CollectiveFundSnapshot,
  RevenueAllocationSnapshot
} from "../domain/store-ops.js";
import { FileStore } from "../storage/store.js";
import { buildOfficeChatSummary } from "./office-chat-shared.js";

function latestByTimestamp<T>(
  items: T[],
  selectTimestamp: (item: T) => string | undefined
): T | undefined {
  return [...items].sort((left, right) =>
    (selectTimestamp(right) ?? "").localeCompare(selectTimestamp(left) ?? "")
  )[0];
}

function newestTimestamp(values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0];
}

function nowIso(): string {
  return new Date().toISOString();
}

export class ControlRoomSnapshotService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {}

  async buildSnapshot(): Promise<ControlRoomSnapshot> {
    const state = await this.collectState();
    const health = this.buildHealthReport(state);
    if (!state.engine || !state.officeSnapshot) {
      throw new Error("Cannot build control-room snapshot before engine and office snapshot exist.");
    }

    const latestAllocations = this.latestAllocationByBusiness(state.allocationSnapshots);
    const collectiveFund = latestByTimestamp(
      state.collectiveSnapshots,
      (snapshot) => snapshot.generatedAt
    );

    const officeSnapshot = state.officeSnapshot;
    const officeChatThreadsByOfficeId = new Map(
      state.officeChatThreads.map((thread) => [thread.officeId, thread])
    );
    const officeChatMessagesByOfficeId = this.groupByOfficeId(state.officeChatMessages);
    const officeChatActionsByOfficeId = this.groupByOfficeId(state.officeChatActions);
    const officeReportArtifactsByOfficeId = this.groupByOfficeId(state.officeReportArtifacts);
    const deferredBusinessIds = new Set(
      state.businesses
        .filter((business) => business.stage === "deferred")
        .map((business) => business.id)
    );
    const executiveView = {
      ...officeSnapshot.executiveView,
      chatSummary: buildOfficeChatSummary({
        officeId: officeSnapshot.executiveView.id,
        scope: "engine",
        thread: officeChatThreadsByOfficeId.get(officeSnapshot.executiveView.id),
        messages: officeChatMessagesByOfficeId.get(officeSnapshot.executiveView.id) ?? [],
        actions: officeChatActionsByOfficeId.get(officeSnapshot.executiveView.id) ?? [],
        reports: officeReportArtifactsByOfficeId.get(officeSnapshot.executiveView.id) ?? []
      })
    };
    const businessViews = officeSnapshot.businessViews.map((view) => ({
      ...view,
      chatSummary: buildOfficeChatSummary({
        officeId: view.id,
        scope: "business",
        thread: officeChatThreadsByOfficeId.get(view.id),
        messages: officeChatMessagesByOfficeId.get(view.id) ?? [],
        actions: officeChatActionsByOfficeId.get(view.id) ?? [],
        reports: officeReportArtifactsByOfficeId.get(view.id) ?? []
      })
    }));
    const departmentWorkspaces = officeSnapshot.departmentWorkspaces.map((workspace) => ({
      ...workspace,
      chatSummary: buildOfficeChatSummary({
        officeId: workspace.id,
        scope: "department",
        thread: officeChatThreadsByOfficeId.get(workspace.id),
        messages: officeChatMessagesByOfficeId.get(workspace.id) ?? [],
        actions: officeChatActionsByOfficeId.get(workspace.id) ?? [],
        reports: officeReportArtifactsByOfficeId.get(workspace.id) ?? []
      })
    }));

    const businesses = [...state.businesses]
      .sort((left, right) => left.launchPriority - right.launchPriority)
      .map((business) => {
        const allocationSnapshot = latestAllocations.get(business.id);
        const dataQuality = allocationSnapshot?.dataQuality;
        const budgetView = allocationSnapshot
          ? {
              basedOnVerifiedDataOnly:
                allocationSnapshot.recommendations.basedOnVerifiedDataOnly ?? true,
              verifiedNetRevenue:
                dataQuality?.verifiedNetRevenue ?? allocationSnapshot.netRevenue,
              relayDeposits: allocationSnapshot.relayDeposits,
              relaySpend: allocationSnapshot.relaySpend,
              growthReinvestment:
                allocationSnapshot.recommendations.growthReinvestment ??
                (allocationSnapshot.recommendations as { reinvestment?: number }).reinvestment ??
                0,
              collectiveTransfer:
                allocationSnapshot.recommendations.collectiveTransfer ??
                (allocationSnapshot.recommendations as { tools?: number }).tools ??
                0,
              ownerCashoutReady: allocationSnapshot.recommendations.ownerCashoutReady,
              excludedFromAllocationCount: dataQuality?.excludedFromAllocationCount ?? 0,
              warnings:
                dataQuality?.warnings ?? [
                  "Legacy revenue snapshot without explicit data-quality metadata."
                ]
            }
          : undefined;

        return {
          id: business.id,
          name: business.name,
          category: business.category,
          templateProfile: businessViews.find((view) => view.businessId === business.id)?.templateProfile,
          stage: business.stage,
          summary: business.summary,
          monthlyRevenue: business.metrics.currentMonthlyRevenue,
          monthlyCosts: business.metrics.currentMonthlyCosts,
          netRevenue:
            business.metrics.currentMonthlyRevenue - business.metrics.currentMonthlyCosts,
          automationCoverage: business.metrics.automationCoverage,
          activeWorkItems: business.metrics.activeWorkItems,
          office: businessViews.find((view) => view.businessId === business.id),
          departmentWorkspaces: departmentWorkspaces.filter(
            (workspace) => workspace.businessId === business.id
          ),
          approvals:
            business.stage === "deferred"
              ? []
              : state.approvals.filter(
                  (approval) =>
                    approval.relatedEntityType === "business" &&
                    approval.relatedEntityId === business.id &&
                    approval.status !== "completed"
                ),
          workflowOwnership: state.workflowOwnership.filter(
            (record) => record.businessId === business.id
          ),
          recentTasks: state.taskEnvelopes
            .filter((task) => task.businessId === business.id)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
            .slice(0, 6),
          recentAudits: state.auditRecords
            .filter((record) => record.businessId === business.id)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
            .slice(0, 6),
          allocationSnapshot,
          budgetView
        };
      });

    const executiveBudgetView = collectiveFund
      ? {
          basedOnVerifiedDataOnly:
            collectiveFund.recommendations.basedOnVerifiedDataOnly ?? true,
          growthReinvestment: collectiveFund.totals.growthReinvestment,
          collectiveTransfer: collectiveFund.totals.collectiveTransfer,
          sharedToolsReinvestmentCap:
            collectiveFund.recommendations.sharedToolsReinvestmentCap ?? 0,
          reserveAfterSharedReinvestment:
            collectiveFund.recommendations.reserveAfterSharedReinvestment ?? 0,
          warnings:
            collectiveFund.dataQuality?.warnings ?? [
              "Legacy collective snapshot without explicit data-quality metadata."
            ]
        }
      : undefined;

    return {
      generatedAt: nowIso(),
      fingerprint: this.computeFingerprint({
        healthFingerprint: health.fingerprint,
        report: state.engineReport,
        officeSnapshot: state.officeSnapshot,
        approvals: state.approvals,
        audits: state.auditRecords,
        tasks: state.taskEnvelopes,
        officeChatThreads: state.officeChatThreads,
        officeChatMessages: state.officeChatMessages,
        officeChatActions: state.officeChatActions,
        officeReportArtifacts: state.officeReportArtifacts,
        officeOperatingConfigs: state.officeOperatingConfigs,
        allocationSnapshots: state.allocationSnapshots,
        collectiveSnapshots: state.collectiveSnapshots
      }),
      engineId: state.engine.id,
      engineName: state.engine.name,
      engineOverview: state.engine.overview,
      report: state.engineReport,
      officeTree: officeSnapshot.officeTree,
      executiveView,
      approvals: state.approvals.filter(
        (approval) =>
          approval.status !== "completed" &&
          !(
            approval.relatedEntityType === "business" &&
            deferredBusinessIds.has(approval.relatedEntityId)
          )
      ),
      businesses,
      departmentWorkspaces,
      departmentExecutionItems: departmentWorkspaces.flatMap(
        (workspace) => workspace.executionItems
      ),
      recentAudits: [...state.auditRecords]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 12),
      collectiveFund,
      executiveBudgetView,
      globalWarnings: this.buildGlobalWarnings({
        health,
        executiveAlerts: officeSnapshot.executiveView.alerts,
        collectiveFund
      }),
      health
    };
  }

  async getHealthReport(): Promise<ControlRoomHealthReport> {
    const state = await this.collectState();
    return this.buildHealthReport(state);
  }

  private async collectState(): Promise<{
    engine?: ImonEngineState | null;
    officeSnapshot?: OfficeViewSnapshot;
    engineReport?: EngineOverviewReport;
    businesses: ManagedBusiness[];
    approvals: ApprovalTask[];
    auditRecords: OrgAuditRecord[];
    taskEnvelopes: TaskEnvelope[];
    workflowOwnership: WorkflowOwnershipRecord[];
    officeChatThreads: OfficeChatThread[];
    officeChatMessages: OfficeChatMessage[];
    officeChatActions: OfficeChatAction[];
    officeReportArtifacts: OfficeReportArtifact[];
    officeOperatingConfigs: OfficeOperatingConfig[];
    allocationSnapshots: RevenueAllocationSnapshot[];
    collectiveSnapshots: CollectiveFundSnapshot[];
  }> {
    const [
      engine,
      officeSnapshots,
      engineReports,
      businesses,
      approvals,
      auditRecords,
      taskEnvelopes,
      workflowOwnership,
      officeChatThreads,
      officeChatMessages,
      officeChatActions,
      officeReportArtifacts,
      officeOperatingConfigs,
      allocationSnapshots,
      collectiveSnapshots
    ] = await Promise.all([
      this.store.getEngineState(),
      this.store.getOfficeViewSnapshots(),
      this.store.getEngineReports(),
      this.store.getManagedBusinesses(),
      this.store.getApprovals(),
      this.store.getOrgAuditRecords(),
      this.store.getTaskEnvelopes(),
      this.store.getWorkflowOwnership(),
      this.store.getOfficeChatThreads(),
      this.store.getOfficeChatMessages(),
      this.store.getOfficeChatActions(),
      this.store.getOfficeReportArtifacts(),
      this.store.getOfficeOperatingConfigs(),
      this.store.getAllocationSnapshots(),
      this.store.getCollectiveSnapshots()
    ]);

    return {
      engine,
      officeSnapshot: latestByTimestamp(officeSnapshots, (snapshot) => snapshot.generatedAt),
      engineReport: latestByTimestamp(engineReports, (report) => report.generatedAt),
      businesses,
      approvals,
      auditRecords,
      taskEnvelopes,
      workflowOwnership,
      officeChatThreads,
      officeChatMessages,
      officeChatActions,
      officeReportArtifacts,
      officeOperatingConfigs,
      allocationSnapshots,
      collectiveSnapshots
    };
  }

  private groupByOfficeId<
    T extends { officeId: string }
  >(items: T[]): Map<string, T[]> {
    const grouped = new Map<string, T[]>();
    for (const item of items) {
      const current = grouped.get(item.officeId) ?? [];
      current.push(item);
      grouped.set(item.officeId, current);
    }
    return grouped;
  }

  private latestAllocationByBusiness(
    snapshots: RevenueAllocationSnapshot[]
  ): Map<string, RevenueAllocationSnapshot> {
    const sorted = [...snapshots].sort((left, right) =>
      right.generatedAt.localeCompare(left.generatedAt)
    );
    const allocations = new Map<string, RevenueAllocationSnapshot>();
    for (const snapshot of sorted) {
      if (!allocations.has(snapshot.businessId)) {
        allocations.set(snapshot.businessId, snapshot);
      }
    }
    return allocations;
  }

  private buildHealthReport(state: {
    engine?: ImonEngineState | null;
    officeSnapshot?: OfficeViewSnapshot;
    engineReport?: EngineOverviewReport;
    approvals: ApprovalTask[];
    auditRecords: OrgAuditRecord[];
    taskEnvelopes: TaskEnvelope[];
    allocationSnapshots: RevenueAllocationSnapshot[];
    collectiveSnapshots: CollectiveFundSnapshot[];
  }): ControlRoomHealthReport {
    const issues: string[] = [];
    if (!state.engine) {
      issues.push("ImonEngine state has not been initialized yet.");
    }
    if (!state.officeSnapshot) {
      issues.push("No office snapshot is available yet. Run engine-sync first.");
    }

    const lastSyncedAt = newestTimestamp([
      state.engine?.lastPortfolioSyncAt,
      state.officeSnapshot?.generatedAt,
      state.engineReport?.generatedAt
    ]);
    const staleThresholdMinutes = this.config.controlRoom.staleThresholdMinutes;
    const stale =
      !lastSyncedAt ||
      Date.now() - Date.parse(lastSyncedAt) > staleThresholdMinutes * 60 * 1000;

    if (stale) {
      issues.push(
        lastSyncedAt
          ? `Control-room source data is older than ${staleThresholdMinutes} minutes.`
          : "Control-room source data has not been generated yet."
      );
    }

    return {
      checkedAt: nowIso(),
      status: issues.length > 0 ? "degraded" : "ready",
      snapshotReady: Boolean(state.engine && state.officeSnapshot),
      stale,
      staleThresholdMinutes,
      fingerprint: this.computeFingerprint({
        engine: state.engine,
        officeSnapshot: state.officeSnapshot,
        report: state.engineReport,
        approvals: state.approvals,
        audits: state.auditRecords,
        tasks: state.taskEnvelopes,
        allocationSnapshots: state.allocationSnapshots,
        collectiveSnapshots: state.collectiveSnapshots
      }),
      lastSyncedAt,
      lastOfficeSnapshotAt: state.officeSnapshot?.generatedAt,
      lastEngineReportAt: state.engineReport?.generatedAt,
      issues
    };
  }

  private buildGlobalWarnings(args: {
    health: ControlRoomHealthReport;
    executiveAlerts: string[];
    collectiveFund?: CollectiveFundSnapshot;
  }): string[] {
    return [...new Set([
      ...args.health.issues,
      ...args.executiveAlerts,
      ...(args.collectiveFund?.dataQuality?.warnings ?? [])
    ])];
  }

  private computeFingerprint(input: unknown): string {
    return createHash("sha256").update(JSON.stringify(input)).digest("hex");
  }
}
