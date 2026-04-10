import { stageFromLeadScore, type LeadRecord } from "../domain/contracts.js";
import type { ResolvedNorthlineBusinessProfile } from "../domain/northline.js";
import { AIClient, ScoredLeadSchema } from "../ai/client.js";
import { scoringPrompt } from "../ai/prompts.js";
import {
  northlineLeadMatchesServiceArea,
  northlineServiceAreaScope
} from "../services/northline-business-profile.js";

function lower(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function includesAny(value: string, candidates: string[]): boolean {
  return candidates.some((candidate) => value.includes(lower(candidate)));
}

export class QualifierAgent {
  constructor(private readonly ai: AIClient) {}

  async scoreLead(
    lead: LeadRecord,
    businessProfile?: ResolvedNorthlineBusinessProfile
  ): Promise<LeadRecord> {
    if (businessProfile && !northlineLeadMatchesServiceArea(lead, businessProfile)) {
      const scopedAreas = northlineServiceAreaScope(businessProfile);
      const leadArea =
        lead.targetContext?.collectionArea ?? lead.targetContext?.market ?? lead.geo ?? "unknown market";

      return {
        ...lead,
        score: 0,
        scoreReasons: [
          `Outside configured service areas: ${leadArea} is not inside ${scopedAreas.join(", ")}.`
        ],
        stage: "discarded",
        updatedAt: new Date().toISOString()
      };
    }

    const fallback = this.heuristicScore(lead, businessProfile);
    const result = await this.ai.generateJson({
      schema: ScoredLeadSchema,
      prompt: scoringPrompt(lead, {
        businessName: businessProfile?.businessName,
        targetIndustries: businessProfile?.targetIndustries,
        targetServices: businessProfile?.targetServices,
        offerSummary: businessProfile?.offerSummary
      }),
      businessId: lead.businessId ?? businessProfile?.businessId ?? "auto-funding-agency",
      capability: "qualify-lead",
      mode: "fast",
      fallback: () => fallback
    });

    return {
      ...lead,
      score: result.data.score,
      scoreReasons: result.data.scoreReasons,
      stage: stageFromLeadScore(result.data.score),
      updatedAt: new Date().toISOString()
    };
  }

  private heuristicScore(
    lead: LeadRecord,
    businessProfile?: ResolvedNorthlineBusinessProfile
  ): { score: number; scoreReasons: string[]; stage: LeadRecord["stage"] } {
    let score = 25;
    const reasons: string[] = [];
    const signals = lead.websiteQualitySignals;
    const targetIndustries =
      lead.targetContext?.targetIndustries.length && lead.targetContext.targetIndustries.length > 0
        ? lead.targetContext.targetIndustries
        : businessProfile?.targetIndustries ?? [];
    const targetServices =
      lead.targetContext?.targetServices.length && lead.targetContext.targetServices.length > 0
        ? lead.targetContext.targetServices
        : businessProfile?.targetServices ?? [];
    const offerSummary = lead.targetContext?.offerSummary ?? businessProfile?.offerSummary;
    const leadDescriptor = `${lead.niche} ${lead.businessName} ${lead.geo} ${lead.tags.join(" ")}`.toLowerCase();
    const trade = lower(lead.targetContext?.trade);
    const industryFit =
      targetIndustries.length === 0 ||
      includesAny(leadDescriptor, targetIndustries) ||
      (trade.length > 0 && includesAny(trade, targetIndustries));

    if (industryFit) {
      score += 10;
      if (targetIndustries.length > 0) {
        reasons.push(`Strong match for target industries: ${targetIndustries.join(", ")}.`);
      } else {
        reasons.push("Strong match for the configured offer.");
      }
    } else if (targetIndustries.length > 0) {
      score -= 10;
      reasons.push(`Weaker fit for target industries: ${targetIndustries.join(", ")}.`);
    }

    if (!signals.hasWebsite) {
      score += 25;
      reasons.push("No website published, which makes the replacement offer straightforward.");
    } else {
      if (!signals.hasHttps) {
        score += 8;
        reasons.push("Website trust is weakened by missing HTTPS.");
      }

      if (!signals.mobileFriendly) {
        score += 12;
        reasons.push("Likely mobile conversion problems.");
      }

      if (!signals.clearOffer) {
        score += 10;
        reasons.push("Service offer is unclear.");
      }

      if (!signals.callsToAction) {
        score += 10;
        reasons.push("Site lacks obvious lead-capture CTAs.");
      }

      if (signals.pageSpeedBucket === "slow") {
        score += 8;
        reasons.push("Slow page experience can reduce calls and form submissions.");
      }
    }

    if (lead.contact.email) {
      score += 10;
      reasons.push("Public email allows compliant direct outreach.");
    }

    if (lead.contact.phone) {
      score += 7;
      reasons.push("Phone number is available for CTA personalization.");
    }

    if (!lead.contact.email && !lead.contact.phone) {
      score -= 25;
      reasons.push("No direct contact channel is available.");
    }

    if (targetServices.length > 0) {
      score += 5;
      reasons.push(`Relevant for service focus: ${targetServices.slice(0, 3).join(", ")}.`);
    }

    if (offerSummary) {
      reasons.push(`Offer context: ${offerSummary}`);
    }

    if (lead.targetContext?.matchReasons.length) {
      reasons.push(...lead.targetContext.matchReasons.slice(0, 2));
    }

    const boundedScore = Math.max(0, Math.min(100, score));
    const stage = stageFromLeadScore(boundedScore);

    return {
      score: boundedScore,
      scoreReasons: reasons.length > 0 ? reasons : ["Limited evidence of need or reachability."],
      stage
    };
  }
}
