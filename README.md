# coding-agent-popup

**Hard-to-miss, Claude-styled popups for AI coding agents on macOS.** When Claude Code or Codex needs permission, asks you a question, or finishes a task, you get a proper card in the bottom-left corner of the screen instead of a tiny notification that disappears before you look at it.

No dependencies. One JavaScript file, macOS's built-in `osascript` and `WKWebView`.

[中文说明](README.zh-CN.md)

![The three popups: a permission request, a multiple-choice question, and merged task-complete cards](docs/hero.png)

```
┌──────────────────────────────────────────────┐
│ ✳ Claude   my-webapp                         │
│                                              │
│ Claude wants to run a command                │
│ Install dependencies and run the tests       │
│ ┌──────────────────────────────────────────┐ │
│ │ npm install && npm test -- --coverage    │ │
│ └──────────────────────────────────────────┘ │
│ ↩ allow · esc answer in app    [Deny][Allow] │
└──────────────────────────────────────────────┘
```

## Why

Agent notifications are the one thing you have to notice while doing something else. The system
notifications that most agents show are small, brief, and easy to miss on a large display — and
you can't answer them without switching back to the app.

coding-agent-popup puts a tall, readable card in the bottom-left corner of the screen (drag it elsewhere
and it remembers), sized to its content, and lets you act on it right there:

- **Answer in place.** Allow or deny a command, or pick an option, without going back to the terminal.
- **Merged completions.** Ten sessions finishing at once means one window with a list, not ten popups.
- **Stays until you deal with it.** No 3-second banners. It waits (up to a configurable timeout).
- **Never in your way.** Anything you dismiss, ignore, or that fails falls back to the agent's own UI.
- **Looks like something.** Claude's warm cream-and-terracotta palette, serif headings, dark mode.

## Features

| | |
|---|---|
| Permission requests | Shows the exact command / file diff / URL and an Allow / Deny choice |
| Multiple-choice questions | Renders Claude Code's `AskUserQuestion` options as clickable cards, with free-text "Other" |
| Task-complete notifications | Merged into one window across sessions *and* agents; one card per agent and project, each with its own Open button that goes to that session |
| Several approvals at once | They share one window, one card each, so you answer them in place instead of chasing a stack of popups |
| Collapse and remember | Collapse any popup to a small capsule in the top-right corner (click it to open again). Drag the popup or capsule by its top strip and it comes back there next time |
| Stays quiet when you're there | If the app the agent runs in is the frontmost app, you see its prompt and reply there, so no popup. Leave with an approval unanswered and it pops up: Claude's you can answer right there; Codex's has already gone to Codex, so you get a "still waiting" card that opens that thread |
| Back to the right session | "Open" and "Answer in app" open the exact conversation in the Claude or Codex desktop app (`claude://…` / `codex://threads/…`); for agents in a terminal, the terminal comes forward |
| Markdown | Task-complete replies render as Markdown: tables, lists, code blocks, bold and inline code. HTML in a reply is always shown as text, never run |
| Never steals focus | The popup floats on top without taking the keyboard, so whatever you are typing keeps going. Click it to use it |
| Quick keys | Click the popup first (it never takes the keyboard by itself), then: `↩` to allow / confirm / dismiss, `esc` to hand back or close, `1`–`9` to pick, `↑`/`↓` to move |
| Multi-monitor | Appears on the screen with your mouse, always floating, also over full-screen apps |
| Stacking | Simultaneous popups offset instead of overlapping exactly |
| Language | English or Chinese, following your macOS language (`AGENT_POPUP_LANG=en|zh` to force) |
| Dark mode | Follows the system appearance |
| Safety | Keys reach the popup only after you click it, so an Enter you meant for another app never approves a command |

## Requirements

- **macOS only** (tested on recent releases; uses `WKWebView` and JavaScript for Automation). No Windows or Linux yet.
- One or both of:
  - **Claude Code** — CLI or desktop app, with hooks support
  - **Codex** — CLI or desktop app, with hooks support
- Nothing else. No Node, no Homebrew, no Python at runtime.

## Install

```bash
git clone https://github.com/qivyn/coding-agent-popup.git
cd coding-agent-popup
./install.sh              # detects Claude Code and/or Codex and wires up both
# or be explicit:
./install.sh claude
./install.sh codex
```

The installer copies `coding-agent-popup.js` to `~/.coding-agent-popup/`, merges the hooks into your
existing config (backing it up first), and prints what it changed. Then:

- **Claude Code:** start a new session (or restart the app).
- **Codex:** hooks must be trusted once. Run `codex` in a terminal, type `/hooks`, trust the
  `PermissionRequest` and `Stop` hooks, then restart Codex — CLI *and* desktop app. Codex keys trust
  to the exact command, so re-trust after editing `~/.codex/hooks.json`.

Upgrading from **agent-popup** (this project's old name)? Just run `./install.sh`: it swaps the old
hooks for the new ones and removes `~/.agent-popup`, keeping where you left the popup. The hook
commands change, so Codex asks you to trust them again.

### Check for updates

After installation, task completion triggers a detached check for this repository's latest stable
GitHub Release, at most once every 24 hours across all sessions. A newer version gets one popup
per version; **View release** opens its GitHub page. Offline and rate-limit failures stay silent
and never delay task-complete, permission, or question popups. Nothing wakes on a timer while
the project is idle.

To check manually, bypassing the daily interval and printing the result and release link:

```bash
osascript -l JavaScript ~/.coding-agent-popup/coding-agent-popup.js check-updates
```

Checks only notify; they never download or replace scripts. To update, pull and reinstall from
your original project directory:

```bash
git pull --ff-only
./install.sh
```

Set `AGENT_POPUP_CHECK_UPDATES=0` in the agent's environment to disable automatic checks;
manual checks remain available. State lives in `~/.coding-agent-popup/updates.json` and is
removed on uninstall.

For maintainers: keep `package.json`'s `version` and the script's `VERSION` in sync, then publish
a matching stable GitHub Release (for example, `v0.2.0`). Commits or tags alone, drafts, and
prereleases do not trigger update notices.

The release workflow validates versions, runs tests, and publishes the stable Release and
installation files when a `vX.Y.Z` tag is pushed. Prepare `docs/releases/vX.Y.Z.md` before tagging.

### See it first

```bash
osascript -l JavaScript ~/.coding-agent-popup/coding-agent-popup.js demo
```

Shows the three popups with sample content, in your language. `demo ask`, `demo perm`, `demo done`
for one at a time, and `demo codex` for the permission popup in Codex's look.

## How it works

Claude Code and Codex both fire a hook named `PermissionRequest` when they're about to ask you
something, and `Stop` when a turn ends. coding-agent-popup registers a command hook for each:

- `PermissionRequest` → read the event JSON from stdin → show a popup → print a decision
  (`allow` / `deny`, or `allow` with `updatedInput` carrying your answers, which is how the
  multiple-choice questions are answered).
  Claude Code fires this hook the moment it *might* ask, while its auto-mode classifier can still
  approve the call by itself. So for Claude Code the popup waits, silently, until Claude Code sends
  its own `permission_prompt` notification (about six seconds after a request that nobody has
  answered); a third hook, `Notification`, passes that on. Anything approved before then — by the
  classifier, a rule, or you in the app — never shows a popup. Codex can hand approvals to its
  auto-reviewer (`approvals_reviewer: auto_review` in the session); it then never asks you, so
  coding-agent-popup stays out of the way. When Codex does ask you, the popup shows right away — and Codex
  waits for it: Codex runs the hook *before* its own approval prompt, so the prompt only appears in
  the Codex app once the popup closes without an answer ("Answer in app", `esc`, or the timeout).
  While a popup is open it keeps watching: once the command is running (it appears in the process
  list) or the call has a result in the session transcript, the popup closes and leaves the
  decision to the agent.
- `Stop` → write the notification into a queue, then try to become the window owner. The first
  one opens the window; later ones just add to the queue and exit immediately, so the agent is
  never blocked. The owner picks up new entries on every tick, refreshes a heartbeat, and — after
  the window closes — re-checks the queue before releasing its lock, so a message arriving at that
  exact moment isn't lost. A crashed window's lock goes stale and is taken over.

The UI is a self-contained HTML page in a borderless `NSWindow` + `WKWebView`. If the web view
fails to load, the script falls back to a native `displayDialog`, so you never lose the prompt.

## Supported agents

| Agent | Permission popup | Question popup | Completion merge | Notes |
|---|---|---|---|---|
| Claude Code | ✅ | ✅ | ✅ | CLI and desktop app |
| Codex | ✅ | — | ✅ | CLI and desktop app (desktop needs hooks from a recent version) |
| Others | maybe | — | ✅ | Any agent whose hook JSON matches: pass its name as the first argument |

Adding another agent is usually just a name. In its hook config, call:

```bash
osascript -l JavaScript "$HOME/.coding-agent-popup/coding-agent-popup.js" <agent-name>
```

Unknown names work — they get a generic terminal icon and their own label in merged popups.

## Configuration

Edit the constants at the top of `~/.coding-agent-popup/coding-agent-popup.js`:

| Constant | Default | Meaning |
|---|---|---|
| `TIMEOUT_SEC` | `180` | How long a question/permission popup waits before handing back to the app |
| `DONE_TIMEOUT_SEC` | `600` | How long the completion window stays before closing itself |
| `WIN_WIDTH` | `400` | Popup width in points |
| `STAGGER_PX` | `28` | Offset between simultaneously open popups |
| `GRACE_MS` | `1000` | Codex and others: how long a permission popup waits before showing |
| `PROMPT_WAIT_SEC` | `30` | Claude Code: show the popup anyway if its "needs your permission" notification never arrives |

Language: `AGENT_POPUP_LANG=en` or `zh`, otherwise macOS's preferred language decides.
After editing, re-run `./install.sh` to copy the updated script (hook configs don't change, so no
re-trusting is needed).

## Troubleshooting

**I don't get a popup while I'm in Claude / Codex / my terminal.**
That's on purpose: when the app the agent runs in is frontmost, the same prompt or reply is right
in front of you. Approvals still pop up if you switch to another app while they're waiting. For a
terminal, "the app" is the whole terminal, so another tab in it also counts.

**Nothing pops up.**
Check the hook is registered and enabled: Claude Code `/hooks`, Codex `/hooks`. In Codex,
`Installed: 0` means the config file wasn't read — restart Codex, and check the file is at
`~/.codex/hooks.json` (or `$CODEX_HOME/hooks.json`). `New hook — review required` means you still
need to trust it.

**Codex desktop doesn't pop up, CLI does.**
Trust the hooks once from the CLI (`codex` → `/hooks`), then fully quit and reopen the desktop app
(`⌘Q`, not just closing the window). If the desktop app still ignores hooks, use the `notify`
fallback in [examples/codex-config-notify.toml](examples/codex-config-notify.toml) — you get
completion notifications (no permission popups), and you should remove the `Stop` hook so you don't
get two notifications.

**The popup appears but is a plain system dialog.**
That's the fallback — the custom window failed to load. The prompt still works. Open Console.app
and look for `osascript` errors if you want to debug it.

**A popup appears for something the agent didn't need to ask about.**
Set `AGENT_POPUP_DEBUG=1` in the agent's environment (for Claude Code, the `env` block of
`~/.claude/settings.json`). Each permission request is then logged with its tool, permission mode
and outcome to `coding-agent-popup/debug.log` in your temp directory (`getconf DARWIN_USER_TEMP_DIR`).
Tool input isn't logged.

**macOS asks for permission the first time.**
Allow it. Scripts that create windows need accessibility/automation permission once.

**A command runs without asking.**
Your agent's approval settings allow it. coding-agent-popup only sees requests the agent would have asked
about; it can't make a permissive agent stricter.

**My questions don't show up as cards.**
Only Claude Code has `AskUserQuestion`; Codex has no equivalent, so its questions stay in the app.

## Uninstall

```bash
./uninstall.sh
```

Removes the hooks from `~/.claude/settings.json` and `~/.codex/hooks.json` (leaving your other
settings and hooks alone, with a backup), and deletes `~/.coding-agent-popup`.

## Privacy

Everything is local. The script reads the hook event JSON, the last assistant message (either from
the event or the local transcript file), and writes small queue files under the per-user temp
directory while a popup is open. No network access, no telemetry, no third-party code.

## Development

```bash
npm install     # jsdom, for the UI tests
npm test        # 62 tests: popup UI, queue/lock logic, settled-elsewhere detection, installer, hook entry point
npm run preview # rebuild docs/preview.html from the current CSS
```

The tests stub the macOS-only parts, so they run on Linux and CI too. `docs/preview.html` renders
the three popups in any browser if you want to tweak the design without installing anything.

## License

MIT. Not affiliated with Anthropic or OpenAI; "Claude" and "Codex" are used only to describe
which tools this integrates with.

## Keywords

coding agent popup, coding agent notification, claude code notification, claude code popup,
claude code hooks, codex notification, openai codex hooks, AI agent notification macos, agent
permission prompt, terminal notification alternative, large screen notification, osascript jxa
wkwebview popup.
