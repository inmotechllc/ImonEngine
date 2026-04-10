import type { AppConfig } from "../config.js";
import {
  leadReadyForAutomatedOutreach,
  type LeadPipeline,
  type LeadRecord,
  type ProspectImportRecord
} from "../domain/contracts.js";
import { DEFAULT_NORTHLINE_BUSINESS_ID } from "../domain/northline.js";
import { AIClient } from "../ai/client.js";
import {
  northlineLeadMatchesBusinessScope,
  resolveNorthlineBusinessProfile
} from "../services/northline-business-profile.js";
import { FileStore } from "../storage/store.js";
import { AccountOpsAgent } from "./account-ops.js";
import { OutreachWriterAgent } from "./outreach-writer.js";
import { ProspectorAgent } from "./prospector.js";
import { QualifierAgent } from "./qualifier.js";
import { ReportsService } from "../services/reports.js";

interface ProspectImportOptions {
  businessId?: string;
  source?: string;
  pipeline?: LeadPipeline;
}

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

  async prospect(inputPath: string, options?: ProspectImportOptions): Promise<LeadRecord[]> {
    const imported = await this.prospector.loadImportFile(inputPath);
    return this.ingestProspects(imported, options);
  }

  async ingestProspects(
    imported: ProspectImportRecord[],
    options?: ProspectImportOptions
  ): Promise<LeadRecord[]> {
    const leads: LeadRecord[] = [];
    const resolvedProfile = await this.resolveBusinessProfile(options?.businessId);

    for (const record of imported) {
      const base = this.prospector.toLead(record, options);
      const scored = await this.qualifier.scoreLead(base, resolvedProfile);
      await this.store.saveLead(scored);
      leads.push(scored);
    }

    return leads;
  }

  async draftOutreach(limit = 10, options?: { businessId?: string }): Promise<number> {
    const [leads, drafts, businesses] = await Promise.all([
      this.store.getLeads(),
      this.store.getOutreachDrafts(),
      this.store.getManagedBusinesses()
    ]);
    const alreadyDrafted = new Set(drafts.map((draft) => draft.leadId));
    const businessesById = new Map(businesses.map((business) => [business.id, business]));
    const profileCache = new Map<string, ReturnType<typeof resolveNorthlineBusinessProfile> | undefined>();
    const profileForBusinessId = (businessId?: string) => {
      const targetBusinessId = businessId ?? DEFAULT_NORTHLINE_BUSINESS_ID;
      if (!profileCache.has(targetBusinessId)) {
        const business = businessesById.get(targetBusinessId);
        profileCache.set(
          targetBusinessId,
          business
            ? resolveNorthlineBusinessProfile(this.config, business)
            : targetBusinessId === DEFAULT_NORTHLINE_BUSINESS_ID
              ? resolveNorthlineBusinessProfile(this.config)
              : undefined
        );
      }
      return profileCache.get(targetBusinessId);
    };
    const targets = leads
      .filter((lead) => leadReadyForAutomatedOutreach(lead))
      .filter((lead) => {
        const leadBusinessId = lead.businessId ?? DEFAULT_NORTHLINE_BUSINESS_ID;
        if (options?.businessId && leadBusinessId !== options.businessId) {
          return false;
        }

        const profile = profileForBusinessId(leadBusinessId);
        return profile ? northlineLeadMatchesBusinessScope(lead, leadBusinessId, profile) : false;
      })
      .filter((lead) => !alreadyDrafted.has(lead.id))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    for (const lead of targets) {
      const resolvedProfile = profileForBusinessId(lead.businessId);
      await this.outreachWriter.createDraft(lead, resolvedProfile);
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

  private async resolveBusinessProfile(businessId?: string) {
    const targetBusinessId = businessId ?? DEFAULT_NORTHLINE_BUSINESS_ID;
    const business = await this.store.getManagedBusiness(targetBusinessId);

    if (business) {
      return resolveNorthlineBusinessProfile(this.config, business);
    }

    if (targetBusinessId === DEFAULT_NORTHLINE_BUSINESS_ID) {
      return resolveNorthlineBusinessProfile(this.config);
    }

    return undefined;
  }
}
