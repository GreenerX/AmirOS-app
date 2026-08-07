import { Brain, Check, ChevronLeft, ChevronRight, KeyRound, LoaderCircle, MessageCircleMore, Palette, QrCode, Rocket, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { whatsappQrUrl } from "../api";
import type { AmirOSRelease, AmirOSUpdateStatus, DashboardData, KnowledgeTrackingDefault, ThemeName } from "../types";

const ONBOARDING_KEY = "amiros.onboarding.completed";
const RELEASE_KEY = "amiros.release-notes.seen";

type ReleaseExperienceProps = {
  release: AmirOSRelease;
  knowledgeTrackingDefault: KnowledgeTrackingDefault;
  theme: ThemeName;
  ownerProfile: DashboardData["settings"]["ownerProfile"];
  onFinishOnboarding: (choice: KnowledgeTrackingDefault, theme: ThemeName) => Promise<void>;
  onSaveOwnerProfile: (profile: DashboardData["settings"]["ownerProfile"]) => Promise<void>;
  apiKeyConfigured: boolean;
  connection: DashboardData["connection"];
  onSaveApiKey: (apiKey: string) => Promise<void>;
  onRelinkWhatsApp: () => Promise<DashboardData["connection"]>;
  update?: AmirOSUpdateStatus;
  onStartUpdate?: () => Promise<void>;
  forceReleaseOpen?: boolean;
  onReleaseNotesClosed?: () => void;
};

const onboardingAvatars = [1, 2, 3, 4].map((number) => `/profile-avatars/avatar-0${number}.png`);
const onboardingThemes: Array<{ id: ThemeName; name: string; colors: [string, string, string] }> = [
  { id: "forest", name: "Forest", colors: ["#197a52", "#edf7f1", "#ffffff"] },
  { id: "ocean", name: "Ocean", colors: ["#256b8f", "#eef7fb", "#ffffff"] },
  { id: "plum", name: "Plum", colors: ["#75558d", "#f6f0f8", "#ffffff"] },
  { id: "sand", name: "Sand", colors: ["#95652f", "#faf4ea", "#fffdfa"] },
  { id: "indigo", name: "Indigo", colors: ["#5364b6", "#f0f2fb", "#ffffff"] },
  { id: "rose", name: "Rose", colors: ["#a34d6f", "#fbf0f4", "#ffffff"] },
  { id: "graphite", name: "Graphite", colors: ["#53606b", "#f0f3f5", "#ffffff"] },
];

function StepProgress({ current }: { current: number }) {
  return <div className="release-step-progress" aria-label={`Step ${current + 1} of 4`}>
    {[0, 1, 2, 3].map((step) => <span key={step} className={step <= current ? "active" : ""} />)}
  </div>;
}

export function ReleaseExperience({ release, knowledgeTrackingDefault, theme, ownerProfile, onFinishOnboarding, onSaveOwnerProfile, apiKeyConfigured, connection, onSaveApiKey, onRelinkWhatsApp, update, onStartUpdate, forceReleaseOpen = false, onReleaseNotesClosed }: ReleaseExperienceProps) {
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [selectedVersion, setSelectedVersion] = useState(release.version);
  const [trackingChoice, setTrackingChoice] = useState<KnowledgeTrackingDefault>(knowledgeTrackingDefault);
  const [selectedTheme, setSelectedTheme] = useState<ThemeName>(theme);
  const [savingTrackingChoice, setSavingTrackingChoice] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string>();
  const [generatingQr, setGeneratingQr] = useState(false);
  const [waitingForQr, setWaitingForQr] = useState(false);
  const [qrError, setQrError] = useState<string>();
  const [ownerName, setOwnerName] = useState(ownerProfile.displayName === "You" ? "" : ownerProfile.displayName);
  const [ownerAvatar, setOwnerAvatar] = useState(() => onboardingAvatars[Math.floor(Math.random() * onboardingAvatars.length)]!);
  const [savingOwnerProfile, setSavingOwnerProfile] = useState(false);
  const [ownerProfileError, setOwnerProfileError] = useState<string>();
  const [startingUpdate, setStartingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string>();
  const releases = release.history?.length ? release.history : [release];
  const selectedRelease = releases.find((item) => item.version === selectedVersion) ?? release;

  useEffect(() => {
    setSelectedVersion(release.version);
    const onboardingComplete = window.localStorage.getItem(ONBOARDING_KEY) === "true";
    const seenVersion = window.localStorage.getItem(RELEASE_KEY);
    if (!onboardingComplete) {
      setOnboardingOpen(true);
      return;
    }
    if (seenVersion !== release.version) setReleaseOpen(true);
  }, [release.version]);

  useEffect(() => setTrackingChoice(knowledgeTrackingDefault), [knowledgeTrackingDefault]);
  useEffect(() => setSelectedTheme(theme), [theme]);

  useEffect(() => {
    if (ownerProfile.displayName !== "You") setOwnerName(ownerProfile.displayName);
  }, [ownerProfile.displayName]);

  useEffect(() => {
    if (connection.status !== "starting") setWaitingForQr(false);
  }, [connection.status]);

  useEffect(() => {
    if (forceReleaseOpen) setReleaseOpen(true);
  }, [forceReleaseOpen]);

  const closeRelease = () => {
    window.localStorage.setItem(RELEASE_KEY, release.version);
    setReleaseOpen(false);
    onReleaseNotesClosed?.();
  };

  const startAvailableUpdate = async () => {
    if (!onStartUpdate || startingUpdate) return;
    setStartingUpdate(true);
    setUpdateError(undefined);
    try {
      await onStartUpdate();
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : "AmirOS could not start the update.");
      setStartingUpdate(false);
    }
  };

  const finishOnboarding = () => {
    window.localStorage.setItem(ONBOARDING_KEY, "true");
    setOnboardingOpen(false);
    if (window.localStorage.getItem(RELEASE_KEY) !== release.version) setReleaseOpen(true);
  };

  const finishWithTrackingChoice = async () => {
    setSavingTrackingChoice(true);
    try {
      await onFinishOnboarding(trackingChoice, selectedTheme);
      finishOnboarding();
    } finally {
      setSavingTrackingChoice(false);
    }
  };

  const continueFromWelcome = async () => {
    const displayName = ownerName.replace(/\s+/g, " ").trim();
    if (!displayName) {
      setOwnerProfileError("Add your name so AmirOS can personalize your dashboard.");
      return;
    }
    setSavingOwnerProfile(true);
    setOwnerProfileError(undefined);
    try {
      await onSaveOwnerProfile({ displayName: displayName.slice(0, 120), avatarUrl: ownerAvatar });
      setStep(1);
    } catch (error) {
      setOwnerProfileError(error instanceof Error ? error.message : "AmirOS could not save your profile.");
    } finally {
      setSavingOwnerProfile(false);
    }
  };

  const saveOnboardingApiKey = async () => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      setApiKeyError("Paste your OpenAI API key to save it.");
      return;
    }
    setSavingApiKey(true);
    setApiKeyError(undefined);
    try {
      await onSaveApiKey(trimmedKey);
      setApiKey("");
    } catch (error) {
      setApiKeyError(error instanceof Error ? error.message : "AmirOS could not save that API key.");
    } finally {
      setSavingApiKey(false);
    }
  };

  const generateQr = async () => {
    setGeneratingQr(true);
    setWaitingForQr(false);
    setQrError(undefined);
    try {
      const nextConnection = await onRelinkWhatsApp();
      setWaitingForQr(nextConnection.status === "starting");
    } catch (error) {
      setQrError(error instanceof Error ? error.message : "AmirOS could not generate a WhatsApp QR code.");
    } finally {
      setGeneratingQr(false);
    }
  };

  if (!onboardingOpen && !releaseOpen) return null;

  return <div className="release-experience-backdrop" role="presentation">
    {onboardingOpen ? <section className="release-dialog onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="amiros-onboarding-title">
      <header>
        <span className="release-dialog-icon"><Sparkles size={24} /></span>
        <div><small>Welcome to AmirOS</small><h2 id="amiros-onboarding-title">Your private WhatsApp assistant</h2></div>
        <button className="icon-button" type="button" aria-label="Skip setup" onClick={() => finishOnboarding()}><X size={18} /></button>
      </header>
      <div className="onboarding-body">
        <StepProgress current={step} />
        {step === 0 ? <><div className="onboarding-intro"><span className="onboarding-hero-icon"><Rocket size={34} /></span><div><h3>Let’s make AmirOS yours.</h3><p>It stays on your computer and connects to the WhatsApp account you choose. You can change everything later.</p></div></div><div className="onboarding-profile-form"><label htmlFor="onboarding-owner-name">What should AmirOS call you?<input id="onboarding-owner-name" autoComplete="name" placeholder="Your name" value={ownerName} onChange={(event) => { setOwnerName(event.target.value); setOwnerProfileError(undefined); }} /></label><span>Choose an avatar</span><div className="onboarding-avatar-options">{onboardingAvatars.map((avatar) => <button type="button" key={avatar} aria-label="Choose avatar" className={ownerAvatar === avatar ? "selected" : ""} onClick={() => setOwnerAvatar(avatar)}><img src={avatar} alt="Illustrated avatar" />{ownerAvatar === avatar ? <Check size={14} /> : null}</button>)}</div></div>{ownerProfileError ? <p className="onboarding-inline-error" role="alert">{ownerProfileError}</p> : null}<ul className="onboarding-checklist"><li><Check size={16} /> Your data stays local</li><li><Check size={16} /> You choose the AI budget</li><li><Check size={16} /> You stay in control of every chat</li></ul></> : null}
        {step === 1 ? <><div className="onboarding-intro"><span className="onboarding-hero-icon"><KeyRound size={34} /></span><div><h3>Add your own OpenAI API key.</h3><p>Your key powers responses, images, voice transcription, and the relationship intelligence features. It is saved only on this computer.</p></div></div><div className="onboarding-api-form"><label htmlFor="onboarding-api-key">OpenAI API key</label><div className="onboarding-api-row"><input id="onboarding-api-key" type="password" autoComplete="off" spellCheck={false} placeholder="sk-…" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setApiKeyError(undefined); }} /><button className="button compact" type="button" disabled={savingApiKey || apiKeyConfigured} onClick={() => void saveOnboardingApiKey()}>{savingApiKey ? <><LoaderCircle className="spin" size={15} /> Saving…</> : apiKeyConfigured ? <><Check size={15} /> Key saved</> : "Save key"}</button></div>{apiKeyError ? <p className="onboarding-inline-error" role="alert">{apiKeyError}</p> : null}</div><small className="onboarding-later-note">You can set a monthly spend limit in Settings after setup.</small></> : null}
        {step === 2 ? <><div className="onboarding-intro"><span className="onboarding-hero-icon"><MessageCircleMore size={34} /></span><div><h3>Link WhatsApp when you’re ready.</h3><p>{connection.status === "ready" ? "Your WhatsApp account is connected and ready to use." : "Generate a QR code here, then scan it from WhatsApp → Settings → Linked Devices → Link a Device."}</p></div></div>{connection.status === "ready" ? <div className="onboarding-success-state"><Check size={18} /><span><strong>WhatsApp is linked</strong><small>{connection.detail || "AmirOS is ready to listen for your messages."}</small></span></div> : <>{connection.status === "qr" ? <div className="onboarding-qr-panel"><img src={whatsappQrUrl()} alt="WhatsApp linked device QR code" /><div><strong>Scan this QR code in WhatsApp</strong><small>Keep this window open until AmirOS confirms the connection.</small><button className="button compact ghost" type="button" disabled={generatingQr} onClick={() => void generateQr()}>{generatingQr ? <><LoaderCircle className="spin" size={15} /> Refreshing…</> : <><QrCode size={15} /> New QR code</>}</button></div></div> : waitingForQr || connection.status === "starting" ? <div className="onboarding-success-state onboarding-waiting-state"><LoaderCircle className="spin" size={18} /><span><strong>Preparing your QR code</strong><small>It will appear here automatically in a few seconds.</small></span></div> : <button className="button compact onboarding-qr-button" type="button" disabled={generatingQr} onClick={() => void generateQr()}>{generatingQr ? <><LoaderCircle className="spin" size={16} /> Generating QR…</> : <><QrCode size={16} /> Generate WhatsApp QR code</>}</button>}{qrError ? <p className="onboarding-inline-error" role="alert">{qrError}</p> : null}</>}<small className="onboarding-later-note">You can safely continue and link WhatsApp later if you prefer.</small></> : null}
        {step === 3 ? <><div className="onboarding-intro"><span className="onboarding-hero-icon"><Brain size={34} /></span><div><h3>Choose how AmirOS learns and looks.</h3><p>Choose what AmirOS can learn from new chats, then pick a color theme. You can change both anytime.</p></div></div><div className="onboarding-choice-grid" role="radiogroup" aria-label="Knowledge tracking preference">
          <label className={trackingChoice === "ask" ? "selected" : ""}><input type="radio" name="knowledge-tracking" value="ask" checked={trackingChoice === "ask"} onChange={() => setTrackingChoice("ask")} /><span><strong>Ask me for each chat</strong><small>Recommended. AmirOS will ask before tracking a person or group.</small></span></label>
          <label className={trackingChoice === "private" ? "selected" : ""}><input type="radio" name="knowledge-tracking" value="private" checked={trackingChoice === "private"} onChange={() => setTrackingChoice("private")} /><span><strong>Track private chats</strong><small>New one-to-one chats are tracked automatically. Groups still need approval.</small></span></label>
          <label className={trackingChoice === "off" ? "selected" : ""}><input type="radio" name="knowledge-tracking" value="off" checked={trackingChoice === "off"} onChange={() => setTrackingChoice("off")} /><span><strong>Keep tracking off</strong><small>AmirOS will not make new knowledge suggestions unless you enable a chat.</small></span></label>
        </div><div className="onboarding-theme-picker"><div><Palette size={17} /><span><strong>Choose a color theme</strong><small>All themes are available in Settings later.</small></span></div><div role="radiogroup" aria-label="AmirOS color theme">{onboardingThemes.map((option) => <button key={option.id} type="button" role="radio" aria-checked={selectedTheme === option.id} className={selectedTheme === option.id ? "selected" : ""} onClick={() => { setSelectedTheme(option.id); document.documentElement.dataset.theme = option.id; }}><span className="onboarding-theme-swatches" aria-hidden="true">{option.colors.map((color) => <i key={color} style={{ background: color }} />)}</span><span>{option.name}</span>{selectedTheme === option.id ? <Check size={13} /> : null}</button>)}</div></div></> : null}
      </div>
      <footer>
        <button className="button compact ghost" type="button" disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))}><ChevronLeft size={16} /> Back</button>
        {step < 3 ? <button className="button primary compact" type="button" disabled={step === 0 && savingOwnerProfile} onClick={() => step === 0 ? void continueFromWelcome() : setStep((current) => Math.min(3, current + 1))}>{step === 0 && savingOwnerProfile ? "Saving…" : "Continue"} <ChevronRight size={16} /></button> : <button className="button primary compact" type="button" disabled={savingTrackingChoice} onClick={() => void finishWithTrackingChoice()}>{savingTrackingChoice ? "Saving…" : "Open AmirOS"} <Check size={16} /></button>}
      </footer>
    </section> : null}
    {releaseOpen ? <section className="release-dialog release-notes-dialog" role="dialog" aria-modal="true" aria-labelledby="amiros-release-title">
      <header>
        <span className="release-dialog-icon"><Sparkles size={24} /></span>
        <div><small>Release notes · v{selectedRelease.version}</small><h2 id="amiros-release-title">{selectedRelease.headline}</h2></div>
        <button className="icon-button" type="button" aria-label="Close release notes" onClick={closeRelease}><X size={18} /></button>
      </header>
      <div className="release-notes-body">
        {update?.status === "available" ? <section className="release-update-ready">
          <div><small>Update available</small><strong>Update to v{update.latestVersion}</strong><p>A new published AmirOS release is ready. Your private data stays on this Mac.</p>{updateError ? <em>{updateError}</em> : null}</div>
          <button className="button primary compact" type="button" disabled={startingUpdate} onClick={() => void startAvailableUpdate()}>{startingUpdate ? "Starting…" : "Update AmirOS"}</button>
        </section> : null}
        <div className="release-version-picker">
          <div><span>Viewing version</span><strong>v{selectedRelease.version}{selectedRelease.version === release.version ? " · Current" : ""}</strong></div>
          <label htmlFor="amiros-release-version" className="sr-only">Choose a past AmirOS version</label>
          <select id="amiros-release-version" value={selectedRelease.version} onChange={(event) => setSelectedVersion(event.target.value)}>
            {releases.map((item) => <option key={item.version} value={item.version}>v{item.version}{item.version === release.version ? " (Current)" : ""}</option>)}
          </select>
        </div>
        <p className="release-date">Released {new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(new Date(`${selectedRelease.releasedAt}T12:00:00`))}</p>
        <div className="release-note-list">{selectedRelease.notes.map((note) => <article key={`${selectedRelease.version}-${note.title}`}><span><Check size={15} /></span><div><h3>{note.title}</h3><p>{note.detail}</p></div></article>)}</div>
      </div>
      <footer><button className="button primary compact" type="button" onClick={closeRelease}>Got it</button><button className="button compact ghost" type="button" onClick={() => { closeRelease(); setStep(0); setOnboardingOpen(true); }}>Replay setup</button></footer>
    </section> : null}
  </div>;
}
