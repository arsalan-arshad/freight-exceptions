# Security and data safety

This tool handles shipment and email data. By design it is read-only, never sends messages, and never contacts carriers; a person copies and sends any message themselves.

## What it does and does not do
- The only outbound network call is to the model provider **you** configure (optional, bring your own key). Message text is not logged by the app.
- There is no login unless you set `APP_PASSWORD`. Run it on localhost or behind your own access controls. There is no rate limiting.
- Use synthetic data for demos and tests. Do not put real customer data into a public or shared instance.
- Model output is untrusted: extracted values are verified against the source text and need a person's confirmation before they change anything.

## Reporting
- Report security issues privately to arsalanarshad.dev@gmail.com. We will acknowledge within a few days.
- Do not open public issues containing real shipment details, customer names or credentials. Anonymise first.
