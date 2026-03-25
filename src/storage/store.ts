import path from "node:path";
import type {
  ApprovalTask,
  ClientJob,
  LeadRecord,
  OfferConfig,
  OutreachDraft,
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
import { ensureDir, readJsonFile, writeJsonFile } from "../lib/fs.js";

type EntityCollectionMap = {
  allocationPolicies: RevenueAllocationPolicy[];
  approvals: ApprovalTask[];
  assetPacks: AssetPackRecord[];
  businesses: ManagedBusiness[];
  businessRuns: BusinessRunRecord[];
  clients: ClientJob[];
  collectiveSnapshots: CollectiveFundSnapshot[];
  growthQueue: GrowthWorkItem[];
  growthPolicies: CatalogGrowthPolicy[];
  engineReports: EngineOverviewReport[];
  leads: LeadRecord[];
  offers: OfferConfig[];
  outreach: OutreachDraft[];
  allocationSnapshots: RevenueAllocationSnapshot[];
  resourceSnapshots: VpsResourceSnapshot[];
  revenueLedger: BusinessLedgerEntry[];
  salesTransactions: SalesTransaction[];
  socialProfiles: SocialProfileRecord[];
  retention: RetentionReport[];
  reports: RunReport[];
};

export class FileStore {
  constructor(private readonly stateDir: string) {}

  async init(): Promise<void> {
    await ensureDir(this.stateDir);
    const collections: Array<keyof EntityCollectionMap> = [
      "allocationPolicies",
      "approvals",
      "allocationSnapshots",
      "assetPacks",
      "businesses",
      "businessRuns",
      "clients",
      "collectiveSnapshots",
      "growthPolicies",
      "growthQueue",
      "engineReports",
      "leads",
      "offers",
      "outreach",
      "resourceSnapshots",
      "revenueLedger",
      "salesTransactions",
      "socialProfiles",
      "retention",
      "reports"
    ];

    await Promise.all(
      collections.map(async (name) => {
        const filePath = this.collectionPath(name);
        const existing = await readJsonFile(filePath, []);
        await writeJsonFile(filePath, existing);
      })
    );

    const enginePath = this.engineStatePath();
    const engine = await readJsonFile<ImonEngineState | null>(enginePath, null);
    await writeJsonFile(enginePath, engine);
  }

  async getOffers(): Promise<OfferConfig[]> {
    return this.readCollection("offers");
  }

  async saveOffer(offer: OfferConfig): Promise<void> {
    await this.upsert("offers", offer);
  }

  async getLeads(): Promise<LeadRecord[]> {
    return this.readCollection("leads");
  }

  async getLead(id: string): Promise<LeadRecord | undefined> {
    const leads = await this.getLeads();
    return leads.find((lead) => lead.id === id);
  }

  async saveLead(lead: LeadRecord): Promise<void> {
    await this.upsert("leads", lead);
  }

  async getClients(): Promise<ClientJob[]> {
    return this.readCollection("clients");
  }

  async getClient(id: string): Promise<ClientJob | undefined> {
    const clients = await this.getClients();
    return clients.find((client) => client.id === id);
  }

  async saveClient(client: ClientJob): Promise<void> {
    await this.upsert("clients", client);
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

  async getGrowthQueue(): Promise<GrowthWorkItem[]> {
    return this.readCollection("growthQueue");
  }

  async saveGrowthWorkItem(item: GrowthWorkItem): Promise<void> {
    await this.upsert("growthQueue", item);
  }

  async replaceGrowthQueue(items: GrowthWorkItem[]): Promise<void> {
    await writeJsonFile(this.collectionPath("growthQueue"), items);
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
    await writeJsonFile(this.collectionPath("socialProfiles"), profiles);
  }

  async getOutreachDrafts(): Promise<OutreachDraft[]> {
    return this.readCollection("outreach");
  }

  async saveOutreachDraft(draft: OutreachDraft): Promise<void> {
    await this.upsert("outreach", draft);
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
    await writeJsonFile(this.engineStatePath(), state);
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

  private async upsert<K extends keyof EntityCollectionMap>(
    name: K,
    item: EntityCollectionMap[K][number],
    matcher?: (candidate: EntityCollectionMap[K][number]) => boolean
  ): Promise<void> {
    const current = await this.readCollection(name);
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

    await writeJsonFile(this.collectionPath(name), next);
  }
}
