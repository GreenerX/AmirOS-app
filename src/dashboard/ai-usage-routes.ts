import type { IncomingMessage, ServerResponse } from "node:http";
import type { AiService } from "../ai.js";
import { type AmirosState, type TodoTask } from "../amiros-state.js";
import type { AppConfig } from "../config.js";
import { CURRENT_RELEASE, RELEASE_HISTORY } from "../release.js";
import { uiBuildFingerprint } from "../ui-build-runtime.js";
import { MODEL_OPTIONS } from "./settings-routes.js";

type SendJson = (response: ServerResponse, status: number, value: unknown) => void;

type VisibleTodoTask = Pick<TodoTask, "status" | "priority" | "dueAt" | "createdAt" | "updatedAt" | "completedAt">;

type AiUsageRouteOptions = {
  request: IncomingMessage;
  response: ServerResponse;
  pathname: string;
  config: AppConfig;
  ai: AiService;
  state: AmirosState;
  chatNameCache: Map<string, string>;
  sendJson: SendJson;
  visibleTodoTasks: <T extends VisibleTodoTask>(todos: T[]) => T[];
  isKnownIntelligenceChat: (chatId: string, contactName: string) => boolean;
  activitiesWithContactNames: () => Promise<unknown>;
};

/**
 * Handles the dashboard summary endpoint, including its AI usage, estimated
 * spend, model choices, and monthly-budget data. Other AmirOS API routes stay
 * in dashboard.ts.
 */
export async function handleAiUsageApiRoute(options: AiUsageRouteOptions): Promise<boolean> {
  const {
    request,
    response,
    pathname,
    config,
    ai,
    state,
    chatNameCache,
    sendJson,
    visibleTodoTasks,
    isKnownIntelligenceChat,
    activitiesWithContactNames,
  } = options;

  if (request.method !== "GET" || pathname !== "/api/dashboard") return false;

  const usage = ai.usageSnapshot();
  const todos = visibleTodoTasks(state.listTodoTasks())
    .map((todo) => ({
      ...todo,
      contactName: chatNameCache.get(todo.chatId) || todo.contactName || todo.evidence.senderName || "WhatsApp contact",
    }))
    .filter((todo) => isKnownIntelligenceChat(todo.chatId, todo.contactName || "WhatsApp contact"));
  sendJson(response, 200, {
    connection: state.connection(),
    paused: state.isPaused(),
    preset: config.modelPresetName,
    models: {
      text: config.openaiTextModel,
      image: config.openaiImageModel,
      voice: config.openaiTranscribeModel,
    },
    modelOptions: MODEL_OPTIONS,
    usage,
    monthlySpendUsd: state.monthlySpendUsd(),
    release: { ...CURRENT_RELEASE, history: RELEASE_HISTORY },
    betaSupport: config.betaSupportEmail
      ? { email: config.betaSupportEmail, build: uiBuildFingerprint()?.slice(0, 12) }
      : config.betaSupportUrl
        ? { url: config.betaSupportUrl, build: uiBuildFingerprint()?.slice(0, 12) }
        : { build: uiBuildFingerprint()?.slice(0, 12) },
    drafts: state.listDrafts(),
    todos,
    activities: await activitiesWithContactNames(),
    knowledgeTrackingRequests: state.listKnowledgeTrackingRequests()
      .filter((request) => isKnownIntelligenceChat(request.chatId, request.contactName)),
    settings: { ...state.getSettings(), apiKeyConfigured: ai.isConfigured() },
  });
  return true;
}
