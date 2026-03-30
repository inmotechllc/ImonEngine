import path from "node:path";
import type { AppConfig } from "../config.js";
import type { ApprovalTask } from "../domain/contracts.js";
import type { AssetPackRecord } from "../domain/digital-assets.js";
import type { BusinessCategory, ImonEngineState, ManagedBusiness } from "../domain/engine.js";
import type {
  ApprovalActionClass,
  ApprovalRoute,
  ApprovalRiskLevel,
  BusinessOfficeView,
  DepartmentExecutionItem,
  DepartmentDefinition,
  DepartmentOfficeView,
  DepartmentWorkspaceView,
  ExecutiveOfficeView,
  MemoryNamespacePolicy,
  OfficeBreadcrumb,
  OfficeHandoffRecord,
  OfficePanelSummary,
  OfficeTemplateProfile,
  OfficeTreeNode,
  OfficeWorkerSummary,
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
import type { GrowthWorkItem, RevenueAllocationSnapshot } from "../domain/store-ops.js";
import { ensureDir, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { FileStore } from "../storage/store.js";
import {
  getOfficeTemplateProfileSpec,
  officeTemplateProfileForCategory
} from "./office-templates.js";
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

type BusinessOfficeContext = {
  business: ManagedBusiness;
  bundle: BlueprintBundle;
  templateProfile: OfficeTemplateProfile;
};

function isDeferredBusiness(business: ManagedBusiness): boolean {
  return business.stage === "deferred";
}

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
    const [approvals, taskEnvelopes, auditRecords, assetPacks, growthQueue, allocationSnapshots] =
      await Promise.all([
        this.store.getApprovals(),
        this.store.getTaskEnvelopes(),
        this.store.getOrgAuditRecords(),
        this.store.getAssetPacks(),
        this.store.getGrowthQueue(),
        this.store.getAllocationSnapshots()
      ]);
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

    const departmentExecutionItems = this.buildDepartmentExecutionItems({
      businesses,
      businessBundles,
      approvals,
      taskEnvelopes,
      auditRecords,
      assetPacks,
      growthQueue,
      allocationSnapshots
    });
    await this.store.replaceDepartmentExecutionItems(departmentExecutionItems);

    const officeHandoffs = this.buildOfficeHandoffs({
      engine,
      businesses,
      businessBundles,
      approvals,
      taskEnvelopes,
      departmentExecutionItems
    });
    await this.store.replaceOfficeHandoffs(officeHandoffs);

    const officeSnapshot = this.buildOfficeSnapshot({
      engine,
      businesses,
      approvals,
      taskEnvelopes,
      auditRecords,
      engineBundle,
      businessBundles,
      officeHandoffs,
      departmentExecutionItems
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
    taskEnvelopes: TaskEnvelope[];
    auditRecords: OrgAuditRecord[];
    engineBundle: BlueprintBundle;
    businessBundles: BlueprintBundle[];
    officeHandoffs: OfficeHandoffRecord[];
    departmentExecutionItems: DepartmentExecutionItem[];
  }): OfficeViewSnapshot {
    const generatedAt = nowIso();
    const businessContexts: BusinessOfficeContext[] = args.businessBundles
      .map((bundle) => {
        const business = args.businesses.find(
          (candidate) => candidate.id === bundle.blueprint.businessId
        );
        if (!business) {
          return undefined;
        }
        return {
          business,
          bundle,
          templateProfile: officeTemplateProfileForCategory(business.category)
        };
      })
      .filter((context): context is BusinessOfficeContext => Boolean(context));

    const businessOfficeData = businessContexts.map((context) =>
      this.buildBusinessOfficeData({
        engine: args.engine,
        context,
        generatedAt,
        approvals: args.approvals,
        auditRecords: args.auditRecords,
        officeHandoffs: args.officeHandoffs,
        departmentExecutionItems: args.departmentExecutionItems
      })
    );
    const businessPanels: OfficePanelSummary[] = businessOfficeData.map(
      ({ context, businessView }) => ({
        id: `office-panel-business-${context.business.id}`,
        title: context.business.name,
        subtitle: context.business.stage,
        status: this.businessOfficeStatus(context.business, businessView.handoffs),
        ownerPositionId: this.businessOrchestratorPosition(context.bundle)?.id,
        metrics: [
          `Revenue: $${context.business.metrics.currentMonthlyRevenue.toFixed(2)}`,
          `Automation: ${Math.round(context.business.metrics.automationCoverage * 100)}%`,
          `Handoffs: ${businessView.handoffs.length}`
        ],
        alertCount:
          context.business.launchBlockers.length + businessView.approvalTasks.length
      })
    );
    const openApprovals = args.approvals.filter(
      (approval) =>
        approval.status !== "completed" &&
        !(
          approval.relatedEntityType === "business" &&
          args.businesses.some(
            (business) =>
              business.id === approval.relatedEntityId && isDeferredBusiness(business)
          )
        )
    );
    const executiveView: ExecutiveOfficeView = {
      id: `office-executive-${args.engine.id}`,
      engineId: args.engine.id,
      generatedAt,
      title: `${args.engine.name} Executive Office`,
      summary:
        "Portfolio office explorer backed by the organization control plane and routed handoffs.",
      businesses: businessPanels,
      alerts: args.businesses
        .filter((business) => !isDeferredBusiness(business) && business.launchBlockers.length > 0)
        .map((business) => `${business.name}: ${business.launchBlockers.join(" ")}`),
      roadblocks: args.businesses
        .filter((business) => !isDeferredBusiness(business) && business.launchBlockers.length > 0)
        .map((business) => `${business.name}: ${business.launchBlockers.join(" ")}`),
      breadcrumbs: this.engineBreadcrumbs(args.engine),
      workers: this.buildExecutiveWorkers({
        engine: args.engine,
        engineBundle: args.engineBundle,
        businessOfficeData
      }),
      handoffs: args.officeHandoffs.filter((record) => record.scope === "engine"),
      approvalTasks: openApprovals,
      approvalsWaiting: openApprovals.length
    };
    const businessViews = businessOfficeData.map((data) => data.businessView);
    const departmentViews = businessOfficeData.flatMap((data) => data.departmentViews);
    const departmentWorkspaces = businessOfficeData.flatMap(
      (data) => data.departmentWorkspaces
    );

    return {
      id: `office-snapshot-${generatedAt.replaceAll(":", "-")}`,
      generatedAt,
      engineId: args.engine.id,
      officeTree: this.buildOfficeTree({
        engine: args.engine,
        businesses: args.businesses,
        executiveView,
        businessViews,
        departmentWorkspaces
      }),
      executiveView,
      businessViews,
      departmentViews,
      departmentWorkspaces
    };
  }

  private buildBusinessOfficeData(args: {
    engine: ImonEngineState;
    context: BusinessOfficeContext;
    generatedAt: string;
    approvals: ApprovalTask[];
    auditRecords: OrgAuditRecord[];
    officeHandoffs: OfficeHandoffRecord[];
    departmentExecutionItems: DepartmentExecutionItem[];
  }): {
    context: BusinessOfficeContext;
    businessView: BusinessOfficeView;
    departmentViews: DepartmentOfficeView[];
    departmentWorkspaces: DepartmentWorkspaceView[];
  } {
    const { context } = args;
    const { business, bundle, templateProfile } = context;
    const approvalTasks = this.openApprovalsForBusiness(args.approvals, business);
    const departmentWorkspaces = bundle.departments.map((department) =>
      this.buildDepartmentWorkspace({
        engine: args.engine,
        business,
        bundle,
        department,
        templateProfile,
        generatedAt: args.generatedAt,
        approvals: approvalTasks,
        auditRecords: args.auditRecords,
        departmentExecutionItems: args.departmentExecutionItems
      })
    );
    const departmentViews = departmentWorkspaces.map((workspace) =>
      this.toDepartmentOfficeView({
        business,
        bundle,
        workspace
      })
    );
    const handoffs = args.officeHandoffs.filter(
      (record) => record.scope === "business" && record.businessId === business.id
    );

    return {
      context,
      businessView: {
        id: `office-business-${business.id}`,
        engineId: args.engine.id,
        businessId: business.id,
        generatedAt: args.generatedAt,
        title: `${business.name} Business Office`,
        summary: bundle.blueprint.summary,
        templateProfile,
        breadcrumbs: this.businessBreadcrumbs(args.engine, business),
        departments: bundle.departments.map((department) =>
          this.departmentPanelSummary(
            bundle,
            department,
            business.launchBlockers,
            args.departmentExecutionItems.filter(
              (item) => item.businessId === business.id && item.departmentId === department.id
            )
          )
        ),
        workers: this.buildBusinessWorkers({
          business,
          bundle,
          templateProfile,
          approvalCount: approvalTasks.length,
          handoffCount: handoffs.length,
          departmentWorkspaces
        }),
        handoffs,
        approvalTasks,
        roadblocks: [...business.launchBlockers],
        alerts: uniqueStrings([
          ...business.launchBlockers,
          ...handoffs
            .filter((record) => ["blocked", "awaiting_approval"].includes(record.status))
            .map((record) => `${record.title}: ${record.status.replaceAll("_", " ")}`)
        ])
      },
      departmentViews,
      departmentWorkspaces
    };
  }

  private buildDepartmentWorkspace(args: {
    engine: ImonEngineState;
    business: ManagedBusiness;
    bundle: BlueprintBundle;
    department: DepartmentDefinition;
    templateProfile: OfficeTemplateProfile;
    generatedAt: string;
    approvals: ApprovalTask[];
    auditRecords: OrgAuditRecord[];
    departmentExecutionItems: DepartmentExecutionItem[];
  }): DepartmentWorkspaceView {
    const executionItems = args.departmentExecutionItems
      .filter(
        (item) =>
          item.businessId === args.business.id && item.departmentId === args.department.id
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const recentActivity = args.auditRecords
      .filter(
        (record) =>
          record.businessId === args.business.id && record.departmentId === args.department.id
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 8);
    const roadblocks = uniqueStrings([
      ...args.business.launchBlockers,
      ...executionItems.flatMap((item) => item.blockers)
    ]);
    const orchestrator = this.buildDepartmentOrchestratorWorker({
      business: args.business,
      bundle: args.bundle,
      department: args.department,
      templateProfile: args.templateProfile,
      executionItems,
      roadblocks,
      approvalCount: args.approvals.length
    });
    const workers = [
      orchestrator,
      ...executionItems.map((item) =>
        this.executionWorkerSummary({
          business: args.business,
          department: args.department,
          item
        })
      )
    ];

    return {
      id: `office-department-${args.department.id}`,
      engineId: args.engine.id,
      businessId: args.business.id,
      departmentId: args.department.id,
      generatedAt: args.generatedAt,
      title: `${args.department.name} Department Workspace`,
      summary: args.department.purpose,
      templateProfile: args.templateProfile,
      breadcrumbs: this.departmentBreadcrumbs(args.engine, args.business, args.department),
      workers,
      executionItems,
      approvalTasks: [...args.approvals],
      roadblocks,
      alerts: uniqueStrings([
        ...roadblocks,
        ...executionItems
          .filter((item) => item.status === "review")
          .map((item) => `${item.title}: ready for review`)
      ]),
      metrics: [
        `Execution items: ${executionItems.length}`,
        `Workers: ${workers.length}`,
        `KPIs: ${args.department.kpis.length}`
      ],
      widgetSections: this.widgetSectionsForDepartment(
        args.templateProfile,
        args.department.kind
      ),
      recentActivity
    };
  }

  private toDepartmentOfficeView(args: {
    business: ManagedBusiness;
    bundle: BlueprintBundle;
    workspace: DepartmentWorkspaceView;
  }): DepartmentOfficeView {
    const department = args.bundle.departments.find(
      (candidate) => candidate.id === args.workspace.departmentId
    )!;
    return {
      id: args.workspace.id,
      engineId: args.workspace.engineId,
      businessId: args.business.id,
      departmentId: department.id,
      generatedAt: args.workspace.generatedAt,
      title: `${department.name} Office`,
      summary: department.purpose,
      templateProfile: args.workspace.templateProfile,
      breadcrumbs: args.workspace.breadcrumbs,
      positions: args.bundle.positions
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
      workers: args.workspace.workers,
      roadblocks: args.workspace.roadblocks,
      alerts: args.workspace.alerts
    };
  }

  private buildDepartmentExecutionItems(args: {
    businesses: ManagedBusiness[];
    businessBundles: BlueprintBundle[];
    approvals: ApprovalTask[];
    taskEnvelopes: TaskEnvelope[];
    auditRecords: OrgAuditRecord[];
    assetPacks: AssetPackRecord[];
    growthQueue: GrowthWorkItem[];
    allocationSnapshots: RevenueAllocationSnapshot[];
  }): DepartmentExecutionItem[] {
    const items: DepartmentExecutionItem[] = [];
    const openApprovals = args.approvals.filter((approval) => approval.status !== "completed");

    for (const business of args.businesses) {
      const bundle = args.businessBundles.find(
        (candidate) => candidate.blueprint.businessId === business.id
      );
      if (!bundle) {
        continue;
      }

      for (const department of bundle.departments) {
        const departmentTasks = args.taskEnvelopes.filter(
          (task) =>
            task.businessId === business.id && task.departmentId === department.id
        );
        const departmentAudits = args.auditRecords.filter(
          (record) =>
            record.businessId === business.id && record.departmentId === department.id
        );
        const workflowOwners = bundle.workflowOwnership.filter(
          (record) => record.departmentId === department.id
        );

        for (const workflowOwner of workflowOwners) {
          const relatedTasks = departmentTasks.filter(
            (task) => task.workflowId === workflowOwner.workflowId
          );
          const businessApprovals = openApprovals.filter(
            (approval) => approval.relatedEntityId === business.id
          );
          const blockers = uniqueStrings([
            ...business.launchBlockers,
            ...businessApprovals.map((approval) => approval.reason)
          ]);
          items.push({
            id: `execution-${business.id}-${department.id}-${workflowOwner.workflowId}`,
            businessId: business.id,
            departmentId: department.id,
            workflowId: workflowOwner.workflowId,
            title: workflowOwner.workflowName,
            summary: workflowOwner.successMetric,
            status: this.executionStatusForWorkflow({
              business,
              blockers,
              approvalCount: businessApprovals.length,
              taskCount: relatedTasks.length
            }),
            assignedWorkerId: `worker-task-agent-${department.id}-${workflowOwner.workflowId}`,
            assignedWorkerLabel: workflowOwner.positionName,
            blockers,
            artifacts: this.executionArtifactsForWorkflow({
              business,
              workflowOwner,
              assetPacks: args.assetPacks,
              growthQueue: args.growthQueue,
              allocationSnapshots: args.allocationSnapshots
            }),
            metrics: [
              `Tasks: ${relatedTasks.length}`,
              `Approvals: ${businessApprovals.length}`,
              `Model tier: ${workflowOwner.allowedModelTier}`
            ],
            approvalIds: businessApprovals.map((approval) => approval.id),
            auditRecordIds: departmentAudits.slice(0, 4).map((record) => record.id),
            createdAt: workflowOwner.updatedAt,
            updatedAt: workflowOwner.updatedAt
          });
        }

        for (const task of departmentTasks
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .slice(0, 3)) {
          const relatedAudits = departmentAudits.filter(
            (record) => record.taskEnvelopeId === task.id
          );
          const blockers = uniqueStrings([
            ...business.launchBlockers,
            ...(task.publicFacing || task.moneyMovement
              ? ["Task is waiting for office review before public or money-sensitive action."]
              : [])
          ]);
          items.push({
            id: `execution-task-${task.id}`,
            businessId: business.id,
            departmentId: department.id,
            workflowId: task.workflowId,
            taskEnvelopeId: task.id,
            title: task.title,
            summary: task.summary,
            status: this.executionStatusForTask(task, blockers),
            assignedWorkerId: `worker-sub-agent-${task.id}`,
            assignedWorkerLabel: task.positionId,
            blockers,
            artifacts: [
              `Workflow: ${task.workflowId ?? "manual"}`,
              `Primary memory: ${task.allowedMemoryNamespaces[0] ?? "n/a"}`
            ],
            metrics: [
              `Risk: ${task.riskLevel}`,
              `Tools: ${task.allowedTools.length}`,
              `Actions: ${task.actionClasses.length}`
            ],
            approvalIds: [],
            auditRecordIds: relatedAudits.map((record) => record.id),
            createdAt: task.createdAt,
            updatedAt: task.updatedAt
          });
        }
      }
    }

    return items;
  }

  private buildOfficeHandoffs(args: {
    engine: ImonEngineState;
    businesses: ManagedBusiness[];
    businessBundles: BlueprintBundle[];
    approvals: ApprovalTask[];
    taskEnvelopes: TaskEnvelope[];
    departmentExecutionItems: DepartmentExecutionItem[];
  }): OfficeHandoffRecord[] {
    const records: OfficeHandoffRecord[] = [];
    const openApprovals = args.approvals.filter((approval) => approval.status !== "completed");

    for (const business of args.businesses) {
      const bundle = args.businessBundles.find(
        (candidate) => candidate.blueprint.businessId === business.id
      );
      if (!bundle) {
        continue;
      }

      const businessApprovals = openApprovals.filter(
        (approval) => approval.relatedEntityId === business.id
      );
      const businessTasks = args.taskEnvelopes.filter(
        (task) => task.businessId === business.id
      );
      const businessExecutionItems = args.departmentExecutionItems.filter(
        (item) => item.businessId === business.id
      );

      records.push({
        id: `handoff-engine-${business.id}`,
        scope: "engine",
        businessId: business.id,
        sourceOfficeId: `office-executive-${args.engine.id}`,
        targetOfficeId: `office-business-${business.id}`,
        title: `Route work into ${business.name}`,
        summary: `${business.metrics.activeWorkItems} active work item(s) and ${businessExecutionItems.length} execution lane(s) are currently owned by ${business.name}.`,
        workflowId: "business-governance",
        status: this.handoffStatus({
          stage: business.stage,
          blockers: business.launchBlockers,
          approvalCount: businessApprovals.length,
          executionItems: businessExecutionItems
        }),
        roadblocks: [...business.launchBlockers],
        ownerPositionId: this.businessOrchestratorPosition(bundle)?.id,
        ownerLabel: this.businessOrchestratorPosition(bundle)?.title ?? business.name,
        approvalIds: businessApprovals.map((approval) => approval.id),
        taskEnvelopeIds: businessTasks.slice(0, 4).map((task) => task.id),
        executionItemIds: businessExecutionItems.slice(0, 8).map((item) => item.id),
        createdAt: nowIso(),
        updatedAt: nowIso()
      });

      for (const department of bundle.departments) {
        const departmentExecutionItems = businessExecutionItems.filter(
          (item) => item.departmentId === department.id
        );
        const departmentTasks = businessTasks.filter(
          (task) => task.departmentId === department.id
        );
        const roadblocks = uniqueStrings([
          ...business.launchBlockers,
          ...departmentExecutionItems.flatMap((item) => item.blockers)
        ]);
        records.push({
          id: `handoff-business-${business.id}-${department.id}`,
          scope: "business",
          businessId: business.id,
          departmentId: department.id,
          sourceOfficeId: `office-business-${business.id}`,
          targetOfficeId: `office-department-${department.id}`,
          title: `Hand off to ${department.name}`,
          summary: `${departmentExecutionItems.length} execution lane(s) are active inside ${department.name}.`,
          workflowId: department.workflowIds[0],
          status: this.handoffStatus({
            stage: business.stage,
            blockers: roadblocks,
            approvalCount: businessApprovals.length,
            executionItems: departmentExecutionItems
          }),
          roadblocks,
          ownerPositionId: this.departmentOrchestratorPosition(bundle, department)?.id,
          ownerLabel:
            this.departmentOrchestratorPosition(bundle, department)?.title ??
            department.name,
          approvalIds: businessApprovals.map((approval) => approval.id),
          taskEnvelopeIds: departmentTasks.slice(0, 4).map((task) => task.id),
          executionItemIds: departmentExecutionItems.map((item) => item.id),
          createdAt: nowIso(),
          updatedAt: nowIso()
        });
      }
    }

    return records;
  }

  private buildExecutiveWorkers(args: {
    engine: ImonEngineState;
    engineBundle: BlueprintBundle;
    businessOfficeData: Array<{
      context: BusinessOfficeContext;
      businessView: BusinessOfficeView;
    }>;
  }): OfficeWorkerSummary[] {
    const enginePosition =
      args.engineBundle.positions.find(
        (position) => position.title === "Chief Operating Officer / Chief of Staff"
      ) ??
      args.engineBundle.positions.find(
        (position) => position.title === "Chief Executive / Portfolio Director"
      ) ??
      args.engineBundle.positions[0];
    const workers: OfficeWorkerSummary[] = [];

    if (enginePosition) {
      workers.push({
        id: `worker-engine-orchestrator-${args.engine.id}`,
        officeId: `office-executive-${args.engine.id}`,
        positionId: enginePosition.id,
        label: getOfficeTemplateProfileSpec("catalog_store").workerLabels.engine_orchestrator,
        title: enginePosition.title,
        workerType: "engine_orchestrator",
        route: this.engineRoute(),
        status:
          args.businessOfficeData.some(({ context }) => context.business.stage === "active")
            ? "active"
            : "ready",
        summary: enginePosition.mission,
        metrics: [
          `Businesses: ${args.businessOfficeData.length}`,
          `Approvals: ${args.businessOfficeData.reduce(
            (sum, entry) => sum + entry.businessView.approvalTasks.length,
            0
          )}`,
          `Handoffs: ${args.businessOfficeData.length}`
        ],
        toolTags: enginePosition.toolTags
      });
    }

    for (const { context, businessView } of args.businessOfficeData) {
      const position = this.businessOrchestratorPosition(context.bundle);
      workers.push({
        id: `worker-brand-orchestrator-${context.business.id}`,
        officeId: `office-executive-${args.engine.id}`,
        businessId: context.business.id,
        positionId: position?.id,
        label: getOfficeTemplateProfileSpec(context.templateProfile).workerLabels.brand_orchestrator,
        title: context.business.name,
        workerType: "brand_orchestrator",
        route: this.businessRoute(context.business.id),
        status: this.businessOfficeStatus(context.business, businessView.handoffs),
        summary: position?.mission ?? context.business.summary,
        metrics: [
          `Departments: ${businessView.departments.length}`,
          `Approvals: ${businessView.approvalTasks.length}`,
          `Handoffs: ${businessView.handoffs.length}`
        ],
        toolTags: position?.toolTags ?? []
      });
    }

    return workers;
  }

  private buildBusinessWorkers(args: {
    business: ManagedBusiness;
    bundle: BlueprintBundle;
    templateProfile: OfficeTemplateProfile;
    approvalCount: number;
    handoffCount: number;
    departmentWorkspaces: DepartmentWorkspaceView[];
  }): OfficeWorkerSummary[] {
    const spec = getOfficeTemplateProfileSpec(args.templateProfile);
    const brandOrchestrator = this.businessOrchestratorPosition(args.bundle);
    const workers: OfficeWorkerSummary[] = [];

    if (brandOrchestrator) {
      workers.push({
        id: `worker-brand-office-${args.business.id}`,
        officeId: `office-business-${args.business.id}`,
        businessId: args.business.id,
        positionId: brandOrchestrator.id,
        label: spec.workerLabels.brand_orchestrator,
        title: brandOrchestrator.title,
        workerType: "brand_orchestrator",
        route: this.businessRoute(args.business.id),
        status: this.businessOfficeStatus(args.business, []),
        summary: brandOrchestrator.mission,
        metrics: [
          `Departments: ${args.bundle.departments.length}`,
          `Approvals: ${args.approvalCount}`,
          `Handoffs: ${args.handoffCount}`
        ],
        toolTags: brandOrchestrator.toolTags
      });
    }

    for (const workspace of args.departmentWorkspaces) {
      const worker = workspace.workers.find(
        (candidate) => candidate.workerType === "department_orchestrator"
      );
      if (worker) {
        workers.push({
          ...worker,
          officeId: `office-business-${args.business.id}`
        });
      }
    }

    return workers;
  }

  private buildDepartmentOrchestratorWorker(args: {
    business: ManagedBusiness;
    bundle: BlueprintBundle;
    department: DepartmentDefinition;
    templateProfile: OfficeTemplateProfile;
    executionItems: DepartmentExecutionItem[];
    roadblocks: string[];
    approvalCount: number;
  }): OfficeWorkerSummary {
    const position = this.departmentOrchestratorPosition(args.bundle, args.department);
    const spec = getOfficeTemplateProfileSpec(args.templateProfile);
    return {
      id: `worker-department-orchestrator-${args.department.id}`,
      officeId: `office-department-${args.department.id}`,
      businessId: args.business.id,
      departmentId: args.department.id,
      positionId: position?.id,
      label: spec.workerLabels.department_orchestrator,
      title: position?.title ?? args.department.name,
      workerType: "department_orchestrator",
      route: this.departmentRoute(args.business.id, args.department.id),
      status: this.departmentWorkspaceStatus(
        args.executionItems,
        args.roadblocks,
        args.approvalCount
      ),
      summary: position?.mission ?? args.department.purpose,
      metrics: [
        `Execution: ${args.executionItems.length}`,
        `Approvals: ${args.approvalCount}`,
        `KPIs: ${args.department.kpis.length}`
      ],
      toolTags: position?.toolTags ?? args.department.toolTags
    };
  }

  private executionWorkerSummary(args: {
    business: ManagedBusiness;
    department: DepartmentDefinition;
    item: DepartmentExecutionItem;
  }): OfficeWorkerSummary {
    const workerType = args.item.taskEnvelopeId ? "sub_agent" : "task_agent";
    return {
      id: args.item.assignedWorkerId,
      officeId: `office-department-${args.department.id}`,
      businessId: args.business.id,
      departmentId: args.department.id,
      label: workerType === "sub_agent" ? "Sub-agent" : "Task Agent",
      title: args.item.title,
      workerType,
      route: this.departmentRoute(args.business.id, args.department.id),
      status: args.item.status,
      summary: args.item.summary,
      metrics: args.item.metrics,
      toolTags: []
    };
  }

  private buildOfficeTree(args: {
    engine: ImonEngineState;
    businesses: ManagedBusiness[];
    executiveView: ExecutiveOfficeView;
    businessViews: BusinessOfficeView[];
    departmentWorkspaces: DepartmentWorkspaceView[];
  }): OfficeTreeNode {
    return {
      id: `office-tree-engine-${args.engine.id}`,
      scope: "engine",
      title: args.engine.name,
      subtitle: "Engine Office",
      route: this.engineRoute(),
      status:
        args.executiveView.roadblocks.length > 0 ||
        args.executiveView.approvalTasks.length > 0
          ? "attention-needed"
          : "active",
      officeId: args.executiveView.id,
      counts: {
        approvals: args.executiveView.approvalTasks.length,
        handoffs: args.executiveView.handoffs.length,
        blockers: args.executiveView.roadblocks.length,
        executions: args.departmentWorkspaces.reduce(
          (sum, workspace) => sum + workspace.executionItems.length,
          0
        )
      },
      children: args.businessViews.map((businessView) => {
        const business = args.businesses.find(
          (candidate) => candidate.id === businessView.businessId
        )!;
        const workspaces = args.departmentWorkspaces.filter(
          (workspace) => workspace.businessId === business.id
        );
        return {
          id: `office-tree-business-${business.id}`,
          scope: "business",
          title: business.name,
          subtitle: `${business.stage} | ${businessView.templateProfile.replaceAll("_", " ")}`,
          route: this.businessRoute(business.id),
          status: this.businessOfficeStatus(business, businessView.handoffs),
          parentId: `office-tree-engine-${args.engine.id}`,
          officeId: businessView.id,
          businessId: business.id,
          counts: {
            approvals: businessView.approvalTasks.length,
            handoffs: businessView.handoffs.length,
            blockers: businessView.roadblocks.length,
            executions: workspaces.reduce(
              (sum, workspace) => sum + workspace.executionItems.length,
              0
            )
          },
          children: workspaces.map((workspace) => ({
            id: `office-tree-department-${workspace.departmentId}`,
            scope: "department",
            title: workspace.title.replace(" Department Workspace", ""),
            subtitle: workspace.templateProfile.replaceAll("_", " "),
            route: this.departmentRoute(workspace.businessId, workspace.departmentId),
            status: this.departmentWorkspaceStatus(
              workspace.executionItems,
              workspace.roadblocks,
              workspace.approvalTasks.length
            ),
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
        };
      })
    };
  }

  private departmentPanelSummary(
    bundle: BlueprintBundle,
    department: DepartmentDefinition,
    launchBlockers: string[],
    executionItems: DepartmentExecutionItem[]
  ): OfficePanelSummary {
    const positions = bundle.positions.filter((position) => position.departmentId === department.id);
    const blockedItems = executionItems.filter((item) => item.status === "blocked").length;
    return {
      id: `office-panel-department-${department.id}`,
      title: department.name,
      subtitle: department.kind,
      status:
        launchBlockers.length > 0 || blockedItems > 0
          ? "attention-needed"
          : executionItems.some((item) => item.status === "running")
            ? "active"
            : "ready",
      ownerPositionId:
        this.departmentOrchestratorPosition(bundle, department)?.id ??
        department.budgetOwnerPositionId ??
        positions[0]?.id,
      metrics: [
        `Positions: ${positions.length}`,
        `Execution: ${executionItems.length}`,
        `Blocked: ${blockedItems}`
      ],
      alertCount: launchBlockers.length + blockedItems
    };
  }

  private openApprovalsForBusiness(
    approvals: ApprovalTask[],
    business: ManagedBusiness
  ): ApprovalTask[] {
    if (isDeferredBusiness(business)) {
      return [];
    }

    return approvals.filter(
      (approval) =>
        approval.status !== "completed" &&
        approval.relatedEntityType === "business" &&
        approval.relatedEntityId === business.id
    );
  }

  private executionStatusForWorkflow(args: {
    business: ManagedBusiness;
    blockers: string[];
    approvalCount: number;
    taskCount: number;
  }): DepartmentExecutionItem["status"] {
    if (args.blockers.length > 0) {
      return "blocked";
    }
    if (args.approvalCount > 0) {
      return "review";
    }
    if (args.taskCount > 0 || args.business.stage === "active") {
      return "running";
    }
    return "queued";
  }

  private executionStatusForTask(
    task: TaskEnvelope,
    blockers: string[]
  ): DepartmentExecutionItem["status"] {
    if (blockers.length > 0) {
      return "blocked";
    }
    if (task.publicFacing || task.moneyMovement || task.riskLevel !== "low") {
      return "review";
    }
    return "running";
  }

  private handoffStatus(args: {
    stage: ManagedBusiness["stage"];
    blockers: string[];
    approvalCount: number;
    executionItems: DepartmentExecutionItem[];
  }): OfficeHandoffRecord["status"] {
    if (args.stage === "deferred") {
      return "queued";
    }
    if (args.blockers.length > 0) {
      return "blocked";
    }
    if (args.approvalCount > 0) {
      return "awaiting_approval";
    }
    if (args.executionItems.some((item) => item.status === "running")) {
      return "in_progress";
    }
    if (args.stage === "active") {
      return "in_progress";
    }
    if (
      args.executionItems.length > 0 &&
      args.executionItems.every((item) => item.status === "done")
    ) {
      return "completed";
    }
    return "queued";
  }

  private businessOfficeStatus(
    business: ManagedBusiness,
    handoffs: OfficeHandoffRecord[]
  ): string {
    if (isDeferredBusiness(business)) {
      return "deferred";
    }
    if (
      business.launchBlockers.length > 0 ||
      handoffs.some((handoff) => handoff.status === "blocked")
    ) {
      return "blocked";
    }
    if (handoffs.some((handoff) => handoff.status === "awaiting_approval")) {
      return "awaiting_approval";
    }
    if (business.stage === "active") {
      return "active";
    }
    return business.stage;
  }

  private departmentWorkspaceStatus(
    executionItems: DepartmentExecutionItem[],
    roadblocks: string[],
    approvalCount: number
  ): string {
    if (roadblocks.length > 0 || executionItems.some((item) => item.status === "blocked")) {
      return "blocked";
    }
    if (approvalCount > 0 || executionItems.some((item) => item.status === "review")) {
      return "review";
    }
    if (executionItems.some((item) => item.status === "running")) {
      return "active";
    }
    if (
      executionItems.length > 0 &&
      executionItems.every((item) => item.status === "done")
    ) {
      return "done";
    }
    return "queued";
  }

  private executionArtifactsForWorkflow(args: {
    business: ManagedBusiness;
    workflowOwner: WorkflowOwnershipRecord;
    assetPacks: AssetPackRecord[];
    growthQueue: GrowthWorkItem[];
    allocationSnapshots: RevenueAllocationSnapshot[];
  }): string[] {
    const defaultArtifacts = [
      `Workflow id: ${args.workflowOwner.workflowId}`,
      `Success metric: ${args.workflowOwner.successMetric}`
    ];

    if (args.workflowOwner.workflowId === "digital-asset-factory") {
      const packs = args.assetPacks
        .filter((pack) => pack.businessId === args.business.id)
        .slice(0, 2);
      return packs.length > 0
        ? packs.map((pack) => `${pack.title}: ${pack.status}`)
        : defaultArtifacts;
    }

    if (args.workflowOwner.workflowId === "store-autopilot") {
      const queueItems = args.growthQueue.filter((item) => item.businessId === args.business.id);
      return [
        `${args.assetPacks.filter((pack) => pack.businessId === args.business.id).length} pack(s) in state`,
        `${queueItems.filter((item) => item.status !== "posted").length} growth item(s) pending`
      ];
    }

    if (args.workflowOwner.workflowId === "growth-publishing") {
      const queueItems = args.growthQueue.filter((item) => item.businessId === args.business.id);
      return [
        `${queueItems.filter((item) => item.status === "planned").length} planned growth item(s)`,
        `${uniqueStrings(queueItems.map((item) => item.channel)).join(", ") || "No channels queued"}`
      ];
    }

    if (args.workflowOwner.workflowId.includes("finance")) {
      const allocation = [...args.allocationSnapshots]
        .filter((snapshot) => snapshot.businessId === args.business.id)
        .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0];
      return allocation
        ? [
            `Allocation snapshot: ${allocation.id}`,
            `Verified net revenue: $${(
              allocation.dataQuality?.verifiedNetRevenue ?? allocation.netRevenue
            ).toFixed(2)}`
          ]
        : defaultArtifacts;
    }

    return defaultArtifacts;
  }

  private engineBreadcrumbs(engine: ImonEngineState): OfficeBreadcrumb[] {
    return [
      {
        id: `crumb-engine-${engine.id}`,
        scope: "engine",
        title: engine.name,
        route: this.engineRoute()
      }
    ];
  }

  private businessBreadcrumbs(
    engine: ImonEngineState,
    business: ManagedBusiness
  ): OfficeBreadcrumb[] {
    return [
      ...this.engineBreadcrumbs(engine),
      {
        id: `crumb-business-${business.id}`,
        scope: "business",
        title: business.name,
        route: this.businessRoute(business.id)
      }
    ];
  }

  private departmentBreadcrumbs(
    engine: ImonEngineState,
    business: ManagedBusiness,
    department: DepartmentDefinition
  ): OfficeBreadcrumb[] {
    return [
      ...this.businessBreadcrumbs(engine, business),
      {
        id: `crumb-department-${department.id}`,
        scope: "department",
        title: department.name,
        route: this.departmentRoute(business.id, department.id)
      }
    ];
  }

  private widgetSectionsForDepartment(
    templateProfile: OfficeTemplateProfile,
    departmentKind: DepartmentDefinition["kind"]
  ): string[] {
    const spec = getOfficeTemplateProfileSpec(templateProfile);
    if (departmentKind === "growth_marketing") {
      return [...spec.departmentWidgetSections, "campaign_queue"];
    }
    if (departmentKind === "finance") {
      return [...spec.departmentWidgetSections, "allocation_policy"];
    }
    if (departmentKind === "analytics_research") {
      return [...spec.departmentWidgetSections, "signal_review"];
    }
    return [...spec.departmentWidgetSections];
  }

  private engineRoute(): string {
    return "/engine";
  }

  private businessRoute(businessId: string): string {
    return `/business/${encodeURIComponent(businessId)}`;
  }

  private departmentRoute(businessId: string, departmentId: string): string {
    return `/department/${encodeURIComponent(businessId)}/${encodeURIComponent(departmentId)}`;
  }

  private businessOrchestratorPosition(bundle: BlueprintBundle): PositionDefinition | undefined {
    return (
      bundle.positions.find((position) => position.title === "General Manager / Brand Director") ??
      bundle.positions[0]
    );
  }

  private departmentOrchestratorPosition(
    bundle: BlueprintBundle,
    department: DepartmentDefinition
  ): PositionDefinition | undefined {
    return (
      bundle.positions.find((position) => {
        const workflowOwner = bundle.workflowOwnership.find(
          (record) =>
            record.departmentId === department.id && record.positionId === position.id
        );
        return Boolean(workflowOwner);
      }) ??
      bundle.positions.find((position) => position.id === department.budgetOwnerPositionId) ??
      bundle.positions.find((position) => position.departmentId === department.id)
    );
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
    officeSnapshot: OfficeViewSnapshot;
  }): string {
    const handoffCount =
      args.officeSnapshot.executiveView.handoffs.length +
      args.officeSnapshot.businessViews.reduce(
        (sum, view) => sum + view.handoffs.length,
        0
      );
    const executionCount = args.officeSnapshot.departmentWorkspaces.reduce(
      (sum, workspace) => sum + workspace.executionItems.length,
      0
    );
    return [
      "# Organization Control Plane",
      "",
      `Generated at: ${nowIso()}`,
      `Approvals waiting: ${args.approvals.filter((approval) => approval.status !== "completed").length}`,
      `Office tree root: ${args.officeSnapshot.officeTree.title}`,
      `Office handoffs: ${handoffCount}`,
      `Department execution items: ${executionCount}`,
      "",
      "## Engine Blueprint",
      `- ${args.engineBundle.blueprint.name}: ${args.engineBundle.blueprint.summary}`,
      `- Engine office workers: ${args.officeSnapshot.executiveView.workers.length}`,
      `- Engine roadblocks: ${args.officeSnapshot.executiveView.roadblocks.length}`,
      ...args.engineBundle.workflowOwnership.map(
        (record) => `- Workflow owner: ${record.workflowName} -> ${record.departmentName} / ${record.positionName}`
      ),
      "",
      "## Business Blueprints",
      ...args.businessBundles.flatMap((bundle) => [
        `### ${bundle.blueprint.name}`,
        `- Blueprint: ${bundle.blueprint.id}`,
        `- Template profile: ${bundle.blueprint.businessCategory && bundle.blueprint.businessCategory !== "engine" ? officeTemplateProfileForCategory(bundle.blueprint.businessCategory) : "service_business"}`,
        `- Departments: ${bundle.departments.length}`,
        `- Positions: ${bundle.positions.length}`,
        `- Workflow ownership: ${bundle.workflowOwnership.length}`,
        `- Department workspaces: ${args.officeSnapshot.departmentWorkspaces.filter((workspace) => workspace.businessId === bundle.blueprint.businessId).length}`,
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
      "## Office Tree",
      `- Root: ${snapshot.officeTree.title}`,
      `- Businesses: ${snapshot.officeTree.children.length}`,
      `- Department workspaces: ${snapshot.departmentWorkspaces.length}`,
      "",
      "## Executive Office",
      `- ${snapshot.executiveView.title}`,
      `- Approvals waiting: ${snapshot.executiveView.approvalsWaiting}`,
      `- Handoffs: ${snapshot.executiveView.handoffs.length}`,
      `- Workers: ${snapshot.executiveView.workers.length}`,
      ...(snapshot.executiveView.roadblocks.length > 0
        ? snapshot.executiveView.roadblocks.map((roadblock) => `- Roadblock: ${roadblock}`)
        : ["- Roadblock: none"]),
      ...snapshot.executiveView.businesses.map(
        (panel) => `- ${panel.title}: ${panel.status} (${panel.metrics.join("; ")})`
      ),
      "",
      "## Business Offices",
      ...snapshot.businessViews.flatMap((view) => [
        `### ${view.title}`,
        `- Template profile: ${view.templateProfile}`,
        `- Handoffs: ${view.handoffs.length}`,
        `- Workers: ${view.workers.length}`,
        ...(view.roadblocks.length > 0
          ? view.roadblocks.map((roadblock) => `- Roadblock: ${roadblock}`)
          : ["- Roadblock: none"]),
        ...view.departments.map(
          (panel) => `- ${panel.title}: ${panel.status} (${panel.metrics.join("; ")})`
        ),
        ...(view.alerts.length > 0 ? view.alerts.map((alert) => `- Alert: ${alert}`) : ["- Alert: none"]),
        ""
      ]),
      "## Department Workspaces",
      ...snapshot.departmentWorkspaces.flatMap((workspace) => [
        `### ${workspace.title}`,
        `- Template profile: ${workspace.templateProfile}`,
        `- Execution items: ${workspace.executionItems.length}`,
        `- Workers: ${workspace.workers.length}`,
        `- Widgets: ${workspace.widgetSections.join(", ")}`,
        ...(workspace.roadblocks.length > 0
          ? workspace.roadblocks.map((roadblock) => `- Roadblock: ${roadblock}`)
          : ["- Roadblock: none"]),
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
