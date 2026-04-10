import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import type { AppConfig } from "../config.js";
import type { RetentionReport } from "../domain/contracts.js";
import { readJsonFile, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import type { NorthlineValidationRunResult } from "./northline-validation.js";

export type NorthlineIntakePayload = {
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

export type NorthlineIntakeSubmission = NorthlineIntakePayload & {
  id: string;
  receivedAt: string;
  remoteAddress?: string;
  userAgent?: string;
};

export type NorthlineIntakeStore =
  | NorthlineIntakeSubmission[]
  | {
      submissions: NorthlineIntakeSubmission[];
      lastReceivedAt?: string;
    };

type NorthlineSiteServerOptions = {
  onSubmissionStored?: (submission: NorthlineIntakeSubmission) => Promise<void>;
  onProposalPaymentCompleted?: (request: {
    clientId: string;
    status: "paid" | "retainer_active";
    formEndpoint?: string;
    stripeContext: {
      customerEmail?: string;
      eventId: string;
      referenceId?: string;
      sessionId?: string;
    };
  }) => Promise<{
    status: "success" | "blocked";
    summary: string;
    businessId: string;
    clientId: string;
    clientName: string;
    billingStatus: string;
    previewPath?: string;
    siteStatus: string;
    qaStatus: string;
    handoffPackage?: {
      clientId: string;
      createdAt: string;
      reportPath: string;
      readmePath: string;
    };
    retentionReport?: {
      clientId: string;
      createdAt: string;
      upsellCandidate: string;
      upgradeOffer?: RetentionReport["upgradeOffer"];
    };
    warnings: string[];
    artifacts: {
      autonomySummaryPath: string;
      previewPath?: string;
      handoffPackagePath?: string;
      productionUrl?: string;
    };
  }>;
  onValidationConfirmed?: (request: {
    submissionId: string;
    status: "paid" | "retainer_active";
    formEndpoint?: string;
  }) => Promise<NorthlineValidationRunResult>;
};

type NorthlineValidationConfirmationRecord = {
  submissionId: string;
  token: string;
  createdAt: string;
  lastConfirmedAt?: string;
  lastStripeCompletedAt?: string;
  lastStripeCustomerEmail?: string;
  lastStripeEventId?: string;
  lastStripeLivemode?: boolean;
  lastStripeReferenceId?: string;
  lastStripeSessionId?: string;
  lastResult?: NorthlineValidationRunResult;
};

type NorthlineValidationConfirmationStore = {
  confirmations: NorthlineValidationConfirmationRecord[];
  processedStripeEventIds?: string[];
  updatedAt?: string;
};

type StripeCheckoutSession = {
  client_reference_id?: string | null;
  customer_details?: {
    email?: string | null;
  } | null;
  id?: string;
  livemode?: boolean;
  metadata?: Record<string, string>;
  payment_status?: string | null;
  status?: string | null;
};

type StripeWebhookEvent = {
  created?: number;
  data?: {
    object?: StripeCheckoutSession;
  };
  id?: string;
  livemode?: boolean;
  type?: string;
};

const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;
const MAX_PROCESSED_STRIPE_EVENT_IDS = 250;

type NorthlineProposalPaymentMatch = {
  clientId: string;
  status: "paid" | "retainer_active";
  formEndpoint?: string;
};

function json(res: ServerResponse, statusCode: number, body: unknown): void {
  const serialized = `${JSON.stringify(body, null, 2)}\n`;
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(serialized)
  });
  res.end(serialized);
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(303, { Location: location });
  res.end();
}

function textResponse(
  res: ServerResponse,
  statusCode: number,
  body: string,
  contentType = "text/plain; charset=utf-8"
): void {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return Array.isArray(value) ? value[0] : value;
}

function normalizeField(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeFirst(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = normalizeField(record[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function normalizeFirstParam(params: URLSearchParams, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = normalizeField(params.get(key));
    if (value) {
      return value;
    }
  }
  return undefined;
}

function contentTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json; charset=utf-8";
    case ".txt":
    case ".md":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function intakeId(seed: string): string {
  const slug = slugify(seed) || "submission";
  return `northline-intake-${Date.now()}-${slug}`;
}

function validationConfirmationToken(): string {
  return randomBytes(24).toString("hex");
}

function validationStatus(value: string | undefined): "paid" | "retainer_active" | undefined {
  const normalized = normalizeField(value);
  if (normalized === "paid" || normalized === "retainer_active") {
    return normalized;
  }
  return undefined;
}

function isValidationSubmission(submission: NorthlineIntakeSubmission): boolean {
  return normalizeField(submission.source) === "northline-validation-page";
}

function isoFromUnixTimestamp(value: number | undefined): string | undefined {
  if (typeof value !== "number") {
    return undefined;
  }
  return new Date(value * 1000).toISOString();
}

function keepRecentEventIds(values: string[], nextValue?: string): string[] {
  if (!nextValue) {
    return values.slice(-MAX_PROCESSED_STRIPE_EVENT_IDS);
  }
  return [...values.filter((value) => value !== nextValue), nextValue].slice(
    -MAX_PROCESSED_STRIPE_EVENT_IDS
  );
}

function safeCompareHex(left: string, right: string): boolean {
  try {
    const leftBuffer = Buffer.from(left, "hex");
    const rightBuffer = Buffer.from(right, "hex");
    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
  } catch {
    return false;
  }
}

function stripeSignatureMatches(secret: string, rawBody: string, signatureHeader: string): boolean {
  const parsed = signatureHeader
    .split(",")
    .map((part) => part.trim())
    .reduce<Record<string, string[]>>((accumulator, part) => {
      const [key, value] = part.split("=", 2);
      if (!key || !value) {
        return accumulator;
      }
      accumulator[key] = [...(accumulator[key] ?? []), value];
      return accumulator;
    }, {});
  const timestamp = Number(parsed.t?.[0]);
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  if (Math.abs(Date.now() / 1000 - timestamp) > STRIPE_WEBHOOK_TOLERANCE_SECONDS) {
    return false;
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return (parsed.v1 ?? []).some((candidate) => safeCompareHex(expected, candidate));
}

function validationSubmissionIdFromReference(referenceId: string | undefined): string | undefined {
  const normalized = normalizeField(referenceId);
  if (!normalized) {
    return undefined;
  }
  if (normalized.startsWith("validation:")) {
    const submissionId = normalized.slice("validation:".length).trim();
    return submissionId || undefined;
  }
  return normalized;
}

function proposalPaymentReference(referenceId: string | undefined): {
  clientId: string;
  status?: "paid" | "retainer_active";
} | undefined {
  const normalized = normalizeField(referenceId);
  if (!normalized || normalized.startsWith("validation:")) {
    return undefined;
  }

  const parts = normalized.split(":").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    return undefined;
  }

  const prefix = parts[0]?.toLowerCase();
  if (!prefix || !["client", "proposal", "northline-client"].includes(prefix)) {
    return undefined;
  }

  const clientId = parts[1];
  if (!clientId) {
    return undefined;
  }

  return {
    clientId,
    status: validationStatus(parts[2])
  };
}

export class NorthlineSiteServer {
  private server?: Server;

  private readonly siteRoot: string;

  private readonly validationConfirmationStorePath: string;

  private automationQueue: Promise<void> = Promise.resolve();

  private readonly activeValidationSubmissionIds = new Set<string>();

  private readonly activeProposalPaymentClientIds = new Set<string>();

  constructor(
    private readonly config: AppConfig,
    private readonly options: NorthlineSiteServerOptions = {}
  ) {
    this.siteRoot = path.join(config.outputDir, "agency-site");
    this.validationConfirmationStorePath = path.join(
      config.stateDir,
      "northlineValidationConfirmations.json"
    );
  }

  async listen(): Promise<{ host: string; port: number }> {
    if (this.server) {
      const address = this.server.address() as AddressInfo;
      return { host: address.address, port: address.port };
    }

    this.server = createServer(async (req, res) => {
      try {
        await this.handle(req, res);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown Northline site error.";
        json(res, 500, { status: "error", message });
      }
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(this.config.northlineSite.port, this.config.northlineSite.bindHost, () => {
        resolve();
      });
    });

    const address = this.server.address() as AddressInfo;
    return { host: address.address, port: address.port };
  }

  async close(): Promise<void> {
    if (!this.server) {
      await this.waitForAutomation();
      return;
    }
    const activeServer = this.server;
    activeServer.closeIdleConnections?.();
    activeServer.closeAllConnections?.();
    await new Promise<void>((resolve, reject) => {
      activeServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    await this.waitForAutomation();
    this.server = undefined;
  }

  async waitForAutomation(): Promise<void> {
    await this.automationQueue.catch(() => undefined);
  }

  async getHealth(): Promise<{
    status: "ready";
    bindHost: string;
    port: number;
    siteRoot: string;
    submissionStorePath: string;
  }> {
    const address = this.server?.address();
    const livePort =
      address && typeof address === "object" ? address.port : this.config.northlineSite.port;
    return {
      status: "ready",
      bindHost: this.config.northlineSite.bindHost,
      port: livePort,
      siteRoot: this.siteRoot,
      submissionStorePath: this.config.northlineSite.submissionStorePath
    };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

    if (requestUrl.pathname === "/health" || requestUrl.pathname === "/api/health") {
      json(res, 200, await this.getHealth());
      return;
    }

    if (requestUrl.pathname === "/api/northline-intake") {
      if (req.method !== "POST") {
        json(res, 405, { status: "method_not_allowed" });
        return;
      }
      await this.handleSubmission(req, res);
      return;
    }

    if (requestUrl.pathname === "/api/northline-validation-confirm") {
      if (req.method !== "POST") {
        json(res, 405, { status: "method_not_allowed" });
        return;
      }
      await this.handleValidationConfirmation(req, res);
      return;
    }

    if (requestUrl.pathname === "/api/northline-validation-status") {
      if (req.method !== "GET") {
        json(res, 405, { status: "method_not_allowed" });
        return;
      }
      await this.handleValidationStatus(requestUrl, res);
      return;
    }

    if (requestUrl.pathname === "/api/northline-stripe-webhook") {
      if (req.method !== "POST") {
        json(res, 405, { status: "method_not_allowed" });
        return;
      }
      await this.handleStripeWebhook(req, res);
      return;
    }

    await this.serveStatic(requestUrl.pathname, res);
  }

  private async handleSubmission(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const payload = await this.parseSubmission(req);
    const submission: NorthlineIntakeSubmission = {
      id: intakeId(payload.businessName ?? payload.ownerName ?? "operator"),
      receivedAt: new Date().toISOString(),
      remoteAddress: normalizeField(firstHeaderValue(req.headers["x-forwarded-for"])) ?? req.socket.remoteAddress,
      userAgent: normalizeField(firstHeaderValue(req.headers["user-agent"])),
      ...payload
    };
    const nextStore = await this.appendSubmission(submission);
    await this.notifySubmission(submission);
    const validationConfirmation = await this.issueValidationConfirmation(submission);
    this.queueSubmissionAutomation(submission);

    const prefersJson =
      firstHeaderValue(req.headers.accept)?.includes("application/json") === true ||
      firstHeaderValue(req.headers["content-type"])?.includes("application/json") === true;

    if (prefersJson) {
      json(res, 200, {
        status: "ok",
        submissionId: submission.id,
        storedCount: nextStore.submissions.length,
        redirectTo: "/thank-you.html",
        validationConfirmation: validationConfirmation
          ? {
              autoHandoffEnabled: Boolean(this.config.northlineStripe.webhookSecret),
              checkoutReference: `validation:${submission.id}`,
              confirmationToken: validationConfirmation.token,
              endpoint: "/api/northline-validation-confirm",
              statusEndpoint: "/api/northline-validation-status",
              fallbackCommand: `npm run dev -- northline-validation-run --submission ${submission.id}`
            }
          : undefined
      });
      return;
    }

    redirect(res, "/thank-you.html");
  }

  private queueSubmissionAutomation(submission: NorthlineIntakeSubmission): void {
    if (!this.options.onSubmissionStored) {
      return;
    }

    this.automationQueue = this.automationQueue
      .catch(() => undefined)
      .then(() => this.options.onSubmissionStored?.(submission))
      .catch((error) => {
        const message = error instanceof Error ? error.stack ?? error.message : String(error);
        console.error(
          `[NorthlineSiteServer] Immediate automation failed for ${submission.id}: ${message}`
        );
      });
  }

  private async handleValidationConfirmation(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    if (!this.options.onValidationConfirmed) {
      json(res, 503, {
        status: "unavailable",
        message: "Hosted Northline validation handoff is not configured on this server."
      });
      return;
    }

    const parsed = await this.parseValidationConfirmation(req);
    if (!parsed.submissionId || !parsed.confirmationToken) {
      json(res, 400, {
        status: "invalid_request",
        message: "submissionId and confirmationToken are required."
      });
      return;
    }
    if (parsed.statusRaw && !parsed.status) {
      json(res, 400, {
        status: "invalid_request",
        message: "status must be paid or retainer_active when it is provided."
      });
      return;
    }

    const submission = await this.findSubmission(parsed.submissionId);
    if (!submission) {
      json(res, 404, {
        status: "not_found",
        message: `Validation submission ${parsed.submissionId} was not found.`
      });
      return;
    }
    if (!isValidationSubmission(submission)) {
      json(res, 403, {
        status: "forbidden",
        message: "Hosted validation handoff is only available for validation-page submissions."
      });
      return;
    }

    const confirmation = await this.findValidationConfirmation(parsed.submissionId);
    if (!confirmation || confirmation.token !== parsed.confirmationToken) {
      json(res, 403, {
        status: "forbidden",
        message: "Validation confirmation token is missing or invalid."
      });
      return;
    }

    if (this.activeValidationSubmissionIds.has(parsed.submissionId)) {
      json(res, 409, {
        status: "already_running",
        message: `Validation handoff for ${parsed.submissionId} is already running.`
      });
      return;
    }

    try {
      const result = await this.runValidationConfirmation({
        confirmation,
        formEndpoint: parsed.formEndpoint,
        status: parsed.status ?? "retainer_active",
        submissionId: parsed.submissionId
      });
      json(res, 200, {
        status: "ok",
        submissionId: parsed.submissionId,
        result
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Hosted validation handoff failed.";
      json(res, 500, {
        status: "error",
        message
      });
    }
  }

  private async handleValidationStatus(
    requestUrl: URL,
    res: ServerResponse
  ): Promise<void> {
    const submissionId = normalizeFirstParam(requestUrl.searchParams, ["submissionId"]);
    const confirmationToken = normalizeFirstParam(requestUrl.searchParams, ["confirmationToken", "token"]);
    if (!submissionId || !confirmationToken) {
      json(res, 400, {
        status: "invalid_request",
        message: "submissionId and confirmationToken are required."
      });
      return;
    }

    const confirmation = await this.findValidationConfirmation(submissionId);
    if (!confirmation || confirmation.token !== confirmationToken) {
      json(res, 403, {
        status: "forbidden",
        message: "Validation confirmation token is missing or invalid."
      });
      return;
    }

    json(res, 200, {
      status: "ok",
      submissionId,
      autoHandoffEnabled: Boolean(this.config.northlineStripe.webhookSecret),
      confirmation: {
        createdAt: confirmation.createdAt,
        lastConfirmedAt: confirmation.lastConfirmedAt,
        lastResult: confirmation.lastResult,
        lastStripeCompletedAt: confirmation.lastStripeCompletedAt,
        lastStripeCustomerEmail: confirmation.lastStripeCustomerEmail,
        lastStripeEventId: confirmation.lastStripeEventId,
        lastStripeLivemode: confirmation.lastStripeLivemode,
        lastStripeReferenceId: confirmation.lastStripeReferenceId,
        lastStripeSessionId: confirmation.lastStripeSessionId
      }
    });
  }

  private async handleStripeWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const webhookSecret = this.config.northlineStripe.webhookSecret;
    if (!webhookSecret) {
      json(res, 503, {
        status: "unavailable",
        message: "Stripe webhook handling is not configured on this server."
      });
      return;
    }

    const signatureHeader = firstHeaderValue(req.headers["stripe-signature"]);
    if (!signatureHeader) {
      json(res, 400, {
        status: "invalid_request",
        message: "Missing Stripe-Signature header."
      });
      return;
    }

    const rawBody = await readRequestBody(req);
    if (!stripeSignatureMatches(webhookSecret, rawBody, signatureHeader)) {
      json(res, 400, {
        status: "invalid_signature",
        message: "Stripe signature verification failed."
      });
      return;
    }

    let event: StripeWebhookEvent;
    try {
      event = JSON.parse(rawBody || "{}") as StripeWebhookEvent;
    } catch {
      json(res, 400, {
        status: "invalid_request",
        message: "Stripe webhook body must be valid JSON."
      });
      return;
    }
    const eventId = normalizeField(event.id);
    if (!eventId) {
      json(res, 400, {
        status: "invalid_request",
        message: "Stripe webhook event is missing an id."
      });
      return;
    }

    const store = await this.readValidationConfirmationStore();
    if ((store.processedStripeEventIds ?? []).includes(eventId)) {
      json(res, 200, {
        status: "duplicate",
        eventId
      });
      return;
    }

    if (event.type !== "checkout.session.completed") {
      await this.saveProcessedStripeEventId(eventId);
      json(res, 200, {
        status: "ignored",
        eventId,
        eventType: event.type ?? "unknown"
      });
      return;
    }

    const session = event.data?.object;
    if (!session) {
      json(res, 400, {
        status: "invalid_request",
        message: "Stripe webhook event is missing a checkout session payload."
      });
      return;
    }

    if (normalizeField(session.payment_status) && normalizeField(session.payment_status) !== "paid") {
      await this.saveProcessedStripeEventId(eventId);
      json(res, 200, {
        status: "ignored",
        eventId,
        reason: `payment_status=${session.payment_status}`
      });
      return;
    }

    const confirmationLookup = await this.findValidationConfirmationForCheckout(session);
    if (confirmationLookup) {
      const stripeContext = {
        completedAt: isoFromUnixTimestamp(event.created),
        customerEmail: normalizeField(session.customer_details?.email ?? undefined),
        eventId,
        livemode: typeof event.livemode === "boolean" ? event.livemode : session.livemode,
        referenceId: normalizeField(session.client_reference_id ?? undefined),
        sessionId: normalizeField(session.id)
      };

      if (this.activeValidationSubmissionIds.has(confirmationLookup.submissionId)) {
        await this.saveValidationConfirmation(
          {
            ...confirmationLookup.confirmation,
            lastStripeCompletedAt: stripeContext.completedAt,
            lastStripeCustomerEmail: stripeContext.customerEmail,
            lastStripeEventId: stripeContext.eventId,
            lastStripeLivemode: stripeContext.livemode,
            lastStripeReferenceId: stripeContext.referenceId,
            lastStripeSessionId: stripeContext.sessionId
          },
          { processedStripeEventId: eventId }
        );
        json(res, 200, {
          status: "already_running",
          eventId,
          submissionId: confirmationLookup.submissionId
        });
        return;
      }

      try {
        const result = await this.runValidationConfirmation({
          confirmation: confirmationLookup.confirmation,
          status: "retainer_active",
          stripeContext,
          submissionId: confirmationLookup.submissionId
        });
        json(res, 200, {
          status: "ok",
          eventId,
          submissionId: confirmationLookup.submissionId,
          result
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Stripe validation handoff failed.";
        json(res, 500, {
          status: "error",
          eventId,
          message
        });
      }
      return;
    }

    const proposalPayment = this.findProposalPaymentForCheckout(session);
    if (!proposalPayment) {
      await this.saveProcessedStripeEventId(eventId);
      json(res, 200, {
        status: "ignored",
        eventId,
        reason: "no_checkout_match"
      });
      return;
    }

    if (!this.options.onProposalPaymentCompleted) {
      json(res, 503, {
        status: "unavailable",
        eventId,
        message: "Hosted Northline proposal-payment handoff is not configured on this server."
      });
      return;
    }

    const proposalStripeContext = {
      customerEmail: normalizeField(session.customer_details?.email ?? undefined),
      eventId,
      referenceId: normalizeField(session.client_reference_id ?? undefined),
      sessionId: normalizeField(session.id)
    };

    if (this.activeProposalPaymentClientIds.has(proposalPayment.clientId)) {
      await this.saveProcessedStripeEventId(eventId);
      json(res, 200, {
        status: "already_running",
        eventId,
        clientId: proposalPayment.clientId
      });
      return;
    }

    try {
      const result = await this.runProposalPaymentCompletion({
        clientId: proposalPayment.clientId,
        status: proposalPayment.status,
        formEndpoint: proposalPayment.formEndpoint,
        stripeContext: proposalStripeContext
      });
      await this.saveProcessedStripeEventId(eventId);
      json(res, 200, {
        status: "ok",
        eventId,
        clientId: proposalPayment.clientId,
        result
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stripe proposal-payment handoff failed.";
      json(res, 500, {
        status: "error",
        eventId,
        message
      });
    }
  }

  private async parseSubmission(req: IncomingMessage): Promise<NorthlineIntakePayload> {
    const rawBody = await readRequestBody(req);
    const contentType = firstHeaderValue(req.headers["content-type"]) ?? "";

    if (contentType.includes("application/json")) {
      const parsed = JSON.parse(rawBody || "{}") as Record<string, unknown>;
      return {
        ownerName: normalizeFirst(parsed, ["ownerName", "operatorName", "contactName"]),
        businessName: normalizeFirst(parsed, ["businessName"]),
        email: normalizeFirst(parsed, ["email"]),
        phone: normalizeFirst(parsed, ["phone"]),
        serviceArea: normalizeFirst(parsed, ["serviceArea", "coverageArea", "targetArea"]),
        primaryServices: normalizeFirst(parsed, ["primaryServices", "jobType", "targetJobs"]),
        preferredCallWindow: normalizeFirst(parsed, ["preferredCallWindow", "callWindow", "reviewWindow"]),
        contactPreference: normalizeFirst(parsed, ["contactPreference", "replyPreference"]),
        website: normalizeFirst(parsed, ["website", "pageUrl"]),
        leadGoal: normalizeFirst(parsed, ["leadGoal", "bestOutcome", "nextGoal"]),
        biggestLeak: normalizeFirst(parsed, ["biggestLeak", "responseGap", "mainProblem"]),
        notes: normalizeFirst(parsed, ["notes"]),
        source: normalizeFirst(parsed, ["source"])
      };
    }

    const params = new URLSearchParams(rawBody);
    return {
      ownerName: normalizeFirstParam(params, ["ownerName", "operatorName", "contactName"]),
      businessName: normalizeFirstParam(params, ["businessName"]),
      email: normalizeFirstParam(params, ["email"]),
      phone: normalizeFirstParam(params, ["phone"]),
      serviceArea: normalizeFirstParam(params, ["serviceArea", "coverageArea", "targetArea"]),
      primaryServices: normalizeFirstParam(params, ["primaryServices", "jobType", "targetJobs"]),
      preferredCallWindow: normalizeFirstParam(params, ["preferredCallWindow", "callWindow", "reviewWindow"]),
      contactPreference: normalizeFirstParam(params, ["contactPreference", "replyPreference"]),
      website: normalizeFirstParam(params, ["website", "pageUrl"]),
      leadGoal: normalizeFirstParam(params, ["leadGoal", "bestOutcome", "nextGoal"]),
      biggestLeak: normalizeFirstParam(params, ["biggestLeak", "responseGap", "mainProblem"]),
      notes: normalizeFirstParam(params, ["notes"]),
      source: normalizeFirstParam(params, ["source"])
    };
  }

  private async parseValidationConfirmation(req: IncomingMessage): Promise<{
    submissionId?: string;
    confirmationToken?: string;
    status?: "paid" | "retainer_active";
    statusRaw?: string;
    formEndpoint?: string;
  }> {
    const rawBody = await readRequestBody(req);
    const contentType = firstHeaderValue(req.headers["content-type"]) ?? "";

    if (contentType.includes("application/json")) {
      const parsed = JSON.parse(rawBody || "{}") as Record<string, unknown>;
      const statusRaw = normalizeFirst(parsed, ["status"]);
      return {
        submissionId: normalizeFirst(parsed, ["submissionId"]),
        confirmationToken: normalizeFirst(parsed, ["confirmationToken", "token"]),
        statusRaw,
        status: validationStatus(statusRaw),
        formEndpoint: normalizeFirst(parsed, ["formEndpoint"])
      };
    }

    const params = new URLSearchParams(rawBody);
    const statusRaw = normalizeFirstParam(params, ["status"]);
    return {
      submissionId: normalizeFirstParam(params, ["submissionId"]),
      confirmationToken: normalizeFirstParam(params, ["confirmationToken", "token"]),
      statusRaw,
      status: validationStatus(statusRaw),
      formEndpoint: normalizeFirstParam(params, ["formEndpoint"])
    };
  }

  private async appendSubmission(submission: NorthlineIntakeSubmission): Promise<{
    submissions: NorthlineIntakeSubmission[];
    lastReceivedAt: string;
  }> {
    const existing = await readJsonFile<NorthlineIntakeStore>(
      this.config.northlineSite.submissionStorePath,
      { submissions: [] }
    );
    const submissions = Array.isArray(existing) ? existing : existing.submissions;
    const nextStore = {
      submissions: [...submissions, submission],
      lastReceivedAt: submission.receivedAt
    };
    await writeJsonFile(this.config.northlineSite.submissionStorePath, nextStore);
    return nextStore;
  }

  private async issueValidationConfirmation(
    submission: NorthlineIntakeSubmission
  ): Promise<NorthlineValidationConfirmationRecord | undefined> {
    if (!this.options.onValidationConfirmed || !isValidationSubmission(submission)) {
      return undefined;
    }

    const record: NorthlineValidationConfirmationRecord = {
      submissionId: submission.id,
      token: validationConfirmationToken(),
      createdAt: submission.receivedAt
    };
    await this.saveValidationConfirmation(record);
    return record;
  }

  private async findSubmission(
    submissionId: string
  ): Promise<NorthlineIntakeSubmission | undefined> {
    const existing = await readJsonFile<NorthlineIntakeStore>(
      this.config.northlineSite.submissionStorePath,
      { submissions: [] }
    );
    const submissions = Array.isArray(existing) ? existing : existing.submissions;
    return submissions.find((submission) => submission.id === submissionId);
  }

  private async readValidationConfirmationStore(): Promise<NorthlineValidationConfirmationStore> {
    return readJsonFile<NorthlineValidationConfirmationStore>(
      this.validationConfirmationStorePath,
      { confirmations: [] }
    );
  }

  private async findValidationConfirmation(
    submissionId: string
  ): Promise<NorthlineValidationConfirmationRecord | undefined> {
    const store = await this.readValidationConfirmationStore();
    return store.confirmations.find((record) => record.submissionId === submissionId);
  }

  private async saveValidationConfirmation(
    record: NorthlineValidationConfirmationRecord,
    options?: { processedStripeEventId?: string }
  ): Promise<void> {
    const store = await this.readValidationConfirmationStore();
    const confirmations = store.confirmations.filter(
      (entry) => entry.submissionId !== record.submissionId
    );
    confirmations.push(record);
    const processedStripeEventIds = options?.processedStripeEventId
      ? keepRecentEventIds([
          ...(store.processedStripeEventIds ?? []),
          options.processedStripeEventId
        ])
      : store.processedStripeEventIds;
    await writeJsonFile(this.validationConfirmationStorePath, {
      confirmations,
      processedStripeEventIds,
      updatedAt: new Date().toISOString()
    });
  }

  private async saveProcessedStripeEventId(eventId: string): Promise<void> {
    const store = await this.readValidationConfirmationStore();
    await writeJsonFile(this.validationConfirmationStorePath, {
      confirmations: store.confirmations,
      processedStripeEventIds: keepRecentEventIds([
        ...(store.processedStripeEventIds ?? []),
        eventId
      ]),
      updatedAt: new Date().toISOString()
    });
  }

  private async findValidationConfirmationForCheckout(
    session: StripeCheckoutSession
  ): Promise<
    | {
        submissionId: string;
        confirmation: NorthlineValidationConfirmationRecord;
      }
    | undefined
  > {
    const candidates = [
      normalizeField(session.client_reference_id ?? undefined),
      normalizeField(session.metadata?.submissionId),
      normalizeField(session.metadata?.validationSubmissionId)
    ].filter((value): value is string => Boolean(value));

    for (const candidate of candidates) {
      const submissionId = validationSubmissionIdFromReference(candidate) ?? candidate;
      const confirmation = await this.findValidationConfirmation(submissionId);
      if (confirmation) {
        return {
          submissionId,
          confirmation
        };
      }
    }

    return undefined;
  }

  private findProposalPaymentForCheckout(
    session: StripeCheckoutSession
  ): NorthlineProposalPaymentMatch | undefined {
    const reference = proposalPaymentReference(normalizeField(session.client_reference_id ?? undefined));
    const clientId =
      normalizeField(session.metadata?.northlineClientId) ??
      normalizeField(session.metadata?.clientId) ??
      reference?.clientId;
    const status =
      validationStatus(normalizeField(session.metadata?.northlineBillingStatus)) ??
      validationStatus(normalizeField(session.metadata?.billingStatus)) ??
      reference?.status;

    if (!clientId || !status) {
      return undefined;
    }

    return {
      clientId,
      status,
      formEndpoint:
        normalizeField(session.metadata?.northlineFormEndpoint) ??
        normalizeField(session.metadata?.formEndpoint)
    };
  }

  private async runValidationConfirmation(options: {
    confirmation: NorthlineValidationConfirmationRecord;
    submissionId: string;
    status: "paid" | "retainer_active";
    formEndpoint?: string;
    stripeContext?: {
      completedAt?: string;
      customerEmail?: string;
      eventId: string;
      livemode?: boolean;
      referenceId?: string;
      sessionId?: string;
    };
  }): Promise<NorthlineValidationRunResult> {
    if (!this.options.onValidationConfirmed) {
      throw new Error("Hosted Northline validation handoff is not configured on this server.");
    }

    const formEndpoint = options.formEndpoint ?? this.defaultValidationFormEndpoint();
    await this.waitForAutomation();
    this.activeValidationSubmissionIds.add(options.submissionId);
    try {
      const result = await this.options.onValidationConfirmed({
        submissionId: options.submissionId,
        status: options.status,
        formEndpoint
      });
      await this.saveValidationConfirmation(
        {
          ...options.confirmation,
          lastConfirmedAt: new Date().toISOString(),
          lastResult: result,
          lastStripeCompletedAt:
            options.stripeContext?.completedAt ?? options.confirmation.lastStripeCompletedAt,
          lastStripeCustomerEmail:
            options.stripeContext?.customerEmail ?? options.confirmation.lastStripeCustomerEmail,
          lastStripeEventId:
            options.stripeContext?.eventId ?? options.confirmation.lastStripeEventId,
          lastStripeLivemode:
            options.stripeContext?.livemode ?? options.confirmation.lastStripeLivemode,
          lastStripeReferenceId:
            options.stripeContext?.referenceId ?? options.confirmation.lastStripeReferenceId,
          lastStripeSessionId:
            options.stripeContext?.sessionId ?? options.confirmation.lastStripeSessionId
        },
        options.stripeContext?.eventId
          ? { processedStripeEventId: options.stripeContext.eventId }
          : undefined
      );
      return result;
    } finally {
      this.activeValidationSubmissionIds.delete(options.submissionId);
    }
  }

  private async runProposalPaymentCompletion(options: {
    clientId: string;
    status: "paid" | "retainer_active";
    formEndpoint?: string;
    stripeContext: {
      customerEmail?: string;
      eventId: string;
      referenceId?: string;
      sessionId?: string;
    };
  }): Promise<Awaited<ReturnType<NonNullable<NorthlineSiteServerOptions["onProposalPaymentCompleted"]>>>> {
    if (!this.options.onProposalPaymentCompleted) {
      throw new Error("Hosted Northline proposal-payment handoff is not configured on this server.");
    }

    await this.waitForAutomation();
    this.activeProposalPaymentClientIds.add(options.clientId);
    try {
      return this.options.onProposalPaymentCompleted({
        clientId: options.clientId,
        status: options.status,
        formEndpoint: options.formEndpoint,
        stripeContext: options.stripeContext
      });
    } finally {
      this.activeProposalPaymentClientIds.delete(options.clientId);
    }
  }

  private defaultValidationFormEndpoint(): string | undefined {
    const action = normalizeField(this.config.business.leadFormAction);
    if (!action) {
      return undefined;
    }
    if (/^https?:\/\//i.test(action)) {
      return action;
    }
    const siteUrl = normalizeField(this.config.business.siteUrl);
    if (!siteUrl) {
      return undefined;
    }
    try {
      return new URL(action, siteUrl).toString();
    } catch {
      return undefined;
    }
  }

  private async notifySubmission(submission: NorthlineIntakeSubmission): Promise<void> {
    const subject = `[Northline Intake] ${submission.businessName ?? submission.ownerName ?? "New operator"}`;
    const body = [
      `Received at: ${submission.receivedAt}`,
      `Submission ID: ${submission.id}`,
      `Owner name: ${submission.ownerName ?? "Not provided"}`,
      `Business name: ${submission.businessName ?? "Not provided"}`,
      `Email: ${submission.email ?? "Not provided"}`,
      `Phone: ${submission.phone ?? "Not provided"}`,
      `Service area: ${submission.serviceArea ?? "Not provided"}`,
      `Primary services: ${submission.primaryServices ?? "Not provided"}`,
      `Preferred call window: ${submission.preferredCallWindow ?? "Not provided"}`,
      `Contact preference: ${submission.contactPreference ?? "Not provided"}`,
      `Website: ${submission.website ?? "Not provided"}`,
      `Best outcome: ${submission.leadGoal ?? "Not provided"}`,
      `Source: ${submission.source ?? "northline-website-intake"}`,
      "",
      "Booked-job leak:",
      submission.biggestLeak ?? "Not provided",
      "",
      "Notes:",
      submission.notes ?? "None",
      "",
      `Remote address: ${submission.remoteAddress ?? "Unknown"}`,
      `User agent: ${submission.userAgent ?? "Unknown"}`
    ].join("\n");

    const archivePath = path.join(
      this.config.notificationDir,
      "northline-intake",
      `${submission.id}.txt`
    );
    const latestPath = path.join(this.config.notificationDir, "northline-intake-latest.txt");
    await writeTextFile(archivePath, `${subject}\n\n${body}\n`);
    await writeTextFile(latestPath, `${subject}\n\n${body}\n`);

    if (!this.config.smtp) {
      return;
    }

    const recipients = [...new Set([this.config.business.salesEmail, this.config.business.approvalEmail])]
      .map((value) => value.trim())
      .filter((value) => Boolean(value) && !/@example\.(com|org|net)$/i.test(value));
    if (recipients.length === 0) {
      return;
    }

    const transporter = nodemailer.createTransport({
      host: this.config.smtp.host,
      port: this.config.smtp.port,
      secure: this.config.smtp.secure,
      auth: {
        user: this.config.smtp.user,
        pass: this.config.smtp.pass
      }
    });

    await transporter.sendMail({
      from: this.config.smtp.from,
      to: recipients.join(", "),
      subject,
      text: body
    });
  }

  private async serveStatic(pathname: string, res: ServerResponse): Promise<void> {
    const requestedPath = pathname === "/" ? "/index.html" : pathname;
    const relativePath = path.posix.normalize(decodeURIComponent(requestedPath));
    if (!relativePath.startsWith("/")) {
      textResponse(res, 400, "Bad request.");
      return;
    }

    const resolvedPath = path.resolve(this.siteRoot, `.${relativePath}`);
    const siteRootWithSep = `${this.siteRoot}${path.sep}`;
    if (resolvedPath !== this.siteRoot && !resolvedPath.startsWith(siteRootWithSep)) {
      textResponse(res, 403, "Forbidden.");
      return;
    }

    try {
      const body = await readFile(resolvedPath);
      res.writeHead(200, {
        "Content-Type": contentTypeFor(resolvedPath),
        "Content-Length": body.byteLength
      });
      res.end(body);
    } catch {
      textResponse(res, 404, "Not found.");
    }
  }
}
