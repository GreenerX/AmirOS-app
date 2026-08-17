# Project state

## What currently works

- New managed-beta packages use the AmirOS Control Center as an activation gate: a tester connects and approves this Mac before normal dashboard data or assistant actions are available. Account access, device access, feature flags, and release channel remain separate controls; private chats, memory, WhatsApp session material, and OpenAI keys stay on the tester's Mac.
- The early-access landing form feeds a Control Center applicant queue. Amir can review the tester's full name and email, approve them, and send the standard secure Netlify Identity invitation from the same workflow. The signed-in tester sees a five-step Beta checklist covering account, Mac connection, Mac approval, WhatsApp readiness, and the first successful People selection.
- Help & feedback sends an explicit, redacted report directly from an active paired Mac to the Control Center and confirms only after the support ticket is saved. Email, HTTPS, and copy fallbacks remain available when direct delivery is unavailable.
- Private beta testers have a persistent Help & feedback entry. Reports are
  explicitly user-initiated, use a configured email draft or support URL, and
  fall back transparently to copying when beta support is not configured.
- Optional diagnostics are limited to safe metadata; AmirOS does not attach
  chats, contacts, credentials, sessions, saved state, QR codes, or full logs.

- AmirOS runs as a local TypeScript service with a Vite/React dashboard for WhatsApp, contact intelligence, calendar items, tasks, and reminders.
- The Overview now treats person-centred Today’s Focus items as identity cards: a contact photo is the leading visual when available, with the relevant birthday, reply, task, calendar, or reminder icon otherwise. Today’s next confirmed event leads the Focus cards, replacing the former Next event / Inbox pulse / AI model strip.
- Overview keeps its equal-height to-do card beside an Agenda that shows confirmed events scheduled for the current local day in chronological order as a compact timeline. Suggested action stays alongside that row; Current session, Reply modes, and Recent activity form a three-card row directly underneath. The former Quick actions card is removed. The Agenda includes a clear empty state and a link to the full agenda.
- Calendar month cells now expose every event: a `+N more` control opens that day’s complete agenda, and selecting an entry opens its usual event details.
- The Today’s Focus empty state is a larger, friendly rounded card. Intelligence queue labels and insight text replace recognized WhatsApp phone handles with their known contact names.
- People is the primary relationship directory. It reuses the existing Intelligence data to show contact cards and a Contact Intelligence detail view without changing backend analysis or approval flows. Favorites reuse the existing contact pin data, hidden contacts can be restored through the Hidden filter, and Quick Views make Favorites, Waiting, Upcoming, and Recently Active directly reachable.
- Contact Intelligence presents each relationship as a personal profile with a prominent avatar and summary, recent interaction, plans, commitments, to-dos, waiting items, topics, and conversation history.
- Sidebar navigation has premium active icon treatments, while the People directory and Contact Intelligence views use a calmer, more spacious visual system. WhatsApp status is aligned beneath the AmirOS wordmark, and a compact split-color circular control sits on the sidebar edge so navigation starts higher without losing collapse behavior.
- The Overview header now combines automatic local weather, the existing live local clock, persistent Celsius/Fahrenheit and 12/24-hour selectors, and up to four saved city clocks. The time preference updates the local clock, city clocks, Agenda, Calendar, Inbox, People, Intelligence, assistant history, and other shared timestamp surfaces; it is also stored in AmirOS settings so WhatsApp replies use the same format. Location permission changes trigger an immediate weather retry. Each city shows current local weather and switches between cached morning, afternoon, and night artwork; WhatsApp connection status now sits compactly beneath the sidebar logo.
- Release notes use a viewport-bounded dialog: on smaller laptop and mobile screens, the notes body scrolls independently while the close and acknowledgement controls remain visible.
- Reviewed relationship knowledge is durable: immediate local extraction now uses the same semantic duplicate check as full analysis, so an approved or dismissed item does not return as a reworded pending suggestion.
- The all-clear Next best action card is an informational status only; it does not redirect into People.
- Reply-needed assessments now use high-confidence local rules for obvious replies and non-replies, with the existing OpenAI service consulted only below the 90% confidence cutoff. Suggested-action and follow-up surfaces show a concise, plain-English confidence/reason label while existing intelligence behavior remains unchanged.
- Explicit owner commands through WhatsApp now write directly to AmirOS Calendar, To-dos, Knowledge, or Commitments instead of becoming review suggestions. Calendar writes are confirmed before their reply is sent, use a concise AI-generated title with a deterministic fallback, and queue a cached `gpt-image-1.5` icon. Today’s Focus marks these event cards as added by WhatsApp Bot.
- New to-dos now get a concise AI-written action summary, a stored low/normal/high priority, and one fitting trailing emoji. Clear priority wording is kept out of the visible title; existing to-dos receive the same safe priority/emoji cleanup on load, while automatic relationship learning and direct owner WhatsApp commands use AI with a deterministic fallback if it is unavailable.
- Owner clock and schedule requests now use the device-local date, time zone, and selected 12/24-hour format. Exact schedule requests list every confirmed event in chronological order instead of relying on an AI summary that might omit or shift an event.
- Canonical memory now maintains itself after learner batches and on restart. Repeated trustworthy direct evidence can promote one pending canonical fact, replacements keep the prior truth as historical, temporary and old weak observations lose retrieval prominence without being deleted, and stable dates such as birthdays never decay merely because they are old.
- Generated contact profiles now carry a canonical-knowledge version. A material canonical change marks old prose stale; stale prose is excluded from Ask AmirOS and reply grounding, while People immediately projects the current canonical fact so an old summary cannot contradict current truth.
- Ask AmirOS and owner-authored WhatsApp bot conversations now support natural memory corrections for canonical facts. The owner can mark a fact wrong, keep it only as historical, forget it, or replace it with a new current fact. The bot persists only a bounded six-hour set of canonical references behind its last answer, survives restart, and asks for clarification instead of guessing. Corrections preserve the original evidence and audit record, invalidate stale profile prose, suppress the corrected evidence from ordinary retrieval, and prevent the same old analysis from reopening the fact.
- Owner-facing intelligence now follows a parity rule: dashboard and owner WhatsApp entry points should call the same authoritative capability services. WhatsApp is the on-the-go AmirOS interface; only inherently visual or administrative controls remain dashboard-only.

## What remains

- Connect and authenticate WhatsApp plus an OpenAI API key for live data; the dashboard can otherwise be explored with its local demo data.
- Native macOS packaging and broader operational checks remain future work.

## Architectural decisions

- Control Center setup state (`setup_required`, `device_pending`, `active`) is independent from access state (`active`, `paused`, `revoked`). The local app uses device credentials only for entitlement, support, and one-way checklist events; those calls never include conversations, contact identities, memory, WhatsApp session data, QR codes, or OpenAI keys.
- WhatsApp and People checklist events are informational milestones, not new entitlement gates. They are idempotent, forward-only, and emitted only after the corresponding local operation succeeds.
- Applicant intake is signed server-to-server from the verified Netlify form event. The Control Center remains the application source of truth, while Netlify Identity remains the credential and invitation-token authority.
- Beta support is always user-initiated. An active paired Mac sends the
  tester-reviewed report directly to the Control Center; no telemetry or
  background report is introduced. `AMIROS_BETA_SUPPORT_EMAIL` and
  `AMIROS_BETA_SUPPORT_URL` remain explicit fallbacks when direct delivery is
  unavailable. The official beta email lives in `.env.example` so an update
  can supply it without overwriting private `.env` or `.env.local` settings.

- First-run People setup is intentionally two choices: a selected chat gets a
  bounded, one-time AI profile only after the owner explicitly consents to
  sending up to 150 newest messages to their configured OpenAI account. Future
  knowledge tracking is separate and defaults to the owner’s tracking choice;
  it is never silently enabled merely because a one-time profile was selected.

- `ui/src/components/Overview.tsx` keeps the UI-specific day filter local, reusing `buildIntelligenceSnapshot` as the canonical source of confirmed, chronological calendar events.
- Contact photos are sourced from the existing chat avatar pipeline through `ContactAvatar`; non-person Today’s Focus cards request a relevant `gpt-image-1.5` icon and cache it privately under `work/todays-focus-icons`, while semantic icons remain the immediate and failure-safe fallback.
- Tasks remain reachable through Today’s Focus and Intelligence; the Overview Agenda is intentionally event-only to keep it a concise day timeline.
- `ui/src/intelligence-contact-name.ts` only replaces a phone reference when it matches an existing chat ID, so unknown phone handles are never assigned a guessed identity.
- `ui/src/components/PeopleExperience.tsx` is a front-end-only view over current chats, intelligence, contacts, commitments, events, to-dos, and summaries; it does not create or modify intelligence records.
- `src/amiros-state.ts` preserves reviewed insight statuses as durable tombstones. Both immediate local extraction and full AI analysis use the same semantic duplicate detection before creating a new pending item.
- `src/memory-maintenance.ts` owns fact-type-aware freshness. Freshness changes ranking and qualification, not canonical validity: historical evidence stays historical, temporary observations fade quickly, weak unreinforced observations age gradually, strongly reinforced facts remain prominent, and important dates are timeless. `AmirosState.maintainKnowledge()` performs conservative deduplication, repeated-evidence promotion, legacy replacement reconciliation, and derived-profile invalidation in the existing store.
- `src/memory-correction.ts` is the narrow owner-control layer for canonical knowledge. `AmirosState.applyMemoryCorrection()` is the only mutation path: it records an audit entry, keeps evidence intact, historicizes or suppresses the affected canonical cluster, creates a replacement only after a safe interpretation, and ensures prior analysis cannot resurrect the exact corrected evidence. Ask AmirOS passes cited insight IDs; WhatsApp carries a bounded persisted reference context from its last owner answer. Message, task, plan, and commitment sources are never mutable memory targets, and non-owner WhatsApp messages cannot invoke corrections.
- `src/reply-needed.ts` is the canonical reply-needed evaluator. It treats direct questions, direct requests, owner replies, acknowledgements, endings, stale messages, and clear owner mentions in groups deterministically; decisions below 90% confidence may call AI. AI results are cached against a versioned hash of the recent conversation context and invalidated when new stored messages arrive. `ui/src/reply-assessment-copy.ts` maps those internal results to user-facing copy without exposing reason codes.
- Weather and city search use fixed Open-Meteo proxy routes in `src/dashboard.ts`; the browser stores only the selected temperature unit and up to four normalized cities. `src/weather-timezones.ts` validates all city coordinates and IANA timezones before weather or image work begins.
- City artwork uses the existing configured OpenAI client with `gpt-image-2` at medium quality and the smallest supported landscape ratio. Newly generated morning, afternoon, and night images are resized to 640px-wide WebP files under `work/timezone-backgrounds`; existing PNG caches remain valid and are never regenerated solely for migration. Timezone cards sample the selected image's left/text area to use a stronger localized scrim only for bright artwork, leaving the rest of the photo visible.
- Today’s Focus includes every eligible confirmed event and action later today (or tomorrow after 3 PM when today is clear), labels each day accurately, and keeps event details to time plus location. All ranked cards stay in one horizontally scrollable rail instead of being capped and revealed one at a time; generated artwork and contact avatars use a larger 60px identity treatment. Its compact cards remain fully clickable without separate action buttons; the desktop Agenda and To-dos share a 360px aligned height. One to five Agenda events divide the available card height evenly, with larger type when fewer events are present; additional events scroll in compact rows.
- `ui/src/TimeFormatProvider.tsx` owns the persisted `amiros-time-format.v1` preference. Shared timestamp presentation goes through `ui/src/format.ts`, while `App` subscribes to the preference so every active page rerenders immediately when the user switches formats.
- `ui/src/components/ReleaseExperience.tsx` keeps release history in-app, and `ui/src/styles.css` caps the release-notes dialog to the visible viewport rather than letting buttons scroll below the screen.
- `src/owner-actions.ts` recognizes only explicit owner write requests. `MessageProcessor` applies those writes through authoritative `AmirosState` methods, then responds from the saved record. Ordinary conversation inference still uses existing review/approval behavior.
- `src/todo-presentation.ts` is the shared guardrail for to-do titles: it strips priority language, keeps priority in `TodoTask.priority`, and ensures exactly one trailing emoji. AI supplies the compact summary and classification for new items; deterministic text rules keep direct writes usable when the model is unavailable.
- Owner-created calendar events carry `MemoryEvidence.source = "whatsapp_bot"` plus an optional cached icon URL. `src/server.ts` uses the configured OpenAI key and `gpt-image-1.5` at low quality to populate a compact 256px WebP cache once per event title; existing PNG icon URLs remain valid, and failed or delayed image generation never blocks the calendar write.
- `tsconfig.json` compiles the runtime service and scripts only. Vitest owns test-file compilation, keeping customer updates from failing on dashboard test-only imports.

## Run and test

- `pnpm dev` — run the local service in watch mode.
- `pnpm ui:dev` — run the Vite dashboard.
- `node_modules/.bin/vitest run tests/amiros-state.test.ts tests/intelligence-learner.test.ts tests/people-experience.test.ts tests/overview-polish.test.ts` — run the focused relationship and Overview tests.
- `node_modules/.bin/vitest run tests/reply-needed.test.ts tests/chat-list-filter.test.ts tests/intelligence-snapshot.test.ts tests/todays-focus.test.ts tests/people-experience.test.ts` — verify hybrid reply-needed detection and its dashboard consumers.
- `node_modules/.bin/vitest run tests/weather-timezones.test.ts tests/timezone-weather-ui.test.ts tests/image-cache.test.ts tests/time-format.test.ts tests/overview-polish.test.ts` — verify weather proxy normalization, compact/compatible artwork caching, persisted time formatting, background-period switching, and the Overview header structure.
- `node_modules/.bin/vitest run tests/todays-focus.test.ts tests/todays-focus-icons.test.ts tests/overview-polish.test.ts` — verify Today’s Focus timing, generated-icon cache inputs, and compact Overview presentation.
- `node_modules/.bin/vitest run tests/owner-actions.test.ts tests/todays-focus.test.ts tests/reply-context-routing.test.ts` — verify owner-authorized writes, deterministic local schedule/clock answers, Today’s Focus provenance, and privacy routing.
- `node_modules/.bin/vitest run tests/todo-presentation.test.ts tests/owner-actions.test.ts tests/intelligence-learner.test.ts` — verify concise to-do summaries, priorities, emojis, and both direct/automatic creation paths.
- `node_modules/.bin/vitest run tests/memory-evolution.test.ts tests/people-experience.test.ts tests/personalization.test.ts tests/intelligence-learner.test.ts` — verify autonomous memory evolution, type-aware freshness, repeated-evidence promotion, history preservation, profile invalidation, People projection, and Ask AmirOS retrieval.
- `node_modules/.bin/vitest run tests/memory-correction.test.ts tests/memory-correction-api.test.ts` — verify canonical correction operations, history preservation, suppression against reanalysis, ambiguity safety, and the real Ask AmirOS API path.
- `node_modules/.bin/vitest run tests/memory-correction-whatsapp.test.ts tests/reply-context-routing.test.ts` — verify owner-only WhatsApp correction, restart-safe answer context, ambiguity continuation, and unchanged privacy routing.
- `node_modules/.bin/tsc -p ui/tsconfig.json --noEmit` — type-check the dashboard.
- `pnpm build` — compile the runtime service used by the updater.
- `pnpm ui:build` — build the production dashboard bundle.
- `pnpm package:clean` — create a clean, private-data-free customer copy in `release/AmirOS`.
