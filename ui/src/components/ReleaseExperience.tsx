import { Brain, Check, ChevronLeft, ChevronRight, KeyRound, LoaderCircle, MessageCircleMore, QrCode, Rocket, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { whatsappQrUrl } from "../api";
import { ProductWalkthrough } from "./ProductWalkthrough";
import { readProductWalkthrough, saveProductWalkthrough } from "../product-walkthrough-state";
import { accountSetupRequired, canShowReleaseNotes, hasLegacyCompletedOnboarding, nextOnboardingStepAfterWhatsAppLink, shouldKeepOnboardingOpen, shouldMarkInstalledReleaseSeen, shouldShowOnboarding } from "../release-visibility";
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
  onOnboardingFinished?: () => void;
  onOpenPeopleSetup?: () => void;
  onWalkthroughStepChange?: (step: number) => void;
  onWalkthroughClosed?: () => void;
  forceReleaseOpen?: boolean;
  onReleaseNotesClosed?: () => void;
};

const onboardingAvatars = [1, 2, 3, 4].map((number) => `/profile-avatars/avatar-0${number}.png`);
function StepProgress({ current }: { current: number }) {
  return <div className="release-step-progress" aria-label={`Step ${current + 1} of 4`}>
    {[0, 1, 2, 3].map((step) => <span key={step} className={step <= current ? "active" : ""} />)}
  </div>;
}

export function ReleaseExperience({ release, knowledgeTrackingDefault, theme, ownerProfile, onFinishOnboarding, onSaveOwnerProfile, apiKeyConfigured, connection, onSaveApiKey, onRelinkWhatsApp, update, onStartUpdate, onOnboardingFinished, onOpenPeopleSetup, onWalkthroughStepChange, onWalkthroughClosed, forceReleaseOpen = false, onReleaseNotesClosed }: ReleaseExperienceProps) {
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [walkthrough, setWalkthrough] = useState(() => readProductWalkthrough());
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
  const [finishOnboardingError, setFinishOnboardingError] = useState<string>();
  const [startingUpdate, setStartingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string>();
  const releases = release.history?.length ? release.history : [release];
  const selectedRelease = releases.find((item) => item.version === selectedVersion) ?? release;
  const setupRequired = accountSetupRequired(apiKeyConfigured);
  const onboardingReadyToFinish = apiKeyConfigured && connection.status === "ready";
  const previousConnectionStatus = useRef(connection.status);

  useEffect(() => {
    setSelectedVersion(release.version);
    const storedOnboardingComplete = window.localStorage.getItem(ONBOARDING_KEY) === "true";
    const onboardingComplete = storedOnboardingComplete || hasLegacyCompletedOnboarding(ownerProfile.displayName, apiKeyConfigured);
    if (onboardingComplete && !storedOnboardingComplete) {
      window.localStorage.setItem(ONBOARDING_KEY, "true");
    }
    const seenVersion = window.localStorage.getItem(RELEASE_KEY);
    const visibility = {
      onboardingComplete,
      apiKeyConfigured,
      connectionStatus: connection.status,
      seenVersion,
      currentVersion: release.version,
    };
    if (shouldKeepOnboardingOpen(onboardingOpen, visibility)) {
      setReleaseOpen(false);
      if (shouldShowOnboarding(visibility)) setOnboardingOpen(true);
      return;
    }
    if (shouldMarkInstalledReleaseSeen(visibility)) {
      window.localStorage.setItem(RELEASE_KEY, release.version);
      setReleaseOpen(false);
      return;
    }
    if (canShowReleaseNotes(visibility)) setReleaseOpen(true);
  }, [apiKeyConfigured, connection.status, onboardingOpen, ownerProfile.displayName, release.version]);

  useEffect(() => {
    const saved = readProductWalkthrough();
    if (saved && !saved.complete) setWalkthrough(saved);
  }, []);

  useEffect(() => setTrackingChoice(knowledgeTrackingDefault), [knowledgeTrackingDefault]);
  useEffect(() => setSelectedTheme(theme), [theme]);

  useEffect(() => {
    if (ownerProfile.displayName !== "You") setOwnerName(ownerProfile.displayName);
  }, [ownerProfile.displayName]);

  useEffect(() => {
    if (connection.status !== "starting") setWaitingForQr(false);
  }, [connection.status]);

  useEffect(() => {
    const nextStep = nextOnboardingStepAfterWhatsAppLink(step, previousConnectionStatus.current, connection.status);
    previousConnectionStatus.current = connection.status;
    if (onboardingOpen && nextStep !== step) setStep(nextStep);
  }, [connection.status, onboardingOpen, step]);

  useEffect(() => {
    if (!forceReleaseOpen) return;
    if (setupRequired || onboardingOpen) {
      setReleaseOpen(false);
      if (setupRequired) setOnboardingOpen(true);
      return;
    }
    setReleaseOpen(true);
  }, [forceReleaseOpen, onboardingOpen, setupRequired]);

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
    if (!onboardingReadyToFinish) return;
    window.localStorage.setItem(ONBOARDING_KEY, "true");
    // The release installed with a person's first setup is not an update.
    // Record it now so they start in AmirOS rather than in release notes.
    window.localStorage.setItem(RELEASE_KEY, release.version);
    setOnboardingOpen(false);
    setReleaseOpen(false);
    const firstTourStep = { version: 1 as const, step: 0, complete: false };
    saveProductWalkthrough(firstTourStep);
    setWalkthrough(firstTourStep);
    onWalkthroughStepChange?.(0);
    onOnboardingFinished?.();
  };

  const setWalkthroughStep = (step: number) => {
    const next = { version: 1 as const, step, complete: false };
    saveProductWalkthrough(next);
    setWalkthrough(next);
    onWalkthroughStepChange?.(next.step);
  };

  const finishWalkthrough = () => {
    const complete = { version: 1 as const, step: 4, complete: true };
    saveProductWalkthrough(complete);
    setWalkthrough(complete);
    onWalkthroughClosed?.();
  };

  const openPeopleSetup = () => {
    finishWalkthrough();
    onOpenPeopleSetup?.();
  };

  const replayProductTour = () => {
    closeRelease();
    const firstTourStep = { version: 1 as const, step: 0, complete: false };
    saveProductWalkthrough(firstTourStep);
    setWalkthrough(firstTourStep);
    onWalkthroughStepChange?.(0);
  };

  const finishWithTrackingChoice = async () => {
    if (!onboardingReadyToFinish) return;
    setSavingTrackingChoice(true);
    setFinishOnboardingError(undefined);
    try {
      await onFinishOnboarding(trackingChoice, selectedTheme);
      finishOnboarding();
    } catch (error) {
      setFinishOnboardingError(error instanceof Error ? error.message : "AmirOS could not finish setup. Please try again.");
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

  if (!onboardingOpen && !releaseOpen && (!walkthrough || walkthrough.complete)) return null;

  return <div className={`release-experience-backdrop ${walkthrough && !walkthrough.complete ? "is-walkthrough-active" : ""}`} role="presentation">
    {onboardingOpen ? <section className="release-dialog onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="amiros-onboarding-title">
      <header>
        <span className="release-dialog-icon"><Sparkles size={24} /></span>
        <div><small>Welcome to AmirOS</small><h2 id="amiros-onboarding-title">Your private WhatsApp assistant</h2></div>
      </header>
      <div className="onboarding-body">
        <StepProgress current={step} />
        {step === 0 ? <><div className="onboarding-intro"><span className="onboarding-hero-icon"><Rocket size={34} /></span><div><h3>Let’s make AmirOS yours.</h3><p>AmirOS keeps your account and saved data on this computer. You decide when it uses your OpenAI account for a selected AI feature.</p></div></div><div className="onboarding-profile-form"><label htmlFor="onboarding-owner-name">What should AmirOS call you?<input id="onboarding-owner-name" autoComplete="name" placeholder="Your name" value={ownerName} onChange={(event) => { setOwnerName(event.target.value); setOwnerProfileError(undefined); }} /></label><span>Choose an avatar</span><div className="onboarding-avatar-options">{onboardingAvatars.map((avatar) => <button type="button" key={avatar} aria-label="Choose avatar" className={ownerAvatar === avatar ? "selected" : ""} onClick={() => setOwnerAvatar(avatar)}><img src={avatar} alt="Illustrated avatar" />{ownerAvatar === avatar ? <Check size={14} /> : null}</button>)}</div></div>{ownerProfileError ? <p className="onboarding-inline-error" role="alert">{ownerProfileError}</p> : null}<ul className="onboarding-checklist"><li><Check size={16} /> Your AmirOS data stays on this computer</li><li><Check size={16} /> You choose when to use AI</li><li><Check size={16} /> You stay in control of every chat</li></ul></> : null}
        {step === 1 ? <><div className="onboarding-intro"><span className="onboarding-hero-icon"><KeyRound size={34} /></span><div><h3>Add your OpenAI API key.</h3><p>Use the individual key provided for your AmirOS beta access, or one from your own OpenAI account. It powers responses, images, voice transcription, and relationship intelligence features, and is saved only on this computer.</p></div></div><div className="onboarding-api-form"><label htmlFor="onboarding-api-key">OpenAI API key</label><div className="onboarding-api-row"><input id="onboarding-api-key" type="password" autoComplete="off" spellCheck={false} placeholder="sk-…" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setApiKeyError(undefined); }} /><button className="button compact" type="button" disabled={savingApiKey || apiKeyConfigured} onClick={() => void saveOnboardingApiKey()}>{savingApiKey ? <><LoaderCircle className="spin" size={15} /> Saving…</> : apiKeyConfigured ? <><Check size={15} /> Key saved</> : "Save key"}</button></div>{apiKeyError ? <p className="onboarding-inline-error" role="alert">{apiKeyError}</p> : null}</div><small className="onboarding-later-note">Save your key to continue. You can set a monthly spend limit in Settings after setup.</small></> : null}
        {step === 2 ? <><div className="onboarding-intro"><span className="onboarding-hero-icon"><MessageCircleMore size={34} /></span><div><h3>Link your WhatsApp.</h3><p>{connection.status === "ready" ? "Your WhatsApp account is connected. Continuing setup…" : "Generate a QR code here, then scan it from WhatsApp → Settings → Linked Devices → Link a Device."}</p></div></div>{connection.status === "ready" ? <div className="onboarding-success-state"><Check size={18} /><span><strong>WhatsApp is linked</strong><small>{connection.detail || "AmirOS is ready to listen for your messages."}</small></span></div> : <>{connection.status === "qr" ? <div className="onboarding-qr-panel"><img src={whatsappQrUrl()} alt="WhatsApp linked device QR code" /><div><strong>Scan this QR code in WhatsApp</strong><small>Keep this window open until AmirOS confirms the connection.</small><button className="button compact ghost" type="button" disabled={generatingQr} onClick={() => void generateQr()}>{generatingQr ? <><LoaderCircle className="spin" size={15} /> Refreshing…</> : <><QrCode size={15} /> New QR code</>}</button></div></div> : waitingForQr || connection.status === "starting" ? <div className="onboarding-success-state onboarding-waiting-state"><LoaderCircle className="spin" size={18} /><span><strong>Preparing your QR code</strong><small>It will appear here automatically in a few seconds.</small></span></div> : <button className="button compact onboarding-qr-button" type="button" disabled={generatingQr} onClick={() => void generateQr()}>{generatingQr ? <><LoaderCircle className="spin" size={16} /> Generating QR…</> : <><QrCode size={16} /> Generate WhatsApp QR code</>}</button>}{qrError ? <p className="onboarding-inline-error" role="alert">{qrError}</p> : null}</>}</> : null}
        {step === 3 ? <><div className="onboarding-intro"><span className="onboarding-hero-icon"><Brain size={34} /></span><div><h3>One privacy choice, then you’re in.</h3><p>Choose how AmirOS handles new chats you have not explicitly selected. You can change this anytime in Settings.</p></div></div><div className="onboarding-choice-grid" role="radiogroup" aria-label="Knowledge tracking preference">
          <label className={trackingChoice === "ask" ? "selected" : ""}><input type="radio" name="knowledge-tracking" value="ask" checked={trackingChoice === "ask"} onChange={() => setTrackingChoice("ask")} /><span><strong>Ask me for each chat</strong><small>Recommended. AmirOS will ask before tracking a person or group.</small></span></label>
          <label className={trackingChoice === "private" ? "selected" : ""}><input type="radio" name="knowledge-tracking" value="private" checked={trackingChoice === "private"} onChange={() => setTrackingChoice("private")} /><span><strong>Track private chats</strong><small>New one-to-one chats are tracked automatically. Groups still need approval.</small></span></label>
          <label className={trackingChoice === "off" ? "selected" : ""}><input type="radio" name="knowledge-tracking" value="off" checked={trackingChoice === "off"} onChange={() => setTrackingChoice("off")} /><span><strong>Keep tracking off</strong><small>AmirOS will not learn from new messages in other chats unless you later enable them. People you explicitly choose during People setup can still keep learning.</small></span></label>
        </div>{finishOnboardingError ? <p className="onboarding-inline-error" role="alert">{finishOnboardingError}</p> : null}</> : null}
      </div>
      <footer>
        <button className="button compact ghost" type="button" disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))}><ChevronLeft size={16} /> Back</button>
        {step < 3 ? <button className="button primary compact" type="button" disabled={(step === 0 && savingOwnerProfile) || (step === 1 && (savingApiKey || !apiKeyConfigured)) || (step === 2 && connection.status !== "ready")} onClick={() => step === 0 ? void continueFromWelcome() : setStep((current) => Math.min(3, current + 1))}>{step === 0 && savingOwnerProfile ? "Saving…" : "Continue"} <ChevronRight size={16} /></button> : <button className="button primary compact" type="button" disabled={savingTrackingChoice} onClick={() => void finishWithTrackingChoice()}>{savingTrackingChoice ? "Saving…" : "Open AmirOS"} {savingTrackingChoice ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}</button>}
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
      <footer><button className="button primary compact" type="button" onClick={closeRelease}>Got it</button><button className="button compact ghost" type="button" onClick={replayProductTour}>Product tour</button><button className="button compact ghost" type="button" onClick={() => { closeRelease(); setStep(0); setOnboardingOpen(true); }}>Replay setup</button></footer>
    </section> : null}
    {walkthrough && !walkthrough.complete ? <ProductWalkthrough step={walkthrough.step} onStepChange={setWalkthroughStep} onFinish={finishWalkthrough} onChoosePeople={openPeopleSetup} /> : null}
  </div>;
}
