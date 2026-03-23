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

    if (!this.config.business.stripeFounding || !this.config.business.stripeStandard) {
      tasks.push(
        await this.createOrUpdateTask({
          id: "approval-payment-links",
          type: "payment",
          actionNeeded: "Add Stripe Payment Links for founding and standard offers",
          reason: "The outreach and proposal flow can draft offers, but cannot collect deposits without payment links.",
          ownerInstructions:
            "Create Stripe payment links for the founding and standard packages, then add them to STRIPE_PAYMENT_LINK_FOUNDING and STRIPE_PAYMENT_LINK_STANDARD.",
          relatedEntityType: "account",
          relatedEntityId: "stripe"
        })
      );
    }

    if (!this.config.business.salesEmail.includes("@") || this.config.business.salesEmail.endsWith("example.com")) {
      tasks.push(
        await this.createOrUpdateTask({
          id: "approval-sales-inbox",
          type: "email",
          actionNeeded: "Connect a real sales inbox on the business domain",
          reason: "Outbound and approval email should use a domain-owned inbox rather than a placeholder address.",
          ownerInstructions:
            "Provision a sending inbox on the business domain and set BUSINESS_SALES_EMAIL. Add SMTP settings if you want approval notices sent automatically.",
          relatedEntityType: "account",
          relatedEntityId: "sales-email"
        })
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
      status: existing?.status ?? "open",
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
}
