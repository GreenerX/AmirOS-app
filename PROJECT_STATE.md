# Project state

## What currently works

- AmirOS runs as a local TypeScript service with a Vite/React dashboard for WhatsApp, contact intelligence, calendar items, tasks, and reminders.
- The Overview now treats person-centred Today’s Focus items as identity cards: a contact photo is the leading visual when available, with the relevant birthday, reply, task, calendar, or reminder icon otherwise.
- Overview keeps its equal-height to-do card beside an Agenda that shows confirmed events scheduled for the current local day in chronological order as a compact timeline. Both cards align with the Recent activity stack. The Agenda includes a clear empty state and a link to the full agenda.
- Calendar month cells now expose every event: a `+N more` control opens that day’s complete agenda, and selecting an entry opens its usual event details.
- The Today’s Focus empty state is a larger, friendly rounded card. Intelligence queue labels and insight text replace recognized WhatsApp phone handles with their known contact names.

## What remains

- Connect and authenticate WhatsApp plus an OpenAI API key for live data; the dashboard can otherwise be explored with its local demo data.
- Broader product work, release packaging, and operational checks remain outside this Overview milestone.

## Architectural decisions

- `ui/src/components/Overview.tsx` keeps the UI-specific day filter local, reusing `buildIntelligenceSnapshot` as the canonical source of confirmed, chronological calendar events.
- Contact photos are sourced from the existing chat avatar pipeline through `ContactAvatar`; semantic icons remain the non-photo fallback so the action still reads at a glance.
- Tasks remain reachable through Today’s Focus and Intelligence; the Overview Agenda is intentionally event-only to keep it a concise day timeline.
- `ui/src/intelligence-contact-name.ts` only replaces a phone reference when it matches an existing chat ID, so unknown phone handles are never assigned a guessed identity.

## Run and test

- `pnpm dev` — run the local service in watch mode.
- `pnpm ui:dev` — run the Vite dashboard.
- `pnpm check && pnpm ui:check` — type-check server and UI.
- `pnpm test -- --run tests/todays-focus.test.ts tests/overview-polish.test.ts tests/intelligence-contact-name.test.ts` — run the focused milestone tests.
- `pnpm ui:build` — build the production dashboard bundle.
