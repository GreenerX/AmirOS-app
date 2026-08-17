import type { AccountSnapshot, ActivationChecklist, AdminUser, FeatureAssignment, SupportTicket } from "./types";

const baseFeatures: FeatureAssignment[] = [
  { id: "memory-control", name: "Memory control", description: "Correct, historicize, and forget relationship facts.", enabled: true },
  { id: "calendar-views", name: "Calendar views", description: "Day, week, and month planning views.", enabled: true },
  { id: "auto-mode", name: "Auto Mode", description: "Owner-style replies after the configured delay.", enabled: false },
  { id: "early-release", name: "Early releases", description: "Receive internal builds before beta rollout.", enabled: false },
];

function demoDevice(id: string, label: string, appVersion: string, status: "active" | "paused" | "revoked" = "active") {
  return { id, label, platform: "macOS", appVersion, lastSeenAt: "Just now", isCurrent: status === "active", status };
}

function demoActivation(completedCount: number): ActivationChecklist {
  const steps: ActivationChecklist["steps"] = [
    { id: "account_created", title: "Account created", description: "Your private AmirOS account is ready.", state: "complete", completedAt: "12 Aug" },
    { id: "mac_connection", title: "Mac connection pending", description: "Connect the Mac that will run AmirOS.", state: completedCount >= 2 ? "complete" : completedCount === 1 ? "current" : "upcoming", ...(completedCount >= 2 ? { completedAt: "13 Aug" } : {}) },
    { id: "mac_approved", title: "Mac approved", description: "Your Control Center access is paired with AmirOS on your Mac.", state: completedCount >= 3 ? "complete" : completedCount === 2 ? "current" : "upcoming", ...(completedCount >= 3 ? { completedAt: "13 Aug" } : {}) },
    { id: "whatsapp_connected", title: "WhatsApp connected", description: "AmirOS confirmed the connection locally.", state: completedCount >= 4 ? "complete" : completedCount === 3 ? "current" : "upcoming", ...(completedCount >= 4 ? { completedAt: "14 Aug" } : {}) },
    { id: "first_people_selected", title: "First people selected", description: "AmirOS confirmed your initial selection locally.", state: completedCount >= 5 ? "complete" : completedCount === 4 ? "current" : "upcoming", ...(completedCount >= 5 ? { completedAt: "14 Aug" } : {}) },
  ];
  const nextAction = completedCount < 2
    ? { id: "connect_mac" as const, target: "control_center_connect" as const, label: "Connect this Mac to finish setup", description: "Open AmirOS and select Connect this Mac." }
    : completedCount < 4
      ? { id: "connect_whatsapp" as const, target: "local_amiros" as const, label: "Continue AmirOS setup", description: "Finish API setup if needed, then connect WhatsApp on your Mac." }
      : completedCount < 5
        ? { id: "choose_people" as const, target: "local_amiros" as const, label: "Choose your first people in AmirOS", description: "Select the first people AmirOS should keep in context." }
        : { id: "complete" as const, target: "none" as const, label: "Beta setup complete", description: "Your AmirOS beta setup is complete." };
  return { completedCount, totalCount: 5, nextAction, steps };
}

export const demoAccount: AccountSnapshot = {
  productName: "AmirOS",
  status: "active",
  setupState: "active",
  releaseChannel: "beta",
  expiresAt: "30 September 2026",
  devices: [
    demoDevice("device-current", "MacBook Pro", "0.10.8"),
  ],
  features: baseFeatures,
  activation: demoActivation(5),
  supportEmail: "support@example.com",
};

export const demoUsers: AdminUser[] = [
  { id: "user-01", initials: "JL", displayName: "Jordan Lee", email: "jordan@example.com", status: "active", setupState: "active", lastSeen: "2m ago", releaseChannel: "stable", appVersion: "0.10.8", addedAt: "12 Aug", devices: [demoDevice("device-jl", "Jordan's Mac", "0.10.8")], features: baseFeatures, activation: demoActivation(5) },
  { id: "user-02", initials: "RP", displayName: "Riley Park", email: "riley@example.com", status: "active", setupState: "active", lastSeen: "14m ago", releaseChannel: "beta", appVersion: "0.10.8", addedAt: "13 Aug", devices: [demoDevice("device-rp", "Riley's Mac", "0.10.8")], features: baseFeatures.map((feature) => feature.id === "auto-mode" ? { ...feature, enabled: true } : feature), activation: demoActivation(4) },
  { id: "user-03", initials: "KM", displayName: "Kai Morgan", email: "kai@example.com", status: "paused", setupState: "active", lastSeen: "47m ago", releaseChannel: "beta", appVersion: "0.10.7", addedAt: "14 Aug", devices: [demoDevice("device-km", "Kai's Mac", "0.10.7", "paused")], features: baseFeatures, activation: demoActivation(3) },
  { id: "user-04", initials: "TD", displayName: "Taylor Davis", email: "taylor@example.com", status: "active", setupState: "device_pending", lastSeen: "Not yet connected", releaseChannel: "internal", appVersion: "—", addedAt: "14 Aug", devices: [], features: baseFeatures.map((feature) => feature.id === "early-release" ? { ...feature, enabled: true } : feature), activation: demoActivation(1) },
  { id: "user-05", initials: "SW", displayName: "Sam Wilson", email: "sam@example.com", status: "revoked", setupState: "active", lastSeen: "Yesterday", releaseChannel: "stable", appVersion: "0.10.6", addedAt: "15 Aug", devices: [demoDevice("device-sw", "Sam's Mac", "0.10.6", "revoked")], features: baseFeatures, activation: demoActivation(5) },
];

export const demoTickets: SupportTicket[] = [
  { ticketId: 18, id: "SUP-018", type: "Bug", subject: "Update did not reopen the dashboard", details: "The dashboard showed a recovery screen after the update. Refreshing once brought it back.", state: "Investigating", createdAt: "18m ago", reporter: "Riley Park", reporterEmail: "riley@example.com" },
  { ticketId: 17, id: "SUP-017", type: "Feedback", subject: "People setup felt clear and safe", details: "The setup explained why I was choosing people and never felt like it was reading more than I expected.", state: "New", createdAt: "1h ago", reporter: "Jordan Lee", reporterEmail: "jordan@example.com" },
  { ticketId: 16, id: "SUP-016", type: "Setup help", subject: "Need help connecting WhatsApp", details: "I am at the QR step and cannot find the linked-devices menu on my phone.", state: "New", createdAt: "3h ago", reporter: "Kai Morgan", reporterEmail: "kai@example.com" },
];
