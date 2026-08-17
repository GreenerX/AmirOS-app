import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const landingPageUrl = new URL(
  "../assets/landing-page/index.html",
  import.meta.url,
);

test("early-access form keeps the verified Netlify fields and spam protection", async () => {
  const html = await readFile(landingPageUrl, "utf8");
  const form = html.match(
    /<form\b[^>]*name="early-access"[\s\S]*?<\/form>/,
  )?.[0];

  assert.ok(form, "early-access form should exist");
  assert.match(form, /data-netlify="true"/);
  assert.match(form, /netlify-honeypot="company"/);
  assert.match(form, /name="form-name" value="early-access"/);
  assert.match(
    form,
    /<input\b[^>]*name="full-name"[^>]*autocomplete="name"[^>]*required/,
  );
  assert.match(
    form,
    /<input\b[^>]*name="email"[^>]*type="email"[^>]*required/,
  );
  assert.match(form, /<textarea\b[^>]*name="interest"/);
  assert.match(form, /<input\b[^>]*name="company"/);
  assert.doesNotMatch(form, /name="(?:submissionId|submission-id)"/);
  assert.match(form, /Request private beta access/);
  assert.match(
    form,
    /Amir reviews each request personally\. If approved, you'll receive a secure account invitation by email\./,
  );
});

test("thank-you page explains the controlled activation path", async () => {
  const html = await readFile(
    new URL("../assets/landing-page/thanks.html", import.meta.url),
    "utf8",
  );

  assert.match(html, /Request received/);
  assert.match(html, /Amir will review your request\./);
  assert.match(html, /If approved, you'll receive a secure account invitation by email\./);
  assert.match(html, /a short checklist in Control Center/);
  assert.match(html, /downloading AmirOS and connecting your Mac/);
  assert.doesNotMatch(html, /your account (?:is|has been) ready/i);
});
