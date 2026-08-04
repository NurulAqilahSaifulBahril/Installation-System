# Installation Management System Plan

## 1. Purpose

Build a new, standalone installation management system that:

- receives customer, sales, payment, and equipment information from an external API;
- stores delivery, scheduling, team assignment, status, remarks, and audit history in Supabase;
- creates a new installation job when the API reports that payment has reached at least 59%;
- allows an authorized user to approve an exceptional installation when payment is below 59%;
- gives scheduling administrators one clear view of every job from payment readiness to installation completion.

The first version will run as a new localhost application. It must not reuse or modify the existing application's screens, database workflow, or code structure. It should replace spreadsheet-based installation coordination without changing the source sales/payment system.

---

## 2. Recommended Architecture

- **Source API**: the read-only API that supplies eligible customer/order information.
- **New localhost application**: a completely separate web application for installation operations.
- **Installation Supabase**: the new operational database used only by the installation system.

### Ownership of data

| Data | System of record | Installation system access |
|---|---|---|
| Customer, agent, address, invoice total amount (Sales Price) | Source system through API | Imported snapshot, read-only in the job |
| Payment percentage and balance | Source system through API | Imported and refreshed |
| Panel, inverter, battery, phase, SLD | Source system through API | Imported snapshot/reference |
| Delivery planning and stock details | Installation Supabase | Read/write |
| Installation dates and statuses | Installation Supabase | Read/write |
| Team directory and assignments | Installation Supabase | Read/write |
| Overrides, remarks, and history | Installation Supabase | Read/write |

### Do not reproduce the original workflow

The new system does **not** need to map or copy the source system's messy internal workflow, table structure, statuses, or relationships. It only needs a small, clean API contract containing the fields required by the installation team.

Some mapping is still unavoidable: API fields such as client name, payment percentage, and panel details must be placed into the correct local job fields. This is a simple field import, not a recreation of the old workflow.

The API must provide stable source references from PostgreSQL, such as quotation, sales order, invoice, project, and site IDs. Because one customer/order can have multiple installation locations, `order_id` alone is not sufficient. The preferred unique installation reference is `external_site_id` or `external_installation_id`. If the source cannot provide one, use a stable composite key such as `order_id + site_id`.

This is the minimum mandatory source relationship. It prevents the same installation location from being inserted more than once. Names, phone numbers, and addresses must not be used for duplicate detection.

### Sync recommendation

Use a secure server-side sync process:

1. Call the Source API from the new application's backend.
2. Request records whose payment is at least 59%, plus any specifically approved below-59% records if the API supports them.
3. Create a new Supabase installation job when its unique external installation/site reference has not been seen before.
4. If the job already exists, refresh only the selected source-owned fields, such as payment and contact details.
5. Never overwrite delivery, scheduling, team assignment, remarks, or status entered by installation users.
6. Store the last successful sync time and any sync error.
7. Never send installation changes back to the source system unless a future API integration explicitly requires it.

For the MVP, poll the API every 5–15 minutes and include a manual **Check for New Jobs** action.

API credentials and Supabase service credentials must only be used by the backend and must never be exposed in the browser.

---

## 3. Source Data to Pull

Each installation job should display:

1. Client name
2. Client contact number
3. Sales agent name
4. Installation address
5. Alternative/site contact number, if different
6. Panel details, including brand/model, quantity, and capacity where available
7. Inverter details
8. Battery details
9. Electrical phase
10. Sales price (RM), sourced from the invoice `Total Amount`
11. Payment status (%)
12. Payment balance (RM)
13. SLD drawing or secure document link
14. External quotation, sales order, invoice, project, and site reference IDs where available
15. Last API sync time

Do not merge “client contact number,” “site contact number,” and “delivery contact number.” They may be the same, but they serve different purposes and should be separately selectable.

---

## 4. Operational Data Stored in Supabase

### Delivery

- delivery requirement/status;
- planned delivery date;
- actual arrival date;
- delivery status;
- stock readiness;
- stock/material line items and quantities;
- missing or pending stock;
- warehouse/origin;
- destination, normally copied from the customer installation address;
- delivery contact name and number;
- delivery notes;
- proof of delivery or attachments, if required.

Recommended delivery statuses:

- `not_planned`
- `pending_stock`
- `ready_for_delivery`
- `delivery_scheduled`
- `in_transit`
- `delivered`
- `partially_delivered`
- `cancelled`

### Scheduling

- proposed installation date;
- customer-confirmed installation date;
- date approval status;
- SEDA approval status;
- scheduling status;
- remarks and blockers;
- reschedule reason and previous date history;
- customer confirmation timestamp and confirming user.

Recommended scheduling statuses:

- `not_ready`
- `ready_to_schedule`
- `pending_customer_confirmation`
- `date_confirmed`
- `pending_installation`
- `reschedule_required`
- `installed`
- `cancelled`

Recommended approval/blocker reasons:

- pending date approval;
- pending SEDA approval;
- pending payment;
- pending panel;
- pending inverter;
- pending battery;
- pending delivery;
- customer unavailable;
- team unavailable;
- weather;
- site not ready;
- other, with a mandatory remark.

### Installation details

- final panel details;
- final inverter details;
- final battery details;
- wiring requirements/details;
- installation notes;
- actual installation start and completion dates;
- completion evidence or attachments, if required.

The source equipment specification should remain visible. If operations must change the planned equipment, store the change separately with a reason and approval rather than overwriting the source value.

### Installation team

- team name and team type;
- team members or supervisor;
- operating/base location;
- service areas;
- team contact number;
- availability;
- assignment role;
- assignment date/time;
- assignment notes.

The system will support multiple team assignments with roles. A job may use one combined team or separate roof/panel, wiring/electrical, battery/inverter, and supervisor teams.

### Team structure decision

There are two possible operating models:

1. **One combined team**
   - One team is assigned to the entire installation.
   - The team handles panels/roof work, wiring, inverter/battery work, and supervision.
   - This is simpler for scheduling and is suitable when the same people normally travel and work together.

2. **Separate specialist teams**
   - A roof/panel team, wiring/electrical team, and site supervisor can be assigned independently.
   - They may attend at different times and have different contacts, locations, and availability.
   - This provides better control when specialist crews are scheduled separately, but it makes scheduling and conflict checking more complex.

Confirmed design: allow multiple team assignments with roles, while permitting the Scheduling Admin to assign just one combined team. The Scheduling Admin can record different attendance dates/times, contacts, statuses, and remarks for each assigned team.

---

## 5. Payment Eligibility and Special Cases

### Normal rule

A job is **payment eligible** when:

```text
payment_percentage >= 59%
```

Payment eligibility does not automatically mean the job can be installed. Stock, approvals, customer date, delivery, and team availability must also be considered.

### Exception rule

A job below 59% may proceed only with a recorded override. The override must contain:

- approval status;
- approving user;
- approval date/time;
- reason;
- optional attachment/reference;
- optional expiry or review date.

An Admin may request a below-59% exception, but management approval is required before installation can proceed. The requester must not approve their own request.

### If payment later falls below 59%

An imported job must never be deleted when its refreshed payment percentage falls below 59%. Deleting it would lose delivery, scheduling, team assignment, remarks, and audit history.

Recommended rule:

1. Set `payment_review_required = true`.
2. Display a prominent `Payment Dropped Below 59%` blocker.
3. Keep all existing dates, assignments, and history.
4. Prevent a not-yet-confirmed job from becoming `ready_to_install`.
5. Require Admin review and management approval to continue as a payment exception.
6. If the installation is already completed, do not reverse its status; notify Admin/management for collection follow-up.
7. If an installation date is already confirmed, do not cancel it automatically. Keep the date but place the job on hold until management decides whether to proceed or reschedule.

Every payment change and management decision must be recorded in the audit history.

### Derived readiness

Use separate indicators rather than one ambiguous status:

- **Payment eligible**: payment is at least 59% or an active override exists.
- **Stock ready**: all required material is ready or an authorized exception exists.
- **Approval ready**: required date/SEDA approvals are complete.
- **Customer confirmed**: customer agreed to the installation date.
- **Team assigned**: an available team is assigned.
- **Delivery ready**: material delivery is completed or confirmed for the correct time.

A job becomes **Ready to Install** only when all required indicators are satisfied.

---

## 6. End-to-End Workflow

### Authoritative planning direction

```text
Scheduling Admin manually prepares operational plans
        |
        +--> Installation groups (area, date, capacity)
        +--> Team directory and team assignments
        +--> Stock delivery runs (warehouse, route, date)
        |
        v
Active Installation Pipeline receives eligible API customers
        |
        v
Admin links each customer to an existing installation group
and an existing delivery run
        |
        v
Customer inherits group date and assigned teams
        |
        v
Confirm customer + SEDA + stock + teams
        |
        v
Ready to Install --> Installed / Rescheduled
```

Operational plans are created first. The Active Installation Pipeline must not be the place where groups, teams, or delivery runs are initially created.

### Detailed workflow

1. **Create installation groups manually**
   - The Scheduling Admin creates an empty group without selecting a customer.
   - Record group name, area/location, proposed installation date, capacity, status, and remarks.
   - Groups remain available for later customer assignment.

2. **Create and maintain teams manually**
   - Add installation and wiring teams to the team directory.
   - Record role, base location, contact number, availability, and active status.
   - Assign one installation team and one wiring team to an installation group.
   - Add a supervisor or specialist when required.
   - Warn about date conflicts and team over-capacity.

3. **Create stock delivery runs manually**
   - The Scheduling Admin creates an empty delivery run without selecting a customer.
   - Record run name, delivery date, warehouse, route/area, delivery team, capacity, status, and remarks.
   - Delivery runs remain available for later customer assignment.

4. **API detects an eligible sale**
   - The source system reports that payment is at least 59%.
   - The API returns the agreed installation fields and a unique external installation/site reference.
   - If one order has multiple installation locations, each location becomes its own installation job.

5. **Create a new installation pipeline row**
   - The new application checks whether the external job ID already exists.
   - If it does not exist, the system creates one new installation job in Supabase.
   - Its initial status is `ready_to_schedule`.
   - The row appears in the Scheduling Admin's **New / Ready to Schedule** queue.

6. **Handle special below-59% jobs**
   - A below-59% job is not created through the normal eligibility feed.
   - An authorized user can create/import it through a special-case action.
   - The user must record the approver and reason.
   - The job is visibly marked as a payment exception.

7. **Link the customer to existing plans**
   - From the Active Installation Pipeline, select an existing installation group.
   - Select an existing stock delivery run.
   - The customer inherits the group's proposed date, installation team, wiring team, and supervisor.
   - The customer remains independently editable for customer confirmation, stock details, and justified exceptions.

8. **Scheduling Admin reviews the job**
   - Confirm the customer details, address, equipment, payment information, and SLD.
   - Check SEDA/date approvals and source equipment specification.
   - If payment is at least 59% but SEDA is not approved, retain the job and show `Pending SEDA Approval` as a blocker/remark.
   - Record blockers and missing material.

9. **Complete customer delivery details**
   - Confirm stock items and quantities for the customer within the selected delivery run.
   - Set the delivery contact and destination.
   - Update delivery status until the materials arrive.

10. **Confirm the installation date**
   - Review the inherited group date, team availability, and delivery timing.
   - Contact the customer and record the proposed date.
   - Record whether the date is approved, pending approval, or pending SEDA approval.

11. **Confirm readiness**
   - Record customer confirmation.
   - Confirm required stock and delivery.
   - Confirm inherited team assignments and required approvals.
   - When all required checks pass, set the job to `ready_to_install`.

12. **Install or reschedule**
   - Mark the job installed when work is complete.
   - If it cannot proceed, choose a reason, add a remark, and create a new schedule record.
   - Never overwrite the old installation date; retain the complete history.

13. **Close job**
   - Record completion date, final details, evidence, and final remarks.

---

## 7. Suggested Supabase Data Model

### Core tables

#### `installation_groups`

Manual planning container created before customer assignment.

- group name;
- area/location;
- proposed installation date;
- customer capacity;
- installation team ID;
- wiring team ID;
- supervisor;
- status and remarks;
- created/updated user and timestamps.

#### `installation_group_jobs`

Links customer installation jobs to an existing installation group. A job may have only one active installation group at a time. Moving a customer must retain assignment history.

#### `team_resources`

Manual team directory containing team name, role (`installation` or `wiring`), base location, contact number, availability, capacity, and active status.

#### `delivery_runs`

Manual delivery plan created before customer assignment.

- run name;
- delivery date;
- warehouse;
- route/area;
- linked installation group/location;
- delivery team;
- delivery person in charge (PIC);
- PIC contact number;
- customer capacity;
- status and remarks.

#### `delivery_run_jobs`

Links customer installation jobs and their stock details to an existing delivery run.

#### `installation_jobs`

One row per source order/site installation.

Important fields:

- `id`
- `external_installation_id` or `external_site_id` (unique)
- `external_customer_id`
- `external_quotation_id`
- `external_sales_order_id`
- `external_invoice_id`
- `external_project_id`
- imported API snapshot fields needed by the installation team
- `payment_percentage`
- `payment_balance_rm`
- `payment_eligible`
- `current_schedule_status`
- `current_delivery_status`
- `overall_status`
- `last_source_sync_at`
- `created_at`, `updated_at`

#### `deliveries`

One job may have multiple deliveries.

- job ID;
- warehouse/origin and destination;
- contact details;
- planned and actual dates;
- status;
- notes.

#### `delivery_items`

- delivery ID;
- material/product description;
- quantity required;
- quantity delivered;
- stock status;
- notes.

#### `installation_schedules`

One row per proposed, confirmed, or rescheduled date.

- job ID;
- proposed/confirmed date and time;
- approval and customer confirmation status;
- status;
- reason and remarks;
- created/confirmed by;
- timestamps.

#### `teams`

- team name/type;
- contact number;
- base location and service area;
- active status.

#### `team_members`

- team ID;
- member name;
- role;
- contact number;
- active status.

#### `job_team_assignments`

- job and schedule IDs;
- team ID;
- assignment role;
- assigned date/time;
- notes.

#### `payment_overrides`

- job ID;
- requested by;
- approved/rejected by;
- status;
- reason;
- timestamps;
- expiry/review date.

#### `job_blockers`

- job ID;
- blocker category;
- status;
- remarks;
- opened and resolved timestamps/users.

#### `job_status_history`

Stores every important status change, including old value, new value, user, time, and remark.

#### `attachments`

Stores metadata and secure Supabase Storage paths for SLDs, delivery proof, approval documents, and completion evidence. Source-owned SLDs may instead remain as secure links to the source system.

### Important constraints

- `external_installation_id` or `external_site_id` must be unique. If neither is available, the stable `external_order_id + external_site_id` combination must be unique.
- Money should use a fixed decimal type, not floating point.
- Phone numbers should be stored as text.
- Dates/times should include timezone; display them in the business timezone.
- Status values should be controlled, not free text.
- “Other” status/reason requires a remark.
- Rescheduling creates history; it must not erase the previous schedule.
- Use soft deletion/archive for operational records where audit history matters.

---

## 8. Main Screens

### Installation pipeline

A searchable/filterable table or board showing:

- customer and location;
- agent;
- payment percentage and balance;
- payment eligibility/override;
- stock and delivery status;
- proposed/confirmed installation date;
- scheduling status;
- blockers;
- assigned team.

Filters should include status, date range, area, agent, team, payment readiness, stock readiness, and SEDA approval.

### Job details

Sections:

1. Customer details, including source sales data, payment, equipment, and SLD;
2. Installation scheduling and customer confirmation;
3. Installation details;
4. Material stock delivery;
5. Team assignments;
6. Remarks, blockers, attachments, and history.

The SLD must be viewable inside the job page as an image or PDF preview, not shown only as an availability status. Users should also be able to open the full drawing and download it when their role permits.

Use a professional specification layout with aligned label/value rows and subtle dividers inside one section surface, rather than a separate visual box around every value.

Team assignments support multiple activity rows. Controlled activities include:

- hooks and rails structure at roof;
- PV panel installation work;
- DC and AC cable trunking, casing, or conduit works;
- earthing cable mounted to the PV structure;
- other, with a required custom activity description.

The Update Job form must use the same section order as the read-only customer popup. Each team activity is a repeatable row with an activity dropdown, installation-team role, and a team selected from the Team Directory; users may add as many activity rows as required.

### Scheduling calendar

- day/week/month views;
- jobs by installation location;
- team availability and assignment;
- delivery date;
- conflict warnings for double-booked teams.

### Installation groups

- table-based group management;
- edit group name, area, installation date, assigned installation team, wiring team, and supervisor inline;
- show linked-customer count;
- create empty groups manually;
- accept suggested groups from Team Planning;
- maintain the team directory on the same screen;
- add and edit team name, role, base location, contact number, and member names;
- assign each team from a start date until an end date;
- select the assigned township/location from available installation groups rather than entering free text;
- retain weekly location-assignment history rather than overwriting the previous week.

Changes to an installation group's date, installation team, or wiring team must appear immediately for every linked customer in the Active Installation Pipeline. Changes to a linked delivery run's date, warehouse, PIC, or contact must also appear without separate customer-level re-entry.

### Team Planning and location suggestions

- pull only ungrouped customers whose status is `ready_to_schedule`;
- require payment of at least 59% or an approved management exception;
- exclude customers marked unavailable;
- allow the Scheduling Admin to choose an approximate planning range such as 10, 20, 30, or 50 km;
- suggest location groups by township names found in customer addresses, such as Mount Austin and Johor Jaya;
- limit each suggested daily installation group to a maximum of five customers;
- show customer count, customer names, payment readiness, and pending SEDA count;
- open a customer-detail list when the user selects a suggestion row;
- allow the Admin to add any non-installed customer through a searchable/dropdown customer picker, regardless of suggested township;
- show a clear special-case warning for customers below 59% payment and retain the management-approval requirement;
- remove a manually added customer from their previous installation group before linking them to the new group;
- require Admin confirmation before creating a suggested group;
- never assign customers automatically without confirmation.

City/state grouping is an approximation. Exact kilometre-radius grouping requires reliable latitude/longitude coordinates or an approved mapping/geocoding service.

Five customers is a configurable planning ceiling, not a guaranteed daily output. Actual capacity depends on panel quantity, roof complexity, wiring and battery scope, travel time, weather, and team size.

If a customer is unavailable:

1. mark customer confirmation as unavailable or pending;
2. do not mark that customer `ready_to_install`;
3. automatically remove the customer from the active installation group while retaining assignment history;
4. free the group slot for another eligible customer;
5. record the reason and preferred alternative dates;
6. show the customer in a dedicated `Customer Unavailable` holding list;
7. require the user to choose an installation group before selecting `Mark available & assign`;
8. prevent assignment to a group that already contains five customers;
9. return the customer to active planning only after availability is restored;
10. assign the customer to a later group only after confirmation.

Customer availability status, preferred installation date, and availability remarks belong to the shared installation job. They must be editable from Team Planning and the Active Installation Pipeline customer popup, with both views showing the same values.

### Delivery board

- pending stock;
- ready for delivery;
- scheduled/in transit;
- delivered/partial delivery;
- overdue deliveries.
- edit delivery-run name, date, warehouse, linked customer group, PIC, contact, delivery team, and status;
- unlink a customer group without deleting the group itself;
- remove an entire delivery run when it is no longer required;
- refresh the delivery customer list when the linked installation group changes.

### Team management

- team details and contact;
- location/service area;
- availability;
- upcoming assignments.

### Override approval queue

- jobs below 59%;
- override reason;
- requester;
- approve/reject action;
- complete audit record.

---

## 9. Roles and Permissions

Suggested roles:

- **Viewer**: read-only access.
- **Scheduling Admin**: plan deliveries, contact customers, propose dates, assign teams, and add remarks.
- **Warehouse/Delivery**: update stock and delivery information.
- **Team Lead**: view assigned jobs and update installation progress.
- **Finance/Manager**: approve or reject payment overrides.
- **System Admin**: manage users, teams, settings, and integrations.

Use Supabase Auth and Row Level Security. At minimum, protect:

- customer personal data;
- payment information;
- SLDs and attachments;
- override approvals;
- team contact information.

Every important write should record who made it and when.

---

## 10. Notifications

Start with in-app alerts. Add WhatsApp, SMS, or email later if required.

Useful alerts:

- payment reaches 59%;
- override requested/approved/rejected;
- job becomes ready to schedule;
- stock is missing for an upcoming installation;
- customer confirmation is pending;
- team conflict or unassigned job;
- delivery or installation is overdue;
- installation is rescheduled.

WhatsApp is the preferred external notification channel, but it will be implemented after the MVP. The MVP should retain in-app status indicators and audit records so WhatsApp automation can be added later without changing the core workflow.

---

## 11. MVP Scope

### Phase 1 — Confirm rules and source mapping

- define the small Source API response needed by the installation system;
- confirm the stable external installation/site ID and the source quotation, sales order, invoice, project, and site references;
- confirm whether the API returns only jobs at or above 59%, or returns all jobs for the new application to filter;
- agree on statuses, permissions, and readiness rules;
- confirm the minimum imported fields and avoid reproducing the original workflow.

### Phase 2 — Database, authentication, and sync

- create Supabase tables, constraints, roles, and audit history;
- create a completely new localhost application;
- build the read-only Source API import;
- implement sync monitoring and **Check for New Jobs**;
- import a test set and verify duplicate prevention.

### Phase 3 — Operational MVP

- installation pipeline;
- job detail page;
- payment rule and override workflow;
- delivery and stock tracking;
- schedule/reschedule history;
- team assignment;
- filters and basic dashboard counts.

### Phase 4 — Calendar and operational controls

- scheduling calendar;
- team conflict checks;
- delivery/installation alerts;
- attachments and completion evidence;
- exports and management reporting.

### Phase 5 — Optional enhancements

- customer/team notifications;
- route or map support;
- mobile field view;
- inventory-system integration;
- advanced capacity and regional planning;
- write-back to another approved business system.

---

## 12. Acceptance Criteria for the MVP

The MVP is ready when:

- an API record at or above 59% creates one new installation row;
- repeated API responses do not create duplicate installation jobs;
- source-field updates do not overwrite installation-admin data;
- newly imported jobs appear in the Scheduling Admin's ready queue;
- jobs below 59% remain blocked unless an authorized override is approved;
- admins can plan and track stock delivery;
- admins can propose, confirm, and reschedule installation dates without losing history;
- teams cannot be unknowingly double-booked;
- users can see why a job is not ready;
- installed jobs retain their source data, schedule, delivery, team, remarks, and audit history;
- permissions prevent unauthorized users from approving overrides or viewing restricted data.

---

## 13. Decisions Needed Before Development

### Confirmed decisions

1. Source data originates in PostgreSQL and is supplied to the new application through an API.
2. Source references for quotations, sales orders, invoices, projects, and sites come from PostgreSQL.
3. One customer/order can have more than one installation location. Each location must be treated as a separate installation job.
4. Payment percentage comes from PostgreSQL through the API.
5. An Admin can request a below-59% exception, but management must approve it.
6. SEDA approval is required for every installation in this system. A job paid at least 59% can enter the installation queue before SEDA approval, but it must show `Pending SEDA Approval` and cannot become fully ready until approval is received.
7. Stock has no current external data source. Stock and material records will be entered and stored in Supabase.
8. The required SLD drawing comes from PostgreSQL through the API.
9. Multiple installation teams can be assigned to one job with roles, including roof/panel, wiring/electrical, battery/inverter, and supervisor roles.
10. WhatsApp is the preferred external notification channel, but it will be added after the MVP.
11. If payment later drops below 59%, retain the job and its history, add a payment blocker, and require Admin/management review before proceeding.
12. Customer and team notifications are required.
13. The application uses Malaysian time (`Asia/Kuala_Lumpur`, UTC+8).
14. Historical spreadsheet records will not be imported. The system starts with new API records.

### Remaining decisions

1. What authentication method will the Source API use?
2. Does “yes” mean the API returns all sales, or only jobs whose payment has reached at least 59%?
3. If the API has no installation/site ID, which stable source fields identify each location: for example `order_id + site_sequence`, a source site ID, or another location reference?
4. Apart from the SLD, are completion photos, delivery proof, or customer sign-off required?

---

## 14. Recommended First Workshop

Before coding, use 5–10 real jobs to walk through:

- one normal job above 59%;
- one job below 59% with approval;
- one job pending SEDA;
- one job with missing stock;
- one partial delivery;
- one rescheduled installation;
- one job using separate installation teams.

For each example, confirm its source fields, owner, allowed actions, readiness result, and expected final status. This will expose workflow exceptions before they become database or UI rework.
