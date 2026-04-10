import path from "node:path";
import type { AppConfig } from "../config.js";
import type { ControlRoomBusinessView, ControlRoomSnapshot } from "../domain/control-room.js";
import type {
  ApprovalActionClass,
  ApprovalRiskLevel,
  BusinessScaffoldDraft,
  DepartmentWorkspaceView,
  OfficeChatAction,
  OfficeChatMessage,
  OfficeChatThread,
  OfficeChatView,
  OfficeOperatingConfig,
  OfficeReportArtifact,
  OrgScope,
  OrgAuditEventType,
  OrgAuditSeverity
} from "../domain/org.js";
import type { BusinessCategory, ManagedBusinessSeed } from "../domain/engine.js";
import { ImonEngineAgent } from "../agents/imon-engine.js";
import { ensureDir, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { AIClient } from "../ai/client.js";
import { FileStore } from "../storage/store.js";
import { ControlRoomSnapshotService } from "./control-room-snapshot.js";
import { OfficeDashboardService } from "./office-dashboard.js";
import {
  assistantLabelForOfficeScope,
  buildOfficeChatSummary
} from "./office-chat-shared.js";

type ChatScope = Extract<OrgScope, "engine" | "business" | "department">;

export interface OfficeChatTarget {
  scope: ChatScope;
  businessId?: string;
  departmentId?: string;
}

type ResolvedOfficeTarget = {
  scope: ChatScope;
  officeId: string;
  engineId: string;
  title: string;
  route: string;
  snapshot: ControlRoomSnapshot;
  business?: ControlRoomBusinessView;
  workspace?: DepartmentWorkspaceView;
};

type MutableOfficeChatState = {
  thread: OfficeChatThread;
  messages: OfficeChatMessage[];
  actions: OfficeChatAction[];
  reports: OfficeReportArtifact[];
  operatingConfig: OfficeOperatingConfig;
  drafts: BusinessScaffoldDraft[];
};

type ChatIntent =
  | {
      kind: "generate_report";
      title: string;
      marketResearch: boolean;
    }
  | {
      kind: "create_business_scaffold_draft";
      title: string;
      proposedBusiness: ManagedBusinessSeed;
    }
  | {
      kind: "route_task";
      title: string;
      riskLevel: ApprovalRiskLevel;
      actionClasses: ApprovalActionClass[];
      publicFacing: boolean;
      moneyMovement: boolean;
      requiresVerifiedFinancialData: boolean;
    }
  | {
      kind: "update_office_directives";
      title: string;
      directive: string;
    }
  | {
      kind: "update_schedule_override";
      title: string;
      cadence: string;
      preferredWindows: string[];
    }
  | {
      kind: "create_execution_brief";
      title: string;
      riskLevel: ApprovalRiskLevel;
    }
  | {
      kind: "answer_question";
      title: string;
    };

type ChatOutcome = {
  assistantContent: string;
  actions: OfficeChatAction[];
  reports: OfficeReportArtifact[];
};

type CategoryDefaults = Pick<
  ManagedBusinessSeed,
  | "revenueModel"
  | "platforms"
  | "automationFocus"
  | "approvalType"
  | "automationPotential"
  | "setupComplexity"
  | "complianceRisk"
  | "supportLoad"
  | "humanSetupHours"
  | "schedule"
  | "resourceBudget"
  | "metrics"
  | "ownerActions"
  | "launchBlockers"
  | "notes"
>;

function nowIso(): string {
  return new Date().toISOString();
}

function timestampSuffix(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function safeSentence(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function excerpt(value: string, maxLength = 140): string {
  const normalized = safeSentence(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

const CATEGORY_DEFAULTS: Record<BusinessCategory, CategoryDefaults> = {
  digital_asset_store: {
    revenueModel: "Marketplace royalties and direct digital downloads",
    platforms: ["Gumroad", "Etsy", "Creative Market"],
    automationFocus: [
      "Generate product concepts and listing packs",
      "Track marketplace conversion and refund anomalies",
      "Stage launch assets and product metadata"
    ],
    approvalType: "marketplace",
    automationPotential: 0.88,
    setupComplexity: 0.32,
    complianceRisk: "low",
    supportLoad: "low",
    humanSetupHours: 3,
    schedule: {
      cadence: "daily",
      timezone: "America/New_York",
      maxRunsPerDay: 2,
      preferredWindows: ["09:00", "15:00"]
    },
    resourceBudget: {
      maxCpuShare: 0.2,
      maxMemoryGb: 1,
      maxDiskGb: 6
    },
    metrics: {
      targetMonthlyRevenue: 250,
      currentMonthlyRevenue: 0,
      currentMonthlyCosts: 0,
      dataValueScore: 0,
      automationCoverage: 0.4,
      activeWorkItems: 0
    },
    ownerActions: ["Review the scaffold and activate when resources open up."],
    launchBlockers: [],
    notes: ["Created from a control-room chat scaffold draft."]
  },
  niche_content_site: {
    revenueModel: "Affiliate commissions and ad revenue",
    platforms: ["Static site", "Search Console", "Pinterest", "Newsletter"],
    automationFocus: [
      "Generate search-driven briefs",
      "Publish low-support articles and updates",
      "Track ranking movement and affiliate content gaps"
    ],
    approvalType: "domain",
    automationPotential: 0.76,
    setupComplexity: 0.45,
    complianceRisk: "low",
    supportLoad: "low",
    humanSetupHours: 5,
    schedule: {
      cadence: "daily",
      timezone: "America/New_York",
      maxRunsPerDay: 2,
      preferredWindows: ["08:00", "13:00"]
    },
    resourceBudget: {
      maxCpuShare: 0.18,
      maxMemoryGb: 1,
      maxDiskGb: 8
    },
    metrics: {
      targetMonthlyRevenue: 400,
      currentMonthlyRevenue: 0,
      currentMonthlyCosts: 0,
      dataValueScore: 0,
      automationCoverage: 0.35,
      activeWorkItems: 0
    },
    ownerActions: ["Review niche assumptions before promotion from deferred."],
    launchBlockers: [],
    notes: ["Created from a control-room chat scaffold draft."]
  },
  faceless_social_brand: {
    revenueModel: "Sponsor revenue, affiliate links, and funnel traffic",
    platforms: ["Instagram", "TikTok", "Pinterest", "Newsletter"],
    automationFocus: [
      "Plan editorial cadence",
      "Generate content prompts and batch briefs",
      "Track reach, saves, and clickthrough signals"
    ],
    approvalType: "manual",
    automationPotential: 0.71,
    setupComplexity: 0.41,
    complianceRisk: "medium",
    supportLoad: "medium",
    humanSetupHours: 4,
    schedule: {
      cadence: "daily",
      timezone: "America/New_York",
      maxRunsPerDay: 3,
      preferredWindows: ["10:00", "18:00"]
    },
    resourceBudget: {
      maxCpuShare: 0.16,
      maxMemoryGb: 1,
      maxDiskGb: 5
    },
    metrics: {
      targetMonthlyRevenue: 300,
      currentMonthlyRevenue: 0,
      currentMonthlyCosts: 0,
      dataValueScore: 0,
      automationCoverage: 0.3,
      activeWorkItems: 0
    },
    ownerActions: ["Review channel strategy before activation."],
    launchBlockers: [],
    notes: ["Created from a control-room chat scaffold draft."]
  },
  micro_saas_factory: {
    revenueModel: "Subscription and usage-based SaaS billing",
    platforms: ["Cloudflare", "Stripe", "Static marketing site"],
    automationFocus: [
      "Validate problem statements and feature drafts",
      "Ship narrow operational tools",
      "Track trial conversion and churn signals"
    ],
    approvalType: "payment",
    automationPotential: 0.69,
    setupComplexity: 0.62,
    complianceRisk: "medium",
    supportLoad: "medium",
    humanSetupHours: 7,
    schedule: {
      cadence: "daily",
      timezone: "America/New_York",
      maxRunsPerDay: 2,
      preferredWindows: ["11:00", "17:00"]
    },
    resourceBudget: {
      maxCpuShare: 0.24,
      maxMemoryGb: 2,
      maxDiskGb: 10
    },
    metrics: {
      targetMonthlyRevenue: 500,
      currentMonthlyRevenue: 0,
      currentMonthlyCosts: 0,
      dataValueScore: 0,
      automationCoverage: 0.28,
      activeWorkItems: 0
    },
    ownerActions: ["Review pricing and hosting assumptions before activation."],
    launchBlockers: [],
    notes: ["Created from a control-room chat scaffold draft."]
  },
  print_on_demand_store: {
    revenueModel: "Print-on-demand margin and direct storefront orders",
    platforms: ["Shopify", "Printful", "Instagram", "Pinterest"],
    automationFocus: [
      "Generate design and listing batches",
      "Stage product launches and merchandising updates",
      "Track product performance and reorder candidates"
    ],
    approvalType: "manual",
    automationPotential: 0.74,
    setupComplexity: 0.49,
    complianceRisk: "low",
    supportLoad: "medium",
    humanSetupHours: 5,
    schedule: {
      cadence: "daily",
      timezone: "America/New_York",
      maxRunsPerDay: 2,
      preferredWindows: ["09:30", "16:30"]
    },
    resourceBudget: {
      maxCpuShare: 0.22,
      maxMemoryGb: 1.5,
      maxDiskGb: 8
    },
    metrics: {
      targetMonthlyRevenue: 350,
      currentMonthlyRevenue: 0,
      currentMonthlyCosts: 0,
      dataValueScore: 0,
      automationCoverage: 0.33,
      activeWorkItems: 0
    },
    ownerActions: ["Review supplier and storefront dependencies before activation."],
    launchBlockers: [],
    notes: ["Created from a control-room chat scaffold draft."]
  },
  client_services_agency: {
    revenueModel: "Setup fees and monthly retainers",
    platforms: ["Email outreach", "Cloudflare Pages", "Stripe"],
    automationFocus: [
      "Prospecting and lead scoring",
      "Outreach drafting and routing",
      "Client site builds and retention reporting"
    ],
    approvalType: "manual",
    automationPotential: 0.63,
    setupComplexity: 0.58,
    complianceRisk: "medium",
    supportLoad: "medium",
    humanSetupHours: 6,
    schedule: {
      cadence: "daily",
      timezone: "America/New_York",
      maxRunsPerDay: 2,
      preferredWindows: ["08:30", "14:30"]
    },
    resourceBudget: {
      maxCpuShare: 0.2,
      maxMemoryGb: 1.5,
      maxDiskGb: 8
    },
    metrics: {
      targetMonthlyRevenue: 1000,
      currentMonthlyRevenue: 0,
      currentMonthlyCosts: 0,
      dataValueScore: 0,
      automationCoverage: 0.25,
      activeWorkItems: 0
    },
    ownerActions: ["Review service offer and delivery assumptions before activation."],
    launchBlockers: [],
    notes: ["Created from a control-room chat scaffold draft."]
  }
};

function businessCategoryFromPrompt(prompt: string): BusinessCategory {
  const lower = prompt.toLowerCase();
  if (lower.includes("pod") || lower.includes("print on demand") || lower.includes("merch")) {
    return "print_on_demand_store";
  }
  if (lower.includes("saas") || lower.includes("software") || lower.includes("app")) {
    return "micro_saas_factory";
  }
  if (lower.includes("agency") || lower.includes("outreach") || lower.includes("home service")) {
    return "client_services_agency";
  }
  if (lower.includes("social") || lower.includes("creator") || lower.includes("media brand")) {
    return "faceless_social_brand";
  }
  if (lower.includes("content") || lower.includes("blog") || lower.includes("seo")) {
    return "niche_content_site";
  }
  return "digital_asset_store";
}

function businessNameFromPrompt(prompt: string): string {
  const quoted =
    prompt.match(/"([^"]{3,80})"/)?.[1] ?? prompt.match(/'([^']{3,80})'/)?.[1];
  if (quoted) {
    return safeSentence(quoted);
  }
  const namedMatch = prompt.match(/\b(?:called|named)\s+([A-Z][a-zA-Z0-9&' -]{2,80})/);
  if (namedMatch?.[1]) {
    return safeSentence(namedMatch[1].replace(/[.?!]+$/, ""));
  }
  const titleWords = prompt
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !["create", "new", "business", "brand", "company", "launch", "start"].includes(word.toLowerCase()))
    .slice(0, 4)
    .map((word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase());
  return titleWords.length > 0 ? titleWords.join(" ") : "New Venture";
}

function moduleForCategory(category: BusinessCategory): string {
  if (category === "digital_asset_store") return "digital-asset-factory";
  if (category === "niche_content_site") return "content-site-network";
  if (category === "faceless_social_brand") return "social-brand-studio";
  if (category === "micro_saas_factory") return "micro-saas-factory";
  if (category === "print_on_demand_store") return "pod-studio";
  return "client-services-agency";
}

function directiveFromPrompt(prompt: string): string {
  const cleaned = safeSentence(prompt);
  return excerpt(
    cleaned.match(/\b(?:prompt|directive|instruction)s?\b[:\s-]*(.+)$/i)?.[1] ?? cleaned,
    220
  );
}

function scheduleFromPrompt(prompt: string): { cadence: string; preferredWindows: string[] } {
  const cleaned = safeSentence(prompt);
  const cadence = excerpt(
    cleaned.match(/\b(?:schedule|cadence|calendar)\b[:\s-]*(.+)$/i)?.[1] ?? cleaned,
    120
  );
  const preferredWindows = uniqueStrings(
    [...cleaned.matchAll(/\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi)].map((match) => match[0])
  );
  return { cadence, preferredWindows };
}

function requestTitle(prefix: string, prompt: string): string {
  return `${prefix}: ${excerpt(prompt.replace(/[.?!]+$/, ""), 72)}`;
}

export class OfficeChatService {
  private readonly ai: AIClient;

  private readonly snapshotService: ControlRoomSnapshotService;

  private readonly imonEngine: ImonEngineAgent;

  private readonly dashboard: OfficeDashboardService;

  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {
    this.ai = new AIClient(config);
    this.snapshotService = new ControlRoomSnapshotService(config, store);
    this.imonEngine = new ImonEngineAgent(config, store);
    this.dashboard = new OfficeDashboardService(config, store);
  }

  async getChat(target: OfficeChatTarget): Promise<OfficeChatView> {
    const resolved = await this.resolveTarget(target);
    const state = await this.ensureState(resolved);
    return this.toChatView(resolved, state);
  }

  async submitMessage(target: OfficeChatTarget, rawMessage: string): Promise<OfficeChatView> {
    const message = safeSentence(rawMessage);
    if (!message) {
      throw new Error("Chat message cannot be empty.");
    }

    const resolved = await this.resolveTarget(target);
    const state = await this.ensureState(resolved);
    const userMessage: OfficeChatMessage = {
      id: `office-chat-message-${timestampSuffix()}-${Math.random().toString(36).slice(2, 8)}`,
      threadId: state.thread.id,
      officeId: resolved.officeId,
      scope: resolved.scope,
      businessId: resolved.business?.id,
      departmentId: resolved.workspace?.departmentId,
      role: "user",
      content: message,
      actionIds: [],
      createdAt: nowIso()
    };
    await this.store.saveOfficeChatMessage(userMessage);
    state.messages.push(userMessage);

    const outcome = await this.handleIntent(resolved, state, message);
    for (const action of outcome.actions) {
      await this.store.saveOfficeChatAction(action);
      state.actions.push(action);
    }
    for (const report of outcome.reports) {
      await this.store.saveOfficeReportArtifact(report);
      state.reports.push(report);
    }

    const assistantMessage: OfficeChatMessage = {
      id: `office-chat-message-${timestampSuffix()}-${Math.random().toString(36).slice(2, 8)}`,
      threadId: state.thread.id,
      officeId: resolved.officeId,
      scope: resolved.scope,
      businessId: resolved.business?.id,
      departmentId: resolved.workspace?.departmentId,
      role: "assistant",
      content: outcome.assistantContent,
      actionIds: outcome.actions.map((action) => action.id),
      createdAt: nowIso()
    };
    await this.store.saveOfficeChatMessage(assistantMessage);
    state.messages.push(assistantMessage);
    await this.updateThreadSummary(state, resolved, assistantMessage.createdAt);
    await this.dashboard.writeDashboard();
    return this.toChatView(resolved, state);
  }

  async applyAction(actionId: string): Promise<OfficeChatView> {
    const [actions, drafts] = await Promise.all([
      this.store.getOfficeChatActions(),
      this.store.getBusinessScaffoldDrafts()
    ]);
    const action = actions.find((entry) => entry.id === actionId);
    if (!action) {
      throw new Error(`Chat action ${actionId} was not found.`);
    }
    if (action.status !== "awaiting_confirmation") {
      throw new Error(`Chat action ${actionId} is not awaiting confirmation.`);
    }
    if (action.kind !== "create_business_scaffold_draft") {
      throw new Error(`Action ${action.id} does not support apply.`);
    }

    const resolved = await this.resolveTarget({
      scope: action.scope,
      businessId: action.businessId,
      departmentId: action.departmentId
    });
    const state = await this.ensureState(resolved);
    const draftId = String(action.payload.draftId ?? "");
    const draft = drafts.find((entry) => entry.id === draftId);
    if (!draft) {
      throw new Error(`Business scaffold draft ${draftId} was not found.`);
    }

    const createdBusiness = await this.imonEngine.createBusinessFromSeed(draft.proposedBusiness);
    const updatedAction: OfficeChatAction = {
      ...action,
      status: "completed",
      resultLines: [
        ...action.resultLines,
        `Applied scaffold draft and created ${createdBusiness.name} in deferred status.`
      ],
      updatedAt: nowIso()
    };
    await this.store.saveOfficeChatAction(updatedAction);
    state.actions = state.actions.map((entry) =>
      entry.id === updatedAction.id ? updatedAction : entry
    );

    const followupAction: OfficeChatAction = {
      id: `office-chat-action-${timestampSuffix()}-${Math.random().toString(36).slice(2, 8)}`,
      threadId: action.threadId,
      officeId: action.officeId,
      scope: action.scope,
      kind: "apply_business_scaffold_draft",
      status: "completed",
      title: `Applied business scaffold: ${createdBusiness.name}`,
      summary: `Created ${createdBusiness.name} from chat.`,
      payload: {
        draftId: draft.id,
        businessId: createdBusiness.id
      },
      resultLines: [
        `Business id: ${createdBusiness.id}`,
        `Stage: ${createdBusiness.stage}`,
        `Category: ${createdBusiness.category}`
      ],
      reportArtifactIds: [],
      taskEnvelopeIds: [],
      approvalIds: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    await this.store.saveOfficeChatAction(followupAction);
    state.actions.push(followupAction);

    await this.writeAudit(resolved, "tool_use", "info", [
      `Applied chat scaffold draft for ${createdBusiness.name}.`,
      `Business id: ${createdBusiness.id}`,
      `Stage: ${createdBusiness.stage}`
    ]);

    const message: OfficeChatMessage = {
      id: `office-chat-message-${timestampSuffix()}-${Math.random().toString(36).slice(2, 8)}`,
      threadId: action.threadId,
      officeId: action.officeId,
      scope: action.scope,
      role: "action",
      content: `Applied the scaffold draft and created ${createdBusiness.name}. The new business is now available in the engine office under deferred businesses.`,
      actionIds: [updatedAction.id, followupAction.id],
      createdAt: nowIso()
    };
    await this.store.saveOfficeChatMessage(message);
    state.messages.push(message);
    await this.updateThreadSummary(state, resolved, message.createdAt);
    await this.dashboard.writeDashboard();
    return this.toChatView(resolved, state);
  }

  async dismissAction(actionId: string): Promise<OfficeChatView> {
    const actions = await this.store.getOfficeChatActions();
    const action = actions.find((entry) => entry.id === actionId);
    if (!action) {
      throw new Error(`Chat action ${actionId} was not found.`);
    }
    if (action.status !== "awaiting_confirmation") {
      throw new Error(`Chat action ${actionId} is not awaiting confirmation.`);
    }

    const resolved = await this.resolveTarget({
      scope: action.scope,
      businessId: action.businessId,
      departmentId: action.departmentId
    });
    const state = await this.ensureState(resolved);
    const nextAction: OfficeChatAction = {
      ...action,
      status: "dismissed",
      resultLines: [...action.resultLines, "Dismissed without applying changes."],
      updatedAt: nowIso()
    };
    await this.store.saveOfficeChatAction(nextAction);
    state.actions = state.actions.map((entry) =>
      entry.id === nextAction.id ? nextAction : entry
    );
    await this.writeAudit(resolved, "tool_use", "info", [
      `Dismissed chat action ${action.title}.`,
      action.summary
    ]);
    const message: OfficeChatMessage = {
      id: `office-chat-message-${timestampSuffix()}-${Math.random().toString(36).slice(2, 8)}`,
      threadId: action.threadId,
      officeId: action.officeId,
      scope: action.scope,
      role: "action",
      content: `Dismissed ${action.title}. No durable changes were applied.`,
      actionIds: [action.id],
      createdAt: nowIso()
    };
    await this.store.saveOfficeChatMessage(message);
    state.messages.push(message);
    await this.updateThreadSummary(state, resolved, message.createdAt);
    await this.dashboard.writeDashboard();
    return this.toChatView(resolved, state);
  }

  private async resolveTarget(target: OfficeChatTarget): Promise<ResolvedOfficeTarget> {
    const snapshot = await this.snapshotService.buildSnapshot();
    if (target.scope === "engine") {
      return {
        scope: "engine",
        officeId: snapshot.executiveView.id,
        engineId: snapshot.engineId,
        title: snapshot.executiveView.title,
        route: "/engine",
        snapshot
      };
    }

    const business = snapshot.businesses.find((entry) => entry.id === target.businessId);
    if (!business || !business.office) {
      throw new Error(`Business ${target.businessId ?? "unknown"} was not found.`);
    }
    if (target.scope === "business") {
      return {
        scope: "business",
        officeId: business.office.id,
        engineId: snapshot.engineId,
        title: business.office.title,
        route: `/business/${encodeURIComponent(business.id)}`,
        snapshot,
        business
      };
    }

    const workspace = snapshot.departmentWorkspaces.find(
      (entry) =>
        entry.businessId === business.id && entry.departmentId === target.departmentId
    );
    if (!workspace) {
      throw new Error(
        `Department ${target.departmentId ?? "unknown"} was not found for ${business.name}.`
      );
    }
    return {
      scope: "department",
      officeId: workspace.id,
      engineId: snapshot.engineId,
      title: workspace.title,
      route: `/department/${encodeURIComponent(workspace.businessId)}/${encodeURIComponent(
        workspace.departmentId
      )}`,
      snapshot,
      business,
      workspace
    };
  }

  private async ensureState(resolved: ResolvedOfficeTarget): Promise<MutableOfficeChatState> {
    const [threads, messages, actions, reports, operatingConfigs, drafts] = await Promise.all([
      this.store.getOfficeChatThreads(),
      this.store.getOfficeChatMessages(),
      this.store.getOfficeChatActions(),
      this.store.getOfficeReportArtifacts(),
      this.store.getOfficeOperatingConfigs(),
      this.store.getBusinessScaffoldDrafts()
    ]);

    let thread = threads.find((entry) => entry.officeId === resolved.officeId);
    if (!thread) {
      const createdAt = nowIso();
      thread = {
        id: `office-chat-thread-${slugify(resolved.officeId)}`,
        officeId: resolved.officeId,
        scope: resolved.scope,
        businessId: resolved.business?.id,
        departmentId: resolved.workspace?.departmentId,
        assistantLabel: assistantLabelForOfficeScope(resolved.scope),
        summary: `No chat history yet for ${resolved.title}.`,
        createdAt,
        updatedAt: createdAt
      };
      await this.store.saveOfficeChatThread(thread);
    }

    let operatingConfig = operatingConfigs.find((entry) => entry.officeId === resolved.officeId);
    if (!operatingConfig) {
      const createdAt = nowIso();
      operatingConfig = {
        id: `office-operating-config-${slugify(resolved.officeId)}`,
        officeId: resolved.officeId,
        scope: resolved.scope,
        businessId: resolved.business?.id,
        departmentId: resolved.workspace?.departmentId,
        promptDirectives: [],
        createdAt,
        updatedAt: createdAt
      };
      await this.store.saveOfficeOperatingConfig(operatingConfig);
    }

    return {
      thread,
      messages: messages
        .filter((entry) => entry.threadId === thread.id)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      actions: actions
        .filter((entry) => entry.threadId === thread.id)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      reports: reports
        .filter((entry) => entry.officeId === resolved.officeId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      operatingConfig,
      drafts
    };
  }

  private toChatView(
    resolved: ResolvedOfficeTarget,
    state: MutableOfficeChatState
  ): OfficeChatView {
    return {
      thread: state.thread,
      messages: state.messages,
      actions: state.actions,
      reports: state.reports,
      operatingConfig: state.operatingConfig,
      summary: buildOfficeChatSummary({
        officeId: resolved.officeId,
        scope: resolved.scope,
        thread: state.thread,
        messages: state.messages,
        actions: state.actions,
        reports: state.reports
      })
    };
  }

  private async handleIntent(
    resolved: ResolvedOfficeTarget,
    state: MutableOfficeChatState,
    message: string
  ): Promise<ChatOutcome> {
    const intent = await this.detectIntent(resolved, message);
    switch (intent.kind) {
      case "generate_report":
        return this.generateReport(resolved, state, message, intent);
      case "create_business_scaffold_draft":
        return this.createBusinessDraft(resolved, state, message, intent);
      case "route_task":
        return this.routeTask(resolved, state, message, intent);
      case "update_office_directives":
        return this.updateOfficeDirectives(resolved, state, intent);
      case "update_schedule_override":
        return this.updateScheduleOverride(resolved, state, message, intent);
      case "create_execution_brief":
        return this.createExecutionBrief(resolved, state, message, intent);
      case "answer_question":
      default:
        return this.answerQuestion(resolved, state, message, intent);
    }
  }

  private async detectIntent(
    resolved: ResolvedOfficeTarget,
    message: string
  ): Promise<ChatIntent> {
    const lower = message.toLowerCase();
    const reportSignal =
      /\b(report|summary|summarize|profit|profits|growth|analytics|accounting|dashboard|kpi|metrics?)\b/.test(
        lower
      );

    if (
      resolved.scope === "engine" &&
      /\b(create|start|launch|scaffold|draft)\b/.test(lower) &&
      /\b(business|brand|venture|company)\b/.test(lower)
    ) {
      return {
        kind: "create_business_scaffold_draft",
        title: requestTitle("Business Scaffold", message),
        proposedBusiness: await this.businessDraftFromPrompt(resolved, message)
      };
    }

    if (
      /\b(schedule|cadence|calendar|posting schedule)\b/.test(lower) &&
      /\b(set|change|update|move|override|adjust)\b/.test(lower)
    ) {
      const schedule = scheduleFromPrompt(message);
      return {
        kind: "update_schedule_override",
        title: requestTitle("Schedule Override", message),
        cadence: schedule.cadence,
        preferredWindows: schedule.preferredWindows
      };
    }

    if (
      /\b(prompt|directive|instruction|instructions)\b/.test(lower) &&
      /\b(add|update|save|remember|append|use)\b/.test(lower)
    ) {
      return {
        kind: "update_office_directives",
        title: requestTitle("Directive Update", message),
        directive: directiveFromPrompt(message)
      };
    }

    if (
      resolved.scope === "department" &&
      /\b(brief|steer|worker|produce|design|draft|build|execute|plan)\b/.test(lower) &&
      !reportSignal
    ) {
      return {
        kind: "create_execution_brief",
        title: requestTitle("Execution Brief", message),
        riskLevel: this.deriveRiskLevel(lower)
      };
    }

    if (
      /\b(route|coordinate|handoff|departments|multi department|multi-department)\b/.test(lower) ||
      /\b(send|publish|post|outreach|contact|invoice|charge|ad spend|ads)\b/.test(lower)
    ) {
      return {
        kind: "route_task",
        title: requestTitle("Routed Task", message),
        riskLevel: this.deriveRiskLevel(lower),
        actionClasses: this.deriveActionClasses(resolved.scope, lower),
        publicFacing:
          /\b(send|publish|post|outreach|contact|client|customer|prospect)\b/.test(lower),
        moneyMovement: /\b(invoice|charge|budget|spend|payment|cash)\b/.test(lower),
        requiresVerifiedFinancialData:
          /\b(finance|financial|budget|profit|cash|accounting)\b/.test(lower)
      };
    }

    if (reportSignal || /\bmarket|competitor|trend|audience\b/.test(lower)) {
      return {
        kind: "generate_report",
        title: requestTitle("Report", message),
        marketResearch: /\bmarket|competitor|trend|audience\b/.test(lower)
      };
    }

    return {
      kind: "answer_question",
      title: requestTitle("Answer", message)
    };
  }

  private async businessDraftFromPrompt(
    resolved: ResolvedOfficeTarget,
    message: string
  ): Promise<ManagedBusinessSeed> {
    const businesses = resolved.snapshot.businesses;
    const category = businessCategoryFromPrompt(message);
    const defaults = CATEGORY_DEFAULTS[category];
    const proposedName = businessNameFromPrompt(message);
    let id = slugify(proposedName);
    if (!id) {
      id = `business-${timestampSuffix()}`;
    }
    const baseId = id;
    let suffix = 2;
    while (businesses.some((business) => business.id === id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }

    return {
      id,
      name: proposedName,
      module: moduleForCategory(category),
      category,
      orgBlueprintId: `org-business-${id}`,
      launchPriority: businesses.length + 1,
      stage: "deferred",
      summary: excerpt(message, 180),
      rolloutReason: `Scaffolded from the ${resolved.title} chat for later validation and activation.`,
      revenueModel: defaults.revenueModel,
      platforms: defaults.platforms,
      automationFocus: defaults.automationFocus,
      ownerActions: defaults.ownerActions,
      launchBlockers: defaults.launchBlockers,
      approvalType: defaults.approvalType,
      automationPotential: defaults.automationPotential,
      setupComplexity: defaults.setupComplexity,
      complianceRisk: defaults.complianceRisk,
      supportLoad: defaults.supportLoad,
      humanSetupHours: defaults.humanSetupHours,
      schedule: defaults.schedule,
      resourceBudget: defaults.resourceBudget,
      metrics: defaults.metrics,
      notes: defaults.notes
    };
  }

  private async generateReport(
    resolved: ResolvedOfficeTarget,
    state: MutableOfficeChatState,
    message: string,
    intent: Extract<ChatIntent, { kind: "generate_report" }>
  ): Promise<ChatOutcome> {
    const payload = await this.reportPayload(resolved, message, intent.marketResearch);
    const artifact = await this.writeReportArtifact(resolved, intent.title, payload);
    const action: OfficeChatAction = {
      id: `office-chat-action-${timestampSuffix()}-${Math.random().toString(36).slice(2, 8)}`,
      threadId: state.thread.id,
      officeId: resolved.officeId,
      scope: resolved.scope,
      businessId: resolved.business?.id,
      departmentId: resolved.workspace?.departmentId,
      kind: "generate_report",
      status: "completed",
      title: intent.title,
      summary: artifact.summary,
      payload: {
        reportArtifactId: artifact.id,
        marketResearch: intent.marketResearch
      },
      resultLines: [`Saved report artifact: ${artifact.title}`, ...payload.highlights.slice(0, 3)],
      reportArtifactIds: [artifact.id],
      taskEnvelopeIds: [],
      approvalIds: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    await this.writeAudit(resolved, "tool_use", "info", [
      `Generated ${artifact.title}.`,
      ...payload.highlights
    ]);
    return {
      assistantContent: `${payload.narrative}\n\nSaved ${artifact.title} to the office report history.`,
      actions: [action],
      reports: [artifact]
    };
  }

  private async createBusinessDraft(
    resolved: ResolvedOfficeTarget,
    state: MutableOfficeChatState,
    message: string,
    intent: Extract<ChatIntent, { kind: "create_business_scaffold_draft" }>
  ): Promise<ChatOutcome> {
    const createdAt = nowIso();
    const draft: BusinessScaffoldDraft = {
      id: `business-scaffold-draft-${intent.proposedBusiness.id}`,
      officeId: resolved.officeId,
      threadId: state.thread.id,
      proposedBusiness: intent.proposedBusiness,
      createdAt,
      updatedAt: createdAt
    };
    await this.store.saveBusinessScaffoldDraft(draft);
    state.drafts.push(draft);

    const action: OfficeChatAction = {
      id: `office-chat-action-${timestampSuffix()}-${Math.random().toString(36).slice(2, 8)}`,
      threadId: state.thread.id,
      officeId: resolved.officeId,
      scope: resolved.scope,
      kind: "create_business_scaffold_draft",
      status: "awaiting_confirmation",
      title: `Create business scaffold: ${intent.proposedBusiness.name}`,
      summary: `Prepared a deferred ${intent.proposedBusiness.category.replaceAll("_", " ")} business draft.`,
      payload: {
        draftId: draft.id,
        businessId: intent.proposedBusiness.id,
        category: intent.proposedBusiness.category
      },
      resultLines: [
        `Name: ${intent.proposedBusiness.name}`,
        `Category: ${intent.proposedBusiness.category}`,
        `Stage on apply: deferred`
      ],
      reportArtifactIds: [],
      taskEnvelopeIds: [],
      approvalIds: [],
      createdAt,
      updatedAt: createdAt
    };
    await this.writeAudit(resolved, "tool_use", "info", [
      `Prepared a new business scaffold draft for ${intent.proposedBusiness.name}.`,
      `Business id: ${intent.proposedBusiness.id}`,
      `Summary: ${excerpt(message, 180)}`
    ]);
    return {
      assistantContent: `Prepared a deferred business scaffold draft for ${intent.proposedBusiness.name}. Review the action card, then apply it when you want the new business added to the portfolio.`,
      actions: [action],
      reports: []
    };
  }

  private async routeTask(
    resolved: ResolvedOfficeTarget,
    state: MutableOfficeChatState,
    message: string,
    intent: Extract<ChatIntent, { kind: "route_task" }>
  ): Promise<ChatOutcome> {
    const routeTarget = this.routeTargetForOffice(resolved);
    const routed = await this.imonEngine.routeTask({
      workflowId: routeTarget.workflowId,
      businessId: resolved.business?.id,
      departmentId: routeTarget.departmentId,
      positionId: routeTarget.positionId,
      title: intent.title,
      summary: message,
      riskLevel: intent.riskLevel,
      actionClasses: intent.actionClasses,
      publicFacing: intent.publicFacing,
      moneyMovement: intent.moneyMovement,
      requiresVerifiedFinancialData: intent.requiresVerifiedFinancialData
    });

    const action: OfficeChatAction = {
      id: `office-chat-action-${timestampSuffix()}-${Math.random().toString(36).slice(2, 8)}`,
      threadId: state.thread.id,
      officeId: resolved.officeId,
      scope: resolved.scope,
      businessId: resolved.business?.id,
      departmentId: resolved.workspace?.departmentId,
      kind: "route_task",
      status: "routed",
      title: intent.title,
      summary: message,
      payload: {
        routedTaskId: routed.envelope.id,
        targetDepartmentId: routed.envelope.departmentId,
        targetPositionId: routed.envelope.positionId
      },
      resultLines: [
        `Routed to ${routed.owner?.departmentName ?? routed.envelope.departmentId}`,
        `Position: ${routed.owner?.positionName ?? routed.envelope.positionId}`,
        `Approval route: ${routed.approvalRoute.id}`
      ],
      reportArtifactIds: [],
      taskEnvelopeIds: [routed.envelope.id],
      approvalIds: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    return {
      assistantContent: `Routed the request into the control plane. It is now assigned to ${routed.owner?.departmentName ?? routed.envelope.departmentId} / ${routed.owner?.positionName ?? routed.envelope.positionId} under approval route ${routed.approvalRoute.id}.`,
      actions: [action],
      reports: []
    };
  }

  private async updateOfficeDirectives(
    resolved: ResolvedOfficeTarget,
    state: MutableOfficeChatState,
    intent: Extract<ChatIntent, { kind: "update_office_directives" }>
  ): Promise<ChatOutcome> {
    const nextConfig: OfficeOperatingConfig = {
      ...state.operatingConfig,
      promptDirectives: uniqueStrings([
        ...state.operatingConfig.promptDirectives,
        intent.directive
      ]),
      updatedAt: nowIso()
    };
    await this.store.saveOfficeOperatingConfig(nextConfig);
    state.operatingConfig = nextConfig;

    const action: OfficeChatAction = {
      id: `office-chat-action-${timestampSuffix()}-${Math.random().toString(36).slice(2, 8)}`,
      threadId: state.thread.id,
      officeId: resolved.officeId,
      scope: resolved.scope,
      businessId: resolved.business?.id,
      departmentId: resolved.workspace?.departmentId,
      kind: "update_office_directives",
      status: "completed",
      title: intent.title,
      summary: intent.directive,
      payload: {
        promptDirectives: nextConfig.promptDirectives
      },
      resultLines: [
        `Saved directive for ${state.thread.assistantLabel}`,
        `Directive count: ${nextConfig.promptDirectives.length}`
      ],
      reportArtifactIds: [],
      taskEnvelopeIds: [],
      approvalIds: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    await this.writeAudit(resolved, "tool_use", "info", [
      `Updated operating directives for ${resolved.title}.`,
      ...nextConfig.promptDirectives.slice(-3)
    ]);
    return {
      assistantContent: `Saved that directive for the ${state.thread.assistantLabel}. It will be included in future automation for this office without changing historical outputs.`,
      actions: [action],
      reports: []
    };
  }

  private async updateScheduleOverride(
    resolved: ResolvedOfficeTarget,
    state: MutableOfficeChatState,
    message: string,
    intent: Extract<ChatIntent, { kind: "update_schedule_override" }>
  ): Promise<ChatOutcome> {
    const nextConfig: OfficeOperatingConfig = {
      ...state.operatingConfig,
      scheduleOverride: {
        cadence: intent.cadence,
        preferredWindows: intent.preferredWindows,
        notes: [excerpt(message, 180)]
      },
      updatedAt: nowIso()
    };
    await this.store.saveOfficeOperatingConfig(nextConfig);
    state.operatingConfig = nextConfig;

    const action: OfficeChatAction = {
      id: `office-chat-action-${timestampSuffix()}-${Math.random().toString(36).slice(2, 8)}`,
      threadId: state.thread.id,
      officeId: resolved.officeId,
      scope: resolved.scope,
      businessId: resolved.business?.id,
      departmentId: resolved.workspace?.departmentId,
      kind: "update_schedule_override",
      status: "completed",
      title: intent.title,
      summary: intent.cadence,
      payload: {
        cadence: nextConfig.scheduleOverride?.cadence,
        preferredWindows: nextConfig.scheduleOverride?.preferredWindows ?? [],
        notes: nextConfig.scheduleOverride?.notes ?? []
      },
      resultLines: [
        `Saved cadence: ${intent.cadence}`,
        intent.preferredWindows.length > 0
          ? `Windows: ${intent.preferredWindows.join(", ")}`
          : "Windows: no explicit clock time detected"
      ],
      reportArtifactIds: [],
      taskEnvelopeIds: [],
      approvalIds: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    await this.writeAudit(resolved, "tool_use", "info", [
      `Updated schedule override for ${resolved.title}.`,
      `Cadence: ${intent.cadence}`,
      intent.preferredWindows.length > 0
        ? `Preferred windows: ${intent.preferredWindows.join(", ")}`
        : "Preferred windows: none detected"
    ]);
    return {
      assistantContent: `Saved the schedule override for this office. It applies to future automation only: ${intent.cadence}.`,
      actions: [action],
      reports: []
    };
  }

  private async createExecutionBrief(
    resolved: ResolvedOfficeTarget,
    state: MutableOfficeChatState,
    message: string,
    intent: Extract<ChatIntent, { kind: "create_execution_brief" }>
  ): Promise<ChatOutcome> {
    if (resolved.scope !== "department" || !resolved.workspace) {
      return this.answerQuestion(resolved, state, message, {
        kind: "answer_question",
        title: intent.title
      });
    }

    const routed = await this.imonEngine.routeTask({
      workflowId: resolved.workspace.executionItems.find((item) => item.workflowId)?.workflowId,
      businessId: resolved.business?.id,
      departmentId: resolved.workspace.departmentId,
      positionId: resolved.workspace.workers.find(
        (worker) => worker.workerType === "department_orchestrator"
      )?.positionId,
      title: intent.title,
      summary: message,
      riskLevel: intent.riskLevel,
      actionClasses: this.deriveActionClasses(resolved.scope, message.toLowerCase()),
      publicFacing: false,
      moneyMovement: false,
      requiresVerifiedFinancialData: false
    });

    const action: OfficeChatAction = {
      id: `office-chat-action-${timestampSuffix()}-${Math.random().toString(36).slice(2, 8)}`,
      threadId: state.thread.id,
      officeId: resolved.officeId,
      scope: resolved.scope,
      businessId: resolved.business?.id,
      departmentId: resolved.workspace.departmentId,
      kind: "create_execution_brief",
      status: "routed",
      title: intent.title,
      summary: message,
      payload: {
        routedTaskId: routed.envelope.id,
        workflowId: routed.envelope.workflowId
      },
      resultLines: [
        `Created execution brief for ${resolved.workspace.title}`,
        `Task id: ${routed.envelope.id}`,
        `Worker: ${routed.owner?.positionName ?? routed.envelope.positionId}`
      ],
      reportArtifactIds: [],
      taskEnvelopeIds: [routed.envelope.id],
      approvalIds: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    return {
      assistantContent: `Created an execution brief and routed it into ${resolved.workspace.title}. The department orchestrator can now steer the work from task ${routed.envelope.id}.`,
      actions: [action],
      reports: []
    };
  }

  private async answerQuestion(
    resolved: ResolvedOfficeTarget,
    state: MutableOfficeChatState,
    message: string,
    intent: Extract<ChatIntent, { kind: "answer_question" }>
  ): Promise<ChatOutcome> {
    const fallback = this.fallbackAnswer(resolved, state);
    const prompt = [
      `You are the ${state.thread.assistantLabel} for ${resolved.title}.`,
      `Current scope: ${resolved.scope}.`,
      `Office summary: ${this.officeSummary(resolved)}.`,
      `Prompt directives: ${
        state.operatingConfig.promptDirectives.length > 0
          ? state.operatingConfig.promptDirectives.join(" | ")
          : "none"
      }.`,
      `Question: ${message}`,
      "Reply concisely in 2 short paragraphs max. If the request implies a risky mutation, recommend routing it instead of claiming it was executed."
    ].join("\n");
    const aiBusinessId = resolved.business?.id ?? "imon-engine";
    const generated = await this.ai.generateText({
      prompt,
      businessId: aiBusinessId,
      capability: "office-chat",
      mode: "fast",
      fallback: () => fallback
    });

    const action: OfficeChatAction = {
      id: `office-chat-action-${timestampSuffix()}-${Math.random().toString(36).slice(2, 8)}`,
      threadId: state.thread.id,
      officeId: resolved.officeId,
      scope: resolved.scope,
      businessId: resolved.business?.id,
      departmentId: resolved.workspace?.departmentId,
      kind: "answer_question",
      status: "completed",
      title: intent.title,
      summary: excerpt(message, 180),
      payload: {
        source: generated.source
      },
      resultLines: [
        `Answered at ${resolved.scope} scope`,
        `Response source: ${generated.source}`
      ],
      reportArtifactIds: [],
      taskEnvelopeIds: [],
      approvalIds: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    await this.writeAudit(resolved, "tool_use", "info", [
      `Answered an office chat question in ${resolved.title}.`,
      excerpt(message, 180)
    ]);
    return {
      assistantContent: generated.text,
      actions: [action],
      reports: []
    };
  }

  private async reportPayload(
    resolved: ResolvedOfficeTarget,
    message: string,
    marketResearch: boolean
  ): Promise<{
    summary: string;
    highlights: string[];
    narrative: string;
    markdown: string;
    json: Record<string, unknown>;
  }> {
    if (resolved.scope === "engine") {
      const active = resolved.snapshot.businesses.filter((business) => business.stage === "active");
      const deferred = resolved.snapshot.businesses.filter(
        (business) => business.stage === "deferred"
      );
      const highlights = [
        `Tracked businesses: ${resolved.snapshot.businesses.length}`,
        `Net monthly revenue: $${(resolved.snapshot.report?.netMonthlyRevenue ?? 0).toFixed(2)}`,
        `Recommended concurrency: ${resolved.snapshot.report?.recommendedConcurrency ?? 0}`,
        `Deferred businesses: ${deferred.map((business) => business.name).join(", ") || "none"}`
      ];
      return {
        summary: `Portfolio summary for ${resolved.snapshot.businesses.length} businesses.`,
        highlights,
        narrative: `Portfolio summary is ready. The system is tracking ${resolved.snapshot.businesses.length} businesses with net monthly revenue at $${(
          resolved.snapshot.report?.netMonthlyRevenue ?? 0
        ).toFixed(2)} and recommended concurrency at ${
          resolved.snapshot.report?.recommendedConcurrency ?? 0
        }.`,
        markdown: [
          `# ${resolved.title} Report`,
          "",
          `Generated at: ${nowIso()}`,
          `Prompt: ${message}`,
          "",
          "## Portfolio Snapshot",
          ...highlights.map((line) => `- ${line}`),
          "",
          "## Active Businesses",
          ...(active.length > 0
            ? active.map((business) => `- ${business.name}: $${business.netRevenue.toFixed(2)} net`)
            : ["- None active right now."]),
          "",
          "## Executive Roadblocks",
          ...(resolved.snapshot.executiveView.roadblocks.length > 0
            ? resolved.snapshot.executiveView.roadblocks.map((item) => `- ${item}`)
            : ["- None recorded."])
        ].join("\n"),
        json: {
          scope: resolved.scope,
          report: resolved.snapshot.report,
          activeBusinesses: active.map((business) => business.id),
          deferredBusinesses: deferred.map((business) => business.id)
        }
      };
    }

    if (resolved.scope === "business" && resolved.business?.office) {
      const marketSummary = marketResearch
        ? await this.marketResearchNarrative(resolved, message)
        : undefined;
      const departmentStatuses = resolved.business.departmentWorkspaces.map((workspace) => ({
        departmentId: workspace.departmentId,
        title: workspace.title,
        executions: workspace.executionItems.length,
        roadblocks: workspace.roadblocks.length
      }));
      const highlights = [
        `Stage: ${resolved.business.stage}`,
        `Net revenue: $${resolved.business.netRevenue.toFixed(2)}`,
        `Automation coverage: ${Math.round(resolved.business.automationCoverage * 100)}%`,
        `Department offices: ${resolved.business.departmentWorkspaces.length}`
      ];
      return {
        summary: `Business report for ${resolved.business.name}.`,
        highlights: marketSummary ? [...highlights, excerpt(marketSummary, 140)] : highlights,
        narrative: marketSummary
          ? `Business report is ready. ${resolved.business.name} is currently ${resolved.business.stage} with net revenue at $${resolved.business.netRevenue.toFixed(2)}. I also added a market-data summary for the current request.`
          : `Business report is ready. ${resolved.business.name} is currently ${resolved.business.stage} with net revenue at $${resolved.business.netRevenue.toFixed(2)} and ${resolved.business.departmentWorkspaces.length} department offices in view.`,
        markdown: [
          `# ${resolved.business.name} Business Report`,
          "",
          `Generated at: ${nowIso()}`,
          `Prompt: ${message}`,
          "",
          "## Business Snapshot",
          ...highlights.map((line) => `- ${line}`),
          "",
          "## Department Offices",
          ...departmentStatuses.map(
            (department) =>
              `- ${department.title}: ${department.executions} execution lane(s), ${department.roadblocks} roadblock(s)`
          ),
          "",
          "## Current Roadblocks",
          ...(resolved.business.office.roadblocks.length > 0
            ? resolved.business.office.roadblocks.map((item) => `- ${item}`)
            : ["- None recorded."]),
          ...(marketSummary ? ["", "## Market Data", marketSummary] : [])
        ].join("\n"),
        json: {
          scope: resolved.scope,
          businessId: resolved.business.id,
          stage: resolved.business.stage,
          budgetView: resolved.business.budgetView,
          departments: departmentStatuses,
          marketSummary
        }
      };
    }

    const workspace = resolved.workspace!;
    const statusBreakdown = {
      queued: workspace.executionItems.filter((item) => item.status === "queued").length,
      running: workspace.executionItems.filter((item) => item.status === "running").length,
      blocked: workspace.executionItems.filter((item) => item.status === "blocked").length,
      review: workspace.executionItems.filter((item) => item.status === "review").length,
      done: workspace.executionItems.filter((item) => item.status === "done").length
    };
    const highlights = [
      `Execution lanes: ${workspace.executionItems.length}`,
      `Workers: ${workspace.workers.length}`,
      `Roadblocks: ${workspace.roadblocks.length}`,
      `Running lanes: ${statusBreakdown.running}`
    ];
    return {
      summary: `Department report for ${workspace.title}.`,
      highlights,
      narrative: `Department report is ready. ${workspace.title} currently has ${workspace.executionItems.length} execution lane(s), ${workspace.workers.length} workers, and ${workspace.roadblocks.length} recorded roadblock(s).`,
      markdown: [
        `# ${workspace.title} Department Report`,
        "",
        `Generated at: ${nowIso()}`,
        `Prompt: ${message}`,
        "",
        "## Department Snapshot",
        ...highlights.map((line) => `- ${line}`),
        "",
        "## Execution Items",
        ...(workspace.executionItems.length > 0
          ? workspace.executionItems.map(
              (item) =>
                `- ${item.title}: ${item.status} | ${item.assignedWorkerLabel} | ${item.metrics.join(", ")}`
            )
          : ["- No execution items recorded yet."]),
        "",
        "## Roadblocks",
        ...(workspace.roadblocks.length > 0
          ? workspace.roadblocks.map((item) => `- ${item}`)
          : ["- None recorded."])
      ].join("\n"),
      json: {
        scope: resolved.scope,
        businessId: workspace.businessId,
        departmentId: workspace.departmentId,
        metrics: workspace.metrics,
        statusBreakdown
      }
    };
  }

  private async marketResearchNarrative(
    resolved: ResolvedOfficeTarget,
    message: string
  ): Promise<string> {
    const business = resolved.business;
    const fallback = () =>
      [
        `${business?.name ?? resolved.title} is using internal signals only because live market research was unavailable.`,
        `Current stage: ${business?.stage ?? "unknown"}.`,
        `Net revenue: $${(business?.netRevenue ?? 0).toFixed(2)}.`,
        "Use this as an internal-only market snapshot until live research is available."
      ].join(" ");
    const prompt = [
      `Create a concise market-data summary for ${business?.name ?? resolved.title}.`,
      `Business summary: ${business?.summary ?? resolved.title}.`,
      `Current internal metrics: net revenue ${(business?.netRevenue ?? 0).toFixed(2)}, automation ${
        Math.round((business?.automationCoverage ?? 0) * 100)
      }%.`,
      `User request: ${message}`,
      "Use web research if available. If not, make it explicit that the summary falls back to internal signals only."
    ].join("\n");
    const result = await this.ai.researchText({
      prompt,
      businessId: business?.id ?? "imon-engine",
      capability: "market-research",
      fallback
    });
    return result.text;
  }

  private async writeReportArtifact(
    resolved: ResolvedOfficeTarget,
    title: string,
    payload: {
      summary: string;
      markdown: string;
      json: Record<string, unknown>;
    }
  ): Promise<OfficeReportArtifact> {
    const dir = path.join(this.config.reportDir, "control-room-chat");
    await ensureDir(dir);
    const fileStem = `${slugify(`${resolved.officeId}-${title}`)}-${timestampSuffix()}`;
    const markdownPath = path.join(dir, `${fileStem}.md`);
    const jsonPath = path.join(dir, `${fileStem}.json`);
    await Promise.all([
      writeTextFile(markdownPath, payload.markdown),
      writeJsonFile(jsonPath, payload.json)
    ]);
    const createdAt = nowIso();
    return {
      id: `office-report-${fileStem}`,
      officeId: resolved.officeId,
      scope: resolved.scope,
      businessId: resolved.business?.id,
      departmentId: resolved.workspace?.departmentId,
      title,
      summary: payload.summary,
      markdownPath,
      jsonPath,
      createdAt,
      updatedAt: createdAt
    };
  }

  private routeTargetForOffice(resolved: ResolvedOfficeTarget): {
    workflowId?: string;
    departmentId?: string;
    positionId?: string;
  } {
    if (resolved.scope === "department") {
      return {
        workflowId: resolved.workspace?.executionItems.find((item) => item.workflowId)?.workflowId,
        departmentId: resolved.workspace?.departmentId,
        positionId: resolved.workspace?.workers.find(
          (worker) => worker.workerType === "department_orchestrator"
        )?.positionId
      };
    }
    if (resolved.scope === "business") {
      return {
        departmentId: resolved.business?.office?.workers[0]?.departmentId,
        positionId: resolved.business?.office?.workers.find(
          (worker) => worker.workerType === "brand_orchestrator"
        )?.positionId
      };
    }
    return {
      positionId: resolved.snapshot.executiveView.workers.find(
        (worker) => worker.workerType === "engine_orchestrator"
      )?.positionId
    };
  }

  private deriveRiskLevel(lower: string): ApprovalRiskLevel {
    if (/\b(finance|budget|charge|invoice|payment|compliance|client)\b/.test(lower)) {
      return "high";
    }
    if (/\b(publish|post|outreach|ads|campaign)\b/.test(lower)) {
      return "medium";
    }
    return "low";
  }

  private deriveActionClasses(
    scope: ChatScope,
    lower: string
  ): ApprovalActionClass[] {
    const classes: ApprovalActionClass[] = ["internal"];
    if (scope === "engine") {
      classes.push("cross_business");
    }
    if (/\b(post|publish|social|ad|ads)\b/.test(lower)) {
      classes.push("public_post");
    }
    if (/\b(client|customer|prospect|outreach|contact)\b/.test(lower)) {
      classes.push("customer_facing");
    }
    if (/\b(finance|budget|cash|invoice|payment|profit)\b/.test(lower)) {
      classes.push("financial");
    }
    if (/\b(compliance|legal|policy|tax)\b/.test(lower)) {
      classes.push("compliance");
    }
    return uniqueStrings(classes) as ApprovalActionClass[];
  }

  private officeSummary(resolved: ResolvedOfficeTarget): string {
    if (resolved.scope === "engine") {
      return [
        `${resolved.snapshot.businesses.length} businesses`,
        `net revenue $${(resolved.snapshot.report?.netMonthlyRevenue ?? 0).toFixed(2)}`,
        `${resolved.snapshot.executiveView.approvalsWaiting} approvals waiting`
      ].join(", ");
    }
    if (resolved.scope === "business" && resolved.business) {
      return [
        resolved.business.name,
        `stage ${resolved.business.stage}`,
        `net $${resolved.business.netRevenue.toFixed(2)}`,
        `${resolved.business.departmentWorkspaces.length} departments`
      ].join(", ");
    }
    return [
      resolved.workspace?.title ?? resolved.title,
      `${resolved.workspace?.executionItems.length ?? 0} execution lanes`,
      `${resolved.workspace?.roadblocks.length ?? 0} roadblocks`,
      `${resolved.workspace?.workers.length ?? 0} workers`
    ].join(", ");
  }

  private fallbackAnswer(
    resolved: ResolvedOfficeTarget,
    state: MutableOfficeChatState
  ): string {
    if (resolved.scope === "engine") {
      return `At the engine level I can summarize portfolio performance, generate consolidated reports, draft new deferred businesses, and route higher-risk work into the control plane. The portfolio currently tracks ${resolved.snapshot.businesses.length} businesses with ${resolved.snapshot.executiveView.approvalsWaiting} approvals waiting.`;
    }
    if (resolved.scope === "business" && resolved.business) {
      return `At the business level I can summarize accounting, analytics, and department coordination for ${resolved.business.name}. Current scope: ${resolved.business.stage} stage, net revenue $${resolved.business.netRevenue.toFixed(2)}, ${resolved.business.departmentWorkspaces.length} department offices, and ${resolved.business.office?.handoffs.length ?? 0} active handoffs.`;
    }
    return `At the department level I can steer workers, create execution briefs, and persist prompt or schedule changes for future automation. This workspace currently has ${resolved.workspace?.executionItems.length ?? 0} execution lanes and ${state.operatingConfig.promptDirectives.length} saved prompt directives.`;
  }

  private async updateThreadSummary(
    state: MutableOfficeChatState,
    resolved: ResolvedOfficeTarget,
    lastMessageAt: string
  ): Promise<void> {
    const recentMessages = state.messages
      .slice(-6)
      .map((message) => `${message.role}: ${excerpt(message.content, 90)}`);
    const pendingActions = state.actions
      .filter((action) => action.status === "awaiting_confirmation")
      .map((action) => `pending ${action.title}`);
    const summary = uniqueStrings([
      ...recentMessages,
      ...pendingActions,
      ...state.operatingConfig.promptDirectives.slice(-2)
    ])
      .join(" | ")
      .slice(0, 500);
    const nextThread: OfficeChatThread = {
      ...state.thread,
      summary: summary || `Updated chat thread for ${resolved.title}.`,
      updatedAt: nowIso(),
      lastMessageAt
    };
    await this.store.saveOfficeChatThread(nextThread);
    state.thread = nextThread;
  }

  private async writeAudit(
    resolved: ResolvedOfficeTarget,
    eventType: OrgAuditEventType,
    severity: OrgAuditSeverity,
    details: string[]
  ): Promise<void> {
    await this.store.saveOrgAuditRecord({
      id: `org-audit-chat-${timestampSuffix()}-${Math.random().toString(36).slice(2, 8)}`,
      engineId: resolved.engineId,
      businessId: resolved.business?.id,
      departmentId: resolved.workspace?.departmentId,
      eventType,
      severity,
      summary: details[0] ?? `Updated ${resolved.title} through office chat.`,
      details,
      createdAt: nowIso()
    });
  }
}
