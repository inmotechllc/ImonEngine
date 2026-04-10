import { readdir } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import type {
  ClipBaitersCreatorOffer,
  ClipBaitersCreatorOfferState,
  ClipBaitersCreatorOrder,
  ClipBaitersCreatorOrderIntakeManifest,
  ClipBaitersCreatorOrderPaymentStatus,
  ClipBaitersCreatorOrderState,
  ClipBaitersCreatorOrderStatus
} from "../domain/clipbaiters.js";
import { ensureDir, readJsonFile, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { FileStore } from "../storage/store.js";
import { ClipBaitersStudioService } from "./clipbaiters-studio.js";

const CLIPBAITERS_BUSINESS_ID = "clipbaiters-viral-moments";
const DEFAULT_REVENUE_LANE_ID = "clipbaiters-streaming";
const DEFAULT_OFFER_ID = "clipbaiters-streaming-event-pack";

const FALLBACK_OFFERS: ClipBaitersCreatorOffer[] = [
  {
    id: "clipbaiters-streaming-monthly-retainer",
    businessId: CLIPBAITERS_BUSINESS_ID,
    laneId: DEFAULT_REVENUE_LANE_ID,
    laneName: "ClipBaitersStreaming",
    name: "ClipBaitersStreaming Monthly Retainer",
    summary: "Recurring short-form clipping for creator-authorized streams and weekly content windows.",
    billingModel: "monthly",
    priceUsd: 1200,
    currency: "USD",
    deliveryWindowHours: 48,
    status: "approval_required",
    deliverables: ["12 short clips per month", "event watchlist", "basic title and packaging notes"],
    notes: ["Fallback offer metadata used only when creator-offers.json does not exist yet."],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  },
  {
    id: DEFAULT_OFFER_ID,
    businessId: CLIPBAITERS_BUSINESS_ID,
    laneId: DEFAULT_REVENUE_LANE_ID,
    laneName: "ClipBaitersStreaming",
    name: "ClipBaitersStreaming Event Pack",
    summary: "One event or stream clipping package for creator-authorized launches, collabs, or live moments.",
    billingModel: "per_event",
    priceUsd: 450,
    currency: "USD",
    deliveryWindowHours: 24,
    status: "approval_required",
    deliverables: ["3 short clips", "caption-ready exports", "delivery notes"],
    notes: ["Fallback offer metadata used only when creator-offers.json does not exist yet."],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  },
  {
    id: "clipbaiters-streaming-rush-pack",
    businessId: CLIPBAITERS_BUSINESS_ID,
    laneId: DEFAULT_REVENUE_LANE_ID,
    laneName: "ClipBaitersStreaming",
    name: "ClipBaitersStreaming Rush Pack",
    summary: "Priority turnaround add-on for creator-authorized clips that need same-day delivery.",
    billingModel: "one_time",
    priceUsd: 250,
    currency: "USD",
    deliveryWindowHours: 12,
    status: "approval_required",
    deliverables: ["1 priority short clip", "same-day turnaround", "delivery note"],
    notes: ["Fallback offer metadata used only when creator-offers.json does not exist yet."],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  }
];

function nowIso(): string {
  return new Date().toISOString();
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function normalizePaymentStatus(
  value: string | undefined,
  paidAt?: string
): ClipBaitersCreatorOrderPaymentStatus {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "paid" || Boolean(paidAt)) {
    return "paid";
  }
  return "pending";
}

function normalizeOrderStatus(
  value: string | undefined,
  paymentStatus: ClipBaitersCreatorOrderPaymentStatus,
  deliveredAt: string | undefined,
  creatorAuthorizationConfirmed: boolean
): ClipBaitersCreatorOrderStatus {
  if (!creatorAuthorizationConfirmed) {
    return "blocked";
  }

  const normalized = value?.trim().toLowerCase();
  if (deliveredAt || normalized === "delivered") {
    return "delivered";
  }
  if (normalized === "in_delivery") {
    return "in_delivery";
  }
  if (normalized === "blocked") {
    return "blocked";
  }
  if (paymentStatus === "paid") {
    return normalized === "paid" ? "paid" : "paid";
  }
  return "pending_payment";
}

function parseIso(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function parsePrice(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = Number(value.trim());
    if (Number.isFinite(normalized)) {
      return normalized;
    }
  }
  return fallback;
}

function orderNameFromOfferId(offerId: string): string {
  switch (offerId) {
    case "clipbaiters-streaming-monthly-retainer":
      return "ClipBaitersStreaming Monthly Retainer";
    case "clipbaiters-streaming-rush-pack":
      return "ClipBaitersStreaming Rush Pack";
    default:
      return "ClipBaitersStreaming Event Pack";
  }
}

function sortOrders(orders: ClipBaitersCreatorOrder[]): ClipBaitersCreatorOrder[] {
  return [...orders].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

export class ClipBaitersIntakeService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {}

  async sync(options?: {
    businessId?: string;
    manifestFile?: string;
  }): Promise<{
    ordersState: ClipBaitersCreatorOrderState;
    importedOrderCount: number;
    artifacts: {
      creatorOrdersPath: string;
      intakeDirectory: string;
      intakeReadmePath: string;
      manifestPaths: string[];
    };
  }> {
    const businessId = options?.businessId ?? CLIPBAITERS_BUSINESS_ID;
    const business = await this.store.getManagedBusiness(businessId);
    if (!business) {
      throw new Error(`Managed business ${businessId} was not found.`);
    }

    const studio = new ClipBaitersStudioService(this.config, this.store);
    const { plan } = await studio.writePlan({ businessId });
    const lane = plan.laneRegistry.lanes.find((item) => item.id === DEFAULT_REVENUE_LANE_ID);
    if (!lane) {
      throw new Error(`ClipBaiters revenue lane ${DEFAULT_REVENUE_LANE_ID} was not found.`);
    }

    const stateDirectory = path.join(this.config.stateDir, "clipbaiters", businessId);
    const creatorOrdersPath = path.join(stateDirectory, "creator-orders.json");
    const creatorOffersPath = path.join(stateDirectory, "creator-offers.json");
    const intakeDirectory = path.join(this.config.outputDir, "source-feeds", "clipbaiters", businessId, "creator-orders");
    const intakeReadmePath = path.join(intakeDirectory, "README.md");
    await Promise.all([ensureDir(stateDirectory), ensureDir(intakeDirectory)]);

    await writeTextFile(intakeReadmePath, this.intakeReadme());

    const existingState = await readJsonFile<ClipBaitersCreatorOrderState>(creatorOrdersPath, {
      businessId,
      generatedAt: nowIso(),
      intakeDirectory,
      intakeReadmePath,
      orders: []
    });
    const offersState = await readJsonFile<ClipBaitersCreatorOfferState | null>(creatorOffersPath, null);
    const offerMap = new Map(
      [...(offersState?.offers ?? FALLBACK_OFFERS)].map((offer) => [offer.id, offer] as const)
    );

    const manifestPaths = options?.manifestFile
      ? [path.resolve(options.manifestFile)]
      : await this.manifestPaths(intakeDirectory);
    const normalizedOrders = await Promise.all(
      manifestPaths.map((filePath) =>
        this.normalizeManifest(filePath, businessId, lane.name, offerMap, existingState.orders.find((order) => order.intakeSourcePath === filePath))
      )
    );

    const merged = new Map(existingState.orders.map((order) => [order.id, order] as const));
    for (const order of normalizedOrders) {
      merged.set(order.id, order);
    }

    const ordersState: ClipBaitersCreatorOrderState = {
      businessId,
      generatedAt: nowIso(),
      intakeDirectory,
      intakeReadmePath,
      orders: sortOrders(Array.from(merged.values()))
    };
    await writeJsonFile(creatorOrdersPath, ordersState);

    return {
      ordersState,
      importedOrderCount: normalizedOrders.length,
      artifacts: {
        creatorOrdersPath,
        intakeDirectory,
        intakeReadmePath,
        manifestPaths
      }
    };
  }

  private async manifestPaths(intakeDirectory: string): Promise<string[]> {
    const entries = await readdir(intakeDirectory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(intakeDirectory, entry.name))
      .sort((left, right) => left.localeCompare(right));
  }

  private async normalizeManifest(
    filePath: string,
    businessId: string,
    laneName: string,
    offerMap: Map<string, ClipBaitersCreatorOffer>,
    existing?: ClipBaitersCreatorOrder
  ): Promise<ClipBaitersCreatorOrder> {
    const manifest = await readJsonFile<ClipBaitersCreatorOrderIntakeManifest>(filePath, {} as ClipBaitersCreatorOrderIntakeManifest);
    if (!manifest.creatorName?.trim()) {
      throw new Error(`Creator order manifest ${filePath} is missing creatorName.`);
    }

    const offerId = manifest.offerId && offerMap.has(manifest.offerId) ? manifest.offerId : existing?.offerId ?? DEFAULT_OFFER_ID;
    const offer = offerMap.get(offerId);
    const paidAt = parseIso(manifest.paidAt) ?? existing?.paidAt;
    const deliveredAt = parseIso(manifest.deliveredAt) ?? existing?.deliveredAt;
    const creatorAuthorizationConfirmed = manifest.creatorAuthorizationConfirmed ?? existing?.creatorAuthorizationConfirmed ?? true;
    const paymentStatus = normalizePaymentStatus(
      typeof manifest.paymentStatus === "string" ? manifest.paymentStatus : undefined,
      paidAt
    );
    const status = normalizeOrderStatus(
      typeof manifest.status === "string" ? manifest.status : undefined,
      paymentStatus,
      deliveredAt,
      creatorAuthorizationConfirmed
    );
    const requestedDeliverables = asStringArray(manifest.requestedDeliverables);
    const deliveryArtifacts = asStringArray(manifest.deliveryArtifacts);
    const createdAt = parseIso(manifest.createdAt) ?? existing?.createdAt ?? nowIso();
    const id = manifest.id?.trim() || existing?.id || slugify(`${manifest.creatorName}-${path.basename(filePath, ".json")}`);

    return {
      id,
      businessId,
      laneId: manifest.laneId?.trim() || existing?.laneId || DEFAULT_REVENUE_LANE_ID,
      laneName,
      creatorName: manifest.creatorName.trim(),
      creatorHandle: manifest.creatorHandle?.trim() || existing?.creatorHandle,
      contactEmail: manifest.contactEmail?.trim() || existing?.contactEmail,
      offerId,
      offerName: offer?.name ?? existing?.offerName ?? orderNameFromOfferId(offerId),
      quotedPriceUsd: parsePrice(manifest.quotedPriceUsd, existing?.quotedPriceUsd ?? offer?.priceUsd ?? 0),
      currency: offer?.currency ?? existing?.currency ?? "USD",
      paymentStatus,
      status,
      paidAt,
      scheduledAt: parseIso(manifest.scheduledAt) ?? existing?.scheduledAt,
      deliveredAt,
      turnaroundHours: Math.max(1, Math.round(parsePrice(manifest.turnaroundHours, existing?.turnaroundHours ?? offer?.deliveryWindowHours ?? 24))),
      creatorAuthorizationConfirmed,
      sourceChannelUrl: manifest.sourceChannelUrl?.trim() || existing?.sourceChannelUrl,
      requestedDeliverables: requestedDeliverables.length > 0 ? requestedDeliverables : existing?.requestedDeliverables ?? offer?.deliverables ?? [],
      intakeSourcePath: filePath,
      deliveryArtifacts: deliveryArtifacts.length > 0 ? deliveryArtifacts : existing?.deliveryArtifacts ?? [],
      notes: [
        ...(existing?.notes ?? []),
        ...asStringArray(manifest.notes),
        creatorAuthorizationConfirmed
          ? "Creator authorization is treated as confirmed for this manual order manifest."
          : "Creator authorization is not confirmed; keep this order blocked until the manual intake is fixed."
      ].filter((note, index, array) => array.indexOf(note) === index),
      createdAt,
      updatedAt: nowIso()
    };
  }

  private intakeReadme(): string {
    return [
      "# ClipBaiters Creator Order Intake",
      "",
      "Drop one JSON file per creator-paid order into this folder.",
      "",
      "Example:",
      "",
      "```json",
      JSON.stringify(
        {
          id: "creator-launch-event",
          creatorName: "Creator Name",
          creatorHandle: "@creator",
          contactEmail: "creator@example.com",
          offerId: "clipbaiters-streaming-event-pack",
          quotedPriceUsd: 450,
          paymentStatus: "paid",
          creatorAuthorizationConfirmed: true,
          sourceChannelUrl: "https://youtube.com/@creator",
          requestedDeliverables: ["3 short clips from the live event"],
          scheduledAt: "2026-04-08T20:00:00.000Z",
          notes: ["Manual creator order manifest."],
          deliveryArtifacts: []
        },
        null,
        2
      ),
      "```",
      "",
      "Use deliveredAt and deliveryArtifacts when the order is complete so the monetization report can move revenue from backlog into delivered revenue.",
      ""
    ].join("\n");
  }
}