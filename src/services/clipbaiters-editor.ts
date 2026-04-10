import path from "node:path";
import type { AppConfig } from "../config.js";
import type {
  ClipBaitersCaptionTrackCue,
  ClipBaitersClipCandidate,
  ClipBaitersClipJob,
  ClipBaitersClipJobState,
  ClipBaitersClipMoment,
  ClipBaitersSeriesPart,
  ClipBaitersToolCommandPreview
} from "../domain/clipbaiters.js";
import { ensureDir, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { FileStore } from "../storage/store.js";

type DraftWindow = {
  clipWindow: {
    startSeconds: number;
    endSeconds: number;
  };
  moment: ClipBaitersClipMoment;
  seriesPart?: ClipBaitersSeriesPart;
};

function nowIso(): string {
  return new Date().toISOString();
}

function clipText(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function laneScopedPath(filePath: string, laneId: string): string {
  const extension = path.extname(filePath);
  const basename = path.basename(filePath, extension);
  return path.join(path.dirname(filePath), `${basename}-${laneId}${extension}`);
}

export class ClipBaitersEditorService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {
    void this.store;
  }

  async draft(options: {
    businessId: string;
    businessName: string;
    laneId: string;
    laneName: string;
    dryRun: boolean;
    candidates: ClipBaitersClipCandidate[];
  }): Promise<{
    jobs: ClipBaitersClipJob[];
    artifacts: {
      clipJobsPath: string;
      clipJobsLanePath: string;
      draftClipsDirectory: string;
    };
  }> {
    const stateDirectory = path.join(this.config.stateDir, "clipbaiters", options.businessId);
    const draftClipsDirectory = path.join(this.config.opsDir, "clipbaiters", options.businessId, "draft-clips");
    const clipJobsPath = path.join(stateDirectory, "clip-jobs.json");
    const clipJobsLanePath = laneScopedPath(clipJobsPath, options.laneId);
    await Promise.all([ensureDir(stateDirectory), ensureDir(draftClipsDirectory)]);

    const jobs: ClipBaitersClipJob[] = [];
    for (const candidate of options.candidates) {
      const candidateJobs = await this.toClipJobs({
        businessId: options.businessId,
        businessName: options.businessName,
        laneId: options.laneId,
        laneName: options.laneName,
        dryRun: options.dryRun,
        candidate,
        draftClipsDirectory
      });
      jobs.push(...candidateJobs);
    }

    const state: ClipBaitersClipJobState = {
      businessId: options.businessId,
      laneId: options.laneId,
      generatedAt: nowIso(),
      dryRun: options.dryRun,
      jobs
    };
    await Promise.all([
      writeJsonFile(clipJobsPath, state),
      writeJsonFile(clipJobsLanePath, state)
    ]);

    return {
      jobs,
      artifacts: {
        clipJobsPath,
        clipJobsLanePath,
        draftClipsDirectory
      }
    };
  }

  private async toClipJobs(payload: {
    businessId: string;
    businessName: string;
    laneId: string;
    laneName: string;
    dryRun: boolean;
    candidate: ClipBaitersClipCandidate;
    draftClipsDirectory: string;
  }): Promise<ClipBaitersClipJob[]> {
    const draftWindows = this.buildDraftWindows(payload.candidate);
    const jobs: ClipBaitersClipJob[] = [];
    for (const draftWindow of draftWindows) {
      jobs.push(
        await this.toClipJob({
          ...payload,
          draftWindow
        })
      );
    }
    return jobs;
  }

  private buildDraftWindows(candidate: ClipBaitersClipCandidate): DraftWindow[] {
    const fallbackMoment = candidate.suggestedMoments[0] ?? {
      startSeconds: 0,
      endSeconds: Math.min(candidate.maxDurationSeconds, 24),
      captionLines: [clipText(candidate.sourceTitle, 72)],
      label: "Moment 1",
      reason: "Fallback draft window.",
      energyScore: 5,
      policyRisk: 5,
      id: slugify(`${candidate.id}-fallback-moment`)
    };
    const transcriptStart = candidate.transcriptSegments[0]?.startSeconds ?? fallbackMoment.startSeconds;
    const transcriptEnd = candidate.transcriptSegments.at(-1)?.endSeconds ?? fallbackMoment.endSeconds;
    const transcriptDuration = transcriptEnd - transcriptStart;

    if (transcriptDuration <= candidate.maxDurationSeconds || candidate.transcriptSegments.length === 0) {
      return [
        {
          clipWindow: {
            startSeconds: fallbackMoment.startSeconds,
            endSeconds: Math.min(fallbackMoment.endSeconds, fallbackMoment.startSeconds + candidate.maxDurationSeconds)
          },
          moment: fallbackMoment,
          seriesPart: candidate.seriesPart
        }
      ];
    }

    const groupedSegments: ClipBaitersClipCandidate["transcriptSegments"][] = [];
    let activeGroup: ClipBaitersClipCandidate["transcriptSegments"] = [];

    for (const segment of candidate.transcriptSegments) {
      const proposedStart = activeGroup[0]?.startSeconds ?? segment.startSeconds;
      const proposedEnd = segment.endSeconds;
      const proposedDuration = proposedEnd - proposedStart;
      if (activeGroup.length > 0 && proposedDuration > candidate.maxDurationSeconds) {
        groupedSegments.push(activeGroup);
        activeGroup = [segment];
        continue;
      }
      activeGroup.push(segment);
    }

    if (activeGroup.length > 0) {
      groupedSegments.push(activeGroup);
    }

    const seriesId = slugify(`${candidate.id}-series`);
    return groupedSegments.map((segments, index, parts) => ({
      clipWindow: {
        startSeconds: segments[0]?.startSeconds ?? transcriptStart,
        endSeconds: segments.at(-1)?.endSeconds ?? transcriptEnd
      },
      moment: {
        id: slugify(`${seriesId}-part-${index + 1}`),
        label: `Part ${index + 1}`,
        startSeconds: segments[0]?.startSeconds ?? transcriptStart,
        endSeconds: segments.at(-1)?.endSeconds ?? transcriptEnd,
        reason: "Split a longer source sequence into ordered short-form parts under the duration cap.",
        energyScore: Math.max(...segments.map((segment) => Math.min(9, 4 + segment.text.split(/\s+/).length / 6))),
        policyRisk: candidate.transformationReview.policyRiskScore,
        captionLines: segments.map((segment) => clipText(segment.text, 72)).slice(0, 6)
      },
      seriesPart: {
        seriesId,
        partNumber: index + 1,
        totalParts: parts.length,
        label: `Part ${index + 1}`
      }
    }));
  }

  private async toClipJob(payload: {
    businessId: string;
    businessName: string;
    laneId: string;
    laneName: string;
    dryRun: boolean;
    candidate: ClipBaitersClipCandidate;
    draftClipsDirectory: string;
    draftWindow: DraftWindow;
  }): Promise<ClipBaitersClipJob> {
    const selectedMoment = payload.draftWindow.moment;
    const partSuffix = payload.draftWindow.seriesPart ? `-${slugify(payload.draftWindow.seriesPart.label)}` : "-draft";
    const jobId = slugify(`${payload.candidate.id}${partSuffix}`);
    const outputPackageDir = path.join(payload.draftClipsDirectory, jobId);
    await ensureDir(outputPackageDir);
    const captionTrack = this.buildCaptionTrack(payload.candidate, selectedMoment);
    const sourceMediaPath = this.resolveSourceMediaPath(payload.candidate, outputPackageDir);
    const renderedVideoPath = path.join(outputPackageDir, `${jobId}.mp4`);
    const workingTitle = payload.draftWindow.seriesPart
      ? `${payload.laneName}: ${clipText(payload.candidate.sourceTitle, 46)} | ${payload.draftWindow.seriesPart.label}`
      : `${payload.laneName}: ${clipText(payload.candidate.sourceTitle, 58)}`;
    const headlineOptions = [
      workingTitle,
      `${payload.laneName} breakdown: ${clipText(payload.candidate.commentaryHook, 54)}`,
      `${clipText(payload.candidate.sourceTitle, 42)} | ${payload.laneName}${payload.draftWindow.seriesPart ? ` ${payload.draftWindow.seriesPart.label}` : " clip draft"}`
    ];
    const briefJsonPath = path.join(outputPackageDir, "brief.json");
    const captionSrtPath = path.join(outputPackageDir, "captions.srt");
    const notesMarkdownPath = path.join(outputPackageDir, "notes.md");
    const voiceoverTextPath = path.join(outputPackageDir, "voiceover.txt");
    const renderArtifacts = {
      sourceMediaPath,
      transcriptJsonPath: path.join(outputPackageDir, "transcript.json"),
      renderedVideoPath,
      attributionTextPath: path.join(outputPackageDir, "attribution.txt"),
      renderLogPath: path.join(outputPackageDir, "render.log")
    };
    const speedAdjustmentPercent = payload.laneId === "clipbaiters-media" ? 103 : 100;
    const renderPlan = this.buildRenderPlan({
      candidate: payload.candidate,
      clipWindow: payload.draftWindow.clipWindow,
      captionSrtPath,
      renderArtifacts,
      speedAdjustmentPercent
    });
    const job: ClipBaitersClipJob = {
      id: jobId,
      businessId: payload.businessId,
      laneId: payload.laneId,
      laneName: payload.laneName,
      candidateId: payload.candidate.id,
      status: payload.candidate.status === "prepared" ? "drafted" : "blocked",
      dryRun: payload.dryRun,
      sourceTitle: payload.candidate.sourceTitle,
      sourceUrl: payload.candidate.sourceUrl,
      localMediaPath: payload.candidate.localMediaPath,
      workingTitle,
      headlineOptions,
      description: [
        payload.candidate.editorialAngle,
        `Commentary hook: ${payload.candidate.commentaryHook}`,
        `Rights basis: ${payload.candidate.rightsBasis}. Manual review: ${payload.candidate.approvalState === "review_required" ? "required" : "not required"}.`,
        `Attribution: ${payload.candidate.transformationReview.attributionText}`
      ].join("\n\n"),
      rightsBasis: payload.candidate.rightsBasis,
      approvedSourceClass: payload.candidate.approvedSourceClass,
      reviewRequired: payload.candidate.approvalState === "review_required",
      transformationReview: payload.candidate.transformationReview,
      automationEligible: payload.candidate.transformationReview.automationEligible,
      seriesPart: payload.draftWindow.seriesPart,
      clipWindow: payload.draftWindow.clipWindow,
      editDecision: {
        aspectRatio: "9:16",
        reframingStrategy: "Center the speaker, preserve the key visual cue, and bias toward readable face framing.",
        captionStyle: "Two-line burned-in captions with high-contrast safe margins and sentence-level emphasis.",
        templateName: payload.laneId === "clipbaiters-media" ? "capcut-pulse" : "newsroom-breakdown",
        speedAdjustmentPercent,
        voiceoverRequired: payload.laneId === "clipbaiters-political",
        attributionText: payload.candidate.transformationReview.attributionText,
        openingBeat: selectedMoment.reason,
        endingBeat: payload.candidate.commentaryHook,
        emphasisWords: selectedMoment.captionLines
          .join(" ")
          .split(/\s+/)
          .filter((word) => word.length > 6)
          .slice(0, 5)
      },
      captionTrack,
      renderPlan,
      renderArtifacts,
      outputPackageDir,
      outputFiles: {
        briefJsonPath,
        captionSrtPath,
        notesMarkdownPath,
        voiceoverTextPath
      },
      createdAt: nowIso(),
      notes: [
        ...payload.candidate.notes,
        payload.draftWindow.seriesPart
          ? `${payload.draftWindow.seriesPart.label} of ${payload.draftWindow.seriesPart.totalParts} for the current source sequence.`
          : "Single-part clip draft.",
        payload.dryRun
          ? "This draft package was generated in dry-run mode; no source download or render was executed."
          : "Review the render commands before executing them on the worker host."
      ]
    };

    await Promise.all([
      writeJsonFile(briefJsonPath, job),
      writeTextFile(captionSrtPath, this.toSrt(captionTrack)),
      writeTextFile(notesMarkdownPath, this.toNotesMarkdown(payload.businessName, job, selectedMoment)),
      writeTextFile(voiceoverTextPath, this.toVoiceoverText(job, selectedMoment)),
      writeTextFile(renderArtifacts.attributionTextPath, job.editDecision.attributionText)
    ]);
    return job;
  }

  private buildCaptionTrack(
    candidate: ClipBaitersClipCandidate,
    moment: ClipBaitersClipMoment
  ): ClipBaitersCaptionTrackCue[] {
    const matchingSegments = candidate.transcriptSegments.filter(
      (segment) => segment.endSeconds > moment.startSeconds && segment.startSeconds < moment.endSeconds
    );
    if (matchingSegments.length > 0) {
      return matchingSegments.map((segment) => ({
        startSeconds: Math.max(moment.startSeconds, segment.startSeconds),
        endSeconds: Math.min(moment.endSeconds, segment.endSeconds),
        text: clipText(segment.text, 72)
      }));
    }

    const fallbackDuration = Math.max(2, (moment.endSeconds - moment.startSeconds) / Math.max(1, moment.captionLines.length));
    return (moment.captionLines.length > 0 ? moment.captionLines : [candidate.sourceTitle]).map((line, index) => ({
      startSeconds: moment.startSeconds + index * fallbackDuration,
      endSeconds: Math.min(moment.endSeconds, moment.startSeconds + (index + 1) * fallbackDuration),
      text: clipText(line, 72)
    }));
  }

  private buildRenderPlan(
    payload: {
      candidate: ClipBaitersClipCandidate;
      clipWindow: {
        startSeconds: number;
        endSeconds: number;
      };
      captionSrtPath: string;
      renderArtifacts: ClipBaitersClipJob["renderArtifacts"];
      speedAdjustmentPercent: number;
    }
  ): ClipBaitersToolCommandPreview[] {
    const speedFactor = payload.speedAdjustmentPercent / 100;
    const videoFilters = [
      speedFactor !== 1 ? `setpts=PTS/${speedFactor.toFixed(2)}` : undefined,
      "scale=1080:1920:force_original_aspect_ratio=increase",
      "crop=1080:1920",
      `subtitles='${this.escapeFfmpegPath(payload.captionSrtPath)}'`
    ]
      .filter((value): value is string => Boolean(value))
      .join(",");

    return [
      {
        tool: "yt-dlp",
        command: payload.candidate.sourceUrl
          ? `yt-dlp "${payload.candidate.sourceUrl}" -o "${payload.renderArtifacts.sourceMediaPath?.replace(/\.mp4$/, ".%(ext)s")}" --merge-output-format mp4`
          : `yt-dlp "<approved-source-url>" -o "${payload.renderArtifacts.sourceMediaPath?.replace(/\.mp4$/, ".%(ext)s")}" --merge-output-format mp4`,
        note: payload.candidate.localMediaPath
          ? `Skip this step when local media already exists at ${payload.candidate.localMediaPath}.`
          : "Download only when the source remains approved for the active lane."
      },
      {
        tool: "whisper",
        command: `python3 -m whisper "${payload.renderArtifacts.sourceMediaPath}" --language en --task transcribe --output_format json --output_dir "${path.dirname(payload.renderArtifacts.transcriptJsonPath ?? payload.captionSrtPath)}"`,
        note: "Refresh the transcript from source media before the final render to keep caption timing grounded in the actual input file."
      },
      {
        tool: "ffmpeg",
        command: [
          `ffmpeg -y -i "${payload.renderArtifacts.sourceMediaPath}"`,
          `-ss ${this.toClock(payload.clipWindow.startSeconds)}`,
          `-to ${this.toClock(payload.clipWindow.endSeconds)}`,
          `-vf "${videoFilters}"`,
          payload.speedAdjustmentPercent !== 100 ? `-af "atempo=${speedFactor.toFixed(2)}"` : undefined,
          `"${payload.renderArtifacts.renderedVideoPath}"`
        ]
          .filter((value): value is string => Boolean(value))
          .join(" "),
        note: "Render the final vertical Short with captions burned in and the planned crop preserved."
      }
    ];
  }

  private toNotesMarkdown(
    businessName: string,
    job: ClipBaitersClipJob,
    moment: ClipBaitersClipCandidate["suggestedMoments"][number]
  ): string {
    return [
      "# Clip Draft Notes",
      "",
      `Business: ${businessName}`,
      `Lane: ${job.laneName}`,
      `Source title: ${job.sourceTitle}`,
      `Working title: ${job.workingTitle}`,
      `Rights basis: ${job.rightsBasis}`,
      `Review required: ${job.reviewRequired ? "yes" : "no"}`,
      `Approved source class: ${job.approvedSourceClass}`,
      ...(job.seriesPart
        ? [`Series part: ${job.seriesPart.label} (${job.seriesPart.partNumber}/${job.seriesPart.totalParts})`]
        : []),
      "",
      "## Selected Moment",
      `- Label: ${moment.label}`,
      `- Window: ${moment.startSeconds}s to ${moment.endSeconds}s`,
      `- Reason: ${moment.reason}`,
      "",
      "## Transformation",
      `- Tactics: ${job.transformationReview.tactics.join(", ")}`,
      `- Attribution: ${job.editDecision.attributionText}`,
      `- Automation eligible: ${job.automationEligible ? "yes" : "no"}`,
      "",
      "## Render Plan",
      ...job.renderPlan.map((step) => `- ${step.tool}: ${step.command}`),
      "",
      "## Notes",
      ...job.notes.map((note) => `- ${note}`),
      ""
    ].join("\n");
  }

  private toSrt(cues: ClipBaitersCaptionTrackCue[]): string {
    return cues
      .map((cue, index) => `${index + 1}\n${this.toSrtTime(cue.startSeconds)} --> ${this.toSrtTime(cue.endSeconds)}\n${cue.text}\n`)
      .join("\n");
  }

  private toSrtTime(seconds: number): string {
    const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
    const hours = Math.floor(totalMilliseconds / 3_600_000)
      .toString()
      .padStart(2, "0");
    const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000)
      .toString()
      .padStart(2, "0");
    const secs = Math.floor((totalMilliseconds % 60_000) / 1_000)
      .toString()
      .padStart(2, "0");
    const millis = Math.floor(totalMilliseconds % 1_000)
      .toString()
      .padStart(3, "0");
    return `${hours}:${minutes}:${secs},${millis}`;
  }

  private toVoiceoverText(
    job: ClipBaitersClipJob,
    moment: ClipBaitersClipMoment
  ): string {
    return [
      job.editDecision.voiceoverRequired
        ? "Voiceover recommended before unattended publish."
        : "Voiceover optional; captions and context hook carry the primary transformation.",
      "",
      `Open with: ${moment.reason}`,
      `Context hook: ${job.description.split("\n\n")[1] ?? job.description}`,
      `Close on: ${job.editDecision.endingBeat}`
    ].join("\n");
  }

  private resolveSourceMediaPath(candidate: ClipBaitersClipCandidate, outputPackageDir: string): string {
    const extension = candidate.localMediaPath ? path.extname(candidate.localMediaPath) || ".mp4" : ".mp4";
    return path.join(outputPackageDir, `source-media${extension}`);
  }

  private escapeFfmpegPath(filePath: string): string {
    return filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
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