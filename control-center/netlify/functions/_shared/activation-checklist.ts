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

type ActivationSource = {
  accountCreatedAt: string;
  setupState: "setup_required" | "device_pending" | "active";
  devices: Array<{
    firstSeenAt: string;
    whatsappConnectedAt: string | null;
    firstPeopleSelectedAt: string | null;
  }>;
};

function earliestTimestamp(values: Array<string | null>): string | undefined {
  return values.filter((value): value is string => Boolean(value)).sort()[0];
}

/**
 * Builds a privacy-minimised, read-only activation view from the existing
 * account and device records. It intentionally records only completion times;
 * it never receives WhatsApp, people, conversations, memory, or API-key data.
 */
export function buildActivationChecklist(source: ActivationSource): ActivationChecklist {
  const macApproved = source.setupState === "active" && source.devices.length > 0;
  const macApprovedAt = earliestTimestamp(source.devices.map((device) => device.firstSeenAt));
  const whatsappConnectedAt = earliestTimestamp(source.devices.map((device) => device.whatsappConnectedAt));
  const firstPeopleSelectedAt = earliestTimestamp(source.devices.map((device) => device.firstPeopleSelectedAt));
  const accountCreatedAt = source.accountCreatedAt;

  const macConnectionState: ActivationStepState = macApproved
    ? "complete"
    : source.setupState === "device_pending" || source.setupState === "active"
      ? "current"
      : "upcoming";
  const macApprovalState: ActivationStepState = macApproved ? "complete" : "upcoming";
  const whatsappState: ActivationStepState = whatsappConnectedAt
    ? "complete"
    : macApproved
      ? "current"
      : "upcoming";
  const peopleState: ActivationStepState = firstPeopleSelectedAt
    ? "complete"
    : whatsappConnectedAt && macApproved
      ? "current"
      : "upcoming";

  const nextAction = source.setupState === "setup_required"
    ? {
        id: "contact_support" as const,
        target: "control_center_support" as const,
        label: "Ask for activation",
        description: "Your signed-in account still needs an approved beta invitation before a Mac can be connected.",
      }
    : !macApproved
      ? {
          id: "connect_mac" as const,
          target: "control_center_connect" as const,
          label: "Connect this Mac to finish setup",
          description: "In AmirOS, open your username menu, choose Settings, then select Connect this Mac.",
        }
      : !whatsappConnectedAt
        ? {
            id: "connect_whatsapp" as const,
            target: "local_amiros" as const,
            label: "Continue AmirOS setup",
            description: "On your approved Mac, finish local API setup if needed, then connect WhatsApp in AmirOS. No API key or WhatsApp content is sent here.",
          }
        : !firstPeopleSelectedAt
          ? {
            id: "choose_people" as const,
            target: "local_amiros" as const,
            label: "Choose your first people in AmirOS",
            description: "After WhatsApp is ready and recent chats are available, select the first people AmirOS should help you keep in context.",
            }
          : {
              id: "complete" as const,
              target: "none" as const,
              label: "Beta setup complete",
              description: "Your AmirOS beta setup is complete. You can return to AmirOS whenever you need it.",
            };

  const steps: ActivationChecklist["steps"] = [
    {
      id: "account_created",
      title: "Account created",
      description: "Your private AmirOS account is ready.",
      state: "complete",
      completedAt: accountCreatedAt,
    },
    {
      id: "mac_connection",
      title: "Mac connection pending",
      description: "Connect the Mac that will run AmirOS.",
      state: macConnectionState,
      ...(macApproved && macApprovedAt ? { completedAt: macApprovedAt } : {}),
    },
    {
      id: "mac_approved",
      title: "Mac approved",
      description: "Your Control Center access is paired with AmirOS on your Mac.",
      state: macApprovalState,
      ...(macApproved && macApprovedAt ? { completedAt: macApprovedAt } : {}),
    },
    {
      id: "whatsapp_connected",
      title: "WhatsApp connected",
      description: "AmirOS confirmed the connection locally; messages and QR material stay on your Mac.",
      state: whatsappState,
      ...(whatsappConnectedAt ? { completedAt: whatsappConnectedAt } : {}),
    },
    {
      id: "first_people_selected",
      title: "First people selected",
      description: "After WhatsApp is ready, AmirOS confirmed your local selection; no names are sent here.",
      state: peopleState,
      ...(firstPeopleSelectedAt ? { completedAt: firstPeopleSelectedAt } : {}),
    },
  ];

  return {
    completedCount: steps.filter((step) => step.state === "complete").length,
    totalCount: 5,
    nextAction,
    steps,
  };
}
