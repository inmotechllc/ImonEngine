import OpenAI from "openai";
import { z, type ZodType } from "zod";
import type { AppConfig } from "../config.js";
import {
  type AIProviderId,
  type AIResolvedProviderConfig,
  type AIResolvedRouteDefinition,
  type AISharedRouteId,
  resolveAIRouteDefinition
} from "./api-map.js";

export type AIResponseSource = AIProviderId | "fallback";

type AIGenerationMode = "fast" | "deep";

type AIRequestContext = {
  businessId?: string;
  capability?: string;
};

type AIRouteRequest = AIRequestContext & {
  sharedRouteId: AISharedRouteId;
};

export class AIClient {
  private readonly clients = new Map<AIProviderId, OpenAI>();

  constructor(private readonly config: AppConfig) {}

  get enabled(): boolean {
    return (["fast", "deep", "research"] as const).some((sharedRouteId) =>
      this.canUse({ sharedRouteId })
    );
  }

  canUse(
    params:
      | ({ mode: AIGenerationMode } & AIRequestContext)
      | ({ sharedRouteId: AISharedRouteId } & AIRequestContext)
  ): boolean {
    const route = this.resolveRoute(params);
    if (!route) {
      return false;
    }

    const provider = this.providerConfig(route.provider);
    return provider ? this.isProviderAvailable(provider) : false;
  }

  describeRoute(
    params:
      | ({ mode: AIGenerationMode } & AIRequestContext)
      | ({ sharedRouteId: AISharedRouteId } & AIRequestContext)
  ): (AIResolvedRouteDefinition & { available: boolean }) | undefined {
    const route = this.resolveRoute(params);
    if (!route) {
      return undefined;
    }

    const provider = this.providerConfig(route.provider);
    return {
      ...route,
      available: provider ? this.isProviderAvailable(provider) : false
    };
  }

  async generateJson<T>({
    schema,
    prompt,
    mode,
    businessId,
    capability,
    fallback
  }: {
    schema: ZodType<T>;
    prompt: string;
    mode: AIGenerationMode;
    businessId?: string;
    capability?: string;
    fallback: () => T;
  }): Promise<{ data: T; source: AIResponseSource; providerLabel?: string; routeId?: string }> {
    const route = this.resolveRoute({ mode, businessId, capability });
    const client = route ? this.clientFor(route) : undefined;
    if (!route || !client) {
      return { data: fallback(), source: "fallback" };
    }

    try {
      const text = await this.createRouteText(client, route, {
        prompt,
        jsonMode: true
      });
      if (!text) {
        return { data: fallback(), source: "fallback" };
      }

      const parsed = this.parseJsonOutput(text);
      if (parsed === undefined) {
        return { data: fallback(), source: "fallback" };
      }

      return {
        data: schema.parse(parsed),
        source: route.provider,
        providerLabel: route.providerLabel,
        routeId: route.routeId
      };
    } catch {
      return { data: fallback(), source: "fallback" };
    }
  }

  async generateText({
    prompt,
    mode,
    businessId,
    capability,
    fallback
  }: {
    prompt: string;
    mode: AIGenerationMode;
    businessId?: string;
    capability?: string;
    fallback: () => string;
  }): Promise<{ text: string; source: AIResponseSource; providerLabel?: string; routeId?: string }> {
    const route = this.resolveRoute({ mode, businessId, capability });
    const client = route ? this.clientFor(route) : undefined;
    if (!route || !client) {
      return { text: fallback(), source: "fallback" };
    }

    try {
      const text = await this.createRouteText(client, route, {
        prompt
      });
      return {
        text: text || fallback(),
        source: text ? route.provider : "fallback",
        providerLabel: text ? route.providerLabel : undefined,
        routeId: text ? route.routeId : undefined
      };
    } catch {
      return { text: fallback(), source: "fallback" };
    }
  }

  async researchText({
    prompt,
    businessId,
    capability,
    fallback
  }: {
    prompt: string;
    businessId?: string;
    capability?: string;
    fallback: () => string;
  }): Promise<{ text: string; source: AIResponseSource; providerLabel?: string; routeId?: string }> {
    const route = this.resolveRoute({ sharedRouteId: "research", businessId, capability });
    const client = route ? this.clientFor(route) : undefined;
    if (!route || !client) {
      return { text: fallback(), source: "fallback" };
    }

    try {
      const text = await this.createRouteText(client, route, {
        prompt
      });
      return {
        text: text || fallback(),
        source: text ? route.provider : "fallback",
        providerLabel: text ? route.providerLabel : undefined,
        routeId: text ? route.routeId : undefined
      };
    } catch {
      return { text: fallback(), source: "fallback" };
    }
  }

  private resolveRoute(
    params:
      | ({ mode: AIGenerationMode } & AIRequestContext)
      | ({ sharedRouteId: AISharedRouteId } & AIRequestContext)
  ): AIResolvedRouteDefinition | undefined {
    const sharedRouteId = "sharedRouteId" in params ? params.sharedRouteId : params.mode;
    if (!sharedRouteId) {
      return undefined;
    }

    return this.applyLegacyModelOverride(
      resolveAIRouteDefinition({
        businessId: params.businessId,
        capabilityId: params.capability,
        sharedRouteId
      })
    );
  }

  private applyLegacyModelOverride(route: AIResolvedRouteDefinition): AIResolvedRouteDefinition {
    const legacyModelOverride = this.config.ai.routeModelOverrides[route.sharedRouteId];
    if (!legacyModelOverride) {
      return route;
    }

    return {
      ...route,
      model: legacyModelOverride
    };
  }

  private providerConfig(providerId: AIProviderId): AIResolvedProviderConfig | undefined {
    return this.config.ai.providers[providerId];
  }

  private isProviderAvailable(provider: AIResolvedProviderConfig): boolean {
    if (provider.requiresBaseUrl && !provider.baseUrl) {
      return false;
    }
    if (provider.requiresApiKey && !provider.apiKey) {
      return false;
    }
    return true;
  }

  private clientFor(route: AIResolvedRouteDefinition): OpenAI | undefined {
    const provider = this.providerConfig(route.provider);
    if (!provider || !this.isProviderAvailable(provider)) {
      return undefined;
    }

    const cached = this.clients.get(route.provider);
    if (cached) {
      return cached;
    }

    const client = new OpenAI({
      apiKey: provider.apiKey ?? "local-dev-key",
      ...(provider.baseUrl ? { baseURL: provider.baseUrl } : {})
    });
    this.clients.set(route.provider, client);
    return client;
  }

  private async createRouteText(
    client: OpenAI,
    route: AIResolvedRouteDefinition,
    request: {
      prompt: string;
      jsonMode?: boolean;
    }
  ): Promise<string | undefined> {
    const provider = this.providerConfig(route.provider);
    if (!provider) {
      return undefined;
    }

    if (provider.apiKind === "chat-completions") {
      return this.createChatCompletionText(client, route, request);
    }

    return this.createResponsesText(client, route, request);
  }

  private async createResponsesText(
    client: OpenAI,
    route: AIResolvedRouteDefinition,
    request: {
      prompt: string;
      jsonMode?: boolean;
    }
  ): Promise<string | undefined> {
    const response = await (client.responses.create as any)({
      model: route.model,
      input: request.prompt,
      ...(route.tools ? { tools: route.tools } : {}),
      ...(request.jsonMode
        ? {
            text: {
              format: {
                type: "json_object"
              }
            }
          }
        : {})
    });

    return response?.output_text?.trim?.() || undefined;
  }

  private async createChatCompletionText(
    client: OpenAI,
    route: AIResolvedRouteDefinition,
    request: {
      prompt: string;
      jsonMode?: boolean;
    }
  ): Promise<string | undefined> {
    if (route.tools?.length) {
      throw new Error(`Provider ${route.provider} does not support the research tool contract.`);
    }

    try {
      const response = await (client.chat.completions.create as any)({
        model: route.model,
        messages: [{ role: "user", content: request.prompt }],
        ...(request.jsonMode
          ? {
              response_format: {
                type: "json_object"
              }
            }
          : {})
      });

      return this.extractChatCompletionText(response?.choices?.[0]?.message?.content);
    } catch {
      if (!request.jsonMode) {
        throw new Error("chat-completion request failed");
      }

      const response = await (client.chat.completions.create as any)({
        model: route.model,
        messages: [
          {
            role: "user",
            content: `${request.prompt}\n\nReturn only a valid JSON object. Do not wrap it in markdown.`
          }
        ]
      });

      return this.extractChatCompletionText(response?.choices?.[0]?.message?.content);
    }
  }

  private extractChatCompletionText(content: unknown): string | undefined {
    if (typeof content === "string") {
      const text = content.trim();
      return text ? text : undefined;
    }

    if (!Array.isArray(content)) {
      return undefined;
    }

    const text = content
      .flatMap((part) => {
        if (typeof part === "string") {
          return [part];
        }
        if (
          part &&
          typeof part === "object" &&
          "type" in part &&
          part.type === "text" &&
          "text" in part &&
          typeof part.text === "string"
        ) {
          return [part.text];
        }
        return [];
      })
      .join("\n")
      .trim();

    return text ? text : undefined;
  }

  private parseJsonOutput(text: string): unknown {
    for (const candidate of this.jsonCandidates(text)) {
      try {
        return JSON.parse(candidate) as unknown;
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private jsonCandidates(text: string): string[] {
    const trimmed = text.trim();
    const candidates = new Set<string>([trimmed]);

    if (trimmed.startsWith("```")) {
      candidates.add(trimmed.replace(/^```[a-zA-Z0-9_-]*\s*/, "").replace(/\s*```$/, "").trim());
    }

    const objectStart = trimmed.indexOf("{");
    const objectEnd = trimmed.lastIndexOf("}");
    if (objectStart !== -1 && objectEnd > objectStart) {
      candidates.add(trimmed.slice(objectStart, objectEnd + 1).trim());
    }

    const arrayStart = trimmed.indexOf("[");
    const arrayEnd = trimmed.lastIndexOf("]");
    if (arrayStart !== -1 && arrayEnd > arrayStart) {
      candidates.add(trimmed.slice(arrayStart, arrayEnd + 1).trim());
    }

    return [...candidates].filter(Boolean);
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
  upsellCandidate: z.string().min(1),
  upgradeOffer: z
    .object({
      label: z.string().min(1),
      summary: z.string().min(1),
      nextStep: z.string().min(1)
    })
    .optional()
});

export const AssetPackBlueprintSchema = z.object({
  title: z.string().min(1),
  shortDescription: z.string().min(1),
  description: z.string().min(1),
  suggestedPrice: z.number().min(1),
  priceVariants: z.array(z.number()).min(2),
  tags: z.array(z.string()).min(5),
  deliverables: z.array(z.string()).min(3),
  promptSeeds: z.array(z.string()).min(4),
  productionChecklist: z.array(z.string()).min(4),
  listingChecklist: z.array(z.string()).min(4)
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
  approvalRequired: z.boolean(),
  route: z.enum(["none", "booked_call", "intake_follow_up", "do_not_contact"])
});