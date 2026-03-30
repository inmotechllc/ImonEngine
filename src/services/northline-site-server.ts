import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import type { AppConfig } from "../config.js";
import { readJsonFile, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";

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

export class NorthlineSiteServer {
  private server?: Server;

  private readonly siteRoot: string;

  constructor(private readonly config: AppConfig) {
    this.siteRoot = path.join(config.outputDir, "agency-site");
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
    this.server = undefined;
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

    const prefersJson =
      firstHeaderValue(req.headers.accept)?.includes("application/json") === true ||
      firstHeaderValue(req.headers["content-type"])?.includes("application/json") === true;

    if (prefersJson) {
      json(res, 200, {
        status: "ok",
        submissionId: submission.id,
        storedCount: nextStore.submissions.length,
        redirectTo: "/thank-you.html"
      });
      return;
    }

    redirect(res, "/thank-you.html");
  }

  private async parseSubmission(req: IncomingMessage): Promise<NorthlineIntakePayload> {
    const rawBody = await readRequestBody(req);
    const contentType = firstHeaderValue(req.headers["content-type"]) ?? "";

    if (contentType.includes("application/json")) {
      const parsed = JSON.parse(rawBody || "{}") as Record<string, unknown>;
      return {
        ownerName: normalizeField(parsed.ownerName),
        businessName: normalizeField(parsed.businessName),
        email: normalizeField(parsed.email),
        phone: normalizeField(parsed.phone),
        serviceArea: normalizeField(parsed.serviceArea),
        primaryServices: normalizeField(parsed.primaryServices),
        preferredCallWindow: normalizeField(parsed.preferredCallWindow),
        contactPreference: normalizeField(parsed.contactPreference),
        website: normalizeField(parsed.website),
        leadGoal: normalizeField(parsed.leadGoal),
        biggestLeak: normalizeField(parsed.biggestLeak),
        notes: normalizeField(parsed.notes),
        source: normalizeField(parsed.source)
      };
    }

    const params = new URLSearchParams(rawBody);
    return {
      ownerName: normalizeField(params.get("ownerName")),
      businessName: normalizeField(params.get("businessName")),
      email: normalizeField(params.get("email")),
      phone: normalizeField(params.get("phone")),
      serviceArea: normalizeField(params.get("serviceArea")),
      primaryServices: normalizeField(params.get("primaryServices")),
      preferredCallWindow: normalizeField(params.get("preferredCallWindow")),
      contactPreference: normalizeField(params.get("contactPreference")),
      website: normalizeField(params.get("website")),
      leadGoal: normalizeField(params.get("leadGoal")),
      biggestLeak: normalizeField(params.get("biggestLeak")),
      notes: normalizeField(params.get("notes")),
      source: normalizeField(params.get("source"))
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
      `Lead goal: ${submission.leadGoal ?? "Not provided"}`,
      `Source: ${submission.source ?? "northline-website-intake"}`,
      "",
      "Biggest leak:",
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
