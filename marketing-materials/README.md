# AmirOS marketing site

The AmirOS Early Access site is a dependency-free static Netlify site published from `assets/`. Netlify Functions live outside that public directory in `netlify/functions/`.

## Beta application intake

The landing form is named `early-access` and collects required `full-name` and `email` fields plus optional `interest`. Netlify's honeypot remains enabled.

The `netlify/functions/early-access-intake.mjs` event function forwards verified `early-access` submissions to the Control Center applicant intake endpoint. It derives a stable idempotency key from Netlify-verified form fields and the Control Center also deduplicates by normalized email; it never accepts a browser-generated identifier.

The function signs `timestamp + "." + exactRawJsonBody` with HMAC-SHA256 and sends the signature as `X-AmirOS-Signature: sha256=<hex>`. Before a coordinated deployment, set the same server-only `CONTROL_CENTER_INTAKE_SECRET` in both Netlify projects' Functions environment. Do not prefix it with `VITE_`, place it in HTML or JavaScript under `assets/`, or commit its value.

The function uses Netlify's explicit `formSubmitted` platform-event subscription. Netlify verifies the event before the function runs; the landing browser never receives the server-only intake secret.

Focused source validation:

```sh
node --test marketing-materials/tests/*.test.mjs
```

No applicant should be promised an automatic invitation. Approval and the normal Netlify Identity invitation remain manual during the controlled beta pilot.

After deployment, submissions appear in the site's **Forms** area in Netlify. To receive each request by email, add a form-submission notification under **Project configuration → Notifications**. Netlify form detection must be enabled for the site.
