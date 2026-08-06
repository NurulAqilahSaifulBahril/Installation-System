# Installation Dashboard — User Guide

**Version 1.0.0 · For the installation scheduling team**

---

## What this app is

The Installation Dashboard replaces the installation scheduling spreadsheet.

Customer details, payment status, panel and inverter specs, addresses and SEDA
status come across automatically from the sales system. You do not type any of
that in. What you record here is the operational side: installation dates,
customer confirmation, teams, stock and delivery.

It installs like a normal Windows program. There is no website to log into and
no link to remember.

---

## Before you start

You need:

- A Windows PC (Windows 10 or 11)
- An internet connection
- About 5 minutes

---

## Step 1 — Download

Go to the **[Installation System download page](https://github.com/NurulAqilahSaifulBahril/Installation-System/releases/latest)**.

Scroll down to the **Assets** list and click the file named:

```
Installation-System-Setup-1.0.0.exe
```

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

You should then see the dashboard, with today's date and **Malaysia time** at
the top.

There are no keys to paste in and no login to create. **You are done.**

---

## ⚠️ Step 4 — Check you are seeing real customers

**Do this every time you open the app. It takes two seconds.**

Look at the top right of the screen for the connection dot, and at the customer
names below it.

| What you see | What it means | What to do |
|---|---|---|
| **Live source** and names you recognise | Connected. Everything is fine. | Carry on working |
| **Demo source**, or **DEMO CUSTOMER ONE / TWO / THREE** | **Not connected.** These are fake examples. | Stop. See below. |

If you see the DEMO CUSTOMER names, the app cannot reach the database. There
will also be a warning message across the top of the screen.

**Anything you type while in this state will not be saved.** Close the app,
check your internet connection, and open it again. If the demo names are still
there, contact Nurul — do not carry on working.

---

## Finding your way around

There are four tabs across the top.

### 🔍 Active pipeline

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

### 👥 Team planning

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

### 🚚 Stock delivery

Delivery runs — a van going out on a date, to an area, from a warehouse.

Set the run's date, warehouse, driver (PIC) and contact, and link customer
groups to it. Track each delivery from pending stock, to in transit, to
delivered.

---

## Understanding a customer record

Click any customer in the Active pipeline to open their record. At the top you
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

- **Nothing of yours is lost.** All your data lives in the shared database. An
  update only replaces the program itself.
- **You never download the installer again.** Steps 1–3 above are one time only.
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
| Seeing DEMO CUSTOMER names | Not connected. Check internet, reopen. Do not enter any data |
| Warning bar across the top | Read it — it explains what is not working |
| App will not start at all | Restart your PC, then try again |
| An update failed | Tell Nurul — the app keeps working on the current version |
| Anything else | Contact Nurul. Say what you were doing and what you saw |

**Please report problems rather than working around them.** In these early
weeks, issues get fixed quickly — but only if someone says something. If you
find yourself going back to Excel to get something done, that is exactly the
thing worth reporting.

---

## Things to know about this version

This is **version 1.0.0**.

- **Nothing is stored on your PC.** All data lives in the shared database, so
  there is nothing to back up and nothing lost if your PC is replaced.
- **To uninstall:** Settings → Apps → Installation System → Uninstall.

---

## Who to contact

**Nurul** — for anything about the app: problems, questions, missing customers,
or suggestions for what would make it easier to use.
