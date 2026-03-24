import "dotenv/config";
import path from "node:path";
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

export async function loadConfig(projectRoot = process.cwd()): Promise<AppConfig> {
  const outputDir = path.join(projectRoot, "runtime");
  const stateDir = path.join(outputDir, "state");
  const previewDir = path.join(outputDir, "previews");
  const reportDir = path.join(outputDir, "reports");
  const notificationDir = path.join(outputDir, "notifications");
  const opsDir = path.join(outputDir, "ops");
  const assetStoreDir = path.join(outputDir, "asset-store");

  await Promise.all([
    ensureDir(outputDir),
    ensureDir(stateDir),
    ensureDir(previewDir),
    ensureDir(reportDir),
    ensureDir(notificationDir),
    ensureDir(opsDir),
    ensureDir(assetStoreDir)
  ]);

  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM;

  const smtp =
    smtpHost && smtpUser && smtpPass && smtpFrom
      ? {
          host: smtpHost,
          port: Number(process.env.SMTP_PORT ?? "587"),
          secure: process.env.SMTP_SECURE === "true",
          user: smtpUser,
          pass: smtpPass,
          from: smtpFrom
        }
      : undefined;

  const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN;
  const cloudflarePagesProject = process.env.CLOUDFLARE_PAGES_PROJECT;

  return {
    projectRoot,
    stateDir,
    outputDir,
    previewDir,
    reportDir,
    notificationDir,
    opsDir,
    assetStoreDir,
    openAiApiKey: process.env.OPENAI_API_KEY,
    models: {
      fast: process.env.OPENAI_MODEL_FAST ?? "gpt-4.1-mini",
      deep: process.env.OPENAI_MODEL_DEEP ?? "gpt-5"
    },
    engine: {
      name: process.env.IMON_ENGINE_NAME ?? "ImonEngine",
      timezone: process.env.IMON_ENGINE_TIMEZONE ?? "America/New_York",
      hostLabel: process.env.IMON_ENGINE_HOST_LABEL ?? "OpenClaw VPS",
      hostProvider: process.env.IMON_ENGINE_HOST_PROVIDER ?? "Contabo",
      hostPrimaryIp: process.env.IMON_ENGINE_HOST_IP,
      maxConcurrentBusinesses: Number(process.env.IMON_ENGINE_MAX_CONCURRENT_BUSINESSES ?? "2"),
      cpuUtilizationTarget: Number(process.env.IMON_ENGINE_CPU_TARGET ?? "0.7"),
      memoryUtilizationTarget: Number(process.env.IMON_ENGINE_MEMORY_TARGET ?? "0.75"),
      minDiskFreeGb: Number(process.env.IMON_ENGINE_MIN_DISK_FREE_GB ?? "40")
    },
    business: {
      name: process.env.BUSINESS_NAME ?? "Northline Growth Systems",
      phone: process.env.BUSINESS_PHONE ?? "(555) 010-1400",
      salesEmail: process.env.BUSINESS_SALES_EMAIL ?? "sales@example.com",
      siteUrl: process.env.BUSINESS_SITE_URL ?? "https://example.com",
      domain: process.env.BUSINESS_DOMAIN ?? "example.com",
      approvalEmail: process.env.APPROVAL_EMAIL ?? "owner@example.com",
      stripeFounding: process.env.STRIPE_PAYMENT_LINK_FOUNDING,
      stripeStandard: process.env.STRIPE_PAYMENT_LINK_STANDARD
    },
    marketplaces: {
      gumroadSellerEmail: process.env.GUMROAD_SELLER_EMAIL,
      gumroadProfileUrl: process.env.GUMROAD_PROFILE_URL
    },
    storeOps: {
      catalog: {
        maxNewPacksPer7Days: Number(process.env.STORE_MAX_NEW_PACKS_7D ?? "2"),
        maxPublishedPacks: Number(process.env.STORE_MAX_PUBLISHED_PACKS ?? "36"),
        maxSharePerAssetType: Number(process.env.STORE_MAX_ASSET_TYPE_SHARE ?? "0.4"),
        maxOpenPackQueue: Number(process.env.STORE_MAX_OPEN_PACK_QUEUE ?? "2")
      },
      growth: {
        postsPerWeek: Number(process.env.STORE_POSTS_PER_WEEK ?? "6"),
        queueDays: Number(process.env.STORE_GROWTH_QUEUE_DAYS ?? "7")
      },
      finance: {
        taxReserveRate: Number(process.env.STORE_TAX_RESERVE_RATE ?? "0.2"),
        reinvestmentRate: Number(process.env.STORE_REINVESTMENT_RATE ?? "0.35"),
        refundBufferRate: Number(process.env.STORE_REFUND_BUFFER_RATE ?? "0.1"),
        cashoutThreshold: Number(process.env.STORE_CASHOUT_THRESHOLD ?? "100")
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
