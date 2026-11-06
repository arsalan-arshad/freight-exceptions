# Spec — Freight Exception Handling (v0 blueprint)

## Principles
1. Rules decide exceptions; AI only extracts and drafts.
2. AI extraction output is validated against a fixed schema and cross-checked against the source text; a value not found in the source is rejected or sent to human review.
3. Drafts contain only facts present in the case data. No invented times, amounts or references.
4. Nothing is sent without human approval in v0.
5. Read-only access to email and data.

## Data model (sketch)
```ts
interface Shipment { id: string; reference: string; carrier?: string; pickupWindow?: Window; deliveryWindow?: Window; agreedRate?: Money; events: StatusEvent[]; documents: Doc[]; }
interface ExceptionCase { id: string; shipmentId: string; ruleId: string; severity: 'low'|'med'|'high'; evidence: Evidence[]; status: 'open'|'drafted'|'resolved'|'dismissed'; }
interface Evidence { source: 'email'|'csv'|'event'; ref: string; excerpt: string; }
```

## Pipeline
1. Ingest: CSV import and read-only email (later). 2. Extract: model proposes fields from emails into the schema; validator checks each value appears in the source. 3. Rules engine: pure functions over `Shipment`, thresholds configurable per account. 4. Case list UI: open exceptions with evidence. 5. Draft: model writes a short message from the case facts; a person edits and sends it themselves.

## Testing
Synthetic shipments and emails covering each rule with passing, failing and ambiguous cases; extraction tests where the source text lacks the value (must be rejected); draft tests asserting no number outside the case data.

## Non-goals (v0)
Automatic sending, rate negotiation, TMS integrations, load booking, payments.

## Risks
Email OAuth review thresholds (verify with Google/Microsoft docs, spike F4); messy email formats; trust; established vendors.
