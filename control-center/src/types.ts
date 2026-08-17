export type AccessStatus = "active" | "paused" | "revoked";
export type ReleaseChannel = "internal" | "beta" | "stable";
export type SetupState = "setup_required" | "device_pending" | "active";
export type BetaApplicationState = "requested" | "reviewing" | "approved" | "invited" | "device_pending" | "active" | "declined";
export type ActivationStepId = "account_created" | "mac_connection" | "mac_approved" | "whatsapp_connected" | "first_people_selected";
export type ActivationStepState = "complete" | "current" | "upcoming";
export type ActivationNextActionId = "contact_support" | "connect_mac" | "connect_whatsapp" | "choose_people" | "complete";
export type ActivationActionTarget = "control_center_support" | "control_center_connect" | "local_amiros" | "none";

export type ActivationChecklist = {
  completedCount: number;
  totalCount: 5;
  nextAction: {
    id: ActivationNextActionId;
    target: ActivationActionTarget;
    label: string;
    description: string;
  };
  steps: Array<{
    id: ActivationStepId;
    title: string;
    description: string;
    state: ActivationStepState;
    completedAt?: string;
  }>;
};

export type DeviceSummary = {
  id: string;
  label: string;
  platform: string;
  appVersion: string;
  lastSeenAt: string;
  isCurrent: boolean;
  status: AccessStatus;
};

export type FeatureAssignment = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
};

export type AccountSnapshot = {
  productName: string;
  status: AccessStatus;
  setupState: SetupState;
  releaseChannel: ReleaseChannel;
  expiresAt?: string;
  devices: DeviceSummary[];
  features: FeatureAssignment[];
  activation: ActivationChecklist;
  supportEmail?: string;
};

export type AdminUser = {
  id: string;
  initials: string;
  displayName: string;
  email: string;
  status: AccessStatus;
  setupState: SetupState;
  lastSeen: string;
  releaseChannel: ReleaseChannel;
  appVersion: string;
  addedAt: string;
  devices: DeviceSummary[];
  features: FeatureAssignment[];
  activation: ActivationChecklist;
};

export type BetaApplication = {
  id: string;
  fullName: string;
  email: string;
  interest?: string;
  state: BetaApplicationState;
  requestedAt: string;
  approvedAt?: string;
  invitedAt?: string;
  accountId?: string;
};

export type SupportTicket = {
  ticketId: number;
  id: string;
  type: "Bug" | "Feedback" | "Feature request" | "Setup help";
  subject: string;
  details?: string;
  state: "New" | "Investigating" | "Resolved";
  createdAt: string;
  updatedAt?: string;
  reporter?: string;
  reporterEmail?: string;
};

export type AdminOverview = {
  users: AdminUser[];
  tickets: SupportTicket[];
  applications: BetaApplication[];
};
