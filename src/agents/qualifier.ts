import type { LeadRecord } from "../domain/contracts.js";
import { AIClient, ScoredLeadSchema } from "../openai/client.js";
import { scoringPrompt } from "../openai/prompts.js";

export class QualifierAgent {
  constructor(private readonly ai: AIClient) {}

  async scoreLead(lead: LeadRecord): Promise<LeadRecord> {
    const fallback = this.heuristicScore(lead);
    const result = await this.ai.generateJson({
      schema: ScoredLeadSchema,
      prompt: scoringPrompt(lead),
      mode: "fast",
      fallback: () => fallback
    });

    return {
      ...lead,
      score: result.data.score,
      scoreReasons: result.data.scoreReasons,
      stage: result.data.stage,
      updatedAt: new Date().toISOString()
    };
  }

  private heuristicScore(lead: LeadRecord): { score: number; scoreReasons: string[]; stage: LeadRecord["stage"] } {
    let score = 25;
    const reasons: string[] = [];
    const signals = lead.websiteQualitySignals;

    if (lead.niche.toLowerCase().includes("home")) {
      score += 10;
      reasons.push("Strong match for the home-services offer.");
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

    const boundedScore = Math.max(0, Math.min(100, score));
    const stage =
      boundedScore >= 65 ? "qualified" : boundedScore >= 40 ? "prospecting" : "discarded";

    return {
      score: boundedScore,
      scoreReasons: reasons.length > 0 ? reasons : ["Limited evidence of need or reachability."],
      stage
    };
  }
}
