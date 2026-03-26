import path from "node:path";
import type { AppConfig } from "../config.js";
import { DEFAULT_IMON_ENGINE, DEFAULT_MANAGED_BUSINESSES } from "../domain/defaults.js";
import type { ApprovalTask } from "../domain/contracts.js";
import type {
  EngineOverviewReport,
  ImonEngineState,
  ManagedBusiness,
  ManagedBusinessSeed,
  VpsResourceSnapshot
} from "../domain/engine.js";
import type { OfficeViewSnapshot, TaskRoutingRequest } from "../domain/org.js";
import { writeJsonFile, writeTextFile } from "../lib/fs.js";
import { FileStore } from "../storage/store.js";
import { AccountOpsAgent } from "./account-ops.js";
import { SystemMonitorService } from "../services/system-monitor.js";
import { OrganizationControlPlaneService } from "../services/organization-control-plane.js";

function nowIso(): string {
  return new Date().toISOString();
}

function sortBusinesses(businesses: ManagedBusiness[]): ManagedBusiness[] {
  return [...businesses].sort((left, right) => left.launchPriority - right.launchPriority);
}

function isVerifiedFinancialSignal(transaction: {
  source: string;
  verificationStatus?: string;
}): boolean {
  if (transaction.verificationStatus) {
    return transaction.verificationStatus === "verified";
  }

  return transaction.source === "gumroad";
}

function isTrustedLedgerSource(source: string): boolean {
  return source === "gumroad";
}

export class ImonEngineAgent {
  private readonly accountOps: AccountOpsAgent;

  private readonly monitor: SystemMonitorService;

  private readonly orgControlPlane: OrganizationControlPlaneService;

  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {
    this.accountOps = new AccountOpsAgent(config, store);
    this.monitor = new SystemMonitorService(config);
    this.orgControlPlane = new OrganizationControlPlaneService(config, store);
  }

  async bootstrap(): Promise<EngineOverviewReport> {
    await this.ensureEngineState();
    const businesses = await this.seedManagedBusinesses();
    await this.ensureBusinessApprovals(businesses);
    return this.sync();
  }

  async sync(): Promise<EngineOverviewReport> {
    const engine = await this.ensureEngineState();
    await this.seedManagedBusinesses();
    const businesses = await this.getPortfolioBusinesses();
    await this.ensureBusinessApprovals(businesses);
    const snapshot = await this.monitor.captureSnapshot({
      activeBusinesses: businesses.filter((business) => business.stage === "active").length,
      readyBusinesses: businesses.filter((business) => business.stage === "ready").length
    });
    await this.store.saveResourceSnapshot(snapshot);

    const nextEngine = this.updateEngineState(engine, businesses, snapshot);
    await this.store.saveEngineState(nextEngine);

    const report = this.buildOverviewReport(nextEngine, businesses, snapshot);
    await this.store.saveEngineReport(report);
    await this.orgControlPlane.sync(nextEngine, businesses);
    await writeJsonFile(path.join(this.config.reportDir, `${report.id}.json`), report);
    await writeJsonFile(path.join(this.config.opsDir, "engine-overview.json"), report);
    await writeJsonFile(path.join(this.config.opsDir, "business-roster.json"), businesses);
    return report;
  }

  async getPortfolioBusinesses(): Promise<ManagedBusiness[]> {
    const businesses = await this.refreshPortfolioMetrics(await this.store.getManagedBusinesses());
    return sortBusinesses(businesses);
  }

  async activateBusiness(id: string): Promise<ManagedBusiness> {
    const businesses = await this.getPortfolioBusinesses();
    const business = businesses.find((candidate) => candidate.id === id);
    if (!business) {
      throw new Error(`Business ${id} not found.`);
    }

    if (business.launchBlockers.length > 0) {
      throw new Error(
        `Business ${id} is still blocked: ${business.launchBlockers.join(" ")}`
      );
    }

    if (!["ready", "paused"].includes(business.stage)) {
      throw new Error(`Business ${id} is not ready to activate from stage ${business.stage}.`);
    }

    const snapshot = await this.monitor.captureSnapshot({
      activeBusinesses: businesses.filter((candidate) => candidate.stage === "active").length,
      readyBusinesses: businesses.filter((candidate) => candidate.stage === "ready").length
    });
    const currentlyActive = businesses.filter((candidate) => candidate.stage === "active").length;
    if (currentlyActive >= snapshot.recommendedConcurrency) {
      throw new Error(
        `Cannot activate ${id}. Recommended concurrency is ${snapshot.recommendedConcurrency}, and ${currentlyActive} businesses are already active.`
      );
    }

    const next: ManagedBusiness = {
      ...business,
      stage: "active",
      metrics: {
        ...business.metrics,
        lastRunAt: nowIso()
      },
      updatedAt: nowIso()
    };
    await this.store.saveManagedBusiness(next);
    await this.store.saveBusinessRun({
      id: `run-${id}-${new Date().toISOString().replaceAll(":", "-")}`,
      businessId: id,
      startedAt: next.updatedAt,
      finishedAt: next.updatedAt,
      status: "success",
      summary: `Activated ${business.name}.`,
      cpuUtilizationAtStart: snapshot.estimatedCpuUtilization,
      memoryUtilizationAtStart: snapshot.memoryUtilization
    });
    await this.sync();
    return next;
  }

  async pauseBusiness(id: string): Promise<ManagedBusiness> {
    const business = await this.store.getManagedBusiness(id);
    if (!business) {
      throw new Error(`Business ${id} not found.`);
    }

    const next: ManagedBusiness = {
      ...business,
      stage: "paused",
      updatedAt: nowIso()
    };
    await this.store.saveManagedBusiness(next);
    await this.store.saveBusinessRun({
      id: `run-${id}-${new Date().toISOString().replaceAll(":", "-")}`,
      businessId: id,
      startedAt: next.updatedAt,
      finishedAt: next.updatedAt,
      status: "skipped",
      summary: `Paused ${business.name}.`
    });
    await this.sync();
    return next;
  }

  async writeVpsArtifacts(): Promise<{
    bootstrapScriptPath: string;
    syncScriptPath: string;
    cronPath: string;
    manifestPath: string;
  }> {
    const bootstrapScriptPath = path.join(this.config.opsDir, "bootstrap-vps.sh");
    const syncScriptPath = path.join(this.config.opsDir, "imon-engine-sync.sh");
    const cronPath = path.join(this.config.opsDir, "imon-engine.cron");
    const manifestPath = path.join(this.config.opsDir, "vps-manifest.json");
    const businesses = await this.getPortfolioBusinesses();
    const engine = await this.ensureEngineState();
    await this.orgControlPlane.sync(engine, businesses);

    await writeTextFile(
      bootstrapScriptPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "",
        'APP_ROOT="${APP_ROOT:-/opt/imon-engine}"',
        'NODE_MAJOR="${NODE_MAJOR:-24}"',
        "",
        "apt-get update",
        "apt-get install -y curl ca-certificates git cron",
        'curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -',
        "apt-get install -y nodejs",
        "systemctl enable --now cron || service cron start || true",
        'mkdir -p "$APP_ROOT"',
        'cd "$APP_ROOT"',
        'if [ ! -f package.json ]; then',
        '  echo "Copy or clone the repository into $APP_ROOT before bootstrapping."',
        "  exit 1",
        "fi",
        "npm ci",
        'if [ ! -f .env ]; then cp .env.example .env; fi',
        "npm run build",
        "npm run dev -- bootstrap",
        "npm run dev -- engine-sync"
      ].join("\n")
    );

    await writeTextFile(
      syncScriptPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'APP_ROOT="${APP_ROOT:-/opt/imon-engine}"',
        'cd "$APP_ROOT"',
        "npm run dev -- engine-sync"
      ].join("\n")
    );

    await writeTextFile(
      cronPath,
      [
        "SHELL=/bin/bash",
        "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        `*/30 * * * * root cd /opt/imon-engine && /usr/bin/env bash ${path.posix.join(
          "scripts",
          "imon-engine-sync.sh"
        )} >> /var/log/imon-engine.log 2>&1`
      ].join("\n")
    );

    await writeJsonFile(manifestPath, {
      generatedAt: nowIso(),
      engine,
      businesses
    });

    return {
      bootstrapScriptPath,
      syncScriptPath,
      cronPath,
      manifestPath
    };
  }

  async syncOrganization(): Promise<OfficeViewSnapshot> {
    const engine = await this.ensureEngineState();
    const businesses = await this.getPortfolioBusinesses();
    const result = await this.orgControlPlane.sync(engine, businesses);
    return result.officeSnapshot;
  }

  async routeTask(request: TaskRoutingRequest) {
    return this.orgControlPlane.routeTask(request);
  }

  async getLatestOfficeSnapshot(): Promise<OfficeViewSnapshot | undefined> {
    return this.orgControlPlane.getLatestOfficeSnapshot();
  }

  private async ensureEngineState(): Promise<ImonEngineState> {
    const existing = await this.store.getEngineState();
    if (existing) {
      const next: ImonEngineState = {
        ...existing,
        orgBlueprintId: `org-engine-${existing.id}`,
        name: this.config.engine.name,
        timezone: this.config.engine.timezone,
        host: {
          provider: this.config.engine.hostProvider,
          label: this.config.engine.hostLabel,
          primaryIp: this.config.engine.hostPrimaryIp
        },
        limits: {
          maxConcurrentBusinesses: this.config.engine.maxConcurrentBusinesses,
          cpuUtilizationTarget: this.config.engine.cpuUtilizationTarget,
          memoryUtilizationTarget: this.config.engine.memoryUtilizationTarget,
          minDiskFreeGb: this.config.engine.minDiskFreeGb
        },
        updatedAt: nowIso()
      };
      await this.store.saveEngineState(next);
      return next;
    }

    const createdAt = nowIso();
    const state: ImonEngineState = {
      ...DEFAULT_IMON_ENGINE,
      orgBlueprintId: `org-engine-${DEFAULT_IMON_ENGINE.id}`,
      name: this.config.engine.name,
      timezone: this.config.engine.timezone,
      host: {
        provider: this.config.engine.hostProvider,
        label: this.config.engine.hostLabel,
        primaryIp: this.config.engine.hostPrimaryIp
      },
      limits: {
        maxConcurrentBusinesses: this.config.engine.maxConcurrentBusinesses,
        cpuUtilizationTarget: this.config.engine.cpuUtilizationTarget,
        memoryUtilizationTarget: this.config.engine.memoryUtilizationTarget,
        minDiskFreeGb: this.config.engine.minDiskFreeGb
      },
      createdAt,
      updatedAt: createdAt
    };
    await this.store.saveEngineState(state);
    return state;
  }

  private async seedManagedBusinesses(): Promise<ManagedBusiness[]> {
    const existing = await this.store.getManagedBusinesses();
    const byId = new Map(existing.map((business) => [business.id, business]));
    const seeded: ManagedBusiness[] = [];

    for (const template of DEFAULT_MANAGED_BUSINESSES) {
      const current = byId.get(template.id);
      const next = this.mergeSeed(template, current);
      await this.store.saveManagedBusiness(next);
      seeded.push(next);
    }

    return sortBusinesses(seeded);
  }

  private mergeSeed(
    template: ManagedBusinessSeed,
    current?: ManagedBusiness
  ): ManagedBusiness {
    const timestamp = nowIso();
    if (!current) {
      return {
        ...template,
        orgBlueprintId: `org-business-${template.id}`,
        createdAt: timestamp,
        updatedAt: timestamp
      };
    }

    const dynamicNotes = current.notes.filter(
      (note) =>
        note.startsWith("Imonic plan refreshed") ||
        note.startsWith("Primary alias:") ||
        note.includes("launch dossier lives under runtime/ops/pod-businesses/")
    );

    return {
      ...template,
      orgBlueprintId: `org-business-${template.id}`,
      stage: current.stage,
      launchBlockers:
        current.stage === "active"
          ? []
          : current.launchBlockers.length > 0
            ? current.launchBlockers
            : template.launchBlockers,
      metrics: {
        ...template.metrics,
        currentMonthlyRevenue: current.metrics.currentMonthlyRevenue,
        currentMonthlyCosts: current.metrics.currentMonthlyCosts,
        activeWorkItems: current.metrics.activeWorkItems,
        automationCoverage: current.metrics.automationCoverage,
        dataValueScore: current.metrics.dataValueScore,
        lastRunAt: current.metrics.lastRunAt,
        nextRunAt: current.metrics.nextRunAt
      },
      notes: [...template.notes, ...dynamicNotes.filter((note) => !template.notes.includes(note))],
      createdAt: current.createdAt,
      updatedAt: timestamp
    };
  }

  private async refreshPortfolioMetrics(businesses: ManagedBusiness[]): Promise<ManagedBusiness[]> {
    const [clients, leads, offers, ledger, assetPacks, salesTransactions] = await Promise.all([
      this.store.getClients(),
      this.store.getLeads(),
      this.store.getOffers(),
      this.store.getRevenueLedger(),
      this.store.getAssetPacks(),
      this.store.getSalesTransactions()
    ]);
    const agencyMrr = clients
      .filter((client) => client.billingStatus === "retainer_active")
      .reduce((sum, client) => {
        const offer = offers.find((candidate) => candidate.id === client.offerId);
        return sum + (offer?.monthlyPrice ?? 0);
      }, 0);
    const agencyWorkItems =
      leads.filter((lead) => ["qualified", "drafted", "contacted", "responded"].includes(lead.stage))
        .length + clients.filter((client) => client.qaStatus !== "passed").length;

    const refreshed: ManagedBusiness[] = [];

    for (const business of businesses) {
      const last30Days = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const salesWindow = salesTransactions.filter(
        (transaction) =>
          transaction.businessId === business.id &&
          new Date(transaction.occurredAt).getTime() >= last30Days
      );
      const verifiedSalesWindow = salesWindow.filter(isVerifiedFinancialSignal);
      const salesRevenue = verifiedSalesWindow
        .filter((transaction) => transaction.type === "sale")
        .reduce((sum, transaction) => sum + Math.max(0, transaction.netAmount), 0);
      const salesCosts = verifiedSalesWindow.reduce((sum, transaction) => {
        if (transaction.type === "refund") {
          return sum + Math.abs(transaction.netAmount);
        }
        if (transaction.source === "relay" && transaction.netAmount < 0) {
          return sum + Math.abs(transaction.netAmount);
        }
        return sum + Math.max(0, transaction.feeAmount);
      }, 0);
      const trustedLedger = ledger.filter(
        (entry) => entry.businessId === business.id && isTrustedLedgerSource(entry.source)
      );

      const revenue =
        verifiedSalesWindow.length > 0
          ? salesRevenue
          : trustedLedger
              .filter((entry) => entry.type === "revenue")
              .reduce((sum, entry) => sum + entry.amount, 0);
      const costs =
        verifiedSalesWindow.length > 0
          ? salesCosts
          : trustedLedger
              .filter((entry) => entry.type === "cost")
              .reduce((sum, entry) => sum + entry.amount, 0);

      const next =
        business.id === "auto-funding-agency"
          ? {
              ...business,
              metrics: {
                ...business.metrics,
                currentMonthlyRevenue: agencyMrr,
                currentMonthlyCosts: costs,
                activeWorkItems: agencyWorkItems
              },
              updatedAt: nowIso()
            }
          : {
              ...business,
              metrics: {
                ...business.metrics,
                currentMonthlyRevenue: revenue,
                currentMonthlyCosts: costs,
                activeWorkItems:
                  business.id === "imon-digital-asset-store"
                    ? assetPacks.filter((pack) => pack.status !== "published").length
                    : business.metrics.activeWorkItems
              },
              updatedAt: nowIso()
            };

      await this.store.saveManagedBusiness(next);
      refreshed.push(next);
    }

    return refreshed;
  }

  private async ensureBusinessApprovals(
    businesses: ManagedBusiness[]
  ): Promise<ApprovalTask[]> {
    const tasks: ApprovalTask[] = [];

    for (const business of businesses) {
      if (business.launchBlockers.length === 0) {
        continue;
      }

      tasks.push(
        await this.accountOps.createOrUpdateTask({
          id: `approval-${business.id}`,
          type: business.approvalType,
          actionNeeded: `Resolve launch blockers for ${business.name}`,
          reason: business.launchBlockers.join(" "),
          ownerInstructions: business.ownerActions.join(" "),
          relatedEntityType: "business",
          relatedEntityId: business.id
        })
      );
    }

    return tasks;
  }

  private updateEngineState(
    engine: ImonEngineState,
    businesses: ManagedBusiness[],
    snapshot: VpsResourceSnapshot
  ): ImonEngineState {
    const readyBusinesses = businesses
      .filter((business) => business.stage === "ready")
      .sort((left, right) => left.launchPriority - right.launchPriority);
    const blockedBusinesses = businesses.filter(
      (business) => business.stage !== "active" && business.launchBlockers.length > 0
    );

    return {
      ...engine,
      orgBlueprintId: `org-engine-${engine.id}`,
      portfolio: {
        trackedBusinesses: businesses.length,
        activeBusinesses: businesses.filter((business) => business.stage === "active").length,
        readyBusinesses: readyBusinesses.length,
        blockedBusinesses: blockedBusinesses.length,
        nextRecommendedBusinessId: readyBusinesses[0]?.id
      },
      lastResourceSnapshotAt: snapshot.recordedAt,
      lastPortfolioSyncAt: nowIso(),
      updatedAt: nowIso()
    };
  }

  private buildOverviewReport(
    engine: ImonEngineState,
    businesses: ManagedBusiness[],
    snapshot: VpsResourceSnapshot
  ): EngineOverviewReport {
    const activeBusinesses = businesses
      .filter((business) => business.stage === "active")
      .map((business) => business.id);
    const nextLaunchCandidates = businesses
      .filter((business) => business.stage === "ready")
      .slice(0, Math.max(1, snapshot.recommendedConcurrency))
      .map((business) => business.id);
    const blockedBusinesses = businesses
      .filter((business) => business.launchBlockers.length > 0 && business.stage !== "active")
      .map((business) => business.id);
    const monthlyRevenue = businesses.reduce(
      (sum, business) => sum + business.metrics.currentMonthlyRevenue,
      0
    );
    const monthlyCosts = businesses.reduce(
      (sum, business) => sum + business.metrics.currentMonthlyCosts,
      0
    );

    return {
      id: `engine-overview-${new Date().toISOString().replaceAll(":", "-")}`,
      generatedAt: nowIso(),
      engineId: engine.id,
      resourceSnapshotId: snapshot.id,
      businessCounts: {
        total: businesses.length,
        active: activeBusinesses.length,
        ready: businesses.filter((business) => business.stage === "ready").length,
        scaffolded: businesses.filter((business) => business.stage === "scaffolded").length,
        paused: businesses.filter((business) => business.stage === "paused").length
      },
      monthlyRevenue,
      monthlyCosts,
      netMonthlyRevenue: monthlyRevenue - monthlyCosts,
      activeBusinesses,
      nextLaunchCandidates,
      blockedBusinesses,
      recommendedConcurrency: snapshot.recommendedConcurrency,
      recommendedActions: this.buildRecommendedActions(engine, businesses, snapshot)
    };
  }

  private buildRecommendedActions(
    engine: ImonEngineState,
    businesses: ManagedBusiness[],
    snapshot: VpsResourceSnapshot
  ): string[] {
    const actions: string[] = [];
    const activeCount = businesses.filter((business) => business.stage === "active").length;
    const readyBusinesses = businesses.filter((business) => business.stage === "ready");
    const blockedBusinesses = businesses.filter((business) => business.launchBlockers.length > 0);

    if (readyBusinesses.length > 0 && activeCount < snapshot.recommendedConcurrency) {
      actions.push(
        `Promote ${readyBusinesses[0]?.name} next. The VPS currently has room for up to ${snapshot.recommendedConcurrency} active businesses.`
      );
    }

    if (blockedBusinesses.length > 0) {
      actions.push(
        `Resolve owner setup blockers for ${blockedBusinesses
          .slice(0, 2)
          .map((business) => business.name)
          .join(" and ")}.`
      );
    }

    if (snapshot.notes.length > 0) {
      actions.push(`Throttle heavy jobs when needed: ${snapshot.notes.join(" ")}`);
    }

    if (engine.portfolio.activeBusinesses > engine.limits.maxConcurrentBusinesses) {
      actions.push("Portfolio is above the configured concurrency cap. Pause the lowest-priority active business.");
    }

    if (actions.length === 0) {
      actions.push("Portfolio is within resource targets. Keep the digital asset store and content sites at the front of the rollout queue.");
    }

    return actions;
  }
}
