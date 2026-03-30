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
      "One conversion-focused homepage or landing-page rebuild",
      "Call-first mobile CTA and quote-form routing",
      "Missed-call text-back and intake script pack",
      "Review request and review-response starter library",
      "Monthly operator summary with next-step recommendations"
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
      "Service page stack for core jobs and territories",
      "Lead capture, qualification, and call-routing assets",
      "Review pipeline and Google Business Profile support",
      "Monthly optimization report with test queue",
      "Ad landing page variants or seasonal campaign page"
    ],
    upsells: [
      "White-label fulfillment",
      "Local search or retargeting landing pages",
      "Intake script refinement"
    ],
    priceFloor: 1250,
    slaHours: 96,
    active: true
  }
];

export const DEFAULT_AGENCY_PROFILE: AgencyProfile = {
  name: "Northline Growth Systems",
  headline: "Northline installs fast proof pages, intake systems, and follow-up flows for home-service operators.",
  supportingCopy:
    "We tighten the gap between click, reply, and booked job: clearer offer framing, stronger intake routing, missed-call recovery, follow-up assets, and monthly conversion cleanup without a bloated agency process.",
  audience:
    "Built for plumbing, HVAC, electrical, roofing, and cleaning operators that already have demand but lose too many calls between click and dispatch.",
  heroNote: "Pilot slots stay intentionally small so delivery stays fast, direct, and fully remote from teardown to launch.",
  industries: ["Plumbing", "HVAC", "Electrical", "Roofing", "Cleaning"],
  differentiators: [
    "Operator-first proof pages built to drive replies and booked calls, not brochure browsing.",
    "Hosted intake, missed-call, and quote-form workflows are packaged into delivery instead of added later.",
    "Monthly cleanup stays focused on booked jobs and friction points instead of vanity reporting."
  ],
  proofPoints: [
    "72-hour preview SLA for first-page rebuilds",
    "Hosted intake path and quote capture in the initial scope",
    "Follow-up assets included from day one"
  ],
  serviceStack: [
    {
      title: "Proof page rebuild",
      description:
        "Rework the first screen, service hierarchy, proof stack, and quote capture so existing traffic turns into replies and calls."
    },
    {
      title: "Hosted intake and missed-call recovery",
      description:
        "Install intake routing, text-back guidance, and dispatch handoff flows so leads stop dying after hours."
    },
    {
      title: "Follow-up and trust loop",
      description:
        "Give the business a repeatable follow-up and review-request system that strengthens proof instead of leaving it ad hoc."
    },
    {
      title: "Campaign landing pages",
      description:
        "Ship clean pages for Google Ads, Local Services Ads support, seasonal promos, and referral pushes once the core funnel is working."
    }
  ],
  process: [
    {
      step: "01",
      title: "Audit the leak",
      body: "Northline starts with a teardown of the homepage, CTA flow, mobile friction, and review surface."
    },
    {
      step: "02",
      title: "Ship the preview",
      body: "You get a fast first-pass preview with direct copy, clearer calls to action, and a tighter service offer."
    },
    {
      step: "03",
      title: "Wire the follow-up",
      body: "Forms, call-routing notes, missed-call text-back language, and review assets are packed into the launch instead of added later."
    },
    {
      step: "04",
      title: "Clean up monthly",
      body: "Every month Northline reviews friction points, recommends the next test, and keeps the funnel from drifting back into brochure mode."
    }
  ],
  pricing: [
    {
      label: "Pilot Launch",
      amount: "$749 setup + $199/mo",
      details:
        "For the first five operators Northline brings on. Use this to replace a weak first page, stand up hosted intake, and tighten the follow-up basics.",
      idealFor:
        "Best for one-location operators that need a fast rebuild before they buy more traffic.",
      includes: [
        "Homepage or landing-page rebuild",
        "Call CTA and quote-form cleanup",
        "Missed-call text-back playbook",
        "Review request and response starter pack"
      ]
    },
    {
      label: "Growth System",
      amount: "$1,250 setup + $299/mo",
      details:
        "For teams that need a broader service stack, monthly optimization, and dedicated landing pages for active campaigns.",
      idealFor:
        "Best for operators already spending on demand generation or juggling multiple high-value services.",
      includes: [
        "Service-page stack",
        "Review and Google Business Profile support",
        "Campaign landing pages",
        "Monthly optimization queue"
      ]
    }
  ],
  faqs: [
    {
      question: "Do you run ads from day one?",
      answer:
        "No. Northline fixes the close path first, then adds paid traffic once the proof page, intake path, and follow-up loop are ready."
    },
    {
      question: "How fast can launch happen?",
      answer:
        "Pilot rebuilds are designed around a 72-hour preview, then a short review cycle once access, routing details, and approvals are in place."
    },
    {
      question: "What do you need from the client?",
      answer:
        "Domain access, brand assets if they exist, service priorities, contact routing, and approval on the final CTA and offer stack."
    },
    {
      question: "Is this a full custom agency retainer?",
      answer:
        "No. Northline is productized on purpose so small operators get useful systems without a long consulting cycle."
    }
  ],
  closingNote:
    "Northline is built to start lean: proof page, intake, and outbound first, search next, paid social only after the conversion path is proven."
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
    deferredBusinesses: 0,
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
    name: "Northbeam Atlas Network",
    module: "content-site-network",
    category: "niche_content_site",
    launchPriority: 2,
    stage: "deferred",
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
      "Approve the first niche, domain strategy, and distinct site brand",
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
    name: "Velora Echo Media",
    module: "social-brand-studio",
    category: "faceless_social_brand",
    launchPriority: 3,
    stage: "deferred",
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
      "Create and warm platform accounts under a distinct creator brand",
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
    name: "QuietPivot Labs",
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
      "Approve the first MVP niche and brand name",
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
    name: "Imonic",
    module: "pod-lab",
    category: "print_on_demand_store",
    launchPriority: 5,
    stage: "scaffolded",
    summary:
      "Digital-art storefront for original AI-generated illustrations translated into print-on-demand products through a Shopify-led catalog.",
    rolloutReason:
      "Higher setup burden than digital downloads, but it is the clearest next test of whether Imon can convert original art into a real physical-product business.",
    revenueModel: "Shopify product margin from print-on-demand orders",
    platforms: ["Shopify", "Printify", "Printful", "Instagram", "Pinterest", "Meta"],
    automationFocus: [
      "Generate original digital-art designs from a reference style dossier",
      "Create product-ready mockups, descriptions, and merchandising copy",
      "Schedule daily Shopify product additions without duplicating design and product pairs",
      "Coordinate carousel, story, and reel promotion around published products"
    ],
    ownerActions: [
      "Create the Shopify trial store and leave the admin logged into the VPS Chrome profile",
      "Connect at least one POD vendor account and leave the account logged in on the VPS if browser automation is required",
      "Confirm taxes, shipping defaults, and storefront basics once the launch dossier flags them"
    ],
    launchBlockers: [
      "Shopify store credentials and at least one POD vendor integration are required before product publishing can start."
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
      "Use imonengine+imonic@gmail.com as the umbrella alias for Shopify and the first social accounts.",
      "Start with five original designs so the first product cadence can rotate designs instead of repeating one illustration across the whole week."
    ]
  },
  {
    id: "auto-funding-agency",
    name: "Northline Growth Systems",
    module: "auto-funding-agency",
    category: "client_services_agency",
    launchPriority: 6,
    stage: "paused",
    summary:
      "Home-services growth lane that prospects operators, ships remote proof pages, routes intake, and packages follow-up, reviews, and recurring optimization.",
    rolloutReason:
      "Revenue can start quickly once the proof page, intake path, payment links, and inbox are live, without waiting on a local office footprint.",
    revenueModel: "Setup fees and monthly retainers",
    platforms: [
      "Email outreach",
      "VPS-hosted proof page",
      "Static previews",
      "Stripe",
      "Meta Business Suite"
    ],
    automationFocus: [
      "Prospecting and scoring",
      "Offer packaging and teardown-first sales assets",
      "Outreach drafting and approval routing",
      "Client site builds and QA",
      "Retention reporting and review operations"
    ],
    ownerActions: [
      "Connect a public proof page or hosted Northline site plus one live intake path",
      "Connect Stripe payment links and a branded sales inbox",
      "Add optional trust layers like social proof, reviews, and SMTP after the faceless pipeline is already live"
    ],
    launchBlockers: [
      "Northline still needs a public proof page and at least one live intake path.",
      "Stripe payment links and the branded contact path are not fully connected."
    ],
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
      "Existing single-business commands remain intact; ImonEngine now governs when this lane should be active.",
      "Treat outbound as the first acquisition channel until at least three proof assets exist."
    ]
  }
];
