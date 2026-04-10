import type { AgencyProfile, OfferConfig } from "./contracts.js";
import type { ImonEngineSeed, ManagedBusinessSeed } from "./engine.js";

export const DEFAULT_OFFERS: OfferConfig[] = [
  {
    id: "lead-generation-offer",
    name: "Lead Generation Offer",
    audience: "Home services businesses that need a lower-friction first step before a broader conversion rebuild",
    setupPrice: 349,
    monthlyPrice: 149,
    includedDeliverables: [
      "One lead-generation landing page or leak-review page refresh",
      "Lead capture cleanup for one primary job path",
      "Hosted intake routing and missed-lead follow-up starter",
      "Operator summary with the next conversion bottleneck called out"
    ],
    upsells: [
      "Growth System upgrade",
      "Additional landing page variants",
      "Review request automation"
    ],
    priceFloor: 349,
    slaHours: 48,
    active: true
  },
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
  headline: "Book more jobs without losing leads to weak pages and slow follow-up.",
  supportingCopy:
    "Northline helps plumbers, HVAC teams, electricians, roofers, cleaners, and other small service businesses fix weak homepages, missed calls, quote-request drop-off, and after-hours follow-up so more leads turn into booked jobs.",
  audience:
    "For owner-led and small dispatch-led home-service businesses that already have calls, referrals, Google traffic, or ad clicks coming in but still lose too many leads before they book.",
  heroNote:
    "Start with the leak review. Northline checks the page, the call path, and the quote path, then points to the fastest next fix.",
  industries: ["Plumbing", "HVAC", "Electrical", "Roofing", "Cleaning"],
  differentiators: [
    "Northline starts with the exact leak costing booked jobs right now: the weak headline, the buried CTA, the missed call, or the quote request nobody followed up on.",
    "The first pass fixes the page, the handoff, and the follow-up together so one broken step does not keep killing good demand.",
    "You get one clear next step before anyone talks about a bigger build, extra pages, or a longer retainer."
  ],
  proofPoints: [
    {
      stat: "1 business day",
      label: "Clear reply window",
      detail:
        "Northline replies with the first diagnosis, the first fix worth shipping, and the clearest next step instead of leaving the intake hanging."
    },
    {
      stat: "3 checks",
      label: "Page, CTA, follow-up",
      detail:
        "Northline reviews the first screen, the quote or call path, and the after-hours follow-up gap before recommending scope."
    },
    {
      stat: "1 next step",
      label: "Leak review, live review, or pilot",
      detail:
        "You hear whether the answer is an async review, a short live review, or the first paid build."
    }
  ],
  trustSignals: [
    {
      label: "Working method",
      title: "Northline shows what gets reviewed before it talks scope.",
      body:
        "The public trust surface explains the page, CTA, and follow-up issues Northline checks first so the buyer can judge the method without fake proof."
    },
    {
      label: "Deliverable",
      title: "The first reply is a practical next-step note, not placeholder proof.",
      body:
        "Northline answers with a short diagnosis, what to change first, and the clearest next move instead of padding the site with invented case studies or stats."
    },
    {
      label: "Buyer fit",
      title: "Built for small service teams that already have some demand.",
      body:
        "Northline is for plumbing, HVAC, electrical, roofing, and cleaning teams that already get calls, referrals, Google traffic, or ad clicks but lose too many leads before they book."
    }
  ],
  proofArtifacts: [
    {
      label: "What gets reviewed",
      title: "Northline checks the first place the lead stalls",
      body: "The first pass reads the page like an operator trying to book the next job, not like a polished agency audit.",
      items: [
        "Trade, job type, and service area are clear in the first screen",
        "CTA is obvious enough for a homeowner to call or request a quote fast",
        "Missed-call and quote-request follow-up do not die after hours"
      ]
    },
    {
      label: "What comes back",
      title: "You get a short usable next-step note",
      body: "Northline replies with response clarity and the first fix worth shipping, not a long strategy deck.",
      items: [
        "Page and CTA diagnosis",
        "Lead-routing or missed-call follow-up note",
        "Recommended next step within one business day"
      ]
    },
    {
      label: "Who fits first",
      title: "Best for teams with traffic but a weak close path",
      body: "Northline is more useful when there is already some demand to recover.",
      items: [
        "Owner-led plumbing, HVAC, electrical, roofing, or cleaning teams",
        "Existing Google, referral, or paid traffic already coming in",
        "Missed calls, quote drop-off, or thin follow-up after hours"
      ]
    }
  ],
  serviceStack: [
    {
      title: "Homepage and CTA cleanup",
      description:
        "Tighten the first screen, service framing, and call-to-action so homeowners quickly understand what you do and how to contact you."
    },
    {
      title: "Missed-call and quote follow-up cleanup",
      description:
        "Fix the handoff from page to phone to quote follow-up so leads stop dying after hours or after the first callback gets missed."
    },
    {
      title: "Follow-up that helps estimates get booked",
      description:
        "Give dispatch or the owner simple review, reply, and follow-up assets so more open leads move toward booked work."
    },
    {
      title: "Extra landing pages after the main path works",
      description:
        "Add service, seasonal, or paid-traffic pages only after the main homepage and lead path are already converting."
    }
  ],
  process: [
    {
      step: "01",
      title: "Find the first leak",
      body: "Northline reviews the first screen, CTA order, phone route, and missed-lead gaps before it prices anything bigger."
    },
    {
      step: "02",
      title: "Ship the first fix",
      body: "You get a faster first-pass page, one clear CTA, and a tighter intake path built around booked jobs."
    },
    {
      step: "03",
      title: "Tighten follow-up",
      body: "Follow-up assets, review asks, and buyer-facing trust cues are packed into launch instead of bolted on later."
    },
    {
      step: "04",
      title: "Expand after the close path works",
      body: "Once the main page converts cleanly, Northline adds service pages, seasonal offers, or ad-specific landing pages."
    }
  ],
  pricing: [
    {
      id: "lead-generation",
      label: "Lead Generation",
      amount: "$349 setup + $149/mo",
      details:
        "For operators that want the lowest-friction paid step first: Northline tightens one lead page, one intake path, and the first follow-up leak before anyone commits to a broader build.",
      idealFor:
        "Best for teams that want a smaller first yes after the leak review before Northline recommends the larger pilot or any later retained scope.",
      includes: [
        "Leak review translated into one paid first-pass page fix",
        "One primary CTA and intake-path cleanup",
        "Hosted intake routing for the first offer path",
        "Short follow-up note with the next leak called out"
      ],
      paymentLinkKey: "lead_generation",
      cta: {
        label: "Get leak review",
        mode: "review",
        href: "./intake.html"
      },
      upgradeOffer: {
        label: "Upgrade to Growth System",
        terms:
          "If the first fix proves the fit, Northline applies the configured upgrade checkout or coupon terms before the broader Growth System starts.",
        paymentLinkKey: "growth_upgrade"
      }
    },
    {
      id: "pilot-launch",
      label: "Pilot Launch",
      amount: "$749 setup + $199/mo",
      details:
        "For operators that already know the main leak and want Northline to fix the first page, CTA path, and dropped-lead problem as the main implementation instead of stretching into a broader build yet.",
      idealFor:
        "Best for one-location teams after Northline confirms the first leak, the first fix, and the pilot scope clearly enough to hold a slot.",
      includes: [
        "Homepage or landing-page rebuild",
        "One primary CTA and quote-path cleanup",
        "Hosted intake and missed-call recovery basics",
        "Review ask and trust-signal starter pack",
        "First-month friction review with next-step recommendations"
      ],
      paymentLinkKey: "founding",
      cta: {
        label: "See if the pilot fits",
        mode: "review",
        href: "./intake.html"
      }
    },
    {
      id: "growth-system",
      label: "Growth System",
      amount: "$1,250 setup + $299/mo",
      details:
        "For teams that already have demand, a proven first fix, and a clear case for broader landing-page coverage, deeper trust assets, and monthly conversion cleanup.",
      idealFor:
        "Best only after a pilot or first fix is live, the close path is working better, and Northline has real delivery proof behind the broader monthly ask.",
      includes: [
        "Service-page stack and campaign expansion",
        "Review and Google Business Profile support",
        "Ongoing CTA, intake, and follow-up optimization",
        "Monthly proof and conversion queue"
      ],
      paymentLinkKey: "standard",
      cta: {
        label: "Book growth review",
        mode: "review",
        href: "./book.html"
      }
    }
  ],
  faqs: [
    {
      question: "Should we start with the leak review or book a live review?",
      answer:
        "Start with the leak review if you want the fastest, lowest-friction next step. Book the live review if you want to talk through one urgent problem on a call. Northline points you to checkout only after the leak and first scope are clear."
    },
    {
      question: "Do you run ads from day one?",
      answer:
        "No. Northline fixes the homepage, lead path, and follow-up first, then adds paid traffic once the close path is ready."
    },
    {
      question: "How fast is the first review?",
      answer:
        "Northline aims to send the first leak review within 72 hours once the basics are in."
    },
    {
      question: "What do you need from us?",
      answer:
        "Your current website or page, the jobs you want more of, the area you serve, your contact details, and the main place leads get stuck now."
    }
  ],
  closingNote:
    "Northline fixes the spots where booked jobs get lost first: the weak homepage, the missed call, the ignored quote request, and the slow follow-up after hours."
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
    id: "clipbaiters-viral-moments",
    name: "ClipBaiters - Viral Moments",
    module: "clipbaiters-studio",
    category: "faceless_social_brand",
    launchPriority: 3.5,
    stage: "scaffolded",
    summary:
      "YouTube-first clipping lane for approved viral moments, commentary-led edits, and creator-paid auto clipping services.",
    rolloutReason:
      "Direct creator clipping revenue can arrive earlier than broad audience monetization, but the lane needs explicit rights, review, and editorial guardrails before launch.",
    revenueModel: "Creator clipping retainers, event packages, and later audience monetization",
    platforms: ["YouTube", "YouTube Shorts", "YouTube Studio", "Optional Facebook Page"],
    automationFocus: [
      "Forecast upcoming viral events and approved source opportunities",
      "Ingest approved source video and generate clip candidates",
      "Draft captions, packaging, and transformed commentary angles",
      "Track creator service revenue, clip performance, and policy risk"
    ],
    ownerActions: [
      "Approve the source-rights and fair-use review policy before any live publishing",
      "Create or warm the first niche YouTube channels in the shared ImonEngine Chrome profile",
      "Review the first approved clip packages and creator-facing offers"
    ],
    launchBlockers: [
      "The approved-source, rights, and editorial review policy must be signed off before this lane can publish clips or fulfill creator orders.",
      "The first niche YouTube channels still need manual creation and warming in the shared ImonEngine browser profile.",
      "The ingest, transcription, editing, and review pipeline is not implemented yet."
    ],
    approvalType: "compliance",
    automationPotential: 8,
    setupComplexity: 4,
    complianceRisk: "high",
    supportLoad: "medium",
    humanSetupHours: 6,
    schedule: {
      cadence: "Daily radar and editorial windows",
      timezone: "America/New_York",
      maxRunsPerDay: 3,
      preferredWindows: ["08:00-10:00", "13:00-15:00", "19:00-21:00"]
    },
    resourceBudget: {
      maxCpuShare: 0.3,
      maxMemoryGb: 6,
      maxDiskGb: 75
    },
    metrics: {
      targetMonthlyRevenue: 1800,
      currentMonthlyRevenue: 0,
      currentMonthlyCosts: 15,
      dataValueScore: 9,
      automationCoverage: 0.35,
      activeWorkItems: 4
    },
    notes: [
      "Start the YouTube-first rollout with ClipBaitersPolitical and ClipBaitersMedia while keeping ClipBaitersStreaming ready as the first direct monetization lane.",
      "Treat niche separation as platform-level channel separation, and add per-lane off-platform identities only when those lane accounts actually exist."
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
    northlineProfile: {
      collectionTrades: ["plumbing", "hvac", "electrical", "roofing", "cleaning"],
      targetIndustries: [...DEFAULT_AGENCY_PROFILE.industries],
      targetServices: [
        "Proof page rebuild",
        "Hosted intake and missed-call recovery",
        "Follow-up and trust loop",
        "Campaign landing pages"
      ],
      offerSummary:
        "Booked-job-focused proof pages, one-route intake systems, and follow-up flows for home-service operators.",
      agencyProfile: DEFAULT_AGENCY_PROFILE
    },
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
