# Installation Operations Dashboard

A standalone localhost dashboard for solar installation scheduling, delivery,
SEDA readiness, SLD viewing, and multi-role team assignment.

## Setup

This project runs as a Next.js app first, with an optional Electron desktop
wrapper for sharing the dashboard as a packaged app.

```powershell
npm.cmd install
npm.cmd run dev
```

Open [http://localhost:3000](http://localhost:3000).

To launch the Electron wrapper during development:

```powershell
npm.cmd run desktop
```

To build a distributable Windows installer:

```powershell
npm.cmd run dist:win
```

The installer is written to `C:\tmp\installation-system-release`.

## Connections

Copy `.env.example` to `.env.local` and set the PostgreSQL proxy values:

- `PG_PROXY_URL`: the API endpoint for SQL queries.
- `PG_PROXY_DATABASE`: the database name exposed by the proxy.
- `PG_PROXY_TOKEN`: the bearer token used by the server route.

Never expose `PG_PROXY_TOKEN` in browser code.

The dashboard imports invoices whose `percent_of_total_amount` is at least 59%.
Source data is read from the PostgreSQL proxy, and operational writes go back to
the API database through the server routes.

## Database bootstrap

The installation tables and operational state are created automatically the first
time the API routes write to the database. No API database schema upload,
or browser-side secret is required.

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
| SLD | `seda_registration.seda_status` |
| Address | SEDA installation address, then customer address |

## Notes

- The desktop wrapper opens the local dashboard and keeps it on the same server
  the web app uses.
- Team Planning supports map hover, marker highlighting, and customer focus.
- Source API writes remain server-side so shared desktop builds do not expose
  database credentials.