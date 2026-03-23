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
  openAiApiKey?: string;
  models: {
    fast: string;
    deep: string;
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

  await Promise.all([
    ensureDir(outputDir),
    ensureDir(stateDir),
    ensureDir(previewDir),
    ensureDir(reportDir),
    ensureDir(notificationDir)
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
    openAiApiKey: process.env.OPENAI_API_KEY,
    models: {
      fast: process.env.OPENAI_MODEL_FAST ?? "gpt-4.1-mini",
      deep: process.env.OPENAI_MODEL_DEEP ?? "gpt-5"
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
