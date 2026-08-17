import type { IncomingMessage, ServerResponse } from "node:http";
import type { AiService } from "../ai.js";
import { type AmirosState, type TodoTask } from "../amiros-state.js";
import type { AppConfig } from "../config.js";
import { CURRENT_RELEASE, RELEASE_HISTORY } from "../release.js";
import { uiBuildFingerprint } from "../ui-build-runtime.js";
import { MODEL_OPTIONS } from "./settings-routes.js";
import type { ControlCenterEntitlement } from "../control-center-entitlement.js";

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
  controlCenter?: ControlCenterEntitlement;
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
    controlCenter,
  } = options;

  if (request.method !== "GET" || pathname !== "/api/dashboard") return false;

  const controlCenterSupportUrl = config.controlCenterUrl
    ? new URL("/account/?support=1", config.controlCenterUrl).toString()
    : undefined;
  const controlCenterStatus = controlCenter?.snapshot();
  const visibleControlCenter = controlCenterStatus || {
    configured: false,
    status: "unpaired" as const,
    detail: "Control Center connection is not configured for this AmirOS copy.",
    setupState: "setup_required" as const,
    activationRequired: false,
    features: [],
  };
  // Existing local installs keep their established email/URL support route.
  // The Control Center becomes the primary support path only for a new
  // managed beta package, where an approved device can submit directly.
  const betaSupport = config.requireControlCenterActivation && controlCenterSupportUrl
    ? {
        url: controlCenterSupportUrl,
        // Keep existing installations on their established support route until
        // they are packaged as a managed, approval-gated beta copy. This avoids
        // sending a tester to a Control Center endpoint before that control
        // plane has been deployed for their release.
        direct: config.requireControlCenterActivation
          && controlCenterStatus?.setupState === "active"
          && (controlCenterStatus.status === "active" || controlCenterStatus.status === "offline_grace"),
        build: uiBuildFingerprint()?.slice(0, 12),
      }
    : config.betaSupportEmail
      ? { email: config.betaSupportEmail, build: uiBuildFingerprint()?.slice(0, 12) }
      : config.betaSupportUrl
        ? { url: config.betaSupportUrl, build: uiBuildFingerprint()?.slice(0, 12) }
        : { build: uiBuildFingerprint()?.slice(0, 12) };
  const activationOnly = visibleControlCenter.configured
    && visibleControlCenter.activationRequired
    && (visibleControlCenter.setupState !== "active"
      || (visibleControlCenter.status !== "active" && visibleControlCenter.status !== "offline_grace"));
  if (activationOnly) {
    sendJson(response, 200, {
      activationOnly: true,
      connection: state.connection(),
      controlCenter: visibleControlCenter,
      release: { ...CURRENT_RELEASE, history: RELEASE_HISTORY },
      betaSupport,
    });
    return true;
  }

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
    controlCenter: visibleControlCenter,
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
    betaSupport,
    drafts: state.listDrafts(),
    todos,
    activities: await activitiesWithContactNames(),
    knowledgeTrackingRequests: state.listKnowledgeTrackingRequests()
      .filter((request) => isKnownIntelligenceChat(request.chatId, request.contactName)),
    settings: { ...state.getSettings(), apiKeyConfigured: ai.isConfigured() },
  });
  return true;
}
