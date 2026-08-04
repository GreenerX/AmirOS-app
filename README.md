# AmirOS

AmirOS is a private, local control center for a WhatsApp AI assistant. It links to
your WhatsApp account as a companion device and uses OpenAI for text replies,
image generation, voice transcription, and current web answers.

The app includes a responsive dashboard and inbox at
`http://127.0.0.1:3789`, with live WhatsApp status, drafts awaiting approval,
per-contact reply modes, quiet hours, usage visibility, and model cost presets.
The Settings screen also controls self-chat replies, outgoing triggers, group
commands, web search, command names, and the monthly budget target. These choices
and model presets persist across restarts.

## Testing AmirOS

For the current macOS early-access setup—including downloading the private
repository, installing dependencies, linking WhatsApp, updating safely, and
protecting local data—follow [the tester setup guide](INSTALL.md).

If the WhatsApp linked device is removed or expires, open **Settings → WhatsApp
linked device → Re-link WhatsApp**. AmirOS safely signs out the old local session
and displays a new QR code in the app. This does not delete contact preferences,
saved memory, or profile analyses.

> This integration uses the unofficial `whatsapp-web.js` library, not Meta's
> supported Cloud API. WhatsApp can change its web client or restrict an account.
> Use a separate/non-critical number and avoid unsolicited or bulk messaging.

## Commands

```text
!bot Explain black holes simply
!web What are today's main technology headlines?
!image A watercolor fox reading in a Jerusalem cafe
!models
```

For voice notes, say **“hey bot …”**, **“search web …”**, or
**“create image …”**. These phrases are configurable. Groups are ignored by
default. Incoming messages from other contacts require a trigger. In WhatsApp's
“Message yourself” chat, plain text and voice messages become prompts automatically;
set `AUTO_REPLY_SELF_CHAT=false` to require triggers there too. Commands you send to
other contacts also trigger the bot when `ALLOW_OUTGOING_TRIGGER_COMMANDS=true`
(the default); ordinary outgoing messages are ignored. Set it to `false` to process
incoming commands only.

## AmirOS control center

Build the interface once with `pnpm ui:build`, then start AmirOS with
`pnpm dev` or the macOS launcher. Open [http://127.0.0.1:3789](http://127.0.0.1:3789)
in your browser.

Each direct contact can use one of three modes:

- **Off:** only explicit `!bot`, `!web`, or `!image` triggers run.
- **Suggest:** ordinary incoming messages create an editable draft in AmirOS.
- **Auto:** ordinary incoming messages receive an automatic reply outside quiet hours.

Quiet hours are disabled by default and can be enabled from Automations. Explicit
trigger commands continue to work during quiet hours. The dashboard
control API binds only to `127.0.0.1`; it is not exposed to your network. Chat
bodies are fetched from the linked WhatsApp session as needed. When **Remember
context** is enabled for a chat, AmirOS also stores its bounded conversation memory,
manual facts, and profile locally alongside preferences and settings.
On narrow windows and phones, Inbox opens the active-conversation list first;
open any chat and use the back arrow to return to the list.

Contact settings can store manual facts and create a private AI profile from saved
incoming messages. Once a profile exists, use **Export PDF** in its profile card to
download a branded A4 report containing the analysis and operator-saved memory.

### Context privacy model

AmirOS enforces three AI context scopes in code:

- In WhatsApp's **Message yourself** chat, the verified self-chat route retrieves
  relevant knowledge across saved contacts and groups and supplies the complete
  upcoming AmirOS calendar. Confirmed events are treated as scheduled; inferred
  events remain clearly marked as suggestions awaiting approval.
- When Amir sends an explicit bot trigger inside another contact or group chat,
  that chat's **Owner trigger access** selections can additionally supply all-contact
  knowledge, the global calendar, or both. The answer is posted into that chat, so
  the contact settings show a visibility warning and either resource can be disabled.
- When a contact or group participant triggers the bot, the AI receives only that
  conversation's history, settings, manual memory, profile, insights, writing style,
  and events by default. A chat's separate **Contact trigger access** selections can
  explicitly grant all-contact knowledge, the global calendar, or both. These grants
  apply only to explicit incoming bot triggers; automatic replies remain chat-only.
  In a group, the grant applies to every participant, which is called out in the UI.

OpenAI continuation IDs are also stored separately per WhatsApp chat. The Terminal
logs `AI context prepared` with the selected scope and record counts—never the
private record contents—so the routing decision can be audited while testing.

## Web search

Web search is enabled by default. `!bot` lets the model search automatically when
an answer needs current information; `!web` forces a live search. Search answers
append up to four clickable source links for WhatsApp. The default
`WEB_SEARCH_CONTEXT_SIZE=low` keeps search context and token use down. Set
`WEB_SEARCH_ENABLED=false` to disable it, or use `medium`/`high` when broader
research is worth the additional latency and cost.

The default personality is warm and conversational, matches the user's language and
tone, remembers details within the active conversation, and uses a few relevant
emojis. Set `BOT_INSTRUCTIONS` in `.env.local` to give it a name, preferred style,
special knowledge, or different emoji habits.

When group conversations are enabled, each group follows its own dashboard reply
mode: `Auto` handles ordinary incoming messages, `Suggest` creates a draft, and
`Off` requires an explicit trigger such as `!bot`.

## Model and cost controls

Set `OPENAI_MODEL_PRESET` in `.env.local`:

| Preset | Text | Images | Voice | Cost posture |
| --- | --- | --- | --- | --- |
| `economy` (default) | `gpt-5.6-luna` | `gpt-image-1-mini`, low | `gpt-4o-mini-transcribe` | Lowest |
| `balanced` | `gpt-5.6-terra` | `gpt-image-2`, low | `gpt-transcribe` | Moderate |
| `quality` | `gpt-5.6-sol` | `gpt-image-2`, high | `gpt-transcribe` | Highest |

List presets with `pnpm models` or send `!models` in WhatsApp. Override any model
with `OPENAI_TEXT_MODEL`, `OPENAI_IMAGE_MODEL`, or
`OPENAI_TRANSCRIBE_MODEL`. `OPENAI_TEXT_MAX_OUTPUT_TOKENS` and
`CONVERSATION_TURN_LIMIT` provide additional cost caps.

The dashboard Usage page calculates estimated current-session spend from the
usage returned by each API request and the official OpenAI rates. It accounts for
standard and cached text tokens, generated-image tokens (or the published
1024×1024 estimate when token usage is unavailable), measured voice duration,
and web-search calls. Rates are maintained in `src/pricing.ts`; verify them
against [OpenAI API pricing](https://developers.openai.com/api/docs/pricing) when
OpenAI changes model pricing.

For an account-level ceiling, configure an OpenAI project hard spend limit and a
lower spend alert in Platform settings. That protection is outside this process and
continues to apply if the bot is restarted.

## Link WhatsApp

1. Ensure `.env.local` contains `OPENAI_API_KEY`. Codex has already saved it in
   this workspace.
2. Optional: add `OPENAI_MODEL_PRESET=economy` (economy is already the default).
3. Install, build, and start:

   ```bash
   pnpm install
   pnpm ui:build
   pnpm dev
   ```

   On macOS, you can instead double-click `start-whatsapp-bot.command`. If AmirOS
   is already running, the launcher simply opens the control center. Otherwise it
   asks which cost profile to use, starts a detached background service, and opens
   the dashboard when it is ready. The Terminal window can then be closed without
   stopping AmirOS. Double-click `stop-whatsapp-bot.command` to stop the background
   service. The launcher uses the bundled Node runtime when Node is not installed
   system-wide.

4. Scan the QR code from **AmirOS Settings** (or the terminal) using **WhatsApp →
   Settings → Linked Devices → Link a Device**.
5. Wait for `WhatsApp bot is ready.` and `AmirOS is available at
   http://127.0.0.1:3789`.
6. Open AmirOS in your browser, or send `!bot hello` in the “Message yourself”
   chat to test it.

The session is stored in `.wwebjs_auth/`, which is ignored by Git. Treat this
directory like a long-lived password: never commit, upload, share, or copy it into a
support request. Unlink the companion device from your phone to revoke it.

## Runtime requirements

- Node.js 20+
- Google Chrome or Chromium
- A continuously running machine with persistent storage
- No public URL, Meta token, webhook, or Meta app is required

The default Chrome path targets macOS. Override `PUPPETEER_EXECUTABLE_PATH` when
deploying elsewhere. Only set `PUPPETEER_NO_SANDBOX=true` when the deployment
environment requires it and you understand the reduced browser isolation.

## Production notes

- The linked-device route can break when WhatsApp Web changes and carries account
  restriction risk. The official WhatsApp Business Cloud API remains the supported
  option for business-critical or high-volume use.
- Keep the process and `.wwebjs_auth/` on persistent storage. Serverless runtimes are
  not suitable.
- Per-chat context and contact memory are stored locally and restored when AmirOS
  restarts. Disable **Remember context** for any chat to clear its saved memory.
- AmirOS is currently a local web app. Native macOS packaging is a planned next
  step; the responsive interface is already designed to support it.

## Creating a clean customer copy

Run `pnpm package:clean` to create `release/AmirOS`. The release is built from
an allow-list and intentionally excludes `.env.local`, `work/`,
`.wwebjs_auth/`, logs, and generated marketing files. Your personal local
knowledge is stored in `work/amiros-state.json`; never copy or commit it.
