import path from "node:path";
import type { AppConfig } from "../config.js";
import {
  type ClipBaitersAutomationPlan,
  type ClipBaitersAutonomySnapshot,
  type ClipBaitersChannelMetricsState,
  type ClipBaitersCreatorLeadState,
  type ClipBaitersCreatorOfferState,
  type ClipBaitersCreatorOrderState,
  type ClipBaitersCreatorOutreachState,
  type ClipBaitersEventRadarState,
  type ClipBaitersPublishHistoryState,
  type ClipBaitersPostingScheduleState,
  type ClipBaitersPublishingQueueState,
  type ClipBaitersRevenueSnapshotState,
  type ClipBaitersSkimSummaryState,
  type ClipBaitersSourceWatchlistState,
  type ClipBaitersStoryCandidateState,
  type ClipBaitersUploadBatchState,
  type ClipBaitersVideoDiscoveryState
} from "../domain/clipbaiters.js";
import {
  resolveClientProofEligible,
  type ApprovalTask,
  type ClientJob,
  type LeadRecord,
  type OutreachDraft,
  type ProofBundle,
  type RetentionReport
} from "../domain/contracts.js";
import type { AssetPackRecord } from "../domain/digital-assets.js";
import type { BusinessCategory, ImonEngineState, ManagedBusiness } from "../domain/engine.js";
import {
  DEFAULT_NORTHLINE_BUSINESS_ID,
  type NorthlineAutomationPlan
} from "../domain/northline.js";
import type { NorthlineAutonomySnapshot } from "../domain/northline-autonomy.js";
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
import { ensureDir, readJsonFile, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { FileStore } from "../storage/store.js";
import {
  northlineBusinessOpsDir,
  northlineLeadMatchesBusinessScope,
  resolveNorthlineBusinessProfile
} from "./northline-business-profile.js";
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

const CLIPBAITERS_BUSINESS_ID = "clipbaiters-viral-moments";
const CLIPBAITERS_PRIMARY_LANE_ID = "clipbaiters-political";

function isClipBaitersBusinessId(businessId: string): boolean {
  return businessId === CLIPBAITERS_BUSINESS_ID;
}

function nowIso(): string {
  return new Date().toISOString();
}

function uniqueStrings<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function namespacePath(parts: string[]): string {
  return parts.filter(Boolean).join("/");
}

function latestTimestamp(values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0];
}

function northlineClientBelongsToBusiness(client: ClientJob, businessId: string): boolean {
  return (
    client.businessId === businessId ||
    (!client.businessId && businessId === DEFAULT_NORTHLINE_BUSINESS_ID)
  );
}

function northlineLeadBelongsToBusiness(
  lead: LeadRecord,
  businessId: string,
  profile: Pick<ReturnType<typeof resolveNorthlineBusinessProfile>, "collectionAreas" | "primaryServiceArea">
): boolean {
  return northlineLeadMatchesBusinessScope(lead, businessId, profile);
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

type NorthlineAutonomySummaryArtifact = {
  plan?: NorthlineAutomationPlan;
  snapshot?: NorthlineAutonomySnapshot;
  reportPath?: string;
};

type NorthlineValidationConfirmationRecord = {
  lastStripeCompletedAt?: string;
  lastResult?: {
    businessId?: string;
    status?: string;
  };
};

type NorthlineValidationConfirmationStore = {
  confirmations?: NorthlineValidationConfirmationRecord[];
};

type NorthlineBusinessExecutionContext = {
  planPath: string;
  autonomySummaryPath: string;
  plan?: NorthlineAutomationPlan;
  autonomySnapshot?: NorthlineAutonomySnapshot;
  reportPath?: string;
  leads: LeadRecord[];
  outreachDrafts: OutreachDraft[];
  clients: ClientJob[];
  proofBundles: ProofBundle[];
  retentionReports: RetentionReport[];
  validationSuccessCount: number;
};

type ClipBaitersBusinessExecutionContext = {
  planPath: string;
  planMarkdownPath: string;
  roadblockEmailPath: string;
  roadblockNotificationPath: string;
  launchChecklistPath: string;
  dailyBriefPath: string;
  dailySummaryPath: string;
  sourceWatchlistsPath: string;
  videoDiscoveryPath: string;
  skimSummariesPath: string;
  eventRadarPath: string;
  storyCandidatesPath: string;
  autonomySummaryPath: string;
  clipCandidatesPath: string;
  clipJobsPath: string;
  draftClipsDirectory: string;
  publishingQueuePath: string;
  postingSchedulePath: string;
  publishHistoryPath: string;
  uploadBatchesPath: string;
  reviewQueuePath: string;
  channelMetricsPath: string;
  channelMetricsMarkdownPath: string;
  creatorLeadsPath: string;
  creatorOutreachPath: string;
  creatorOffersPath: string;
  creatorOrdersPath: string;
  intakeDirectory: string;
  intakeReadmePath: string;
  revenueSnapshotsPath: string;
  creatorDealsReportPath: string;
  monetizationReportPath: string;
  plan?: ClipBaitersAutomationPlan;
  watchlistState?: ClipBaitersSourceWatchlistState;
  discoveryState?: ClipBaitersVideoDiscoveryState;
  skimState?: ClipBaitersSkimSummaryState;
  radarState?: ClipBaitersEventRadarState;
  storyState?: ClipBaitersStoryCandidateState;
  autonomySnapshot?: ClipBaitersAutonomySnapshot;
  publishingQueueState?: ClipBaitersPublishingQueueState;
  postingScheduleState?: ClipBaitersPostingScheduleState;
  publishHistoryState?: ClipBaitersPublishHistoryState;
  uploadBatches?: ClipBaitersUploadBatchState;
  channelMetrics?: ClipBaitersChannelMetricsState;
  roadblockNotificationState?: {
    signature?: string;
    notifiedAt?: string;
  };
  creatorLeadState?: ClipBaitersCreatorLeadState;
  creatorOutreachState?: ClipBaitersCreatorOutreachState;
  offersState?: ClipBaitersCreatorOfferState;
  ordersState?: ClipBaitersCreatorOrderState;
  revenueState?: ClipBaitersRevenueSnapshotState;
};

type BusinessExecutionContext = {
  northline?: NorthlineBusinessExecutionContext;
  clipbaiters?: ClipBaitersBusinessExecutionContext;
};

type WorkflowExecutionInsights = {
  taskCount: number;
  reviewCount: number;
  blockers: string[];
  artifacts: string[];
  metrics: string[];
  updatedAt: string;
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
    const [
      approvals,
      taskEnvelopes,
      auditRecords,
      assetPacks,
      growthQueue,
      allocationSnapshots,
      leads,
      clients,
      outreachDrafts,
      proofBundles,
      retentionReports
    ] =
      await Promise.all([
        this.store.getApprovals(),
        this.store.getTaskEnvelopes(),
        this.store.getOrgAuditRecords(),
        this.store.getAssetPacks(),
        this.store.getGrowthQueue(),
        this.store.getAllocationSnapshots(),
        this.store.getLeads(),
        this.store.getClients(),
        this.store.getOutreachDrafts(),
        this.store.getProofBundles(),
        this.store.getRetentionReports()
      ]);
    const businessExecutionContext = await this.buildBusinessExecutionContext({
      businesses,
      leads,
      clients,
      outreachDrafts,
      proofBundles,
      retentionReports
    });
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
        template: buildBusinessOrgTemplate(business.category, business.id)
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
      allocationSnapshots,
      businessExecutionContext
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
      officeSnapshot,
      businessExecutionContext
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
    businessExecutionContext: Map<string, BusinessExecutionContext>;
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
        const businessContext = args.businessExecutionContext.get(business.id);

        for (const workflowOwner of workflowOwners) {
          const relatedTasks = departmentTasks.filter(
            (task) => task.workflowId === workflowOwner.workflowId
          );
          const businessApprovals = openApprovals.filter(
            (approval) => approval.relatedEntityId === business.id
          );
          const insights = this.workflowExecutionInsights({
            business,
            workflowOwner,
            relatedTasks,
            businessApprovals,
            assetPacks: args.assetPacks,
            growthQueue: args.growthQueue,
            allocationSnapshots: args.allocationSnapshots,
            context: businessContext
          });
          const blockers = uniqueStrings([
            ...business.launchBlockers,
            ...businessApprovals.map((approval) => approval.reason),
            ...insights.blockers
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
              taskCount: insights.taskCount,
              reviewCount: insights.reviewCount
            }),
            assignedWorkerId: `worker-task-agent-${department.id}-${workflowOwner.workflowId}`,
            assignedWorkerLabel: workflowOwner.positionName,
            blockers,
            artifacts: insights.artifacts,
            metrics: insights.metrics,
            approvalIds: businessApprovals.map((approval) => approval.id),
            auditRecordIds: departmentAudits.slice(0, 4).map((record) => record.id),
            createdAt: insights.updatedAt,
            updatedAt: insights.updatedAt
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

  private async buildBusinessExecutionContext(args: {
    businesses: ManagedBusiness[];
    leads: LeadRecord[];
    clients: ClientJob[];
    outreachDrafts: OutreachDraft[];
    proofBundles: ProofBundle[];
    retentionReports: RetentionReport[];
  }): Promise<Map<string, BusinessExecutionContext>> {
    const validationStore = await readJsonFile<NorthlineValidationConfirmationStore>(
      path.join(this.config.stateDir, "northlineValidationConfirmations.json"),
      { confirmations: [] }
    );

    const entries = await Promise.all(
      args.businesses.map(async (business): Promise<[string, BusinessExecutionContext]> => {
        if (isClipBaitersBusinessId(business.id)) {
          const stateDir = path.join(this.config.stateDir, "clipbaiters", business.id);
          const opsDir = path.join(this.config.opsDir, "clipbaiters", business.id);
          const feedDir = path.join(
            this.config.outputDir,
            "source-feeds",
            "clipbaiters",
            business.id
          );
          const creatorOrdersDir = path.join(feedDir, "creator-orders");

          const planPath = path.join(opsDir, "plan.json");
          const planMarkdownPath = path.join(opsDir, "plan.md");
          const roadblockEmailPath = path.join(opsDir, "roadblock-email.md");
          const roadblockNotificationPath = path.join(opsDir, "roadblock-notification.json");
          const launchChecklistPath = path.join(opsDir, "launch-checklist.md");
          const dailyBriefPath = path.join(opsDir, "daily-brief.md");
          const dailySummaryPath = path.join(opsDir, "daily-summary.md");
          const sourceWatchlistsPath = path.join(stateDir, "source-watchlists.json");
          const videoDiscoveryPath = path.join(stateDir, "video-discovery.json");
          const skimSummariesPath = path.join(stateDir, "skim-summaries.json");
          const eventRadarPath = path.join(stateDir, "event-radar.json");
          const storyCandidatesPath = path.join(stateDir, "story-candidates.json");
          const autonomySummaryPath = path.join(opsDir, "autonomy-run.json");
          const clipCandidatesPath = path.join(stateDir, "clip-candidates.json");
          const clipJobsPath = path.join(stateDir, "clip-jobs.json");
          const draftClipsDirectory = path.join(opsDir, "draft-clips");
          const publishingQueuePath = path.join(stateDir, "publishing-queue.json");
          const postingSchedulePath = path.join(stateDir, "posting-schedule.json");
          const publishHistoryPath = path.join(stateDir, "publish-history.json");
          const uploadBatchesPath = path.join(opsDir, "upload-batches.json");
          const reviewQueuePath = path.join(opsDir, "review-queue.md");
          const channelMetricsPath = path.join(stateDir, "channel-metrics.json");
          const channelMetricsMarkdownPath = path.join(opsDir, "channel-metrics.md");
          const creatorLeadsPath = path.join(stateDir, "creator-leads.json");
          const creatorOutreachPath = path.join(stateDir, "creator-outreach.json");
          const creatorOffersPath = path.join(stateDir, "creator-offers.json");
          const creatorOrdersPath = path.join(stateDir, "creator-orders.json");
          const intakeReadmePath = path.join(creatorOrdersDir, "README.md");
          const revenueSnapshotsPath = path.join(stateDir, "revenue-snapshots.json");
          const creatorDealsReportPath = path.join(opsDir, "creator-deals.md");
          const monetizationReportPath = path.join(opsDir, "monetization-report.md");

          const [
            plan,
            watchlistState,
            discoveryState,
            skimState,
            radarState,
            storyState,
            autonomySnapshot,
            publishingQueueState,
            postingScheduleState,
            publishHistoryState,
            uploadBatches,
            channelMetrics,
            roadblockNotificationState,
            creatorLeadState,
            creatorOutreachState,
            offersState,
            ordersState,
            revenueState
          ] = await Promise.all([
            readJsonFile<ClipBaitersAutomationPlan | null>(planPath, null),
            readJsonFile<ClipBaitersSourceWatchlistState | null>(sourceWatchlistsPath, null),
            readJsonFile<ClipBaitersVideoDiscoveryState | null>(videoDiscoveryPath, null),
            readJsonFile<ClipBaitersSkimSummaryState | null>(skimSummariesPath, null),
            readJsonFile<ClipBaitersEventRadarState | null>(eventRadarPath, null),
            readJsonFile<ClipBaitersStoryCandidateState | null>(storyCandidatesPath, null),
            readJsonFile<ClipBaitersAutonomySnapshot | null>(autonomySummaryPath, null),
            readJsonFile<ClipBaitersPublishingQueueState | null>(publishingQueuePath, null),
            readJsonFile<ClipBaitersPostingScheduleState | null>(postingSchedulePath, null),
            readJsonFile<ClipBaitersPublishHistoryState | null>(publishHistoryPath, null),
            readJsonFile<ClipBaitersUploadBatchState | null>(uploadBatchesPath, null),
            readJsonFile<ClipBaitersChannelMetricsState | null>(channelMetricsPath, null),
            readJsonFile<{ signature?: string; notifiedAt?: string } | null>(roadblockNotificationPath, null),
            readJsonFile<ClipBaitersCreatorLeadState | null>(creatorLeadsPath, null),
            readJsonFile<ClipBaitersCreatorOutreachState | null>(creatorOutreachPath, null),
            readJsonFile<ClipBaitersCreatorOfferState | null>(creatorOffersPath, null),
            readJsonFile<ClipBaitersCreatorOrderState | null>(creatorOrdersPath, null),
            readJsonFile<ClipBaitersRevenueSnapshotState | null>(revenueSnapshotsPath, null)
          ]);

          return [
            business.id,
            {
              clipbaiters: {
                planPath,
                roadblockEmailPath,
                roadblockNotificationPath,
                dailySummaryPath,
                sourceWatchlistsPath,
                videoDiscoveryPath,
                skimSummariesPath,
                planMarkdownPath,
                launchChecklistPath,
                dailyBriefPath,
                eventRadarPath,
                storyCandidatesPath,
                autonomySummaryPath,
                clipCandidatesPath,
                publishHistoryPath,
                clipJobsPath,
                draftClipsDirectory,
                publishingQueuePath,
                postingSchedulePath,
                uploadBatchesPath,
                creatorLeadsPath,
                creatorOutreachPath,
                reviewQueuePath,
                channelMetricsPath,
                channelMetricsMarkdownPath,
                creatorOffersPath,
                creatorOrdersPath,
                creatorDealsReportPath,
                intakeDirectory: creatorOrdersDir,
                intakeReadmePath,
                watchlistState: watchlistState ?? undefined,
                discoveryState: discoveryState ?? undefined,
                skimState: skimState ?? undefined,
                revenueSnapshotsPath,
                monetizationReportPath,
                plan: plan ?? undefined,
                radarState: radarState ?? undefined,
                publishHistoryState: publishHistoryState ?? undefined,
                storyState: storyState ?? undefined,
                autonomySnapshot: autonomySnapshot ?? undefined,
                creatorLeadState: creatorLeadState ?? undefined,
                creatorOutreachState: creatorOutreachState ?? undefined,
                publishingQueueState: publishingQueueState ?? undefined,
                postingScheduleState: postingScheduleState ?? undefined,
                uploadBatches: uploadBatches ?? undefined,
                channelMetrics: channelMetrics ?? undefined,
                roadblockNotificationState: roadblockNotificationState ?? undefined,
                offersState: offersState ?? undefined,
                ordersState: ordersState ?? undefined,
                revenueState: revenueState ?? undefined
              }
            }
          ];
        }

        if (business.category !== "client_services_agency") {
          return [business.id, {}];
        }

        const clients = args.clients.filter((client) =>
          northlineClientBelongsToBusiness(client, business.id)
        );
        const clientIds = new Set(clients.map((client) => client.id));
        const profile = resolveNorthlineBusinessProfile(this.config, business);
        const leads = args.leads.filter((lead) =>
          northlineLeadBelongsToBusiness(lead, business.id, profile)
        );
        const leadIds = new Set(leads.map((lead) => lead.id));
        const planPath = path.join(northlineBusinessOpsDir(this.config, business.id), "plan.json");
        const autonomySummaryPath = path.join(
          northlineBusinessOpsDir(this.config, business.id),
          "autonomy-summary.json"
        );
        const [plan, autonomySummary] = await Promise.all([
          readJsonFile<NorthlineAutomationPlan | null>(planPath, null),
          readJsonFile<NorthlineAutonomySummaryArtifact | null>(autonomySummaryPath, null)
        ]);

        return [
          business.id,
          {
            northline: {
              planPath,
              autonomySummaryPath,
              plan: plan ?? undefined,
              autonomySnapshot: autonomySummary?.snapshot,
              reportPath: autonomySummary?.reportPath,
              leads,
              outreachDrafts: args.outreachDrafts.filter((draft) => leadIds.has(draft.leadId)),
              clients,
              proofBundles: args.proofBundles.filter(
                (bundle) =>
                  bundle.businessId === business.id ||
                  (!bundle.businessId && clientIds.has(bundle.clientId))
              ),
              retentionReports: args.retentionReports.filter((report) =>
                clientIds.has(report.clientId)
              ),
              validationSuccessCount: this.northlineValidationSuccessCount(
                validationStore,
                business.id
              )
            }
          }
        ];
      })
    );

    return new Map(entries);
  }

  private northlineValidationSuccessCount(
    store: NorthlineValidationConfirmationStore,
    businessId: string
  ): number {
    return (store.confirmations ?? []).filter((record) => {
      if (!record.lastStripeCompletedAt || record.lastResult?.status !== "success") {
        return false;
      }

      return (record.lastResult.businessId ?? DEFAULT_NORTHLINE_BUSINESS_ID) === businessId;
    }).length;
  }

  private workflowExecutionInsights(args: {
    business: ManagedBusiness;
    workflowOwner: WorkflowOwnershipRecord;
    relatedTasks: TaskEnvelope[];
    businessApprovals: ApprovalTask[];
    assetPacks: AssetPackRecord[];
    growthQueue: GrowthWorkItem[];
    allocationSnapshots: RevenueAllocationSnapshot[];
    context?: BusinessExecutionContext;
  }): WorkflowExecutionInsights {
    const relatedTaskCount = args.relatedTasks.length;
    const clipbaitersInsights = args.context?.clipbaiters
      ? this.clipbaitersWorkflowInsights({
          business: args.business,
          workflowOwner: args.workflowOwner,
          context: args.context.clipbaiters
        })
      : undefined;
    const northlineInsights = !clipbaitersInsights && args.context?.northline
      ? this.northlineWorkflowInsights({
          business: args.business,
          workflowOwner: args.workflowOwner,
          context: args.context.northline,
          growthQueue: args.growthQueue,
          allocationSnapshots: args.allocationSnapshots
        })
      : undefined;
    const domainInsights = clipbaitersInsights ?? northlineInsights;
    const totalTaskCount = relatedTaskCount + (domainInsights?.taskCount ?? 0);
    const artifacts = domainInsights
      ? uniqueStrings([
          ...domainInsights.artifacts,
          ...this.executionArtifactsForWorkflow({
            business: args.business,
            workflowOwner: args.workflowOwner,
            assetPacks: args.assetPacks,
            growthQueue: args.growthQueue,
            allocationSnapshots: args.allocationSnapshots
          })
        ])
      : this.executionArtifactsForWorkflow({
          business: args.business,
          workflowOwner: args.workflowOwner,
          assetPacks: args.assetPacks,
          growthQueue: args.growthQueue,
          allocationSnapshots: args.allocationSnapshots
        });
    const metrics = domainInsights
      ? uniqueStrings([
          `Work items: ${totalTaskCount}`,
          ...(relatedTaskCount > 0 ? [`Task envelopes: ${relatedTaskCount}`] : []),
          ...domainInsights.metrics,
          `Approvals: ${args.businessApprovals.length}`,
          `Model tier: ${args.workflowOwner.allowedModelTier}`
        ])
      : [
          `Tasks: ${relatedTaskCount}`,
          `Approvals: ${args.businessApprovals.length}`,
          `Model tier: ${args.workflowOwner.allowedModelTier}`
        ];

    return {
      taskCount: totalTaskCount,
      reviewCount: domainInsights?.reviewCount ?? 0,
      blockers: domainInsights?.blockers ?? [],
      artifacts,
      metrics,
      updatedAt: domainInsights?.updatedAt ?? args.workflowOwner.updatedAt
    };
  }

  private clipbaitersWorkflowInsights(args: {
    business: ManagedBusiness;
    workflowOwner: WorkflowOwnershipRecord;
    context: ClipBaitersBusinessExecutionContext;
  }): Omit<WorkflowExecutionInsights, "artifacts"> & { artifacts: string[] } | undefined {
    const plan = args.context.plan;
    const primaryEditorialLaneId = plan?.primaryEditorialLaneId ?? CLIPBAITERS_PRIMARY_LANE_ID;
    const primaryRevenueLaneId = plan?.primaryRevenueLaneId ?? primaryEditorialLaneId;
    const editorialLane = plan?.laneRegistry.lanes.find(
      (lane) => lane.id === primaryEditorialLaneId
    );
    const revenueLane = plan?.laneRegistry.lanes.find(
      (lane) => lane.id === primaryRevenueLaneId
    );
    const editorialSources =
      plan?.sourceRegistry.sources.filter((source) => source.laneId === primaryEditorialLaneId) ?? [];
    const activeEditorialSources = editorialSources.filter(
      (source) => source.status === "active"
    ).length;
    const gatedEditorialSources = editorialSources.filter(
      (source) => source.status !== "active"
    ).length;
    const watchlistCount =
      args.context.watchlistState?.watchlists.filter((watchlist) => watchlist.laneId === primaryEditorialLaneId).length ?? 0;
    const discoveryCount =
      args.context.discoveryState?.videos.filter((video) => video.laneId === primaryEditorialLaneId).length ?? 0;
    const skimCount =
      args.context.skimState?.summaries.filter((summary) => summary.laneId === primaryEditorialLaneId).length ?? 0;
    const radarLane = args.context.radarState?.lanes.find(
      (lane) => lane.laneId === primaryEditorialLaneId
    );
    const storyLane = args.context.storyState?.lanes.find(
      (lane) => lane.laneId === primaryEditorialLaneId
    );
    const radarCandidateCount = radarLane?.candidateCount ?? 0;
    const radarReviewCount =
      radarLane?.candidates.filter(
        (candidate) => candidate.reviewRequired || candidate.status === "review_required"
      ).length ?? 0;
    const storyCount = storyLane?.stories.length ?? 0;
    const storyReviewCount =
      storyLane?.stories.filter((story) => story.reviewRequired).length ?? 0;
    const blockedStoryCount =
      storyLane?.stories.filter((story) => story.status === "blocked").length ?? 0;
    const autonomy = args.context.autonomySnapshot;
    const autonomyManualGateCount = autonomy?.manualGates.length ?? 0;
    const missingTooling = autonomy?.tooling.filter((tool) => !tool.available) ?? [];
    const activeLaneIds = new Set(plan?.laneRegistry.activeLaneIds ?? []);
    const youtubeProfiles = (plan?.socialPresence ?? []).filter(
      (profile) => profile.platform === "youtube_channel"
    );
    const activeYoutubeProfiles = youtubeProfiles.filter(
      (profile) => Boolean(profile.laneId && activeLaneIds.has(profile.laneId))
    );
    const liveActiveYoutubeProfileCount = activeYoutubeProfiles.filter(
      (profile) => profile.status === "live"
    ).length;
    const pendingActiveYoutubeProfileCount = activeYoutubeProfiles.filter(
      (profile) => profile.status !== "live"
    ).length;
    const deferredYoutubeProfileCount = youtubeProfiles.filter(
      (profile) => !profile.laneId || !activeLaneIds.has(profile.laneId)
    ).length;
    const publishingItems = args.context.publishingQueueState?.items ?? [];
    const queueItemCount = publishingItems.length;
    const publishAwaitingReviewCount = publishingItems.filter(
      (item) => item.status === "awaiting_review"
    ).length;
    const publishApprovedCount = publishingItems.filter((item) =>
      ["approved", "publishing", "live"].includes(item.status)
    ).length;
    const publishLiveCount = publishingItems.filter((item) => item.status === "live").length;
    const publishFailureCount = publishingItems.filter(
      (item) => item.status === "failed" || item.status === "blocked"
    ).length;
    const publishMissingChannelCount = publishingItems.filter(
      (item) => item.channelStatus === "missing"
    ).length;
    const publishReviewRequiredCount = publishingItems.filter(
      (item) => item.reviewRequired || item.status === "awaiting_review"
    ).length;
    const publishHistoryEntries = args.context.publishHistoryState?.entries ?? [];
    const publishHistoryLiveCount = publishHistoryEntries.filter(
      (entry) => entry.status === "live"
    ).length;
    const publishHistoryFailureCount = publishHistoryEntries.filter(
      (entry) => entry.status === "failed"
    ).length;
    const uploadBatches = args.context.uploadBatches?.batches ?? [];
    const uploadBatchCount = uploadBatches.length;
    const batchReviewRequiredCount = uploadBatches.filter(
      (batch) => batch.status === "review_required" || batch.reviewRequiredCount > 0
    ).length;
    const channelProfiles = args.context.channelMetrics?.profiles ?? [];
    const liveProfileCount = channelProfiles.filter((profile) => profile.liveCount > 0).length;
    const nextScheduledWindow = channelProfiles
      .map((profile) => profile.nextScheduledFor)
      .filter((value): value is string => Boolean(value))
      .sort()[0];
    const scheduledQueueCount = channelProfiles.reduce(
      (sum, profile) => sum + profile.scheduledCount,
      0
    );
    const renderReadyQueueCount = channelProfiles.reduce(
      (sum, profile) => sum + profile.renderReadyCount,
      0
    );
    const totalPolicyEvents = channelProfiles.reduce(
      (sum, profile) => sum + profile.policyEventCount,
      0
    );
    const postingSchedule = args.context.postingScheduleState;
    const plannedPostingCount = postingSchedule?.allocations.filter(
      (allocation) => allocation.status === "planned"
    ).length ?? 0;
    const roadblockNotifiedAt = args.context.roadblockNotificationState?.notifiedAt;
    const renderBacklogCount = Math.max(
      (autonomy?.clipJobCount ?? 0) - (autonomy?.renderedClipCount ?? 0),
      0
    );
    const offers = args.context.offersState?.offers ?? [];
    const creatorLeads = args.context.creatorLeadState?.leads ?? [];
    const creatorOutreachDrafts = args.context.creatorOutreachState?.drafts ?? [];
    const creatorProspectCount = creatorLeads.filter((lead) => lead.status === "prospect").length;
    const creatorActiveCount = creatorLeads.filter((lead) => lead.status === "active").length;
    const creatorPaidCount = creatorLeads.filter((lead) => lead.status === "paid").length;
    const readyToSendOutreachCount = creatorOutreachDrafts.filter(
      (draft) => draft.status === "ready_to_send"
    ).length;
    const paymentLinkReadyCount = offers.filter(
      (offer) => offer.status === "payment_link_ready"
    ).length;
    const offerApprovalCount = offers.filter(
      (offer) => offer.status === "approval_required"
    ).length;
    const orders = args.context.ordersState?.orders ?? [];
    const pendingPaymentCount = orders.filter(
      (order) => order.paymentStatus === "pending"
    ).length;
    const deliveryBacklogCount = orders.filter((order) =>
      ["paid", "in_delivery"].includes(order.status)
    ).length;
    const blockedOrderCount = orders.filter((order) => order.status === "blocked").length;
    const paidOrderCount = orders.filter((order) => order.paymentStatus === "paid").length;
    const deliveredOrderCount = orders.filter((order) => order.status === "delivered").length;
    const latestRevenueSnapshot = [...(args.context.revenueState?.snapshots ?? [])].sort(
      (left, right) => right.generatedAt.localeCompare(left.generatedAt)
    )[0];
    const stripeConfigured = Boolean(
      this.config.clipbaiters.finance.stripe.accountId ||
        this.config.clipbaiters.finance.stripe.publishableKey ||
        this.config.clipbaiters.finance.stripe.secretKey
    );
    const relayConfigured = Boolean(
      this.config.clipbaiters.finance.relay.checkingLabel ||
        this.config.clipbaiters.finance.relay.checkingLast4
    );
    const updatedAt =
      latestTimestamp([
        plan?.generatedAt,
        args.context.radarState?.generatedAt,
        args.context.storyState?.generatedAt,
        args.context.watchlistState?.generatedAt,
        args.context.discoveryState?.generatedAt,
        args.context.skimState?.generatedAt,
        autonomy?.generatedAt,
        args.context.publishingQueueState?.generatedAt,
        args.context.postingScheduleState?.generatedAt,
        args.context.publishHistoryState?.generatedAt,
        args.context.uploadBatches?.generatedAt,
        args.context.channelMetrics?.generatedAt,
        roadblockNotifiedAt,
        args.context.creatorLeadState?.generatedAt,
        args.context.creatorOutreachState?.generatedAt,
        args.context.offersState?.generatedAt,
        args.context.ordersState?.generatedAt,
        args.context.revenueState?.generatedAt,
        latestRevenueSnapshot?.generatedAt,
        ...offers.map((offer) => offer.updatedAt),
        ...orders.map((order) => order.updatedAt)
      ]) ?? args.workflowOwner.updatedAt;
    const planRoadblocks = plan?.roadblocks ?? [];
    const planBlocked = plan?.status === "blocked";
    const launchGovernanceBlockers = uniqueStrings([
      ...(planBlocked ? ["ClipBaiters plan still has unresolved launch roadblocks."] : []),
      ...planRoadblocks.map((roadblock) => roadblock.summary),
      ...(editorialLane && editorialLane.rolloutStatus !== "active"
        ? [`${editorialLane.name} lane is ${editorialLane.rolloutStatus}.`]
        : [])
    ]);

    switch (args.workflowOwner.workflowId) {
      case "business-governance":
        return {
          taskCount:
            planRoadblocks.length +
            (plan?.nextAutomationSteps.length ?? 0) +
            autonomyManualGateCount +
            publishReviewRequiredCount,
          reviewCount: autonomyManualGateCount + publishReviewRequiredCount,
          blockers: launchGovernanceBlockers,
          artifacts: [
            `Plan status: ${plan?.status ?? "not-generated"}`,
            `Launch checklist: ${this.relativeArtifactPath(args.context.launchChecklistPath)}`,
            `Daily summary: ${this.relativeArtifactPath(args.context.dailySummaryPath)}`,
            `Daily brief: ${this.relativeArtifactPath(args.context.dailyBriefPath)}`,
            `Plan artifact: ${this.relativeArtifactPath(args.context.planMarkdownPath)}`,
            `Roadblock email: ${this.relativeArtifactPath(args.context.roadblockEmailPath)}`,
            `Posting schedule: ${this.relativeArtifactPath(args.context.postingSchedulePath)}`,
            `Creator deals: ${this.relativeArtifactPath(args.context.creatorDealsReportPath)}`
          ],
          metrics: [
            `Roadblocks: ${planRoadblocks.length}`,
            `Next automation steps: ${plan?.nextAutomationSteps.length ?? 0}`,
            `Pending review gates: ${autonomyManualGateCount + publishReviewRequiredCount}`,
            `Active lanes: ${plan?.laneRegistry.activeLaneIds.length ?? 0}`,
            `Roadblock notified: ${roadblockNotifiedAt ?? "not-yet-sent"}`,
            `Next posting window: ${nextScheduledWindow ?? "not-scheduled"}`
          ],
          updatedAt
        };
      case "clipbaiters-collect":
        return {
          taskCount: watchlistCount + discoveryCount,
          reviewCount: 0,
          blockers: uniqueStrings([
            ...(watchlistCount === 0 ? ["No editorial watchlists are available for the primary ClipBaiters lane."] : []),
            ...(discoveryCount === 0 ? ["No discovery items are available for the primary ClipBaiters lane."] : [])
          ]),
          artifacts: [
            `Source watchlists: ${this.relativeArtifactPath(args.context.sourceWatchlistsPath)}`,
            `Video discovery: ${this.relativeArtifactPath(args.context.videoDiscoveryPath)}`,
            `Daily brief: ${this.relativeArtifactPath(args.context.dailyBriefPath)}`
          ],
          metrics: [
            `Watchlists: ${watchlistCount}`,
            `Discovery items: ${discoveryCount}`,
            `Active sources: ${activeEditorialSources}`
          ],
          updatedAt
        };
      case "clipbaiters-skim":
        return {
          taskCount: discoveryCount + skimCount,
          reviewCount: 0,
          blockers: uniqueStrings([
            ...(discoveryCount === 0 ? ["No discovery items are available to skim."] : []),
            ...(skimCount === 0 ? ["No skim summaries have been produced for the primary ClipBaiters lane."] : [])
          ]),
          artifacts: [
            `Video discovery: ${this.relativeArtifactPath(args.context.videoDiscoveryPath)}`,
            `Skim summaries: ${this.relativeArtifactPath(args.context.skimSummariesPath)}`,
            `Daily brief: ${this.relativeArtifactPath(args.context.dailyBriefPath)}`
          ],
          metrics: [
            `Discovery items: ${discoveryCount}`,
            `Skim summaries: ${skimCount}`,
            `Review required: ${radarReviewCount + storyReviewCount}`
          ],
          updatedAt
        };
      case "clipbaiters-radar":
        return {
          taskCount: watchlistCount + discoveryCount + skimCount + radarCandidateCount + storyCount,
          reviewCount: radarReviewCount + storyReviewCount,
          blockers: uniqueStrings([
            ...(planBlocked
              ? ["Radar planning is still blocked by unresolved ClipBaiters roadblocks."]
              : []),
            ...(watchlistCount === 0
              ? ["Source watchlists have not been refreshed yet."]
              : []),
            ...(skimCount === 0
              ? ["Skim summaries are missing for the primary editorial lane."]
              : []),
            ...(gatedEditorialSources > 0
              ? [`${gatedEditorialSources} editorial source(s) remain gated or manual-only.`]
              : []),
            ...(blockedStoryCount > 0
              ? [`${blockedStoryCount} story candidate(s) are blocked pending editorial follow-up.`]
              : [])
          ]),
          artifacts: [
            `Primary editorial lane: ${editorialLane?.name ?? primaryEditorialLaneId}`,
            `Source watchlists: ${this.relativeArtifactPath(args.context.sourceWatchlistsPath)}`,
            `Video discovery: ${this.relativeArtifactPath(args.context.videoDiscoveryPath)}`,
            `Skim summaries: ${this.relativeArtifactPath(args.context.skimSummariesPath)}`,
            `Daily brief: ${this.relativeArtifactPath(args.context.dailyBriefPath)}`,
            `Radar snapshot: ${this.relativeArtifactPath(args.context.eventRadarPath)}`,
            `Story candidates: ${this.relativeArtifactPath(args.context.storyCandidatesPath)}`
          ],
          metrics: [
            `Watchlists: ${watchlistCount}`,
            `Discovery items: ${discoveryCount}`,
            `Skim summaries: ${skimCount}`,
            `Candidates: ${radarCandidateCount}`,
            `Stories: ${storyCount}`,
            `Review required: ${radarReviewCount + storyReviewCount}`,
            `Active sources: ${activeEditorialSources}`
          ],
          updatedAt
        };
      case "clipbaiters-autonomy-run":
        return {
          taskCount:
            (autonomy?.sourceManifestCount ?? 0) +
            (autonomy?.candidateCount ?? 0) +
            (autonomy?.clipJobCount ?? 0) +
            autonomyManualGateCount,
          reviewCount: autonomyManualGateCount,
          blockers: uniqueStrings([
            ...(autonomy?.status === "blocked"
              ? [autonomy.nextStep || "Clip draft automation is currently blocked."]
              : []),
            ...missingTooling.map(
              (tool) => `${tool.tool} is unavailable for the ClipBaiters worker: ${tool.note}`
            )
          ]),
          artifacts: [
            `Autonomy summary: ${this.relativeArtifactPath(args.context.autonomySummaryPath)}`,
            `Clip candidates: ${this.relativeArtifactPath(args.context.clipCandidatesPath)}`,
            `Clip jobs: ${this.relativeArtifactPath(args.context.clipJobsPath)}`,
            `Draft clips: ${this.relativeArtifactPath(args.context.draftClipsDirectory)}`
          ],
          metrics: [
            `Source manifests: ${autonomy?.sourceManifestCount ?? 0}`,
            `Candidates: ${autonomy?.candidateCount ?? 0}`,
            `Clip jobs: ${autonomy?.clipJobCount ?? 0}`,
            `Rendered clips: ${autonomy?.renderedClipCount ?? 0}`,
            `Render backlog: ${renderBacklogCount}`,
            `Manual gates: ${autonomyManualGateCount}`
          ],
          updatedAt
        };
      case "clipbaiters-publish":
        return {
          taskCount: queueItemCount + uploadBatchCount,
          reviewCount: publishReviewRequiredCount + batchReviewRequiredCount,
          blockers: uniqueStrings([
            ...(publishMissingChannelCount > 0
              ? [`${publishMissingChannelCount} queued clip(s) still lack a mapped channel profile.`]
              : []),
            ...(publishFailureCount > 0
              ? [`${publishFailureCount} publish item(s) are blocked or failed.`]
              : [])
          ]),
          artifacts: [
            `Review queue: ${this.relativeArtifactPath(args.context.reviewQueuePath)}`,
            `Publishing queue: ${this.relativeArtifactPath(args.context.publishingQueuePath)}`,
            `Posting schedule: ${this.relativeArtifactPath(args.context.postingSchedulePath)}`,
            `Upload batches: ${this.relativeArtifactPath(args.context.uploadBatchesPath)}`,
            `Channel metrics: ${this.relativeArtifactPath(args.context.channelMetricsMarkdownPath)}`,
            `Publish history: ${this.relativeArtifactPath(args.context.publishHistoryPath)}`,
            `Daily summary: ${this.relativeArtifactPath(args.context.dailySummaryPath)}`
          ],
          metrics: [
            `Queued items: ${queueItemCount}`,
            `Scheduled items: ${scheduledQueueCount}`,
            `Approved or live: ${publishApprovedCount}`,
            `Review required: ${publishReviewRequiredCount}`,
            `Render ready: ${renderReadyQueueCount}`,
            `Live channel profiles: ${liveProfileCount}`,
            `Next posting window: ${nextScheduledWindow ?? "not-scheduled"}`,
            `Planned windows: ${plannedPostingCount}`,
            `Policy events: ${totalPolicyEvents}`,
            `Live uploads: ${publishHistoryLiveCount}`,
            `Upload failures: ${publishHistoryFailureCount}`
          ],
          updatedAt
        };
      case "clipbaiters-youtube-channel-ops":
        return {
          taskCount: activeYoutubeProfiles.length + pendingActiveYoutubeProfileCount,
          reviewCount: pendingActiveYoutubeProfileCount,
          blockers: uniqueStrings([
            ...(activeYoutubeProfiles.length === 0
              ? ["No active YouTube lane bindings are configured yet."]
              : []),
            ...(pendingActiveYoutubeProfileCount > 0
              ? [`${pendingActiveYoutubeProfileCount} active YouTube channel(s) are still planned or blocked.`]
              : [])
          ]),
          artifacts: [
            `Launch checklist: ${this.relativeArtifactPath(args.context.launchChecklistPath)}`,
            `Plan artifact: ${this.relativeArtifactPath(args.context.planMarkdownPath)}`,
            `Social profiles: ${this.relativeArtifactPath(path.join(this.config.opsDir, "social-profiles.md"))}`,
            `Daily summary: ${this.relativeArtifactPath(args.context.dailySummaryPath)}`
          ],
          metrics: [
            `Active YouTube lanes: ${activeYoutubeProfiles.length}`,
            `Live active channels: ${liveActiveYoutubeProfileCount}`,
            `Pending active channels: ${pendingActiveYoutubeProfileCount}`,
            `Deferred YouTube channels: ${deferredYoutubeProfileCount}`
          ],
          updatedAt
        };
      case "clipbaiters-source-creators":
        return {
          taskCount: creatorLeads.length,
          reviewCount: creatorLeads.filter((lead) => ["paused", "closed_lost"].includes(lead.status)).length,
          blockers: uniqueStrings([
            ...(creatorLeads.length === 0 ? ["No creator leads are available for the ClipBaiters streaming lane."] : []),
            ...(creatorProspectCount === 0 ? ["No prospect-stage creator leads remain in the sourcing queue."] : [])
          ]),
          artifacts: [
            `Creator leads: ${this.relativeArtifactPath(args.context.creatorLeadsPath)}`,
            `Creator deals report: ${this.relativeArtifactPath(args.context.creatorDealsReportPath)}`
          ],
          metrics: [
            `Leads: ${creatorLeads.length}`,
            `Prospects: ${creatorProspectCount}`,
            `Active creators: ${creatorActiveCount}`
          ],
          updatedAt
        };
      case "clipbaiters-draft-creator-outreach":
        return {
          taskCount: creatorOutreachDrafts.length,
          reviewCount: creatorOutreachDrafts.filter((draft) => draft.status === "manual_send_required").length,
          blockers: uniqueStrings([
            ...(creatorOutreachDrafts.length === 0 ? ["No creator outreach drafts are available yet."] : []),
            ...(readyToSendOutreachCount === 0 ? ["No creator outreach drafts are ready to send through the shared path."] : [])
          ]),
          artifacts: [
            `Creator leads: ${this.relativeArtifactPath(args.context.creatorLeadsPath)}`,
            `Creator outreach: ${this.relativeArtifactPath(args.context.creatorOutreachPath)}`,
            `Creator deals report: ${this.relativeArtifactPath(args.context.creatorDealsReportPath)}`
          ],
          metrics: [
            `Drafts: ${creatorOutreachDrafts.length}`,
            `Ready to send: ${readyToSendOutreachCount}`,
            `Manual send required: ${creatorOutreachDrafts.filter((draft) => draft.status === "manual_send_required").length}`
          ],
          updatedAt
        };
      case "clipbaiters-deals-report":
        return {
          taskCount: creatorLeads.length + creatorOutreachDrafts.length + orders.length,
          reviewCount: blockedOrderCount + creatorOutreachDrafts.filter((draft) => draft.status === "manual_send_required").length,
          blockers: uniqueStrings([
            ...(creatorLeads.length === 0 ? ["The creator deals pipeline has not been sourced yet."] : []),
            ...(blockedOrderCount > 0 ? [`${blockedOrderCount} creator order(s) are still blocked.`] : []),
            ...(creatorOutreachDrafts.filter((draft) => draft.status === "manual_send_required").length > 0
              ? ["Some creator outreach drafts still require a manual send path."]
              : [])
          ]),
          artifacts: [
            `Creator deals report: ${this.relativeArtifactPath(args.context.creatorDealsReportPath)}`,
            `Creator leads: ${this.relativeArtifactPath(args.context.creatorLeadsPath)}`,
            `Creator outreach: ${this.relativeArtifactPath(args.context.creatorOutreachPath)}`,
            `Creator orders: ${this.relativeArtifactPath(args.context.creatorOrdersPath)}`
          ],
          metrics: [
            `Leads: ${creatorLeads.length}`,
            `Outreach drafts: ${creatorOutreachDrafts.length}`,
            `Paid creators: ${creatorPaidCount}`,
            `Active creators: ${creatorActiveCount}`
          ],
          updatedAt
        };
      case "clipbaiters-intake":
        return {
          taskCount: offers.length + orders.length + pendingPaymentCount,
          reviewCount: offerApprovalCount + blockedOrderCount,
          blockers: uniqueStrings([
            ...(blockedOrderCount > 0
              ? [`${blockedOrderCount} creator order(s) are blocked pending delivery follow-up.`]
              : []),
            ...(offerApprovalCount > 0
              ? [`${offerApprovalCount} creator offer(s) still require approval before use.`]
              : [])
          ]),
          artifacts: [
            `Creator intake guide: ${this.relativeArtifactPath(args.context.intakeReadmePath)}`,
            `Creator offers: ${this.relativeArtifactPath(args.context.creatorOffersPath)}`,
            `Creator orders: ${this.relativeArtifactPath(args.context.creatorOrdersPath)}`,
            `Intake directory: ${this.relativeArtifactPath(args.context.intakeDirectory)}`
          ],
          metrics: [
            `Offers ready: ${paymentLinkReadyCount}`,
            `Orders: ${orders.length}`,
            `Pending payment: ${pendingPaymentCount}`,
            `Delivery backlog: ${deliveryBacklogCount}`
          ],
          updatedAt
        };
      case "clipbaiters-monetization-report":
        return {
          taskCount: offers.length + orders.length + (args.context.revenueState?.snapshots.length ?? 0),
          reviewCount: offerApprovalCount + blockedOrderCount,
          blockers: uniqueStrings([
            ...(offerApprovalCount > 0
              ? [`${offerApprovalCount} offer(s) remain approval-gated.`]
              : []),
            ...(pendingPaymentCount > 0
              ? [`${pendingPaymentCount} order(s) still need payment collection.`]
              : []),
            ...(blockedOrderCount > 0
              ? [`${blockedOrderCount} order(s) are blocked and not ready for revenue recognition.`]
              : [])
          ]),
          artifacts: [
            `Monetization report: ${this.relativeArtifactPath(args.context.monetizationReportPath)}`,
            `Revenue snapshots: ${this.relativeArtifactPath(args.context.revenueSnapshotsPath)}`,
            `Creator offers: ${this.relativeArtifactPath(args.context.creatorOffersPath)}`,
            `Creator orders: ${this.relativeArtifactPath(args.context.creatorOrdersPath)}`
          ],
          metrics: [
            `Revenue lane: ${revenueLane?.name ?? primaryRevenueLaneId}`,
            `Paid orders: ${paidOrderCount}`,
            `Delivered orders: ${deliveredOrderCount}`,
            `Booked revenue: $${(latestRevenueSnapshot?.bookedRevenueUsd ?? 0).toFixed(2)}`,
            `Shared Stripe noted: ${stripeConfigured ? "yes" : "no"}`,
            `Relay cashout route noted: ${relayConfigured ? "yes" : "no"}`
          ],
          updatedAt
        };
      default:
        return undefined;
    }
  }

  private northlineWorkflowInsights(args: {
    business: ManagedBusiness;
    workflowOwner: WorkflowOwnershipRecord;
    context: NorthlineBusinessExecutionContext;
    growthQueue: GrowthWorkItem[];
    allocationSnapshots: RevenueAllocationSnapshot[];
  }): Omit<WorkflowExecutionInsights, "artifacts"> & { artifacts: string[] } | undefined {
    const queueItems = args.growthQueue.filter((item) => item.businessId === args.business.id);
    const channels = uniqueStrings(queueItems.map((item) => item.channel));
    const plannedQueueCount = queueItems.filter((item) => item.status === "planned").length;
    const manualGateCount =
      args.context.autonomySnapshot?.manualGates.filter((gate) => gate.status !== "completed")
        .length ?? 0;
    const intakeCount =
      args.context.autonomySnapshot?.newIntakes.filter((item) => item.status !== "duplicate")
        .length ?? 0;
    const outboundPendingCount =
      args.context.autonomySnapshot?.outboundQueue.filter(
        (item) =>
          item.status === "awaiting_compliance" || item.status === "awaiting_manual_send"
      ).length ?? 0;
    const replyFollowUpCount =
      args.context.autonomySnapshot?.replyQueue.filter(
        (item) => item.status === "logged" || item.status === "intake_follow_up" || item.status === "error"
      ).length ?? 0;
    const deliveryQueue = args.context.autonomySnapshot?.deliveryQueue ?? [];
    const qaFailureCount =
      deliveryQueue.filter((item) => item.status === "qa_failed").length ||
      args.context.clients.filter(
        (client) => client.qaStatus === "failed" || client.siteStatus === "qa_failed"
      ).length;
    const activeDeliveryCount =
      deliveryQueue.length > 0
        ? deliveryQueue.filter((item) => item.status !== "stable").length
        : args.context.clients.filter(
            (client) =>
              client.billingStatus !== "paused" &&
              (client.assets.handoffPackage === undefined || client.qaStatus !== "passed")
          ).length;
    const handoffPackageCount = args.context.clients.filter(
      (client) => client.assets.handoffPackage !== undefined
    ).length;
    const paidClientCount = args.context.clients.filter(
      (client) => client.billingStatus === "paid" || client.billingStatus === "retainer_active"
    ).length;
    const retainerClientCount = args.context.clients.filter(
      (client) => client.billingStatus === "retainer_active"
    ).length;
    const proposalCount = args.context.clients.filter(
      (client) =>
        client.billingStatus === "proposal" || client.billingStatus === "deposit_pending"
    ).length;
    const proofEligibleClientCount = args.context.clients.filter((client) =>
      resolveClientProofEligible(client)
    ).length;
    const stableClientCount =
      deliveryQueue.filter((item) => item.status === "stable").length ||
      args.context.clients.filter(
        (client) => client.assets.handoffPackage !== undefined && client.qaStatus === "passed"
      ).length;
    const proofReadyCount =
      args.context.plan?.proofAssets.filter((asset) => asset.status === "ready").length ??
      args.context.proofBundles.filter((bundle) => bundle.screenshots.length > 0).length;
    const proofAssetCount =
      args.context.plan?.proofAssets.length ?? args.context.proofBundles.length;
    const readinessLiveCount =
      args.context.plan?.readiness.filter((item) => item.status === "live").length ?? 0;
    const readinessCount = args.context.plan?.readiness.length ?? 0;
    const promotionMetCount =
      args.context.plan?.operatingMode.promotionCriteria.filter(
        (criterion) => criterion.status === "met"
      ).length ?? 0;
    const promotionCount = args.context.plan?.operatingMode.promotionCriteria.length ?? 0;
    const roadblockCount = args.context.plan?.roadblocks.length ?? args.business.launchBlockers.length;
    const latestAllocation = [...args.allocationSnapshots]
      .filter((snapshot) => snapshot.businessId === args.business.id)
      .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0];
    const updatedAt =
      latestTimestamp([
        args.context.autonomySnapshot?.generatedAt,
        args.context.plan?.generatedAt,
        latestAllocation?.generatedAt,
        ...args.context.clients.map((client) => client.updatedAt),
        ...args.context.proofBundles.map((bundle) => bundle.createdAt),
        ...args.context.retentionReports.map((report) => report.createdAt)
      ]) ?? args.workflowOwner.updatedAt;

    switch (args.workflowOwner.workflowId) {
      case "business-governance":
        return {
          taskCount:
            Math.max(roadblockCount, 0) +
            Math.max(promotionCount - promotionMetCount, 0) +
            manualGateCount,
          reviewCount: manualGateCount,
          blockers: [],
          artifacts: [
            `Operating mode: ${args.context.plan?.operatingMode.current ?? "not-generated"}`,
            `Readiness live: ${readinessLiveCount}/${readinessCount}`,
            `Promotion criteria met: ${promotionMetCount}/${promotionCount}`,
            `Plan artifact: ${this.relativeArtifactPath(args.context.planPath)}`
          ],
          metrics: [
            `Roadblocks: ${roadblockCount}`,
            `Validation confirmations: ${args.context.validationSuccessCount}`,
            `Proof-eligible clients: ${proofEligibleClientCount}`
          ],
          updatedAt
        };
      case "business-ops":
        return {
          taskCount: intakeCount + manualGateCount + replyFollowUpCount + activeDeliveryCount,
          reviewCount: manualGateCount,
          blockers: [],
          artifacts: [
            `Autonomy status: ${args.context.autonomySnapshot?.status ?? "not-run"}`,
            `Lead pipeline: ${args.context.leads.length} lead(s), ${args.context.outreachDrafts.length} draft(s), ${args.context.clients.length} client(s)`,
            `Autonomy summary: ${this.relativeArtifactPath(args.context.autonomySummaryPath)}`
          ],
          metrics: [
            `Manual gates: ${manualGateCount}`,
            `Reply follow-ups: ${replyFollowUpCount}`,
            `Delivery active: ${activeDeliveryCount}`
          ],
          updatedAt
        };
      case "growth-publishing":
        return {
          taskCount: plannedQueueCount + outboundPendingCount + args.context.outreachDrafts.length,
          reviewCount: outboundPendingCount,
          blockers: [],
          artifacts: [
            `Promotion queue: ${plannedQueueCount} planned item(s)`,
            `Outbound queue: ${outboundPendingCount} item(s) awaiting send review`,
            `Channels: ${channels.join(", ") || "none"}`
          ],
          metrics: [
            `Leads: ${args.context.leads.length}`,
            `Drafts: ${args.context.outreachDrafts.length}`,
            `Pending send: ${outboundPendingCount}`
          ],
          updatedAt
        };
      case "analytics-reporting":
        return {
          taskCount: args.context.proofBundles.length + args.context.retentionReports.length + 1,
          reviewCount: 0,
          blockers: [],
          artifacts: [
            `Plan status: ${args.context.plan?.status ?? "not-generated"}`,
            `Proof assets ready: ${proofReadyCount}/${proofAssetCount}`,
            ...(args.context.reportPath
              ? [`Autonomy run report: ${this.relativeArtifactPath(args.context.reportPath)}`]
              : [])
          ],
          metrics: [
            `Clients: ${args.context.clients.length}`,
            `Proof bundles: ${args.context.proofBundles.length}`,
            `Retention reports: ${args.context.retentionReports.length}`
          ],
          updatedAt
        };
      case "product-production":
        return {
          taskCount: activeDeliveryCount + handoffPackageCount + args.context.proofBundles.length,
          reviewCount: 0,
          blockers:
            qaFailureCount > 0
              ? [`QA blockers remain on ${qaFailureCount} client delivery item(s).`]
              : [],
          artifacts: [
            `Clients in delivery: ${activeDeliveryCount}`,
            `Handoff packages: ${handoffPackageCount}`,
            `Proof bundles: ${args.context.proofBundles.length}`
          ],
          metrics: [
            `Paid clients: ${paidClientCount}`,
            `QA failed: ${qaFailureCount}`,
            `Retention reports: ${args.context.retentionReports.length}`
          ],
          updatedAt
        };
      case "finance-allocation-reporting":
        return {
          taskCount: paidClientCount + proposalCount + args.context.validationSuccessCount,
          reviewCount: proposalCount > 0 ? 1 : 0,
          blockers: [],
          artifacts: [
            `Paid clients: ${paidClientCount}`,
            `Retainers: ${retainerClientCount}`,
            `Validation confirmations: ${args.context.validationSuccessCount}`
          ],
          metrics: [
            `Billing pending: ${proposalCount}`,
            `Paid: ${paidClientCount}`,
            `Retainers: ${retainerClientCount}`
          ],
          updatedAt
        };
      case "support-qa":
        return {
          taskCount: qaFailureCount + replyFollowUpCount + args.context.retentionReports.length,
          reviewCount: replyFollowUpCount,
          blockers:
            qaFailureCount > 0
              ? [`${qaFailureCount} client delivery item(s) still have QA blockers.`]
              : [],
          artifacts: [
            `QA backlog: ${qaFailureCount}`,
            `Reply follow-ups: ${replyFollowUpCount}`,
            `Retention reports: ${args.context.retentionReports.length}`
          ],
          metrics: [
            `Stable clients: ${stableClientCount}`,
            `Review asks: ${args.context.proofBundles.length}`,
            `Handoff packages: ${handoffPackageCount}`
          ],
          updatedAt
        };
      default:
        return undefined;
    }
  }

  private relativeArtifactPath(filePath: string): string {
    return path.relative(this.config.projectRoot, filePath) || filePath;
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
    reviewCount?: number;
  }): DepartmentExecutionItem["status"] {
    if (args.blockers.length > 0) {
      return "blocked";
    }
    if (args.approvalCount > 0 || (args.reviewCount ?? 0) > 0) {
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
    businessExecutionContext: Map<string, BusinessExecutionContext>;
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
      [
        ...[args.engineBundle, ...args.businessBundles].flatMap((bundle) => [
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
        ]),
        ...args.businesses.flatMap((business) => {
          const clipbaitersContext = args.businessExecutionContext.get(business.id)?.clipbaiters;
          if (!clipbaitersContext) {
            return [];
          }

          return [
            ensureDir(path.dirname(clipbaitersContext.launchChecklistPath)).then(() =>
              writeTextFile(
                clipbaitersContext.launchChecklistPath,
                this.toClipBaitersLaunchChecklist({
                  business,
                  context: clipbaitersContext
                })
              )
            )
          ];
        })
      ]
    );

    return {
      controlPlaneJsonPath,
      controlPlaneMarkdownPath,
      officeViewsJsonPath,
      officeViewsMarkdownPath,
      blueprintDirPath: this.blueprintDir
    };
  }

  private toClipBaitersLaunchChecklist(args: {
    business: ManagedBusiness;
    context: ClipBaitersBusinessExecutionContext;
  }): string {
    const plan = args.context.plan;
    const editorialLaneId = plan?.primaryEditorialLaneId ?? CLIPBAITERS_PRIMARY_LANE_ID;
    const revenueLaneId = plan?.primaryRevenueLaneId ?? editorialLaneId;
    const editorialLane = plan?.laneRegistry.lanes.find((lane) => lane.id === editorialLaneId);
    const revenueLane = plan?.laneRegistry.lanes.find((lane) => lane.id === revenueLaneId);
    const watchlistCount =
      args.context.watchlistState?.watchlists.filter((watchlist) => watchlist.laneId === editorialLaneId).length ?? 0;
    const discoveryCount =
      args.context.discoveryState?.videos.filter((video) => video.laneId === editorialLaneId).length ?? 0;
    const skimCount =
      args.context.skimState?.summaries.filter((summary) => summary.laneId === editorialLaneId).length ?? 0;
    const radarLane = args.context.radarState?.lanes.find((lane) => lane.laneId === editorialLaneId);
    const storyLane = args.context.storyState?.lanes.find((lane) => lane.laneId === editorialLaneId);
    const autonomy = args.context.autonomySnapshot;
    const queueItems = args.context.publishingQueueState?.items ?? [];
    const postingSchedule = args.context.postingScheduleState;
    const publishHistoryEntries = args.context.publishHistoryState?.entries ?? [];
    const reviewQueueCount = queueItems.filter(
      (item) => item.reviewRequired || item.status === "awaiting_review"
    ).length;
    const missingToolingCount = autonomy?.tooling.filter((tool) => !tool.available).length ?? 0;
    const blockedQueueCount = queueItems.filter(
      (item) => item.status === "blocked" || item.status === "failed"
    ).length;
    const renderReadyCount = queueItems.filter((item) => item.renderReady).length;
    const scheduledQueueCount = queueItems.filter((item) => Boolean(item.scheduledWindowLabel)).length;
    const nextScheduledWindow = queueItems
      .filter((item) => Boolean(item.scheduledWindowLabel) && item.status !== "live")
      .map((item) => item.scheduledFor)
      .sort()
      .at(0);
    const roadblockNotifiedAt = args.context.roadblockNotificationState?.notifiedAt;
    const creatorLeadCount = args.context.creatorLeadState?.leads.length ?? 0;
    const creatorOutreachCount = args.context.creatorOutreachState?.drafts.length ?? 0;
    const offers = args.context.offersState?.offers ?? [];
    const paymentLinkReadyCount = offers.filter(
      (offer) => offer.status === "payment_link_ready"
    ).length;
    const orders = args.context.ordersState?.orders ?? [];
    const pendingPaymentCount = orders.filter(
      (order) => order.paymentStatus === "pending"
    ).length;
    const latestRevenueSnapshot = [...(args.context.revenueState?.snapshots ?? [])].sort(
      (left, right) => right.generatedAt.localeCompare(left.generatedAt)
    )[0];
    const activeLaneIds = new Set(plan?.laneRegistry.activeLaneIds ?? []);
    const activeYoutubeProfiles = (plan?.socialPresence ?? []).filter(
      (profile) =>
        profile.platform === "youtube_channel" &&
        Boolean(profile.laneId && activeLaneIds.has(profile.laneId))
    );
    const liveActiveYoutubeProfileCount = activeYoutubeProfiles.filter(
      (profile) => profile.status === "live"
    ).length;
    const pendingActiveYoutubeProfileCount = activeYoutubeProfiles.filter(
      (profile) => profile.status !== "live"
    ).length;
    const stripeConfigured = Boolean(
      this.config.clipbaiters.finance.stripe.accountId ||
        this.config.clipbaiters.finance.stripe.publishableKey ||
        this.config.clipbaiters.finance.stripe.secretKey
    );
    const relayConfigured = Boolean(
      this.config.clipbaiters.finance.relay.checkingLabel ||
        this.config.clipbaiters.finance.relay.checkingLast4
    );
    const openBlockers = uniqueStrings([
      ...(plan?.roadblocks.map((roadblock) => roadblock.summary) ?? []),
      ...(plan?.status === "blocked"
        ? ["The plan is still blocked and needs owner action before the lane can be treated as operational."]
        : []),
      ...(plan?.roadblocks.length && !roadblockNotifiedAt
        ? ["Roadblock notification has not been sent for the current blocking set."]
        : []),
      ...(reviewQueueCount > 0
        ? [
            `${reviewQueueCount} publish queue item(s) still require manual review before any upload can go live.`
          ]
        : []),
      ...(blockedQueueCount > 0
        ? [`${blockedQueueCount} publish queue item(s) are blocked or failed.`]
        : []),
      ...(scheduledQueueCount === 0 && queueItems.length > 0
        ? ["No randomized posting windows are allocated for the current publish queue."]
        : []),
      ...(renderReadyCount === 0 && queueItems.length > 0
        ? ["No rendered clips are ready for the current publish queue."]
        : []),
      ...(autonomy?.status === "blocked"
        ? [autonomy.nextStep || "Autonomy is blocked and needs tooling or source fixes."]
        : []),
      ...(missingToolingCount > 0
        ? [`${missingToolingCount} worker tooling dependency(ies) are unavailable.`]
        : []),
      ...(pendingPaymentCount > 0
        ? [`${pendingPaymentCount} creator order(s) are still pending payment collection.`]
        : [])
    ]);

    const readinessChecks = [
      `${plan && plan.status !== "blocked" ? "[x]" : "[ ]"} Automation plan, lane registry, and source registry are in place`,
      `${plan?.roadblocks.length === 0 || roadblockNotifiedAt ? "[x]" : "[ ]"} Roadblock notification state is current for the latest plan`,
      `${watchlistCount > 0 && discoveryCount > 0 && skimCount > 0 ? "[x]" : "[ ]"} Collect and skim artifacts are present for ${editorialLane?.name ?? editorialLaneId}`,
      `${radarLane && storyLane ? "[x]" : "[ ]"} Radar and story artifacts are available for ${editorialLane?.name ?? editorialLaneId}`,
      `${pendingActiveYoutubeProfileCount === 0 && activeYoutubeProfiles.length > 0 ? "[x]" : "[ ]"} Active YouTube lane bindings are live for the current rollout set`,
      `${autonomy && autonomy.status !== "blocked" && missingToolingCount === 0 ? "[x]" : "[ ]"} Worker tooling is ready for rendered autonomy clipping`,
      `${renderReadyCount > 0 ? "[x]" : "[ ]"} Rendered clips exist for the current publish queue`,
      `${scheduledQueueCount > 0 ? "[x]" : "[ ]"} Randomized peak posting windows are allocated in the schedule artifact`,
      `${reviewQueueCount === 0 && blockedQueueCount === 0 ? "[x]" : "[ ]"} Review queue is clear enough for approved uploads without bypassing manual gates`,
      `${creatorLeadCount > 0 || creatorOutreachCount > 0 ? "[x]" : "[ ]"} Creator deals pipeline has lead or outreach coverage for ${revenueLane?.name ?? revenueLaneId}`,
      `${offers.length > 0 && args.context.revenueState?.snapshots.length ? "[x]" : "[ ]"} Direct monetization artifacts are present for ${revenueLane?.name ?? revenueLaneId}`,
      `[x] Isolated worker command is pinned to scripts/business-worker-start.sh ${args.business.id} "${args.business.name}"`
    ];

    const lines = [
      "# ClipBaiters Launch Checklist",
      "",
      `- Generated: ${nowIso()}`,
      `- Business: ${args.business.name}`,
      `- Editorial lane: ${editorialLane?.name ?? editorialLaneId}`,
      `- Revenue lane: ${revenueLane?.name ?? revenueLaneId}`,
      `- Active YouTube rollout: ${activeYoutubeProfiles.map((profile) => profile.laneName ?? profile.laneId ?? profile.profileId).join(", ") || "None configured"}`,
      "- Review posture: Scheduled publishing stays dry-run until manual review clears rights-sensitive items.",
      "",
      "## Readiness",
      ...readinessChecks,
      "",
      "## Current state",
      `- Source watchlists: ${watchlistCount}`,
      `- Discovery items: ${discoveryCount}`,
      `- Skim summaries: ${skimCount}`,
      `- Radar candidates: ${radarLane?.candidateCount ?? 0}`,
      `- Story candidates: ${storyLane?.stories.length ?? 0}`,
      `- Draft clip jobs: ${autonomy?.clipJobCount ?? 0}`,
      `- Rendered clip jobs: ${autonomy?.renderedClipCount ?? 0}`,
      `- Publish queue review items: ${reviewQueueCount}`,
      `- Scheduled queue items: ${scheduledQueueCount}`,
      `- Next posting window: ${nextScheduledWindow ?? "Not allocated"}`,
      `- Roadblock notification sent: ${roadblockNotifiedAt ?? "Not yet sent"}`,
      `- Live upload history entries: ${publishHistoryEntries.filter((entry) => entry.status === "live").length}`,
      `- Creator leads: ${creatorLeadCount}`,
      `- Creator outreach drafts: ${creatorOutreachCount}`,
      `- Payment links ready: ${paymentLinkReadyCount}`,
      `- Active YouTube channels live: ${liveActiveYoutubeProfileCount}/${activeYoutubeProfiles.length}`,
      `- Shared Stripe recorded: ${stripeConfigured ? "yes" : "no"}`,
      `- Relay cashout route recorded: ${relayConfigured ? "yes" : "no"}`,
      `- Latest booked revenue: $${(latestRevenueSnapshot?.bookedRevenueUsd ?? 0).toFixed(2)}`,
      "",
      "## Scheduled cadence",
      `- npm run dev -- clipbaiters-plan --business ${args.business.id} --notify-roadblocks`,
      `- npm run dev -- clipbaiters-collect --business ${args.business.id}`,
      `- npm run dev -- clipbaiters-skim --business ${args.business.id}`,
      `- npm run dev -- clipbaiters-autonomy-run --business ${args.business.id} --all-active-lanes${args.business.stage === "scaffolded" ? " --dry-run" : ""}`,
      `- npm run dev -- clipbaiters-publish --business ${args.business.id} --all-active-lanes${renderReadyCount > 0 && blockedQueueCount === 0 ? "" : " --dry-run"}`,
      `- npm run dev -- clipbaiters-source-creators --business ${args.business.id}`,
      `- npm run dev -- clipbaiters-draft-creator-outreach --business ${args.business.id}`,
      `- npm run dev -- clipbaiters-deals-report --business ${args.business.id}`,
      `- npm run dev -- clipbaiters-monetization-report --business ${args.business.id}`,
      "",
      "## Key artifacts",
      `- Plan: ${this.relativeArtifactPath(args.context.planMarkdownPath)}`,
      `- Roadblock email: ${this.relativeArtifactPath(args.context.roadblockEmailPath)}`,
      `- Daily brief: ${this.relativeArtifactPath(args.context.dailyBriefPath)}`,
      `- Daily summary: ${this.relativeArtifactPath(args.context.dailySummaryPath)}`,
      `- Autonomy summary: ${this.relativeArtifactPath(args.context.autonomySummaryPath)}`,
      `- Posting schedule: ${this.relativeArtifactPath(args.context.postingSchedulePath)}`,
      `- Review queue: ${this.relativeArtifactPath(args.context.reviewQueuePath)}`,
      `- Creator deals report: ${this.relativeArtifactPath(args.context.creatorDealsReportPath)}`,
      `- Monetization report: ${this.relativeArtifactPath(args.context.monetizationReportPath)}`,
      "",
      "## Open blockers",
      ...(openBlockers.length > 0 ? openBlockers.map((blocker) => `- ${blocker}`) : ["- None currently flagged by the control plane."])
    ];

    return `${lines.join("\n")}\n`;
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
