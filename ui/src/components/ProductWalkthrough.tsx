import {
  ArrowLeft,
  ArrowRight,
  Check,
  CloudSun,
  Clock3,
  MessageCircleMore,
  MessageSquareText,
  Search,
  Sparkles,
  UsersRound,
  X,
} from "lucide-react";

type ProductWalkthroughProps = {
  step: number;
  onStepChange: (step: number) => void;
  onFinish: () => void;
  onChoosePeople: () => void;
};

const steps = [
  { title: "Overview", icon: Sparkles, route: "overview" },
  { title: "Timezones", icon: Clock3, route: "overview" },
  { title: "Reply help", icon: MessageSquareText, route: "inbox" },
  { title: "Inbox", icon: MessageCircleMore, route: "inbox" },
  { title: "Ask AmirOS", icon: Search, route: "overview" },
] as const;

function OverviewExample() {
  return <div className="walkthrough-example walkthrough-overview-example"><div className="walkthrough-example-heading"><span>SAMPLE CARD</span><strong>Tuesday, 9:42 AM</strong></div><div className="walkthrough-overview-grid"><article><small>FOLLOW-UP</small><strong>Reply to Maya about Friday</strong><p>She asked to confirm the restaurant.</p></article><article><small>PLAN</small><strong>Flight to Lisbon next week</strong><p>From a conversation with Jordan.</p></article><article><small>COMMITMENT</small><strong>Send the final proposal</strong><p>Due today · client conversation.</p></article></div></div>;
}

function TimezoneExample() {
  return <div className="walkthrough-example walkthrough-timezone-example"><article className="overview-timezone-card period-morning walkthrough-timezone-tel" data-art-tone="dark"><span className="overview-timezone-city">Tel Aviv</span><time>09:42 AM</time><span className="overview-timezone-weather"><CloudSun className="overview-timezone-weather-icon" size={22} />26° · Partly cloudy</span></article><article className="overview-timezone-card period-night walkthrough-timezone-new-york" data-art-tone="dark"><span className="overview-timezone-city">New York</span><time>02:42 AM</time><span className="overview-timezone-weather"><CloudSun className="overview-timezone-weather-icon" size={22} />19° · Clear</span></article><p><strong>Overview → Add world clock → search for a city → Select.</strong></p></div>;
}

function ReplyExample() {
  return <div className="walkthrough-example walkthrough-reply-example"><div className="walkthrough-message received">“Can we move Friday’s call to the afternoon?”</div><div className="walkthrough-message suggested"><small>DRAFT REPLY</small><strong>Friday afternoon works for me. Does 3:00 PM suit you?</strong></div><div><button type="button" disabled>Rewrite</button><button type="button" disabled>Insert in chat</button></div></div>;
}

function InboxExample() {
  return <div className="walkthrough-example walkthrough-inbox-example"><header><span><img src="/demo-avatars/sana.png" alt="" /><span><strong>Sana Farooq</strong><small>Private chat · connected</small></span></span><span className="walkthrough-inbox-live"><i /> Live</span></header><div className="walkthrough-inbox-messages"><p className="received">Can you send the final pricing sheet before the meeting?</p><p className="sent">Yes — I’ll send the concise version today.</p><p className="received">Perfect. Thank you.</p></div><div className="walkthrough-inbox-composer">Write a message <span>⌘ ↵</span></div></div>;
}

export function ProductWalkthrough({ step, onStepChange, onFinish, onChoosePeople }: ProductWalkthroughProps) {
  const current = steps[step] || steps[0];
  const Icon = current.icon;
  const isLast = step === steps.length - 1;
  const Example = step === 0 ? OverviewExample : step === 1 ? TimezoneExample : step === 2 ? ReplyExample : InboxExample;
  const copy = step === 0
    ? { eyebrow: "YOUR OVERVIEW", heading: "See the things that deserve your attention.", body: "Overview brings together plans, promises, follow-ups, and relationship context. The sample card shows the kind of useful signal AmirOS can surface once you choose people." }
    : step === 1
      ? { eyebrow: "TIMEZONES", heading: "Know when it is a good time to reach out.", body: "Add up to four cities from Overview when friends, family, or work span timezones. A local-time glance helps you avoid an accidental 2 AM message." }
      : step === 2
        ? { eyebrow: "REPLY HELP", heading: "Keep your voice. Spend less time drafting.", body: "AmirOS can prepare an optional draft from the conversation. You can edit it, regenerate it, insert it into chat, or ignore it — the message always remains yours." }
        : step === 3
          ? { eyebrow: "YOUR INBOX", heading: "Keep WhatsApp familiar — with helpful context nearby.", body: "Read and send messages normally. Reply help stays optional, and AmirOS keeps each person’s writing context separate rather than applying one voice everywhere." }
          : { eyebrow: "ASK AMIROS", heading: "Ask for the context you do not want to lose.", body: "This is the kind of grounded answer Ask can provide after you build your first People profile. It grows more useful as you choose people and keep using AmirOS." };

  return <div className={`product-walkthrough-backdrop product-walkthrough-step-${step}`} role="presentation">
    <div className="product-tour-scrim" />
    {step === 4 ? null : <div className={`product-tour-demo product-tour-demo-${current.route}`} aria-hidden="true"><Example /></div>}
    <section className="product-walkthrough" role="dialog" aria-modal="true" aria-labelledby="product-walkthrough-title">
      <header><div className="product-walkthrough-brand"><span><Sparkles size={17} /></span><strong>AmirOS tour</strong></div><button type="button" className="icon-button" aria-label="Skip product tour" onClick={onFinish}><X size={18} /></button></header>
      <div className="product-walkthrough-progress" aria-label={`Tour step ${step + 1} of ${steps.length}`}>{steps.map((item, index) => <span key={item.title} className={index === step ? "active" : index < step ? "complete" : ""}><i>{index < step ? <Check size={11} /> : index + 1}</i><b>{item.title}</b></span>)}</div>
      <div className="product-walkthrough-body"><span className="product-walkthrough-icon"><Icon size={21} /></span><div className="product-walkthrough-copy"><small>{copy.eyebrow}</small><h2 id="product-walkthrough-title">{copy.heading}</h2><p>{copy.body}</p></div><div className="product-walkthrough-note"><UsersRound size={15} /><span>{step === 4 ? "This answer and its sources are sample information, not your conversations." : "The highlighted card is sample information, not your conversations."}</span></div></div>
      <footer><button type="button" className="button compact ghost" disabled={step === 0} onClick={() => onStepChange(step - 1)}><ArrowLeft size={15} /> Back</button><button type="button" className="text-action" onClick={onFinish}>Skip tour</button><button type="button" className="button primary compact" onClick={() => isLast ? onChoosePeople() : onStepChange(step + 1)}>{isLast ? "Choose people" : "Next"}{isLast ? <UsersRound size={15} /> : <ArrowRight size={15} />}</button></footer>
    </section>
  </div>;
}
