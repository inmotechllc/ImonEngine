import { spawn } from "node:child_process";
import { appendFile, copyFile, readdir, rename } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import type { ClipBaitersClipJob } from "../domain/clipbaiters.js";
import { ensureDir, exists, writeTextFile } from "../lib/fs.js";
import { FileStore } from "../storage/store.js";

function nowIso(): string {
  return new Date().toISOString();
}

export class ClipBaitersRendererService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {
    void this.config;
    void this.store;
  }

  async render(options: {
    jobs: ClipBaitersClipJob[];
  }): Promise<{
    jobs: ClipBaitersClipJob[];
    renderedCount: number;
    blockedCount: number;
    artifactPaths: string[];
  }> {
    const jobs: ClipBaitersClipJob[] = [];
    const artifactPaths = new Set<string>();

    for (const job of options.jobs) {
      const renderedJob = await this.renderJob(job);
      jobs.push(renderedJob);
      for (const artifactPath of this.collectArtifactPaths(renderedJob)) {
        artifactPaths.add(artifactPath);
      }
    }

    return {
      jobs,
      renderedCount: jobs.filter((job) => job.status === "rendered").length,
      blockedCount: jobs.filter((job) => job.status === "blocked").length,
      artifactPaths: [...artifactPaths]
    };
  }

  private async renderJob(job: ClipBaitersClipJob): Promise<ClipBaitersClipJob> {
    await ensureDir(job.outputPackageDir);
    await Promise.all([
      writeTextFile(job.renderArtifacts.attributionTextPath, job.editDecision.attributionText),
      writeTextFile(job.renderArtifacts.renderLogPath, this.renderLogHeader(job))
    ]);

    if (job.status === "blocked") {
      await this.appendLog(job.renderArtifacts.renderLogPath, "Render skipped because the job was already blocked.\n");
      return job;
    }

    if (job.clipWindow.endSeconds - job.clipWindow.startSeconds > 59) {
      const note = "Render blocked because the requested clip window exceeds the short-form duration cap.";
      await this.appendLog(job.renderArtifacts.renderLogPath, `${note}\n`);
      return {
        ...job,
        status: "blocked",
        notes: [...job.notes, note]
      };
    }

    let sourceMediaPath = job.renderArtifacts.sourceMediaPath;
    let transcriptJsonPath = job.renderArtifacts.transcriptJsonPath;

    try {
      sourceMediaPath = await this.prepareSourceMedia(job);
      transcriptJsonPath = await this.captureTranscript(job, sourceMediaPath);
      await this.renderVideo(job, sourceMediaPath);
      await this.appendLog(
        job.renderArtifacts.renderLogPath,
        `Rendered final clip to ${job.renderArtifacts.renderedVideoPath}.\n`
      );

      return {
        ...job,
        status: "rendered",
        renderedAt: nowIso(),
        renderArtifacts: {
          ...job.renderArtifacts,
          sourceMediaPath,
          transcriptJsonPath
        },
        notes: [...job.notes, `Rendered final clip to ${job.renderArtifacts.renderedVideoPath}.`]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown render failure.";
      await this.appendLog(job.renderArtifacts.renderLogPath, `ERROR: ${message}\n`);
      return {
        ...job,
        status: "blocked",
        renderArtifacts: {
          ...job.renderArtifacts,
          sourceMediaPath,
          transcriptJsonPath
        },
        notes: [...job.notes, `Render blocked: ${message}`]
      };
    }
  }

  private async prepareSourceMedia(job: ClipBaitersClipJob): Promise<string> {
    const expectedPath = job.renderArtifacts.sourceMediaPath ?? path.join(job.outputPackageDir, "source-media.mp4");
    if (job.localMediaPath) {
      if (!(await exists(job.localMediaPath))) {
        throw new Error(`Local media path ${job.localMediaPath} does not exist.`);
      }
      if (path.resolve(job.localMediaPath) !== path.resolve(expectedPath)) {
        await copyFile(job.localMediaPath, expectedPath);
      }
      await this.appendLog(
        job.renderArtifacts.renderLogPath,
        `Using local media ${job.localMediaPath} as the render input.\n`
      );
      return expectedPath;
    }

    if (!job.sourceUrl) {
      throw new Error("No local media path or approved source URL was available for render execution.");
    }

    const outputPattern = this.downloadPattern(expectedPath);
    await this.runCommand(
      "yt-dlp",
      [job.sourceUrl, "-o", outputPattern, "--merge-output-format", "mp4", "--no-progress"],
      job.renderArtifacts.renderLogPath,
      job.outputPackageDir
    );
    if (await exists(expectedPath)) {
      return expectedPath;
    }

    const downloadedPath = await this.findDownloadedMedia(job.outputPackageDir, path.basename(expectedPath, path.extname(expectedPath)));
    if (!downloadedPath) {
      throw new Error(`yt-dlp completed but did not materialize source media near ${expectedPath}.`);
    }
    return downloadedPath;
  }

  private async captureTranscript(job: ClipBaitersClipJob, sourceMediaPath: string): Promise<string> {
    const transcriptJsonPath = job.renderArtifacts.transcriptJsonPath ?? path.join(job.outputPackageDir, "transcript.json");
    await this.runCommand(
      "python3",
      [
        "-m",
        "whisper",
        sourceMediaPath,
        "--language",
        "en",
        "--task",
        "transcribe",
        "--output_format",
        "json",
        "--output_dir",
        job.outputPackageDir
      ],
      job.renderArtifacts.renderLogPath,
      job.outputPackageDir
    );

    const rawTranscriptPath = path.join(
      job.outputPackageDir,
      `${path.basename(sourceMediaPath, path.extname(sourceMediaPath))}.json`
    );
    if (await exists(rawTranscriptPath)) {
      if (path.resolve(rawTranscriptPath) !== path.resolve(transcriptJsonPath)) {
        await rename(rawTranscriptPath, transcriptJsonPath);
      }
      return transcriptJsonPath;
    }
    if (await exists(transcriptJsonPath)) {
      return transcriptJsonPath;
    }

    throw new Error(`Whisper did not produce a transcript JSON for ${sourceMediaPath}.`);
  }

  private async renderVideo(job: ClipBaitersClipJob, sourceMediaPath: string): Promise<void> {
    const speedFactor = job.editDecision.speedAdjustmentPercent / 100;
    const videoFilters = [
      speedFactor !== 1 ? `setpts=PTS/${speedFactor.toFixed(2)}` : undefined,
      "scale=1080:1920:force_original_aspect_ratio=increase",
      "crop=1080:1920",
      `subtitles='${this.escapeFfmpegPath(job.outputFiles.captionSrtPath)}'`
    ]
      .filter((value): value is string => Boolean(value))
      .join(",");

    const args = [
      "-y",
      "-i",
      sourceMediaPath,
      "-ss",
      this.toClock(job.clipWindow.startSeconds),
      "-to",
      this.toClock(job.clipWindow.endSeconds),
      "-map",
      "0:v:0",
      "-map",
      "0:a?:0",
      "-vf",
      videoFilters,
      ...(speedFactor !== 1 ? ["-af", `atempo=${speedFactor.toFixed(2)}`] : []),
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      job.renderArtifacts.renderedVideoPath
    ];

    await this.runCommand("ffmpeg", args, job.renderArtifacts.renderLogPath, job.outputPackageDir);
    if (!(await exists(job.renderArtifacts.renderedVideoPath))) {
      throw new Error(`ffmpeg completed but ${job.renderArtifacts.renderedVideoPath} was not created.`);
    }
  }

  private async runCommand(
    command: string,
    args: string[],
    logPath: string,
    cwd: string
  ): Promise<void> {
    await this.appendLog(logPath, `$ ${this.stringifyCommand(command, args)}\n`);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        const value = chunk.toString("utf8");
        stdout += value;
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const value = chunk.toString("utf8");
        stderr += value;
      });
      child.on("error", (error) => {
        reject(error);
      });
      child.on("close", async (code) => {
        await this.appendLog(logPath, `${stdout}${stderr}`);
        if (code === 0) {
          resolve();
          return;
        }

        const failureOutput = `${stdout}${stderr}`.trim();
        reject(new Error(failureOutput || `${command} exited with code ${code}.`));
      });
    });
  }

  private async appendLog(logPath: string, text: string): Promise<void> {
    await appendFile(logPath, text, "utf8");
  }

  private renderLogHeader(job: ClipBaitersClipJob): string {
    return [
      `Generated at: ${nowIso()}`,
      `Job: ${job.id}`,
      `Lane: ${job.laneName}`,
      `Source: ${job.sourceTitle}`,
      ""
    ].join("\n");
  }

  private downloadPattern(expectedPath: string): string {
    const extension = path.extname(expectedPath);
    const basePath = extension ? expectedPath.slice(0, -extension.length) : expectedPath;
    return `${basePath}.%(ext)s`;
  }

  private async findDownloadedMedia(directory: string, basename: string): Promise<string | undefined> {
    const entries = await readdir(directory, { withFileTypes: true });
    const match = entries.find(
      (entry) => entry.isFile() && entry.name.startsWith(`${basename}.`) && !entry.name.endsWith(".json")
    );
    return match ? path.join(directory, match.name) : undefined;
  }

  private collectArtifactPaths(job: ClipBaitersClipJob): string[] {
    return [
      job.renderArtifacts.sourceMediaPath,
      job.renderArtifacts.transcriptJsonPath,
      job.renderArtifacts.renderedVideoPath,
      job.renderArtifacts.attributionTextPath,
      job.renderArtifacts.renderLogPath,
      job.outputFiles.briefJsonPath,
      job.outputFiles.captionSrtPath,
      job.outputFiles.notesMarkdownPath,
      job.outputFiles.voiceoverTextPath
    ].filter((value): value is string => Boolean(value));
  }

  private escapeFfmpegPath(filePath: string): string {
    return filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  }

  private stringifyCommand(command: string, args: string[]): string {
    return [command, ...args.map((arg) => (arg.includes(" ") ? `"${arg}"` : arg))].join(" ");
  }

  private toClock(seconds: number): string {
    const totalSeconds = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(totalSeconds / 3600)
      .toString()
      .padStart(2, "0");
    const minutes = Math.floor((totalSeconds % 3600) / 60)
      .toString()
      .padStart(2, "0");
    const secs = Math.floor(totalSeconds % 60)
      .toString()
      .padStart(2, "0");
    return `${hours}:${minutes}:${secs}`;
  }
}