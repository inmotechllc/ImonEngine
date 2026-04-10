import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { DEFAULT_OFFERS } from "./domain/defaults.js";
import { AIClient } from "./ai/client.js";
import { FileStore } from "./storage/store.js";
import { ImonEngineAgent } from "./agents/imon-engine.js";
import { PodStudioService } from "./services/pod-studio.js";
import { PodAutonomyService } from "./services/pod-autonomy.js";
import { StoreOpsService } from "./services/store-ops.js";
import { exists, readJsonFile, readTextFile } from "./lib/fs.js";

async function setupWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "auto-funding-pod-"));
  const config = await loadConfig(root);
  const store = new FileStore(config.stateDir);
  await store.init();

  for (const offer of DEFAULT_OFFERS) {
    await store.saveOffer(offer);
  }

  const ai = new AIClient(config);
  void ai;
  const imonEngine = new ImonEngineAgent(config, store);
  const storeOps = new StoreOpsService(config, store);
  const podStudio = new PodStudioService(config, store);
  const podAutonomy = new PodAutonomyService(config, store, podStudio, storeOps);

  return { root, imonEngine, podStudio, podAutonomy };
}

test("pod autonomy writes a full Imonic operating system", async () => {
  const { root, imonEngine, podAutonomy } = await setupWorkspace();
  await imonEngine.bootstrap();

  const referenceDir = path.join(root, "refs");
  await mkdir(referenceDir, { recursive: true });
  await writeFile(path.join(referenceDir, "signal-bloom-tiger.png"), "img", "utf8");
  await writeFile(path.join(referenceDir, "orbit-courier-rabbit.png"), "img", "utf8");
  await writeFile(path.join(referenceDir, "dream-static-fox.png"), "img", "utf8");
  await writeFile(path.join(referenceDir, "prism-aviator-bear.png"), "img", "utf8");
  await writeFile(path.join(referenceDir, "candy-citadel-crew.png"), "img", "utf8");

  const result = await podAutonomy.writeOperatingSystem({
    businessId: "imon-pod-store",
    referenceDirectory: referenceDir
  });

  assert.equal(result.plan.businessName, "Imonic");
  assert.equal(result.listingDrafts.length, result.plan.productSchedule.length);
  assert.ok(result.collections.some((collection) => collection.handle === "imonic-featured-drop"));
  assert.ok(result.growthEngine.scheduledPosts.some((post) => post.platform === "pinterest"));
  assert.ok(result.analyticsEngine.metrics.some((metric) => metric.id === "conversion-rate"));
  assert.ok(result.ownerChecklist.requiredActions.some((action) => action.system.includes("Shopify")));
  assert.equal(await exists(result.artifacts.autonomyMarkdownPath), true);

  const summary = await readTextFile(result.artifacts.autonomyMarkdownPath);
  assert.match(summary, /Imonic Autonomy Summary/i);
  assert.match(summary, /Owner Checklist/i);

  const commerce = await readJsonFile(result.artifacts.commerceJsonPath, null as any);
  assert.equal(commerce.listingDrafts.length, result.plan.productSchedule.length);
});

test("pod studio filters unsafe reference cues and adds Pinterest pins", async () => {
  const { root, imonEngine, podStudio } = await setupWorkspace();
  await imonEngine.bootstrap();

  const referenceDir = path.join(root, "refs-unsafe");
  await mkdir(referenceDir, { recursive: true });
  await writeFile(path.join(referenceDir, "adventure-time-bear.png"), "img", "utf8");
  await writeFile(path.join(referenceDir, "kanye-bear.png"), "img", "utf8");
  await writeFile(path.join(referenceDir, "signal-bloom-tiger.png"), "img", "utf8");
  await writeFile(path.join(referenceDir, "rabbit-orbit.png"), "img", "utf8");

  const result = await podStudio.writePlan({
    businessId: "imon-pod-store",
    referenceDirectory: referenceDir
  });

  assert.ok(!result.plan.styleDossier.motifs.includes("adventure"));
  assert.ok(!result.plan.styleDossier.motifs.includes("kanye"));
  assert.ok(result.plan.socialSchedule.some((item) => item.platform === "pinterest" && item.kind === "pin"));
});
