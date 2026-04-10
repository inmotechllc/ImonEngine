export type AITransportKind = "openai-compatible";

export type AIRequestApiKind = "responses" | "chat-completions";

export type AIProviderId = "openai" | "nvidia" | "local";

export type AISharedRouteId = "fast" | "deep" | "research";

export type AICapabilityStatus = "active" | "reserved";

export type AIToolDefinition = {
  type: "web_search_preview";
};

export type AIManagedBusinessId =
  | "imon-engine"
  | "imon-digital-asset-store"
  | "imon-niche-content-sites"
  | "imon-faceless-social-brand"
  | "clipbaiters-viral-moments"
  | "imon-micro-saas-factory"
  | "imon-pod-store"
  | "auto-funding-agency";

export interface AIProviderDefinition {
  label: string;
  transport: AITransportKind;
  apiKind: AIRequestApiKind;
  env: {
    apiKey: string;
    baseUrl?: string;
  };
  defaultBaseUrl?: string;
  requiresApiKey: boolean;
  requiresBaseUrl?: boolean;
  legacy?: {
    apiKey?: readonly string[];
    baseUrl?: readonly string[];
  };
}

export interface AIResolvedProviderConfig extends AIProviderDefinition {
  id: AIProviderId;
  apiKey?: string;
  baseUrl?: string;
}

export interface AISharedRouteDefinition {
  provider: AIProviderId;
  model: string;
  description: string;
  tools?: readonly AIToolDefinition[];
}

export interface AIBusinessCapabilityDefinition {
  route: AISharedRouteId;
  description: string;
  status: AICapabilityStatus;
  provider?: AIProviderId;
  model?: string;
  tools?: readonly AIToolDefinition[];
}

export interface AIBusinessToolingDependency {
  id: string;
  label: string;
  kind: "local-cli" | "browser-automation" | "openai-compatible";
  status: AICapabilityStatus;
  notes: string;
}

export interface AIBusinessMetadata {
  label: string;
  status: AICapabilityStatus;
  description: string;
  tooling: readonly AIBusinessToolingDependency[];
}

export interface AIResolvedRouteDefinition extends AISharedRouteDefinition {
  routeId: string;
  sharedRouteId: AISharedRouteId;
  businessId?: string;
  capabilityId?: string;
  status: AICapabilityStatus;
  providerLabel: string;
}

export const AI_PROVIDER_MAP: Record<AIProviderId, AIProviderDefinition> = {
  openai: {
    label: "OpenAI",
    transport: "openai-compatible",
    apiKind: "responses",
    env: {
      apiKey: "AI_PROVIDER_OPENAI_API_KEY",
      baseUrl: "AI_PROVIDER_OPENAI_BASE_URL"
    },
    requiresApiKey: true,
    legacy: {
      apiKey: ["OPENAI_API_KEY"],
      baseUrl: ["OPENAI_BASE_URL"]
    }
  },
  nvidia: {
    label: "NVIDIA API Catalog",
    transport: "openai-compatible",
    apiKind: "chat-completions",
    env: {
      apiKey: "AI_PROVIDER_NVIDIA_API_KEY",
      baseUrl: "AI_PROVIDER_NVIDIA_BASE_URL"
    },
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    requiresApiKey: true,
    requiresBaseUrl: true,
    legacy: {
      apiKey: ["NVIDIA_API_KEY"],
      baseUrl: ["NVIDIA_BASE_URL"]
    }
  },
  local: {
    label: "Local OpenAI-Compatible",
    transport: "openai-compatible",
    apiKind: "responses",
    env: {
      apiKey: "AI_PROVIDER_LOCAL_API_KEY",
      baseUrl: "AI_PROVIDER_LOCAL_BASE_URL"
    },
    requiresApiKey: false,
    requiresBaseUrl: true
  }
};

export const AI_SHARED_ROUTE_MAP: Record<AISharedRouteId, AISharedRouteDefinition> = {
  fast: {
    provider: "nvidia",
    model: "microsoft/phi-3.5-mini-instruct",
    description: "Shared low-cost route for lightweight scoring, drafting, and chat responses."
  },
  deep: {
    provider: "nvidia",
    model: "deepseek-ai/deepseek-v3.1",
    description: "Shared higher-depth route for richer composition, synthesis, and reporting."
  },
  research: {
    provider: "openai",
    model: "gpt-5",
    description: "Shared research route for web-backed summaries and prospect enrichment.",
    tools: [{ type: "web_search_preview" }]
  }
};

export const AI_BUSINESS_METADATA: Record<AIManagedBusinessId, AIBusinessMetadata> = {
  "imon-engine": {
    label: "ImonEngine",
    status: "active",
    description: "Shared engine and control-room AI routes.",
    tooling: []
  },
  "imon-digital-asset-store": {
    label: "Imon Digital Asset Store",
    status: "active",
    description: "Digital asset blueprint and listing-support AI routes.",
    tooling: []
  },
  "imon-niche-content-sites": {
    label: "Northbeam Atlas Network",
    status: "reserved",
    description: "Reserved AI namespace for future content-site planning and research flows.",
    tooling: []
  },
  "imon-faceless-social-brand": {
    label: "Velora Echo Media",
    status: "reserved",
    description: "Reserved AI namespace for future social-brand scripting and analysis flows.",
    tooling: []
  },
  "clipbaiters-viral-moments": {
    label: "ClipBaiters - Viral Moments",
    status: "reserved",
    description: "Reserved LLM namespace plus AI-adjacent tooling inventory for the clipping lane.",
    tooling: [
      {
        id: "whisper-cli",
        label: "OpenAI Whisper CLI",
        kind: "local-cli",
        status: "active",
        notes: "Used by the ClipBaiters render pipeline and business-worker image for transcription."
      }
    ]
  },
  "imon-micro-saas-factory": {
    label: "QuietPivot Labs",
    status: "reserved",
    description: "Reserved AI namespace for future micro-SaaS ideation and product drafting flows.",
    tooling: []
  },
  "imon-pod-store": {
    label: "Imonic",
    status: "reserved",
    description: "Reserved AI namespace for future merchandising and storefront-support routes.",
    tooling: []
  },
  "auto-funding-agency": {
    label: "Northline Growth Systems",
    status: "active",
    description: "Northline lead scoring, outreach, site copy, reply handling, retention, and prospect research routes.",
    tooling: []
  }
};

export const AI_BUSINESS_ROUTE_MAP: Record<AIManagedBusinessId, Record<string, AIBusinessCapabilityDefinition>> = {
  "imon-engine": {
    "office-chat": {
      route: "fast",
      status: "active",
      description: "Control-room assistant responses for engine, business, and department offices."
    },
    "market-research": {
      route: "research",
      status: "active",
      description: "Web-backed market summaries for the engine and selected businesses."
    }
  },
  "imon-digital-asset-store": {
    "asset-blueprint": {
      route: "deep",
      status: "active",
      description: "Asset-pack blueprint generation for the Imon Digital Asset Store."
    }
  },
  "imon-niche-content-sites": {},
  "imon-faceless-social-brand": {},
  "clipbaiters-viral-moments": {},
  "imon-micro-saas-factory": {},
  "imon-pod-store": {},
  "auto-funding-agency": {
    "qualify-lead": {
      route: "fast",
      status: "active",
      description: "Northline lead scoring and stage normalization."
    },
    "outreach-draft": {
      route: "fast",
      status: "active",
      description: "Northline outreach draft generation."
    },
    "site-copy": {
      route: "deep",
      status: "active",
      description: "Northline landing-page copy generation."
    },
    "reply-classification": {
      route: "fast",
      status: "active",
      description: "Northline reply classification for booked-call and intake routing."
    },
    "retention-report": {
      route: "deep",
      status: "active",
      description: "Northline monthly retention report drafting."
    },
    "prospect-research": {
      route: "research",
      status: "active",
      description: "Northline web-backed prospect collection supplementation."
    }
  }
};

export function isAIManagedBusinessId(value: string | undefined): value is AIManagedBusinessId {
  return value !== undefined && value in AI_BUSINESS_METADATA;
}

export function providerLabel(providerId: AIProviderId): string {
  return AI_PROVIDER_MAP[providerId].label;
}

export function resolveAIRouteDefinition(options: {
  businessId?: string;
  capabilityId?: string;
  sharedRouteId: AISharedRouteId;
}): AIResolvedRouteDefinition {
  const businessId = isAIManagedBusinessId(options.businessId) ? options.businessId : undefined;
  const businessRoutes = businessId ? AI_BUSINESS_ROUTE_MAP[businessId] : undefined;
  const capability = businessId && options.capabilityId ? businessRoutes?.[options.capabilityId] : undefined;
  const sharedRouteId = capability?.route ?? options.sharedRouteId;
  const sharedRoute = AI_SHARED_ROUTE_MAP[sharedRouteId];

  return {
    ...sharedRoute,
    provider: capability?.provider ?? sharedRoute.provider,
    model: capability?.model ?? sharedRoute.model,
    tools: capability?.tools ?? sharedRoute.tools,
    routeId: businessId && options.capabilityId ? `${businessId}.${options.capabilityId}` : sharedRouteId,
    sharedRouteId,
    businessId,
    capabilityId: options.capabilityId,
    status: capability?.status ?? (businessId ? AI_BUSINESS_METADATA[businessId].status : "active"),
    providerLabel: providerLabel(capability?.provider ?? sharedRoute.provider)
  };
}