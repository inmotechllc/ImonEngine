import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AppConfig } from "../config.js";
import type { VpsResourceSnapshot } from "../domain/engine.js";

const execFileAsync = promisify(execFile);
const GIGABYTE = 1024 ** 3;

interface DiskSnapshot {
  totalGb?: number;
  freeGb?: number;
  utilization?: number;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

async function readDiskSnapshot(targetPath: string): Promise<DiskSnapshot> {
  try {
    if (process.platform === "win32") {
      const driveLetter = path.parse(path.resolve(targetPath)).root.replace(/[:\\]/g, "");
      const script = [
        `$drive = Get-PSDrive -Name '${driveLetter}' -ErrorAction Stop`,
        "[Console]::Out.Write($drive.Used.ToString() + ',' + $drive.Free.ToString())"
      ].join("; ");
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-Command", script],
        { timeout: 5000 }
      );
      const [usedRaw, freeRaw] = stdout.trim().split(",");
      const used = Number(usedRaw);
      const free = Number(freeRaw);
      const total = used + free;
      if (!Number.isFinite(total) || total <= 0) {
        return {};
      }

      return {
        totalGb: round(total / GIGABYTE),
        freeGb: round(free / GIGABYTE),
        utilization: round(used / total)
      };
    }

    const { stdout } = await execFileAsync("df", ["-Pk", targetPath], { timeout: 5000 });
    const lines = stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    const last = lines.at(-1);
    if (!last) {
      return {};
    }

    const columns = last.trim().split(/\s+/);
    const totalKb = Number(columns[1]);
    const freeKb = Number(columns[3]);
    if (!Number.isFinite(totalKb) || !Number.isFinite(freeKb) || totalKb <= 0) {
      return {};
    }

    const totalBytes = totalKb * 1024;
    const freeBytes = freeKb * 1024;
    return {
      totalGb: round(totalBytes / GIGABYTE),
      freeGb: round(freeBytes / GIGABYTE),
      utilization: round((totalBytes - freeBytes) / totalBytes)
    };
  } catch {
    return {};
  }
}

export class SystemMonitorService {
  constructor(private readonly config: AppConfig) {}

  async captureSnapshot(input: {
    activeBusinesses: number;
    readyBusinesses: number;
  }): Promise<VpsResourceSnapshot> {
    const recordedAt = new Date().toISOString();
    const cpuCores = Math.max(1, os.cpus().length);
    const loadAverage = os.loadavg() as [number, number, number];
    const totalMemoryGb = round(os.totalmem() / GIGABYTE);
    const freeMemoryGb = round(os.freemem() / GIGABYTE);
    const memoryUtilization =
      totalMemoryGb > 0 ? round((totalMemoryGb - freeMemoryGb) / totalMemoryGb) : 0;
    const estimatedCpuUtilization =
      process.platform === "win32" ? 0 : round(Math.min(1, loadAverage[0] / cpuCores));
    const disk = await readDiskSnapshot(this.config.outputDir);
    const recommendedConcurrency = this.recommendConcurrency({
      estimatedCpuUtilization,
      memoryUtilization,
      diskFreeGb: disk.freeGb
    });

    const notes: string[] = [];
    if (estimatedCpuUtilization >= this.config.engine.cpuUtilizationTarget) {
      notes.push("CPU utilization is at or above the target threshold.");
    }

    if (memoryUtilization >= this.config.engine.memoryUtilizationTarget) {
      notes.push("Memory utilization is at or above the target threshold.");
    }

    if (
      typeof disk.freeGb === "number" &&
      disk.freeGb < this.config.engine.minDiskFreeGb
    ) {
      notes.push("Disk headroom is below the minimum target.");
    }

    return {
      id: `resource-${recordedAt.replaceAll(":", "-")}`,
      recordedAt,
      hostname: os.hostname(),
      platform: `${process.platform}-${os.release()}`,
      cpuCores,
      loadAverage,
      estimatedCpuUtilization,
      totalMemoryGb,
      freeMemoryGb,
      memoryUtilization,
      diskTotalGb: disk.totalGb,
      diskFreeGb: disk.freeGb,
      diskUtilization: disk.utilization,
      activeBusinesses: input.activeBusinesses,
      readyBusinesses: input.readyBusinesses,
      recommendedConcurrency,
      notes
    };
  }

  private recommendConcurrency(input: {
    estimatedCpuUtilization: number;
    memoryUtilization: number;
    diskFreeGb?: number;
  }): number {
    const maxBusinesses = Math.max(1, this.config.engine.maxConcurrentBusinesses);
    if (
      typeof input.diskFreeGb === "number" &&
      input.diskFreeGb < this.config.engine.minDiskFreeGb
    ) {
      return 1;
    }

    const cpuHeadroom =
      this.config.engine.cpuUtilizationTarget <= 0
        ? 0
        : Math.max(
            0,
            (this.config.engine.cpuUtilizationTarget - input.estimatedCpuUtilization) /
              this.config.engine.cpuUtilizationTarget
          );
    const memoryHeadroom =
      this.config.engine.memoryUtilizationTarget <= 0
        ? 0
        : Math.max(
            0,
            (this.config.engine.memoryUtilizationTarget - input.memoryUtilization) /
              this.config.engine.memoryUtilizationTarget
          );

    const headroom = Math.min(1, Math.max(0, Math.min(cpuHeadroom, memoryHeadroom)));
    if (headroom <= 0.15) {
      return 1;
    }

    return Math.max(1, Math.min(maxBusinesses, 1 + Math.floor(headroom * (maxBusinesses - 1))));
  }
}
