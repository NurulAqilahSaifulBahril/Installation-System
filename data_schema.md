# NUrul_DB data schema

Generated 2026-09-28 from the live database catalog (read-only queries through the Railway pg-proxy). Row counts are exact as of that date.

| | |
|---|---|
| Database | `NUrul_DB` (Postgres database name `railway`) |
| Host | Railway, reached through `https://pg-proxy-production.up.railway.app/api/sql` |
| Engine | PostgreSQL 17.11 |
| Size | 174 MB |
| Tables | 125 (`dashboard` 21, `eter_agent` 3, `notification` 3, `public` 98); no views |

## Key facts

- **Invoices live in this database.** `invoice` (8,344) and `invoice_item` (31,750) are copied in from Bubble, together with customers, payments, agents, packages and SEDA registrations.
- **The Bubble sync last ran on 2026-08-12.** `sync_state` shows every synced table last refreshed between 07:13 and 07:21 UTC that day, all with `ok = true`. The newest invoice is INV-1011145; anything created after that (for example INV-1011299) is not here.
- **The installation app owns 7 tables** (listed below). It only reads the business tables and never writes to them.
- **Installation dates are stored in `installation_jobs.installation_date`**, keyed to the invoice by `source_invoice_id`. `invoice.installation_date` and `invoice.installation_status` are text columns that are empty on every row.
- The connection user is `postgres`, so any holder of the full-access key can change any table.

## Linking installation data to invoices

Every `installation_jobs` row matches an invoice (451 of 451). Join on the invoice's `bubble_id` (or `id`), not on `invoice_number`: some jobs store the number without the `INV-` prefix.

```sql
select i.invoice_number,
       i.customer_name_snapshot,
       j.installation_date,
       j.customer_availability_status,
       j.schedule_status,
       j.delivery_status,
       j.delivery_date
from public.installation_jobs j
join public.invoice i
  on i.bubble_id::text = j.source_invoice_id
  or i.id::text = j.source_invoice_id;
```

Tables the installation app reads to build its pipeline: `agent`, `customer`, `invoice`, `invoice_item`, `package`, `package_item`, `payment`, `product`, `seda_registration`.

## Tables by group

### Installation app (created and written by this app)

| Table | Rows | Cols | Notes |
|---|---:|---:|---|
| [`installation_jobs`](#public-installation_jobs) | 451 | 30 | One row per customer installation. Install date, schedule, delivery, equipment and remarks. Linked to `invoice` by `source_invoice_id`. |
| [`job_team_assignments`](#public-job_team_assignments) | 0 | 8 | Which team (roof, electrical, …) handles each installation job. |
| [`job_status_history`](#public-job_status_history) | 254 | 5 | Log of status changes per installation job. |
| [`installation_ops_state`](#public-installation_ops_state) | 1 | 3 | Single row of JSON: installation groups, delivery runs, team rosters, weekly team assignments, and a backup copy of per-job edits (`jobUpdates`). |
| [`app_users`](#public-app_users) | 5 | 8 | Installation dashboard logins (username, role, password hash). Internal. |
| [`app_sessions`](#public-app_sessions) | 32 | 5 | Signed-in sessions for the installation dashboard. Internal. |
| [`app_audit_log`](#public-app_audit_log) | 1,601 | 9 | Who changed what in the installation dashboard, and when. Internal. |

### Business data synced from Bubble

| Table | Rows | Cols | Notes |
|---|---:|---:|---|
| [`agent`](#public-agent) | 200 | 32 | Sales agents, synced from Bubble. |
| [`customer`](#public-customer) | 7,516 | 22 | Customer master record, synced from Bubble. |
| [`invoice`](#public-invoice) | 8,344 | 130 | Main invoice table, synced from Bubble. 130 columns. `installation_date` / `installation_status` exist but are empty. |
| [`invoice_item`](#public-invoice_item) | 31,750 | 25 | Line items for `invoice` (package, panels, inverter, battery, add-ons). |
| [`invoice_payment_planning`](#public-invoice_payment_planning) | 0 | 22 | Payment plans per invoice (synced, currently empty). |
| [`package`](#public-package) | 1,290 | 33 | Solar packages sold (panel/inverter combinations, pricing). |
| [`payment`](#public-payment) | 3,934 | 32 | Payments received against invoices, synced from Bubble. |
| [`referral`](#public-referral) | 353 | 16 | Customer referrals, synced from Bubble. |
| [`seda_registration`](#public-seda_registration) | 11,721 | 116 | SEDA (NEM) registration records per customer/invoice. 116 columns. |
| [`user`](#public-user) | 217 | 37 | Bubble user accounts (staff and agents), synced from Bubble. |
| [`voucher`](#public-voucher) | 69 | 27 | Discount vouchers, synced from Bubble. |

### New invoicing system

| Table | Rows | Cols | Notes |
|---|---:|---:|---|
| [`invoice_new`](#public-invoice_new) | 33 | 41 | Invoices from the newer in-house invoicing flow (33 rows). Separate from `invoice`. |
| [`invoice_new_item`](#public-invoice_new_item) | 33 | 13 | Line items for `invoice_new`. |
| [`invoice_payment_new`](#public-invoice_payment_new) | 0 | 15 | Payments for `invoice_new` (empty). |
| [`invoice_template`](#public-invoice_template) | 3 | 20 | Templates for `invoice_new`. |

### Sync bookkeeping

| Table | Rows | Cols | Notes |
|---|---:|---:|---|
| [`sync_state`](#public-sync_state) | 11 | 5 | Last Bubble → NUrul_DB sync time and row count per table. |
| [`sync_cursors`](#public-sync_cursors) | 11 | 7 | Older incremental-sync cursors (last used 2025). |
| [`sync_status`](#public-sync_status) | 0 | 8 | Empty |
| [`synced_records`](#public-synced_records) | 0 | 7 | Empty |

### `dashboard` schema (commission / agent dashboard)

| Table | Rows | Cols | Notes |
|---|---:|---:|---|
| [`dashboard.agent_roles`](#dashboard-agent_roles) | 110 | 18 |  |
| [`dashboard.anp_rules`](#dashboard-anp_rules) | 2 | 9 |  |
| [`dashboard.anp_tiers`](#dashboard-anp_tiers) | 10 | 9 |  |
| [`dashboard.audit_log`](#dashboard-audit_log) | 669 | 9 |  |
| [`dashboard.basic_rates`](#dashboard-basic_rates) | 0 | 13 | Empty |
| [`dashboard.commission_entries`](#dashboard-commission_entries) | 0 | 15 | Empty |
| [`dashboard.commission_rates`](#dashboard-commission_rates) | 47 | 25 |  |
| [`dashboard.contest_roster`](#dashboard-contest_roster) | 47 | 9 |  |
| [`dashboard.contest_rules`](#dashboard-contest_rules) | 3 | 23 |  |
| [`dashboard.contest_team_month`](#dashboard-contest_team_month) | 18 | 11 |  |
| [`dashboard.ega_month_thresholds`](#dashboard-ega_month_thresholds) | 14 | 10 |  |
| [`dashboard.ega_rules`](#dashboard-ega_rules) | 2 | 13 |  |
| [`dashboard.factory_rates`](#dashboard-factory_rates) | 4 | 9 |  |
| [`dashboard.invoices`](#dashboard-invoices) | 5,964 | 22 | Invoice snapshot used by the commission dashboard. |
| [`dashboard.login_log`](#dashboard-login_log) | 158 | 8 |  |
| [`dashboard.nfp_prices`](#dashboard-nfp_prices) | 896 | 17 |  |
| [`dashboard.portal_staff`](#dashboard-portal_staff) | 1 | 5 |  |
| [`dashboard.production_bonus_rules`](#dashboard-production_bonus_rules) | 2 | 17 |  |
| [`dashboard.rule_settings`](#dashboard-rule_settings) | 0 | 17 | Empty |
| [`dashboard.special_cases`](#dashboard-special_cases) | 59 | 9 |  |
| [`dashboard.users`](#dashboard-users) | 12 | 6 |  |

### `eter_agent` and `notification` schemas

| Table | Rows | Cols | Notes |
|---|---:|---:|---|
| [`eter_agent.agents`](#eter_agent-agents) | 2 | 5 |  |
| [`eter_agent.messages`](#eter_agent-messages) | 15 | 7 |  |
| [`eter_agent.sessions`](#eter_agent-sessions) | 3 | 6 |  |
| [`notification.delivery_log`](#notification-delivery_log) | 6 | 6 |  |
| [`notification.notification_log`](#notification-notification_log) | 6 | 8 |  |
| [`notification.subscriptions`](#notification-subscriptions) | 1 | 8 |  |

### Other `public` tables

| Table | Rows | Cols | Notes |
|---|---:|---:|---|
| [`_admin_backup_logs`](#public-_admin_backup_logs) | 9 | 6 |  |
| [`agent_content`](#public-agent_content) | 0 | 11 | Empty |
| [`agent_daily_report`](#public-agent_daily_report) | 3,204 | 15 |  |
| [`agent_monthly_commission`](#public-agent_monthly_commission) | 0 | 11 | Empty |
| [`agent_monthly_perf`](#public-agent_monthly_perf) | 604 | 14 |  |
| [`ai_contact`](#public-ai_contact) | 0 | 9 | Empty |
| [`ai_profile`](#public-ai_profile) | 0 | 8 | Empty |
| [`alembic_version`](#public-alembic_version) | 1 | 1 |  |
| [`api_key`](#public-api_key) | 1 | 10 |  |
| [`app_news_articles`](#public-app_news_articles) | 8 | 13 |  |
| [`app_news_headlines`](#public-app_news_headlines) | 9 | 11 |  |
| [`app_search_tasks`](#public-app_search_tasks) | 1 | 10 |  |
| [`app_settings`](#public-app_settings) | 0 | 3 | Empty |
| [`audit_log`](#public-audit_log) | 32 | 12 |  |
| [`auth_session`](#public-auth_session) | 0 | 8 | Empty |
| [`auth_user`](#public-auth_user) | 1 | 12 |  |
| [`blacklisted_sites`](#public-blacklisted_sites) | 0 | 7 | Empty |
| [`brand`](#public-brand) | 0 | 8 | Empty |
| [`bug_report`](#public-bug_report) | 0 | 12 | Empty |
| [`career_invitation`](#public-career_invitation) | 0 | 12 | Empty |
| [`case_hub_records`](#public-case_hub_records) | 131 | 4 |  |
| [`category`](#public-category) | 0 | 10 | Empty |
| [`chat_messages`](#public-chat_messages) | 115 | 11 |  |
| [`chat_sessions`](#public-chat_sessions) | 14 | 5 |  |
| [`commission_adjustment`](#public-commission_adjustment) | 0 | 14 | Empty |
| [`commission_adjustment_v2`](#public-commission_adjustment_v2) | 0 | 8 | Empty |
| [`company_setting`](#public-company_setting) | 0 | 10 | Empty |
| [`content_category`](#public-content_category) | 0 | 8 | Empty |
| [`conversation`](#public-conversation) | 0 | 8 | Empty |
| [`customer_profile`](#public-customer_profile) | 3,032 | 18 |  |
| [`daily_job_planning`](#public-daily_job_planning) | 0 | 11 | Empty |
| [`dealership`](#public-dealership) | 0 | 10 | Empty |
| [`department`](#public-department) | 0 | 12 | Empty |
| [`department_report`](#public-department_report) | 0 | 10 | Empty |
| [`dept_report_comment`](#public-dept_report_comment) | 0 | 9 | Empty |
| [`discovery_logs`](#public-discovery_logs) | 227 | 11 |  |
| [`documents`](#public-documents) | 7 | 7 |  |
| [`ee_calendar`](#public-ee_calendar) | 0 | 7 | Empty |
| [`ee_circular`](#public-ee_circular) | 0 | 13 | Empty |
| [`ega_carryover`](#public-ega_carryover) | 29 | 9 |  |
| [`epp_gateway`](#public-epp_gateway) | 12 | 10 |  |
| [`epp_option`](#public-epp_option) | 32 | 11 |  |
| [`eternalgy_agreement`](#public-eternalgy_agreement) | 1 | 15 |  |
| [`eternalgynotification`](#public-eternalgynotification) | 0 | 11 | Empty |
| [`financial_projection`](#public-financial_projection) | 0 | 9 | Empty |
| [`follow_up_notes`](#public-follow_up_notes) | 0 | 8 | Empty |
| [`generated_commission_report`](#public-generated_commission_report) | 4 | 14 |  |
| [`join_us_form`](#public-join_us_form) | 0 | 9 | Empty |
| [`news_links`](#public-news_links) | 19 | 11 |  |
| [`package_formula`](#public-package_formula) | 0 | 14 | Empty |
| [`package_item`](#public-package_item) | 2,320 | 13 | Components inside each package. |
| [`package_test`](#public-package_test) | 0 | 15 | Empty |
| [`pb_refunds`](#public-pb_refunds) | 1 | 9 |  |
| [`pending_schema_patches`](#public-pending_schema_patches) | 33 | 13 |  |
| [`processed_content`](#public-processed_content) | 15 | 14 |  |
| [`product`](#public-product) | 39 | 24 | Product catalogue (panels, inverters, batteries). |
| [`query_task_runs`](#public-query_task_runs) | 2 | 4 |  |
| [`query_tasks`](#public-query_tasks) | 2 | 11 |  |
| [`referal_contact`](#public-referal_contact) | 0 | 12 | Empty |
| [`referral_overrides`](#public-referral_overrides) | 23 | 10 |  |
| [`relationship_discovery_status`](#public-relationship_discovery_status) | 224 | 8 |  |
| [`rewriter_prompts`](#public-rewriter_prompts) | 0 | 4 | Empty |
| [`saving_report`](#public-saving_report) | 0 | 16 | Empty |
| [`submit_payment`](#public-submit_payment) | 0 | 16 | Empty |
| [`support_ticket`](#public-support_ticket) | 0 | 12 | Empty |
| [`system_logs`](#public-system_logs) | 27,966 | 8 |  |
| [`system_setting`](#public-system_setting) | 0 | 11 | Empty |
| [`tariff_b_d_database`](#public-tariff_b_d_database) | 0 | 13 | Empty |
| [`terminal`](#public-terminal) | 0 | 11 | Empty |
| [`tnb_bill_database`](#public-tnb_bill_database) | 5,117 | 25 |  |
| [`tnb_tariff_2025`](#public-tnb_tariff_2025) | 4,999 | 17 |  |
| [`users`](#public-users) | 1 | 5 |  |

## Column reference

Every table, in the same groups. `NN` = not null. Defaults are shortened.

### Installation app (created and written by this app)

<a id="public-installation_jobs"></a>
#### `public.installation_jobs`

451 rows. One row per customer installation. Install date, schedule, delivery, equipment and remarks. Linked to `invoice` by `source_invoice_id`.

Primary key: `id` · Unique: `source_invoice_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | text | NN |  |
| `source_invoice_id` | text | NN |  |
| `invoice_number` | text | NN |  |
| `customer_name` | text | NN |  |
| `installation_date` | date |  |  |
| `customer_availability_status` | text | NN | `'not_set'::text` |
| `preferred_installation_date` | date |  |  |
| `availability_remarks` | text | NN | `''::text` |
| `installation_approval_status` | text | NN | `'pending_approval_date'::text` |
| `schedule_status` | text | NN | `'ready_to_schedule'::text` |
| `delivery_status` | text | NN | `'not_planned'::text` |
| `delivery_date` | date |  |  |
| `arrival_date` | date |  |  |
| `stock_details` | text | NN | `''::text` |
| `delivery_contact_number` | text | NN | `''::text` |
| `warehouse_location` | text | NN | `''::text` |
| `panel_details` | text | NN | `''::text` |
| `wiring_details` | text | NN | `''::text` |
| `battery_details` | text | NN | `''::text` |
| `remarks` | text | NN | `''::text` |
| `payment_override_status` | text | NN | `'none'::text` |
| `payment_override_reason` | text | NN | `''::text` |
| `created_at` | timestamptz | NN | `now()` |
| `updated_at` | timestamptz | NN | `now()` |
| `arrival_time` | text |  |  |
| `installation_remarks` | text | NN | `''::text` |
| `second_preferred_installation_date` | date |  |  |
| `preferred_installation_time` | text |  |  |
| `inverter_battery` | text | NN | `''::text` |
| `power_output` | text | NN | `''::text` |

<a id="public-job_team_assignments"></a>
#### `public.job_team_assignments`

0 rows. Which team (roof, electrical, …) handles each installation job.

Primary key: `id` · Foreign keys: `installation_job_id` → `public.installation_jobs(id)`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | text | NN |  |
| `installation_job_id` | text | NN |  |
| `role` | text | NN |  |
| `team_name` | text | NN |  |
| `contact` | text |  |  |
| `activity` | text | NN | `'pv_panels'::text` |
| `custom_activity` | text |  |  |
| `created_at` | timestamptz | NN | `now()` |

<a id="public-job_status_history"></a>
#### `public.job_status_history`

254 rows. Log of status changes per installation job.

Primary key: `id` · Foreign keys: `installation_job_id` → `public.installation_jobs(id)`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN |  |
| `installation_job_id` | text | NN |  |
| `event_type` | text | NN |  |
| `event_data` | jsonb | NN | `'{}'::jsonb` |
| `created_at` | timestamptz | NN | `now()` |

<a id="public-installation_ops_state"></a>
#### `public.installation_ops_state`

1 rows. Single row of JSON: installation groups, delivery runs, team rosters, weekly team assignments, and a backup copy of per-job edits (`jobUpdates`).

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | text | NN |  |
| `state` | jsonb | NN | `'{}'::jsonb` |
| `updated_at` | timestamptz | NN | `now()` |

<a id="public-app_users"></a>
#### `public.app_users`

5 rows. Installation dashboard logins (username, role, password hash). Internal.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | text | NN |  |
| `username` | text | NN | `''::text` |
| `display_name` | text | NN | `''::text` |
| `password_hash` | text | NN | `''::text` |
| `role` | text | NN | `'staff'::text` |
| `is_active` | boolean | NN | `true` |
| `created_at` | timestamptz | NN | `now()` |
| `updated_at` | timestamptz | NN | `now()` |

<a id="public-app_sessions"></a>
#### `public.app_sessions`

32 rows. Signed-in sessions for the installation dashboard. Internal.

Primary key: `id` · Foreign keys: `user_id` → `public.app_users(id)`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | text | NN |  |
| `user_id` | text |  |  |
| `created_at` | timestamptz | NN | `now()` |
| `expires_at` | timestamptz | NN | `now()` |
| `last_seen_at` | timestamptz | NN | `now()` |

<a id="public-app_audit_log"></a>
#### `public.app_audit_log`

1,601 rows. Who changed what in the installation dashboard, and when. Internal.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN |  |
| `user_id` | text |  |  |
| `username` | text | NN | `'unknown'::text` |
| `action` | text | NN | `''::text` |
| `entity_type` | text | NN | `''::text` |
| `entity_id` | text |  |  |
| `summary` | text | NN | `''::text` |
| `details` | jsonb | NN | `'{}'::jsonb` |
| `created_at` | timestamptz | NN | `now()` |

### Business data synced from Bubble

<a id="public-agent"></a>
#### `public.agent`

200 rows. Sales agents, synced from Bubble.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('agent_id_seq'::regclass)` |
| `bubble_id` | text | NN |  |
| `last_synced_at` | timestamptz |  | `now()` |
| `created_at` | timestamptz |  | `now()` |
| `updated_at` | timestamptz |  | `now()` |
| `modified_date` | timestamptz |  |  |
| `linked_user_login` | text |  |  |
| `name` | text |  |  |
| `current_annual_sales` | integer |  |  |
| `contact` | text |  |  |
| `created_date` | timestamptz |  |  |
| `last_update_annual_sales` | timestamptz |  |  |
| `slug` | text |  |  |
| `agent_type` | text |  |  |
| `commission` | integer |  |  |
| `annual_collection` | integer |  |  |
| `intro_youtube` | text |  |  |
| `created_by` | text |  |  |
| `tree_seed` | text |  |  |
| `email` | text |  |  |
| `banker` | text |  |  |
| `bankin_account` | text |  |  |
| `introducer` | text |  |  |
| `ic_front` | text |  |  |
| `ic_back` | text |  |  |
| `address` | text |  |  |
| `creation_date` | text |  |  |
| `creator` | text |  |  |
| `group_member` | text |  |  |
| `group_name` | text |  |  |
| `unique_id` | text |  |  |
| `agent_code` | text |  |  |

<a id="public-customer"></a>
#### `public.customer`

7,516 rows. Customer master record, synced from Bubble.

Primary key: `id` · Unique: `customer_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('customer_id_seq'::regclass)` |
| `customer_id` | text | NN |  |
| `last_synced_at` | timestamptz |  | `now()` |
| `created_at` | timestamptz |  | `now()` |
| `updated_at` | timestamptz |  | `now()` |
| `name` | text |  |  |
| `phone` | text |  |  |
| `email` | text |  |  |
| `address` | text |  |  |
| `city` | text |  |  |
| `state` | text |  |  |
| `postcode` | text |  |  |
| `ic_number` | text |  |  |
| `linked_seda_registration` | text |  |  |
| `linked_old_customer` | text |  |  |
| `notes` | text |  |  |
| `created_by` | text |  |  |
| `version` | integer |  |  |
| `updated_by` | text |  |  |
| `profile_picture` | text |  |  |
| `lead_source` | text |  |  |
| `remark` | text |  |  |

<a id="public-invoice"></a>
#### `public.invoice`

8,344 rows. Main invoice table, synced from Bubble. 130 columns. `installation_date` / `installation_status` exist but are empty.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('invoice_id_seq'::regclass)` |
| `bubble_id` | text | NN |  |
| `last_synced_at` | timestamptz |  | `now()` |
| `created_at` | timestamptz |  | `now()` |
| `updated_at` | timestamptz |  | `now()` |
| `visit` | integer |  |  |
| `eligible_amount_description` | text |  |  |
| `linked_seda_registration` | text |  |  |
| `normal_commission` | numeric |  |  |
| `linked_agent` | text |  |  |
| `performance_tier_month` | integer |  |  |
| `full_payment_date` | timestamptz |  |  |
| `modified_date` | timestamptz |  |  |
| `need_approval` | boolean |  |  |
| `linked_package` | text |  |  |
| `locked_package` | boolean |  |  |
| `linked_customer` | text |  |  |
| `panel_qty` | integer |  |  |
| `dealercode` | text |  |  |
| `linked_agreement` | text |  |  |
| `performance_tier_year` | integer |  |  |
| `invoice_id` | integer |  |  |
| `type` | text |  |  |
| `last_payment_date` | timestamptz |  |  |
| `approval_status` | text |  |  |
| `1st_payment_date` | timestamptz |  |  |
| `commission_paid` | boolean |  |  |
| `paid` | boolean |  |  |
| `version` | integer |  |  |
| `amount_eligible_for_comm` | numeric |  |  |
| `2nd_payment` | integer |  |  |
| `created_by` | text |  |  |
| `linked_payment` | _text |  |  |
| `amount` | numeric |  |  |
| `invoice_date` | timestamptz |  |  |
| `1st_payment` | integer |  |  |
| `logs` | text |  |  |
| `linked_stock_transaction` | _text |  |  |
| `stamp_cash_price` | numeric |  |  |
| `percent_of_total_amount` | numeric |  |  |
| `created_date` | timestamptz |  |  |
| `stock_status_inv` | text |  |  |
| `linked_invoice_item` | _text |  |  |
| `perf_tier_commission` | integer |  |  |
| `linked_agent_monthly_perf` | text |  |  |
| `how_you_win` | text |  |  |
| `stock_status` | text |  |  |
| `customer_average_tnb` | numeric |  |  |
| `estimated_saving` | numeric |  |  |
| `linked_roof_image` | _text |  |  |
| `description` | text |  |  |
| `state` | text |  |  |
| `linked_notification` | _text |  |  |
| `linked_follow_up` | _text |  |  |
| `case_status` | text |  |  |
| `referrer_name` | text |  |  |
| `customer_signature` | text |  |  |
| `signature_date` | timestamptz |  |  |
| `estimated_new_bill_amount` | numeric |  |  |
| `effective_epp` | numeric |  |  |
| `lead_source` | text |  |  |
| `strategic_va` | numeric |  |  |
| `hide_payment_terms` | boolean |  |  |
| `premium_electrical_job` | boolean |  |  |
| `panel_rating` | integer |  |  |
| `custom_proposal` | text |  |  |
| `package_type` | text |  |  |
| `request_urgent_submission` | text |  |  |
| `linked_voucher` | _text |  |  |
| `approved_toberemove` | boolean |  |  |
| `user_manual_pdf` | text |  |  |
| `linked_payment_plan` | text |  |  |
| `linked_saving_report` | text |  |  |
| `linked_lead_from_customer` | _text |  |  |
| `achieved_monthly_anp` | numeric |  |  |
| `1st_payment__` | text |  |  |
| `2nd_payment__` | text |  |  |
| `stock_status__` | text |  |  |
| `invoice_number` | varchar |  |  |
| `status` | varchar |  |  |
| `is_latest` | boolean |  |  |
| `package_id` | varchar |  |  |
| `discount_percent` | numeric |  |  |
| `voucher_code` | text |  |  |
| `total_amount` | numeric |  |  |
| `paid_amount` | numeric |  |  |
| `balance_due` | numeric |  |  |
| `sent_at` | timestamptz |  |  |
| `viewed_at` | timestamptz |  |  |
| `paid_at` | timestamptz |  |  |
| `share_token` | varchar |  |  |
| `share_expires_at` | timestamptz |  |  |
| `share_enabled` | boolean |  |  |
| `package_name_snapshot` | text |  |  |
| `template_id` | varchar |  |  |
| `agent_markup` | numeric |  |  |
| `share_access_count` | integer |  |  |
| `root_id` | text |  |  |
| `parent_id` | text |  |  |
| `customer_notes` | text |  |  |
| `internal_notes` | text |  |  |
| `discount_fixed` | numeric |  |  |
| `linked_old_invoice` | varchar |  |  |
| `migration_status` | varchar |  |  |
| `customer_name_snapshot` | varchar |  |  |
| `customer_email_snapshot` | varchar |  |  |
| `customer_phone_snapshot` | varchar |  |  |
| `customer_address_snapshot` | text |  |  |
| `profile_picture_snapshot` | text |  |  |
| `pv_system_drawing` | _text |  |  |
| `follow_up_date` | timestamptz |  |  |
| `commission_finalized` | text |  |  |
| `creation_date` | text |  |  |
| `creator` | text |  |  |
| `final_comm_payment_amount` | text |  |  |
| `installation_date` | text |  |  |
| `installation_status` | text |  |  |
| `payment_method` | text |  |  |
| `reject_reason` | text |  |  |
| `remark_financne` | text |  |  |
| `special_comm` | text |  |  |
| `check_boxed` | text |  |  |
| `feedback` | text |  |  |
| `unique_id` | text |  |  |
| `is_deleted` | boolean |  |  |
| `deleted_at` | timestamptz |  |  |
| `solar_sun_peak_hour` | numeric |  |  |
| `solar_morning_usage_percent` | numeric |  |  |
| `linked_referral` | text |  |  |
| `site_assessment_image` | _text |  |  |

<a id="public-invoice_item"></a>
#### `public.invoice_item`

31,750 rows. Line items for `invoice` (package, panels, inverter, battery, add-ons).

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('invoice_item_id_seq'::regclass)` |
| `bubble_id` | text | NN |  |
| `last_synced_at` | timestamptz |  | `now()` |
| `created_at` | timestamptz |  | `now()` |
| `updated_at` | timestamptz |  | `now()` |
| `description` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `qty` | numeric |  |  |
| `amount` | numeric |  |  |
| `unit_price` | numeric |  |  |
| `created_by` | text |  |  |
| `created_date` | timestamptz |  |  |
| `is_a_package` | boolean |  |  |
| `inv_item_type` | text |  |  |
| `linked_package` | text |  |  |
| `epp` | numeric |  |  |
| `linked_invoice` | text |  |  |
| `sort` | numeric |  |  |
| `linked_voucher` | text |  |  |
| `voucher_remark` | text |  |  |
| `creation_date` | text |  |  |
| `creator` | text |  |  |
| `slug` | text |  |  |
| `unique_id` | text |  |  |
| `linked_product` | text |  |  |

<a id="public-invoice_payment_planning"></a>
#### `public.invoice_payment_planning`

0 rows. Payment plans per invoice (synced, currently empty).

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('invoice_payment_planning_id_…` |
| `bubble_id` | text |  |  |
| `linked_invoice` | text |  |  |
| `payment_method_3` | text |  |  |
| `payment_1_charges` | integer |  |  |
| `final_payment_amount___inclusive` | text |  |  |
| `created_by` | text |  |  |
| `epp_option_3` | text |  |  |
| `1st_payment_amount___inclusive` | text |  |  |
| `payment_2_epp_charges` | integer |  |  |
| `payment_3_epp_charges` | text |  |  |
| `2nd_payment_amount___inclusive` | text |  |  |
| `payment_method_1` | text |  |  |
| `epp_option_2` | text |  |  |
| `payment_method_2` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `created_date` | timestamptz |  |  |
| `synced_at` | timestamptz |  | `now()` |
| `epp_option_1` | text |  |  |
| `final_payment_amount_inclusive` | numeric |  |  |
| `2nd_payment_amount_inclusive` | numeric |  |  |
| `1st_payment_amount_inclusive` | numeric |  |  |

<a id="public-package"></a>
#### `public.package`

1,290 rows. Solar packages sold (panel/inverter combinations, pricing).

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('package_id_seq'::regclass)` |
| `bubble_id` | text | NN |  |
| `last_synced_at` | timestamptz |  | `now()` |
| `created_at` | timestamptz |  | `now()` |
| `updated_at` | timestamptz |  | `now()` |
| `linked_package_item` | _text |  |  |
| `name` | text |  |  |
| `created_date` | timestamptz |  |  |
| `price` | numeric |  |  |
| `panel` | text |  |  |
| `active` | boolean |  |  |
| `modified_date` | timestamptz |  |  |
| `need_approval` | boolean |  |  |
| `invoice_desc` | text |  |  |
| `panel_qty` | integer |  |  |
| `created_by` | text |  |  |
| `max_discount` | integer |  |  |
| `type` | text |  |  |
| `special` | boolean |  |  |
| `password` | text |  |  |
| `description` | text |  |  |
| `items` | json |  | `'[]'::json` |
| `package_name` | text |  |  |
| `creation_date` | text |  |  |
| `creator` | text |  |  |
| `slug` | text |  |  |
| `system_default` | text |  |  |
| `inverter_1` | text |  |  |
| `inverter_2` | text |  |  |
| `inverter_3` | text |  |  |
| `inverter_4` | text |  |  |
| `unique_id` | text |  |  |
| `nett_price` | numeric |  |  |

<a id="public-payment"></a>
#### `public.payment`

3,934 rows. Payments received against invoices, synced from Bubble.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('payment_id_seq'::regclass)` |
| `bubble_id` | text | NN |  |
| `last_synced_at` | timestamptz |  | `now()` |
| `created_at` | timestamptz |  | `now()` |
| `updated_at` | timestamptz |  | `now()` |
| `payment_method` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `amount` | numeric |  |  |
| `created_by` | text |  |  |
| `linked_agent` | text |  |  |
| `created_date` | timestamptz |  |  |
| `remark` | text |  |  |
| `payment_date` | timestamptz |  |  |
| `linked_invoice` | text |  |  |
| `linked_customer` | text |  |  |
| `payment_index` | numeric |  |  |
| `attachment` | _text |  |  |
| `verified_by` | text |  |  |
| `edit_history` | text |  |  |
| `issuer_bank` | text |  |  |
| `epp_month` | numeric |  |  |
| `payment_method_v2` | text |  |  |
| `terminal` | text |  |  |
| `bank_charges` | numeric |  |  |
| `epp_type` | text |  |  |
| `creation_date` | text |  |  |
| `creator` | text |  |  |
| `referrer` | text |  |  |
| `actual_received` | text |  |  |
| `unique_id` | text |  |  |
| `log` | text |  |  |
| `epp_cost` | numeric |  |  |

<a id="public-referral"></a>
#### `public.referral`

353 rows. Customer referrals, synced from Bubble.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN |  |
| `bubble_id` | varchar |  |  |
| `linked_customer_profile` | varchar |  |  |
| `name` | varchar |  |  |
| `relationship` | varchar |  |  |
| `mobile_number` | varchar |  |  |
| `status` | varchar |  |  |
| `created_at` | timestamptz |  |  |
| `updated_at` | timestamptz |  |  |
| `linked_agent` | varchar |  |  |
| `deal_value` | numeric |  |  |
| `commission_earned` | numeric |  |  |
| `linked_invoice` | varchar |  |  |
| `project_type` | varchar |  |  |
| `deleted_at` | timestamptz |  |  |
| `deleted_by` | varchar |  |  |

<a id="public-seda_registration"></a>
#### `public.seda_registration`

11,721 rows. SEDA (NEM) registration records per customer/invoice. 116 columns.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('seda_registration_id_seq'::r…` |
| `bubble_id` | text | NN |  |
| `last_synced_at` | timestamptz |  | `now()` |
| `created_at` | timestamptz |  | `now()` |
| `updated_at` | timestamptz |  | `now()` |
| `reg_status` | text |  |  |
| `created_by` | text |  |  |
| `drawing_system_submitted` | boolean |  |  |
| `modified_date` | timestamptz |  |  |
| `state` | text |  |  |
| `redex_status` | text |  |  |
| `roof_images` | _text |  |  |
| `sunpeak_hours` | numeric |  |  |
| `system_size_in_form_kwp` | numeric |  |  |
| `created_date` | timestamptz |  |  |
| `agent` | text |  |  |
| `project_price` | numeric |  |  |
| `system_size` | numeric |  |  |
| `city` | text |  |  |
| `linked_customer` | text |  |  |
| `inverter_kwac` | numeric |  |  |
| `slug` | text |  |  |
| `estimated_monthly_saving` | numeric |  |  |
| `average_tnb` | numeric |  |  |
| `price_category` | text |  |  |
| `g_electric_folder_link` | text |  |  |
| `g_roof_folder_link` | text |  |  |
| `installation_address` | text |  |  |
| `linked_invoice` | _text |  |  |
| `customer_signature` | text |  |  |
| `email` | text |  |  |
| `ic_copy_back` | text |  |  |
| `ic_copy_front` | text |  |  |
| `tnb_bill_3` | text |  |  |
| `tnb_bill_1` | text |  |  |
| `tnb_meter` | text |  |  |
| `e_contact_no` | text |  |  |
| `tnb_bill_2` | text |  |  |
| `drawing_pdf_system` | _text |  |  |
| `e_contact_name` | text |  |  |
| `seda_status` | text |  |  |
| `version` | integer |  |  |
| `nem_application_no` | text |  |  |
| `e_contact_relationship` | text |  |  |
| `ic_no` | text |  |  |
| `request_drawing_date` | timestamptz |  |  |
| `phase_type` | text |  |  |
| `special_remark` | text |  |  |
| `tnb_account_no` | text |  |  |
| `nem_cert` | text |  |  |
| `property_ownership_prove` | text |  |  |
| `inverter_serial_no` | text |  |  |
| `tnb_meter_install_date` | timestamptz |  |  |
| `tnb_meter_status` | text |  |  |
| `first_completion_date` | timestamptz |  |  |
| `e_contact_mykad` | text |  |  |
| `mykad_pdf` | text |  |  |
| `nem_type` | text |  |  |
| `e_email` | text |  |  |
| `redex_remark` | text |  |  |
| `site_images` | _text |  |  |
| `company_registration_no` | text |  |  |
| `drawing_system_actual` | _text |  |  |
| `check_tnb_bill_and_meter_image` | boolean |  |  |
| `check_mykad` | boolean |  |  |
| `check_ownership` | boolean |  |  |
| `check_fill_in_detail` | boolean |  |  |
| `drawing_engineering_seda_pdf` | _text |  |  |
| `mapper_status` | text |  |  |
| `postcode` | text |  |  |
| `share_token` | varchar |  |  |
| `share_enabled` | boolean |  |  |
| `share_expires_at` | timestamp |  |  |
| `1st_generation` | text |  |  |
| `creation_date` | text |  |  |
| `creator` | text |  |  |
| `drawing_engineer_seda_done` | text |  |  |
| `epcc` | text |  |  |
| `epcc_remark` | text |  |  |
| `g_folder_seda_doc` | text |  |  |
| `house_ownership_doc_type` | text |  |  |
| `house_ownership_image` | text |  |  |
| `if_counter_date` | text |  |  |
| `installation_appointment` | text |  |  |
| `installment_tenure` | text |  |  |
| `inverter` | text |  |  |
| `link_appointment` | text |  |  |
| `overwrite_redex_date` | text |  |  |
| `seda_application_fee` | text |  |  |
| `tnb_status` | text |  |  |
| `chat_deleted` | text |  |  |
| `unique_id` | text |  |  |
| `seda_profile_status` | text |  |  |
| `seda_profile_id` | text |  |  |
| `seda_profile_checked_at` | timestamptz |  |  |
| `installation_address_1` | text |  |  |
| `installation_address_2` | text |  |  |
| `latitude` | numeric |  |  |
| `longitude` | numeric |  |  |
| `applicant_name` | text |  |  |
| `applicant_ic` | text |  |  |
| `applicant_phone` | text |  |  |
| `applicant_email` | text |  |  |
| `applicant_tin` | text |  |  |
| `tax_document` | varchar |  |  |
| `application_type` | text |  |  |
| `tnb_bills_12_months` | _text |  |  |
| `tnb_bills_12_months_requested_at` | timestamptz |  |  |
| `tnb_bills_12_months_note` | text |  |  |
| `ssm_form_9` | text |  |  |
| `ssm_form_49` | text |  |  |
| `director_ic_front` | text |  |  |
| `director_ic_back` | text |  |  |
| `commercial_docs_completed` | boolean |  |  |
| `ssm_registration` | text |  |  |
| `company_stamp` | text |  |  |

<a id="public-user"></a>
#### `public.user`

217 rows. Bubble user accounts (staff and agents), synced from Bubble.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('user_id_seq'::regclass)` |
| `bubble_id` | text | NN |  |
| `last_synced_at` | timestamptz |  | `now()` |
| `created_at` | timestamptz |  | `now()` |
| `updated_at` | timestamptz |  | `now()` |
| `check_in_report_today` | text |  |  |
| `dealership` | text |  |  |
| `created_date` | timestamptz |  |  |
| `linked_agent_profile` | text |  |  |
| `authentication` | text |  |  |
| `access_level` | _text |  |  |
| `user_signed_up` | boolean |  |  |
| `profile_picture` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `agent_code` | text |  |  |
| `email` | text |  |  |
| `creation_date` | text |  |  |
| `slug` | text |  |  |
| `null` | text |  |  |
| `unique_id` | text |  |  |
| `main_department` | text |  |  |
| `support_department` | text |  |  |
| `name` | text |  |  |
| `contact` | text |  |  |
| `ic_front` | text |  |  |
| `ic_back` | text |  |  |
| `address` | text |  |  |
| `introducer` | text |  |  |
| `bankin_account` | text |  |  |
| `banker` | text |  |  |
| `outsource_role` | text |  |  |
| `outsource_parent_user_id` | integer |  |  |
| `outsource_notes` | text |  |  |
| `offer_letter` | text |  |  |
| `employment_letter` | text |  |  |
| `user_signature` | text |  |  |
| `agent_type` | text |  |  |

<a id="public-voucher"></a>
#### `public.voucher`

69 rows. Discount vouchers, synced from Bubble.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('voucher_id_seq'::regclass)` |
| `bubble_id` | text | NN |  |
| `last_synced_at` | timestamptz |  | `now()` |
| `created_at` | timestamptz |  | `now()` |
| `updated_at` | timestamptz |  | `now()` |
| `title` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `invoice_description` | text |  |  |
| `discount_amount` | numeric |  |  |
| `created_by` | text |  |  |
| `voucher_code` | text |  |  |
| `created_date` | timestamptz |  |  |
| `terms_conditions` | text |  |  |
| `active` | boolean |  |  |
| `auto_cancel_voucher` | _text |  |  |
| `voucher_availability` | integer |  |  |
| `voucher_type` | text |  |  |
| `discount_percent` | integer |  |  |
| `deductable_from_commission` | integer |  |  |
| `available_until` | text |  |  |
| `delete` | boolean |  |  |
| `public` | boolean |  |  |
| `linked_voucher_category` | text |  |  |
| `access_tag` | text |  |  |
| `allowed_users` | _text |  |  |
| `bypass_max_discount` | boolean |  |  |
| `available_package_types` | _text |  |  |

### New invoicing system

<a id="public-invoice_new"></a>
#### `public.invoice_new`

33 rows. Invoices from the newer in-house invoicing flow (33 rows). Separate from `invoice`.

Primary key: `id` · Foreign keys: `created_by` → `public.auth_user(user_id)`; `customer_id` → `public.customer(id)`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('invoice_new_id_seq'::regclass)` |
| `bubble_id` | varchar | NN |  |
| `template_id` | varchar |  |  |
| `customer_id` | integer |  |  |
| `customer_name_snapshot` | varchar | NN |  |
| `customer_address_snapshot` | text |  |  |
| `customer_phone_snapshot` | varchar |  |  |
| `customer_email_snapshot` | varchar |  |  |
| `agent_id` | varchar |  |  |
| `agent_name_snapshot` | varchar |  |  |
| `package_id` | varchar |  |  |
| `package_name_snapshot` | varchar |  |  |
| `invoice_number` | varchar | NN |  |
| `invoice_date` | varchar | NN |  |
| `due_date` | varchar |  |  |
| `subtotal` | numeric | NN |  |
| `sst_rate` | numeric |  |  |
| `sst_amount` | numeric | NN |  |
| `discount_amount` | numeric | NN |  |
| `discount_percent` | numeric |  |  |
| `voucher_code` | varchar |  |  |
| `voucher_amount` | numeric |  |  |
| `total_amount` | numeric | NN |  |
| `status` | varchar |  |  |
| `paid_amount` | numeric |  |  |
| `internal_notes` | text |  |  |
| `customer_notes` | text |  |  |
| `share_token` | varchar |  |  |
| `share_enabled` | boolean |  |  |
| `share_expires_at` | timestamptz |  |  |
| `share_access_count` | integer |  |  |
| `linked_old_invoice` | varchar |  |  |
| `migration_status` | varchar |  |  |
| `created_by` | varchar |  |  |
| `created_at` | timestamptz |  | `now()` |
| `updated_at` | timestamptz |  | `now()` |
| `sent_at` | timestamptz |  |  |
| `viewed_at` | timestamptz |  |  |
| `paid_at` | timestamptz |  |  |
| `agent_markup` | numeric |  | `0` |
| `discount_fixed` | numeric |  | `0` |

<a id="public-invoice_new_item"></a>
#### `public.invoice_new_item`

33 rows. Line items for `invoice_new`.

Primary key: `id` · Foreign keys: `invoice_id` → `public.invoice_new(bubble_id)`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('invoice_new_item_id_seq'::re…` |
| `bubble_id` | varchar | NN |  |
| `invoice_id` | varchar |  |  |
| `product_id` | varchar |  |  |
| `product_name_snapshot` | varchar |  |  |
| `description` | text | NN |  |
| `qty` | numeric | NN |  |
| `unit_price` | numeric | NN |  |
| `discount_percent` | numeric |  |  |
| `total_price` | numeric | NN |  |
| `sort_order` | integer |  |  |
| `created_at` | timestamptz |  | `now()` |
| `item_type` | varchar |  | `'package'::character varying` |

<a id="public-invoice_payment_new"></a>
#### `public.invoice_payment_new`

0 rows. Payments for `invoice_new` (empty).

Primary key: `id` · Foreign keys: `created_by` → `public.auth_user(user_id)`; `invoice_id` → `public.invoice_new(bubble_id)`; `verified_by` → `public.auth_user(user_id)`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('invoice_payment_new_id_seq':…` |
| `bubble_id` | varchar | NN |  |
| `invoice_id` | varchar |  |  |
| `amount` | numeric | NN |  |
| `payment_method` | varchar |  |  |
| `payment_date` | varchar | NN |  |
| `reference_no` | varchar |  |  |
| `bank_name` | varchar |  |  |
| `notes` | text |  |  |
| `status` | varchar |  |  |
| `verified_by` | varchar |  |  |
| `verified_at` | timestamptz |  |  |
| `attachment_urls` | _varchar |  |  |
| `created_by` | varchar |  |  |
| `created_at` | timestamptz |  | `now()` |

<a id="public-invoice_template"></a>
#### `public.invoice_template`

3 rows. Templates for `invoice_new`.

Primary key: `id` · Foreign keys: `created_by` → `public.auth_user(user_id)`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('invoice_template_id_seq'::re…` |
| `bubble_id` | varchar | NN |  |
| `template_name` | varchar | NN |  |
| `company_name` | varchar | NN |  |
| `company_address` | text | NN |  |
| `company_phone` | varchar |  |  |
| `company_email` | varchar |  |  |
| `sst_registration_no` | varchar |  |  |
| `bank_name` | varchar |  |  |
| `bank_account_no` | varchar |  |  |
| `bank_account_name` | varchar |  |  |
| `logo_url` | varchar |  |  |
| `terms_and_conditions` | text |  |  |
| `active` | boolean |  |  |
| `is_default` | boolean |  |  |
| `created_by` | varchar |  |  |
| `created_at` | timestamptz |  | `now()` |
| `updated_at` | timestamptz |  | `now()` |
| `disclaimer` | text |  |  |
| `apply_sst` | boolean |  | `false` |

### Sync bookkeeping

<a id="public-sync_state"></a>
#### `public.sync_state`

11 rows. Last Bubble → NUrul_DB sync time and row count per table.

Primary key: `table_name`

| Column | Type | Null | Default |
|---|---|---|---|
| `table_name` | text | NN |  |
| `row_count` | bigint |  |  |
| `synced_at` | timestamptz |  |  |
| `ok` | boolean |  |  |
| `error` | text |  |  |

<a id="public-sync_cursors"></a>
#### `public.sync_cursors`

11 rows. Older incremental-sync cursors (last used 2025).

Primary key: `id` · Unique: `table_name`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('sync_cursors_id_seq'::regclass)` |
| `table_name` | text | NN |  |
| `last_cursor` | integer | NN | `0` |
| `last_sync_at` | timestamp | NN | `now()` |
| `sync_run_id` | text |  |  |
| `created_at` | timestamp | NN | `now()` |
| `updated_at` | timestamp | NN | `now()` |

<a id="public-sync_status"></a>
#### `public.sync_status`

0 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | text | NN |  |
| `running` | boolean | NN | `false` |
| `progress` | integer | NN | `0` |
| `currentTable` | text |  |  |
| `lastSync` | timestamp |  |  |
| `error` | text |  |  |
| `createdAt` | timestamp | NN | `CURRENT_TIMESTAMP` |
| `updatedAt` | timestamp | NN |  |

<a id="public-synced_records"></a>
#### `public.synced_records`

0 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | text | NN |  |
| `bubble_id` | text | NN |  |
| `data_type` | text | NN |  |
| `raw_data` | jsonb | NN |  |
| `processed_data` | jsonb |  |  |
| `synced_at` | timestamp | NN | `CURRENT_TIMESTAMP` |
| `updated_at` | timestamp | NN |  |

### `dashboard` schema (commission / agent dashboard)

<a id="dashboard-agent_roles"></a>
#### `dashboard.agent_roles`

110 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN |  |
| `effective_from` | text | NN |  |
| `agent` | text | NN |  |
| `agent_type` | text |  |  |
| `hierarchy` | text |  |  |
| `reports_to` | text |  |  |
| `branch` | text |  |  |
| `remarks` | text |  |  |
| `start_date` | text |  |  |
| `ic_no` | text |  |  |
| `nick_name` | text |  |  |
| `full_name` | text |  |  |
| `pg_bubble_id` | text |  |  |
| `hidden` | integer |  |  |
| `created_by` | text |  |  |
| `created_at` | text | NN |  |
| `updated_by` | text |  |  |
| `updated_at` | text | NN |  |

<a id="dashboard-anp_rules"></a>
#### `dashboard.anp_rules`

2 rows.

Primary key: `id` · Unique: `effective_from`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN |  |
| `effective_from` | text | NN |  |
| `min_paid` | text |  |  |
| `excluded_payment_ids` | text |  |  |
| `invoice_overrides` | text |  |  |
| `created_by` | text |  |  |
| `created_at` | text | NN |  |
| `updated_by` | text |  |  |
| `updated_at` | text | NN |  |

<a id="dashboard-anp_tiers"></a>
#### `dashboard.anp_tiers`

10 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN |  |
| `effective_from` | text | NN |  |
| `from_amount` | text |  |  |
| `to_amount` | text |  |  |
| `commission_rm` | text |  |  |
| `created_by` | text |  |  |
| `created_at` | text | NN |  |
| `updated_by` | text |  |  |
| `updated_at` | text | NN |  |

<a id="dashboard-audit_log"></a>
#### `dashboard.audit_log`

669 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN |  |
| `user_id` | integer |  |  |
| `username` | text | NN |  |
| `action` | text | NN |  |
| `entity_type` | text | NN |  |
| `entity_summary` | text |  |  |
| `before_json` | text |  |  |
| `after_json` | text |  |  |
| `created_at` | text | NN |  |

<a id="dashboard-basic_rates"></a>
#### `dashboard.basic_rates`

0 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN |  |
| `rate_type` | text | NN | `'Basic Commission'::text` |
| `agent_type` | text | NN |  |
| `hierarchy` | text | NN |  |
| `agent` | text |  |  |
| `rate_pct` | text | NN |  |
| `effective_from` | text | NN |  |
| `remarks` | text |  |  |
| `condition` | text |  |  |
| `created_by` | text |  |  |
| `created_at` | text | NN |  |
| `updated_by` | text |  |  |
| `updated_at` | text | NN |  |

<a id="dashboard-commission_entries"></a>
#### `dashboard.commission_entries`

0 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NN | `gen_random_uuid()` |
| `invoice_bubble_id` | text | NN |  |
| `entry_type` | text | NN |  |
| `adjusted_sales_price` | numeric |  |  |
| `net_floor_price` | numeric |  |  |
| `fee_waiver` | numeric |  |  |
| `rate_pct` | numeric |  |  |
| `profit_sharing_pct` | numeric |  |  |
| `remarks` | text |  |  |
| `created_by` | uuid | NN |  |
| `created_by_name` | text | NN |  |
| `updated_by` | uuid |  |  |
| `updated_by_name` | text |  |  |
| `created_at` | timestamptz | NN | `now()` |
| `updated_at` | timestamptz | NN | `now()` |

<a id="dashboard-commission_rates"></a>
#### `dashboard.commission_rates`

47 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN |  |
| `rate_type` | text | NN | `'Basic Commission'::text` |
| `agent_type` | text |  |  |
| `hierarchy` | text |  |  |
| `agent` | text |  |  |
| `label` | text |  |  |
| `rate_pct` | text |  |  |
| `override_rate_pct` | text |  |  |
| `override_from` | text |  |  |
| `profit_sharing_rate_pct` | text |  |  |
| `profit_sharing_mode` | text |  |  |
| `property_type` | text |  |  |
| `trigger_pct` | text |  |  |
| `invoice_date_from` | text |  |  |
| `rule_type` | text |  |  |
| `amount_rm` | text |  |  |
| `condition` | text |  |  |
| `effective_from` | text | NN |  |
| `remarks` | text |  |  |
| `created_by` | text |  |  |
| `created_at` | text | NN |  |
| `updated_by` | text |  |  |
| `updated_at` | text | NN |  |
| `job_type` | text |  |  |
| `ev_type` | text |  |  |

<a id="dashboard-contest_roster"></a>
#### `dashboard.contest_roster`

47 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN |  |
| `month` | text | NN |  |
| `team` | text | NN |  |
| `agent` | text | NN |  |
| `created_by` | text |  |  |
| `created_at` | text | NN |  |
| `updated_by` | text |  |  |
| `updated_at` | text | NN |  |
| `sales_prices` | text |  |  |

<a id="dashboard-contest_rules"></a>
#### `dashboard.contest_rules`

3 rows.

Primary key: `id` · Unique: `month`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN |  |
| `month` | text | NN |  |
| `full_rate_cap` | text |  |  |
| `above_cap_pct` | text |  |  |
| `activity_bonus_enabled` | integer |  |  |
| `activity_bonus_points` | text |  |  |
| `target_bonus_points` | text |  |  |
| `rank1_award` | text |  |  |
| `rank2_award` | text |  |  |
| `rank3_award` | text |  |  |
| `achievement_bonus` | text |  |  |
| `gb1_award` | text |  |  |
| `gb2_award` | text |  |  |
| `gb3_award` | text |  |  |
| `gb_min_cases` | text |  |  |
| `gb_min_sales` | text |  |  |
| `fast_start_gift` | text |  |  |
| `fast_start_slots` | text |  |  |
| `fast_start_unpaid` | text |  |  |
| `created_by` | text |  |  |
| `created_at` | text | NN |  |
| `updated_by` | text |  |  |
| `updated_at` | text | NN |  |

<a id="dashboard-contest_team_month"></a>
#### `dashboard.contest_team_month`

18 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN |  |
| `month` | text | NN |  |
| `team` | text | NN |  |
| `branch` | text |  |  |
| `captain` | text |  |  |
| `original_target` | text |  |  |
| `handicap` | text |  |  |
| `created_by` | text |  |  |
| `created_at` | text | NN |  |
| `updated_by` | text |  |  |
| `updated_at` | text | NN |  |

<a id="dashboard-ega_month_thresholds"></a>
#### `dashboard.ega_month_thresholds`

14 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN |  |
| `year` | text | NN |  |
| `month` | integer | NN |  |
| `ep_threshold` | text |  |  |
| `label` | text |  |  |
| `created_by` | text |  |  |
| `created_at` | text | NN |  |
| `updated_by` | text |  |  |
| `updated_at` | text | NN |  |
| `agent_type` | text | NN | `'internal'::text` |

<a id="dashboard-ega_rules"></a>
#### `dashboard.ega_rules`

2 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN |  |
| `year` | text | NN |  |
| `ega_threshold` | text |  |  |
| `esa_threshold` | text |  |  |
| `factory_from` | text |  |  |
| `factory_first_block` | text |  |  |
| `factory_balance_rate` | text |  |  |
| `factory_min_panels` | text |  |  |
| `created_by` | text |  |  |
| `created_at` | text | NN |  |
| `updated_by` | text |  |  |
| `updated_at` | text | NN |  |
| `agent_type` | text | NN | `'internal'::text` |

<a id="dashboard-factory_rates"></a>
#### `dashboard.factory_rates`

4 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN |  |
| `year` | text | NN |  |
| `month` | text | NN |  |
| `agent_type` | text | NN |  |
| `data_json` | text | NN |  |
| `created_by` | text |  |  |
| `created_at` | text | NN |  |
| `updated_by` | text |  |  |
| `updated_at` | text | NN |  |

<a id="dashboard-invoices"></a>
#### `dashboard.invoices`

5,964 rows. Invoice snapshot used by the commission dashboard.

Primary key: `invoice_bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `invoice_bubble_id` | text | NN |  |
| `invoice_number` | text |  |  |
| `agent_bubble_id` | text | NN |  |
| `agent_name` | text |  |  |
| `agent_type` | text |  |  |
| `customer_name` | text |  |  |
| `invoice_date` | date |  |  |
| `first_payment_date` | date |  |  |
| `full_payment_date` | date |  |  |
| `pct5_date` | date |  |  |
| `pct75_date` | date |  |  |
| `pct100_date` | date |  |  |
| `total_amount` | numeric |  |  |
| `paid_amount` | numeric |  |  |
| `epp_interest` | numeric |  |  |
| `package_type` | text |  |  |
| `package_name_snapshot` | text |  |  |
| `description` | text |  |  |
| `seda_nem_type` | text |  |  |
| `referral_project_type` | text |  |  |
| `referral_name` | text |  |  |
| `synced_at` | timestamptz | NN | `now()` |

<a id="dashboard-login_log"></a>
#### `dashboard.login_log`

158 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN |  |
| `user_id` | integer |  |  |
| `username` | text | NN |  |
| `role` | text |  |  |
| `host` | text |  |  |
| `ip_address` | text |  |  |
| `user_agent` | text |  |  |
| `created_at` | text | NN |  |

<a id="dashboard-nfp_prices"></a>
#### `dashboard.nfp_prices`

896 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN |  |
| `month` | text | NN |  |
| `panel_rating` | integer | NN |  |
| `table_no` | integer | NN | `1` |
| `panels` | integer | NN |  |
| `final_price` | numeric | NN |  |
| `final_with_tng` | numeric |  |  |
| `source_sheet` | text |  |  |
| `package_price` | numeric |  |  |
| `tng_rebate` | numeric |  |  |
| `inverter_type` | text |  | `'string'::text` |
| `power_system` | text |  |  |
| `columns_json` | text |  |  |
| `created_by` | text |  |  |
| `created_at` | text | NN |  |
| `updated_by` | text |  |  |
| `updated_at` | text | NN |  |

<a id="dashboard-portal_staff"></a>
#### `dashboard.portal_staff`

1 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NN |  |
| `full_name` | text | NN |  |
| `role` | text | NN |  |
| `is_active` | boolean | NN | `true` |
| `created_at` | timestamptz | NN | `now()` |

<a id="dashboard-production_bonus_rules"></a>
#### `dashboard.production_bonus_rules`

2 rows.

Primary key: `id` · Unique: `effective_from`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN |  |
| `effective_from` | text | NN |  |
| `min_paid` | text |  |  |
| `property_types` | text |  |  |
| `oum_team_target` | text |  |  |
| `oum_personal_target` | text |  |  |
| `oum_rate_pct` | text |  |  |
| `ogm_team_target` | text |  |  |
| `ogm_osa_rate_pct` | text |  |  |
| `ogm_oum_rate_pct` | text |  |  |
| `stage1_pct` | text |  |  |
| `stage2_pct` | text |  |  |
| `stage3_pct` | text |  |  |
| `created_by` | text |  |  |
| `created_at` | text | NN |  |
| `updated_by` | text |  |  |
| `updated_at` | text | NN |  |

<a id="dashboard-rule_settings"></a>
#### `dashboard.rule_settings`

0 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN |  |
| `rule_key` | text | NN |  |
| `label` | text |  |  |
| `value` | text | NN |  |
| `effective_from` | text | NN |  |
| `remarks` | text |  |  |
| `rule_type` | text |  |  |
| `trigger_pct` | text |  |  |
| `agent_type` | text |  |  |
| `hierarchy` | text |  |  |
| `agent` | text |  |  |
| `property_type` | text |  |  |
| `invoice_date_from` | text |  |  |
| `created_by` | text |  |  |
| `created_at` | text | NN |  |
| `updated_by` | text |  |  |
| `updated_at` | text | NN |  |

<a id="dashboard-special_cases"></a>
#### `dashboard.special_cases`

59 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN |  |
| `year` | text | NN |  |
| `month` | text | NN |  |
| `agent_type` | text | NN |  |
| `data_json` | text | NN |  |
| `created_by` | text |  |  |
| `created_at` | text | NN |  |
| `updated_by` | text |  |  |
| `updated_at` | text | NN |  |

<a id="dashboard-users"></a>
#### `dashboard.users`

12 rows.

Primary key: `id` · Unique: `username`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN |  |
| `username` | text | NN |  |
| `password_hash` | text | NN |  |
| `role` | text | NN |  |
| `is_active` | integer | NN | `1` |
| `created_at` | text | NN |  |

### `eter_agent` and `notification` schemas

<a id="eter_agent-agents"></a>
#### `eter_agent.agents`

2 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | text | NN |  |
| `name` | text | NN |  |
| `workspace` | text | NN |  |
| `role_path` | text | NN |  |
| `state` | text | NN | `'idle'::text` |

<a id="eter_agent-messages"></a>
#### `eter_agent.messages`

15 rows.

Primary key: `id` · Foreign keys: `agent_id` → `eter_agent.agents(id)`; `session_id` → `eter_agent.sessions(id)`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('eter_agent.messages_id_seq':…` |
| `agent_id` | text | NN |  |
| `session_id` | integer | NN |  |
| `kind` | text | NN |  |
| `body` | text | NN |  |
| `detail` | jsonb |  |  |
| `created_at` | timestamptz | NN | `now()` |

<a id="eter_agent-sessions"></a>
#### `eter_agent.sessions`

3 rows.

Primary key: `id` · Foreign keys: `agent_id` → `eter_agent.agents(id)`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('eter_agent.sessions_id_seq':…` |
| `agent_id` | text | NN |  |
| `cline_task_id` | text |  |  |
| `state` | text | NN | `'working'::text` |
| `started_at` | timestamptz | NN | `now()` |
| `ended_at` | timestamptz |  |  |

<a id="notification-delivery_log"></a>
#### `notification.delivery_log`

6 rows.

Primary key: `id` · Foreign keys: `notification_id` → `notification.notification_log(id)`; `subscription_id` → `notification.subscriptions(id)`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN | `nextval('notification.delivery_log_id…` |
| `notification_id` | bigint | NN |  |
| `subscription_id` | bigint | NN |  |
| `status` | text | NN |  |
| `provider_status` | integer |  |  |
| `attempted_at` | timestamptz | NN | `now()` |

<a id="notification-notification_log"></a>
#### `notification.notification_log`

6 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN | `nextval('notification.notification_lo…` |
| `kind` | text | NN |  |
| `title` | text | NN |  |
| `body` | text | NN |  |
| `created_at` | timestamptz | NN | `now()` |
| `sent_count` | integer | NN | `0` |
| `failed_count` | integer | NN | `0` |
| `requested_by` | text |  |  |

<a id="notification-subscriptions"></a>
#### `notification.subscriptions`

1 rows.

Primary key: `id` · Unique: `endpoint`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN | `nextval('notification.subscriptions_i…` |
| `endpoint` | text | NN |  |
| `p256dh` | text | NN |  |
| `auth` | text | NN |  |
| `created_at` | timestamptz | NN | `now()` |
| `updated_at` | timestamptz | NN | `now()` |
| `last_success_at` | timestamptz |  |  |
| `disabled_at` | timestamptz |  |  |

### Other `public` tables

<a id="public-_admin_backup_logs"></a>
#### `public._admin_backup_logs`

9 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('_admin_backup_logs_id_seq'::…` |
| `timestamp` | timestamp |  | `CURRENT_TIMESTAMP` |
| `status` | varchar |  |  |
| `filename` | varchar |  |  |
| `size_bytes` | bigint |  |  |
| `message` | text |  |  |

<a id="public-agent_content"></a>
#### `public.agent_content`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('agent_content_id_seq'::regcl…` |
| `bubble_id` | text |  |  |
| `created_date` | timestamptz |  |  |
| `google_drive_link` | text |  |  |
| `active` | boolean |  |  |
| `linked_category` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `title` | text |  |  |
| `type` | text |  |  |
| `created_by` | text |  |  |
| `synced_at` | timestamptz |  | `now()` |

<a id="public-agent_daily_report"></a>
#### `public.agent_daily_report`

3,204 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('agent_daily_report_id_seq'::…` |
| `bubble_id` | text | NN |  |
| `last_synced_at` | timestamptz |  | `now()` |
| `created_at` | timestamptz |  | `now()` |
| `updated_at` | timestamptz |  | `now()` |
| `activity_type` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `linked_user` | text |  |  |
| `linked_customer` | text |  |  |
| `report_point` | integer |  |  |
| `created_date` | timestamptz |  |  |
| `tag` | _text |  |  |
| `report_date` | timestamptz |  |  |
| `created_by` | text |  |  |
| `remark` | text |  |  |

<a id="public-agent_monthly_commission"></a>
#### `public.agent_monthly_commission`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('agent_monthly_commission_id_…` |
| `bubble_id` | text |  |  |
| `linked_invoice` | _text |  |  |
| `created_by` | text |  |  |
| `linked_agent` | text |  |  |
| `record_month` | timestamptz |  |  |
| `total_bonus_comm` | integer |  |  |
| `total_normal_comm` | text |  |  |
| `created_date` | timestamptz |  |  |
| `modified_date` | timestamptz |  |  |
| `synced_at` | timestamptz |  | `now()` |

<a id="public-agent_monthly_perf"></a>
#### `public.agent_monthly_perf`

604 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('agent_monthly_perf_id_seq'::…` |
| `bubble_id` | text | NN |  |
| `last_synced_at` | timestamptz |  | `now()` |
| `created_at` | timestamptz |  | `now()` |
| `updated_at` | timestamptz |  | `now()` |
| `total_amount` | numeric |  |  |
| `created_date` | timestamptz |  |  |
| `record_month` | text |  |  |
| `linked_user` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `linked_invoice` | _text |  |  |
| `created_by` | text |  |  |
| `all_full_on_date` | timestamptz |  |  |
| `achieved_tier_bonus` | numeric |  |  |

<a id="public-ai_contact"></a>
#### `public.ai_contact`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('ai_contact_id_seq'::regclass)` |
| `bubble_id` | text |  |  |
| `whatsapp_no_` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `created_date` | timestamptz |  |  |
| `name` | text |  |  |
| `created_by` | text |  |  |
| `synced_at` | timestamptz |  | `now()` |
| `whatsapp_no` | text |  |  |

<a id="public-ai_profile"></a>
#### `public.ai_profile`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('ai_profile_id_seq'::regclass)` |
| `bubble_id` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `created_by` | text |  |  |
| `name` | text |  |  |
| `user_instruction` | text |  |  |
| `created_date` | timestamptz |  |  |
| `synced_at` | timestamptz |  | `now()` |

<a id="public-alembic_version"></a>
#### `public.alembic_version`

1 rows.

Primary key: `version_num`

| Column | Type | Null | Default |
|---|---|---|---|
| `version_num` | varchar | NN |  |

<a id="public-api_key"></a>
#### `public.api_key`

1 rows.

Primary key: `id` · Foreign keys: `created_by` → `public.auth_user(user_id)`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('api_key_id_seq'::regclass)` |
| `key_id` | varchar | NN |  |
| `key_hash` | varchar | NN |  |
| `service_name` | varchar | NN |  |
| `app_domain` | varchar | NN |  |
| `permissions` | _varchar |  |  |
| `active` | boolean |  |  |
| `expires_at` | timestamptz |  |  |
| `created_by` | varchar |  |  |
| `created_at` | timestamptz |  | `now()` |

<a id="public-app_news_articles"></a>
#### `public.app_news_articles`

8 rows.

Primary key: `id` · Unique: `headline_id` · Foreign keys: `headline_id` → `public.app_news_headlines(id)`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('app_news_articles_id_seq'::r…` |
| `headline_id` | integer |  |  |
| `title_en` | varchar |  |  |
| `title_zh` | varchar |  |  |
| `title_ms` | varchar |  |  |
| `content_en` | text |  |  |
| `content_zh` | text |  |  |
| `content_ms` | text |  |  |
| `summary_en` | text |  |  |
| `summary_zh` | text |  |  |
| `summary_ms` | text |  |  |
| `tags` | _text |  |  |
| `created_at` | timestamptz |  | `CURRENT_TIMESTAMP` |

<a id="public-app_news_headlines"></a>
#### `public.app_news_headlines`

9 rows.

Primary key: `id` · Unique: `headline, news_date` · Foreign keys: `task_id` → `public.app_search_tasks(id)`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('app_news_headlines_id_seq'::…` |
| `task_id` | integer |  |  |
| `headline` | text | NN |  |
| `news_date` | varchar |  |  |
| `source` | varchar |  |  |
| `search_query` | text |  |  |
| `status` | varchar |  | `'fresh'::character varying` |
| `retry_count` | integer |  | `0` |
| `error_message` | text |  |  |
| `created_at` | timestamptz |  | `CURRENT_TIMESTAMP` |
| `updated_at` | timestamptz |  | `CURRENT_TIMESTAMP` |

<a id="public-app_search_tasks"></a>
#### `public.app_search_tasks`

1 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('app_search_tasks_id_seq'::re…` |
| `name` | varchar | NN |  |
| `query` | text | NN |  |
| `gems_name` | varchar |  | `'news-search'::character varying` |
| `gems_url` | text |  |  |
| `schedule` | varchar |  | `'08:00'::character varying` |
| `is_active` | boolean |  | `true` |
| `last_run_at` | timestamptz |  |  |
| `created_at` | timestamptz |  | `CURRENT_TIMESTAMP` |
| `updated_at` | timestamptz |  | `CURRENT_TIMESTAMP` |

<a id="public-app_settings"></a>
#### `public.app_settings`

0 rows.

Primary key: `key`

| Column | Type | Null | Default |
|---|---|---|---|
| `key` | varchar | NN |  |
| `value` | text |  |  |
| `updated_at` | timestamptz | NN | `now()` |

<a id="public-audit_log"></a>
#### `public.audit_log`

32 rows.

Primary key: `id` · Foreign keys: `user_id` → `public.auth_user(user_id)`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('audit_log_id_seq'::regclass)` |
| `entity_type` | varchar | NN |  |
| `entity_id` | varchar | NN |  |
| `action` | varchar | NN |  |
| `user_id` | varchar |  |  |
| `old_values` | text |  |  |
| `new_values` | text |  |  |
| `ip_address` | varchar |  |  |
| `created_at` | timestamptz |  | `now()` |
| `username` | text | NN | `'unknown'::text` |
| `summary` | text | NN | `''::text` |
| `details` | jsonb | NN | `'{}'::jsonb` |

<a id="public-auth_session"></a>
#### `public.auth_session`

0 rows.

Primary key: `id` · Foreign keys: `user_id` → `public.auth_user(user_id)`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('auth_session_id_seq'::regclass)` |
| `session_id` | varchar | NN |  |
| `user_id` | varchar |  |  |
| `token_hash` | varchar | NN |  |
| `expires_at` | timestamptz | NN |  |
| `ip_address` | varchar |  |  |
| `user_agent` | varchar |  |  |
| `created_at` | timestamptz |  | `now()` |

<a id="public-auth_user"></a>
#### `public.auth_user`

1 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('auth_user_id_seq'::regclass)` |
| `user_id` | varchar | NN |  |
| `whatsapp_number` | varchar | NN |  |
| `whatsapp_formatted` | varchar | NN |  |
| `name` | varchar |  |  |
| `role` | varchar | NN |  |
| `active` | boolean |  |  |
| `app_permissions` | _varchar |  |  |
| `created_at` | timestamptz |  | `now()` |
| `last_login_at` | timestamptz |  |  |
| `last_otp_at` | timestamptz |  |  |
| `last_otp_code` | varchar |  |  |

<a id="public-blacklisted_sites"></a>
#### `public.blacklisted_sites`

0 rows.

Primary key: `id` · Unique: `domain`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('blacklisted_sites_id_seq'::r…` |
| `domain` | varchar | NN |  |
| `url` | text | NN |  |
| `title` | text |  |  |
| `reason` | text |  |  |
| `created_at` | timestamp |  | `CURRENT_TIMESTAMP` |
| `updated_at` | timestamp |  | `CURRENT_TIMESTAMP` |

<a id="public-brand"></a>
#### `public.brand`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('brand_id_seq'::regclass)` |
| `bubble_id` | text |  |  |
| `name` | text |  |  |
| `created_by` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `created_date` | timestamptz |  |  |
| `logo` | text |  |  |
| `synced_at` | timestamptz |  | `now()` |

<a id="public-bug_report"></a>
#### `public.bug_report`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('bug_report_id_seq'::regclass)` |
| `bubble_id` | text |  |  |
| `created_date` | timestamptz |  |  |
| `description` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `created_by` | text |  |  |
| `report_type` | text |  |  |
| `is_a_update_` | boolean |  |  |
| `report_by` | text |  |  |
| `screenshoot` | _text |  |  |
| `synced_at` | timestamptz |  | `now()` |
| `is_a_update` | timestamptz |  |  |

<a id="public-career_invitation"></a>
#### `public.career_invitation`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('career_invitation_id_seq'::r…` |
| `bubble_id` | text |  |  |
| `message` | text |  |  |
| `expire_date` | timestamptz |  |  |
| `invitation_code` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `created_date` | timestamptz |  |  |
| `position_to_offer` | text |  |  |
| `person_to_invite_name` | text |  |  |
| `created_by` | text |  |  |
| `linked_agent` | text |  |  |
| `synced_at` | timestamptz |  | `now()` |

<a id="public-case_hub_records"></a>
#### `public.case_hub_records`

131 rows.

Primary key: `bucket, id`

| Column | Type | Null | Default |
|---|---|---|---|
| `bucket` | text | NN |  |
| `id` | text | NN |  |
| `data` | jsonb | NN |  |
| `updated_at` | timestamptz | NN | `now()` |

<a id="public-category"></a>
#### `public.category`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('category_id_seq'::regclass)` |
| `bubble_id` | text | NN |  |
| `last_synced_at` | timestamptz |  | `now()` |
| `created_at` | timestamptz |  | `now()` |
| `updated_at` | timestamptz |  | `now()` |
| `created_date` | timestamptz |  |  |
| `category_name` | text |  |  |
| `created_by` | text |  |  |
| `linked_products` | _text |  |  |
| `modified_date` | timestamptz |  |  |

<a id="public-chat_messages"></a>
#### `public.chat_messages`

115 rows.

Primary key: `id` · Foreign keys: `session_id` → `public.chat_sessions(id)`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('chat_messages_id_seq'::regcl…` |
| `session_id` | integer | NN |  |
| `role` | varchar | NN |  |
| `content` | text | NN |  |
| `created_at` | timestamptz | NN | `now()` |
| `attachments` | text |  |  |
| `input_tokens` | integer |  |  |
| `output_tokens` | integer |  |  |
| `cache_creation_input_tokens` | integer |  |  |
| `cache_read_input_tokens` | integer |  |  |
| `cost_usd` | numeric |  |  |

<a id="public-chat_sessions"></a>
#### `public.chat_sessions`

14 rows.

Primary key: `id` · Foreign keys: `user_id` → `public.users(id)`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('chat_sessions_id_seq'::regcl…` |
| `user_id` | integer | NN |  |
| `title` | varchar |  |  |
| `created_at` | timestamptz | NN | `now()` |
| `mode` | varchar | NN | `'discussion'::character varying` |

<a id="public-commission_adjustment"></a>
#### `public.commission_adjustment`

0 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | text | NN | `(gen_random_uuid())::text` |
| `created_at` | timestamp | NN | `CURRENT_TIMESTAMP` |
| `updated_at` | timestamp | NN | `CURRENT_TIMESTAMP` |
| `agent_id` | text | NN |  |
| `agent_name` | text | NN |  |
| `amount` | numeric | NN |  |
| `description` | text | NN |  |
| `created_by` | text | NN |  |
| `report_id` | text |  |  |
| `adjustment_month` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `created_date` | timestamptz |  |  |
| `linked_agent` | text |  |  |
| `linked_invoice` | text |  |  |

<a id="public-commission_adjustment_v2"></a>
#### `public.commission_adjustment_v2`

0 rows.

Primary key: `adjustment_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `adjustment_id` | text | NN |  |
| `report_id` | text | NN |  |
| `invoice_bubble_id` | text | NN |  |
| `agent_id` | text | NN |  |
| `adjustment_amount` | numeric | NN |  |
| `remark` | text |  |  |
| `created_at` | timestamp | NN | `CURRENT_TIMESTAMP` |
| `created_by` | text |  |  |

<a id="public-company_setting"></a>
#### `public.company_setting`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('company_setting_id_seq'::reg…` |
| `bubble_id` | text |  |  |
| `invoice_request_system_drawing` | _text |  |  |
| `grand_strategy` | text |  |  |
| `created_by` | text |  |  |
| `created_date` | timestamptz |  |  |
| `invoice_count` | integer |  |  |
| `seda_request_engineering_drawing` | _text |  |  |
| `modified_date` | timestamptz |  |  |
| `synced_at` | timestamptz |  | `now()` |

<a id="public-content_category"></a>
#### `public.content_category`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('content_category_id_seq'::re…` |
| `bubble_id` | text |  |  |
| `created_by` | text |  |  |
| `cat_name` | text |  |  |
| `linked_agent_content` | _text |  |  |
| `created_date` | timestamptz |  |  |
| `modified_date` | timestamptz |  |  |
| `synced_at` | timestamptz |  | `now()` |

<a id="public-conversation"></a>
#### `public.conversation`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('conversation_id_seq'::regclass)` |
| `bubble_id` | text |  |  |
| `created_date` | timestamptz |  |  |
| `modified_date` | timestamptz |  |  |
| `created_by` | text |  |  |
| `synced_at` | timestamptz |  | `now()` |
| `user` | text |  |  |
| `user_input` | text |  |  |

<a id="public-customer_profile"></a>
#### `public.customer_profile`

3,032 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('customer_profile_id_seq'::re…` |
| `bubble_id` | text | NN |  |
| `last_synced_at` | timestamptz |  | `now()` |
| `created_at` | timestamptz |  | `now()` |
| `updated_at` | timestamptz |  | `now()` |
| `linked_agent` | text |  |  |
| `address` | text |  |  |
| `name` | text |  |  |
| `created_by` | text |  |  |
| `contact` | text |  |  |
| `status` | text |  |  |
| `created_date` | timestamptz |  |  |
| `modified_date` | timestamptz |  |  |
| `whatsapp` | text |  |  |
| `state` | text |  |  |
| `link_seda_reg` | text |  |  |
| `chinese_content` | boolean |  |  |
| `group_status` | boolean |  |  |

<a id="public-daily_job_planning"></a>
#### `public.daily_job_planning`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('daily_job_planning_id_seq'::…` |
| `bubble_id` | text |  |  |
| `created_date` | timestamptz |  |  |
| `dealer_code` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `created_by` | text |  |  |
| `checkin_person` | text |  |  |
| `check_in_time` | timestamptz |  |  |
| `planning_today` | text |  |  |
| `synced_at` | timestamptz |  | `now()` |
| `today_report` | text |  |  |

<a id="public-dealership"></a>
#### `public.dealership`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('dealership_id_seq'::regclass)` |
| `bubble_id` | text |  |  |
| `dealer_tier_bonus` | numeric |  |  |
| `dealercode` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `join_date` | timestamptz |  |  |
| `dealer_name` | text |  |  |
| `created_date` | timestamptz |  |  |
| `created_by` | text |  |  |
| `synced_at` | timestamptz |  | `now()` |

<a id="public-department"></a>
#### `public.department`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('department_id_seq'::regclass)` |
| `bubble_id` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `created_by` | text |  |  |
| `department_name` | text |  |  |
| `created_date` | timestamptz |  |  |
| `current_task_last_update` | timestamptz |  |  |
| `current_task` | text |  |  |
| `hod` | _text |  |  |
| `member` | _text |  |  |
| `assign_task` | _text |  |  |
| `synced_at` | timestamptz |  | `now()` |

<a id="public-department_report"></a>
#### `public.department_report`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('department_report_id_seq'::r…` |
| `bubble_id` | text |  |  |
| `linked_department` | text |  |  |
| `linked_comment` | _text |  |  |
| `content` | text |  |  |
| `created_date` | timestamptz |  |  |
| `created_by` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `report_type` | text |  |  |
| `synced_at` | timestamptz |  | `now()` |

<a id="public-dept_report_comment"></a>
#### `public.dept_report_comment`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('dept_report_comment_id_seq':…` |
| `bubble_id` | text |  |  |
| `comment` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `created_date` | timestamptz |  |  |
| `created_by` | text |  |  |
| `linked_report` | text |  |  |
| `by` | text |  |  |
| `synced_at` | timestamptz |  | `now()` |

<a id="public-discovery_logs"></a>
#### `public.discovery_logs`

227 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('discovery_logs_id_seq'::regc…` |
| `run_id` | text | NN |  |
| `table_name` | text | NN |  |
| `field_name` | text | NN |  |
| `field_type` | text | NN |  |
| `link_status` | text |  |  |
| `target_table` | text |  |  |
| `sample_value` | text |  |  |
| `reason` | text |  |  |
| `bubble_id_count` | integer |  |  |
| `discovered_at` | timestamp | NN | `now()` |

<a id="public-documents"></a>
#### `public.documents`

7 rows.

Primary key: `id` · Foreign keys: `session_id` → `public.chat_sessions(id)`; `user_id` → `public.users(id)`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('documents_id_seq'::regclass)` |
| `session_id` | integer |  |  |
| `user_id` | integer |  |  |
| `title` | varchar | NN |  |
| `doc_type` | varchar | NN |  |
| `filename` | varchar | NN |  |
| `created_at` | timestamptz | NN | `now()` |

<a id="public-ee_calendar"></a>
#### `public.ee_calendar`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('ee_calendar_id_seq'::regclass)` |
| `bubble_id` | text |  |  |
| `created_date` | timestamptz |  |  |
| `modified_date` | timestamptz |  |  |
| `created_by` | text |  |  |
| `date` | timestamptz |  |  |
| `synced_at` | timestamptz |  | `now()` |

<a id="public-ee_circular"></a>
#### `public.ee_circular`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('ee_circular_id_seq'::regclass)` |
| `bubble_id` | text |  |  |
| `active_` | boolean |  |  |
| `department` | text |  |  |
| `title` | text |  |  |
| `read_by` | _text |  |  |
| `created_date` | timestamptz |  |  |
| `file` | text |  |  |
| `created_by` | text |  |  |
| `date_of_circular` | timestamptz |  |  |
| `modified_date` | timestamptz |  |  |
| `synced_at` | timestamptz |  | `now()` |
| `active` | boolean |  |  |

<a id="public-ega_carryover"></a>
#### `public.ega_carryover`

29 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN |  |
| `year` | text | NN |  |
| `agent` | text | NN |  |
| `cases` | text |  |  |
| `sales` | text |  |  |
| `created_by` | text |  |  |
| `created_at` | text | NN |  |
| `updated_by` | text |  |  |
| `updated_at` | text | NN |  |

<a id="public-epp_gateway"></a>
#### `public.epp_gateway`

12 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('epp_gateway_id_seq'::regclass)` |
| `bubble_id` | text | NN |  |
| `last_synced_at` | timestamptz |  | `now()` |
| `created_at` | timestamptz |  | `now()` |
| `updated_at` | timestamptz |  | `now()` |
| `modified_date` | timestamptz |  |  |
| `name` | text |  |  |
| `created_date` | timestamptz |  |  |
| `type` | text |  |  |
| `created_by` | text |  |  |

<a id="public-epp_option"></a>
#### `public.epp_option`

32 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('epp_option_id_seq'::regclass)` |
| `bubble_id` | text | NN |  |
| `last_synced_at` | timestamptz |  | `now()` |
| `created_at` | timestamptz |  | `now()` |
| `updated_at` | timestamptz |  | `now()` |
| `bank` | text |  |  |
| `created_by` | text |  |  |
| `created_date` | timestamptz |  |  |
| `modified_date` | timestamptz |  |  |
| `interest_charges` | numeric |  |  |
| `tenures` | integer |  |  |

<a id="public-eternalgy_agreement"></a>
#### `public.eternalgy_agreement`

1 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('eternalgy_agreement_id_seq':…` |
| `bubble_id` | text | NN |  |
| `last_synced_at` | timestamptz |  | `now()` |
| `created_at` | timestamptz |  | `now()` |
| `updated_at` | timestamptz |  | `now()` |
| `refund_policy` | text |  |  |
| `type` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `installation_related` | text |  |  |
| `disclaimer` | text |  |  |
| `privacy_policy` | text |  |  |
| `created_date` | timestamptz |  |  |
| `created_by` | text |  |  |
| `warranty` | text |  |  |
| `version_name` | text |  |  |

<a id="public-eternalgynotification"></a>
#### `public.eternalgynotification`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('eternalgynotification_id_seq…` |
| `bubble_id` | text |  |  |
| `content` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `title` | text |  |  |
| `created_date` | timestamptz |  |  |
| `created_by` | text |  |  |
| `checked_agent` | _text |  |  |
| `gallery_image` | _text |  |  |
| `synced_at` | timestamptz |  | `now()` |
| `youtube_1` | text |  |  |

<a id="public-financial_projection"></a>
#### `public.financial_projection`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('financial_projection_id_seq'…` |
| `bubble_id` | text |  |  |
| `created_date` | timestamptz |  |  |
| `year` | integer |  |  |
| `cumulative_earning` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `degradation` | text |  |  |
| `created_by` | text |  |  |
| `synced_at` | timestamptz |  | `now()` |

<a id="public-follow_up_notes"></a>
#### `public.follow_up_notes`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('follow_up_notes_id_seq'::reg…` |
| `bubble_id` | text |  |  |
| `message` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `linked_invoice` | text |  |  |
| `created_date` | timestamptz |  |  |
| `created_by` | text |  |  |
| `synced_at` | timestamptz |  | `now()` |

<a id="public-generated_commission_report"></a>
#### `public.generated_commission_report`

4 rows.

Primary key: `report_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `report_id` | text | NN |  |
| `agent_id` | text | NN |  |
| `agent_name` | text | NN |  |
| `month_period` | text | NN |  |
| `total_basic_commission` | numeric | NN |  |
| `total_bonus_commission` | numeric | NN |  |
| `total_adjustments` | numeric | NN |  |
| `final_total_commission` | numeric | NN |  |
| `commission_paid` | boolean | NN |  |
| `invoice_bubble_ids` | jsonb | NN |  |
| `created_at` | timestamp | NN |  |
| `created_by` | text |  |  |
| `paid_at` | timestamp |  |  |
| `paid_by` | text |  |  |

<a id="public-join_us_form"></a>
#### `public.join_us_form`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('join_us_form_id_seq'::regclass)` |
| `bubble_id` | text |  |  |
| `mobile` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `name` | text |  |  |
| `created_date` | timestamptz |  |  |
| `created_by` | text |  |  |
| `email` | text |  |  |
| `synced_at` | timestamptz |  | `now()` |

<a id="public-news_links"></a>
#### `public.news_links`

19 rows.

Primary key: `id` · Unique: `url_hash`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('news_links_id_seq'::regclass)` |
| `url` | text | NN |  |
| `url_hash` | varchar | NN |  |
| `title` | text |  |  |
| `discovered_at` | timestamp |  | `CURRENT_TIMESTAMP` |
| `source_task` | varchar |  |  |
| `status` | varchar |  | `'pending'::character varying` |
| `error_message` | text |  |  |
| `processed_at` | timestamp |  |  |
| `last_checked` | timestamp |  |  |
| `created_at` | timestamp |  | `CURRENT_TIMESTAMP` |

<a id="public-package_formula"></a>
#### `public.package_formula`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('package_formula_id_seq'::reg…` |
| `bubble_id` | text |  |  |
| `created_by` | text |  |  |
| `baseprice` | integer |  |  |
| `created_date` | timestamptz |  |  |
| `formula_name` | text |  |  |
| `installation` | integer |  |  |
| `skylift` | integer |  |  |
| `per_invoice` | integer |  |  |
| `electrical` | integer |  |  |
| `panel_price` | integer |  |  |
| `modified_date` | timestamptz |  |  |
| `dcac_ratio` | integer |  |  |
| `synced_at` | timestamptz |  | `now()` |

<a id="public-package_item"></a>
#### `public.package_item`

2,320 rows. Components inside each package.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('package_item_id_seq'::regclass)` |
| `bubble_id` | text | NN |  |
| `last_synced_at` | timestamptz |  | `now()` |
| `created_at` | timestamptz |  | `now()` |
| `updated_at` | timestamptz |  | `now()` |
| `total_cost` | integer |  |  |
| `created_by` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `created_date` | timestamptz |  |  |
| `product` | text |  |  |
| `qty` | integer |  |  |
| `sort` | integer |  |  |
| `inventory` | boolean |  |  |

<a id="public-package_test"></a>
#### `public.package_test`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('package_test_id_seq'::regclass)` |
| `bubble_id` | text |  |  |
| `inverter_01` | integer |  |  |
| `recal` | boolean |  |  |
| `created_date` | timestamptz |  |  |
| `created_by` | text |  |  |
| `price` | integer |  |  |
| `modified_date` | timestamptz |  |  |
| `ratio` | numeric |  |  |
| `panel_count` | integer |  |  |
| `system_size` | numeric |  |  |
| `price_without_inverter` | integer |  |  |
| `synced_at` | timestamptz |  | `now()` |
| `micro_2_2` | text |  |  |
| `inverter_02` | text |  |  |

<a id="public-pb_refunds"></a>
#### `public.pb_refunds`

1 rows.

Primary key: `id` · Unique: `invoice_number`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN |  |
| `invoice_number` | text | NN |  |
| `bank_account` | text |  |  |
| `refund_done` | integer | NN | `0` |
| `done_by` | text |  |  |
| `done_at` | text |  |  |
| `created_at` | text |  |  |
| `updated_by` | text |  |  |
| `updated_at` | text |  |  |

<a id="public-pending_schema_patches"></a>
#### `public.pending_schema_patches`

33 rows.

Primary key: `id` · Unique: `field_name, table_name`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('pending_schema_patches_id_se…` |
| `table_name` | text | NN |  |
| `field_name` | text | NN |  |
| `original_field_name` | text |  |  |
| `suggested_type` | text | NN |  |
| `error_message` | text |  |  |
| `status` | text | NN | `'pending'::text` |
| `created_at` | timestamp | NN | `now()` |
| `approved_at` | timestamp |  |  |
| `approved_by` | text |  |  |
| `executed_at` | timestamp |  |  |
| `execution_result` | text |  |  |
| `sync_run_id` | text |  |  |

<a id="public-processed_content"></a>
#### `public.processed_content`

15 rows.

Primary key: `id` · Unique: `link_id` · Foreign keys: `link_id` → `public.news_links(id)`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('processed_content_id_seq'::r…` |
| `link_id` | integer |  |  |
| `title` | text |  |  |
| `title_en` | text |  |  |
| `title_zh` | text |  |  |
| `title_ms` | text |  |  |
| `content` | text |  |  |
| `translated_content` | text |  |  |
| `tags` | _text |  |  |
| `country` | varchar |  |  |
| `news_date` | date |  |  |
| `metadata` | jsonb |  |  |
| `created_at` | timestamp |  | `CURRENT_TIMESTAMP` |
| `updated_at` | timestamp |  | `CURRENT_TIMESTAMP` |

<a id="public-product"></a>
#### `public.product`

39 rows. Product catalogue (panels, inverters, batteries).

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('product_id_seq'::regclass)` |
| `bubble_id` | text | NN |  |
| `last_synced_at` | timestamptz |  | `now()` |
| `created_at` | timestamptz |  | `now()` |
| `updated_at` | timestamptz |  | `now()` |
| `linked_brand` | text |  |  |
| `inventory` | boolean |  |  |
| `image` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `created_date` | timestamptz |  |  |
| `warranty_name` | text |  |  |
| `active` | boolean |  |  |
| `cost_price` | numeric |  |  |
| `selling_price` | numeric |  |  |
| `description` | text |  |  |
| `linked_category` | text |  |  |
| `name` | text |  |  |
| `warranty_link` | text |  |  |
| `label` | text |  |  |
| `pdf_product` | text |  |  |
| `product_warranty_desc` | text |  |  |
| `solar_output_rating` | integer |  |  |
| `created_by` | text |  |  |
| `inverter_rating` | integer |  |  |

<a id="public-query_task_runs"></a>
#### `public.query_task_runs`

2 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('query_task_runs_id_seq'::reg…` |
| `task_name` | varchar | NN |  |
| `summary` | jsonb | NN |  |
| `created_at` | timestamp |  | `CURRENT_TIMESTAMP` |

<a id="public-query_tasks"></a>
#### `public.query_tasks`

2 rows.

Primary key: `id` · Unique: `task_name`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('query_tasks_id_seq'::regclass)` |
| `task_name` | varchar | NN |  |
| `prompt_template` | text | NN |  |
| `is_active` | boolean |  | `true` |
| `schedule` | varchar |  |  |
| `last_run` | timestamp |  |  |
| `total_runs` | integer |  | `0` |
| `total_links_found` | integer |  | `0` |
| `created_at` | timestamp |  | `CURRENT_TIMESTAMP` |
| `updated_at` | timestamp |  | `CURRENT_TIMESTAMP` |
| `model` | varchar |  |  |

<a id="public-referal_contact"></a>
#### `public.referal_contact`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('referal_contact_id_seq'::reg…` |
| `bubble_id` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `created_date` | timestamptz |  |  |
| `lead_name` | text |  |  |
| `lead_contact_no` | text |  |  |
| `linked_agent` | text |  |  |
| `linked_invoice` | text |  |  |
| `created_by` | text |  |  |
| `refer_by` | text |  |  |
| `status` | text |  |  |
| `synced_at` | timestamptz |  | `now()` |

<a id="public-referral_overrides"></a>
#### `public.referral_overrides`

23 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NN |  |
| `year` | text | NN |  |
| `agent` | text | NN |  |
| `customer` | text | NN |  |
| `referral_name` | text |  |  |
| `rate` | text |  |  |
| `created_by` | text |  |  |
| `created_at` | text | NN |  |
| `updated_by` | text |  |  |
| `updated_at` | text | NN |  |

<a id="public-relationship_discovery_status"></a>
#### `public.relationship_discovery_status`

224 rows.

Primary key: `id` · Unique: `source_field, source_table`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('relationship_discovery_statu…` |
| `source_table` | text | NN |  |
| `source_field` | text | NN |  |
| `field_type` | text | NN |  |
| `link_status` | text |  |  |
| `target_table` | text |  |  |
| `last_checked` | timestamp | NN | `now()` |
| `created_at` | timestamp | NN | `now()` |

<a id="public-rewriter_prompts"></a>
#### `public.rewriter_prompts`

0 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('rewriter_prompts_id_seq'::re…` |
| `prompt` | text | NN |  |
| `updated_at` | timestamp |  | `CURRENT_TIMESTAMP` |
| `model` | varchar |  |  |

<a id="public-saving_report"></a>
#### `public.saving_report`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('saving_report_id_seq'::regcl…` |
| `bubble_id` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `created_date` | timestamptz |  |  |
| `panel_type` | integer |  |  |
| `panel_qty` | integer |  |  |
| `linked_invoice` | text |  |  |
| `created_by` | text |  |  |
| `sun_peak` | numeric |  |  |
| `linked_ori_bill` | text |  |  |
| `after_solar_bill` | text |  |  |
| `morning_usage` | integer |  |  |
| `export_generation` | integer |  |  |
| `morning_offset_generation` | integer |  |  |
| `solar_generation` | integer |  |  |
| `synced_at` | timestamptz |  | `now()` |

<a id="public-submit_payment"></a>
#### `public.submit_payment`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('submit_payment_id_seq'::regc…` |
| `bubble_id` | text |  |  |
| `linked_customer` | text |  |  |
| `terminal` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `payment_date` | timestamptz |  |  |
| `amount` | integer |  |  |
| `linked_installment` | text |  |  |
| `created_date` | timestamptz |  |  |
| `linked_agent` | text |  |  |
| `attachment` | text |  |  |
| `payment_method_v2` | text |  |  |
| `created_by` | text |  |  |
| `linked_invoice` | text |  |  |
| `issuer_bank` | text |  |  |
| `synced_at` | timestamptz |  | `now()` |

<a id="public-support_ticket"></a>
#### `public.support_ticket`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('support_ticket_id_seq'::regc…` |
| `bubble_id` | text |  |  |
| `created_date` | timestamptz |  |  |
| `modified_date` | timestamptz |  |  |
| `created_by` | text |  |  |
| `link_customer` | text |  |  |
| `problem_description` | text |  |  |
| `technician_remark` | text |  |  |
| `status` | text |  |  |
| `title` | text |  |  |
| `images` | _text |  |  |
| `synced_at` | timestamptz |  | `now()` |

<a id="public-system_logs"></a>
#### `public.system_logs`

27,966 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('system_logs_id_seq'::regclass)` |
| `timestamp` | timestamptz | NN |  |
| `run_id` | varchar | NN |  |
| `level` | varchar | NN |  |
| `context` | varchar | NN |  |
| `message` | text | NN |  |
| `metadata` | jsonb |  |  |
| `created_at` | timestamptz |  | `now()` |

<a id="public-system_setting"></a>
#### `public.system_setting`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('system_setting_id_seq'::regc…` |
| `bubble_id` | text |  |  |
| `invoice_id_run` | integer |  |  |
| `landed_view` | integer |  |  |
| `assistant_prompt` | text |  |  |
| `epp_default_rate` | numeric |  |  |
| `created_date` | timestamptz |  |  |
| `whatsapp_click` | integer |  |  |
| `created_by` | text |  |  |
| `modified_date` | timestamptz |  |  |
| `synced_at` | timestamptz |  | `now()` |

<a id="public-tariff_b_d_database"></a>
#### `public.tariff_b_d_database`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('tariff_b_d_database_id_seq':…` |
| `bubble_id` | text |  |  |
| `created_by` | text |  |  |
| `201_and_above` | numeric |  |  |
| `icpt` | numeric |  |  |
| `kwtbb` | numeric |  |  |
| `created_date` | timestamptz |  |  |
| `usage` | integer |  |  |
| `modified_date` | timestamptz |  |  |
| `jumlah` | numeric |  |  |
| `first_200kwh` | integer |  |  |
| `tariff_type` | text |  |  |
| `synced_at` | timestamptz |  | `now()` |

<a id="public-terminal"></a>
#### `public.terminal`

0 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('terminal_id_seq'::regclass)` |
| `bubble_id` | text |  |  |
| `bank` | text |  |  |
| `created_by` | text |  |  |
| `name` | text |  |  |
| `created_date` | timestamptz |  |  |
| `modified_date` | timestamptz |  |  |
| `oversea_credit_card` | integer |  |  |
| `local_credit_card__rate_` | integer |  |  |
| `synced_at` | timestamptz |  | `now()` |
| `local_credit_card_rate` | numeric |  |  |

<a id="public-tnb_bill_database"></a>
#### `public.tnb_bill_database`

5,117 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('tnb_bill_database_id_seq'::r…` |
| `bubble_id` | text | NN |  |
| `last_synced_at` | timestamptz |  | `now()` |
| `created_at` | timestamptz |  | `now()` |
| `updated_at` | timestamptz |  | `now()` |
| `total_kwh` | integer |  |  |
| `kwh_with_st` | numeric |  |  |
| `st_total` | numeric |  |  |
| `t5_usage` | integer |  |  |
| `created_date` | timestamptz |  |  |
| `total_bill` | numeric |  |  |
| `t5_57_1` | integer |  |  |
| `icpt_surcharge` | integer |  |  |
| `t2_33_4` | numeric |  |  |
| `t1_21_8` | numeric |  |  |
| `t4_54_6` | numeric |  |  |
| `t3_51_6` | numeric |  |  |
| `t4_usage` | integer |  |  |
| `kwtbb_1_6` | numeric |  |  |
| `modified_date` | timestamptz |  |  |
| `t2_usage` | integer |  |  |
| `created_by` | text |  |  |
| `t1_usage` | integer |  |  |
| `kwh_tanpa_st` | numeric |  |  |
| `t3_usage` | integer |  |  |

<a id="public-tnb_tariff_2025"></a>
#### `public.tnb_tariff_2025`

4,999 rows.

Primary key: `id` · Unique: `bubble_id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('tnb_tariff_2025_id_seq'::reg…` |
| `bubble_id` | text | NN |  |
| `last_synced_at` | timestamptz |  | `now()` |
| `created_at` | timestamptz |  | `now()` |
| `updated_at` | timestamptz |  | `now()` |
| `created_date` | timestamptz |  |  |
| `usage_kwh` | integer |  |  |
| `eei` | numeric |  |  |
| `network` | numeric |  |  |
| `kwtbb_normal` | integer |  |  |
| `retail` | integer |  |  |
| `modified_date` | timestamptz |  |  |
| `usage_normal` | numeric |  |  |
| `created_by` | text |  |  |
| `bill_total_normal` | numeric |  |  |
| `capacity` | numeric |  |  |
| `sst_normal` | integer |  |  |

<a id="public-users"></a>
#### `public.users`

1 rows.

Primary key: `id`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NN | `nextval('users_id_seq'::regclass)` |
| `username` | varchar | NN |  |
| `password_hash` | varchar | NN |  |
| `role` | userrole | NN |  |
| `created_at` | timestamptz | NN | `now()` |

