# Draft exception rules (to validate with brokers)

Each rule: id, trigger, inputs, severity, suggested next step, fixture test. All thresholds are placeholders until brokers confirm.

| id | Trigger | Inputs | Suggested next step |
|---|---|---|---|
| LATE-PU | Pickup not confirmed N hours after the appointment window | appointment time, status events | Ask carrier for ETA |
| LATE-DEL | Delivery ETA after the promised window, or no delivery confirmation by window end | promised window, latest ETA/status | Ask carrier, warn the customer |
| NO-POD | Delivered but no proof of delivery received within N hours | delivery event, document list | Request POD from carrier |
| NO-UPDATE | No status event for N hours on an in-transit load | last event time | Check-call |
| DETENTION | Dwell time at a stop over the free-time limit | arrive/depart times, free-time terms | Flag for accessorial billing |
| RATE-MISMATCH | Carrier invoice differs from the agreed rate | agreed rate, invoice amount | Hold payment, query carrier |

Every exception stores the rule id, the input values, and the source message or row so a person can verify it. Nothing here is an automated decision about money; humans approve.
