# Cycle Intelligence — Backlog

> Shared task list for multi-agent development. Use `[ ]` / `[/]` / `[x]` / `[!]` for status.
>
> **Legend:** `[ ]` todo · `[/]` in progress · `[x]` done · `[!]` blocked

---

## 0 — Project Infrastructure
- [x] Mobile-responsive dashboard layout
- [x] Persist backlog + plans to project root (`backlog.md`, `plan.md`)
- [ ] Remove stale artifacts from antigravity scratch dir after promoting

---

## 1 — LLM-Powered Log Capture
> Replace the rigid keyword parser with a Gemini 2.5 Flash API call for NLP.

- [x] Add `/api/parse` endpoint that calls Gemini 2.5 Flash
- [x] Define structured output schema (date, mood_score, event_summary, is_period)
- [x] Wire frontend input to use `/api/parse` instead of local `parseInput`
- [x] Support backdating: "today was X", "yesterday she was Y", "last Tuesday was Z"
- [x] Support multi-event input: "Monday was bad, Tuesday was fine"
- [x] Keep live preview working (show parsed result before committing)
- [x] Fallback gracefully if API is unavailable (use local parser)
- [x] Verify: input → parse → dashboard update → chart reflects entry

---

## 2 — Statefulness & Database
> Migrate from markdown-file storage to SQLite + keep markdown as export format.

- [x] Design SQLite schema: `mood_entries`, `period_entries`, `cycle_config`
- [x] Add `db.py` module with read/write functions
- [x] Migrate `server.py` to use SQLite instead of markdown parsing
- [x] Add data migration script: read existing markdown → populate SQLite
- [x] Keep markdown export for human-readability / version control
- [x] Add `/api/export` endpoint to dump data as markdown

---

## 3 — Production App Setup
> Make it a proper deployable application.

- [x] Add `requirements.txt` (or pyproject.toml)
- [x] Add proper error handling and logging in server
- [x] Add CORS configuration for production
- [x] Add environment variable support (API keys, port, etc.)
- [x] Add `.env.example` with required variables
- [x] Add startup script / Makefile
- [ ] Consider migrating server to Flask or FastAPI for robustness

---

## 4 — Edit Log Entries (Natural Language)
> Low-friction editing via natural language and inline UI.

- [ ] Add `/api/entry/update` endpoint
- [ ] Add `/api/entry/delete` endpoint
- [ ] LLM-powered edit parsing: "update the entry on March 5 to say she was calm"
- [ ] UI: pullable list of entries with inline one-liner editing
- [ ] One-liner → structured format conversion (LLM assist)
- [ ] Structured format → dashboard recomputation
- [ ] Support "undo last entry" via simple command

---

## 5 — Prediction Feedback & Delta Tracking
> Allow logging retroactive feedback to compare predictions vs reality.

- [ ] Extend data model: add `predicted_score` field to mood entries
- [ ] When logging a mood on a future-predicted date, auto-capture the prediction
- [ ] Add `delta` (actual - predicted) to the stored entry
- [ ] Dashboard visualization: show prediction vs actual overlay on chart
- [ ] Aggregate delta stats in Model Confidence card
- [ ] Retroactive apply: "apply feedback" re-scores without altering predictions
- [ ] Do NOT alter the prediction line when actuals are logged
- [ ] Track cycle length changes over time (store historical values, show trend)

---

## 6 — CLI & Agent API
> Queryable interface for chatbot tool-calls and other agents.

- [ ] Create `cli.py` with argparse: `--help`, subcommands
- [ ] `cli.py status` → today's phase, risk level, tip, patience/energy
- [ ] `cli.py log "yesterday she was upset"` → parse + store
- [ ] `cli.py query "what was the mood on march 5?"` → lookup
- [ ] `cli.py forecast [--days N]` → upcoming sensitive/resilient windows
- [ ] `cli.py advisory` → natural-language advisory (sensitivity alerts)
- [ ] All output as JSON (machine-readable) with `--json` flag
- [ ] Human-friendly default output with risk-level language
- [ ] Document tool schemas for LLM function-calling integration

---

## Icebox (Deferred)
> Not critical this session. Pick up later.

- [ ] Export data as CSV (`cli.py export --format csv`, `/api/export?format=csv`)
- [ ] Make `periodLength` configurable via CLI/UI (currently hardcoded to 5)
