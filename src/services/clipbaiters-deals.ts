import path from "node:path";
import type { AppConfig } from "../config.js";
import type {
  ClipBaitersCreatorLead,
  ClipBaitersCreatorLeadState,
  ClipBaitersCreatorOffer,
  ClipBaitersCreatorOfferState,
  ClipBaitersCreatorOrderState,
  ClipBaitersCreatorOutreachDraft,
  ClipBaitersCreatorOutreachState,
  ClipBaitersDealsSnapshot,
  ClipBaitersSourceRecord
} from "../domain/clipbaiters.js";
import { ensureDir, readJsonFile, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { FileStore } from "../storage/store.js";
import { ClipBaitersIntakeService } from "./clipbaiters-intake.js";
import { ClipBaitersStudioService } from "./clipbaiters-studio.js";

const CLIPBAITERS_BUSINESS_ID = "clipbaiters-viral-moments";
const STREAMING_LANE_ID = "clipbaiters-streaming";
const DEFAULT_EVENT_PACK_ID = "clipbaiters-streaming-event-pack";

function nowIso(): string {
  return new Date().toISOString();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function extractHandle(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  const handleMatch = url.match(/@([^/?#]+)/i);
  if (handleMatch?.[1]) {
    return handleMatch[1];
  }
  const channelMatch = url.match(/\/channel\/([^/?#]+)/i);
  if (channelMatch?.[1]) {
    return channelMatch[1];
  }
  return undefined;
}

function statusRank(status: ClipBaitersCreatorLead["status"]): number {
  switch (status) {
    case "active":
      return 7;
    case "paid":
      return 6;
    case "quoted":
      return 5;
    case "interested":
      return 4;
    case "contacted":
      return 3;
    case "paused":
      return 2;
    case "closed_lost":
      return 1;
    default:
      return 0;
  }
}

function sortLeads(leads: ClipBaitersCreatorLead[]): ClipBaitersCreatorLead[] {
  return [...leads].sort((left, right) => left.creatorName.localeCompare(right.creatorName));
}

function sortDrafts(drafts: ClipBaitersCreatorOutreachDraft[]): ClipBaitersCreatorOutreachDraft[] {
  return [...drafts].sort((left, right) => left.creatorName.localeCompare(right.creatorName));
}

export class ClipBaitersDealsService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {}

  async sourceCreators(options?: {
    businessId?: string;
  }): Promise<{
    leadState: ClipBaitersCreatorLeadState;
    ordersState: ClipBaitersCreatorOrderState;
    artifacts: {
      creatorLeadsPath: string;
      creatorOrdersPath: string;
    };
  }> {
    const businessId = options?.businessId ?? CLIPBAITERS_BUSINESS_ID;
    const business = await this.store.getManagedBusiness(businessId);
    if (!business) {
      throw new Error(`Managed business ${businessId} was not found.`);
    }

    const studio = new ClipBaitersStudioService(this.config, this.store);
    const { plan } = await studio.writePlan({ businessId });
    const stateDirectory = path.join(this.config.stateDir, "clipbaiters", businessId);
    const creatorLeadsPath = path.join(stateDirectory, "creator-leads.json");
    await ensureDir(stateDirectory);

    const intake = new ClipBaitersIntakeService(this.config, this.store);
    const intakeResult = await intake.sync({ businessId });
    const existing = await readJsonFile<ClipBaitersCreatorLeadState>(creatorLeadsPath, {
      businessId,
      generatedAt: nowIso(),
      leads: []
    });

    const sourceLeads = plan.sourceRegistry.sources
      .filter((source) => source.laneId === STREAMING_LANE_ID)
      .filter(
        (source) =>
          source.sourceType === "creator_authorized_channel" ||
          source.sourceType === "manual_creator_brief"
      )
      .map((source) => this.toLeadFromSource(businessId, source));
    const orderLeads = intakeResult.ordersState.orders.map((order) => this.toLeadFromOrder(order));

    const merged = new Map(existing.leads.map((lead) => [lead.id, lead] as const));
    for (const lead of [...sourceLeads, ...orderLeads]) {
      const current = merged.get(lead.id);
      merged.set(lead.id, current ? this.mergeLead(current, lead) : lead);
    }

    const leadState: ClipBaitersCreatorLeadState = {
      businessId,
      generatedAt: nowIso(),
      leads: sortLeads(Array.from(merged.values()))
    };
    await writeJsonFile(creatorLeadsPath, leadState);

    return {
      leadState,
      ordersState: intakeResult.ordersState,
      artifacts: {
        creatorLeadsPath,
        creatorOrdersPath: intakeResult.artifacts.creatorOrdersPath
      }
    };
  }

  async draftCreatorOutreach(options?: {
    businessId?: string;
  }): Promise<{
    leadState: ClipBaitersCreatorLeadState;
    outreachState: ClipBaitersCreatorOutreachState;
    artifacts: {
      creatorLeadsPath: string;
      creatorOutreachPath: string;
    };
  }> {
    const businessId = options?.businessId ?? CLIPBAITERS_BUSINESS_ID;
    const sourced = await this.sourceCreators({ businessId });
    const stateDirectory = path.join(this.config.stateDir, "clipbaiters", businessId);
    const creatorOutreachPath = path.join(stateDirectory, "creator-outreach.json");
    const creatorOffersPath = path.join(stateDirectory, "creator-offers.json");
    await ensureDir(stateDirectory);

    const existing = await readJsonFile<ClipBaitersCreatorOutreachState>(creatorOutreachPath, {
      businessId,
      generatedAt: nowIso(),
      drafts: []
    });
    const offersState = await readJsonFile<ClipBaitersCreatorOfferState>(creatorOffersPath, {
      businessId,
      generatedAt: nowIso(),
      offers: []
    });

    const merged = new Map(existing.drafts.map((draft) => [draft.id, draft] as const));
    for (const lead of sourced.leadState.leads.filter((candidate) =>
      ["prospect", "interested", "quoted", "paid", "active"].includes(candidate.status)
    )) {
      const recommendedOffer = this.recommendedOfferForLead(lead, offersState.offers);
      const draft = this.toOutreachDraft(lead, recommendedOffer);
      const current = merged.get(draft.id);
      merged.set(draft.id, current ? { ...current, ...draft, updatedAt: nowIso() } : draft);
    }

    const outreachState: ClipBaitersCreatorOutreachState = {
      businessId,
      generatedAt: nowIso(),
      drafts: sortDrafts(Array.from(merged.values()))
    };
    await writeJsonFile(creatorOutreachPath, outreachState);

    return {
      leadState: sourced.leadState,
      outreachState,
      artifacts: {
        creatorLeadsPath: sourced.artifacts.creatorLeadsPath,
        creatorOutreachPath
      }
    };
  }

  async report(options?: {
    businessId?: string;
  }): Promise<{
    snapshot: ClipBaitersDealsSnapshot;
    leadState: ClipBaitersCreatorLeadState;
    outreachState: ClipBaitersCreatorOutreachState;
    ordersState: ClipBaitersCreatorOrderState;
    artifacts: {
      creatorLeadsPath: string;
      creatorOutreachPath: string;
      creatorDealsReportPath: string;
      creatorOrdersPath: string;
      intakeDirectory: string;
    };
  }> {
    const businessId = options?.businessId ?? CLIPBAITERS_BUSINESS_ID;
    const business = await this.store.getManagedBusiness(businessId);
    if (!business) {
      throw new Error(`Managed business ${businessId} was not found.`);
    }

    const sourced = await this.sourceCreators({ businessId });
    const drafted = await this.draftCreatorOutreach({ businessId });
    const intake = new ClipBaitersIntakeService(this.config, this.store);
    let intakeResult = await intake.sync({ businessId });
    const generatedManifestPaths = await this.materializeAcceptedLeadOrders({
      businessId,
      leadState: sourced.leadState,
      ordersState: intakeResult.ordersState,
      intakeDirectory: intakeResult.artifacts.intakeDirectory
    });
    if (generatedManifestPaths.length > 0) {
      intakeResult = await intake.sync({ businessId });
    }

    const streamingLaneName =
      intakeResult.ordersState.orders[0]?.laneName ?? "ClipBaitersStreaming";
    const prospectCount = sourced.leadState.leads.filter((lead) => lead.status === "prospect").length;
    const paidCount = sourced.leadState.leads.filter((lead) => lead.status === "paid").length;
    const activeCount = sourced.leadState.leads.filter((lead) => lead.status === "active").length;
    const stateDirectory = path.join(this.config.stateDir, "clipbaiters", businessId);
    const opsDirectory = path.join(this.config.opsDir, "clipbaiters", businessId);
    const creatorDealsReportPath = path.join(opsDirectory, "creator-deals.md");
    await Promise.all([ensureDir(stateDirectory), ensureDir(opsDirectory)]);

    const snapshot: ClipBaitersDealsSnapshot = {
      businessId,
      businessName: business.name,
      laneId: STREAMING_LANE_ID,
      laneName: streamingLaneName,
      generatedAt: nowIso(),
      leadCount: sourced.leadState.leads.length,
      outreachDraftCount: drafted.outreachState.drafts.length,
      activeCount,
      paidCount,
      prospectCount,
      summary:
        sourced.leadState.leads.length > 0
          ? `ClipBaiters creator deals now track ${sourced.leadState.leads.length} lead(s), ${drafted.outreachState.drafts.length} outreach draft(s), and ${intakeResult.ordersState.orders.length} creator order(s).`
          : "ClipBaiters creator deals do not have any leads yet.",
      nextStep:
        drafted.outreachState.drafts.length > 0
          ? "Review the outreach drafts, send the approved ones manually or through the shared Gmail path, then mark responding creators as interested or quoted."
          : "Add more approved creator-authorized streaming sources or paid orders so the deals loop has leads to work with.",
      artifactPaths: [
        sourced.artifacts.creatorLeadsPath,
        drafted.artifacts.creatorOutreachPath,
        intakeResult.artifacts.creatorOrdersPath,
        creatorDealsReportPath
      ]
    };

    await writeTextFile(
      creatorDealsReportPath,
      this.toReportMarkdown({
        snapshot,
        leadState: sourced.leadState,
        outreachState: drafted.outreachState,
        ordersState: intakeResult.ordersState,
        generatedManifestPaths
      })
    );

    return {
      snapshot,
      leadState: sourced.leadState,
      outreachState: drafted.outreachState,
      ordersState: intakeResult.ordersState,
      artifacts: {
        creatorLeadsPath: sourced.artifacts.creatorLeadsPath,
        creatorOutreachPath: drafted.artifacts.creatorOutreachPath,
        creatorDealsReportPath,
        creatorOrdersPath: intakeResult.artifacts.creatorOrdersPath,
        intakeDirectory: intakeResult.artifacts.intakeDirectory
      }
    };
  }

  private toLeadFromSource(businessId: string, source: ClipBaitersSourceRecord): ClipBaitersCreatorLead {
    return {
      id: slugify(source.name),
      businessId,
      laneId: STREAMING_LANE_ID,
      creatorName: source.name,
      creatorHandle: extractHandle(source.sourceUrl),
      sourceChannelUrl: source.sourceUrl,
      status: source.status === "active" ? "prospect" : "paused",
      notes: uniqueStrings([
        ...source.notes,
        "Seeded from the ClipBaiters streaming source registry."
      ]),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
  }

  private toLeadFromOrder(order: ClipBaitersCreatorOrderState["orders"][number]): ClipBaitersCreatorLead {
    const status: ClipBaitersCreatorLead["status"] =
      order.status === "delivered" || order.status === "in_delivery"
        ? "active"
        : order.paymentStatus === "paid"
          ? "paid"
          : order.status === "pending_payment"
            ? "quoted"
            : "prospect";

    return {
      id: slugify(order.creatorHandle ?? order.creatorName),
      businessId: order.businessId,
      laneId: order.laneId,
      creatorName: order.creatorName,
      creatorHandle: order.creatorHandle,
      contactEmail: order.contactEmail,
      sourceChannelUrl: order.sourceChannelUrl,
      status,
      offerId: order.offerId,
      quotedPriceUsd: order.quotedPriceUsd,
      lastStatusAt: order.updatedAt,
      notes: uniqueStrings([
        ...order.notes,
        `Backfilled from creator order ${order.id}.`
      ]),
      createdAt: order.createdAt,
      updatedAt: nowIso()
    };
  }

  private mergeLead(current: ClipBaitersCreatorLead, next: ClipBaitersCreatorLead): ClipBaitersCreatorLead {
    return {
      ...current,
      ...next,
      status: statusRank(next.status) >= statusRank(current.status) ? next.status : current.status,
      contactEmail: next.contactEmail ?? current.contactEmail,
      sourceChannelUrl: next.sourceChannelUrl ?? current.sourceChannelUrl,
      offerId: next.offerId ?? current.offerId,
      quotedPriceUsd: next.quotedPriceUsd ?? current.quotedPriceUsd,
      lastContactAt: next.lastContactAt ?? current.lastContactAt,
      lastStatusAt: next.lastStatusAt ?? current.lastStatusAt,
      notes: uniqueStrings([...(current.notes ?? []), ...(next.notes ?? [])]),
      createdAt: current.createdAt,
      updatedAt: nowIso()
    };
  }

  private recommendedOfferForLead(
    lead: ClipBaitersCreatorLead,
    offers: ClipBaitersCreatorOffer[]
  ): ClipBaitersCreatorOffer | undefined {
    const preferredOfferId = lead.offerId ?? DEFAULT_EVENT_PACK_ID;
    return offers.find((offer) => offer.id === preferredOfferId) ?? offers[0];
  }

  private toOutreachDraft(
    lead: ClipBaitersCreatorLead,
    offer: ClipBaitersCreatorOffer | undefined
  ): ClipBaitersCreatorOutreachDraft {
    const senderReady = Boolean(this.config.clipbaiters.sharedAliasEmail && lead.contactEmail);
    const status: ClipBaitersCreatorOutreachDraft["status"] = senderReady
      ? "ready_to_send"
      : "manual_send_required";
    const offerName = offer?.name ?? "ClipBaitersStreaming Event Pack";
    const priceText = offer ? `$${offer.priceUsd.toFixed(0)}` : "pricing on request";
    const bookingLine = this.config.clipbaiters.creatorBookingUrl
      ? `If you want to talk through a recurring setup, use ${this.config.clipbaiters.creatorBookingUrl}.`
      : "If the fit is good, we can turn this into a recurring setup after the first event pack.";

    return {
      id: slugify(`${lead.id}-outreach`),
      businessId: lead.businessId,
      leadId: lead.id,
      laneId: lead.laneId,
      creatorName: lead.creatorName,
      channel: senderReady ? "shared_gmail" : "manual",
      status,
      subject: `${lead.creatorName} x ClipBaitersStreaming clipping offer`,
      body: [
        `Hi ${lead.creatorName},`,
        "",
        "We run ClipBaitersStreaming for creator-authorized short-form clipping and post-stream recap packaging.",
        `The cleanest first package for your channel is ${offerName} at ${priceText}.`,
        lead.sourceChannelUrl ? `We are already tracking your public source channel at ${lead.sourceChannelUrl}.` : undefined,
        offer?.paymentLink ? `If you want to book it directly, use ${offer.paymentLink}.` : undefined,
        bookingLine,
        "",
        "The workflow stays creator-authorized, file-backed, and review-aware instead of scraping or blind reposting.",
        ""
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n"),
      toEmail: lead.contactEmail,
      offerId: offer?.id,
      paymentLink: offer?.paymentLink,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      notes: [
        senderReady
          ? `Shared ClipBaiters sender is configured as ${this.config.clipbaiters.sharedAliasEmail}.`
          : "Shared sender or creator email is missing, so this draft needs a manual send path.",
        offer?.paymentLink
          ? "A public payment link is available for the recommended offer."
          : "The recommended offer still needs a public payment link before the draft can become a clean quote."
      ]
    };
  }

  private async materializeAcceptedLeadOrders(payload: {
    businessId: string;
    leadState: ClipBaitersCreatorLeadState;
    ordersState: ClipBaitersCreatorOrderState;
    intakeDirectory: string;
  }): Promise<string[]> {
    await ensureDir(payload.intakeDirectory);
    const existingOrderIds = new Set(
      payload.ordersState.orders.map((order) => slugify(order.creatorHandle ?? order.creatorName))
    );
    const generatedPaths: string[] = [];

    for (const lead of payload.leadState.leads.filter((candidate) =>
      ["paid", "active"].includes(candidate.status)
    )) {
      if (existingOrderIds.has(slugify(lead.creatorHandle ?? lead.creatorName))) {
        continue;
      }
      const manifestPath = path.join(payload.intakeDirectory, `${lead.id}.json`);
      await writeJsonFile(manifestPath, {
        creatorName: lead.creatorName,
        creatorHandle: lead.creatorHandle,
        contactEmail: lead.contactEmail,
        offerId: lead.offerId ?? DEFAULT_EVENT_PACK_ID,
        quotedPriceUsd: lead.quotedPriceUsd ?? 450,
        paymentStatus: "paid",
        status: lead.status === "active" ? "in_delivery" : "paid",
        creatorAuthorizationConfirmed: true,
        sourceChannelUrl: lead.sourceChannelUrl,
        requestedDeliverables: ["3 short clips", "caption-ready exports", "delivery note"],
        notes: [
          "Generated automatically from a paid or active creator lead in ClipBaiters deals.",
          ...(lead.notes ?? [])
        ],
        createdAt: nowIso()
      });
      generatedPaths.push(manifestPath);
    }

    return generatedPaths;
  }

  private toReportMarkdown(payload: {
    snapshot: ClipBaitersDealsSnapshot;
    leadState: ClipBaitersCreatorLeadState;
    outreachState: ClipBaitersCreatorOutreachState;
    ordersState: ClipBaitersCreatorOrderState;
    generatedManifestPaths: string[];
  }): string {
    return [
      "# ClipBaiters Creator Deals",
      "",
      `Generated at: ${payload.snapshot.generatedAt}`,
      `Lane: ${payload.snapshot.laneName}`,
      `Leads: ${payload.snapshot.leadCount}`,
      `Outreach drafts: ${payload.snapshot.outreachDraftCount}`,
      `Paid leads: ${payload.snapshot.paidCount}`,
      `Active leads: ${payload.snapshot.activeCount}`,
      "",
      "## Lead Pipeline",
      ...payload.leadState.leads.map((lead) =>
        `- ${lead.creatorName}: ${lead.status}${lead.contactEmail ? ` (${lead.contactEmail})` : ""}`
      ),
      "",
      "## Outreach Drafts",
      ...(payload.outreachState.drafts.length > 0
        ? payload.outreachState.drafts.map((draft) => `- ${draft.creatorName}: ${draft.status}`)
        : ["- No outreach drafts are available yet."]),
      "",
      "## Creator Orders",
      ...(payload.ordersState.orders.length > 0
        ? payload.ordersState.orders.map((order) => `- ${order.creatorName}: ${order.status}`)
        : ["- No creator orders are synced yet."]),
      "",
      "## Generated Intake Manifests",
      ...(payload.generatedManifestPaths.length > 0
        ? payload.generatedManifestPaths.map((manifestPath) => `- ${manifestPath}`)
        : ["- No new intake manifests were generated from paid or active leads."]),
      "",
      "## Next Step",
      `- ${payload.snapshot.nextStep}`,
      ""
    ].join("\n");
  }
}