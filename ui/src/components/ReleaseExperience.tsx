import { Check, ChevronLeft, ChevronRight, KeyRound, MessageCircleMore, Rocket, Settings2, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AmirOSRelease } from "../types";

const ONBOARDING_KEY = "amiros.onboarding.completed";
const RELEASE_KEY = "amiros.release-notes.seen";

type ReleaseExperienceProps = {
  release: AmirOSRelease;
  onOpenSettings: () => void;
  forceReleaseOpen?: boolean;
  onReleaseNotesClosed?: () => void;
};

function StepProgress({ current }: { current: number }) {
  return <div className="release-step-progress" aria-label={`Step ${current + 1} of 3`}>
    {[0, 1, 2].map((step) => <span key={step} className={step <= current ? "active" : ""} />)}
  </div>;
}

export function ReleaseExperience({ release, onOpenSettings, forceReleaseOpen = false, onReleaseNotesClosed }: ReleaseExperienceProps) {
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const onboardingComplete = window.localStorage.getItem(ONBOARDING_KEY) === "true";
    const seenVersion = window.localStorage.getItem(RELEASE_KEY);
    if (!onboardingComplete) {
      setOnboardingOpen(true);
      return;
    }
    if (seenVersion !== release.version) setReleaseOpen(true);
  }, [release.version]);

  useEffect(() => {
    if (forceReleaseOpen) setReleaseOpen(true);
  }, [forceReleaseOpen]);

  const closeRelease = () => {
    window.localStorage.setItem(RELEASE_KEY, release.version);
    setReleaseOpen(false);
    onReleaseNotesClosed?.();
  };

  const finishOnboarding = (openSettings = false) => {
    window.localStorage.setItem(ONBOARDING_KEY, "true");
    setOnboardingOpen(false);
    if (openSettings) onOpenSettings();
    if (window.localStorage.getItem(RELEASE_KEY) !== release.version) setReleaseOpen(true);
  };

  if (!onboardingOpen && !releaseOpen) return null;

  return <div className="release-experience-backdrop" role="presentation">
    {onboardingOpen ? <section className="release-dialog onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="amiros-onboarding-title">
      <header>
        <span className="release-dialog-icon"><Sparkles size={24} /></span>
        <div><small>Welcome to AmirOS</small><h2 id="amiros-onboarding-title">Your private WhatsApp co-pilot</h2></div>
        <button className="icon-button" type="button" aria-label="Skip setup" onClick={() => finishOnboarding()}><X size={18} /></button>
      </header>
      <div className="onboarding-body">
        <StepProgress current={step} />
        {step === 0 ? <><span className="onboarding-hero-icon"><Rocket size={34} /></span><h3>Let’s get AmirOS ready for you.</h3><p>AmirOS stays on your computer and connects to the WhatsApp account you choose. Setup takes a few minutes, and you can change everything later.</p><ul className="onboarding-checklist"><li><Check size={16} /> Your data stays local</li><li><Check size={16} /> You choose the AI budget</li><li><Check size={16} /> You stay in control of every chat</li></ul></> : null}
        {step === 1 ? <><span className="onboarding-hero-icon"><KeyRound size={34} /></span><h3>Add your own OpenAI API key.</h3><p>Your key powers responses, images, voice transcription, and the relationship intelligence features. Set a monthly limit in Settings so usage always stays predictable.</p><button className="button compact" type="button" onClick={() => finishOnboarding(true)}><Settings2 size={16} /> Open Settings</button></> : null}
        {step === 2 ? <><span className="onboarding-hero-icon"><MessageCircleMore size={34} /></span><h3>Link WhatsApp when you’re ready.</h3><p>In Settings, select <strong>Re-link WhatsApp</strong> to display a QR code. Scan it from WhatsApp → Settings → Linked Devices.</p><button className="button compact" type="button" onClick={() => finishOnboarding(true)}><Settings2 size={16} /> Open Settings</button></> : null}
      </div>
      <footer>
        <button className="button compact ghost" type="button" disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))}><ChevronLeft size={16} /> Back</button>
        {step < 2 ? <button className="button primary compact" type="button" onClick={() => setStep((current) => Math.min(2, current + 1))}>Continue <ChevronRight size={16} /></button> : <button className="button primary compact" type="button" onClick={() => finishOnboarding()}>Open AmirOS <Check size={16} /></button>}
      </footer>
    </section> : null}
    {releaseOpen ? <section className="release-dialog release-notes-dialog" role="dialog" aria-modal="true" aria-labelledby="amiros-release-title">
      <header>
        <span className="release-dialog-icon"><Sparkles size={24} /></span>
        <div><small>What’s new in v{release.version}</small><h2 id="amiros-release-title">{release.headline}</h2></div>
        <button className="icon-button" type="button" aria-label="Close release notes" onClick={closeRelease}><X size={18} /></button>
      </header>
      <div className="release-notes-body">
        <p className="release-date">Released {new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(new Date(`${release.releasedAt}T12:00:00`))}</p>
        <div className="release-note-list">{release.notes.map((note) => <article key={note.title}><span><Check size={15} /></span><div><h3>{note.title}</h3><p>{note.detail}</p></div></article>)}</div>
      </div>
      <footer><button className="button primary compact" type="button" onClick={closeRelease}>Got it</button><button className="button compact ghost" type="button" onClick={() => { closeRelease(); setStep(0); setOnboardingOpen(true); }}>Replay setup</button></footer>
    </section> : null}
  </div>;
}
