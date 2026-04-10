import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { URL } from "node:url";
import { createConnection, type AddressInfo } from "node:net";
import type { AppConfig } from "../config.js";
import { ControlRoomRenderer } from "./control-room-renderer.js";
import { ControlRoomRemoteClient } from "./control-room-remote-client.js";

type LocalRouteMatch =
  | { type: "home" }
  | { type: "engine" }
  | { type: "login" }
  | { type: "logout" }
  | { type: "business"; businessId: string }
  | { type: "department"; businessId: string; departmentId: string }
  | { type: "api-snapshot" }
  | { type: "api-business"; businessId: string }
  | { type: "api-department"; businessId: string; departmentId: string }
  | { type: "api-chat-engine" }
  | { type: "api-chat-business"; businessId: string }
  | { type: "api-chat-department"; businessId: string; departmentId: string }
  | { type: "api-chat-apply"; actionId: string }
  | { type: "api-chat-dismiss"; actionId: string }
  | { type: "api-activity" }
  | { type: "api-approvals" }
  | { type: "api-tasks" }
  | { type: "api-health" }
  | { type: "command-engine-sync" }
  | { type: "command-activate-business" }
  | { type: "command-pause-business" }
  | { type: "command-route-task" }
  | { type: "command-resolve-approval" }
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

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(303, { Location: location });
  res.end();
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const raw = await readRequestBody(req);
  return JSON.parse(raw || "{}") as T;
}

function routePath(pathname: string): LocalRouteMatch {
  if (pathname === "/") return { type: "home" };
  if (pathname === "/engine") return { type: "engine" };
  if (pathname === "/login") return { type: "login" };
  if (pathname === "/logout") return { type: "logout" };
  if (pathname === "/api/control-room/snapshot") return { type: "api-snapshot" };
  if (pathname === "/api/control-room/chat/engine") return { type: "api-chat-engine" };
  if (pathname === "/api/control-room/activity") return { type: "api-activity" };
  if (pathname === "/api/control-room/approvals") return { type: "api-approvals" };
  if (pathname === "/api/control-room/tasks") return { type: "api-tasks" };
  if (pathname === "/api/control-room/health") return { type: "api-health" };
  if (pathname === "/api/control-room/commands/engine-sync") return { type: "command-engine-sync" };
  if (pathname === "/api/control-room/commands/activate-business") return { type: "command-activate-business" };
  if (pathname === "/api/control-room/commands/pause-business") return { type: "command-pause-business" };
  if (pathname === "/api/control-room/commands/route-task") return { type: "command-route-task" };
  if (pathname === "/api/control-room/commands/resolve-approval") return { type: "command-resolve-approval" };

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

  const apiChatBusinessMatch = pathname.match(/^\/api\/control-room\/chat\/business\/([^/]+)$/);
  if (apiChatBusinessMatch?.[1]) {
    return {
      type: "api-chat-business",
      businessId: decodeURIComponent(apiChatBusinessMatch[1])
    };
  }

  const apiDepartmentMatch = pathname.match(/^\/api\/control-room\/department\/([^/]+)\/([^/]+)$/);
  if (apiDepartmentMatch?.[1] && apiDepartmentMatch?.[2]) {
    return {
      type: "api-department",
      businessId: decodeURIComponent(apiDepartmentMatch[1]),
      departmentId: decodeURIComponent(apiDepartmentMatch[2])
    };
  }

  const apiChatDepartmentMatch = pathname.match(
    /^\/api\/control-room\/chat\/department\/([^/]+)\/([^/]+)$/
  );
  if (apiChatDepartmentMatch?.[1] && apiChatDepartmentMatch?.[2]) {
    return {
      type: "api-chat-department",
      businessId: decodeURIComponent(apiChatDepartmentMatch[1]),
      departmentId: decodeURIComponent(apiChatDepartmentMatch[2])
    };
  }

  const apiChatApplyMatch = pathname.match(
    /^\/api\/control-room\/chat\/actions\/([^/]+)\/apply$/
  );
  if (apiChatApplyMatch?.[1]) {
    return {
      type: "api-chat-apply",
      actionId: decodeURIComponent(apiChatApplyMatch[1])
    };
  }

  const apiChatDismissMatch = pathname.match(
    /^\/api\/control-room\/chat\/actions\/([^/]+)\/dismiss$/
  );
  if (apiChatDismissMatch?.[1]) {
    return {
      type: "api-chat-dismiss",
      actionId: decodeURIComponent(apiChatDismissMatch[1])
    };
  }

  return { type: "missing" };
}

export class ControlRoomLocalServer {
  private readonly renderer = new ControlRoomRenderer();

  private readonly remoteClient: ControlRoomRemoteClient;

  private server?: Server;

  private tunnelProcess?: ChildProcessWithoutNullStreams;

  private lastRemoteError?: string;

  constructor(private readonly config: AppConfig) {
    this.remoteClient = new ControlRoomRemoteClient(config.controlRoom.local.remoteUrl);
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
        const message = error instanceof Error ? error.message : "Unknown local control-room error.";
        json(res, 500, { status: "error", message });
      }
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(
        this.config.controlRoom.local.port,
        this.config.controlRoom.local.bindHost,
        () => resolve()
      );
    });

    const address = this.server.address() as AddressInfo;
    void this.ensureRemoteReady().catch(() => undefined);
    return { host: address.address, port: address.port };
  }

  async close(): Promise<void> {
    if (this.server) {
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

    if (this.tunnelProcess && !this.tunnelProcess.killed) {
      this.tunnelProcess.kill();
      this.tunnelProcess = undefined;
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    const route = routePath(url.pathname);

    if (route.type === "login") {
      if (req.method === "POST") {
        const rawBody = await readRequestBody(req);
        const params = new URLSearchParams(rawBody);
        try {
          await this.ensureRemoteReady();
          await this.remoteClient.login(params.get("password") ?? "", params.get("next") ?? "/");
          redirect(res, this.safeRedirectPath(params.get("next") ?? "/"));
        } catch (error) {
          const message = this.describeRemoteError(error);
          html(
            res,
            this.isRemoteAuthFailure(error) ? 401 : 503,
            this.renderer.renderLoginPage({
              engineName: this.config.engine.name,
              message,
              nextPath: params.get("next") ?? "/",
              intro:
                "This local operator app signs into the VPS control room and keeps all execution on the server."
            })
          );
        }
        return;
      }

      try {
        await this.ensureRemoteReady();
      } catch {
        // Keep the login page available even when the VPS tunnel or remote endpoint is failing.
      }

      html(
        res,
        200,
        this.renderer.renderLoginPage({
          engineName: this.config.engine.name,
          message: this.lastRemoteError,
          nextPath: url.searchParams.get("next") ?? "/",
          intro:
            "This local operator app signs into the VPS control room and keeps all execution on the server."
        })
      );
      return;
    }

    if (route.type === "logout") {
      this.remoteClient.logout();
      redirect(res, "/login");
      return;
    }

    if (!this.remoteClient.isAuthenticated()) {
      redirect(res, `/login?next=${encodeURIComponent(url.pathname)}`);
      return;
    }

    try {
      await this.ensureRemoteReady();
      switch (route.type) {
        case "home":
        case "engine":
        case "business":
        case "department": {
          const snapshot = await this.remoteClient.fetchSnapshot();
          html(
            res,
            200,
            this.renderer.renderPage(snapshot, {
              appMode: "local",
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
        case "api-snapshot":
          json(res, 200, await this.remoteClient.fetchSnapshot());
          return;
        case "api-business": {
          const snapshot = await this.remoteClient.fetchSnapshot();
          const business = snapshot.businesses.find((entry) => entry.id === route.businessId);
          if (!business) {
            json(res, 404, { status: "missing", message: `Business ${route.businessId} was not found.` });
            return;
          }
          json(res, 200, business);
          return;
        }
        case "api-department": {
          const snapshot = await this.remoteClient.fetchSnapshot();
          const workspace = snapshot.departmentWorkspaces.find(
            (entry) =>
              entry.businessId === route.businessId && entry.departmentId === route.departmentId
          );
          if (!workspace) {
            json(res, 404, {
              status: "missing",
              message: `Department ${route.departmentId} was not found for ${route.businessId}.`
            });
            return;
          }
          json(res, 200, workspace);
          return;
        }
        case "api-chat-engine": {
          if (req.method === "POST") {
            const body = await readJsonBody<{ message?: string }>(req);
            json(res, 200, await this.remoteClient.submitEngineChat(body.message ?? ""));
            return;
          }
          json(res, 200, await this.remoteClient.fetchEngineChat());
          return;
        }
        case "api-chat-business": {
          if (req.method === "POST") {
            const body = await readJsonBody<{ message?: string }>(req);
            json(
              res,
              200,
              await this.remoteClient.submitBusinessChat(route.businessId, body.message ?? "")
            );
            return;
          }
          json(res, 200, await this.remoteClient.fetchBusinessChat(route.businessId));
          return;
        }
        case "api-chat-department": {
          if (req.method === "POST") {
            const body = await readJsonBody<{ message?: string }>(req);
            json(
              res,
              200,
              await this.remoteClient.submitDepartmentChat(
                route.businessId,
                route.departmentId,
                body.message ?? ""
              )
            );
            return;
          }
          json(
            res,
            200,
            await this.remoteClient.fetchDepartmentChat(route.businessId, route.departmentId)
          );
          return;
        }
        case "api-chat-apply":
          json(res, 200, await this.remoteClient.applyChatAction(route.actionId));
          return;
        case "api-chat-dismiss":
          json(res, 200, await this.remoteClient.dismissChatAction(route.actionId));
          return;
        case "api-activity":
          json(res, 200, await this.remoteClient.fetchActivity());
          return;
        case "api-approvals":
          json(res, 200, await this.remoteClient.fetchApprovals());
          return;
        case "api-tasks":
          json(res, 200, await this.remoteClient.fetchTasks());
          return;
        case "api-health":
          json(res, 200, await this.remoteClient.fetchHealth());
          return;
        case "command-engine-sync":
          json(res, 200, await this.remoteClient.postCommand("/api/control-room/commands/engine-sync", {}));
          return;
        case "command-activate-business": {
          const body = await readJsonBody<{ businessId?: string }>(req);
          json(
            res,
            200,
            await this.remoteClient.postCommand("/api/control-room/commands/activate-business", body)
          );
          return;
        }
        case "command-pause-business": {
          const body = await readJsonBody<{ businessId?: string }>(req);
          json(
            res,
            200,
            await this.remoteClient.postCommand("/api/control-room/commands/pause-business", body)
          );
          return;
        }
        case "command-route-task": {
          const body = await readJsonBody<Record<string, unknown>>(req);
          json(
            res,
            200,
            await this.remoteClient.postCommand("/api/control-room/commands/route-task", body)
          );
          return;
        }
        case "command-resolve-approval": {
          const body = await readJsonBody<Record<string, unknown>>(req);
          json(
            res,
            200,
            await this.remoteClient.postCommand(
              "/api/control-room/commands/resolve-approval",
              body
            )
          );
          return;
        }
        default:
          json(res, 404, { status: "missing" });
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("authentication expired")) {
        this.remoteClient.logout();
        redirect(res, `/login?next=${encodeURIComponent(url.pathname)}`);
        return;
      }
      throw error;
    }
  }

  private async ensureRemoteReady(): Promise<void> {
    try {
      await this.ensureTunnel();
      this.lastRemoteError = undefined;
    } catch (error) {
      const message = this.describeRemoteError(error);
      this.lastRemoteError = message;
      throw new Error(message);
    }
  }

  private async ensureTunnel(): Promise<void> {
    if (!this.config.controlRoom.local.tunnelEnabled) {
      return;
    }

    const remoteUrl = new URL(this.config.controlRoom.local.remoteUrl);
    if (remoteUrl.hostname !== "127.0.0.1" && remoteUrl.hostname !== "localhost") {
      return;
    }

    const directHostedBaseUrl = `http://127.0.0.1:${this.config.controlRoom.port}`;
    if (
      remoteUrl.port === String(this.config.controlRoom.local.tunnelLocalPort) &&
      (await this.isReachable("127.0.0.1", this.config.controlRoom.port))
    ) {
      this.remoteClient.setRemoteBaseUrl(directHostedBaseUrl);
      return;
    }

    if (this.tunnelProcess) {
      const tunnelAlive = await this.isReachable(
        this.config.controlRoom.local.bindHost,
        this.config.controlRoom.local.tunnelLocalPort
      );
      if (tunnelAlive) {
        return;
      }

      this.tunnelProcess = undefined;
    }

    const scriptPath = path.join(this.config.projectRoot, "scripts", "control_room_tunnel.py");
    const pythonBin = this.config.controlRoom.local.tunnelPythonBin;
    const args = [
      scriptPath,
      "--local-port",
      String(this.config.controlRoom.local.tunnelLocalPort),
      "--remote-port",
      String(this.config.controlRoom.port)
    ];

    this.tunnelProcess = spawn(pythonBin, args, {
      cwd: this.config.projectRoot,
      env: process.env
    });

    await new Promise<void>((resolve, reject) => {
      let stdoutText = "";
      let stderrText = "";
      const timeout = setTimeout(() => resolve(), 3000);
      const cleanup = () => {
        clearTimeout(timeout);
        this.tunnelProcess?.stdout.off("data", onStdout);
        this.tunnelProcess?.stderr.off("data", onStderr);
        this.tunnelProcess?.off("error", onError);
        this.tunnelProcess?.off("exit", onExit);
      };
      const onStdout = (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stdoutText += text;
        if (text.includes('"status": "ready"')) {
          cleanup();
          resolve();
        }
      };
      const onStderr = (chunk: Buffer) => {
        stderrText += chunk.toString("utf8");
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onExit = (code: number | null) => {
        cleanup();
        const message = stderrText.trim() || stdoutText.trim();
        reject(
          new Error(
            message || `control_room_tunnel.py exited with code ${code ?? -1}.`
          )
        );
      };
      this.tunnelProcess?.stdout.on("data", onStdout);
      this.tunnelProcess?.stderr.on("data", onStderr);
      this.tunnelProcess?.on("error", onError);
      this.tunnelProcess?.on("exit", onExit);
    });
  }

  private describeRemoteError(error: unknown): string {
    const message = error instanceof Error ? error.message : "Unknown local control-room error.";
    if (message.includes("did not accept the provided password")) {
      return message;
    }
    if (message.includes("Missing VPS host or password")) {
      return "The local operator app could not open the VPS tunnel because IMON_ENGINE_VPS_HOST or IMON_ENGINE_VPS_PASSWORD is missing on this machine.";
    }
    if (message.includes("paramiko is not installed")) {
      return "The local operator app could not open the VPS tunnel because the Python dependency paramiko is not installed.";
    }
    if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
      return "The local operator app could not reach the hosted control room through the configured remote URL or SSH tunnel.";
    }
    return message;
  }

  private isRemoteAuthFailure(error: unknown): boolean {
    return error instanceof Error && error.message.includes("did not accept the provided password");
  }

  private async isReachable(host: string, port: number): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host, port });
      const finish = (reachable: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(reachable);
      };

      socket.setTimeout(1500);
      socket.once("connect", () => finish(true));
      socket.once("timeout", () => finish(false));
      socket.once("error", () => finish(false));
    });
  }

  private safeRedirectPath(candidate: string): string {
    return candidate.startsWith("/") ? candidate : "/";
  }
}
