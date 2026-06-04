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
    if (!route || !this.canUseRoute(route)) {
      return { data: fallback(), source: "fallback" };
    }

    try {
      const text = await this.createRouteText(route, {
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
    if (!route || !this.canUseRoute(route)) {
      return { text: fallback(), source: "fallback" };
    }

    try {
      const text = await this.createRouteText(route, {
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
    if (!route || !this.canUseRoute(route)) {
      return { text: fallback(), source: "fallback" };
    }

    try {
      const text = await this.createRouteText(route, {
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
    if (!legacyModelOverride || route.provider === "nomi") {
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

  private canUseRoute(route: AIResolvedRouteDefinition): boolean {
    const provider = this.providerConfig(route.provider);
    return provider ? this.isProviderAvailable(provider) : false;
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

    if (provider.transport === "nomi-gateway") {
      return this.createNomiGatewayText(provider, route, request);
    }

    const client = this.clientFor(route);
    if (!client) {
      return undefined;
    }

    if (provider.apiKind === "chat-completions") {
      return this.createChatCompletionText(client, route, request);
    }

    return this.createResponsesText(client, route, request);
  }

  private async createNomiGatewayText(
    provider: AIResolvedProviderConfig,
    route: AIResolvedRouteDefinition,
    request: {
      prompt: string;
      jsonMode?: boolean;
    }
  ): Promise<string | undefined> {
    const baseUrl = this.normalizeBaseUrl(provider.baseUrl);
    if (!baseUrl) {
      return undefined;
    }

    const prompt = request.jsonMode
      ? `${request.prompt}\n\nReturn only a valid JSON object. Do not wrap it in markdown.`
      : request.prompt;
    const capability = request.jsonMode || route.sharedRouteId === "deep" ? "reasoning" : "chat";
    const timeoutMs = 30000;
    const headers = this.buildNomiGatewayHeaders(provider);
    const acceptedResponse = await fetch(this.resolveUrl(baseUrl, "/requests"), {
      method: "POST",
      headers,
      body: JSON.stringify({
        modelId: route.model || "auto",
        capability,
        mode: "sync",
        input: {
          kind: "text",
          text: prompt,
          attachments: []
        },
        requestMetadata: {
          taskClass: request.jsonMode ? "analysis" : "conversation",
          preferredCapabilityPackId: request.jsonMode ? "workflow-planning" : "conversation-coordination",
          workflowStage: request.jsonMode ? "planning" : undefined,
          qualityMode: route.sharedRouteId === "fast" ? "fast" : "balanced",
          preferredRoutingRole: request.jsonMode ? "planning" : "coordination"
        },
        context: {
          promptId: route.routeId
        },
        timeoutMs
      })
    });

    const acceptedPayload = (await acceptedResponse.json()) as {
      statusPath?: string;
      message?: string;
      detail?: string;
    };
    if (!acceptedResponse.ok || !acceptedPayload.statusPath) {
      throw new Error(
        acceptedPayload.message?.trim() ||
          acceptedPayload.detail?.trim() ||
          "Nomi gateway rejected the request."
      );
    }

    const statusPayload = await this.pollNomiGatewayStatus(baseUrl, acceptedPayload.statusPath, headers, timeoutMs);
    if (statusPayload.state === "failed" || statusPayload.state === "cancelled") {
      throw new Error(statusPayload.error?.message?.trim() || "Nomi gateway request failed.");
    }

    if (typeof statusPayload.output?.text === "string" && statusPayload.output.text.trim()) {
      return statusPayload.output.text.trim();
    }

    if (statusPayload.output?.json !== undefined) {
      return JSON.stringify(statusPayload.output.json);
    }

    return undefined;
  }

  private async pollNomiGatewayStatus(
    baseUrl: string,
    statusPath: string,
    headers: Record<string, string>,
    timeoutMs: number
  ): Promise<{
    state?: string;
    output?: {
      text?: string;
      json?: unknown;
    };
    error?: {
      message?: string;
    };
  }> {
    const deadline = Date.now() + timeoutMs;
    const pathName = statusPath.startsWith("/") ? statusPath : `/${statusPath}`;

    while (Date.now() <= deadline) {
      const response = await fetch(this.resolveUrl(baseUrl, pathName), {
        method: "GET",
        headers
      });
      const payload = (await response.json()) as {
        state?: string;
        output?: {
          text?: string;
          json?: unknown;
        };
        error?: {
          message?: string;
        };
        message?: string;
      };

      if (!response.ok) {
        throw new Error(payload.message?.trim() || "Nomi gateway status request failed.");
      }

      if (payload.state === "succeeded" || payload.state === "failed" || payload.state === "cancelled") {
        return payload;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error("Timed out waiting for Nomi gateway output.");
  }

  private buildNomiGatewayHeaders(provider: AIResolvedProviderConfig): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (provider.apiKey) {
      headers.Authorization = `Bearer ${provider.apiKey}`;
    }
    return headers;
  }

  private normalizeBaseUrl(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed) {
      return undefined;
    }
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    return withProtocol.endsWith("/") ? withProtocol.slice(0, -1) : withProtocol;
  }

  private resolveUrl(baseUrl: string, pathName: string): string {
    return new URL(pathName, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
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
