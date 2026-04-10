import type { ClientJob, LeadRecord } from "../domain/contracts.js";
import type { AssetPackBrief } from "../domain/digital-assets.js";

type LeadPromptContext = {
  businessName?: string;
  siteUrl?: string;
  targetIndustries?: string[];
  targetServices?: string[];
  offerSummary?: string;
};

type RetentionPromptContext = {
  businessName?: string;
  upgradeOffer?: {
    label: string;
    couponLabel?: string;
    terms?: string;
    hasPaymentLink: boolean;
  };
};

export function scoringPrompt(lead: LeadRecord, context?: LeadPromptContext): string {
  return [
    `Score this local-services sales prospect for ${context?.businessName ?? "the current agency"}.`,
    "Return JSON with score, scoreReasons, and stage.",
    `Target industries: ${(context?.targetIndustries ?? []).join(", ") || "Not specified"}`,
    `Target services: ${(context?.targetServices ?? []).join(", ") || "Not specified"}`,
    `Offer summary: ${context?.offerSummary ?? "Not specified"}`,
    "Prioritize weak website execution, available contact data, geographic fit, and fit for the configured offer.",
    `Lead: ${JSON.stringify(lead)}`
  ].join("\n");
}

export function outreachPrompt(lead: LeadRecord, context: LeadPromptContext): string {
  return [
    "Write a compliant cold email for a local-services business.",
    "No fake claims, fake results, guarantees, or spammy pressure.",
    "Return JSON with subject, body, followUps[], and complianceNotes[].",
    `Sender business: ${context.businessName ?? "Unknown sender"}`,
    `Sender site: ${context.siteUrl ?? "Not specified"}`,
    `Target industries: ${(context.targetIndustries ?? []).join(", ") || "Not specified"}`,
    `Target services: ${(context.targetServices ?? []).join(", ") || "Not specified"}`,
    `Offer summary: ${context.offerSummary ?? "Not specified"}`,
    `Lead: ${JSON.stringify(lead)}`
  ].join("\n");
}

export function siteCopyPrompt(client: ClientJob): string {
  return [
    "Create website copy for a local home-services business landing page.",
    "Return JSON with heroHeadline, heroCopy, serviceBullets[], proofStrip[], processSteps[], faq[].",
    "Keep the tone direct and specific. Avoid generic marketing fluff.",
    `Client: ${JSON.stringify(client)}`
  ].join("\n");
}

export function retentionPrompt(client: ClientJob, context?: RetentionPromptContext): string {
  return [
    "Create a monthly retention report for a home-services client.",
    "Return JSON with updateSuggestions[], reviewResponses[], upsellCandidate, and optional upgradeOffer { label, summary, nextStep }.",
    "Focus on actions that can improve calls, form fills, credibility, and local search trust.",
    "Only include upgradeOffer when the client is on the Lead Generation path and factual Growth System upgrade context is provided.",
    "Do not invent discount percentages, coupon codes, checkout URLs, or timing terms that were not provided in the prompt.",
    `Sender business: ${context?.businessName ?? "Unknown business"}`,
    context?.upgradeOffer
      ? `Configured Growth upgrade: label=${context.upgradeOffer.label}; checkoutLink=${context.upgradeOffer.hasPaymentLink ? "available" : "not_configured"}; couponLabel=${context.upgradeOffer.couponLabel ?? "not_configured"}; terms=${context.upgradeOffer.terms ?? "not_configured"}`
      : "Configured Growth upgrade: not provided for this client.",
    `Client: ${JSON.stringify(client)}`
  ].join("\n");
}

export function replyClassificationPrompt(message: string): string {
  return [
    "Classify this prospect reply.",
    "Return JSON with disposition, recommendedStage, nextAction, approvalRequired, and route.",
    "Allowed dispositions: positive, objection, neutral, unsubscribe.",
    "Allowed routes: none, booked_call, intake_follow_up, do_not_contact.",
    `Reply: ${message}`
  ].join("\n");
}

export function assetPackPrompt(brief: AssetPackBrief): string {
  return [
    "Create a Gumroad-ready digital asset pack blueprint.",
    "Return JSON with title, shortDescription, description, suggestedPrice, priceVariants[], tags[], deliverables[], promptSeeds[], productionChecklist[], and listingChecklist[].",
    "Keep it low-risk, specific, and easy to produce in a first launch sprint.",
    "Avoid trademarked brands, copyrighted characters, or rights-sensitive content.",
    `Brief: ${JSON.stringify(brief)}`
  ].join("\n");
}