import type { LeadRecord } from "../domain/contracts.js";
import { AIClient, ReplyClassificationSchema } from "../openai/client.js";
import { replyClassificationPrompt } from "../openai/prompts.js";

export class ReplyHandlerAgent {
  constructor(private readonly ai: AIClient) {}

  async classify(message: string): Promise<{
    disposition: "positive" | "objection" | "neutral" | "unsubscribe";
    recommendedStage: LeadRecord["stage"];
    nextAction: string;
    approvalRequired: boolean;
  }> {
    return (
      await this.ai.generateJson({
        schema: ReplyClassificationSchema,
        prompt: replyClassificationPrompt(message),
        mode: "fast",
        fallback: () => this.fallback(message)
      })
    ).data;
  }

  private fallback(message: string) {
    const lower = message.toLowerCase();

    if (/(stop|unsubscribe|remove me)/.test(lower)) {
      return {
        disposition: "unsubscribe" as const,
        recommendedStage: "lost" as const,
        nextAction: "Mark the lead as lost and suppress further outreach.",
        approvalRequired: false
      };
    }

    if (/(call me|interested|send it|send me|let'?s talk|looks interesting)/.test(lower)) {
      return {
        disposition: "positive" as const,
        recommendedStage: "responded" as const,
        nextAction: "Send the preview or booking link and move the lead toward intake.",
        approvalRequired: false
      };
    }

    if (/(price|budget|already have|not now)/.test(lower)) {
      return {
        disposition: "objection" as const,
        recommendedStage: "responded" as const,
        nextAction: "Answer the objection with a concise, non-pushy follow-up.",
        approvalRequired: false
      };
    }

    return {
      disposition: "neutral" as const,
      recommendedStage: "contacted" as const,
      nextAction: "Log the reply and wait before the next touch.",
      approvalRequired: false
    };
  }
}
