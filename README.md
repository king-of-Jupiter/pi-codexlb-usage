# pi-codexlb-usage

*[Русская версия](README.ru.md)*

An extension for [pi](https://github.com/badlogic/pi-mono) / [oh-my-pi](https://github.com/can1357/oh-my-pi):
usage-limit bars from a [codex-lb](https://github.com/Soju06/codex-lb) load balancer —
a widget below the editor, like [usage-limit-tracker](https://github.com/mattstrayer/usage-limit-tracker),
but fed by your own balancer, like
[paseocodexlbusage](https://github.com/king-of-Jupiter/paseocodexlbusage).

One line per balancer: the `5h` / `7d` windows from the usage endpoint's `limits[]`.
Color is **risk**, not raw percent (the same risk model as the original):

- `│` marks how much of the window has elapsed. Fill left of the tick = under pace.
- `●` chill / on track, `▲` warning / hot.
- Palette is muted by default (`sage → amber → dusty red`). `vivid` and `pastel` are available.

## Install

**oh-my-pi**

```sh
omp install git:github.com/king-of-Jupiter/pi-codexlb-usage
```

(The package is not in the npm registry — it installs straight from GitHub, so
`omp install npm:pi-codexlb-usage` will not work.)

Without `bun` on your PATH: clone the repo and run
`omp plugin link ./pi-codexlb-usage`.

**pi**

```sh
pi install git:github.com/king-of-Jupiter/pi-codexlb-usage
```

Or copy `index.ts` + `src/` + `hooks/` into
`~/.pi/agent/extensions/pi-codexlb-usage/` (pi) or
`~/.omp/agent/extensions/pi-codexlb-usage/` (omp).

No runtime dependencies. Node 22+ (the host runs TypeScript directly).

Do not install alongside the original `usage-limit-tracker`: both register the
`/limits` command and the `usage-limits` widget.

## Configure

The easiest way is via chat commands (stored in
`~/.config/pi-codexlb-usage/config.json` with mode `0600`; the token is never echoed):

```
/limits set-url https://codexlb.example.com/v1/usage
/limits set-token <bearer-token>
/limits config    # show file, source of each field, masked token
```

A bare host works too — `/limits set-url codexlb.example.com`
saves `https://codexlb.example.com/v1/usage`, and a partial path gains
`/usage` (`…/v1` → `…/v1/usage`). Full URLs with a custom
path are kept as-is. The token must be a codex-lb **API key**
(dashboard → API keys), not the dashboard password.

Environment variables also work and win per-field over the file
(handy for one-off runs and CI):

```sh
export CODEXLB_URL="https://example.com/api/usage"
export CODEXLB_TOKEN="<bearer-token>"
```

| Variable | Purpose | Default |
|---|---|---|
| `CODEXLB_URL` (`CODEXLB_USAGE_URL`) | Balancer usage endpoint | — (taken from file) |
| `CODEXLB_TOKEN` (`CODEXLB_BEARER_TOKEN`) | Bearer token (`Authorization: Bearer …`) | — (taken from file) |
| `CODEXLB_LABEL` | Widget line label | `CodexLB` |
| `CODEXLB_CONFIG` | Custom config.json path (tests/profiles) | `~/.config/…` (`$XDG_CONFIG_HOME` respected) |
| `CODEXLB_POLL_MS` | Poll interval (minimum 60,000) | `300000` (5 min) |
| `USAGE_LIMITS_HIDDEN=1` | Start with the widget hidden | visible |
| `USAGE_LIMITS_PALETTE=vivid` | Palette: `muted` / `vivid` / `pastel` | `muted` |
| `CODEXLB_DEBUG=1` | Debug logs to stderr (never the token) | off |

With nothing configured, a one-time setup hint is shown at session start.
pi/omp extensions get no settings storage from the host, so the plugin keeps
its own file — no root needed, and secrets stay out of shell history
(unlike `export`).

## Where the numbers come from

The plugin polls your codex-lb and parses `limits[]`
(`upstream_limits[]` as fallback when empty):

| `limit_window` | Widget window |
|---|---|
| `5h` | `5h` (18000 s) |
| `7d` | `7d` (604800 s) |
| anything else (`90m`, `credits`, …) | verbatim |

- `used = current_value / max_value`, fallback `max_value - remaining_value`.
- Reset time comes from `reset_at`. Entries without one render as plain
  threshold gauges with no countdown.
- `model_filter` adds a suffix: `5h·opus`, `7d·codex-mini`.
- Like the built-in sources, bars show the **consumed** share
  (`current_value`) while the codex-lb dashboard shows the **remaining** share —
  the two add up to 100%.

Polling runs at start and every 5 minutes; the display re-renders every
minute so countdowns move. Nothing is shown until the endpoint is configured
and answers — there are no other data sources.

## Commands

The command is `/limits` (as in the original; no clash with built-in `/usage`).
Subcommands and palette names complete via Tab.

| Command | Effect |
|---|---|
| `/limits` | Poll now and print a plain-text breakdown with the data source |
| `/limits status` | Endpoint (host only), label, poll age, error — no secrets |
| `/limits config` | Config file, source of each field, masked token |
| `/limits set-url <url>` | Save the endpoint to the file and poll (bare host gains `https://` + `/v1/usage`) |
| `/limits set-token <token>` | Save the token to the file (0600) and poll |
| `/limits toggle` | Hide / show the widget |
| `/limits palette muted\|vivid\|pastel` | Switch colors |

## Development

```sh
npm test        # node --test, zero deps
npm run demo    # sample lines
```

Layout:

- `src/smart-color.ts` — risk model, palettes (pure, unchanged from the original)
- `src/render.ts` — bar/line rendering (pure, unchanged)
- `src/sources/codexlb.ts` — fetch + `limits[]` mapping (zero-dep port of `server/usage.ts` from paseocodexlbusage)
- `src/config.ts` — config file `~/.config/pi-codexlb-usage/config.json` (0600), env wins per-field
- `src/store.ts` — per-provider window merge (unchanged)
- `src/extension.ts` — host wiring (events, widget, timers, `/limits`)

## Credits

- Widget, risk coloring, rendering: [mattstrayer/usage-limit-tracker](https://github.com/mattstrayer/usage-limit-tracker) (MIT).
  The risk-color idea is from [TokenEater](https://github.com/AThevon/TokenEater).
- codex-lb `limits[]` mapping: [king-of-Jupiter/paseocodexlbusage](https://github.com/king-of-Jupiter/paseocodexlbusage).
- Data: [Soju06/codex-lb](https://github.com/Soju06/codex-lb).

MIT
