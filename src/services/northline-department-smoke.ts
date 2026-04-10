import path from "node:path";
import type { AppConfig } from "../config.js";
import type { ManagedBusiness } from "../domain/engine.js";
import type {
  ApprovalRiskLevel,
  DepartmentExecutionItem,
  DepartmentWorkspaceView,
  OfficePanelSummary,
  OfficeViewSnapshot,
  OrgAuditRecord,
  TaskEnvelope
} from "../domain/org.js";
import { ensureDir, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { FileStore } from "../storage/store.js";
import { ImonEngineAgent } from "../agents/imon-engine.js";
import { northlineBusinessOpsDir } from "./northline-business-profile.js";

type SmokeCheckStatus = "passed" | "failed" | "skipped";
type SmokeStatus = "passed" | "attention" | "failed";

export type NorthlineDepartmentSmokeCase = {
  workflowId: string;
  departmentName: string;
  executionTitle: string;
  expectedPosition: string;
  expectedRiskLevel: ApprovalRiskLevel;
  requestedTools: string[];
  allowedTools: string[];
  deniedTools: string[];
};

export const NORTHLINE_DEPARTMENT_SMOKE_CASES: readonly NorthlineDepartmentSmokeCase[] = [
  {
    workflowId: "business-governance",
    departmentName: "Executive / Management",
    executionTitle: "Business Governance",
    expectedPosition: "General Manager / Brand Director",
    expectedRiskLevel: "high",
    requestedTools: ["business-registry", "approvals", "scheduler"],
    allowedTools: ["business-registry", "approvals"],
    deniedTools: ["scheduler"]
  },
  {
    workflowId: "business-ops",
    departmentName: "Operations",
    executionTitle: "Business Operations",
    expectedPosition: "Operations Manager",
    expectedRiskLevel: "low",
    requestedTools: ["scheduler", "runtime-ops", "money_movement"],
    allowedTools: ["scheduler", "runtime-ops"],
    deniedTools: ["money_movement"]
  },
  {
    workflowId: "growth-publishing",
    departmentName: "Marketing / Growth",
    executionTitle: "Growth Publishing",
    expectedPosition: "Growth And Marketing Manager",
    expectedRiskLevel: "medium",
    requestedTools: ["growth-queue", "social-posting", "org-control-plane"],
    allowedTools: ["growth-queue", "social-posting"],
    deniedTools: ["org-control-plane"]
  },
  {
    workflowId: "product-production",
    departmentName: "Product / Content",
    executionTitle: "Client Delivery Production",
    expectedPosition: "Product / Content Lead",
    expectedRiskLevel: "low",
    requestedTools: ["qa", "reports", "growth-queue"],
    allowedTools: ["qa", "reports"],
    deniedTools: ["growth-queue"]
  },
  {
    workflowId: "finance-allocation-reporting",
    departmentName: "Finance",
    executionTitle: "Business Finance Reporting",
    expectedPosition: "Finance Lead",
    expectedRiskLevel: "high",
    requestedTools: ["revenue-report", "collective-fund-report", "public_post"],
    allowedTools: ["revenue-report", "collective-fund-report"],
    deniedTools: ["public_post"]
  },
  {
    workflowId: "analytics-reporting",
    departmentName: "Analytics / Research",
    executionTitle: "Analytics Reporting",
    expectedPosition: "Analytics And Research Lead",
    expectedRiskLevel: "low",
    requestedTools: ["reports", "analytics", "public_post"],
    allowedTools: ["reports", "analytics"],
    deniedTools: ["public_post"]
  },
  {
    workflowId: "support-qa",
    departmentName: "Customer Support / QA",
    executionTitle: "Support And QA",
    expectedPosition: "Customer Support And QA Lead",
    expectedRiskLevel: "medium",
    requestedTools: ["support", "qa", "growth-queue"],
    allowedTools: ["support", "qa"],
    deniedTools: ["growth-queue"]
  }
];

export interface NorthlineDepartmentSmokeCheck {
  id: string;
  status: SmokeCheckStatus;
  summary: string;
  details: string[];
}

export interface NorthlineDepartmentRouteDrill {
  status: SmokeCheckStatus;
  envelopeId?: string;
  auditRecordId?: string;
  riskLevel?: ApprovalRiskLevel;
  details: string[];
}

export interface NorthlineDepartmentSmokeDepartmentResult {
  departmentName: string;
  workflowId: string;
  executionTitle: string;
  panelStatus?: string;
  workspaceStatus: string;
  executionItemStatus?: DepartmentExecutionItem["status"];
  assignedWorkerLabel?: string;
  approvalCount: number;
  blockerCount: number;
  alerts: string[];
  blockers: string[];
  metrics: string[];
  artifacts: string[];
  checks: NorthlineDepartmentSmokeCheck[];
  routeDrill: NorthlineDepartmentRouteDrill;
  status: SmokeStatus;
}

export interface NorthlineDepartmentSmokeResult {
  businessId: string;
  businessName: string;
  generatedAt: string;
  status: SmokeStatus;
  summary: string;
  businessOffice: {
    title: string;
    summary: string;
    templateProfile: string;
    departmentCount: number;
    workerCount: number;
    handoffCount: number;
    approvalCount: number;
    roadblocks: string[];
    alerts: string[];
  };
  routeDrills: {
    status: SmokeCheckStatus;
    attempted: number;
    passed: number;
    failed: number;
    restoredState: boolean;
    summary: string;
  };
  departments: NorthlineDepartmentSmokeDepartmentResult[];
  artifacts: {
    jsonPath: string;
    markdownPath: string;
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function nowIso(): string {
  return new Date().toISOString();
}

function deriveWorkspaceStatus(workspace: DepartmentWorkspaceView): string {
  if (
    workspace.roadblocks.length > 0 ||
    workspace.executionItems.some((item) => item.status === "blocked")
  ) {
    return "blocked";
  }
  if (
    workspace.approvalTasks.length > 0 ||
    workspace.executionItems.some((item) => item.status === "review")
  ) {
    return "review";
  }
  if (workspace.executionItems.some((item) => item.status === "running")) {
    return "active";
  }
  if (
    workspace.executionItems.length > 0 &&
    workspace.executionItems.every((item) => item.status === "done")
  ) {
    return "done";
  }
  return "queued";
}

function departmentStatus(args: {
  checks: NorthlineDepartmentSmokeCheck[];
  workspaceStatus: string;
  panelStatus?: string;
  blockers: string[];
}): SmokeStatus {
  if (args.checks.some((check) => check.status === "failed")) {
    return "failed";
  }
  if (
    args.workspaceStatus === "blocked" ||
    args.workspaceStatus === "review" ||
    args.blockers.length > 0 ||
    args.panelStatus === "attention-needed"
  ) {
    return "attention";
  }
  return "passed";
}

function workspaceForDepartment(
  workspaces: DepartmentWorkspaceView[],
  departmentName: string
): DepartmentWorkspaceView | undefined {
  return workspaces.find(
    (workspace) => workspace.title === `${departmentName} Department Workspace`
  );
}

function panelForDepartment(
  panels: OfficePanelSummary[],
  departmentName: string
): OfficePanelSummary | undefined {
  return panels.find((panel) => panel.title === departmentName);
}

function latestAuditForTask(
  audits: OrgAuditRecord[],
  taskEnvelopeId: string,
  workflowId: string
): OrgAuditRecord | undefined {
  return [...audits]
    .filter(
      (record) =>
        record.taskEnvelopeId === taskEnvelopeId && record.workflowId === workflowId
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export class NorthlineDepartmentSmokeService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore,
    private readonly imonEngine: ImonEngineAgent
  ) {}

  async run(options?: {
    businessId?: string;
    routeDrills?: boolean;
  }): Promise<NorthlineDepartmentSmokeResult> {
    const businessId = options?.businessId ?? "auto-funding-agency";
    const routeDrillsEnabled = options?.routeDrills !== false;
    const generatedAt = nowIso();

    const business = await this.store.getManagedBusiness(businessId);
    if (!business) {
      throw new Error(`Northline department smoke could not find business ${businessId}.`);
    }
    if (business.category !== "client_services_agency") {
      throw new Error(
        `Northline department smoke only supports client_services_agency lanes, but ${businessId} is ${business.category}.`
      );
    }

    const snapshot = await this.resolveSnapshot();
    const businessOffice = snapshot.businessViews.find((view) => view.businessId === businessId);
    if (!businessOffice) {
      throw new Error(`No business office snapshot exists for ${businessId}.`);
    }

    const workspaces = snapshot.departmentWorkspaces.filter(
      (workspace) => workspace.businessId === businessId
    );
    const taskEnvelopeBaseline = await this.store.getTaskEnvelopes();
    const auditBaseline = await this.store.getOrgAuditRecords();
    const routeDrills = routeDrillsEnabled
      ? await this.runRouteDrills({
          businessId,
          generatedAt,
          taskEnvelopeBaseline,
          auditBaseline
        })
      : {
          byWorkflowId: new Map<string, NorthlineDepartmentRouteDrill>(),
          attempted: 0,
          passed: 0,
          failed: 0,
          restoredState: true,
          status: "skipped" as SmokeCheckStatus,
          summary: "Route drills were skipped; snapshot inspection only."
        };

    const departments = NORTHLINE_DEPARTMENT_SMOKE_CASES.map((smokeCase) => {
      const panel = panelForDepartment(businessOffice.departments, smokeCase.departmentName);
      const workspace = workspaceForDepartment(workspaces, smokeCase.departmentName);
      const executionItem = workspace?.executionItems.find(
        (item) => item.workflowId === smokeCase.workflowId
      );
      const routeDrill = routeDrills.byWorkflowId.get(smokeCase.workflowId) ?? {
        status: routeDrillsEnabled ? "failed" : "skipped",
        details: routeDrillsEnabled
          ? ["No route-drill result was recorded for this workflow."]
          : ["Route drills were skipped for this run."]
      };
      const checks: NorthlineDepartmentSmokeCheck[] = [
        {
          id: "workspace-present",
          status: workspace ? "passed" : "failed",
          summary: workspace
            ? `${smokeCase.departmentName} workspace is present in the office snapshot.`
            : `${smokeCase.departmentName} workspace is missing from the office snapshot.`,
          details: workspace ? [workspace.title] : []
        },
        {
          id: "execution-item-present",
          status: executionItem ? "passed" : "failed",
          summary: executionItem
            ? `${smokeCase.executionTitle} is present in the department workspace.`
            : `${smokeCase.executionTitle} is missing from the department workspace.`,
          details: executionItem
            ? [
                `Execution status: ${executionItem.status}`,
                `Assigned worker: ${executionItem.assignedWorkerLabel}`
              ]
            : []
        },
        {
          id: "runtime-signals-present",
          status:
            executionItem && executionItem.artifacts.length > 0 && executionItem.metrics.length > 0
              ? "passed"
              : "failed",
          summary:
            executionItem && executionItem.artifacts.length > 0 && executionItem.metrics.length > 0
              ? `${smokeCase.departmentName} exposes live artifacts and metrics.`
              : `${smokeCase.departmentName} does not expose enough runtime signals yet.`,
          details: executionItem
            ? [
                ...executionItem.artifacts.slice(0, 3),
                ...executionItem.metrics.slice(0, 3)
              ]
            : []
        },
        {
          id: "route-drill",
          status: routeDrill.status,
          summary:
            routeDrill.status === "passed"
              ? `${smokeCase.departmentName} accepted an internal routing drill and restored state cleanly.`
              : routeDrill.status === "skipped"
                ? `${smokeCase.departmentName} route drill was skipped for this run.`
                : `${smokeCase.departmentName} failed the internal routing drill.`,
          details: routeDrill.details
        }
      ];

      return {
        departmentName: smokeCase.departmentName,
        workflowId: smokeCase.workflowId,
        executionTitle: smokeCase.executionTitle,
        panelStatus: panel?.status,
        workspaceStatus: workspace ? deriveWorkspaceStatus(workspace) : "missing",
        executionItemStatus: executionItem?.status,
        assignedWorkerLabel: executionItem?.assignedWorkerLabel,
        approvalCount: workspace?.approvalTasks.length ?? 0,
        blockerCount: uniqueStrings([
          ...(workspace?.roadblocks ?? []),
          ...(executionItem?.blockers ?? [])
        ]).length,
        alerts: workspace?.alerts ?? [],
        blockers: uniqueStrings([
          ...(workspace?.roadblocks ?? []),
          ...(executionItem?.blockers ?? [])
        ]),
        metrics: executionItem?.metrics ?? workspace?.metrics ?? [],
        artifacts: executionItem?.artifacts ?? [],
        checks,
        routeDrill,
        status: departmentStatus({
          checks,
          workspaceStatus: workspace ? deriveWorkspaceStatus(workspace) : "missing",
          panelStatus: panel?.status,
          blockers: uniqueStrings([
            ...(workspace?.roadblocks ?? []),
            ...(executionItem?.blockers ?? [])
          ])
        })
      } satisfies NorthlineDepartmentSmokeDepartmentResult;
    });

    const status: SmokeStatus = departments.some((department) => department.status === "failed")
      ? "failed"
      : businessOffice.roadblocks.length > 0 ||
          departments.some((department) => department.status === "attention")
        ? "attention"
        : "passed";
    const artifacts = await this.writeArtifacts({
      business,
      businessOffice,
      departments,
      routeDrills,
      generatedAt,
      status,
      businessId
    });
    const summary =
      status === "passed"
        ? `Northline department smoke passed for ${business.name}; ${routeDrills.passed}/${routeDrills.attempted} internal drills succeeded with clean state restoration.`
        : status === "attention"
          ? `Northline department smoke passed with operational attention for ${business.name}; ${routeDrills.passed}/${routeDrills.attempted} internal drills succeeded, but ${businessOffice.roadblocks.length} business roadblock(s) remain.`
          : `Northline department smoke failed for ${business.name}; ${routeDrills.failed} internal drill(s) did not complete cleanly.`;

    return {
      businessId,
      businessName: business.name,
      generatedAt,
      status,
      summary,
      businessOffice: {
        title: businessOffice.title,
        summary: businessOffice.summary,
        templateProfile: businessOffice.templateProfile,
        departmentCount: businessOffice.departments.length,
        workerCount: businessOffice.workers.length,
        handoffCount: businessOffice.handoffs.length,
        approvalCount: businessOffice.approvalTasks.length,
        roadblocks: [...businessOffice.roadblocks],
        alerts: [...businessOffice.alerts]
      },
      routeDrills: {
        status: routeDrills.status,
        attempted: routeDrills.attempted,
        passed: routeDrills.passed,
        failed: routeDrills.failed,
        restoredState: routeDrills.restoredState,
        summary: routeDrills.summary
      },
      departments,
      artifacts
    };
  }

  private async resolveSnapshot(): Promise<OfficeViewSnapshot> {
    const latest = await this.imonEngine.getLatestOfficeSnapshot();
    if (latest) {
      return latest;
    }
    return this.imonEngine.syncOrganization();
  }

  private async runRouteDrills(args: {
    businessId: string;
    generatedAt: string;
    taskEnvelopeBaseline: TaskEnvelope[];
    auditBaseline: OrgAuditRecord[];
  }): Promise<{
    byWorkflowId: Map<string, NorthlineDepartmentRouteDrill>;
    attempted: number;
    passed: number;
    failed: number;
    restoredState: boolean;
    status: SmokeCheckStatus;
    summary: string;
  }> {
    const byWorkflowId = new Map<string, NorthlineDepartmentRouteDrill>();
    const attempted = NORTHLINE_DEPARTMENT_SMOKE_CASES.length;
    let passed = 0;
    let failed = attempted;
    let restoredState = false;
    let status: SmokeCheckStatus = "failed";
    let summary = "No route drills completed.";

    try {
      const routed = await Promise.allSettled(
        NORTHLINE_DEPARTMENT_SMOKE_CASES.map((smokeCase) =>
          this.imonEngine.routeTask({
            workflowId: smokeCase.workflowId,
            businessId: args.businessId,
            title: `Northline ${smokeCase.departmentName} smoke drill ${args.generatedAt}`,
            summary: `Validate ${smokeCase.departmentName} routing, worker scope, and file-backed persistence without touching customer-facing state.`,
            requestedTools: [...smokeCase.requestedTools]
          })
        )
      );
      const taskEnvelopes = await this.store.getTaskEnvelopes();
      const audits = await this.store.getOrgAuditRecords();
      failed = 0;

      for (const [index, smokeCase] of NORTHLINE_DEPARTMENT_SMOKE_CASES.entries()) {
        const result = routed[index];
        if (!result || result.status === "rejected") {
          failed += 1;
          byWorkflowId.set(smokeCase.workflowId, {
            status: "failed",
            details: [
              result?.status === "rejected"
                ? result.reason instanceof Error
                  ? result.reason.message
                  : String(result.reason)
                : "The routing drill did not return a result."
            ]
          });
          continue;
        }

        const routedTask = result.value;
        const persistedEnvelope = taskEnvelopes.find(
          (envelope) => envelope.id === routedTask.envelope.id
        );
        const audit = latestAuditForTask(
          audits,
          routedTask.envelope.id,
          smokeCase.workflowId
        );
        const allowedToolsPresent = smokeCase.allowedTools.every((tool) =>
          routedTask.envelope.allowedTools.includes(tool)
        );
        const deniedToolsBlocked = smokeCase.deniedTools.every(
          (tool) => !routedTask.envelope.allowedTools.includes(tool)
        );
        const memoryScoped = routedTask.envelope.allowedMemoryNamespaces.every(
          (namespace) =>
            namespace.includes(`business/${args.businessId}`) &&
            !namespace.includes("business/imon-digital-asset-store") &&
            !namespace.includes("business/imon-pod-store")
        );
        const positionMatched = routedTask.owner?.positionName === smokeCase.expectedPosition;
        const riskMatched = routedTask.approvalRoute.riskLevel === smokeCase.expectedRiskLevel;
        const passedRouteDrill =
          Boolean(persistedEnvelope) &&
          Boolean(audit) &&
          allowedToolsPresent &&
          deniedToolsBlocked &&
          memoryScoped &&
          positionMatched &&
          riskMatched;

        if (passedRouteDrill) {
          passed += 1;
        } else {
          failed += 1;
        }

        byWorkflowId.set(smokeCase.workflowId, {
          status: passedRouteDrill ? "passed" : "failed",
          envelopeId: routedTask.envelope.id,
          auditRecordId: audit?.id,
          riskLevel: routedTask.approvalRoute.riskLevel,
          details: [
            `Owner: ${routedTask.owner?.positionName ?? "unresolved"}`,
            `Envelope persisted: ${persistedEnvelope ? "yes" : "no"}`,
            `Audit persisted: ${audit ? "yes" : "no"}`,
            `Allowed tools honored: ${allowedToolsPresent ? "yes" : "no"}`,
            `Denied tools blocked: ${deniedToolsBlocked ? "yes" : "no"}`,
            `Memory scoped to ${args.businessId}: ${memoryScoped ? "yes" : "no"}`,
            `Expected risk level ${smokeCase.expectedRiskLevel}: ${riskMatched ? "yes" : "no"}`
          ]
        });
      }

      status = failed > 0 ? "failed" : "passed";
      summary =
        failed > 0
          ? `${passed}/${attempted} route drills passed before state restoration.`
          : `All ${attempted} route drills passed before state restoration.`;
    } finally {
      await this.store.replaceTaskEnvelopes(args.taskEnvelopeBaseline);
      await this.store.replaceOrgAuditRecords(args.auditBaseline);
      restoredState = true;
    }

    return {
      byWorkflowId,
      attempted,
      passed,
      failed,
      restoredState,
      status,
      summary
    };
  }

  private async writeArtifacts(args: {
    business: ManagedBusiness;
    businessOffice: NorthlineDepartmentSmokeResult["businessOffice"] | {
      title: string;
      summary: string;
      templateProfile: string;
      roadblocks: string[];
      alerts: string[];
      departments: OfficePanelSummary[];
      workers: unknown[];
      handoffs: unknown[];
      approvalTasks: unknown[];
    };
    departments: NorthlineDepartmentSmokeDepartmentResult[];
    routeDrills: {
      attempted: number;
      passed: number;
      failed: number;
      restoredState: boolean;
      summary: string;
      status: SmokeCheckStatus;
    };
    generatedAt: string;
    status: SmokeStatus;
    businessId: string;
  }): Promise<{ jsonPath: string; markdownPath: string }> {
    const baseDir = northlineBusinessOpsDir(this.config, args.businessId);
    await ensureDir(baseDir);

    const jsonPath = path.join(baseDir, "department-smoke.json");
    const markdownPath = path.join(baseDir, "department-smoke.md");
    const payload = {
      businessId: args.businessId,
      businessName: args.business.name,
      generatedAt: args.generatedAt,
      status: args.status,
      businessOffice: {
        title: args.businessOffice.title,
        summary: args.businessOffice.summary,
        templateProfile: args.businessOffice.templateProfile,
        roadblocks: [...args.businessOffice.roadblocks],
        alerts: [...args.businessOffice.alerts],
        departmentCount:
          "departments" in args.businessOffice
            ? args.businessOffice.departments.length
            : (args.businessOffice as NorthlineDepartmentSmokeResult["businessOffice"]).departmentCount,
        workerCount:
          "workers" in args.businessOffice
            ? args.businessOffice.workers.length
            : (args.businessOffice as NorthlineDepartmentSmokeResult["businessOffice"]).workerCount,
        handoffCount:
          "handoffs" in args.businessOffice
            ? args.businessOffice.handoffs.length
            : (args.businessOffice as NorthlineDepartmentSmokeResult["businessOffice"]).handoffCount,
        approvalCount:
          "approvalTasks" in args.businessOffice
            ? args.businessOffice.approvalTasks.length
            : (args.businessOffice as NorthlineDepartmentSmokeResult["businessOffice"]).approvalCount
      },
      routeDrills: args.routeDrills,
      departments: args.departments
    };

    await writeJsonFile(jsonPath, payload);
    await writeTextFile(markdownPath, this.markdownSummary({
      businessName: args.business.name,
      generatedAt: args.generatedAt,
      status: args.status,
      roadblocks: [...args.businessOffice.roadblocks],
      routeDrills: args.routeDrills,
      departments: args.departments
    }));

    return {
      jsonPath,
      markdownPath
    };
  }

  private markdownSummary(args: {
    businessName: string;
    generatedAt: string;
    status: SmokeStatus;
    roadblocks: string[];
    routeDrills: {
      attempted: number;
      passed: number;
      failed: number;
      restoredState: boolean;
      summary: string;
      status: SmokeCheckStatus;
    };
    departments: NorthlineDepartmentSmokeDepartmentResult[];
  }): string {
    return [
      "# Northline Department Smoke",
      "",
      `- Business: ${args.businessName}`,
      `- Generated at: ${args.generatedAt}`,
      `- Status: ${args.status}`,
      `- Route drills: ${args.routeDrills.passed}/${args.routeDrills.attempted} passed (${args.routeDrills.status})`,
      `- Route state restored: ${args.routeDrills.restoredState ? "yes" : "no"}`,
      `- Business roadblocks: ${args.roadblocks.length}`,
      ...(args.roadblocks.length > 0 ? args.roadblocks.map((roadblock) => `  - ${roadblock}`) : []),
      "",
      "## Departments",
      "",
      ...args.departments.flatMap((department) => [
        `### ${department.departmentName}`,
        `- Status: ${department.status}`,
        `- Panel status: ${department.panelStatus ?? "missing"}`,
        `- Workspace status: ${department.workspaceStatus}`,
        `- Execution: ${department.executionTitle} (${department.executionItemStatus ?? "missing"})`,
        `- Worker: ${department.assignedWorkerLabel ?? "missing"}`,
        `- Route drill: ${department.routeDrill.status}`,
        ...(department.blockers.length > 0
          ? department.blockers.map((blocker) => `- Blocker: ${blocker}`)
          : ["- Blocker: none"]),
        ...(department.checks.map(
          (check) => `- Check ${check.id}: ${check.status} - ${check.summary}`
        )),
        ""
      ])
    ].join("\n");
  }
}