import type { BusinessCategory } from "../domain/engine.js";
import type { ApprovalActionClass, ApprovalRiskLevel, DepartmentKind, ModelRouteTier, PositionAssignmentMode } from "../domain/org.js";

export interface DepartmentTemplateSpec {
  kind: DepartmentKind;
  name: string;
  purpose: string;
  kpis: string[];
  toolTags: string[];
  workflowIds: string[];
}

export interface PositionTemplateSpec {
  title: string;
  departmentKind: DepartmentKind;
  mission: string;
  assignmentMode: PositionAssignmentMode;
  defaultTier: ModelRouteTier;
  escalationTargetTier: ModelRouteTier;
  escalationTriggers: string[];
  authorityLimits: string[];
  decisionRights: string[];
  kpis: string[];
  toolTags: string[];
  publicFacing: boolean;
  handlesMoney: boolean;
  workflowIds: string[];
}

export interface ApprovalRouteTemplateSpec {
  key: "low" | "medium" | "high";
  riskLevel: ApprovalRiskLevel;
  actionClasses: ApprovalActionClass[];
  autoApproveWhen: string[];
  escalationTitles: string[];
  notes: string[];
}

export interface WorkflowOwnershipTemplateSpec {
  workflowId: string;
  workflowName: string;
  departmentKind: DepartmentKind;
  positionTitle: string;
  allowedModelTier: ModelRouteTier;
  allowedTools: string[];
  escalationTargetTitle?: string;
  successMetric: string;
  notes: string[];
}

export interface OrgTemplateSpec {
  summary: string;
  departments: DepartmentTemplateSpec[];
  positions: PositionTemplateSpec[];
  approvalRoutes: ApprovalRouteTemplateSpec[];
  workflowOwnership: WorkflowOwnershipTemplateSpec[];
}

export interface OrgTemplateSummary {
  summary: string;
  departments: Array<{
    kind: DepartmentKind;
    name: string;
    purpose: string;
    positionTitles: string[];
  }>;
  workflowOwnership: Array<{
    workflowId: string;
    workflowName: string;
    departmentKind: DepartmentKind;
    positionTitle: string;
    allowedModelTier: ModelRouteTier;
    escalationTargetTitle?: string;
  }>;
  approvalModel: string[];
}

const BASE_APPROVAL_ROUTES: ApprovalRouteTemplateSpec[] = [
  {
    key: "low",
    riskLevel: "low",
    actionClasses: ["internal"],
    autoApproveWhen: [
      "The action stays inside one business namespace.",
      "The action is not public-facing.",
      "The action does not move money.",
      "The action does not change verified financial data."
    ],
    escalationTitles: [],
    notes: ["Department-level low-risk work can auto-run."]
  },
  {
    key: "medium",
    riskLevel: "medium",
    actionClasses: ["public_post", "customer_facing"],
    autoApproveWhen: [],
    escalationTitles: ["General Manager / Brand Director"],
    notes: ["Business-level public or customer-facing actions escalate to the business GM."]
  },
  {
    key: "high",
    riskLevel: "high",
    actionClasses: ["financial", "compliance", "cross_business"],
    autoApproveWhen: [],
    escalationTitles: ["General Manager / Brand Director", "Chief Executive / Portfolio Director", "Risk And Compliance Director"],
    notes: ["Cross-business, money-moving, or compliance-sensitive actions escalate to ImonEngine."]
  }
];

const ENGINE_DEPARTMENTS: DepartmentTemplateSpec[] = [
  {
    kind: "executive_management",
    name: "Executive / Management",
    purpose: "Direct the portfolio, allocate attention, and own parent-company decisions.",
    kpis: ["active businesses within concurrency target", "cross-business launch readiness", "approval turnaround time"],
    toolTags: ["engine-sync", "venture-studio", "business-registry", "approvals"],
    workflowIds: ["engine-sync", "venture-studio", "approval-generation"]
  },
  {
    kind: "finance",
    name: "Finance",
    purpose: "Protect capital, track verified earnings, and govern collective reinvestment.",
    kpis: ["verified net revenue", "collective reserve coverage", "allocation accuracy"],
    toolTags: ["revenue-report", "collective-fund-report", "relay-import", "gumroad-import"],
    workflowIds: ["finance-allocation-reporting"]
  },
  {
    kind: "technology_systems",
    name: "Technology / Systems",
    purpose: "Own the platform, automation reliability, and orchestration safety.",
    kpis: ["workflow uptime", "VPS health", "artifact freshness"],
    toolTags: ["vps-artifacts", "browser-automation", "playwright", "docker", "codex-cli"],
    workflowIds: ["engine-sync"]
  },
  {
    kind: "risk_compliance",
    name: "Risk / Compliance",
    purpose: "Review high-risk actions, cross-business access, and policy exceptions.",
    kpis: ["policy violations prevented", "blocked high-risk actions", "review completion time"],
    toolTags: ["approvals", "audit-log", "policy-review"],
    workflowIds: ["approval-generation"]
  }
];

const ENGINE_POSITIONS: PositionTemplateSpec[] = [
  {
    title: "Chief Executive / Portfolio Director",
    departmentKind: "executive_management",
    mission: "Set portfolio direction and approve high-impact cross-business actions.",
    assignmentMode: "hybrid",
    defaultTier: "premium",
    escalationTargetTier: "premium",
    escalationTriggers: ["cross-business opportunity", "capital allocation change", "public narrative change"],
    authorityLimits: ["Does not execute routine microtasks directly.", "Delegates recurring execution to business and department owners."],
    decisionRights: ["approve new business launches", "approve cross-business policy", "pause unsafe operations"],
    kpis: ["portfolio net revenue", "launch velocity", "risk-adjusted growth"],
    toolTags: ["engine-sync", "venture-studio", "approvals", "org-control-plane"],
    publicFacing: false,
    handlesMoney: true,
    workflowIds: ["venture-studio", "approval-generation"]
  },
  {
    title: "Chief Operating Officer / Chief of Staff",
    departmentKind: "executive_management",
    mission: "Coordinate portfolio operations, approvals, and operating cadence.",
    assignmentMode: "ai",
    defaultTier: "mid",
    escalationTargetTier: "premium",
    escalationTriggers: ["cross-department conflict", "blocked operating workflow", "missed service level"],
    authorityLimits: ["Cannot override verified-finance rules.", "Escalates public or money-moving exceptions."],
    decisionRights: ["route work between businesses", "approve medium-risk internal actions", "maintain operating cadence"],
    kpis: ["autopilot throughput", "approval latency", "blocked workflow aging"],
    toolTags: ["engine-sync", "approvals", "org-control-plane", "audit-log"],
    publicFacing: false,
    handlesMoney: false,
    workflowIds: ["engine-sync", "approval-generation"]
  },
  {
    title: "Chief Financial Officer / Controller",
    departmentKind: "finance",
    mission: "Govern verified revenue, reinvestment caps, and collective fund rules.",
    assignmentMode: "hybrid",
    defaultTier: "mid",
    escalationTargetTier: "premium",
    escalationTriggers: ["financial anomaly", "manual financial data", "cashout threshold crossed"],
    authorityLimits: ["Uses verified exports only for decisions.", "Cannot approve unverified spend."],
    decisionRights: ["approve collective allocation proposals", "block unverified financial actions", "own reserve policy"],
    kpis: ["verified allocation accuracy", "reserve health", "finance data-quality"],
    toolTags: ["revenue-report", "collective-fund-report", "gumroad-import", "relay-import"],
    publicFacing: false,
    handlesMoney: true,
    workflowIds: ["finance-allocation-reporting"]
  },
  {
    title: "Chief Technology Officer / Systems Director",
    departmentKind: "technology_systems",
    mission: "Keep the automation stack, browser systems, and orchestration surfaces healthy.",
    assignmentMode: "ai",
    defaultTier: "mid",
    escalationTargetTier: "premium",
    escalationTriggers: ["system regression", "tooling outage", "permission leak"],
    authorityLimits: ["Cannot approve compliance exceptions.", "Cannot move money directly."],
    decisionRights: ["maintain VPS workflows", "approve low-risk system changes", "own task-routing logic"],
    kpis: ["system uptime", "artifact freshness", "task route accuracy"],
    toolTags: ["vps-artifacts", "playwright", "docker", "codex-cli", "org-control-plane"],
    publicFacing: false,
    handlesMoney: false,
    workflowIds: ["engine-sync"]
  },
  {
    title: "Risk And Compliance Director",
    departmentKind: "risk_compliance",
    mission: "Guardrail public, financial, and cross-business actions.",
    assignmentMode: "hybrid",
    defaultTier: "premium",
    escalationTargetTier: "premium",
    escalationTriggers: ["compliance-sensitive action", "cross-business write request", "public posting exception"],
    authorityLimits: ["Does not own everyday execution.", "Blocks policy-breaking actions until reviewed."],
    decisionRights: ["approve or block high-risk actions", "define approval routes", "own audit exceptions"],
    kpis: ["high-risk action review speed", "blocked policy violations", "approval quality"],
    toolTags: ["approvals", "audit-log", "org-control-plane"],
    publicFacing: false,
    handlesMoney: false,
    workflowIds: ["approval-generation"]
  }
];

const CORE_BUSINESS_DEPARTMENTS: DepartmentTemplateSpec[] = [
  {
    kind: "executive_management",
    name: "Executive / Management",
    purpose: "Own the business thesis, priorities, and launch or pause decisions for the lane.",
    kpis: ["business launch readiness", "business net revenue", "approval turnaround time"],
    toolTags: ["business-registry", "approvals", "org-control-plane"],
    workflowIds: ["business-governance", "approval-generation"]
  },
  {
    kind: "operations",
    name: "Operations",
    purpose: "Run the day-to-day execution system, scheduling, and operational follow-through.",
    kpis: ["workflow completion rate", "queue freshness", "operational blocker age"],
    toolTags: ["scheduler", "browser-automation", "runtime-ops"],
    workflowIds: ["store-autopilot", "business-ops"]
  },
  {
    kind: "growth_marketing",
    name: "Marketing / Growth",
    purpose: "Acquire attention, publish to channels, and improve conversion over time.",
    kpis: ["growth queue completion", "channel cadence adherence", "traffic and conversion trend"],
    toolTags: ["growth-queue", "social-posting", "pinterest", "meta-api"],
    workflowIds: ["growth-publishing", "growth-planning"]
  },
  {
    kind: "product_content",
    name: "Product / Content",
    purpose: "Create, refine, and QA the business's core offer or publishable outputs.",
    kpis: ["publish-ready outputs", "qa pass rate", "content freshness"],
    toolTags: ["content-generation", "asset-builders", "qa", "imagegen"],
    workflowIds: ["product-production", "qa-review"]
  },
  {
    kind: "finance",
    name: "Finance",
    purpose: "Track verified revenue, protect spend, and enforce allocation policy.",
    kpis: ["verified net revenue", "allocation accuracy", "data quality"],
    toolTags: ["revenue-report", "collective-fund-report", "imports"],
    workflowIds: ["finance-allocation-reporting"]
  },
  {
    kind: "analytics_research",
    name: "Analytics / Research",
    purpose: "Study the lane, summarize performance, and generate next-step insight.",
    kpis: ["decision-support report freshness", "experiment turnaround", "signal quality"],
    toolTags: ["reports", "research", "venture-studio", "analytics"],
    workflowIds: ["analytics-reporting", "market-research"]
  },
  {
    kind: "customer_support_qa",
    name: "Customer Support / QA",
    purpose: "Protect customer-facing quality, support readiness, and trust signals.",
    kpis: ["support backlog", "issue resolution time", "qa coverage"],
    toolTags: ["support", "qa", "approvals"],
    workflowIds: ["support-qa", "approval-generation"]
  }
];

const CATEGORY_DEPARTMENT_EXTENSIONS: Partial<Record<BusinessCategory, DepartmentTemplateSpec[]>> = {
  print_on_demand_store: [
    {
      kind: "merchandising",
      name: "Merchandising",
      purpose: "Map designs to product formats and maintain a balanced merchandise mix.",
      kpis: ["design-to-product coverage", "catalog variety", "duplicate prevention"],
      toolTags: ["pod-plan", "product-catalog", "merchandising"],
      workflowIds: ["pod-planning", "product-production"]
    },
    {
      kind: "storefront_ops",
      name: "Storefront Ops",
      purpose: "Operate the storefront, product publishing, and merchandising workflow.",
      kpis: ["published product queue", "store freshness", "duplicate-free catalog"],
      toolTags: ["shopify", "printify", "printful", "browser-automation"],
      workflowIds: ["shopify-publishing", "storefront-ops"]
    }
  ],
  faceless_social_brand: [
    {
      kind: "content_studio",
      name: "Content Studio",
      purpose: "Produce daily or weekly media assets, scripts, hooks, and reusable creative blocks.",
      kpis: ["content batch output", "hook test cadence", "creative iteration speed"],
      toolTags: ["video", "imagegen", "scripts", "content-generation"],
      workflowIds: ["content-production", "growth-publishing"]
    },
    {
      kind: "community_qa",
      name: "Community / QA",
      purpose: "Moderate brand surfaces, protect quality, and review public-facing responses.",
      kpis: ["community reply time", "public issue rate", "qa review coverage"],
      toolTags: ["support", "social", "approvals"],
      workflowIds: ["community-ops", "approval-generation"]
    }
  ],
  micro_saas_factory: [
    {
      kind: "product_ops",
      name: "Product Ops",
      purpose: "Own feature planning, release flow, and product operations for software lanes.",
      kpis: ["release cadence", "backlog aging", "activation improvement"],
      toolTags: ["product", "deploy", "qa", "analytics"],
      workflowIds: ["product-ops", "qa-review"]
    }
  ]
};

const CORE_BUSINESS_POSITIONS: PositionTemplateSpec[] = [
  {
    title: "General Manager / Brand Director",
    departmentKind: "executive_management",
    mission: "Own the business outcome, approve medium-risk moves, and keep the lane aligned with portfolio policy.",
    assignmentMode: "hybrid",
    defaultTier: "premium",
    escalationTargetTier: "premium",
    escalationTriggers: ["launch blocker", "public narrative change", "money-moving exception"],
    authorityLimits: ["Cannot bypass verified-financial-data rules.", "Escalates cross-business and compliance-sensitive actions."],
    decisionRights: ["approve medium-risk business actions", "pause business workflows", "select lane priorities"],
    kpis: ["net revenue", "launch readiness", "approval turnaround"],
    toolTags: ["business-registry", "approvals", "org-control-plane"],
    publicFacing: true,
    handlesMoney: true,
    workflowIds: ["business-governance", "approval-generation"]
  },
  {
    title: "Operations Manager",
    departmentKind: "operations",
    mission: "Coordinate execution, queue discipline, and operating rhythm for the business.",
    assignmentMode: "ai",
    defaultTier: "mid",
    escalationTargetTier: "premium",
    escalationTriggers: ["stalled queue", "repeat blocker", "workflow drift"],
    authorityLimits: ["Does not approve public financial exceptions.", "Escalates policy conflicts."],
    decisionRights: ["sequence routine work", "own scheduler discipline", "route low-risk internal tasks"],
    kpis: ["queue freshness", "task throughput", "blocked work age"],
    toolTags: ["scheduler", "runtime-ops", "org-control-plane", "browser-automation"],
    publicFacing: false,
    handlesMoney: false,
    workflowIds: ["store-autopilot", "business-ops"]
  },
  {
    title: "Growth And Marketing Manager",
    departmentKind: "growth_marketing",
    mission: "Own acquisition experiments, channel calendars, and organic distribution.",
    assignmentMode: "ai",
    defaultTier: "mid",
    escalationTargetTier: "premium",
    escalationTriggers: ["public campaign exception", "paid growth proposal", "brand voice risk"],
    authorityLimits: ["Public posting follows approval policy.", "Paid growth proposals require verified financial context."],
    decisionRights: ["schedule approved content", "run organic experiments", "refresh growth queue"],
    kpis: ["channel cadence", "traffic trend", "experiment learning velocity"],
    toolTags: ["growth-queue", "social-posting", "meta-api", "pinterest"],
    publicFacing: true,
    handlesMoney: false,
    workflowIds: ["growth-publishing", "growth-planning"]
  },
  {
    title: "Product / Content Lead",
    departmentKind: "product_content",
    mission: "Turn briefs into launchable outputs while keeping QA and style consistency intact.",
    assignmentMode: "ai",
    defaultTier: "mid",
    escalationTargetTier: "premium",
    escalationTriggers: ["complex creative judgment", "quality failure", "sensitive public asset"],
    authorityLimits: ["Cannot publish directly without workflow ownership and approval coverage.", "Escalates novel public-facing creative decisions."],
    decisionRights: ["ship production batches", "own QA fixes", "choose within approved creative bounds"],
    kpis: ["publish-ready outputs", "qa pass rate", "creative consistency"],
    toolTags: ["asset-builders", "qa", "imagegen", "content-generation"],
    publicFacing: false,
    handlesMoney: false,
    workflowIds: ["product-production", "qa-review"]
  },
  {
    title: "Analytics And Research Lead",
    departmentKind: "analytics_research",
    mission: "Translate output and performance data into next-step operating guidance.",
    assignmentMode: "ai",
    defaultTier: "mid",
    escalationTargetTier: "premium",
    escalationTriggers: ["weak signal quality", "cross-business comparison request", "model ambiguity"],
    authorityLimits: ["Cross-business comparisons are read-only by default.", "Cannot spend money or publish externally."],
    decisionRights: ["generate internal reports", "propose experiments", "score opportunities"],
    kpis: ["report freshness", "signal clarity", "decision-support coverage"],
    toolTags: ["reports", "analytics", "venture-studio"],
    publicFacing: false,
    handlesMoney: false,
    workflowIds: ["analytics-reporting", "market-research"]
  },
  {
    title: "Finance Lead",
    departmentKind: "finance",
    mission: "Protect verified revenue accounting and enforce reinvestment policy inside the business.",
    assignmentMode: "hybrid",
    defaultTier: "mid",
    escalationTargetTier: "premium",
    escalationTriggers: ["financial anomaly", "cashout threshold", "unverified data request"],
    authorityLimits: ["Cannot approve allocations from inferred data.", "Escalates money-moving changes beyond policy."],
    decisionRights: ["own allocation snapshots", "block unverified financial decisions", "recommend reinvestment within cap"],
    kpis: ["allocation accuracy", "verified data coverage", "reserve health"],
    toolTags: ["revenue-report", "collective-fund-report", "imports"],
    publicFacing: false,
    handlesMoney: true,
    workflowIds: ["finance-allocation-reporting"]
  },
  {
    title: "Customer Support And QA Lead",
    departmentKind: "customer_support_qa",
    mission: "Review customer-facing quality and maintain support readiness for the lane.",
    assignmentMode: "hybrid",
    defaultTier: "mid",
    escalationTargetTier: "premium",
    escalationTriggers: ["customer issue cluster", "public quality risk", "refund-sensitive issue"],
    authorityLimits: ["Does not approve cross-business policy.", "Escalates compliance or refund exceptions."],
    decisionRights: ["review customer messaging", "own support queue health", "gate quality-sensitive public outputs"],
    kpis: ["support backlog", "issue resolution time", "qa coverage"],
    toolTags: ["support", "qa", "approvals"],
    publicFacing: true,
    handlesMoney: false,
    workflowIds: ["support-qa"]
  }
];

const CATEGORY_POSITION_EXTENSIONS: Partial<Record<BusinessCategory, PositionTemplateSpec[]>> = {
  print_on_demand_store: [
    {
      title: "Merchandising Lead",
      departmentKind: "merchandising",
      mission: "Translate designs into the right product mix without flooding the catalog with redundant variants.",
      assignmentMode: "ai",
      defaultTier: "mid",
      escalationTargetTier: "premium",
      escalationTriggers: ["duplicate-catalog risk", "theme expansion", "product mix imbalance"],
      authorityLimits: ["Cannot approve paid buys.", "Escalates vendor or brand-sensitive merch changes."],
      decisionRights: ["select product formats", "shape the assortment", "prevent duplicate design-product pairs"],
      kpis: ["catalog coverage", "duplicate-free assortments", "product mix balance"],
      toolTags: ["pod-plan", "product-catalog", "merchandising"],
      publicFacing: false,
      handlesMoney: false,
      workflowIds: ["pod-planning", "product-production"]
    },
    {
      title: "Storefront Operations Manager",
      departmentKind: "storefront_ops",
      mission: "Own storefront publishing, vendor sync, and the live store catalog.",
      assignmentMode: "hybrid",
      defaultTier: "mid",
      escalationTargetTier: "premium",
      escalationTriggers: ["store credential blocker", "vendor sync failure", "public product issue"],
      authorityLimits: ["Does not bypass store credentials or payment setup.", "Escalates public launch issues to the GM."],
      decisionRights: ["publish approved products", "sync catalog changes", "route storefront blockers"],
      kpis: ["published product count", "catalog freshness", "sync reliability"],
      toolTags: ["shopify", "printify", "printful", "browser-automation"],
      publicFacing: true,
      handlesMoney: false,
      workflowIds: ["shopify-publishing", "storefront-ops"]
    }
  ],
  faceless_social_brand: [
    {
      title: "Content Studio Lead",
      departmentKind: "content_studio",
      mission: "Run the content batch system for hooks, scripts, and reusable social assets.",
      assignmentMode: "ai",
      defaultTier: "mid",
      escalationTargetTier: "premium",
      escalationTriggers: ["brand safety issue", "viral format decision", "sensitive public trend"],
      authorityLimits: ["Escalates high-risk public framing.", "Does not approve platform policy exceptions."],
      decisionRights: ["select approved content angles", "ship content batches", "feed the growth queue"],
      kpis: ["content output", "hook iteration speed", "batch freshness"],
      toolTags: ["content-generation", "video", "imagegen", "scripts"],
      publicFacing: true,
      handlesMoney: false,
      workflowIds: ["content-production", "growth-publishing"]
    },
    {
      title: "Community And QA Lead",
      departmentKind: "community_qa",
      mission: "Protect audience trust, moderate quality, and review external interactions.",
      assignmentMode: "hybrid",
      defaultTier: "mid",
      escalationTargetTier: "premium",
      escalationTriggers: ["platform strike risk", "comment spiral", "public complaint"],
      authorityLimits: ["Does not change cross-business policy.", "Escalates compliance-sensitive moderation issues."],
      decisionRights: ["review public replies", "moderate queues", "block risky public actions"],
      kpis: ["reply time", "community issue rate", "qa review speed"],
      toolTags: ["support", "social", "approvals"],
      publicFacing: true,
      handlesMoney: false,
      workflowIds: ["community-ops", "approval-generation"]
    }
  ],
  micro_saas_factory: [
    {
      title: "Product Operations Lead",
      departmentKind: "product_ops",
      mission: "Own backlog health, releases, and workflow reliability for software products.",
      assignmentMode: "hybrid",
      defaultTier: "mid",
      escalationTargetTier: "premium",
      escalationTriggers: ["release blocker", "support spike", "billing-sensitive change"],
      authorityLimits: ["Does not bypass payment compliance.", "Escalates user-facing pricing or billing changes."],
      decisionRights: ["sequence releases", "prioritize backlog work", "own operational product quality"],
      kpis: ["release cadence", "backlog health", "activation trend"],
      toolTags: ["product", "deploy", "qa", "analytics"],
      publicFacing: false,
      handlesMoney: false,
      workflowIds: ["product-ops", "qa-review"]
    }
  ]
};

const ENGINE_WORKFLOW_OWNERSHIP: WorkflowOwnershipTemplateSpec[] = [
  {
    workflowId: "engine-sync",
    workflowName: "Engine Sync",
    departmentKind: "technology_systems",
    positionTitle: "Chief Technology Officer / Systems Director",
    allowedModelTier: "mid",
    allowedTools: ["org-control-plane", "vps-artifacts", "system-monitor", "approvals"],
    escalationTargetTitle: "Chief Operating Officer / Chief of Staff",
    successMetric: "Portfolio sync, artifacts, and health data stay current.",
    notes: ["Parent-company sync should always refresh the org/control-plane artifacts too."]
  },
  {
    workflowId: "venture-studio",
    workflowName: "Venture Studio Planning",
    departmentKind: "executive_management",
    positionTitle: "Chief Executive / Portfolio Director",
    allowedModelTier: "premium",
    allowedTools: ["venture-studio", "research", "org-control-plane"],
    escalationTargetTitle: "Risk And Compliance Director",
    successMetric: "New business opportunities stay ranked and policy-aligned.",
    notes: ["Capital-market ideas remain paper-only or review-required."]
  },
  {
    workflowId: "approval-generation",
    workflowName: "Approval Generation",
    departmentKind: "risk_compliance",
    positionTitle: "Risk And Compliance Director",
    allowedModelTier: "premium",
    allowedTools: ["approvals", "audit-log", "org-control-plane"],
    escalationTargetTitle: "Chief Executive / Portfolio Director",
    successMetric: "High-risk actions are routed to the right reviewer with full context.",
    notes: ["Use the verified-data guardrail for financial approvals."]
  },
  {
    workflowId: "finance-allocation-reporting",
    workflowName: "Collective Finance Reporting",
    departmentKind: "finance",
    positionTitle: "Chief Financial Officer / Controller",
    allowedModelTier: "mid",
    allowedTools: ["revenue-report", "collective-fund-report", "gumroad-import", "relay-import"],
    escalationTargetTitle: "Chief Executive / Portfolio Director",
    successMetric: "Collective fund and verified allocations stay current.",
    notes: ["Unverified or inferred data cannot drive spend or cashout."]
  },
  {
    workflowId: "org-control-plane",
    workflowName: "Organization Control Plane",
    departmentKind: "technology_systems",
    positionTitle: "Chief Technology Officer / Systems Director",
    allowedModelTier: "mid",
    allowedTools: ["org-control-plane", "audit-log", "business-registry"],
    escalationTargetTitle: "Risk And Compliance Director",
    successMetric: "Org blueprints, task envelopes, and office views stay current.",
    notes: ["This control plane is the source of truth; office views are derived from it."]
  }
];

const COMMON_BUSINESS_WORKFLOW_OWNERSHIP: WorkflowOwnershipTemplateSpec[] = [
  {
    workflowId: "business-governance",
    workflowName: "Business Governance",
    departmentKind: "executive_management",
    positionTitle: "General Manager / Brand Director",
    allowedModelTier: "premium",
    allowedTools: ["business-registry", "approvals", "org-control-plane"],
    escalationTargetTitle: "Chief Executive / Portfolio Director",
    successMetric: "The lane stays within launch, spend, and approval policy.",
    notes: []
  },
  {
    workflowId: "business-ops",
    workflowName: "Business Operations",
    departmentKind: "operations",
    positionTitle: "Operations Manager",
    allowedModelTier: "mid",
    allowedTools: ["scheduler", "runtime-ops", "browser-automation"],
    escalationTargetTitle: "General Manager / Brand Director",
    successMetric: "Routine operating work completes on cadence with low blocker age.",
    notes: []
  },
  {
    workflowId: "growth-publishing",
    workflowName: "Growth Publishing",
    departmentKind: "growth_marketing",
    positionTitle: "Growth And Marketing Manager",
    allowedModelTier: "mid",
    allowedTools: ["growth-queue", "social-posting", "meta-api", "pinterest"],
    escalationTargetTitle: "General Manager / Brand Director",
    successMetric: "Approved posts publish on cadence without duplicate promotion.",
    notes: ["Public posting follows the approval route for the lane."]
  },
  {
    workflowId: "analytics-reporting",
    workflowName: "Analytics Reporting",
    departmentKind: "analytics_research",
    positionTitle: "Analytics And Research Lead",
    allowedModelTier: "mid",
    allowedTools: ["reports", "analytics", "venture-studio"],
    escalationTargetTitle: "General Manager / Brand Director",
    successMetric: "Decision-support summaries stay current and grounded in real business data.",
    notes: []
  },
  {
    workflowId: "finance-allocation-reporting",
    workflowName: "Business Finance Reporting",
    departmentKind: "finance",
    positionTitle: "Finance Lead",
    allowedModelTier: "mid",
    allowedTools: ["revenue-report", "collective-fund-report", "imports"],
    escalationTargetTitle: "Chief Financial Officer / Controller",
    successMetric: "Verified business revenue and reinvestment recommendations stay current.",
    notes: ["Only verified exports can drive reinvestment or cashout decisions."]
  },
  {
    workflowId: "support-qa",
    workflowName: "Support And QA",
    departmentKind: "customer_support_qa",
    positionTitle: "Customer Support And QA Lead",
    allowedModelTier: "mid",
    allowedTools: ["support", "qa", "approvals"],
    escalationTargetTitle: "General Manager / Brand Director",
    successMetric: "Customer-facing quality stays intact and issues are triaged quickly.",
    notes: []
  }
];

const CATEGORY_WORKFLOW_OWNERSHIP: Partial<Record<BusinessCategory, WorkflowOwnershipTemplateSpec[]>> = {
  digital_asset_store: [
    {
      workflowId: "store-autopilot",
      workflowName: "Digital Store Autopilot",
      departmentKind: "operations",
      positionTitle: "Operations Manager",
      allowedModelTier: "mid",
      allowedTools: ["scheduler", "browser-automation", "growth-queue", "org-control-plane"],
      escalationTargetTitle: "General Manager / Brand Director",
      successMetric: "The store keeps shipping products and growth tasks without drifting outside policy.",
      notes: []
    },
    {
      workflowId: "digital-asset-factory",
      workflowName: "Digital Asset Factory",
      departmentKind: "product_content",
      positionTitle: "Product / Content Lead",
      allowedModelTier: "mid",
      allowedTools: ["asset-builders", "imagegen", "qa"],
      escalationTargetTitle: "Operations Manager",
      successMetric: "Asset packs move from brief to publish-ready without duplicate or low-quality output.",
      notes: []
    }
  ],
  print_on_demand_store: [
    {
      workflowId: "pod-planning",
      workflowName: "POD Planning",
      departmentKind: "merchandising",
      positionTitle: "Merchandising Lead",
      allowedModelTier: "mid",
      allowedTools: ["pod-plan", "research", "org-control-plane"],
      escalationTargetTitle: "General Manager / Brand Director",
      successMetric: "Design and product plans stay deduplicated, on-brand, and launch-ready.",
      notes: []
    },
    {
      workflowId: "shopify-publishing",
      workflowName: "Shopify Publishing",
      departmentKind: "storefront_ops",
      positionTitle: "Storefront Operations Manager",
      allowedModelTier: "mid",
      allowedTools: ["shopify", "printify", "printful", "browser-automation"],
      escalationTargetTitle: "Operations Manager",
      successMetric: "Approved products publish to the storefront without duplicates.",
      notes: []
    }
  ],
  faceless_social_brand: [
    {
      workflowId: "content-production",
      workflowName: "Content Production",
      departmentKind: "content_studio",
      positionTitle: "Content Studio Lead",
      allowedModelTier: "mid",
      allowedTools: ["content-generation", "video", "imagegen"],
      escalationTargetTitle: "Growth And Marketing Manager",
      successMetric: "Content batches land on schedule and feed the approved growth plan.",
      notes: []
    },
    {
      workflowId: "community-ops",
      workflowName: "Community Operations",
      departmentKind: "community_qa",
      positionTitle: "Community And QA Lead",
      allowedModelTier: "mid",
      allowedTools: ["support", "social", "approvals"],
      escalationTargetTitle: "General Manager / Brand Director",
      successMetric: "Community-facing operations stay on-brand and within platform policy.",
      notes: []
    }
  ],
  micro_saas_factory: [
    {
      workflowId: "product-ops",
      workflowName: "Product Operations",
      departmentKind: "product_ops",
      positionTitle: "Product Operations Lead",
      allowedModelTier: "mid",
      allowedTools: ["product", "deploy", "qa", "analytics"],
      escalationTargetTitle: "Operations Manager",
      successMetric: "Software releases and onboarding changes ship with low operational risk.",
      notes: []
    }
  ]
};

const CATEGORY_SUMMARIES: Record<BusinessCategory | "engine", string> = {
  engine: "Parent-company operating model for portfolio governance, finance, systems, and risk.",
  digital_asset_store:
    "Business operating model for a low-support digital product store with strong production, growth, finance, and QA coverage.",
  niche_content_site:
    "Business operating model for editorial, SEO, and research-driven content businesses.",
  faceless_social_brand:
    "Business operating model for social-media-first brands with content studio, growth, analytics, and community ownership.",
  micro_saas_factory:
    "Business operating model for narrow software products with product operations, growth, finance, and support ownership.",
  print_on_demand_store:
    "Business operating model for merchandising-heavy physical product brands with storefront, merchandising, growth, and finance ownership.",
  client_services_agency:
    "Business operating model for service delivery, growth, analytics, finance, and customer support ownership."
};

function cloneDepartments(definitions: DepartmentTemplateSpec[]): DepartmentTemplateSpec[] {
  return definitions.map((definition) => ({
    ...definition,
    kpis: [...definition.kpis],
    toolTags: [...definition.toolTags],
    workflowIds: [...definition.workflowIds]
  }));
}

function clonePositions(definitions: PositionTemplateSpec[]): PositionTemplateSpec[] {
  return definitions.map((definition) => ({
    ...definition,
    escalationTriggers: [...definition.escalationTriggers],
    authorityLimits: [...definition.authorityLimits],
    decisionRights: [...definition.decisionRights],
    kpis: [...definition.kpis],
    toolTags: [...definition.toolTags],
    workflowIds: [...definition.workflowIds]
  }));
}

function cloneApprovalRoutes(definitions: ApprovalRouteTemplateSpec[]): ApprovalRouteTemplateSpec[] {
  return definitions.map((definition) => ({
    ...definition,
    actionClasses: [...definition.actionClasses],
    autoApproveWhen: [...definition.autoApproveWhen],
    escalationTitles: [...definition.escalationTitles],
    notes: [...definition.notes]
  }));
}

function cloneWorkflowOwnership(
  definitions: WorkflowOwnershipTemplateSpec[]
): WorkflowOwnershipTemplateSpec[] {
  return definitions.map((definition) => ({
    ...definition,
    allowedTools: [...definition.allowedTools],
    notes: [...definition.notes]
  }));
}

function mergeDepartments(
  baseDefinitions: DepartmentTemplateSpec[],
  extensions: DepartmentTemplateSpec[] = []
): DepartmentTemplateSpec[] {
  const byKind = new Map<DepartmentKind, DepartmentTemplateSpec>();
  for (const definition of [...baseDefinitions, ...extensions]) {
    byKind.set(definition.kind, {
      ...definition,
      kpis: [...definition.kpis],
      toolTags: [...definition.toolTags],
      workflowIds: [...definition.workflowIds]
    });
  }
  return [...byKind.values()];
}

function mergePositions(
  baseDefinitions: PositionTemplateSpec[],
  extensions: PositionTemplateSpec[] = []
): PositionTemplateSpec[] {
  const byTitle = new Map<string, PositionTemplateSpec>();
  for (const definition of [...baseDefinitions, ...extensions]) {
    byTitle.set(definition.title, {
      ...definition,
      escalationTriggers: [...definition.escalationTriggers],
      authorityLimits: [...definition.authorityLimits],
      decisionRights: [...definition.decisionRights],
      kpis: [...definition.kpis],
      toolTags: [...definition.toolTags],
      workflowIds: [...definition.workflowIds]
    });
  }
  return [...byTitle.values()];
}

function mergeWorkflowOwnership(
  baseDefinitions: WorkflowOwnershipTemplateSpec[],
  extensions: WorkflowOwnershipTemplateSpec[] = []
): WorkflowOwnershipTemplateSpec[] {
  const byWorkflowId = new Map<string, WorkflowOwnershipTemplateSpec>();
  for (const definition of [...baseDefinitions, ...extensions]) {
    byWorkflowId.set(definition.workflowId, {
      ...definition,
      allowedTools: [...definition.allowedTools],
      notes: [...definition.notes]
    });
  }
  return [...byWorkflowId.values()];
}

export function buildEngineOrgTemplate(): OrgTemplateSpec {
  return {
    summary: CATEGORY_SUMMARIES.engine,
    departments: cloneDepartments(ENGINE_DEPARTMENTS),
    positions: clonePositions(ENGINE_POSITIONS),
    approvalRoutes: cloneApprovalRoutes(BASE_APPROVAL_ROUTES),
    workflowOwnership: cloneWorkflowOwnership(ENGINE_WORKFLOW_OWNERSHIP)
  };
}

export function buildBusinessOrgTemplate(category: BusinessCategory): OrgTemplateSpec {
  return {
    summary: CATEGORY_SUMMARIES[category],
    departments: mergeDepartments(
      CORE_BUSINESS_DEPARTMENTS,
      CATEGORY_DEPARTMENT_EXTENSIONS[category] ?? []
    ),
    positions: mergePositions(
      CORE_BUSINESS_POSITIONS,
      CATEGORY_POSITION_EXTENSIONS[category] ?? []
    ),
    approvalRoutes: cloneApprovalRoutes(BASE_APPROVAL_ROUTES),
    workflowOwnership: mergeWorkflowOwnership(
      COMMON_BUSINESS_WORKFLOW_OWNERSHIP,
      CATEGORY_WORKFLOW_OWNERSHIP[category] ?? []
    )
  };
}

export function summarizeOrgTemplate(template: OrgTemplateSpec): OrgTemplateSummary {
  const departments = template.departments.map((department) => ({
    kind: department.kind,
    name: department.name,
    purpose: department.purpose,
    positionTitles: template.positions
      .filter((position) => position.departmentKind === department.kind)
      .map((position) => position.title)
  }));

  return {
    summary: template.summary,
    departments,
    workflowOwnership: template.workflowOwnership.map((record) => ({
      workflowId: record.workflowId,
      workflowName: record.workflowName,
      departmentKind: record.departmentKind,
      positionTitle: record.positionTitle,
      allowedModelTier: record.allowedModelTier,
      escalationTargetTitle: record.escalationTargetTitle
    })),
    approvalModel: template.approvalRoutes.map(
      (route) =>
        `${route.key.toUpperCase()}: ${route.notes.join(" ")} Escalation: ${
          route.escalationTitles.length > 0 ? route.escalationTitles.join(" -> ") : "auto-run"
        }.`
    )
  };
}
