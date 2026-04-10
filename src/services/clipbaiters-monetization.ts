import path from "node:path";
import type { AppConfig } from "../config.js";
import type { ApprovalTask } from "../domain/contracts.js";
import type {
  ClipBaitersCreatorOffer,
  ClipBaitersCreatorOfferState,
  ClipBaitersCreatorOrder,
  ClipBaitersCreatorOrderState,
  ClipBaitersMonetizationSnapshot,
  ClipBaitersRevenueOfferBreakdown,
  ClipBaitersRevenueSnapshot,
  ClipBaitersRevenueSnapshotState
} from "../domain/clipbaiters.js";
import type { OrchestratorAgent } from "../agents/orchestrator.js";
import { ensureDir, readJsonFile, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { FileStore } from "../storage/store.js";
import { ClipBaitersIntakeService } from "./clipbaiters-intake.js";
import { ClipBaitersStudioService } from "./clipbaiters-studio.js";

const CLIPBAITERS_BUSINESS_ID = "clipbaiters-viral-moments";
const REVENUE_LANE_ID = "clipbaiters-streaming";

function nowIso(): string {
  return new Date().toISOString();
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function sortOffers(offers: ClipBaitersCreatorOffer[]): ClipBaitersCreatorOffer[] {
  return [...offers].sort((left, right) => left.name.localeCompare(right.name));
}

function sortApprovals(tasks: ApprovalTask[]): ApprovalTask[] {
  return [...tasks].sort((left, right) => left.id.localeCompare(right.id));
}

export class ClipBaitersMonetizationService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore,
    private readonly orchestrator: OrchestratorAgent
  ) {}

  async run(options?: {
    businessId?: string;
  }): Promise<{
    snapshot: ClipBaitersMonetizationSnapshot;
    offersState: ClipBaitersCreatorOfferState;
    ordersState: ClipBaitersCreatorOrderState;
    revenueState: ClipBaitersRevenueSnapshotState;
    approvals: ApprovalTask[];
    artifacts: {
      creatorOffersPath: string;
      creatorOrdersPath: string;
      revenueSnapshotsPath: string;
      monetizationReportPath: string;
      intakeDirectory: string;
      intakeReadmePath: string;
    };
  }> {
    const businessId = options?.businessId ?? CLIPBAITERS_BUSINESS_ID;
    const business = await this.store.getManagedBusiness(businessId);
    if (!business) {
      throw new Error(`Managed business ${businessId} was not found.`);
    }

    const studio = new ClipBaitersStudioService(this.config, this.store);
    const { plan } = await studio.writePlan({ businessId });
    const lane = plan.laneRegistry.lanes.find((item) => item.id === REVENUE_LANE_ID);
    if (!lane) {
      throw new Error(`ClipBaiters revenue lane ${REVENUE_LANE_ID} was not found.`);
    }

    const stateDirectory = path.join(this.config.stateDir, "clipbaiters", businessId);
    const opsDirectory = path.join(this.config.opsDir, "clipbaiters", businessId);
    const creatorOffersPath = path.join(stateDirectory, "creator-offers.json");
    const revenueSnapshotsPath = path.join(stateDirectory, "revenue-snapshots.json");
    const monetizationReportPath = path.join(opsDirectory, "monetization-report.md");
    await Promise.all([ensureDir(stateDirectory), ensureDir(opsDirectory)]);

    const offersState = this.buildOfferState(businessId, lane.name);
    await writeJsonFile(creatorOffersPath, offersState);

    const intake = new ClipBaitersIntakeService(this.config, this.store);
    const intakeResult = await intake.sync({ businessId });

    await this.ensurePaymentLinkApprovals(offersState.offers);
    await this.ensureDeliveryApprovals(intakeResult.ordersState.orders);

    const approvals = await this.loadScopedApprovals(offersState.offers, intakeResult.ordersState.orders);
    const revenueSnapshot = this.buildRevenueSnapshot({
      businessId,
      laneName: lane.name,
      offers: offersState.offers,
      orders: intakeResult.ordersState.orders
    });
    const revenueState = await this.writeRevenueState(revenueSnapshotsPath, businessId, revenueSnapshot);

    const snapshot = this.toSnapshot({
      businessId,
      businessName: business.name,
      laneName: lane.name,
      offers: offersState.offers,
      orders: intakeResult.ordersState.orders,
      approvals,
      monetizationReportPath,
      creatorOffersPath,
      creatorOrdersPath: intakeResult.artifacts.creatorOrdersPath,
      revenueSnapshotsPath
    });

    await writeTextFile(
      monetizationReportPath,
      this.toMarkdown({
        snapshot,
        offers: offersState.offers,
        orders: intakeResult.ordersState.orders,
        approvals,
        revenueSnapshot,
        intakeDirectory: intakeResult.artifacts.intakeDirectory
      })
    );

    return {
      snapshot,
      offersState,
      ordersState: intakeResult.ordersState,
      revenueState,
      approvals,
      artifacts: {
        creatorOffersPath,
        creatorOrdersPath: intakeResult.artifacts.creatorOrdersPath,
        revenueSnapshotsPath,
        monetizationReportPath,
        intakeDirectory: intakeResult.artifacts.intakeDirectory,
        intakeReadmePath: intakeResult.artifacts.intakeReadmePath
      }
    };
  }

  private buildOfferState(businessId: string, laneName: string): ClipBaitersCreatorOfferState {
    const generatedAt = nowIso();
    const offers: ClipBaitersCreatorOffer[] = [
      {
        id: "clipbaiters-streaming-monthly-retainer",
        businessId,
        laneId: REVENUE_LANE_ID,
        laneName,
        name: "ClipBaitersStreaming Monthly Retainer",
        summary: "Recurring creator-authorized clipping for streamers who want consistent weekly output.",
        billingModel: "monthly",
        priceUsd: 1200,
        currency: "USD",
        deliveryWindowHours: 48,
        paymentLink: this.config.clipbaiters.paymentLinks.streamingRetainer,
        status: this.config.clipbaiters.paymentLinks.streamingRetainer ? "payment_link_ready" : "approval_required",
        deliverables: ["12 short clips per month", "event watchlist", "basic packaging notes"],
        notes: ["Primary recurring offer for the ClipBaitersStreaming revenue lane."],
        createdAt: generatedAt,
        updatedAt: generatedAt
      },
      {
        id: "clipbaiters-streaming-event-pack",
        businessId,
        laneId: REVENUE_LANE_ID,
        laneName,
        name: "ClipBaitersStreaming Event Pack",
        summary: "Fast-turn clipping for one creator-authorized live event, launch stream, or collab.",
        billingModel: "per_event",
        priceUsd: 450,
        currency: "USD",
        deliveryWindowHours: 24,
        paymentLink: this.config.clipbaiters.paymentLinks.eventPack,
        status: this.config.clipbaiters.paymentLinks.eventPack ? "payment_link_ready" : "approval_required",
        deliverables: ["3 short clips", "caption-ready exports", "delivery note"],
        notes: ["Default one-off offer for the creator-order intake flow."],
        createdAt: generatedAt,
        updatedAt: generatedAt
      },
      {
        id: "clipbaiters-streaming-rush-pack",
        businessId,
        laneId: REVENUE_LANE_ID,
        laneName,
        name: "ClipBaitersStreaming Rush Pack",
        summary: "Same-day rush add-on for creator-authorized moments that need fast turnaround.",
        billingModel: "one_time",
        priceUsd: 250,
        currency: "USD",
        deliveryWindowHours: 12,
        paymentLink: this.config.clipbaiters.paymentLinks.rushPack,
        status: this.config.clipbaiters.paymentLinks.rushPack ? "payment_link_ready" : "approval_required",
        deliverables: ["1 rush short clip", "same-day delivery", "priority queue"],
        notes: ["Use this for debate nights, launch streams, and other same-day creator needs."],
        createdAt: generatedAt,
        updatedAt: generatedAt
      }
    ];

    return {
      businessId,
      generatedAt,
      offers: sortOffers(offers)
    };
  }

  private async ensurePaymentLinkApprovals(offers: ClipBaitersCreatorOffer[]): Promise<void> {
    const accountOps = this.orchestrator.getAccountOps();

    for (const offer of offers) {
      const taskId = `approval-clipbaiters-payment-link-${offer.id}`;
      if (offer.paymentLink) {
        await accountOps.completeTask(taskId, `${offer.name} payment link is configured.`);
        continue;
      }

      await accountOps.createOrUpdateTask({
        id: taskId,
        type: "payment",
        actionNeeded: `Add ClipBaiters payment link for ${offer.name}`,
        reason: `${offer.name} cannot move from quoted offer to owner-sendable checkout until its payment link exists.`,
        ownerInstructions: `Create the payment link for ${offer.name} and save it to ${this.paymentLinkEnvKey(offer.id)}.`,
        relatedEntityType: "account",
        relatedEntityId: `clipbaiters-payment-link-${offer.id}`
      });
    }
  }

  private async ensureDeliveryApprovals(orders: ClipBaitersCreatorOrder[]): Promise<void> {
    const accountOps = this.orchestrator.getAccountOps();

    for (const order of orders) {
      const taskId = `approval-clipbaiters-delivery-${order.id}`;
      if (order.status === "delivered") {
        await accountOps.completeTask(
          taskId,
          `${order.creatorName} delivery is marked complete and revenue can stay counted as delivered.`
        );
        continue;
      }

      if (order.paymentStatus !== "paid" || order.status === "blocked") {
        continue;
      }

      await accountOps.createOrUpdateTask(
        {
          id: taskId,
          type: "manual",
          actionNeeded: `Review ClipBaiters delivery for ${order.creatorName}`,
          reason: `${order.creatorName} has a paid creator order that still needs delivery review before it is counted as fulfilled revenue.`,
          ownerInstructions: [
            `Review ${order.offerName} for ${order.creatorName}.`,
            `Confirm the deliverables listed in ${order.intakeSourcePath} were actually handed off.`,
            "Update the intake manifest with deliveredAt and any deliveryArtifacts once the delivery is complete.",
            "Mark the approval completed only after the manifest and the delivery proof match."
          ].join(" "),
          relatedEntityType: "workflow",
          relatedEntityId: order.id
        },
        {
          reopenCompleted: false
        }
      );
    }
  }

  private async loadScopedApprovals(
    offers: ClipBaitersCreatorOffer[],
    orders: ClipBaitersCreatorOrder[]
  ): Promise<ApprovalTask[]> {
    const paymentTaskIds = offers.map((offer) => `approval-clipbaiters-payment-link-${offer.id}`);
    const deliveryTaskIds = orders.map((order) => `approval-clipbaiters-delivery-${order.id}`);
    const ids = new Set([...paymentTaskIds, ...deliveryTaskIds]);
    const approvals = await this.store.getApprovals();
    return sortApprovals(approvals.filter((task) => ids.has(task.id)));
  }

  private buildRevenueSnapshot(payload: {
    businessId: string;
    laneName: string;
    offers: ClipBaitersCreatorOffer[];
    orders: ClipBaitersCreatorOrder[];
  }): ClipBaitersRevenueSnapshot {
    const offerBreakdown: ClipBaitersRevenueOfferBreakdown[] = payload.offers.map((offer) => {
      const orders = payload.orders.filter((order) => order.offerId === offer.id);
      const paidOrders = orders.filter((order) => order.paymentStatus === "paid");
      const deliveredOrders = orders.filter((order) => order.status === "delivered");
      return {
        offerId: offer.id,
        offerName: offer.name,
        orderCount: orders.length,
        paidOrderCount: paidOrders.length,
        deliveredOrderCount: deliveredOrders.length,
        bookedRevenueUsd: roundCurrency(orders.reduce((sum, order) => sum + order.quotedPriceUsd, 0)),
        paidRevenueUsd: roundCurrency(paidOrders.reduce((sum, order) => sum + order.quotedPriceUsd, 0)),
        deliveredRevenueUsd: roundCurrency(deliveredOrders.reduce((sum, order) => sum + order.quotedPriceUsd, 0))
      };
    });

    const orderCount = payload.orders.length;
    const paidOrders = payload.orders.filter((order) => order.paymentStatus === "paid");
    const deliveredOrders = payload.orders.filter((order) => order.status === "delivered");
    const bookedRevenueUsd = roundCurrency(offerBreakdown.reduce((sum, offer) => sum + offer.bookedRevenueUsd, 0));
    const paidRevenueUsd = roundCurrency(offerBreakdown.reduce((sum, offer) => sum + offer.paidRevenueUsd, 0));
    const deliveredRevenueUsd = roundCurrency(offerBreakdown.reduce((sum, offer) => sum + offer.deliveredRevenueUsd, 0));

    return {
      id: slugify(`${payload.businessId}-${nowIso()}-monetization`),
      businessId: payload.businessId,
      laneId: REVENUE_LANE_ID,
      laneName: payload.laneName,
      generatedAt: nowIso(),
      currency: "USD",
      orderCount,
      paidOrderCount: paidOrders.length,
      deliveredOrderCount: deliveredOrders.length,
      bookedRevenueUsd,
      paidRevenueUsd,
      deliveredRevenueUsd,
      pendingCollectionUsd: roundCurrency(Math.max(0, bookedRevenueUsd - paidRevenueUsd)),
      deliveryBacklogUsd: roundCurrency(Math.max(0, paidRevenueUsd - deliveredRevenueUsd)),
      offers: offerBreakdown,
      notes: [
        "Booked revenue includes every creator order manifest in state.",
        "Paid revenue includes only orders with paymentStatus=paid.",
        "Delivered revenue includes only paid orders marked delivered in the intake manifest."
      ]
    };
  }

  private async writeRevenueState(
    revenueSnapshotsPath: string,
    businessId: string,
    snapshot: ClipBaitersRevenueSnapshot
  ): Promise<ClipBaitersRevenueSnapshotState> {
    const existing = await readJsonFile<ClipBaitersRevenueSnapshotState>(revenueSnapshotsPath, {
      businessId,
      generatedAt: nowIso(),
      snapshots: []
    });
    const revenueState: ClipBaitersRevenueSnapshotState = {
      businessId,
      generatedAt: snapshot.generatedAt,
      snapshots: [...existing.snapshots, snapshot].slice(-20)
    };
    await writeJsonFile(revenueSnapshotsPath, revenueState);
    return revenueState;
  }

  private toSnapshot(payload: {
    businessId: string;
    businessName: string;
    laneName: string;
    offers: ClipBaitersCreatorOffer[];
    orders: ClipBaitersCreatorOrder[];
    approvals: ApprovalTask[];
    monetizationReportPath: string;
    creatorOffersPath: string;
    creatorOrdersPath: string;
    revenueSnapshotsPath: string;
  }): ClipBaitersMonetizationSnapshot {
    const missingPaymentLinks = payload.offers.filter((offer) => !offer.paymentLink).length;
    const blockedOrders = payload.orders.filter((order) => order.status === "blocked").length;
    const pendingDeliveryReview = payload.orders.filter(
      (order) => order.paymentStatus === "paid" && order.status !== "delivered" && order.status !== "blocked"
    ).length;
    const status =
      missingPaymentLinks > 0 || blockedOrders > 0
        ? "blocked"
        : pendingDeliveryReview > 0
          ? "review_gated"
          : "ready";

    return {
      businessId: payload.businessId,
      businessName: payload.businessName,
      laneId: REVENUE_LANE_ID,
      laneName: payload.laneName,
      generatedAt: nowIso(),
      status,
      offerCount: payload.offers.length,
      configuredPaymentLinks: payload.offers.filter((offer) => Boolean(offer.paymentLink)).length,
      orderCount: payload.orders.length,
      paidOrderCount: payload.orders.filter((order) => order.paymentStatus === "paid").length,
      deliveredOrderCount: payload.orders.filter((order) => order.status === "delivered").length,
      openApprovalCount: payload.approvals.filter((approval) => approval.status !== "completed").length,
      summary:
        status === "blocked"
          ? `${payload.businessName} monetization is blocked by missing payment links or blocked creator orders.`
          : status === "review_gated"
            ? `${payload.businessName} monetization is ready to sell, but paid creator work still needs delivery review.`
            : `${payload.businessName} monetization report is current and no open step-6 approvals remain.`,
      nextStep:
        status === "blocked"
          ? "Create the missing ClipBaiters payment links, fix any blocked creator orders, and rerun clipbaiters-monetization-report."
          : status === "review_gated"
            ? "Complete the delivery review approvals, then update the creator-order manifest with deliveredAt and deliveryArtifacts."
            : "Keep new creator-order manifests flowing into the intake folder and rerun the monetization report after each payment or delivery update.",
      artifactPaths: [
        payload.creatorOffersPath,
        payload.creatorOrdersPath,
        payload.revenueSnapshotsPath,
        payload.monetizationReportPath
      ]
    };
  }

  private toMarkdown(payload: {
    snapshot: ClipBaitersMonetizationSnapshot;
    offers: ClipBaitersCreatorOffer[];
    orders: ClipBaitersCreatorOrder[];
    approvals: ApprovalTask[];
    revenueSnapshot: ClipBaitersRevenueSnapshot;
    intakeDirectory: string;
  }): string {
    const stripeConfigured = Boolean(
      this.config.clipbaiters.finance.stripe.accountId ||
        this.config.clipbaiters.finance.stripe.publishableKey ||
        this.config.clipbaiters.finance.stripe.secretKey
    );
    const relayLabel = this.config.clipbaiters.finance.relay.checkingLabel;
    const relayLast4 = this.config.clipbaiters.finance.relay.checkingLast4;

    return [
      "# ClipBaiters Monetization Report",
      "",
      `Generated at: ${payload.snapshot.generatedAt}`,
      `Business: ${payload.snapshot.businessName}`,
      `Lane: ${payload.snapshot.laneName}`,
      `Status: ${payload.snapshot.status}`,
      `Creator order intake: ${payload.intakeDirectory}`,
      "",
      "## Offer Catalog",
      ...payload.offers.map((offer) =>
        [
          `### ${offer.name}`,
          `- Status: ${offer.status}`,
          `- Billing model: ${offer.billingModel}`,
          `- Price: $${offer.priceUsd.toFixed(2)} ${offer.currency}`,
          `- Delivery window: ${offer.deliveryWindowHours} hour(s)`,
          `- Payment link: ${offer.paymentLink ?? "Missing payment link"}`,
          ...offer.deliverables.map((item) => `- Deliverable: ${item}`),
          ...offer.notes.map((note) => `- Note: ${note}`),
          ""
        ].join("\n")
      ),
      "## Orders",
      ...(payload.orders.length > 0
        ? payload.orders.map((order) =>
            [
              `### ${order.id}`,
              `- Creator: ${order.creatorName}${order.creatorHandle ? ` (${order.creatorHandle})` : ""}`,
              `- Offer: ${order.offerName}`,
              `- Payment status: ${order.paymentStatus}`,
              `- Delivery status: ${order.status}`,
              `- Quoted price: $${order.quotedPriceUsd.toFixed(2)} ${order.currency}`,
              ...(order.scheduledAt ? [`- Scheduled at: ${order.scheduledAt}`] : []),
              ...(order.deliveredAt ? [`- Delivered at: ${order.deliveredAt}`] : []),
              ...(order.sourceChannelUrl ? [`- Source channel: ${order.sourceChannelUrl}`] : []),
              ...order.requestedDeliverables.map((item) => `- Requested: ${item}`),
              ...order.deliveryArtifacts.map((item) => `- Delivery artifact: ${item}`),
              ...order.notes.map((note) => `- Note: ${note}`),
              ""
            ].join("\n")
          )
        : ["- No creator orders are recorded yet.", ""]),
      "## Revenue Snapshot",
      `- Booked revenue: $${payload.revenueSnapshot.bookedRevenueUsd.toFixed(2)} ${payload.revenueSnapshot.currency}`,
      `- Paid revenue: $${payload.revenueSnapshot.paidRevenueUsd.toFixed(2)} ${payload.revenueSnapshot.currency}`,
      `- Delivered revenue: $${payload.revenueSnapshot.deliveredRevenueUsd.toFixed(2)} ${payload.revenueSnapshot.currency}`,
      `- Pending collection: $${payload.revenueSnapshot.pendingCollectionUsd.toFixed(2)} ${payload.revenueSnapshot.currency}`,
      `- Delivery backlog: $${payload.revenueSnapshot.deliveryBacklogUsd.toFixed(2)} ${payload.revenueSnapshot.currency}`,
      ...payload.revenueSnapshot.offers.map((offer) =>
        `- ${offer.offerName}: ${offer.orderCount} order(s), $${offer.bookedRevenueUsd.toFixed(2)} booked, $${offer.paidRevenueUsd.toFixed(2)} paid, $${offer.deliveredRevenueUsd.toFixed(2)} delivered`
      ),
      ...payload.revenueSnapshot.notes.map((note) => `- Note: ${note}`),
      "",
      "## Finance Planning",
      `- Shared Stripe planning metadata: ${stripeConfigured ? "recorded" : "not recorded"}`,
      `- Relay cashout route: ${relayLabel || relayLast4 ? `${relayLabel ?? "Relay checking"}${relayLast4 ? ` (••••${relayLast4})` : ""}` : "not recorded"}`,
      "- Note: Verified creator orders remain the source of truth for revenue. Bank-routing notes do not replace paid-order verification.",
      "",
      "## Approval Tasks",
      ...(payload.approvals.length > 0
        ? payload.approvals.map((approval) =>
            `- ${approval.id}: ${approval.status} · ${approval.actionNeeded}`
          )
        : ["- No ClipBaiters monetization approvals are currently recorded."]),
      "",
      "## Next Step",
      `- ${payload.snapshot.nextStep}`,
      ""
    ].join("\n");
  }

  private paymentLinkEnvKey(offerId: string): string {
    switch (offerId) {
      case "clipbaiters-streaming-monthly-retainer":
        return "CLIPBAITERS_STREAMING_PAYMENT_LINK_RETAINER";
      case "clipbaiters-streaming-rush-pack":
        return "CLIPBAITERS_STREAMING_PAYMENT_LINK_RUSH_PACK";
      default:
        return "CLIPBAITERS_STREAMING_PAYMENT_LINK_EVENT_PACK";
    }
  }
}