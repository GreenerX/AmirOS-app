import { createHash, createHmac } from "node:crypto";

export const CONTROL_CENTER_INTAKE_URL =
  "https://amiros-control-center.netlify.app/api/beta-applications/intake";

const EARLY_ACCESS_FORM_NAME = "early-access";
const INTAKE_SECRET_NAME = "CONTROL_CENTER_INTAKE_SECRET";

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Verified early-access submission is missing ${label}.`);
  }

  return value.trim();
}

function optionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function verifiedSubmissionId({ fullName, email, interest }) {
  // Netlify's supported FormSubmittedEvent exposes the verified form fields,
  // not a submission ID. Derive a stable server-side id from only those
  // platform-verified fields. The Control Center also deduplicates by email.
  const digest = createHash("sha256")
    .update(JSON.stringify({ fullName, email: email.toLowerCase(), interest }))
    .digest("hex");
  return `form-${digest}`;
}

export function readVerifiedSubmission(event) {
  const data = event?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid Netlify formSubmitted event payload.");
  }

  const formName = optionalString(data["form-name"] ?? data.form_name);
  if (formName !== EARLY_ACCESS_FORM_NAME) return null;

  const fullName = requiredString(data["full-name"], "full name");
  const email = requiredString(data.email, "email");
  const interest = optionalString(data.interest);
  return {
    submissionId: verifiedSubmissionId({ fullName, email, interest }),
    fullName,
    email,
    interest,
  };
}

export function createSignedIntakeRequest(submission, secret, timestamp) {
  const signingSecret = requiredString(secret, INTAKE_SECRET_NAME);
  const timestampText = String(timestamp);
  const body = JSON.stringify(submission);
  const signature = createHmac("sha256", signingSecret)
    .update(`${timestampText}.${body}`)
    .digest("hex");

  return {
    body,
    headers: {
      "Content-Type": "application/json",
      "X-AmirOS-Timestamp": timestampText,
      "X-AmirOS-Signature": `sha256=${signature}`,
    },
  };
}

function getServerSecret() {
  const value = globalThis.Netlify?.env?.get?.(INTAKE_SECRET_NAME);
  return requiredString(value, INTAKE_SECRET_NAME);
}

export function createFormSubmittedHandler({
  fetchImpl = globalThis.fetch,
  getSecret = getServerSecret,
  now = Date.now,
} = {}) {
  return async function formSubmitted(event) {
    const submission = readVerifiedSubmission(event);
    if (submission === null) return;
    if (typeof fetchImpl !== "function") {
      throw new Error("The Netlify Functions runtime did not provide fetch.");
    }

    const signedRequest = createSignedIntakeRequest(submission, getSecret(), now());
    const response = await fetchImpl(CONTROL_CENTER_INTAKE_URL, {
      method: "POST",
      headers: signedRequest.headers,
      body: signedRequest.body,
    });
    if (!response.ok) {
      throw new Error(`Control Center applicant intake failed with HTTP ${response.status}.`);
    }
  };
}

// The explicit event handler is Netlify's supported subscription mechanism.
// Netlify verifies the platform event before this code is invoked.
export default {
  formSubmitted: createFormSubmittedHandler(),
};
