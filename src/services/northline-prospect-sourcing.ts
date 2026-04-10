import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import type { BusinessRunStatus } from "../domain/engine.js";
import type { ResolvedNorthlineBusinessProfile } from "../domain/northline.js";
import { ensureDir, readJsonFile, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { OrchestratorAgent } from "../agents/orchestrator.js";
import { FileStore } from "../storage/store.js";
import {
  northlineBusinessOpsDir,
  northlineBusinessStateFilePath,
  resolveNorthlineBusinessProfile
} from "./northline-business-profile.js";

const STATE_FILE = "northlineProspectSourcing.json";
const SUMMARY_JSON_FILE = "prospect-sourcing-summary.json";
const SUMMARY_MARKDOWN_FILE = "prospect-sourcing-summary.md";
const NORTHLINE_BUSINESS_ID = "auto-funding-agency";

interface NorthlineProspectSourceFileState {
  filePath: string;
  hash: string;
  processedAt: string;
  leadCount: number;
}

interface NorthlineProspectSourcingState {
  businessId: string;
  files: NorthlineProspectSourceFileState[];
  lastRunAt?: string;
  updatedAt: string;
}

export interface NorthlineProspectSourcingFileResult {
  filePath: string;
  status: "processed" | "skipped" | "failed";
  leadCount: number;
  summary: string;
}

export interface NorthlineProspectSourcingRunResult {
  status: BusinessRunStatus;
  summary: string;
  details: string[];
  businessId: string;
  sourceDir: string;
  files: NorthlineProspectSourcingFileResult[];
  processedLeads: number;
  processedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  artifacts: {
    statePath: string;
    summaryJsonPath: string;
    summaryMarkdownPath: string;
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function digest(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export class NorthlineProspectSourcingService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore,
    private readonly orchestrator: OrchestratorAgent
  ) {}

  async run(options?: { businessId?: string }): Promise<NorthlineProspectSourcingRunResult> {
    const businessId = options?.businessId ?? NORTHLINE_BUSINESS_ID;
    const businessProfile = await this.resolveBusinessProfile(businessId);
    const sourceDir = businessProfile.sourceDir;
    await ensureDir(sourceDir);

    const state = await this.readState(businessId);
    const knownFiles = new Map(state.files.map((file) => [file.filePath, file]));
    const nextFiles = new Map(knownFiles);
    const filePaths = await this.listSourceFiles(sourceDir);
    const generatedAt = nowIso();
    const files: NorthlineProspectSourcingFileResult[] = [];
    let processedLeads = 0;

    for (const filePath of filePaths) {
      const raw = await readFile(filePath, "utf8");
      const relativePath = path.relative(sourceDir, filePath) || path.basename(filePath);
      const hash = digest(raw);
      const previous = knownFiles.get(relativePath);

      if (previous?.hash === hash) {
        files.push({
          filePath: relativePath,
          status: "skipped",
          leadCount: previous.leadCount,
          summary: `${relativePath} is unchanged and was skipped.`
        });
        continue;
      }

      try {
        const leads = await this.orchestrator.prospect(filePath, {
          businessId,
          source: `northline-feed:${relativePath}`,
          pipeline: "agency_client_acquisition"
        });
        processedLeads += leads.length;
        nextFiles.set(relativePath, {
          filePath: relativePath,
          hash,
          processedAt: generatedAt,
          leadCount: leads.length
        });
        files.push({
          filePath: relativePath,
          status: "processed",
          leadCount: leads.length,
          summary: `Processed ${leads.length} lead(s) from ${relativePath}.`
        });
      } catch (error) {
        files.push({
          filePath: relativePath,
          status: "failed",
          leadCount: 0,
          summary:
            error instanceof Error
              ? `Failed to process ${relativePath}: ${error.message}`
              : `Failed to process ${relativePath}.`
        });
      }
    }

    const nextState: NorthlineProspectSourcingState = {
      businessId,
      files: [...nextFiles.values()].sort((left, right) => left.filePath.localeCompare(right.filePath)),
      lastRunAt: generatedAt,
      updatedAt: generatedAt
    };

    const processedFiles = files.filter((file) => file.status === "processed").length;
    const skippedFiles = files.filter((file) => file.status === "skipped").length;
    const failedFiles = files.filter((file) => file.status === "failed").length;
    const status: BusinessRunStatus = failedFiles > 0 ? "blocked" : "success";
    const summary = this.buildSummary(filePaths.length, processedFiles, skippedFiles, failedFiles, processedLeads);
    const details = files.map((file) => file.summary);
    const artifacts = {
      statePath: this.statePath(businessId),
      summaryJsonPath: this.summaryJsonPath(businessId),
      summaryMarkdownPath: this.summaryMarkdownPath(businessId)
    };

    await writeJsonFile(artifacts.statePath, nextState);
    await this.writeSummaryArtifacts(artifacts.summaryJsonPath, artifacts.summaryMarkdownPath, {
      generatedAt,
      businessId,
      sourceDir,
      status,
      summary,
      files,
      processedLeads,
      processedFiles,
      skippedFiles,
      failedFiles
    });

    return {
      status,
      summary,
      details,
      businessId,
      sourceDir,
      files,
      processedLeads,
      processedFiles,
      skippedFiles,
      failedFiles,
      artifacts
    };
  }

  private async readState(businessId: string): Promise<NorthlineProspectSourcingState> {
    return readJsonFile<NorthlineProspectSourcingState>(this.statePath(businessId), {
      businessId,
      files: [],
      updatedAt: nowIso()
    });
  }

  private async listSourceFiles(sourceDir: string): Promise<string[]> {
    const entries = await readdir(sourceDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /\.(csv|json)$/i.test(entry.name))
      .map((entry) => path.join(sourceDir, entry.name))
      .sort((left, right) => left.localeCompare(right));
  }

  private buildSummary(
    totalFiles: number,
    processedFiles: number,
    skippedFiles: number,
    failedFiles: number,
    processedLeads: number
  ): string {
    if (totalFiles === 0) {
      return "Northline prospect sourcing found no source files.";
    }

    const parts = [
      processedFiles > 0 ? `${processedFiles} source file(s) processed` : undefined,
      skippedFiles > 0 ? `${skippedFiles} unchanged file(s) skipped` : undefined,
      failedFiles > 0 ? `${failedFiles} file(s) failed` : undefined,
      processedLeads > 0 ? `${processedLeads} lead record(s) scored` : undefined
    ].filter((value): value is string => Boolean(value));

    if (parts.length === 0) {
      return "Northline prospect sourcing scanned source files with no new work.";
    }

    return `Northline prospect sourcing completed: ${parts.join(", ")}.`;
  }

  private async writeSummaryArtifacts(
    summaryJsonPath: string,
    summaryMarkdownPath: string,
    summary: {
      generatedAt: string;
      businessId: string;
      sourceDir: string;
      status: BusinessRunStatus;
      summary: string;
      files: NorthlineProspectSourcingFileResult[];
      processedLeads: number;
      processedFiles: number;
      skippedFiles: number;
      failedFiles: number;
    }
  ): Promise<void> {
    await ensureDir(path.dirname(summaryJsonPath));
    await writeJsonFile(summaryJsonPath, summary);
    await writeTextFile(
      summaryMarkdownPath,
      [
        "# Northline Prospect Sourcing Summary",
        "",
        `Generated at: ${summary.generatedAt}`,
        `Status: ${summary.status}`,
        `Summary: ${summary.summary}`,
        `Source dir: ${summary.sourceDir}`,
        "",
        "## File Results",
        ...(summary.files.length > 0
          ? summary.files.map((file) => `- [${file.status}] ${file.filePath}: ${file.summary}`)
          : ["- No source files found."]),
        ""
      ].join("\n")
    );
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