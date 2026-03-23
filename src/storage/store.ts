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
import { ensureDir, readJsonFile, writeJsonFile } from "../lib/fs.js";

type EntityCollectionMap = {
  approvals: ApprovalTask[];
  clients: ClientJob[];
  leads: LeadRecord[];
  offers: OfferConfig[];
  outreach: OutreachDraft[];
  retention: RetentionReport[];
  reports: RunReport[];
};

export class FileStore {
  constructor(private readonly stateDir: string) {}

  async init(): Promise<void> {
    await ensureDir(this.stateDir);
    const collections: Array<keyof EntityCollectionMap> = [
      "approvals",
      "clients",
      "leads",
      "offers",
      "outreach",
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

  async getApprovals(): Promise<ApprovalTask[]> {
    return this.readCollection("approvals");
  }

  async saveApproval(task: ApprovalTask): Promise<void> {
    await this.upsert("approvals", task);
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

  private collectionPath(name: keyof EntityCollectionMap): string {
    return path.join(this.stateDir, `${name}.json`);
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
