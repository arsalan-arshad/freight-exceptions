# freight-exceptions — a short daily list of shipment problems for small freight brokers

> **Open source (MIT).** Early, unvalidated software: built from a hypothesis, **not yet tested with real brokers**. Treat every threshold as a placeholder.

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

---

## 1. Overview

Small freight brokers and 3PLs spend a large part of the day chasing carriers: where is the truck, where is the proof of delivery, why does this invoice not match the rate. **freight-exceptions** turns shipment data into a short list of open exceptions, each with the evidence behind it and a drafted follow-up that a person reviews.

Three rules of the design, enforced in code and tests:

- **Rules decide, AI does not.** Whether something is an exception is decided by plain, deterministic functions in `src/core/`. The same input always gives the same list.
- **AI is optional and boxed in.** A model (your own API key) may only (a) extract fields from an email into a fixed schema, where every value must come with a quote that is verified to exist in the email, and (b) word a follow-up using only facts already in the case. Anything else is rejected, and a failing draft falls back to a fixed template.
- **Nothing is ever sent.** There is no send button, SMTP, or webhook anywhere. A person can edit a draft, copy it, and mark it approved; they send it themselves.

**What it is not (yet):** a TMS, a tracking product, or a hosted service. It does not talk to your email account, and it does not read from a TMS. See the roadmap.

## 2. Implemented features

- **Six exception rules** (`src/core/rules/`): `LATE-PU` late pickup, `LATE-DEL` late delivery or late ETA, `NO-POD` delivered with no proof of delivery, `NO-UPDATE` no status update while in transit, `DETENTION` dwell over free time, `RATE-MISMATCH` carrier invoice differs from the agreed rate. Each case carries a severity, a plain-language summary, the facts used, and links back to the source rows/messages. If an input is missing (for example no delivery window), the rule stays quiet instead of guessing.
- **Configurable thresholds** (`src/core/types.ts` `DEFAULT_RULE_CONFIG`): all current defaults are placeholders chosen without broker input.
- **CSV import** (`src/ingest/csv.ts`): one row per shipment, flexible header names, never throws on a bad row (it reports issues instead). Times without a timezone are treated as UTC and the import says so.
- **Email import, model required** (`src/ingest/extract.ts`, `eml.ts`, `apply.ts`): paste a raw email (or its text); the model proposes fields; each is accepted only if its quote appears verbatim in the email and supports what the field claims (an ETA cannot be saved as a delivery time, a fee is not an invoice total, negations such as "POD not attached" are caught). Times need an explicit timezone. **Nothing is stored until a person ticks the values to apply**, and they are re-verified on apply. Values for shipments that are not already in your data are not created. Without a model configured the app says so and stores nothing.
- **Drafts** (`src/ai/`): a deterministic template per rule, or an optional model rewrite. `validateDraft` blocks any number, time, reference, link or email that is not in the case facts, spelled-out quantities such as "twelve hours", deadline words such as "tomorrow", and payment promises or threats.
- **Web UI** (`src/app/`): case list with filters, case detail with evidence, draft editing with live validation, copy to clipboard, approve, resolve, dismiss. A draft remembers the case facts it was written against; if time passes or new data arrives it is flagged out of date and cannot be approved or copied until regenerated. Light and dark themes, usable on a phone-width screen.
- **Storage** (`src/db/sqlite.ts`): SQLite via Node's built-in `node:sqlite`. No database server needed.
- **Demo mode** (`DEMO_MODE=true`): sample data only; uploads, pasted email and the model are disabled; a banner says so.
- **Optional password gate** (`APP_PASSWORD`): HTTP Basic auth on every page and API route.
- **Synthetic data only** (`src/fixtures/`): fake shipments, CSV and emails for demos and tests. No real customer data is in this repository.

## 3. Architecture and stack

TypeScript (strict), Node 22.13+, Next.js (App Router) + React, SQLite. Production dependencies: `next`, `react`, `react-dom`. Model calls use plain `fetch`; there are no AI SDKs.

```
src/
  core/       types, six rules, evaluateShipments()      pure, deterministic, takes `now` as input
  fixtures/   synthetic shipments, CSV and emails         all fake, times relative to `now`
  ingest/     CSV parser, .eml parser, field extraction   untrusted input; model output is verified
  ai/         model clients (BYOK), template + model drafts, draft validator
  db/         Store interface + SQLite implementation
  app/        Next.js pages, API routes, import pipeline, auth gate
  proxy.ts    password gate (Next 16 "proxy", formerly middleware)
docs/         SPEC.md, EXCEPTION_RULES.md, BUILD_PLAN.md, CONTRACT.md
```

## 4. Data model (SQLite)

| Table | Purpose |
|---|---|
| `shipments` | one row per shipment; events and documents stored as JSON in `data` |
| `cases` | one row per exception (`<shipmentId>:<RULE>`); status `open`, `drafted`, `resolved` or `dismissed` |
| `drafts` | the latest draft per case, with `approved` flag; approving never sends anything |

Schema version is tracked with `PRAGMA user_version`.

## 5. Local development quickstart

Prerequisite: Node 22.13 or newer.

```bash
npm install
cp .env.example .env.local     # optional; every setting is optional
npm run dev                    # http://localhost:3000
```

Open the app, press **Load sample data**, and open a case. Drafts use the built-in templates unless you set `LLM_PROVIDER` (`anthropic` or `openai`), `LLM_API_KEY` and `LLM_MODEL` in your own environment. Your key stays in your environment and is never sent anywhere except the provider you choose.

| Variable | Meaning |
|---|---|
| `DATABASE_PATH` | SQLite file (default `./data/freight.sqlite`) |
| `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL` | optional model, bring your own key; `LLM_BASE_URL` optional |
| `DEMO_MODE` | `true` for sample data only |
| `APP_PASSWORD` | when set, every route needs HTTP Basic auth (any username) |
| `ALLOWED_HOSTS` | extra hostnames accepted when no password is set (default: localhost, 127.0.0.1, [::1]); protects against DNS rebinding |

**Run it on localhost or behind your own network controls.** Without `APP_PASSWORD` the app has no login, and it only answers requests for localhost-style hostnames unless you list others in `ALLOWED_HOSTS`. There is no rate limiting.

## 6. Verification and tests

```bash
npm run typecheck   # tsc --noEmit
npm test            # node:test over src/**/*.test.ts and test/**/*.test.ts
npm run build       # production build
npm run check       # typecheck + tests
```

The tests use synthetic data only and cover each rule (passing, failing, boundary and missing-data cases), parser edge cases, adversarial model output, the draft validator, the SQLite store, the auth gate and the import pipeline. Adversarial tests live in `test/adversarial/` (hostile emails, model output, drafts, HTML and CSV inputs, auth and origin checks). Nothing has been tested against a live model provider.

A GitHub Actions workflow (`.github/workflows/ci.yml`: typecheck, tests, build) is in the repo but **has not run yet**, because nothing has been pushed.

## 7. Deployment

A `Dockerfile` (Node 22, non-root, standalone Next output, SQLite on a `/data` volume) is included but has **not been built or run in this repository's history**, and nothing is deployed anywhere. For any public instance use `DEMO_MODE=true` so nobody can upload real customer data to a page with no accounts.

## 8. Roadmap

- [x] Rules, CSV import, drafts, case list UI, SQLite storage
- [x] Optional model extraction and drafting with verification (BYOK)
- [ ] Validate the rules and thresholds with real brokers (about 10 conversations first)
- [ ] First green CI run on GitHub (workflow file exists, never run)
- [ ] Read-only email connection (self-hosted Gmail or Microsoft first; see `docs/` notes on review requirements)
- [ ] Postgres storage adapter
- [ ] Accounts, multi-user hosting, billing — only after a paying pilot says yes
- [x] Cases that were auto-resolved by new data re-open if the exception returns (cases a person resolved or dismissed stay as they left them)

## Known limitations

- Thresholds and severity levels are guesses until brokers confirm them.
- When new data clears an exception the case is auto-resolved (and marked as resolved by data).
- The draft validator is a strong filter, not proof. It cannot catch a wrong name or a false statement that contains no digits (for example "the truck is parked at the dock"), and number words in other languages are only partly caught. Template drafts avoid this; model-worded drafts need a human read, which is why approval is manual.
- The email `Date` header is unauthenticated and is used to resolve relative dates.
- In `DEMO_MODE` the state (including drafts) is shared by every visitor, and anyone can reset it. Use it for fake data only.
- The Content-Security-Policy allows inline scripts because Next.js hydration needs them in this setup.
- Single-user, no accounts, no audit log.

## Contributing and security

See `CONTRIBUTING.md` and `SECURITY.md`. Contact: arsalanarshad.dev@gmail.com.
