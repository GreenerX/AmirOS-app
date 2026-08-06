import {
  Brain,
  Bot,
  Check,
  Clock3,
  Cloud,
  Coins,
  Copy,
  Eye,
  EyeOff,
  Globe2,
  Image as ImageIcon,
  KeyRound,
  LockKeyhole,
  MessageSquareText,
  Mic,
  PencilLine,
  Palette,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Search,
  Trash2,
  Upload,
  UserRound,
  UsersRound,
} from "lucide-react";
import { SiApple } from "react-icons/si";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { compactNumber } from "../format";
import { deleteOwnerAvatar, getBackendRestartStatus, getCalendarSubscription, getOwnerAvatars, restartAmirosBackend, uploadOwnerAvatar, whatsappQrUrl, type BackendRestartStatus, type CalendarSubscriptionInfo, type OwnerAvatar } from "../api";
import { calendarSubscriptionBannerHidden, setCalendarSubscriptionBannerHidden } from "../calendar-preferences";
import { WhatsAppIcon } from "./BrandIcons";
import { ContactAvatar } from "./ContactAvatar";
import type {
  ChatSummary,
  DashboardData,
  ModelPreset,
  KnowledgeTrackingDefault,
  ReplyMode,
  ThemeName,
} from "../types";

type ContactsViewProps = {
  chats: ChatSummary[];
  onModeChange: (chatId: string, mode: ReplyMode) => Promise<void>;
  onOpenChat: (chatId: string) => void;
};

export function ContactsView({ chats, onModeChange, onOpenChat }: ContactsViewProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "people" | "groups" | "assisted">("all");
  const visibleChats = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return chats.filter((chat) => {
      const matchesQuery = !needle || `${chat.name} ${chat.preview}`.toLocaleLowerCase().includes(needle);
      const matchesFilter = filter === "all" || (filter === "people" && !chat.isGroup) || (filter === "groups" && chat.isGroup) || (filter === "assisted" && chat.mode !== "off");
      return matchesQuery && matchesFilter;
    });
  }, [chats, filter, query]);
  const assistedCount = chats.filter((chat) => chat.mode !== "off").length;
  const groupCount = chats.filter((chat) => chat.isGroup).length;
  return (
    <main className="main-content secondary-page">
      <header className="page-header compact-header"><div><h1>Contacts</h1><p>Choose how AmirOS helps in every conversation.</p></div><label className="search-box contacts-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search contacts" /></label></header>
      <section className="contacts-overview-bar" aria-label="Contact overview">
        <span><UserRound size={18} /><strong>{chats.length}</strong><small>relationships</small></span>
        <span><MessageSquareText size={18} /><strong>{groupCount}</strong><small>groups</small></span>
        <span><Bot size={18} /><strong>{assistedCount}</strong><small>AI assisted</small></span>
        <div className="contacts-filter-tabs" role="tablist" aria-label="Contact filters">{(["all", "people", "groups", "assisted"] as const).map((item) => <button role="tab" aria-selected={filter === item} className={filter === item ? "active" : ""} key={item} onClick={() => setFilter(item)}>{item === "assisted" ? "AI assisted" : item}</button>)}</div>
      </section>
      <section className="panel contacts-table">
        <div className="contacts-table-heading"><span><strong>{filter === "all" ? "All contacts" : filter === "people" ? "People" : filter === "groups" ? "Groups" : "AI assisted"}</strong><small>{visibleChats.length} shown</small></span><small>Open a contact to configure tone, memory, and instructions.</small></div>
        <div className="table-head"><span>Contact</span><span>Last message</span><span>Reply mode</span><span /></div>
        {visibleChats.map((chat, index) => (
          <div className="contact-table-row" key={chat.id}>
            <span className="contact-identity"><ContactAvatar name={chat.name} src={chat.avatarUrl} tone={index} /><span><strong>{chat.name}</strong><small className="contact-channel">{chat.isGroup ? <UsersRound size={13} /> : <WhatsAppIcon size={13} />}{chat.isGroup ? "Group" : "WhatsApp contact"}</small></span></span>
            <span className="table-preview">{chat.preview}</span>
            <select aria-label={`Reply mode for ${chat.name}`} value={chat.mode} onChange={(event) => onModeChange(chat.id, event.target.value as ReplyMode)}>
              <option value="off">Off</option><option value="suggest">Suggest</option><option value="auto">Auto</option>
            </select>
            <button className="text-button" onClick={() => onOpenChat(chat.id)}>Open</button>
          </div>
        ))}
        {visibleChats.length === 0 ? <div className="conversation-empty">No contacts match “{query}”.</div> : null}
      </section>
    </main>
  );
}

type AutomationsViewProps = {
  data: DashboardData;
  onSave: (quietHours: DashboardData["settings"]["quietHours"]) => Promise<void>;
};

export function AutomationsView({ data, onSave }: AutomationsViewProps) {
  const quiet = data.settings.quietHours;
  return (
    <main className="main-content secondary-page">
      <header className="page-header compact-header"><div><h1>Automations</h1><p>Set calm boundaries for automatic replies.</p></div><button className="button primary" onClick={() => onSave(quiet)}>Save changes</button></header>
      <section className="automation-status-bar"><span className={quiet.enabled ? "active" : "inactive"}><Clock3 size={19} /><span><small>Quiet hours</small><strong>{quiet.enabled ? "Active schedule" : "Not enabled"}</strong></span></span><span><small>Window</small><strong>{quiet.start}–{quiet.end}</strong></span><span><small>Triggers</small><strong>Always available</strong></span><span><small>Applies to</small><strong>Auto + Suggest</strong></span></section>
      <div className="settings-grid">
        <section className="panel large-setting-panel">
          <span className="setting-hero-icon"><Clock3 size={25} /></span>
          <div><h2>Quiet hours</h2><p>Outside this schedule, automatic and suggested replies resume normally. Explicit trigger commands still work.</p></div>
          <label className="switch-row"><span><strong>Use quiet hours</strong><small>Pause proactive AI assistance overnight</small></span><input type="checkbox" checked={quiet.enabled} onChange={(event) => onSave({ ...quiet, enabled: event.target.checked })} /></label>
          <div className="time-fields"><label>Starts<input type="time" value={quiet.start} onChange={(event) => onSave({ ...quiet, start: event.target.value })} /></label><span>to</span><label>Ends<input type="time" value={quiet.end} onChange={(event) => onSave({ ...quiet, end: event.target.value })} /></label></div>
        </section>
        <section className="panel rule-explainer">
          <h2>How modes behave</h2>
          <div><span className="mode-icon auto"><Bot size={17} /></span><span><strong>Auto</strong><small>Replies to ordinary incoming messages when quiet hours allow.</small></span></div>
          <div><span className="mode-icon suggest"><PencilLine size={17} /></span><span><strong>Suggest</strong><small>Creates a private draft for your approval.</small></span></div>
          <div><span className="mode-icon off"><LockKeyhole size={17} /></span><span><strong>Off</strong><small>Does nothing automatically; explicit trigger commands remain available.</small></span></div>
        </section>
      </div>
    </main>
  );
}

type UsageViewProps = {
  data: DashboardData;
  onPreset: (preset: ModelPreset) => Promise<void>;
};

const presetDetails: Record<ModelPreset, { title: string; description: string }> = {
  economy: { title: "Economy", description: "Lowest-cost text, images, and voice." },
  balanced: { title: "Balanced", description: "Stronger answers at moderate cost." },
  quality: { title: "Quality", description: "Highest quality for important work." },
};

export function UsageView({ data, onPreset }: UsageViewProps) {
  const totalTokens = data.usage.inputTokens + data.usage.outputTokens;
  const formatCost = (cost: number) => `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}`;
  const budget = Math.max(0.01, data.settings.monthlyBudgetUsd);
  const budgetPercent = Math.min(100, (data.usage.estimatedCostUsd / budget) * 100);
  return (
    <main className="main-content secondary-page">
      <header className="page-header compact-header"><div><h1>Usage</h1><p>Understand where your OpenAI usage comes from.</p></div></header>
      <section className="usage-budget-banner"><span><small>Monthly cost control</small><strong>{formatCost(data.usage.estimatedCostUsd)} <em>of ${budget.toFixed(0)}</em></strong></span><div><span style={{ width: `${budgetPercent}%` }} /><small>{budgetPercent.toFixed(budgetPercent < 1 ? 2 : 0)}% used · {formatCost(Math.max(0, budget - data.usage.estimatedCostUsd))} remaining</small></div><b className={budgetPercent >= 80 ? "warning" : "healthy"}>{budgetPercent >= 80 ? "Review models" : "On track"}</b></section>
      <div className="usage-stat-grid">
        <section className="panel usage-stat"><Coins size={21} /><small>Estimated spend</small><strong>{formatCost(data.usage.estimatedCostUsd)}</strong><p>Current session, calculated with official OpenAI API rates.</p></section>
        <section className="panel usage-stat"><MessageSquareText size={21} /><small>Text requests</small><strong>{data.usage.textRequests}</strong><p>{compactNumber(totalTokens)} combined tokens</p></section>
        <section className="panel usage-stat"><Sparkles size={21} /><small>Creative requests</small><strong>{data.usage.imageRequests}</strong><p>Generated images</p></section>
        <section className="panel usage-stat"><Bot size={21} /><small>Voice + web</small><strong>{data.usage.transcriptionRequests + data.usage.webSearchCalls}</strong><p>{data.usage.transcriptionRequests} voice notes · {data.usage.webSearchCalls} searches</p></section>
      </div>
      <section className="panel cost-breakdown-panel">
        <div className="cost-breakdown-heading"><div><h2>Cost breakdown</h2><p>Measured when each request runs, so changing presets does not reprice earlier requests.</p></div><span className="rate-badge">Official rates · {data.usage.pricingUpdatedAt}</span></div>
        <div className="cost-breakdown-grid">
          <div><span className="cost-category-label"><i className="cost-category-icon text"><MessageSquareText size={16} /></i>Text</span><strong>{formatCost(data.usage.textCostUsd)}</strong><small>{compactNumber(data.usage.inputTokens)} in ({compactNumber(data.usage.cachedInputTokens)} cached) · {compactNumber(data.usage.outputTokens)} out</small></div>
          <div><span className="cost-category-label"><i className="cost-category-icon image"><ImageIcon size={16} /></i>Images</span><strong>{formatCost(data.usage.imageCostUsd)}</strong><small>{data.usage.imageRequests} generated</small></div>
          <div><span className="cost-category-label"><i className="cost-category-icon voice"><Mic size={16} /></i>Voice</span><strong>{formatCost(data.usage.transcriptionCostUsd)}</strong><small>{Math.round(data.usage.transcriptionSeconds / 60)} audio min</small></div>
          <div><span className="cost-category-label"><i className="cost-category-icon web"><Globe2 size={16} /></i>Web search</span><strong>{formatCost(data.usage.webSearchCostUsd)}</strong><small>{data.usage.webSearchCalls} calls</small></div>
        </div>
        <p className="pricing-note">Estimates use standard API pricing and exclude taxes or account-specific adjustments. Image totals use returned token usage when available, otherwise OpenAI’s published 1024×1024 per-image estimate. <a href={data.usage.pricingSourceUrl} target="_blank" rel="noreferrer">View OpenAI pricing ↗</a></p>
      </section>
      <section className="panel preset-panel">
        <div><h2>Model preset</h2><p>Switch models immediately without relinking WhatsApp.</p></div>
        <div className="preset-options">
          {(Object.keys(presetDetails) as ModelPreset[]).map((preset) => (
            <button key={preset} className={data.preset === preset ? "preset-option selected" : "preset-option"} onClick={() => onPreset(preset)}><span><strong>{presetDetails[preset].title}</strong><small>{presetDetails[preset].description}</small></span>{data.preset === preset ? <ShieldCheck size={19} /> : null}</button>
          ))}
        </div>
      </section>
    </main>
  );
}

type SettingsViewProps = {
  data: DashboardData;
  onRelink: () => Promise<void>;
  onPause: () => Promise<void>;
  onSaveApiKey: (apiKey: string) => Promise<void>;
  onSave: (patch: {
    monthlyBudgetUsd?: number;
    assistant?: Partial<DashboardData["settings"]["assistant"]>;
    theme?: ThemeName;
    models?: DashboardData["models"];
    ownerProfile?: Partial<DashboardData["settings"]["ownerProfile"]>;
    knowledgeTrackingDefault?: KnowledgeTrackingDefault;
  }) => Promise<void>;
};

const profileAvatars = [1, 2, 3, 4].map((number) => `/profile-avatars/avatar-0${number}.png?v=2`);

async function readProfileImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file");
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

async function cropProfileDataUrl(source: string, zoom: number, horizontalOffset: number, verticalOffset: number): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("Could not open image"));
    element.src = source;
  });
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare image");
  const baseScale = Math.max(512 / image.naturalWidth, 512 / image.naturalHeight);
  const scale = baseScale * zoom;
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const offsetScale = 512 / 220;
  const x = (512 - width) / 2 + horizontalOffset * offsetScale;
  const y = (512 - height) / 2 + verticalOffset * offsetScale;
  context.drawImage(image, x, y, width, height);
  return canvas.toDataURL("image/png", 0.9);
}

const themes: Array<{
  id: ThemeName;
  name: string;
  description: string;
  colors: [string, string, string];
}> = [
  { id: "forest", name: "Forest", description: "Calm, natural, and focused", colors: ["#197a52", "#edf7f1", "#ffffff"] },
  { id: "ocean", name: "Ocean", description: "Crisp blue with cool surfaces", colors: ["#256b8f", "#eef7fb", "#ffffff"] },
  { id: "plum", name: "Plum", description: "Rich violet with soft lilac", colors: ["#75558d", "#f6f0f8", "#ffffff"] },
  { id: "sand", name: "Sand", description: "Warm bronze and quiet stone", colors: ["#95652f", "#faf4ea", "#fffdfa"] },
  { id: "indigo", name: "Indigo", description: "Clear blue-violet and cloud", colors: ["#5364b6", "#f0f2fb", "#ffffff"] },
  { id: "rose", name: "Rose", description: "Soft berry with blush surfaces", colors: ["#a34d6f", "#fbf0f4", "#ffffff"] },
  { id: "graphite", name: "Graphite", description: "Neutral slate and cool mist", colors: ["#53606b", "#f0f3f5", "#ffffff"] },
];

export function SettingsView({ data, onSave, onSaveApiKey, onRelink, onPause }: SettingsViewProps) {
  const [budget, setBudget] = useState(data.settings.monthlyBudgetUsd);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyState, setApiKeyState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [apiKeyError, setApiKeyError] = useState("");
  const [selectedTheme, setSelectedTheme] = useState(data.settings.theme);
  const [models, setModels] = useState(data.models);
  const [knowledgeTrackingDefault, setKnowledgeTrackingDefault] = useState(data.settings.knowledgeTrackingDefault);
  const [ownerProfile, setOwnerProfile] = useState(data.settings.ownerProfile);
  const [uploadingProfile, setUploadingProfile] = useState(false);
  const [pendingProfileImage, setPendingProfileImage] = useState<string>();
  const [profileZoom, setProfileZoom] = useState(1);
  const [profileHorizontalOffset, setProfileHorizontalOffset] = useState(0);
  const [profileVerticalOffset, setProfileVerticalOffset] = useState(0);
  const [profileUploadError, setProfileUploadError] = useState("");
  const [customAvatars, setCustomAvatars] = useState<OwnerAvatar[]>([]);
  const profileFileRef = useRef<HTMLInputElement>(null);
  const cropDragRef = useRef<{ pointerId: number; x: number; y: number; horizontal: number; vertical: number } | undefined>(undefined);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [relinkState, setRelinkState] = useState<"idle" | "confirm" | "working">("idle");
  const [calendarSubscription, setCalendarSubscription] = useState<CalendarSubscriptionInfo>();
  const [calendarSubscriptionError, setCalendarSubscriptionError] = useState("");
  const [calendarSubscriptionCopied, setCalendarSubscriptionCopied] = useState(false);
  const [calendarBannerHidden, setCalendarBannerHidden] = useState(calendarSubscriptionBannerHidden);
  const [backendStatus, setBackendStatus] = useState<BackendRestartStatus["status"]>("running");
  const [backendRestartState, setBackendRestartState] = useState<"idle" | "restarting" | "success" | "error">("idle");
  const [backendRestartMessage, setBackendRestartMessage] = useState("");
  const backendRestartPollTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void getOwnerAvatars()
      .then((avatars) => { if (!cancelled) setCustomAvatars(avatars); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshStatus = () => {
      void getBackendRestartStatus()
        .then((status) => { if (!cancelled) setBackendStatus(status.status); })
        .catch(() => { if (!cancelled) setBackendStatus("offline"); });
    };
    refreshStatus();
    const timer = window.setInterval(refreshStatus, 8_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(backendRestartPollTimerRef.current);
    };
  }, []);

  const autoSavePayload = useMemo(() => ({
    monthlyBudgetUsd: budget,
    theme: selectedTheme,
    models,
    ownerProfile,
    knowledgeTrackingDefault,
  }), [budget, knowledgeTrackingDefault, models, ownerProfile, selectedTheme]);
  const serializedAutoSavePayload = useMemo(() => JSON.stringify(autoSavePayload), [autoSavePayload]);
  const lastSavedSettingsRef = useRef(serializedAutoSavePayload);
  const autoSaveTimerRef = useRef<number | undefined>(undefined);
  const saveNoticeTimerRef = useRef<number | undefined>(undefined);
  const saveSequenceRef = useRef(0);
  const saveInFlightRef = useRef(0);
  const pendingAutoSaveRef = useRef<{ payload: typeof autoSavePayload; serialized: string } | undefined>(undefined);
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    pendingAutoSaveRef.current = { payload: autoSavePayload, serialized: serializedAutoSavePayload };
    if (serializedAutoSavePayload === lastSavedSettingsRef.current && saveInFlightRef.current === 0) {
      setSaveState("idle");
      return;
    }

    window.clearTimeout(autoSaveTimerRef.current);
    window.clearTimeout(saveNoticeTimerRef.current);
    setSaveState("saving");
    const sequence = ++saveSequenceRef.current;
    autoSaveTimerRef.current = window.setTimeout(() => {
      saveInFlightRef.current += 1;
      void onSaveRef.current(autoSavePayload)
        .then(() => {
          if (sequence !== saveSequenceRef.current) return;
          lastSavedSettingsRef.current = serializedAutoSavePayload;
          setSaveState("saved");
          saveNoticeTimerRef.current = window.setTimeout(() => setSaveState("idle"), 2_400);
        })
        .catch(() => {
          if (sequence !== saveSequenceRef.current) return;
          setSaveState("error");
          saveNoticeTimerRef.current = window.setTimeout(() => setSaveState("idle"), 3_600);
        })
        .finally(() => {
          saveInFlightRef.current = Math.max(0, saveInFlightRef.current - 1);
        });
    }, 650);

    return () => window.clearTimeout(autoSaveTimerRef.current);
  }, [autoSavePayload, serializedAutoSavePayload]);

  useEffect(() => () => {
    window.clearTimeout(autoSaveTimerRef.current);
    window.clearTimeout(saveNoticeTimerRef.current);
    const pending = pendingAutoSaveRef.current;
    if (pending && pending.serialized !== lastSavedSettingsRef.current) {
      void onSaveRef.current(pending.payload);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getCalendarSubscription().then((result) => {
      if (!cancelled) setCalendarSubscription(result);
    }).catch((error) => {
      if (!cancelled) setCalendarSubscriptionError(error instanceof Error ? error.message : "Could not create the subscription link");
    });
    return () => { cancelled = true; };
  }, []);

  const saveApiKey = async () => {
    if (!apiKey.trim()) {
      setApiKeyError("Paste an OpenAI API key to connect it.");
      setApiKeyState("error");
      return;
    }
    setApiKeyState("saving");
    setApiKeyError("");
    try {
      await onSaveApiKey(apiKey);
      setApiKey("");
      setApiKeyState("saved");
      window.setTimeout(() => setApiKeyState("idle"), 2_000);
    } catch (error) {
      setApiKeyError(error instanceof Error ? error.message : "Could not save the API key.");
      setApiKeyState("error");
    }
  };

  const startRelink = async () => {
    setRelinkState("working");
    try {
      await onRelink();
      setRelinkState("idle");
    } catch {
      setRelinkState("confirm");
    }
  };

  const copyCalendarSubscription = async () => {
    if (!calendarSubscription) return;
    try {
      await navigator.clipboard.writeText(calendarSubscription.httpUrl);
      setCalendarSubscriptionError("");
      setCalendarSubscriptionCopied(true);
      window.setTimeout(() => setCalendarSubscriptionCopied(false), 1_800);
    } catch {
      setCalendarSubscriptionError("The browser could not copy the link.");
    }
  };

  const restartBackend = async () => {
    if (backendRestartState === "restarting") return;
    if (!window.confirm("Restart the local AmirOS backend now? The dashboard may disconnect briefly.")) return;
    setBackendRestartState("restarting");
    setBackendRestartMessage("Restarting… AmirOS will reconnect automatically.");
    setBackendStatus("restarting");
    try {
      await restartAmirosBackend();
      const deadline = Date.now() + 35_000;
      const pollForBackend = () => {
        void getBackendRestartStatus()
          .then((status) => {
            setBackendStatus(status.status);
            if (status.status === "running") {
              setBackendRestartState("success");
              setBackendRestartMessage("AmirOS backend is running again.");
              window.setTimeout(() => setBackendRestartState("idle"), 4_000);
              return;
            }
            if (Date.now() >= deadline) {
              setBackendRestartState("error");
              setBackendRestartMessage("AmirOS did not return in time. Open Terminal from your profile menu for details.");
              return;
            }
            backendRestartPollTimerRef.current = window.setTimeout(pollForBackend, 800);
          })
          .catch(() => {
            if (Date.now() >= deadline) {
              setBackendStatus("offline");
              setBackendRestartState("error");
              setBackendRestartMessage("AmirOS did not return in time. Open Terminal from your profile menu for details.");
              return;
            }
            backendRestartPollTimerRef.current = window.setTimeout(pollForBackend, 800);
          });
      };
      backendRestartPollTimerRef.current = window.setTimeout(pollForBackend, 800);
    } catch (error) {
      setBackendRestartState("error");
      setBackendRestartMessage(error instanceof Error ? error.message : "AmirOS could not start the restart.");
      void getBackendRestartStatus().then((status) => setBackendStatus(status.status)).catch(() => setBackendStatus("offline"));
    }
  };

  const connectionReady = data.connection.status === "ready";
  const qrAvailable = data.connection.status === "qr";
  const connectionBusy = data.connection.status === "starting" || data.connection.status === "authenticated" || relinkState === "working";

  const chooseProfileUpload = async (file?: File) => {
    if (!file) return;
    try {
      setPendingProfileImage(await readProfileImage(file));
      setProfileZoom(1);
      setProfileHorizontalOffset(0);
      setProfileVerticalOffset(0);
      setProfileUploadError("");
    } catch (error) {
      setProfileUploadError(error instanceof Error ? error.message : "Could not open this image.");
    } finally {
      if (profileFileRef.current) profileFileRef.current.value = "";
    }
  };

  const saveProfileCrop = async () => {
    if (!pendingProfileImage) return;
    setUploadingProfile(true);
    setProfileUploadError("");
    try {
      const profile = await uploadOwnerAvatar(await cropProfileDataUrl(pendingProfileImage, profileZoom, profileHorizontalOffset, profileVerticalOffset));
      const avatars = await getOwnerAvatars();
      setCustomAvatars(avatars);
      setOwnerProfile(profile);
      setPendingProfileImage(undefined);
    } catch (error) {
      setProfileUploadError(error instanceof Error ? error.message : "Could not save this profile image.");
    } finally {
      setUploadingProfile(false);
    }
  };

  const sameAvatar = (left: string, right: string) => left.split("?")[0] === right.split("?")[0];
  const removeCustomAvatar = async (avatar: OwnerAvatar) => {
    if (!window.confirm("Delete this uploaded profile photo? This cannot be undone.")) return;
    try {
      const result = await deleteOwnerAvatar(avatar.id);
      setCustomAvatars(result.avatars);
      setOwnerProfile(result.profile);
    } catch (error) {
      setProfileUploadError(error instanceof Error ? error.message : "Could not delete this profile image.");
    }
  };

  const beginProfilePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    cropDragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      horizontal: profileHorizontalOffset,
      vertical: profileVerticalOffset,
    };
  };

  const panProfileImage = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = cropDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setProfileHorizontalOffset(Math.max(-110, Math.min(110, drag.horizontal + event.clientX - drag.x)));
    setProfileVerticalOffset(Math.max(-110, Math.min(110, drag.vertical + event.clientY - drag.y)));
  };

  const endProfilePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (cropDragRef.current?.pointerId !== event.pointerId) return;
    cropDragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <main className="main-content secondary-page">
      <header className="page-header compact-header"><div><h1>Settings</h1><p>Configure when AmirOS responds and which commands it listens for.</p></div></header>
      {saveState === "saved" || saveState === "error" ? (
        <div className={`settings-save-notice ${saveState}`} role="status" aria-live="polite">
          {saveState === "saved" ? <Check size={17} /> : <RefreshCw size={17} />}
          <span>{saveState === "saved" ? "Settings saved" : "Settings couldn’t be saved"}</span>
        </div>
      ) : null}
      <div className="settings-grid settings-config-grid">
        <section className="panel settings-summary profile-settings-card">
          <span className="setting-hero-icon"><UserRound size={25} /></span>
          <div className="profile-settings-content"><div><h2>Your profile</h2><p>Used throughout AmirOS. Choose an example or upload your own photo.</p></div>
            <div className="owner-profile-editor"><img src={ownerProfile.avatarUrl} alt="Your selected profile" /><label>Display name<input value={ownerProfile.displayName} onChange={(event) => setOwnerProfile({ ...ownerProfile, displayName: event.target.value })} /></label></div>
            <div className="profile-avatar-options" aria-label="Profile photo choices">
              {profileAvatars.map((avatar) => <button type="button" key={avatar} className={sameAvatar(ownerProfile.avatarUrl, avatar) ? "selected" : ""} onClick={() => setOwnerProfile({ ...ownerProfile, avatarUrl: avatar })}><img src={avatar} alt="Illustrated profile avatar" />{sameAvatar(ownerProfile.avatarUrl, avatar) ? <Check size={15} /> : null}</button>)}
              {customAvatars.map((avatar) => <div className="profile-avatar-option" key={avatar.id}><button type="button" className={sameAvatar(ownerProfile.avatarUrl, avatar.url) ? "selected" : ""} onClick={() => setOwnerProfile({ ...ownerProfile, avatarUrl: avatar.url })}><img src={avatar.url} alt={avatar.label} />{sameAvatar(ownerProfile.avatarUrl, avatar.url) ? <Check size={15} /> : null}</button><button className="profile-avatar-delete" type="button" aria-label={`Delete ${avatar.label}`} title={`Delete ${avatar.label}`} onClick={() => void removeCustomAvatar(avatar)}><Trash2 size={13} /></button></div>)}
            </div>
            <input ref={profileFileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void chooseProfileUpload(event.target.files?.[0])} />
            <button className="button" type="button" disabled={uploadingProfile} onClick={() => profileFileRef.current?.click()}><Upload size={16} />{uploadingProfile ? "Uploading…" : "Upload photo"}</button>
          </div>
        </section>
        <section className="panel settings-summary settings-connection-card">
          <div className="settings-connection-device whatsapp-link-settings">
            <span className="setting-hero-icon whatsapp-setting-icon"><WhatsAppIcon size={27} /></span>
            <div className="whatsapp-link-copy">
              <div className="connection-title-row"><div><h2>WhatsApp linked device</h2><p>{data.connection.detail}</p></div><span className={`connection-badge ${data.connection.status}`}><span />{connectionReady ? "Connected" : qrAvailable ? "QR ready" : connectionBusy ? "Connecting" : "Disconnected"}</span></div>
              {qrAvailable ? (
                <div className="qr-link-layout">
                  <img src={whatsappQrUrl()} alt="WhatsApp linked-device QR code" />
                  <div><h3>Scan with your phone</h3><ol><li>Open WhatsApp Settings.</li><li>Tap <strong>Linked Devices</strong>.</li><li>Tap <strong>Link a Device</strong> and scan this code.</li></ol><p>The code refreshes automatically if WhatsApp replaces it.</p></div>
                </div>
              ) : relinkState === "confirm" ? (
                <div className="relink-confirmation"><strong>Replace the current linked-device session?</strong><p>This signs AmirOS out of WhatsApp on this Mac and generates a fresh QR. Your AmirOS settings, contact memory, and profiles stay intact.</p><div><button className="button" onClick={() => setRelinkState("idle")}>Cancel</button><button className="button primary" onClick={() => void startRelink()}><RefreshCw size={16} />Generate new QR</button></div></div>
              ) : (
                <div className="relink-action"><p>{connectionReady ? "Use this if the linked device is removed from your phone, expires, or stops receiving messages." : "Create a new QR code to reconnect AmirOS to WhatsApp."}</p><button className="button" disabled={connectionBusy} onClick={() => setRelinkState("confirm")}><RefreshCw className={connectionBusy ? "spin" : ""} size={16} />{connectionBusy ? "Preparing connection…" : connectionReady ? "Re-link WhatsApp" : "Generate new QR"}</button></div>
              )}
            </div>
          </div>
          <div className="settings-connection-availability bot-availability-settings">
            <span className="setting-hero-icon"><Bot size={25} /></span>
            <div className="bot-availability-copy"><h2>Assistant availability</h2><p>{data.paused ? "AmirOS is paused. It will not listen for or answer WhatsApp messages until you resume it." : "AmirOS is listening for WhatsApp messages and can reply according to each chat’s settings."}</p></div>
            <div className="bot-availability-action">
              <span className={data.paused ? "assistant-status paused" : "assistant-status running"}><i />{data.paused ? "Paused" : "Running"}</span>
              <button className={data.paused ? "button primary" : "button secondary"} type="button" onClick={() => void onPause()}>
                {data.paused ? <Play size={16} /> : <Pause size={16} />}{data.paused ? "Resume bot" : "Pause bot"}
              </button>
            </div>
          </div>
        </section>
        <div className="settings-core-grid">
        <section className="panel settings-summary api-key-settings">
          <span className="setting-hero-icon"><KeyRound size={25} /></span>
          <div className="api-key-copy"><h2>OpenAI connection</h2><p>{data.settings.apiKeyConfigured ? "An OpenAI API key is connected locally on this Mac. Paste a different key only to replace it." : "Connect your own OpenAI account to enable AmirOS."}</p>
            <div className="api-key-row"><input aria-label="OpenAI API key" type="password" autoComplete="off" spellCheck={false} value={apiKey} placeholder={data.settings.apiKeyConfigured ? "••••••••••••••••" : "sk-…"} onChange={(event) => setApiKey(event.target.value)} /><button className="button primary compact" type="button" disabled={apiKeyState === "saving"} onClick={() => void saveApiKey()}>{apiKeyState === "saving" ? "Saving…" : apiKeyState === "saved" ? "Connected ✓" : "Save API key"}</button></div>
            <small>Your key stays in this Mac’s private <code>.env.local</code> file and is never shown in AmirOS.</small>{apiKeyError ? <small className="subscription-error">{apiKeyError}</small> : null}
          </div>
          <label className="budget-field spend-guard-field">Monthly spend limit (USD)<input aria-label="Monthly AmirOS spend limit" type="number" min="1" step="1" value={budget} onChange={(event) => setBudget(Math.max(1, Number(event.target.value) || 1))} /><small>Stops AmirOS AI requests at this monthly estimate. Usage from other apps is not included.</small></label>
        </section>
        <section className="panel settings-summary assistant-configuration-card">
          <div className="assistant-config-models">
            <span className="setting-hero-icon"><Sparkles size={25} /></span>
            <div className="assistant-config-copy"><div><h2>Assistant models</h2><p>Choose each capability directly. Presets remain available on Overview and Usage.</p></div>
              <div className="model-select-grid"><label>Text model<select value={models.text} onChange={(event) => setModels({ ...models, text: event.target.value })}>{data.modelOptions.text.map((model) => <option key={model} value={model}>{model}</option>)}</select></label><label>Image model<select value={models.image} onChange={(event) => setModels({ ...models, image: event.target.value })}>{data.modelOptions.image.map((model) => <option key={model} value={model}>{model}</option>)}</select></label><label>Transcription model<select value={models.voice} onChange={(event) => setModels({ ...models, voice: event.target.value })}>{data.modelOptions.voice.map((model) => <option key={model} value={model}>{model}</option>)}</select></label></div>
            </div>
          </div>
          <div className="assistant-config-knowledge">
            <span className="setting-hero-icon"><Brain size={25} /></span>
            <div className="assistant-config-copy"><div><h2>New-chat knowledge tracking</h2><p>Choose what AmirOS does when it first sees a conversation.</p></div>
              <label>Default for new chats<select aria-label="Default knowledge tracking" value={knowledgeTrackingDefault} onChange={(event) => setKnowledgeTrackingDefault(event.target.value as KnowledgeTrackingDefault)}><option value="ask">Ask me for each chat</option><option value="private">Track private chats; ask for groups</option><option value="off">Keep tracking off</option></select></label>
            </div>
          </div>
        </section>
        <section className="panel settings-summary calendar-subscription-settings">
          <span className="setting-hero-icon calendar-subscription-icon"><Cloud size={23} /><SiApple size={13} /></span>
          <div className="calendar-subscription-copy">
            <span className="subscription-heading"><h2>iCloud calendar subscription</h2><small className={calendarSubscription?.publicUrlConfigured ? "public" : "local"}>{calendarSubscription?.publicUrlConfigured ? "iCloud-ready URL" : "Local Mac feed"}</small></span>
            <p>Subscribe once to keep confirmed AmirOS events in a read-only Apple calendar.</p>
            <small>This setting always stays here, even when its shortcut is hidden from the Calendar page.</small>
          </div>
          <div className="calendar-subscription-actions">
            {calendarSubscription?.webcalUrl ? <a className="button primary compact" href={calendarSubscription.webcalUrl}><SiApple className="brand-icon apple" size={16} />Subscribe in Apple Calendar</a> : <button className="button primary compact" disabled={!calendarSubscription} onClick={() => void copyCalendarSubscription()}><SiApple className="brand-icon apple" size={16} />{calendarSubscriptionCopied ? "Link copied ✓" : "Copy link for Apple Calendar"}</button>}
            {calendarSubscription?.webcalUrl ? <button className="button compact" disabled={!calendarSubscription} onClick={() => void copyCalendarSubscription()}><Copy size={15} />{calendarSubscriptionCopied ? "Copied ✓" : "Copy link"}</button> : null}
            <button className="button compact" onClick={() => { const hidden = !calendarBannerHidden; setCalendarSubscriptionBannerHidden(hidden); setCalendarBannerHidden(hidden); }}>{calendarBannerHidden ? <Eye size={15} /> : <EyeOff size={15} />}{calendarBannerHidden ? "Show on Calendar" : "Hide from Calendar"}</button>
          </div>
          {calendarSubscriptionError ? <small className="subscription-error">{calendarSubscriptionError}</small> : null}
        </section>
        </div>
        <section className="panel settings-summary system-diagnostics-settings">
          <span className="setting-hero-icon"><RefreshCw className={backendRestartState === "restarting" ? "spin" : ""} size={25} /></span>
          <div className="system-diagnostics-copy">
            <div className="system-diagnostics-heading"><div><h2>System &amp; Diagnostics</h2><p>AmirOS v{data.release.version} · local service controls</p></div></div>
            <p>Restarts the local AmirOS service. The dashboard may disconnect briefly.</p>
            {backendRestartState !== "idle" ? <small className={`backend-restart-notice ${backendRestartState}`} role="status" aria-live="polite">{backendRestartMessage}</small> : null}
          </div>
          <div className="system-diagnostics-actions">
            <span className={`backend-status ${backendStatus}`}><i />{backendStatus === "running" ? "Running" : backendStatus === "restarting" ? "Restarting" : "Offline"}</span>
            <button className="button secondary" type="button" disabled={backendRestartState === "restarting"} onClick={() => void restartBackend()}><RefreshCw className={backendRestartState === "restarting" ? "spin" : ""} size={16} />{backendRestartState === "restarting" ? "Restarting…" : "Restart AmirOS backend"}</button>
          </div>
        </section>
        <section className="panel settings-summary appearance-settings">
          <span className="setting-hero-icon"><Palette size={25} /></span>
          <div className="appearance-heading"><h2>Color theme</h2><p>Choose the palette that feels best. Changes apply immediately and stay selected.</p></div>
          <div className="theme-options" role="radiogroup" aria-label="Color theme">
            {themes.map((theme) => (
              <button
                key={theme.id}
                className={selectedTheme === theme.id ? "theme-option selected" : "theme-option"}
                role="radio"
                aria-checked={selectedTheme === theme.id}
                onClick={() => {
                  setSelectedTheme(theme.id);
                  document.documentElement.dataset.theme = theme.id;
                }}
              >
                <span className="theme-swatches" aria-hidden="true">
                  {theme.colors.map((color) => <span key={color} style={{ background: color }} />)}
                </span>
                <span><strong>{theme.name}</strong><small>{theme.description}</small></span>
                {selectedTheme === theme.id ? <Check size={18} /> : null}
              </button>
            ))}
          </div>
        </section>
        <footer className="settings-privacy-footer"><ShieldCheck size={16} /><span>Private by design — AmirOS runs on this Mac and keeps your conversations, saved knowledge, and API key local.</span></footer>
      </div>
      {pendingProfileImage ? <div className="profile-crop-backdrop" role="presentation"><section className="profile-crop-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-crop-title"><header><div><small>YOUR PROFILE</small><h2 id="profile-crop-title">Crop your profile photo</h2><p>Zoom, then drag your photo to position it.</p></div><button className="icon-button" type="button" aria-label="Close photo crop" onClick={() => setPendingProfileImage(undefined)}>×</button></header><div className="profile-crop-content"><div className="profile-crop-preview" role="application" aria-label="Profile image crop area. Drag to position the photo." onPointerDown={beginProfilePan} onPointerMove={panProfileImage} onPointerUp={endProfilePan} onPointerCancel={endProfilePan}><img draggable={false} src={pendingProfileImage} alt="Profile crop preview" style={{ transform: `translate(${profileHorizontalOffset}px, ${profileVerticalOffset}px) scale(${profileZoom})` }} /></div><small className="profile-crop-hint">Drag the photo to move it within the circle.</small><label>Zoom<input type="range" min="1" max="3" step="0.01" value={profileZoom} onChange={(event) => setProfileZoom(Number(event.target.value))} /></label>{profileUploadError ? <p className="profile-crop-error" role="alert">{profileUploadError}</p> : null}</div><footer><button className="button" type="button" disabled={uploadingProfile} onClick={() => setPendingProfileImage(undefined)}>Cancel</button><button className="button primary" type="button" disabled={uploadingProfile} onClick={() => void saveProfileCrop()}>{uploadingProfile ? "Saving…" : "Save profile photo"}</button></footer></section></div> : null}
    </main>
  );
}
