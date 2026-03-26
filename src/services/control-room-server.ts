import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import type { AddressInfo } from "node:net";
import type { AppConfig } from "../config.js";
import { createControlRoomDefaultSecret, createSignedControlRoomSession, readSignedControlRoomSession, verifyControlRoomPassword } from "../lib/control-room-auth.js";
import { ControlRoomRenderer } from "./control-room-renderer.js";
import { ControlRoomSnapshotService } from "./control-room-snapshot.js";
import { FileStore } from "../storage/store.js";

type RouteMatch =
  | { type: "home" }
  | { type: "login" }
  | { type: "logout" }
  | { type: "business"; businessId: string }
  | { type: "department"; businessId: string; departmentId: string }
  | { type: "api-snapshot" }
  | { type: "api-business"; businessId: string }
  | { type: "api-activity" }
  | { type: "api-approvals" }
  | { type: "api-tasks" }
  | { type: "api-health" }
  | { type: "api-stream" }
  | { type: "missing" };

function html(res: ServerResponse, statusCode: number, body: string): void {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function json(res: ServerResponse, statusCode: number, body: unknown): void {
  const serialized = `${JSON.stringify(body, null, 2)}\n`;
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(serialized)
  });
  res.end(serialized);
}

function redirect(res: ServerResponse, location: string, cookies?: string[]): void {
  res.writeHead(303, {
    Location: location,
    ...(cookies ? { "Set-Cookie": cookies } : {})
  });
  res.end();
}

function parseCookies(req: IncomingMessage): Map<string, string> {
  const values = new Map<string, string>();
  const raw = req.headers.cookie;
  if (!raw) {
    return values;
  }

  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (!key) {
      continue;
    }
    values.set(key, decodeURIComponent(rest.join("=")));
  }

  return values;
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function routePath(pathname: string): RouteMatch {
  if (pathname === "/") return { type: "home" };
  if (pathname === "/login") return { type: "login" };
  if (pathname === "/logout") return { type: "logout" };
  if (pathname === "/api/control-room/snapshot") return { type: "api-snapshot" };
  if (pathname === "/api/control-room/activity") return { type: "api-activity" };
  if (pathname === "/api/control-room/approvals") return { type: "api-approvals" };
  if (pathname === "/api/control-room/tasks") return { type: "api-tasks" };
  if (pathname === "/api/control-room/health") return { type: "api-health" };
  if (pathname === "/api/control-room/stream") return { type: "api-stream" };

  const businessMatch = pathname.match(/^\/business\/([^/]+)$/);
  if (businessMatch?.[1]) {
    return { type: "business", businessId: decodeURIComponent(businessMatch[1]) };
  }

  const departmentMatch = pathname.match(/^\/department\/([^/]+)\/([^/]+)$/);
  if (departmentMatch?.[1] && departmentMatch?.[2]) {
    return {
      type: "department",
      businessId: decodeURIComponent(departmentMatch[1]),
      departmentId: decodeURIComponent(departmentMatch[2])
    };
  }

  const apiBusinessMatch = pathname.match(/^\/api\/control-room\/business\/([^/]+)$/);
  if (apiBusinessMatch?.[1]) {
    return { type: "api-business", businessId: decodeURIComponent(apiBusinessMatch[1]) };
  }

  return { type: "missing" };
}

export class ControlRoomServer {
  private readonly snapshotService: ControlRoomSnapshotService;

  private readonly renderer: ControlRoomRenderer;

  private server?: Server;

  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {
    this.snapshotService = new ControlRoomSnapshotService(config, store);
    this.renderer = new ControlRoomRenderer();
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
        const message = error instanceof Error ? error.message : "Unknown control-room error.";
        json(res, 500, { status: "error", message });
      }
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(this.config.controlRoom.port, this.config.controlRoom.bindHost, () => {
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
    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    this.server = undefined;
  }

  async getHealth() {
    const snapshotHealth = await this.snapshotService.getHealthReport();
    const authConfigured = Boolean(this.resolvePasswordHash());
    return {
      status:
        snapshotHealth.status === "ready" && authConfigured ? "ready" : "degraded",
      authConfigured,
      bindHost: this.config.controlRoom.bindHost,
      port: this.config.controlRoom.port,
      snapshot: snapshotHealth
    };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    const route = routePath(url.pathname);
    const isAuthenticated = this.isAuthenticated(req);

    if (route.type === "api-health") {
      json(res, 200, await this.getHealth());
      return;
    }

    if (route.type === "login") {
      if (req.method === "POST") {
        await this.handleLoginSubmit(req, res);
        return;
      }
      const nextPath = url.searchParams.get("next") ?? "/";
      html(
        res,
        200,
        this.renderer.renderLoginPage({
          engineName: this.config.engine.name,
          nextPath
        })
      );
      return;
    }

    if (route.type === "logout") {
      redirect(res, "/login", [this.clearSessionCookie()]);
      return;
    }

    if (!isAuthenticated) {
      redirect(res, `/login?next=${encodeURIComponent(url.pathname)}`);
      return;
    }

    switch (route.type) {
      case "home":
      case "business":
      case "department": {
        const snapshot = await this.snapshotService.buildSnapshot();
        html(
          res,
          200,
          this.renderer.renderPage(snapshot, {
            appMode: "hosted",
            selectedBusinessId:
              route.type === "business" || route.type === "department"
                ? route.businessId
                : undefined,
            selectedDepartmentId:
              route.type === "department" ? route.departmentId : undefined
          })
        );
        return;
      }
      case "api-snapshot": {
        json(res, 200, await this.snapshotService.buildSnapshot());
        return;
      }
      case "api-business": {
        const snapshot = await this.snapshotService.buildSnapshot();
        const business = snapshot.businesses.find((entry) => entry.id === route.businessId);
        if (!business) {
          json(res, 404, { status: "missing", businessId: route.businessId });
          return;
        }
        json(res, 200, business);
        return;
      }
      case "api-activity": {
        const snapshot = await this.snapshotService.buildSnapshot();
        json(res, 200, snapshot.recentAudits);
        return;
      }
      case "api-approvals": {
        const snapshot = await this.snapshotService.buildSnapshot();
        json(res, 200, snapshot.approvals);
        return;
      }
      case "api-tasks": {
        const snapshot = await this.snapshotService.buildSnapshot();
        json(
          res,
          200,
          snapshot.businesses.flatMap((business) => business.recentTasks)
        );
        return;
      }
      case "api-stream": {
        await this.handleSse(req, res);
        return;
      }
      default: {
        json(res, 404, { status: "missing" });
      }
    }
  }

  private async handleLoginSubmit(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const passwordHash = this.resolvePasswordHash();
    if (!passwordHash) {
      html(
        res,
        503,
        this.renderer.renderLoginPage({
          engineName: this.config.engine.name,
          message: "Control-room auth is not configured yet. Add CONTROL_ROOM_PASSWORD_HASH."
        })
      );
      return;
    }

    const rawBody = await readRequestBody(req);
    const params = new URLSearchParams(rawBody);
    const password = params.get("password") ?? "";
    const nextPath = params.get("next") ?? "/";

    const matches = await verifyControlRoomPassword(password, passwordHash);
    if (!matches) {
      html(
        res,
        401,
        this.renderer.renderLoginPage({
          engineName: this.config.engine.name,
          message: "Password not accepted.",
          nextPath
        })
      );
      return;
    }

    redirect(res, this.safeRedirectPath(nextPath), [this.issueSessionCookie()]);
  }

  private async handleSse(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });

    let lastFingerprint = "";
    const pushSnapshot = async () => {
      const snapshot = await this.snapshotService.buildSnapshot();
      if (snapshot.fingerprint !== lastFingerprint) {
        lastFingerprint = snapshot.fingerprint;
        res.write(`event: snapshot\n`);
        res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
      } else {
        res.write(`event: ping\ndata: {"ok":true}\n\n`);
      }
    };

    await pushSnapshot();
    const timer = setInterval(() => {
      void pushSnapshot();
    }, 15000);

    req.on("close", () => {
      clearInterval(timer);
      res.end();
    });
  }

  private isAuthenticated(req: IncomingMessage): boolean {
    const cookies = parseCookies(req);
    const sessionSecret = this.resolveSessionSecret();
    return Boolean(
      readSignedControlRoomSession(cookies.get("control_room_session"), sessionSecret)
    );
  }

  private resolveSessionSecret(): string {
    return (
      this.config.controlRoom.sessionSecret ??
      createControlRoomDefaultSecret(
        `${this.config.engine.name}:${this.config.business.approvalEmail}:${this.config.controlRoom.port}`
      )
    );
  }

  private resolvePasswordHash(): string | undefined {
    return this.config.controlRoom.passwordHash;
  }

  private issueSessionCookie(): string {
    const value = createSignedControlRoomSession(
      this.resolveSessionSecret(),
      this.config.controlRoom.sessionTtlHours
    );
    return `control_room_session=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${this.config.controlRoom.sessionTtlHours * 60 * 60}`;
  }

  private clearSessionCookie(): string {
    return "control_room_session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0";
  }

  private safeRedirectPath(candidate: string): string {
    return candidate.startsWith("/") ? candidate : "/";
  }
}
