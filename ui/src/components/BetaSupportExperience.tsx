import { ArrowLeft, Bug, Check, Clipboard, ExternalLink, HeartHandshake, LifeBuoy, Lightbulb, Mail, Paperclip, Wrench, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BETA_SUPPORT_CATEGORIES, betaSupportQuestions, browserLabel, buildBetaSupportReport, featureAreaForView, highLevelConnection, supportAction, validationError, type BetaSupportCategory, type BetaSupportDraft } from "../beta-support";
import type { DashboardData, ViewName } from "../types";

type Props = {
  open: boolean;
  onClose: () => void;
  destination: DashboardData["betaSupport"];
  version: string;
  connection: DashboardData["connection"];
  currentView: ViewName;
};

const categoryIcons = { Bug, Feedback: HeartHandshake, "Feature request": Lightbulb, "Setup help": Wrench } satisfies Record<BetaSupportCategory, typeof Bug>;

export function BetaSupportExperience({ open, onClose, destination, version, connection, currentView }: Props) {
  const [step, setStep] = useState<"choose" | "details">("choose");
  const [draft, setDraft] = useState<BetaSupportDraft>({ category: "Bug", featureArea: featureAreaForView(currentView), trying: "", happened: "", expected: "", includeDiagnostics: false });
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const closeRef = useRef(onClose);
  const action = supportAction(destination);
  const questions = betaSupportQuestions[draft.category];
  const diagnostics = draft.includeDiagnostics ? { version, build: destination.build, timestamp: new Date().toISOString(), browser: browserLabel(navigator.userAgent), connection: highLevelConnection(connection.status), featureArea: draft.featureArea } : undefined;
  const report = useMemo(() => buildBetaSupportReport(draft, diagnostics), [draft, diagnostics]);

  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    setStep("choose");
    setError(undefined);
    setNotice(undefined);
    setDraft((value) => ({ ...value, featureArea: featureAreaForView(currentView) }));
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") closeRef.current(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, currentView]);

  if (!open) return null;
  const update = <K extends keyof BetaSupportDraft>(key: K, value: BetaSupportDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const chooseCategory = (category: BetaSupportCategory) => {
    setDraft({ category, featureArea: featureAreaForView(currentView), trying: "", happened: "", expected: "", includeDiagnostics: false });
    setError(undefined);
    setNotice(undefined);
    setStep("details");
  };
  const validate = () => { const nextError = validationError(draft); setError(nextError); return !nextError; };
  const copy = async () => {
    if (!validate()) return false;
    try { await navigator.clipboard.writeText(report); setNotice("Feedback report copied. You choose where to share it."); return true; }
    catch { setNotice("Your browser could not copy the report. Select the report below and copy it manually."); return false; }
  };
  const continueToDestination = async () => {
    if (!validate()) return;
    if (action === "copy") { await copy(); return; }
    const copied = await copy();
    if (action === "url" && destination.url) { window.open(destination.url, "_blank", "noopener,noreferrer"); setNotice(copied ? "Support form opened. Paste the copied report there." : "Support form opened. Copy the report below and paste it there."); }
    if (action === "email" && destination.email) { window.location.assign(`mailto:${destination.email}?subject=${encodeURIComponent(`AmirOS beta feedback: ${draft.category}`)}&body=${encodeURIComponent(report)}`); setNotice("An email draft was opened. Attach a screenshot there if it would help, then review and send it yourself."); }
  };
  const destinationButton = action === "url" ? <><ExternalLink size={16} />Open support form</> : action === "email" ? <><Mail size={16} />Open email draft</> : <><Clipboard size={16} />Copy feedback report</>;

  return <div className="beta-support-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="beta-support-dialog" role="dialog" aria-modal="true" aria-labelledby="beta-support-title">
      <header>
        <span className="beta-support-icon"><LifeBuoy size={23} /></span>
        <div><small>PRIVATE BETA · STEP {step === "choose" ? "1" : "2"} OF 2</small><h2 id="beta-support-title">{step === "choose" ? "How can we help?" : questions.title}</h2></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close help and feedback"><X size={19} /></button>
      </header>
      {step === "choose" ? <div className="beta-support-body beta-support-choose">
        <p className="beta-support-intro">Choose one option. You’ll see a short form with only the questions that fit.</p>
        <div className="beta-support-category-grid" aria-label="Choose feedback type">
          {BETA_SUPPORT_CATEGORIES.map((category) => { const Icon = categoryIcons[category]; return <button key={category} type="button" onClick={() => chooseCategory(category)}><span><Icon size={20} /></span><strong>{category}</strong><small>{category === "Bug" ? "Something did not work as expected" : category === "Feedback" ? "Share what feels useful or frustrating" : category === "Feature request" ? "Suggest an improvement you would use" : "Get help with getting started"}</small></button>; })}
        </div>
        <p className="beta-support-privacy-note">Nothing is sent automatically. You can review the report before opening the beta support email.</p>
      </div> : <form className="beta-support-body" onSubmit={(event) => { event.preventDefault(); void continueToDestination(); }}>
        <button className="beta-support-back" type="button" onClick={() => { setStep("choose"); setError(undefined); setNotice(undefined); }}><ArrowLeft size={15} />Choose a different option</button>
        <p className="beta-support-intro">{questions.description}</p>
        <label>Where did this happen?<input value={draft.featureArea} maxLength={80} onChange={(event) => update("featureArea", event.target.value)} /></label>
        <label>{questions.trying} <b>Required</b><textarea value={draft.trying} maxLength={1_500} onChange={(event) => update("trying", event.target.value)} /></label>
        <label>{questions.happened} <b>Required</b><textarea value={draft.happened} maxLength={1_500} onChange={(event) => update("happened", event.target.value)} /></label>
        {questions.expected ? <label>{questions.expected} <em>Optional</em><textarea value={draft.expected} maxLength={1_500} onChange={(event) => update("expected", event.target.value)} /></label> : null}
        <aside className="beta-support-screenshot"><Paperclip size={18} /><span><strong>Have a screenshot?</strong><small>Your email draft will include this report. Attach the screenshot in your email app before sending. Screenshots may contain private conversations, names, calendar details, or QR codes. Do not include API keys or QR codes.</small></span></aside>
        <label className="beta-support-diagnostics"><input type="checkbox" checked={draft.includeDiagnostics} onChange={(event) => update("includeDiagnostics", event.target.checked)} /><span><strong>Include basic technical details to help diagnose this</strong><small>Includes the AmirOS version, time, device, connection status, and selected area. It does not include your conversations or saved data.</small></span></label>
        {error ? <p className="beta-support-error"><Bug size={16} />{error}</p> : null}
        {notice ? <p className="beta-support-notice"><Check size={16} />{notice}</p> : null}
        {action === "copy" ? <p className="beta-support-unconfigured">Beta support has not yet been configured. Copy your report and share it through your agreed beta channel.</p> : null}
        {notice ? <label className="beta-support-report"><span>Feedback report</span><textarea readOnly value={report} aria-label="Feedback report to copy" /></label> : null}
        <footer><button className="button" type="button" onClick={onClose}>Close</button><button className="button primary" type="submit">{destinationButton}</button></footer>
      </form>}
    </section>
  </div>;
}
