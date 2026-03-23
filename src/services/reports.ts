import path from "node:path";
import type { AppConfig } from "../config.js";
import type {
  ClientJob,
  LeadStage,
  RetentionReport,
  ReviewResponseDraft,
  RunReport
} from "../domain/contracts.js";
import { writeJsonFile } from "../lib/fs.js";
import { AIClient, RetentionSchema } from "../openai/client.js";
import { retentionPrompt } from "../openai/prompts.js";
import { FileStore } from "../storage/store.js";

const LEAD_STAGES: LeadStage[] = [
  "prospecting",
  "qualified",
  "drafted",
  "contacted",
  "responded",
  "won",
  "lost",
  "discarded"
];

export class ReportsService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore,
    private readonly ai: AIClient
  ) {}

  async generateRunReport(notes: string[] = []): Promise<RunReport> {
    const [leads, approvals, clients, offers] = await Promise.all([
      this.store.getLeads(),
      this.store.getApprovals(),
      this.store.getClients(),
      this.store.getOffers()
    ]);

    const counts = Object.fromEntries(LEAD_STAGES.map((stage) => [stage, 0])) as Record<LeadStage, number>;
    for (const lead of leads) {
      counts[lead.stage] += 1;
    }

    const activeClients = clients.filter((client) => client.billingStatus === "retainer_active");
    const mrr = activeClients.reduce((sum, client) => {
      const offer = offers.find((item) => item.id === client.offerId);
      return sum + (offer?.monthlyPrice ?? 0);
    }, 0);

    const report: RunReport = {
      id: `run-${new Date().toISOString().replaceAll(":", "-")}`,
      generatedAt: new Date().toISOString(),
      pipelineCounts: counts,
      replies: counts.responded,
      bookedCalls: clients.filter((client) => client.nextAction.toLowerCase().includes("booked")).length,
      closes: clients.filter((client) => ["paid", "retainer_active"].includes(client.billingStatus)).length,
      mrr,
      blockedApprovals: approvals.filter((approval) => approval.status !== "completed").length,
      notes,
      upsellCandidates: activeClients.map(
        (client) => `${client.clientName}: add GBP optimization or review request automation`
      )
    };

    await this.store.saveReport(report);
    await writeJsonFile(path.join(this.config.reportDir, `${report.id}.json`), report);
    return report;
  }

  async generateRetentionReport(client: ClientJob): Promise<RetentionReport> {
    const fallbackReviewResponses: ReviewResponseDraft[] = (client.assets.reviews ?? [
      "Great service and easy scheduling.",
      "Tech showed up on time and explained everything.",
      "Would use them again for future work."
    ]).map((review) => ({
      review,
      response:
        "Thanks for the feedback. We appreciate the trust and are glad the service experience was straightforward."
    }));

    const generated = await this.ai.generateJson({
      schema: RetentionSchema,
      prompt: retentionPrompt(client),
      mode: "deep",
      fallback: () => ({
        updateSuggestions: [
          "Create a seasonal service block above the fold for the next 30 days.",
          "Add one trust badge cluster near the primary CTA.",
          "Tighten the form copy so homeowners know response timing."
        ],
        reviewResponses: fallbackReviewResponses,
        upsellCandidate: "Add a second landing page focused on the highest-margin service."
      })
    });

    const report: RetentionReport = {
      clientId: client.id,
      createdAt: new Date().toISOString(),
      reviewResponses: generated.data.reviewResponses,
      updateSuggestions: generated.data.updateSuggestions,
      upsellCandidate: generated.data.upsellCandidate
    };

    await this.store.saveRetentionReport(report);
    await writeJsonFile(path.join(this.config.reportDir, `${client.id}-retention.json`), report);
    return report;
  }
}
