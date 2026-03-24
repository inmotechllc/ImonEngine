import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import type { AppConfig } from "../config.js";
import type { AssetPackRecord, DigitalAssetType } from "../domain/digital-assets.js";
import type { BusinessLedgerEntry } from "../domain/engine.js";
import type {
  CatalogGrowthPolicy,
  GrowthChannel,
  GrowthWorkItem,
  RevenueAllocationPolicy,
  RevenueAllocationSnapshot,
  SalesTransaction,
  SalesTransactionType
} from "../domain/store-ops.js";
import { writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { FileStore } from "../storage/store.js";

const DIGITAL_ASSET_STORE_ID = "imon-digital-asset-store";
const DEFAULT_CURRENCY = "USD";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type CsvRow = Record<string, string>;

function nowIso(): string {
  return new Date().toISOString();
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseCsv(content: string): CsvRow[] {
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true
  }) as CsvRow[];
}

function parseAmount(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const normalized = value
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .replace(/\(([^)]+)\)/g, "-$1")
    .trim();

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value: string | undefined, fallback = nowIso()): string {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  return parsed.toISOString();
}

function pickField(row: CsvRow, candidates: string[]): string | undefined {
  const normalizedEntries = Object.entries(row).map(([key, value]) => [normalize(key), value] as const);
  for (const candidate of candidates) {
    const match = normalizedEntries.find(([key]) => key === normalize(candidate));
    if (match && `${match[1]}`.trim().length > 0) {
      return match[1];
    }
  }
  return undefined;
}

function rangeStart(days: number): string {
  return new Date(Date.now() - days * MS_PER_DAY).toISOString();
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function channelForAssetType(assetType: DigitalAssetType): GrowthChannel[] {
  switch (assetType) {
    case "wallpaper_pack":
      return ["pinterest", "x"];
    case "texture_pack":
      return ["pinterest", "linkedin"];
    case "social_template_pack":
      return ["linkedin", "gumroad_update"];
    case "icon_pack":
    case "ui_kit":
      return ["linkedin", "x"];
  }
}

function assetChannelPriority(assetType: DigitalAssetType): number {
  switch (assetType) {
    case "social_template_pack":
      return 0;
    case "icon_pack":
      return 1;
    case "texture_pack":
      return 2;
    case "wallpaper_pack":
      return 3;
    case "ui_kit":
      return 4;
  }
}

function composeGrowthCaption(pack: AssetPackRecord, channel: GrowthChannel): string {
  const cta = channel === "gumroad_update" ? "Now live in the ImonEngine store." : "See the full pack on Gumroad.";
  return [
    pack.title,
    "",
    pack.shortDescription,
    "",
    cta,
    pack.productUrl ?? "Publish on Gumroad next"
  ].join("\n");
}

function chooseMarketingAsset(pack: AssetPackRecord, channel: GrowthChannel): string {
  const marketingRoot = path.join(path.dirname(path.dirname(pack.outputDir)), "marketing", pack.id);
  const preferredName = channel === "x" || channel === "gumroad_update" ? "teaser-landscape.png" : "teaser-square.png";
  const preferredPath = path.join(marketingRoot, preferredName);
  if (existsSync(preferredPath)) {
    return preferredPath;
  }

  const thumbnailPath = path.join(pack.outputDir, "covers", "thumbnail-square.png");
  if (channel !== "x" && channel !== "gumroad_update" && existsSync(thumbnailPath)) {
    return thumbnailPath;
  }

  const coversDir = path.join(pack.outputDir, "covers");
  if (existsSync(coversDir)) {
    const firstCover = readdirSync(coversDir)
      .filter((fileName) => /^cover-.*\.(png|jpe?g)$/i.test(fileName))
      .sort()[0];
    if (firstCover) {
      return path.join(coversDir, firstCover);
    }
  }

  return preferredPath;
}

function titleCandidate(brief: {
  niche: string;
  style: string;
  assetType: DigitalAssetType;
  audience: string;
}): string {
  const lead = brief.style.length > 0 ? brief.style.charAt(0).toUpperCase() + brief.style.slice(1) : "Curated";
  return `${lead} ${brief.niche}`.trim();
}

function buildGenericBrief(assetType: DigitalAssetType, index: number): {
  niche: string;
  assetType: DigitalAssetType;
  style: string;
  audience: string;
  packSize: number;
} {
  switch (assetType) {
    case "social_template_pack":
      return {
        niche: `Clean creator carousel templates volume ${index}`,
        assetType,
        style: "neutral editorial layouts with strong text hierarchy",
        audience: "solo creators and consultants",
        packSize: 24
      };
    case "icon_pack":
      return {
        niche: `Soft SaaS icon set volume ${index}`,
        assetType,
        style: "soft translucent system icons with muted contrast",
        audience: "indie builders and SaaS marketers",
        packSize: 72
      };
    case "texture_pack":
      return {
        niche: `Poster grain texture pack volume ${index}`,
        assetType,
        style: "matte fibers and soft print grain overlays",
        audience: "brand designers and creators",
        packSize: 28
      };
    case "wallpaper_pack":
      return {
        niche: `Low-noise desktop backgrounds volume ${index}`,
        assetType,
        style: "smoky neutral gradients with subtle geometry",
        audience: "operators, developers, and creator workspaces",
        packSize: 14
      };
    case "ui_kit":
      return {
        niche: `Minimal UI kit volume ${index}`,
        assetType,
        style: "restrained panels and utility-first dashboard patterns",
        audience: "indie builders and product designers",
        packSize: 18
      };
  }
}

export interface SalesImportResult {
  imported: number;
  ledgerEntriesCreated: number;
}

export class StoreOpsService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {}

  async ensureCatalogPolicy(businessId = DIGITAL_ASSET_STORE_ID): Promise<CatalogGrowthPolicy> {
    const policies = await this.store.getGrowthPolicies();
    const existing = policies.find((policy) => policy.businessId === businessId);
    const next: CatalogGrowthPolicy = {
      id: `${businessId}-catalog-policy`,
      businessId,
      maxNewPacksPer7Days: this.config.storeOps.catalog.maxNewPacksPer7Days,
      maxPublishedPacks: this.config.storeOps.catalog.maxPublishedPacks,
      maxSharePerAssetType: this.config.storeOps.catalog.maxSharePerAssetType,
      maxOpenPackQueue: this.config.storeOps.catalog.maxOpenPackQueue,
      minPublishedByType: {
        social_template_pack: 2,
        icon_pack: 2,
        texture_pack: 2,
        wallpaper_pack: 2
      },
      updatedAt: nowIso()
    };

    const merged = existing
      ? {
          ...existing,
          ...next,
          minPublishedByType: {
            ...existing.minPublishedByType,
            ...next.minPublishedByType
          }
        }
      : next;
    await this.store.saveGrowthPolicy(merged);
    return merged;
  }

  async ensureAllocationPolicy(businessId = DIGITAL_ASSET_STORE_ID): Promise<RevenueAllocationPolicy> {
    const policies = await this.store.getAllocationPolicies();
    const existing = policies.find((policy) => policy.businessId === businessId);
    const next: RevenueAllocationPolicy = {
      id: `${businessId}-allocation-policy`,
      businessId,
      taxReserveRate: this.config.storeOps.finance.taxReserveRate,
      reinvestmentRate: this.config.storeOps.finance.reinvestmentRate,
      toolsRate: this.config.storeOps.finance.toolsRate,
      refundBufferRate: this.config.storeOps.finance.refundBufferRate,
      profitHoldRate: this.config.storeOps.finance.profitHoldRate,
      cashoutThreshold: this.config.storeOps.finance.cashoutThreshold,
      updatedAt: nowIso()
    };
    const merged = existing ? { ...existing, ...next } : next;
    await this.store.saveAllocationPolicy(merged);
    return merged;
  }

  async getCatalogControlState(
    packs: AssetPackRecord[],
    policy?: CatalogGrowthPolicy
  ): Promise<{
    policy: CatalogGrowthPolicy;
    openQueueCount: number;
    publishedCount: number;
    publishedLast7Days: number;
    publishedByType: Partial<Record<DigitalAssetType, number>>;
    canSeedMore: boolean;
    reasons: string[];
  }> {
    const activePolicy = policy ?? (await this.ensureCatalogPolicy());
    const openQueueCount = packs.filter((pack) => pack.status !== "published").length;
    const published = packs.filter((pack) => pack.status === "published");
    const publishedCount = published.length;
    const last7Start = Date.now() - 7 * MS_PER_DAY;
    const publishedLast7Days = published.filter((pack) => {
      const stamp = pack.publishedAt ?? pack.updatedAt;
      return new Date(stamp).getTime() >= last7Start;
    }).length;

    const publishedByType = published.reduce<Partial<Record<DigitalAssetType, number>>>((accumulator, pack) => {
      accumulator[pack.assetType] = (accumulator[pack.assetType] ?? 0) + 1;
      return accumulator;
    }, {});

    const reasons: string[] = [];
    if (openQueueCount >= activePolicy.maxOpenPackQueue) {
      reasons.push(`Open pack queue is at ${openQueueCount}/${activePolicy.maxOpenPackQueue}.`);
    }
    if (publishedLast7Days >= activePolicy.maxNewPacksPer7Days) {
      reasons.push(
        `Published ${publishedLast7Days} pack(s) in the last 7 days, hitting the ${activePolicy.maxNewPacksPer7Days} pack cap.`
      );
    }
    if (publishedCount >= activePolicy.maxPublishedPacks) {
      reasons.push(`Catalog already has ${publishedCount}/${activePolicy.maxPublishedPacks} published packs.`);
    }

    return {
      policy: activePolicy,
      openQueueCount,
      publishedCount,
      publishedLast7Days,
      publishedByType,
      canSeedMore: reasons.length === 0,
      reasons
    };
  }

  selectNextAssetType(
    packs: AssetPackRecord[],
    policy: CatalogGrowthPolicy
  ): DigitalAssetType {
    const published = packs.filter((pack) => pack.status === "published");
    const publishedCount = Math.max(1, published.length);
    const counts = published.reduce<Record<DigitalAssetType, number>>(
      (accumulator, pack) => {
        accumulator[pack.assetType] += 1;
        return accumulator;
      },
      {
        wallpaper_pack: 0,
        icon_pack: 0,
        social_template_pack: 0,
        texture_pack: 0,
        ui_kit: 0
      }
    );

    const deficits = Object.entries(policy.minPublishedByType)
      .filter(([, minimum]) => typeof minimum === "number")
      .map(([assetType, minimum]) => ({
        assetType: assetType as DigitalAssetType,
        minimum: minimum as number,
        current: counts[assetType as DigitalAssetType] ?? 0
      }))
      .filter((item) => item.current < item.minimum)
      .sort((left, right) => left.current - right.current || assetChannelPriority(left.assetType) - assetChannelPriority(right.assetType));

    if (deficits.length > 0) {
      return deficits[0]!.assetType;
    }

    const viable = (Object.keys(counts) as DigitalAssetType[])
      .filter((assetType) => assetType !== "ui_kit")
      .map((assetType) => ({
        assetType,
        count: counts[assetType],
        share: counts[assetType] / publishedCount
      }))
      .sort((left, right) => left.share - right.share || left.count - right.count || assetChannelPriority(left.assetType) - assetChannelPriority(right.assetType));

    const underCap = viable.find((item) => item.share < policy.maxSharePerAssetType);
    return underCap?.assetType ?? viable[0]?.assetType ?? "wallpaper_pack";
  }

  nextBriefForCatalog(
    packs: AssetPackRecord[],
    policy: CatalogGrowthPolicy
  ): {
    niche: string;
    assetType: DigitalAssetType;
    style: string;
    audience: string;
    packSize: number;
  } {
    const nextType = this.selectNextAssetType(packs, policy);
    const seenTitles = new Set(packs.map((pack) => pack.title));
    const seenNiches = new Set(packs.map((pack) => pack.niche));
    let index = 1;
    while (index < 500) {
      const brief = buildGenericBrief(nextType, index);
      if (!seenNiches.has(brief.niche) && !seenTitles.has(titleCandidate(brief))) {
        return brief;
      }
      index += 1;
    }

    return buildGenericBrief(nextType, Date.now());
  }

  async refreshGrowthQueue(
    packs: AssetPackRecord[],
    businessId = DIGITAL_ASSET_STORE_ID
  ): Promise<GrowthWorkItem[]> {
    const published = packs
      .filter((pack) => pack.status === "published" && pack.productUrl)
      .sort((left, right) => assetChannelPriority(left.assetType) - assetChannelPriority(right.assetType));
    const existing = await this.store.getGrowthQueue();
    const existingById = new Map(existing.map((item) => [item.id, item]));
    const keep = existing.filter((item) => item.status === "posted");
    const queueDays = this.config.storeOps.growth.queueDays;
    const postsPerWeek = this.config.storeOps.growth.postsPerWeek;
    const start = new Date();
    start.setHours(9, 0, 0, 0);
    const planned: GrowthWorkItem[] = [];

    const channelSlots = published.flatMap((pack) =>
      channelForAssetType(pack.assetType).map((channel) => ({ pack, channel }))
    );

    const slotCount = Math.min(postsPerWeek, channelSlots.length);
    for (let index = 0; index < slotCount; index += 1) {
      const slot = channelSlots[index % channelSlots.length];
      if (!slot) {
        continue;
      }
      const scheduled = new Date(start.getTime() + index * Math.max(1, Math.floor((queueDays * MS_PER_DAY) / slotCount)));
      const item: GrowthWorkItem = {
        id: slugify(`${slot.pack.id}-${slot.channel}-${scheduled.toISOString()}`),
        businessId,
        packId: slot.pack.id,
        channel: slot.channel,
        title: `${slot.pack.title} on ${slot.channel}`,
        caption: composeGrowthCaption(slot.pack, slot.channel),
        assetPath: chooseMarketingAsset(slot.pack, slot.channel),
        destinationUrl: slot.pack.productUrl ?? "",
        scheduledFor: scheduled.toISOString(),
        status: existingById.get(slugify(`${slot.pack.id}-${slot.channel}-${scheduled.toISOString()}`))?.status ?? "planned",
        notes: [
          "Generated by the repo-controlled store ops service.",
          "Use the signed-in browser session before marking as posted."
        ],
        createdAt:
          existingById.get(slugify(`${slot.pack.id}-${slot.channel}-${scheduled.toISOString()}`))?.createdAt ?? nowIso(),
        updatedAt: existingById.get(slugify(`${slot.pack.id}-${slot.channel}-${scheduled.toISOString()}`))?.updatedAt ?? nowIso()
      };
      planned.push(item);
    }

    const nextQueue = [...keep, ...planned];
    await this.store.replaceGrowthQueue(nextQueue);
    return nextQueue;
  }

  async writeGrowthArtifacts(
    packs: AssetPackRecord[],
    queue: GrowthWorkItem[]
  ): Promise<{ jsonPath: string; markdownPath: string }> {
    const jsonPath = path.join(this.config.opsDir, "growth-queue.json");
    const markdownPath = path.join(this.config.opsDir, "growth-queue.md");
    await writeJsonFile(jsonPath, queue);

    const packMap = new Map(packs.map((pack) => [pack.id, pack]));
    const generatedAt = queue.map((item) => item.updatedAt).sort().at(-1) ?? nowIso();
    const markdown = [
      "# Growth Queue",
      "",
      `Generated at: ${generatedAt}`,
      "",
      ...queue
        .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor))
        .map((item) => {
          const pack = packMap.get(item.packId);
          return [
            `## ${item.title}`,
            `- Status: ${item.status}`,
            `- Scheduled for: ${item.scheduledFor}`,
            `- Pack: ${pack?.title ?? item.packId}`,
            `- Channel: ${item.channel}`,
            `- Asset: ${item.assetPath}`,
            `- Link: ${item.destinationUrl}`,
            "",
            "```text",
            item.caption,
            "```",
            ""
          ].join("\n");
        })
    ].join("\n");

    await writeTextFile(markdownPath, markdown);
    return { jsonPath, markdownPath };
  }

  async importGumroadSales(csvPath: string, packs: AssetPackRecord[]): Promise<SalesImportResult> {
    const rows = parseCsv(await import("node:fs/promises").then((fs) => fs.readFile(csvPath, "utf8")));
    const importedAt = nowIso();
    let imported = 0;
    let ledgerEntriesCreated = 0;

    for (const row of rows) {
      const orderId = pickField(row, ["order id", "sale id", "id"]) ?? slugify(JSON.stringify(row));
      const productName = pickField(row, ["product name", "product", "name"]) ?? "Unknown Gumroad product";
      const pack = this.matchPackByTitle(packs, productName);
      const grossAmount = parseAmount(
        pickField(row, ["sale price", "amount", "price", "gross", "total"])
      );
      const feeAmount = Math.abs(parseAmount(pickField(row, ["fee", "fees", "gumroad fee"])));
      const payoutAmount = parseAmount(pickField(row, ["creator earnings", "net", "payout", "earnings"]));
      const occurredAt = parseDate(pickField(row, ["purchase date", "date", "created at", "timestamp"]));
      const currency = (pickField(row, ["currency"]) ?? DEFAULT_CURRENCY).toUpperCase();
      const statusText = normalize(
        `${pickField(row, ["status", "purchase status", "refund status"]) ?? ""} ${pickField(row, ["type"]) ?? ""}`
      );
      const isRefund = statusText.includes("refund") || statusText.includes("chargeback") || grossAmount < 0;
      const type: SalesTransactionType = isRefund ? "refund" : "sale";
      const gross = Math.abs(grossAmount);
      const netAmount = isRefund ? -Math.abs(gross || payoutAmount) : payoutAmount || Math.max(0, gross - feeAmount);

      const transaction: SalesTransaction = {
        id: slugify(`gumroad-${orderId}-${type}`),
        businessId: pack?.businessId ?? DIGITAL_ASSET_STORE_ID,
        packId: pack?.id,
        source: "gumroad",
        externalId: orderId,
        type,
        grossAmount: gross,
        feeAmount,
        netAmount,
        currency,
        counterparty: pickField(row, ["email", "customer email", "buyer email"]) ?? "Gumroad customer",
        note: productName,
        occurredAt,
        importedAt,
        metadata: {
          productName
        }
      };

      await this.store.saveSalesTransaction(transaction);
      imported += 1;

      const ledgerEntry: BusinessLedgerEntry = {
        id: `${transaction.id}-ledger`,
        businessId: transaction.businessId ?? DIGITAL_ASSET_STORE_ID,
        type: type === "refund" ? "cost" : "revenue",
        amount: Math.abs(netAmount),
        currency,
        source: "gumroad",
        note: `${type}: ${productName}`,
        recordedAt: occurredAt
      };
      await this.store.saveRevenueLedgerEntry(ledgerEntry);
      ledgerEntriesCreated += 1;
    }

    return { imported, ledgerEntriesCreated };
  }

  async importRelayTransactions(csvPath: string, defaultBusinessId = DIGITAL_ASSET_STORE_ID): Promise<SalesImportResult> {
    const rows = parseCsv(await import("node:fs/promises").then((fs) => fs.readFile(csvPath, "utf8")));
    const importedAt = nowIso();
    let imported = 0;
    let ledgerEntriesCreated = 0;

    for (const row of rows) {
      const description = pickField(row, ["description", "merchant name", "merchant", "details", "name"]) ?? "Relay transaction";
      const amount = parseAmount(pickField(row, ["amount", "amount (usd)", "debit", "credit"]));
      const occurredAt = parseDate(pickField(row, ["posted date", "date", "transaction date", "created at"]));
      const currency = (pickField(row, ["currency"]) ?? DEFAULT_CURRENCY).toUpperCase();
      const normalizedDescription = normalize(description);
      const inferredType: SalesTransactionType =
        amount > 0
          ? normalizedDescription.includes("gumroad")
            ? "payout"
            : "deposit"
          : /(meta|facebook|instagram|pinterest|linkedin|tiktok|ads)/.test(normalizedDescription)
            ? "ad_spend"
            : /(openai|chatgpt|canva|figma|shopify|printify|printful|gumroad)/.test(normalizedDescription)
              ? "tool_cost"
              : /transfer|ach|wire/.test(normalizedDescription)
                ? "transfer"
                : "tool_cost";
      const businessId = normalizedDescription.includes("gumroad") ? DIGITAL_ASSET_STORE_ID : defaultBusinessId;

      const transaction: SalesTransaction = {
        id: slugify(`relay-${description}-${occurredAt}-${amount}`),
        businessId,
        source: "relay",
        type: inferredType,
        grossAmount: Math.abs(amount),
        feeAmount: 0,
        netAmount: amount,
        currency,
        counterparty: "Relay",
        note: description,
        occurredAt,
        importedAt,
        metadata: {
          account: pickField(row, ["account", "account name"]) ?? ""
        }
      };

      await this.store.saveSalesTransaction(transaction);
      imported += 1;

      if (transaction.businessId && transaction.type !== "transfer") {
        const ledgerEntry: BusinessLedgerEntry = {
          id: `${transaction.id}-ledger`,
          businessId: transaction.businessId,
          type: amount >= 0 ? "revenue" : "cost",
          amount: Math.abs(amount),
          currency,
          source: "relay",
          note: description,
          recordedAt: occurredAt
        };
        await this.store.saveRevenueLedgerEntry(ledgerEntry);
        ledgerEntriesCreated += 1;
      }
    }

    return { imported, ledgerEntriesCreated };
  }

  async buildRevenueSnapshot(
    businessId = DIGITAL_ASSET_STORE_ID,
    days = 30
  ): Promise<RevenueAllocationSnapshot> {
    const policy = await this.ensureAllocationPolicy(businessId);
    const transactions = (await this.store.getSalesTransactions()).filter((transaction) => {
      return (
        transaction.businessId === businessId &&
        new Date(transaction.occurredAt).getTime() >= new Date(rangeStart(days)).getTime()
      );
    });

    const saleTransactions = transactions.filter((transaction) => transaction.type === "sale");
    const refundTransactions = transactions.filter((transaction) => transaction.type === "refund");
    const relayTransactions = transactions.filter((transaction) => transaction.source === "relay");

    const grossRevenue = roundCurrency(saleTransactions.reduce((sum, item) => sum + item.grossAmount, 0));
    const fees = roundCurrency(saleTransactions.reduce((sum, item) => sum + item.feeAmount, 0));
    const refunds = roundCurrency(refundTransactions.reduce((sum, item) => sum + Math.abs(item.netAmount), 0));
    const netRevenue = roundCurrency(Math.max(0, grossRevenue - fees - refunds));
    const relayDeposits = roundCurrency(
      relayTransactions.filter((item) => item.netAmount > 0).reduce((sum, item) => sum + item.netAmount, 0)
    );
    const relaySpend = roundCurrency(
      relayTransactions.filter((item) => item.netAmount < 0).reduce((sum, item) => sum + Math.abs(item.netAmount), 0)
    );
    const unmatchedRelayTransactions = relayTransactions.filter((item) => !item.businessId).length;

    const latestSignal =
      transactions
        .map((transaction) => transaction.importedAt || transaction.occurredAt)
        .sort()
        .at(-1) ?? nowIso();
    const snapshot: RevenueAllocationSnapshot = {
      id: `${businessId}-revenue-${latestSignal.replaceAll(":", "-")}`,
      businessId,
      windowStart: rangeStart(days),
      windowEnd: nowIso(),
      saleCount: saleTransactions.length,
      refundCount: refundTransactions.length,
      grossRevenue,
      fees,
      refunds,
      netRevenue,
      relayDeposits,
      relaySpend,
      unmatchedRelayTransactions,
      recommendations: {
        taxReserve: roundCurrency(netRevenue * policy.taxReserveRate),
        reinvestment: roundCurrency(netRevenue * policy.reinvestmentRate),
        tools: roundCurrency(netRevenue * policy.toolsRate),
        refundBuffer: roundCurrency(netRevenue * policy.refundBufferRate),
        profitHold: roundCurrency(netRevenue * policy.profitHoldRate),
        ownerCashoutReady: netRevenue * policy.profitHoldRate >= policy.cashoutThreshold
      },
      generatedAt: latestSignal
    };

    await this.store.saveAllocationSnapshot(snapshot);
    return snapshot;
  }

  async writeRevenueArtifacts(snapshot: RevenueAllocationSnapshot, businessName: string): Promise<{
    jsonPath: string;
    markdownPath: string;
  }> {
    const jsonPath = path.join(this.config.opsDir, "revenue-report.json");
    const markdownPath = path.join(this.config.opsDir, "revenue-report.md");
    await writeJsonFile(jsonPath, snapshot);
    await writeTextFile(
      markdownPath,
      [
        `# Revenue Report: ${businessName}`,
        "",
        `Generated at: ${snapshot.generatedAt}`,
        `Window: ${snapshot.windowStart} -> ${snapshot.windowEnd}`,
        "",
        `- Gross revenue: $${snapshot.grossRevenue.toFixed(2)}`,
        `- Fees: $${snapshot.fees.toFixed(2)}`,
        `- Refunds: $${snapshot.refunds.toFixed(2)}`,
        `- Net revenue: $${snapshot.netRevenue.toFixed(2)}`,
        `- Relay deposits: $${snapshot.relayDeposits.toFixed(2)}`,
        `- Relay spend: $${snapshot.relaySpend.toFixed(2)}`,
        "",
        "## Recommended Allocation",
        `- Tax reserve: $${snapshot.recommendations.taxReserve.toFixed(2)}`,
        `- Reinvestment: $${snapshot.recommendations.reinvestment.toFixed(2)}`,
        `- Tools: $${snapshot.recommendations.tools.toFixed(2)}`,
        `- Refund buffer: $${snapshot.recommendations.refundBuffer.toFixed(2)}`,
        `- Profit hold: $${snapshot.recommendations.profitHold.toFixed(2)}`,
        `- Owner cashout ready: ${snapshot.recommendations.ownerCashoutReady ? "yes" : "no"}`
      ].join("\n")
    );
    return { jsonPath, markdownPath };
  }

  private matchPackByTitle(packs: AssetPackRecord[], title: string): AssetPackRecord | undefined {
    const normalizedTitle = normalize(title);
    return packs.find((pack) => normalize(pack.title) === normalizedTitle || normalizedTitle.includes(normalize(pack.title)));
  }
}
