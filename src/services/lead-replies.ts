import type { LeadReplyClassification, LeadReplyRecord, LeadRecord } from "../domain/contracts.js";
import { slugify } from "../lib/text.js";
import { ReplyHandlerAgent } from "../agents/reply-handler.js";
import { FileStore } from "../storage/store.js";

function nowIso(): string {
  return new Date().toISOString();
}

function routeTag(route: LeadReplyClassification["route"]): string | undefined {
  switch (route) {
    case "booked_call":
      return "reply-route-booked-call";
    case "intake_follow_up":
      return "reply-route-intake-follow-up";
    case "do_not_contact":
      return "reply-route-do-not-contact";
    default:
      return undefined;
  }
}

function replyId(leadId: string, externalMessageId: string | undefined, receivedAt: string): string {
  if (externalMessageId) {
    return `lead-reply-${slugify(leadId)}-${slugify(externalMessageId) || "message"}`;
  }
  return `lead-reply-${slugify(leadId)}-${receivedAt.replaceAll(":", "-").replaceAll(".", "-")}`;
}

function applyRouteTags(lead: LeadRecord, route: LeadReplyClassification["route"]): string[] {
  const cleaned = (lead.tags ?? []).filter(
    (tag) => !tag.startsWith("reply-route-")
  );
  const nextRouteTag = routeTag(route);
  if (!nextRouteTag || cleaned.includes(nextRouteTag)) {
    return cleaned;
  }
  return [...cleaned, nextRouteTag];
}

export async function processLeadReply(options: {
  store: FileStore;
  replyHandler: ReplyHandlerAgent;
  leadId: string;
  message: string;
  subject?: string;
  source: LeadReplyRecord["source"];
  externalThreadId?: string;
  externalMessageId?: string;
  fromAddress?: string;
  receivedAt?: string;
}): Promise<{
  lead: LeadRecord;
  reply: LeadReplyRecord;
  classification: LeadReplyClassification;
  duplicate: boolean;
}> {
  const lead = await options.store.getLead(options.leadId);
  if (!lead) {
    throw new Error(`Lead ${options.leadId} not found.`);
  }

  const receivedAt = options.receivedAt ?? nowIso();
  const processedAt = nowIso();
  const existingReplies = await options.store.getLeadReplies();
  const duplicate = options.externalMessageId
    ? existingReplies.find(
        (reply) =>
          reply.leadId === options.leadId &&
          reply.externalMessageId === options.externalMessageId
      )
    : undefined;

  if (duplicate) {
    return {
      lead,
      reply: duplicate,
      classification: duplicate.classification,
      duplicate: true
    };
  }

  const classification = await options.replyHandler.classify(options.message);
  const updatedLead: LeadRecord = {
    ...lead,
    stage: classification.recommendedStage,
    tags: applyRouteTags(lead, classification.route),
    lastTouchAt: receivedAt,
    updatedAt: processedAt
  };
  await options.store.saveLead(updatedLead);

  const reply: LeadReplyRecord = {
    id: replyId(options.leadId, options.externalMessageId, receivedAt),
    businessId: updatedLead.businessId,
    leadId: updatedLead.id,
    source: options.source,
    externalThreadId: options.externalThreadId,
    externalMessageId: options.externalMessageId,
    fromAddress: options.fromAddress,
    subject: options.subject ?? `Reply from ${updatedLead.businessName}`,
    body: options.message,
    receivedAt,
    syncedAt: processedAt,
    classification,
    processedAt
  };
  await options.store.saveLeadReply(reply);

  return {
    lead: updatedLead,
    reply,
    classification,
    duplicate: false
  };
}
