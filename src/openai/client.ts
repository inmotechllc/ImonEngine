import OpenAI from "openai";
import { z, type ZodType } from "zod";
import type { AppConfig } from "../config.js";

export class AIClient {
  private readonly client?: OpenAI;

  constructor(private readonly config: AppConfig) {
    if (config.openAiApiKey) {
      this.client = new OpenAI({ apiKey: config.openAiApiKey });
    }
  }

  get enabled(): boolean {
    return Boolean(this.client);
  }

  async generateJson<T>({
    schema,
    prompt,
    mode,
    fallback
  }: {
    schema: ZodType<T>;
    prompt: string;
    mode: "fast" | "deep";
    fallback: () => T;
  }): Promise<{ data: T; source: "openai" | "fallback" }> {
    if (!this.client) {
      return { data: fallback(), source: "fallback" };
    }

    try {
      const response = await this.client.responses.create({
        model: mode === "fast" ? this.config.models.fast : this.config.models.deep,
        input: prompt,
        text: {
          format: {
            type: "json_object"
          }
        }
      });

      const text = response.output_text?.trim();
      if (!text) {
        return { data: fallback(), source: "fallback" };
      }

      const parsed = JSON.parse(text) as unknown;
      return { data: schema.parse(parsed), source: "openai" };
    } catch {
      return { data: fallback(), source: "fallback" };
    }
  }
}

export const ScoredLeadSchema = z.object({
  score: z.number().min(0).max(100),
  scoreReasons: z.array(z.string()).min(1),
  stage: z.enum(["prospecting", "qualified", "drafted", "contacted", "responded", "won", "lost", "discarded"])
});

export const OutreachDraftSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
  followUps: z.array(z.string()).min(2),
  complianceNotes: z.array(z.string())
});

export const SiteCopySchema = z.object({
  heroHeadline: z.string().min(1),
  heroCopy: z.string().min(1),
  serviceBullets: z.array(z.string()).min(3),
  proofStrip: z.array(z.string()).min(3),
  processSteps: z.array(z.string()).min(3),
  faq: z.array(z.object({ question: z.string(), answer: z.string() })).min(3)
});

export const RetentionSchema = z.object({
  updateSuggestions: z.array(z.string()).min(2),
  reviewResponses: z.array(z.object({ review: z.string(), response: z.string() })).min(1),
  upsellCandidate: z.string().min(1)
});

export const ReplyClassificationSchema = z.object({
  disposition: z.enum(["positive", "objection", "neutral", "unsubscribe"]),
  recommendedStage: z.enum([
    "prospecting",
    "qualified",
    "drafted",
    "contacted",
    "responded",
    "won",
    "lost",
    "discarded"
  ]),
  nextAction: z.string().min(1),
  approvalRequired: z.boolean()
});
