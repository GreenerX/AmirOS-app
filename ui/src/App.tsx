import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  addContactMemory,
  analyzeContactIntelligence,
  askIntelligence,
  approveDraft,
  demoMode,
  dismissDraft,
  getChats,
  getDashboard,
  getIntelligence,
  getMessages,
  markChatRead,
  getTerminalLog,
  subscribeTerminalLog,
  generateContactProfile,
  generateGroupSummary,
  generateWritingStyle,
  relinkWhatsApp,
  removeContactMemory,
  sendMessage,
  setPaused,
  setPreset,
  updateContact,
  updateContactCommitment,
  updateTodoTask,
  updateProactiveIntelligence,
  updateContactInsight,
  updateCalendarEvent,
  regenerateCalendarTitle,
  updateSettings,
  deleteIntelligenceQuestion,
  forwardMessage,
  reactToMessage,
  replyToMessage,
  scanChatHistory,
  sendMedia,
  generateImageForChat,
  saveOpenAiApiKey,
  getUpdateStatus,
  startAmirosUpdate,
} from "./api";
import { InboxView } from "./components/InboxView";
import { IntelligenceView } from "./components/IntelligenceView";
import { Overview } from "./components/Overview";
import type { NextBestAction } from "./components/Overview";
import { Sidebar } from "./components/Sidebar";
import { TerminalView } from "./components/TerminalView";
import { CalendarView } from "./components/CalendarView";
import { FloatingAssistant } from "./components/FloatingAssistant";
import { ReleaseExperience } from "./components/ReleaseExperience";
import { UpdatePrompt } from "./components/UpdatePrompt";
import {
  AutomationsView,
  ContactsView,
  SettingsView,
  UsageView,
} from "./components/SecondaryViews";
import {
  contactForSelectedChat,
  historyForSelectedChat,
} from "./chat-history";
import type {
  ChatMessage,
  ChatMemoryEntry,
  ChatSummary,
  ContactMemoryItem,
  ContactInsight,
  ContactPreferences,
  ContactProfile,
  GroupConversationSummary,
  DashboardData,
  Draft,
  ModelPreset,
  IntelligenceData,
  IntelligenceSearchResult,
  TodoTask,
  ReplyMode,
  KnowledgeTrackingDefault,
  KnowledgeTrackingStatus,
  ThemeName,
  AmirOSUpdateStatus,
  ViewName,
  WritingStyleProfile,
} from "./types";
import { useTimeFormat } from "./TimeFormatProvider";

const presetModels: Record<ModelPreset, DashboardData["models"]> = {
  economy: {
    text: "gpt-5.6-luna",
    image: "gpt-image-1-mini",
    voice: "gpt-4o-mini-transcribe",
  },
  balanced: {
    text: "gpt-5.6-terra",
    image: "gpt-image-2",
    voice: "gpt-4o-transcribe",
  },
  quality: {
    text: "gpt-5.6-sol",
    image: "gpt-image-2",
    voice: "gpt-4o-transcribe",
  },
};

async function mediaPayload(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Could not read media"));
    reader.readAsDataURL(file);
  });
}

function preserveLocalMessageState(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const localById = new Map(current.map((message) => [message.id, message]));
  return incoming.map((message) => {
    const local = localById.get(message.id);
    const localReactionIsNowSynced = Boolean(
      local?.localReaction && message.reactions?.some((reaction) =>
        reaction.emoji === local.localReaction && reaction.hasReactionByMe,
      ),
    );
    return local?.localReaction && !localReactionIsNowSynced
      ? { ...message, localReaction: local.localReaction }
      : message;
  });
}

export function App() {
  const { timeFormat, setTimeFormat } = useTimeFormat();
  const [view, setView] = useState<ViewName>("overview");
  const [dashboard, setDashboard] = useState<DashboardData>();
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [memory, setMemory] = useState<ChatMemoryEntry[]>([]);
  const [manualMemory, setManualMemory] = useState<ContactMemoryItem[]>([]);
  const [profile, setProfile] = useState<ContactProfile>();
  const [insights, setInsights] = useState<ContactInsight[]>([]);
  const [styleProfile, setStyleProfile] = useState<WritingStyleProfile>();
  const [groupSummary, setGroupSummary] = useState<GroupConversationSummary>();
  const [groupDescription, setGroupDescription] = useState<string>();
  const [assistantComposerDraft, setAssistantComposerDraft] = useState<{ chatId: string; body: string }>();
  const [intelligence, setIntelligence] = useState<IntelligenceData>();
  const [loadingIntelligence, setLoadingIntelligence] = useState(false);
  const [incomingMessageCount, setIncomingMessageCount] = useState(0);
  const [contact, setContact] = useState<ContactPreferences>();
  const [loadedChatId, setLoadedChatId] = useState<string>();
  const [loadingChat, setLoadingChat] = useState(false);
  const [error, setError] = useState<string>();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("amiros-sidebar") === "collapsed");
  const [inboxInitialFilter, setInboxInitialFilter] = useState<"all" | "unread">("all");
  const [inboxContactSettingsTab, setInboxContactSettingsTab] = useState<"configure" | "knowledge">("configure");
  const [highlightedMessageId, setHighlightedMessageId] = useState<string>();
  const [intelligenceNavigationRequest, setIntelligenceNavigationRequest] = useState<{
    id: number;
    tab: "briefing";
    queueFilter: "todo";
  }>();
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const hydratedTimeFormat = useRef(false);
  useEffect(() => {
    const savedTimeFormat = dashboard?.settings.assistant.timeFormat;
    if (!hydratedTimeFormat.current && savedTimeFormat) {
      hydratedTimeFormat.current = true;
      if (savedTimeFormat !== timeFormat) setTimeFormat(savedTimeFormat);
    }
  }, [dashboard?.settings.assistant.timeFormat, setTimeFormat, timeFormat]);
  const [updateStatus, setUpdateStatus] = useState<AmirOSUpdateStatus>();
  const mutationVersion = useRef(0);

  const refresh = useCallback(async () => {
    const versionAtStart = mutationVersion.current;
    try {
      const nextDashboard = await getDashboard();
      if (versionAtStart === mutationVersion.current) setDashboard(nextDashboard);
      try {
        const nextChats = await getChats();
        setChats(nextChats);
        setSelectedChatId((current) => current || nextChats[0]?.id);
        setError(undefined);
      } catch (chatError) {
        setError(
          chatError instanceof Error
            ? `Dashboard connected; WhatsApp chats are still syncing (${chatError.message}).`
            : "Dashboard connected; WhatsApp chats are still syncing.",
        );
      }
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Could not connect to AmirOS");
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (demoMode) return;
    const interval = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const refreshUpdateStatus = useCallback(async (force = false) => {
    try {
      setUpdateStatus(await getUpdateStatus(force));
    } catch {
      // Update checks should never interrupt someone using their local dashboard.
    }
  }, []);

  useEffect(() => {
    void refreshUpdateStatus();
    if (demoMode) return;
    const interval = window.setInterval(() => void refreshUpdateStatus(), 15 * 60_000);
    return () => window.clearInterval(interval);
  }, [refreshUpdateStatus]);

  useEffect(() => {
    document.documentElement.dataset.theme = dashboard?.settings.theme || "forest";
  }, [dashboard?.settings.theme]);

  useEffect(() => {
    if (!selectedChatId || view !== "inbox") return;
    let cancelled = false;
    setLoadingChat(true);
    setLoadedChatId(undefined);
    setMessages([]);
    setMemory([]);
    setManualMemory([]);
    setProfile(undefined);
    setInsights([]);
    setStyleProfile(undefined);
    setGroupSummary(undefined);
    setGroupDescription(undefined);
    setIncomingMessageCount(0);
    setContact(undefined);
    void getMessages(selectedChatId)
      .then((result) => {
        if (cancelled) return;
        if (result.chatId !== selectedChatId) {
          throw new Error("WhatsApp returned history for a different conversation");
        }
        setMessages((current) => preserveLocalMessageState(current, result.messages));
        setMemory(result.memory);
        setManualMemory(result.manualMemory);
        setProfile(result.profile);
        setInsights(result.insights);
        setStyleProfile(result.styleProfile);
        setGroupSummary(result.groupSummary);
        setGroupDescription(result.groupDescription);
        setIncomingMessageCount(result.incomingMessageCount);
        setContact(result.contact);
        setLoadedChatId(result.chatId);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load conversation");
      })
      .finally(() => {
        if (!cancelled) setLoadingChat(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedChatId, view]);

  useEffect(() => {
    if (demoMode || !selectedChatId || view !== "inbox") return;
    let cancelled = false;
    let inFlight = false;
    const pollConversation = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const result = await getMessages(selectedChatId);
        if (cancelled || result.chatId !== selectedChatId) return;
        setMessages((current) => preserveLocalMessageState(current, result.messages));
        setMemory(result.memory);
        setManualMemory(result.manualMemory);
        setProfile(result.profile);
        setInsights(result.insights);
        setStyleProfile(result.styleProfile);
        setGroupSummary(result.groupSummary);
        setGroupDescription(result.groupDescription);
        setIncomingMessageCount(result.incomingMessageCount);
        setContact(result.contact);
        setLoadedChatId(result.chatId);
      } catch {
        // Keep the visible conversation stable during a transient WhatsApp sync gap.
      } finally {
        inFlight = false;
      }
    };
    const interval = window.setInterval(() => void pollConversation(), 2_000);
    const onVisibility = () => { if (document.visibilityState === "visible") void pollConversation(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [selectedChatId, view]);

  const refreshIntelligence = useCallback(async () => {
    setLoadingIntelligence(true);
    try {
      setIntelligence(await getIntelligence());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load Relationship Radar");
    } finally {
      setLoadingIntelligence(false);
    }
  }, []);

  useEffect(() => {
    if (view !== "overview" && view !== "intelligence" && view !== "calendar") return;
    void refreshIntelligence();
    if (demoMode) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshIntelligence();
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [view, refreshIntelligence]);

  const navigate = (nextView: ViewName) => {
    if (nextView === "inbox") { setInboxInitialFilter("all"); setInboxContactSettingsTab("configure"); setHighlightedMessageId(undefined); }
    if (nextView === "intelligence") setIntelligenceNavigationRequest(undefined);
    if (nextView === "inbox" && window.matchMedia("(max-width: 720px)").matches) {
      setSelectedChatId(undefined);
    }
    setView(nextView);
  };
  const openUnreadInbox = () => {
    setInboxInitialFilter("unread");
    if (window.matchMedia("(max-width: 720px)").matches) setSelectedChatId(undefined);
    setView("inbox");
  };
  const openTodoReview = () => {
    setIntelligenceNavigationRequest({ id: Date.now(), tab: "briefing", queueFilter: "todo" });
    setView("intelligence");
  };
  const openChat = (chatId: string, messageId?: string) => {
    setSelectedChatId(chatId);
    setInboxContactSettingsTab("configure");
    setHighlightedMessageId(messageId);
    setView("inbox");
  };
  const selectInboxChat = (chatId: string | undefined) => {
    setHighlightedMessageId(undefined);
    setSelectedChatId(chatId);
  };

  const visibleMessages = historyForSelectedChat(
    selectedChatId,
    loadedChatId,
    messages,
  );
  const visibleContact = contactForSelectedChat(
    selectedChatId,
    loadedChatId,
    contact,
  );
  const visibleMemory = selectedChatId === loadedChatId ? memory : [];
  const visibleManualMemory = selectedChatId === loadedChatId ? manualMemory : [];
  const visibleProfile = selectedChatId === loadedChatId ? profile : undefined;

  const changeMode = async (chatId: string, mode: ReplyMode) => {
    try {
      const updated = await updateContact(chatId, { mode });
      setContact((current) => (chatId === selectedChatId ? { ...(current || updated), ...updated } : current));
      setChats((current) => current.map((chat) => (chat.id === chatId ? { ...chat, mode } : chat)));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not change reply mode");
    }
  };

  const changeContact = async (
    chatId: string,
    patch: Partial<ContactPreferences>,
  ): Promise<boolean> => {
    try {
      const updated = await updateContact(chatId, patch);
      setDashboard((current) => current ? {
        ...current,
        settings: {
          ...current.settings,
          contacts: { ...current.settings.contacts, [chatId]: updated },
        },
      } : current);
      if (chatId === selectedChatId) setContact(updated);
      if (chatId === selectedChatId && patch.memoryEnabled === false) setMemory([]);
      if (chatId === selectedChatId && patch.memoryEnabled === false) {
        setManualMemory([]);
        setProfile(undefined);
        setInsights([]);
        setStyleProfile(undefined);
        setGroupSummary(undefined);
        setIncomingMessageCount(0);
      }
      return true;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not save contact settings");
      return false;
    }
  };

  const decideKnowledgeTracking = async (chatId: string, status: KnowledgeTrackingStatus) => {
    const saved = await changeContact(chatId, { knowledgeTracking: status });
    if (saved) await refresh();
  };

  const addMemory = async (chatId: string, content: string) => {
    try {
      const updated = await addContactMemory(chatId, content);
      if (chatId === selectedChatId) setManualMemory(updated);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not add contact memory");
      throw actionError;
    }
  };

  const removeMemory = async (chatId: string, itemId: string) => {
    try {
      const updated = await removeContactMemory(chatId, itemId);
      if (chatId === selectedChatId) setManualMemory(updated);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not remove contact memory");
    }
  };

  const generateProfile = async (chatId: string) => {
    try {
      const result = await generateContactProfile(chatId);
      if (chatId === selectedChatId) {
        setProfile(result.profile);
        setIncomingMessageCount(result.incomingMessageCount);
      }
      await refreshIntelligence();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not generate contact profile");
      throw actionError;
    }
  };

  const analyzeIntelligence = async (chatId: string) => {
    try {
      const result = await analyzeContactIntelligence(chatId);
      if (chatId === selectedChatId) {
        setInsights(result.insights);
      }
      await refreshIntelligence();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not analyze this relationship");
      throw actionError;
    }
  };

  const changeInsight = async (
    chatId: string,
    insightId: string,
    patch: { status?: ContactInsight["status"]; content?: string },
  ) => {
    const updated = await updateContactInsight(chatId, insightId, patch);
    if (chatId === selectedChatId) setInsights(updated);
    await refreshIntelligence();
  };

  const changeCommitmentStatus = async (chatId: string, commitmentId: string, status: "dismissed") => {
    await updateContactCommitment(chatId, commitmentId, status);
    await refreshIntelligence();
  };

  const changeTodoTask = async (
    chatId: string,
    todoId: string,
    patch: { status?: TodoTask["status"]; title?: string; dueAt?: number | null; priority?: TodoTask["priority"] },
  ) => {
    await updateTodoTask(chatId, todoId, patch);
    await Promise.all([refreshIntelligence(), refresh()]);
  };
  const changeTodoStatus = (chatId: string, todoId: string, status: TodoTask["status"]) => changeTodoTask(chatId, todoId, { status });

  const learnWritingStyle = async (chatId: string) => {
    try {
      const result = await generateWritingStyle(chatId);
      if (chatId === selectedChatId) setStyleProfile(result);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not learn your writing style");
      throw actionError;
    }
  };

  const summarizeSelectedGroup = async (chatId: string) => {
    try {
      const result = await generateGroupSummary(chatId);
      if (chatId === selectedChatId) setGroupSummary(result);
      await refreshIntelligence();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not summarize this group");
      throw actionError;
    }
  };

  const askRelationships = async (
    query: string,
    options?: {
      followUp?: { question: string; answer: string; sourceRefs?: Array<{ id: string; chatId: string; kind: "insight" }> };
      scope?: { knowledge: boolean; calendar: boolean };
      signal?: AbortSignal;
    },
  ): Promise<IntelligenceSearchResult> => {
    const result = await askIntelligence(query, options);
    await refreshIntelligence();
    return result;
  };

  const readChat = async (chatId: string) => {
    try {
      await markChatRead(chatId);
      setChats((current) => current.map((chat) => chat.id === chatId ? { ...chat, unreadCount: 0 } : chat));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not mark chat as read");
    }
  };

  const changeCalendarStatus = async (
    chatId: string,
    eventId: string,
    patch: { status?: "inferred" | "confirmed" | "completed" | "dismissed"; title?: string; startAt?: number; endAt?: number; allDay?: boolean; location?: string },
  ) => {
    await updateCalendarEvent(chatId, eventId, patch);
    await refreshIntelligence();
  };

  const dismissNextBestAction = async (action: NextBestAction) => {
    try {
      if (action.actionType === "calendar") {
        await changeCalendarStatus(action.chatId, action.actionId, { status: "dismissed" });
      } else if (action.actionType === "todo") {
        await changeTodoTask(action.chatId, action.actionId, { status: "dismissed" });
      } else if (action.actionType === "insight") {
        await changeInsight(action.chatId, action.actionId, { status: "outdated" });
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not dismiss this action");
      throw actionError;
    }
  };

  const decideProactiveIntelligence = async (
    item: NonNullable<IntelligenceData["proactive"]>[number],
    status: "opened" | "dismissed" | "resolved",
  ) => {
    await updateProactiveIntelligence(item, status);
    if (status !== "opened") await refreshIntelligence();
  };

  const regenerateEventTitle = async (chatId: string, eventId: string) => {
    const title = await regenerateCalendarTitle(chatId, eventId);
    await refreshIntelligence();
    return title;
  };

  const togglePaused = async () => {
    if (!dashboard) return;
    const paused = !dashboard.paused;
    mutationVersion.current += 1;
    await setPaused(paused);
    setDashboard({ ...dashboard, paused });
  };

  const choosePreset = async (preset: ModelPreset) => {
    if (!dashboard) return;
    try {
      mutationVersion.current += 1;
      await setPreset(preset);
      setDashboard((current) =>
        current ? { ...current, preset, models: presetModels[preset] } : current,
      );
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not change model preset");
    }
  };

  const approve = async (draft: Draft, body: string) => {
    await approveDraft(draft.id, body);
    setDashboard((current) =>
      current
        ? { ...current, drafts: current.drafts.filter((item) => item.id !== draft.id) }
        : current,
    );
    if (demoMode) {
      setMessages((current) => [
        ...current,
        {
          id: `sent-${Date.now()}`,
          body,
          fullBody: body,
          fromMe: true,
          timestamp: Math.floor(Date.now() / 1_000),
          type: "chat",
          hasMedia: false,
        },
      ]);
    }
  };

  const dismiss = async (draft: Draft) => {
    await dismissDraft(draft.id);
    setDashboard((current) =>
      current
        ? { ...current, drafts: current.drafts.filter((item) => item.id !== draft.id) }
        : current,
    );
  };

  const send = async (chatId: string, body: string) => {
    await sendMessage(chatId, body);
    setMessages((current) => [
      ...current,
      {
        id: `sent-${Date.now()}`,
        body,
        fullBody: body,
        fromMe: true,
        timestamp: Math.floor(Date.now() / 1_000),
        type: "chat",
        hasMedia: false,
      },
    ]);
  };

  const sendChatMedia = async (chatId: string, file: File, caption: string, voiceNote = false) => {
    const data = await mediaPayload(file);
    const mimetype = file.type || "application/octet-stream";
    const sent = await sendMedia(chatId, {
      data,
      mimetype,
      filename: file.name || "attachment",
      caption,
      voiceNote,
    });
    setMessages((current) => [...current, {
      ...sent,
      body: caption || sent.body || file.name,
      fullBody: caption || sent.fullBody || "",
      mediaUrl: sent.mediaUrl || `data:${mimetype};base64,${data}`,
    }]);
  };

  const generateChatImage = async (chatId: string, prompt: string) => {
    try {
      const generated = await generateImageForChat(chatId, prompt);
      setMessages((current) => [...current, generated]);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not generate this image");
      throw actionError;
    }
  };

  const react = async (chatId: string, messageId: string, emoji: string) => {
    try {
      await reactToMessage(chatId, messageId, emoji);
      setMessages((current) => current.map((message) => message.id === messageId ? { ...message, localReaction: emoji } : message));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not send this reaction");
      throw actionError;
    }
  };

  const reply = async (chatId: string, messageId: string, body: string) => {
    try {
      const sent = await replyToMessage(chatId, messageId, body);
      setMessages((current) => {
        const quoted = current.find((message) => message.id === messageId);
        return [...current, quoted ? {
          ...sent,
          quotedMessage: {
            id: quoted.id,
            body: quoted.fullBody || quoted.body,
            fromMe: quoted.fromMe,
            senderId: quoted.senderId,
            senderName: quoted.senderName,
          },
        } : sent];
      });
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not send this reply");
      throw actionError;
    }
  };

  const forward = async (chatId: string, messageId: string, targetChatId: string) => {
    await forwardMessage(chatId, messageId, targetChatId);
  };

  const scanHistory = async (chatId: string) => {
    const result = await scanChatHistory(chatId);
    if (chatId === selectedChatId) {
      setMessages((current) => preserveLocalMessageState(current, result.messages));
      setMemory(result.memory);
      setIncomingMessageCount(result.incomingMessageCount);
    }
    return { scanned: result.scanned, added: result.added };
  };

  const deleteQuestion = async (id: string) => {
    await deleteIntelligenceQuestion(id);
    await refreshIntelligence();
  };

  const saveQuietHours = async (quietHours: DashboardData["settings"]["quietHours"]) => {
    if (!dashboard) return;
    mutationVersion.current += 1;
    const settings = await updateSettings({ quietHours });
    setDashboard((current) => current ? { ...current, settings } : current);
  };

  const saveSettings = async (patch: {
    monthlyBudgetUsd?: number;
    assistant?: Partial<DashboardData["settings"]["assistant"]>;
    theme?: ThemeName;
    models?: DashboardData["models"];
    ownerProfile?: Partial<DashboardData["settings"]["ownerProfile"]>;
    knowledgeTrackingDefault?: KnowledgeTrackingDefault;
  }) => {
    if (!dashboard) return;
    try {
      mutationVersion.current += 1;
      const settings = await updateSettings(patch);
      setDashboard((current) => current ? { ...current, settings, models: patch.models || current.models } : current);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not save settings");
      throw actionError;
    }
  };

  const saveApiKey = async (apiKey: string) => {
    const result = await saveOpenAiApiKey(apiKey);
    setDashboard((current) => current
      ? { ...current, settings: { ...current.settings, apiKeyConfigured: result.apiKeyConfigured } }
      : current);
  };

  const relink = async () => {
    try {
      mutationVersion.current += 1;
      const connection = await relinkWhatsApp();
      setDashboard((current) => current ? { ...current, connection } : current);
      return connection;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not regenerate the WhatsApp QR code");
      throw actionError;
    }
  };

  const startDashboardUpdate = async () => {
    await startAmirosUpdate();
  };

  if (!dashboard) {
    return (
      <div className="launch-state">
        <img src="/amiros-mark-v2-cropped.png" alt="AmirOS" />
        <h1>AmirOS</h1>
        <p>{error || "Connecting to your private assistant…"}</p>
        {error ? <button className="button primary" onClick={() => void refresh()}>Try again</button> : <span className="loading-spinner" />}
      </div>
    );
  }

  const unreadCount = chats.reduce((total, chat) => total + Math.max(0, chat.unreadCount), 0);

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`} data-time-format={timeFormat}>
      <Sidebar current={view} onNavigate={navigate} unreadCount={unreadCount} collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed((value) => { localStorage.setItem("amiros-sidebar", value ? "expanded" : "collapsed"); return !value; })} profile={dashboard.settings.ownerProfile} version={dashboard.release.version} updateAvailable={updateStatus?.status === "available"} connection={dashboard.connection} onOpenReleaseNotes={() => setReleaseNotesOpen(true)} />
      <div className="app-body">
        {error ? <div className="error-banner"><AlertTriangle size={17} />{error}<button onClick={() => setError(undefined)}>Dismiss</button></div> : null}
{view === "overview" ? <Overview data={dashboard} chats={chats} intelligence={intelligence} onNavigate={navigate} onTrackingDecision={decideKnowledgeTracking} onOpenTrackingChat={(chatId) => openChat(chatId)} onOpenNextBestAction={openChat} onOpenTodoReview={openTodoReview} onTodoStatus={changeTodoStatus} onTodoUpdate={changeTodoTask} onCalendarStatus={changeCalendarStatus} onInsightStatus={(chatId, insightId, status) => changeInsight(chatId, insightId, { status })} onDismissNextBestAction={dismissNextBestAction} onProactiveDecision={decideProactiveIntelligence} /> : null}
        {view === "intelligence" ? <IntelligenceView data={intelligence} chats={chats} contacts={dashboard.settings.contacts} ownerName={dashboard.settings.ownerProfile.displayName} loading={loadingIntelligence} onRefresh={refreshIntelligence} onOpenChat={openChat} onOpenCalendar={() => setView("calendar")} onContactChange={changeContact} onGenerateSummary={(chatId, isGroup) => isGroup ? summarizeSelectedGroup(chatId) : generateProfile(chatId)} onCalendarStatus={changeCalendarStatus} onRegenerateCalendarTitle={regenerateEventTitle} onInsightStatus={(chatId, insightId, status) => changeInsight(chatId, insightId, { status })} onCommitmentStatus={changeCommitmentStatus} onTodoStatus={changeTodoStatus} onTodoUpdate={changeTodoTask} onDeleteQuestion={deleteQuestion} navigationRequest={intelligenceNavigationRequest} /> : null}
        {view === "calendar" ? <CalendarView data={intelligence} onOpenChat={openChat} onStatus={changeCalendarStatus} onRegenerateTitle={regenerateEventTitle} /> : null}
        {view === "inbox" ? <InboxView chats={chats} unreadCount={unreadCount} initialFilter={inboxInitialFilter} initialContactSettingsTab={inboxContactSettingsTab} selectedChatId={selectedChatId} highlightedMessageId={highlightedMessageId} messages={visibleMessages} memory={visibleMemory} manualMemory={visibleManualMemory} profile={visibleProfile} insights={insights} styleProfile={styleProfile} groupSummary={groupSummary} groupDescription={groupDescription} composerDraft={assistantComposerDraft?.chatId === selectedChatId ? assistantComposerDraft?.body : undefined} onComposerDraftConsumed={() => setAssistantComposerDraft(undefined)} incomingMessageCount={incomingMessageCount} contact={visibleContact} drafts={dashboard.drafts} loading={loadingChat} onSelectChat={selectInboxChat} onMarkRead={readChat} onModeChange={changeMode} onContactChange={changeContact} onAddMemory={addMemory} onRemoveMemory={removeMemory} onGenerateProfile={generateProfile} onAnalyzeIntelligence={analyzeIntelligence} onInsightChange={changeInsight} onGenerateWritingStyle={learnWritingStyle} onGenerateGroupSummary={summarizeSelectedGroup} onApproveDraft={approve} onDismissDraft={dismiss} onSend={send} onSendMedia={sendChatMedia} onGenerateImage={generateChatImage} onReact={react} onReply={reply} onForward={forward} onScanHistory={scanHistory} /> : null}
        {view === "contacts" ? <ContactsView chats={chats} onModeChange={changeMode} onOpenChat={openChat} /> : null}
        {view === "automations" ? <AutomationsView data={dashboard} onSave={saveQuietHours} /> : null}
        {view === "usage" ? <UsageView data={dashboard} onPreset={choosePreset} /> : null}
        {view === "terminal" ? <TerminalView connection={dashboard.connection} loadLog={getTerminalLog} subscribeLog={subscribeTerminalLog} /> : null}
        {view === "settings" ? <SettingsView data={dashboard} onSave={saveSettings} onSaveApiKey={saveApiKey} onRelink={async () => { await relink(); }} onPause={togglePaused} /> : null}
        <FloatingAssistant data={intelligence} loading={loadingIntelligence} onRefresh={refreshIntelligence} onAsk={askRelationships} onOpenChat={openChat} onOpenCalendar={() => navigate("calendar")} onSaveKnowledge={addMemory} onInsertReply={(chatId, body) => { setAssistantComposerDraft({ chatId, body }); openChat(chatId); }} />
        <ReleaseExperience release={dashboard.release} knowledgeTrackingDefault={dashboard.settings.knowledgeTrackingDefault} theme={dashboard.settings.theme} ownerProfile={dashboard.settings.ownerProfile} apiKeyConfigured={dashboard.settings.apiKeyConfigured} connection={dashboard.connection} onSaveApiKey={saveApiKey} onRelinkWhatsApp={relink} onFinishOnboarding={async (choice, theme) => saveSettings({ knowledgeTrackingDefault: choice, theme })} onSaveOwnerProfile={async (ownerProfile) => saveSettings({ ownerProfile })} update={updateStatus} onStartUpdate={startDashboardUpdate} forceReleaseOpen={releaseNotesOpen} onReleaseNotesClosed={() => setReleaseNotesOpen(false)} />
        <UpdatePrompt update={updateStatus} onStartUpdate={startDashboardUpdate} />
      </div>
    </div>
  );
}
