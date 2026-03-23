import type { AgencyProfile, OfferConfig } from "./contracts.js";
import type { ImonEngineSeed, ManagedBusinessSeed } from "./engine.js";

export const DEFAULT_OFFERS: OfferConfig[] = [
  {
    id: "founding-offer",
    name: "Founding Offer",
    audience: "Home services businesses needing lead capture and follow-up",
    setupPrice: 749,
    monthlyPrice: 199,
    includedDeliverables: [
      "One conversion-focused landing page",
      "Call and form CTA wiring",
      "Follow-up workflow copy and missed-call text-back playbook",
      "Review response drafts",
      "Monthly performance summary"
    ],
    upsells: [
      "Google Business Profile optimization",
      "Review request automation",
      "Seasonal service campaign page"
    ],
    priceFloor: 749,
    slaHours: 72,
    active: true
  },
  {
    id: "standard-offer",
    name: "Standard Offer",
    audience: "Home services businesses with existing traction",
    setupPrice: 1250,
    monthlyPrice: 299,
    includedDeliverables: [
      "Full service page stack",
      "Lead capture and qualification assets",
      "Monthly optimization report",
      "Offer testing roadmap"
    ],
    upsells: [
      "White-label fulfillment",
      "Ad landing page variants",
      "Intake script refinement"
    ],
    priceFloor: 1250,
    slaHours: 96,
    active: true
  }
];

export const DEFAULT_AGENCY_PROFILE: AgencyProfile = {
  name: "Northline Growth Systems",
  headline: "AI-operated lead generation for home-service companies",
  supportingCopy:
    "We turn weak local websites into conversion-ready funnels, then keep the follow-up and reporting loop moving so owners can stay in the field.",
  pricing: [
    {
      label: "Founding",
      amount: "$749 setup + $199/mo",
      details: "For the first five clients. Built to prove speed, not drag out a consulting process."
    },
    {
      label: "Standard",
      amount: "$1,250 setup + $299/mo",
      details: "For businesses that need a tighter funnel, monthly optimization, and recurring updates."
    }
  ],
  differentiators: [
    "Conversion-focused sites instead of brochure pages",
    "Structured outreach and intake workflows built into delivery",
    "Monthly reporting with upsell recommendations instead of passive maintenance"
  ],
  proofPoints: [
    "72-hour preview SLA for landing-page builds",
    "File-backed workflow that can run without extra SaaS spend",
    "Approval-first ops for payments, access, and compliance exceptions"
  ]
};

export const DEFAULT_IMON_ENGINE: ImonEngineSeed = {
  id: "imon-engine",
  name: "ImonEngine",
  overview:
    "Portfolio controller for low-touch AI businesses. It consolidates revenue, tracks VPS pressure, ranks launch order, and keeps the easiest systems at the front of the rollout queue.",
  timezone: "America/New_York",
  host: {
    provider: "Contabo",
    label: "OpenClaw VPS"
  },
  limits: {
    maxConcurrentBusinesses: 2,
    cpuUtilizationTarget: 0.7,
    memoryUtilizationTarget: 0.75,
    minDiskFreeGb: 40
  },
  portfolio: {
    trackedBusinesses: 0,
    activeBusinesses: 0,
    readyBusinesses: 0,
    blockedBusinesses: 0
  }
};

export const DEFAULT_MANAGED_BUSINESSES: ManagedBusinessSeed[] = [
  {
    id: "imon-digital-asset-store",
    name: "Imon Digital Asset Store",
    module: "digital-asset-factory",
    category: "digital_asset_store",
    launchPriority: 1,
    stage: "ready",
    summary:
      "Asset-pack business for stock images, wallpapers, icons, UI kits, and social templates distributed through marketplace storefronts.",
    rolloutReason:
      "Lowest support burden, clean automation surface, and fast revenue signal without needing ads or live support.",
    revenueModel: "Marketplace royalties and direct digital downloads",
    platforms: ["Gumroad", "Etsy", "Creative Market", "Shopify Digital Downloads"],
    automationFocus: [
      "Generate asset packs and variant batches",
      "Write listing titles, tags, and metadata",
      "Prepare thumbnails and pricing experiments",
      "Track downloads, conversion rate, and refund anomalies"
    ],
    ownerActions: [
      "Connect at least one marketplace seller account",
      "Provide payout destination and tax profile",
      "Approve the first three asset pack niches"
    ],
    launchBlockers: [],
    approvalType: "marketplace",
    automationPotential: 10,
    setupComplexity: 1,
    complianceRisk: "low",
    supportLoad: "low",
    humanSetupHours: 2,
    schedule: {
      cadence: "Every 6 hours",
      timezone: "America/New_York",
      maxRunsPerDay: 4,
      preferredWindows: ["02:00-04:00", "08:00-10:00", "14:00-16:00", "20:00-22:00"]
    },
    resourceBudget: {
      maxCpuShare: 0.15,
      maxMemoryGb: 2,
      maxDiskGb: 20
    },
    metrics: {
      targetMonthlyRevenue: 1000,
      currentMonthlyRevenue: 0,
      currentMonthlyCosts: 15,
      dataValueScore: 6,
      automationCoverage: 0.85,
      activeWorkItems: 4
    },
    notes: [
      "Use the VPS for image generation queues, metadata generation, and marketplace listing prep.",
      "This is the first launch candidate whenever capacity exists."
    ]
  },
  {
    id: "imon-niche-content-sites",
    name: "Imon Niche Content Sites",
    module: "content-site-network",
    category: "niche_content_site",
    launchPriority: 2,
    stage: "ready",
    summary:
      "SEO-driven content site network that produces informational and affiliate pages around low-support niches.",
    rolloutReason:
      "Light infrastructure, strong learning signal, and good alignment with data collection around topics, funnels, and monetization.",
    revenueModel: "Ads, affiliate commissions, and lead capture",
    platforms: ["Static sites", "Cloudflare Pages", "Affiliate networks", "Analytics"],
    automationFocus: [
      "Discover keyword clusters and content gaps",
      "Draft, update, and interlink articles",
      "Monitor page health, rankings, and CTA performance",
      "Feed content performance back into portfolio planning"
    ],
    ownerActions: [
      "Approve the first niche and domain strategy",
      "Connect analytics and affiliate programs",
      "Review monetization disclosures"
    ],
    launchBlockers: [],
    approvalType: "domain",
    automationPotential: 9,
    setupComplexity: 2,
    complianceRisk: "low",
    supportLoad: "low",
    humanSetupHours: 3,
    schedule: {
      cadence: "Twice daily",
      timezone: "America/New_York",
      maxRunsPerDay: 2,
      preferredWindows: ["05:00-07:00", "17:00-19:00"]
    },
    resourceBudget: {
      maxCpuShare: 0.2,
      maxMemoryGb: 3,
      maxDiskGb: 30
    },
    metrics: {
      targetMonthlyRevenue: 1500,
      currentMonthlyRevenue: 0,
      currentMonthlyCosts: 25,
      dataValueScore: 8,
      automationCoverage: 0.8,
      activeWorkItems: 5
    },
    notes: [
      "Designed to become the highest-quality behavioral data feed early on.",
      "Content batches should be throttled when disk or memory pressure rises."
    ]
  },
  {
    id: "imon-faceless-social-brand",
    name: "Imon Faceless Social Brand",
    module: "social-brand-studio",
    category: "faceless_social_brand",
    launchPriority: 3,
    stage: "scaffolded",
    summary:
      "Persona-driven content brand that publishes media, tests hooks, and measures engagement patterns across social platforms.",
    rolloutReason:
      "Valuable as a training environment, but it needs slower ramp-up because platform trust and moderation risk are higher.",
    revenueModel: "Audience monetization, sponsorships, and later paid offers",
    platforms: ["TikTok", "Instagram", "YouTube Shorts", "Scheduling tools"],
    automationFocus: [
      "Generate scripts, visuals, and captions",
      "Schedule and rotate post formats",
      "Track engagement drift and account health",
      "Escalate platform-risk events before account damage compounds"
    ],
    ownerActions: [
      "Create and warm platform accounts",
      "Approve brand guardrails and moderation settings",
      "Review the first week of posting volume"
    ],
    launchBlockers: [
      "Platform accounts need to be created and warmed manually before automation starts.",
      "Posting cadence needs manual review to reduce flag risk."
    ],
    approvalType: "marketplace",
    automationPotential: 7,
    setupComplexity: 3,
    complianceRisk: "medium",
    supportLoad: "medium",
    humanSetupHours: 5,
    schedule: {
      cadence: "Three windows daily",
      timezone: "America/New_York",
      maxRunsPerDay: 3,
      preferredWindows: ["09:00-10:00", "13:00-14:00", "19:00-20:00"]
    },
    resourceBudget: {
      maxCpuShare: 0.25,
      maxMemoryGb: 4,
      maxDiskGb: 35
    },
    metrics: {
      targetMonthlyRevenue: 800,
      currentMonthlyRevenue: 0,
      currentMonthlyCosts: 20,
      dataValueScore: 9,
      automationCoverage: 0.65,
      activeWorkItems: 6
    },
    notes: [
      "Use OpenClaw browser automation carefully and keep publishing volume conservative at first."
    ]
  },
  {
    id: "imon-micro-saas-factory",
    name: "Imon Micro-SaaS Factory",
    module: "micro-saas-factory",
    category: "micro_saas_factory",
    launchPriority: 4,
    stage: "scaffolded",
    summary:
      "Factory lane for small subscription products like caption generators, ad idea tools, prompt utilities, and niche analytics.",
    rolloutReason:
      "High long-term leverage, but still heavier than content or assets because deployment, billing, and support expectations appear sooner.",
    revenueModel: "Subscriptions and one-off pro upgrades",
    platforms: ["Static landing pages", "Stripe", "Cloudflare Pages", "Email capture"],
    automationFocus: [
      "Generate narrow product briefs from portfolio pain points",
      "Ship landing pages and MVPs quickly",
      "Measure signup and retention data",
      "Reuse portfolio learnings as product features"
    ],
    ownerActions: [
      "Approve the first MVP niche",
      "Connect Stripe and support inboxes",
      "Review legal pages before launch"
    ],
    launchBlockers: [
      "Billing and support channels need to be connected before launch."
    ],
    approvalType: "payment",
    automationPotential: 8,
    setupComplexity: 4,
    complianceRisk: "medium",
    supportLoad: "medium",
    humanSetupHours: 6,
    schedule: {
      cadence: "Daily build window",
      timezone: "America/New_York",
      maxRunsPerDay: 1,
      preferredWindows: ["01:00-05:00"]
    },
    resourceBudget: {
      maxCpuShare: 0.3,
      maxMemoryGb: 6,
      maxDiskGb: 40
    },
    metrics: {
      targetMonthlyRevenue: 2500,
      currentMonthlyRevenue: 0,
      currentMonthlyCosts: 50,
      dataValueScore: 8,
      automationCoverage: 0.7,
      activeWorkItems: 7
    },
    notes: [
      "Best launched after asset and content systems are producing stable learnings."
    ]
  },
  {
    id: "imon-pod-store",
    name: "Imon Print-on-Demand Store",
    module: "pod-lab",
    category: "print_on_demand_store",
    launchPriority: 5,
    stage: "scaffolded",
    summary:
      "Design-driven store for print-on-demand products with AI-generated artwork, descriptions, and niche testing.",
    rolloutReason:
      "Still automatable, but it requires more third-party setup and operational review than digital-only products.",
    revenueModel: "Product margin from print-on-demand orders",
    platforms: ["Shopify", "Printful", "Printify", "Marketplaces"],
    automationFocus: [
      "Generate design batches and mockups",
      "Write product descriptions and tags",
      "Test niche bundles and pricing",
      "Track return patterns and ad readiness"
    ],
    ownerActions: [
      "Connect POD vendor accounts",
      "Set shipping and tax defaults",
      "Approve the first store theme and niches"
    ],
    launchBlockers: [
      "Print-on-demand vendor integrations and store policies need owner approval."
    ],
    approvalType: "marketplace",
    automationPotential: 7,
    setupComplexity: 4,
    complianceRisk: "medium",
    supportLoad: "medium",
    humanSetupHours: 6,
    schedule: {
      cadence: "Daily merchandising window",
      timezone: "America/New_York",
      maxRunsPerDay: 1,
      preferredWindows: ["10:00-13:00"]
    },
    resourceBudget: {
      maxCpuShare: 0.25,
      maxMemoryGb: 4,
      maxDiskGb: 50
    },
    metrics: {
      targetMonthlyRevenue: 1200,
      currentMonthlyRevenue: 0,
      currentMonthlyCosts: 35,
      dataValueScore: 5,
      automationCoverage: 0.72,
      activeWorkItems: 5
    },
    notes: [
      "Keep this behind the digital asset store because the fulfillment surface is wider."
    ]
  },
  {
    id: "auto-funding-agency",
    name: "Auto-Funding Agency",
    module: "auto-funding-agency",
    category: "client_services_agency",
    launchPriority: 6,
    stage: "paused",
    summary:
      "The existing home-services agency pipeline that prospects, drafts outreach, builds client sites, and produces retention reports.",
    rolloutReason:
      "Kept under ImonEngine management, but intentionally paused while the lower-touch businesses are validated first.",
    revenueModel: "Setup fees and monthly retainers",
    platforms: ["Email outreach", "Cloudflare Pages", "Static previews", "Stripe"],
    automationFocus: [
      "Prospecting and scoring",
      "Outreach drafting and approval routing",
      "Client site builds and QA",
      "Retention reporting"
    ],
    ownerActions: [
      "Decide when to promote the agency lane back into active rotation",
      "Complete payment and inbox approvals when live outreach resumes"
    ],
    launchBlockers: [],
    approvalType: "manual",
    automationPotential: 8,
    setupComplexity: 5,
    complianceRisk: "medium",
    supportLoad: "high",
    humanSetupHours: 8,
    schedule: {
      cadence: "Daily ops review",
      timezone: "America/New_York",
      maxRunsPerDay: 1,
      preferredWindows: ["08:00-09:00"]
    },
    resourceBudget: {
      maxCpuShare: 0.35,
      maxMemoryGb: 5,
      maxDiskGb: 25
    },
    metrics: {
      targetMonthlyRevenue: 5000,
      currentMonthlyRevenue: 0,
      currentMonthlyCosts: 0,
      dataValueScore: 9,
      automationCoverage: 0.78,
      activeWorkItems: 0
    },
    notes: [
      "Existing single-business commands remain intact; ImonEngine now governs when this lane should be active."
    ]
  }
];
