import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ProspectImportRecord, LeadRecord, WebsiteQualitySignals } from "../domain/contracts.js";
import { parseProspectCsv } from "../lib/csv.js";
import { readJsonFile } from "../lib/fs.js";
import { asBoolean, slugify, splitTags } from "../lib/text.js";

export class ProspectorAgent {
  async loadImportFile(filePath: string): Promise<ProspectImportRecord[]> {
    const resolved = path.resolve(filePath);
    if (resolved.endsWith(".json")) {
      return readJsonFile<ProspectImportRecord[]>(resolved, []);
    }

    const raw = await readFile(resolved, "utf8");
    return parseProspectCsv(raw);
  }

  toLead(record: ProspectImportRecord): LeadRecord {
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

    return {
      id: slugify(record.businessName),
      businessName: record.businessName,
      niche: record.niche,
      geo,
      source: "public-business-list",
      contact: {
        ownerName: record.ownerName,
        email: record.email,
        phone: record.phone,
        website: record.website
      },
      websiteQualitySignals: qualitySignals,
      score: 0,
      scoreReasons: [],
      stage: "prospecting",
      tags: splitTags(record.tags),
      createdAt: now,
      updatedAt: now
    };
  }
}
