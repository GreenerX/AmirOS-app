# Changelog

## [0.10.2] - 2026-08-15

### Added

- Added an optional first-run People setup step. It suggests up to 12 recent direct chats, prioritizes Favorites, and reads only the newest 150 messages from people the user explicitly selects.
- Added a persistent **Help & feedback** action for private beta testers, with separate bug, feedback, feature-request, and setup-help forms.

### Changed

- Changed generated People summaries to describe relationships directly to the owner using “you” and “your,” rather than referring to the owner in the third person.

### Privacy

- Beta reports are always user-initiated and use a configured email draft or support URL. Optional diagnostics are safe, bounded metadata only; no chats, contacts, credentials, sessions, QR codes, saved state, or complete logs are included.
- Screenshots remain on the tester’s computer until they choose to attach one in their email app.

### Fixed

- Prevented first-run history analysis from being duplicated by the normal incremental learner after setup.

### Testing

- Added coverage for feedback reporting, safe redaction, destination fallbacks, diagnostics opt-in, first-run chat suggestions, Favorites prioritization, bounded history, and deduplicated learning.

## [0.10.1] - 2026-08-15

### Added

- Increased the Overview world-clock limit from three saved cities to four.

### Changed

- Changed Today’s Focus to keep every eligible event and action in one horizontally scrollable row instead of revealing additional cards only after another card is dismissed.
- Increased generated event artwork and contact avatars to make each Focus card’s identity clearer while retaining adaptive widths and complete titles.

### Fixed

- Fixed proactive dismissals allowing an equivalent event, task, or commitment card from the same source to immediately replace the dismissed card.

### Testing

- Extended Focus and Overview coverage for uncapped ranked items, dismissal aliases, larger identity visuals, horizontal scrolling, and the four-city limit.

## [0.10.0] - 2026-08-13

### Added

- Added natural memory correction through Ask AmirOS and the owner WhatsApp bot. The owner can reject an incorrect fact, keep an old fact as historical, forget it, or replace it with a new current fact.
- Added restart-safe, six-hour reference context for owner WhatsApp answers so follow-ups such as “That’s wrong” apply only to the canonical knowledge behind the latest answer.
- Added durable correction audit records that preserve source evidence while preventing corrected claims from reopening unchanged.

### Changed

- Established dashboard and owner WhatsApp parity for owner-facing intelligence: both entry points now use the same authoritative memory-correction service.
- Changed Today’s Focus cards to size themselves around their content within a single horizontal row, with complete titles and compact supporting details.

### Improved

- Improved proactive titles and summaries with tighter AI output limits and deterministic cleanup so cards remain concise without cutting off text.
- Improved correction safety with bounded candidate sets, owner-only authorization, deterministic handling for explicit corrections, and clarification when several facts could be intended.
- Improved memory propagation after a correction: canonical retrieval, People profile freshness, and relationship context update from the corrected truth.

### Fixed

- Fixed long proactive summaries overflowing compact Today’s Focus cards.
- Fixed corrected or forgotten evidence remaining eligible for ordinary current-memory retrieval or returning through repeated analysis.

### Testing

- Added focused state, API, and WhatsApp tests for rejection, replacement, historical conversion, forgetting, ambiguity, restart persistence, evidence preservation, suppression, and non-owner protection.
- Extended Overview and Proactive Intelligence coverage for concise generated copy, full card titles, compact layouts, and deterministic fallback behavior.

## [0.9.0] - 2026-08-13

### Added

- Added a People-centered Contact Intelligence experience that uses existing AmirOS contacts, intelligence, calendar events, to-dos, commitments, and relationship summaries.
- Added Contact Intelligence profile pages with relationship summaries, recent interaction, upcoming plans, open commitments, open to-dos, follow-ups, important topics, and conversation timeline.
- Added a shared deterministic temporal classifier for owner/self-chat actions, covering calendar events, to-dos, commitments, due dates, start times, and clarification flows.
- Added owner-action lifecycle commands for completing, cancelling, renaming, rescheduling, reprioritizing, and annotating existing AmirOS records.
- Added an owner-action end-to-end QA harness that exercises incoming owner messages through persistence and confirmation.
- Added canonical memory fields for current, historical, temporary, reinforced, replaced, and autonomously confirmed relationship knowledge.
- Added automatic memory maintenance for type-aware freshness, repeated evidence, profile invalidation, and current-first retrieval.
- Added memory explainability so People and Ask AmirOS can show confidence, evidence, reinforcement, current-versus-historical status, and why AmirOS believes a fact.
- Added grounded Relationship Intelligence briefings that distinguish current context, recent developments, upcoming plans, and unresolved follow-ups without presenting old conversation history as current.
- Added Proactive Intelligence for timely relationship context, commitments, to-dos, and likely replies, with deterministic safety checks, cached AI usefulness review, semantic deduplication, feedback-aware ranking, and automatic resolution.
- Added backend and frontend build freshness checks so stale compiled backend or dashboard code is detected before runtime use.

### Changed

- Replaced the old Intelligence landing experience with People as the primary relationship directory while reusing the existing AmirOS intelligence model.
- Changed owner/self-chat write requests so explicit commands can persist directly to Calendar, To-dos, Knowledge, and Commitments through verified write paths.
- Changed generated contact profiles so stale profile prose is ignored when canonical knowledge has materially changed.
- Changed Ask AmirOS and reply grounding to prefer current canonical knowledge and qualify stale or uncertain knowledge when it is still relevant.
- Changed relationship-learning prompts to produce semantic topic titles, canonical keys, validity, and evolution metadata for new insights.
- Changed startup and launch scripts to use freshness-aware build wrappers instead of directly launching potentially stale `dist` output.
- Changed Today’s Focus to adapt late in the evening: it becomes Up Next only when every remaining visible card belongs to tomorrow, while overdue or still-actionable items keep today’s framing.

### Improved

- Improved People and Contact Intelligence presentation with more readable cards, contact avatars, compact relationship summaries, favorites, hidden contacts, quick views, and removable relationship items.
- Improved owner action reliability for dated to-dos, clarification replies, exact calendar times, duplicate protection, and truthful confirmations.
- Improved to-do presentation with concise AI-assisted titles, priority extraction, and consistent trailing emoji handling.
- Improved relationship commitment reconciliation so repeated or reworded obligations merge into one record with preserved evidence history.
- Improved memory retrieval so current facts rank ahead of older or historical facts, while historical facts remain available for history-oriented questions.
- Improved contact summaries so People can project newer canonical facts immediately, even before a full profile regeneration.
- Improved Ask AmirOS relationship answers with temporal relevance, evidence-grounded uncertainty, and natural follow-up explanations such as “Why?”, “How do you know?”, and “What changed?”.
- Improved proactive guidance with human-readable “Why this is here” explanations, contact identity, AI confidence when available, durable dismissal, and non-blocking interaction feedback.
- Improved dashboard diagnostics and health checks to verify that the browser receives the current stamped UI build.

### Fixed

- Fixed clarified owner actions that were understood but failed to persist or verify.
- Fixed calendar event time preservation for explicit morning, afternoon, and evening times.
- Fixed cases where completed to-dos were treated as already present instead of being reopened when the owner asked to add them again.
- Fixed stale relationship knowledge returning as new pending suggestions after approval or dismissal.
- Fixed outdated profile summaries contradicting newer canonical knowledge in People and Ask AmirOS context.
- Fixed backend/dashboard mismatch cases where tests passed against TypeScript source while the live runtime used older compiled JavaScript.

### Infrastructure

- Added `scripts/build-backend.mjs`, `scripts/build-ui.mjs`, `scripts/build-freshness.mjs`, and `scripts/start-backend.mjs`.
- Updated the watchdog, launcher, clean-release packaging, installer upgrade test, dashboard health check, and backend restart status handling for build freshness.
- Added UI build fingerprint headers and cache-control behavior so stale dashboard assets are easier to detect.

### Testing

- Added focused tests for temporal classification, owner actions, lifecycle commands, memory evolution, build freshness, UI build runtime behavior, relationship learning prompts, and People presentation.
- Added precision-first Proactive Intelligence evaluation coverage for useful suggestions, noise, duplicates, resolved items, caching, feedback, privacy exclusions, and deterministic fallback.
- Added owner-action E2E tests for clarification, persistence, lifecycle mutations, ambiguity handling, duplicate protection, failed writes, and truthful confirmations.
- Verified the current state with the full Vitest suite, backend typecheck, frontend typecheck, backend build, frontend build, and Git whitespace checks before committing.

### Known Limitations

- Live WhatsApp behavior still requires WhatsApp authentication and the configured local runtime.
- Autonomous memory evolution is intentionally conservative for uncertain, sensitive, group-member, hearsay, and temporary claims.
- Contact Intelligence still relies on the existing AmirOS intelligence data model; this release does not introduce a separate intelligence backend or approval system.

## [0.8.5] - 2026-08

- Improved overview layout, Today's Focus, Agenda, to-dos, weather, timezone cards, release notes sizing, and owner-created task/calendar behavior.
- Preserved past calendar events instead of removing them from calendar history.
- Improved owner to-do handling for completed items, priority ordering, duplicate checks, and reply guidance.

## [0.8.0] - 2026-08

- Added the redesigned Overview header with local weather, live clock, unit and time-format preferences, and saved timezone cards.
- Added generated and cached city artwork for timezone cards.
- Improved sidebar navigation, WhatsApp connection placement, Overview layout, Agenda sizing, and card alignment.

## [0.7.1] - 2026-08

- Fixed updater builds so customer updates compile the runtime service without test-only TypeScript failures.

## [0.7.0] - 2026-08

- Made People the primary relationship directory.
- Added a Contact Intelligence flow over existing relationship data.
- Improved crowded calendar days, Today's Focus empty states, and contact names in Intelligence.

## [0.6.9] - 2026-08

- Polished Today's Focus themes and Overview presentation.

## [0.6.8] - 2026-08

- Fixed release version identity and release history behavior.

## [0.3.0] - 2026-08-05

- Added a complete in-app setup flow: add an OpenAI API key, generate a WhatsApp QR code, and choose knowledge tracking before opening the dashboard.
- Added a default knowledge-tracking choice for new chats, plus an approval area on the Overview page for chats that need a decision.
- Added a simple version history inside the in-app "What's new" window.
- Improved service startup recovery when an old background-service record remains after an interrupted session.

## [0.2.2] - 2026-08-04

- Made `stop-whatsapp-bot.command` reliably locate and stop AmirOS if its PID record is unavailable.
- The recommended everyday controls are now `Open AmirOS.command` to launch and `stop-whatsapp-bot.command` to stop.

## [0.2.1] - 2026-08-04

- Fixed the Finder launcher so it finds Node.js from common Homebrew, Volta, and asdf locations.
- Added a temporary developer-only fallback for this Mac while Node.js is being installed system-wide.

## [0.2.0] - 2026-08-04

- Added a first-run setup that introduces API-key, budget, and WhatsApp linking steps.
- Added an in-app version button and a "What's new" popup for each new release.
- The dashboard version now comes from the same `package.json` version used for Git releases.

## [0.1.0]

- Initial clean AmirOS source release.
