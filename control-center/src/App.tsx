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
import { approveAndInviteBetaApplication, approveDeviceActivation, createSupportTicket, getAccountSnapshot, getAdminOverview, updateAdminDevice, updateAdminSupportTicket, updateAdminUser, updateBetaApplication } from "./api";
import { demoAccount, demoTickets, demoUsers } from "./demo-data";
import { acceptInvitation, createAccount, identityAllowsSignup, initialiseIdentity, isIdentityAvailable, observeIdentity, resetPassword, signIn, signOut, type ControlCenterUser } from "./identity";
import type { AccessStatus, AccountSnapshot, ActivationChecklist, AdminUser, BetaApplication, BetaApplicationState, FeatureAssignment, ReleaseChannel, SetupState, SupportTicket } from "./types";

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

function currentPage(): Page {
  return window.location.pathname.startsWith("/admin") ? "admin" : window.location.pathname.startsWith("/download") ? "download" : window.location.pathname.startsWith("/connect") ? "connect" : "account";
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
  const [channel, setChannel] = useState<ReleaseChannel>(demoAccount.releaseChannel);
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
      <article className="detail-card"><CardHeading icon={CalendarClock} title="Update channel" description="Choose when you receive new AmirOS releases." />
        <div className="channel-control"><div><strong>{channelLabel(channel)}</strong><span>{channel === "stable" ? "Validated releases only." : channel === "beta" ? "Early improvements with support coverage." : "Internal testing builds."}</span></div><label className="select-wrap"><span className="sr-only">Update channel</span><select value={channel} onChange={(event) => setChannel(event.target.value as ReleaseChannel)}><option value="stable">Stable</option><option value="beta">Beta</option><option value="internal">Internal</option></select><ChevronDown size={17} /></label></div>
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
  const [selectedId, setSelectedId] = useState<string | undefined>(demoEnabled ? demoUsers[0]?.id : undefined);
  const [users, setUsers] = useState<AdminUser[]>(demoEnabled ? demoUsers : []);
  const [applications, setApplications] = useState<BetaApplication[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>(demoEnabled ? demoTickets : []);
  const [invitingApplicationId, setInvitingApplicationId] = useState<string>();
  const [selectedTicketId, setSelectedTicketId] = useState<number | undefined>(demoEnabled ? demoTickets[0]?.ticketId : undefined);
  const [apiMessage, setApiMessage] = useState<string | undefined>();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const selected = users.find((item) => item.id === selectedId) || users[0];
  const selectedTicket = tickets.find((ticket) => ticket.ticketId === selectedTicketId) || tickets[0];
  const activeCount = users.filter((item) => item.status === "active" && item.setupState === "active").length;
  const updateCount = users.filter((item) => item.appVersion === "0.10.8").length;
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
  }, [user]);

  return <main className="admin-shell">
    <button className="mobile-menu-button" aria-label="Open admin navigation" onClick={() => setMobileNavOpen(true)}><Menu size={21} /></button>
    <AdminNav open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} onNavigate={onNavigate} />
    <section className="admin-main">
      <header className="admin-topbar"><div><p className="section-index">Control Center</p><h1>Overview</h1></div><div className="topbar-actions"><button className="icon-button" aria-label="Notifications"><Bell size={19} /></button><button className="profile-button"><span>{user?.displayName?.slice(0, 2).toUpperCase() || "AD"}</span><ChevronDown size={16} /></button><button className="text-button" onClick={onSignOut}>Sign out <LogOut size={15} /></button></div></header>
      <div className="admin-context"><span><span className="live-dot" />{demoEnabled ? "Demo workspace" : "Control Center database"}</span><p>{demoEnabled ? "Preview controls are local only until the Control Center database is connected." : "Operational account records and administrator controls are live."}</p></div>
      {apiMessage && <div className="service-notice"><CircleHelp size={18} /><span>{apiMessage}</span></div>}
      <section className="metric-row"><Metric label="Connected testers" value={String(activeCount)} detail="Mac paired and active" icon={Users} /><Metric label="Applicants" value={String(applications.filter((item) => item.state === "requested" || item.state === "reviewing").length)} detail="Waiting for review" icon={KeyRound} /><Metric label="On current release" value={users.length ? `${Math.round((updateCount / users.length) * 100)}%` : "—"} detail="v0.10.8 adoption" icon={ArrowDownToLine} /></section>
      <ApplicantPanel applications={applications} onState={setApplicationState} onInvite={approveAndInvite} invitingApplicationId={invitingApplicationId} />
      <section className="admin-columns"><div className="user-panel"><div className="panel-heading"><div><h2>Users</h2><p>{users.length} signed-in testers</p></div><div className="table-actions"><label className="search-field"><Search size={16} /><input placeholder="Search users" /></label><button className="button button-secondary"><SlidersHorizontal size={16} />Filters</button></div></div><UserTable users={users} selectedId={selected?.id} onSelect={setSelectedId} /><div className="table-footer"><span>Showing {users.length} active Control Center accounts</span><span>All activity is operational metadata only.</span></div></div>
        <aside className="user-detail">{selected ? <SelectedUser selected={selected} onStatus={setStatus} onReleaseChannel={setReleaseChannel} onToggleFeature={toggleFeature} onDeviceStatus={setDeviceStatus} /> : <EmptyCopy text="Signed-in testers will appear here as they begin using the Control Center." />}</aside>
      </section>
      <section className="support-panel" id="support"><div className="panel-heading"><div><h2>Support queue</h2><p>User-submitted requests only</p></div><span className="panel-note">Ticket state changes are recorded in the audit log.</span></div><div className="support-queue">{tickets.length ? <><div className="ticket-list">{tickets.map((ticket) => <TicketRow ticket={ticket} key={ticket.id} selected={ticket.ticketId === selectedTicket?.ticketId} onSelect={() => setSelectedTicketId(ticket.ticketId)} />)}</div><aside className="ticket-detail">{selectedTicket ? <SelectedTicket ticket={selectedTicket} onState={setTicketState} /> : <EmptyCopy text="Choose a support request to view it." />}</aside></> : <EmptyCopy text="New support requests will appear here." />}</div></section>
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

function AdminNav({ open, onClose, onNavigate }: { open: boolean; onClose: () => void; onNavigate: (page: Page) => void }) { return <aside className={`admin-nav ${open ? "is-open" : ""}`}><div className="admin-nav-header"><Brand /><button className="icon-button mobile-only" aria-label="Close navigation" onClick={onClose}><X size={19} /></button></div><nav aria-label="Admin navigation"><a className="is-active" href="/admin/"><MonitorCog size={18} />Overview</a><a href="#applicants"><Users size={18} />Applicants</a><a href="#users"><Users size={18} />Users</a><a href="#rollouts"><ArrowDownToLine size={18} />Rollouts</a><a href="#releases"><FileClock size={18} />Releases</a><a href="#flags"><SlidersHorizontal size={18} />Feature flags</a><a href="#support"><LifeBuoy size={18} />Support</a></nav><div className="admin-nav-footer"><button className="emergency-button"><PauseCircle size={18} />Emergency pause</button><button className="audit-link"><FileClock size={17} />Audit log</button><button className="text-button" onClick={() => onNavigate("account")}>View account portal <ArrowUpRight size={14} /></button></div></aside>; }

function Metric({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: typeof Users }) { return <article className="metric"><span className="metric-icon"><Icon size={20} /></span><p>{label}</p><strong>{value}</strong><small>{detail}</small></article>; }

function ApplicantPanel({ applications, onState, onInvite, invitingApplicationId }: { applications: BetaApplication[]; onState: (applicationId: string, state: BetaApplicationState) => void; onInvite: (application: BetaApplication) => void; invitingApplicationId?: string }) {
  return <section className="applicant-panel" id="applicants"><div className="panel-heading"><div><h2>Beta applicants</h2><p>Approve a request to send Netlify’s secure account invitation.</p></div><span className="panel-note">Invitation links stay with Netlify and are never shown here.</span></div>{applications.length ? <div className="applicant-list">{applications.map((application) => <article className="applicant-row" key={application.id}><div><strong>{application.fullName}</strong><span>{application.email} · {applicationStateLabel(application.state)}</span>{application.interest ? <p>{application.interest}</p> : null}</div><ApplicantActions application={application} onState={onState} onInvite={onInvite} inviting={invitingApplicationId === application.id} /></article>)}</div> : <EmptyCopy text="New landing-page requests will appear here after the verified application intake is connected." />}</section>;
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

function SelectedUser({ selected, onStatus, onReleaseChannel, onToggleFeature, onDeviceStatus }: { selected: AdminUser; onStatus: (status: AccessStatus) => void; onReleaseChannel: (channel: ReleaseChannel) => void; onToggleFeature: (featureId: string) => void; onDeviceStatus: (deviceId: string, status: AccessStatus) => void }) { return <div className="selected-user"><div className="selected-header"><span className="selected-avatar">{selected.initials}</span><div><h2>{selected.displayName}</h2><p>{selected.email}</p><p>Setup · {setupLabel(selected.setupState)} · {selected.activation.completedCount}/{selected.activation.totalCount} complete</p></div><button className="icon-button" aria-label={`Close ${selected.displayName} details`}><X size={18} /></button></div><section className="admin-activation-progress"><h3>Activation progress</h3><p>{selected.activation.nextAction.id === "complete" ? "Beta setup complete." : `Next: ${selected.activation.nextAction.label}`}</p><ol>{selected.activation.steps.map((step) => <li className={`is-${step.state}`} key={step.id}><span>{step.state === "complete" ? <BadgeCheck size={15} /> : ""}</span><strong>{step.title}</strong><em>{step.state === "complete" ? "Done" : step.state === "current" ? "Next" : "Later"}</em></li>)}</ol></section><section><h3>Access status</h3><div className="status-options">{(["active", "paused", "revoked"] as AccessStatus[]).map((status) => <button className={selected.status === status ? "is-active" : ""} key={status} onClick={() => onStatus(status)}><StatusPill status={status} /><span>{status === "active" ? "Can use assigned features." : status === "paused" ? "Keeps data local; blocks new entitlement checks." : "Access cannot renew."}</span></button>)}</div></section><section><h3>Release channel</h3><label className="select-wrap wide"><select value={selected.releaseChannel} onChange={(event) => onReleaseChannel(event.target.value as ReleaseChannel)}><option value="stable">Stable</option><option value="beta">Beta</option><option value="internal">Internal</option></select><ChevronDown size={17} /></label></section><section><h3>Authorized devices</h3><div className="device-control-list">{selected.devices.length ? selected.devices.map((device) => <article className="device-control" key={device.id}><div className="detail-device"><Laptop size={18} /><div><strong>{device.label} · {device.appVersion}</strong><span>{device.platform} · Last seen {device.lastSeenAt}</span></div></div><StatusPill status={device.status} />{device.status === "revoked" ? <p>This Mac must reconnect from AmirOS before it can be used again.</p> : <div className="device-actions"><button className="text-button" onClick={() => onDeviceStatus(device.id, device.status === "paused" ? "active" : "paused")}>{device.status === "paused" ? "Resume device" : "Pause device"}</button><button className="text-button device-revoke" onClick={() => onDeviceStatus(device.id, "revoked")}>Revoke device</button></div>}</article>) : <EmptyCopy text="This account has not connected a Mac yet." />}</div></section><section><h3>Feature access</h3><div className="feature-list">{selected.features.map((feature) => <label key={feature.id}><div><strong>{feature.name}</strong><span>{feature.description}</span></div><button className={`toggle ${feature.enabled ? "is-on" : ""}`} role="switch" aria-checked={feature.enabled} aria-label={`Toggle ${feature.name}`} onClick={() => onToggleFeature(feature.id)}><i /></button></label>)}</div></section><button className="danger-button" onClick={() => onStatus("paused")}><CirclePause size={17} />Pause account now</button><p className="detail-footnote">Every account and device change is written to the audit log.</p></div>; }

function TicketRow({ ticket, selected, onSelect }: { ticket: SupportTicket; selected: boolean; onSelect: () => void }) { return <button className={`ticket-row ${selected ? "is-selected" : ""}`} type="button" aria-pressed={selected} onClick={onSelect}><span className="ticket-icon"><LifeBuoy size={17} /></span><span className="ticket-summary"><strong>{ticket.subject}</strong><span>{ticket.id} · {ticket.type} · {ticket.createdAt}</span></span><span className={`ticket-state ${ticket.state.toLowerCase().replace(" ", "-")}`}>{ticket.state}</span><ArrowUpRight size={17} aria-hidden="true" /></button>; }

function SelectedTicket({ ticket, onState }: { ticket: SupportTicket; onState: (state: SupportTicket["state"]) => void }) { return <div className="selected-ticket"><div className="ticket-detail-heading"><div><p className="section-index">{ticket.id} · {ticket.type}</p><h3>{ticket.subject}</h3></div><span className={`ticket-state ${ticket.state.toLowerCase().replace(" ", "-")}`}>{ticket.state}</span></div><p className="ticket-reporter">From <strong>{ticket.reporter || "AmirOS tester"}</strong>{ticket.reporterEmail ? <> · {ticket.reporterEmail}</> : null}</p><section><h4>Report</h4><p className="ticket-details">{ticket.details || "No additional details were provided."}</p></section><label className="ticket-state-control"><span>Ticket status</span><select value={ticket.state} onChange={(event) => onState(event.target.value as SupportTicket["state"])}><option>New</option><option>Investigating</option><option>Resolved</option></select></label><p className="ticket-updated">Received {ticket.createdAt}{ticket.updatedAt ? ` · Updated ${ticket.updatedAt}` : ""}</p></div>; }

function NotAuthorized({ onNavigate }: { onNavigate: (page: Page) => void }) { return <main className="not-authorized"><Brand /><section><ShieldAlert size={34} /><h1>This area is for Control Center operators.</h1><p>Your account is active, but it does not have administrator access.</p><button className="button button-primary" onClick={() => onNavigate("account")}>Return to your account</button></section><footer className="not-authorized-footer"><CopyrightNotice /></footer></main>; }
