import path from "node:path";
import type { AppConfig } from "../config.js";
import type { ClientJob } from "../domain/contracts.js";
import { exists } from "./fs.js";
import { slugify } from "./text.js";

type PreviewClient = Pick<ClientJob, "id" | "deployment">;

export async function resolveClientPreviewPath(
  config: Pick<AppConfig, "previewDir">,
  client: PreviewClient
): Promise<string | undefined> {
  const storedPreviewPath = client.deployment.previewPath?.trim();
  const fallbackPreviewPath = path.join(config.previewDir, slugify(client.id));
  const candidates = [storedPreviewPath, fallbackPreviewPath].filter(
    (candidate, index, items): candidate is string =>
      Boolean(candidate) && items.indexOf(candidate) === index
  );

  for (const candidate of candidates) {
    if (await exists(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }

  return storedPreviewPath;
}