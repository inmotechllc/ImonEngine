import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AppConfig } from "../config.js";
import {
  clientCountsTowardExternalRevenue,
  AgencyPricingTierPaymentLinkKey,
  ClientJob,
  HandoffPackage,
  LeadStage,
  ProofBundle,
  ProofBundleRequestDraft,
  ProofBundleScreenshot,
  RetentionReport,
  RetentionUpgradeOffer,
  ReviewResponseDraft,
  RunReport
} from "../domain/contracts.js";
import {
  DEFAULT_NORTHLINE_BUSINESS_ID,
  type ResolvedNorthlineBusinessProfile
} from "../domain/northline.js";
import { resolveClientPreviewPath } from "../lib/client-preview.js";
import { ensureDir, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { slugify } from "../lib/text.js";
import { AIClient, RetentionSchema } from "../ai/client.js";
import { retentionPrompt } from "../ai/prompts.js";
import { resolveNorthlineBusinessProfile } from "./northline-business-profile.js";
import { FileStore } from "../storage/store.js";

const LEAD_STAGES: LeadStage[] = [
  "prospecting",
  "qualified",
  "drafted",
  "contacted",
  "responded",
  "won",
  "lost",
  "discarded"
];

export class ReportsService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore,
    private readonly ai: AIClient
  ) {}

  async generateRunReport(notes: string[] = []): Promise<RunReport> {
    const [leads, approvals, clients, offers] = await Promise.all([
      this.store.getLeads(),
      this.store.getApprovals(),
      this.store.getClients(),
      this.store.getOffers()
    ]);

    const counts = Object.fromEntries(LEAD_STAGES.map((stage) => [stage, 0])) as Record<LeadStage, number>;
    for (const lead of leads) {
      counts[lead.stage] += 1;
    }

    const externalClients = clients.filter((client) => clientCountsTowardExternalRevenue(client));
    const activeClients = externalClients.filter((client) => client.billingStatus === "retainer_active");
    const mrr = activeClients.reduce((sum, client) => {
      const offer = offers.find((item) => item.id === client.offerId);
      return sum + (offer?.monthlyPrice ?? 0);
    }, 0);

    const report: RunReport = {
      id: `run-${new Date().toISOString().replaceAll(":", "-")}`,
      generatedAt: new Date().toISOString(),
      pipelineCounts: counts,
      replies: counts.responded,
      bookedCalls: externalClients.filter((client) => client.nextAction.toLowerCase().includes("booked")).length,
      closes: externalClients.filter((client) => ["paid", "retainer_active"].includes(client.billingStatus)).length,
      mrr,
      blockedApprovals: approvals.filter((approval) => approval.status !== "completed").length,
      notes,
      upsellCandidates: activeClients.map(
        (client) => `${client.clientName}: add GBP optimization or review request automation`
      )
    };

    await this.store.saveReport(report);
    await writeJsonFile(path.join(this.config.reportDir, `${report.id}.json`), report);
    return report;
  }

  async generateRetentionReport(client: ClientJob): Promise<RetentionReport> {
    const businessProfile = await this.resolveBusinessProfile(client);
    const upgradeContext = this.retentionUpgradeContext(client, businessProfile);
    const fallbackReviewResponses: ReviewResponseDraft[] = (client.assets.reviews ?? [
      "Great service and easy scheduling.",
      "Tech showed up on time and explained everything.",
      "Would use them again for future work."
    ]).map((review) => ({
      review,
      response:
        "Thanks for the feedback. We appreciate the trust and are glad the service experience was straightforward."
    }));

    const generated = await this.ai.generateJson({
      schema: RetentionSchema,
      prompt: retentionPrompt(client, {
        businessName: businessProfile?.businessName,
        upgradeOffer: upgradeContext
          ? {
              label: upgradeContext.label,
              couponLabel: upgradeContext.couponLabel,
              terms: upgradeContext.terms,
              hasPaymentLink: Boolean(upgradeContext.paymentLink)
            }
          : undefined
      }),
      businessId: client.businessId ?? businessProfile?.businessId ?? DEFAULT_NORTHLINE_BUSINESS_ID,
      capability: "retention-report",
      mode: "deep",
      fallback: () => ({
        updateSuggestions: [
          "Create a seasonal service block above the fold for the next 30 days.",
          "Add one trust badge cluster near the primary CTA.",
          "Tighten the form copy so homeowners know response timing."
        ],
        reviewResponses: fallbackReviewResponses,
        upsellCandidate: upgradeContext
          ? "Move the client from Lead Generation into the configured Growth System upgrade once fit is confirmed."
          : "Add a second landing page focused on the highest-margin service.",
        upgradeOffer: upgradeContext
          ? {
              label: upgradeContext.label,
              summary: this.defaultUpgradeSummary(upgradeContext),
              nextStep: this.defaultUpgradeNextStep(upgradeContext)
            }
          : undefined
      })
    });

    const report: RetentionReport = {
      clientId: client.id,
      createdAt: new Date().toISOString(),
      reviewResponses: generated.data.reviewResponses,
      updateSuggestions: generated.data.updateSuggestions,
      upsellCandidate: generated.data.upsellCandidate,
      upgradeOffer: this.buildRetentionUpgradeOffer(upgradeContext, generated.data.upgradeOffer)
    };

    await this.store.saveRetentionReport(report);
    await writeJsonFile(path.join(this.config.reportDir, `${client.id}-retention.json`), report);
    return report;
  }

  async generateProofBundle(
    client: ClientJob,
    options?: {
      retentionReport?: RetentionReport;
    }
  ): Promise<ProofBundle> {
    const createdAt = new Date().toISOString();
    const bundleDir = path.join(this.config.reportDir, "proof-bundles", slugify(client.id));
    const reportPath = path.join(bundleDir, "proof-bundle.json");
    const qaReportPath = path.join(this.config.reportDir, `${client.id}-qa.json`);
    const previewPath = await resolveClientPreviewPath(this.config, client);
    const resolvedClient =
      previewPath === client.deployment.previewPath
        ? client
        : {
            ...client,
            deployment: {
              ...client.deployment,
              previewPath
            }
          };
    const retentionReport =
      options?.retentionReport ??
      this.latestRetentionReport(
        (await this.store.getRetentionReports()).filter((report) => report.clientId === client.id)
      );
    const retentionReportPath = retentionReport
      ? path.join(this.config.reportDir, `${client.id}-retention.json`)
      : undefined;
    const screenshots = await this.captureProofScreenshots(resolvedClient, bundleDir);
    const testimonialQuote = this.firstProofQuote(resolvedClient);
    const bundle: ProofBundle = {
      clientId: client.id,
      businessId: client.businessId,
      createdAt,
      clientName: client.clientName,
      siteStatus: client.siteStatus,
      qaStatus: client.qaStatus,
      previewPath,
      reportPath,
      qaReportPath,
      retentionReportPath,
      screenshots,
      testimonialRequest: this.buildTestimonialRequest(resolvedClient),
      reviewRequest: this.buildReviewRequest(resolvedClient),
      publication: {
        headline: this.publicationHeadline(resolvedClient),
        summary: this.publicationSummary(resolvedClient),
        bullets: [
          previewPath
            ? `Preview is available at ${previewPath}.`
            : "Preview artifact path is not recorded yet.",
          resolvedClient.qaStatus === "passed"
            ? "QA passed and the preview is ready for client handoff packaging."
            : `QA is ${resolvedClient.qaStatus}; review the latest QA report before publishing proof broadly.`,
          retentionReport
            ? this.retentionPublicationBullet(retentionReport)
            : `Testimonial and review asks are packaged for follow-up immediately after delivery.`
        ],
        testimonialQuote
      }
    };

    await ensureDir(bundleDir);
    await this.store.saveProofBundle(bundle);
    await this.store.saveClient({
      ...resolvedClient,
      assets: {
        ...resolvedClient.assets,
        proofBundle: bundle
      },
      updatedAt: createdAt
    });
    await writeJsonFile(reportPath, bundle);
    return bundle;
  }

  async generateHandoffPackage(
    client: ClientJob,
    options?: {
      retentionReport?: RetentionReport;
      proofBundle?: ProofBundle;
    }
  ): Promise<HandoffPackage> {
    const createdAt = new Date().toISOString();
    const handoffDir = path.join(this.config.reportDir, "handoff-packages", slugify(client.id));
    const reportPath = path.join(handoffDir, "handoff-package.json");
    const readmePath = path.join(handoffDir, "README.md");
    const qaReportPath = path.join(this.config.reportDir, `${client.id}-qa.json`);
    const previewPath = await resolveClientPreviewPath(this.config, client);
    const resolvedClient =
      previewPath === client.deployment.previewPath
        ? client
        : {
            ...client,
            deployment: {
              ...client.deployment,
              previewPath
            }
          };
    const retentionReport =
      options?.retentionReport ??
      this.latestRetentionReport(
        (await this.store.getRetentionReports()).filter((report) => report.clientId === client.id)
      );
    const proofBundle = options?.proofBundle ?? resolvedClient.assets.proofBundle;
    const retentionReportPath = retentionReport
      ? path.join(this.config.reportDir, `${client.id}-retention.json`)
      : undefined;
    const handoffPackage: HandoffPackage = {
      clientId: client.id,
      businessId: client.businessId,
      createdAt,
      clientName: client.clientName,
      previewPath,
      reportPath,
      readmePath,
      qaReportPath,
      retentionReportPath,
      proofBundlePath: proofBundle?.reportPath,
      summary: this.handoffSummary(resolvedClient),
      includedArtifacts: [
        previewPath ? `QA-passed preview export: ${previewPath}` : "Preview export path is not recorded yet.",
        `Package manifest: ${reportPath}`,
        `Publication instructions: ${readmePath}`,
        `Latest QA report: ${qaReportPath}`,
        proofBundle ? `Proof bundle: ${proofBundle.reportPath}` : undefined,
        retentionReportPath ? `Retention report: ${retentionReportPath}` : undefined
      ].filter((value): value is string => Boolean(value)),
      clientChecklist: this.clientHandoffChecklist(resolvedClient),
      developerChecklist: this.developerHandoffChecklist(resolvedClient)
    };

    await ensureDir(handoffDir);
    await this.store.saveClient({
      ...resolvedClient,
      assets: {
        ...resolvedClient.assets,
        handoffPackage
      }
    });
    await writeJsonFile(reportPath, handoffPackage);
    await writeTextFile(readmePath, this.buildHandoffReadme(handoffPackage, retentionReport));
    return handoffPackage;
  }

  private buildTestimonialRequest(client: ClientJob): ProofBundleRequestDraft {
    return {
      subject: `Quick Northline testimonial request for ${client.clientName}`,
      body: [
        `Hi ${client.clientName},`,
        "",
        "The preview is live and the QA pass is recorded.",
        "Could you reply with 2-3 sentences on what felt clearer, faster, or easier after the Northline update?",
        "Specific details about the homepage, intake path, or follow-up flow are the most useful.",
        "",
        "Thanks,",
        "Northline Growth Systems"
      ].join("\n")
    };
  }

  private buildReviewRequest(client: ClientJob): ProofBundleRequestDraft {
    const targetUrl = this.config.business.googleReviewUrl?.trim() || undefined;
    return {
      subject: `Could you leave a short Northline review for ${client.clientName}?`,
      body: [
        `Hi ${client.clientName},`,
        "",
        "If the Northline build and follow-up pack helped, could you leave a short public review?",
        targetUrl
          ? `Use this link: ${targetUrl}`
          : "Reply if you want the review link sent directly.",
        "A sentence or two on clarity, speed, or lead handling is enough.",
        "",
        "Thank you,",
        "Northline Growth Systems"
      ].join("\n"),
      targetUrl
    };
  }

  private publicationHeadline(client: ClientJob): string {
    const focus = client.assets.services?.[0] ?? client.niche;
    return `${client.clientName}: ${focus} lead path rebuilt for faster response`;
  }

  private publicationSummary(client: ClientJob): string {
    return `${client.clientName} moved from intake friction to a clearer proof-first preview, packaged with QA, screenshot capture, and follow-up asks.`;
  }

  private handoffSummary(client: ClientJob): string {
    return `${client.clientName} is packaged for client-managed publication with a QA-passed preview, proof assets, and clear next-step instructions for the client or their developer.`;
  }

  private clientHandoffChecklist(client: ClientJob): string[] {
    return [
      `Review the approved preview for ${client.clientName} and confirm the offer, phone number, and CTA language are ready to publish.`,
      "Forward the handoff package README and approved preview export to whoever manages the live website or hosting account.",
      "Confirm whether the current lead form should stay on the packaged endpoint or be replaced with the client's approved production handler before launch.",
      "Ask the publishing owner to send back the final live URL once the update is live on the client's host so retention follow-up can point at the real page."
    ];
  }

  private developerHandoffChecklist(client: ClientJob): string[] {
    return [
      `Publish the approved preview for ${client.clientName} from the packaged export instead of rebuilding the page from scratch.`,
      "Preserve the approved layout, copy, assets, phone links, and contact CTA behavior unless the client requested a deliberate integration change.",
      client.formEndpoint
        ? `Keep the form action wired to ${client.formEndpoint} or replace it with the client's approved production endpoint before launch.`
        : "Set the form action to the client's approved production endpoint before launch if the preview still uses a temporary handler.",
      "Verify the homepage, phone links, and form submit path on both desktop and mobile after the publish completes.",
      "Return the live production URL and any publish notes so Northline can close the delivery loop without managing the host directly."
    ];
  }

  private buildHandoffReadme(
    handoffPackage: HandoffPackage,
    retentionReport?: RetentionReport
  ): string {
    const packageContents = [
      "- Approved preview export: the page files your web person should publish on the live site",
      `- Handoff manifest: ${path.basename(handoffPackage.reportPath)}`,
      `- This README: ${path.basename(handoffPackage.readmePath)}`,
      handoffPackage.qaReportPath
        ? `- QA report: ${path.basename(handoffPackage.qaReportPath)}`
        : "- QA report: not generated yet",
      handoffPackage.proofBundlePath
        ? `- Proof bundle: ${path.basename(handoffPackage.proofBundlePath)}`
        : undefined,
      handoffPackage.retentionReportPath
        ? `- Retention report: ${path.basename(handoffPackage.retentionReportPath)}`
        : undefined
    ].filter((item): item is string => Boolean(item));

    const sourcePaths = [
      handoffPackage.previewPath
        ? `- Preview export source: ${handoffPackage.previewPath}`
        : "- Preview export source: not recorded yet",
      `- Handoff manifest source: ${handoffPackage.reportPath}`,
      handoffPackage.qaReportPath ? `- QA report source: ${handoffPackage.qaReportPath}` : undefined,
      handoffPackage.proofBundlePath ? `- Proof bundle source: ${handoffPackage.proofBundlePath}` : undefined,
      handoffPackage.retentionReportPath
        ? `- Retention report source: ${handoffPackage.retentionReportPath}`
        : undefined
    ].filter((item): item is string => Boolean(item));

    const upgradeSection = retentionReport?.upgradeOffer
      ? [
          "## Growth upgrade path",
          `- Upgrade target: ${retentionReport.upgradeOffer.label}`,
          `- Summary: ${retentionReport.upgradeOffer.summary}`,
          `- Next step: ${retentionReport.upgradeOffer.nextStep}`,
          retentionReport.upgradeOffer.paymentLink
            ? `- Upgrade checkout: ${retentionReport.upgradeOffer.paymentLink}`
            : "- Upgrade checkout: confirm the live checkout path before sending the broader Growth System offer.",
          retentionReport.upgradeOffer.couponLabel
            ? `- Coupon label: ${retentionReport.upgradeOffer.couponLabel}`
            : undefined,
          retentionReport.upgradeOffer.terms
            ? `- Terms: ${retentionReport.upgradeOffer.terms}`
            : undefined,
          ""
        ].filter((item): item is string => Boolean(item))
      : [];

    return [
      `# ${handoffPackage.clientName} handoff package`,
      "",
      handoffPackage.summary,
      "",
      "## Start here",
      "- Northline is not hosting this site for you.",
      "- This package is the approved version your current website owner, developer, or hosting support team should publish.",
      "- Send this README and the approved preview export together so the publisher has both the files and the instructions.",
      "",
      "## Fastest publish path",
      "1. Review the approved preview and confirm the offer, phone number, and CTA copy are correct.",
      "2. Forward the approved preview export and this README to the person who updates your website.",
      "3. Ask them to publish the approved page on your current host without redesigning it first.",
      "4. Ask them to confirm the live form endpoint before launch if they need to swap the current handler.",
      "5. Have them send back the final live URL after publish so Northline can close delivery cleanly.",
      "",
      "## Send this to your web person",
      "- Publish the approved preview export as delivered instead of rebuilding the page from scratch.",
      "- Keep the approved copy, phone links, CTA order, and contact flow unless the client approved a specific integration change.",
      "- Follow the form-action instruction in the developer checklist below before launch.",
      "- Test the homepage, phone links, and form submit flow on desktop and mobile after publishing.",
      "- Return the live URL and any host-specific notes once the page is live.",
      "",
      "## If you do not have a developer",
      "- Send the approved preview export and this README to your hosting support team or a freelancer.",
      "- Tell them this is an approved page export that should replace or update the current page without a redesign pass first.",
      "- If they must rebuild it inside WordPress, Squarespace, Wix, or another CMS, they should keep the same copy, layout order, phone links, and CTA flow from the approved preview.",
      "- Ask them to send you the final live URL and any issue that blocked the publish.",
      "",
      "## Package contents",
      ...packageContents,
      "",
      "## Northline source paths",
      ...sourcePaths,
      "",
      ...upgradeSection,
      "## Client checklist",
      ...handoffPackage.clientChecklist.map((item) => `- ${item}`),
      "",
      "## Developer checklist",
      ...handoffPackage.developerChecklist.map((item) => `- ${item}`)
    ].join("\n");
  }

  private async resolveBusinessProfile(
    client: ClientJob
  ): Promise<ResolvedNorthlineBusinessProfile | undefined> {
    const businessId = client.businessId ?? DEFAULT_NORTHLINE_BUSINESS_ID;
    const business = await this.store.getManagedBusiness(businessId);

    if (business) {
      return resolveNorthlineBusinessProfile(this.config, business);
    }

    if (businessId === DEFAULT_NORTHLINE_BUSINESS_ID) {
      return resolveNorthlineBusinessProfile(this.config);
    }

    return undefined;
  }

  private retentionUpgradeContext(
    client: ClientJob,
    businessProfile: ResolvedNorthlineBusinessProfile | undefined
  ): RetentionUpgradeOffer | undefined {
    if (!businessProfile || client.offerId !== "lead-generation-offer") {
      return undefined;
    }

    const leadGenerationTier = businessProfile.agencyProfile.pricing.find(
      (tier) => tier.id === "lead-generation"
    );
    const upgradeSource = leadGenerationTier?.upgradeOffer;
    const paymentLinkKey = upgradeSource?.paymentLinkKey;
    const paymentLink =
      this.paymentLinkForKey(businessProfile, paymentLinkKey) ?? businessProfile.growthUpgrade?.paymentLink;
    const couponLabel = businessProfile.growthUpgrade?.couponLabel;
    const terms = businessProfile.growthUpgrade?.terms ?? upgradeSource?.terms;

    if (!upgradeSource && !paymentLink && !couponLabel && !terms) {
      return undefined;
    }

    const label = upgradeSource?.label ?? "Upgrade to Growth System";
    return {
      targetTierId: "growth-system",
      label,
      summary: this.defaultUpgradeSummary({ label, paymentLink, couponLabel, terms }),
      nextStep: this.defaultUpgradeNextStep({ label, paymentLink, couponLabel, terms }),
      paymentLinkKey,
      paymentLink,
      couponLabel,
      terms
    };
  }

  private buildRetentionUpgradeOffer(
    base: RetentionUpgradeOffer | undefined,
    generated:
      | {
          label: string;
          summary: string;
          nextStep: string;
        }
      | undefined
  ): RetentionUpgradeOffer | undefined {
    if (!base) {
      return undefined;
    }

    return {
      ...base,
      label: generated?.label || base.label,
      summary: generated?.summary || base.summary,
      nextStep: generated?.nextStep || base.nextStep
    };
  }

  private paymentLinkForKey(
    profile: ResolvedNorthlineBusinessProfile,
    key: AgencyPricingTierPaymentLinkKey | undefined
  ): string | undefined {
    switch (key) {
      case "lead_generation":
        return profile.stripeLeadGeneration;
      case "founding":
        return profile.stripeFounding;
      case "standard":
        return profile.stripeStandard;
      case "growth_upgrade":
        return profile.growthUpgrade?.paymentLink;
      default:
        return undefined;
    }
  }

  private defaultUpgradeSummary(context: {
    label: string;
    paymentLink?: string;
    couponLabel?: string;
    terms?: string;
  }): string {
    if (context.paymentLink) {
      return `Lead Generation proved the initial fit, so Northline can move the client into ${context.label} through the configured upgrade checkout.`;
    }

    if (context.couponLabel || context.terms) {
      return `Lead Generation proved the initial fit, and Northline has a configured ${context.label} upgrade path with coupon-aware terms ready for the broader rollout.`;
    }

    return `Lead Generation proved the initial fit, so the next expansion step is ${context.label} once the client confirms the broader scope.`;
  }

  private defaultUpgradeNextStep(context: {
    label: string;
    paymentLink?: string;
    couponLabel?: string;
    terms?: string;
  }): string {
    if (context.paymentLink && context.couponLabel) {
      return `Send the configured ${context.label} checkout and mention ${context.couponLabel} before booking the broader implementation kickoff.`;
    }

    if (context.paymentLink) {
      return `Send the configured ${context.label} checkout once the client confirms they want the broader implementation.`;
    }

    if (context.couponLabel || context.terms) {
      return `Confirm the configured ${context.label} terms in writing before asking the client to approve the broader rollout.`;
    }

    return `Confirm fit for ${context.label} before asking the client to approve the broader rollout.`;
  }

  private retentionPublicationBullet(report: RetentionReport): string {
    if (report.upgradeOffer) {
      const upgradeNote = [
        report.upgradeOffer.label,
        report.upgradeOffer.couponLabel,
        report.upgradeOffer.terms
      ]
        .filter(Boolean)
        .join(" | ");
      return `Monthly retention follow-up is packaged with upsell focus: ${report.upsellCandidate}. Growth upgrade path: ${upgradeNote || report.upgradeOffer.nextStep}.`;
    }

    return `Monthly retention follow-up is packaged with upsell focus: ${report.upsellCandidate}.`;
  }

  private firstProofQuote(client: ClientJob): string | undefined {
    return [...(client.assets.testimonials ?? []), ...(client.assets.reviews ?? [])]
      .map((entry) => entry.trim())
      .find(Boolean);
  }

  private latestRetentionReport(reports: RetentionReport[]): RetentionReport | undefined {
    return reports.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  }

  private async captureProofScreenshots(
    client: ClientJob,
    bundleDir: string
  ): Promise<ProofBundleScreenshot[]> {
    const previewPath = client.deployment.previewPath;
    if (!previewPath) {
      return [];
    }

    const entryPath = path.join(previewPath, "index.html");
    const targetUrl = pathToFileURL(entryPath).href;

    try {
      const { chromium } = await import("playwright");
      await ensureDir(bundleDir);
      const desktopPath = path.join(bundleDir, "home-desktop.png");
      const mobilePath = path.join(bundleDir, "home-mobile.png");
      const browser = await chromium.launch({ headless: true });

      try {
        const desktop = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
        await desktop.goto(targetUrl, { waitUntil: "load" });
        await desktop.locator("h1").waitFor();
        await desktop.screenshot({ path: desktopPath, fullPage: true });
        await desktop.close();

        const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await mobile.goto(targetUrl, { waitUntil: "load" });
        await mobile.locator("h1").waitFor();
        await mobile.screenshot({ path: mobilePath, fullPage: true });
        await mobile.close();
      } finally {
        await browser.close();
      }

      return [
        {
          id: `${client.id}-home-desktop`,
          label: "Desktop homepage",
          path: desktopPath,
          viewport: "desktop"
        },
        {
          id: `${client.id}-home-mobile`,
          label: "Mobile homepage",
          path: mobilePath,
          viewport: "mobile"
        }
      ];
    } catch {
      return [];
    }
  }
}
