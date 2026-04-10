import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  resolveLeadPipeline,
  type LeadPipeline,
  type ProspectImportRecord,
  type LeadRecord,
  type WebsiteQualitySignals
} from "../domain/contracts.js";
import { parseProspectCsv } from "../lib/csv.js";
import { readJsonFile } from "../lib/fs.js";
import { asBoolean, slugify, splitTags } from "../lib/text.js";

function splitMatchReasons(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

export class ProspectorAgent {
  async loadImportFile(filePath: string): Promise<ProspectImportRecord[]> {
    const resolved = path.resolve(filePath);
    if (resolved.endsWith(".json")) {
      const data = await readJsonFile<ProspectImportRecord[] | { records?: ProspectImportRecord[] }>(
        resolved,
        []
      );
      return Array.isArray(data) ? data : data.records ?? [];
    }

    const raw = await readFile(resolved, "utf8");
    return parseProspectCsv(raw);
  }

  toLead(
    record: ProspectImportRecord,
    options?: {
      businessId?: string;
      source?: string;
      pipeline?: LeadPipeline;
    }
  ): LeadRecord {
    const now = new Date().toISOString();
    const geo = [record.city, record.state].filter(Boolean).join(", ");
    const qualitySignals: WebsiteQualitySignals = {
      hasWebsite: asBoolean(record.hasWebsite, Boolean(record.website)),
      hasHttps: asBoolean(record.hasHttps, Boolean(record.website?.startsWith("https://"))),
      mobileFriendly: asBoolean(record.mobileFriendly, false),
      clearOffer: asBoolean(record.clearOffer, false),
      callsToAction: asBoolean(record.callsToAction, false),
      pageSpeedBucket:
        record.pageSpeedBucket === "slow" ||
        record.pageSpeedBucket === "average" ||
        record.pageSpeedBucket === "fast"
          ? record.pageSpeedBucket
          : "unknown",
      notes: record.notes
        ? record.notes
            .split(/[|;]/)
            .map((item) => item.trim())
            .filter(Boolean)
        : []
    };
    const targetIndustries = splitTags(record.targetIndustries);
    const targetServices = splitTags(record.targetServices);
    const matchReasons = splitMatchReasons(record.matchReasons);
    const targetContext =
      record.market ||
      record.trade ||
      record.collectionArea ||
      record.sourceType ||
      targetIndustries.length > 0 ||
      targetServices.length > 0 ||
      record.offerSummary ||
      matchReasons.length > 0
        ? {
            market: record.market,
            trade: record.trade,
            collectionArea: record.collectionArea,
            sourceType: record.sourceType,
            targetIndustries,
            targetServices,
            offerSummary: record.offerSummary,
            matchReasons
          }
        : undefined;

    return {
      id: slugify(record.businessName),
      businessId: options?.businessId ?? "auto-funding-agency",
      pipeline: resolveLeadPipeline({ pipeline: options?.pipeline ?? record.pipeline }),
      businessName: record.businessName,
      niche: record.niche,
      geo,
      source: options?.source ?? "public-business-list",
      contact: {
        ownerName: record.ownerName,
        email: record.email,
        phone: record.phone,
        website: record.website
      },
      websiteQualitySignals: qualitySignals,
      targetContext,
      score: 0,
      scoreReasons: [],
      stage: "prospecting",
      tags: splitTags(record.tags),
      createdAt: now,
      updatedAt: now
    };
  }
}
