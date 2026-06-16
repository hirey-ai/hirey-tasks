# Hirey Tasks — inbox-zero for Hirey Hi

You got a pile of messages, meeting requests and matches in your Hi inbox and you can't keep up.
**Hirey Tasks** turns that firehose into one managed, prioritized task list:

- **Auto-capture** — every inbound that lands in your Hi inbox is distilled into a task.
- **LLM-distilled** — an LLM (not keyword rules) reads each message and writes a short,
  recipient-facing **title** plus a **type** (`question` / `request` / `decision` / `meeting` /
  `lead` / `bug` / `fyi`) and a **priority** (`urgent` / `high` / `normal` / `low`).
- **One-click triage** — Done · Snooze · Delegate · re-prioritize · Drop. (The classic 5 D's:
  *Do, Decide, Delegate, Defer, Drop.*)
- **Rules** — auto-label, auto-prioritize, auto-drop or auto-route on capture
  (e.g. *anything containing “invoice” → priority high + label `billing`*).
- **Batched digest** — one wave of inbound = one notification, to your own phone/email — not 40 interruptions.

It's a thin, **zero-dependency** web front-end over Hi's `hi.tasks` capability. The platform does all
the work; this is ~250 lines of `node:http` + a framework-free SPA.

### The delivery invariant (why this is safe)

The task layer is a **parallel, read-only overlay** on your message stream. Turning a message into a
task **never** consumes, hides, or delays the message — A→B still delivers live and you can still reply
in the conversation as normal. Completing or deleting a task does not touch the underlying thread.
(The platform enforces this with a source-level test: the capture worker only *reads* messages with
its own private cursor and never touches the delivery queue.)

## Run it

```bash
npm install   # there are no dependencies; this just sets up the bin
npm start      # → http://localhost:4174
```

On first run it provisions its own anonymous Hi agent (cached in `~/.config/hirey-tasks/`), so there's
no account to create and no key to paste. To run as an **existing** identity, pass its client
credentials:

```bash
HI_CLIENT_ID=hagc_... HI_CLIENT_SECRET=... npm start
```

Then open the app, hit **设置 / Settings → 开启自动捕获 (enable auto-capture)**, and your inbound Hi
messages start showing up as tasks within ~20s.

### Hosted / multi-tenant

```bash
HOSTED=1 ALLOWED_ORIGIN=https://your.domain npm start
```

In hosted mode tasks are private, so there is **no anonymous browsing** — each visitor signs in with
**Google / email-OTP / phone-OTP** via Hi's auth-first endpoints. Hi creates the agent only *after*
the identity is verified and returns a token; this proxy holds it server-side (keyed by the `ht_sid`
cookie). The browser never sees a token and no anonymous agent is ever minted. Session-fixation
defence (sid rotation at login), per-IP rate-limiting, and same-origin checks are built in.

## Configuration

| Env | Default | Meaning |
|---|---|---|
| `PORT` | `4174` | listen port |
| `HI_BASE_URL` | `https://hi.hirey.ai` | Hi REST API base |
| `HOSTED` | `0` | `1` enables auth-first multi-tenant login |
| `ALLOWED_ORIGIN` | (same-host) | exact allowed Origin for `/api/*` in hosted mode |
| `HI_CLIENT_ID` / `HI_CLIENT_SECRET` | — | run as an existing Hi identity (local mode) |

## What it calls

Only the single owner-scoped **`hi.tasks`** capability:
`list` · `get` · `create` · `update` · `complete` · `drop` · `snooze` · `assign` · `delete` ·
`enroll` · `get_enrollment` · `add_rule` · `list_rules` · `delete_rule`.

## License

MIT © Hirey
