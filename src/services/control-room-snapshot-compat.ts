import type {
  ControlRoomBusinessView,
  ControlRoomHealthReport,
  ControlRoomSnapshot
} from "../domain/control-room.js";
import type { ApprovalTask } from "../domain/contracts.js";
import type { BusinessCategory } from "../domain/engine.js";
import type {
  BusinessOfficeView,
  DepartmentExecutionItem,
  DepartmentExecutionStatus,
  DepartmentWorkspaceView,
  ExecutiveOfficeView,
  OfficeBreadcrumb,
  OfficeHandoffRecord,
  OfficePanelSummary,
  OfficeTemplateProfile,
  OfficeTreeNode,
  OfficeWorkerSummary,
  OrgAuditRecord,
  TaskEnvelope,
  WorkflowOwnershipRecord
} from "../domain/org.js";
import {
  getOfficeTemplateProfileSpec,
  officeTemplateProfileForCategory
} from "./office-templates.js";

type LegacyExecutiveOfficeView = Omit<
  ExecutiveOfficeView,
  "roadblocks" | "breadcrumbs" | "workers" | "handoffs" | "approvalTasks"
>;

type LegacyBusinessOfficeView = Omit<
  BusinessOfficeView,
  | "templateProfile"
  | "breadcrumbs"
  | "workers"
  | "handoffs"
  | "approvalTasks"
  | "roadblocks"
>;

interface LegacyBusinessView {
  id: string;
  name: string;
  category: string;
  stage: string;
  summary: string;
  monthlyRevenue: number;
  monthlyCosts: number;
  netRevenue: number;
  automationCoverage: number;
  activeWorkItems: number;
  office?: LegacyBusinessOfficeView;
  approvals: ApprovalTask[];
  workflowOwnership: WorkflowOwnershipRecord[];
  recentTasks: TaskEnvelope[];
  recentAudits: OrgAuditRecord[];
  allocationSnapshot?: ControlRoomBusinessView["allocationSnapshot"];
  budgetView?: ControlRoomBusinessView["budgetView"];
  departmentWorkspaces?: DepartmentWorkspaceView[];
}

interface LegacyControlRoomSnapshot
  extends Omit<
    ControlRoomSnapshot,
    "officeTree" | "executiveView" | "businesses" | "departmentWorkspaces" | "departmentExecutionItems"
  > {
  officeTree?: OfficeTreeNode;
  executiveView: LegacyExecutiveOfficeView;
  businesses: LegacyBusinessView[];
  departmentWorkspaces?: DepartmentWorkspaceView[];
  departmentExecutionItems?: DepartmentExecutionItem[];
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function modernSnapshot(snapshot: LegacyControlRoomSnapshot): snapshot is ControlRoomSnapshot {
  return Boolean(
    snapshot.officeTree &&
      Array.isArray(snapshot.departmentWorkspaces) &&
      Array.isArray(snapshot.departmentExecutionItems) &&
      Array.isArray((snapshot.executiveView as Partial<ExecutiveOfficeView>).workers)
  );
}

function businessTemplateProfile(category: string): OfficeTemplateProfile {
  return officeTemplateProfileForCategory(category as BusinessCategory);
}

function businessRoute(businessId: string): string {
  return `/business/${encodeURIComponent(businessId)}`;
}

function departmentRoute(businessId: string, departmentId: string): string {
  return `/department/${encodeURIComponent(businessId)}/${encodeURIComponent(departmentId)}`;
}

function workspaceTitle(workspace: DepartmentWorkspaceView): string {
  return workspace.title.endsWith(" Department Workspace")
    ? workspace.title.slice(0, -` Department Workspace`.length)
    : workspace.title;
}

function parseDepartmentId(
  businessId: string,
  panel: OfficePanelSummary,
  workflows: WorkflowOwnershipRecord[]
): string {
  if (panel.id.startsWith("office-panel-department-")) {
    return panel.id.slice("office-panel-department-".length);
  }

  const exactWorkflow =
    workflows.find((workflow) => workflow.departmentName === panel.title) ??
    workflows.find((workflow) => workflow.positionId === panel.ownerPositionId) ??
    workflows.find((workflow) => workflow.departmentId.endsWith(panel.subtitle));
  if (exactWorkflow) {
    return exactWorkflow.departmentId;
  }

  const fallbackSlug = panel.subtitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `legacy-business-${businessId}-department-${fallbackSlug || "general"}`;
}

function makeHealth(snapshot: LegacyControlRoomSnapshot): ControlRoomHealthReport {
  return (
    snapshot.health ?? {
      checkedAt: snapshot.generatedAt,
      status: "degraded",
      snapshotReady: true,
      stale: false,
      staleThresholdMinutes: 120,
      fingerprint: snapshot.fingerprint,
      lastSyncedAt: snapshot.generatedAt,
      issues: ["Legacy control-room snapshot required compatibility normalization."]
    }
  );
}

function businessApprovals(
  snapshot: LegacyControlRoomSnapshot,
  business: LegacyBusinessView
): ApprovalTask[] {
  if (business.stage === "deferred") {
    return [];
  }

  if (business.approvals.length > 0) {
    return business.approvals;
  }

  return snapshot.approvals.filter(
    (approval) =>
      approval.relatedEntityType === "business" &&
      approval.relatedEntityId === business.id &&
      approval.status !== "completed"
  );
}

function businessRoadblocks(
  business: LegacyBusinessView,
  approvals: ApprovalTask[]
): string[] {
  return uniqueStrings([
    ...(business.office?.alerts ?? []),
    ...approvals.map((approval) => approval.reason || approval.actionNeeded)
  ]);
}

function departmentRoadblocks(
  panel: OfficePanelSummary,
  business: LegacyBusinessView,
  approvals: ApprovalTask[]
): string[] {
  const officeAlerts = business.office?.alerts ?? [];
  const approvalReasons = approvals.map((approval) => approval.reason || approval.actionNeeded);
  const candidates = uniqueStrings([...officeAlerts, ...approvalReasons]);
  if (panel.alertCount > 0) {
    return candidates.slice(0, Math.max(1, panel.alertCount));
  }
  if (business.stage === "blocked" || business.stage === "scaffolded") {
    return candidates.slice(0, 1);
  }
  return [];
}

function executionStatus(
  business: LegacyBusinessView,
  roadblocks: string[],
  approvalTasks: ApprovalTask[]
): DepartmentExecutionStatus {
  if (business.stage === "deferred") {
    return "queued";
  }

  if (roadblocks.length > 0) {
    return "blocked";
  }
  if (approvalTasks.length > 0) {
    return "review";
  }
  if (business.stage === "active" || business.stage === "ready") {
    return "running";
  }
  return "queued";
}

function departmentApprovalTasks(
  panel: OfficePanelSummary,
  approvals: ApprovalTask[]
): ApprovalTask[] {
  return panel.subtitle === "executive_management" || panel.subtitle === "operations"
    ? approvals
    : [];
}

function auditTrailForDepartment(
  business: LegacyBusinessView,
  departmentId: string
): OrgAuditRecord[] {
  return [...business.recentAudits]
    .filter((record) => record.departmentId === departmentId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 8);
}

function taskTrailForDepartment(
  business: LegacyBusinessView,
  departmentId: string
): TaskEnvelope[] {
  return [...business.recentTasks]
    .filter((task) => task.departmentId === departmentId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 6);
}

function departmentWorkers(args: {
  business: LegacyBusinessView;
  officeId: string;
  departmentId: string;
  departmentTitle: string;
  panel: OfficePanelSummary;
  workflows: WorkflowOwnershipRecord[];
  status: DepartmentExecutionStatus;
}): OfficeWorkerSummary[] {
  const route = departmentRoute(args.business.id, args.departmentId);
  const toolTags = uniqueStrings(args.workflows.flatMap((workflow) => workflow.allowedTools));
  const orchestrator: OfficeWorkerSummary = {
    id: `worker-department-${args.business.id}-${args.departmentId}-orchestrator`,
    officeId: args.officeId,
    businessId: args.business.id,
    departmentId: args.departmentId,
    positionId: args.panel.ownerPositionId ?? args.workflows[0]?.positionId,
    label: `${args.departmentTitle} Orchestrator`,
    title: `${args.departmentTitle} Department Office`,
    workerType: "department_orchestrator",
    route,
    status: args.status,
    summary: `Coordinates ${args.departmentTitle.toLowerCase()} execution inside ${args.business.name}.`,
    metrics: [...args.panel.metrics],
    toolTags
  };

  const taskAgents = args.workflows.map<OfficeWorkerSummary>((workflow) => ({
    id: `worker-task-${args.business.id}-${args.departmentId}-${workflow.workflowId}`,
    officeId: args.officeId,
    businessId: args.business.id,
    departmentId: args.departmentId,
    positionId: workflow.positionId,
    label: workflow.positionName,
    title: workflow.workflowName,
    workerType: "task_agent",
    route,
    status: args.status,
    summary: workflow.successMetric,
    metrics: [
      `Model: ${workflow.allowedModelTier}`,
      `Tools: ${workflow.allowedTools.length}`,
      `Workflow: ${workflow.workflowId}`
    ],
    toolTags: [...workflow.allowedTools]
  }));

  return [orchestrator, ...taskAgents];
}

function departmentExecutionItems(args: {
  business: LegacyBusinessView;
  departmentId: string;
  departmentTitle: string;
  workflows: WorkflowOwnershipRecord[];
  roadblocks: string[];
  approvalTasks: ApprovalTask[];
  recentActivity: OrgAuditRecord[];
  recentTasks: TaskEnvelope[];
  status: DepartmentExecutionStatus;
}): DepartmentExecutionItem[] {
  if (args.workflows.length === 0) {
    return [
      {
        id: `execution-${args.business.id}-${args.departmentId}-backlog`,
        businessId: args.business.id,
        departmentId: args.departmentId,
        title: `${args.departmentTitle} backlog`,
        summary: `Pending execution work for ${args.departmentTitle.toLowerCase()} inside ${args.business.name}.`,
        status: args.status,
        assignedWorkerId: `worker-department-${args.business.id}-${args.departmentId}-orchestrator`,
        assignedWorkerLabel: `${args.departmentTitle} Orchestrator`,
        blockers: [...args.roadblocks],
        artifacts:
          args.recentTasks[0] ? [args.recentTasks[0].title] : ["No output recorded yet."],
        metrics: ["Workflow coverage pending", "Tools: 0"],
        approvalIds: args.approvalTasks.map((approval) => approval.id),
        auditRecordIds: args.recentActivity.map((record) => record.id),
        createdAt: args.business.office?.generatedAt ?? args.business.recentAudits[0]?.createdAt ?? new Date().toISOString(),
        updatedAt: args.business.office?.generatedAt ?? args.business.recentAudits[0]?.createdAt ?? new Date().toISOString()
      }
    ];
  }

  return args.workflows.map((workflow) => ({
    id: `execution-${args.business.id}-${args.departmentId}-${workflow.workflowId}`,
    businessId: args.business.id,
    departmentId: args.departmentId,
    workflowId: workflow.workflowId,
    title: workflow.workflowName,
    summary: workflow.successMetric,
    status: args.status,
    assignedWorkerId: `worker-task-${args.business.id}-${args.departmentId}-${workflow.workflowId}`,
    assignedWorkerLabel: workflow.positionName,
    blockers: [...args.roadblocks],
    artifacts:
      args.recentTasks.length > 0
        ? args.recentTasks.map((task) => task.title)
        : ["No output recorded yet."],
    metrics: [
      `Model: ${workflow.allowedModelTier}`,
      `Tools: ${workflow.allowedTools.length}`,
      `Workflow: ${workflow.workflowId}`
    ],
    approvalIds: args.approvalTasks.map((approval) => approval.id),
    auditRecordIds: args.recentActivity.map((record) => record.id),
    createdAt: workflow.updatedAt,
    updatedAt: workflow.updatedAt
  }));
}

function departmentWorkspace(
  snapshot: LegacyControlRoomSnapshot,
  business: LegacyBusinessView,
  panel: OfficePanelSummary,
  approvals: ApprovalTask[],
  templateProfile: OfficeTemplateProfile
): DepartmentWorkspaceView {
  const departmentId = parseDepartmentId(business.id, panel, business.workflowOwnership);
  const workflows = business.workflowOwnership.filter(
    (workflow) =>
      workflow.departmentId === departmentId ||
      workflow.departmentName === panel.title ||
      workflow.positionId === panel.ownerPositionId
  );
  const officeId = `office-department-workspace-${business.id}-${departmentId}`;
  const roadblocks = departmentRoadblocks(panel, business, approvals);
  const approvalTasks = departmentApprovalTasks(panel, approvals);
  const recentActivity = auditTrailForDepartment(business, departmentId);
  const recentTasks = taskTrailForDepartment(business, departmentId);
  const status = executionStatus(business, roadblocks, approvalTasks);
  const workers = departmentWorkers({
    business,
    officeId,
    departmentId,
    departmentTitle: panel.title,
    panel,
    workflows,
    status
  });
  const executionItems = departmentExecutionItems({
    business,
    departmentId,
    departmentTitle: panel.title,
    workflows,
    roadblocks,
    approvalTasks,
    recentActivity,
    recentTasks,
    status
  });
  const profileSpec = getOfficeTemplateProfileSpec(templateProfile);
  const metrics = uniqueStrings([
    ...panel.metrics,
    `Workers: ${workers.length}`,
    `Approvals: ${approvalTasks.length}`
  ]);

  const breadcrumbs: OfficeBreadcrumb[] = [
    {
      id: `breadcrumb-engine-${snapshot.engineId}`,
      scope: "engine",
      title: snapshot.engineName,
      route: "/engine"
    },
    {
      id: `breadcrumb-business-${business.id}`,
      scope: "business",
      title: business.name,
      route: businessRoute(business.id)
    },
    {
      id: `breadcrumb-department-${business.id}-${departmentId}`,
      scope: "department",
      title: panel.title,
      route: departmentRoute(business.id, departmentId)
    }
  ];

  return {
    id: officeId,
    engineId: snapshot.engineId,
    businessId: business.id,
    departmentId,
    generatedAt: business.office?.generatedAt ?? snapshot.generatedAt,
    title: `${panel.title} Department Workspace`,
    summary: `Department dashboard for ${panel.title.toLowerCase()} execution inside ${business.name}.`,
    templateProfile,
    breadcrumbs,
    workers,
    executionItems,
    approvalTasks,
    roadblocks,
    alerts: [...roadblocks],
    metrics,
    widgetSections: [...profileSpec.departmentWidgetSections],
    recentActivity
  };
}

function businessOfficeWorkers(
  business: LegacyBusinessView,
  officeId: string,
  departmentWorkspaces: DepartmentWorkspaceView[]
): OfficeWorkerSummary[] {
  const brandWorker: OfficeWorkerSummary = {
    id: `worker-brand-${business.id}-orchestrator`,
    officeId,
    businessId: business.id,
    positionId:
      business.office?.departments.find((panel) => panel.subtitle === "executive_management")
        ?.ownerPositionId ??
      business.workflowOwnership[0]?.positionId,
    label: `${business.name} Orchestrator`,
    title: "Brand Office",
    workerType: "brand_orchestrator",
    route: businessRoute(business.id),
    status: business.stage,
    summary: `Coordinates approvals and department routing for ${business.name}.`,
    metrics: [
      `Automation: ${Math.round(business.automationCoverage * 100)}%`,
      `Departments: ${departmentWorkspaces.length}`,
      `Approvals: ${business.approvals.length}`
    ],
    toolTags: uniqueStrings(business.workflowOwnership.flatMap((workflow) => workflow.allowedTools))
  };

  const departmentOrchestrators = departmentWorkspaces.map<OfficeWorkerSummary>((workspace) => ({
    id: `worker-business-${business.id}-${workspace.departmentId}`,
    officeId,
    businessId: business.id,
    departmentId: workspace.departmentId,
    positionId: workspace.workers[0]?.positionId,
    label: `${workspaceTitle(workspace)} Orchestrator`,
    title: "Department Office",
    workerType: "department_orchestrator",
    route: departmentRoute(business.id, workspace.departmentId),
    status:
      workspace.roadblocks.length > 0
        ? "blocked"
        : workspace.approvalTasks.length > 0
          ? "review"
          : "active",
    summary: workspace.summary,
    metrics: [...workspace.metrics.slice(0, 3)],
    toolTags: uniqueStrings(workspace.workers.flatMap((worker) => worker.toolTags))
  }));

  return [brandWorker, ...departmentOrchestrators];
}

function businessHandoffs(
  business: LegacyBusinessView,
  office: LegacyBusinessOfficeView,
  approvals: ApprovalTask[],
  roadblocks: string[],
  departmentWorkspaces: DepartmentWorkspaceView[]
): OfficeHandoffRecord[] {
  return departmentWorkspaces.map((workspace) => ({
    id: `handoff-business-${business.id}-${workspace.departmentId}`,
    scope: "business",
    businessId: business.id,
    departmentId: workspace.departmentId,
    sourceOfficeId: office.id,
    targetOfficeId: workspace.id,
    title: `${business.name} -> ${workspaceTitle(workspace)}`,
    summary: workspace.summary,
    workflowId: workspace.executionItems[0]?.workflowId,
    status:
      business.stage === "deferred"
        ? "queued"
        : workspace.roadblocks.length > 0
        ? "blocked"
        : workspace.approvalTasks.length > 0
          ? "awaiting_approval"
          : business.stage === "active"
            ? "in_progress"
            : "queued",
    roadblocks: [...workspace.roadblocks],
    ownerPositionId: workspace.workers[0]?.positionId,
    ownerLabel: workspace.workers[0]?.label ?? `${workspaceTitle(workspace)} Orchestrator`,
    approvalIds: workspace.approvalTasks.map((approval) => approval.id),
    taskEnvelopeIds: [],
    executionItemIds: workspace.executionItems.map((item) => item.id),
    createdAt: office.generatedAt,
    updatedAt: office.generatedAt
  }));
}

function businessOffice(
  snapshot: LegacyControlRoomSnapshot,
  business: LegacyBusinessView,
  approvals: ApprovalTask[],
  templateProfile: OfficeTemplateProfile,
  departmentWorkspaces: DepartmentWorkspaceView[]
): BusinessOfficeView | undefined {
  if (!business.office) {
    return undefined;
  }

  const roadblocks = businessRoadblocks(business, approvals);
  const breadcrumbs: OfficeBreadcrumb[] = [
    {
      id: `breadcrumb-engine-${snapshot.engineId}`,
      scope: "engine",
      title: snapshot.engineName,
      route: "/engine"
    },
    {
      id: `breadcrumb-business-${business.id}`,
      scope: "business",
      title: business.name,
      route: businessRoute(business.id)
    }
  ];
  const workers = businessOfficeWorkers(business, business.office.id, departmentWorkspaces);
  const handoffs = businessHandoffs(
    business,
    business.office,
    approvals,
    roadblocks,
    departmentWorkspaces
  );

  return {
    id: business.office.id,
    engineId: business.office.engineId,
    businessId: business.office.businessId,
    generatedAt: business.office.generatedAt,
    title: business.office.title,
    summary: business.office.summary,
    templateProfile,
    breadcrumbs,
    departments: business.office.departments,
    workers,
    handoffs,
    approvalTasks: approvals,
    roadblocks,
    alerts: [...business.office.alerts]
  };
}

function upgradeBusiness(
  snapshot: LegacyControlRoomSnapshot,
  business: LegacyBusinessView
): ControlRoomBusinessView {
  const templateProfile = businessTemplateProfile(business.category);
  const approvals = businessApprovals(snapshot, business);
  const departmentWorkspaces =
    business.office?.departments.map((panel) =>
      departmentWorkspace(snapshot, business, panel, approvals, templateProfile)
    ) ?? [];
  const office = businessOffice(
    snapshot,
    {
      ...business,
      approvals
    },
    approvals,
    templateProfile,
    departmentWorkspaces
  );

  return {
    ...business,
    templateProfile,
    office,
    departmentWorkspaces,
    approvals
  };
}

function executiveWorkers(
  snapshot: LegacyControlRoomSnapshot,
  businesses: ControlRoomBusinessView[],
  approvals: ApprovalTask[]
): OfficeWorkerSummary[] {
  const engineWorker: OfficeWorkerSummary = {
    id: `worker-engine-${snapshot.engineId}-orchestrator`,
    officeId: snapshot.executiveView.id,
    label: "Imon Engine Orchestrator",
    title: snapshot.executiveView.title,
    workerType: "engine_orchestrator",
    route: "/engine",
    status: makeHealth(snapshot).status === "ready" ? "active" : "degraded",
    summary: "Coordinates portfolio approvals, business routing, and consolidated execution visibility.",
    metrics: [
      `Businesses: ${businesses.length}`,
      `Approvals: ${approvals.length}`,
      `Concurrency: ${snapshot.report?.recommendedConcurrency ?? 0}`
    ],
    toolTags: ["org-control-plane", "approvals", "runtime-ops"]
  };

  const brandWorkers = businesses.flatMap((business) =>
    business.office?.workers.filter((worker) => worker.workerType === "brand_orchestrator") ?? []
  );

  return [engineWorker, ...brandWorkers];
}

function executiveHandoffs(
  snapshot: LegacyControlRoomSnapshot,
  businesses: ControlRoomBusinessView[]
): OfficeHandoffRecord[] {
  return businesses.map((business) => ({
    id: `handoff-engine-${business.id}`,
    scope: "engine",
    businessId: business.id,
    sourceOfficeId: snapshot.executiveView.id,
    targetOfficeId: business.office?.id ?? `office-business-${business.id}`,
    title: `${snapshot.engineName} -> ${business.name}`,
    summary: business.summary,
    status:
      business.stage === "deferred"
        ? "queued"
        : business.office?.roadblocks.length
        ? "blocked"
        : business.approvals.length
          ? "awaiting_approval"
          : business.stage === "active"
            ? "in_progress"
            : "queued",
    roadblocks: [...business.office?.roadblocks ?? []],
    ownerPositionId: business.office?.workers[0]?.positionId,
    ownerLabel: business.office?.workers[0]?.label ?? `${business.name} Orchestrator`,
    approvalIds: business.approvals.map((approval) => approval.id),
    taskEnvelopeIds: business.recentTasks.map((task) => task.id),
    executionItemIds: business.departmentWorkspaces.flatMap((workspace) =>
      workspace.executionItems.map((item) => item.id)
    ),
    createdAt: snapshot.executiveView.generatedAt,
    updatedAt: snapshot.executiveView.generatedAt
  }));
}

function executiveView(
  snapshot: LegacyControlRoomSnapshot,
  businesses: ControlRoomBusinessView[],
  approvals: ApprovalTask[]
): ExecutiveOfficeView {
  const deferredBusinessNames = new Set(
    businesses
      .filter((business) => business.stage === "deferred")
      .map((business) => business.name)
  );
  const roadblocks = uniqueStrings([
    ...snapshot.executiveView.alerts.filter(
      (alert) =>
        ![...deferredBusinessNames].some((name) => alert.startsWith(`${name}:`))
    ),
    ...(snapshot.globalWarnings ?? []).filter(
      (warning) =>
        ![...deferredBusinessNames].some((name) => warning.startsWith(`${name}:`))
    )
  ]);
  return {
    ...snapshot.executiveView,
    roadblocks,
    breadcrumbs: [
      {
        id: `breadcrumb-engine-${snapshot.engineId}`,
        scope: "engine",
        title: snapshot.engineName,
        route: "/engine"
      }
    ],
    workers: executiveWorkers(snapshot, businesses, approvals),
    handoffs: executiveHandoffs(snapshot, businesses),
    approvalTasks: approvals
  };
}

function officeTree(
  snapshot: LegacyControlRoomSnapshot,
  executiveOffice: ExecutiveOfficeView,
  businesses: ControlRoomBusinessView[]
): OfficeTreeNode {
  return {
    id: `office-tree-engine-${snapshot.engineId}`,
    scope: "engine",
    title: snapshot.engineName,
    subtitle: "System dashboard",
    route: "/engine",
    status: makeHealth(snapshot).status,
    officeId: executiveOffice.id,
    counts: {
      approvals: executiveOffice.approvalTasks.length,
      handoffs: executiveOffice.handoffs.length,
      blockers: executiveOffice.roadblocks.length,
      executions: businesses.flatMap((business) => business.departmentWorkspaces).flatMap((workspace) => workspace.executionItems).length
    },
    children: businesses.map((business) => {
      const templateProfile = business.templateProfile ?? businessTemplateProfile(business.category);
      return {
        id: `office-tree-business-${business.id}`,
        scope: "business",
        title: business.name,
        subtitle: `${templateProfile.replaceAll("_", " ")} | ${business.stage}`,
        route: businessRoute(business.id),
        status:
          business.stage === "deferred"
            ? "deferred"
            : business.office?.roadblocks.length
              ? "blocked"
              : business.stage,
        parentId: `office-tree-engine-${snapshot.engineId}`,
        officeId: business.office?.id ?? `office-business-${business.id}`,
        businessId: business.id,
        counts: {
          approvals: business.office?.approvalTasks.length ?? business.approvals.length,
          handoffs: business.office?.handoffs.length ?? 0,
          blockers: business.office?.roadblocks.length ?? 0,
          executions: business.departmentWorkspaces.flatMap((workspace) => workspace.executionItems)
            .length
        },
        children: business.departmentWorkspaces.map((workspace) => ({
          id: `office-tree-department-${business.id}-${workspace.departmentId}`,
          scope: "department",
          title: workspaceTitle(workspace),
          subtitle: workspace.templateProfile.replaceAll("_", " "),
          route: departmentRoute(workspace.businessId, workspace.departmentId),
          status:
            workspace.roadblocks.length > 0
              ? "blocked"
              : workspace.approvalTasks.length > 0
                ? "review"
                : "active",
          parentId: `office-tree-business-${business.id}`,
          officeId: workspace.id,
          businessId: workspace.businessId,
          departmentId: workspace.departmentId,
          counts: {
            approvals: workspace.approvalTasks.length,
            handoffs: 0,
            blockers: workspace.roadblocks.length,
            executions: workspace.executionItems.length
          },
          children: []
        }))
      } satisfies OfficeTreeNode;
    })
  };
}

export function normalizeControlRoomSnapshot(
  snapshot: ControlRoomSnapshot | LegacyControlRoomSnapshot
): ControlRoomSnapshot {
  if (modernSnapshot(snapshot)) {
    return snapshot;
  }

  const deferredBusinessIds = new Set(
    snapshot.businesses
      .filter((business) => business.stage === "deferred")
      .map((business) => business.id)
  );
  const approvals = snapshot.approvals.filter(
    (approval) =>
      approval.status !== "completed" &&
      !(
        approval.relatedEntityType === "business" &&
        deferredBusinessIds.has(approval.relatedEntityId)
      )
  );
  const businesses = snapshot.businesses.map((business) => upgradeBusiness(snapshot, business));
  const departmentWorkspaces = businesses.flatMap((business) => business.departmentWorkspaces);
  const departmentExecutionItems = departmentWorkspaces.flatMap(
    (workspace) => workspace.executionItems
  );
  const upgradedExecutiveView = executiveView(snapshot, businesses, approvals);
  const upgradedRecentAudits =
    snapshot.recentAudits.length > 0
      ? snapshot.recentAudits
      : businesses.flatMap((business) => business.recentAudits).slice(0, 12);
  const deferredBusinessNames = new Set(
    businesses
      .filter((business) => business.stage === "deferred")
      .map((business) => business.name)
  );

  return {
    ...snapshot,
    officeTree: officeTree(snapshot, upgradedExecutiveView, businesses),
    executiveView: upgradedExecutiveView,
    approvals,
    businesses,
    departmentWorkspaces,
    departmentExecutionItems,
    recentAudits: upgradedRecentAudits,
    globalWarnings:
      snapshot.globalWarnings.length > 0
        ? snapshot.globalWarnings.filter(
            (warning) =>
              ![...deferredBusinessNames].some((name) => warning.startsWith(`${name}:`))
          )
        : [...upgradedExecutiveView.roadblocks],
    health: makeHealth(snapshot)
  };
}
