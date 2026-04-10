import type { ControlRoomHealthReport, ControlRoomSnapshot } from "../domain/control-room.js";
import { normalizeControlRoomSnapshot } from "./control-room-snapshot-compat.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

export interface ControlRoomPageOptions {
  selectedBusinessId?: string;
  selectedDepartmentId?: string;
  appMode: "static" | "hosted" | "local";
}

export class ControlRoomRenderer {
  renderPage(snapshot: ControlRoomSnapshot, options: ControlRoomPageOptions): string {
    snapshot = normalizeControlRoomSnapshot(snapshot);
    const selectedBusiness =
      snapshot.businesses.find((business) => business.id === options.selectedBusinessId) ??
      snapshot.businesses[0];
    const selectedDepartment =
      snapshot.departmentWorkspaces.find(
        (workspace) =>
          workspace.businessId === selectedBusiness?.id &&
          workspace.departmentId === options.selectedDepartmentId
      ) ?? selectedBusiness?.departmentWorkspaces[0];
    const selectedScope = options.selectedDepartmentId
      ? "department"
      : options.selectedBusinessId
        ? "business"
        : "engine";
    const payload = JSON.stringify({
      snapshot,
      selectedScope,
      selectedBusinessId: selectedBusiness?.id ?? null,
      selectedDepartmentId: selectedDepartment?.departmentId ?? null,
      appMode: options.appMode,
      routes: {
        snapshot: "/api/control-room/snapshot",
        department: "/api/control-room/department",
        stream: "/api/control-room/stream",
        engineSync: "/api/control-room/commands/engine-sync",
        activateBusiness: "/api/control-room/commands/activate-business",
        pauseBusiness: "/api/control-room/commands/pause-business",
        resolveApproval: "/api/control-room/commands/resolve-approval",
        routeTask: "/api/control-room/commands/route-task",
        chat: {
          engine: "/api/control-room/chat/engine",
          businessBase: "/api/control-room/chat/business",
          departmentBase: "/api/control-room/chat/department",
          actionBase: "/api/control-room/chat/actions"
        }
      }
    });
    const modeLabel =
      options.appMode === "static"
        ? "Static Export"
        : options.appMode === "local"
          ? "Local Operator App"
          : "Hosted VPS App";
    const heroAction =
      options.appMode === "static"
        ? `<span class="button button-muted" aria-disabled="true">Static export</span>`
        : `<a class="button button-primary" href="/logout">Sign out</a>`;

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(snapshot.engineName)} Control Room</title>
    <style>${this.pageStyles()}</style>
  </head>
  <body>
    <div class="shell">
      <section class="hero">
        <div class="hero-top">
          <div>
            <div class="eyebrow">Folder-Style Office Explorer</div>
            <h1>${escapeHtml(snapshot.engineName)}</h1>
            <p>${escapeHtml(snapshot.engineOverview)}</p>
          </div>
          <div class="hero-actions">
            <div class="eyebrow">${escapeHtml(modeLabel)}</div>
            <div class="mono" id="freshness-label">${escapeHtml(this.freshnessLabel(snapshot.health))}</div>
            ${heroAction}
          </div>
        </div>
        <div class="banner${snapshot.globalWarnings.length > 0 ? " visible" : ""}" id="global-banner">${snapshot.globalWarnings[0] ? escapeHtml(snapshot.globalWarnings[0]) : ""}</div>
        <nav class="breadcrumbs" id="breadcrumbs"></nav>
        <div class="kpi-strip">
          <div class="kpi"><label>Active Businesses</label><strong>${snapshot.report?.businessCounts.active ?? 0}</strong></div>
          <div class="kpi"><label>Deferred Businesses</label><strong>${snapshot.report?.businessCounts.deferred ?? 0}</strong></div>
          <div class="kpi"><label>Approvals Waiting</label><strong>${snapshot.executiveView.approvalsWaiting}</strong></div>
          <div class="kpi"><label>Recommended Concurrency</label><strong>${snapshot.report?.recommendedConcurrency ?? 0}</strong></div>
          <div class="kpi"><label>Net Monthly Revenue</label><strong>${formatMoney(snapshot.report?.netMonthlyRevenue ?? 0)}</strong></div>
          <div class="kpi"><label>Collective Transfer</label><strong>${formatMoney(snapshot.executiveBudgetView?.collectiveTransfer ?? 0)}</strong></div>
        </div>
      </section>

      <aside class="rail">
        <div class="region-title">Office Explorer</div>
        <div class="tree" id="office-tree"></div>
      </aside>

      <main class="main">
        <section class="section">
          <div class="headline">
            <div>
              <div class="mono muted" id="view-id"></div>
              <h2 id="view-title"></h2>
            </div>
            <div class="status" id="view-status"></div>
          </div>
          <p class="muted" id="view-summary"></p>
          <div class="metric-grid" id="view-metrics"></div>
        </section>
        <section class="section">
          <div class="region-title" id="primary-title"></div>
          <div class="roster" id="primary-roster"></div>
        </section>
        <section class="section">
          <div class="region-title" id="secondary-title"></div>
          <div class="roster" id="secondary-roster"></div>
        </section>
        <section class="section">
          <div class="region-title" id="tertiary-title"></div>
          <div class="roster" id="tertiary-roster"></div>
        </section>
      </main>

      <aside class="inspector">
        <div class="stack">
          <section>
            <div class="tab-strip">
              <button class="tab-button active" id="chat-tab-button" data-inspector-tab="chat" type="button">Chat</button>
              <button class="tab-button" id="controls-tab-button" data-inspector-tab="controls" type="button">Controls</button>
            </div>
            <div class="inspector-panel active" id="chat-panel">${this.chatSection(options.appMode)}</div>
            <div class="inspector-panel" id="controls-panel">${this.controlsSection(options.appMode)}</div>
          </section>
          <section><div class="region-title">Detail</div><div class="detail-panel" id="detail-panel">Select an approval, handoff, worker, roadblock, or execution lane for details.</div></section>
          <section><div class="region-title">Context</div><div class="list" id="context-list"></div></section>
          <section><div class="region-title">Activity</div><div class="list" id="activity-list"></div></section>
        </div>
      </aside>
    </div>
    <script>${this.pageScript(payload)}</script>
  </body>
</html>`;
  }

  private chatSection(appMode: ControlRoomPageOptions["appMode"]): string {
    const composer =
      appMode === "static"
        ? `<div class="detail-panel" id="chat-composer-state">Static export: latest chat summary only.</div>`
        : `<form id="chat-form" class="task-form">
            <label class="field">
              <span>Message</span>
              <textarea id="chat-input" name="message" rows="4" placeholder="Ask the current orchestrator to summarize, report, route work, or update office instructions."></textarea>
            </label>
            <button class="button button-primary" id="chat-submit-button" type="submit">Send to orchestrator</button>
          </form>`;

    return `
      <div class="region-title">Scoped Orchestrator Chat</div>
      <div class="detail-panel" id="chat-header-panel">Loading chat context...</div>
      <div class="chat-history" id="chat-history"></div>
      <div class="list" id="chat-action-list"></div>
      <div class="list" id="chat-report-list"></div>
      ${composer}
      <div class="detail-panel" id="chat-status-panel">Chat actions and reports for the selected office will appear here.</div>
    `;
  }

  renderLoginPage(args: {
    engineName: string;
    message?: string;
    nextPath?: string;
    intro?: string;
  }): string {
    const nextValue = args.nextPath ? escapeHtml(args.nextPath) : "/";
    const intro = args.intro ?? "Use the owner password to open the control room.";
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${escapeHtml(args.engineName)} Control Room Login</title><style>
      :root{--line:rgba(176,198,214,.15);--text:#ebf1f5;--muted:#92a2af;--warning:#ffb14a}
      *{box-sizing:border-box}html,body{margin:0;min-height:100%;background:radial-gradient(circle at top left,rgba(88,211,164,.14),transparent 28%),radial-gradient(circle at top right,rgba(124,199,255,.12),transparent 24%),linear-gradient(180deg,#081017 0%,#0b1117 100%);color:var(--text);font-family:"Bahnschrift","Aptos","Segoe UI Variable","Segoe UI",sans-serif}
      body{display:grid;place-items:center;padding:20px}.panel{width:min(460px,100%);padding:28px;border:1px solid var(--line);background:linear-gradient(180deg,rgba(17,27,35,.92),rgba(11,17,23,.96))}
      h1{margin:0;font-size:clamp(1.8rem,5vw,3rem);letter-spacing:-.04em}p{color:var(--muted);line-height:1.6}label{display:block;font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
      input{width:100%;min-height:48px;padding:0 14px;border:1px solid var(--line);background:rgba(255,255,255,.03);color:var(--text);font:inherit}button{width:100%;min-height:46px;border:1px solid var(--line);background:rgba(88,211,164,.12);color:var(--text);font:inherit;cursor:pointer}
      .message{margin-bottom:16px;padding:12px 14px;border:1px solid rgba(255,177,74,.3);background:rgba(255,177,74,.08);color:var(--warning)}
    </style></head>
    <body><section class="panel"><div style="font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;color:#92a2af;">ImonEngine Control Room</div><h1>${escapeHtml(args.engineName)}</h1><p>${escapeHtml(intro)}</p>${args.message ? `<div class="message">${escapeHtml(args.message)}</div>` : ""}<form method="post" action="/login"><input type="hidden" name="next" value="${nextValue}" /><label for="password">Owner password</label><input id="password" name="password" type="password" autocomplete="current-password" /><div style="height:16px;"></div><button type="submit">Open control room</button></form></section></body></html>`;
  }

  private controlsSection(appMode: ControlRoomPageOptions["appMode"]): string {
    if (appMode === "static") {
      return `<div class="detail-panel">Static export: operator controls stay disabled here.</div>`;
    }

    return `
      <div class="region-title">Operator Controls</div>
      <div class="controls">
        <button class="button button-primary" id="engine-sync-button" type="button">Run engine sync</button>
        <button class="button" id="business-toggle-button" type="button">Toggle business state</button>
      </div>
      <div class="detail-panel" id="control-context">Selected business context will appear here.</div>
      <form id="task-form" class="task-form">
        <label class="field">
          <span>Directive title</span>
          <input id="task-title" name="title" type="text" placeholder="Guide Imon with a routed task" />
        </label>
        <label class="field">
          <span>Directive summary</span>
          <textarea id="task-summary" name="summary" rows="4" placeholder="What should the owning department do next?"></textarea>
        </label>
        <label class="field">
          <span>Risk</span>
          <select id="task-risk" name="risk">
            <option value="low">low</option>
            <option value="medium" selected>medium</option>
            <option value="high">high</option>
          </select>
        </label>
        <button class="button button-primary" type="submit">Route directive</button>
      </form>
      <div class="detail-panel" id="control-result">Use this panel to sync the engine, change business state, or route operator guidance into the control plane.</div>
      <div class="region-title">Approval Actions</div>
      <div class="list" id="approval-action-list"></div>
      <form id="approval-form" class="task-form">
        <label class="field">
          <span>Approved by</span>
          <input id="approval-approved-by" name="approvedBy" type="text" placeholder="owner@example.org or owner name" />
        </label>
        <label class="field">
          <span>Approval note</span>
          <textarea id="approval-note" name="note" rows="4" placeholder="Optional approval note for the saved artifact."></textarea>
        </label>
        <button class="button button-primary" id="approval-submit-button" type="submit">Record approval</button>
      </form>
      <div class="detail-panel" id="approval-panel">Select an approval waiting item to see whether the control room can resolve it directly.</div>`;
  }

  private pageStyles(): string {
    return `
      :root{--line:rgba(176,198,214,.15);--text:#ebf1f5;--muted:#92a2af;--warning:#ffb14a;--accent:#58d3a4}
      *{box-sizing:border-box}html,body{margin:0;min-height:100%;background:radial-gradient(circle at top left,rgba(88,211,164,.14),transparent 28%),radial-gradient(circle at top right,rgba(124,199,255,.12),transparent 24%),linear-gradient(180deg,#081017 0%,#0b1117 100%);color:var(--text);font-family:"Bahnschrift","Aptos","Segoe UI Variable","Segoe UI",sans-serif}
      body{padding:22px}a{color:inherit;text-decoration:none}button{font:inherit}
      .shell{display:grid;grid-template-columns:300px minmax(0,1fr) 360px;gap:18px;align-items:start}
      .hero{grid-column:1 / -1;padding:26px 30px 24px;border:1px solid var(--line);background:linear-gradient(120deg,rgba(17,27,35,.96),rgba(8,15,21,.92));position:relative;overflow:hidden}
      .hero::after{content:"";position:absolute;inset:auto -10% -35% 40%;height:220px;background:radial-gradient(circle,rgba(124,199,255,.18),transparent 60%);filter:blur(18px);pointer-events:none}
      .hero-top,.headline{display:flex;justify-content:space-between;gap:18px;align-items:start}.hero h1{margin:0;font-size:clamp(2rem,4vw,4.1rem);line-height:.95;letter-spacing:-.04em;max-width:10ch}.hero p{max-width:62ch;margin:16px 0 0;color:var(--muted);line-height:1.6}.hero-actions{display:grid;gap:8px;justify-items:end}
      .eyebrow,.mono{font-family:"Cascadia Code","IBM Plex Mono","Consolas",monospace;font-size:.78rem}.eyebrow,.region-title,.field span{color:var(--muted);letter-spacing:.12em;text-transform:uppercase}
      .button{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 14px;border:1px solid var(--line);background:rgba(255,255,255,.03);color:var(--text);cursor:pointer}.button:hover{border-color:rgba(124,199,255,.38)}.button:disabled{opacity:.55;cursor:not-allowed}.button-primary{background:rgba(88,211,164,.12);border-color:rgba(88,211,164,.26)}.button-muted{opacity:.8;cursor:default}
      .banner{display:none;margin-top:18px;padding:12px 14px;border:1px solid rgba(255,177,74,.28);background:rgba(255,177,74,.08);color:var(--warning)}.banner.visible{display:block}
      .breadcrumbs{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}.crumb{border:1px solid var(--line);background:rgba(255,255,255,.03);padding:6px 10px;cursor:pointer}.crumb.active{border-color:rgba(88,211,164,.34)}
      .kpi-strip{display:flex;flex-wrap:wrap;gap:12px;margin-top:22px}.kpi{min-width:150px;padding:12px 14px;border-top:1px solid var(--line)}.kpi label,.metric-box label{display:block;font-size:.73rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}.kpi strong,.metric-box strong{font-size:1.35rem}
      .rail,.main,.inspector{border:1px solid var(--line);background:linear-gradient(180deg,rgba(17,27,35,.9),rgba(11,17,23,.96))}.rail,.inspector{padding:18px}.main{padding:20px 24px}.stack,.list,.roster,.controls,.tree{display:grid;gap:10px}
      .tab-strip{display:grid;grid-template-columns:1fr 1fr;gap:8px}.tab-button{min-height:38px;border:1px solid var(--line);background:rgba(255,255,255,.03);color:var(--text);cursor:pointer}.tab-button.active{background:rgba(88,211,164,.12);border-color:rgba(88,211,164,.26)}
      .inspector-panel{display:none;gap:10px}.inspector-panel.active{display:grid}
      .tree-node,.row-button,.worker-button{width:100%;text-align:left;border:1px solid transparent;background:rgba(255,255,255,.02);padding:12px 14px;color:var(--text);cursor:pointer}.tree-node{padding-left:calc(14px + var(--depth,0) * 16px)}.tree-node:hover,.tree-node.active,.row-button:hover,.row-button.active,.worker-button:hover{border-color:rgba(124,199,255,.38);background:rgba(124,199,255,.08)}.row-button.active{border-color:rgba(88,211,164,.34);background:rgba(88,211,164,.08)}
      .tree-node strong,.row-button strong,.worker-button strong{display:block}.tree-meta,.muted{color:var(--muted)}.tree-meta,.row-meta{font-size:.84rem;line-height:1.5}.headline{align-items:end;margin-bottom:18px}.headline h2{margin:0;font-size:clamp(1.6rem,2vw,2.3rem);letter-spacing:-.035em}
      .status{display:inline-flex;align-items:center;gap:8px;font-size:.84rem;text-transform:uppercase;letter-spacing:.12em;color:var(--muted)}.status::before{content:"";width:9px;height:9px;border-radius:999px;background:var(--accent);box-shadow:0 0 0 6px rgba(88,211,164,.08)}.status[data-tone="blocked"]::before,.status[data-tone="attention-needed"]::before,.status[data-tone="degraded"]::before{background:var(--warning)}.status[data-tone="paused"]::before,.status[data-tone="deferred"]::before{background:var(--muted)}
      .section{padding-bottom:22px;margin-bottom:22px;border-bottom:1px solid var(--line)}.section:last-child{border-bottom:0;margin-bottom:0;padding-bottom:0}.metric-grid{display:grid;gap:14px;grid-template-columns:repeat(4,minmax(0,1fr))}
      .metric-box,.detail-panel{padding:12px 14px;border:1px solid var(--line);background:rgba(255,255,255,.03)}.row-shell{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) auto;gap:14px;align-items:start}.tag{display:inline-flex;align-items:center;padding:4px 8px;border:1px solid var(--line);color:var(--muted);font-size:.75rem;letter-spacing:.08em;text-transform:uppercase}
      .worker-grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}.detail-panel{white-space:pre-wrap}.inspector{position:sticky;top:22px}.task-form{display:grid;gap:12px;margin-top:10px}.field{display:grid;gap:8px}.field input,.field textarea,.field select{width:100%;border:1px solid var(--line);background:rgba(255,255,255,.03);color:var(--text);padding:10px 12px}
      .chat-history{display:grid;gap:10px;max-height:420px;overflow:auto;padding-right:4px}.chat-message{border:1px solid var(--line);padding:12px 14px;background:rgba(255,255,255,.03)}.chat-message[data-role="user"]{border-color:rgba(124,199,255,.3)}.chat-message[data-role="assistant"]{border-color:rgba(88,211,164,.24)}.chat-message[data-role="action"]{border-color:rgba(255,177,74,.3)}.chat-meta{font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
      .action-card,.report-card{padding:12px 14px;border:1px solid var(--line);background:rgba(255,255,255,.03)}.action-card h3,.report-card h3{margin:0 0 8px;font-size:1rem}.action-actions{display:flex;gap:8px;margin-top:12px}
      @media (max-width:1220px){.shell{grid-template-columns:1fr}.inspector{position:static}.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media (max-width:760px){body{padding:12px}.hero{padding:20px}.hero-top,.headline{flex-direction:column}.metric-grid{grid-template-columns:1fr}.row-shell{grid-template-columns:1fr}}
    `;
  }

  private pageScript(payload: string): string {
    return `
      const app = ${payload};
      const state = {
        scope: app.selectedScope,
        selectedBusinessId: app.selectedBusinessId || (app.snapshot.businesses[0] && app.snapshot.businesses[0].id) || null,
        selectedDepartmentId: app.selectedDepartmentId || null,
        inspectorTab: "chat",
        selectedApprovalId: null,
        chatScopeKey: null,
        chatView: null
      };
      const el = {
        breadcrumbs: document.getElementById("breadcrumbs"),
        officeTree: document.getElementById("office-tree"),
        viewId: document.getElementById("view-id"),
        viewTitle: document.getElementById("view-title"),
        viewStatus: document.getElementById("view-status"),
        viewSummary: document.getElementById("view-summary"),
        viewMetrics: document.getElementById("view-metrics"),
        primaryTitle: document.getElementById("primary-title"),
        secondaryTitle: document.getElementById("secondary-title"),
        tertiaryTitle: document.getElementById("tertiary-title"),
        primaryRoster: document.getElementById("primary-roster"),
        secondaryRoster: document.getElementById("secondary-roster"),
        tertiaryRoster: document.getElementById("tertiary-roster"),
        contextList: document.getElementById("context-list"),
        activityList: document.getElementById("activity-list"),
        detailPanel: document.getElementById("detail-panel"),
        freshnessLabel: document.getElementById("freshness-label"),
        globalBanner: document.getElementById("global-banner"),
        engineSyncButton: document.getElementById("engine-sync-button"),
        businessToggleButton: document.getElementById("business-toggle-button"),
        taskForm: document.getElementById("task-form"),
        controlContext: document.getElementById("control-context"),
        controlResult: document.getElementById("control-result"),
        approvalActionList: document.getElementById("approval-action-list"),
        approvalForm: document.getElementById("approval-form"),
        approvalApprovedBy: document.getElementById("approval-approved-by"),
        approvalNote: document.getElementById("approval-note"),
        approvalSubmitButton: document.getElementById("approval-submit-button"),
        approvalPanel: document.getElementById("approval-panel"),
        chatTabButton: document.getElementById("chat-tab-button"),
        controlsTabButton: document.getElementById("controls-tab-button"),
        chatPanel: document.getElementById("chat-panel"),
        controlsPanel: document.getElementById("controls-panel"),
        chatHeaderPanel: document.getElementById("chat-header-panel"),
        chatHistory: document.getElementById("chat-history"),
        chatActionList: document.getElementById("chat-action-list"),
        chatReportList: document.getElementById("chat-report-list"),
        chatForm: document.getElementById("chat-form"),
        chatInput: document.getElementById("chat-input"),
        chatStatusPanel: document.getElementById("chat-status-panel")
      };
      function escapeHtml(value) { return String(value || "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;"); }
      function formatMoney(value) { return "$" + Number(value || 0).toFixed(2); }
      function replaceUrl(route) { try { history.replaceState({}, "", route); } catch {} }
      function currentBusiness() { return app.snapshot.businesses.find((entry) => entry.id === state.selectedBusinessId) || app.snapshot.businesses[0] || null; }
      function currentWorkspace() { return app.snapshot.departmentWorkspaces.find((entry) => entry.businessId === state.selectedBusinessId && entry.departmentId === state.selectedDepartmentId) || null; }
      function currentApprovals() {
        if (state.scope === "department") {
          const workspace = currentWorkspace();
          return (workspace && workspace.approvalTasks) || [];
        }
        if (state.scope === "business") {
          const business = currentBusiness();
          return (business && business.office && business.office.approvalTasks) || [];
        }
        return app.snapshot.executiveView.approvalTasks || [];
      }
      function approvalActionConfig(approval) {
        if (!approval) return null;
        if (approval.id === "approval-clipbaiters-viral-moments") {
          return {
            label: "Record rights approval",
            summary: "Write the ClipBaiters rights and fair-use approval artifact and rerun engine sync."
          };
        }
        if (approval.id === "approval-clipbaiters-lane-posture-clipbaiters-viral-moments") {
          return {
            label: "Record lane posture approval",
            summary: "Write the ClipBaiters lane posture approval artifact for the current rollout set and rerun engine sync."
          };
        }
        return null;
      }
      function selectedApproval() {
        return currentApprovals().find((entry) => entry.id === state.selectedApprovalId) || null;
      }
      function currentScopeKey() { return state.scope === "department" ? "department:" + (state.selectedBusinessId || "") + ":" + (state.selectedDepartmentId || "") : state.scope === "business" ? "business:" + (state.selectedBusinessId || "") : "engine"; }
      function chatEndpoint() {
        if (state.scope === "department") return app.routes.chat.departmentBase + "/" + encodeURIComponent(state.selectedBusinessId || "") + "/" + encodeURIComponent(state.selectedDepartmentId || "");
        if (state.scope === "business") return app.routes.chat.businessBase + "/" + encodeURIComponent(state.selectedBusinessId || "");
        return app.routes.chat.engine;
      }
      function actionEndpoint(actionId, mode) { return app.routes.chat.actionBase + "/" + encodeURIComponent(actionId) + "/" + mode; }
      function toneFor(status) {
        if (app.snapshot.health.status !== "ready") return "degraded";
        if (["blocked", "scaffolded"].includes(status)) return "blocked";
        if (["attention-needed", "awaiting_approval", "review"].includes(status)) return "attention-needed";
        if (status === "paused") return "paused";
        if (status === "deferred") return "deferred";
        return "active";
      }
      function gotoRoute(route) {
        if (!route || route === "/" || route === "/engine") {
          state.scope = "engine";
          state.selectedDepartmentId = null;
          replaceUrl("/engine");
          render();
          void ensureChatLoaded(true);
          return;
        }
        const businessMatch = route.match(/^\\/business\\/([^/]+)$/);
        if (businessMatch && businessMatch[1]) {
          state.scope = "business";
          state.selectedBusinessId = decodeURIComponent(businessMatch[1]);
          state.selectedDepartmentId = null;
          replaceUrl(route);
          render();
          void ensureChatLoaded(true);
          return;
        }
        const departmentMatch = route.match(/^\\/department\\/([^/]+)\\/([^/]+)$/);
        if (departmentMatch && departmentMatch[1] && departmentMatch[2]) {
          state.scope = "department";
          state.selectedBusinessId = decodeURIComponent(departmentMatch[1]);
          state.selectedDepartmentId = decodeURIComponent(departmentMatch[2]);
          replaceUrl(route);
          render();
          void ensureChatLoaded(true);
        }
      }
      function detail(title, lines) {
        el.detailPanel.innerHTML = "<strong>" + escapeHtml(title) + "</strong><div style='height:10px'></div>" + lines.map((line) => "<div>" + escapeHtml(line) + "</div>").join("");
      }
      function allHandoffs() { return [...app.snapshot.executiveView.handoffs, ...app.snapshot.businesses.flatMap((business) => business.office ? business.office.handoffs : [])]; }
      function setControlMessage(message) { if (el.controlResult) el.controlResult.textContent = message; }
      function setChatStatus(message) { if (el.chatStatusPanel) el.chatStatusPanel.textContent = message; }
      function renderApprovalActions() {
        if (!el.approvalActionList || !el.approvalPanel) return;
        const approvals = currentApprovals();
        if (!approvals.some((approval) => approval.id === state.selectedApprovalId)) {
          state.selectedApprovalId = approvals[0] ? approvals[0].id : null;
        }
        el.approvalActionList.innerHTML = approvals.length > 0
          ? approvals.map((approval) => {
              const active = approval.id === state.selectedApprovalId;
              const config = approvalActionConfig(approval);
              return "<button class='row-button " + (active ? "active" : "") + "' data-approval-action-id='" + escapeHtml(approval.id) + "'><div class='row-shell'><div><strong>" + escapeHtml(approval.actionNeeded) + "</strong><div class='muted'>" + escapeHtml(approval.reason) + "</div></div><div class='row-meta'>" + escapeHtml((config ? config.label : approval.relatedEntityType) + " | " + approval.status) + "</div><div><span class='tag'>" + escapeHtml(config ? "actionable" : approval.status) + "</span></div></div></button>";
            }).join("")
          : "<div class='detail-panel'>No approvals are waiting in this office.</div>";
        const approval = selectedApproval();
        const config = approvalActionConfig(approval);
        if (el.approvalSubmitButton) el.approvalSubmitButton.disabled = !config;
        if (!approval) {
          el.approvalPanel.textContent = "Select an approval waiting item to see whether the control room can resolve it directly.";
          return;
        }
        if (!config) {
          el.approvalPanel.innerHTML = "<strong>" + escapeHtml(approval.actionNeeded) + "</strong><div style='height:10px'></div><div>" + escapeHtml("Reason: " + approval.reason) + "</div><div>" + escapeHtml("Status: " + approval.status) + "</div><div>" + escapeHtml("Next step: " + approval.ownerInstructions) + "</div><div style='height:10px'></div><div class='muted'>This approval is visible here, but it is not directly actionable from the control room yet.</div>";
          return;
        }
        el.approvalPanel.innerHTML = "<strong>" + escapeHtml(approval.actionNeeded) + "</strong><div style='height:10px'></div><div>" + escapeHtml(config.summary) + "</div><div>" + escapeHtml("Reason: " + approval.reason) + "</div><div>" + escapeHtml("Owner instructions: " + approval.ownerInstructions) + "</div>";
      }
      function setInspectorTab(tab) {
        state.inspectorTab = tab;
        if (el.chatTabButton) el.chatTabButton.classList.toggle("active", tab === "chat");
        if (el.controlsTabButton) el.controlsTabButton.classList.toggle("active", tab === "controls");
        if (el.chatPanel) el.chatPanel.classList.toggle("active", tab === "chat");
        if (el.controlsPanel) el.controlsPanel.classList.toggle("active", tab === "controls");
      }
      async function postJson(url, body) {
        const response = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
        const text = await response.text();
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch {}
        if (!response.ok) throw new Error(parsed && parsed.message ? parsed.message : text || "Request failed.");
        return parsed;
      }
      async function getJson(url) {
        const response = await fetch(url, { credentials: "same-origin" });
        const text = await response.text();
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch {}
        if (!response.ok) throw new Error(parsed && parsed.message ? parsed.message : text || "Request failed.");
        return parsed;
      }
      async function refreshSnapshot(forceRender) {
        try {
          const response = await fetch(app.routes.snapshot, { credentials: "same-origin" });
          if (!response.ok) return;
          const next = await response.json();
          if (next.fingerprint !== app.snapshot.fingerprint) {
            app.snapshot = next;
            render();
          } else if (forceRender) {
            render();
          }
        } catch {}
      }
      function treeNodeHtml(node, depth) {
        const active = (node.scope === "engine" && state.scope === "engine") || (node.scope === "business" && state.scope === "business" && node.businessId === state.selectedBusinessId) || (node.scope === "department" && state.scope === "department" && node.departmentId === state.selectedDepartmentId && node.businessId === state.selectedBusinessId);
        return "<button class='tree-node " + (active ? "active" : "") + "' style='--depth:" + depth + "' data-route='" + escapeHtml(node.route) + "'><strong>" + escapeHtml(node.title) + "</strong><div class='tree-meta'>" + escapeHtml(node.subtitle) + " | approvals " + node.counts.approvals + " | executions " + node.counts.executions + "</div></button>" + node.children.map((child) => treeNodeHtml(child, depth + 1)).join("");
      }
      function rowButton(title, subtitle, meta, status, attrs) {
        return "<button class='row-button' " + attrs + "><div class='row-shell'><div><strong>" + escapeHtml(title) + "</strong><div class='muted'>" + escapeHtml(subtitle || "") + "</div></div><div class='row-meta'>" + escapeHtml(meta || "") + "</div><div><span class='tag'>" + escapeHtml(status || "view") + "</span></div></div></button>";
      }
      function workerButton(worker) {
        return "<button class='worker-button' data-route='" + escapeHtml(worker.route) + "'><strong>" + escapeHtml(worker.label) + "</strong><div class='muted'>" + escapeHtml(worker.title) + "</div><div class='row-meta'>" + escapeHtml((worker.metrics || []).join(" | ")) + "</div><div style='height:6px'></div><span class='tag'>" + escapeHtml(worker.status) + "</span></button>";
      }
      function renderMetrics(items) { el.viewMetrics.innerHTML = items.map((item) => "<div class='metric-box'><label>" + escapeHtml(item.label) + "</label><strong>" + escapeHtml(item.value) + "</strong></div>").join(""); }
      function renderRows(container, html, emptyText) { container.innerHTML = html || "<div class='detail-panel'>" + escapeHtml(emptyText) + "</div>"; }
      function roadblockRows(roadblocks, scopeLabel) {
        return (roadblocks || []).map((roadblock, index) =>
          rowButton(
            roadblock,
            scopeLabel,
            "Roadblock " + (index + 1),
            "blocked",
            "data-roadblock='" + escapeHtml(scopeLabel + "::" + roadblock) + "'"
          )
        );
      }
      function businessContextRows(statusFilter) {
        return app.snapshot.businesses
          .filter((business) => typeof statusFilter === "function" ? statusFilter(business) : true)
          .map((business) =>
          rowButton(
            business.name,
            business.summary,
            (business.templateProfile || business.category) + " | " + business.stage,
            business.stage,
            "data-route='/business/" + encodeURIComponent(business.id) + "'"
          )
        );
      }
      function departmentContextRows(business) {
        return (business ? business.departmentWorkspaces : []).map((workspace) =>
          rowButton(
            workspace.title.replace(" Department Workspace", ""),
            workspace.summary,
            workspace.templateProfile.replaceAll("_", " ") +
              " | " +
              workspace.executionItems.length +
              " execution lane(s)",
            workspace.roadblocks.length > 0 ? "blocked" : "open",
            "data-route='/department/" +
              encodeURIComponent(workspace.businessId) +
              "/" +
              encodeURIComponent(workspace.departmentId) +
              "'"
          )
        );
      }
      function activityRows(records) {
        return records.map((record) =>
          rowButton(
            record.summary,
            (record.details && record.details[0]) || "",
            record.eventType + " | " + record.createdAt,
            "detail",
            "data-activity-id='" + escapeHtml(record.id) + "'"
          )
        );
      }
      function engineView() {
        return {
          id: "engine/" + app.snapshot.engineId,
          title: app.snapshot.executiveView.title,
          status: app.snapshot.executiveView.roadblocks.length > 0 || app.snapshot.executiveView.approvalTasks.length > 0 ? "attention-needed" : "active",
          summary: app.snapshot.executiveView.summary,
          breadcrumbs: app.snapshot.executiveView.breadcrumbs,
          chatSummary: app.snapshot.executiveView.chatSummary,
          metrics: [
            { label: "Businesses", value: String(app.snapshot.businesses.length) },
            { label: "Deferred", value: String(app.snapshot.businesses.filter((business) => business.stage === "deferred").length) },
            { label: "Approvals", value: String(app.snapshot.executiveView.approvalsWaiting) },
            { label: "Handoffs", value: String(app.snapshot.executiveView.handoffs.length) },
            { label: "Roadblocks", value: String(app.snapshot.executiveView.roadblocks.length) }
          ],
          primaryTitle: "Business Offices",
          primaryHtml: "<div class='worker-grid'>" + businessContextRows((business) => business.stage !== "deferred").join("") + "</div>",
          secondaryTitle: "Deferred",
          secondaryHtml: "<div class='worker-grid'>" + businessContextRows((business) => business.stage === "deferred").join("") + "</div>",
          tertiaryTitle: "Approval Workflow",
          tertiaryHtml: app.snapshot.executiveView.approvalTasks.map((approval) => rowButton(approval.actionNeeded, approval.reason, approval.relatedEntityType + " | " + approval.status, approval.status, "data-approval-id='" + escapeHtml(approval.id) + "'")).join(""),
          contextHtml: "<div class='worker-grid'>" + app.snapshot.executiveView.workers.map(workerButton).join("") + "</div>" + app.snapshot.executiveView.handoffs.map((handoff) => rowButton(handoff.title, handoff.summary, handoff.ownerLabel + " | " + handoff.roadblocks.length + " roadblock(s)", handoff.status, "data-handoff-id='" + escapeHtml(handoff.id) + "'")).join("") + roadblockRows(app.snapshot.executiveView.roadblocks, "Engine office").join(""),
          activityHtml: activityRows(app.snapshot.recentAudits).join("")
        };
      }
      function businessView() {
        const business = currentBusiness();
        if (!business || !business.office) return engineView();
        return {
          id: "business/" + business.id,
          title: business.office.title,
          status: business.stage === "deferred" ? "deferred" : business.office.roadblocks.length > 0 ? "blocked" : business.stage,
          summary: business.summary,
          breadcrumbs: business.office.breadcrumbs,
          chatSummary: business.office.chatSummary,
          metrics: [
            { label: "Revenue", value: formatMoney(business.monthlyRevenue) },
            { label: "Costs", value: formatMoney(business.monthlyCosts) },
            { label: "Net", value: formatMoney(business.netRevenue) },
            { label: "Automation", value: Math.round(business.automationCoverage * 100) + "%" },
            { label: "Approvals", value: String(business.office.approvalTasks.length) },
            { label: "Roadblocks", value: String(business.office.roadblocks.length) }
          ],
          primaryTitle: "Department Offices",
          primaryHtml: "<div class='worker-grid'>" + departmentContextRows(business).join("") + "</div>",
          secondaryTitle: "Approval Workflow",
          secondaryHtml: business.office.approvalTasks.map((approval) => rowButton(approval.actionNeeded, approval.reason, approval.relatedEntityType + " | " + approval.status, approval.status, "data-approval-id='" + escapeHtml(approval.id) + "'")).join(""),
          tertiaryTitle: "Department Handoffs",
          tertiaryHtml: business.office.handoffs.map((handoff) => rowButton(handoff.title, handoff.summary, handoff.ownerLabel + " | " + handoff.executionItemIds.length + " execution item(s)", handoff.status, "data-handoff-id='" + escapeHtml(handoff.id) + "'")).join(""),
          contextHtml: "<div class='worker-grid'>" + business.office.workers.map(workerButton).join("") + "</div>" + roadblockRows(business.office.roadblocks, business.office.title).join(""),
          activityHtml: activityRows((business.recentAudits && business.recentAudits.length) ? business.recentAudits : app.snapshot.recentAudits).join("")
        };
      }
      function departmentView() {
        const workspace = currentWorkspace();
        const business = currentBusiness();
        if (!workspace || !business) return businessView();
        return {
          id: "department/" + workspace.businessId + "/" + workspace.departmentId,
          title: workspace.title,
          status: workspace.roadblocks.length > 0 ? "blocked" : workspace.approvalTasks.length > 0 ? "review" : "active",
          summary: workspace.summary,
          breadcrumbs: workspace.breadcrumbs,
          chatSummary: workspace.chatSummary,
          metrics: [
            { label: "Execution Items", value: String(workspace.executionItems.length) },
            { label: "Roadblocks", value: String(workspace.roadblocks.length) },
            { label: "Approvals", value: String(workspace.approvalTasks.length) },
            { label: "Workers", value: String(workspace.workers.length) },
            ...workspace.metrics.map((metric, index) => ({
              label: "Metric " + (index + 1),
              value: metric
            }))
          ],
          primaryTitle: "Execution Dashboard",
          primaryHtml: workspace.executionItems.map((item) => rowButton(item.title, item.summary, item.assignedWorkerLabel + " | " + item.metrics.join(" | "), item.status, "data-execution-id='" + escapeHtml(item.id) + "'")).join(""),
          secondaryTitle: "Outputs And KPIs",
          secondaryHtml: workspace.executionItems.map((item) => rowButton(item.title, item.artifacts[0] || "No output recorded yet", item.metrics.join(" | "), item.status, "data-execution-id='" + escapeHtml(item.id) + "'")).join("") + workspace.widgetSections.map((section) => rowButton(section.replaceAll("_", " "), "Workspace widget", workspace.templateProfile.replaceAll("_", " "), "widget", "")).join(""),
          tertiaryTitle: "Department Workers",
          tertiaryHtml: "<div class='worker-grid'>" + workspace.workers.map(workerButton).join("") + "</div>",
          contextHtml: roadblockRows(workspace.roadblocks, workspace.title).concat(workspace.approvalTasks.map((approval) => rowButton(approval.actionNeeded, approval.reason, approval.relatedEntityType + " | " + approval.status, approval.status, "data-approval-id='" + escapeHtml(approval.id) + "'"))).join(""),
          activityHtml: activityRows(workspace.recentActivity).join("")
        };
      }
      function activeView() { return state.scope === "department" ? departmentView() : state.scope === "business" ? businessView() : engineView(); }
      function bindRouteButtons() { document.querySelectorAll("[data-route]").forEach((node) => node.addEventListener("click", (event) => { event.preventDefault(); gotoRoute(node.getAttribute("data-route")); })); }
      function bindDetailButtons() {
        document.querySelectorAll("[data-approval-id]").forEach((node) => node.addEventListener("click", () => {
          const approval = app.snapshot.approvals.find((entry) => entry.id === node.getAttribute("data-approval-id"));
          if (approval) {
            state.selectedApprovalId = approval.id;
            renderApprovalActions();
            detail(approval.actionNeeded, ["Status: " + approval.status, "Reason: " + approval.reason, "Owner instructions: " + approval.ownerInstructions, approvalActionConfig(approval) ? "Control room action: open Controls to record this approval." : "Control room action: not available for this approval yet."]);
          }
        }));
        document.querySelectorAll("[data-approval-action-id]").forEach((node) => node.addEventListener("click", () => {
          const approval = currentApprovals().find((entry) => entry.id === node.getAttribute("data-approval-action-id"));
          if (!approval) return;
          state.selectedApprovalId = approval.id;
          renderApprovalActions();
          detail(approval.actionNeeded, ["Status: " + approval.status, "Reason: " + approval.reason, "Owner instructions: " + approval.ownerInstructions]);
        }));
        document.querySelectorAll("[data-handoff-id]").forEach((node) => node.addEventListener("click", () => {
          const handoff = allHandoffs().find((entry) => entry.id === node.getAttribute("data-handoff-id"));
          if (handoff) detail(handoff.title, ["Status: " + handoff.status, "Owner: " + handoff.ownerLabel, "Summary: " + handoff.summary, ...(handoff.roadblocks.length ? handoff.roadblocks.map((item) => "Roadblock: " + item) : ["Roadblocks: none"])]);
        }));
        document.querySelectorAll("[data-execution-id]").forEach((node) => node.addEventListener("click", () => {
          const item = app.snapshot.departmentExecutionItems.find((entry) => entry.id === node.getAttribute("data-execution-id"));
          if (item) detail(item.title, ["Status: " + item.status, "Worker: " + item.assignedWorkerLabel, "Summary: " + item.summary, ...item.metrics.map((metric) => "Metric: " + metric), ...item.artifacts.map((artifact) => "Artifact: " + artifact), ...(item.blockers.length ? item.blockers.map((blocker) => "Blocker: " + blocker) : ["Blockers: none"])]);
        }));
        document.querySelectorAll("[data-roadblock]").forEach((node) => node.addEventListener("click", () => {
          const raw = node.getAttribute("data-roadblock") || "";
          const separator = raw.indexOf("::");
          const scopeLabel = separator >= 0 ? raw.slice(0, separator) : "Office";
          const roadblock = separator >= 0 ? raw.slice(separator + 2) : raw;
          detail(roadblock, ["Scope: " + scopeLabel, "Status: blocked", "Action: resolve blocker before advancing dependent work."]);
        }));
        document.querySelectorAll("[data-activity-id]").forEach((node) => node.addEventListener("click", () => {
          const id = node.getAttribute("data-activity-id");
          const record = app.snapshot.recentAudits.find((entry) => entry.id === id) || app.snapshot.businesses.flatMap((business) => business.recentAudits || []).find((entry) => entry.id === id) || app.snapshot.departmentWorkspaces.flatMap((workspace) => workspace.recentActivity || []).find((entry) => entry.id === id);
          if (record) detail(record.summary, ["Type: " + record.eventType, "Created: " + record.createdAt, ...(record.details || [])]);
        }));
        document.querySelectorAll("[data-chat-action-detail]").forEach((node) => node.addEventListener("click", () => {
          const action = state.chatView && (state.chatView.actions || []).find((entry) => entry.id === node.getAttribute("data-chat-action-detail"));
          if (action) detail(action.title, ["Status: " + action.status, "Summary: " + action.summary, ...(action.resultLines || []).map((line) => "Result: " + line)]);
        }));
        document.querySelectorAll("[data-chat-apply]").forEach((node) => node.addEventListener("click", () => { void applyChatAction(node.getAttribute("data-chat-apply")).catch((error) => setChatStatus(error.message || String(error))); }));
        document.querySelectorAll("[data-chat-dismiss]").forEach((node) => node.addEventListener("click", () => { void dismissChatAction(node.getAttribute("data-chat-dismiss")).catch((error) => setChatStatus(error.message || String(error))); }));
      }
      function renderBreadcrumbs(crumbs) { el.breadcrumbs.innerHTML = crumbs.map((crumb, index) => "<button class='crumb " + (index === crumbs.length - 1 ? "active" : "") + "' data-route='" + escapeHtml(crumb.route) + "'>" + escapeHtml(crumb.title) + "</button>").join(""); }
      function renderChat(summaryOnly) {
        if (!el.chatHeaderPanel || !el.chatHistory || !el.chatActionList || !el.chatReportList) return;
        const summary = summaryOnly || activeView().chatSummary || { assistantLabel: "Orchestrator", pendingActionCount: 0, reportCount: 0, lastMessagePreview: "No chat history yet.", latestActionTitles: [], latestReportTitles: [] };
        el.chatHeaderPanel.textContent = summary.assistantLabel + " | pending actions " + (summary.pendingActionCount || 0) + " | reports " + (summary.reportCount || 0);
        if (app.appMode === "static") {
          el.chatHistory.innerHTML = "<div class='chat-message' data-role='assistant'><div class='chat-meta'>Summary</div><div>" + escapeHtml(summary.lastMessagePreview || "No chat history yet.") + "</div></div>";
          el.chatActionList.innerHTML = (summary.latestActionTitles || []).map((title) => "<div class='action-card'><h3>" + escapeHtml(title) + "</h3><div class='muted'>Recent chat action</div></div>").join("") || "<div class='detail-panel'>No chat actions recorded yet.</div>";
          el.chatReportList.innerHTML = (summary.latestReportTitles || []).map((title) => "<div class='report-card'><h3>" + escapeHtml(title) + "</h3><div class='muted'>Recent office report</div></div>").join("") || "<div class='detail-panel'>No office reports recorded yet.</div>";
          return;
        }
        if (!state.chatView || state.chatScopeKey !== currentScopeKey()) {
          el.chatHistory.innerHTML = "<div class='detail-panel'>Loading scoped chat...</div>";
          el.chatActionList.innerHTML = "";
          el.chatReportList.innerHTML = "";
          return;
        }
        const messages = state.chatView.messages || [];
        const actions = (state.chatView.actions || []).slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        const reports = (state.chatView.reports || []).slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        el.chatHistory.innerHTML = messages.length > 0 ? messages.map((message) => "<div class='chat-message' data-role='" + escapeHtml(message.role) + "'><div class='chat-meta'>" + escapeHtml(message.role) + " | " + escapeHtml(message.createdAt) + "</div><div>" + escapeHtml(message.content) + "</div></div>").join("") : "<div class='detail-panel'>No chat history yet for this office.</div>";
        el.chatActionList.innerHTML = actions.length > 0 ? actions.map((action) => "<div class='action-card'><h3>" + escapeHtml(action.title) + "</h3><div class='muted'>" + escapeHtml(action.status) + "</div><div style='height:8px'></div><div>" + escapeHtml(action.summary) + "</div><div style='height:8px'></div><div class='row-meta'>" + escapeHtml((action.resultLines || []).join(" | ")) + "</div><div class='action-actions'>" + (action.status === "awaiting_confirmation" ? "<button class='button button-primary' type='button' data-chat-apply='" + escapeHtml(action.id) + "'>Apply</button><button class='button' type='button' data-chat-dismiss='" + escapeHtml(action.id) + "'>Dismiss</button>" : "") + "<button class='button' type='button' data-chat-action-detail='" + escapeHtml(action.id) + "'>Details</button></div></div>").join("") : "<div class='detail-panel'>No chat actions recorded yet.</div>";
        el.chatReportList.innerHTML = reports.length > 0 ? reports.map((report) => "<div class='report-card'><h3>" + escapeHtml(report.title) + "</h3><div class='muted'>" + escapeHtml(report.summary) + "</div><div class='row-meta'>" + escapeHtml(report.createdAt) + "</div></div>").join("") : "<div class='detail-panel'>No office reports recorded yet.</div>";
      }
      async function ensureChatLoaded(force) {
        if (app.appMode === "static") { renderChat(activeView().chatSummary); return; }
        const key = currentScopeKey();
        if (!force && state.chatView && state.chatScopeKey === key) { renderChat(activeView().chatSummary); return; }
        try {
          setChatStatus("Loading scoped chat...");
          state.chatView = await getJson(chatEndpoint());
          state.chatScopeKey = key;
          renderChat(activeView().chatSummary);
          setChatStatus("Scoped chat ready for " + activeView().title + ".");
        } catch (error) {
          setChatStatus(error.message || String(error));
          renderChat(activeView().chatSummary);
        }
      }
      async function submitChat(event) {
        event.preventDefault();
        if (!el.chatInput) return;
        const message = el.chatInput.value.trim();
        if (!message) { setChatStatus("Chat message is required."); return; }
        setChatStatus("Sending message to the current orchestrator...");
        state.chatView = await postJson(chatEndpoint(), { message });
        state.chatScopeKey = currentScopeKey();
        el.chatInput.value = "";
        renderChat(activeView().chatSummary);
        setChatStatus("Scoped chat updated.");
        await refreshSnapshot(true);
      }
      async function applyChatAction(actionId) {
        setChatStatus("Applying chat action...");
        state.chatView = await postJson(actionEndpoint(actionId, "apply"), {});
        state.chatScopeKey = currentScopeKey();
        renderChat(activeView().chatSummary);
        setChatStatus("Chat action applied.");
        await refreshSnapshot(true);
      }
      async function dismissChatAction(actionId) {
        setChatStatus("Dismissing chat action...");
        state.chatView = await postJson(actionEndpoint(actionId, "dismiss"), {});
        state.chatScopeKey = currentScopeKey();
        renderChat(activeView().chatSummary);
        setChatStatus("Chat action dismissed.");
        await refreshSnapshot(true);
      }
      function render() {
        const business = currentBusiness();
        const view = activeView();
        el.officeTree.innerHTML = treeNodeHtml(app.snapshot.officeTree, 0);
        renderBreadcrumbs(view.breadcrumbs);
        el.viewId.textContent = view.id;
        el.viewTitle.textContent = view.title;
        el.viewStatus.textContent = view.status;
        el.viewStatus.dataset.tone = toneFor(view.status);
        el.viewSummary.textContent = view.summary;
        renderMetrics(view.metrics);
        el.primaryTitle.textContent = view.primaryTitle;
        el.secondaryTitle.textContent = view.secondaryTitle;
        el.tertiaryTitle.textContent = view.tertiaryTitle;
        renderRows(el.primaryRoster, view.primaryHtml, "No items in this section.");
        renderRows(el.secondaryRoster, view.secondaryHtml, "No items in this section.");
        renderRows(el.tertiaryRoster, view.tertiaryHtml, "No items in this section.");
        renderRows(el.contextList, view.contextHtml, "No context items yet.");
        renderRows(el.activityList, view.activityHtml, "No activity has been recorded yet.");
        el.freshnessLabel.textContent = (app.snapshot.health.stale ? "Stale since " : "Last sync: ") + (app.snapshot.health.lastSyncedAt || "not available");
        if (app.snapshot.globalWarnings.length) { el.globalBanner.classList.add("visible"); el.globalBanner.textContent = app.snapshot.globalWarnings[0]; } else { el.globalBanner.classList.remove("visible"); el.globalBanner.textContent = ""; }
        if (el.businessToggleButton && business) el.businessToggleButton.textContent = business.stage === "active" ? "Pause selected business" : "Activate selected business";
        if (el.controlContext && business) el.controlContext.textContent = "Selected business context: " + business.name + " (" + business.id + ")";
        setInspectorTab(state.inspectorTab);
        renderApprovalActions();
        renderChat(view.chatSummary);
        bindRouteButtons();
        bindDetailButtons();
      }
      async function runEngineSync() { setControlMessage("Running engine sync..."); const result = await postJson(app.routes.engineSync, {}); setControlMessage("Engine synced. Recommended concurrency: " + result.report.recommendedConcurrency); await refreshSnapshot(true); }
      async function toggleBusinessState() { const business = currentBusiness(); if (!business) return; const target = business.stage === "active" ? app.routes.pauseBusiness : app.routes.activateBusiness; setControlMessage((business.stage === "active" ? "Pausing " : "Activating ") + business.name + "..."); await postJson(target, { businessId: business.id }); setControlMessage("Updated business state for " + business.name + "."); await refreshSnapshot(true); }
      async function routeTask(event) {
        event.preventDefault();
        const business = currentBusiness();
        if (!business) return;
        const title = document.getElementById("task-title").value.trim();
        const summary = document.getElementById("task-summary").value.trim();
        const riskLevel = document.getElementById("task-risk").value;
        if (!title || !summary) { setControlMessage("Directive title and summary are required."); return; }
        setControlMessage("Routing operator directive...");
        const result = await postJson(app.routes.routeTask, { businessId: business.id, workflowId: business.workflowOwnership[0] ? business.workflowOwnership[0].workflowId : undefined, title, summary, riskLevel });
        document.getElementById("task-title").value = "";
        document.getElementById("task-summary").value = "";
        setControlMessage("Directive routed to " + result.routed.envelope.departmentId + " / " + result.routed.envelope.positionId + ".");
        await refreshSnapshot(true);
      }
      async function resolveApproval(event) {
        event.preventDefault();
        const approval = selectedApproval();
        const config = approvalActionConfig(approval);
        if (!approval || !config) {
          setControlMessage("Select a directly actionable approval first.");
          return;
        }
        const approvedBy = el.approvalApprovedBy && el.approvalApprovedBy.value.trim();
        const note = el.approvalNote && el.approvalNote.value.trim();
        setControlMessage("Recording approval...");
        const result = await postJson(app.routes.resolveApproval, {
          approvalId: approval.id,
          approvedBy: approvedBy || undefined,
          note: note || undefined
        });
        if (el.approvalNote) el.approvalNote.value = "";
        state.selectedApprovalId = null;
        setControlMessage(result.message || "Approval recorded.");
        detail(approval.actionNeeded, ["Status: completed", "Handler: " + (result.handledBy || "control-room"), "Message: " + (result.message || "Approval recorded.")]);
        await refreshSnapshot(true);
      }
      function connectStream() {
        if (app.appMode !== "hosted" || !window.EventSource) return;
        const stream = new EventSource(app.routes.stream, { withCredentials: true });
        stream.addEventListener("snapshot", (event) => { try { const next = JSON.parse(event.data); if (next.fingerprint !== app.snapshot.fingerprint) { app.snapshot = next; render(); } } catch {} });
        stream.addEventListener("error", () => { stream.close(); window.setTimeout(connectStream, 5000); });
      }
      if (el.chatTabButton) el.chatTabButton.addEventListener("click", () => setInspectorTab("chat"));
      if (el.controlsTabButton) el.controlsTabButton.addEventListener("click", () => setInspectorTab("controls"));
      if (el.chatForm) el.chatForm.addEventListener("submit", (event) => { void submitChat(event).catch((error) => setChatStatus(error.message || String(error))); });
      if (el.engineSyncButton) el.engineSyncButton.addEventListener("click", () => { void runEngineSync().catch((error) => setControlMessage(error.message || String(error))); });
      if (el.businessToggleButton) el.businessToggleButton.addEventListener("click", () => { void toggleBusinessState().catch((error) => setControlMessage(error.message || String(error))); });
      if (el.taskForm) el.taskForm.addEventListener("submit", (event) => { void routeTask(event).catch((error) => setControlMessage(error.message || String(error))); });
      if (el.approvalForm) el.approvalForm.addEventListener("submit", (event) => { void resolveApproval(event).catch((error) => setControlMessage(error.message || String(error))); });
      render();
      void ensureChatLoaded(false);
      connectStream();
      if (app.appMode !== "static") window.setInterval(() => { void refreshSnapshot(false); }, 30000);
    `;
  }

  private freshnessLabel(health: ControlRoomHealthReport): string {
    if (!health.lastSyncedAt) {
      return "No engine sync available yet";
    }
    return health.stale
      ? `Stale since ${health.lastSyncedAt}`
      : `Live from ${health.lastSyncedAt}`;
  }
}
