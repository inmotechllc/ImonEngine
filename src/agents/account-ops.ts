import nodemailer from "nodemailer";
import path from "node:path";
import type { AppConfig } from "../config.js";
import type { ApprovalTask } from "../domain/contracts.js";
import { writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { FileStore } from "../storage/store.js";

interface TaskUpdateOptions {
  reopenCompleted?: boolean;
  status?: ApprovalTask["status"];
}

const NO_IMMEDIATE_ACTION_REQUIRED = "No immediate owner action is required right now.";

function isPlaceholderDomain(value: string | undefined): boolean {
  if (!value) {
    return true;
  }

  return /(^|\.)example\.(com|org|net)$/i.test(value.trim());
}

function isBrandedInbox(email: string | undefined, domain: string | undefined): boolean {
  const normalizedEmail = email?.trim().toLowerCase();
  const normalizedDomain = domain?.trim().toLowerCase();

  if (!normalizedEmail || !normalizedEmail.includes("@") || !normalizedDomain) {
    return false;
  }

  if (/@example\.(com|org|net)$/i.test(normalizedEmail) || isPlaceholderDomain(normalizedDomain)) {
    return false;
  }

  return normalizedEmail.endsWith(`@${normalizedDomain}`);
}

export class AccountOpsAgent {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore
  ) {}

  async ensureOperationalApprovals(): Promise<ApprovalTask[]> {
    const tasks: ApprovalTask[] = [];
    const businesses = await this.store.getManagedBusinesses();
    const activeCategories = new Set(
      businesses.filter((business) => business.stage === "active").map((business) => business.category)
    );

    const requiresDirectBilling = activeCategories.has("client_services_agency") || activeCategories.has("micro_saas_factory");
    const requiresBusinessInbox = activeCategories.has("client_services_agency") || activeCategories.has("micro_saas_factory");
    const requiresGumroadSeller = activeCategories.has("digital_asset_store");
    const directBillingReady = Boolean(this.config.business.stripeFounding && this.config.business.stripeStandard);
    const businessInboxReady = isBrandedInbox(this.config.business.salesEmail, this.config.business.domain);

    if (!requiresDirectBilling) {
      await this.deferTask(
        "approval-payment-links",
        "Stripe links are not on the critical path until a direct-billing business becomes active.",
        "Create Stripe payment links for the founding and standard packages, then add them to NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING and NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD."
      );
    } else if (!directBillingReady) {
      tasks.push(
        await this.createOrUpdateTask({
          id: "approval-payment-links",
          type: "payment",
          actionNeeded: "Add Stripe Payment Links for founding and standard offers",
          reason: "The outreach and proposal flow can draft offers, but cannot collect deposits without payment links.",
          ownerInstructions:
            "Create Stripe payment links for the founding and standard packages, then add them to NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING and NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD.",
          relatedEntityType: "account",
          relatedEntityId: "stripe"
        })
      );
    } else {
      await this.completeTask(
        "approval-payment-links",
        "Stripe payment links are configured for the active direct-billing lane."
      );
    }

    if (!requiresBusinessInbox) {
      await this.deferTask(
        "approval-sales-inbox",
        "A dedicated business inbox is not required until a direct-support or direct-billing business is active.",
        "Provision a sending inbox on the Northline domain and set NORTHLINE_SALES_EMAIL. Add SMTP settings if you want approval notices sent automatically."
      );
      await this.deferTask(
        "approval-smtp-setup",
        "SMTP can wait until live approval notifications matter for an active direct-support business.",
        "Add SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, and NORTHLINE_SMTP_FROM to enable approval notifications and SMTP fallback sends. The VPS Gmail session can still send approved outreach without SMTP. Legacy SMTP_FROM still loads as a fallback."
      );
    } else if (!businessInboxReady) {
      tasks.push(
        await this.createOrUpdateTask({
          id: "approval-sales-inbox",
          type: "email",
          actionNeeded: "Connect a real sales inbox on the business domain",
          reason: "Outbound and approval email should use a domain-owned inbox rather than a placeholder address.",
          ownerInstructions:
            "Provision a sending inbox on the Northline domain and set NORTHLINE_SALES_EMAIL. Add SMTP settings if you want approval notices sent automatically.",
          relatedEntityType: "account",
          relatedEntityId: "sales-email"
        })
      );
      await this.createOrUpdateTask(
        {
          id: "approval-smtp-setup",
          type: "email",
          actionNeeded: "Connect SMTP settings for live approval notifications",
          reason:
            "SMTP can wait until a branded inbox is connected and Northline is ready to move approval notifications or SMTP fallback sends off filesystem fallbacks.",
          ownerInstructions:
            "Add SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, and NORTHLINE_SMTP_FROM to enable approval notifications and SMTP fallback sends. The VPS Gmail session can still send approved outreach without SMTP. Legacy SMTP_FROM still loads as a fallback.",
          relatedEntityType: "account",
          relatedEntityId: "smtp"
        },
        {
          reopenCompleted: false,
          status: "waiting"
        }
      );
    } else {
      await this.completeTask(
        "approval-sales-inbox",
        `A branded sales inbox is configured for the active direct-support lane: ${this.config.business.salesEmail}.`
      );

      if (!this.config.smtp) {
        await this.createOrUpdateTask(
          {
            id: "approval-smtp-setup",
            type: "email",
            actionNeeded: "Connect SMTP settings for live approval notifications",
            reason:
                "SMTP is optional for VPS Gmail-based outbound sends during controlled launch, but required before approval notifications and SMTP fallback sends move off filesystem fallbacks.",
            ownerInstructions:
                "Add SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, and NORTHLINE_SMTP_FROM to enable approval notifications and SMTP fallback sends. The VPS Gmail session can still send approved outreach without SMTP. Legacy SMTP_FROM still loads as a fallback.",
            relatedEntityType: "account",
            relatedEntityId: "smtp"
          },
          {
            reopenCompleted: false,
            status: "waiting"
          }
        );
      } else {
        await this.completeTask(
          "approval-smtp-setup",
          "SMTP is configured for live approval notifications."
        );
      }
    }

    if (requiresGumroadSeller && !this.config.marketplaces.gumroadSellerEmail) {
      tasks.push(
        await this.createOrUpdateTask({
          id: "approval-gumroad-seller",
          type: "marketplace",
          actionNeeded: "Connect the Gumroad seller identity to ImonEngine",
          reason: "The digital asset store is active, but the system does not yet know which Gumroad seller account it should track.",
          ownerInstructions:
            "Add IMON_STORE_GUMROAD_SELLER_EMAIL to .env.example. If you have a profile URL, add IMON_STORE_GUMROAD_PROFILE_URL as well.",
          relatedEntityType: "account",
          relatedEntityId: "gumroad"
        })
      );
    } else {
      await this.deferTask(
        "approval-gumroad-seller",
        "Gumroad seller identity is already connected or the digital asset store is not active.",
        "Add IMON_STORE_GUMROAD_SELLER_EMAIL to .env.example. If you have a profile URL, add IMON_STORE_GUMROAD_PROFILE_URL as well."
      );
    }

    return tasks;
  }

  async createOrUpdateTask(
    task: Omit<ApprovalTask, "status" | "notifyChannel" | "createdAt" | "updatedAt">,
    options?: TaskUpdateOptions
  ): Promise<ApprovalTask> {
    const now = new Date().toISOString();
    const existing = (await this.store.getApprovals()).find((candidate) => candidate.id === task.id);
    if (existing?.status === "completed" && options?.reopenCompleted === false) {
      return existing;
    }
    const requestedStatus = options?.status ?? "open";
    const next: ApprovalTask = {
      ...task,
      notifyChannel: "email",
      status:
        existing?.status === "completed"
          ? requestedStatus === "open" && options?.reopenCompleted !== false
            ? "open"
            : "completed"
          : requestedStatus,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    await this.store.saveApproval(next);
    return next;
  }

  async notifyApproval(task: ApprovalTask): Promise<void> {
    const subject = `[Auto-Funding Approval] ${task.actionNeeded}`;
    const body = [
      `Action: ${task.actionNeeded}`,
      `Reason: ${task.reason}`,
      `Instructions: ${task.ownerInstructions}`,
      `Related: ${task.relatedEntityType}/${task.relatedEntityId}`
    ].join("\n");

    await this.notifyOwner(subject, body, {
      fileName: `${task.id}.txt`
    });
  }

  async notifyOwner(
    subject: string,
    body: string,
    options?: {
      fileName?: string;
      recipients?: string[];
    }
  ): Promise<{ channel: "email" | "file"; path?: string }> {
    const recipients = [
      ...(options?.recipients ?? [this.config.business.approvalEmail])
    ]
      .map((value) => value.trim())
      .filter((value) => Boolean(value) && !/@example\.(com|org|net)$/i.test(value));

    if (this.config.smtp && recipients.length > 0) {
      const transporter = nodemailer.createTransport({
        host: this.config.smtp.host,
        port: this.config.smtp.port,
        secure: this.config.smtp.secure,
        auth: {
          user: this.config.smtp.user,
          pass: this.config.smtp.pass
        }
      });

      await transporter.sendMail({
        from: this.config.smtp.from,
        to: recipients.join(", "),
        subject,
        text: body
      });
      return { channel: "email" };
    }

    const fileName = options?.fileName ?? `${slugify(subject) || "notification"}.txt`;
    const fallbackPath = path.join(this.config.notificationDir, fileName);
    await writeTextFile(fallbackPath, `${subject}\n\n${body}\n`);
    return {
      channel: "file",
      path: fallbackPath
    };
  }

  async setTaskStatus(
    id: string,
    status: ApprovalTask["status"],
    updates?: Partial<Pick<ApprovalTask, "reason" | "ownerInstructions">>
  ): Promise<ApprovalTask | undefined> {
    const existing = (await this.store.getApprovals()).find((candidate) => candidate.id === id);
    if (!existing) {
      return undefined;
    }

    const next: ApprovalTask = {
      ...existing,
      status,
      reason: updates?.reason ?? existing.reason,
      ownerInstructions: updates?.ownerInstructions ?? existing.ownerInstructions,
      updatedAt: new Date().toISOString()
    };
    await this.store.saveApproval(next);
    return next;
  }

  async completeTask(id: string, reason?: string): Promise<ApprovalTask | undefined> {
    return this.setTaskStatus(id, "completed", {
      reason,
      ownerInstructions: NO_IMMEDIATE_ACTION_REQUIRED
    });
  }

  private async deferTask(id: string, reason: string, ownerInstructions?: string): Promise<void> {
    const existing = (await this.store.getApprovals()).find((candidate) => candidate.id === id);
    if (!existing) {
      return;
    }

    if (existing.status === "completed") {
      return;
    }

    await this.store.saveApproval({
      ...existing,
      status: "waiting",
      reason,
      ownerInstructions: ownerInstructions ?? existing.ownerInstructions,
      updatedAt: new Date().toISOString()
    });
  }
}
