# Installation Operations Dashboard

A standalone localhost dashboard for solar installation scheduling, delivery,
SEDA readiness, SLD viewing, and multi-role team assignment.

## Docker

Docker is not required. The first version runs directly with Node.js:

```powershell
npm.cmd install
npm.cmd run dev
```

Open [http://localhost:3000](http://localhost:3000).

Docker can be added later for deployment consistency, but it would add
unnecessary setup for the current localhost workflow.

## Connections

Copy `.env.example` to `.env.local` and set:

- `PG_PROXY_TOKEN`: read-only token for the source PostgreSQL proxy.
- `NEXT_PUBLIC_SUPABASE_URL`: the installation Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only key from Supabase project settings.

Never expose `PG_PROXY_TOKEN` or `SUPABASE_SERVICE_ROLE_KEY` in browser code.

The source proxy is queried only by the Next.js server route. The dashboard
imports invoices whose `percent_of_total_amount` is at least 59%.

## Supabase setup

1. Open the Supabase SQL editor.
2. Run `supabase/schema.sql`.
3. Add the service-role key to `.env.local`.
4. Restart the development server.

Until the Supabase key and schema are configured, operational edits remain in
the current browser using local storage. Source API data can still load live.

## Source field mapping

| Dashboard field | Source |
|---|---|
| Sales price | `invoice.total_amount` |
| Payment percentage | `invoice.percent_of_total_amount` |
| Payment balance | `invoice.balance_due` |
| Customer | `customer` via `invoice.linked_customer` |
| Agent | `agent` via `invoice.linked_agent` |
| Panel | `invoice.panel_qty` and `invoice.panel_rating` |
| Inverter | package inverter product, then SEDA/package fallback |
| Phase | `seda_registration.phase_type` |
| SEDA | `seda_registration.seda_status` |
| Address | SEDA installation address, then customer address |
| SLD | SEDA drawing PDF, then invoice PV system drawing |
