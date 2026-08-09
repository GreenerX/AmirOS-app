# Project state

## What currently works

- AmirOS runs as a local TypeScript service with a Vite/React dashboard for WhatsApp, contact intelligence, calendar items, tasks, and reminders.
- The Overview now treats person-centred Today’s Focus items as identity cards: a contact photo is the leading visual when available, with the relevant birthday, reply, task, calendar, or reminder icon otherwise.
- Overview keeps its equal-height to-do card beside an Agenda that shows confirmed events scheduled for the current local day in chronological order as a compact timeline. Both cards align with the Recent activity stack. The Agenda includes a clear empty state and a link to the full agenda.
- Calendar month cells now expose every event: a `+N more` control opens that day’s complete agenda, and selecting an entry opens its usual event details.
- The Today’s Focus empty state is a larger, friendly rounded card. Intelligence queue labels and insight text replace recognized WhatsApp phone handles with their known contact names.
- People is the primary relationship directory. It reuses the existing Intelligence data to show contact cards and a Contact Intelligence detail view without changing backend analysis or approval flows. Favorites reuse the existing contact pin data, hidden contacts can be restored through the Hidden filter, and Quick Views make Favorites, Waiting, Upcoming, and Recently Active directly reachable.
- Contact Intelligence presents each relationship as a personal profile with a prominent avatar and summary, recent interaction, plans, commitments, to-dos, waiting items, topics, and conversation history.
- Sidebar navigation has premium active icon treatments, while the People directory and Contact Intelligence views use a calmer, more spacious visual system.
- Reviewed relationship knowledge is durable: immediate local extraction now uses the same semantic duplicate check as full analysis, so an approved or dismissed item does not return as a reworded pending suggestion.
- The all-clear Next best action card is an informational status only; it does not redirect into People.

## What remains

- Connect and authenticate WhatsApp plus an OpenAI API key for live data; the dashboard can otherwise be explored with its local demo data.
- Native macOS packaging and broader operational checks remain future work.

## Architectural decisions

- `ui/src/components/Overview.tsx` keeps the UI-specific day filter local, reusing `buildIntelligenceSnapshot` as the canonical source of confirmed, chronological calendar events.
- Contact photos are sourced from the existing chat avatar pipeline through `ContactAvatar`; semantic icons remain the non-photo fallback so the action still reads at a glance.
- Tasks remain reachable through Today’s Focus and Intelligence; the Overview Agenda is intentionally event-only to keep it a concise day timeline.
- `ui/src/intelligence-contact-name.ts` only replaces a phone reference when it matches an existing chat ID, so unknown phone handles are never assigned a guessed identity.
- `ui/src/components/PeopleExperience.tsx` is a front-end-only view over current chats, intelligence, contacts, commitments, events, to-dos, and summaries; it does not create or modify intelligence records.
- `src/amiros-state.ts` preserves reviewed insight statuses as durable tombstones. Both immediate local extraction and full AI analysis use the same semantic duplicate detection before creating a new pending item.
- `tsconfig.json` compiles the runtime service and scripts only. Vitest owns test-file compilation, keeping customer updates from failing on dashboard test-only imports.

## Run and test

- `pnpm dev` — run the local service in watch mode.
- `pnpm ui:dev` — run the Vite dashboard.
- `node_modules/.bin/vitest run tests/amiros-state.test.ts tests/intelligence-learner.test.ts tests/people-experience.test.ts tests/overview-polish.test.ts` — run the focused relationship and Overview tests.
- `node_modules/.bin/tsc -p ui/tsconfig.json --noEmit` — type-check the dashboard.
- `pnpm build` — compile the runtime service used by the updater.
- `pnpm ui:build` — build the production dashboard bundle.
- `pnpm package:clean` — create a clean, private-data-free customer copy in `release/AmirOS`.
