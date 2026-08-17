# Control Center

The Control Center is the hosted, privacy-minimised operating layer around the
local AmirOS app. It is deliberately separate from AmirOS' WhatsApp, memory,
calendar, and local state.

## What this first milestone includes

- a user account and download portal
- a role-protected admin surface
- applicant review and an explicit invitation/pairing lifecycle
- Netlify Identity integration for signup, login, invite-only access, and roles
- Netlify Function API contracts for account snapshots, operator overview, and
  user-submitted support tickets
- a safe configuration boundary for future product renaming and domain moves

## Before deploying

1. Create a Netlify site with **base directory** set to `control-center`.
2. Enable Netlify Identity and set registration to **Invite only**.
3. Grant the first operator the `admin` role using server-controlled
   `app_metadata.roles`; never assign roles from browser-provided metadata.
4. Set the public `VITE_*` values and the private database configuration in
   Netlify environment variables.
5. Deploy a preview first. Identity requires a deployed Netlify environment;
   it does not run in local Netlify development.

## Beta-access lifecycle

The Control Center keeps request approval, Identity activation, and Mac pairing
as separate states:

`requested → reviewing → approved → invited → device_pending → active`

- A landing-site server function sends a signed application to the Control
  Center. The browser never receives a database key or intake secret.
- An operator approves the application in **Applicants**.
- The operator uses **Approve & send invite** in Applicants. The Control
  Center requests the normal Netlify Identity invitation server-side, while
  Netlify Identity remains the sole owner of the activation token. If that
  delivery is unavailable, the admin surface keeps the explicit **Copy email**
  and **Open Netlify** fallback; it never copies or handles an activation link.
- After the tester creates their password, their account is restricted to the
  download, connection instructions, support, and sign-out until a Mac is
  paired. A successful device approval moves both the account and application
  to `active` atomically.

Access status (`active`, `paused`, `revoked`) remains independent from setup
state. A paused or revoked user retains local data, but cannot obtain normal
entitlement or feature access.

## Live beta checklist

After account creation, the account portal and admin user detail show the same
read-only progression:

`Account created → Mac connection pending → Mac approved → WhatsApp connected → First people selected`

The first three entries are derived from the existing account/device lifecycle.
The last two are optional local-onboarding milestones, not entitlement gates:
they never change `setupState`, access status, features, or release access.
The Control Center stores only a completion timestamp for each. It does not
receive WhatsApp identity, messages, QR codes, API keys, contact names,
conversations, memory, or people selections.

The one displayed next action is intentionally contextual:

- signed-in account not yet approved: ask for activation;
- invited tester: connect this Mac;
- approved Mac: continue the local API/WhatsApp setup in AmirOS;
- WhatsApp ready: choose initial people after recent chats are available.

The Control Center must not make a browser-only setup step look like an access
gate. The local AmirOS app remains the source of truth for the actual WhatsApp
and people experiences.

## Landing application intake contract

The landing project should use a verified Netlify `formSubmitted` event
function, not browser JavaScript, to call:

```text
POST https://<control-center-host>/api/beta-applications/intake
Content-Type: application/json
X-AmirOS-Timestamp: <unix milliseconds>
X-AmirOS-Signature: sha256=<HMAC-SHA256(timestamp + "." + raw JSON body)>
```

The JSON body is:

```json
{
  "submissionId": "stable-netlify-submission-id",
  "fullName": "Tester name",
  "email": "tester@example.com",
  "interest": "Optional short response"
}
```

Both sites need the same private `CONTROL_CENTER_INTAKE_SECRET`. The endpoint
accepts only a fresh (five-minute) signature and deduplicates by submission ID
and normalized email.

## Local AmirOS device-support contract

After a Mac has completed pairing, local AmirOS can submit an explicit support
report without a browser session:

```text
POST /api/devices/support-tickets
Content-Type: application/json
```

```json
{
  "deviceKey": "opaque per-Mac key",
  "deviceSecret": "opaque per-Mac secret",
  "label": "MacBook Pro",
  "platform": "macOS",
  "appVersion": "0.10.9",
  "type": "Bug",
  "subject": "Short summary",
  "details": "Only the text the tester chose to send"
}
```

The endpoint returns `201` with `{ "ticket": { "ticketId", "id", "type",
"subject", "details", "state", "createdAt", "updatedAt" } }`. It returns
`401` for an unknown or unpaired Mac, `403` unless both device and account are
active and the account `setupState` is `active`, `400` for invalid input, and
`503` when the control plane is unavailable. No log bundle, conversation,
memory, API key, QR code, or other local data is attached automatically.

`POST /api/devices/entitlement` keeps `status` as `active`, `paused`, or
`revoked` and adds a separate `setupState` field: `setup_required`,
`device_pending`, or `active`. The local app should treat a non-`active`
`setupState` as setup-only access; it should never expect those values in the
`status` field. Before pairing, the activation-status endpoint continues to
return only `pending`, `approved`, or `expired`.

### Local onboarding progress contract

Only a paired, active Mac may publish the two optional milestone events below.
They are one-way and idempotent; the local app must call them only after the
corresponding local action genuinely succeeds.

```text
POST /api/devices/onboarding-progress
Content-Type: application/json
```

```json
{
  "deviceKey": "opaque per-Mac key",
  "deviceSecret": "opaque per-Mac secret",
  "label": "This Mac",
  "platform": "macOS",
  "appVersion": "0.10.9",
  "event": "whatsapp_connected"
}
```

The allowed `event` values are:

- `whatsapp_connected` — call only once AmirOS reports its WhatsApp connection
  ready locally.
- `first_people_selected` — call only after the initial people-directory flow
  succeeds locally. The endpoint rejects it until the same paired Mac has
  recorded `whatsapp_connected`.

The request must never include a WhatsApp session, QR code, message, contact
or person name, OpenAI key, conversation, memory, or log. A successful `200`
returns `{ "event", "activation" }`, where `activation` is the read-only
five-step checklist shape returned by `/api/account` and `/api/admin/overview`.
Errors use `{ "message": "…" }`: `400` malformed credential/event, `401`
unknown Mac, `403` non-active device/account/setup state, `409` people before
WhatsApp, and `503` unavailable control plane. These events never change
entitlement, setup, feature, or release state.

## Turning the preview into a live control plane

The interface and authentication boundary are ready, but live control is
deliberately blocked until a durable database adapter is added. The safe order
is:

1. Provision the separate Supabase Free development project and save its URL
   and server-only secret key as private Netlify environment variables.
2. Implement the adapter behind the existing protected API endpoints, with an
   audit record for every entitlement, feature, release, and support change.
3. Add a small AmirOS client that checks a signed entitlement on launch and
   before an update is offered. It should cache the last valid result for a
   short grace period, so a temporary network outage never locks a legitimate
   user out of their local data.
4. Upload signed release artifacts and expose only the release selected for
   that user's channel and access state.
5. Invite a small beta group, verify revocation and rollback, then make the
   Netlify site public for account creation by invitation.

Use the generated `*.netlify.app` hostname while the product name is in flux.
When the new name and domain are ready, add it in Netlify and update the public
`VITE_*` values—no data migration or client reinstall should be required.

## Storage boundary

The included API intentionally returns `503` until a real Control Center
database adapter is configured. That is a safety feature: accounts, access,
feature assignments, releases, and support tickets must never silently fall
back to a process-local store.

The production adapter persists only operational records: applicant names and
emails, user IDs, device IDs, entitlement/setup state, feature flags, release
assignment, support tickets, and audit events. Do not store WhatsApp messages,
contact data, canonical memory, QR material, API keys, or local AmirOS state.
