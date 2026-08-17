import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Config, Context } from "@netlify/functions";
import { databaseUnavailable, getSupabaseAdmin } from "./_shared/supabase";
import { json, methodNotAllowed } from "./_shared/http";

const MAX_BODY_BYTES = 12_000;
const MAX_AGE_MS = 5 * 60 * 1_000;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const submissionPattern = /^[A-Za-z0-9_-]{8,160}$/;

type Intake = {
  submissionId: string;
  email: string;
  emailNormalized: string;
  fullName: string;
  interest?: string;
};

function cleanText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/\s+/gu, " ").trim();
  return cleaned && cleaned.length <= maximum ? cleaned : undefined;
}

function parseIntake(value: unknown): Intake | Response {
  if (!value || typeof value !== "object") return json({ message: "A beta application is required." }, 400);
  const input = value as Record<string, unknown>;
  const submissionId = typeof input.submissionId === "string" ? input.submissionId : "";
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const fullName = cleanText(input.fullName, 160);
  const interest = input.interest === undefined || input.interest === null ? undefined : cleanText(input.interest, 2_000);
  if (!submissionPattern.test(submissionId) || !emailPattern.test(email) || email.length > 320 || !fullName || (input.interest !== undefined && input.interest !== null && !interest)) {
    return json({ message: "The beta application payload is invalid." }, 400);
  }
  return { submissionId, email, emailNormalized: email.toLowerCase(), fullName, interest };
}

function validSignature(secret: string, timestamp: string, body: string, supplied: string | null): boolean {
  if (!/^[0-9]{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > MAX_AGE_MS || !supplied) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const candidate = supplied.replace(/^sha256=/u, "");
  if (!/^[a-f0-9]{64}$/u.test(candidate)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(candidate, "hex"));
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function validNetlifyWebhookSignature(secret: string, body: string, supplied: string | null): boolean {
  if (!supplied) return false;
  const parts = supplied.split(".");
  if (parts.length !== 3) return false;
  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  try {
    const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")) as unknown;
    const claims = JSON.parse(Buffer.from(encodedClaims, "base64url").toString("utf8")) as unknown;
    if (record(header)?.alg !== "HS256" || record(claims)?.iss !== "netlify") return false;
    const bodyHash = createHash("sha256").update(body).digest("hex");
    if (record(claims)?.sha256 !== bodyHash) return false;
    const expected = createHmac("sha256", secret).update(`${encodedHeader}.${encodedClaims}`).digest();
    const candidate = Buffer.from(encodedSignature, "base64url");
    return expected.length === candidate.length && timingSafeEqual(expected, candidate);
  } catch {
    return false;
  }
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string");
}

/** Normalize Netlify's verified Forms webhook payload into the existing intake shape. */
export function parseNetlifyFormsWebhook(value: unknown): Intake | Response {
  const outer = record(value);
  const payload = record(outer?.payload);
  const data = record(payload?.data) || record(outer?.data) || payload || outer;
  if (!outer || !data) return json({ message: "A verified Netlify form submission is required." }, 400);

  const formName = cleanText(firstString(
    data["form-name"],
    data.form_name,
    data.formName,
    payload?.form_name,
    outer.form_name,
  ), 120);
  if (formName && formName !== "early-access") {
    return json({ message: "This webhook only accepts early-access applications." }, 400);
  }

  const fullName = cleanText(firstString(data["full-name"], data.full_name, data.fullName, data.name, outer.name), 160);
  const email = firstString(data.email, outer.email)?.trim();
  const interest = cleanText(firstString(data.interest, data.message, outer.summary), 2_000);
  if (!fullName || !email || !emailPattern.test(email) || email.length > 320) {
    return json({ message: "The verified Netlify form submission is missing a valid name or email." }, 400);
  }

  const upstreamId = cleanText(firstString(payload?.id, outer.id, outer.submission_id), 160);
  const submissionId = upstreamId && submissionPattern.test(upstreamId)
    ? upstreamId
    : `form-${createHash("sha256")
      .update(JSON.stringify({ fullName, email: email.toLowerCase(), interest: interest || "" }))
      .digest("hex")}`;
  return { submissionId, email, emailNormalized: email.toLowerCase(), fullName, interest };
}

/**
 * Server-to-server intake for the public landing site's verified Forms event.
 * The landing function must sign `${timestamp}.${rawJsonBody}` with
 * CONTROL_CENTER_INTAKE_SECRET and must never expose that secret to a browser.
 */
export default async (request: Request, _context: Context): Promise<Response> => {
  if (request.method !== "POST") return methodNotAllowed();
  const secret = Netlify.env.get("CONTROL_CENTER_INTAKE_SECRET");
  if (!secret) return json({ message: "Beta application intake is not configured." }, 503);
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) return json({ message: "The beta application payload is too large." }, 413);
  const netlifyWebhook = request.headers.has("x-webhook-signature");
  console.info("beta_application_intake_received", {
    transport: netlifyWebhook ? "netlify_webhook" : "signed_relay",
    bodyBytes: rawBody.length,
  });
  const authorized = netlifyWebhook
    ? validNetlifyWebhookSignature(secret, rawBody, request.headers.get("x-webhook-signature"))
    : validSignature(secret, request.headers.get("x-amiros-timestamp") || "", rawBody, request.headers.get("x-amiros-signature"));
  if (!authorized) {
    console.warn("beta_application_intake_rejected", { stage: "signature" });
    return json({ message: "The beta application signature is invalid." }, 401);
  }
  const parsed = (() => {
    try {
      return JSON.parse(rawBody) as unknown;
    } catch {
      return undefined;
    }
  })();
  const intake = netlifyWebhook ? parseNetlifyFormsWebhook(parsed) : parseIntake(parsed);
  if (intake instanceof Response) {
    console.warn("beta_application_intake_rejected", { stage: "payload", status: intake.status });
    return intake;
  }

  const client = getSupabaseAdmin();
  if (client instanceof Response) return client;
  const { data: duplicateSubmission, error: submissionError } = await client
    .from("control_beta_applications")
    .select("id,state")
    .eq("submission_id", intake.submissionId)
    .maybeSingle();
  if (submissionError) {
    console.error("beta_application_intake_failed", { stage: "submission_lookup" });
    return databaseUnavailable();
  }
  if (duplicateSubmission) {
    console.info("beta_application_intake_accepted", { result: "duplicate_submission" });
    return json({ accepted: true, applicationId: duplicateSubmission.id, state: duplicateSubmission.state }, 202);
  }

  const { data: duplicateEmail, error: emailError } = await client
    .from("control_beta_applications")
    .select("id,state")
    .eq("email_normalized", intake.emailNormalized)
    .maybeSingle();
  if (emailError) {
    console.error("beta_application_intake_failed", { stage: "email_lookup" });
    return databaseUnavailable();
  }
  if (duplicateEmail) {
    if (duplicateEmail.state === "requested" || duplicateEmail.state === "reviewing") {
      const { error: updateError } = await client
        .from("control_beta_applications")
        .update({ email: intake.email, full_name: intake.fullName, interest: intake.interest || null })
        .eq("id", duplicateEmail.id);
      if (updateError) {
        console.error("beta_application_intake_failed", { stage: "email_update" });
        return databaseUnavailable();
      }
    }
    console.info("beta_application_intake_accepted", { result: "duplicate_email" });
    return json({ accepted: true, applicationId: duplicateEmail.id, state: duplicateEmail.state }, 202);
  }

  const { data, error } = await client
    .from("control_beta_applications")
    .insert({
      submission_id: intake.submissionId,
      email: intake.email,
      email_normalized: intake.emailNormalized,
      full_name: intake.fullName,
      interest: intake.interest || null,
    })
    .select("id,state")
    .single();
  if (error || !data) {
    console.error("beta_application_intake_failed", { stage: "insert" });
    return databaseUnavailable();
  }
  console.info("beta_application_intake_accepted", { result: "created" });
  return json({ accepted: true, applicationId: data.id, state: data.state }, 201);
};

export const config: Config = { path: "/api/beta-applications/intake", method: ["POST"] };
