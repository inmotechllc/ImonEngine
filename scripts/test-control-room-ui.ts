import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import { loadConfig } from "../src/config.js";
import { DEFAULT_OFFERS } from "../src/domain/defaults.js";
import { hashControlRoomPassword } from "../src/lib/control-room-auth.js";
import { ImonEngineAgent } from "../src/agents/imon-engine.js";
import { FileStore } from "../src/storage/store.js";
import { ControlRoomServer } from "../src/services/control-room-server.js";
import { ControlRoomLocalServer } from "../src/services/control-room-local-server.js";
import { ControlRoomSnapshotService } from "../src/services/control-room-snapshot.js";

async function setupWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "auto-funding-control-room-ui-"));
  const config = await loadConfig(root);
  const store = new FileStore(config.stateDir);
  await store.init();

  for (const offer of DEFAULT_OFFERS) {
    await store.saveOffer(offer);
  }

  const imonEngine = new ImonEngineAgent(config, store);
  await imonEngine.bootstrap();
  await imonEngine.sync();

  config.controlRoom.bindHost = "127.0.0.1";
  config.controlRoom.port = 0;
  config.controlRoom.sessionSecret = "test-control-room-ui-secret";
  config.controlRoom.passwordHash = await hashControlRoomPassword("control-room-pass");

  const remoteServer = new ControlRoomServer(config, store);
  const remoteAddress = await remoteServer.listen();
  const remoteBaseUrl = `http://${remoteAddress.host}:${remoteAddress.port}`;

  config.controlRoom.local.bindHost = "127.0.0.1";
  config.controlRoom.local.port = 0;
  config.controlRoom.local.remoteUrl = remoteBaseUrl;
  config.controlRoom.local.tunnelEnabled = false;

  const localServer = new ControlRoomLocalServer(config);
  const localAddress = await localServer.listen();
  const localBaseUrl = `http://${localAddress.host}:${localAddress.port}`;

  const snapshot = await new ControlRoomSnapshotService(config, store).buildSnapshot();

  return {
    config,
    snapshot,
    remoteServer,
    localServer,
    localBaseUrl
  };
}

async function text(page: Page, selector: string): Promise<string> {
  return ((await page.locator(selector).textContent()) ?? "").trim();
}

async function waitForPath(page: Page, pathname: string): Promise<void> {
  await page.waitForFunction(
    (expected) => window.location.pathname === expected,
    pathname
  );
}

async function waitForText(page: Page, selector: string, expected: string): Promise<void> {
  await page.waitForFunction(
    ({ targetSelector, targetText }) =>
      document.querySelector(targetSelector)?.textContent?.includes(targetText) ?? false,
    { targetSelector: selector, targetText: expected }
  );
}

async function sendChatAndWaitForAction(
  page: Page,
  message: string,
  expectedActionText: string
): Promise<void> {
  await page.locator("#chat-input").fill(message);
  await page.locator("#chat-form button[type='submit']").click();
  await waitForText(page, "#chat-action-list", expectedActionText);
}

async function main(): Promise<void> {
  const {
    snapshot,
    remoteServer,
    localServer,
    localBaseUrl
  } = await setupWorkspace();
  const outputDir = path.resolve("output", "playwright");
  await mkdir(outputDir, { recursive: true });

  const targetBusiness =
    snapshot.businesses.find(
      (business) =>
        business.stage !== "deferred" &&
        business.departmentWorkspaces.some((workspace) => workspace.executionItems.length > 0)
    ) ?? snapshot.businesses.find((business) => business.departmentWorkspaces.length > 0);
  assert.ok(targetBusiness, "Expected at least one business workspace for UI navigation.");
  const deferredBusiness = snapshot.businesses.find((business) => business.stage === "deferred");
  assert.ok(deferredBusiness, "Expected at least one deferred business.");

  const targetWorkspace =
    targetBusiness.departmentWorkspaces.find(
      (workspace) => workspace.executionItems.length > 0
    ) ?? targetBusiness.departmentWorkspaces[0];
  assert.ok(targetWorkspace, "Expected at least one department workspace.");
  assert.ok(snapshot.executiveView.approvalTasks.length > 0, "Expected engine approvals.");
  assert.ok(snapshot.executiveView.handoffs.length > 0, "Expected engine handoffs.");

  let browser;
  let page: Page | undefined;

  try {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();

    await page.goto(`${localBaseUrl}/login?next=/engine`, {
      waitUntil: "networkidle"
    });
    await page.locator("#password").fill("control-room-pass");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle" }),
      page.getByRole("button", { name: "Open control room" }).click()
    ]);

    await waitForPath(page, "/engine");
    await page.locator("#view-title").waitFor();
    assert.equal(await text(page, "#view-title"), snapshot.executiveView.title);
    assert.equal(await text(page, "#primary-title"), "Business Offices");
    assert.equal(await text(page, "#secondary-title"), "Deferred");
    await page.locator(`#secondary-roster [data-route="/business/${deferredBusiness.id}"]`).waitFor();

    await sendChatAndWaitForAction(
      page,
      "Summarize profits and growth across the full system.",
      "Report:"
    );
    await waitForText(page, "#chat-report-list", "Report:");

    await sendChatAndWaitForAction(
      page,
      'Create a new business called "Harbor Template Vault" for marketplace design bundles.',
      "Create business scaffold:"
    );
    await page.locator('[data-chat-dismiss]').first().click();
    await waitForText(page, "#chat-history", "Dismissed");

    await sendChatAndWaitForAction(
      page,
      'Create a new business called "Cedar Service Signals" for local home service reporting.',
      "Create business scaffold:"
    );
    await page.locator('[data-chat-apply]').first().click();
    await waitForText(page, "#chat-history", "Cedar Service Signals");
    await waitForText(page, "#secondary-roster", "Cedar Service Signals");

    await page.locator(`#primary-roster [data-route="/business/${targetBusiness.id}"]`).click();
    await waitForPath(page, `/business/${targetBusiness.id}`);
    assert.equal(await text(page, "#view-title"), targetBusiness.office?.title ?? "");
    assert.equal(await text(page, "#primary-title"), "Department Offices");

    await sendChatAndWaitForAction(
      page,
      "Generate accounting and analytics for this business.",
      "Report:"
    );
    await sendChatAndWaitForAction(
      page,
      "Coordinate growth and finance to publish a launch campaign with reporting handoff notes.",
      "Routed Task:"
    );
    await waitForText(page, "#chat-action-list", "routed");

    await page.locator(
      `#primary-roster [data-route="/department/${targetWorkspace.businessId}/${targetWorkspace.departmentId}"]`
    ).click();
    await waitForPath(
      page,
      `/department/${targetWorkspace.businessId}/${targetWorkspace.departmentId}`
    );
    assert.equal(await text(page, "#view-title"), targetWorkspace.title);

    await sendChatAndWaitForAction(
      page,
      "Add a prompt directive to favor bolder utility-first concepts and sharper hooks.",
      "Directive Update:"
    );
    await sendChatAndWaitForAction(
      page,
      "Update the posting schedule to Tuesdays and Fridays at 9 AM Eastern.",
      "Schedule Override:"
    );
    await sendChatAndWaitForAction(
      page,
      "Create a worker brief to produce three fresh design concepts for the next campaign.",
      "Execution Brief:"
    );

    await page.locator(`#breadcrumbs [data-route="/business/${targetBusiness.id}"]`).click();
    await waitForPath(page, `/business/${targetBusiness.id}`);
    await waitForText(page, "#chat-history", "Generate accounting and analytics");

    await page.locator(`#breadcrumbs [data-route="/engine"]`).click();
    await waitForPath(page, "/engine");
    await waitForText(page, "#chat-history", "Summarize profits and growth");

    await page.locator("[data-approval-id]").first().click();
    assert.match(await text(page, "#detail-panel"), /Status:/);

    await page.locator("[data-handoff-id]").first().click();
    assert.match(await text(page, "#detail-panel"), /Owner:/);

    if (snapshot.executiveView.roadblocks.length > 0) {
      await page.locator("[data-roadblock]").first().click();
      assert.match(await text(page, "#detail-panel"), /Scope:/);
    }

    await page
      .locator(`#context-list [data-route="/business/${targetBusiness.id}"]`)
      .click();
    await waitForPath(page, `/business/${targetBusiness.id}`);

    await page
      .locator(
        `#context-list [data-route="/department/${targetWorkspace.businessId}/${targetWorkspace.departmentId}"]`
      )
      .click();
    await waitForPath(
      page,
      `/department/${targetWorkspace.businessId}/${targetWorkspace.departmentId}`
    );

    await page.locator("[data-execution-id]").first().click();
    assert.match(await text(page, "#detail-panel"), /Worker:/);

    if (targetWorkspace.roadblocks.length > 0) {
      await page.locator("[data-roadblock]").first().click();
      assert.match(await text(page, "#detail-panel"), /blocked/i);
    }

    await page.locator("#controls-tab-button").click();
    await page.locator("#engine-sync-button").click();
    await waitForText(page, "#control-result", "Engine synced.");

    await page.locator("#business-toggle-button").click();
    await waitForText(page, "#control-result", "Updated business state");

    await page.locator("#task-title").fill("UI regression directive");
    await page.locator("#task-summary").fill(
      "Confirm the folder-style office explorer routes operator work into the selected department."
    );
    await page.locator("#task-form button[type='submit']").click();
    await waitForText(page, "#control-result", "Directive routed to");

    await page.screenshot({
      path: path.join(outputDir, "control-room-ui.png"),
      fullPage: true
    });
    console.log("control-room-local UI regression passed.");
  } catch (error) {
    if (page) {
      await page.screenshot({
        path: path.join(outputDir, "control-room-ui-failure.png"),
        fullPage: true
      });
    }
    throw error;
  } finally {
    await browser?.close();
    await localServer.close();
    await remoteServer.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
