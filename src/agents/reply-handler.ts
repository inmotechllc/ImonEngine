import type { LeadRecord } from "../domain/contracts.js";
import { AIClient, ReplyClassificationSchema } from "../ai/client.js";
import { replyClassificationPrompt } from "../ai/prompts.js";

export class ReplyHandlerAgent {
  constructor(private readonly ai: AIClient) {}

  async classify(message: string): Promise<{
    disposition: "positive" | "objection" | "neutral" | "unsubscribe";
    recommendedStage: LeadRecord["stage"];
    nextAction: string;
    approvalRequired: boolean;
    route: "none" | "booked_call" | "intake_follow_up" | "do_not_contact";
  }> {
    return (
      await this.ai.generateJson({
        schema: ReplyClassificationSchema,
        prompt: replyClassificationPrompt(message),
        businessId: "auto-funding-agency",
        capability: "reply-classification",
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
        approvalRequired: false,
        route: "do_not_contact" as const
      };
    }

    if (/(call me|let'?s talk|book|schedule|meeting|phone me|give me a call)/.test(lower)) {
      return {
        disposition: "positive" as const,
        recommendedStage: "responded" as const,
        nextAction: "Send the booking link and move the lead toward a scheduled call.",
        approvalRequired: false,
        route: "booked_call" as const
      };
    }

    if (/(interested|send it|send me|preview|pricing|quote|details|looks interesting|more info)/.test(lower)) {
      return {
        disposition: "positive" as const,
        recommendedStage: "responded" as const,
        nextAction: "Send the preview, pricing, or hosted intake link and move the lead toward intake.",
        approvalRequired: false,
        route: "intake_follow_up" as const
      };
    }

    if (/(price|budget|already have|not now)/.test(lower)) {
      return {
        disposition: "objection" as const,
        recommendedStage: "responded" as const,
        nextAction: "Answer the objection with a concise, non-pushy follow-up.",
        approvalRequired: false,
        route: /(price|budget)/.test(lower) ? ("intake_follow_up" as const) : ("none" as const)
      };
    }

    return {
      disposition: "neutral" as const,
      recommendedStage: "contacted" as const,
      nextAction: "Log the reply and wait before the next touch.",
      approvalRequired: false,
      route: "none" as const
    };
  }
}
