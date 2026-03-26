import path from "node:path";
import type { AppConfig } from "../config.js";
import type { ApprovalTask } from "../domain/contracts.js";
import type { BusinessCategory, ImonEngineState, ManagedBusiness } from "../domain/engine.js";
import type {
  ApprovalActionClass,
  ApprovalRoute,
  ApprovalRiskLevel,
  BusinessOfficeView,
  DepartmentDefinition,
  DepartmentOfficeView,
  ExecutiveOfficeView,
  MemoryNamespacePolicy,
  OfficePanelSummary,
  OfficeViewSnapshot,
  OrganizationBlueprint,
  OrgScope,
  PermissionPolicy,
  PositionAssignment,
  PositionDefinition,
  ReportingLine,
  TaskEnvelope,
  TaskRoutingRequest,
  WorkflowOwnershipRecord,
  OrgAuditRecord
} from "../domain/org.js";
import { ensureDir, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { FileStore } from "../storage/store.js";
import {
  buildBusinessOrgTemplate,
  buildEngineOrgTemplate,
  summarizeOrgTemplate,
  type OrgTemplateSpec
} from "./org-templates.js";

function nowIso(): string {
  return new Date().toISOString();
}

function uniqueStrings<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function namespacePath(parts: string[]): string {
  return parts.filter(Boolean).join("/");
}

type BlueprintBundle = {
  blueprint: OrganizationBlueprint;
  departments: DepartmentDefinition[];
  positions: PositionDefinition[];
  assignments: PositionAssignment[];
  reportingLines: ReportingLine[];
  permissionPolicies: PermissionPolicy[];
  memoryPolicies: MemoryNamespacePolicy[];
  approvalRoutes: ApprovalRoute[];
  workflowOwnership: WorkflowOwnershipRecord[];
};

export interface OrganizationSyncResult {
  engineBlueprint: OrganizationBlueprint;
  businessBlueprints: OrganizationBlueprint[];
  officeSnapshot: OfficeViewSnapshot;
  artifactPaths: {
    controlPlaneJsonPath: string;
    controlPlaneMarkdownPath: string;
    officeViewsJsonPath: string;
    officeViewsMarkdownPath: string;
    blueprintDirPath: string;
  };
}

export interface RoutedTaskResult {
  envelope: TaskEnvelope;
  owner?: WorkflowOwnershipRecord;
  approvalRoute: ApprovalRoute;
}

export class OrganizationControlPlaneService {
  private readonly blueprintDir: string;

  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {
    this.blueprintDir = path.join(this.config.opsDir, "org-blueprints");
  }

  async sync(
    engine: ImonEngineState,
    businesses: ManagedBusiness[]
  ): Promise<OrganizationSyncResult> {
    const approvals = await this.store.getApprovals();
    const engineBundle = this.instantiateBlueprint({
      scope: "engine",
      engine,
      name: engine.name,
      summary: engine.overview,
      template: buildEngineOrgTemplate()
    });
    const businessBundles = businesses.map((business) =>
      this.instantiateBlueprint({
        scope: "business",
        engine,
        business,
        name: business.name,
        summary: business.summary,
        template: buildBusinessOrgTemplate(business.category)
      })
    );

    await this.store.replaceOrganizationBlueprints([
      engineBundle.blueprint,
      ...businessBundles.map((bundle) => bundle.blueprint)
    ]);
    await this.store.replaceDepartmentDefinitions([
      ...engineBundle.departments,
      ...businessBundles.flatMap((bundle) => bundle.departments)
    ]);
    await this.store.replacePositionDefinitions([
      ...engineBundle.positions,
      ...businessBundles.flatMap((bundle) => bundle.positions)
    ]);
    await this.store.replacePositionAssignments([
      ...engineBundle.assignments,
      ...businessBundles.flatMap((bundle) => bundle.assignments)
    ]);
    await this.store.replaceReportingLines([
      ...engineBundle.reportingLines,
      ...businessBundles.flatMap((bundle) => bundle.reportingLines)
    ]);
    await this.store.replacePermissionPolicies([
      ...engineBundle.permissionPolicies,
      ...businessBundles.flatMap((bundle) => bundle.permissionPolicies)
    ]);
    await this.store.replaceMemoryNamespacePolicies([
      ...engineBundle.memoryPolicies,
      ...businessBundles.flatMap((bundle) => bundle.memoryPolicies)
    ]);
    await this.store.replaceApprovalRoutes([
      ...engineBundle.approvalRoutes,
      ...businessBundles.flatMap((bundle) => bundle.approvalRoutes)
    ]);
    await this.store.replaceWorkflowOwnership([
      ...engineBundle.workflowOwnership,
      ...businessBundles.flatMap((bundle) => bundle.workflowOwnership)
    ]);

    const officeSnapshot = this.buildOfficeSnapshot({
      engine,
      businesses,
      approvals,
      engineBundle,
      businessBundles
    });
    await this.store.saveOfficeViewSnapshot(officeSnapshot);
    const artifactPaths = await this.writeArtifacts({
      engine,
      businesses,
      approvals,
      engineBundle,
      businessBundles,
      officeSnapshot
    });

    await this.store.saveOrgAuditRecord({
      id: `org-audit-sync-${new Date().toISOString().replaceAll(":", "-")}`,
      engineId: engine.id,
      eventType: "sync",
      severity: "info",
      summary: "Synchronized the organization control plane.",
      details: [
        `Engine blueprint: ${engineBundle.blueprint.id}`,
        `Business blueprints: ${businessBundles.length}`,
        `Office snapshot: ${officeSnapshot.id}`
      ],
      createdAt: nowIso()
    });

    return {
      engineBlueprint: engineBundle.blueprint,
      businessBlueprints: businessBundles.map((bundle) => bundle.blueprint),
      officeSnapshot,
      artifactPaths
    };
  }

  async routeTask(request: TaskRoutingRequest): Promise<RoutedTaskResult> {
    const engine = await this.store.getEngineState();
    if (!engine) {
      throw new Error("ImonEngine state is not initialized.");
    }

    const workflowOwnership = await this.store.getWorkflowOwnership();
    const owner =
      (request.workflowId
        ? workflowOwnership.find(
            (record) =>
              record.workflowId === request.workflowId && record.businessId === request.businessId
          ) ??
          workflowOwnership.find(
            (record) => record.workflowId === request.workflowId && !record.businessId
          )
        : undefined) ??
      workflowOwnership.find(
        (record) =>
          record.businessId === request.businessId &&
          record.departmentId === request.departmentId &&
          record.positionId === request.positionId
      );

    if (!owner && !request.positionId) {
      throw new Error("Task routing requires a workflow owner or an explicit position id.");
    }

    const positions = await this.store.getPositionDefinitions();
    const departments = await this.store.getDepartmentDefinitions();
    const permissionPolicies = await this.store.getPermissionPolicies();
    const memoryPolicies = await this.store.getMemoryNamespacePolicies();
    const approvalRoutes = await this.store.getApprovalRoutes();

    const position =
      positions.find((candidate) => candidate.id === request.positionId) ??
      positions.find((candidate) => candidate.id === owner?.positionId);
    if (!position) {
      throw new Error("Could not resolve a position for the requested task.");
    }

    const department =
      departments.find((candidate) => candidate.id === request.departmentId) ??
      departments.find((candidate) => candidate.id === position.departmentId);
    if (!department) {
      throw new Error("Could not resolve a department for the requested task.");
    }

    const permissionPolicy = permissionPolicies.find(
      (candidate) => candidate.id === position.permissionPolicyId
    );
    if (!permissionPolicy) {
      throw new Error(`Permission policy ${position.permissionPolicyId} was not found.`);
    }

    const memoryPolicy = memoryPolicies.find(
      (candidate) => candidate.positionId === position.id
    );
    if (!memoryPolicy) {
      throw new Error(`Memory policy for ${position.title} was not found.`);
    }

    const riskLevel = request.riskLevel ?? this.defaultRiskLevelFor(position, owner);
    const actionClasses = uniqueStrings(request.actionClasses ?? this.defaultActionClassesFor(position));
    const approvalRoute = this.selectApprovalRoute(approvalRoutes, {
      businessId: position.businessId,
      blueprintId: position.blueprintId,
      riskLevel,
      actionClasses
    });

    const requestedTools = request.requestedTools ?? owner?.allowedTools ?? permissionPolicy.allowedTools;
    const allowedTools = requestedTools.filter(
      (tool) =>
        permissionPolicy.allowedTools.includes(tool) &&
        !permissionPolicy.deniedTools.includes(tool)
    );

    const envelope: TaskEnvelope = {
      id: `task-${slugify(`${request.title}-${new Date().toISOString()}`)}`,
      title: request.title,
      summary: request.summary,
      scope: "task",
      workflowId: request.workflowId ?? owner?.workflowId,
      engineId: engine.id,
      businessId: position.businessId ?? request.businessId,
      departmentId: department.id,
      positionId: position.id,
      allowedTools,
      allowedMemoryNamespaces: uniqueStrings([
        memoryPolicy.primaryNamespace,
        ...memoryPolicy.readableNamespaces,
        ...memoryPolicy.writableNamespaces
      ]),
      approvalRouteId: approvalRoute.id,
      riskLevel,
      actionClasses,
      publicFacing: request.publicFacing ?? position.publicFacing,
      moneyMovement: request.moneyMovement ?? position.handlesMoney,
      requiresVerifiedFinancialData:
        request.requiresVerifiedFinancialData ?? permissionPolicy.requiresVerifiedFinancialData,
      escalationTargetPositionId: owner?.escalationTargetPositionId,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    await this.store.saveTaskEnvelope(envelope);
    await this.store.saveOrgAuditRecord({
      id: `org-audit-route-${new Date().toISOString().replaceAll(":", "-")}`,
      engineId: engine.id,
      businessId: envelope.businessId,
      departmentId: envelope.departmentId,
      positionId: envelope.positionId,
      workflowId: envelope.workflowId,
      taskEnvelopeId: envelope.id,
      eventType: "route",
      severity: "info",
      summary: `Routed task ${envelope.title}.`,
      details: [
        `Workflow: ${envelope.workflowId ?? "manual"}`,
        `Department: ${department.name}`,
        `Position: ${position.title}`,
        `Approval route: ${approvalRoute.id}`
      ],
      createdAt: nowIso()
    });

    return {
      envelope,
      owner,
      approvalRoute
    };
  }

  async getLatestOfficeSnapshot(): Promise<OfficeViewSnapshot | undefined> {
    const snapshots = await this.store.getOfficeViewSnapshots();
    return [...snapshots].sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0];
  }

  private instantiateBlueprint(args: {
    scope: "engine" | "business";
    engine: ImonEngineState;
    business?: ManagedBusiness;
    name: string;
    summary: string;
    template: OrgTemplateSpec;
  }): BlueprintBundle {
    const timestamp = nowIso();
    const blueprintId =
      args.scope === "engine"
        ? `org-engine-${args.engine.id}`
        : `org-business-${args.business!.id}`;
    const approvalRoutes: ApprovalRoute[] = args.template.approvalRoutes.map((route) => ({
      id: `${blueprintId}-approval-${route.key}`,
      blueprintId,
      scope: args.scope,
      businessId: args.business?.id,
      riskLevel: route.riskLevel,
      actionClasses: [...route.actionClasses],
      autoApproveWhen: [...route.autoApproveWhen],
      escalationChain: [...route.escalationTitles],
      notes: [...route.notes]
    }));

    const departmentEntries = args.template.departments.map((department) => {
      const departmentId = `${blueprintId}-department-${department.kind}`;
      const departmentMemoryId = `${departmentId}-memory`;
      const departmentMemory: MemoryNamespacePolicy = {
        id: departmentMemoryId,
        blueprintId,
        scope: "department",
        businessId: args.business?.id,
        departmentId,
        primaryNamespace:
          args.scope === "engine"
            ? namespacePath(["engine", args.engine.id, department.kind])
            : namespacePath(["business", args.business!.id, department.kind]),
        readableNamespaces: [
          args.scope === "engine"
            ? namespacePath(["engine", args.engine.id])
            : namespacePath(["business", args.business!.id])
        ],
        writableNamespaces: [
          args.scope === "engine"
            ? namespacePath(["engine", args.engine.id, department.kind])
            : namespacePath(["business", args.business!.id, department.kind])
        ],
        allowCrossBusinessAccess: args.scope === "engine",
        temporaryNamespacePattern:
          args.scope === "engine"
            ? namespacePath(["engine", args.engine.id, department.kind, "tasks", "*"])
            : namespacePath(["business", args.business!.id, department.kind, "tasks", "*"]),
        notes: ["Department namespaces are isolated by business by default."]
      };
      return {
        departmentId,
        memoryPolicy: departmentMemory,
        definition: {
          id: departmentId,
          blueprintId,
          scope: args.scope,
          businessId: args.business?.id,
          name: department.name,
          kind: department.kind,
          purpose: department.purpose,
          kpis: [...department.kpis],
          workflowIds: [...department.workflowIds],
          toolTags: [...department.toolTags],
          memoryNamespaceIds: [departmentMemoryId],
          positionIds: [],
          createdAt: timestamp,
          updatedAt: timestamp
        } as DepartmentDefinition
      };
    });

    const positions: PositionDefinition[] = [];
    const assignments: PositionAssignment[] = [];
    const reportingLines: ReportingLine[] = [];
    const permissionPolicies: PermissionPolicy[] = [];
    const memoryPolicies: MemoryNamespacePolicy[] = departmentEntries.map((entry) => entry.memoryPolicy);
    const workflowOwnership: WorkflowOwnershipRecord[] = [];
    const positionIdsByTitle = new Map<string, string>();

    for (const templatePosition of args.template.positions) {
      const departmentEntry = departmentEntries.find(
        (entry) => entry.definition.kind === templatePosition.departmentKind
      );
      if (!departmentEntry) {
        continue;
      }

      const positionId = `${blueprintId}-position-${slugify(templatePosition.title)}`;
      const permissionPolicyId = `${positionId}-permissions`;
      const memoryPolicyId = `${positionId}-memory`;
      const positionWorkflowOwnership = args.template.workflowOwnership.filter(
        (record) => record.positionTitle === templatePosition.title
      );
      const permissionPolicy: PermissionPolicy = {
        id: permissionPolicyId,
        blueprintId,
        scope: "position",
        businessId: args.business?.id,
        departmentId: departmentEntry.definition.id,
        positionId,
        allowedTools: uniqueStrings([
          ...templatePosition.toolTags,
          ...positionWorkflowOwnership.flatMap((record) => record.allowedTools)
        ]),
        deniedTools: uniqueStrings([
          ...(templatePosition.publicFacing ? [] : ["public_post"]),
          ...(templatePosition.handlesMoney ? [] : ["money_movement"])
        ]),
        allowedSystems:
          args.scope === "engine"
            ? ["engine", "portfolio", "org-control-plane"]
            : ["business", args.business!.id, "org-control-plane"],
        allowCrossBusinessRead: args.scope === "engine",
        allowCrossBusinessWrite: false,
        canPublicPost: templatePosition.publicFacing,
        canSpendMoney: templatePosition.handlesMoney,
        canApproveExternalChanges:
          templatePosition.publicFacing ||
          templatePosition.title.includes("Director") ||
          templatePosition.title.includes("Manager"),
        requiresVerifiedFinancialData:
          templatePosition.handlesMoney || templatePosition.departmentKind === "finance",
        notes: ["Least-privilege defaults apply; cross-business write access stays off by default."]
      };
      const memoryPolicy: MemoryNamespacePolicy = {
        id: memoryPolicyId,
        blueprintId,
        scope: "position",
        businessId: args.business?.id,
        departmentId: departmentEntry.definition.id,
        positionId,
        primaryNamespace:
          args.scope === "engine"
            ? namespacePath(["engine", args.engine.id, departmentEntry.definition.kind, slugify(templatePosition.title)])
            : namespacePath([
                "business",
                args.business!.id,
                departmentEntry.definition.kind,
                slugify(templatePosition.title)
              ]),
        readableNamespaces: uniqueStrings([
          departmentEntry.memoryPolicy.primaryNamespace,
          ...(args.scope === "engine"
            ? [namespacePath(["engine", args.engine.id])]
            : [namespacePath(["business", args.business!.id])])
        ]),
        writableNamespaces: [
          args.scope === "engine"
            ? namespacePath(["engine", args.engine.id, departmentEntry.definition.kind, slugify(templatePosition.title)])
            : namespacePath([
                "business",
                args.business!.id,
                departmentEntry.definition.kind,
                slugify(templatePosition.title)
              ])
        ],
        allowCrossBusinessAccess: args.scope === "engine",
        temporaryNamespacePattern:
          args.scope === "engine"
            ? namespacePath([
                "engine",
                args.engine.id,
                departmentEntry.definition.kind,
                slugify(templatePosition.title),
                "tasks",
                "*"
              ])
            : namespacePath([
                "business",
                args.business!.id,
                departmentEntry.definition.kind,
                slugify(templatePosition.title),
                "tasks",
                "*"
              ]),
        notes: ["Position memory is nested under its department namespace."]
      };

      const position: PositionDefinition = {
        id: positionId,
        blueprintId,
        scope: args.scope,
        businessId: args.business?.id,
        departmentId: departmentEntry.definition.id,
        title: templatePosition.title,
        mission: templatePosition.mission,
        assignmentMode: templatePosition.assignmentMode,
        modelPolicy: {
          defaultTier: templatePosition.defaultTier,
          escalationTargetTier: templatePosition.escalationTargetTier,
          escalationTriggers: [...templatePosition.escalationTriggers]
        },
        permissionPolicyId,
        approvalRouteIds: approvalRoutes.map((route) => route.id),
        memoryNamespaceIds: [memoryPolicyId],
        authorityLimits: [...templatePosition.authorityLimits],
        decisionRights: [...templatePosition.decisionRights],
        kpis: [...templatePosition.kpis],
        toolTags: [...templatePosition.toolTags],
        publicFacing: templatePosition.publicFacing,
        handlesMoney: templatePosition.handlesMoney,
        createdAt: timestamp,
        updatedAt: timestamp
      };

      positions.push(position);
      assignments.push({
        id: `${positionId}-assignment`,
        blueprintId,
        positionId,
        mode: templatePosition.assignmentMode,
        assigneeLabel:
          templatePosition.assignmentMode === "ai"
            ? "Imon AI owner"
            : templatePosition.assignmentMode === "human"
              ? "Owner oversight"
              : "Imon AI with owner oversight",
        state: "active",
        notes: ["Positions are operating responsibilities, not simulated employees."],
        createdAt: timestamp,
        updatedAt: timestamp
      });
      permissionPolicies.push(permissionPolicy);
      memoryPolicies.push(memoryPolicy);
      positionIdsByTitle.set(templatePosition.title, positionId);
      departmentEntry.definition.positionIds.push(positionId);
    }

    for (const position of positions) {
      const reportTarget = this.reportsToTitleFor(args.scope, position.title);
      if (!reportTarget) {
        continue;
      }
      const reportsToPositionId = positionIdsByTitle.get(reportTarget);
      if (!reportsToPositionId) {
        continue;
      }
      position.reportsToPositionId = reportsToPositionId;
      reportingLines.push({
        id: `${position.id}-reports-to-${reportsToPositionId}`,
        blueprintId,
        fromPositionId: position.id,
        toPositionId: reportsToPositionId,
        relationship: "manager"
      });
    }

    for (const workflow of args.template.workflowOwnership) {
      const positionId = positionIdsByTitle.get(workflow.positionTitle);
      const department = departmentEntries.find(
        (entry) => entry.definition.kind === workflow.departmentKind
      )?.definition;
      if (!positionId || !department) {
        continue;
      }
      workflowOwnership.push({
        id: `${blueprintId}-workflow-${workflow.workflowId}`,
        workflowId: workflow.workflowId,
        workflowName: workflow.workflowName,
        scope: args.scope,
        businessId: args.business?.id,
        departmentId: department.id,
        departmentName: department.name,
        positionId,
        positionName: workflow.positionTitle,
        allowedModelTier: workflow.allowedModelTier,
        allowedTools: [...workflow.allowedTools],
        escalationTargetPositionId: workflow.escalationTargetTitle
          ? positionIdsByTitle.get(workflow.escalationTargetTitle)
          : undefined,
        escalationTargetLabel: workflow.escalationTargetTitle,
        successMetric: workflow.successMetric,
        notes: [...workflow.notes],
        updatedAt: timestamp
      });
    }

    const budgetOwners = positions
      .filter((position) => position.handlesMoney)
      .map((position) => position.id);
    const blueprint: OrganizationBlueprint = {
      id: blueprintId,
      scope: args.scope,
      engineId: args.engine.id,
      businessId: args.business?.id,
      businessCategory: args.scope === "engine" ? "engine" : args.business?.category,
      name: args.name,
      summary: args.template.summary || args.summary,
      departmentIds: departmentEntries.map((entry) => entry.definition.id),
      positionIds: positions.map((position) => position.id),
      approvalRouteIds: approvalRoutes.map((route) => route.id),
      memoryNamespaceIds: memoryPolicies.map((policy) => policy.id),
      permissionPolicyIds: permissionPolicies.map((policy) => policy.id),
      workflowIds: workflowOwnership.map((record) => record.workflowId),
      reportingLineIds: reportingLines.map((line) => line.id),
      budgetOwners,
      kpiOwners: positions.map((position) => position.id),
      officeViews: {
        executiveViewId:
          args.scope === "engine" ? `office-executive-${args.engine.id}` : undefined,
        businessViewId:
          args.scope === "business" ? `office-business-${args.business!.id}` : undefined,
        departmentViewIds: departmentEntries.map((entry) => `office-department-${entry.definition.id}`)
      },
      createdAt: timestamp,
      updatedAt: timestamp
    };

    for (const departmentEntry of departmentEntries) {
      const budgetOwner = positions.find(
        (position) =>
          position.departmentId === departmentEntry.definition.id &&
          (position.title === "Finance Lead" ||
            position.title === "Chief Financial Officer / Controller" ||
            position.title === "General Manager / Brand Director")
      );
      departmentEntry.definition.budgetOwnerPositionId = budgetOwner?.id;
    }

    return {
      blueprint,
      departments: departmentEntries.map((entry) => entry.definition),
      positions,
      assignments,
      reportingLines,
      permissionPolicies,
      memoryPolicies,
      approvalRoutes,
      workflowOwnership
    };
  }

  private reportsToTitleFor(scope: "engine" | "business", title: string): string | undefined {
    if (scope === "engine") {
      return title === "Chief Executive / Portfolio Director"
        ? undefined
        : "Chief Executive / Portfolio Director";
    }

    return title === "General Manager / Brand Director"
      ? undefined
      : "General Manager / Brand Director";
  }

  private defaultRiskLevelFor(
    position: PositionDefinition,
    owner?: WorkflowOwnershipRecord
  ): ApprovalRiskLevel {
    if (position.handlesMoney) {
      return "high";
    }
    if (position.publicFacing || owner?.workflowId === "growth-publishing") {
      return "medium";
    }
    return "low";
  }

  private defaultActionClassesFor(position: PositionDefinition): ApprovalActionClass[] {
    const actionClasses: ApprovalActionClass[] = ["internal"];
    if (position.publicFacing) {
      actionClasses.push("public_post");
    }
    if (position.handlesMoney) {
      actionClasses.push("financial");
    }
    if (position.title.includes("Support") || position.title.includes("Community")) {
      actionClasses.push("customer_facing");
    }
    if (position.title.includes("Risk") || position.title.includes("Compliance")) {
      actionClasses.push("compliance");
    }
    return uniqueStrings(actionClasses);
  }

  private selectApprovalRoute(
    routes: ApprovalRoute[],
    args: {
      blueprintId: string;
      businessId?: string;
      riskLevel: ApprovalRiskLevel;
      actionClasses: ApprovalActionClass[];
    }
  ): ApprovalRoute {
    const scoped = routes.filter(
      (route) =>
        route.blueprintId === args.blueprintId &&
        route.businessId === args.businessId &&
        route.riskLevel === args.riskLevel
    );
    const matched =
      scoped.find((route) =>
        args.actionClasses.every((actionClass) => route.actionClasses.includes(actionClass))
      ) ?? scoped[0];
    if (!matched) {
      throw new Error(`No approval route matched risk level ${args.riskLevel}.`);
    }
    return matched;
  }

  private buildOfficeSnapshot(args: {
    engine: ImonEngineState;
    businesses: ManagedBusiness[];
    approvals: ApprovalTask[];
    engineBundle: BlueprintBundle;
    businessBundles: BlueprintBundle[];
  }): OfficeViewSnapshot {
    const generatedAt = nowIso();
    const businessPanels: OfficePanelSummary[] = args.businesses.map((business) => ({
      id: `office-panel-business-${business.id}`,
      title: business.name,
      subtitle: business.stage,
      status:
        business.launchBlockers.length > 0
          ? "blocked"
          : business.stage === "active"
            ? "active"
            : business.stage,
      ownerPositionId: args.businessBundles.find((bundle) => bundle.blueprint.businessId === business.id)?.positions.find(
        (position) => position.title === "General Manager / Brand Director"
      )?.id,
      metrics: [
        `Revenue: $${business.metrics.currentMonthlyRevenue.toFixed(2)}`,
        `Costs: $${business.metrics.currentMonthlyCosts.toFixed(2)}`,
        `Automation: ${Math.round(business.metrics.automationCoverage * 100)}%`
      ],
      alertCount: business.launchBlockers.length
    }));

    const executiveView: ExecutiveOfficeView = {
      id: `office-executive-${args.engine.id}`,
      engineId: args.engine.id,
      generatedAt,
      title: `${args.engine.name} Executive Office`,
      summary: "Portfolio control-room view backed by the real organization registry.",
      businesses: businessPanels,
      alerts: args.businesses
        .filter((business) => business.launchBlockers.length > 0)
        .map((business) => `${business.name}: ${business.launchBlockers.join(" ")}`),
      approvalsWaiting: args.approvals.filter((approval) => approval.status !== "completed").length
    };

    const businessViews: BusinessOfficeView[] = args.businessBundles.map((bundle) => {
      const business = args.businesses.find((candidate) => candidate.id === bundle.blueprint.businessId)!;
      return {
        id: `office-business-${business.id}`,
        engineId: args.engine.id,
        businessId: business.id,
        generatedAt,
        title: `${business.name} Business Office`,
        summary: bundle.blueprint.summary,
        departments: bundle.departments.map((department) =>
          this.departmentPanelSummary(bundle, department, business.launchBlockers)
        ),
        alerts: business.launchBlockers
      };
    });

    const departmentViews: DepartmentOfficeView[] = [
      ...this.buildDepartmentViews(args.engine.id, args.engineBundle, generatedAt),
      ...args.businessBundles.flatMap((bundle) =>
        this.buildDepartmentViews(args.engine.id, bundle, generatedAt)
      )
    ];

    return {
      id: `office-snapshot-${generatedAt.replaceAll(":", "-")}`,
      generatedAt,
      engineId: args.engine.id,
      executiveView,
      businessViews,
      departmentViews
    };
  }

  private buildDepartmentViews(
    engineId: string,
    bundle: BlueprintBundle,
    generatedAt: string
  ): DepartmentOfficeView[] {
    return bundle.departments.map((department) => ({
      id: `office-department-${department.id}`,
      engineId,
      businessId: bundle.blueprint.businessId,
      departmentId: department.id,
      generatedAt,
      title: `${department.name} Office`,
      summary: department.purpose,
      positions: bundle.positions
        .filter((position) => position.departmentId === department.id)
        .map((position) => ({
          id: `office-panel-position-${position.id}`,
          title: position.title,
          subtitle: position.modelPolicy.defaultTier,
          status: position.publicFacing ? "public-capable" : "internal",
          ownerPositionId: position.id,
          metrics: [
            `Assignment: ${position.assignmentMode}`,
            `Money: ${position.handlesMoney ? "yes" : "no"}`,
            `KPIs: ${position.kpis.length}`
          ],
          alertCount: 0
        })),
      alerts: []
    }));
  }

  private departmentPanelSummary(
    bundle: BlueprintBundle,
    department: DepartmentDefinition,
    launchBlockers: string[]
  ): OfficePanelSummary {
    const positions = bundle.positions.filter((position) => position.departmentId === department.id);
    return {
      id: `office-panel-department-${department.id}`,
      title: department.name,
      subtitle: department.kind,
      status: launchBlockers.length > 0 ? "attention-needed" : "ready",
      ownerPositionId: department.budgetOwnerPositionId ?? positions[0]?.id,
      metrics: [
        `Positions: ${positions.length}`,
        `Workflows: ${department.workflowIds.length}`,
        `KPIs: ${department.kpis.length}`
      ],
      alertCount: launchBlockers.length
    };
  }

  private async writeArtifacts(args: {
    engine: ImonEngineState;
    businesses: ManagedBusiness[];
    approvals: ApprovalTask[];
    engineBundle: BlueprintBundle;
    businessBundles: BlueprintBundle[];
    officeSnapshot: OfficeViewSnapshot;
  }): Promise<{
    controlPlaneJsonPath: string;
    controlPlaneMarkdownPath: string;
    officeViewsJsonPath: string;
    officeViewsMarkdownPath: string;
    blueprintDirPath: string;
  }> {
    await ensureDir(this.blueprintDir);
    const controlPlaneJsonPath = path.join(this.config.opsDir, "org-control-plane.json");
    const controlPlaneMarkdownPath = path.join(this.config.opsDir, "org-control-plane.md");
    const officeViewsJsonPath = path.join(this.config.opsDir, "office-views.json");
    const officeViewsMarkdownPath = path.join(this.config.opsDir, "office-views.md");

    const payload = {
      generatedAt: nowIso(),
      engine: args.engine,
      businesses: args.businesses,
      approvalsWaiting: args.approvals.filter((approval) => approval.status !== "completed").length,
      blueprints: [args.engineBundle.blueprint, ...args.businessBundles.map((bundle) => bundle.blueprint)],
      workflowOwnership: [
        ...args.engineBundle.workflowOwnership,
        ...args.businessBundles.flatMap((bundle) => bundle.workflowOwnership)
      ]
    };

    await writeJsonFile(controlPlaneJsonPath, payload);
    await writeTextFile(controlPlaneMarkdownPath, this.toControlPlaneMarkdown(args));
    await writeJsonFile(officeViewsJsonPath, args.officeSnapshot);
    await writeTextFile(officeViewsMarkdownPath, this.toOfficeViewsMarkdown(args.officeSnapshot));

    await Promise.all(
      [args.engineBundle, ...args.businessBundles].flatMap((bundle) => [
        writeJsonFile(path.join(this.blueprintDir, `${bundle.blueprint.id}.json`), {
          blueprint: bundle.blueprint,
          departments: bundle.departments,
          positions: bundle.positions,
          assignments: bundle.assignments,
          reportingLines: bundle.reportingLines,
          permissionPolicies: bundle.permissionPolicies,
          memoryPolicies: bundle.memoryPolicies,
          approvalRoutes: bundle.approvalRoutes,
          workflowOwnership: bundle.workflowOwnership
        }),
        writeTextFile(
          path.join(this.blueprintDir, `${bundle.blueprint.id}.md`),
          this.toBlueprintMarkdown(bundle)
        )
      ])
    );

    return {
      controlPlaneJsonPath,
      controlPlaneMarkdownPath,
      officeViewsJsonPath,
      officeViewsMarkdownPath,
      blueprintDirPath: this.blueprintDir
    };
  }

  private toControlPlaneMarkdown(args: {
    engine: ImonEngineState;
    approvals: ApprovalTask[];
    engineBundle: BlueprintBundle;
    businessBundles: BlueprintBundle[];
  }): string {
    return [
      "# Organization Control Plane",
      "",
      `Generated at: ${nowIso()}`,
      `Approvals waiting: ${args.approvals.filter((approval) => approval.status !== "completed").length}`,
      "",
      "## Engine Blueprint",
      `- ${args.engineBundle.blueprint.name}: ${args.engineBundle.blueprint.summary}`,
      ...args.engineBundle.workflowOwnership.map(
        (record) => `- Workflow owner: ${record.workflowName} -> ${record.departmentName} / ${record.positionName}`
      ),
      "",
      "## Business Blueprints",
      ...args.businessBundles.flatMap((bundle) => [
        `### ${bundle.blueprint.name}`,
        `- Blueprint: ${bundle.blueprint.id}`,
        `- Departments: ${bundle.departments.length}`,
        `- Positions: ${bundle.positions.length}`,
        `- Workflow ownership: ${bundle.workflowOwnership.length}`,
        ...bundle.workflowOwnership.map(
          (record) => `- ${record.workflowName}: ${record.departmentName} / ${record.positionName}`
        ),
        ""
      ])
    ].join("\n");
  }

  private toOfficeViewsMarkdown(snapshot: OfficeViewSnapshot): string {
    return [
      "# Office Views",
      "",
      `Generated at: ${snapshot.generatedAt}`,
      "",
      "## Executive Office",
      `- ${snapshot.executiveView.title}`,
      `- Approvals waiting: ${snapshot.executiveView.approvalsWaiting}`,
      ...snapshot.executiveView.businesses.map(
        (panel) => `- ${panel.title}: ${panel.status} (${panel.metrics.join("; ")})`
      ),
      "",
      "## Business Offices",
      ...snapshot.businessViews.flatMap((view) => [
        `### ${view.title}`,
        ...view.departments.map(
          (panel) => `- ${panel.title}: ${panel.status} (${panel.metrics.join("; ")})`
        ),
        ...(view.alerts.length > 0 ? view.alerts.map((alert) => `- Alert: ${alert}`) : ["- Alert: none"]),
        ""
      ])
    ].join("\n");
  }

  private toBlueprintMarkdown(bundle: BlueprintBundle): string {
    const summary = summarizeOrgTemplate({
      summary: bundle.blueprint.summary,
      departments: bundle.departments.map((department) => ({
        kind: department.kind,
        name: department.name,
        purpose: department.purpose,
        kpis: department.kpis,
        toolTags: department.toolTags,
        workflowIds: department.workflowIds
      })),
      positions: bundle.positions.map((position) => ({
        title: position.title,
        departmentKind: bundle.departments.find(
          (department) => department.id === position.departmentId
        )!.kind,
        mission: position.mission,
        assignmentMode: position.assignmentMode,
        defaultTier: position.modelPolicy.defaultTier,
        escalationTargetTier: position.modelPolicy.escalationTargetTier,
        escalationTriggers: position.modelPolicy.escalationTriggers,
        authorityLimits: position.authorityLimits,
        decisionRights: position.decisionRights,
        kpis: position.kpis,
        toolTags: position.toolTags,
        publicFacing: position.publicFacing,
        handlesMoney: position.handlesMoney,
        workflowIds: []
      })),
      approvalRoutes: bundle.approvalRoutes.map((route) => ({
        key:
          route.riskLevel === "low" ? "low" : route.riskLevel === "medium" ? "medium" : "high",
        riskLevel: route.riskLevel,
        actionClasses: route.actionClasses,
        autoApproveWhen: route.autoApproveWhen,
        escalationTitles: route.escalationChain,
        notes: route.notes
      })),
      workflowOwnership: bundle.workflowOwnership.map((record) => ({
        workflowId: record.workflowId,
        workflowName: record.workflowName,
        departmentKind: bundle.departments.find((department) => department.id === record.departmentId)!.kind,
        positionTitle: record.positionName,
        allowedModelTier: record.allowedModelTier,
        allowedTools: record.allowedTools,
        escalationTargetTitle: record.escalationTargetLabel,
        successMetric: record.successMetric,
        notes: record.notes
      }))
    });

    return [
      `# ${bundle.blueprint.name}`,
      "",
      `- Blueprint id: ${bundle.blueprint.id}`,
      `- Scope: ${bundle.blueprint.scope}`,
      `- Summary: ${bundle.blueprint.summary}`,
      "",
      "## Departments",
      ...summary.departments.flatMap((department) => [
        `### ${department.name}`,
        `- Kind: ${department.kind}`,
        `- Purpose: ${department.purpose}`,
        ...department.positionTitles.map((title) => `- Position: ${title}`),
        ""
      ]),
      "## Workflow Ownership",
      ...summary.workflowOwnership.map(
        (record) =>
          `- ${record.workflowName}: ${record.departmentKind} / ${record.positionTitle} (${record.allowedModelTier})`
      ),
      "",
      "## Approval Model",
      ...summary.approvalModel.map((line) => `- ${line}`),
      "",
      "## Memory Namespaces",
      ...bundle.memoryPolicies.map(
        (policy) =>
          `- ${policy.primaryNamespace} (read: ${policy.readableNamespaces.join(", ") || "none"}; write: ${policy.writableNamespaces.join(", ") || "none"})`
      ),
      "",
      "## Tool Access",
      ...bundle.permissionPolicies.map(
        (policy) =>
          `- ${policy.positionId}: allow [${policy.allowedTools.join(", ")}] deny [${policy.deniedTools.join(", ")}]`
      ),
      ""
    ].join("\n");
  }
}
