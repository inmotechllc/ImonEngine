import type { ApprovalTask } from "./contracts.js";
import type { BusinessCategory, ManagedBusinessSeed } from "./engine.js";

export type OrgScope = "engine" | "business" | "department" | "position" | "task";

export type PositionAssignmentMode = "ai" | "human" | "hybrid";

export type ModelRouteTier = "local" | "mid" | "premium";

export type ApprovalRiskLevel = "low" | "medium" | "high";

export type ApprovalActionClass =
  | "internal"
  | "public_post"
  | "customer_facing"
  | "financial"
  | "compliance"
  | "cross_business";

export type OrgAuditSeverity = "info" | "warning" | "error";

export type OrgAuditEventType =
  | "sync"
  | "route"
  | "approval"
  | "escalation"
  | "tool_use"
  | "public_action"
  | "blocked";

export type DepartmentKind =
  | "executive_management"
  | "operations"
  | "growth_marketing"
  | "product_content"
  | "finance"
  | "analytics_research"
  | "customer_support_qa"
  | "merchandising"
  | "storefront_ops"
  | "content_studio"
  | "community_qa"
  | "product_ops"
  | "technology_systems"
  | "risk_compliance";

export type OfficeTemplateProfile =
  | "catalog_store"
  | "audience_brand"
  | "product_business"
  | "service_business";

export type OfficeHandoffStatus =
  | "queued"
  | "awaiting_approval"
  | "in_progress"
  | "blocked"
  | "completed";

export type DepartmentExecutionStatus =
  | "queued"
  | "running"
  | "blocked"
  | "review"
  | "done";

export type OfficeWorkerType =
  | "engine_orchestrator"
  | "brand_orchestrator"
  | "department_orchestrator"
  | "task_agent"
  | "sub_agent";

export type OfficeChatMessageRole =
  | "user"
  | "assistant"
  | "system"
  | "action";

export type OfficeChatActionStatus =
  | "completed"
  | "awaiting_confirmation"
  | "routed"
  | "failed"
  | "dismissed";

export type OfficeChatActionKind =
  | "generate_report"
  | "answer_question"
  | "create_business_scaffold_draft"
  | "apply_business_scaffold_draft"
  | "route_task"
  | "update_office_directives"
  | "update_schedule_override"
  | "create_execution_brief";

export interface OfficeScheduleOverride {
  cadence?: string;
  maxRunsPerDay?: number;
  preferredWindows: string[];
  notes: string[];
}

export interface PermissionPolicy {
  id: string;
  blueprintId: string;
  scope: OrgScope;
  businessId?: string;
  departmentId?: string;
  positionId?: string;
  allowedTools: string[];
  deniedTools: string[];
  allowedSystems: string[];
  allowCrossBusinessRead: boolean;
  allowCrossBusinessWrite: boolean;
  canPublicPost: boolean;
  canSpendMoney: boolean;
  canApproveExternalChanges: boolean;
  requiresVerifiedFinancialData: boolean;
  notes: string[];
}

export interface MemoryNamespacePolicy {
  id: string;
  blueprintId: string;
  scope: OrgScope;
  businessId?: string;
  departmentId?: string;
  positionId?: string;
  primaryNamespace: string;
  readableNamespaces: string[];
  writableNamespaces: string[];
  allowCrossBusinessAccess: boolean;
  temporaryNamespacePattern?: string;
  notes: string[];
}

export interface ApprovalRoute {
  id: string;
  blueprintId: string;
  scope: OrgScope;
  businessId?: string;
  departmentId?: string;
  positionId?: string;
  riskLevel: ApprovalRiskLevel;
  actionClasses: ApprovalActionClass[];
  autoApproveWhen: string[];
  escalationChain: string[];
  notes: string[];
}

export interface DepartmentDefinition {
  id: string;
  blueprintId: string;
  scope: Extract<OrgScope, "engine" | "business" | "department">;
  businessId?: string;
  name: string;
  kind: DepartmentKind;
  purpose: string;
  kpis: string[];
  budgetOwnerPositionId?: string;
  workflowIds: string[];
  toolTags: string[];
  memoryNamespaceIds: string[];
  positionIds: string[];
  reportsToDepartmentId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PositionDefinition {
  id: string;
  blueprintId: string;
  scope: Extract<OrgScope, "engine" | "business" | "position">;
  businessId?: string;
  departmentId: string;
  title: string;
  mission: string;
  reportsToPositionId?: string;
  assignmentMode: PositionAssignmentMode;
  modelPolicy: {
    defaultTier: ModelRouteTier;
    escalationTargetTier: ModelRouteTier;
    escalationTriggers: string[];
  };
  permissionPolicyId: string;
  approvalRouteIds: string[];
  memoryNamespaceIds: string[];
  authorityLimits: string[];
  decisionRights: string[];
  kpis: string[];
  toolTags: string[];
  publicFacing: boolean;
  handlesMoney: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PositionAssignment {
  id: string;
  blueprintId: string;
  positionId: string;
  mode: PositionAssignmentMode;
  assigneeLabel: string;
  state: "planned" | "active";
  notes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ReportingLine {
  id: string;
  blueprintId: string;
  fromPositionId: string;
  toPositionId: string;
  relationship: "manager" | "dotted_line" | "approval";
}

export interface WorkflowOwnershipRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  scope: OrgScope;
  businessId?: string;
  departmentId: string;
  departmentName: string;
  positionId: string;
  positionName: string;
  allowedModelTier: ModelRouteTier;
  allowedTools: string[];
  escalationTargetPositionId?: string;
  escalationTargetLabel?: string;
  successMetric: string;
  notes: string[];
  updatedAt: string;
}

export interface OrganizationBlueprint {
  id: string;
  scope: Extract<OrgScope, "engine" | "business">;
  engineId: string;
  businessId?: string;
  businessCategory?: BusinessCategory | "engine";
  name: string;
  summary: string;
  departmentIds: string[];
  positionIds: string[];
  approvalRouteIds: string[];
  memoryNamespaceIds: string[];
  permissionPolicyIds: string[];
  workflowIds: string[];
  reportingLineIds: string[];
  budgetOwners: string[];
  kpiOwners: string[];
  officeViews: {
    executiveViewId?: string;
    businessViewId?: string;
    departmentViewIds: string[];
  };
  createdAt: string;
  updatedAt: string;
}

export interface TaskEnvelope {
  id: string;
  title: string;
  summary: string;
  scope: "task";
  workflowId?: string;
  engineId: string;
  businessId?: string;
  departmentId: string;
  positionId: string;
  allowedTools: string[];
  allowedMemoryNamespaces: string[];
  approvalRouteId: string;
  riskLevel: ApprovalRiskLevel;
  actionClasses: ApprovalActionClass[];
  publicFacing: boolean;
  moneyMovement: boolean;
  requiresVerifiedFinancialData: boolean;
  escalationTargetPositionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrgAuditRecord {
  id: string;
  engineId: string;
  businessId?: string;
  departmentId?: string;
  positionId?: string;
  workflowId?: string;
  taskEnvelopeId?: string;
  eventType: OrgAuditEventType;
  severity: OrgAuditSeverity;
  summary: string;
  details: string[];
  createdAt: string;
}

export interface OfficePanelSummary {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  ownerPositionId?: string;
  metrics: string[];
  alertCount: number;
}

export interface OfficeBreadcrumb {
  id: string;
  scope: Extract<OrgScope, "engine" | "business" | "department">;
  title: string;
  route: string;
}

export interface OfficeTreeNode {
  id: string;
  scope: Extract<OrgScope, "engine" | "business" | "department">;
  title: string;
  subtitle: string;
  route: string;
  status: string;
  parentId?: string;
  officeId: string;
  businessId?: string;
  departmentId?: string;
  counts: {
    approvals: number;
    handoffs: number;
    blockers: number;
    executions: number;
  };
  children: OfficeTreeNode[];
}

export interface OfficeChatSummary {
  officeId: string;
  scope: Extract<OrgScope, "engine" | "business" | "department">;
  threadId: string;
  assistantLabel: string;
  lastMessagePreview: string;
  lastMessageAt?: string;
  pendingActionCount: number;
  reportCount: number;
  latestActionTitles: string[];
  latestReportTitles: string[];
}

export interface OfficeChatThread {
  id: string;
  officeId: string;
  scope: Extract<OrgScope, "engine" | "business" | "department">;
  businessId?: string;
  departmentId?: string;
  assistantLabel: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string;
}

export interface OfficeChatMessage {
  id: string;
  threadId: string;
  officeId: string;
  scope: Extract<OrgScope, "engine" | "business" | "department">;
  businessId?: string;
  departmentId?: string;
  role: OfficeChatMessageRole;
  content: string;
  actionIds: string[];
  createdAt: string;
}

export interface OfficeChatAction {
  id: string;
  threadId: string;
  officeId: string;
  scope: Extract<OrgScope, "engine" | "business" | "department">;
  businessId?: string;
  departmentId?: string;
  kind: OfficeChatActionKind;
  status: OfficeChatActionStatus;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  resultLines: string[];
  reportArtifactIds: string[];
  taskEnvelopeIds: string[];
  approvalIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OfficeReportArtifact {
  id: string;
  officeId: string;
  scope: Extract<OrgScope, "engine" | "business" | "department">;
  businessId?: string;
  departmentId?: string;
  title: string;
  summary: string;
  markdownPath: string;
  jsonPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessScaffoldDraft {
  id: string;
  officeId: string;
  threadId: string;
  proposedBusiness: ManagedBusinessSeed;
  createdAt: string;
  updatedAt: string;
}

export interface OfficeOperatingConfig {
  id: string;
  officeId: string;
  scope: Extract<OrgScope, "engine" | "business" | "department">;
  businessId?: string;
  departmentId?: string;
  promptDirectives: string[];
  scheduleOverride?: OfficeScheduleOverride;
  createdAt: string;
  updatedAt: string;
}

export interface OfficeWorkerSummary {
  id: string;
  officeId: string;
  businessId?: string;
  departmentId?: string;
  positionId?: string;
  label: string;
  title: string;
  workerType: OfficeWorkerType;
  route: string;
  status: string;
  summary: string;
  metrics: string[];
  toolTags: string[];
}

export interface OfficeHandoffRecord {
  id: string;
  scope: Extract<OrgScope, "engine" | "business">;
  businessId?: string;
  departmentId?: string;
  sourceOfficeId: string;
  targetOfficeId: string;
  title: string;
  summary: string;
  workflowId?: string;
  status: OfficeHandoffStatus;
  roadblocks: string[];
  ownerPositionId?: string;
  ownerLabel: string;
  approvalIds: string[];
  taskEnvelopeIds: string[];
  executionItemIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DepartmentExecutionItem {
  id: string;
  businessId?: string;
  departmentId: string;
  workflowId?: string;
  taskEnvelopeId?: string;
  title: string;
  summary: string;
  status: DepartmentExecutionStatus;
  assignedWorkerId: string;
  assignedWorkerLabel: string;
  blockers: string[];
  artifacts: string[];
  metrics: string[];
  approvalIds: string[];
  auditRecordIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ExecutiveOfficeView {
  id: string;
  engineId: string;
  generatedAt: string;
  title: string;
  summary: string;
  businesses: OfficePanelSummary[];
  alerts: string[];
  roadblocks: string[];
  breadcrumbs: OfficeBreadcrumb[];
  workers: OfficeWorkerSummary[];
  handoffs: OfficeHandoffRecord[];
  approvalTasks: ApprovalTask[];
  approvalsWaiting: number;
  chatSummary?: OfficeChatSummary;
}

export interface BusinessOfficeView {
  id: string;
  engineId: string;
  businessId: string;
  generatedAt: string;
  title: string;
  summary: string;
  templateProfile: OfficeTemplateProfile;
  breadcrumbs: OfficeBreadcrumb[];
  departments: OfficePanelSummary[];
  workers: OfficeWorkerSummary[];
  handoffs: OfficeHandoffRecord[];
  approvalTasks: ApprovalTask[];
  roadblocks: string[];
  alerts: string[];
  chatSummary?: OfficeChatSummary;
}

export interface DepartmentOfficeView {
  id: string;
  engineId: string;
  businessId?: string;
  departmentId: string;
  generatedAt: string;
  title: string;
  summary: string;
  templateProfile?: OfficeTemplateProfile;
  breadcrumbs: OfficeBreadcrumb[];
  positions: OfficePanelSummary[];
  workers: OfficeWorkerSummary[];
  roadblocks: string[];
  alerts: string[];
}

export interface DepartmentWorkspaceView {
  id: string;
  engineId: string;
  businessId: string;
  departmentId: string;
  generatedAt: string;
  title: string;
  summary: string;
  templateProfile: OfficeTemplateProfile;
  breadcrumbs: OfficeBreadcrumb[];
  workers: OfficeWorkerSummary[];
  executionItems: DepartmentExecutionItem[];
  approvalTasks: ApprovalTask[];
  roadblocks: string[];
  alerts: string[];
  metrics: string[];
  widgetSections: string[];
  recentActivity: OrgAuditRecord[];
  chatSummary?: OfficeChatSummary;
}

export interface OfficeViewSnapshot {
  id: string;
  generatedAt: string;
  engineId: string;
  officeTree: OfficeTreeNode;
  executiveView: ExecutiveOfficeView;
  businessViews: BusinessOfficeView[];
  departmentViews: DepartmentOfficeView[];
  departmentWorkspaces: DepartmentWorkspaceView[];
}

export interface TaskRoutingRequest {
  workflowId?: string;
  title: string;
  summary: string;
  businessId?: string;
  departmentId?: string;
  positionId?: string;
  riskLevel?: ApprovalRiskLevel;
  actionClasses?: ApprovalActionClass[];
  publicFacing?: boolean;
  moneyMovement?: boolean;
  requiresVerifiedFinancialData?: boolean;
  requestedTools?: string[];
}

export interface OfficeChatView {
  thread: OfficeChatThread;
  messages: OfficeChatMessage[];
  actions: OfficeChatAction[];
  reports: OfficeReportArtifact[];
  operatingConfig: OfficeOperatingConfig;
  summary: OfficeChatSummary;
}
