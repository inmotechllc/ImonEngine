import { createHash } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { ApprovalTask } from "../domain/contracts.js";
import type { ControlRoomHealthReport, ControlRoomSnapshot } from "../domain/control-room.js";
import type { EngineOverviewReport, ImonEngineState, ManagedBusiness } from "../domain/engine.js";
import type {
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

    const businesses = [...state.businesses]
      .sort((left, right) => left.launchPriority - right.launchPriority)
      .map((business) => {
        const allocationSnapshot = latestAllocations.get(business.id);
        const dataQuality = allocationSnapshot?.dataQuality;
        const budgetView = allocationSnapshot
          ? {
              basedOnVerifiedDataOnly: allocationSnapshot.recommendations.basedOnVerifiedDataOnly,
              verifiedNetRevenue:
                dataQuality?.verifiedNetRevenue ?? allocationSnapshot.netRevenue,
              relayDeposits: allocationSnapshot.relayDeposits,
              relaySpend: allocationSnapshot.relaySpend,
              growthReinvestment: allocationSnapshot.recommendations.growthReinvestment,
              collectiveTransfer: allocationSnapshot.recommendations.collectiveTransfer,
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
          stage: business.stage,
          summary: business.summary,
          monthlyRevenue: business.metrics.currentMonthlyRevenue,
          monthlyCosts: business.metrics.currentMonthlyCosts,
          netRevenue:
            business.metrics.currentMonthlyRevenue - business.metrics.currentMonthlyCosts,
          automationCoverage: business.metrics.automationCoverage,
          activeWorkItems: business.metrics.activeWorkItems,
          office: officeSnapshot.businessViews.find((view) => view.businessId === business.id),
          approvals: state.approvals.filter(
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
          basedOnVerifiedDataOnly: collectiveFund.recommendations.basedOnVerifiedDataOnly,
          growthReinvestment: collectiveFund.totals.growthReinvestment,
          collectiveTransfer: collectiveFund.totals.collectiveTransfer,
          sharedToolsReinvestmentCap:
            collectiveFund.recommendations.sharedToolsReinvestmentCap,
          reserveAfterSharedReinvestment:
            collectiveFund.recommendations.reserveAfterSharedReinvestment,
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
        allocationSnapshots: state.allocationSnapshots,
        collectiveSnapshots: state.collectiveSnapshots
      }),
      engineId: state.engine.id,
      engineName: state.engine.name,
      engineOverview: state.engine.overview,
      report: state.engineReport,
      executiveView: officeSnapshot.executiveView,
      approvals: state.approvals.filter((approval) => approval.status !== "completed"),
      businesses,
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
      allocationSnapshots,
      collectiveSnapshots
    };
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
