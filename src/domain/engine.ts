import type { ApprovalType } from "./contracts.js";

export type BusinessCategory =
  | "digital_asset_store"
  | "niche_content_site"
  | "faceless_social_brand"
  | "micro_saas_factory"
  | "print_on_demand_store"
  | "client_services_agency";

export type BusinessLaunchStage = "scaffolded" | "ready" | "active" | "paused";

export type RiskBand = "low" | "medium" | "high";

export type SupportLoad = "low" | "medium" | "high";

export interface BusinessSchedule {
  cadence: string;
  timezone: string;
  maxRunsPerDay: number;
  preferredWindows: string[];
}

export interface ResourceBudget {
  maxCpuShare: number;
  maxMemoryGb: number;
  maxDiskGb: number;
}

export interface ManagedBusinessMetrics {
  targetMonthlyRevenue: number;
  currentMonthlyRevenue: number;
  currentMonthlyCosts: number;
  dataValueScore: number;
  automationCoverage: number;
  activeWorkItems: number;
  lastRunAt?: string;
  nextRunAt?: string;
}

export interface ManagedBusiness {
  id: string;
  name: string;
  module: string;
  category: BusinessCategory;
  orgBlueprintId?: string;
  launchPriority: number;
  stage: BusinessLaunchStage;
  summary: string;
  rolloutReason: string;
  revenueModel: string;
  platforms: string[];
  automationFocus: string[];
  ownerActions: string[];
  launchBlockers: string[];
  approvalType: ApprovalType;
  automationPotential: number;
  setupComplexity: number;
  complianceRisk: RiskBand;
  supportLoad: SupportLoad;
  humanSetupHours: number;
  schedule: BusinessSchedule;
  resourceBudget: ResourceBudget;
  metrics: ManagedBusinessMetrics;
  notes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ManagedBusinessSeed extends Omit<ManagedBusiness, "createdAt" | "updatedAt"> {}

export interface ImonEngineState {
  id: string;
  name: string;
  orgBlueprintId?: string;
  overview: string;
  timezone: string;
  host: {
    provider: string;
    label: string;
    primaryIp?: string;
  };
  limits: {
    maxConcurrentBusinesses: number;
    cpuUtilizationTarget: number;
    memoryUtilizationTarget: number;
    minDiskFreeGb: number;
  };
  portfolio: {
    trackedBusinesses: number;
    activeBusinesses: number;
    readyBusinesses: number;
    blockedBusinesses: number;
    nextRecommendedBusinessId?: string;
  };
  lastResourceSnapshotAt?: string;
  lastPortfolioSyncAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VpsResourceSnapshot {
  id: string;
  recordedAt: string;
  hostname: string;
  platform: string;
  cpuCores: number;
  loadAverage: [number, number, number];
  estimatedCpuUtilization: number;
  totalMemoryGb: number;
  freeMemoryGb: number;
  memoryUtilization: number;
  diskTotalGb?: number;
  diskFreeGb?: number;
  diskUtilization?: number;
  activeBusinesses: number;
  readyBusinesses: number;
  recommendedConcurrency: number;
  notes: string[];
}

export type BusinessRunStatus = "success" | "skipped" | "blocked" | "failed";

export interface BusinessRunRecord {
  id: string;
  businessId: string;
  startedAt: string;
  finishedAt: string;
  status: BusinessRunStatus;
  summary: string;
  cpuUtilizationAtStart?: number;
  memoryUtilizationAtStart?: number;
}

export type BusinessLedgerEntryType = "revenue" | "cost";

export interface BusinessLedgerEntry {
  id: string;
  businessId: string;
  type: BusinessLedgerEntryType;
  amount: number;
  currency: string;
  source: string;
  note: string;
  recordedAt: string;
}

export interface EngineOverviewReport {
  id: string;
  generatedAt: string;
  engineId: string;
  resourceSnapshotId: string;
  businessCounts: {
    total: number;
    active: number;
    ready: number;
    scaffolded: number;
    paused: number;
  };
  monthlyRevenue: number;
  monthlyCosts: number;
  netMonthlyRevenue: number;
  activeBusinesses: string[];
  nextLaunchCandidates: string[];
  blockedBusinesses: string[];
  recommendedConcurrency: number;
  recommendedActions: string[];
}

export interface ImonEngineSeed
  extends Omit<
    ImonEngineState,
    "createdAt" | "updatedAt" | "lastResourceSnapshotAt" | "lastPortfolioSyncAt"
  > {}
