import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseDotenv } from "dotenv";
import {
  AI_PROVIDER_MAP,
  type AIProviderId,
  type AIResolvedProviderConfig,
  type AISharedRouteId
} from "./ai/api-map.js";
import { hashControlRoomPassword } from "./lib/control-room-auth.js";
import { ensureDir } from "./lib/fs.js";

const DEFAULT_NORTHLINE_PROSPECT_TRADES = [
  "plumbing",
  "hvac",
  "electrical",
  "roofing",
  "cleaning"
] as const;

const DEFAULT_CLIPBAITERS_ACTIVE_LANES = [
  "clipbaiters-political",
  "clipbaiters-media"
] as const;

export interface AppConfig {
  projectRoot: string;
  stateDir: string;
  outputDir: string;
  previewDir: string;
  reportDir: string;
  notificationDir: string;
  opsDir: string;
  assetStoreDir: string;
  ai: {
    providers: Record<AIProviderId, AIResolvedProviderConfig>;
    routeModelOverrides: Partial<Record<AISharedRouteId, string>>;
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
    stripeLeadGeneration?: string;
    stripeFounding?: string;
    stripeStandard?: string;
    growthUpgrade?: {
      paymentLink?: string;
      couponLabel?: string;
      terms?: string;
    };
    stripeValidation?: string;
  };
  marketplaces: {
    gumroadSellerEmail?: string;
    gumroadProfileUrl?: string;
  };
  clipbaiters: {
    sharedAliasEmail?: string;
    creatorContactEmail?: string;
    creatorBookingUrl?: string;
    activeLaneIds: string[];
    facebook: {
      pageUrl?: string;
      pageId?: string;
    };
    youtube: {
      political: {
        channelUrl?: string;
        channelId?: string;
      };
      media: {
        channelUrl?: string;
        channelId?: string;
      };
      animated: {
        channelUrl?: string;
        channelId?: string;
      };
      celebs: {
        channelUrl?: string;
        channelId?: string;
      };
      streaming: {
        channelUrl?: string;
        channelId?: string;
      };
    };
    finance: {
      stripe: {
        accountId?: string;
        publishableKey?: string;
        secretKey?: string;
      };
      relay: {
        checkingLabel?: string;
        checkingLast4?: string;
      };
    };
    paymentLinks: {
      streamingRetainer?: string;
      eventPack?: string;
      rushPack?: string;
    };
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
  northlineStripe: {
    webhookSecret?: string;
  };
  northlineDeploy: {
    autoDeployEnabled: boolean;
    autoDeployMinCompletedDeliveries: number;
    autoDeployRequireZeroQaBlockers: boolean;
  };
  northlineProspecting: {
    sourceDir: string;
    collectionAreas: string[];
    collectionTrades: string[];
    collectionIntervalHours: number;
    collectionMaxRecordsPerTrade: number;
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
  northlineMail: {
    outboundChannel: "gmail_cdp" | "smtp";
    inboxProvider: "gmail_cdp" | "imap";
    aliasAddress: string;
    imap?: {
      host: string;
      port: number;
      secure: boolean;
      user: string;
      pass: string;
      mailbox: string;
    };
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

function envList(...names: string[]): string[] {
  const value = envValue(...names);
  if (!value) {
    return [];
  }

  return value
    .split(/[;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function envCommaList(...names: string[]): string[] {
  const value = envValue(...names);
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function envNumber(defaultValue: string, ...names: string[]): number {
  return Number(envValue(...names) ?? defaultValue);
}

function resolveAiProviders(): Record<AIProviderId, AIResolvedProviderConfig> {
  const providers = {} as Record<AIProviderId, AIResolvedProviderConfig>;

  for (const providerId of Object.keys(AI_PROVIDER_MAP) as AIProviderId[]) {
    const definition = AI_PROVIDER_MAP[providerId];
    providers[providerId] = {
      id: providerId,
      ...definition,
      apiKey: envValue(definition.env.apiKey, ...(definition.legacy?.apiKey ?? [])),
      baseUrl: definition.env.baseUrl
        ? (envValue(definition.env.baseUrl, ...(definition.legacy?.baseUrl ?? [])) ??
          definition.defaultBaseUrl)
        : definition.defaultBaseUrl
    };
  }

  return providers;
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
  const northlineProspectSourceDir =
    envValue("NORTHLINE_PROSPECT_SOURCE_DIR") ??
    path.join(outputDir, "prospect-sources", "northline");
  const northlinePrimaryServiceArea = envValue(
    "NORTHLINE_PRIMARY_SERVICE_AREA",
    "BUSINESS_PRIMARY_SERVICE_AREA"
  );
  const northlineProspectCollectionAreas = envList("NORTHLINE_PROSPECT_COLLECTION_AREAS");
  const northlineProspectCollectionTrades = envList("NORTHLINE_PROSPECT_COLLECTION_TRADES");
  const clipbaitersActiveLaneIds = envCommaList("CLIPBAITERS_ACTIVE_LANES");

  await Promise.all([
    ensureDir(outputDir),
    ensureDir(stateDir),
    ensureDir(previewDir),
    ensureDir(reportDir),
    ensureDir(notificationDir),
    ensureDir(opsDir),
    ensureDir(assetStoreDir),
    ensureDir(controlRoomDir),
    ensureDir(northlineProspectSourceDir)
  ]);

  const smtpHost = envValue("SMTP_HOST");
  const smtpUser = envValue("SMTP_USER");
  const smtpPass = envValue("SMTP_PASS", "NORTHLINE_ZOHO_APP_PASS");
  const smtpFrom = envValue("NORTHLINE_SMTP_FROM", "BUSINESS_SMTP_FROM", "SMTP_FROM");
  const controlRoomFallbackPassword = envValue(
    "IMON_ENGINE_HOST_PASSWORD",
    "IMON_ENGINE_VPS_PASSWORD"
  );
  const controlRoomPasswordHash =
    envValue("CONTROL_ROOM_PASSWORD_HASH") ??
    (controlRoomFallbackPassword
      ? await hashControlRoomPassword(controlRoomFallbackPassword)
      : undefined);

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

  const requestedNorthlineInboxProvider = envValue("NORTHLINE_INBOX_PROVIDER", "INBOX_PROVIDER");
  const imapHost =
    envValue("NORTHLINE_IMAP_HOST", "IMAP_HOST") ??
    (requestedNorthlineInboxProvider === "imap" && smtpHost?.includes("zoho.com")
      ? "imappro.zoho.com"
      : undefined);
  const imapUser = envValue("NORTHLINE_IMAP_USER", "IMAP_USER", "SMTP_USER");
  const imapPass = envValue(
    "NORTHLINE_IMAP_PASS",
    "NORTHLINE_ZOHO_APP_PASS",
    "IMAP_PASS",
    "SMTP_PASS"
  );
  const northlineImap =
    imapHost && imapUser && imapPass
      ? {
          host: imapHost,
          port: envNumber("993", "NORTHLINE_IMAP_PORT", "IMAP_PORT"),
          secure: envValue("NORTHLINE_IMAP_SECURE", "IMAP_SECURE") !== "false",
          user: imapUser,
          pass: imapPass,
          mailbox: envValueOr("INBOX", "NORTHLINE_IMAP_MAILBOX", "IMAP_MAILBOX")
        }
      : undefined;
  const northlineInboxProvider =
    requestedNorthlineInboxProvider === "imap" && northlineImap ? "imap" : "gmail_cdp";
  const configuredNorthlineOutboundChannel = envValue(
    "NORTHLINE_OUTBOUND_CHANNEL",
    "OUTBOUND_CHANNEL"
  );
  const northlineOutboundChannel =
    configuredNorthlineOutboundChannel === "smtp" || configuredNorthlineOutboundChannel === "gmail_cdp"
      ? configuredNorthlineOutboundChannel
      : northlineInboxProvider === "imap"
        ? "smtp"
        : "gmail_cdp";

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
    ai: {
      providers: resolveAiProviders(),
      routeModelOverrides: {
        fast: envValue("OPENAI_MODEL_FAST"),
        deep: envValue("OPENAI_MODEL_DEEP"),
        research: envValue("OPENAI_MODEL_DEEP")
      }
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
      primaryServiceArea: northlinePrimaryServiceArea,
      googleBusinessProfileUrl: envValue(
        "NORTHLINE_GOOGLE_BUSINESS_PROFILE_URL",
        "BUSINESS_GOOGLE_BUSINESS_PROFILE_URL"
      ),
      googleReviewUrl: envValue("NORTHLINE_GOOGLE_REVIEW_URL", "BUSINESS_GOOGLE_REVIEW_URL"),
      facebookUrl: envValue("NORTHLINE_FACEBOOK_URL", "BUSINESS_FACEBOOK_URL"),
      instagramUrl: envValue("NORTHLINE_INSTAGRAM_URL", "BUSINESS_INSTAGRAM_URL"),
      linkedinUrl: envValue("NORTHLINE_LINKEDIN_URL", "BUSINESS_LINKEDIN_URL"),
      stripeLeadGeneration: envValue(
        "NORTHLINE_STRIPE_PAYMENT_LINK_LEAD_GENERATION",
        "STRIPE_PAYMENT_LINK_LEAD_GENERATION"
      ),
      stripeFounding: envValue(
        "NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING",
        "STRIPE_PAYMENT_LINK_FOUNDING"
      ),
      stripeStandard: envValue(
        "NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD",
        "STRIPE_PAYMENT_LINK_STANDARD"
      ),
      growthUpgrade: {
        paymentLink: envValue(
          "NORTHLINE_STRIPE_PAYMENT_LINK_GROWTH_UPGRADE",
          "STRIPE_PAYMENT_LINK_GROWTH_UPGRADE"
        ),
        couponLabel: envValue(
          "NORTHLINE_GROWTH_UPGRADE_COUPON_LABEL",
          "GROWTH_UPGRADE_COUPON_LABEL"
        ),
        terms: envValue(
          "NORTHLINE_GROWTH_UPGRADE_COUPON_TERMS",
          "GROWTH_UPGRADE_COUPON_TERMS"
        )
      },
      stripeValidation: envValue(
        "NORTHLINE_STRIPE_PAYMENT_LINK_VALIDATION",
        "STRIPE_PAYMENT_LINK_VALIDATION"
      )
    },
    marketplaces: {
      gumroadSellerEmail: imonStoreGumroadSellerEmail,
      gumroadProfileUrl: imonStoreGumroadProfileUrl
    },
    clipbaiters: {
      sharedAliasEmail: envValue("CLIPBAITERS_SHARED_ALIAS_EMAIL"),
      creatorContactEmail: envValue("CLIPBAITERS_CREATOR_CONTACT_EMAIL"),
      creatorBookingUrl: envValue("CLIPBAITERS_CREATOR_BOOKING_URL"),
      activeLaneIds:
        clipbaitersActiveLaneIds.length > 0
          ? clipbaitersActiveLaneIds
          : [...DEFAULT_CLIPBAITERS_ACTIVE_LANES],
      facebook: {
        pageUrl: envValue("CLIPBAITERS_FACEBOOK_PAGE_URL"),
        pageId: envValue("CLIPBAITERS_FACEBOOK_PAGE_ID")
      },
      youtube: {
        political: {
          channelUrl: envValue("CLIPBAITERS_YOUTUBE_POLITICAL_CHANNEL_URL"),
          channelId: envValue("CLIPBAITERS_YOUTUBE_POLITICAL_CHANNEL_ID")
        },
        media: {
          channelUrl: envValue("CLIPBAITERS_YOUTUBE_MEDIA_CHANNEL_URL"),
          channelId: envValue("CLIPBAITERS_YOUTUBE_MEDIA_CHANNEL_ID")
        },
        animated: {
          channelUrl: envValue("CLIPBAITERS_YOUTUBE_ANIMATED_CHANNEL_URL"),
          channelId: envValue("CLIPBAITERS_YOUTUBE_ANIMATED_CHANNEL_ID")
        },
        celebs: {
          channelUrl: envValue("CLIPBAITERS_YOUTUBE_CELEBS_CHANNEL_URL"),
          channelId: envValue("CLIPBAITERS_YOUTUBE_CELEBS_CHANNEL_ID")
        },
        streaming: {
          channelUrl: envValue("CLIPBAITERS_YOUTUBE_STREAMING_CHANNEL_URL"),
          channelId: envValue("CLIPBAITERS_YOUTUBE_STREAMING_CHANNEL_ID")
        }
      },
      finance: {
        stripe: {
          accountId: envValue("CLIPBAITERS_SHARED_STRIPE_ACCOUNT_ID"),
          publishableKey: envValue("CLIPBAITERS_SHARED_STRIPE_PUBLISHABLE_KEY"),
          secretKey: envValue("CLIPBAITERS_SHARED_STRIPE_SECRET_KEY")
        },
        relay: {
          checkingLabel: envValue("CLIPBAITERS_RELAY_CHECKING_LABEL"),
          checkingLast4: envValue("CLIPBAITERS_RELAY_CHECKING_LAST4")
        }
      },
      paymentLinks: {
        streamingRetainer: envValue("CLIPBAITERS_STREAMING_PAYMENT_LINK_RETAINER"),
        eventPack: envValue("CLIPBAITERS_STREAMING_PAYMENT_LINK_EVENT_PACK"),
        rushPack: envValue("CLIPBAITERS_STREAMING_PAYMENT_LINK_RUSH_PACK")
      }
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
    northlineStripe: {
      webhookSecret: envValue("NORTHLINE_STRIPE_WEBHOOK_SECRET")
    },
    northlineDeploy: {
      autoDeployEnabled: envValue("NORTHLINE_AUTO_DEPLOY_ENABLED") === "true",
      autoDeployMinCompletedDeliveries: envNumber(
        "3",
        "NORTHLINE_AUTO_DEPLOY_MIN_COMPLETED_DELIVERIES"
      ),
      autoDeployRequireZeroQaBlockers:
        envValue("NORTHLINE_AUTO_DEPLOY_REQUIRE_ZERO_QA_BLOCKERS") !== "false"
    },
    northlineProspecting: {
      sourceDir: northlineProspectSourceDir,
      collectionAreas:
        northlineProspectCollectionAreas.length > 0
          ? northlineProspectCollectionAreas
          : northlinePrimaryServiceArea
            ? [northlinePrimaryServiceArea]
            : [],
      collectionTrades:
        northlineProspectCollectionTrades.length > 0
          ? northlineProspectCollectionTrades
          : [...DEFAULT_NORTHLINE_PROSPECT_TRADES],
      collectionIntervalHours: envNumber("24", "NORTHLINE_PROSPECT_COLLECTION_INTERVAL_HOURS"),
      collectionMaxRecordsPerTrade: envNumber(
        "20",
        "NORTHLINE_PROSPECT_COLLECTION_MAX_RECORDS_PER_TRADE"
      )
    },
    northlineMail: {
      outboundChannel: northlineOutboundChannel,
      inboxProvider: northlineInboxProvider,
      aliasAddress: envValueOr(
        "sales@example.com",
        "NORTHLINE_INBOX_ALIAS_FILTER",
        "NORTHLINE_SALES_EMAIL",
        "BUSINESS_SALES_EMAIL"
      ),
      imap: northlineImap
    },
    controlRoom: {
      bindHost: envValueOr("127.0.0.1", "CONTROL_ROOM_BIND_HOST"),
      port: envNumber("4177", "CONTROL_ROOM_PORT"),
      sessionSecret: envValue("CONTROL_ROOM_SESSION_SECRET"),
      passwordHash: controlRoomPasswordHash,
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
        tunnelPythonBin:
          envValue("CONTROL_ROOM_TUNNEL_PYTHON_BIN") ??
          (process.platform === "win32" ? "python" : "python3")
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
