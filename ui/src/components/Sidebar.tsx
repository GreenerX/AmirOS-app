import { BarChart3, CalendarDays, ChevronDown, ContactRound, Home, ListChecks, Mail, PanelLeftClose, PanelLeftOpen, Settings, TerminalSquare, UsersRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import type { DashboardData, ViewName } from "../types";
import { WhatsAppIcon } from "./BrandIcons";
const navigation: Array<{
  id: ViewName;
  label: string;
  icon: ComponentType<{ size?: number }>;
  tone: string;
}> = [
  { id: "overview", label: "Overview", icon: Home, tone: "overview" },
  { id: "inbox", label: "Inbox", icon: Mail, tone: "inbox" },
  { id: "intelligence", label: "People", icon: UsersRound, tone: "people" },
  { id: "calendar", label: "Calendar", icon: CalendarDays, tone: "calendar" },
  { id: "contacts", label: "Contacts", icon: ContactRound, tone: "contacts" },
];

const profileNavigation: Array<{
  id: ViewName;
  label: string;
  icon: ComponentType<{ size?: number }>;
  tone: string;
}> = [
  { id: "settings", label: "Settings", icon: Settings, tone: "settings" },
  { id: "automations", label: "Automations", icon: ListChecks, tone: "tasks" },
  { id: "terminal", label: "Terminal", icon: TerminalSquare, tone: "terminal" },
  { id: "usage", label: "Usage", icon: BarChart3, tone: "usage" },
];

type SidebarProps = {
  current: ViewName;
  onNavigate: (view: ViewName) => void;
  unreadCount: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  profile: { displayName: string; avatarUrl: string };
  version: string;
  updateAvailable?: boolean;
  connection: DashboardData["connection"];
  onOpenReleaseNotes: () => void;
};

export function Sidebar({ current, onNavigate, unreadCount, collapsed, onToggleCollapsed, profile, version, updateAvailable = false, connection, onOpenReleaseNotes }: SidebarProps) {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) setProfileMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileMenuOpen]);

  const navigateFromProfile = (view: ViewName) => {
    setProfileMenuOpen(false);
    onNavigate(view);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand-area">
        <button className="brand" onClick={() => onNavigate("overview")} aria-label="AmirOS overview">
          <img src="/amiros-mark-v2-cropped.png" alt="" />
          <span>AmirOS</span>
        </button>
        <div className={`sidebar-whatsapp-status ${connection.status}`} title={connection.detail}>
          <WhatsAppIcon size={15} />
          <span>{connection.status === "ready" ? "WhatsApp Connected" : connection.status === "qr" ? "WhatsApp QR Ready" : connection.status === "authenticated" || connection.status === "starting" ? "WhatsApp Connecting" : "WhatsApp Disconnected"}</span>
          <i aria-hidden="true" />
        </div>
        <button className="sidebar-collapse" type="button" onClick={onToggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <span className="sidebar-collapse-icon" aria-hidden="true">
            {collapsed ? <><PanelLeftOpen className="sidebar-collapse-glyph on-light" size={18} /><PanelLeftOpen className="sidebar-collapse-glyph on-dark" size={18} /></> : <><PanelLeftClose className="sidebar-collapse-glyph on-light" size={18} /><PanelLeftClose className="sidebar-collapse-glyph on-dark" size={18} /></>}
          </span>
        </button>
      </div>

      <nav className="navigation" aria-label="Main navigation">
        {navigation.map(({ id, label, icon: Icon, tone }) => (
          <button
            key={id}
            className={`nav-item nav-tone-${tone}${current === id ? " active" : ""}`}
            onClick={() => onNavigate(id)}
            aria-label={label}
            aria-current={current === id ? "page" : undefined}
          >
            <span className={`nav-icon-shell nav-icon-${tone}`}><Icon size={24} /></span>
            <span>{label}</span>
            {id === "inbox" && unreadCount > 0 ? (
              <span className="nav-count" aria-label={`${unreadCount} unread messages`} title={`${unreadCount} unread messages`}>{unreadCount > 99 ? "99+" : unreadCount}</span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="sidebar-spacer" />
      <div className="profile-menu-wrap" ref={profileMenuRef}>
        {profileMenuOpen ? (
          <div className="profile-menu" id="profile-tools-menu" role="menu" aria-label="AmirOS tools">
            {profileNavigation.map(({ id, label, icon: Icon, tone }) => (
              <button key={id} className={current === id ? "profile-menu-item active" : "profile-menu-item"} type="button" role="menuitem" aria-current={current === id ? "page" : undefined} onClick={() => navigateFromProfile(id)}>
                <span className={`profile-menu-icon nav-icon-${tone}`}><Icon size={21} /></span>
                <span>{label}</span>
              </button>
            ))}
          </div>
        ) : null}
        <button className="profile-button" type="button" onClick={() => setProfileMenuOpen((open) => !open)} aria-label="Open AmirOS tools" aria-haspopup="menu" aria-expanded={profileMenuOpen} aria-controls="profile-tools-menu">
          <img className="sidebar-profile-avatar" src={profile.avatarUrl} alt="" />
          <span className="profile-copy">
            <strong>{profile.displayName}</strong>
            <small>Manage AmirOS</small>
          </span>
          <ChevronDown className={profileMenuOpen ? "profile-button-chevron open" : "profile-button-chevron"} size={18} aria-hidden="true" />
        </button>
      </div>
      <button className={updateAvailable ? "sidebar-version update-available" : "sidebar-version"} type="button" onClick={onOpenReleaseNotes} title={updateAvailable ? "An AmirOS update is ready" : "View release notes"}>v{version}<span>{updateAvailable ? "Update ready" : "What’s new"}</span></button>
      <small className="sidebar-rights">© 2026 Amir Friedman.<br />All rights reserved.</small>
    </aside>
  );
}
