import type {
  ChatMessage,
  ChatSummary,
  ContactPreferences,
  DashboardData,
  IntelligenceData,
} from "./types";

const now = Date.now();
const seconds = (minutes: number) => Math.floor((now - minutes * 60_000) / 1_000);

export const demoChats: ChatSummary[] = [
  {
    id: "sana@demo",
    name: "Sana Farooq",
    isGroup: false,
    unreadCount: 2,
    timestamp: seconds(1),
    preview: "Can you send the price list for the latest products?",
    mode: "suggest",
    avatarUrl: "/demo-avatars/sana.png",
  },
  {
    id: "bilal@demo",
    name: "Bilal Khan",
    isGroup: false,
    unreadCount: 1,
    timestamp: seconds(76),
    preview: "Thanks! Also, what's the delivery time to DHA?",
    mode: "auto",
    avatarUrl: "/demo-avatars/bilal.png",
  },
  {
    id: "mariam@demo",
    name: "Mariam Ali",
    isGroup: false,
    unreadCount: 1,
    timestamp: seconds(163),
    preview: "Do you have this in black?",
    mode: "suggest",
    avatarUrl: "/demo-avatars/mariam.png",
  },
  {
    id: "zain@demo",
    name: "Zain Merchant",
    isGroup: false,
    unreadCount: 0,
    timestamp: seconds(267),
    preview: "Please share your bank details.",
    mode: "off",
    avatarUrl: "/demo-avatars/zain.png",
  },
  {
    id: "hassan@demo",
    name: "Hassan Raza",
    isGroup: false,
    unreadCount: 0,
    timestamp: seconds(337),
    preview: "Great, see you tomorrow.",
    mode: "auto",
    avatarUrl: "/demo-avatars/hassan.png",
  },
  {
    id: "product-team@demo",
    name: "Product Team",
    isGroup: true,
    unreadCount: 1,
    timestamp: seconds(382),
    preview: "Can we move tomorrow’s launch review?",
    mode: "suggest",
  },
];

export const demoContact: ContactPreferences = {
  mode: "suggest",
  relationship: "Client",
  tone: "Warm & concise",
    language: "Automatic",
    memoryEnabled: true,
    knowledgeTracking: "enabled",
  customInstructions: "Prioritize concise pricing info and attach relevant documents.",
  ownerTriggerAccess: ["knowledge", "calendar"],
  contactTriggerAccess: [],
};

export const demoMessages: ChatMessage[] = [
  {
    id: "m1",
    body: "Can you send the price list for the latest products?",
    fullBody: "Can you send the price list for the latest products?",
    fromMe: false,
    timestamp: seconds(2),
    type: "chat",
    hasMedia: false,
  },
  {
    id: "m2",
    body: "Voice message",
    fullBody: "",
    fromMe: false,
    timestamp: seconds(2),
    type: "ptt",
    hasMedia: true,
  },
  {
    id: "m3",
    body: "Hi Sana, sure! I’ll send you the latest price list right away.",
    fullBody: "Hi Sana, sure! I’ll send you the latest price list right away.",
    fromMe: true,
    timestamp: seconds(1),
    type: "chat",
    hasMedia: false,
  },
];

const demoReplies: Record<string, string> = {
  "sana@demo": "Hi Sana, sure! I’ll send you the latest price list right away.",
  "bilal@demo": "Delivery to DHA usually takes 2–3 business days. I’ll confirm the exact window for your order.",
  "mariam@demo": "Yes, it’s available in black. Would you like me to reserve one for you?",
  "zain@demo": "I’ll send the bank details to you privately now.",
  "hassan@demo": "Perfect — see you tomorrow! 👋",
};

export function demoMessagesForChat(chatId: string): ChatMessage[] {
  const chat = demoChats.find((item) => item.id === chatId) || demoChats[0];
  if (!chat) return [];
  const messages: ChatMessage[] = [
    {
      ...demoMessages[0]!,
      id: `${chat.id}-incoming`,
      body: chat.preview,
      fullBody: chat.preview,
      senderName: chat.isGroup ? "Sana Farooq" : undefined,
    },
    {
      id: `${chat.id}-image`,
      body: "AmirOS image preview",
      fullBody: "",
      fromMe: false,
      timestamp: seconds(1.5),
      type: "image",
      hasMedia: true,
      mediaUrl: "/amiros-mark-v2-cropped.png?v=20260803",
      senderName: chat.isGroup ? "Bilal Khan" : undefined,
    },
    {
      ...demoMessages[2]!,
      id: `${chat.id}-reply`,
      body: demoReplies[chat.id] || "Thanks for your message — I’ll get back to you shortly.",
      fullBody: demoReplies[chat.id] || "Thanks for your message — I’ll get back to you shortly.",
    },
  ];
  return messages;
}

export const demoDashboard: DashboardData = {
  release: {
    version: "0.2.2",
    releasedAt: "2026-08-04",
    headline: "Start and stop with confidence",
    notes: [
      { title: "Reliable background stopping", detail: "Stop AmirOS can safely locate its own service." },
      { title: "Release notes, right in the app", detail: "See what changed whenever a new version is installed." },
    ],
  },
  connection: { status: "ready", detail: "Listening for WhatsApp messages" },
  paused: false,
  preset: "economy",
  models: {
    text: "gpt-5.6-luna",
    image: "gpt-image-1-mini",
    voice: "gpt-4o-mini-transcribe",
  },
  modelOptions: {
    text: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"],
    image: ["gpt-image-1-mini", "gpt-image-1", "gpt-image-1.5", "gpt-image-2"],
    voice: ["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"],
  },
  usage: {
    inputTokens: 43_820,
    cachedInputTokens: 9_800,
    outputTokens: 18_260,
    textRequests: 128,
    imageRequests: 7,
    transcriptionRequests: 14,
    webSearchCalls: 22,
    transcriptionSeconds: 436,
    textCostUsd: 0.31,
    imageCostUsd: 0.042,
    transcriptionCostUsd: 0.033,
    webSearchCostUsd: 0.22,
    estimatedCostUsd: 7.42,
    pricingSourceUrl: "https://developers.openai.com/api/docs/pricing",
    imagePricingSourceUrl: "https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency",
    pricingUpdatedAt: "2026-07-31",
  },
  monthlySpendUsd: 7.42,
  drafts: [
    {
      id: "draft-1",
      chatId: "sana@demo",
      contactName: "Sana Farooq",
      sourcePreview: "Can you send the price list for the latest products?",
      body:
        "Hi Sana,\n\nPlease find attached the latest price list for all current products. Let me know if you’d like a quote or any product details.\n\nBest regards,\nAmir",
      createdAt: now - 50_000,
      status: "pending",
    },
    {
      id: "draft-2",
      chatId: "bilal@demo",
      contactName: "Bilal Khan",
      sourcePreview: "What’s the delivery time to DHA?",
      body: "Delivery to DHA usually takes 2–3 business days. I’ll confirm the exact window for your order.",
      createdAt: now - 4_100_000,
      status: "pending",
    },
    {
      id: "draft-3",
      chatId: "mariam@demo",
      contactName: "Mariam Ali",
      sourcePreview: "Do you have this in black?",
      body: "Yes, it’s available in black. Would you like me to reserve one for you?",
      createdAt: now - 9_800_000,
      status: "pending",
    },
  ],
  activities: [
    {
      id: "a1",
      kind: "text",
      title: "Text reply sent",
      detail: "Sana Farooq",
      timestamp: now - 60_000,
    },
    {
      id: "a2",
      kind: "voice",
      title: "Voice transcription",
      detail: "Bilal Khan · 0:21",
      timestamp: now - 4_500_000,
    },
    {
      id: "a3",
      kind: "image",
      title: "Image generated",
      detail: "Product photo for Mariam Ali",
      timestamp: now - 10_000_000,
    },
  ],
  settings: {
    theme: "forest",
    contacts: Object.fromEntries(demoChats.map((chat) => [chat.id, { ...demoContact, mode: chat.mode }])),
    quietHours: { enabled: true, start: "23:00", end: "07:00" },
    monthlyBudgetUsd: 20,
    apiKeyConfigured: true,
    assistant: {
      autoReplySelfChat: true,
      allowOutgoingTriggerCommands: true,
      allowGroups: false,
      webSearchEnabled: true,
      botTriggerPrefix: "!bot",
      webTriggerPrefix: "!web",
      imageTriggerPrefix: "!image",
      modelsTriggerPrefix: "!models",
    },
    models: {
      text: "gpt-5.6-luna",
      image: "gpt-image-1-mini",
      voice: "gpt-4o-mini-transcribe",
    },
    ownerProfile: {
      displayName: "Alex Morgan",
      avatarUrl: "/profile-avatars/avatar-01.png",
    },
  },
};

export function demoIntelligenceData(): IntelligenceData {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(15, 0, 0, 0);
  const friday = new Date();
  friday.setDate(friday.getDate() + ((5 - friday.getDay() + 7) % 7 || 7));
  friday.setHours(10, 30, 0, 0);
  const hourAgo = Date.now() - 60 * 60_000;
  const sanaInsight = {
    id: "demo-sana-preference",
    clusterId: "demo-sana-preference-cluster",
    subjectChatIds: ["sana@demo"],
    subjectNames: ["Sana Farooq"],
    kind: "preference" as const,
    content: "Sana prefers concise updates, clear pricing, and Thursday deliveries.",
    status: "inferred" as const,
    confidence: 0.96,
    evidence: { messageId: "sana@demo-incoming", excerpt: "Can you send the price list and confirm Thursday delivery?", senderName: "Sana Farooq", timestamp: hourAgo },
    createdAt: hourAgo,
    updatedAt: hourAgo,
  };
  const bilalInsight = {
    id: "demo-bilal-fact",
    clusterId: "demo-bilal-fact-cluster",
    subjectChatIds: ["bilal@demo"],
    subjectNames: ["Bilal Khan"],
    kind: "fact" as const,
    content: "Bilal usually needs deliveries sent to DHA within three business days.",
    status: "confirmed" as const,
    confidence: 0.98,
    evidence: { messageId: "bilal@demo-incoming", excerpt: "What’s the delivery time to DHA?", senderName: "Bilal Khan", timestamp: hourAgo - 20 * 60_000 },
    createdAt: hourAgo - 20 * 60_000,
    updatedAt: hourAgo - 20 * 60_000,
  };
  const teamInsight = {
    id: "demo-team-style",
    clusterId: "demo-team-style-cluster",
    subjectChatIds: ["product-team@demo"],
    subjectNames: ["Product Team"],
    kind: "relationship_change" as const,
    content: "The product team prefers decisions summarized with a clear owner and next step.",
    status: "inferred" as const,
    confidence: 0.94,
    evidence: { messageId: "product-team@demo-incoming", excerpt: "Can we finish with an owner and next step for each decision?", senderName: "Mariam Ali", timestamp: hourAgo - 35 * 60_000 },
    createdAt: hourAgo - 35 * 60_000,
    updatedAt: hourAgo - 35 * 60_000,
  };
  const sendDeck = {
    id: "demo-send-deck",
    content: "Send Sana the updated launch deck and pricing sheet.",
    owner: "me" as const,
    assigneeName: "Alex Morgan",
    status: "open" as const,
    dueAt: tomorrow.getTime() - 3 * 60 * 60_000,
    evidence: { messageId: "sana@demo-incoming", excerpt: "Can you send the latest price list?", senderName: "Sana Farooq", timestamp: hourAgo },
    createdAt: hourAgo,
    updatedAt: hourAgo,
  };
  const launchReview = {
    id: "demo-next-event",
    title: "Product launch review",
    startAt: tomorrow.getTime(),
    endAt: tomorrow.getTime() + 60 * 60_000,
    allDay: false,
    status: "confirmed" as const,
    location: "Studio meeting room",
    evidence: { messageId: "product-team@demo-incoming", excerpt: "Can we move tomorrow’s launch review to 3 PM?", senderName: "Sana Farooq", timestamp: hourAgo },
    createdAt: hourAgo,
    updatedAt: hourAgo,
  };
  const coffeeSuggestion = {
    id: "demo-coffee-event",
    title: "Coffee with Sana",
    startAt: friday.getTime(),
    endAt: friday.getTime() + 60 * 60_000,
    allDay: false,
    status: "inferred" as const,
    location: "The Green Room",
    evidence: { messageId: "sana@demo-coffee", excerpt: "Coffee Friday at 10:30 at The Green Room?", senderName: "Sana Farooq", timestamp: hourAgo - 12 * 60_000 },
    createdAt: hourAgo - 12 * 60_000,
    updatedAt: hourAgo - 12 * 60_000,
  };

  return {
    generatedAt: Date.now(),
    needsReply: [{
      chatId: "sana@demo", contactName: "Sana Farooq", isGroup: false,
      insights: [sanaInsight], commitments: [sendDeck], events: [coffeeSuggestion],
      needsReply: true,
      lastIncoming: { role: "user", content: "Can you send the price list and confirm Thursday delivery?", timestamp: Math.floor(hourAgo / 1_000) },
      updatedAt: Date.now() - 2 * 60_000,
    }],
    commitments: [{ ...sendDeck, chatId: "sana@demo", contactName: "Sana Farooq" }],
    changes: [
      { ...sanaInsight, chatId: "sana@demo", contactName: "Sana Farooq" },
      { ...teamInsight, chatId: "product-team@demo", contactName: "Product Team" },
      { ...bilalInsight, chatId: "bilal@demo", contactName: "Bilal Khan" },
    ],
    events: [
      { ...launchReview, chatId: "product-team@demo", contactName: "Product Team" },
      { ...coffeeSuggestion, chatId: "sana@demo", contactName: "Sana Farooq" },
    ],
    chats: [
      { chatId: "sana@demo", contactName: "Sana Farooq", isGroup: false, insights: [sanaInsight], commitments: [sendDeck], events: [coffeeSuggestion], needsReply: true, lastIncoming: { role: "user", content: "Can you send the price list and confirm Thursday delivery?", timestamp: Math.floor(hourAgo / 1_000) }, updatedAt: Date.now() - 2 * 60_000 },
      { chatId: "bilal@demo", contactName: "Bilal Khan", isGroup: false, insights: [bilalInsight], commitments: [], events: [], needsReply: false, updatedAt: Date.now() - 18 * 60_000 },
      { chatId: "product-team@demo", contactName: "Product Team", isGroup: true, insights: [teamInsight], commitments: [], events: [launchReview], needsReply: false, updatedAt: Date.now() - 12 * 60_000 },
    ],
    questionHistory: [{
      id: "demo-question-1",
      question: "What should I focus on today?",
      answer: "Send Sana the launch deck before noon, then prepare for tomorrow’s 3 PM product review.",
      sources: [],
      createdAt: Date.now() - 25 * 60_000,
    }],
    suggestedQuestions: ["What needs my attention?", "What’s on my schedule?", "What does Sana prefer?"],
  };
}
