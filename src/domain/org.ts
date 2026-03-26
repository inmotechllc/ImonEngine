import type { BusinessCategory } from "./engine.js";

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

export interface ExecutiveOfficeView {
  id: string;
  engineId: string;
  generatedAt: string;
  title: string;
  summary: string;
  businesses: OfficePanelSummary[];
  alerts: string[];
  approvalsWaiting: number;
}

export interface BusinessOfficeView {
  id: string;
  engineId: string;
  businessId: string;
  generatedAt: string;
  title: string;
  summary: string;
  departments: OfficePanelSummary[];
  alerts: string[];
}

export interface DepartmentOfficeView {
  id: string;
  engineId: string;
  businessId?: string;
  departmentId: string;
  generatedAt: string;
  title: string;
  summary: string;
  positions: OfficePanelSummary[];
  alerts: string[];
}

export interface OfficeViewSnapshot {
  id: string;
  generatedAt: string;
  engineId: string;
  executiveView: ExecutiveOfficeView;
  businessViews: BusinessOfficeView[];
  departmentViews: DepartmentOfficeView[];
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
