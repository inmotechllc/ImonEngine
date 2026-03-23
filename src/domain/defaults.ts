import type { AgencyProfile, OfferConfig } from "./contracts.js";

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
