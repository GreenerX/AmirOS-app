import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ContactInsight,
  ContactMemoryItem,
  ContactPreferences,
  ContactProfile,
  GroupConversationSummary,
  RelationshipCommitment,
  WritingStyleProfile,
} from "./amiros-state.js";

export type ContactProfilePdfInput = {
  contactName: string;
  contact: ContactPreferences;
  profile: ContactProfile;
  manualMemory: ContactMemoryItem[];
  isGroup: boolean;
  profileImage?: { data: string; mimetype: string };
  insights: ContactInsight[];
  commitments: RelationshipCommitment[];
  styleProfile?: WritingStyleProfile;
  groupSummary?: GroupConversationSummary;
  generatedAt?: number;
  timezoneOffsetMinutes?: number;
  locale?: string;
};

function cleanText(value: unknown): string {
  return String(value || "")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .trim();
}

function escapeHtml(value: unknown): string {
  return cleanText(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] || character);
}

function text(value: unknown, tag = "span", className = ""): string {
  return `<${tag}${className ? ` class="${className}"` : ""} dir="auto">${escapeHtml(value)}</${tag}>`;
}

function formatDeviceTime(timestamp: number, offsetMinutes: number, locale: string): string {
  const shifted = new Date(timestamp - offsetMinutes * 60_000);
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "long", timeStyle: "short", timeZone: "UTC",
    }).format(shifted);
  } catch {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "long", timeStyle: "short", timeZone: "UTC",
    }).format(shifted);
  }
}

function summaryHtml(summary: string): string {
  const blocks: string[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (!list.length) return;
    blocks.push(`<ul>${list.map((item) => `<li dir="auto">${escapeHtml(item)}</li>`).join("")}</ul>`);
    list = [];
  };
  for (const raw of cleanText(summary).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flushList(); continue; }
    if (/^[-*•]\s*/u.test(line)) { list.push(line.replace(/^[-*•]\s*/u, "")); continue; }
    flushList();
    if (line.length <= 80 && !/[.!?:]$/u.test(line)) blocks.push(text(line, "h3"));
    else blocks.push(text(line, "p"));
  }
  flushList();
  return blocks.join("");
}

function chromeExecutable(): string {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH?.trim(),
    process.env.CHROME_BIN?.trim(),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter((candidate): candidate is string => Boolean(candidate));
  const executable = candidates.find(existsSync);
  if (!executable) throw new Error("Chrome is required to export Unicode profile PDFs");
  return executable;
}

async function imageDataUrl(path: string): Promise<string> {
  const data = await readFile(path);
  return `data:image/png;base64,${data.toString("base64")}`;
}

function renderPdfHtml(input: ContactProfilePdfInput, logoUrl: string): string {
  const generatedAt = input.generatedAt || Date.now();
  const offset = Number.isFinite(input.timezoneOffsetMinutes)
    ? input.timezoneOffsetMinutes as number
    : new Date().getTimezoneOffset();
  const locale = input.locale?.trim().slice(0, 35) || "en";
  const generatedLabel = formatDeviceTime(generatedAt, offset, locale);
  const contactName = cleanText(input.contactName) || "WhatsApp contact";
  const profileImageUrl = input.profileImage
    ? `data:${input.profileImage.mimetype};base64,${input.profileImage.data}`
    : "";
  const initials = contactName.split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "A";
  const insights = input.insights.filter((item) => item.status !== "outdated").slice(-30);
  const commitments = input.commitments.filter((item) => item.status === "open").slice(-20);
  const insightHtml = insights.map((item) => `<article class="signal">
    <div class="signal-heading">${text(item.kind.replaceAll("_", " "), "strong")}<span>${Math.round(item.confidence * 100)}%</span></div>
    ${text(item.content, "p")}
    <blockquote dir="auto">${escapeHtml(item.evidence.senderName || contactName)}: ${escapeHtml(item.evidence.excerpt)}</blockquote>
  </article>`).join("");
  const commitmentHtml = commitments.map((item) => {
    const owner = item.owner === "me" ? "Amir" : item.assigneeName || "Contact";
    return `<li class="commitment"><strong dir="auto">${escapeHtml(owner)}</strong><span dir="auto">${escapeHtml(item.content)}</span></li>`;
  }).join("");
  const style = input.styleProfile;
  const group = input.groupSummary;
  const memoryHtml = input.manualMemory.map((item) => `<li dir="auto">${escapeHtml(item.content)}</li>`).join("");

  return `<!doctype html><html lang="${escapeHtml(locale)}"><head><meta charset="utf-8"><title>AmirOS profile — ${escapeHtml(contactName)}</title><style>
    @page { size: A4; margin: 10mm 15mm; }
    * { box-sizing: border-box; }
    html { color: #17231e; background: white; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", Arial, "Arial Hebrew", "Apple Color Emoji", "Segoe UI Emoji", sans-serif; }
    body { margin: 0; font-size: 9.4pt; line-height: 1.43; }
    [dir="rtl"] { text-align: right; unicode-bidi: plaintext; }
    header { display: flex; align-items: center; height: 10mm; margin-bottom: 4mm; border-bottom: .35mm solid #d9e6df; }
    header img { width: 9mm; height: 9mm; object-fit: contain; margin-right: 2.5mm; }
    header strong { display: block; color: #112a23; font-size: 13pt; line-height: 1.05; }
    header small { color: #66736d; font-size: 7.5pt; }
    footer { display: flex; justify-content: space-between; margin-top: 4mm; padding-top: 2.5mm; border-top: .3mm solid #d9e6df; color: #66736d; font-size: 7.2pt; break-inside: avoid; }
    .hero { display: grid; grid-template-columns: 24mm 1fr; gap: 5mm; align-items: center; min-height: 32mm; padding: 4.5mm 6mm; border: .35mm solid #d9e6df; border-radius: 4mm; background: linear-gradient(135deg,#f8fbf9,#edf7f1); break-inside: avoid; }
    .avatar { display: grid; place-items: center; width: 22mm; height: 22mm; overflow: hidden; border: .8mm solid white; border-radius: 50%; color: #0f4f36; background: #dcefe4; box-shadow: 0 1.5mm 4mm rgba(17,42,35,.12); font-size: 14pt; font-weight: 800; }
    .avatar img { width: 100%; height: 100%; object-fit: cover; }
    .eyebrow { margin: 0 0 1mm; color: #197a52; font-size: 7pt; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; }
    h1 { margin: 0; color: #112a23; font-size: 20pt; line-height: 1.1; font-weight: 800; }
    .hero-meta { display: flex; flex-wrap: wrap; gap: 1.5mm; align-items: center; margin-top: 2mm; color: #66736d; font-size: 8.3pt; }
    .metrics { display: grid; grid-template-columns: repeat(3,1fr); margin: 3.5mm 0 1mm; overflow: hidden; border: .35mm solid #d9e6df; border-radius: 3mm; background: #edf7f1; break-inside: avoid; }
    .metric { padding: 2.6mm; text-align: center; border-right: .3mm solid #d9e6df; }.metric:last-child{border:0}.metric strong{display:block;color:#0f4f36;font-size:15pt}.metric span{color:#66736d;font-size:7pt;font-weight:650}
    section { margin-top: 3.5mm; } section > h2 { margin: 0 0 1.8mm; padding-bottom: 1.1mm; border-bottom: .5mm solid #197a52; color: #0f4f36; font-size: 13.5pt; line-height: 1.18; font-weight: 800; break-after: avoid; }
    section.compact { break-inside: avoid; }
    h3 { margin: 2.5mm 0 1mm; color: #112a23; font-size: 10.5pt; font-weight: 800; } p { margin: 0 0 1.6mm; } ul { margin: .7mm 0 0; padding-inline-start: 6mm; } li { margin-bottom: 1.1mm; }
    .signals { display: grid; grid-template-columns: 1fr 1fr; gap: 2.5mm; }.signal { padding: 2.8mm; border: .3mm solid #d9e6df; border-radius: 2.5mm; background: #f8fbf9; break-inside: avoid; }.signal:only-child{grid-column:1/-1}.signal-heading{display:flex;justify-content:space-between;gap:3mm;color:#0f4f36;text-transform:capitalize}.signal-heading span{color:#197a52;font-weight:800}.signal p{margin:1mm 0;font-weight:700}.signal blockquote{margin:0;padding-inline-start:2.5mm;border-inline-start:.6mm solid #c7ddd1;color:#66736d;font-size:7.5pt}
    .style-grid { display:grid;grid-template-columns:repeat(3,1fr);gap:0;overflow:hidden;border:.3mm solid #d9e6df;border-radius:2.5mm }.style-grid div{padding:3mm;border-right:.3mm solid #d9e6df}.style-grid div:last-child{border:0}.style-grid small{display:block;color:#66736d;font-size:7pt;font-weight:750;text-transform:uppercase}.style-grid strong{display:block;margin-top:1mm;color:#112a23}
    .commitment { display:grid;grid-template-columns:25mm minmax(0,1fr);gap:2mm;align-items:start }.commitment strong{color:#0f4f36}.note { margin-top: 3.5mm; padding: 2.8mm; border: .3mm solid #d9e6df; border-radius: 2.5mm; color: #52615a; background: #f8fbf9; font-size: 7.8pt; break-inside: avoid; }.note strong{color:#112a23;font-size:8.7pt}.audit-line{display:flex;flex-wrap:wrap;gap:1mm 2mm;align-items:baseline}.audit-line bdi{font-weight:700;color:#33473f}
  </style></head><body>
    <header><img src="${logoUrl}" alt=""><div><strong>AmirOS</strong><small>Private relationship intelligence</small></div></header>
    <main>
      <div class="hero"><div class="avatar">${profileImageUrl ? `<img src="${profileImageUrl}" alt="">` : escapeHtml(initials)}</div><div><p class="eyebrow">${input.isGroup ? "Group relationship profile" : "Private contact profile"}</p>${text(contactName,"h1")}<div class="hero-meta"><strong dir="auto">${escapeHtml(input.contact.relationship || "Contact")}</strong><span>•</span><strong dir="auto">${escapeHtml(input.contact.tone || "Automatic")}</strong><span>•</span><span dir="auto">${escapeHtml(input.contact.language || "Automatic")}</span></div></div></div>
      <div class="metrics"><div class="metric"><strong>${input.profile.sourceMessageCount}</strong><span>TRACKED MESSAGES</span></div><div class="metric"><strong>${insights.length}</strong><span>ACTIVE INSIGHTS</span></div><div class="metric"><strong>${commitments.length}</strong><span>OPEN COMMITMENTS</span></div></div>
      <section><h2>Profile analysis</h2>${summaryHtml(input.profile.summary)}</section>
      ${insights.length ? `<section><h2>Relationship intelligence</h2><div class="signals">${insightHtml}</div></section>` : ""}
      ${commitments.length ? `<section><h2>Open commitments</h2><ul>${commitmentHtml}</ul></section>` : ""}
      ${style ? `<section><h2>Communication style</h2>${text(style.summary,"p")}<div class="style-grid"><div><small>Message length</small>${text(style.messageLength,"strong")}</div><div><small>Emoji use</small>${text(style.emojiUse,"strong")}</div><div><small>Formality</small>${text(style.formality,"strong")}</div></div><ul>${style.replyGuidance.map((item) => `<li dir="auto">${escapeHtml(item)}</li>`).join("")}</ul></section>` : ""}
      ${group ? `<section><h2>Group dynamics</h2>${text(group.summary,"p")}${[["Decisions",group.decisions],["Tasks",group.tasks],["Open questions",group.unansweredQuestions]].map(([heading,values]) => (values as string[]).length ? `${text(heading,"h3")}<ul>${(values as string[]).map((item) => `<li dir="auto">${escapeHtml(item)}</li>`).join("")}</ul>` : "").join("")}</section>` : ""}
      ${input.manualMemory.length ? `<section class="compact"><h2>Operator-saved memory</h2><ul>${memoryHtml}</ul></section>` : ""}
      <div class="note"><strong>Analysis details</strong><div class="audit-line"><span>Generated</span><bdi dir="auto">${escapeHtml(generatedLabel)}</bdi><span>· ${input.profile.sourceMessageCount} tracked messages</span><span>· ${input.manualMemory.length} manual memory items</span></div>Inferences are evidence-backed where available, but may still be incomplete and should be reviewed.</div>
    </main>
    <footer><span>Private analysis generated locally by AmirOS</span><bdi dir="auto">${escapeHtml(generatedLabel)}</bdi></footer>
  </body></html>`;
}

export function safePdfFilename(contactName: string): string {
  const slug = contactName.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60) || "contact";
  return `AmirOS-profile-${slug}.pdf`;
}

export async function generateContactProfilePdf(input: ContactProfilePdfInput): Promise<Buffer> {
  const logoUrl = await imageDataUrl(resolve("ui/public/amiros-mark-v2-cropped.png"));
  const require = createRequire(import.meta.url);
  const whatsappEntry = require.resolve("whatsapp-web.js");
  const puppeteerEntry = require.resolve("puppeteer", { paths: [dirname(whatsappEntry)] });
  const puppeteerModule = await import(pathToFileURL(puppeteerEntry).href) as {
    default: {
      launch(options: { headless: boolean; executablePath: string; args: string[] }): Promise<{
        newPage(): Promise<{
          setContent(html: string, options: { waitUntil: string }): Promise<void>;
          pdf(options: { format: string; printBackground: boolean; preferCSSPageSize: boolean }): Promise<Uint8Array>;
        }>;
        close(): Promise<void>;
      }>;
    };
  };
  const browser = await puppeteerModule.default.launch({
    headless: true,
    executablePath: chromeExecutable(),
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-background-networking"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(renderPdfHtml(input, logoUrl), { waitUntil: "load" });
    const pdf = Buffer.from(await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true }));
    if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("Profile PDF generation returned an invalid document");
    return pdf;
  } finally {
    await browser.close();
  }
}
