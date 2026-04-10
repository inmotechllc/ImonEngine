import { unlink } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import type { ProspectImportRecord } from "../domain/contracts.js";
import type { BusinessRunStatus } from "../domain/engine.js";
import type { ResolvedNorthlineBusinessProfile, NorthlineTrade } from "../domain/northline.js";
import { ensureDir, readJsonFile, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify, splitTags, unique } from "../lib/text.js";
import { AIClient } from "../ai/client.js";
import { FileStore } from "../storage/store.js";
import {
  northlineBusinessOpsDir,
  northlineBusinessStateFilePath,
  resolveNorthlineBusinessProfile
} from "./northline-business-profile.js";

const NORTHLINE_BUSINESS_ID = "auto-funding-agency";
const STATE_FILE = "northlineProspectCollection.json";
const SUMMARY_JSON_FILE = "prospect-collection-summary.json";
const SUMMARY_MARKDOWN_FILE = "prospect-collection-summary.md";
const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_INTERPRETER_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
] as const;
const COLLECTION_HTTP_TIMEOUT_MS = 45_000;
const COLLECTION_WEB_RESEARCH_TIMEOUT_MS = 20_000;

type TradeKey = NorthlineTrade;

interface OverpassTradeFilter {
  key: string;
  value: string;
}

const OVERPASS_TRADE_FILTERS: Record<TradeKey, OverpassTradeFilter[]> = {
  plumbing: [{ key: "craft", value: "plumber" }],
  hvac: [{ key: "craft", value: "hvac" }],
  electrical: [{ key: "craft", value: "electrician" }],
  roofing: [{ key: "craft", value: "roofer" }],
  cleaning: [{ key: "craft", value: "cleaning" }]
};

const TRADE_ALIASES: Record<string, keyof typeof OVERPASS_TRADE_FILTERS> = {
  plumbing: "plumbing",
  plumber: "plumbing",
  hvac: "hvac",
  electrical: "electrical",
  electrician: "electrical",
  roofing: "roofing",
  roofer: "roofing",
  cleaning: "cleaning",
  cleaner: "cleaning"
};

type FetchLike = typeof fetch;

interface NorthlineProspectCollectorTimeouts {
  requestMs?: number;
  webResearchMs?: number;
}

interface CachedMarket {
  key: string;
  query: string;
  displayName: string;
  south: number;
  west: number;
  north: number;
  east: number;
  city?: string;
  state?: string;
  resolvedAt: string;
}

interface NorthlineProspectCollectionState {
  businessId: string;
  lastRunAt?: string;
  lastRunStatus?: BusinessRunStatus;
  cachedMarkets: CachedMarket[];
  managedSourceFiles: string[];
  updatedAt: string;
}

interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  state?: string;
  state_code?: string;
}

interface NominatimSearchResult {
  display_name: string;
  boundingbox: string[];
  address?: NominatimAddress;
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

interface WebSearchProspectRecord {
  businessName?: string;
  city?: string;
  state?: string;
  ownerName?: string;
  email?: string;
  phone?: string;
  website?: string;
  trade?: string;
  sourceType?: string;
  sourceUrl?: string;
  notes?: string;
  matchReason?: string;
}

interface MarketCollectionSummary {
  market: string;
  sourceFileName: string;
  resolvedFromCache: boolean;
  status: "collected" | "failed";
  records: number;
  summary: string;
}

export interface NorthlineProspectCollectionMarketResult extends MarketCollectionSummary {
  sourceFilePath: string;
}

export interface NorthlineProspectCollectionRunResult {
  status: BusinessRunStatus;
  summary: string;
  details: string[];
  businessId: string;
  sourceDir: string;
  collectionAreas: string[];
  trades: string[];
  targetIndustries: string[];
  targetServices: string[];
  collectedRecords: number;
  writtenFiles: number;
  marketResults: NorthlineProspectCollectionMarketResult[];
  artifacts: {
    statePath: string;
    summaryJsonPath: string;
    summaryMarkdownPath: string;
    sourceFilePaths: string[];
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function compact(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeMarketKey(value: string): string {
  return slugify(value);
}

function sourceFileNameForMarket(market: string): string {
  const slug = normalizeMarketKey(market);
  return `auto-osm-${slug || "market"}.json`;
}

function parseMarketParts(market: string): { city?: string; state?: string } {
  const parts = market
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return {
    city: parts[0],
    state: parts[1]
  };
}

function normalizePhone(value: string | undefined): string | undefined {
  const trimmed = compact(value);
  return trimmed ? trimmed.replace(/\s+/g, " ") : undefined;
}

function normalizeEmail(value: string | undefined): string | undefined {
  const trimmed = compact(value)?.toLowerCase();
  if (!trimmed || !trimmed.includes("@")) {
    return undefined;
  }
  return trimmed;
}

function normalizeWebsite(value: string | undefined): string | undefined {
  const trimmed = compact(value);
  if (!trimmed) {
    return undefined;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, "");
  }

  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
  }

  return undefined;
}

function splitPipe(value: string | undefined): string[] {
  return value
    ? value
        .split("|")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function joinPipeValues(...values: Array<string | undefined>): string | undefined {
  const entries = unique(values.flatMap((value) => splitPipe(value)));
  return entries.length > 0 ? entries.join("|") : undefined;
}

function websiteIdentity(value: string | undefined): string | undefined {
  const normalized = normalizeWebsite(value);
  if (!normalized) {
    return undefined;
  }

  return normalized
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function qualityScore(record: ProspectImportRecord): number {
  let score = 0;
  if (record.email) {
    score += 4;
  }
  if (record.phone) {
    score += 3;
  }
  if (record.website) {
    score += 3;
  }
  if (record.hasHttps === true) {
    score += 1;
  }
  return score;
}

function compareRecords(left: ProspectImportRecord, right: ProspectImportRecord): number {
  return (
    qualityScore(right) - qualityScore(left) ||
    left.businessName.localeCompare(right.businessName) ||
    left.city.localeCompare(right.city) ||
    left.state.localeCompare(right.state)
  );
}

function tagValue(tags: Record<string, string> | undefined, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = compact(tags?.[name]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

export class NorthlineProspectCollectorService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly ai?: AIClient,
    private readonly timeouts: NorthlineProspectCollectorTimeouts = {}
  ) {}

  private get requestTimeoutMs(): number {
    return this.timeouts.requestMs ?? COLLECTION_HTTP_TIMEOUT_MS;
  }

  private get webResearchTimeoutMs(): number {
    return this.timeouts.webResearchMs ?? COLLECTION_WEB_RESEARCH_TIMEOUT_MS;
  }

  async run(options?: {
    businessId?: string;
    force?: boolean;
  }): Promise<NorthlineProspectCollectionRunResult> {
    const businessId = options?.businessId ?? NORTHLINE_BUSINESS_ID;
    const businessProfile = await this.resolveBusinessProfile(businessId);
    const sourceDir = businessProfile.sourceDir;
    const collectionAreas = unique(businessProfile.collectionAreas.map((area) => area.trim())).filter(Boolean);
    const trades = this.resolveTrades(businessProfile.collectionTrades);
    const expectedSourceFiles = unique(collectionAreas.map((area) => sourceFileNameForMarket(area))).sort(
      (left, right) => left.localeCompare(right)
    );
    const artifacts = {
      statePath: this.statePath(businessId),
      summaryJsonPath: this.summaryJsonPath(businessId),
      summaryMarkdownPath: this.summaryMarkdownPath(businessId),
      sourceFilePaths: expectedSourceFiles.map((fileName) => path.join(sourceDir, fileName))
    };
    const state = await this.readState(businessId);
    await ensureDir(sourceDir);
    await this.deleteStaleManagedFiles(state.managedSourceFiles, expectedSourceFiles, sourceDir);

    if (collectionAreas.length === 0) {
      const nextState: NorthlineProspectCollectionState = {
        ...state,
        businessId,
        managedSourceFiles: expectedSourceFiles,
        updatedAt: nowIso()
      };
      await writeJsonFile(artifacts.statePath, nextState);
      return this.writeSummaryAndReturn(
        {
          status: "skipped",
          summary: "Northline prospect collection skipped because no collection areas are configured.",
          details: [
            "Set NORTHLINE_PRIMARY_SERVICE_AREA or NORTHLINE_PROSPECT_COLLECTION_AREAS to enable automated market collection."
          ],
          businessId,
          sourceDir,
          collectionAreas,
          trades: trades.map((trade) => trade),
          targetIndustries: businessProfile.targetIndustries,
          targetServices: businessProfile.targetServices,
          collectedRecords: 0,
          writtenFiles: 0,
          marketResults: [],
          artifacts
        },
        this.config.northlineProspecting.collectionIntervalHours
      );
    }

    if (trades.length === 0) {
      const nextState: NorthlineProspectCollectionState = {
        ...state,
        businessId,
        managedSourceFiles: expectedSourceFiles,
        updatedAt: nowIso()
      };
      await writeJsonFile(artifacts.statePath, nextState);
      return this.writeSummaryAndReturn(
        {
          status: "skipped",
          summary: "Northline prospect collection skipped because no supported trade filters are configured.",
          details: [
            "Set NORTHLINE_PROSPECT_COLLECTION_TRADES to one or more supported values: plumbing, hvac, electrical, roofing, cleaning."
          ],
          businessId,
          sourceDir,
          collectionAreas,
          trades: trades.map((trade) => trade),
          targetIndustries: businessProfile.targetIndustries,
          targetServices: businessProfile.targetServices,
          collectedRecords: 0,
          writtenFiles: 0,
          marketResults: [],
          artifacts
        },
        this.config.northlineProspecting.collectionIntervalHours
      );
    }

    if (this.shouldSkipInterval(state.lastRunAt, Boolean(options?.force))) {
      const nextState: NorthlineProspectCollectionState = {
        ...state,
        businessId,
        managedSourceFiles: expectedSourceFiles,
        updatedAt: nowIso()
      };
      await writeJsonFile(artifacts.statePath, nextState);
      return this.writeSummaryAndReturn(
        {
          status: "skipped",
          summary: `Northline prospect collection skipped because the ${this.config.northlineProspecting.collectionIntervalHours}-hour collection interval has not elapsed yet.`,
          details: state.lastRunAt
            ? [`Last collection run: ${state.lastRunAt}`]
            : ["No previous collection timestamp was recorded."],
          businessId,
          sourceDir,
          collectionAreas,
          trades: trades.map((trade) => trade),
          targetIndustries: businessProfile.targetIndustries,
          targetServices: businessProfile.targetServices,
          collectedRecords: 0,
          writtenFiles: 0,
          marketResults: [],
          artifacts
        },
        this.config.northlineProspecting.collectionIntervalHours
      );
    }

    const cachedMarkets = new Map(state.cachedMarkets.map((market) => [market.key, market]));
    const marketSummaries: MarketCollectionSummary[] = [];

    for (const market of collectionAreas) {
      const marketKey = normalizeMarketKey(market);
      const sourceFileName = sourceFileNameForMarket(market);
      const previous = cachedMarkets.get(marketKey);

      try {
        const resolvedMarket = previous ?? (await this.resolveMarket(market));
        cachedMarkets.set(marketKey, resolvedMarket);
        const records = await this.collectMarketRecords(resolvedMarket, trades, market, businessProfile);
        await this.writeMarketSourceFile(sourceDir, sourceFileName, market, trades, records, businessProfile);
        marketSummaries.push({
          market,
          sourceFileName,
          resolvedFromCache: previous !== undefined,
          status: "collected",
          records: records.length,
          summary: `Collected ${records.length} record(s) for ${market} into ${sourceFileName}.`
        });
      } catch (error) {
        await this.deleteMarketSourceFile(sourceDir, sourceFileName);
        marketSummaries.push({
          market,
          sourceFileName,
          resolvedFromCache: previous !== undefined,
          status: "failed",
          records: 0,
          summary:
            error instanceof Error
              ? `Failed to collect prospects for ${market}: ${error.message}`
              : `Failed to collect prospects for ${market}.`
        });
      }
    }

    const collectedRecords = marketSummaries.reduce((total, market) => total + market.records, 0);
    const failedMarkets = marketSummaries.filter((market) => market.status === "failed").length;
    const collectedMarkets = marketSummaries.filter((market) => market.status === "collected").length;
    const result: NorthlineProspectCollectionRunResult = {
      status: collectedMarkets > 0 || failedMarkets === 0 ? "success" : "failed",
      summary: this.buildSummary(marketSummaries, collectedRecords),
      details: marketSummaries.map((market) => market.summary),
      businessId,
      sourceDir,
      collectionAreas,
      trades: trades.map((trade) => trade),
      targetIndustries: businessProfile.targetIndustries,
      targetServices: businessProfile.targetServices,
      collectedRecords,
      writtenFiles: marketSummaries.filter((market) => market.status === "collected").length,
      marketResults: marketSummaries.map((market) => ({
        ...market,
        sourceFilePath: path.join(sourceDir, market.sourceFileName)
      })),
      artifacts
    };

    const nextState: NorthlineProspectCollectionState = {
      businessId,
      lastRunAt: result.status === "failed" ? state.lastRunAt : nowIso(),
      lastRunStatus: result.status,
      cachedMarkets: [...cachedMarkets.values()].sort((left, right) => left.key.localeCompare(right.key)),
      managedSourceFiles: expectedSourceFiles,
      updatedAt: nowIso()
    };
    await writeJsonFile(artifacts.statePath, nextState);

    return this.writeSummaryAndReturn(result, this.config.northlineProspecting.collectionIntervalHours);
  }

  private async collectMarketRecords(
    market: CachedMarket,
    trades: TradeKey[],
    marketLabel: string,
    businessProfile: ResolvedNorthlineBusinessProfile
  ): Promise<ProspectImportRecord[]> {
    const perTrade = new Map<TradeKey, ProspectImportRecord[]>();
    const errors: string[] = [];

    try {
      const response = await this.fetchOverpassResponse(market, trades);

      for (const element of response.elements ?? []) {
        const mapped = this.elementToProspect(element, trades, market, marketLabel, businessProfile);
        if (!mapped) {
          continue;
        }

        const bucket = perTrade.get(mapped.trade) ?? [];
        bucket.push(mapped.record);
        perTrade.set(mapped.trade, bucket);
      }
    } catch (error) {
      errors.push(
        error instanceof Error
          ? `OSM/Overpass collection failed for ${marketLabel}: ${error.message}`
          : `OSM/Overpass collection failed for ${marketLabel}.`
      );
    }

    const webSearchRecords = await this.collectWebSearchRecords(marketLabel, trades, businessProfile);
    for (const mapped of webSearchRecords) {
      const bucket = perTrade.get(mapped.trade) ?? [];
      bucket.push(mapped.record);
      perTrade.set(mapped.trade, bucket);
    }

    const selected: ProspectImportRecord[] = [];
    for (const trade of trades) {
      const bucket = this.dedupeRecords(perTrade.get(trade) ?? [])
        .sort(compareRecords)
        .slice(0, this.config.northlineProspecting.collectionMaxRecordsPerTrade);
      selected.push(...bucket);
    }

    const nextRecords = this.ensureUniqueBusinessNames(this.dedupeRecords(selected).sort(compareRecords));
    if (nextRecords.length === 0 && errors.length > 0) {
      throw new Error(errors.join(" "));
    }

    return nextRecords;
  }

  private async collectWebSearchRecords(
    marketLabel: string,
    trades: TradeKey[],
    businessProfile: ResolvedNorthlineBusinessProfile
  ): Promise<Array<{ trade: TradeKey; record: ProspectImportRecord }>> {
    const researchRoute = this.ai?.describeRoute({
      businessId: businessProfile.businessId,
      capability: "prospect-research",
      sharedRouteId: "research"
    });
    if (!researchRoute?.available) {
      return [];
    }

    const fallbackMarket = parseMarketParts(marketLabel);
    const limitPerTrade = Math.max(
      2,
      Math.min(5, Math.ceil(this.config.northlineProspecting.collectionMaxRecordsPerTrade / 2))
    );
    let result: Awaited<ReturnType<AIClient["researchText"]>>;

    try {
      result = await this.runWithTimeout(
        () =>
          this.ai!.researchText({
            prompt: [
              `Find up to ${limitPerTrade} current Northline prospect candidates per trade in ${marketLabel}.`,
              `Target trades: ${trades.join(", ")}.`,
              `Target industries: ${businessProfile.targetIndustries.join(", ")}.`,
              `Target services: ${businessProfile.targetServices.join(", ")}.`,
              `Offer summary: ${businessProfile.offerSummary}.`,
              "Prioritize free public sources: official business sites first, then public directory or profile pages such as Google Business/Maps landing pages, Yelp, BBB, chamber directories, and local directories.",
              "Return strict JSON only with shape {\"records\":[...]}",
              "Each record must include: businessName, trade, city, state, and any verified public email, phone, or website. Optional fields: ownerName, sourceType, sourceUrl, notes, matchReason.",
              "Use sourceType values such as official_site, google_business_profile, yelp, bbb, chamber_directory, local_directory, or social_profile.",
              "Do not invent contact data. Omit any business that does not show at least one public contact method. Prefer active and recent businesses."
            ].join("\n"),
            businessId: businessProfile.businessId,
            capability: "prospect-research",
            fallback: () => JSON.stringify({ records: [] })
          }),
        this.webResearchTimeoutMs,
        `Web research for ${marketLabel}`
      );
    } catch {
      return [];
    }

    const records = this.parseWebSearchRecords(result.text);
    return records.flatMap((candidate) => {
      const trade = TRADE_ALIASES[slugify(candidate.trade ?? "")];
      const businessName = compact(candidate.businessName);
      if (!trade || !trades.includes(trade) || !businessName) {
        return [];
      }

      const email = normalizeEmail(candidate.email);
      const phone = normalizePhone(candidate.phone);
      const website = normalizeWebsite(candidate.website);
      if (!email && !phone && !website) {
        return [];
      }

      const sourceLabel = compact(candidate.sourceType) ?? "public_web";
      const sourceTag = slugify(sourceLabel) || "public-web";
      const sourceUrl = compact(candidate.sourceUrl);
      const matchReasons = unique(
        [
          compact(candidate.matchReason),
          `${this.tradeLabel(trade)} matches the configured target lane`,
          `${marketLabel} is inside the configured service-area list`,
          `Offer fit: ${businessProfile.offerSummary}`
        ].filter((value): value is string => Boolean(value))
      ).join("|");

      return [
        {
          trade,
          record: {
            businessName,
            niche: "home services",
            city: compact(candidate.city) ?? fallbackMarket.city ?? "",
            state: compact(candidate.state) ?? fallbackMarket.state ?? "",
            ownerName: compact(candidate.ownerName),
            email,
            phone,
            website,
            hasWebsite: Boolean(website),
            hasHttps: Boolean(website?.toLowerCase().startsWith("https://")),
            pageSpeedBucket: "unknown",
            market: marketLabel,
            trade,
            collectionArea: marketLabel,
            sourceType: `northline-web-search:${sourceTag}`,
            targetIndustries: businessProfile.targetIndustries.join("|"),
            targetServices: businessProfile.targetServices.join("|"),
            offerSummary: businessProfile.offerSummary,
            matchReasons,
            notes: [
              `Web search source: ${this.tradeLabel(trade)} via ${marketLabel}`,
              sourceUrl ? `Source URL: ${sourceUrl}` : undefined,
              compact(candidate.notes),
              !email ? "No public email found in the reviewed web result." : undefined,
              !phone ? "No public phone found in the reviewed web result." : undefined,
              !website ? "No public website found in the reviewed web result." : undefined
            ]
              .filter((value): value is string => Boolean(value))
              .join("; "),
            tags: [trade, "web-search", sourceTag, normalizeMarketKey(marketLabel)].join("|")
          }
        }
      ];
    });
  }

  private parseWebSearchRecords(text: string): WebSearchProspectRecord[] {
    const candidates = unique(
      [
        text.trim(),
        text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim(),
        this.sliceJsonCandidate(text, "{", "}"),
        this.sliceJsonCandidate(text, "[", "]")
      ].filter((value): value is string => Boolean(value))
    );

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (value): value is WebSearchProspectRecord => typeof value === "object" && value !== null
          );
        }
        if (
          parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { records?: unknown }).records)
        ) {
          return (parsed as { records: unknown[] }).records.filter(
            (value): value is WebSearchProspectRecord => typeof value === "object" && value !== null
          );
        }
      } catch {
        // Keep trying alternate extracted candidates.
      }
    }

    return [];
  }

  private sliceJsonCandidate(text: string, startToken: string, endToken: string): string | undefined {
    const start = text.indexOf(startToken);
    const end = text.lastIndexOf(endToken);
    if (start === -1 || end <= start) {
      return undefined;
    }
    return text.slice(start, end + 1).trim();
  }

  private elementToProspect(
    element: OverpassElement,
    trades: TradeKey[],
    market: CachedMarket,
    marketLabel: string,
    businessProfile: ResolvedNorthlineBusinessProfile
  ): { trade: TradeKey; record: ProspectImportRecord } | undefined {
    const tags = element.tags;
    const trade = this.tradeFromTags(tags, trades);
    const businessName = compact(tags?.name);
    if (!trade || !businessName) {
      return undefined;
    }

    const rawWebsite = tagValue(tags, "contact:website", "website");
    const rawEmail = tagValue(tags, "contact:email", "email");
    const rawPhone = tagValue(tags, "contact:phone", "phone", "contact:mobile", "mobile");
    const website = normalizeWebsite(rawWebsite);
    const email = normalizeEmail(rawEmail);
    const phone = normalizePhone(rawPhone);
    if (!website && !email && !phone) {
      return undefined;
    }

    const fallbackMarket = parseMarketParts(marketLabel);
    const city =
      tagValue(tags, "addr:city", "addr:suburb", "addr:place") ??
      market.city ??
      fallbackMarket.city ??
      "";
    const state =
      tagValue(tags, "addr:state") ??
      market.state ??
      fallbackMarket.state ??
      "";
    const addressLine = this.addressLine(tags, city, state);
    const notes = [
      `OpenStreetMap source: ${this.tradeLabel(trade)} via ${marketLabel}`,
      addressLine ? `Address: ${addressLine}` : undefined,
      `OSM element: ${element.type}/${element.id}`,
      !email ? "No public email found in OSM tags." : undefined,
      !phone ? "No public phone found in OSM tags." : undefined,
      !website ? "No public website found in OSM tags." : undefined
    ]
      .filter((value): value is string => Boolean(value))
      .join("; ");

    return {
      trade,
      record: {
        businessName,
        niche: "home services",
        city,
        state,
        pipeline: "agency_client_acquisition",
        email,
        phone,
        website,
        hasWebsite: Boolean(website),
        hasHttps: Boolean(rawWebsite?.trim().toLowerCase().startsWith("https://")),
        pageSpeedBucket: "unknown",
        market: marketLabel,
        trade,
        collectionArea: marketLabel,
        sourceType: "northline-osm-overpass",
        targetIndustries: businessProfile.targetIndustries.join("|"),
        targetServices: businessProfile.targetServices.join("|"),
        offerSummary: businessProfile.offerSummary,
        matchReasons: [
          `${this.tradeLabel(trade)} matches the configured target lane`,
          `${marketLabel} is inside the configured service-area list`,
          `Offer fit: ${businessProfile.offerSummary}`
        ].join("|"),
        notes,
        tags: [trade, "osm", normalizeMarketKey(marketLabel)].join("|")
      }
    };
  }

  private tradeFromTags(
    tags: Record<string, string> | undefined,
    trades: TradeKey[]
  ): TradeKey | undefined {
    if (!tags) {
      return undefined;
    }

    return trades.find((trade) =>
      OVERPASS_TRADE_FILTERS[trade].some((filter) => tags[filter.key] === filter.value)
    );
  }

  private addressLine(tags: Record<string, string> | undefined, city: string, state: string): string | undefined {
    const street = tagValue(tags, "addr:street");
    const houseNumber = tagValue(tags, "addr:housenumber");
    const postcode = tagValue(tags, "addr:postcode");
    const parts = [
      [houseNumber, street].filter(Boolean).join(" "),
      [city, state].filter(Boolean).join(", "),
      postcode
    ].filter((value): value is string => Boolean(value));
    return parts.length > 0 ? parts.join(" ") : undefined;
  }

  private dedupeRecords(records: ProspectImportRecord[]): ProspectImportRecord[] {
    const merged = new Map<string, ProspectImportRecord>();

    for (const record of records) {
      const key = this.recordIdentity(record);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, record);
        continue;
      }

      merged.set(key, this.mergeRecords(existing, record));
    }

    return [...merged.values()];
  }

  private ensureUniqueBusinessNames(records: ProspectImportRecord[]): ProspectImportRecord[] {
    const totals = new Map<string, number>();
    for (const record of records) {
      totals.set(record.businessName, (totals.get(record.businessName) ?? 0) + 1);
    }

    const seen = new Map<string, number>();
    return records.map((record) => {
      if ((totals.get(record.businessName) ?? 0) <= 1) {
        return record;
      }

      const occurrence = (seen.get(record.businessName) ?? 0) + 1;
      seen.set(record.businessName, occurrence);
      const baseSuffix = [record.city, record.state].filter(Boolean).join(", ") || "Market";
      const suffix = occurrence === 1 ? baseSuffix : `${baseSuffix} ${occurrence}`;
      return {
        ...record,
        businessName: `${record.businessName} (${suffix})`
      };
    });
  }

  private recordIdentity(record: ProspectImportRecord): string {
    return (
      websiteIdentity(record.website) ??
      normalizePhone(record.phone)?.replace(/[^0-9+]/g, "") ??
      `${slugify(record.businessName)}:${slugify(record.city)}:${slugify(record.state)}`
    );
  }

  private mergeRecords(left: ProspectImportRecord, right: ProspectImportRecord): ProspectImportRecord {
    const notes = unique(
      [left.notes, right.notes]
        .flatMap((value) => (value ? value.split(/;\s*/) : []))
        .map((value) => value.trim())
        .filter(Boolean)
    );
    const tags = unique([...splitTags(left.tags), ...splitTags(right.tags)]);

    return {
      businessName: left.businessName,
      niche: left.niche,
      city: left.city || right.city,
      state: left.state || right.state,
      ownerName: left.ownerName ?? right.ownerName,
      email: left.email ?? right.email,
      phone: left.phone ?? right.phone,
      website: left.website ?? right.website,
      hasWebsite: Boolean(left.website ?? right.website),
      hasHttps: left.hasHttps === true || right.hasHttps === true,
      mobileFriendly: left.mobileFriendly === true || right.mobileFriendly === true ? true : undefined,
      clearOffer: left.clearOffer === true || right.clearOffer === true ? true : undefined,
      callsToAction: left.callsToAction === true || right.callsToAction === true ? true : undefined,
      pageSpeedBucket:
        left.pageSpeedBucket === "slow" ||
        left.pageSpeedBucket === "average" ||
        left.pageSpeedBucket === "fast"
          ? left.pageSpeedBucket
          : right.pageSpeedBucket,
      market: left.market ?? right.market,
      trade: left.trade ?? right.trade,
      collectionArea: left.collectionArea ?? right.collectionArea,
      pipeline: left.pipeline ?? right.pipeline,
      sourceType: left.sourceType ?? right.sourceType,
      targetIndustries: left.targetIndustries ?? right.targetIndustries,
      targetServices: left.targetServices ?? right.targetServices,
      offerSummary: left.offerSummary ?? right.offerSummary,
      matchReasons: joinPipeValues(left.matchReasons, right.matchReasons),
      notes: notes.join("; "),
      tags: tags.join("|")
    };
  }

  private async writeMarketSourceFile(
    sourceDir: string,
    sourceFileName: string,
    marketLabel: string,
    trades: TradeKey[],
    records: ProspectImportRecord[],
    businessProfile: ResolvedNorthlineBusinessProfile
  ): Promise<void> {
    const payload = {
      source: "northline-osm-overpass",
      businessId: businessProfile.businessId,
      pipeline: "agency_client_acquisition",
      market: marketLabel,
      trades: trades.map((trade) => trade),
      targetIndustries: businessProfile.targetIndustries,
      targetServices: businessProfile.targetServices,
      offerSummary: businessProfile.offerSummary,
      records
    };
    await writeTextFile(
      path.join(sourceDir, sourceFileName),
      `${JSON.stringify(payload, null, 2)}\n`
    );
  }

  private resolveTrades(values: string[]): TradeKey[] {
    return unique(
      values
        .map((value) => TRADE_ALIASES[slugify(value)])
        .filter((value): value is TradeKey => value !== undefined)
    );
  }

  private buildOverpassQuery(market: CachedMarket, trades: TradeKey[]): string {
    const filters = trades.flatMap((trade) => OVERPASS_TRADE_FILTERS[trade]);
    return [
      `[out:json][timeout:25][bbox:${market.south},${market.west},${market.north},${market.east}];`,
      "(",
      ...filters.map((filter) => `  nwr[\"${filter.key}\"=\"${filter.value}\"][\"name\"];`),
      ");",
      "out center tags;"
    ].join("\n");
  }

  private tradeLabel(trade: TradeKey): string {
    switch (trade) {
      case "hvac":
        return "HVAC";
      default:
        return trade.charAt(0).toUpperCase() + trade.slice(1);
    }
  }

  private async resolveMarket(market: string): Promise<CachedMarket> {
    const params = new URLSearchParams({
      q: market,
      format: "jsonv2",
      limit: "1",
      addressdetails: "1"
    });
    const results = await this.fetchJson<NominatimSearchResult[]>(`${NOMINATIM_SEARCH_URL}?${params.toString()}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": this.userAgent()
      }
    });
    const [match] = results;
    if (!match || match.boundingbox.length < 4) {
      throw new Error(`No Nominatim market match was found for ${market}.`);
    }

    const fallback = parseMarketParts(market);
    const city =
      match.address?.city ??
      match.address?.town ??
      match.address?.village ??
      match.address?.municipality ??
      fallback.city;
    const state = match.address?.state_code?.toUpperCase() ?? match.address?.state ?? fallback.state;

    return {
      key: normalizeMarketKey(market),
      query: market,
      displayName: match.display_name,
      south: Number(match.boundingbox[0]),
      north: Number(match.boundingbox[1]),
      west: Number(match.boundingbox[2]),
      east: Number(match.boundingbox[3]),
      city,
      state,
      resolvedAt: nowIso()
    };
  }

  private shouldSkipInterval(lastRunAt: string | undefined, force: boolean): boolean {
    if (force || !lastRunAt) {
      return false;
    }

    const elapsedMs = Date.now() - new Date(lastRunAt).getTime();
    return elapsedMs < this.config.northlineProspecting.collectionIntervalHours * 60 * 60 * 1000;
  }

  private async deleteStaleManagedFiles(previous: string[], next: string[], sourceDir: string): Promise<void> {
    const stale = previous.filter((fileName) => !next.includes(fileName));
    for (const fileName of stale) {
      try {
        await unlink(path.join(sourceDir, fileName));
      } catch {
        // Ignore stale-file cleanup failures when the file is already absent.
      }
    }
  }

  private async deleteMarketSourceFile(sourceDir: string, sourceFileName: string): Promise<void> {
    try {
      await unlink(path.join(sourceDir, sourceFileName));
    } catch {
      // Ignore failed-market cleanup when the file is already absent.
    }
  }

  private async fetchOverpassResponse(market: CachedMarket, trades: TradeKey[]): Promise<OverpassResponse> {
    const query = this.buildOverpassQuery(market, trades);
    const errors: string[] = [];

    for (const url of OVERPASS_INTERPRETER_URLS) {
      try {
        return await this.fetchJson<OverpassResponse>(url, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "text/plain;charset=UTF-8",
            "User-Agent": this.userAgent()
          },
          body: query
        });
      } catch (error) {
        errors.push(error instanceof Error ? `${url}: ${error.message}` : `${url}: request failed.`);
      }
    }

    throw new Error(errors.join(" | "));
  }

  private async fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        ...init,
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      if (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError") {
        throw new Error(`Request to ${url} timed out after ${this.requestTimeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private async runWithTimeout<T>(operation: () => Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      operation()
        .then((value) => {
          clearTimeout(timeoutHandle);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timeoutHandle);
          reject(error);
        });
    });
  }

  private async readState(businessId: string): Promise<NorthlineProspectCollectionState> {
    return readJsonFile<NorthlineProspectCollectionState>(this.statePath(businessId), {
      businessId,
      cachedMarkets: [],
      managedSourceFiles: [],
      updatedAt: nowIso()
    });
  }

  private async writeSummaryAndReturn(
    result: NorthlineProspectCollectionRunResult,
    intervalHours: number
  ): Promise<NorthlineProspectCollectionRunResult> {
    const attribution = this.sourceAttribution();
    await ensureDir(path.dirname(result.artifacts.summaryJsonPath));
    await writeJsonFile(result.artifacts.summaryJsonPath, {
      generatedAt: nowIso(),
      status: result.status,
      summary: result.summary,
      businessId: result.businessId,
      sourceDir: result.sourceDir,
      collectionAreas: result.collectionAreas,
      trades: result.trades,
      targetIndustries: result.targetIndustries,
      targetServices: result.targetServices,
      collectedRecords: result.collectedRecords,
      writtenFiles: result.writtenFiles,
      marketResults: result.marketResults,
      cadenceHours: intervalHours,
      attribution
    });
    await writeTextFile(result.artifacts.summaryMarkdownPath, this.summaryMarkdown(result, intervalHours));
    return result;
  }

  private summaryMarkdown(result: NorthlineProspectCollectionRunResult, intervalHours: number): string {
    return [
      "# Northline Prospect Collection Summary",
      "",
      `Status: ${result.status}`,
      `Summary: ${result.summary}`,
      `Cadence: ${intervalHours} hour(s)` ,
      `Source: ${this.sourceAttribution()}`,
      "",
      "## Markets",
      ...(result.marketResults.length > 0
        ? result.marketResults.map(
            (market) =>
              `- [${market.status}] ${market.market} -> ${market.records} record(s) -> ${market.sourceFilePath}`
          )
        : ["- No market collection work was performed on this run."]),
      "",
      "## Notes",
      ...(result.details.length > 0 ? result.details.map((detail) => `- ${detail}`) : ["- No additional notes."]),
      ""
    ].join("\n");
  }

  private buildSummary(marketResults: MarketCollectionSummary[], collectedRecords: number): string {
    if (marketResults.length === 0) {
      return "Northline prospect collection completed with no configured markets.";
    }

    const failedMarkets = marketResults.filter((market) => market.status === "failed").length;
    const collectedMarkets = marketResults.filter((market) => market.status === "collected").length;
    const parts = [
      collectedMarkets > 0 ? `${collectedMarkets} market feed(s) refreshed` : undefined,
      collectedRecords > 0 ? `${collectedRecords} record(s) written` : undefined,
      failedMarkets > 0 ? `${failedMarkets} market(s) failed` : undefined
    ].filter((value): value is string => Boolean(value));

    if (parts.length === 0) {
      return "Northline prospect collection ran with no matching records.";
    }

    return `Northline prospect collection completed: ${parts.join(", ")}.`;
  }

  private userAgent(): string {
    const email = this.config.business.approvalEmail || "owner@example.com";
    return `ImonEngine Northline Prospect Collector/0.1 (+mailto:${email})`;
  }

  private sourceAttribution(): string {
    const researchRoute = this.ai?.describeRoute({
      businessId: NORTHLINE_BUSINESS_ID,
      capability: "prospect-research",
      sharedRouteId: "research"
    });
    return researchRoute?.available
      ? `OpenStreetMap contributors via Overpass API; when the ${researchRoute.providerLabel} ${researchRoute.routeId} route is configured, the collector also supplements feeds with public-source web search. Nominatim is used only for cached market resolution.`
      : "OpenStreetMap contributors via Overpass API; Nominatim is used only for cached market resolution.";
  }

  private async resolveBusinessProfile(businessId: string): Promise<ResolvedNorthlineBusinessProfile> {
    const business = await this.store.getManagedBusiness(businessId);
    if (business) {
      return resolveNorthlineBusinessProfile(this.config, business);
    }
    if (businessId === NORTHLINE_BUSINESS_ID) {
      return resolveNorthlineBusinessProfile(this.config);
    }
    throw new Error(`Managed business ${businessId} was not found.`);
  }

  private statePath(businessId: string): string {
    return northlineBusinessStateFilePath(this.config, businessId, STATE_FILE);
  }

  private summaryJsonPath(businessId: string): string {
    return path.join(northlineBusinessOpsDir(this.config, businessId), SUMMARY_JSON_FILE);
  }

  private summaryMarkdownPath(businessId: string): string {
    return path.join(northlineBusinessOpsDir(this.config, businessId), SUMMARY_MARKDOWN_FILE);
  }
}