import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function NavSvg({ size = 22, children, ...props }: IconProps & { children: ReactNode }) {
  return <svg className="nav-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>{children}</svg>;
}

const stroke = { stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function OverviewIcon(props: IconProps) { return <NavSvg {...props}><rect x="3" y="3" width="7" height="7" rx="2" fill="currentColor" opacity=".2" /><rect x="14" y="3" width="7" height="7" rx="2" {...stroke} /><rect x="3" y="14" width="7" height="7" rx="2" {...stroke} /><path d="M14 17.5h7M17.5 14v7" {...stroke} /></NavSvg>; }
export function InboxIcon(props: IconProps) { return <NavSvg {...props}><path d="M4 5.5h16v11.8a2.2 2.2 0 0 1-2.2 2.2H6.2A2.2 2.2 0 0 1 4 17.3V5.5Z" fill="currentColor" opacity=".16" /><path d="M4 5.5h16v11.8a2.2 2.2 0 0 1-2.2 2.2H6.2A2.2 2.2 0 0 1 4 17.3V5.5Z" {...stroke} /><path d="M4 14h4l1.5 2h5L16 14h4M8 9h8" {...stroke} /></NavSvg>; }
export function ContactsIcon(props: IconProps) { return <NavSvg {...props}><circle cx="9" cy="8" r="3.2" fill="currentColor" opacity=".2" /><circle cx="9" cy="8" r="3.2" {...stroke} /><path d="M3.5 19c.5-3.4 2.3-5 5.5-5s5 1.6 5.5 5" {...stroke} /><circle cx="17.5" cy="9" r="2.3" {...stroke} /><path d="M16 14.5c2.7-.5 4.3.8 4.8 3.6" {...stroke} /></NavSvg>; }
export function IntelligenceIcon(props: IconProps) { return <NavSvg {...props}><circle cx="12" cy="12" r="3" fill="currentColor" opacity=".22" /><circle cx="12" cy="12" r="3" {...stroke} /><circle cx="5" cy="6" r="2" {...stroke} /><circle cx="19" cy="6" r="2" {...stroke} /><circle cx="5" cy="18" r="2" {...stroke} /><circle cx="19" cy="18" r="2" {...stroke} /><path d="m7 7.5 2.7 2.3m4.6 0L17 7.5m-10 9 2.7-2.3m4.6 0L17 16.5" {...stroke} /></NavSvg>; }
export function CalendarIcon(props: IconProps) { return <NavSvg {...props}><rect x="3.5" y="5" width="17" height="16" rx="3" fill="currentColor" opacity=".14" /><rect x="3.5" y="5" width="17" height="16" rx="3" {...stroke} /><path d="M8 3v4m8-4v4M3.5 10h17" {...stroke} /><circle cx="15.5" cy="15.5" r="2.2" fill="currentColor" /></NavSvg>; }
export function ActivityIcon(props: IconProps) { return <NavSvg {...props}><circle cx="12" cy="12" r="9" fill="currentColor" opacity=".13" /><circle cx="12" cy="12" r="9" {...stroke} /><path d="M6.5 12h3l1.4-4 2.3 8 1.4-4H18" {...stroke} /></NavSvg>; }
export function AutomationsIcon(props: IconProps) { return <NavSvg {...props}><path d="M6.5 6.5h11v11h-11z" fill="currentColor" opacity=".13" /><circle cx="6" cy="6" r="2.5" {...stroke} /><circle cx="18" cy="18" r="2.5" {...stroke} /><path d="M8.5 6H15a3 3 0 0 1 3 3v6.5M15.5 18H9a3 3 0 0 1-3-3V8.5" {...stroke} /><path d="m12.8 8.8-2.1 3.7h2.4l-1.7 3" {...stroke} /></NavSvg>; }
export function UsageIcon(props: IconProps) { return <NavSvg {...props}><path d="M5 19V11h3v8H5Zm5.5 0V5h3v14h-3Zm5.5 0V8h3v11h-3Z" fill="currentColor" opacity=".2" /><path d="M4 20h16M5 19V11h3v8m2.5 0V5h3v14m2.5 0V8h3v11" {...stroke} /></NavSvg>; }
export function TerminalIcon(props: IconProps) { return <NavSvg {...props}><rect x="3" y="4" width="18" height="16" rx="3" fill="currentColor" opacity=".13" /><rect x="3" y="4" width="18" height="16" rx="3" {...stroke} /><path d="m7 9 3 3-3 3m5 0h5" {...stroke} /></NavSvg>; }
export function SettingsIcon(props: IconProps) { return <NavSvg {...props}><path d="M5 7h14M5 12h14M5 17h14" {...stroke} /><circle cx="9" cy="7" r="2" fill="currentColor" /><circle cx="15" cy="12" r="2" fill="currentColor" /><circle cx="11" cy="17" r="2" fill="currentColor" /></NavSvg>; }
