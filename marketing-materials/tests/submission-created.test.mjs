import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  CONTROL_CENTER_INTAKE_URL,
  createFormSubmittedHandler,
  readVerifiedSubmission,
} from "../netlify/functions/early-access-intake.mjs";

const secret = "test-only-shared-secret";
const timestamp = 1_786_942_800_123;

function formSubmittedEvent({
  formName = "early-access",
  fullName = "Sarah Miller",
  email = "sarah@example.com",
  interest = "I want to be more thoughtful with follow-ups.",
  extraData = {},
} = {}) {
  return {
    data: {
      "form-name": formName,
      "full-name": fullName,
      email,
      interest,
      ...extraData,
    },
  };
}

test("forwards the verified submission using the exact signed JSON body", async () => {
  const calls = [];
  const handler = createFormSubmittedHandler({
    getSecret: () => secret,
    now: () => timestamp,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(null, { status: 202 });
    },
  });

  await handler(formSubmittedEvent());

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, CONTROL_CENTER_INTAKE_URL);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(calls[0].init.headers["X-AmirOS-Timestamp"], String(timestamp));

  const expectedSubmission = readVerifiedSubmission(formSubmittedEvent());
  const expectedBody = JSON.stringify({
    submissionId: expectedSubmission.submissionId,
    fullName: "Sarah Miller",
    email: "sarah@example.com",
    interest: "I want to be more thoughtful with follow-ups.",
  });
  const expectedSignature = createHmac("sha256", secret)
    .update(`${timestamp}.${expectedBody}`)
    .digest("hex");

  assert.equal(calls[0].init.body, expectedBody);
  assert.equal(
    calls[0].init.headers["X-AmirOS-Signature"],
    `sha256=${expectedSignature}`,
  );
});

test("derives a stable id from verified fields and ignores a spoofed browser submission ID", () => {
  const parsed = readVerifiedSubmission(formSubmittedEvent({
    fullName: "Jake Thompson",
    email: "jake@example.com",
    interest: "",
    extraData: { submissionId: "browser-controlled-id" },
  }));
  const repeated = readVerifiedSubmission(formSubmittedEvent({
    fullName: "Jake Thompson",
    email: "jake@example.com",
    interest: "",
    extraData: { submissionId: "another-browser-value" },
  }));

  assert.equal(parsed.submissionId, repeated.submissionId);
  assert.match(parsed.submissionId, /^form-[a-f0-9]{64}$/u);
  assert.equal(parsed.interest, "");
});

test("does not forward submissions from another form", async () => {
  let called = false;
  const handler = createFormSubmittedHandler({
    getSecret: () => secret,
    fetchImpl: async () => {
      called = true;
      return new Response(null, { status: 202 });
    },
  });

  await handler(formSubmittedEvent({ formName: "contact" }));
  assert.equal(called, false);
});

test("rejects an event without Netlify's verified form data", () => {
  assert.throws(
    () => readVerifiedSubmission({}),
    /formSubmitted event payload/,
  );
});

test("fails closed when the server-only secret is missing", async () => {
  let called = false;
  const handler = createFormSubmittedHandler({
    getSecret: () => undefined,
    fetchImpl: async () => {
      called = true;
      return new Response(null, { status: 202 });
    },
  });

  await assert.rejects(handler(formSubmittedEvent()), /CONTROL_CENTER_INTAKE_SECRET/);
  assert.equal(called, false);
});

test("surfaces a rejected Control Center intake in the event function logs", async () => {
  const handler = createFormSubmittedHandler({
    getSecret: () => secret,
    now: () => timestamp,
    fetchImpl: async () => new Response(null, { status: 503 }),
  });

  await assert.rejects(handler(formSubmittedEvent()), /HTTP 503/);
});
