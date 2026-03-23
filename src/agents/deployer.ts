import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AppConfig } from "../config.js";
import type { ClientJob } from "../domain/contracts.js";
import { FileStore } from "../storage/store.js";
import { AccountOpsAgent } from "./account-ops.js";

const execFileAsync = promisify(execFile);

export class Deployer {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore,
    private readonly accountOps: AccountOpsAgent
  ) {}

  async deploy(client: ClientJob): Promise<string> {
    if (!client.deployment.previewPath) {
      throw new Error(`No preview path available for ${client.id}.`);
    }

    if (!this.config.cloudflare) {
      const task = await this.accountOps.createOrUpdateTask({
        id: "approval-cloudflare-access",
        type: "domain",
        actionNeeded: "Connect Cloudflare Pages credentials",
        reason: "Production deployment needs CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and CLOUDFLARE_PAGES_PROJECT.",
        ownerInstructions:
          "Create a Cloudflare Pages project, generate an API token with Pages deploy access, and add the three Cloudflare env vars.",
        relatedEntityType: "account",
        relatedEntityId: "cloudflare"
      });
      await this.accountOps.notifyApproval(task);
      return client.deployment.previewPath;
    }

    const { stdout } = await execFileAsync(
      "npx",
      [
        "wrangler",
        "pages",
        "deploy",
        client.deployment.previewPath,
        "--project-name",
        this.config.cloudflare.pagesProject,
        "--commit-dirty=true"
      ],
      {
        cwd: this.config.projectRoot,
        env: {
          ...process.env,
          CLOUDFLARE_ACCOUNT_ID: this.config.cloudflare.accountId,
          CLOUDFLARE_API_TOKEN: this.config.cloudflare.apiToken
        }
      }
    );

    const urlMatch = stdout.match(/https:\/\/[^\s]+/);
    const productionUrl = urlMatch?.[0] ?? client.deployment.previewPath;

    await this.store.saveClient({
      ...client,
      siteStatus: "deployed",
      deployment: {
        platform: "cloudflare-pages",
        previewPath: client.deployment.previewPath,
        productionUrl
      },
      updatedAt: new Date().toISOString()
    });

    return productionUrl;
  }
}
