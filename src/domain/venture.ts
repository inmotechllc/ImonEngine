import type { BusinessCategory } from "./engine.js";
import type { DepartmentKind, ModelRouteTier } from "./org.js";

export type VentureLaunchMode = "weekly" | "monthly";

export type VentureRiskMode = "live_ops" | "review_required" | "paper_only";

export interface VentureRangeTarget {
  label: string;
  minimum: number;
  maximum: number;
  selected: number;
  period: string;
}

export interface VentureCadencePlan {
  coreOutput: VentureRangeTarget;
  feedPosts: VentureRangeTarget;
  storiesOrReels: VentureRangeTarget;
  activeDays: VentureRangeTarget;
  notes: string[];
}

export interface VentureStartupPhase {
  id: string;
  title: string;
  goals: string[];
  heuristics: string[];
  completionSignals: string[];
}

export interface VentureAgentRole {
  id: string;
  name: string;
  mission: string;
  outputs: string[];
  autonomyRules: string[];
}

export type VentureFacebookStrategy = "legacy_live" | "umbrella_brand" | "avoid_by_default";

export type VentureInstagramStrategy = "single_brand" | "niche_accounts";

export interface VentureNicheLane {
  id: string;
  name: string;
  focus: string;
  aliasEmail: string;
  handleStem: string;
  notes: string[];
}

export interface VentureSocialAccountPlan {
  platform: string;
  ownership: "umbrella_brand" | "niche_lane" | "minimal";
  quantity: number;
  aliasPattern: string;
  purpose: string;
  notes: string[];
}

export interface VentureSocialArchitecture {
  umbrellaBrandName: string;
  umbrellaAliasEmail: string;
  umbrellaHandleStem: string;
  facebookStrategy: VentureFacebookStrategy;
  instagramStrategy: VentureInstagramStrategy;
  maxInstagramAccountsPerDevice: number;
  niches: VentureNicheLane[];
  accountPlan: VentureSocialAccountPlan[];
  notes: string[];
}

export interface VentureSelectionScore {
  automationFit: number;
  revenuePotential: number;
  growthSurface: number;
  startupBurden: number;
  riskPenalty: number;
  composite: number;
}

export interface VentureOrgDepartmentSummary {
  kind: DepartmentKind;
  name: string;
  purpose: string;
  positionTitles: string[];
}

export interface VentureWorkflowOwnershipSummary {
  workflowId: string;
  workflowName: string;
  departmentKind: DepartmentKind;
  positionTitle: string;
  allowedModelTier: ModelRouteTier;
  escalationTargetTitle?: string;
}

export interface VentureOrgStructure {
  blueprintId: string;
  summary: string;
  departments: VentureOrgDepartmentSummary[];
  workflowOwnership: VentureWorkflowOwnershipSummary[];
  approvalModel: string[];
}

export interface VentureBlueprint {
  businessId: string;
  businessName: string;
  category: BusinessCategory;
  launchPriority: number;
  stage: string;
  medium: string;
  aliasEmail: string;
  handleStem: string;
  templateSourceBusinessId: string;
  selectionScore: VentureSelectionScore;
  stack: string[];
  signupTargets: string[];
  startupPhases: VentureStartupPhase[];
  cadence: VentureCadencePlan;
  growthFocus: string[];
  orgStructure: VentureOrgStructure;
  socialArchitecture: VentureSocialArchitecture;
  reinvestment: {
    brandRate: number;
    collectiveCapRate: number;
    cashoutThreshold: number;
    rules: string[];
  };
  riskPolicy: {
    mode: VentureRiskMode;
    guardrails: string[];
  };
  agentRoles: VentureAgentRole[];
}

export interface VentureLaunchWindow {
  id: string;
  mode: VentureLaunchMode;
  startsAt: string;
  endsAt: string;
  timezone: string;
  reason: string;
}

export interface CapitalExperimentTrack {
  id: string;
  name: string;
  stage: VentureRiskMode;
  thesis: string;
  gates: string[];
  allowedActions: string[];
}

export interface VentureStudioPolicy {
  templateSourceBusinessId: string;
  systemReinvestmentCapRate: number;
  creationRules: {
    preSlowdownBrandCount: number;
    weeklyLaunchDay: string;
    monthlyLaunchRule: string;
    launchWindowLocal: string;
    oneNewBrandPerWindow: boolean;
  };
  socialRules: string[];
  cadenceRules: string[];
  capitalRules: string[];
}

export interface VentureStudioSnapshot {
  generatedAt: string;
  systemName: string;
  createdBrandCount: number;
  nextLaunchMode: VentureLaunchMode;
  templateSource: {
    businessId: string;
    businessName: string;
    lessons: string[];
  };
  broadPlan: string[];
  policy: VentureStudioPolicy;
  launchWindows: VentureLaunchWindow[];
  blueprints: VentureBlueprint[];
  capitalExperimentTracks: CapitalExperimentTrack[];
}
