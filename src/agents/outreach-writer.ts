import type { AppConfig } from "../config.js";
import type { LeadRecord, OutreachDraft } from "../domain/contracts.js";
import { containsUnsupportedClaims } from "../lib/text.js";
import { AIClient, OutreachDraftSchema } from "../openai/client.js";
import { outreachPrompt } from "../openai/prompts.js";
import { FileStore } from "../storage/store.js";
import { AccountOpsAgent } from "./account-ops.js";

export class OutreachWriterAgent {
  constructor(
    private readonly ai: AIClient,
    private readonly config: AppConfig,
    private readonly store: FileStore,
    private readonly accountOps: AccountOpsAgent
  ) {}

  async createDraft(lead: LeadRecord): Promise<OutreachDraft> {
    const fallback = this.fallbackDraft(lead);
    const generated = await this.ai.generateJson({
      schema: OutreachDraftSchema,
      prompt: outreachPrompt(lead, this.config.business.name, this.config.business.siteUrl),
      mode: "fast",
      fallback: () => fallback
    });

    const issues = containsUnsupportedClaims(
      [generated.data.subject, generated.data.body, ...generated.data.followUps].join("\n")
    );
    const complianceNotes = [...generated.data.complianceNotes, ...issues];

    const draft: OutreachDraft = {
      id: `${lead.id}-draft`,
      leadId: lead.id,
      subject: generated.data.subject,
      body: generated.data.body,
      followUps: generated.data.followUps,
      complianceNotes,
      approved: complianceNotes.length === 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await this.store.saveOutreachDraft(draft);

    if (!draft.approved) {
      const task = await this.accountOps.createOrUpdateTask({
        id: `approval-outreach-${lead.id}`,
        type: "compliance",
        actionNeeded: `Review outreach copy for ${lead.businessName}`,
        reason: "Generated copy triggered compliance rules and should be checked before sending.",
        ownerInstructions: `Inspect runtime/state/outreach.json and confirm the draft for ${lead.businessName}.`,
        relatedEntityType: "lead",
        relatedEntityId: lead.id
      });
      await this.accountOps.notifyApproval(task);
    }

    if (!this.config.smtp) {
      const task = await this.accountOps.createOrUpdateTask({
        id: "approval-smtp-setup",
        type: "email",
        actionNeeded: "Connect SMTP settings for live approval notifications",
        reason: "Approval tasks are currently written to runtime/notifications instead of being sent by email.",
        ownerInstructions:
          "Add SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, and SMTP_FROM to enable live email notifications.",
        relatedEntityType: "account",
        relatedEntityId: "smtp"
      });
      await this.accountOps.notifyApproval(task);
    }

    return draft;
  }

  private fallbackDraft(
    lead: LeadRecord
  ): Omit<OutreachDraft, "id" | "leadId" | "approved" | "createdAt" | "updatedAt"> {
    const issues = lead.scoreReasons.slice(0, 2).join(" ");
    return {
      subject: `${lead.businessName}: quick website conversion fixes`,
      body: [
        `Hi ${lead.contact.ownerName ?? "there"},`,
        "",
        `I looked at ${lead.businessName} and noticed a few issues that can slow down calls and form submissions: ${issues}`,
        "",
        "We build focused home-services pages with stronger call routing, contact forms, and follow-up assets without dragging owners through a long rebuild.",
        "",
        "If useful, I can send a short preview showing how your landing page and CTA flow could be tightened up.",
        "",
        "Reply here and I will send it over.",
        "",
        `${this.config.business.name}`,
        this.config.business.salesEmail
      ].join("\n"),
      followUps: [
        `Following up on the quick funnel ideas I mentioned for ${lead.businessName}. If a preview would help, I can send one.`,
        `Still happy to show a tighter CTA and lead-capture structure for ${lead.businessName} if website updates are a priority this month.`,
        `Closing the loop here. If improving calls and form fills is on the roadmap, I can send a draft approach for review.`
      ],
      complianceNotes: []
    };
  }
}
