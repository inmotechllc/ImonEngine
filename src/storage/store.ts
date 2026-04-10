import path from "node:path";
import { normalizeClientJob, normalizeLeadRecord } from "../domain/contracts.js";
import type {
  ApprovalTask,
  ClientJob,
  LeadReplyRecord,
  LeadRecord,
  OfferConfig,
  OutreachDraft,
  ProofBundle,
  RetentionReport,
  RunReport
} from "../domain/contracts.js";
import type { AssetPackRecord } from "../domain/digital-assets.js";
import type {
  BusinessLedgerEntry,
  BusinessRunRecord,
  EngineOverviewReport,
  ImonEngineState,
  ManagedBusiness,
  VpsResourceSnapshot
} from "../domain/engine.js";
import type {
  CatalogGrowthPolicy,
  CollectiveFundSnapshot,
  GrowthWorkItem,
  RevenueAllocationPolicy,
  RevenueAllocationSnapshot,
  SalesTransaction
} from "../domain/store-ops.js";
import type { SocialProfileRecord } from "../domain/social.js";
import type {
  ApprovalRoute,
  BusinessScaffoldDraft,
  DepartmentExecutionItem,
  DepartmentDefinition,
  MemoryNamespacePolicy,
  OfficeChatAction,
  OfficeChatMessage,
  OfficeChatThread,
  OfficeHandoffRecord,
  OfficeOperatingConfig,
  OfficeReportArtifact,
  OfficeViewSnapshot,
  OrganizationBlueprint,
  OrgAuditRecord,
  PermissionPolicy,
  PositionAssignment,
  PositionDefinition,
  ReportingLine,
  TaskEnvelope,
  WorkflowOwnershipRecord
} from "../domain/org.js";
import { ensureDir, readJsonFile, writeJsonFile } from "../lib/fs.js";

type EntityCollectionMap = {
  allocationPolicies: RevenueAllocationPolicy[];
  approvals: ApprovalTask[];
  approvalRoutes: ApprovalRoute[];
  assetPacks: AssetPackRecord[];
  businesses: ManagedBusiness[];
  businessRuns: BusinessRunRecord[];
  clients: ClientJob[];
  collectiveSnapshots: CollectiveFundSnapshot[];
  businessScaffoldDrafts: BusinessScaffoldDraft[];
  departmentExecutionItems: DepartmentExecutionItem[];
  departmentDefinitions: DepartmentDefinition[];
  growthQueue: GrowthWorkItem[];
  growthPolicies: CatalogGrowthPolicy[];
  engineReports: EngineOverviewReport[];
  leads: LeadRecord[];
  leadReplies: LeadReplyRecord[];
  memoryNamespacePolicies: MemoryNamespacePolicy[];
  offers: OfferConfig[];
  officeChatActions: OfficeChatAction[];
  officeChatMessages: OfficeChatMessage[];
  officeChatThreads: OfficeChatThread[];
  officeViewSnapshots: OfficeViewSnapshot[];
  officeHandoffs: OfficeHandoffRecord[];
  officeOperatingConfigs: OfficeOperatingConfig[];
  officeReportArtifacts: OfficeReportArtifact[];
  orgAuditRecords: OrgAuditRecord[];
  organizationBlueprints: OrganizationBlueprint[];
  outreach: OutreachDraft[];
  proofBundles: ProofBundle[];
  allocationSnapshots: RevenueAllocationSnapshot[];
  permissionPolicies: PermissionPolicy[];
  positionAssignments: PositionAssignment[];
  positionDefinitions: PositionDefinition[];
  resourceSnapshots: VpsResourceSnapshot[];
  revenueLedger: BusinessLedgerEntry[];
  reportingLines: ReportingLine[];
  salesTransactions: SalesTransaction[];
  socialProfiles: SocialProfileRecord[];
  taskEnvelopes: TaskEnvelope[];
  retention: RetentionReport[];
  reports: RunReport[];
  workflowOwnership: WorkflowOwnershipRecord[];
};

export class FileStore {
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(private readonly stateDir: string) {}

  async init(): Promise<void> {
    await ensureDir(this.stateDir);
    const collections: Array<keyof EntityCollectionMap> = [
      "allocationPolicies",
      "approvals",
      "approvalRoutes",
      "allocationSnapshots",
      "assetPacks",
      "businesses",
      "businessRuns",
      "businessScaffoldDrafts",
      "clients",
      "collectiveSnapshots",
      "departmentExecutionItems",
      "departmentDefinitions",
      "growthPolicies",
      "growthQueue",
      "engineReports",
      "leads",
      "leadReplies",
      "memoryNamespacePolicies",
      "offers",
      "officeChatActions",
      "officeChatMessages",
      "officeChatThreads",
      "officeOperatingConfigs",
      "officeReportArtifacts",
      "officeViewSnapshots",
      "officeHandoffs",
      "orgAuditRecords",
      "organizationBlueprints",
      "outreach",
      "proofBundles",
      "permissionPolicies",
      "positionAssignments",
      "positionDefinitions",
      "resourceSnapshots",
      "reportingLines",
      "revenueLedger",
      "salesTransactions",
      "socialProfiles",
      "taskEnvelopes",
      "retention",
      "reports",
      "workflowOwnership"
    ];

    await Promise.all(
      collections.map(async (name) => {
        const filePath = this.collectionPath(name);
        const existing = await readJsonFile(filePath, []);
        await this.writeCollection(name, existing);
      })
    );

    const enginePath = this.engineStatePath();
    const engine = await readJsonFile<ImonEngineState | null>(enginePath, null);
    await this.writeStateFile(enginePath, engine);
  }

  async getOffers(): Promise<OfferConfig[]> {
    return this.readCollection("offers");
  }

  async saveOffer(offer: OfferConfig): Promise<void> {
    await this.upsert("offers", offer);
  }

  async getLeads(): Promise<LeadRecord[]> {
    return (await this.readCollection("leads")).map((lead) => normalizeLeadRecord(lead));
  }

  async getLead(id: string): Promise<LeadRecord | undefined> {
    const leads = await this.getLeads();
    return leads.find((lead) => lead.id === id);
  }

  async saveLead(lead: LeadRecord): Promise<void> {
    await this.upsert("leads", normalizeLeadRecord(lead));
  }

  async getLeadReplies(): Promise<LeadReplyRecord[]> {
    return this.readCollection("leadReplies");
  }

  async saveLeadReply(reply: LeadReplyRecord): Promise<void> {
    await this.upsert("leadReplies", reply);
  }

  async getClients(): Promise<ClientJob[]> {
    return (await this.readCollection("clients")).map((client) => normalizeClientJob(client));
  }

  async getClient(id: string): Promise<ClientJob | undefined> {
    const clients = await this.getClients();
    return clients.find((client) => client.id === id);
  }

  async saveClient(client: ClientJob): Promise<void> {
    await this.upsert("clients", normalizeClientJob(client));
  }

  async getManagedBusinesses(): Promise<ManagedBusiness[]> {
    return this.readCollection("businesses");
  }

  async getManagedBusiness(id: string): Promise<ManagedBusiness | undefined> {
    const businesses = await this.getManagedBusinesses();
    return businesses.find((business) => business.id === id);
  }

  async saveManagedBusiness(business: ManagedBusiness): Promise<void> {
    await this.upsert("businesses", business);
  }

  async getAssetPacks(): Promise<AssetPackRecord[]> {
    return this.readCollection("assetPacks");
  }

  async getAssetPack(id: string): Promise<AssetPackRecord | undefined> {
    const packs = await this.getAssetPacks();
    return packs.find((pack) => pack.id === id);
  }

  async saveAssetPack(pack: AssetPackRecord): Promise<void> {
    await this.upsert("assetPacks", pack);
  }

  async getApprovals(): Promise<ApprovalTask[]> {
    return this.readCollection("approvals");
  }

  async saveApproval(task: ApprovalTask): Promise<void> {
    await this.upsert("approvals", task);
  }

  async getApprovalRoutes(): Promise<ApprovalRoute[]> {
    return this.readCollection("approvalRoutes");
  }

  async saveApprovalRoute(route: ApprovalRoute): Promise<void> {
    await this.upsert("approvalRoutes", route);
  }

  async replaceApprovalRoutes(routes: ApprovalRoute[]): Promise<void> {
    await this.writeCollection("approvalRoutes", routes);
  }

  async getGrowthQueue(): Promise<GrowthWorkItem[]> {
    return this.readCollection("growthQueue");
  }

  async saveGrowthWorkItem(item: GrowthWorkItem): Promise<void> {
    await this.upsert("growthQueue", item);
  }

  async replaceGrowthQueue(items: GrowthWorkItem[]): Promise<void> {
    await this.writeCollection("growthQueue", items);
  }

  async getAllocationPolicies(): Promise<RevenueAllocationPolicy[]> {
    return this.readCollection("allocationPolicies");
  }

  async saveAllocationPolicy(policy: RevenueAllocationPolicy): Promise<void> {
    await this.upsert("allocationPolicies", policy);
  }

  async getAllocationSnapshots(): Promise<RevenueAllocationSnapshot[]> {
    return this.readCollection("allocationSnapshots");
  }

  async saveAllocationSnapshot(snapshot: RevenueAllocationSnapshot): Promise<void> {
    await this.upsert("allocationSnapshots", snapshot);
  }

  async getCollectiveSnapshots(): Promise<CollectiveFundSnapshot[]> {
    return this.readCollection("collectiveSnapshots");
  }

  async saveCollectiveSnapshot(snapshot: CollectiveFundSnapshot): Promise<void> {
    await this.upsert("collectiveSnapshots", snapshot);
  }

  async getGrowthPolicies(): Promise<CatalogGrowthPolicy[]> {
    return this.readCollection("growthPolicies");
  }

  async saveGrowthPolicy(policy: CatalogGrowthPolicy): Promise<void> {
    await this.upsert("growthPolicies", policy);
  }

  async getSalesTransactions(): Promise<SalesTransaction[]> {
    return this.readCollection("salesTransactions");
  }

  async saveSalesTransaction(transaction: SalesTransaction): Promise<void> {
    await this.upsert("salesTransactions", transaction);
  }

  async getSocialProfiles(): Promise<SocialProfileRecord[]> {
    return this.readCollection("socialProfiles");
  }

  async saveSocialProfile(profile: SocialProfileRecord): Promise<void> {
    await this.upsert("socialProfiles", profile);
  }

  async replaceSocialProfiles(profiles: SocialProfileRecord[]): Promise<void> {
    await this.writeCollection("socialProfiles", profiles);
  }

  async getOrganizationBlueprints(): Promise<OrganizationBlueprint[]> {
    return this.readCollection("organizationBlueprints");
  }

  async getOrganizationBlueprint(id: string): Promise<OrganizationBlueprint | undefined> {
    const blueprints = await this.getOrganizationBlueprints();
    return blueprints.find((blueprint) => blueprint.id === id);
  }

  async saveOrganizationBlueprint(blueprint: OrganizationBlueprint): Promise<void> {
    await this.upsert("organizationBlueprints", blueprint);
  }

  async replaceOrganizationBlueprints(blueprints: OrganizationBlueprint[]): Promise<void> {
    await this.writeCollection("organizationBlueprints", blueprints);
  }

  async getDepartmentDefinitions(): Promise<DepartmentDefinition[]> {
    return this.readCollection("departmentDefinitions");
  }

  async getDepartmentExecutionItems(): Promise<DepartmentExecutionItem[]> {
    return this.readCollection("departmentExecutionItems");
  }

  async getBusinessScaffoldDrafts(): Promise<BusinessScaffoldDraft[]> {
    return this.readCollection("businessScaffoldDrafts");
  }

  async saveBusinessScaffoldDraft(draft: BusinessScaffoldDraft): Promise<void> {
    await this.upsert("businessScaffoldDrafts", draft);
  }

  async replaceBusinessScaffoldDrafts(drafts: BusinessScaffoldDraft[]): Promise<void> {
    await this.writeCollection("businessScaffoldDrafts", drafts);
  }

  async saveDepartmentExecutionItem(item: DepartmentExecutionItem): Promise<void> {
    await this.upsert("departmentExecutionItems", item);
  }

  async replaceDepartmentExecutionItems(items: DepartmentExecutionItem[]): Promise<void> {
    await this.writeCollection("departmentExecutionItems", items);
  }

  async saveDepartmentDefinition(definition: DepartmentDefinition): Promise<void> {
    await this.upsert("departmentDefinitions", definition);
  }

  async replaceDepartmentDefinitions(definitions: DepartmentDefinition[]): Promise<void> {
    await this.writeCollection("departmentDefinitions", definitions);
  }

  async getPositionDefinitions(): Promise<PositionDefinition[]> {
    return this.readCollection("positionDefinitions");
  }

  async savePositionDefinition(definition: PositionDefinition): Promise<void> {
    await this.upsert("positionDefinitions", definition);
  }

  async replacePositionDefinitions(definitions: PositionDefinition[]): Promise<void> {
    await this.writeCollection("positionDefinitions", definitions);
  }

  async getPositionAssignments(): Promise<PositionAssignment[]> {
    return this.readCollection("positionAssignments");
  }

  async savePositionAssignment(assignment: PositionAssignment): Promise<void> {
    await this.upsert("positionAssignments", assignment);
  }

  async replacePositionAssignments(assignments: PositionAssignment[]): Promise<void> {
    await this.writeCollection("positionAssignments", assignments);
  }

  async getReportingLines(): Promise<ReportingLine[]> {
    return this.readCollection("reportingLines");
  }

  async saveReportingLine(reportingLine: ReportingLine): Promise<void> {
    await this.upsert("reportingLines", reportingLine);
  }

  async replaceReportingLines(reportingLines: ReportingLine[]): Promise<void> {
    await this.writeCollection("reportingLines", reportingLines);
  }

  async getPermissionPolicies(): Promise<PermissionPolicy[]> {
    return this.readCollection("permissionPolicies");
  }

  async savePermissionPolicy(policy: PermissionPolicy): Promise<void> {
    await this.upsert("permissionPolicies", policy);
  }

  async replacePermissionPolicies(policies: PermissionPolicy[]): Promise<void> {
    await this.writeCollection("permissionPolicies", policies);
  }

  async getMemoryNamespacePolicies(): Promise<MemoryNamespacePolicy[]> {
    return this.readCollection("memoryNamespacePolicies");
  }

  async saveMemoryNamespacePolicy(policy: MemoryNamespacePolicy): Promise<void> {
    await this.upsert("memoryNamespacePolicies", policy);
  }

  async replaceMemoryNamespacePolicies(policies: MemoryNamespacePolicy[]): Promise<void> {
    await this.writeCollection("memoryNamespacePolicies", policies);
  }

  async getWorkflowOwnership(): Promise<WorkflowOwnershipRecord[]> {
    return this.readCollection("workflowOwnership");
  }

  async getWorkflowOwnershipRecord(
    workflowId: string,
    businessId?: string
  ): Promise<WorkflowOwnershipRecord | undefined> {
    const records = await this.getWorkflowOwnership();
    return records.find(
      (record) => record.workflowId === workflowId && record.businessId === businessId
    ) ?? records.find((record) => record.workflowId === workflowId && !record.businessId);
  }

  async saveWorkflowOwnership(record: WorkflowOwnershipRecord): Promise<void> {
    await this.upsert("workflowOwnership", record);
  }

  async replaceWorkflowOwnership(records: WorkflowOwnershipRecord[]): Promise<void> {
    await this.writeCollection("workflowOwnership", records);
  }

  async getTaskEnvelopes(): Promise<TaskEnvelope[]> {
    return this.readCollection("taskEnvelopes");
  }

  async saveTaskEnvelope(envelope: TaskEnvelope): Promise<void> {
    await this.upsert("taskEnvelopes", envelope);
  }

  async replaceTaskEnvelopes(envelopes: TaskEnvelope[]): Promise<void> {
    await this.writeCollection("taskEnvelopes", envelopes);
  }

  async getOrgAuditRecords(): Promise<OrgAuditRecord[]> {
    return this.readCollection("orgAuditRecords");
  }

  async saveOrgAuditRecord(record: OrgAuditRecord): Promise<void> {
    await this.upsert("orgAuditRecords", record);
  }

  async replaceOrgAuditRecords(records: OrgAuditRecord[]): Promise<void> {
    await this.writeCollection("orgAuditRecords", records);
  }

  async getOfficeViewSnapshots(): Promise<OfficeViewSnapshot[]> {
    return this.readCollection("officeViewSnapshots");
  }

  async getOfficeChatThreads(): Promise<OfficeChatThread[]> {
    return this.readCollection("officeChatThreads");
  }

  async saveOfficeChatThread(thread: OfficeChatThread): Promise<void> {
    await this.upsert("officeChatThreads", thread);
  }

  async replaceOfficeChatThreads(threads: OfficeChatThread[]): Promise<void> {
    await this.writeCollection("officeChatThreads", threads);
  }

  async getOfficeChatMessages(): Promise<OfficeChatMessage[]> {
    return this.readCollection("officeChatMessages");
  }

  async saveOfficeChatMessage(message: OfficeChatMessage): Promise<void> {
    await this.upsert("officeChatMessages", message);
  }

  async replaceOfficeChatMessages(messages: OfficeChatMessage[]): Promise<void> {
    await this.writeCollection("officeChatMessages", messages);
  }

  async getOfficeChatActions(): Promise<OfficeChatAction[]> {
    return this.readCollection("officeChatActions");
  }

  async saveOfficeChatAction(action: OfficeChatAction): Promise<void> {
    await this.upsert("officeChatActions", action);
  }

  async replaceOfficeChatActions(actions: OfficeChatAction[]): Promise<void> {
    await this.writeCollection("officeChatActions", actions);
  }

  async getOfficeReportArtifacts(): Promise<OfficeReportArtifact[]> {
    return this.readCollection("officeReportArtifacts");
  }

  async saveOfficeReportArtifact(artifact: OfficeReportArtifact): Promise<void> {
    await this.upsert("officeReportArtifacts", artifact);
  }

  async replaceOfficeReportArtifacts(artifacts: OfficeReportArtifact[]): Promise<void> {
    await this.writeCollection("officeReportArtifacts", artifacts);
  }

  async getOfficeOperatingConfigs(): Promise<OfficeOperatingConfig[]> {
    return this.readCollection("officeOperatingConfigs");
  }

  async saveOfficeOperatingConfig(config: OfficeOperatingConfig): Promise<void> {
    await this.upsert("officeOperatingConfigs", config);
  }

  async replaceOfficeOperatingConfigs(configs: OfficeOperatingConfig[]): Promise<void> {
    await this.writeCollection("officeOperatingConfigs", configs);
  }

  async getOfficeHandoffs(): Promise<OfficeHandoffRecord[]> {
    return this.readCollection("officeHandoffs");
  }

  async saveOfficeHandoff(record: OfficeHandoffRecord): Promise<void> {
    await this.upsert("officeHandoffs", record);
  }

  async replaceOfficeHandoffs(records: OfficeHandoffRecord[]): Promise<void> {
    await this.writeCollection("officeHandoffs", records);
  }

  async saveOfficeViewSnapshot(snapshot: OfficeViewSnapshot): Promise<void> {
    await this.upsert("officeViewSnapshots", snapshot);
  }

  async replaceOfficeViewSnapshots(snapshots: OfficeViewSnapshot[]): Promise<void> {
    await this.writeCollection("officeViewSnapshots", snapshots);
  }

  async getOutreachDrafts(): Promise<OutreachDraft[]> {
    return this.readCollection("outreach");
  }

  async saveOutreachDraft(draft: OutreachDraft): Promise<void> {
    await this.upsert("outreach", draft);
  }

  async getProofBundles(): Promise<ProofBundle[]> {
    return this.readCollection("proofBundles");
  }

  async saveProofBundle(bundle: ProofBundle): Promise<void> {
    await this.upsert("proofBundles", bundle, (existing) => existing.clientId === bundle.clientId);
  }

  async getReports(): Promise<RunReport[]> {
    return this.readCollection("reports");
  }

  async saveReport(report: RunReport): Promise<void> {
    await this.upsert("reports", report);
  }

  async getRetentionReports(): Promise<RetentionReport[]> {
    return this.readCollection("retention");
  }

  async saveRetentionReport(report: RetentionReport): Promise<void> {
    await this.upsert("retention", report, (existing) => existing.clientId === report.clientId);
  }

  async getEngineState(): Promise<ImonEngineState | undefined> {
    return (await readJsonFile<ImonEngineState | null>(this.engineStatePath(), null)) ?? undefined;
  }

  async saveEngineState(state: ImonEngineState): Promise<void> {
    await this.writeStateFile(this.engineStatePath(), state);
  }

  async getBusinessRuns(): Promise<BusinessRunRecord[]> {
    return this.readCollection("businessRuns");
  }

  async saveBusinessRun(run: BusinessRunRecord): Promise<void> {
    await this.upsert("businessRuns", run);
  }

  async getResourceSnapshots(): Promise<VpsResourceSnapshot[]> {
    return this.readCollection("resourceSnapshots");
  }

  async saveResourceSnapshot(snapshot: VpsResourceSnapshot): Promise<void> {
    await this.upsert("resourceSnapshots", snapshot);
  }

  async getRevenueLedger(): Promise<BusinessLedgerEntry[]> {
    return this.readCollection("revenueLedger");
  }

  async saveRevenueLedgerEntry(entry: BusinessLedgerEntry): Promise<void> {
    await this.upsert("revenueLedger", entry);
  }

  async getEngineReports(): Promise<EngineOverviewReport[]> {
    return this.readCollection("engineReports");
  }

  async saveEngineReport(report: EngineOverviewReport): Promise<void> {
    await this.upsert("engineReports", report);
  }

  private collectionPath(name: keyof EntityCollectionMap): string {
    return path.join(this.stateDir, `${name}.json`);
  }

  private engineStatePath(): string {
    return path.join(this.stateDir, "engine.json");
  }

  private async readCollection<K extends keyof EntityCollectionMap>(
    name: K
  ): Promise<EntityCollectionMap[K]> {
    return readJsonFile(this.collectionPath(name), [] as EntityCollectionMap[K]);
  }

  private async writeCollection<K extends keyof EntityCollectionMap>(
    name: K,
    value: EntityCollectionMap[K]
  ): Promise<void> {
    await this.writeStateFile(this.collectionPath(name), value);
  }

  private async writeStateFile<T>(filePath: string, value: T): Promise<void> {
    await this.queueWrite(filePath, async () => {
      await writeJsonFile(filePath, value);
    });
  }

  private async queueWrite(filePath: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.writeQueues.get(filePath) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.writeQueues.set(filePath, next);

    try {
      await next;
    } finally {
      if (this.writeQueues.get(filePath) === next) {
        this.writeQueues.delete(filePath);
      }
    }
  }

  private async upsert<K extends keyof EntityCollectionMap>(
    name: K,
    item: EntityCollectionMap[K][number],
    matcher?: (candidate: EntityCollectionMap[K][number]) => boolean
  ): Promise<void> {
    const filePath = this.collectionPath(name);

    await this.queueWrite(filePath, async () => {
      const current = await readJsonFile(filePath, [] as EntityCollectionMap[K]);
      const predicate =
        matcher ??
        ((candidate: EntityCollectionMap[K][number]) =>
          "id" in candidate &&
          "id" in item &&
          candidate.id === item.id);
      const next = [...current];
      const index = next.findIndex(predicate);

      if (index >= 0) {
        next[index] = item;
      } else {
        next.push(item);
      }

      await writeJsonFile(filePath, next);
    });
  }
}
