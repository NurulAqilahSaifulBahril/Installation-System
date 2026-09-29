# Installation Dashboard — User Guide

**For the installation scheduling team**

---

## What this app is

The Installation Dashboard replaces the installation scheduling spreadsheet.

Customer details, payment status, panel and inverter specs, addresses and SEDA
status come across automatically from the sales system. You do not type any of
that in. What you record here is the operational side: installation dates,
customer confirmation, teams, stock and delivery.

It installs like a normal Windows program. There is no website and no link to
remember — you open it from the Start Menu and sign in with your own username
and password.

---

## Before you start

You need:

- A Windows PC (Windows 10 or 11)
- An internet connection
- About 5 minutes
- **Your username and password from Nurul** — everyone has their own
- **Access to the download page** — it is private, so ask Nurul to add your
  GitHub account before you begin

You will **not** be asked for a server address, a database name or an access
token. The connection to the office database is already inside the installer.

---

## Step 1 — Download

Sign in to **GitHub** with the account Nurul added for you, then go to the
**[Installation System download page](https://github.com/NurulAqilahSaifulBahril/Installation-System/releases/latest)**.

If the page says **404 — Not Found**, you are either not signed in to GitHub or
your account has not been added yet. Tell Nurul; there is nothing wrong with the
link.

Scroll down to the **Assets** list and click the file that starts with
`Installation-System-Setup` and ends in `.exe`. There will be a version number
in the middle — always take the newest one the page offers.

It will go to your **Downloads** folder unless you choose somewhere else.

---

## Step 2 — Install

Double-click the file you just downloaded.

> ### ⚠️ You will see a blue warning screen. This is normal.
>
> Windows shows **"Windows protected your PC"** because this is an internal
> company app and not something sold in a shop. It does not mean the file is
> unsafe.
>
> Click **More info**, then click **Run anyway**.
>
> If you do not see "Run anyway", make sure you clicked **More info** first.

Click **Next** through the screens, tick **Create a desktop shortcut** if you
would like one, then click **Install**.

When it is done you will have an **Installation System** shortcut on your
desktop and in the Start Menu.

---

## Step 3 — Open it for the first time

Double-click the desktop shortcut.

The first time you open it, the window may stay blank or white for a few
seconds while it starts up. This is normal and only happens on the first
launch. Later launches are faster.

You should then see the **Installation Operations** sign-in screen. There is
nothing to configure first — the connection to the office database came with
the installer.

---

## Step 4 — Sign in

Use the username and password Nurul gave you. Everyone has their own — your
name is what appears against the changes you make, and in the audit log.

1. Type your **username**.
2. Type your **password**. Click the eye icon at the end of the box to check
   what you typed before you send it.
3. Click **Sign in**.

You land on the dashboard, with today's date and **Malaysia time** at the top
and your own name in the top right — click it to sign out.

It remembers you for about a month, so on your own PC you will rarely have to
sign in again, and an update does not sign you out.

If it says **Incorrect username or password**, try again with the eye icon on so
you can see the password. If it still refuses, ask Nurul to reset it rather than
guessing — repeated failures are recorded.

If it asks you to **create the IT Admin account**, stop and tell Nurul. That
screen only appears when the app is pointed at an empty database.

---

## ⚠️ Step 5 — Check you are seeing real customers

**Do this every time you open the app. It takes two seconds.**

Look at the top right of the screen for the connection dot, and at the customer
names below it.

| What you see | What it means | What to do |
|---|---|---|
| **Live source** and names you recognise | Connected. Everything is fine. | Carry on working |
| **Demo source**, or **DEMO CUSTOMER ONE / TWO / THREE** | **Not connected.** These are fake examples. | Stop. See below. |

If you see the DEMO CUSTOMER names, the app cannot reach the database. There
will also be a warning message across the top of the screen.

**Anything you type while in this state will not be saved.** Work through these
in order:

1. Check your internet connection.
2. Close the app completely and open it again.
3. If the top bar is offering an update, take it — an update can carry a new
   database password, and an app left un-updated can drop to demo data for that
   reason alone.

If the demo names are still there, contact Nurul — do not carry on working. You
should never have to type connection details in yourself; if the app asks for
them, something is wrong.

---

## Finding your way around

There are four workspaces, listed down the left-hand side.

### 🔍 Customer details

Your main working screen. Every customer who is ready for installation, one row
each.

Customers appear here automatically once they reach **59% payment**. You do not
add them yourself.

Use the filter buttons to narrow the list:

- **All active jobs** — everything currently in progress
- **New / ready to schedule** — customers who have just arrived and need a date
- **Needs attention** — jobs with something blocking them
- **All states** — filter by state (Johor, Selangor and so on)

Click any customer row to open their full record.

### 👥 Customer Scheduling

Where you plan which customers to install together.

The app suggests groups of nearby customers based on township — for example all
the Mount Austin jobs together. You choose a planning range, review the
suggestion, and confirm it before anything is created. Nothing is grouped
automatically without you agreeing to it.

A group holds a maximum of five customers per day. You can also add any
customer manually through the search box if the suggestion missed them.

Customers who tell you they are not available are moved to a **Customer
unavailable** list, and their slot is freed for someone else. They come back to
planning once they confirm a new date.

### 📅 Installation groups

Your installation groups and the team directory.

A group is one day's work in one area — it has a date, an area, an installation
team, a wiring team and a supervisor. Change the group's date or team here, and
**every customer in that group updates automatically**. You do not need to edit
each customer one by one.

The team directory is on this screen too. Add teams, their members, contact
numbers and base location, and set which township each team is working in for
the week.

#### Installation queue (Planning status: Ready to Install)

On Installation groups, pick **Ready to Install** in Planning status to see the
installation queue: one table per crew (Team 1 to Team 4, Monday to Saturday,
9am and 2pm) for **next week (front line)** and **the week after
(provisional)**.

- **Queued** — customers paid 60% or more with SEDA approved. Each has 28
  working days (Mon–Fri, public holidays excluded) from reaching 60% to be
  installed. The queue runs by days left on that clock, so anyone over it goes
  first. The **Queue** column shows their number and clock.
- **Front line** — next week's slots, filled from the top of the queue. Team 1
  works from Kluang; Teams 2 to 4 from JB. A day's two houses are within 10 km
  where possible, up to 30 km. A hard roof takes the whole day.
- **Confirm** — the customer agreed; the slot becomes a booking (**Scheduled**).
- **Drop out** — the customer can't make the slot. Choose where they go (back
  to the queue, another day this week, or on hold), add a remark, and pick the
  **standby** who takes the slot.
- **Standby** — the next customers in line. They meet every front-line rule;
  their 60% date is just later. Anyone not used this week is at the front of
  next week.
- **On hold** — customer not available (clock paused), no stock, or materials
  and equipment (clock keeps running). They keep their queue number; press
  **Release** to bring them back. A hard roof stays in the queue until the
  manager puts it on hold.
- **Difficulty** — set in the Difficulty column, or via **View** in the SLD
  column after looking at the photos. Ratings marked **Suggested by Claude**
  come from the photos; press **Confirm** to keep one.
- **Rain** — when rain is forecast for a day with customers on it, a notice asks
  the manager to **Proceed** or **Put day on hold**. Nothing new is planned on a
  day on hold; bookings already made that day are moved in the bookings.

The SEDA approved date is recorded from 29 Sep 2026 onwards. Customers already
approved before then show "Approved, date not recorded".

### 🚚 Stock delivery

Delivery runs — a van going out on a date, to an area, from a warehouse.

Set the run's date, warehouse, driver (PIC) and contact, and link customer
groups to it. Track each delivery from pending stock, to in transit, to
delivered.

---

## Understanding a customer record

Click any customer in **Customer details** to open their record. At the top you
will see five checks:

| Check | Green when | What it tells you |
|---|---|---|
| **Payment** | 59% or above | Customer has paid enough to install |
| **SEDA** | Approved | SEDA approval has come through |
| **Stock** | Delivered | Materials have arrived |
| **Date** | A date is set | Installation date is arranged |
| **Teams** | At least one assigned | Someone is booked to do the work |

A job is only truly **Ready to install** when all five are satisfied. If a job
is not ready, these five checks tell you exactly which one is holding it up —
so you never have to guess.

Inside the record you can set the installation date, record whether the customer
confirmed, add remarks, enter stock details, and assign teams.

**Team assignments** — you can add as many rows as you need. Each row has a
role (Roof / panel, Wiring / electrical, Battery / inverter, or Site
supervisor) and an activity:

- Hooks and rails structure at roof
- PV panel installation work
- DC & AC cable trunking / casing / conduit works
- Earthing cable mounted to PV structure
- Other (you type the description)

**The SLD drawing** opens inside the record — you can view it on screen, no need
to go looking for the file separately.

---

## Updating

**Short version: you don't have to do anything.** The app checks for new
versions by itself and tells you when one is ready.

### When an update is ready

An **Install Update** button appears in the **top bar**, next to *Check for new
jobs*, showing the new version number.

1. Click **Install Update**.
2. Wait. The button shows the download progress, then the app closes and
   reopens by itself on the new version. This takes a minute or two.
3. **Do not close the window while it is working.**

### Things worth knowing

- **Nothing of yours is lost.** All your data lives in the shared database, and
  the connection is kept separately from the program. An update only replaces
  the program itself, and you stay signed in.
- **You never download the installer again.** Steps 1–4 above are one time only.
- **Take updates when they appear.** An update can also carry a new database
  password, which is one way an un-updated app ends up on demo data.
- **To check your version:** Settings → Apps → Installation System. The app
  itself does not show a version number on screen.
- **If an update fails**, the app keeps working on the current version. Tell
  Nurul so it can be looked into.

---

## Common questions

**Do I need to save?**
Your changes go to the shared database when you save the record. Watch for the
confirmation message. If you are not sure a change went through, close the
record and open it again to check.

**Will my colleague see my updates?**
Yes. The app runs on your PC, but everyone shares the same database. If two of
you have it open, you are working on the same jobs. Refresh to see each other's
latest changes.

**A customer is missing.**
Check your filter first — you may be on **New / ready to schedule** rather than
**All active jobs**. If they are genuinely missing, tell Nurul; do not add them
manually somewhere else.

**A customer paid but is not showing.**
Customers appear at 59% payment. Below that they need management approval as a
special case.

**Can I use it at home / on site?**
Yes, as long as you have internet. It does not need to be on the office network.

---

## If something goes wrong

| Problem | What to do |
|---|---|
| Blue "Windows protected your PC" screen | Normal. Click **More info** → **Run anyway** |
| Window is blank or white | Wait 10 seconds. If still blank, close it completely and reopen |
| **404 — Not Found** on the download page | The page is private. Sign in to GitHub, and ask Nurul to add your account if it still will not open |
| "Incorrect username or password" | Turn on the eye icon and try again. Still refused — ask Nurul to reset it |
| It asks you to create the IT Admin account | Stop and tell Nurul. The app is pointed at an empty database — do not create anything |
| Seeing DEMO CUSTOMER names | Not connected. Check your internet, then close the app completely and reopen. Do not enter any data |
| "Set up connection" button showing | The connection that ships with the app has not taken. Tell Nurul — do not type details in yourself |
| Still on Demo source after reopening | Take any update the top bar offers, then reopen. If it persists, contact Nurul |
| Warning bar across the top | Read it — it explains what is not working |
| App will not start at all | Restart your PC, then try again |
| An update failed | Tell Nurul — the app keeps working on the current version |
| Anything else | Contact Nurul. Say what you were doing and what you saw |

**Please report problems rather than working around them.** In these early
weeks, issues get fixed quickly — but only if someone says something. If you
find yourself going back to Excel to get something done, that is exactly the
thing worth reporting.

---

## Things to know

- **Your work is not stored on your PC.** All customer and scheduling data lives
  in the shared database, so there is nothing to back up and nothing lost if
  your PC is replaced.
- **A new PC needs nothing but the installer and your sign-in.** The connection
  comes with the installer, so there is nothing to copy off an old machine.
- **To uninstall:** Settings → Apps → Installation System → Uninstall.

---

## Who to contact

**Nurul** — for anything about the app: problems, questions, missing customers,
or suggestions for what would make it easier to use.
