import path from "node:path";
import type { AppConfig } from "../config.js";
import type {
  PodAutomationPlan,
  PodPostKind,
  PodPostPlatform,
  PodProductType,
  PodScheduledPost
} from "../domain/pod.js";
import type { SocialProfileRecord } from "../domain/social.js";
import type {
  CollectiveFundSnapshot,
  RevenueAllocationPolicy,
  RevenueAllocationSnapshot
} from "../domain/store-ops.js";
import { slugify, unique } from "../lib/text.js";
import { writeJsonFile, writeTextFile } from "../lib/fs.js";
import { FileStore } from "../storage/store.js";
import { PodStudioService } from "./pod-studio.js";
import { StoreOpsService } from "./store-ops.js";

const IMONIC_BUSINESS_ID = "imon-pod-store";

type ProductFamily = "wall_art" | "apparel" | "accessory" | "home_decor" | "collectible";
type ReadinessStatus = "ready" | "planned" | "blocked" | "gated";

type ProductTypeSettings = {
  family: ProductFamily;
  priceUsd: number;
  compareAtPriceUsd: number;
  useCase: string;
  mockupFocus: string;
};

type DesignQueueItem = {
  id: string;
  designId: string;
  title: string;
  concept: string;
  prompt: string;
  launchCollectionHandle: string;
  firstProducts: string[];
  exportTargets: string[];
  qaChecklist: string[];
  mockupShots: string[];
};

type CollectionDraft = {
  handle: string;
  title: string;
  description: string;
  merchandisingGoal: string;
  productHandles: string[];
  sortOrder: number;
};

type ListingSection = {
  label: string;
  body: string;
};

type ListingDraft = {
  id: string;
  productScheduleId: string;
  designId: string;
  designTitle: string;
  productType: PodProductType;
  productLabel: string;
  productTitle: string;
  subtitle: string;
  handle: string;
  priceUsd: number;
  compareAtPriceUsd: number;
  scheduledFor: string;
  primaryCollectionHandles: string[];
  tags: string[];
  seoTitle: string;
  metaDescription: string;
  featureBullets: string[];
  descriptionSections: ListingSection[];
  mockupBrief: string[];
  crossSellHandles: string[];
  publishingChecklist: string[];
};

type LaunchCalendarEvent = {
  id: string;
  scheduledFor: string;
  category: "owner_action" | "product_launch" | "social_post";
  title: string;
  dependency: string;
  destinationHandle?: string;
};

type PlatformPlaybook = {
  platform: PodPostPlatform | SocialProfileRecord["platform"];
  status: SocialProfileRecord["status"] | ReadinessStatus;
  role: string;
  cadence: string;
  objective: string;
  notes: string[];
};

type ScheduledMarketingPost = {
  id: string;
  scheduledFor: string;
  platform: PodPostPlatform;
  kind: PodPostKind;
  title: string;
  hook: string;
  caption: string;
  cta: string;
  destinationHandle: string;
  dependency: string;
};

type EmailFlow = {
  id: string;
  trigger: string;
  subject: string;
  objective: string;
  corePoints: string[];
};

type AdExperiment = {
  id: string;
  name: string;
  channel: string;
  status: ReadinessStatus;
  trigger: string;
  objective: string;
  creativeAngle: string;
  landingHandle: string;
  maxDailyBudgetUsd: number;
  successSignals: string[];
  stopSignals: string[];
};

type AdPlan = {
  readiness: {
    status: ReadinessStatus;
    reason: string;
    availableGrowthBudgetUsd: number;
    suggestedMaxDailyBudgetUsd: number;
  };
  experiments: AdExperiment[];
};

type GrowthEngine = {
  generatedAt: string;
  platformPlaybooks: PlatformPlaybook[];
  scheduledPosts: ScheduledMarketingPost[];
  evergreenLoops: string[];
  emailFlows: EmailFlow[];
  adPlan: AdPlan;
};

type DataSourceStatus = {
  name: string;
  status: ReadinessStatus;
  cadence: string;
  dependency: string;
};

type AnalyticsMetric = {
  id: string;
  name: string;
  source: string;
  cadence: string;
  definition: string;
};

type RevenueImportCadence = {
  name: string;
  cadence: string;
  verification: string;
  purpose: string;
};

type RevenuePlan = {
  allocationPolicy: RevenueAllocationPolicy;
  snapshot: RevenueAllocationSnapshot;
  collectiveSnapshot: CollectiveFundSnapshot;
  importCadence: RevenueImportCadence[];
};

type AnalyticsEngine = {
  generatedAt: string;
  dataSources: DataSourceStatus[];
  metrics: AnalyticsMetric[];
  alertRules: string[];
  reviewLoops: string[];
  revenuePlan: RevenuePlan;
};

type OwnerAction = {
  id: string;
  system: string;
  priority: "high" | "medium" | "low";
  summary: string;
  unblocks: string[];
};

type OwnerChecklist = {
  requiredActions: OwnerAction[];
  recommendedActions: OwnerAction[];
};

type AutonomyReport = {
  businessId: string;
  businessName: string;
  generatedAt: string;
  launchStatus: string;
  blockerCount: number;
  readiness: {
    productCreation: ReadinessStatus;
    listings: ReadinessStatus;
    publishing: ReadinessStatus;
    social: ReadinessStatus;
    ads: ReadinessStatus;
    analytics: ReadinessStatus;
    revenue: ReadinessStatus;
  };
  autonomousNow: string[];
  ownerUnlocks: string[];
  blockers: string[];
  nextCommand: string;
};

export interface PodAutonomyArtifacts {
  autonomyJsonPath: string;
  autonomyMarkdownPath: string;
  commerceJsonPath: string;
  growthJsonPath: string;
  analyticsJsonPath: string;
  launchCalendarJsonPath: string;
  ownerChecklistMarkdownPath: string;
}

export interface PodOperatingSystemResult {
  plan: PodAutomationPlan;
  designQueue: DesignQueueItem[];
  collections: CollectionDraft[];
  listingDrafts: ListingDraft[];
  launchCalendar: LaunchCalendarEvent[];
  growthEngine: GrowthEngine;
  analyticsEngine: AnalyticsEngine;
  ownerChecklist: OwnerChecklist;
  autonomyReport: AutonomyReport;
  socialProfiles: SocialProfileRecord[];
  artifacts: PodAutonomyArtifacts;
}

const PRODUCT_SETTINGS: Record<PodProductType, ProductTypeSettings> = {
  t_shirt: {
    family: "apparel",
    priceUsd: 34,
    compareAtPriceUsd: 44,
    useCase: "everyday hero apparel",
    mockupFocus: "front mockup, folded flat lay, detail crop"
  },
  puzzle: {
    family: "collectible",
    priceUsd: 39,
    compareAtPriceUsd: 49,
    useCase: "detail-rich gift or coffee-table piece",
    mockupFocus: "assembled crop, boxed lifestyle shot, close detail"
  },
  canvas: {
    family: "wall_art",
    priceUsd: 69,
    compareAtPriceUsd: 89,
    useCase: "statement wall art",
    mockupFocus: "room scene, clean wall crop, edge detail"
  },
  poster: {
    family: "wall_art",
    priceUsd: 29,
    compareAtPriceUsd: 39,
    useCase: "entry-level wall art",
    mockupFocus: "framed room scene, flat crop, texture detail"
  },
  shorts: {
    family: "apparel",
    priceUsd: 44,
    compareAtPriceUsd: 56,
    useCase: "bold wearable statement piece",
    mockupFocus: "front mockup, motion lifestyle shot, detail crop"
  },
  clock: {
    family: "home_decor",
    priceUsd: 39,
    compareAtPriceUsd: 49,
    useCase: "functional decor accent",
    mockupFocus: "wall scene, face detail, room context"
  },
  tapestry: {
    family: "wall_art",
    priceUsd: 49,
    compareAtPriceUsd: 64,
    useCase: "large-format room centerpiece",
    mockupFocus: "wide room scene, drape detail, styled crop"
  },
  round_rug: {
    family: "home_decor",
    priceUsd: 79,
    compareAtPriceUsd: 99,
    useCase: "floor statement piece",
    mockupFocus: "floor scene, close textile crop, scale reference"
  },
  mouse_pad: {
    family: "accessory",
    priceUsd: 24,
    compareAtPriceUsd: 32,
    useCase: "desk accessory impulse buy",
    mockupFocus: "desk scene, surface detail, scale shot"
  },
  bag: {
    family: "accessory",
    priceUsd: 32,
    compareAtPriceUsd: 42,
    useCase: "portable everyday art piece",
    mockupFocus: "front mockup, carried lifestyle shot, detail crop"
  },
  phone_case: {
    family: "accessory",
    priceUsd: 28,
    compareAtPriceUsd: 36,
    useCase: "high-frequency accessory purchase",
    mockupFocus: "device mockup, hand-held shot, camera cutout detail"
  },
  hoodie: {
    family: "apparel",
    priceUsd: 59,
    compareAtPriceUsd: 74,
    useCase: "premium cold-weather apparel",
    mockupFocus: "front mockup, worn lifestyle shot, print detail"
  },
  sticker: {
    family: "accessory",
    priceUsd: 9,
    compareAtPriceUsd: 12,
    useCase: "low-ticket brand entry point",
    mockupFocus: "sheet mockup, laptop placement, die-cut closeup"
  }
};

function nowIso(): string {
  return new Date().toISOString();
}

function familyHandle(family: ProductFamily): string {
  switch (family) {
    case "wall_art":
      return "imonic-wall-art";
    case "apparel":
      return "imonic-apparel";
    case "accessory":
      return "imonic-accessories";
    case "home_decor":
      return "imonic-home-decor";
    case "collectible":
      return "imonic-collectibles";
  }
}

function familyTitle(family: ProductFamily): string {
  switch (family) {
    case "wall_art":
      return "Wall Art";
    case "apparel":
      return "Apparel";
    case "accessory":
      return "Accessories";
    case "home_decor":
      return "Home Decor";
    case "collectible":
      return "Collectibles";
  }
}

function relativeDropHandle(index: number): string {
  return `imonic-drop-${String(Math.floor(index / 7) + 1).padStart(2, "0")}`;
}

function titleWords(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

function compactConcept(concept: string): string {
  return concept.charAt(0).toUpperCase() + concept.slice(1).replace(/\.$/, "");
}

function hasRoadblock(plan: PodAutomationPlan, roadblockId: string): boolean {
  return plan.roadblocks.some((roadblock) => roadblock.id === roadblockId);
}

export class PodAutonomyService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore,
    private readonly podStudio: PodStudioService,
    private readonly storeOps: StoreOpsService
  ) {}

  async writeOperatingSystem(options?: {
    businessId?: string;
    referenceDirectory?: string;
    notifyRoadblocks?: boolean;
  }): Promise<PodOperatingSystemResult> {
    const businessId = options?.businessId ?? IMONIC_BUSINESS_ID;
    const planResult = await this.podStudio.writePlan({
      businessId,
      referenceDirectory: options?.referenceDirectory,
      notifyRoadblocks: options?.notifyRoadblocks
    });
    const plan = planResult.plan;
    const socialProfiles = await this.storeOps.ensureSocialProfiles(plan.businessId, plan.businessName);
    const allocationPolicy = await this.storeOps.ensureAllocationPolicy(plan.businessId);
    const revenueSnapshot = await this.storeOps.buildRevenueSnapshot(plan.businessId, 30);
    const collectiveSnapshot = await this.storeOps.buildCollectiveFundSnapshot(30);
    const revenuePlan = this.buildRevenuePlan(allocationPolicy, revenueSnapshot, collectiveSnapshot);
    const designQueue = this.buildDesignQueue(plan);
    const listingDrafts = this.buildListingDrafts(plan);
    const collections = this.buildCollections(plan, listingDrafts);
    const launchCalendar = this.buildLaunchCalendar(plan, listingDrafts);
    const growthEngine = this.buildGrowthEngine(plan, listingDrafts, socialProfiles, revenuePlan);
    const analyticsEngine = this.buildAnalyticsEngine(plan, socialProfiles, revenuePlan);
    const ownerChecklist = this.buildOwnerChecklist(plan, socialProfiles);
    const autonomyReport = this.buildAutonomyReport(
      plan,
      growthEngine.adPlan,
      analyticsEngine,
      listingDrafts,
      ownerChecklist
    );
    const artifacts = await this.writeArtifacts({
      plan,
      designQueue,
      collections,
      listingDrafts,
      launchCalendar,
      growthEngine,
      analyticsEngine,
      ownerChecklist,
      autonomyReport,
      socialProfiles
    });
    await this.updateBusinessState(plan.businessId, plan.businessName);

    return {
      plan,
      designQueue,
      collections,
      listingDrafts,
      launchCalendar,
      growthEngine,
      analyticsEngine,
      ownerChecklist,
      autonomyReport,
      socialProfiles,
      artifacts
    };
  }

  private buildDesignQueue(plan: PodAutomationPlan): DesignQueueItem[] {
    return plan.starterDesigns.map((design) => {
      const scheduledProducts = plan.productSchedule
        .filter((product) => product.designId === design.id)
        .slice(0, 4)
        .map((product) => `${product.productLabel} on ${product.scheduledFor.slice(0, 10)}`);

      return {
        id: `${design.id}-production-queue`,
        designId: design.id,
        title: design.title,
        concept: compactConcept(design.concept),
        prompt: design.prompt,
        launchCollectionHandle: `design-${slugify(design.title)}`,
        firstProducts: scheduledProducts,
        exportTargets: [
          "Primary master artwork with clean edges and print-safe negative space.",
          "Square crop for storefront and carousel use.",
          "Vertical crop for Pinterest and story formats.",
          "One detail crop for closeup merchandising."
        ],
        qaChecklist: [
          "Keep the artwork original and free of celebrity likenesses, franchise characters, or logos.",
          "Maintain clear silhouette separation at thumbnail size.",
          "Leave enough negative space or containment for mockups to stay legible.",
          "Check that the focal subject still reads on both wall-art and smaller accessory crops."
        ],
        mockupShots: [
          "Hero mockup with the product filling most of the frame.",
          "Lifestyle placement shot for scale and context.",
          "Detail crop that shows texture, linework, or color transitions."
        ]
      };
    });
  }

  private buildListingDrafts(plan: PodAutomationPlan): ListingDraft[] {
    const templatesByType = new Map(plan.productTemplates.map((template) => [template.type, template]));

    return plan.productSchedule.map((product, index) => {
      const design = plan.starterDesigns.find((candidate) => candidate.id === product.designId);
      const settings = PRODUCT_SETTINGS[product.productType];
      const template = templatesByType.get(product.productType);
      const designCollectionHandle = `design-${slugify(product.designTitle)}`;
      const dropHandle = relativeDropHandle(index);
      const handlesForDesign = plan.productSchedule
        .filter((candidate) => candidate.designId === product.designId && candidate.id !== product.id)
        .slice(0, 3)
        .map((candidate) => candidate.shopifyHandle);
      const tags = unique([
        "imonic",
        familyTitle(settings.family).toLowerCase().replace(/\s+/g, "-"),
        ...titleWords(product.designTitle).slice(0, 3),
        ...plan.styleDossier.motifs.slice(0, 3).map((item) => slugify(item))
      ]);
      const featureBullets = [
        `${compactConcept(design?.concept ?? `${product.designTitle} translated into physical merch`)}.`,
        `Built as a ${settings.useCase} with ${template?.merchandisingAngle ?? "balanced merchandising"} in mind.`,
        `Best merch lane: ${familyTitle(settings.family)}.`
      ];
      const descriptionSections: ListingSection[] = [
        {
          label: "Product Story",
          body: `${compactConcept(design?.concept ?? product.designTitle)}. This version packages the artwork as a ${product.productLabel.toLowerCase()} for ${settings.useCase}.`
        },
        {
          label: "Why It Converts",
          body: `The piece leans on ${plan.styleDossier.signals[0]?.toLowerCase() ?? "bold visual hierarchy"} and ${plan.styleDossier.signals[1]?.toLowerCase() ?? "clean negative space"} so the mockups stay legible in a crowded feed.`
        },
        {
          label: "Merchandising Notes",
          body: `Lead with ${settings.mockupFocus}. Cross-sell it with other ${product.designTitle} items once the first listing is live.`
        },
        {
          label: "Operational Guardrails",
          body: "Only publish after vendor sync, price verification, mockup QA, and a matching social post draft are ready."
        }
      ];

      return {
        id: `${product.id}-listing`,
        productScheduleId: product.id,
        designId: product.designId,
        designTitle: product.designTitle,
        productType: product.productType,
        productLabel: product.productLabel,
        productTitle: `${product.designTitle} ${product.productLabel}`,
        subtitle: `Original ${product.designTitle} artwork translated into ${settings.useCase}.`,
        handle: product.shopifyHandle,
        priceUsd: settings.priceUsd,
        compareAtPriceUsd: settings.compareAtPriceUsd,
        scheduledFor: product.scheduledFor,
        primaryCollectionHandles: [
          "imonic-featured-drop",
          familyHandle(settings.family),
          designCollectionHandle,
          dropHandle
        ],
        tags,
        seoTitle: `${product.designTitle} ${product.productLabel} | Imonic`,
        metaDescription: `Shop ${product.designTitle} as a ${product.productLabel.toLowerCase()} from Imonic. Original art, bold mockups, and a clean giftable presentation.`,
        featureBullets,
        descriptionSections,
        mockupBrief: [
          `Priority shots: ${settings.mockupFocus}.`,
          "Keep one clean product-only frame and one room or body context frame.",
          "Preserve readable focal contrast in the thumbnail crop."
        ],
        crossSellHandles: handlesForDesign,
        publishingChecklist: [
          "Upload the final artwork master and the approved mockup set.",
          "Confirm the vendor sync, pricing, and variant visibility.",
          "Attach the featured, family, design, and launch-drop collections.",
          "Paste the SEO title, meta description, and tag set before publishing.",
          "Do not schedule social promotion until the product page is live."
        ]
      };
    });
  }

  private buildCollections(plan: PodAutomationPlan, listingDrafts: ListingDraft[]): CollectionDraft[] {
    const collections: CollectionDraft[] = [];
    const pushCollection = (draft: CollectionDraft) => {
      if (draft.productHandles.length === 0) {
        return;
      }
      collections.push(draft);
    };

    pushCollection({
      handle: "imonic-featured-drop",
      title: "Imonic Featured Drop",
      description: "The first curation of original Imonic pieces across wall art, apparel, and accessories.",
      merchandisingGoal: "Homepage hero collection for the first storefront pass.",
      productHandles: listingDrafts.slice(0, 8).map((draft) => draft.handle),
      sortOrder: 1
    });

    const byFamily = new Map<ProductFamily, ListingDraft[]>();
    for (const draft of listingDrafts) {
      const family = PRODUCT_SETTINGS[draft.productType].family;
      byFamily.set(family, [...(byFamily.get(family) ?? []), draft]);
    }

    let sortOrder = 10;
    for (const family of ["wall_art", "apparel", "accessory", "home_decor", "collectible"] as ProductFamily[]) {
      const drafts = byFamily.get(family) ?? [];
      pushCollection({
        handle: familyHandle(family),
        title: `Imonic ${familyTitle(family)}`,
        description: `A grouped ${familyTitle(family).toLowerCase()} collection from the Imonic launch bank.`,
        merchandisingGoal: `Keep ${familyTitle(family).toLowerCase()} browseable as a single storefront lane.`,
        productHandles: drafts.map((draft) => draft.handle),
        sortOrder
      });
      sortOrder += 10;
    }

    for (const design of plan.starterDesigns) {
      const designDrafts = listingDrafts.filter((draft) => draft.designId === design.id);
      pushCollection({
        handle: `design-${slugify(design.title)}`,
        title: design.title,
        description: `All launch products built from the ${design.title} artwork system.`,
        merchandisingGoal: "Create an easy upsell path for buyers who connect with one illustration.",
        productHandles: designDrafts.map((draft) => draft.handle),
        sortOrder
      });
      sortOrder += 10;
    }

    return collections.sort((left, right) => left.sortOrder - right.sortOrder);
  }

  private buildLaunchCalendar(plan: PodAutomationPlan, listingDrafts: ListingDraft[]): LaunchCalendarEvent[] {
    const listingByProductId = new Map(listingDrafts.map((draft) => [draft.productScheduleId, draft]));
    const events: LaunchCalendarEvent[] = [];

    for (const roadblock of plan.roadblocks) {
      events.push({
        id: `owner-${roadblock.id}`,
        scheduledFor: plan.generatedAt,
        category: "owner_action",
        title: roadblock.summary,
        dependency: roadblock.requiredFromOwner.join(" ")
      });
    }

    for (const product of plan.productSchedule) {
      const draft = listingByProductId.get(product.id);
      events.push({
        id: `${product.id}-launch`,
        scheduledFor: product.scheduledFor,
        category: "product_launch",
        title: `${product.designTitle} -> ${product.productLabel}`,
        dependency: "Requires Shopify draft creation, vendor sync, and mockup QA.",
        destinationHandle: draft?.handle
      });
    }

    for (const post of plan.socialSchedule) {
      const draft = listingDrafts.find(
        (candidate) =>
          candidate.designId === post.designId &&
          (!post.productType || candidate.productType === post.productType)
      );
      events.push({
        id: `${post.id}-marketing`,
        scheduledFor: post.scheduledFor,
        category: "social_post",
        title: `${post.kind} on ${post.platform} for ${post.designTitle}`,
        dependency: "Skip this if the matching Shopify listing is not live yet.",
        destinationHandle: draft?.handle
      });
    }

    return events.sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor));
  }

  private buildGrowthEngine(
    plan: PodAutomationPlan,
    listingDrafts: ListingDraft[],
    socialProfiles: SocialProfileRecord[],
    revenuePlan: RevenuePlan
  ): GrowthEngine {
    const scheduledPosts = plan.socialSchedule.map((post) =>
      this.composeScheduledPost(plan, post, listingDrafts)
    );
    const platformPlaybooks = socialProfiles.map((profile) => ({
      platform: profile.platform,
      status: profile.status,
      role: profile.role ?? "distribution",
      cadence:
        profile.platform === "instagram_account"
          ? "3 feed posts per week plus stories or reels."
          : profile.platform === "pinterest"
            ? "2 to 3 fresh pins per week."
            : profile.platform === "facebook_page"
              ? "1 to 2 support posts per week."
              : "Warm and maintain for the launch window.",
      objective:
        profile.platform === "instagram_account"
          ? "Show the brand world and move profile clicks into the storefront."
          : profile.platform === "pinterest"
            ? "Create evergreen discovery for product and collection pages."
            : profile.platform === "facebook_page"
              ? "Support trust, retargeting readiness, and lightweight community proof."
              : "Maintain the account surface needed for automation.",
      notes: profile.notes
    }));

    const emailFlows: EmailFlow[] = [
      {
        id: "imonic-welcome-sequence",
        trigger: "A new email signup enters the Imonic list.",
        subject: "Meet Imonic: the first drop is ready",
        objective: "Introduce the brand voice, hero collections, and the first low-friction click path.",
        corePoints: [
          "Position Imonic as original art translated into physical goods.",
          "Send shoppers to the featured drop and one family collection.",
          "Offer a first-purchase incentive only after the storefront is live."
        ]
      },
      {
        id: "imonic-drop-alert",
        trigger: "A new scheduled product is published in Shopify.",
        subject: "New Imonic drop: {{product_title}}",
        objective: "Tie each product release to a quick email touch instead of relying only on social.",
        corePoints: [
          "Lead with the product mockup that best explains scale.",
          "Link directly to the product page and the matching design collection.",
          "Reuse the same core angle as the paired social post."
        ]
      },
      {
        id: "imonic-weekly-collection-roundup",
        trigger: "Weekly on Friday afternoon.",
        subject: "This week’s Imonic collection picks",
        objective: "Bundle together the best-looking recent products without increasing publishing volume.",
        corePoints: [
          "Highlight one hero design and two supporting products.",
          "Use collection links instead of fragmenting clicks across too many SKUs.",
          "Pause this flow until the first live collection page exists."
        ]
      }
    ];

    const adPlan = this.buildAdPlan(plan, revenuePlan, listingDrafts, socialProfiles);

    return {
      generatedAt: plan.generatedAt,
      platformPlaybooks,
      scheduledPosts,
      evergreenLoops: [
        "Open each new design with one hero collection page, not a scattered set of isolated products.",
        "Create one Pinterest save for each published product and one additional save for the matching collection page.",
        "Bundle two or three products from the same design only after one of those products shows real click or save signal.",
        "Ask for customer photos or room placements after the first delivered orders to build future proof assets."
      ],
      emailFlows,
      adPlan
    };
  }

  private composeScheduledPost(
    plan: PodAutomationPlan,
    post: PodScheduledPost,
    listingDrafts: ListingDraft[]
  ): ScheduledMarketingPost {
    const listing =
      listingDrafts.find(
        (candidate) =>
          candidate.designId === post.designId &&
          (!post.productType || candidate.productType === post.productType)
      ) ?? listingDrafts[0];
    const design = plan.starterDesigns.find((candidate) => candidate.id === post.designId);
    const shortConcept = compactConcept(design?.concept ?? post.designTitle);
    const baseTitle = listing?.productTitle ?? `${post.designTitle} launch`;

    const hook =
      post.kind === "reel"
        ? `Watch ${post.designTitle} shift from flat art to ${listing?.productLabel ?? "product"} form.`
        : post.kind === "story"
          ? `${baseTitle} is live.`
          : post.kind === "pin"
            ? `${baseTitle} for save-and-shop discovery.`
            : `New Imonic drop: ${baseTitle}.`;
    const cta =
      post.platform === "pinterest"
        ? "Save it, then shop the matching collection."
        : post.platform === "facebook_page"
          ? "Tap through to the live product once it is published."
          : "View the live product or collection from the profile link.";

    const caption = [hook, "", shortConcept, "", post.assetDirection, "", cta].join("\n");

    return {
      id: post.id,
      scheduledFor: post.scheduledFor,
      platform: post.platform,
      kind: post.kind,
      title: `${post.kind} -> ${baseTitle}`,
      hook,
      caption,
      cta,
      destinationHandle: listing?.handle ?? "",
      dependency: "Publish only after the linked Shopify page is live."
    };
  }

  private buildAdPlan(
    plan: PodAutomationPlan,
    revenuePlan: RevenuePlan,
    listingDrafts: ListingDraft[],
    socialProfiles: SocialProfileRecord[]
  ): AdPlan {
    const availableGrowthBudgetUsd = revenuePlan.snapshot.recommendations.growthReinvestment;
    const suggestedMaxDailyBudgetUsd = Math.floor(availableGrowthBudgetUsd / 7);
    const metaReady = socialProfiles.some(
      (profile) => profile.platform === "facebook_page" && profile.status === "live"
    );
    const pinterestReady = socialProfiles.some(
      (profile) => profile.platform === "pinterest" && profile.status === "live"
    );
    const storeReady = !hasRoadblock(plan, "shopify-admin-setup") && !hasRoadblock(plan, "pod-vendor-setup");
    const hasVerifiedRevenue = revenuePlan.snapshot.dataQuality.verifiedTransactions > 0;

    let status: ReadinessStatus = "blocked";
    let reason = "Shopify publishing and POD vendor setup still block paid experimentation.";
    if (storeReady && !hasVerifiedRevenue) {
      status = "gated";
      reason = "Keep ads off until Imonic has verified revenue and at least one working conversion path.";
    } else if (storeReady && hasVerifiedRevenue && !metaReady && !pinterestReady) {
      status = "planned";
      reason = "The store can support paid tests once at least one ad-capable channel is live.";
    } else if (storeReady && hasVerifiedRevenue) {
      status = "ready";
      reason = "Paid tests can start within the verified reinvestment budget.";
    }

    const landingHandle = listingDrafts[0]?.primaryCollectionHandles[0] ?? "imonic-featured-drop";

    const experiments: AdExperiment[] = [
      {
        id: "meta-retargeting-featured-drop",
        name: "Meta Retargeting: Featured Drop",
        channel: "facebook_page",
        status: metaReady && status === "ready" ? "ready" : status,
        trigger: "Enable only after the pixel and first verified sales exist.",
        objective: "Retarget product or collection visitors back to the featured drop.",
        creativeAngle: "Lead with the strongest room or product mockup rather than a pure flat crop.",
        landingHandle,
        maxDailyBudgetUsd: metaReady ? Math.max(0, suggestedMaxDailyBudgetUsd) : 0,
        successSignals: ["Positive add-to-cart rate from retargeted visitors.", "ROAS above break-even over 3 days."],
        stopSignals: ["Three-day ROAS below break-even.", "50 clicks without a meaningful add-to-cart signal."]
      },
      {
        id: "pinterest-collection-promotion",
        name: "Pinterest Promotion: Collection Pin",
        channel: "pinterest",
        status: pinterestReady && status !== "blocked" ? status : "planned",
        trigger: "Use only after a strong-performing organic pin proves the creative angle.",
        objective: "Boost a save-heavy hero collection pin into additional product page visits.",
        creativeAngle: "Use a vertical collage with one hero product and one tight detail crop.",
        landingHandle,
        maxDailyBudgetUsd: pinterestReady ? Math.max(0, suggestedMaxDailyBudgetUsd) : 0,
        successSignals: ["Strong outbound click-through from a saved pin.", "Cost per product-page visit remains efficient."],
        stopSignals: ["Outbound clicks stay weak after two creative variants.", "The landing collection has no add-to-cart behavior."]
      },
      {
        id: "meta-broad-creative-test",
        name: "Meta Broad Test: Winning Design Angle",
        channel: "facebook_page",
        status: status === "ready" && metaReady ? "planned" : status,
        trigger: "Launch only after retargeting proves which design family converts first.",
        objective: "Test the strongest design family against a broader creative audience.",
        creativeAngle: "One hero design, one tight use-case angle, one collection landing page.",
        landingHandle,
        maxDailyBudgetUsd: metaReady ? Math.max(0, suggestedMaxDailyBudgetUsd) : 0,
        successSignals: ["Strong thumb-stop CTR and consistent add-to-cart rate.", "AOV holds while prospecting traffic scales."],
        stopSignals: ["CTR stays weak across three creative variants.", "Prospecting traffic burns budget without downstream cart activity."]
      }
    ];

    return {
      readiness: {
        status,
        reason,
        availableGrowthBudgetUsd,
        suggestedMaxDailyBudgetUsd: Math.max(0, suggestedMaxDailyBudgetUsd)
      },
      experiments
    };
  }

  private buildAnalyticsEngine(
    plan: PodAutomationPlan,
    socialProfiles: SocialProfileRecord[],
    revenuePlan: RevenuePlan
  ): AnalyticsEngine {
    const shopifyReady = !hasRoadblock(plan, "shopify-admin-setup");
    const vendorReady = !hasRoadblock(plan, "pod-vendor-setup");
    const metaStatus = socialProfiles.some((profile) => profile.platform === "facebook_page" && profile.status === "live")
      ? "ready"
      : socialProfiles.some((profile) => profile.platform === "facebook_page")
        ? "planned"
        : "blocked";
    const pinterestStatus = socialProfiles.some((profile) => profile.platform === "pinterest" && profile.status === "live")
      ? "ready"
      : socialProfiles.some((profile) => profile.platform === "pinterest")
        ? "planned"
        : "blocked";
    const instagramStatus = socialProfiles.some((profile) => profile.platform === "instagram_account" && profile.status === "live")
      ? "ready"
      : socialProfiles.some((profile) => profile.platform === "instagram_account")
        ? "planned"
        : "blocked";

    const dataSources: DataSourceStatus[] = [
      {
        name: "Shopify orders and product analytics export",
        status: shopifyReady ? "ready" : "blocked",
        cadence: "Daily",
        dependency: shopifyReady
          ? "Use for product sessions, add-to-cart, checkout, and order attribution."
          : "Blocked until the Shopify store exists and admin access is live."
      },
      {
        name: "POD vendor cost and fulfillment export",
        status: vendorReady ? "ready" : "blocked",
        cadence: "Daily",
        dependency: vendorReady
          ? "Use for unit cost, fulfillment lag, and margin checks."
          : "Blocked until Printify or Printful is connected."
      },
      {
        name: "Instagram insights export",
        status: instagramStatus as ReadinessStatus,
        cadence: "Weekly",
        dependency: "Needed to compare profile clicks, saves, and top creative angles."
      },
      {
        name: "Pinterest analytics export",
        status: pinterestStatus as ReadinessStatus,
        cadence: "Weekly",
        dependency: "Needed for outbound clicks, saves, and evergreen board performance."
      },
      {
        name: "Meta ads export",
        status: metaStatus as ReadinessStatus,
        cadence: "Daily after ads begin",
        dependency: "Only matters after paid tests unlock."
      },
      {
        name: "Relay banking export",
        status: "ready",
        cadence: "Weekly",
        dependency: "Use as observed cash movement only, not as the source of truth for earnings."
      }
    ];

    const metrics: AnalyticsMetric[] = [
      {
        id: "product-launch-velocity",
        name: "Product Launch Velocity",
        source: "Launch calendar vs live Shopify catalog",
        cadence: "Weekly",
        definition: "How many scheduled launches actually made it live inside the target window."
      },
      {
        id: "sessions-per-collection",
        name: "Sessions Per Collection",
        source: "Shopify analytics",
        cadence: "Daily",
        definition: "Which collections are earning visits and which ones stay invisible."
      },
      {
        id: "add-to-cart-rate",
        name: "Add-To-Cart Rate",
        source: "Shopify analytics",
        cadence: "Daily",
        definition: "Visits that create cart intent divided by product or collection sessions."
      },
      {
        id: "conversion-rate",
        name: "Store Conversion Rate",
        source: "Shopify analytics",
        cadence: "Daily",
        definition: "Orders divided by sessions over the current review window."
      },
      {
        id: "average-order-value",
        name: "Average Order Value",
        source: "Shopify orders export",
        cadence: "Daily",
        definition: "Average verified order value for live Imonic products."
      },
      {
        id: "gross-margin-per-order",
        name: "Gross Margin Per Order",
        source: "Shopify orders + POD vendor cost export",
        cadence: "Weekly",
        definition: "Verified order revenue minus direct product and fulfillment cost."
      },
      {
        id: "creative-save-rate",
        name: "Creative Save Rate",
        source: "Instagram and Pinterest insights",
        cadence: "Weekly",
        definition: "How often a design or product earns a save compared with its reach."
      },
      {
        id: "paid-roas",
        name: "Paid ROAS",
        source: "Meta or Pinterest ads export + verified revenue",
        cadence: "Daily after ads begin",
        definition: "Attributed revenue divided by ad spend, used only after verified revenue is present."
      },
      {
        id: "refund-rate",
        name: "Refund Rate",
        source: "Shopify or vendor support records",
        cadence: "Weekly",
        definition: "Refunds divided by verified orders over the current window."
      }
    ];

    return {
      generatedAt: plan.generatedAt,
      dataSources,
      metrics,
      alertRules: [
        "Pause new creative volume if the catalog is growing but product sessions remain flat for two weeks.",
        "Do not unlock ads until there is verified revenue and one product or collection page has clear add-to-cart behavior.",
        "Treat Relay exports as observed bank activity only. Verified marketplace or storefront exports remain the source of truth for earnings."
      ],
      reviewLoops: [
        "Daily: reconcile live products against the launch calendar and flag anything that missed publish.",
        "Weekly: rank designs by product views, saves, and add-to-cart behavior before creating more variants.",
        "Monthly: review verified revenue, margin, and reinvestment recommendations before changing spend."
      ],
      revenuePlan
    };
  }

  private buildRevenuePlan(
    allocationPolicy: RevenueAllocationPolicy,
    snapshot: RevenueAllocationSnapshot,
    collectiveSnapshot: CollectiveFundSnapshot
  ): RevenuePlan {
    return {
      allocationPolicy,
      snapshot,
      collectiveSnapshot,
      importCadence: [
        {
          name: "Shopify orders export",
          cadence: "Daily",
          verification: "Verified store export",
          purpose: "Use as the source of truth for order volume, AOV, and verified revenue."
        },
        {
          name: "POD vendor export",
          cadence: "Daily or every fulfillment batch",
          verification: "Verified vendor export",
          purpose: "Use for cost, fulfillment timing, and margin accounting."
        },
        {
          name: "Meta or Pinterest ads export",
          cadence: "Daily after spend begins",
          verification: "Verified platform export",
          purpose: "Use for spend, CPC, CTR, and paid learning reviews."
        },
        {
          name: "Relay export",
          cadence: "Weekly",
          verification: "Observed cash movement only",
          purpose: "Reconcile bank activity without letting inferred classifications drive allocation decisions."
        }
      ]
    };
  }

  private buildOwnerChecklist(
    plan: PodAutomationPlan,
    socialProfiles: SocialProfileRecord[]
  ): OwnerChecklist {
    const requiredActions = plan.roadblocks.map<OwnerAction>((roadblock) => ({
      id: roadblock.id,
      system: roadblock.category,
      priority:
        roadblock.id === "shopify-admin-setup" || roadblock.id === "pod-vendor-setup"
          ? "high"
          : "medium",
      summary: roadblock.summary,
      unblocks: roadblock.continueAfterCompletion
    }));

    const recommendedActions: OwnerAction[] = [];
    const instagram = socialProfiles.find((profile) => profile.platform === "instagram_account");
    const pinterest = socialProfiles.find((profile) => profile.platform === "pinterest");
    const facebook = socialProfiles.find((profile) => profile.platform === "facebook_page");

    if (instagram && instagram.status !== "live") {
      recommendedActions.push({
        id: "instagram-brand-launch",
        system: "Instagram",
        priority: "medium",
        summary: `Create the primary Imonic Instagram account with ${instagram.emailAlias} and keep it signed in on the VPS profile.`,
        unblocks: [
          "Lets the scheduled carousels and reels publish without an extra signup step.",
          "Creates a direct organic feedback loop for future design decisions."
        ]
      });
    }

    if (pinterest && pinterest.status !== "live") {
      recommendedActions.push({
        id: "pinterest-brand-launch",
        system: "Pinterest",
        priority: "medium",
        summary: `Create the Imonic Pinterest business profile, first board, and login session with ${pinterest.emailAlias}.`,
        unblocks: [
          "Lets the evergreen pin queue start driving visual discovery to collections and products."
        ]
      });
    }

    if (facebook && facebook.status !== "live") {
      recommendedActions.push({
        id: "meta-surface-complete",
        system: "Meta",
        priority: "medium",
        summary: "Finish the umbrella Meta Page and keep the page-token path or signed-in browser session available.",
        unblocks: [
          "Supports Facebook publishing and later paid creative testing once the store converts."
        ]
      });
    }

    recommendedActions.push(
      {
        id: "shipping-and-payout-review",
        system: "Storefront Operations",
        priority: "medium",
        summary: "Review taxes, shipping defaults, payout routing, returns, and support inbox basics once the Shopify store is active.",
        unblocks: [
          "Prevents a half-live storefront from creating avoidable support debt."
        ]
      },
      {
        id: "pixel-and-email-capture",
        system: "Analytics / Growth",
        priority: "low",
        summary: "Install pixel and email capture once the storefront and first collections are live.",
        unblocks: [
          "Lets ads stay gated until the measurement stack can support them cleanly."
        ]
      }
    );

    return { requiredActions, recommendedActions };
  }

  private buildAutonomyReport(
    plan: PodAutomationPlan,
    adPlan: AdPlan,
    analyticsEngine: AnalyticsEngine,
    listingDrafts: ListingDraft[],
    ownerChecklist: OwnerChecklist
  ): AutonomyReport {
    const publishingReady = !hasRoadblock(plan, "shopify-admin-setup") && !hasRoadblock(plan, "pod-vendor-setup");
    const hasPlannedSocialSetup = ownerChecklist.recommendedActions.some((action) =>
      ["instagram-brand-launch", "pinterest-brand-launch", "meta-surface-complete"].includes(action.id)
    );
    const revenueReady =
      analyticsEngine.revenuePlan.snapshot.dataQuality.verifiedTransactions > 0 ? "ready" : "planned";

    return {
      businessId: plan.businessId,
      businessName: plan.businessName,
      generatedAt: plan.generatedAt,
      launchStatus: plan.status,
      blockerCount: plan.roadblocks.length,
      readiness: {
        productCreation: plan.styleDossier.fileCount > 0 ? "ready" : "blocked",
        listings: listingDrafts.length > 0 ? "ready" : "blocked",
        publishing: publishingReady ? "ready" : "blocked",
        social: hasPlannedSocialSetup ? "planned" : "ready",
        ads: adPlan.readiness.status,
        analytics: analyticsEngine.dataSources.some((source) => source.status === "ready") ? "planned" : "blocked",
        revenue: revenueReady
      },
      autonomousNow: [
        "Generates a five-design prompt bank and a deduplicated product queue.",
        "Builds Shopify-ready listing drafts, collections, launch calendar, and cross-sell structure.",
        "Writes the organic marketing engine, email flows, and ad gating rules.",
        "Enforces verified-data revenue policy and reinvestment recommendations."
      ],
      ownerUnlocks: ownerChecklist.requiredActions
        .flatMap((action) => action.unblocks)
        .concat(ownerChecklist.recommendedActions.flatMap((action) => action.unblocks)),
      blockers: plan.roadblocks.map((roadblock) => roadblock.summary),
      nextCommand: "npm run dev -- pod-autonomy --business imon-pod-store"
    };
  }

  private async writeArtifacts(payload: {
    plan: PodAutomationPlan;
    designQueue: DesignQueueItem[];
    collections: CollectionDraft[];
    listingDrafts: ListingDraft[];
    launchCalendar: LaunchCalendarEvent[];
    growthEngine: GrowthEngine;
    analyticsEngine: AnalyticsEngine;
    ownerChecklist: OwnerChecklist;
    autonomyReport: AutonomyReport;
    socialProfiles: SocialProfileRecord[];
  }): Promise<PodAutonomyArtifacts> {
    const baseDir = path.join(this.config.opsDir, "pod-businesses", payload.plan.businessId);
    const autonomyJsonPath = path.join(baseDir, "autonomy-system.json");
    const autonomyMarkdownPath = path.join(baseDir, "autonomy-summary.md");
    const commerceJsonPath = path.join(baseDir, "commerce-engine.json");
    const growthJsonPath = path.join(baseDir, "growth-engine.json");
    const analyticsJsonPath = path.join(baseDir, "analytics-engine.json");
    const launchCalendarJsonPath = path.join(baseDir, "launch-calendar.json");
    const ownerChecklistMarkdownPath = path.join(baseDir, "owner-checklist.md");

    await writeJsonFile(autonomyJsonPath, payload);
    await writeJsonFile(commerceJsonPath, {
      generatedAt: payload.plan.generatedAt,
      designQueue: payload.designQueue,
      collections: payload.collections,
      listingDrafts: payload.listingDrafts
    });
    await writeJsonFile(growthJsonPath, {
      generatedAt: payload.plan.generatedAt,
      socialProfiles: payload.socialProfiles,
      growthEngine: payload.growthEngine
    });
    await writeJsonFile(analyticsJsonPath, payload.analyticsEngine);
    await writeJsonFile(launchCalendarJsonPath, payload.launchCalendar);
    const artifacts: PodAutonomyArtifacts = {
      autonomyJsonPath,
      autonomyMarkdownPath,
      commerceJsonPath,
      growthJsonPath,
      analyticsJsonPath,
      launchCalendarJsonPath,
      ownerChecklistMarkdownPath
    };
    await writeTextFile(autonomyMarkdownPath, this.toSummaryMarkdown({ ...payload, artifacts }));
    await writeTextFile(ownerChecklistMarkdownPath, this.toOwnerChecklistMarkdown(payload.ownerChecklist));
    return artifacts;
  }

  private async updateBusinessState(businessId: string, businessName: string): Promise<void> {
    const business = await this.store.getManagedBusiness(businessId);
    if (!business) {
      return;
    }

    await this.store.saveManagedBusiness({
      ...business,
      name: businessName,
      notes: [
        ...business.notes.filter((note) => !note.startsWith("Imonic autonomy system refreshed")),
        `Imonic autonomy system refreshed ${nowIso()}.`,
        "The operating system artifacts live under runtime/ops/pod-businesses/imon-pod-store."
      ],
      updatedAt: nowIso()
    });
  }

  private toSummaryMarkdown(payload: {
    plan: PodAutomationPlan;
    designQueue: DesignQueueItem[];
    collections: CollectionDraft[];
    listingDrafts: ListingDraft[];
    launchCalendar: LaunchCalendarEvent[];
    growthEngine: GrowthEngine;
    analyticsEngine: AnalyticsEngine;
    ownerChecklist: OwnerChecklist;
    autonomyReport: AutonomyReport;
    socialProfiles: SocialProfileRecord[];
    artifacts: PodAutonomyArtifacts;
  }): string {
    const firstLaunches = payload.listingDrafts
      .slice(0, 5)
      .map((draft) => `- ${draft.scheduledFor}: ${draft.productTitle} at $${draft.priceUsd}`);
    const postCounts = payload.growthEngine.scheduledPosts.reduce<Record<string, number>>((counts, post) => {
      counts[post.platform] = (counts[post.platform] ?? 0) + 1;
      return counts;
    }, {});

    return [
      `# ${payload.plan.businessName} Autonomy Summary`,
      "",
      `Generated at: ${payload.plan.generatedAt}`,
      `Launch status: ${payload.autonomyReport.launchStatus}`,
      `Roadblocks: ${payload.autonomyReport.blockerCount}`,
      "",
      "## Readiness",
      `- Product creation: ${payload.autonomyReport.readiness.productCreation}`,
      `- Listings: ${payload.autonomyReport.readiness.listings}`,
      `- Publishing: ${payload.autonomyReport.readiness.publishing}`,
      `- Social: ${payload.autonomyReport.readiness.social}`,
      `- Ads: ${payload.autonomyReport.readiness.ads}`,
      `- Analytics: ${payload.autonomyReport.readiness.analytics}`,
      `- Revenue: ${payload.autonomyReport.readiness.revenue}`,
      "",
      "## Autonomous Now",
      ...payload.autonomyReport.autonomousNow.map((item) => `- ${item}`),
      "",
      "## Storefront Engine",
      `- Starter designs: ${payload.designQueue.length}`,
      `- Listing drafts: ${payload.listingDrafts.length}`,
      `- Collections: ${payload.collections.length}`,
      ...firstLaunches,
      "",
      "## Growth Engine",
      ...payload.socialProfiles.map(
        (profile) =>
          `- ${profile.platform}: ${profile.status}${profile.handle ? ` (${profile.handle})` : ""}`
      ),
      ...Object.entries(postCounts).map(([platform, count]) => `- Scheduled ${platform} posts: ${count}`),
      `- Email flows: ${payload.growthEngine.emailFlows.length}`,
      `- Ad readiness: ${payload.growthEngine.adPlan.readiness.status} (${payload.growthEngine.adPlan.readiness.reason})`,
      "",
      "## Analytics And Revenue",
      `- Verified transactions: ${payload.analyticsEngine.revenuePlan.snapshot.dataQuality.verifiedTransactions}`,
      `- Verified net revenue: $${payload.analyticsEngine.revenuePlan.snapshot.dataQuality.verifiedNetRevenue.toFixed(2)}`,
      `- Growth reinvestment available: $${payload.analyticsEngine.revenuePlan.snapshot.recommendations.growthReinvestment.toFixed(2)}`,
      ...payload.analyticsEngine.dataSources.map(
        (source) => `- ${source.name}: ${source.status} (${source.dependency})`
      ),
      "",
      "## Owner Checklist",
      ...payload.ownerChecklist.requiredActions.map(
        (action) => `- [${action.priority}] ${action.system}: ${action.summary}`
      ),
      ...payload.ownerChecklist.recommendedActions.map(
        (action) => `- [${action.priority}] ${action.system}: ${action.summary}`
      ),
      "",
      "## Artifacts",
      `- Autonomy JSON: ${payload.artifacts.autonomyJsonPath}`,
      `- Commerce JSON: ${payload.artifacts.commerceJsonPath}`,
      `- Growth JSON: ${payload.artifacts.growthJsonPath}`,
      `- Analytics JSON: ${payload.artifacts.analyticsJsonPath}`,
      `- Launch calendar JSON: ${payload.artifacts.launchCalendarJsonPath}`,
      `- Owner checklist: ${payload.artifacts.ownerChecklistMarkdownPath}`,
      ""
    ].join("\n");
  }

  private toOwnerChecklistMarkdown(checklist: OwnerChecklist): string {
    return [
      "# Imonic Owner Checklist",
      "",
      "## Required",
      ...checklist.requiredActions.flatMap((action) => [
        `### ${action.system} (${action.priority})`,
        `- ${action.summary}`,
        ...action.unblocks.map((item) => `- Unblocks: ${item}`),
        ""
      ]),
      "## Recommended",
      ...checklist.recommendedActions.flatMap((action) => [
        `### ${action.system} (${action.priority})`,
        `- ${action.summary}`,
        ...action.unblocks.map((item) => `- Unblocks: ${item}`),
        ""
      ])
    ].join("\n");
  }
}
