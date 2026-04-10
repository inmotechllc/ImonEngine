import type { AppConfig } from "../config.js";
import type { LeadRecord, OutreachDraft } from "../domain/contracts.js";
import type { ResolvedNorthlineBusinessProfile } from "../domain/northline.js";
import { containsUnsupportedClaims } from "../lib/text.js";
import { AIClient, OutreachDraftSchema } from "../ai/client.js";
import { outreachPrompt } from "../ai/prompts.js";
import { FileStore } from "../storage/store.js";
import { AccountOpsAgent } from "./account-ops.js";

export class OutreachWriterAgent {
  constructor(
    private readonly ai: AIClient,
    private readonly config: AppConfig,
    private readonly store: FileStore,
    private readonly accountOps: AccountOpsAgent
  ) {}

  async createDraft(
    lead: LeadRecord,
    businessProfile?: ResolvedNorthlineBusinessProfile
  ): Promise<OutreachDraft> {
    const senderBusinessName = businessProfile?.businessName ?? this.config.business.name;
    const senderSite = businessProfile?.siteUrl ?? this.config.business.siteUrl;
    const fallback = this.fallbackDraft(lead, businessProfile);
    const generated = await this.ai.generateJson({
      schema: OutreachDraftSchema,
      prompt: outreachPrompt(lead, {
        businessName: senderBusinessName,
        siteUrl: senderSite,
        targetIndustries: businessProfile?.targetIndustries ?? lead.targetContext?.targetIndustries,
        targetServices: businessProfile?.targetServices ?? lead.targetContext?.targetServices,
        offerSummary: businessProfile?.offerSummary ?? lead.targetContext?.offerSummary
      }),
      businessId: lead.businessId ?? businessProfile?.businessId ?? "auto-funding-agency",
      capability: "outreach-draft",
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
      sendReceipts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await this.store.saveOutreachDraft(draft);

    if (!draft.approved) {
      const task = await this.accountOps.createOrUpdateTask({
        id: `approval-outreach-${lead.id}`,
        type: "compliance",
        actionNeeded: `Review outreach copy for ${lead.businessName}`,
        reason: "Generated copy triggered compliance rules and should be checked before the VPS sender can deliver it automatically.",
        ownerInstructions:
          `Inspect runtime/state/outreach.json, confirm the draft for ${lead.businessName}, and rerun northline-autonomy-run once the copy is approved.`,
        relatedEntityType: "lead",
        relatedEntityId: lead.id
      });
      await this.accountOps.notifyApproval(task);
    }

    if (!this.config.smtp) {
      await this.accountOps.createOrUpdateTask(
        {
          id: "approval-smtp-setup",
          type: "email",
          actionNeeded: "Connect SMTP settings for live approval notifications",
          reason:
            "SMTP is optional for VPS Gmail-based outbound sends during controlled launch, but still required before approval notifications and SMTP fallback sends move off filesystem fallbacks.",
          ownerInstructions:
            "Add SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, and NORTHLINE_SMTP_FROM to enable approval notifications and SMTP fallback sends. Legacy SMTP_FROM still loads as a fallback.",
          relatedEntityType: "account",
          relatedEntityId: "smtp"
        },
        {
          reopenCompleted: false,
          status: "waiting"
        }
      );
    }

    return draft;
  }

  private fallbackDraft(
    lead: LeadRecord,
    businessProfile?: ResolvedNorthlineBusinessProfile
  ): Omit<OutreachDraft, "id" | "leadId" | "approved" | "createdAt" | "updatedAt"> {
    const issues = lead.scoreReasons.slice(0, 2).join(" ");
    const senderBusinessName = businessProfile?.businessName ?? this.config.business.name;
    const senderEmail = businessProfile?.salesEmail ?? this.config.business.salesEmail;
    const offerSummary = businessProfile?.offerSummary ?? lead.targetContext?.offerSummary;
    return {
      subject: `${lead.businessName}: quick website conversion fixes`,
      body: [
        `Hi ${lead.contact.ownerName ?? "there"},`,
        "",
        `I looked at ${lead.businessName} and noticed a few issues that can slow down calls and form submissions: ${issues}`,
        "",
        offerSummary
          ? `We help operators tighten the close path with ${offerSummary.toLowerCase()}.`
          : "We build focused local-services pages with stronger call routing, contact forms, and follow-up assets without dragging owners through a long rebuild.",
        "",
        "If useful, I can send a short preview showing how your landing page and CTA flow could be tightened up.",
        "",
        "Reply here and I will send it over.",
        "",
        senderBusinessName,
        senderEmail
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
