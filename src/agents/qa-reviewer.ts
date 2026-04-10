import path from "node:path";
import type { AppConfig } from "../config.js";
import type { ClientJob, QaCheck, QaReport } from "../domain/contracts.js";
import { resolveClientPreviewPath } from "../lib/client-preview.js";
import { readTextFile, writeJsonFile } from "../lib/fs.js";
import { FileStore } from "../storage/store.js";

export class QaReviewerAgent {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {}

  async review(client: ClientJob): Promise<QaReport> {
    const previewPath = await resolveClientPreviewPath(this.config, client);
    if (!previewPath) {
      throw new Error(`Client ${client.id} has no preview path.`);
    }

    const html = await readTextFile(path.join(previewPath, "index.html"));
    const css = await readTextFile(path.join(previewPath, "styles.css"));
    const checks: QaCheck[] = [
      {
        label: "Viewport meta tag",
        passed: /<meta name="viewport" content="width=device-width, initial-scale=1"/.test(html),
        detail: "Landing page must declare a mobile viewport."
      },
      {
        label: "Primary phone CTA",
        passed: html.includes(`href="tel:${client.primaryPhone.replace(/[^0-9+]/g, "")}`),
        detail: "Primary CTA should include a tap-to-call link."
      },
      {
        label: "Service request form",
        passed: /<form[^>]*method="post"/.test(html),
        detail: "Lead capture form must be present."
      },
      {
        label: "Form routing",
        passed: Boolean(client.formEndpoint) ? html.includes(`action="${client.formEndpoint}"`) : false,
        detail: "Paid builds should include a concrete form action endpoint."
      },
      {
        label: "Responsive layout rules",
        passed: /@media \(max-width: 840px\)/.test(css),
        detail: "CSS should include a responsive breakpoint."
      },
      {
        label: "Visual hierarchy",
        passed: /font-family: "Newsreader"/.test(css) && /background-orb/.test(css),
        detail: "Preview should preserve the intended visual direction."
      }
    ];

    const report: QaReport = {
      clientId: client.id,
      createdAt: new Date().toISOString(),
      checks,
      passed: checks.every((item) => item.passed)
    };

    await writeJsonFile(path.join(this.config.reportDir, `${client.id}-qa.json`), report);
    await this.store.saveClient({
      ...client,
      siteStatus: report.passed ? "ready" : "qa_failed",
      qaStatus: report.passed ? "passed" : "failed",
      deployment: {
        ...client.deployment,
        previewPath
      },
      updatedAt: new Date().toISOString()
    });

    return report;
  }
}
