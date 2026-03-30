import type { ApprovalTask } from "./contracts.js";
import type { EngineOverviewReport } from "./engine.js";
import type {
  BusinessOfficeView,
  DepartmentExecutionItem,
  DepartmentWorkspaceView,
  ExecutiveOfficeView,
  OfficeTreeNode,
  OrgAuditRecord,
  TaskEnvelope,
  WorkflowOwnershipRecord
} from "./org.js";
import type {
  CollectiveFundSnapshot,
  RevenueAllocationSnapshot
} from "./store-ops.js";

export interface ExecutiveOfficeBudgetView {
  basedOnVerifiedDataOnly: boolean;
  growthReinvestment: number;
  collectiveTransfer: number;
  sharedToolsReinvestmentCap: number;
  reserveAfterSharedReinvestment: number;
  warnings: string[];
}

export interface BusinessOfficeBudgetView {
  basedOnVerifiedDataOnly: boolean;
  verifiedNetRevenue: number;
  relayDeposits: number;
  relaySpend: number;
  growthReinvestment: number;
  collectiveTransfer: number;
  ownerCashoutReady: boolean;
  excludedFromAllocationCount: number;
  warnings: string[];
}

export interface ControlRoomBusinessView {
  id: string;
  name: string;
  category: string;
  templateProfile?: string;
  stage: string;
  summary: string;
  monthlyRevenue: number;
  monthlyCosts: number;
  netRevenue: number;
  automationCoverage: number;
  activeWorkItems: number;
  office?: BusinessOfficeView;
  departmentWorkspaces: DepartmentWorkspaceView[];
  approvals: ApprovalTask[];
  workflowOwnership: WorkflowOwnershipRecord[];
  recentTasks: TaskEnvelope[];
  recentAudits: OrgAuditRecord[];
  allocationSnapshot?: RevenueAllocationSnapshot;
  budgetView?: BusinessOfficeBudgetView;
}

export interface ControlRoomHealthReport {
  checkedAt: string;
  status: "ready" | "degraded";
  snapshotReady: boolean;
  stale: boolean;
  staleThresholdMinutes: number;
  fingerprint: string;
  lastSyncedAt?: string;
  lastOfficeSnapshotAt?: string;
  lastEngineReportAt?: string;
  issues: string[];
}

export interface ControlRoomSnapshot {
  generatedAt: string;
  fingerprint: string;
  engineId: string;
  engineName: string;
  engineOverview: string;
  report?: EngineOverviewReport;
  officeTree: OfficeTreeNode;
  executiveView: ExecutiveOfficeView;
  approvals: ApprovalTask[];
  businesses: ControlRoomBusinessView[];
  departmentWorkspaces: DepartmentWorkspaceView[];
  departmentExecutionItems: DepartmentExecutionItem[];
  recentAudits: OrgAuditRecord[];
  collectiveFund?: CollectiveFundSnapshot;
  executiveBudgetView?: ExecutiveOfficeBudgetView;
  globalWarnings: string[];
  health: ControlRoomHealthReport;
}
