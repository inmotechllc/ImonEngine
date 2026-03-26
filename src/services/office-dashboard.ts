import path from "node:path";
import type { AppConfig } from "../config.js";
import { ensureDir, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { FileStore } from "../storage/store.js";
import { ControlRoomRenderer } from "./control-room-renderer.js";
import { ControlRoomSnapshotService } from "./control-room-snapshot.js";

export class OfficeDashboardService {
  private readonly snapshotService: ControlRoomSnapshotService;

  private readonly renderer: ControlRoomRenderer;

  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {
    this.snapshotService = new ControlRoomSnapshotService(config, store);
    this.renderer = new ControlRoomRenderer();
  }

  async writeDashboard(): Promise<{
    htmlPath: string;
    dataPath: string;
  }> {
    const snapshot = await this.snapshotService.buildSnapshot();
    const outputDir = path.join(this.config.opsDir, "control-room");
    const htmlPath = path.join(outputDir, "index.html");
    const dataPath = path.join(outputDir, "data.json");

    await ensureDir(outputDir);
    await writeJsonFile(dataPath, snapshot);
    await writeTextFile(
      htmlPath,
      this.renderer.renderPage(snapshot, {
        appMode: "static"
      })
    );

    return { htmlPath, dataPath };
  }
}
