import type { ClientJob, LeadRecord } from "../domain/contracts.js";

export function scoringPrompt(lead: LeadRecord): string {
  return [
    "Score this local-services sales prospect for a website plus follow-up automation offer.",
    "Return JSON with score, scoreReasons, and stage.",
    "Prioritize weak website execution, available contact data, and fit for a home-services offer.",
    `Lead: ${JSON.stringify(lead)}`
  ].join("\n");
}

export function outreachPrompt(lead: LeadRecord, businessName: string, siteUrl: string): string {
  return [
    "Write a compliant cold email for a home-services business.",
    "No fake claims, fake results, guarantees, or spammy pressure.",
    "Return JSON with subject, body, followUps[], and complianceNotes[].",
    `Sender business: ${businessName}`,
    `Sender site: ${siteUrl}`,
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

export function retentionPrompt(client: ClientJob): string {
  return [
    "Create a monthly retention report for a home-services client.",
    "Return JSON with updateSuggestions[], reviewResponses[], and upsellCandidate.",
    "Focus on actions that can improve calls, form fills, credibility, and local search trust.",
    `Client: ${JSON.stringify(client)}`
  ].join("\n");
}

export function replyClassificationPrompt(message: string): string {
  return [
    "Classify this prospect reply.",
    "Return JSON with disposition, recommendedStage, nextAction, and approvalRequired.",
    "Allowed dispositions: positive, objection, neutral, unsubscribe.",
    `Reply: ${message}`
  ].join("\n");
}
