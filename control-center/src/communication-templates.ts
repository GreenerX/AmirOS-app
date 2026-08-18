export type CommunicationTemplateKey = "invite-guidance" | "welcome-setup" | "support-follow-up" | "personal-ai-access" | "mac-setup" | "update-ready" | "blank-note";

export type CommunicationTemplateOptions = {
  personalAccessLink?: string;
  customSubject?: string;
  customBody?: string;
};

export type RenderedCommunication = {
  subject: string;
  plainText: string;
  mailDraftText: string;
  html: string;
};

const markUrl = "https://amiros-early-access.netlify.app/landing-page/amiros-mark-v2-cropped-256.png";
const controlCenterUrl = "https://amiros-control-center.netlify.app/account/";

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] || character);
}

function firstName(name: string): string {
  const candidate = name.trim().split(/\s+/)[0];
  return candidate ? candidate.slice(0, 80) : "there";
}

type TemplateCopy = {
  subject: string;
  eyebrow: string;
  headline: string;
  paragraphs: string[];
  steps?: string[];
  action?: { label: string; href: string };
  closing: string;
  footer?: string;
};

function copyFor(template: CommunicationTemplateKey, name: string, options: CommunicationTemplateOptions): TemplateCopy {
  const greeting = firstName(name);
  if (template === "invite-guidance") {
    return {
      subject: "AmirOS private beta — next steps ✦",
      eyebrow: "PRIVATE BETA",
      headline: "Your place in the private beta.",
      paragraphs: [
        `Hi ${greeting},`,
        "The standard Netlify Identity email is a separate Control Center account invitation. It contains your account sign-in link; this branded guidance email does not.",
        "Once your account is ready, open the Control Center to download AmirOS and begin connecting your Mac.",
      ],
      action: { label: "Open Control Center", href: controlCenterUrl },
      closing: "Amir",
    };
  }
  if (template === "welcome-setup") {
    return {
      subject: "Welcome to AmirOS ✦",
      eyebrow: "WELCOME",
      headline: "A calmer way to get started.",
      paragraphs: [`Hi ${greeting},`, "The standard Netlify Identity email is a separate Control Center account invitation. It contains your account sign-in link; this branded guidance email does not.", "Once you are signed in, the Control Center will guide you through the guided setup."],
      steps: ["Sign in to the Control Center.", "Choose Latest private beta download for your Mac.", "Open AmirOS and select Connect this Mac."],
      action: { label: "Continue setup", href: controlCenterUrl },
      closing: "Amir",
    };
  }
  if (template === "personal-ai-access") {
    const hasPersonalLink = Boolean(options.personalAccessLink);
    return {
      subject: "Your AmirOS AI setup ✦",
      eyebrow: "PERSONAL AI ACCESS",
      headline: "Your private AI access.",
      paragraphs: hasPersonalLink
        ? [`Hi ${greeting},`, "Your individual OpenAI key is available through the secure personal link below. Enter it only in AmirOS. Never forward, email, or send it to Support."]
        : [`Hi ${greeting},`, "This message can include a secure personal link to your individual OpenAI key. No personal link has been added to this exported copy."],
      action: hasPersonalLink ? { label: "Open secure personal link", href: options.personalAccessLink! } : undefined,
      closing: "Amir",
      footer: "This message is intended for one person and contains no Control Center account sign-in link.",
    };
  }
  if (template === "mac-setup") {
    return {
      subject: "Set up AmirOS on your Mac ✦",
      eyebrow: "MAC SETUP",
      headline: "Let’s connect this Mac.",
      paragraphs: [`Hi ${greeting},`, "Open AmirOS on the Mac you want to use, then select Connect this Mac. The Control Center will show when the connection is ready."],
      steps: ["Sign in to the Control Center.", "Choose Latest private beta download for your Mac.", "Open AmirOS and select Connect this Mac."],
      action: { label: "Open Control Center", href: controlCenterUrl },
      closing: "Amir",
    };
  }
  if (template === "update-ready") {
    return {
      subject: "A new AmirOS beta update is ready ✦",
      eyebrow: "UPDATE READY",
      headline: "A calmer improvement is ready.",
      paragraphs: [`Hi ${greeting},`, "A new AmirOS update is ready for your Mac. Open the Control Center to choose the Latest private beta download when you are ready."],
      action: { label: "Latest private beta download", href: controlCenterUrl },
      closing: "Amir",
    };
  }
  if (template === "blank-note") {
    const paragraphs = (options.customBody || "").split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
    return {
      subject: (options.customSubject || "").trim() ? `${(options.customSubject || "").trim()} ✦` : "A note from AmirOS ✦",
      eyebrow: "A NOTE FROM AMIROS",
      headline: (options.customSubject || "").trim() || "Your message will appear here.",
      paragraphs: [`Hi ${greeting},`, ...paragraphs],
      closing: "Amir",
    };
  }
  return {
    subject: "AmirOS support follow-up ✦",
    eyebrow: "SUPPORT",
    headline: "Here when you need us.",
    paragraphs: [
      `Hi ${greeting},`,
      "Thanks for getting in touch. Please continue with Help & feedback in AmirOS or open Support in the Control Center so your request stays connected to your account.",
      "For your privacy, please do not include credentials or private personal information in an email reply.",
    ],
    action: { label: "Open support", href: controlCenterUrl },
    closing: "Amir",
  };
}

function emailShell(copy: TemplateCopy): string {
  const paragraphs = copy.paragraphs.map((paragraph) => `<p style="margin:0 0 17px;color:#53605b;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.65;">${escapeHtml(paragraph)}</p>`).join("");
  const steps = copy.steps
    ? `<ol style="margin:0 0 24px;padding:18px 18px 18px 36px;border:1px solid #dce5e0;border-radius:12px;color:#53605b;background:#f7faf8;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.75;">${copy.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(copy.subject)}</title></head>
<body style="margin:0;padding:0;background:#eef6f2;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#eef6f2;"><tr><td align="center" style="padding:36px 16px;">
    <table role="presentation" width="620" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;background:#ffffff;border:1px solid #dce5e0;border-radius:18px;overflow:hidden;">
      <tr><td style="padding:29px 38px 22px;border-bottom:1px solid #dce5e0;"><img src="${markUrl}" width="34" height="34" alt="AmirOS" style="display:block;width:34px;height:34px;" /></td></tr>
      <tr><td style="padding:40px 38px 30px;">
        <p style="margin:0 0 15px;color:#078a56;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.7px;">${escapeHtml(copy.eyebrow)}</p>
        <h1 style="margin:0 0 22px;color:#17202b;font-family:Georgia,'Times New Roman',serif;font-size:42px;font-weight:400;letter-spacing:-1.7px;line-height:1.06;">${escapeHtml(copy.headline)}</h1>
        ${paragraphs}${steps}${copy.action ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-radius:9px;background:#078a56;"><a href="${escapeHtml(copy.action.href)}" style="display:inline-block;padding:13px 19px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;line-height:1;text-decoration:none;">${escapeHtml(copy.action.label)} &#8599;</a></td></tr></table>` : ""}
        <p style="margin:26px 0 0;color:#53605b;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.65;">${escapeHtml(copy.closing)}<br>AmirOS</p>
      </td></tr>
      <tr><td style="padding:20px 38px;border-top:1px solid #dce5e0;color:#77827c;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.55;">${escapeHtml(copy.footer || "This guidance contains no account credentials.")}</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export function renderCommunicationTemplate(template: CommunicationTemplateKey, recipientName: string, options: CommunicationTemplateOptions = {}): RenderedCommunication {
  const copy = copyFor(template, recipientName, options);
  const footer = copy.footer || "This guidance contains no account credentials.";
  const plainText = [copy.paragraphs.join("\n\n"), copy.steps ? `Setup checklist:\n${copy.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}` : "", copy.action ? `${copy.action.label}: ${copy.action.href}` : "", `${copy.closing}\nAmirOS`, footer].filter(Boolean).join("\n\n");
  const mailDraftText = template === "personal-ai-access" && options.personalAccessLink
    ? [`Hi ${firstName(recipientName)},`, "Your individual OpenAI key is prepared for you. For privacy, the secure personal link is not included in this email draft. Use the copied branded content only when you are ready to add it privately.", `${copy.closing}\nAmirOS`, footer].join("\n\n")
    : plainText;
  return { subject: copy.subject, plainText, mailDraftText, html: emailShell(copy) };
}
