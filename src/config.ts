import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseDotenv } from "dotenv";
import { ensureDir } from "./lib/fs.js";

export interface AppConfig {
  projectRoot: string;
  stateDir: string;
  outputDir: string;
  previewDir: string;
  reportDir: string;
  notificationDir: string;
  opsDir: string;
  assetStoreDir: string;
  openAiApiKey?: string;
  models: {
    fast: string;
    deep: string;
  };
  engine: {
    name: string;
    timezone: string;
    hostLabel: string;
    hostProvider: string;
    hostPrimaryIp?: string;
    maxConcurrentBusinesses: number;
    cpuUtilizationTarget: number;
    memoryUtilizationTarget: number;
    minDiskFreeGb: number;
  };
  business: {
    name: string;
    phone: string;
    salesEmail: string;
    siteUrl: string;
    domain: string;
    approvalEmail: string;
    bookingUrl?: string;
    leadFormAction?: string;
    primaryServiceArea?: string;
    googleBusinessProfileUrl?: string;
    googleReviewUrl?: string;
    facebookUrl?: string;
    instagramUrl?: string;
    linkedinUrl?: string;
    stripeFounding?: string;
    stripeStandard?: string;
  };
  marketplaces: {
    gumroadSellerEmail?: string;
    gumroadProfileUrl?: string;
  };
  storeOps: {
    catalog: {
      maxNewPacksPer7Days: number;
      maxPublishedPacks: number;
      maxSharePerAssetType: number;
      maxOpenPackQueue: number;
    };
    growth: {
      postsPerWeek: number;
      queueDays: number;
    };
    finance: {
      taxReserveRate: number;
      reinvestmentRate: number;
      refundBufferRate: number;
      cashoutThreshold: number;
    };
  };
  storefront: {
    siteUrl?: string;
    emailCaptureAction?: string;
    emailCaptureEmail: string;
  };
  northlineSite: {
    bindHost: string;
    port: number;
    submissionStorePath: string;
  };
  controlRoom: {
    bindHost: string;
    port: number;
    sessionSecret?: string;
    passwordHash?: string;
    sessionTtlHours: number;
    staleThresholdMinutes: number;
    serviceLogPath: string;
    local: {
      bindHost: string;
      port: number;
      remoteUrl: string;
      tunnelEnabled: boolean;
      tunnelLocalPort: number;
      tunnelPythonBin: string;
    };
  };
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
  };
  cloudflare?: {
    accountId: string;
    apiToken: string;
    pagesProject: string;
  };
}

function normalizeEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    return {};
  }
  const parsed = parseDotenv(readFileSync(filePath, "utf8"));
  return Object.fromEntries(
    Object.entries(parsed).flatMap(([key, value]) => {
      const normalized = normalizeEnvValue(value);
      return normalized ? [[key, normalized] as const] : [];
    })
  );
}

function hydrateProcessEnv(projectRoot: string): void {
  const mergedFiles = {
    ...readEnvFile(path.join(projectRoot, ".env")),
    ...readEnvFile(path.join(projectRoot, ".env.example"))
  };

  for (const [key, value] of Object.entries(mergedFiles)) {
    if (!normalizeEnvValue(process.env[key])) {
      process.env[key] = value;
    }
  }
}

function envValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = normalizeEnvValue(process.env[name]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function envValueOr(defaultValue: string, ...names: string[]): string {
  return envValue(...names) ?? defaultValue;
}

function envNumber(defaultValue: string, ...names: string[]): number {
  return Number(envValue(...names) ?? defaultValue);
}

export async function loadConfig(projectRoot = process.cwd()): Promise<AppConfig> {
  hydrateProcessEnv(projectRoot);
  const outputDir = path.join(projectRoot, "runtime");
  const stateDir = path.join(outputDir, "state");
  const previewDir = path.join(outputDir, "previews");
  const reportDir = path.join(outputDir, "reports");
  const notificationDir = path.join(outputDir, "notifications");
  const opsDir = path.join(outputDir, "ops");
  const assetStoreDir = path.join(outputDir, "asset-store");
  const controlRoomDir = path.join(opsDir, "control-room");
  const northlineSubmissionStorePath = path.join(stateDir, "northlineIntakeSubmissions.json");

  await Promise.all([
    ensureDir(outputDir),
    ensureDir(stateDir),
    ensureDir(previewDir),
    ensureDir(reportDir),
    ensureDir(notificationDir),
    ensureDir(opsDir),
    ensureDir(assetStoreDir),
    ensureDir(controlRoomDir)
  ]);

  const smtpHost = envValue("SMTP_HOST");
  const smtpUser = envValue("SMTP_USER");
  const smtpPass = envValue("SMTP_PASS");
  const smtpFrom = envValue("SMTP_FROM");

  const smtp =
    smtpHost && smtpUser && smtpPass && smtpFrom
      ? {
          host: smtpHost,
          port: envNumber("587", "SMTP_PORT"),
          secure: envValue("SMTP_SECURE") === "true",
          user: smtpUser,
          pass: smtpPass,
          from: smtpFrom
        }
      : undefined;

  const cloudflareAccountId = envValue("CLOUDFLARE_ACCOUNT_ID");
  const cloudflareApiToken = envValue("CLOUDFLARE_API_TOKEN");
  const cloudflarePagesProject = envValue("CLOUDFLARE_PAGES_PROJECT");
  const imonStoreGumroadSellerEmail = envValue("IMON_STORE_GUMROAD_SELLER_EMAIL", "GUMROAD_SELLER_EMAIL");
  const imonStoreGumroadProfileUrl = envValue("IMON_STORE_GUMROAD_PROFILE_URL", "GUMROAD_PROFILE_URL");

  return {
    projectRoot,
    stateDir,
    outputDir,
    previewDir,
    reportDir,
    notificationDir,
    opsDir,
    assetStoreDir,
    openAiApiKey: envValue("OPENAI_API_KEY"),
    models: {
      fast: envValueOr("gpt-4.1-mini", "OPENAI_MODEL_FAST"),
      deep: envValueOr("gpt-5", "OPENAI_MODEL_DEEP")
    },
    engine: {
      name: envValueOr("ImonEngine", "IMON_ENGINE_NAME"),
      timezone: envValueOr("America/New_York", "IMON_ENGINE_TIMEZONE"),
      hostLabel: envValueOr("OpenClaw VPS", "IMON_ENGINE_HOST_LABEL"),
      hostProvider: envValueOr("Contabo", "IMON_ENGINE_HOST_PROVIDER"),
      hostPrimaryIp: envValue("IMON_ENGINE_HOST_IP"),
      maxConcurrentBusinesses: envNumber("2", "IMON_ENGINE_MAX_CONCURRENT_BUSINESSES"),
      cpuUtilizationTarget: envNumber("0.7", "IMON_ENGINE_CPU_TARGET"),
      memoryUtilizationTarget: envNumber("0.75", "IMON_ENGINE_MEMORY_TARGET"),
      minDiskFreeGb: envNumber("40", "IMON_ENGINE_MIN_DISK_FREE_GB")
    },
    business: {
      name: envValueOr("Northline Growth Systems", "NORTHLINE_NAME", "BUSINESS_NAME"),
      phone: envValueOr("(555) 010-1400", "NORTHLINE_PHONE", "BUSINESS_PHONE"),
      salesEmail: envValueOr("sales@example.com", "NORTHLINE_SALES_EMAIL", "BUSINESS_SALES_EMAIL"),
      siteUrl: envValueOr("https://example.com", "NORTHLINE_SITE_URL", "BUSINESS_SITE_URL"),
      domain: envValueOr("example.com", "NORTHLINE_DOMAIN", "BUSINESS_DOMAIN"),
      approvalEmail: envValueOr("owner@example.com", "APPROVAL_EMAIL"),
      bookingUrl: envValue("NORTHLINE_BOOKING_URL", "BUSINESS_BOOKING_URL"),
      leadFormAction: envValue("NORTHLINE_LEAD_FORM_ACTION", "BUSINESS_LEAD_FORM_ACTION"),
      primaryServiceArea: envValue("NORTHLINE_PRIMARY_SERVICE_AREA", "BUSINESS_PRIMARY_SERVICE_AREA"),
      googleBusinessProfileUrl: envValue(
        "NORTHLINE_GOOGLE_BUSINESS_PROFILE_URL",
        "BUSINESS_GOOGLE_BUSINESS_PROFILE_URL"
      ),
      googleReviewUrl: envValue("NORTHLINE_GOOGLE_REVIEW_URL", "BUSINESS_GOOGLE_REVIEW_URL"),
      facebookUrl: envValue("NORTHLINE_FACEBOOK_URL", "BUSINESS_FACEBOOK_URL"),
      instagramUrl: envValue("NORTHLINE_INSTAGRAM_URL", "BUSINESS_INSTAGRAM_URL"),
      linkedinUrl: envValue("NORTHLINE_LINKEDIN_URL", "BUSINESS_LINKEDIN_URL"),
      stripeFounding: envValue(
        "NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING",
        "STRIPE_PAYMENT_LINK_FOUNDING"
      ),
      stripeStandard: envValue(
        "NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD",
        "STRIPE_PAYMENT_LINK_STANDARD"
      )
    },
    marketplaces: {
      gumroadSellerEmail: imonStoreGumroadSellerEmail,
      gumroadProfileUrl: imonStoreGumroadProfileUrl
    },
    storeOps: {
      catalog: {
        maxNewPacksPer7Days: envNumber("2", "IMON_STORE_MAX_NEW_PACKS_7D", "STORE_MAX_NEW_PACKS_7D"),
        maxPublishedPacks: envNumber("36", "IMON_STORE_MAX_PUBLISHED_PACKS", "STORE_MAX_PUBLISHED_PACKS"),
        maxSharePerAssetType: envNumber(
          "0.4",
          "IMON_STORE_MAX_ASSET_TYPE_SHARE",
          "STORE_MAX_ASSET_TYPE_SHARE"
        ),
        maxOpenPackQueue: envNumber("2", "IMON_STORE_MAX_OPEN_PACK_QUEUE", "STORE_MAX_OPEN_PACK_QUEUE")
      },
      growth: {
        postsPerWeek: envNumber("6", "IMON_STORE_POSTS_PER_WEEK", "STORE_POSTS_PER_WEEK"),
        queueDays: envNumber("7", "IMON_STORE_GROWTH_QUEUE_DAYS", "STORE_GROWTH_QUEUE_DAYS")
      },
      finance: {
        taxReserveRate: envNumber("0.2", "IMON_STORE_TAX_RESERVE_RATE", "STORE_TAX_RESERVE_RATE"),
        reinvestmentRate: envNumber(
          "0.35",
          "IMON_STORE_REINVESTMENT_RATE",
          "STORE_REINVESTMENT_RATE"
        ),
        refundBufferRate: envNumber(
          "0.1",
          "IMON_STORE_REFUND_BUFFER_RATE",
          "STORE_REFUND_BUFFER_RATE"
        ),
        cashoutThreshold: envNumber("100", "IMON_STORE_CASHOUT_THRESHOLD", "STORE_CASHOUT_THRESHOLD")
      }
    },
    storefront: {
      siteUrl: envValue("IMON_STORE_SITE_URL", "STORE_SITE_URL"),
      emailCaptureAction: envValue("IMON_STORE_EMAIL_CAPTURE_ACTION", "STORE_EMAIL_CAPTURE_ACTION"),
      emailCaptureEmail:
        envValue(
          "IMON_STORE_EMAIL_CAPTURE_EMAIL",
          "STORE_EMAIL_CAPTURE_EMAIL",
          "IMON_STORE_GUMROAD_SELLER_EMAIL",
          "GUMROAD_SELLER_EMAIL"
        ) ??
        "sales@example.com"
    },
    northlineSite: {
      bindHost: envValueOr("0.0.0.0", "NORTHLINE_SITE_BIND_HOST"),
      port: envNumber("4181", "NORTHLINE_SITE_PORT"),
      submissionStorePath: envValueOr(northlineSubmissionStorePath, "NORTHLINE_SUBMISSION_STORE_PATH")
    },
    controlRoom: {
      bindHost: envValueOr("127.0.0.1", "CONTROL_ROOM_BIND_HOST"),
      port: envNumber("4177", "CONTROL_ROOM_PORT"),
      sessionSecret: envValue("CONTROL_ROOM_SESSION_SECRET"),
      passwordHash: envValue("CONTROL_ROOM_PASSWORD_HASH"),
      sessionTtlHours: envNumber("12", "CONTROL_ROOM_SESSION_TTL_HOURS"),
      staleThresholdMinutes: envNumber("120", "CONTROL_ROOM_STALE_THRESHOLD_MINUTES"),
      serviceLogPath:
        envValue("CONTROL_ROOM_SERVICE_LOG_PATH") ??
        path.join(controlRoomDir, "server.log"),
      local: {
        bindHost: envValueOr("127.0.0.1", "CONTROL_ROOM_LOCAL_BIND_HOST"),
        port: envNumber("4310", "CONTROL_ROOM_LOCAL_PORT"),
        remoteUrl:
          envValue("CONTROL_ROOM_REMOTE_URL") ??
          `http://127.0.0.1:${envNumber("4311", "CONTROL_ROOM_TUNNEL_PORT")}`,
        tunnelEnabled: envValue("CONTROL_ROOM_AUTO_TUNNEL") !== "false",
        tunnelLocalPort: envNumber("4311", "CONTROL_ROOM_TUNNEL_PORT"),
        tunnelPythonBin: envValueOr("python", "CONTROL_ROOM_TUNNEL_PYTHON_BIN")
      }
    },
    smtp,
    cloudflare:
      cloudflareAccountId && cloudflareApiToken && cloudflarePagesProject
        ? {
            accountId: cloudflareAccountId,
            apiToken: cloudflareApiToken,
            pagesProject: cloudflarePagesProject
          }
        : undefined
  };
}
