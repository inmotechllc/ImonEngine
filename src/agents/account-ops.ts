import nodemailer from "nodemailer";
import path from "node:path";
import type { AppConfig } from "../config.js";
import type { ApprovalTask } from "../domain/contracts.js";
import { writeTextFile } from "../lib/fs.js";
import { FileStore } from "../storage/store.js";

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

    if (requiresDirectBilling && (!this.config.business.stripeFounding || !this.config.business.stripeStandard)) {
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
      await this.deferTask(
        "approval-payment-links",
        "Stripe links are not on the critical path until a direct-billing business becomes active.",
        "Create Stripe payment links for the founding and standard packages, then add them to NORTHLINE_STRIPE_PAYMENT_LINK_FOUNDING and NORTHLINE_STRIPE_PAYMENT_LINK_STANDARD."
      );
    }

    if (
      requiresBusinessInbox &&
      (!this.config.business.salesEmail.includes("@") || this.config.business.salesEmail.endsWith("example.com"))
    ) {
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
    } else {
      await this.deferTask(
        "approval-sales-inbox",
        "A dedicated business inbox is not required until a direct-support or direct-billing business is active.",
        "Provision a sending inbox on the Northline domain and set NORTHLINE_SALES_EMAIL. Add SMTP settings if you want approval notices sent automatically."
      );
      await this.deferTask(
        "approval-smtp-setup",
        "SMTP can wait until live approval notifications matter for an active direct-support business.",
        "Add SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, and SMTP_FROM to enable live email notifications."
      );
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
    task: Omit<ApprovalTask, "status" | "notifyChannel" | "createdAt" | "updatedAt">
  ): Promise<ApprovalTask> {
    const now = new Date().toISOString();
    const existing = (await this.store.getApprovals()).find((candidate) => candidate.id === task.id);
    const next: ApprovalTask = {
      ...task,
      notifyChannel: "email",
      status: existing?.status === "completed" ? "open" : existing?.status ?? "open",
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

    if (this.config.smtp) {
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
        to: this.config.business.approvalEmail,
        subject,
        text: body
      });
      return;
    }

    const fallbackPath = path.join(this.config.notificationDir, `${task.id}.txt`);
    await writeTextFile(fallbackPath, `${subject}\n\n${body}\n`);
  }

  private async deferTask(id: string, reason: string, ownerInstructions?: string): Promise<void> {
    const existing = (await this.store.getApprovals()).find((candidate) => candidate.id === id);
    if (!existing) {
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
