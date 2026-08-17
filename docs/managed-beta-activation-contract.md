# Managed beta activation contract

This is the local AmirOS contract for the invitation-only Control Center pilot.
It is an implementation handoff, not beta-tester copy.

## Scope and compatibility

- A clean managed-beta package sets `AMIROS_REQUIRE_CONTROL_CENTER_ACTIVATION=true`.
- That setting causes the local app to use the configured
  `AMIROS_CONTROL_CENTER_URL`; when no URL is supplied, it uses
  `https://amiros-control-center.netlify.app`.
- Older local installations keep the default `false`. They do not create a
  Control Center device credential, are not gated, and do not show a new
  Control Center setup card.
- `work/control-center-device.json` is a separate mode-0600 local file. It
  contains opaque device credentials, entitlement state, and a short-lived
  activation code. It must never contain API keys, WhatsApp material,
  conversation content, or memory.

## Required local order

1. The new package starts in setup-only mode. `/api/dashboard` returns only
   `activationOnly`, connection status, release data, Control Center status,
   and the non-secret support destination.
2. The local UI shows **Connect this Mac to finish setup**. It does not request
   chats or render the normal dashboard while the Mac is not active.
3. The tester signs in to the Control Center and approves the Mac. The Control
   Center's next action is **Continue AmirOS setup**; after a successful local
   check, the local dashboard becomes available.
4. Existing first-run setup then requires an individual OpenAI API key (either
   supplied for that tester's beta access or owned by the tester), followed by
   WhatsApp QR linking.
5. People setup is offered only after WhatsApp is ready and recent chats are
   available. It is intentionally not an activation gate: **Not now** leaves
   the tester in AmirOS and they can choose people later.

The Control Center's five-step beta checklist (account created → Mac
connection pending → Mac approved → WhatsApp connected → first people
selected) is progress guidance only after Mac approval. The local app must not
send WhatsApp, API-key, or People-completion state as an entitlement signal,
and those steps must not re-gate an active Mac.

## Control Center states expected by local AmirOS

`setupState` and `status` are separate fields.

| `setupState` | `status` | Local behavior |
| --- | --- | --- |
| `setup_required` | `unpaired` | Show connection gate; start activation. |
| `device_pending` | `pending` | Open the Control Center approval page and allow an explicit status check. |
| `active` | `active` or `offline_grace` | Allow the normal dashboard and assistant actions. |
| any | `paused` | Hide normal dashboard; assistant actions stay paused; show access recovery and support. |
| any | `revoked` | Hide normal dashboard; assistant actions stay paused; show recovery/support. Local data stays local. |
| any | `unavailable` | Hide normal dashboard after the seven-day cached-access grace period; allow a retry and support. |

The backend applies the same gate to incoming assistant actions through
`AmirosState.setControlCenterAccess`; hiding the UI alone is not a sufficient
control.

## HTTP expectations

All local requests below are `POST` JSON requests to the configured Control
Center origin. The client sends a random per-Mac `deviceKey` and `deviceSecret`,
the local label `This Mac`, platform, and AmirOS app version. It must not send
WhatsApp sessions, QR codes, OpenAI keys, contacts, conversations, memory, or
logs.

- `/api/devices/activation-start` accepts an opaque `activationCode` and the
  device metadata. It returns `{ "expiresAt": "ISO-8601" }`.
- `/api/devices/activation-status` accepts `activationCode`, `deviceKey`, and
  `deviceSecret`. It returns `pending`, `approved`, or `expired`; `pending`
  may include `expiresAt`.
- `/api/devices/entitlement` accepts the device credential and metadata. It
  returns `status` (`active`, `paused`, or `revoked`), `setupState`, `detail`,
  `checkedAt`, optional release channel, and feature assignments.
- `/api/devices/support-tickets` is allowed only for a paired active device
  and active account. It receives only the tester-authored structured report
  and the device metadata. The local UI can use the signed-in Control Center
  support page before pairing; it must not attempt direct ticket submission.
- `/api/devices/onboarding-progress` is allowed only for a paired active
  device and receives one of two idempotent events: `whatsapp_connected` after
  WhatsApp is truly ready, or `first_people_selected` after the optional
  first-run People directory finishes successfully. The request includes only
  the existing opaque device credential and ordinary device metadata. These
  events advance the informational beta checklist; they never change access,
  setup state, entitlements, feature assignments, or the release channel.

The Control Center must return a user-safe `message` field on non-2xx errors.
Local AmirOS surfaces that message without exposing device credentials.

## Recovery rules

- Activation is pending: the tester may reopen the approval page and select
  **Check approval**.
- Access is paused or unavailable: the tester should select **Check access**
  after support or an administrator resolves access.
- A revoked Mac receives a new opaque local device credential only after the
  tester explicitly selects **Reconnect this Mac**. That starts a new approval
  request and does not remove WhatsApp, local AmirOS data, or the OpenAI key.
  The tester should not re-link WhatsApp or paste a different API key as a
  workaround.
- Support before pairing goes to the signed-in Control Center form. Direct
  local support tickets require a paired active Mac.
- The Control Center remains the authority for the account's active/paused/
  revoked state and whether a replacement device must be approved.
