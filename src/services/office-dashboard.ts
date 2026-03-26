import path from "node:path";
import type { AppConfig } from "../config.js";
import type { ApprovalTask } from "../domain/contracts.js";
import type { EngineOverviewReport, ManagedBusiness } from "../domain/engine.js";
import type {
  BusinessOfficeView,
  OfficePanelSummary,
  OfficeViewSnapshot,
  OrgAuditRecord,
  TaskEnvelope,
  WorkflowOwnershipRecord
} from "../domain/org.js";
import { ensureDir, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { FileStore } from "../storage/store.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type DashboardBusinessPayload = {
  id: string;
  name: string;
  category: string;
  stage: string;
  summary: string;
  monthlyRevenue: number;
  monthlyCosts: number;
  netRevenue: number;
  automationCoverage: number;
  activeWorkItems: number;
  office?: BusinessOfficeView;
  approvals: ApprovalTask[];
  workflowOwnership: WorkflowOwnershipRecord[];
  recentTasks: TaskEnvelope[];
  recentAudits: OrgAuditRecord[];
};

type DashboardPayload = {
  generatedAt: string;
  engineName: string;
  engineOverview: string;
  report?: EngineOverviewReport;
  executiveView: OfficeViewSnapshot["executiveView"];
  approvals: ApprovalTask[];
  businesses: DashboardBusinessPayload[];
  recentAudits: OrgAuditRecord[];
};

export class OfficeDashboardService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {}

  async writeDashboard(): Promise<{
    htmlPath: string;
    dataPath: string;
  }> {
    const [engine, snapshot, report, businesses, approvals, auditRecords, taskEnvelopes, workflowOwnership] =
      await Promise.all([
        this.store.getEngineState(),
        this.getLatestOfficeSnapshot(),
        this.getLatestEngineReport(),
        this.store.getManagedBusinesses(),
        this.store.getApprovals(),
        this.store.getOrgAuditRecords(),
        this.store.getTaskEnvelopes(),
        this.store.getWorkflowOwnership()
      ]);

    if (!engine || !snapshot) {
      throw new Error("Cannot write office dashboard before engine and office snapshot exist.");
    }

    const payload: DashboardPayload = {
      generatedAt: new Date().toISOString(),
      engineName: engine.name,
      engineOverview: engine.overview,
      report,
      executiveView: snapshot.executiveView,
      approvals: approvals.filter((approval) => approval.status !== "completed"),
      recentAudits: [...auditRecords]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 12),
      businesses: businesses
        .sort((left, right) => left.launchPriority - right.launchPriority)
        .map((business) => ({
          id: business.id,
          name: business.name,
          category: business.category,
          stage: business.stage,
          summary: business.summary,
          monthlyRevenue: business.metrics.currentMonthlyRevenue,
          monthlyCosts: business.metrics.currentMonthlyCosts,
          netRevenue: business.metrics.currentMonthlyRevenue - business.metrics.currentMonthlyCosts,
          automationCoverage: business.metrics.automationCoverage,
          activeWorkItems: business.metrics.activeWorkItems,
          office: snapshot.businessViews.find((view) => view.businessId === business.id),
          approvals: approvals.filter(
            (approval) =>
              approval.relatedEntityType === "business" &&
              approval.relatedEntityId === business.id &&
              approval.status !== "completed"
          ),
          workflowOwnership: workflowOwnership.filter((record) => record.businessId === business.id),
          recentTasks: taskEnvelopes
            .filter((task) => task.businessId === business.id)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
            .slice(0, 6),
          recentAudits: auditRecords
            .filter((record) => record.businessId === business.id)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
            .slice(0, 6)
        }))
    };

    const outputDir = path.join(this.config.opsDir, "control-room");
    const htmlPath = path.join(outputDir, "index.html");
    const dataPath = path.join(outputDir, "data.json");

    await ensureDir(outputDir);
    await writeJsonFile(dataPath, payload);
    await writeTextFile(htmlPath, this.renderHtml(payload));

    return { htmlPath, dataPath };
  }

  private async getLatestOfficeSnapshot(): Promise<OfficeViewSnapshot | undefined> {
    const snapshots = await this.store.getOfficeViewSnapshots();
    return [...snapshots].sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0];
  }

  private async getLatestEngineReport(): Promise<EngineOverviewReport | undefined> {
    const reports = await this.store.getEngineReports();
    return [...reports].sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0];
  }

  private renderHtml(payload: DashboardPayload): string {
    const serializedPayload = JSON.stringify(payload);
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(payload.engineName)} Control Room</title>
    <style>
      :root {
        --bg: #0b1117;
        --panel: #111b23;
        --panel-2: #0f171e;
        --text: #ebf1f5;
        --muted: #92a2af;
        --line: rgba(176, 198, 214, 0.15);
        --accent: #58d3a4;
        --accent-2: #7cc7ff;
        --warning: #ffb14a;
        --danger: #ff7f75;
      }

      * { box-sizing: border-box; }

      html, body {
        margin: 0;
        min-height: 100%;
        background:
          radial-gradient(circle at top left, rgba(88, 211, 164, 0.14), transparent 28%),
          radial-gradient(circle at top right, rgba(124, 199, 255, 0.12), transparent 24%),
          linear-gradient(180deg, #081017 0%, #0b1117 100%);
        color: var(--text);
        font-family: "Bahnschrift", "Aptos", "Segoe UI Variable", "Segoe UI", sans-serif;
      }

      body {
        padding: 28px;
      }

      .shell {
        display: grid;
        grid-template-columns: 280px minmax(0, 1fr) 340px;
        gap: 20px;
        align-items: start;
      }

      .hero {
        grid-column: 1 / -1;
        min-height: 220px;
        padding: 28px 30px;
        border: 1px solid var(--line);
        background:
          linear-gradient(120deg, rgba(17, 27, 35, 0.96), rgba(8, 15, 21, 0.92)),
          linear-gradient(90deg, rgba(88, 211, 164, 0.15), transparent 45%);
        position: relative;
        overflow: hidden;
      }

      .hero::after {
        content: "";
        position: absolute;
        inset: auto -10% -35% 40%;
        height: 220px;
        background: radial-gradient(circle, rgba(124, 199, 255, 0.18), transparent 60%);
        filter: blur(18px);
        pointer-events: none;
      }

      .hero h1 {
        margin: 0;
        font-size: clamp(2rem, 4vw, 4.4rem);
        line-height: 0.94;
        letter-spacing: -0.04em;
        max-width: 9ch;
      }

      .hero p {
        max-width: 62ch;
        margin: 18px 0 0;
        color: var(--muted);
        font-size: 1rem;
        line-height: 1.6;
      }

      .kpi-strip {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 24px;
      }

      .kpi {
        min-width: 160px;
        padding: 12px 14px;
        border-top: 1px solid var(--line);
      }

      .kpi label {
        display: block;
        font-size: 0.73rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted);
        margin-bottom: 8px;
      }

      .kpi strong {
        font-size: 1.45rem;
        font-weight: 600;
      }

      .rail, .main, .inspector {
        border: 1px solid var(--line);
        background: linear-gradient(180deg, rgba(17, 27, 35, 0.9), rgba(11, 17, 23, 0.96));
      }

      .rail {
        padding: 18px;
      }

      .rail h2, .main h2, .inspector h2 {
        margin: 0 0 16px;
        font-size: 0.84rem;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--muted);
      }

      .business-list {
        display: grid;
        gap: 10px;
      }

      .business-button {
        appearance: none;
        border: 1px solid transparent;
        background: rgba(255,255,255,0.02);
        color: inherit;
        text-align: left;
        padding: 14px;
        cursor: pointer;
        transition: border-color 160ms ease, transform 160ms ease, background 160ms ease;
      }

      .business-button:hover,
      .business-button[aria-pressed="true"] {
        border-color: rgba(124, 199, 255, 0.38);
        background: rgba(124, 199, 255, 0.08);
        transform: translateY(-1px);
      }

      .business-button strong {
        display: block;
        font-size: 1rem;
        margin-bottom: 6px;
      }

      .business-button span,
      .muted {
        color: var(--muted);
      }

      .main {
        padding: 22px 24px;
      }

      .section {
        padding-bottom: 22px;
        margin-bottom: 22px;
        border-bottom: 1px solid var(--line);
        animation: rise 260ms ease both;
      }

      .section:last-child {
        border-bottom: 0;
        margin-bottom: 0;
        padding-bottom: 0;
      }

      .headline {
        display: flex;
        justify-content: space-between;
        gap: 20px;
        align-items: end;
        margin-bottom: 18px;
      }

      .headline h3 {
        margin: 0;
        font-size: clamp(1.5rem, 2vw, 2.4rem);
        letter-spacing: -0.035em;
      }

      .status {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 0.84rem;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--muted);
      }

      .status::before {
        content: "";
        width: 9px;
        height: 9px;
        border-radius: 999px;
        background: var(--accent);
        box-shadow: 0 0 0 6px rgba(88, 211, 164, 0.08);
      }

      .status[data-tone="blocked"]::before,
      .status[data-tone="attention-needed"]::before { background: var(--warning); }
      .status[data-tone="paused"]::before { background: var(--muted); }

      .metric-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 14px;
      }

      .metric-box {
        padding: 14px 0;
        border-top: 1px solid var(--line);
      }

      .metric-box label {
        display: block;
        font-size: 0.74rem;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }

      .metric-box strong {
        display: block;
        margin-top: 7px;
        font-size: 1.18rem;
      }

      .roster {
        display: grid;
        gap: 12px;
      }

      .roster-row {
        display: grid;
        grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto;
        gap: 14px;
        padding: 13px 0;
        border-top: 1px solid var(--line);
      }

      .tag {
        display: inline-flex;
        align-items: center;
        padding: 4px 8px;
        border: 1px solid var(--line);
        color: var(--muted);
        font-size: 0.75rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .inspector {
        padding: 18px;
        position: sticky;
        top: 28px;
      }

      .stack {
        display: grid;
        gap: 18px;
      }

      .list {
        display: grid;
        gap: 10px;
      }

      .list-item {
        padding-top: 10px;
        border-top: 1px solid var(--line);
      }

      .list-item strong {
        display: block;
        margin-bottom: 6px;
      }

      .tone-warning { color: var(--warning); }
      .tone-danger { color: var(--danger); }
      .mono {
        font-family: "Cascadia Code", "IBM Plex Mono", "Consolas", monospace;
        font-size: 0.84rem;
      }

      @keyframes rise {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @media (max-width: 1200px) {
        .shell {
          grid-template-columns: 1fr;
        }

        .inspector {
          position: static;
        }

        .metric-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 760px) {
        body { padding: 14px; }
        .hero { padding: 20px; min-height: 0; }
        .metric-grid { grid-template-columns: 1fr; }
        .roster-row { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <section class="hero">
        <h1>${escapeHtml(payload.engineName)}</h1>
        <p>${escapeHtml(payload.engineOverview)}</p>
        <div class="kpi-strip">
          <div class="kpi"><label>Active Businesses</label><strong>${payload.report?.businessCounts.active ?? 0}</strong></div>
          <div class="kpi"><label>Ready Next</label><strong>${payload.report?.businessCounts.ready ?? 0}</strong></div>
          <div class="kpi"><label>Approvals Waiting</label><strong>${payload.executiveView.approvalsWaiting}</strong></div>
          <div class="kpi"><label>Recommended Concurrency</label><strong>${payload.report?.recommendedConcurrency ?? 0}</strong></div>
          <div class="kpi"><label>Net Monthly Revenue</label><strong>$${(payload.report?.netMonthlyRevenue ?? 0).toFixed(2)}</strong></div>
        </div>
      </section>

      <aside class="rail">
        <h2>Business Offices</h2>
        <div class="business-list" id="business-list"></div>
      </aside>

      <main class="main">
        <section class="section">
          <div class="headline">
            <div>
              <div class="muted mono" id="business-id"></div>
              <h3 id="business-name"></h3>
            </div>
            <div class="status" id="business-status"></div>
          </div>
          <p class="muted" id="business-summary"></p>
          <div class="metric-grid" id="business-metrics"></div>
        </section>

        <section class="section">
          <h2>Department Office</h2>
          <div class="roster" id="department-roster"></div>
        </section>

        <section class="section">
          <h2>Workflow Ownership</h2>
          <div class="roster" id="workflow-roster"></div>
        </section>
      </main>

      <aside class="inspector">
        <div class="stack">
          <section>
            <h2>Approval Queue</h2>
            <div class="list" id="approval-list"></div>
          </section>
          <section>
            <h2>Task Inspector</h2>
            <div class="list" id="task-list"></div>
          </section>
          <section>
            <h2>Activity Log</h2>
            <div class="list" id="audit-list"></div>
          </section>
        </div>
      </aside>
    </div>

    <script>
      const payload = ${serializedPayload};
      const state = {
        selectedBusinessId: payload.businesses[0]?.id ?? null
      };

      const businessList = document.getElementById("business-list");
      const businessId = document.getElementById("business-id");
      const businessName = document.getElementById("business-name");
      const businessStatus = document.getElementById("business-status");
      const businessSummary = document.getElementById("business-summary");
      const businessMetrics = document.getElementById("business-metrics");
      const departmentRoster = document.getElementById("department-roster");
      const workflowRoster = document.getElementById("workflow-roster");
      const approvalList = document.getElementById("approval-list");
      const taskList = document.getElementById("task-list");
      const auditList = document.getElementById("audit-list");

      function renderBusinessButtons() {
        businessList.innerHTML = "";
        payload.businesses.forEach((business) => {
          const button = document.createElement("button");
          button.className = "business-button";
          button.type = "button";
          button.setAttribute("aria-pressed", String(state.selectedBusinessId === business.id));
          button.innerHTML = \`
            <strong>\${business.name}</strong>
            <span>\${business.category.replaceAll("_", " ")} · \${business.stage}</span>
          \`;
          button.addEventListener("click", () => {
            state.selectedBusinessId = business.id;
            render();
          });
          businessList.appendChild(button);
        });
      }

      function render() {
        renderBusinessButtons();
        const business = payload.businesses.find((entry) => entry.id === state.selectedBusinessId) ?? payload.businesses[0];
        if (!business) {
          return;
        }

        businessId.textContent = business.id;
        businessName.textContent = business.name;
        businessStatus.textContent = business.stage;
        businessStatus.dataset.tone = business.office?.alerts?.length ? "attention-needed" : business.stage;
        businessSummary.textContent = business.summary;

        businessMetrics.innerHTML = [
          ["Revenue", \`$\${business.monthlyRevenue.toFixed(2)}\`],
          ["Costs", \`$\${business.monthlyCosts.toFixed(2)}\`],
          ["Net", \`$\${business.netRevenue.toFixed(2)}\`],
          ["Automation", \`\${Math.round(business.automationCoverage * 100)}%\`],
          ["Open Work", String(business.activeWorkItems)],
          ["Approvals", String(business.approvals.length)]
        ].map(([label, value]) => \`<div class="metric-box"><label>\${label}</label><strong>\${value}</strong></div>\`).join("");

        departmentRoster.innerHTML = (business.office?.departments ?? []).map((panel) => \`
          <article class="roster-row">
            <div>
              <strong>\${panel.title}</strong>
              <div class="muted">\${panel.subtitle}</div>
            </div>
            <div class="muted">\${panel.metrics.join(" · ")}</div>
            <div><span class="tag">\${panel.status}</span></div>
          </article>
        \`).join("") || '<div class="muted">No department office has been generated for this business yet.</div>';

        workflowRoster.innerHTML = business.workflowOwnership.map((owner) => \`
          <article class="roster-row">
            <div>
              <strong>\${owner.workflowName}</strong>
              <div class="muted mono">\${owner.workflowId}</div>
            </div>
            <div class="muted">\${owner.departmentName} / \${owner.positionName}</div>
            <div><span class="tag">\${owner.allowedModelTier}</span></div>
          </article>
        \`).join("") || '<div class="muted">No workflow ownership records found.</div>';

        approvalList.innerHTML = business.approvals.map((approval) => \`
          <article class="list-item">
            <strong>\${approval.actionNeeded}</strong>
            <div class="muted">\${approval.reason}</div>
          </article>
        \`).join("") || '<div class="muted">No open business-specific approvals.</div>';

        taskList.innerHTML = business.recentTasks.map((task) => \`
          <article class="list-item">
            <strong>\${task.title}</strong>
            <div class="muted mono">\${task.workflowId ?? "manual"} · \${task.riskLevel}</div>
            <div class="muted">\${task.summary}</div>
          </article>
        \`).join("") || '<div class="muted">No recent task envelopes for this business yet.</div>';

        const auditRecords = business.recentAudits.length > 0 ? business.recentAudits : payload.recentAudits;
        auditList.innerHTML = auditRecords.map((record) => \`
          <article class="list-item">
            <strong>\${record.summary}</strong>
            <div class="muted mono">\${record.eventType} · \${record.createdAt}</div>
            <div class="muted">\${record.details[0] ?? ""}</div>
          </article>
        \`).join("") || '<div class="muted">No audit activity has been recorded yet.</div>';
      }

      render();
    </script>
  </body>
</html>`;
  }
}
