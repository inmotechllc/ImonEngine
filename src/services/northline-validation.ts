import path from "node:path";
import type { AppConfig } from "../config.js";
import type { BillingStatus, ClientJob, RetentionReport } from "../domain/contracts.js";
import { DEFAULT_NORTHLINE_BUSINESS_ID } from "../domain/northline.js";
import { readJsonFile } from "../lib/fs.js";
import { FileStore } from "../storage/store.js";
import { NorthlineAutonomyService } from "./northline-autonomy.js";

type NorthlineIntakePayload = {
  ownerName?: string;
  businessName?: string;
  email?: string;
  phone?: string;
  serviceArea?: string;
  primaryServices?: string;
  preferredCallWindow?: string;
  contactPreference?: string;
  website?: string;
  leadGoal?: string;
  biggestLeak?: string;
  notes?: string;
  source?: string;
};

type NorthlineIntakeSubmission = NorthlineIntakePayload & {
  id: string;
  receivedAt: string;
  remoteAddress?: string;
  userAgent?: string;
};

type NorthlineIntakeStore =
  | NorthlineIntakeSubmission[]
  | {
      submissions: NorthlineIntakeSubmission[];
      lastReceivedAt?: string;
    };

type ValidationStatus = "success" | "blocked";

export interface NorthlineValidationRunResult {
  status: ValidationStatus;
  summary: string;
  businessId: string;
  submissionId: string;
  clientId: string;
  clientName: string;
  billingStatus: ClientJob["billingStatus"];
  previewPath?: string;
  siteStatus: ClientJob["siteStatus"];
  qaStatus: ClientJob["qaStatus"];
  handoffPackage?: {
    clientId: string;
    createdAt: string;
    reportPath: string;
    readmePath: string;
  };
  retentionReport?: Pick<RetentionReport, "clientId" | "createdAt" | "upsellCandidate" | "upgradeOffer">;
  proofBundle?: {
    clientId: string;
    createdAt: string;
    screenshotCount: number;
  };
  warnings: string[];
  steps: {
    intakePromotion: string;
    billingHandoff: string;
    deliveryRun: string;
  };
  artifacts: {
    autonomySummaryPath: string;
    previewPath?: string;
    proofBundlePath?: string;
    proofScreenshotPaths: string[];
    handoffPackagePath?: string;
  };
}

function compact(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeStore(store: NorthlineIntakeStore): NorthlineIntakeSubmission[] {
  return Array.isArray(store) ? store : store.submissions;
}

function businessClient(client: ClientJob, businessId: string): boolean {
  return (client.businessId ?? DEFAULT_NORTHLINE_BUSINESS_ID) === businessId;
}

export class NorthlineValidationService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore,
    private readonly northlineAutonomy: NorthlineAutonomyService
  ) {}

  async run(options?: {
    businessId?: string;
    submissionId?: string;
    status?: Extract<BillingStatus, "paid" | "retainer_active">;
    formEndpoint?: string;
  }): Promise<NorthlineValidationRunResult> {
    const businessId = options?.businessId ?? DEFAULT_NORTHLINE_BUSINESS_ID;
    const submission = await this.resolveSubmission(options?.submissionId);

    const intakePromotion = await this.northlineAutonomy.run({ businessId });
    const resolvedClient = await this.resolveClient(businessId, submission.id);
    if (!resolvedClient) {
      throw new Error(
        `Validation submission ${submission.id} did not produce a tracked client. Check the intake fields and rerun northline-autonomy-run.`
      );
    }
    const client = await this.ensureValidationClientMetadata(resolvedClient);

    const handoffStatus = options?.status ?? "retainer_active";
    const handoff = await this.northlineAutonomy.applyBillingHandoff({
      clientId: client.id,
      status: handoffStatus,
      formEndpoint: options?.formEndpoint,
      nextAction:
        handoffStatus === "retainer_active"
          ? "Validation pipeline is running through build, QA, and retention coverage."
          : "Validation pipeline is running through build and QA."
    });
    const deliveryRun = await this.northlineAutonomy.run({ businessId });
    const refreshedClient = (await this.store.getClient(client.id)) ?? handoff.client;
    const retentionReport =
      handoffStatus === "retainer_active"
        ? this.latestRetentionReport(
            (await this.store.getRetentionReports()).filter(
              (report) => report.clientId === refreshedClient.id
            )
          )
        : undefined;
    const proofBundle = refreshedClient.assets.proofBundle;
    const handoffPackage = refreshedClient.assets.handoffPackage;
    const warnings: string[] = [];

    if (refreshedClient.qaStatus !== "passed") {
      warnings.push(`QA is ${refreshedClient.qaStatus}. Review runtime/reports for details.`);
    }
    if (refreshedClient.siteStatus === "qa_failed") {
      warnings.push("The preview build failed QA and needs a manual fix before handoff.");
    }
    if (handoffStatus === "retainer_active" && !retentionReport) {
      warnings.push("Retention coverage was requested, but no retention report was generated.");
    }
    if (refreshedClient.qaStatus === "passed" && !proofBundle) {
      warnings.push("Proof bundle was not generated for the delivered client.");
    }
    if (proofBundle && proofBundle.screenshots.length === 0) {
      warnings.push("Proof bundle is present, but screenshot capture is still missing.");
    }
    if (refreshedClient.qaStatus === "passed" && !handoffPackage) {
      warnings.push("Preview is QA-passed, but the client handoff package was not generated yet.");
    }

    const deliveryCompleted =
      refreshedClient.qaStatus === "passed" &&
      proofBundle !== undefined &&
      proofBundle.screenshots.length > 0 &&
      handoffPackage !== undefined &&
      (handoffStatus !== "retainer_active" || retentionReport !== undefined);

    const status: ValidationStatus = warnings.length === 0 && deliveryCompleted ? "success" : "blocked";

    return {
      status,
      summary:
        status === "success"
          ? `Validation submission ${submission.id} reached preview build, QA, proof capture, and client handoff packaging successfully.`
          : `Validation submission ${submission.id} moved through the pipeline with follow-up items to review.`,
      businessId,
      submissionId: submission.id,
      clientId: refreshedClient.id,
      clientName: refreshedClient.clientName,
      billingStatus: refreshedClient.billingStatus,
      previewPath: refreshedClient.deployment.previewPath,
      siteStatus: refreshedClient.siteStatus,
      qaStatus: refreshedClient.qaStatus,
      handoffPackage: handoffPackage
        ? {
            clientId: handoffPackage.clientId,
            createdAt: handoffPackage.createdAt,
            reportPath: handoffPackage.reportPath,
            readmePath: handoffPackage.readmePath
          }
        : undefined,
      retentionReport: retentionReport
        ? {
            clientId: retentionReport.clientId,
            createdAt: retentionReport.createdAt,
            upsellCandidate: retentionReport.upsellCandidate,
            upgradeOffer: retentionReport.upgradeOffer
          }
        : undefined,
      proofBundle: proofBundle
        ? {
            clientId: proofBundle.clientId,
            createdAt: proofBundle.createdAt,
            screenshotCount: proofBundle.screenshots.length
          }
        : undefined,
      warnings,
      steps: {
        intakePromotion: intakePromotion.summary,
        billingHandoff: `Billing handoff recorded as ${handoff.client.billingStatus}.`,
        deliveryRun: deliveryRun.summary
      },
      artifacts: {
        autonomySummaryPath: deliveryRun.artifacts.summaryJsonPath,
        previewPath: refreshedClient.deployment.previewPath,
        proofBundlePath: proofBundle?.reportPath,
        proofScreenshotPaths: proofBundle?.screenshots.map((item) => item.path) ?? [],
        handoffPackagePath: handoffPackage?.reportPath
      }
    };
  }

  private async resolveSubmission(submissionId?: string): Promise<NorthlineIntakeSubmission> {
    const stored = await readJsonFile<NorthlineIntakeStore>(this.config.northlineSite.submissionStorePath, {
      submissions: []
    });
    const submissions = normalizeStore(stored).sort((left, right) =>
      right.receivedAt.localeCompare(left.receivedAt)
    );

    if (submissions.length === 0) {
      throw new Error("No Northline submissions were found. Submit the validation page first.");
    }

    if (submissionId && submissionId !== "latest") {
      const exact = submissions.find((submission) => submission.id === submissionId);
      if (!exact) {
        throw new Error(`Validation submission ${submissionId} was not found.`);
      }
      return exact;
    }

    const latestValidation = submissions.find(
      (submission) => compact(submission.source) === "northline-validation-page"
    );
    if (!latestValidation) {
      throw new Error(
        `No validation submission was found in ${this.config.northlineSite.submissionStorePath}. Submit /validation.html first.`
      );
    }
    return latestValidation;
  }

  private async resolveClient(
    businessId: string,
    submissionId: string
  ): Promise<ClientJob | undefined> {
    const clients = await this.store.getClients();
    return clients.find(
      (client) => businessClient(client, businessId) && client.sourceSubmissionId === submissionId
    );
  }

  private latestRetentionReport(reports: RetentionReport[]): RetentionReport | undefined {
    return reports.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  }

  private async ensureValidationClientMetadata(client: ClientJob): Promise<ClientJob> {
    if (
      client.provenance === "external_inbound" ||
      client.provenance === "external_outbound" ||
      (client.provenance === "internal_validation" && client.proofEligible === false)
    ) {
      return client;
    }

    const nextClient: ClientJob = {
      ...client,
      provenance: "internal_validation",
      proofEligible: false,
      updatedAt: new Date().toISOString()
    };
    await this.store.saveClient(nextClient);
    return nextClient;
  }
}