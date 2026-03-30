import type { ControlRoomSnapshot } from "../domain/control-room.js";
import { normalizeControlRoomSnapshot } from "./control-room-snapshot-compat.js";

export class ControlRoomRemoteClient {
  private remoteSessionCookie?: string;

  constructor(private readonly remoteBaseUrl: string) {}

  isAuthenticated(): boolean {
    return Boolean(this.remoteSessionCookie);
  }

  logout(): void {
    this.remoteSessionCookie = undefined;
  }

  async login(password: string, nextPath = "/"): Promise<void> {
    const response = await fetch(`${this.remoteBaseUrl}/login`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        password,
        next: nextPath
      }).toString()
    });

    if (response.status !== 303) {
      throw new Error("Remote control room did not accept the provided password.");
    }

    const cookie = response.headers.get("set-cookie");
    if (!cookie) {
      throw new Error("Remote control room did not return a session cookie.");
    }

    this.remoteSessionCookie = cookie.split(";")[0];
  }

  async fetchSnapshot(): Promise<ControlRoomSnapshot> {
    const snapshot = await this.fetchJson<ControlRoomSnapshot>("/api/control-room/snapshot");
    return normalizeControlRoomSnapshot(snapshot);
  }

  async fetchEngineChat(): Promise<unknown> {
    return this.fetchJson("/api/control-room/chat/engine");
  }

  async submitEngineChat(message: string): Promise<unknown> {
    return this.fetchJson("/api/control-room/chat/engine", true, { message });
  }

  async fetchBusinessChat(businessId: string): Promise<unknown> {
    return this.fetchJson(`/api/control-room/chat/business/${encodeURIComponent(businessId)}`);
  }

  async submitBusinessChat(businessId: string, message: string): Promise<unknown> {
    return this.fetchJson(`/api/control-room/chat/business/${encodeURIComponent(businessId)}`, true, {
      message
    });
  }

  async fetchDepartmentChat(businessId: string, departmentId: string): Promise<unknown> {
    return this.fetchJson(
      `/api/control-room/chat/department/${encodeURIComponent(businessId)}/${encodeURIComponent(
        departmentId
      )}`
    );
  }

  async submitDepartmentChat(
    businessId: string,
    departmentId: string,
    message: string
  ): Promise<unknown> {
    return this.fetchJson(
      `/api/control-room/chat/department/${encodeURIComponent(businessId)}/${encodeURIComponent(
        departmentId
      )}`,
      true,
      { message }
    );
  }

  async applyChatAction(actionId: string): Promise<unknown> {
    return this.fetchJson(
      `/api/control-room/chat/actions/${encodeURIComponent(actionId)}/apply`,
      true,
      {}
    );
  }

  async dismissChatAction(actionId: string): Promise<unknown> {
    return this.fetchJson(
      `/api/control-room/chat/actions/${encodeURIComponent(actionId)}/dismiss`,
      true,
      {}
    );
  }

  async fetchBusiness(businessId: string): Promise<unknown> {
    return this.fetchJson(`/api/control-room/business/${encodeURIComponent(businessId)}`);
  }

  async fetchDepartment(businessId: string, departmentId: string): Promise<unknown> {
    return this.fetchJson(
      `/api/control-room/department/${encodeURIComponent(businessId)}/${encodeURIComponent(
        departmentId
      )}`
    );
  }

  async fetchActivity(): Promise<unknown> {
    return this.fetchJson("/api/control-room/activity");
  }

  async fetchApprovals(): Promise<unknown> {
    return this.fetchJson("/api/control-room/approvals");
  }

  async fetchTasks(): Promise<unknown> {
    return this.fetchJson("/api/control-room/tasks");
  }

  async fetchHealth(): Promise<unknown> {
    return this.fetchJson("/api/control-room/health", false);
  }

  async postCommand(path: string, body: unknown): Promise<unknown> {
    return this.fetchJson(path, true, body);
  }

  private async fetchJson<T = unknown>(
    path: string,
    requireAuth = true,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.remoteSessionCookie) {
      headers.cookie = this.remoteSessionCookie;
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${this.remoteBaseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual"
    });

    if (response.status === 303 || response.status === 401) {
      this.remoteSessionCookie = undefined;
      throw new Error("Remote control room authentication expired.");
    }

    if (requireAuth && !this.remoteSessionCookie) {
      throw new Error("Remote control room is not authenticated.");
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Remote control room request failed with ${response.status}.`);
    }

    return (await response.json()) as T;
  }
}
