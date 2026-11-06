# Build contract (internal, for parallel development)

Stack: TypeScript (strict), Node >= 22.13, ESM. Tests: `node:test` via `tsx` (`npm test`). Typecheck: `npm run typecheck`.
UI: Next.js (App Router, `src/app`) + React. Storage: SQLite through `node:sqlite` behind the `Store` interface (Postgres adapter is roadmap; D6 in PROJECT_CONTEXT).
Zero cost to run: no paid service is needed. A model is optional and BYOK.

## Hard rules (every agent)
1. Rules decide exceptions. A model may only (a) extract fields into the fixed schema in `src/ingest/types.ts`, each with a verbatim quote that is verified to exist in the source, rejecting anything not found; (b) draft messages containing only values from `ExceptionCase.facts`.
2. Nothing is ever sent. No SMTP, no Gmail send, no webhooks. "Approve" only marks text as reviewed so the person can copy it.
3. Synthetic data only. Never include real names, companies, phone numbers, emails or shipment data. Use obviously fake names (e.g. "Acme Freight", "Example Carrier LLC", `@example.com`).
4. Secrets: never print or commit them. Read config from env only. `.env.example` lists names only.
5. Do NOT edit `src/core/types.ts` or any `*/types.ts` owned by someone else. If a contract change is needed, work around it and report it.
6. Do NOT run any `git` command. The orchestrator commits.
7. Stay inside your assigned folders. Do not touch sibling project folders outside this directory.
8. Every module ships with tests that run under `npm test` and pass. Test the unhappy paths (missing data, ambiguous data, hostile model output).
9. Pure functions take `now` as a parameter. No `Date.now()` inside rules.
10. Keep dependencies minimal. Prefer Node built-ins. State any new dependency in your report.

## Folder ownership
| Folder | Owner | Exports (from `index.ts`) |
|---|---|---|
| `src/core/` (except `types.ts`) | core agent | `evaluateShipments(shipments, now, config?) => ExceptionCase[]`, `RULES`, re-export types and `DEFAULT_RULE_CONFIG` |
| `src/fixtures/` | core agent | `generateSyntheticShipments(now: Date, seed?: number) => Shipment[]`, `generateSampleCsv(now: Date) => string` (CSV in the format below), `generateSampleEmails(now: Date) => { id: string; raw: string }[]` (raw .eml text; each email refers to a reference present in the sample CSV). All times are relative to `now` so the demo always shows live exceptions. |
| `src/ingest/` (except `types.ts`) | ingest+ai agent | see signatures in `src/ingest/types.ts` |
| `src/ai/` (except `types.ts`) | ingest+ai agent | see signatures in `src/ai/types.ts` |
| `src/db/` (except `types.ts`) | app agent | `openSqliteStore(path: string \| ':memory:'): Store` |
| `src/app/`, `next.config.*`, `public/` | app agent | Next.js UI and API routes |
| `test/` | whoever needs cross-module tests | integration tests |

## Rule semantics (core agent implements; all thresholds from `RuleConfig`)
- LATE-PU: no `picked_up` event and no `departed` at the pickup stop, and `now` is later than `pickupWindow.end + latePickupGraceHours`.
- LATE-DEL: not delivered, and either `now` is past `deliveryWindow.end + lateDeliveryGraceHours`, or the latest `eta_update.eta` is past `deliveryWindow.end`.
- NO-POD: has a `delivered` event, no `pod` document, and `now` is later than delivered time + `noPodHours`.
- NO-UPDATE: picked up, not delivered, and the newest event is older than `noUpdateHours`.
- DETENTION: per stop, dwell = departed - arrived (or `now` - arrived if still on site); exception when dwell exceeds `freeTimeMinutes` (shipment) or `defaultFreeTimeMinutes`. Id suffix `:pickup` / `:delivery`.
- RATE-MISMATCH: an `invoice` document with `amount`, and `agreedRate` exists. Differs by more than `rateToleranceAmount` (same currency), or currencies differ.
- Missing inputs (no window, no agreed rate) => the rule does not fire; never guess. Output sorted by severity then id. Same input => identical output.
- Every case has `facts` (display-ready: references, carrier, times formatted with offset, amounts like "1,250.00 USD"), `evidence` pointing at the source events/docs, `title`, `summary`, `suggestedNextStep`. Severity: document your reasoning in the rule file.

## Sample CSV format (`parseShipmentsCsv`)
One row per shipment, header names case-insensitive, aliases allowed (document them). Columns:
`reference, customer, carrier, pickup_start, pickup_end, delivery_start, delivery_end, free_time_minutes, agreed_rate, currency, pickup_arrived_at, picked_up_at, pickup_departed_at, delivery_arrived_at, delivery_departed_at, delivered_at, eta, last_status_at, last_status_note, pod_received_at, invoice_amount, invoice_received_at`.
Empty cell = unknown. Bad rows produce `issues`, never throw. Shipment id = stable slug of the reference. Events/docs get stable ids like `${shipmentId}:picked_up`. Quoted fields, commas inside quotes, CRLF and a UTF-8 BOM must work. Times without an offset are treated as UTC and the issue list says so.

## Dependencies
Only the **app agent** may run `npm install` (it owns package.json). Everyone else uses Node built-ins and the already-installed `typescript`, `tsx`, `@types/node`.

## Running only your part
`node --import tsx --test "src/<folder>/**/*.test.ts"` and `npx tsc --noEmit 2>&1 | grep '^src/<folder>'` (other folders may be mid-edit by other agents; ignore their errors).

## Web app behaviour (app agent)
- `/` case list: open exceptions sorted by severity, filters by rule/status, each row shows title, shipment reference, carrier, evidence on expand.
- Import: upload CSV, paste an email (raw or .eml) to extract, or "Load sample data". After import: upsert shipments, run `evaluateShipments` with the real current time, `saveCases`.
- Case detail: facts, evidence, suggested next step, "Generate draft" (LLM if configured else template; invalid LLM drafts fall back to the template and say so), editable text, "Copy to clipboard", "Mark approved", "Resolve", "Dismiss". There is NO send button.
- Env: `DATABASE_PATH` (default `./data/freight.sqlite`), `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `DEMO_MODE=true` (disables uploads/paste and the LLM; only sample data; banner says so), `APP_PASSWORD` (optional HTTP Basic gate for everything when set).
- Honest UI copy: say that thresholds are placeholders and nothing is sent.
