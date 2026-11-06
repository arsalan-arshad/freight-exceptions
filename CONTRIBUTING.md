# Contributing to freight-exceptions

This project is **open source (MIT)** and **early**: the code exists, but the rules and thresholds have not been validated with real brokers.

## Most valuable contribution
Real-world broker experience: which exceptions cost you the most, what thresholds you use, how you handle them today. Open an issue and **anonymise everything** (no customer names, load numbers or real shipment data).

## Code changes
- Open an issue first for anything beyond a small fix; one change per PR; branches `feat/<short>` or `fix/<short>`.
- Before submitting run `npm run check` (typecheck and tests) and `npm run build`. These are the checks that exist; a CI workflow file is included but has not run on GitHub yet.
- Every rule needs passing, failing, boundary and missing-data fixtures (synthetic only).
- Changes that let AI-extracted values bypass the verbatim-quote check, change which cases exist, or add any way to send a message will be rejected.
- Tests in `test/adversarial/` encode past security findings; do not weaken them to make a change pass.
- Never commit secrets or real shipment/customer data. New dependencies need a reason in the PR.
- Security-sensitive changes (ingest, draft validation, auth, storage) get extra scrutiny.
