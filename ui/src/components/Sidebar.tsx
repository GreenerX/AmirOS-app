import { ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import type { ViewName } from "../types";
import {
  AutomationsIcon, CalendarIcon, ContactsIcon, InboxIcon,
  IntelligenceIcon, OverviewIcon, SettingsIcon, TerminalIcon, UsageIcon,
} from "./NavigationIcons";

const navigation: Array<{
  id: ViewName;
  label: string;
  icon: ComponentType<{ size?: number }>;
}> = [
  { id: "overview", label: "Overview", icon: OverviewIcon },
  { id: "inbox", label: "Inbox", icon: InboxIcon },
  { id: "intelligence", label: "Intelligence", icon: IntelligenceIcon },
  { id: "calendar", label: "Calendar", icon: CalendarIcon },
  { id: "contacts", label: "Contacts", icon: ContactsIcon },
];

const profileNavigation: Array<{
  id: ViewName;
  label: string;
  icon: ComponentType<{ size?: number }>;
}> = [
  { id: "settings", label: "Settings", icon: SettingsIcon },
  { id: "automations", label: "Automations", icon: AutomationsIcon },
  { id: "terminal", label: "Terminal", icon: TerminalIcon },
  { id: "usage", label: "Usage", icon: UsageIcon },
];

type SidebarProps = {
  current: ViewName;
  onNavigate: (view: ViewName) => void;
  unreadCount: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  profile: { displayName: string; avatarUrl: string };
  version: string;
  onOpenReleaseNotes: () => void;
};

export function Sidebar({ current, onNavigate, unreadCount, collapsed, onToggleCollapsed, profile, version, onOpenReleaseNotes }: SidebarProps) {
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
      <button className="brand" onClick={() => onNavigate("overview")} aria-label="AmirOS overview">
        <img src="/amiros-mark-v2-cropped.png" alt="" />
        <span>AmirOS</span>
      </button>
      <button className="sidebar-collapse" type="button" onClick={onToggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}<span>{collapsed ? "Expand" : "Collapse"}</span></button>

      <nav className="navigation" aria-label="Main navigation">
        {navigation.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={current === id ? "nav-item active" : "nav-item"}
            onClick={() => onNavigate(id)}
            aria-label={label}
            aria-current={current === id ? "page" : undefined}
          >
            <span className="nav-icon-shell"><Icon size={22} /></span>
            <span>{label}</span>
            {id === "intelligence" ? <span className="beta-badge nav-beta">Beta</span> : null}
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
            {profileNavigation.map(({ id, label, icon: Icon }) => (
              <button key={id} className={current === id ? "profile-menu-item active" : "profile-menu-item"} type="button" role="menuitem" aria-current={current === id ? "page" : undefined} onClick={() => navigateFromProfile(id)}>
                <span className="profile-menu-icon"><Icon size={19} /></span>
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
      <button className="sidebar-version" type="button" onClick={onOpenReleaseNotes} title="View release notes">v{version}<span>What’s new</span></button>
      <small className="sidebar-rights">© 2026 Amir Friedman.<br />All rights reserved.</small>
    </aside>
  );
}
