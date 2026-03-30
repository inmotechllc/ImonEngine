import type {
  OfficeChatAction,
  OfficeChatMessage,
  OfficeChatSummary,
  OfficeChatThread,
  OfficeReportArtifact,
  OrgScope
} from "../domain/org.js";

type ChatScope = Extract<OrgScope, "engine" | "business" | "department">;

export function assistantLabelForOfficeScope(scope: ChatScope): string {
  if (scope === "engine") {
    return "Imon Engine Orchestrator";
  }
  if (scope === "business") {
    return "Brand Orchestrator";
  }
  return "Department Orchestrator";
}

export function buildOfficeChatSummary(args: {
  officeId: string;
  scope: ChatScope;
  thread?: OfficeChatThread;
  messages: OfficeChatMessage[];
  actions: OfficeChatAction[];
  reports: OfficeReportArtifact[];
}): OfficeChatSummary {
  const lastMessage = [...args.messages].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  )[0];
  const pendingActionCount = args.actions.filter(
    (action) => action.status === "awaiting_confirmation"
  ).length;
  const latestActionTitles = [...args.actions]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 3)
    .map((action) => action.title);
  const latestReportTitles = [...args.reports]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 3)
    .map((artifact) => artifact.title);

  return {
    officeId: args.officeId,
    scope: args.scope,
    threadId: args.thread?.id ?? `${args.officeId}-thread`,
    assistantLabel: args.thread?.assistantLabel ?? assistantLabelForOfficeScope(args.scope),
    lastMessagePreview: lastMessage?.content?.slice(0, 180) || "No chat history yet.",
    lastMessageAt: lastMessage?.createdAt ?? args.thread?.lastMessageAt,
    pendingActionCount,
    reportCount: args.reports.length,
    latestActionTitles,
    latestReportTitles
  };
}
