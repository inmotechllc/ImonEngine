import type { AppConfig } from "../config.js";
import type { LeadRecord } from "../domain/contracts.js";
import { AIClient } from "../openai/client.js";
import { FileStore } from "../storage/store.js";
import { AccountOpsAgent } from "./account-ops.js";
import { OutreachWriterAgent } from "./outreach-writer.js";
import { ProspectorAgent } from "./prospector.js";
import { QualifierAgent } from "./qualifier.js";
import { ReportsService } from "../services/reports.js";

export class OrchestratorAgent {
  private readonly prospector = new ProspectorAgent();
  private readonly qualifier: QualifierAgent;
  private readonly accountOps: AccountOpsAgent;
  private readonly outreachWriter: OutreachWriterAgent;
  private readonly reports: ReportsService;

  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore,
    ai: AIClient
  ) {
    this.qualifier = new QualifierAgent(ai);
    this.accountOps = new AccountOpsAgent(config, store);
    this.outreachWriter = new OutreachWriterAgent(ai, config, store, this.accountOps);
    this.reports = new ReportsService(config, store, ai);
  }

  getAccountOps(): AccountOpsAgent {
    return this.accountOps;
  }

  getReports(): ReportsService {
    return this.reports;
  }

  async prospect(inputPath: string): Promise<LeadRecord[]> {
    const imported = await this.prospector.loadImportFile(inputPath);
    const leads: LeadRecord[] = [];

    for (const record of imported) {
      const base = this.prospector.toLead(record);
      const scored = await this.qualifier.scoreLead(base);
      await this.store.saveLead(scored);
      leads.push(scored);
    }

    return leads;
  }

  async draftOutreach(limit = 10): Promise<number> {
    const leads = await this.store.getLeads();
    const drafts = await this.store.getOutreachDrafts();
    const alreadyDrafted = new Set(drafts.map((draft) => draft.leadId));
    const targets = leads
      .filter((lead) => lead.stage === "qualified")
      .filter((lead) => !alreadyDrafted.has(lead.id))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    for (const lead of targets) {
      await this.outreachWriter.createDraft(lead);
      await this.store.saveLead({
        ...lead,
        stage: "drafted",
        updatedAt: new Date().toISOString()
      });
    }

    return targets.length;
  }

  async dailyRun(inputPath?: string): Promise<void> {
    const notes: string[] = [];
    await this.accountOps.ensureOperationalApprovals();

    if (inputPath) {
      const imported = await this.prospect(inputPath);
      notes.push(`Imported ${imported.length} prospects from ${inputPath}.`);
    }

    const drafted = await this.draftOutreach(10);
    notes.push(`Prepared ${drafted} outreach drafts.`);

    await this.reports.generateRunReport(notes);
  }
}
