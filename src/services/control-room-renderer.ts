import type { ControlRoomHealthReport, ControlRoomSnapshot } from "../domain/control-room.js";

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

function statusToneFor(businessStage: string, health: ControlRoomHealthReport): string {
  if (health.status !== "ready") {
    return "degraded";
  }
  if (businessStage === "paused") {
    return "paused";
  }
  if (businessStage === "scaffolded") {
    return "blocked";
  }
  return businessStage;
}

export interface ControlRoomPageOptions {
  selectedBusinessId?: string;
  selectedDepartmentId?: string;
  appMode: "static" | "hosted";
}

export class ControlRoomRenderer {
  renderPage(snapshot: ControlRoomSnapshot, options: ControlRoomPageOptions): string {
    const selectedBusiness =
      snapshot.businesses.find((business) => business.id === options.selectedBusinessId) ??
      snapshot.businesses[0];
    const selectedDepartmentId =
      options.selectedDepartmentId ?? selectedBusiness?.office?.departments[0]?.id ?? null;
    const initialPayload = JSON.stringify({
      snapshot,
      selectedBusinessId: selectedBusiness?.id ?? null,
      selectedDepartmentId,
      appMode: options.appMode
    });

    const heroAction = options.appMode === "hosted"
      ? `<a class="button" href="/logout">Sign out</a>`
      : `<span class="button" aria-disabled="true">Static export</span>`;

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(snapshot.engineName)} Control Room</title>
    <style>
      :root{--bg:#081017;--panel:#111b23;--panel2:#0d161d;--line:rgba(176,198,214,.15);--text:#ebf1f5;--muted:#92a2af;--accent:#58d3a4;--accent2:#7cc7ff;--warning:#ffb14a;--danger:#ff7f75}
      *{box-sizing:border-box}html,body{margin:0;min-height:100%;background:radial-gradient(circle at top left,rgba(88,211,164,.14),transparent 28%),radial-gradient(circle at top right,rgba(124,199,255,.12),transparent 24%),linear-gradient(180deg,#081017 0%,#0b1117 100%);color:var(--text);font-family:"Bahnschrift","Aptos","Segoe UI Variable","Segoe UI",sans-serif}
      body{padding:22px}a{color:inherit;text-decoration:none}
      .shell{display:grid;grid-template-columns:280px minmax(0,1fr) 340px;gap:18px;align-items:start}
      .hero{grid-column:1 / -1;padding:26px 30px 24px;border:1px solid var(--line);background:linear-gradient(120deg,rgba(17,27,35,.96),rgba(8,15,21,.92)),linear-gradient(90deg,rgba(88,211,164,.15),transparent 45%);position:relative;overflow:hidden}
      .hero::after{content:"";position:absolute;inset:auto -10% -35% 40%;height:220px;background:radial-gradient(circle,rgba(124,199,255,.18),transparent 60%);filter:blur(18px);pointer-events:none}
      .hero-top,.headline{display:flex;justify-content:space-between;gap:18px;align-items:start}
      .hero h1{margin:0;font-size:clamp(2rem,4vw,4.2rem);line-height:.94;letter-spacing:-.04em;max-width:9ch}
      .hero p{max-width:60ch;margin:16px 0 0;color:var(--muted);line-height:1.6}
      .hero-actions{display:grid;gap:8px;justify-items:end}
      .eyebrow,.mono{font-family:"Cascadia Code","IBM Plex Mono","Consolas",monospace;font-size:.78rem}
      .eyebrow,.section-label,.region-title{color:var(--muted);letter-spacing:.12em;text-transform:uppercase}
      .button{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 14px;border:1px solid var(--line);background:rgba(255,255,255,.03)}
      .button:hover{border-color:rgba(124,199,255,.38)}
      .banner{display:none;margin-top:18px;padding:12px 14px;border:1px solid rgba(255,177,74,.28);background:rgba(255,177,74,.08);color:var(--warning)}
      .banner.visible{display:block}
      .kpi-strip{display:flex;flex-wrap:wrap;gap:12px;margin-top:22px}
      .kpi{min-width:150px;padding:12px 14px;border-top:1px solid var(--line)}
      .kpi label,.metric-box label,.finance-box label{display:block;font-size:.73rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
      .kpi strong{font-size:1.45rem}.rail,.main,.inspector{border:1px solid var(--line);background:linear-gradient(180deg,rgba(17,27,35,.9),rgba(11,17,23,.96))}
      .rail,.inspector{padding:18px}.main{padding:20px 24px}.business-list,.stack,.list,.roster{display:grid;gap:10px}
      .business-link{display:block;border:1px solid transparent;background:rgba(255,255,255,.02);padding:14px;transition:border-color .16s ease,transform .16s ease,background .16s ease}
      .business-link:hover,.business-link[aria-current="page"]{border-color:rgba(124,199,255,.38);background:rgba(124,199,255,.08);transform:translateY(-1px)}
      .headline{align-items:end;margin-bottom:18px}.headline h2{margin:0;font-size:clamp(1.5rem,2vw,2.35rem);letter-spacing:-.035em}.muted{color:var(--muted)}
      .status{display:inline-flex;align-items:center;gap:8px;font-size:.84rem;text-transform:uppercase;letter-spacing:.12em;color:var(--muted)}
      .status::before{content:"";width:9px;height:9px;border-radius:999px;background:var(--accent);box-shadow:0 0 0 6px rgba(88,211,164,.08)}
      .status[data-tone="blocked"]::before,.status[data-tone="attention-needed"]::before,.status[data-tone="degraded"]::before{background:var(--warning)}.status[data-tone="paused"]::before{background:var(--muted)}
      .section{padding-bottom:22px;margin-bottom:22px;border-bottom:1px solid var(--line)}.section:last-child{border-bottom:0;margin-bottom:0;padding-bottom:0}
      .metric-grid,.finance-grid{display:grid;gap:14px}.metric-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.finance-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
      .metric-box,.finance-box,.roster-row,.list-item{padding-top:12px;border-top:1px solid var(--line)}
      .metric-box strong,.finance-box strong{display:block;margin-top:7px;font-size:1.15rem}
      .roster-row{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr) auto;gap:14px;padding-bottom:12px}
      .tag{display:inline-flex;align-items:center;padding:4px 8px;border:1px solid var(--line);color:var(--muted);font-size:.75rem;letter-spacing:.08em;text-transform:uppercase}
      .detail-panel{padding:14px;border:1px solid var(--line);background:rgba(255,255,255,.03);margin-top:16px}
      .warning-list{display:grid;gap:10px;padding-left:18px}.warning-list li{margin:0;color:var(--warning)}.inspector{position:sticky;top:22px}
      @media (max-width:1220px){.shell{grid-template-columns:1fr}.inspector{position:static}.metric-grid,.finance-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media (max-width:760px){body{padding:12px}.hero{padding:20px}.hero-top,.headline{flex-direction:column}.metric-grid,.finance-grid{grid-template-columns:1fr}.roster-row{grid-template-columns:1fr}}
    </style>
  </head>
  <body>
    <div class="shell">
      <section class="hero">
        <div class="hero-top">
          <div>
            <div class="eyebrow">Executive Office</div>
            <h1>${escapeHtml(snapshot.engineName)}</h1>
            <p>${escapeHtml(snapshot.engineOverview)}</p>
          </div>
          <div class="hero-actions">
            <div class="eyebrow">Hosted ${escapeHtml(options.appMode)} view</div>
            <div class="mono" id="freshness-label">${escapeHtml(this.freshnessLabel(snapshot.health))}</div>
            ${heroAction}
          </div>
        </div>
        <div class="banner${snapshot.globalWarnings.length > 0 ? " visible" : ""}" id="global-banner">${snapshot.globalWarnings[0] ? escapeHtml(snapshot.globalWarnings[0]) : ""}</div>
        <div class="kpi-strip">
          <div class="kpi"><label>Active Businesses</label><strong>${snapshot.report?.businessCounts.active ?? 0}</strong></div>
          <div class="kpi"><label>Ready Next</label><strong>${snapshot.report?.businessCounts.ready ?? 0}</strong></div>
          <div class="kpi"><label>Approvals Waiting</label><strong>${snapshot.executiveView.approvalsWaiting}</strong></div>
          <div class="kpi"><label>Recommended Concurrency</label><strong>${snapshot.report?.recommendedConcurrency ?? 0}</strong></div>
          <div class="kpi"><label>Net Monthly Revenue</label><strong>${formatMoney(snapshot.report?.netMonthlyRevenue ?? 0)}</strong></div>
          <div class="kpi"><label>Collective Transfer</label><strong>${formatMoney(snapshot.executiveBudgetView?.collectiveTransfer ?? 0)}</strong></div>
        </div>
      </section>
      <aside class="rail"><div class="region-title">Business Offices</div><div class="business-list" id="business-list"></div></aside>
      <main class="main">
        <section class="section">
          <div class="headline"><div><div class="mono muted" id="business-id"></div><h2 id="business-name"></h2></div><div class="status" id="business-status"></div></div>
          <p class="muted" id="business-summary"></p>
          <div class="metric-grid" id="business-metrics"></div>
        </section>
        <section class="section">
          <div class="region-title">Budget Monitor</div>
          <div class="finance-grid" id="finance-grid"></div>
          <div class="detail-panel" id="finance-meta"></div>
        </section>
        <section class="section"><div class="region-title">Department Office</div><div class="roster" id="department-roster"></div></section>
        <section class="section"><div class="region-title">Workflow Ownership</div><div class="roster" id="workflow-roster"></div></section>
      </main>
      <aside class="inspector"><div class="stack">
        <section><div class="region-title">Approval Queue</div><div class="list" id="approval-list"></div></section>
        <section><div class="region-title">Task Inspector</div><div class="list" id="task-list"></div></section>
        <section><div class="region-title">Activity Log</div><div class="list" id="audit-list"></div></section>
      </div></aside>
    </div>
    <script>
      const app = ${initialPayload};
      const state = { selectedBusinessId: app.selectedBusinessId, selectedDepartmentId: app.selectedDepartmentId };
      const businessList = document.getElementById("business-list");
      const businessId = document.getElementById("business-id");
      const businessName = document.getElementById("business-name");
      const businessStatus = document.getElementById("business-status");
      const businessSummary = document.getElementById("business-summary");
      const businessMetrics = document.getElementById("business-metrics");
      const financeGrid = document.getElementById("finance-grid");
      const financeMeta = document.getElementById("finance-meta");
      const departmentRoster = document.getElementById("department-roster");
      const workflowRoster = document.getElementById("workflow-roster");
      const approvalList = document.getElementById("approval-list");
      const taskList = document.getElementById("task-list");
      const auditList = document.getElementById("audit-list");
      const freshnessLabel = document.getElementById("freshness-label");
      const globalBanner = document.getElementById("global-banner");

      function routeForBusiness(id) { return "/business/" + encodeURIComponent(id); }
      function routeForDepartment(businessId, departmentId) { return "/department/" + encodeURIComponent(businessId) + "/" + encodeURIComponent(departmentId); }
      function formatMoney(value) { return "$" + Number(value || 0).toFixed(2); }
      function toneFor(business) {
        if (app.snapshot.health.status !== "ready") return "degraded";
        if (!business) return "paused";
        if (business.office && business.office.alerts && business.office.alerts.length) return "attention-needed";
        if (business.stage === "paused") return "paused";
        if (business.stage === "scaffolded") return "blocked";
        return business.stage;
      }

      function renderBusinessButtons() {
        businessList.innerHTML = "";
        app.snapshot.businesses.forEach((business) => {
          const link = document.createElement("a");
          link.className = "business-link";
          link.href = routeForBusiness(business.id);
          link.setAttribute("aria-current", String(state.selectedBusinessId === business.id));
          link.innerHTML = "<strong>" + business.name + "</strong><span class=\\"muted\\">" + business.category.replaceAll("_", " ") + " · " + business.stage + "</span>";
          link.addEventListener("click", (event) => {
            event.preventDefault();
            state.selectedBusinessId = business.id;
            state.selectedDepartmentId = business.office && business.office.departments[0] ? business.office.departments[0].id : null;
            history.replaceState({}, "", routeForBusiness(business.id));
            render();
          });
          businessList.appendChild(link);
        });
      }

      function render() {
        renderBusinessButtons();
        const business = app.snapshot.businesses.find((entry) => entry.id === state.selectedBusinessId) || app.snapshot.businesses[0];
        if (!business) return;
        businessId.textContent = business.id;
        businessName.textContent = business.name;
        businessStatus.textContent = business.stage;
        businessStatus.dataset.tone = toneFor(business);
        businessSummary.textContent = business.summary;
        freshnessLabel.textContent = (app.snapshot.health.stale ? "Stale since " : "Last sync: ") + (app.snapshot.health.lastSyncedAt || "not available");
        businessMetrics.innerHTML = [["Revenue", formatMoney(business.monthlyRevenue)],["Costs", formatMoney(business.monthlyCosts)],["Net", formatMoney(business.netRevenue)],["Automation", Math.round(business.automationCoverage * 100) + "%"],["Open Work", String(business.activeWorkItems)],["Approvals", String(business.approvals.length)]].map(([label, value]) => "<div class=\\"metric-box\\"><label>" + label + "</label><strong>" + value + "</strong></div>").join("");
        const budget = business.budgetView;
        financeGrid.innerHTML = budget ? [["Verified Net Revenue", formatMoney(budget.verifiedNetRevenue)],["Growth Reinvestment", formatMoney(budget.growthReinvestment)],["Collective Transfer", formatMoney(budget.collectiveTransfer)],["Observed Relay Deposits", formatMoney(budget.relayDeposits)],["Observed Relay Spend", formatMoney(budget.relaySpend)],["Excluded Transactions", String(budget.excludedFromAllocationCount)]].map(([label, value]) => "<div class=\\"finance-box\\"><label>" + label + "</label><strong>" + value + "</strong></div>").join("") : "<div class=\\"muted\\">No verified allocation snapshot is available for this business yet.</div>";
        financeMeta.innerHTML = budget ? "<div class=\\"section-label\\">Data Quality</div><div class=\\"muted\\">" + (budget.basedOnVerifiedDataOnly ? "Allocation decisions are restricted to verified data only." : "Allocation view includes degraded data quality.") + "</div>" + (budget.warnings.length ? "<ul class=\\"warning-list\\">" + budget.warnings.map((warning) => "<li>" + warning + "</li>").join("") + "</ul>" : "") : "<div class=\\"muted\\">Run revenue imports to populate verified earnings and reinvestment views.</div>";
        departmentRoster.innerHTML = (business.office ? business.office.departments : []).map((panel) => "<article class=\\"roster-row\\"><div><strong>" + panel.title + "</strong><div class=\\"muted\\">" + panel.subtitle + "</div></div><div class=\\"muted\\">" + panel.metrics.join(" · ") + "</div><div><span class=\\"tag\\">" + panel.status + "</span></div></article>").join("") || "<div class=\\"muted\\">No department office has been generated for this business yet.</div>";
        workflowRoster.innerHTML = business.workflowOwnership.map((owner) => "<article class=\\"roster-row\\"><div><strong>" + owner.workflowName + "</strong><div class=\\"muted mono\\">" + owner.workflowId + "</div></div><div class=\\"muted\\">" + owner.departmentName + " / " + owner.positionName + "</div><div><span class=\\"tag\\">" + owner.allowedModelTier + "</span></div></article>").join("") || "<div class=\\"muted\\">No workflow ownership records found.</div>";
        approvalList.innerHTML = business.approvals.map((approval) => "<article class=\\"list-item\\"><strong>" + approval.actionNeeded + "</strong><div class=\\"muted\\">" + approval.reason + "</div><div class=\\"muted mono\\">" + approval.relatedEntityType + " · " + approval.status + "</div></article>").join("") || "<div class=\\"muted\\">No open business-specific approvals.</div>";
        taskList.innerHTML = business.recentTasks.map((task) => "<article class=\\"list-item\\"><strong>" + task.title + "</strong><div class=\\"muted mono\\">" + (task.workflowId || "manual") + " · " + task.riskLevel + "</div><div class=\\"muted\\">" + task.summary + "</div><div class=\\"muted\\">Owner scope: " + task.departmentId + " / " + task.positionId + "</div></article>").join("") || "<div class=\\"muted\\">No recent task envelopes for this business yet.</div>";
        const auditRecords = business.recentAudits.length ? business.recentAudits : app.snapshot.recentAudits;
        auditList.innerHTML = auditRecords.map((record) => "<article class=\\"list-item\\"><strong>" + record.summary + "</strong><div class=\\"muted mono\\">" + record.eventType + " · " + record.createdAt + "</div><div class=\\"muted\\">" + (record.details[0] || "") + "</div></article>").join("") || "<div class=\\"muted\\">No audit activity has been recorded yet.</div>";
        if (app.snapshot.globalWarnings.length) { globalBanner.classList.add("visible"); globalBanner.textContent = app.snapshot.globalWarnings[0]; } else { globalBanner.classList.remove("visible"); globalBanner.textContent = ""; }
      }

      async function refreshSnapshot() {
        try {
          const response = await fetch("/api/control-room/snapshot", { credentials: "same-origin" });
          if (!response.ok) return;
          const next = await response.json();
          if (next.fingerprint !== app.snapshot.fingerprint) {
            app.snapshot = next;
            render();
          }
        } catch {}
      }

      function connectStream() {
        if (app.appMode !== "hosted" || !window.EventSource) return;
        const stream = new EventSource("/api/control-room/stream", { withCredentials: true });
        stream.addEventListener("snapshot", (event) => {
          try {
            const next = JSON.parse(event.data);
            if (next.fingerprint !== app.snapshot.fingerprint) {
              app.snapshot = next;
              render();
            }
          } catch {}
        });
        stream.addEventListener("error", () => {
          stream.close();
          window.setTimeout(connectStream, 5000);
        });
      }

      render();
      connectStream();
      if (app.appMode === "hosted") window.setInterval(refreshSnapshot, 30000);
    </script>
  </body>
</html>`;
  }

  renderLoginPage(args: { engineName: string; message?: string; nextPath?: string }): string {
    const nextValue = args.nextPath ? escapeHtml(args.nextPath) : "/";
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${escapeHtml(args.engineName)} Control Room Login</title><style>
      :root{--line:rgba(176,198,214,.15);--text:#ebf1f5;--muted:#92a2af;--warning:#ffb14a}
      *{box-sizing:border-box}html,body{margin:0;min-height:100%;background:radial-gradient(circle at top left,rgba(88,211,164,.14),transparent 28%),radial-gradient(circle at top right,rgba(124,199,255,.12),transparent 24%),linear-gradient(180deg,#081017 0%,#0b1117 100%);color:var(--text);font-family:"Bahnschrift","Aptos","Segoe UI Variable","Segoe UI",sans-serif}
      body{display:grid;place-items:center;padding:20px}.panel{width:min(460px,100%);padding:28px;border:1px solid var(--line);background:linear-gradient(180deg,rgba(17,27,35,.92),rgba(11,17,23,.96))}
      h1{margin:0;font-size:clamp(1.8rem,5vw,3rem);letter-spacing:-.04em}p{color:var(--muted);line-height:1.6}label{display:block;font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
      input{width:100%;min-height:48px;padding:0 14px;border:1px solid var(--line);background:rgba(255,255,255,.03);color:var(--text);font:inherit}button{width:100%;min-height:46px;border:1px solid var(--line);background:rgba(88,211,164,.12);color:var(--text);font:inherit;cursor:pointer}
      .message{margin-bottom:16px;padding:12px 14px;border:1px solid rgba(255,177,74,.3);background:rgba(255,177,74,.08);color:var(--warning)}
    </style></head>
    <body><section class="panel"><div style="font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;color:#92a2af;">Private VPS Control Room</div><h1>${escapeHtml(args.engineName)}</h1><p>Use the owner password to open the hosted control room inside the VPS browser or an SSH tunnel.</p>${args.message ? `<div class="message">${escapeHtml(args.message)}</div>` : ""}<form method="post" action="/login"><input type="hidden" name="next" value="${nextValue}" /><label for="password">Owner password</label><input id="password" name="password" type="password" autocomplete="current-password" /><div style="height:16px;"></div><button type="submit">Open control room</button></form></section></body></html>`;
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
