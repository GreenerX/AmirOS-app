import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  BadgeCheck,
  Bell,
  CalendarClock,
  ChevronDown,
  CircleHelp,
  CirclePause,
  CircleUserRound,
  Download,
  FileClock,
  KeyRound,
  Laptop,
  LifeBuoy,
  LogOut,
  Mail,
  Menu,
  MonitorCog,
  MoreHorizontal,
  PauseCircle,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import { approveAndInviteBetaApplication, approveDeviceActivation, archiveBetaApplication, createAdminRelease, createManualBetaApplication, createSupportTicket, getAccountSnapshot, getAdminOverview, getAdminReleases, setAdminReleaseChannel, updateAdminDevice, updateAdminSupportTicket, updateAdminUser, updateBetaApplication, updateBetaApplicationProfile } from "./api";
import { renderCommunicationTemplate, type CommunicationTemplateKey } from "./communication-templates";
import { demoAccount, demoTickets, demoUsers } from "./demo-data";
import { acceptInvitation, createAccount, identityAllowsSignup, initialiseIdentity, isIdentityAvailable, observeIdentity, resetPassword, signIn, signOut, type ControlCenterUser } from "./identity";
import type { AccessStatus, AccountSnapshot, ActivationChecklist, AdminUser, BetaApplication, BetaApplicationState, FeatureAssignment, ReleaseChannel, ReleaseControlSnapshot, SetupState, SupportTicket } from "./types";

const amirosMark = "/amiros-mark-v2-cropped.png";

const productName = import.meta.env.VITE_PRODUCT_NAME || "AmirOS";
// Keep account downloads functional in every deploy context. The environment
// variable remains available when the release host changes in the future.
const defaultDownloadUrl = "https://github.com/GreenerX/AmirOS-app/releases/latest/download/AmirOS-latest.zip";
const downloadUrl = import.meta.env.VITE_DOWNLOAD_URL || defaultDownloadUrl;
const waitlistUrl =
  import.meta.env.VITE_WAITLIST_URL ||
  "https://amiros-early-access.netlify.app/landing-page/#early-access";
// Demo state is compiled out of production builds. A URL parameter alone must
// never disclose the admin surface or pretend that a user is authenticated.
const demoEnabled = import.meta.env.DEV;
const demoOperator: ControlCenterUser = { id: "demo-operator", email: "operator@example.com", displayName: "Admin", roles: ["admin"] };

type Page = "account" | "admin" | "download" | "connect";
type AuthMode = "sign-in" | "sign-up";
type AdminSection = "overview" | "applicants" | "testers" | "devices" | "rollouts" | "releases" | "flags" | "support" | "audit" | "communications";

const adminSections: Array<{ id: AdminSection; label: string; icon: typeof MonitorCog }> = [
  { id: "overview", label: "Overview", icon: MonitorCog },
  { id: "applicants", label: "Applicants", icon: Users },
  { id: "testers", label: "Testers", icon: Users },
  { id: "devices", label: "Devices & access", icon: Laptop },
  { id: "rollouts", label: "Rollouts", icon: ArrowDownToLine },
  { id: "releases", label: "Releases", icon: FileClock },
  { id: "flags", label: "Feature flags", icon: SlidersHorizontal },
  { id: "support", label: "Support", icon: LifeBuoy },
  { id: "communications", label: "Communications", icon: Mail },
];

function currentPage(): Page {
  return window.location.pathname.startsWith("/admin") ? "admin" : window.location.pathname.startsWith("/download") ? "download" : window.location.pathname.startsWith("/connect") ? "connect" : "account";
}

function currentAdminSection(): AdminSection {
  const segment = window.location.pathname.replace(/^\/admin\/?/, "").split("/")[0];
  return adminSections.some((section) => section.id === segment) || segment === "audit" ? (segment || "overview") as AdminSection : "overview";
}

function adminPath(section: AdminSection): string {
  return section === "overview" ? "/admin/" : `/admin/${section}/`;
}

function accessLabel(status: AccessStatus): string {
  return status === "active" ? "Active" : status === "paused" ? "Paused" : "Revoked";
}

function channelLabel(channel: ReleaseChannel): string {
  return channel === "internal" ? "Internal" : channel === "beta" ? "Beta" : "Stable";
}

function setupLabel(state: SetupState): string {
  return state === "active" ? "Mac connected" : state === "device_pending" ? "Connect Mac" : "Invite required";
}

function applicationStateLabel(state: BetaApplicationState): string {
  return state === "requested" ? "Requested" : state === "reviewing" ? "Reviewing" : state === "approved" ? "Approved" : state === "invited" ? "Invite sent" : state === "device_pending" ? "Connect Mac" : state === "active" ? "Active" : "Declined";
}

export function App() {
  const [page, setPage] = useState<Page>(currentPage);
  const [user, setUser] = useState<ControlCenterUser>();
  const [invitationToken, setInvitationToken] = useState<string>();
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [loadingIdentity, setLoadingIdentity] = useState(true);
  const [identityAvailable, setIdentityAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([initialiseIdentity(), isIdentityAvailable()]).then(([initialState, available]) => {
      if (active) {
        setUser(initialState.user || (demoEnabled ? demoOperator : undefined));
        setInvitationToken(initialState.invitationToken);
        setPasswordRecovery(Boolean(initialState.passwordRecovery));
        setLoadingIdentity(false);
        setIdentityAvailable(available);
      }
    });
    const unsubscribe = observeIdentity((nextUser) => {
      setUser(nextUser);
      setIdentityAvailable(true);
    });
    const onPopstate = () => setPage(currentPage());
    window.addEventListener("popstate", onPopstate);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("popstate", onPopstate);
    };
  }, []);

  const navigate = (nextPage: Page) => {
    const destination = nextPage === "admin" ? "/admin/" : nextPage === "download" ? "/download/" : "/account/";
    window.history.pushState({}, "", destination);
    setPage(nextPage);
  };

  if (loadingIdentity) return <LoadingScreen />;

  if (passwordRecovery) {
    return <AuthScreen
      identityAvailable={identityAvailable}
      passwordRecovery
      onAuthenticated={(nextUser) => {
        setUser(nextUser);
        setPasswordRecovery(false);
      }}
    />;
  }

  if (!user && page !== "download") {
    return <AuthScreen
      identityAvailable={identityAvailable}
      invitationToken={invitationToken}
      onAuthenticated={(nextUser) => {
        setUser(nextUser);
        setInvitationToken(undefined);
        setPasswordRecovery(false);
      }}
    />;
  }

  if (page === "connect") {
    return <DeviceConnectionPage onNavigate={navigate} />;
  }

  if (page === "admin") {
    const canAdmin = user?.roles.includes("admin") || demoEnabled;
    return canAdmin
      ? <AdminDashboard user={user} onNavigate={navigate} onSignOut={() => void signOut().then(() => setUser(undefined))} />
      : <NotAuthorized onNavigate={navigate} />;
  }

  return <AccountPortal user={user} onNavigate={navigate} onSignOut={() => void signOut().then(() => setUser(undefined))} />;
}

function LoadingScreen() {
  return <main className="loading-screen"><header className="loading-brand"><Brand /></header><div><img className="brand-mark" src={amirosMark} alt="" /><p>Opening your AmirOS Control Center…</p></div><footer className="loading-footer"><CopyrightNotice /></footer></main>;
}

function DeviceConnectionPage({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const activationCode = new URLSearchParams(window.location.search).get("code") || "";
  const [state, setState] = useState<"idle" | "working" | "approved" | "error">("idle");
  const [message, setMessage] = useState("");

  const approve = async () => {
    if (!activationCode) return;
    setState("working");
    setMessage("");
    const result = await approveDeviceActivation(activationCode);
    if (result.data) {
      setState("approved");
      setMessage("This Mac is approved. Return to AmirOS and it will finish connecting automatically.");
    } else {
      setState("error");
      setMessage(result.message || "This Mac could not be approved. Return to AmirOS and start again.");
    }
  };

  return <main className="not-authorized">
    <Brand />
    <section>
      <MonitorCog size={34} />
      <h1>{activationCode ? "Connect this Mac?" : "Open this from AmirOS."}</h1>
      <p>{activationCode ? "Approve the Mac that requested access. AmirOS will send only its device credential, version, and access check—never conversations, memory, WhatsApp material, or API keys." : "In AmirOS, open Settings and select Connect this Mac. Then return here using the link it opens."}</p>
      {message ? <p className="form-message" role="status">{message}</p> : null}
      {activationCode && state !== "approved" ? <button className="button button-primary" disabled={state === "working"} onClick={() => void approve()}>{state === "working" ? "Approving…" : "Approve this Mac"}</button> : null}
      {state === "approved" || !activationCode ? <button className="button button-secondary" onClick={() => onNavigate("account")}>Go to your account</button> : null}
    </section>
    <footer className="not-authorized-footer"><CopyrightNotice /></footer>
  </main>;
}

function AuthScreen({ identityAvailable, invitationToken, passwordRecovery = false, onAuthenticated }: { identityAvailable: boolean; invitationToken?: string; passwordRecovery?: boolean; onAuthenticated: (user: ControlCenterUser | undefined) => void }) {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [signupAllowed, setSignupAllowed] = useState(false);
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const completingInvitation = Boolean(invitationToken);
  const settingPassword = completingInvitation || passwordRecovery;

  useEffect(() => {
    void identityAllowsSignup().then(setSignupAllowed);
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (settingPassword && password !== passwordConfirmation) {
      setMessage("Passwords do not match. Please try again.");
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      const nextUser = completingInvitation
        ? await acceptInvitation(invitationToken!, password, name)
        : passwordRecovery
          ? await resetPassword(password)
        : mode === "sign-in"
          ? await signIn(email, password)
          : await createAccount(email, password, name);
      onAuthenticated(nextUser);
      setMessage(settingPassword ? "Your password has been updated." : mode === "sign-up" ? "Check your email to confirm your account, then return here to sign in." : "You’re signed in.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We couldn’t complete that request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="auth-shell">
    <header className="auth-header"><Brand /><a className="quiet-link" href={waitlistUrl}>Request access <ArrowUpRight size={15} /></a></header>
    <section className="auth-panel" aria-labelledby="auth-title">
      <div className="auth-copy">
        <p className="section-index">Private access</p>
        <h1 id="auth-title">A calmer way to get started.</h1>
        <p>Your account unlocks the Mac app, beta updates, and a secure place to get help. Conversations and memory remain on your Mac.</p>
        <div className="auth-points">
          <span><ShieldCheck size={17} />Private by design</span>
          <span><Laptop size={17} />Built for your Mac</span>
          <span><LifeBuoy size={17} />Direct beta support</span>
        </div>
      </div>
      <div className="auth-card">
        <div className="auth-card-heading"><h2>{completingInvitation ? "Create your password" : passwordRecovery ? "Set a new password" : mode === "sign-in" ? "Sign in" : "Create your account"}</h2><p>{completingInvitation ? "Finish your invitation to unlock your Control Center." : passwordRecovery ? "Choose a new password to restore your AmirOS Control Center access." : mode === "sign-in" ? "Use the invitation details you set up." : "Your invitation will determine your access."}</p></div>
        {!identityAvailable && <div className="setup-callout"><ShieldAlert size={17} /><span>Account invitations are being enabled for this private beta. You’ll receive an email when your access is ready.</span></div>}
        <form onSubmit={submit} className="auth-form">
          {(completingInvitation || (!settingPassword && mode === "sign-up")) && <label>Full name<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></label>}
          {!settingPassword && <label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required /></label>}
          <label>{passwordRecovery ? "New password" : "Password"}<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={settingPassword || mode === "sign-up" ? "new-password" : "current-password"} minLength={8} required /></label>
          {settingPassword && <label>Confirm password<input value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} type="password" autoComplete="new-password" minLength={8} required /></label>}
          {message && <p className="form-message" role="status">{message}</p>}
          <button className="button button-primary" disabled={!identityAvailable || submitting} type="submit">{submitting ? "Please wait…" : completingInvitation ? "Finish setup" : passwordRecovery ? "Save new password" : mode === "sign-in" ? "Sign in" : "Create account"}<ArrowUpRight size={17} /></button>
        </form>
        {!settingPassword && <div className="auth-switch">
          {mode === "sign-in" && signupAllowed ? <button type="button" onClick={() => setMode("sign-up")}>Have an invitation but no account? Create one</button> : null}
          {mode === "sign-up" ? <button type="button" onClick={() => setMode("sign-in")}>Already have an account? Sign in</button> : null}
          {!signupAllowed && <a href={waitlistUrl}>Need an invitation? Request early access</a>}
        </div>}
      </div>
    </section>
    <footer className="auth-footer"><span><CopyrightNotice /></span><span>Privacy</span><span>Terms</span></footer>
  </main>;
}

function AccountPortal({ user, onNavigate, onSignOut }: { user?: ControlCenterUser; onNavigate: (page: Page) => void; onSignOut: () => void }) {
  const [snapshot, setSnapshot] = useState<AccountSnapshot | undefined>(demoEnabled ? demoAccount : undefined);
  const [apiMessage, setApiMessage] = useState<string | undefined>();
  const [supportOpen, setSupportOpen] = useState(() => new URLSearchParams(window.location.search).get("support") === "1");
  const [ticketType, setTicketType] = useState<SupportTicket["type"]>("Bug");
  const [subject, setSubject] = useState("");
  const [details, setDetails] = useState("");
  const [ticketMessage, setTicketMessage] = useState<string | undefined>();

  useEffect(() => {
    if (!user) return;
    void getAccountSnapshot().then((result) => {
      if (result.data) setSnapshot(result.data);
      else if (result.status !== 401) setApiMessage(result.message);
    });
  }, [user]);

  const account = snapshot;
  const activationInProgress = Boolean(account && account.activation.nextAction.id !== "complete");
  const openSupport = () => {
    setSupportOpen(true);
    window.setTimeout(() => document.getElementById("support")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };
  const submitTicket = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await createSupportTicket({ type: ticketType, subject, details });
    if (result.data) {
      setTicketMessage(`Ticket ${result.data.ticket.id} is ready for the support team.`);
      setSubject(""); setDetails("");
    } else setTicketMessage(result.message);
  };

  return <main className="portal-shell">
    <PortalHeader page="account" user={user} onNavigate={onNavigate} onSignOut={onSignOut} />
    <section className="portal-hero"><div><p className="section-index">Account</p><h1>{activationInProgress ? "Your AmirOS setup." : "Your access, devices, and updates."}</h1><p>{activationInProgress ? account?.activation.nextAction.description : "Everything needed to keep your personal assistant running smoothly—without sending your conversations to us."}</p></div>{account ? <StatusCard status={account.status} expiresAt={account.expiresAt} /> : <div className="status-card status-empty"><CircleHelp size={21} /><span>Connect your Control Center database to show account status.</span></div>}</section>
    {apiMessage && <div className="service-notice"><CircleHelp size={18} /><span>{apiMessage}</span></div>}
    <section className="portal-grid" aria-label="Your account controls">
      {account ? <ActivationChecklistCard checklist={account.activation} setupState={account.setupState} onNavigate={onNavigate} onOpenSupport={openSupport} /> : null}
      {account && account.setupState === "active" ? <>
      <article className="download-card">
        <div className="app-icon"><MonitorCog size={34} /></div>
        <div className="download-copy"><h2>{productName} for Mac</h2><p>Private help with the people, plans, and details you choose to remember.</p><small>macOS 13 or later · Apple Silicon or Intel</small></div>
        <div className="download-action"><a className="button button-primary" href={downloadUrl}>Download for Mac <Download size={17} /></a><span>Latest public beta · Safe local installer</span></div>
      </article>
      <article className="detail-card"><CardHeading icon={Laptop} title="Authorized devices" description="Only signed-in Macs can use your access." />
        {account?.devices.length ? account.devices.map((device) => <div className="device-row" key={device.id}><div className="device-icon"><Laptop size={19} /></div><div><strong>{device.label}</strong><span>{device.platform} · {device.appVersion} · {device.lastSeenAt}</span></div>{device.isCurrent && <span className="soft-tag">This Mac</span>}<button className="icon-button" aria-label={`More options for ${device.label}`}><MoreHorizontal size={19} /></button></div>) : <EmptyCopy text="Your signed-in Mac will appear here after device authorization." />}
      </article>
      <article className="detail-card"><CardHeading icon={CalendarClock} title="Updates" description="The private beta team manages update availability for your AmirOS install." />
        <div className="channel-control"><div><strong>Managed private beta</strong><span>When a tested update is ready for your Mac, AmirOS will let you know.</span></div></div>
      </article>
      </> : null}
      <article className="detail-card support-card" id="support"><CardHeading icon={LifeBuoy} title="Help and feedback" description="Send a focused report to the team when you choose." />
        <button className="button button-secondary" onClick={() => setSupportOpen((open) => !open)}>{supportOpen ? "Close support form" : "Open support"} <ArrowUpRight size={16} /></button>
        {supportOpen && <form className="support-form" onSubmit={submitTicket}><label>Type<select value={ticketType} onChange={(event) => setTicketType(event.target.value as SupportTicket["type"])}><option>Bug</option><option>Feedback</option><option>Feature request</option><option>Setup help</option></select></label><label>Short subject<input value={subject} onChange={(event) => setSubject(event.target.value)} required maxLength={140} /></label><label>What should we know?<textarea value={details} onChange={(event) => setDetails(event.target.value)} required maxLength={6000} /></label><p>Only the details you write are sent. Conversations, API keys, QR codes, and local memory are never attached automatically.</p>{ticketMessage && <span className="form-message">{ticketMessage}</span>}<button className="button button-primary" type="submit">Send to support <Send size={16} /></button></form>}
      </article>
      <article className="privacy-card"><div className="privacy-icon"><ShieldCheck size={23} /></div><div><h2>Private by design</h2><p>Your conversations and AmirOS memory stay on your Mac. The Control Center manages access, updates, and support—not your personal history.</p></div><a href="#privacy" className="text-link">Learn about privacy <ArrowUpRight size={15} /></a></article>
    </section>
    <footer className="portal-footer"><CopyrightNotice /></footer>
  </main>;
}

function ActivationChecklistCard({ checklist, setupState, onNavigate, onOpenSupport }: { checklist: ActivationChecklist; setupState: SetupState; onNavigate: (page: Page) => void; onOpenSupport: () => void }) {
  const action = checklist.nextAction;
  return <article className="activation-checklist">
    <div className="activation-checklist-heading"><div><p className="section-index">Beta checklist · {checklist.completedCount} of {checklist.totalCount}</p><h2>{action.id === "complete" ? "You’re ready for AmirOS." : "One clear next step."}</h2><p>{action.description}</p></div><span className={`activation-count ${action.id === "complete" ? "is-complete" : ""}`}>{checklist.completedCount}/{checklist.totalCount}</span></div>
    <ol className="activation-steps">{checklist.steps.map((step, index) => <li className={`activation-step is-${step.state}`} key={step.id}><span className="activation-step-mark">{step.state === "complete" ? <BadgeCheck size={18} /> : index + 1}</span><div><strong>{step.title}</strong><p>{step.description}</p></div><span className="activation-step-state">{step.state === "complete" ? "Done" : step.state === "current" ? "Next" : "Later"}</span></li>)}</ol>
    <div className="activation-next-action">
      <div><strong>{action.label}</strong><p>{action.target === "local_amiros" ? "Continue on your approved Mac in the AmirOS app." : action.description}</p></div>
      {action.target === "control_center_support" ? <button className="button button-primary" onClick={onOpenSupport}>Ask for activation <ArrowUpRight size={16} /></button> : null}
      {action.target === "control_center_connect" ? <button className="button button-primary" onClick={() => onNavigate("connect")}>Open connection help <ArrowUpRight size={16} /></button> : null}
      {action.target === "local_amiros" ? <span className="local-action-label">Next in AmirOS</span> : null}
      {action.target === "none" ? <span className="local-action-label is-complete">All set</span> : null}
    </div>
    {setupState === "device_pending" ? <p className="activation-download-note"><a className="text-link" href={downloadUrl}>Download AmirOS for Mac <Download size={15} /></a> if it is not already installed.</p> : null}
  </article>;
}

function AdminDashboard({ user, onNavigate, onSignOut }: { user?: ControlCenterUser; onNavigate: (page: Page) => void; onSignOut: () => void }) {
  const [section, setSection] = useState<AdminSection>(currentAdminSection);
  const [selectedId, setSelectedId] = useState<string | undefined>(demoEnabled ? demoUsers[0]?.id : undefined);
  const [users, setUsers] = useState<AdminUser[]>(demoEnabled ? demoUsers : []);
  const [applications, setApplications] = useState<BetaApplication[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>(demoEnabled ? demoTickets : []);
  const [releaseControl, setReleaseControl] = useState<ReleaseControlSnapshot>({ channels: [], releases: [] });
  const [invitingApplicationId, setInvitingApplicationId] = useState<string>();
  const [selectedTicketId, setSelectedTicketId] = useState<number | undefined>(demoEnabled ? demoTickets[0]?.ticketId : undefined);
  const [apiMessage, setApiMessage] = useState<string | undefined>();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const selected = users.find((item) => item.id === selectedId) || users[0];
  const selectedTicket = tickets.find((ticket) => ticket.ticketId === selectedTicketId) || tickets[0];
  const activeCount = users.filter((item) => item.status === "active" && item.setupState === "active").length;
  const setStatus = (status: AccessStatus) => {
    if (!selected) return;
    if (demoEnabled) {
      setUsers((items) => items.map((item) => item.id === selected.id ? { ...item, status } : item));
      return;
    }
    void updateAdminUser({ userId: selected.id, accessStatus: status }).then((result) => {
      if (result.data) setUsers((items) => items.map((item) => item.id === selected.id ? { ...item, status } : item));
      else setApiMessage(result.message);
    });
  };
  const setReleaseChannel = (releaseChannel: ReleaseChannel) => {
    if (!selected) return;
    if (demoEnabled) {
      setUsers((items) => items.map((item) => item.id === selected.id ? { ...item, releaseChannel } : item));
      return;
    }
    void updateAdminUser({ userId: selected.id, releaseChannel }).then((result) => {
      if (result.data) setUsers((items) => items.map((item) => item.id === selected.id ? { ...item, releaseChannel } : item));
      else setApiMessage(result.message);
    });
  };
  const setUserProfile = (firstName: string, lastName: string) => {
    if (!selected) return;
    if (demoEnabled) {
      setUsers((items) => items.map((item) => item.id === selected.id ? { ...item, firstName, lastName, displayName: `${firstName} ${lastName}` } : item));
      return;
    }
    void updateAdminUser({ userId: selected.id, firstName, lastName }).then((result) => {
      if (result.data) setUsers((items) => items.map((item) => item.id === selected.id ? { ...item, firstName, lastName, displayName: `${firstName} ${lastName}` } : item));
      else setApiMessage(result.message);
    });
  };
  const toggleFeature = (featureId: string) => {
    if (!selected) return;
    const feature = selected.features.find((item) => item.id === featureId);
    if (!feature) return;
    const enabled = !feature.enabled;
    if (demoEnabled) {
      setUsers((items) => items.map((item) => item.id !== selected.id ? item : { ...item, features: item.features.map((item) => item.id === featureId ? { ...item, enabled } : item) }));
      return;
    }
    void updateAdminUser({ userId: selected.id, featureId, enabled }).then((result) => {
      if (result.data) setUsers((items) => items.map((item) => item.id !== selected.id ? item : { ...item, features: item.features.map((item) => item.id === featureId ? { ...item, enabled } : item) }));
      else setApiMessage(result.message);
    });
  };
  const setDeviceStatus = (deviceId: string, accessStatus: AccessStatus) => {
    if (!selected) return;
    const device = selected.devices.find((item) => item.id === deviceId);
    if (!device || device.status === accessStatus) return;
    if (accessStatus === "revoked" && !window.confirm(`Revoke ${device.label}? This Mac will need to be reconnected from AmirOS before it can use the account again.`)) return;
    if (demoEnabled) {
      setUsers((items) => items.map((item) => item.id !== selected.id ? item : { ...item, devices: item.devices.map((candidate) => candidate.id === deviceId ? { ...candidate, status: accessStatus, isCurrent: accessStatus === "active" } : candidate) }));
      return;
    }
    void updateAdminDevice({ deviceId, accessStatus }).then((result) => {
      if (result.data) setUsers((items) => items.map((item) => item.id !== selected.id ? item : { ...item, devices: item.devices.map((candidate) => candidate.id === deviceId ? { ...candidate, status: accessStatus, isCurrent: accessStatus === "active" } : candidate) }));
      else setApiMessage(result.message);
    });
  };
  const setTicketState = (state: SupportTicket["state"]) => {
    if (!selectedTicket || selectedTicket.state === state) return;
    if (demoEnabled) {
      setTickets((items) => items.map((ticket) => ticket.ticketId === selectedTicket.ticketId ? { ...ticket, state } : ticket));
      return;
    }
    void updateAdminSupportTicket({ ticketId: selectedTicket.ticketId, state }).then((result) => {
      if (result.data) setTickets((items) => items.map((ticket) => ticket.ticketId === selectedTicket.ticketId ? { ...ticket, state } : ticket));
      else setApiMessage(result.message);
    });
  };
  const setApplicationState = (applicationId: string, state: BetaApplicationState) => {
    if (demoEnabled) {
      setApplications((items) => items.map((item) => item.id === applicationId ? { ...item, state } : item));
      return;
    }
    void updateBetaApplication({ applicationId, state }).then((result) => {
      if (result.data) setApplications((items) => items.map((item) => item.id === applicationId ? { ...item, state } : item));
      else setApiMessage(result.message);
    });
  };
  const refreshOverview = () => {
    if (demoEnabled) return;
    void getAdminOverview().then((result) => {
      if (result.data) {
        setUsers(result.data.users); setTickets(result.data.tickets); setApplications(result.data.applications);
      } else setApiMessage(result.message);
    });
  };
  const addManualApplicant = (input: { firstName: string; lastName: string; email: string; internalNote?: string }) => {
    if (demoEnabled) return Promise.resolve(undefined);
    return createManualBetaApplication(input).then((result) => { if (result.data) { setApiMessage(`${input.firstName} was added as a manual applicant.`); refreshOverview(); } else setApiMessage(result.message); return result; });
  };
  const editApplicant = (input: { applicationId: string; firstName: string; lastName: string; email: string; internalNote?: string }) => {
    if (demoEnabled) return Promise.resolve(undefined);
    return updateBetaApplicationProfile(input).then((result) => { if (result.data) { setApiMessage("Applicant profile updated."); refreshOverview(); } else setApiMessage(result.message); return result; });
  };
  const archiveApplicant = (applicationId: string, archived: boolean) => {
    if (demoEnabled) return Promise.resolve(undefined);
    return archiveBetaApplication({ applicationId, archived }).then((result) => { if (result.data) { setApiMessage(archived ? "Declined applicant archived." : "Applicant restored to the declined list."); refreshOverview(); } else setApiMessage(result.message); return result; });
  };
  const approveAndInvite = (application: BetaApplication) => {
    if (!window.confirm(`Approve ${application.fullName} and send Netlify's secure invitation to ${application.email}?`)) return;
    if (demoEnabled) {
      setApplications((items) => items.map((item) => item.id === application.id ? { ...item, state: "invited", invitedAt: new Date().toISOString() } : item));
      return;
    }
    setInvitingApplicationId(application.id);
    void approveAndInviteBetaApplication({ applicationId: application.id }).then((result) => {
      if (result.data) {
        setApplications((items) => items.map((item) => item.id === application.id ? { ...item, state: "invited", invitedAt: result.data?.invitedAt || new Date().toISOString() } : item));
        setApiMessage(result.data.delivery === "sent" ? `Secure invitation sent to ${application.email}.` : `${application.email} already has an Identity account, so no duplicate invitation was sent.`);
      } else setApiMessage(result.message);
    }).finally(() => setInvitingApplicationId(undefined));
  };
  const refreshReleases = () => {
    if (demoEnabled) return;
    void getAdminReleases().then((result) => {
      if (result.data) setReleaseControl(result.data);
      else setApiMessage(result.message);
    });
  };
  const createRelease = (input: { channel: ReleaseChannel; version: string; downloadUrl: string; sha256: string; releaseNotesUrl?: string }) => {
    if (demoEnabled) return Promise.resolve(undefined);
    return createAdminRelease(input).then((result) => {
      if (result.data) {
        setApiMessage(`Release ${input.version} was saved. It will not prompt testers until its channel is made available.`);
        refreshReleases();
      } else setApiMessage(result.message);
      return result;
    });
  };
  const setReleaseAvailability = (channel: ReleaseChannel, mode: "hold" | "available", releaseId?: number) => {
    if (demoEnabled) return Promise.resolve(undefined);
    return setAdminReleaseChannel({ channel, mode, releaseId }).then((result) => {
      if (result.data) {
        setApiMessage(mode === "hold" ? `${channelLabel(channel)} updates are now on hold.` : `${channelLabel(channel)} now offers its approved release.`);
        refreshReleases();
      } else setApiMessage(result.message);
      return result;
    });
  };

  useEffect(() => {
    if (!user || demoEnabled) return;
    void getAdminOverview().then((result) => {
      if (result.data) {
        setUsers(result.data.users);
        setTickets(result.data.tickets);
        setApplications(result.data.applications);
        setSelectedId((current) => current && result.data?.users.some((item) => item.id === current) ? current : result.data?.users[0]?.id);
        setSelectedTicketId((current) => current && result.data?.tickets.some((ticket) => ticket.ticketId === current) ? current : result.data?.tickets[0]?.ticketId);
      } else setApiMessage(result.message);
    });
    refreshReleases();
  }, [user]);

  useEffect(() => {
    const onPopstate = () => setSection(currentAdminSection());
    window.addEventListener("popstate", onPopstate);
    return () => window.removeEventListener("popstate", onPopstate);
  }, []);

  const navigateSection = (nextSection: AdminSection) => {
    window.history.pushState({}, "", adminPath(nextSection));
    setSection(nextSection);
    setMobileNavOpen(false);
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const openUser = (id: string, target: AdminSection = "testers") => {
    setSelectedId(id);
    navigateSection(target);
  };

  const attention = getAttentionItems(users, applications, tickets);
  const currentVersion = mostReportedVersion(users);
  const content = section === "overview"
    ? <AdminOverviewPage activeCount={activeCount} applications={applications} users={users} tickets={tickets} attention={attention} currentVersion={currentVersion} onOpenSection={navigateSection} onOpenUser={openUser} />
    : section === "applicants"
      ? <AdminApplicantsPage applications={applications} onState={setApplicationState} onInvite={approveAndInvite} onCreate={addManualApplicant} onEdit={editApplicant} onArchive={archiveApplicant} invitingApplicationId={invitingApplicationId} />
      : section === "testers"
        ? <AdminTestersPage users={users} selected={selected} onSelect={setSelectedId} onStatus={setStatus} onProfile={setUserProfile} onReleaseChannel={setReleaseChannel} onToggleFeature={toggleFeature} onDeviceStatus={setDeviceStatus} />
        : section === "devices"
          ? <AdminDevicesPage users={users} onOpenUser={openUser} />
          : section === "rollouts"
            ? <AdminRolloutsPage users={users} currentVersion={currentVersion} onOpenUser={openUser} />
            : section === "releases"
              ? <AdminReleasesPage users={users} currentVersion={currentVersion} releaseControl={releaseControl} onCreate={createRelease} onSetAvailability={setReleaseAvailability} />
              : section === "flags"
                ? <AdminFeatureFlagsPage users={users} selected={selected} onSelect={setSelectedId} onToggleFeature={toggleFeature} />
                : section === "support"
                  ? <AdminSupportPage tickets={tickets} selectedTicket={selectedTicket} onSelect={setSelectedTicketId} onState={setTicketState} />
                  : section === "audit"
                    ? <AdminAuditPage />
                    : <AdminCommunicationsPage users={users} applications={applications} />;

  return <main className="admin-shell">
    <button className="mobile-menu-button" aria-label="Open admin navigation" onClick={() => setMobileNavOpen(true)}><Menu size={21} /></button>
    <AdminNav activeSection={section} open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} onNavigate={onNavigate} onNavigateSection={navigateSection} />
    <section className="admin-main">
      <header className="admin-topbar"><div><p className="section-index">Control Center</p><h1>{adminSectionTitle(section)}</h1></div><div className="topbar-actions"><button className="icon-button" aria-label="Notifications"><Bell size={19} /></button><button className="profile-button"><span>{user?.displayName?.slice(0, 2).toUpperCase() || "AD"}</span><ChevronDown size={16} /></button><button className="text-button" onClick={onSignOut}>Sign out <LogOut size={15} /></button></div></header>
      <div className="admin-context"><span><span className="live-dot" />{demoEnabled ? "Demo workspace" : "Control Center database"}</span><p>{demoEnabled ? "Preview controls are local only until the Control Center database is connected." : "Operational account records and administrator controls are live."}</p></div>
      {apiMessage && <div className="service-notice"><CircleHelp size={18} /><span>{apiMessage}</span></div>}
      {content}
      <footer className="admin-footer"><CopyrightNotice /></footer>
    </section>
  </main>;
}

function PortalHeader({ page, user, onNavigate, onSignOut }: { page: Page; user?: ControlCenterUser; onNavigate: (page: Page) => void; onSignOut: () => void }) {
  const isAdmin = user?.roles.includes("admin");
  return <header className="portal-header"><Brand /><nav aria-label="Control Center navigation"><button className={page === "download" ? "nav-active" : ""} onClick={() => onNavigate("download")}>Download</button><button className={page === "account" ? "nav-active" : ""} onClick={() => onNavigate("account")}>Account</button>{isAdmin && <button className={page === "admin" ? "nav-active" : ""} onClick={() => onNavigate("admin")}>Admin</button>}<a href="#support">Support</a></nav><div className="header-account"><span>{user?.displayName?.slice(0, 2).toUpperCase() || user?.email?.slice(0, 2).toUpperCase() || "AC"}</span><button className="icon-button" aria-label="Sign out" onClick={onSignOut}><LogOut size={17} /></button></div></header>;
}

function Brand() { return <a className="brand" href="/account/"><img className="brand-mark" src={amirosMark} alt="" /><span>AmirOS</span></a>; }

function CopyrightNotice() { return <>© 2026 Amir Friedman. All rights reserved.</>; }

function StatusCard({ status, expiresAt }: { status: AccessStatus; expiresAt?: string }) { return <div className={`status-card status-${status}`}><BadgeCheck size={21} /><div><strong>{accessLabel(status)}</strong><span>{status === "active" ? expiresAt ? `Access confirmed through ${expiresAt}.` : "Your access is ready." : status === "paused" ? "Access is temporarily paused." : "Access has been revoked."}</span></div></div>; }

function CardHeading({ icon: Icon, title, description }: { icon: typeof Laptop; title: string; description: string }) { return <div className="card-heading"><span className="card-heading-icon"><Icon size={20} /></span><div><h2>{title}</h2><p>{description}</p></div></div>; }

function EmptyCopy({ text }: { text: string }) { return <p className="empty-copy">{text}</p>; }

function AdminNav({ activeSection, open, onClose, onNavigate, onNavigateSection }: { activeSection: AdminSection; open: boolean; onClose: () => void; onNavigate: (page: Page) => void; onNavigateSection: (section: AdminSection) => void }) {
  const link = (section: AdminSection, label: string, Icon: typeof MonitorCog) => <a key={section} className={activeSection === section ? "is-active" : ""} href={adminPath(section)} onClick={(event) => { event.preventDefault(); onNavigateSection(section); }}><Icon size={18} />{label}</a>;
  return <aside className={`admin-nav ${open ? "is-open" : ""}`}>
    <div className="admin-nav-header"><Brand /><button className="icon-button mobile-only" aria-label="Close navigation" onClick={onClose}><X size={19} /></button></div>
    <nav aria-label="Admin navigation">{adminSections.map(({ id, label, icon }) => link(id, label, icon))}</nav>
    <div className="admin-nav-footer">
      <button className="emergency-button" type="button" onClick={() => onNavigateSection("rollouts")}><PauseCircle size={18} />Emergency pause</button>
      <button className="audit-link" type="button" onClick={() => onNavigateSection("audit")}><FileClock size={17} />Audit log</button>
      <button className="text-button" onClick={() => onNavigate("account")}>View account portal <ArrowUpRight size={14} /></button>
    </div>
  </aside>;
}

function adminSectionTitle(section: AdminSection): string {
  return section === "flags" ? "Feature flags" : adminSections.find((item) => item.id === section)?.label || (section === "audit" ? "Audit log" : "Overview");
}

function mostReportedVersion(users: AdminUser[]): string {
  const versions = users.map((user) => user.appVersion).filter((version) => version && version !== "—");
  if (!versions.length) return "—";
  return [...new Set(versions)].sort((left, right) => right.localeCompare(left, undefined, { numeric: true })).at(0) || "—";
}

type AttentionItem = { id: string; label: string; detail: string; count: number; section: AdminSection; userId?: string };

function getAttentionItems(users: AdminUser[], applications: BetaApplication[], tickets: SupportTicket[]): AttentionItem[] {
  const review = applications.filter((application) => application.state === "requested" || application.state === "reviewing");
  const invited = applications.filter((application) => application.state === "approved" || application.state === "invited");
  const pendingMac = users.filter((user) => user.setupState === "device_pending");
  const incomplete = users.filter((user) => user.setupState === "active" && user.activation.nextAction.id !== "complete");
  const openTickets = tickets.filter((ticket) => ticket.state !== "Resolved");
  const currentVersion = mostReportedVersion(users);
  const outdated = users.filter((user) => user.appVersion !== "—" && currentVersion !== "—" && user.appVersion !== currentVersion);
  const items: AttentionItem[] = [
    { id: "review", label: "Applications awaiting review", detail: "Review each request before sending a secure invitation.", count: review.length, section: "applicants" },
    { id: "invited", label: "Invitation follow-up", detail: "Approved or invited applicants who have not yet reached device setup.", count: invited.length, section: "applicants" },
    { id: "mac", label: "Mac connection pending", detail: "Accounts that still need an approved Mac.", count: pendingMac.length, section: "devices", userId: pendingMac[0]?.id },
    { id: "setup", label: "Setup needs attention", detail: "Active testers with a remaining optional beta checklist step.", count: incomplete.length, section: "testers", userId: incomplete[0]?.id },
    { id: "updates", label: "Version follow-up", detail: currentVersion === "—" ? "No connected Mac has reported a version yet." : `Connected Macs not yet reporting ${currentVersion}.`, count: outdated.length, section: "releases", userId: outdated[0]?.id },
    { id: "support", label: "Open support tickets", detail: "Tester-submitted requests still awaiting resolution.", count: openTickets.length, section: "support" },
  ];
  return items.filter((item) => item.count > 0);
}

function AdminOverviewPage({ activeCount, applications, users, tickets, attention, currentVersion, onOpenSection, onOpenUser }: { activeCount: number; applications: BetaApplication[]; users: AdminUser[]; tickets: SupportTicket[]; attention: AttentionItem[]; currentVersion: string; onOpenSection: (section: AdminSection) => void; onOpenUser: (id: string, section?: AdminSection) => void }) {
  const pendingApplications = applications.filter((application) => application.state === "requested" || application.state === "reviewing").length;
  const currentCount = users.filter((user) => user.appVersion === currentVersion).length;
  return <>
    <section className="metric-row"><Metric label="Attention needed" value={String(attention.reduce((total, item) => total + item.count, 0))} detail="A small, privacy-safe beta queue" icon={CircleHelp} /><Metric label="Active testers" value={String(activeCount)} detail="Mac paired and active" icon={Users} /><Metric label="Current release" value={users.length && currentVersion !== "—" ? `${Math.round((currentCount / users.length) * 100)}%` : "—"} detail={currentVersion === "—" ? "No Mac version reported" : `${currentVersion} adoption`} icon={ArrowDownToLine} /></section>
    <section className="admin-overview-grid">
      <article className="overview-list-panel"><div className="panel-heading"><div><h2>Attention today</h2><p>Only the operational signals that need a human decision.</p></div></div>{attention.length ? <div className="attention-list">{attention.map((item) => <button type="button" key={item.id} onClick={() => item.userId ? onOpenUser(item.userId, item.section) : onOpenSection(item.section)}><span><strong>{item.label}</strong><small>{item.detail}</small></span><b>{item.count}</b><ArrowUpRight size={16} /></button>)}</div> : <EmptyCopy text="Nothing needs attention right now. Your pilot is clear." />}</article>
      <article className="overview-list-panel"><div className="panel-heading"><div><h2>Release health</h2><p>Reported only by connected Macs—never from private AmirOS data.</p></div></div><dl className="health-list"><div><dt>Latest reported version</dt><dd>{currentVersion}</dd></div><div><dt>Current channel mix</dt><dd>{users.filter((user) => user.releaseChannel === "beta").length} beta · {users.filter((user) => user.releaseChannel === "stable").length} stable</dd></div><div><dt>Open support</dt><dd>{tickets.filter((ticket) => ticket.state !== "Resolved").length} tickets</dd></div><div><dt>Applicant pipeline</dt><dd>{pendingApplications} awaiting review</dd></div></dl><button className="text-button overview-action" onClick={() => onOpenSection("releases")}>Review releases <ArrowUpRight size={14} /></button></article>
    </section>
  </>;
}

function AdminApplicantsPage({ applications, onState, onInvite, onCreate, onEdit, onArchive, invitingApplicationId }: {
  applications: BetaApplication[];
  onState: (applicationId: string, state: BetaApplicationState) => void;
  onInvite: (application: BetaApplication) => void;
  onCreate: (input: { firstName: string; lastName: string; email: string; internalNote?: string }) => Promise<unknown>;
  onEdit: (input: { applicationId: string; firstName: string; lastName: string; email: string; internalNote?: string }) => Promise<unknown>;
  onArchive: (applicationId: string, archived: boolean) => Promise<unknown>;
  invitingApplicationId?: string;
}) { return <ApplicantPanel applications={applications} onState={onState} onInvite={onInvite} onCreate={onCreate} onEdit={onEdit} onArchive={onArchive} invitingApplicationId={invitingApplicationId} />; }

function AdminTestersPage({ users, selected, onSelect, onStatus, onProfile, onReleaseChannel, onToggleFeature, onDeviceStatus }: { users: AdminUser[]; selected?: AdminUser; onSelect: (id: string) => void; onStatus: (status: AccessStatus) => void; onProfile: (firstName: string, lastName: string) => void; onReleaseChannel: (channel: ReleaseChannel) => void; onToggleFeature: (featureId: string) => void; onDeviceStatus: (deviceId: string, status: AccessStatus) => void }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | AccessStatus>("all");
  const matchingUsers = useMemo(() => users.filter((user) => `${user.displayName} ${user.email}`.toLowerCase().includes(query.toLowerCase()) && (statusFilter === "all" || user.status === statusFilter)), [query, statusFilter, users]);
  return <section className="admin-columns"><div className="user-panel"><div className="panel-heading"><div><h2>Testers</h2><p>Accounts, setup state, and release access—never personal AmirOS content.</p></div><div className="table-actions"><label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search testers" /></label><select className="compact-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | AccessStatus)}><option value="all">All access</option><option value="active">Active</option><option value="paused">Paused</option><option value="revoked">Revoked</option></select></div></div><UserTable users={matchingUsers} selectedId={selected?.id} onSelect={onSelect} /><div className="table-footer"><span>Showing {matchingUsers.length} Control Center accounts</span><span>Operational metadata only.</span></div></div><aside className="user-detail">{selected ? <SelectedUser selected={selected} onStatus={onStatus} onProfile={onProfile} onReleaseChannel={onReleaseChannel} onToggleFeature={onToggleFeature} onDeviceStatus={onDeviceStatus} /> : <EmptyCopy text="Select a tester to review setup, device access, and feature assignments." />}</aside></section>;
}

function AdminDevicesPage({ users, onOpenUser }: { users: AdminUser[]; onOpenUser: (id: string, section?: AdminSection) => void }) {
  const [query, setQuery] = useState("");
  const devices = users.flatMap((user) => user.devices.map((device) => ({ user, device })));
  const matching = devices.filter(({ user, device }) => `${user.displayName} ${user.email} ${device.label} ${device.appVersion}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="admin-data-panel"><div className="panel-heading"><div><h2>Devices & access</h2><p>Each Mac must be paired by its signed-in tester. Access and setup remain separate.</p></div><div className="table-actions"><label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search devices" /></label></div></div>{matching.length ? <div className="operational-table"><div className="operational-table-head"><span>Tester</span><span>Mac</span><span>Version</span><span>Last check-in</span><span>Access</span></div>{matching.map(({ user, device }) => <button type="button" className="operational-table-row" key={device.id} onClick={() => onOpenUser(user.id)}><span><strong>{user.displayName}</strong><small>{user.email}</small></span><span>{device.label}<small>{device.platform}</small></span><span>{device.appVersion}</span><span>{device.lastSeenAt}</span><span><StatusPill status={device.status} /></span></button>)}</div> : <EmptyCopy text={devices.length ? "No devices match this search." : "Paired Macs will appear here after their testers approve the connection."} />}</section>;
}

function AdminRolloutsPage({ users, currentVersion, onOpenUser }: { users: AdminUser[]; currentVersion: string; onOpenUser: (id: string, section?: AdminSection) => void }) {
  const channelRows: ReleaseChannel[] = ["stable", "beta", "internal"];
  const outOfDate = users.filter((user) => user.appVersion !== "—" && currentVersion !== "—" && user.appVersion !== currentVersion);
  return <div className="admin-page-stack"><section className="admin-data-panel" id="emergency-pause"><div className="panel-heading"><div><h2>Rollout controls</h2><p>Channels are assigned per account. A global release hold is intentionally not configured yet.</p></div></div><div className="rollout-summary">{channelRows.map((channel) => <article key={channel}><strong>{channelLabel(channel)}</strong><span>{users.filter((user) => user.releaseChannel === channel).length} testers</span><small>{channel === "stable" ? "Validated public release channel" : channel === "beta" ? "Early improvements with support coverage" : "Internal testing only"}</small></article>)}</div></section><section className="admin-data-panel"><div className="panel-heading"><div><h2>Needs a release check</h2><p>{currentVersion === "—" ? "No paired device has reported an app version yet." : `These testers are not yet reporting ${currentVersion}.`}</p></div></div>{outOfDate.length ? <div className="attention-list">{outOfDate.map((user) => <button type="button" key={user.id} onClick={() => onOpenUser(user.id)}><span><strong>{user.displayName}</strong><small>{user.appVersion} reported · {channelLabel(user.releaseChannel)} channel</small></span><ArrowUpRight size={16} /></button>)}</div> : <EmptyCopy text="All reporting Macs are on the latest version known to the Control Center." />}</section></div>;
}

function AdminReleasesPage({ users, currentVersion, releaseControl, onCreate, onSetAvailability }: {
  users: AdminUser[];
  currentVersion: string;
  releaseControl: ReleaseControlSnapshot;
  onCreate: (input: { channel: ReleaseChannel; version: string; downloadUrl: string; sha256: string; releaseNotesUrl?: string }) => Promise<unknown>;
  onSetAvailability: (channel: ReleaseChannel, mode: "hold" | "available", releaseId?: number) => Promise<unknown>;
}) {
  const versions = [...new Set(users.map((user) => user.appVersion).filter((version) => version !== "—"))].sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  const [channel, setChannel] = useState<ReleaseChannel>("beta");
  const [version, setVersion] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [sha256, setSha256] = useState("");
  const [releaseNotesUrl, setReleaseNotesUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true);
    try {
      await onCreate({ channel, version, downloadUrl, sha256, releaseNotesUrl: releaseNotesUrl || undefined });
      setVersion(""); setDownloadUrl(""); setSha256(""); setReleaseNotesUrl("");
    } finally { setSaving(false); }
  };
  return <div className="admin-page-stack">
    <section className="admin-data-panel"><div className="panel-heading"><div><h2>Managed update rollout</h2><p>Paired Macs receive a manual update prompt only when their assigned channel is explicitly available.</p></div></div><div className="release-channel-grid">{(["internal", "beta", "stable"] as ReleaseChannel[]).map((item) => {
      const control = releaseControl.channels.find((candidate) => candidate.channel === item);
      const activeRelease = releaseControl.releases.find((candidate) => candidate.id === control?.approvedReleaseId);
      const options = releaseControl.releases.filter((candidate) => candidate.channel === item);
      return <article className="release-channel-card" key={item}><div><span className={`soft-tag ${control?.mode === "available" ? "is-active" : ""}`}>{control?.mode === "available" ? "Available" : "Hold"}</span><h3>{channelLabel(item)}</h3><p>{control?.mode === "available" && activeRelease ? `${activeRelease.version} is approved for a manual prompt.` : "No managed update prompt is shown."}</p></div><label>Approved release<select value={control?.approvedReleaseId || ""} disabled={!options.length || saving} onChange={(event) => { const id = Number(event.target.value); const selected = options.find((candidate) => candidate.id === id); if (selected && window.confirm(`Make ${selected.version} available to ${channelLabel(item)} testers?`)) void onSetAvailability(item, "available", id); }}><option value="">{options.length ? "Choose a tested release" : "No release entered"}</option>{options.map((release) => <option key={release.id} value={release.id}>{release.version}</option>)}</select></label><div className="release-card-actions"><button className="button button-secondary" type="button" disabled={!control?.approvedReleaseId || saving} onClick={() => { if (window.confirm(`Hold future ${channelLabel(item)} update prompts? Local access remains unchanged.`)) void onSetAvailability(item, "hold"); }}>Hold updates</button>{activeRelease?.releaseNotesUrl ? <a className="text-link" href={activeRelease.releaseNotesUrl} target="_blank" rel="noreferrer">Release notes <ArrowUpRight size={14} /></a> : null}</div></article>;
    })}</div><p className="admin-page-note">Hold stops future prompts. It does not pause access, revoke a Mac, or uninstall anything.</p></section>
    <section className="admin-data-panel"><div className="panel-heading"><div><h2>Enter tested release</h2><p>Control Center records a verified artifact; it never uploads installers or publishes GitHub releases.</p></div></div><form className="release-form" onSubmit={submit}><label>Channel<select value={channel} onChange={(event) => setChannel(event.target.value as ReleaseChannel)}><option value="beta">Beta</option><option value="stable">Stable</option><option value="internal">Internal</option></select></label><label>Version<input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="0.10.12" required maxLength={80} /></label><label>Download URL<input value={downloadUrl} onChange={(event) => setDownloadUrl(event.target.value)} type="url" placeholder="https://…" required /></label><label>SHA-256<input value={sha256} onChange={(event) => setSha256(event.target.value.toLowerCase())} placeholder="64-character lowercase hash" required pattern="[a-f0-9]{64}" /></label><label>Release notes URL <span>(optional)</span><input value={releaseNotesUrl} onChange={(event) => setReleaseNotesUrl(event.target.value)} type="url" placeholder="https://…" /></label><button className="button button-primary" disabled={saving} type="submit">{saving ? "Saving…" : "Save tested release"}</button></form></section>
    <section className="admin-data-panel"><div className="panel-heading"><div><h2>Reported version health</h2><p>Derived from active Control Center device check-ins.</p></div></div>{versions.length ? <div className="operational-table"><div className="operational-table-head"><span>Version</span><span>Devices reporting</span><span>Share</span><span>Current status</span></div>{versions.map((item) => { const count = users.filter((user) => user.appVersion === item).length; return <div className="operational-table-row release-row" key={item}><span><strong>{item}</strong></span><span>{count}</span><span>{Math.round((count / users.length) * 100)}%</span><span>{item === currentVersion ? <span className="soft-tag">Latest reported</span> : "Earlier version"}</span></div>; })}</div> : <EmptyCopy text="Release health will appear after a paired Mac checks in with its app version." />}</section>
  </div>;
}

function AdminFeatureFlagsPage({ users, selected, onSelect, onToggleFeature }: { users: AdminUser[]; selected?: AdminUser; onSelect: (id: string) => void; onToggleFeature: (featureId: string) => void }) {
  const [query, setQuery] = useState("");
  const matching = users.filter((user) => `${user.displayName} ${user.email}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="admin-columns"><div className="user-panel"><div className="panel-heading"><div><h2>Feature assignments</h2><p>Choose a tester to review their assigned product capabilities.</p></div><div className="table-actions"><label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search testers" /></label></div></div><UserTable users={matching} selectedId={selected?.id} onSelect={onSelect} /><div className="table-footer"><span>Showing {matching.length} accounts · feature changes are server-authorized and audit logged.</span></div></div><aside className="user-detail">{selected ? <div className="selected-user"><div className="selected-header"><span className="selected-avatar">{selected.initials}</span><div><h2>{selected.displayName}</h2><p>{selected.email}</p><p>Account feature assignments</p></div></div><section><h3>Feature access</h3><div className="feature-list">{selected.features.map((feature) => <label key={feature.id}><div><strong>{feature.name}</strong><span>{feature.description}</span></div><button className={`toggle ${feature.enabled ? "is-on" : ""}`} role="switch" aria-checked={feature.enabled} aria-label={`Toggle ${feature.name}`} onClick={() => onToggleFeature(feature.id)}><i /></button></label>)}</div></section><p className="detail-footnote">The interface requests a change; server-side entitlement enforcement remains the authority.</p></div> : <EmptyCopy text="Select a tester to manage feature assignments." />}</aside></section>;
}

function AdminSupportPage({ tickets, selectedTicket, onSelect, onState }: { tickets: SupportTicket[]; selectedTicket?: SupportTicket; onSelect: (id: number) => void; onState: (state: SupportTicket["state"]) => void }) {
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<"all" | SupportTicket["state"]>("all");
  const matching = tickets.filter((ticket) => `${ticket.subject} ${ticket.reporter || ""} ${ticket.reporterEmail || ""}`.toLowerCase().includes(query.toLowerCase()) && (stateFilter === "all" || ticket.state === stateFilter));
  return <section className="support-panel"><div className="panel-heading"><div><h2>Support queue</h2><p>Only tester-submitted reports appear here.</p></div><div className="table-actions"><label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search support" /></label><select className="compact-select" value={stateFilter} onChange={(event) => setStateFilter(event.target.value as "all" | SupportTicket["state"])}><option value="all">All tickets</option><option value="New">New</option><option value="Investigating">Investigating</option><option value="Resolved">Resolved</option></select></div></div><div className="support-queue">{matching.length ? <><div className="ticket-list">{matching.map((ticket) => <TicketRow ticket={ticket} key={ticket.id} selected={ticket.ticketId === selectedTicket?.ticketId} onSelect={() => onSelect(ticket.ticketId)} />)}</div><aside className="ticket-detail">{selectedTicket ? <SelectedTicket ticket={selectedTicket} onState={onState} /> : <EmptyCopy text="Choose a support request to view it." />}</aside></> : <EmptyCopy text={tickets.length ? "No tickets match these filters." : "New support requests will appear here."} />}</div></section>;
}

function AdminAuditPage() { return <section className="admin-data-panel"><div className="panel-heading"><div><h2>Audit log</h2><p>Every current access, device, feature, invitation, and support-state change is recorded server-side.</p></div></div><div className="audit-empty"><FileClock size={24} /><div><strong>Read-only audit viewing is the next control-plane addition.</strong><p>The underlying actions are already audited, but this client does not yet expose an event-feed endpoint. Until it does, this page deliberately does not invent or cache audit history in the browser.</p></div></div></section>; }

function AdminCommunicationsPage({ users, applications }: { users: AdminUser[]; applications: BetaApplication[] }) {
  const [recipientId, setRecipientId] = useState("");
  const [template, setTemplate] = useState<CommunicationTemplateKey>("invite-guidance");
  const [personalAccessLink, setPersonalAccessLink] = useState("");
  const [customSubject, setCustomSubject] = useState("");
  const [customBody, setCustomBody] = useState("");
  const [copyState, setCopyState] = useState<"rich" | "plain" | "error" | "draft-opening" | "draft-rich" | "draft-fallback">();
  const recipients = [...applications.filter((application) => application.state !== "declined" && application.state !== "requested" && application.state !== "reviewing").map((application) => ({ id: `application:${application.id}`, name: application.fullName, email: application.email, state: applicationStateLabel(application.state) })), ...users.filter((user) => user.status !== "revoked").map((user) => ({ id: `user:${user.id}`, name: user.displayName, email: user.email, state: setupLabel(user.setupState) }))];
  const recipient = recipients.find((candidate) => candidate.id === recipientId);
  const usesPersonalLink = template === "personal-ai-access";
  const isBlankNote = template === "blank-note";
  const trimmedPersonalLink = personalAccessLink.trim();
  let securePersonalLink: string | undefined;
  try { const candidate = new URL(trimmedPersonalLink); if (candidate.protocol === "https:") securePersonalLink = candidate.toString(); } catch { /* The field stays client-only and is simply excluded until it is a secure URL. */ }
  const personalLinkInvalid = usesPersonalLink && Boolean(trimmedPersonalLink) && !securePersonalLink;
  const blankNoteIncomplete = isBlankNote && (!customSubject.trim() || !customBody.trim());
  const rendered = recipient ? renderCommunicationTemplate(template, recipient.name, { personalAccessLink: usesPersonalLink ? securePersonalLink : undefined, customSubject: isBlankNote ? customSubject : undefined, customBody: isBlankNote ? customBody : undefined }) : undefined;
  const canExport = Boolean(rendered) && !personalLinkInvalid && !blankNoteIncomplete;
  const notice = copyState === "rich" ? "Rich email content copied. Paste it into a compatible mail composer." : copyState === "plain" ? "Plain text copied. Add it to a message manually when you are ready." : copyState === "draft-opening" ? "Opening a default email draft with readable plain text. If no draft appears, use Copy plain text and Copy rich content below." : copyState === "draft-rich" ? "A default email draft was requested with readable plain text. Branded rich content is ready to paste; it was not inserted automatically." : copyState === "draft-fallback" ? "A default email draft was requested with readable plain text. Rich copy was unavailable, so use Copy rich content when your browser supports it." : copyState === "error" ? "Copy is not available in this browser. Download the HTML instead." : "";
  const clearNotice = () => window.setTimeout(() => setCopyState(undefined), 3500);
  const copyPlainText = () => { if (!rendered || !canExport || !navigator.clipboard) return; void navigator.clipboard.writeText(`Subject: ${rendered.subject}\n\n${rendered.plainText}`).then(() => { setCopyState("plain"); clearNotice(); }).catch(() => { setCopyState("error"); clearNotice(); }); };
  const copyRichContent = () => { if (!rendered || !canExport || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") { setCopyState("error"); clearNotice(); return; } const rich = new Blob([rendered.html], { type: "text/html" }); const plain = new Blob([`Subject: ${rendered.subject}\n\n${rendered.plainText}`], { type: "text/plain" }); void navigator.clipboard.write([new ClipboardItem({ "text/html": rich, "text/plain": plain })]).then(() => { setCopyState("rich"); clearNotice(); }).catch(() => { setCopyState("error"); clearNotice(); }); };
  const downloadHtml = () => { if (!rendered || !canExport) return; const link = document.createElement("a"); const objectUrl = URL.createObjectURL(new Blob([rendered.html], { type: "text/html;charset=utf-8" })); link.href = objectUrl; link.download = `amiros-${template}.html`; link.click(); window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0); };
  const mailtoHref = rendered && recipient && canExport ? `mailto:${encodeURIComponent(recipient.email)}?subject=${encodeURIComponent(rendered.subject)}&body=${encodeURIComponent(rendered.mailDraftText)}` : undefined;
  const prepareEmailDraft = () => { if (!rendered || !canExport) return; setCopyState("draft-opening"); clearNotice(); if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") { window.setTimeout(() => { setCopyState("draft-fallback"); clearNotice(); }, 0); return; } void navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([rendered.html], { type: "text/html" }), "text/plain": new Blob([`Subject: ${rendered.subject}\n\n${rendered.plainText}`], { type: "text/plain" }) })]).then(() => { setCopyState("draft-rich"); clearNotice(); }).catch(() => { setCopyState("draft-fallback"); clearNotice(); }); };
  const updateTemplate = (nextTemplate: CommunicationTemplateKey) => { setTemplate(nextTemplate); setCopyState(undefined); };
  return <section className="admin-communications"><div className="panel-heading"><div><h2>Communications</h2><p>Prepare a one-to-one branded message. This workspace previews and exports content; it does not send or track email.</p></div></div><div className="communications-grid"><label>Approved applicant or tester<select value={recipientId} onChange={(event) => { setRecipientId(event.target.value); setCopyState(undefined); }}><option value="">Choose a person</option>{recipients.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.state}</option>)}</select></label><label>Operational template<select value={template} onChange={(event) => updateTemplate(event.target.value as CommunicationTemplateKey)}><option value="invite-guidance">Invitation guidance</option><option value="welcome-setup">Welcome &amp; setup</option><option value="personal-ai-access">Personal AI access</option><option value="mac-setup">Set up or reconnect this Mac</option><option value="update-ready">New AmirOS update ready</option><option value="support-follow-up">Support follow-up</option><option value="blank-note">Blank branded note</option></select></label>{usesPersonalLink ? <section className="communication-editor personal-link-editor"><label>Optional secure personal link<input type="url" autoComplete="off" value={personalAccessLink} onChange={(event) => { setPersonalAccessLink(event.target.value); setCopyState(undefined); }} placeholder="Paste a secure HTTPS link" /></label><p>This field is empty by default and stays only in this open browser page. It is included only in the copied or downloaded email—never in Support, shared drafts, URLs, audit history, or telemetry.</p>{personalLinkInvalid ? <small>Use a complete HTTPS link or leave this field empty.</small> : null}</section> : null}{isBlankNote ? <section className="communication-editor"><label>Subject<input value={customSubject} onChange={(event) => { setCustomSubject(event.target.value); setCopyState(undefined); }} placeholder="Write a subject" /></label><label>Message<textarea value={customBody} onChange={(event) => { setCustomBody(event.target.value); setCopyState(undefined); }} placeholder="Write the note that should appear between the greeting and signature." rows={6} /></label><p>The greeting and AmirOS signature remain consistent. Subject and message are local to this open page until copied or downloaded.</p></section> : null}{rendered ? <><div className="email-preview-meta"><span>Preview only</span><strong>{rendered.subject || "Complete the blank note to preview its subject."}</strong><p>Open a readable plain-text draft, or copy/download branded content for manual review. Nothing is sent or inserted automatically.</p></div><iframe className="email-preview-frame" title="Branded AmirOS email preview" sandbox="allow-same-origin" srcDoc={rendered.html} /><div className="communications-actions">{mailtoHref ? <a className="button button-primary" href={mailtoHref} onClick={prepareEmailDraft}>Open email draft <Mail size={16} /></a> : <button className="button button-primary" type="button" disabled>Open email draft <Mail size={16} /></button>}<button className="button button-secondary" type="button" disabled={!canExport} onClick={copyRichContent}>Copy rich content</button><button className="button button-secondary" type="button" disabled={!canExport} onClick={copyPlainText}>Copy plain text</button><button className="button button-secondary" type="button" disabled={!canExport} onClick={downloadHtml}>Download HTML <Download size={16} /></button></div>{blankNoteIncomplete ? <p className="communications-notice">Add a subject and message before exporting this blank note.</p> : null}{notice ? <p className="communications-notice" role="status">{notice}</p> : null}</> : <div className="communication-empty"><Mail size={20} /><div><strong>Select an approved applicant or tester.</strong><p>The preview uses their first name only. No email address or account detail is included in the exported message.</p></div></div>}</div><p className="admin-page-note">The secure Netlify invitation remains the only account-activation email. This page never exposes credentials or private AmirOS data, makes no delivery claim, and does not support bulk campaigns.</p></section>;
}

function Metric({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: typeof Users }) { return <article className="metric"><span className="metric-icon"><Icon size={20} /></span><p>{label}</p><strong>{value}</strong><small>{detail}</small></article>; }

function ApplicantPanel({ applications, onState, onInvite, onCreate, onEdit, onArchive, invitingApplicationId }: {
  applications: BetaApplication[];
  onState: (applicationId: string, state: BetaApplicationState) => void;
  onInvite: (application: BetaApplication) => void;
  onCreate: (input: { firstName: string; lastName: string; email: string; internalNote?: string }) => Promise<unknown>;
  onEdit: (input: { applicationId: string; firstName: string; lastName: string; email: string; internalNote?: string }) => Promise<unknown>;
  onArchive: (applicationId: string, archived: boolean) => Promise<unknown>;
  invitingApplicationId?: string;
}) {
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<"active" | "all" | BetaApplicationState>("active");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const resetForm = () => { setAdding(false); setEditingId(undefined); setFirstName(""); setLastName(""); setEmail(""); setInternalNote(""); };
  const beginEdit = (application: BetaApplication) => { setAdding(false); setEditingId(application.id); const parts = application.fullName.trim().split(/\s+/); setFirstName(application.firstName || parts[0] || ""); setLastName(application.lastName || parts.slice(1).join(" ")); setEmail(application.email); setInternalNote(application.internalNote || ""); };
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (editingId) await onEdit({ applicationId: editingId, firstName, lastName, email, internalNote: internalNote || undefined }); else await onCreate({ firstName, lastName, email, internalNote: internalNote || undefined }); resetForm(); };
  const normalized = query.trim().toLowerCase();
  const visible = applications.filter((application) => {
    const stateMatches = stateFilter === "all" ? true : stateFilter === "active" ? !application.archivedAt && application.state !== "declined" : application.state === stateFilter;
    const textMatches = !normalized || `${application.fullName} ${application.email}`.toLowerCase().includes(normalized);
    return stateMatches && textMatches;
  });
  return <section className="applicant-panel" id="applicants"><div className="panel-heading"><div><h2>Beta applicants</h2><p>Approve a request to send Netlify’s secure account invitation.</p></div><div className="table-actions"><label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search applicants" /></label><select className="compact-select" value={stateFilter} onChange={(event) => setStateFilter(event.target.value as typeof stateFilter)}><option value="active">Active queue</option><option value="all">All applicants</option><option value="requested">Requested</option><option value="reviewing">Reviewing</option><option value="approved">Approved</option><option value="invited">Invite sent</option><option value="declined">Declined</option></select><button className="button button-primary" type="button" onClick={() => { resetForm(); setAdding(true); }}>Add applicant</button></div></div>{(adding || editingId) ? <form className="applicant-form" onSubmit={submit}><label>First name<input value={firstName} onChange={(event) => setFirstName(event.target.value)} required maxLength={80} /></label><label>Last name<input value={lastName} onChange={(event) => setLastName(event.target.value)} required maxLength={80} /></label><label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required /></label><label>Internal note <span>(optional)</span><input value={internalNote} onChange={(event) => setInternalNote(event.target.value)} maxLength={1000} placeholder="Operational context only" /></label><div><button className="button button-primary" type="submit">{editingId ? "Save profile" : "Add applicant"}</button><button className="text-button" type="button" onClick={resetForm}>Cancel</button></div><p>Manual entries are labelled separately from landing requests. They do not create an account or send an invitation until you approve them.</p></form> : null}{visible.length ? <div className="applicant-list">{visible.map((application) => <article className="applicant-row" key={application.id}><div><span className="source-chip">{application.source === "manual" ? "Added manually" : "Landing request"}</span><strong>{application.fullName}</strong><span>{application.email} · {application.archivedAt ? "Archived" : applicationStateLabel(application.state)}</span>{application.interest ? <p>{application.interest}</p> : null}{application.internalNote ? <small>Internal note: {application.internalNote}</small> : null}</div><div className="applicant-actions"><button className="button button-secondary" type="button" onClick={() => beginEdit(application)} disabled={application.state === "invited" || application.state === "active" || application.state === "device_pending"}>Edit</button><ApplicantActions application={application} onState={onState} onInvite={onInvite} inviting={invitingApplicationId === application.id} />{application.state === "declined" ? <button className="button button-secondary" type="button" onClick={() => { if (application.archivedAt || window.confirm(`Archive ${application.fullName}? You can restore the record later.`)) void onArchive(application.id, !application.archivedAt); }}>{application.archivedAt ? "Restore" : "Archive"}</button> : null}</div></article>)}</div> : <EmptyCopy text={applications.length ? "No applicants match these filters." : "New landing-page requests will appear here after the verified application intake is connected."} />}</section>;
}

function ApplicantActions({ application, onState, onInvite, inviting }: { application: BetaApplication; onState: (applicationId: string, state: BetaApplicationState) => void; onInvite: (application: BetaApplication) => void; inviting: boolean }) {
  const action = (state: BetaApplicationState, label: string) => <button className="button button-secondary" type="button" onClick={() => onState(application.id, state)}>{label}</button>;
  const invite = <button className="button button-primary" type="button" onClick={() => onInvite(application)} disabled={inviting}>{inviting ? "Sending…" : application.state === "approved" ? "Send secure invite" : "Approve & send invite"}</button>;
  if (application.state === "requested") return <div className="applicant-actions">{action("reviewing", "Review")}{invite}</div>;
  if (application.state === "reviewing") return <div className="applicant-actions">{action("declined", "Decline")}{invite}</div>;
  if (application.state === "approved") return <div className="applicant-actions">{invite}<NetlifyInviteFallback email={application.email} /></div>;
  if (application.state === "declined") return <div className="applicant-actions">{action("requested", "Reopen")}</div>;
  if (application.state === "invited") return <div className="applicant-actions"><span className="application-state">Invite sent{application.invitedAt ? ` · ${new Date(application.invitedAt).toLocaleDateString()}` : ""}</span><NetlifyInviteFallback email={application.email} /></div>;
  return <span className="application-state">{applicationStateLabel(application.state)}</span>;
}

function NetlifyInviteFallback({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);
  const copyEmail = () => {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(email).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }).catch(() => undefined);
  };
  return <><button className="button button-secondary" type="button" onClick={copyEmail}>{copied ? "Email copied" : "Copy email"}</button><a className="button button-secondary" href="https://app.netlify.com/projects/amiros-control-center/configuration/identity#users" target="_blank" rel="noreferrer">Open Netlify</a></>;
}

function UserTable({ users, selectedId, onSelect }: { users: AdminUser[]; selectedId?: string; onSelect: (id: string) => void }) { return <div className="user-table-wrap"><table className="user-table"><thead><tr><th>User</th><th>Email</th><th>Setup</th><th>Progress</th><th>Access</th><th>Device</th><th>Channel</th><th><span className="sr-only">Select</span></th></tr></thead><tbody>{users.map((item) => <tr className={item.id === selectedId ? "is-selected" : ""} key={item.id} onClick={() => onSelect(item.id)}><td><span className="user-initials">{item.initials}</span>{item.displayName}</td><td>{item.email}</td><td>{setupLabel(item.setupState)}</td><td><span className="activation-table-progress">{item.activation.completedCount}/{item.activation.totalCount}</span></td><td><StatusPill status={item.status} /></td><td>{item.devices.length ? `${item.devices.length} Mac${item.devices.length === 1 ? "" : "s"} · ${item.appVersion}` : "Not connected"}</td><td>{channelLabel(item.releaseChannel)}</td><td><button className="icon-button" aria-label={`Select ${item.displayName}`}><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table></div>; }

function StatusPill({ status }: { status: AccessStatus }) { return <span className={`status-pill ${status}`}><i />{accessLabel(status)}</span>; }

function SelectedUser({ selected, onStatus, onProfile, onReleaseChannel, onToggleFeature, onDeviceStatus }: { selected: AdminUser; onStatus: (status: AccessStatus) => void; onProfile: (firstName: string, lastName: string) => void; onReleaseChannel: (channel: ReleaseChannel) => void; onToggleFeature: (featureId: string) => void; onDeviceStatus: (deviceId: string, status: AccessStatus) => void }) {
  const parts = selected.displayName.trim().split(/\s+/);
  const [editingProfile, setEditingProfile] = useState(false);
  const [firstName, setFirstName] = useState(selected.firstName || parts[0] || "");
  const [lastName, setLastName] = useState(selected.lastName || parts.slice(1).join(" "));
  useEffect(() => { const next = selected.displayName.trim().split(/\s+/); setFirstName(selected.firstName || next[0] || ""); setLastName(selected.lastName || next.slice(1).join(" ")); setEditingProfile(false); }, [selected.id, selected.displayName, selected.firstName, selected.lastName]);
  return <div className="selected-user"><div className="selected-header"><span className="selected-avatar">{selected.initials}</span><div><h2>{selected.displayName}</h2><p>{selected.email}</p><p>Setup · {setupLabel(selected.setupState)} · {selected.activation.completedCount}/{selected.activation.totalCount} complete</p></div><button className="icon-button" aria-label={`Close ${selected.displayName} details`}><X size={18} /></button></div><section>{editingProfile ? <form className="profile-form" onSubmit={(event) => { event.preventDefault(); onProfile(firstName, lastName); setEditingProfile(false); }}><h3>Profile</h3><label>First name<input value={firstName} onChange={(event) => setFirstName(event.target.value)} required /></label><label>Last name<input value={lastName} onChange={(event) => setLastName(event.target.value)} required /></label><div><button className="button button-secondary" type="submit">Save profile</button><button className="text-button" type="button" onClick={() => setEditingProfile(false)}>Cancel</button></div></form> : <><h3>Profile</h3><p className="detail-footnote">Name and operational status are stored here. Email changes are handled through Identity recovery, not silently in the admin panel.</p><button className="text-button" onClick={() => setEditingProfile(true)}>Edit name</button></>}</section><section className="admin-activation-progress"><h3>Activation progress</h3><p>{selected.activation.nextAction.id === "complete" ? "Beta setup complete." : `Next: ${selected.activation.nextAction.label}`}</p><ol>{selected.activation.steps.map((step) => <li className={`is-${step.state}`} key={step.id}><span>{step.state === "complete" ? <BadgeCheck size={15} /> : ""}</span><strong>{step.title}</strong><em>{step.state === "complete" ? "Done" : step.state === "current" ? "Next" : "Later"}</em></li>)}</ol><p className="detail-footnote">If this tester is stuck, use Communications to prepare the matching one-to-one guidance. “Connect this Mac” recovery is available from AmirOS Settings.</p></section><section><h3>Access status</h3><div className="status-options">{(["active", "paused", "revoked"] as AccessStatus[]).map((status) => <button className={selected.status === status ? "is-active" : ""} key={status} onClick={() => onStatus(status)}><StatusPill status={status} /><span>{status === "active" ? "Can use assigned features." : status === "paused" ? "Keeps data local; blocks new entitlement checks." : "Access cannot renew."}</span></button>)}</div></section><section><h3>Release channel</h3><label className="select-wrap wide"><select value={selected.releaseChannel} onChange={(event) => onReleaseChannel(event.target.value as ReleaseChannel)}><option value="stable">Stable</option><option value="beta">Beta</option><option value="internal">Internal</option></select><ChevronDown size={17} /></label></section><section><h3>Authorized devices</h3><div className="device-control-list">{selected.devices.length ? selected.devices.map((device) => <article className="device-control" key={device.id}><div className="detail-device"><Laptop size={18} /><div><strong>{device.label} · {device.appVersion}</strong><span>{device.platform} · Last seen {device.lastSeenAt}</span></div></div><StatusPill status={device.status} />{device.status === "revoked" ? <p>This Mac must reconnect from AmirOS before it can be used again.</p> : <div className="device-actions"><button className="text-button" onClick={() => onDeviceStatus(device.id, device.status === "paused" ? "active" : "paused")}>{device.status === "paused" ? "Resume device" : "Pause device"}</button><button className="text-button device-revoke" onClick={() => onDeviceStatus(device.id, "revoked")}>Revoke device</button></div>}</article>) : <EmptyCopy text="This account has not connected a Mac yet." />}</div></section><section><h3>Feature access</h3><div className="feature-list">{selected.features.map((feature) => <label key={feature.id}><div><strong>{feature.name}</strong><span>{feature.description}</span></div><button className={`toggle ${feature.enabled ? "is-on" : ""}`} role="switch" aria-checked={feature.enabled} aria-label={`Toggle ${feature.name}`} onClick={() => onToggleFeature(feature.id)}><i /></button></label>)}</div></section><button className="danger-button" onClick={() => onStatus("paused")}><CirclePause size={17} />Pause account now</button><p className="detail-footnote">Every account and device change is written to the audit log.</p></div>;
}

function TicketRow({ ticket, selected, onSelect }: { ticket: SupportTicket; selected: boolean; onSelect: () => void }) { return <button className={`ticket-row ${selected ? "is-selected" : ""}`} type="button" aria-pressed={selected} onClick={onSelect}><span className="ticket-icon"><LifeBuoy size={17} /></span><span className="ticket-summary"><strong>{ticket.subject}</strong><span>{ticket.id} · {ticket.type} · {ticket.createdAt}</span></span><span className={`ticket-state ${ticket.state.toLowerCase().replace(" ", "-")}`}>{ticket.state}</span><ArrowUpRight size={17} aria-hidden="true" /></button>; }

function SelectedTicket({ ticket, onState }: { ticket: SupportTicket; onState: (state: SupportTicket["state"]) => void }) { return <div className="selected-ticket"><div className="ticket-detail-heading"><div><p className="section-index">{ticket.id} · {ticket.type}</p><h3>{ticket.subject}</h3></div><span className={`ticket-state ${ticket.state.toLowerCase().replace(" ", "-")}`}>{ticket.state}</span></div><p className="ticket-reporter">From <strong>{ticket.reporter || "AmirOS tester"}</strong>{ticket.reporterEmail ? <> · {ticket.reporterEmail}</> : null}</p><section><h4>Report</h4><p className="ticket-details">{ticket.details || "No additional details were provided."}</p></section><label className="ticket-state-control"><span>Ticket status</span><select value={ticket.state} onChange={(event) => onState(event.target.value as SupportTicket["state"])}><option>New</option><option>Investigating</option><option>Resolved</option></select></label><p className="ticket-updated">Received {ticket.createdAt}{ticket.updatedAt ? ` · Updated ${ticket.updatedAt}` : ""}</p></div>; }

function NotAuthorized({ onNavigate }: { onNavigate: (page: Page) => void }) { return <main className="not-authorized"><Brand /><section><ShieldAlert size={34} /><h1>This area is for Control Center operators.</h1><p>Your account is active, but it does not have administrator access.</p><button className="button button-primary" onClick={() => onNavigate("account")}>Return to your account</button></section><footer className="not-authorized-footer"><CopyrightNotice /></footer></main>; }
