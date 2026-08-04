import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
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
};

function pythonExecutable(): string {
  const configured = process.env.AMIROS_PYTHON_BIN?.trim();
  if (configured) return configured;
  const bundled = resolve(dirname(process.execPath), "../../python/bin/python3");
  return existsSync(bundled) ? bundled : "python3";
}

export function safePdfFilename(contactName: string): string {
  const slug = contactName
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60) || "contact";
  return `AmirOS-profile-${slug}.pdf`;
}

export async function generateContactProfilePdf(
  input: ContactProfilePdfInput,
): Promise<Buffer> {
  const scriptPath = resolve("scripts/profile-pdf.py");
  if (!existsSync(scriptPath)) throw new Error("The profile PDF generator is missing");
  const child = spawn(pythonExecutable(), [scriptPath], {
    cwd: resolve("."),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output: Buffer[] = [];
  const errors: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
  child.stdin.end(JSON.stringify({
    contactName: input.contactName,
    relationship: input.contact.relationship,
    tone: input.contact.tone,
    language: input.contact.language,
    summary: input.profile.summary,
    generatedAt: new Date(input.profile.updatedAt).toISOString(),
    sourceMessageCount: input.profile.sourceMessageCount,
    manualMemory: input.manualMemory.map((item) => item.content),
    isGroup: input.isGroup,
    profileImage: input.profileImage,
    insights: input.insights.filter((item) => item.status !== "outdated").slice(-30),
    commitments: input.commitments.filter((item) => item.status === "open").slice(-20),
    styleProfile: input.styleProfile,
    groupSummary: input.groupSummary,
    logoPath: resolve("ui/public/amiros-mark-v2-cropped.png"),
  }));
  const exitCode = await new Promise<number | null>((accept, reject) => {
    child.once("error", reject);
    child.once("close", accept);
  });
  if (exitCode !== 0) {
    const detail = Buffer.concat(errors).toString("utf8").trim();
    throw new Error(detail || "Profile PDF generation failed");
  }
  const pdf = Buffer.concat(output);
  if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error("Profile PDF generation returned an invalid document");
  }
  return pdf;
}
