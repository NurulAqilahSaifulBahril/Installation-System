"""Renders the Installation System user guide to a styled PDF.

Mirrors the design language of the Commission Portal guide (Eternalgy navy
header, blue accent rule, Segoe UI throughout) so the two desktop apps hand
users the same-looking document.

    python scripts/build-user-guide.py

Writes docs/Installation Desktop app_user_guide.pdf. Content is authored here
rather than parsed from USER-GUIDE.md — the markdown is the plain-text version,
this is the laid-out one. Keep the two in step when either changes.
"""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "Installation Desktop app_user_guide.pdf"

VERSION = "1.0.0"
DATE_LABEL = "August 2026"
RELEASES_URL = "https://github.com/NurulAqilahSaifulBahril/Installation-System/releases/latest"

# --- design tokens -------------------------------------------------------

NAVY = colors.HexColor("#0F1922")
BLUE = colors.HexColor("#2563EB")
BLUE_LIGHT = colors.HexColor("#60A5FA")
EYEBROW_ON_NAVY = colors.HexColor("#93C5FD")
META_ON_NAVY = colors.HexColor("#AEC3DE")
INK = colors.HexColor("#0F172A")
MUTED = colors.HexColor("#64748B")
CODE_BG = colors.HexColor("#EFF2F6")
RULE = colors.HexColor("#E2E8F0")
AMBER_BG = colors.HexColor("#FFF8EB")
AMBER_EDGE = colors.HexColor("#F59E0B")
BLUE_BG = colors.HexColor("#F1F6FE")
ZEBRA = colors.HexColor("#F8FAFC")

PAGE_W, PAGE_H = A4
MARGIN = 46
CONTENT_W = PAGE_W - 2 * MARGIN
HEADER_H = 153
BANNER_H = 34  # running header band on pages 2+

FONTS = {
    "SegoeUI": "segoeui.ttf",
    "SegoeUI-Bold": "segoeuib.ttf",
    "SegoeUI-Italic": "segoeuii.ttf",
    "SegoeUI-Semibold": "seguisb.ttf",
    "Consolas": "consola.ttf",
}


def register_fonts():
    windows_fonts = Path("C:/Windows/Fonts")
    for name, filename in FONTS.items():
        pdfmetrics.registerFont(TTFont(name, str(windows_fonts / filename)))
    pdfmetrics.registerFontFamily(
        "SegoeUI",
        normal="SegoeUI",
        bold="SegoeUI-Bold",
        italic="SegoeUI-Italic",
        boldItalic="SegoeUI-Bold",
    )


# --- paragraph styles ----------------------------------------------------


def build_styles():
    body = ParagraphStyle(
        "body",
        fontName="SegoeUI",
        fontSize=10,
        leading=15.5,
        textColor=INK,
        spaceAfter=9,
        alignment=TA_LEFT,
    )
    return {
        "body": body,
        "lead": ParagraphStyle(
            "lead", parent=body, fontSize=10.5, leading=16.5, spaceAfter=12
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=body,
            fontName="SegoeUI-Semibold",
            fontSize=17,
            leading=22,
            spaceBefore=4,
            spaceAfter=8,
            keepWithNext=1,
        ),
        "h3": ParagraphStyle(
            "h3",
            parent=body,
            fontName="SegoeUI-Semibold",
            fontSize=13,
            leading=18,
            spaceBefore=13,
            spaceAfter=6,
            keepWithNext=1,
        ),
        "eyebrow": ParagraphStyle(
            "eyebrow",
            parent=body,
            fontName="SegoeUI-Bold",
            fontSize=8.4,
            leading=11,
            textColor=BLUE,
            spaceBefore=16,
            spaceAfter=5,
            keepWithNext=1,
        ),
        "bullet": ParagraphStyle(
            "bullet", parent=body, leading=15, spaceAfter=5
        ),
        "step": ParagraphStyle(
            "step", parent=body, leading=15, spaceAfter=0
        ),
        "callout": ParagraphStyle(
            "callout", parent=body, fontSize=9.6, leading=15, spaceAfter=6
        ),
        "callout_title": ParagraphStyle(
            "callout_title",
            parent=body,
            fontName="SegoeUI-Semibold",
            fontSize=10.5,
            leading=15,
            spaceAfter=5,
        ),
        "th": ParagraphStyle(
            "th",
            parent=body,
            fontName="SegoeUI-Bold",
            fontSize=8.2,
            leading=11,
            textColor=colors.white,
            spaceAfter=0,
        ),
        "td": ParagraphStyle(
            "td", parent=body, fontSize=9.3, leading=13.5, spaceAfter=0
        ),
        "code": ParagraphStyle(
            "code",
            parent=body,
            fontName="Consolas",
            fontSize=9.6,
            leading=15,
            textColor=INK,
            spaceAfter=0,
            leftIndent=10,
        ),
        "footer": ParagraphStyle(
            "footer", parent=body, fontSize=7.6, textColor=MUTED, spaceAfter=0
        ),
    }


S = None  # populated in main()


# --- inline helpers ------------------------------------------------------


def code(text):
    """Inline code — Consolas on a light background, like the Commission guide."""
    return (
        f'<font face="Consolas" size="8.8" backColor="#EFF2F6"> {text} </font>'
    )


def link(text, url):
    return f'<link href="{url}" color="#2563EB"><b>{text}</b></link>'


# --- block helpers -------------------------------------------------------


def para(text, style="body"):
    return Paragraph(text, S[style])


def eyebrow(text):
    return Paragraph(text.upper(), S["eyebrow"])


def h2(text):
    return Paragraph(text, S["h2"])


def h3(text):
    return Paragraph(text, S["h3"])


def bullets(items):
    """Bulleted list with a blue dot, tight against the body column."""
    rows = [
        [Paragraph('<font color="#2563EB">•</font>', S["bullet"]),
         Paragraph(item, S["bullet"])]
        for item in items
    ]
    table = Table(rows, colWidths=[13, CONTENT_W - 13])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (0, -1), 3),
            ]
        )
    )
    return table


def _number_badge(n):
    """Fixed 15x15 blue square holding the step number.

    Nested in its own table so the fill stays square — a BACKGROUND on the
    outer cell would stretch down the full height of a multi-line step.
    """
    badge = Table(
        [[Paragraph(
            f'<font color="white" face="SegoeUI-Bold" size="8.4">{n}</font>',
            S["step"],
        )]],
        colWidths=[15],
        rowHeights=[15],
    )
    badge.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), BLUE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return badge


def steps(items):
    """Numbered steps with filled blue number badges."""
    rows = [
        [_number_badge(i), Paragraph(item, S["step"])]
        for i, item in enumerate(items, start=1)
    ]

    table = Table(rows, colWidths=[15, CONTENT_W - 15])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (0, -1), 9),
                ("LEFTPADDING", (1, 0), (1, -1), 9),
            ]
        )
    )
    return table


def callout(title, lines, accent=AMBER_EDGE, background=AMBER_BG):
    """Boxed aside with a coloured left edge."""
    inner = []
    if title:
        inner.append(Paragraph(title, S["callout_title"]))
    for text in lines:
        inner.append(Paragraph(text, S["callout"]))

    table = Table([[inner]], colWidths=[CONTENT_W])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), background),
                ("LINEBEFORE", (0, 0), (0, -1), 3, accent),
                ("LEFTPADDING", (0, 0), (-1, -1), 13),
                ("RIGHTPADDING", (0, 0), (-1, -1), 13),
                ("TOPPADDING", (0, 0), (-1, -1), 11),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def code_block(text):
    table = Table([[Paragraph(text, S["code"])]], colWidths=[CONTENT_W])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), CODE_BG),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
            ]
        )
    )
    return table


def data_table(headers, rows, widths):
    """Header band in navy, zebra-striped body — matches the guide's tables."""
    data = [[Paragraph(h.upper(), S["th"]) for h in headers]]
    for row in rows:
        data.append([Paragraph(cell, S["td"]) for cell in row])

    table = Table(data, colWidths=widths, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LINEBELOW", (0, 1), (-1, -2), 0.6, RULE),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), ZEBRA))
    table.setStyle(TableStyle(style))
    return table


# --- page furniture ------------------------------------------------------


def draw_cover_header(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, PAGE_H - HEADER_H, PAGE_W, HEADER_H, stroke=0, fill=1)
    canvas.setFillColor(BLUE)
    canvas.rect(0, PAGE_H - HEADER_H - 3, PAGE_W, 3, stroke=0, fill=1)

    canvas.setFillColor(EYEBROW_ON_NAVY)
    canvas.setFont("SegoeUI-Bold", 8.5)
    canvas.drawString(MARGIN, PAGE_H - 46, "E T E R N A L G Y")

    canvas.setFillColor(colors.white)
    canvas.setFont("SegoeUI-Semibold", 25)
    canvas.drawString(MARGIN, PAGE_H - 82, "Installation Dashboard")

    canvas.setFillColor(BLUE_LIGHT)
    canvas.drawString(MARGIN, PAGE_H - 111, "Install & Update Guide")

    canvas.setFillColor(META_ON_NAVY)
    canvas.setFont("SegoeUI", 10)
    canvas.drawString(
        MARGIN,
        PAGE_H - 133,
        f"Installation System \u00b7 Version {VERSION} \u00b7 {DATE_LABEL}",
    )
    canvas.restoreState()


def draw_running_header(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, PAGE_H - BANNER_H, PAGE_W, BANNER_H, stroke=0, fill=1)
    canvas.setFillColor(BLUE)
    canvas.rect(0, PAGE_H - BANNER_H - 2, PAGE_W, 2, stroke=0, fill=1)
    canvas.setFillColor(EYEBROW_ON_NAVY)
    canvas.setFont("SegoeUI-Bold", 8)
    canvas.drawString(MARGIN, PAGE_H - 22, "ETERNALGY  INSTALLATION DASHBOARD")
    canvas.restoreState()


def draw_footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(MUTED)
    canvas.setFont("SegoeUI", 7.6)
    canvas.drawString(MARGIN, 30, "Install & Update Guide")
    canvas.drawRightString(PAGE_W - MARGIN, 30, str(doc.page))
    canvas.restoreState()


def on_first_page(canvas, doc):
    draw_cover_header(canvas, doc)
    draw_footer(canvas, doc)


def on_later_pages(canvas, doc):
    draw_running_header(canvas, doc)
    draw_footer(canvas, doc)


# --- content -------------------------------------------------------------


def build_story():
    # Page 1 gets the tall cover banner; every page after it gets the slim
    # running header instead.
    story = [NextPageTemplate("body")]

    story.append(
        para(
            "The Installation Dashboard replaces the installation scheduling "
            "spreadsheet. Customer details, payment status, panel and inverter "
            "specs, addresses and SEDA status come across automatically from the "
            "sales system \u2014 you do not type any of that in. What you record "
            "here is the operational side: installation dates, customer "
            "confirmation, teams, stock and delivery.",
            "lead",
        )
    )
    story.append(
        para(
            "It installs like a normal Windows program. There is no website to "
            "log into and no link to remember."
        )
    )

    # Part 1 — installing
    story.append(eyebrow("Part 1"))
    story.append(h2("Part 1 \u2014 Installing"))
    story.append(
        para(
            "Set aside about 5 minutes. You need a Windows PC (Windows 10 or 11) "
            "and an internet connection. There is nothing to install beforehand "
            "\u2014 the app brings everything it needs with it."
        )
    )

    story.append(h3("Step 1 \u2014 Download"))
    story.append(
        para(
            f"Go to the {link('Installation System download page', RELEASES_URL)}, "
            "scroll down to the <b>Assets</b> list, and click the file named:"
        )
    )
    story.append(code_block(f"Installation-System-Setup-{VERSION}.exe"))
    story.append(Spacer(1, 10))
    story.append(
        para(
            "It will go to your <b>Downloads</b> folder unless you choose "
            "somewhere else."
        )
    )

    story.append(h3("Step 2 \u2014 Install"))
    story.append(para("Double-click the file you just downloaded."))
    story.append(
        callout(
            "You will see a blue warning screen. This is normal.",
            [
                "Windows shows <b>\u201cWindows protected your PC\u201d</b> because "
                "this is an internal company app and not something sold in a shop. "
                "It does not mean the file is unsafe.",
                "Click <b>More info</b>, then click <b>Run anyway</b>. If you do "
                "not see \u201cRun anyway\u201d, make sure you clicked "
                "<b>More info</b> first.",
            ],
        )
    )
    story.append(Spacer(1, 11))
    story.append(
        para(
            "Click <b>Next</b> through the screens, tick <b>Create a desktop "
            "shortcut</b> if you would like one, then click <b>Install</b>. When "
            "it is done you will have an <b>Installation System</b> shortcut on "
            "your desktop and in the Start Menu."
        )
    )

    story.append(h3("Step 3 \u2014 Open it for the first time"))
    story.append(
        para(
            "Double-click the desktop shortcut. The first time you open it, the "
            "window may stay blank or white for a few seconds while it starts up. "
            "This is normal and only happens on the first launch \u2014 later "
            "launches are faster."
        )
    )
    story.append(
        para(
            "You should then see the dashboard, with today's date and "
            "<b>Malaysia time</b> at the top. There are no keys to paste in and "
            "no login to create. <b>You are done.</b>"
        )
    )

    story.append(PageBreak())

    # Step 4 — the connection check
    story.append(eyebrow("Check this every time"))
    story.append(h2("Step 4 \u2014 Check you are seeing real customers"))
    story.append(
        para(
            "<b>Do this every time you open the app. It takes two seconds.</b> "
            "Look at the connection dot in the top right of the screen, and at "
            "the customer names below it."
        )
    )
    story.append(
        data_table(
            ["What you see", "What it means", "What to do"],
            [
                [
                    "<b>Live source</b> and names you recognise",
                    "Connected. Everything is fine.",
                    "Carry on working",
                ],
                [
                    "<b>Demo source</b>, or <b>DEMO CUSTOMER ONE / TWO / THREE</b>",
                    "<b>Not connected.</b> These are fake examples.",
                    "Stop. See below.",
                ],
            ],
            widths=[CONTENT_W * 0.34, CONTENT_W * 0.36, CONTENT_W * 0.30],
        )
    )
    story.append(Spacer(1, 12))
    story.append(
        callout(
            "If you see the DEMO CUSTOMER names",
            [
                "The app cannot reach the database, and there will be a warning "
                "message across the top of the screen.",
                "<b>Anything you type while in this state will not be saved.</b> "
                "Close the app, check your internet connection, and open it again. "
                "If the demo names are still there, contact Nurul \u2014 do not "
                "carry on working.",
            ],
        )
    )

    # Finding your way around
    story.append(eyebrow("The four tabs"))
    story.append(h2("Finding your way around"))

    story.append(h3("Active pipeline"))
    story.append(
        para(
            "Your main working screen \u2014 every customer who is ready for "
            "installation, one row each. Customers appear here automatically once "
            "they reach <b>59% payment</b>. You do not add them yourself. Click "
            "any customer row to open their full record."
        )
    )
    story.append(
        bullets(
            [
                "<b>All active jobs</b> \u2014 everything currently in progress",
                "<b>New / ready to schedule</b> \u2014 customers who have just "
                "arrived and need a date",
                "<b>Needs attention</b> \u2014 jobs with something blocking them",
                "<b>All states</b> \u2014 filter by state (Johor, Selangor and so on)",
            ]
        )
    )

    story.append(h3("Team planning"))
    story.append(
        para(
            "Where you plan which customers to install together. The app suggests "
            "groups of nearby customers based on township \u2014 for example all "
            "the Mount Austin jobs together. You choose a planning range, review "
            "the suggestion, and confirm it before anything is created. "
            "<b>Nothing is grouped automatically without you agreeing to it.</b>"
        )
    )
    story.append(
        para(
            "A group holds a maximum of five customers per day. You can also add "
            "any customer manually through the search box if the suggestion missed "
            "them. Customers who tell you they are not available are moved to a "
            "<b>Customer unavailable</b> list and their slot is freed for someone "
            "else; they come back to planning once they confirm a new date."
        )
    )

    story.append(h3("Installation groups"))
    story.append(
        para(
            "Your installation groups and the team directory. A group is one day's "
            "work in one area \u2014 it has a date, an area, an installation team, "
            "a wiring team and a supervisor. Change the group's date or team here "
            "and <b>every customer in that group updates automatically</b>. You do "
            "not need to edit each customer one by one."
        )
    )
    story.append(
        para(
            "The team directory is on this screen too. Add teams, their members, "
            "contact numbers and base location, and set which township each team "
            "is working in for the week."
        )
    )

    story.append(h3("Stock delivery"))
    story.append(
        para(
            "Delivery runs \u2014 a van going out on a date, to an area, from a "
            "warehouse. Set the run's date, warehouse, driver (PIC) and contact, "
            "and link customer groups to it. Track each delivery from pending "
            "stock, to in transit, to delivered."
        )
    )

    # Customer record
    story.append(eyebrow("Inside a job"))
    story.append(h2("Understanding a customer record"))
    story.append(
        para(
            "Click any customer in the Active pipeline to open their record. At "
            "the top you will see five checks:"
        )
    )
    story.append(
        data_table(
            ["Check", "Green when", "What it tells you"],
            [
                ["<b>Payment</b>", "59% or above",
                 "Customer has paid enough to install"],
                ["<b>SEDA</b>", "Approved", "SEDA approval has come through"],
                ["<b>Stock</b>", "Delivered", "Materials have arrived"],
                ["<b>Date</b>", "A date is set", "Installation date is arranged"],
                ["<b>Teams</b>", "At least one assigned",
                 "Someone is booked to do the work"],
            ],
            widths=[CONTENT_W * 0.20, CONTENT_W * 0.28, CONTENT_W * 0.52],
        )
    )
    story.append(Spacer(1, 12))
    story.append(
        para(
            "A job is only truly <b>Ready to install</b> when all five are "
            "satisfied. If a job is not ready, these five checks tell you exactly "
            "which one is holding it up \u2014 so you never have to guess."
        )
    )
    story.append(
        para(
            "Inside the record you can set the installation date, record whether "
            "the customer confirmed, add remarks, enter stock details, and assign "
            "teams. <b>Team assignments</b> take as many rows as you need; each "
            "row has a role (Roof / panel, Wiring / electrical, Battery / "
            "inverter, or Site supervisor) and an activity:"
        )
    )
    story.append(
        bullets(
            [
                "Hooks and rails structure at roof",
                "PV panel installation work",
                "DC &amp; AC cable trunking / casing / conduit works",
                "Earthing cable mounted to PV structure",
                "Other (you type the description)",
            ]
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        para(
            "<b>The SLD drawing</b> opens inside the record \u2014 you can view it "
            "on screen, no need to go looking for the file separately."
        )
    )

    # Part 2 — updating
    story.append(eyebrow("Part 2"))
    story.append(h2("Part 2 \u2014 Updating"))
    story.append(
        para(
            "<b>Short version: you don't have to do anything.</b> The app checks "
            "for new versions by itself and tells you when one is ready."
        )
    )
    story.append(h3("When an update is ready"))
    story.append(
        para(
            "An <b>Install Update</b> button appears in the <b>top bar</b>, next "
            "to <i>Check for new jobs</i>, showing the new version number."
        )
    )
    story.append(
        steps(
            [
                "Click <b>Install Update</b>.",
                "Wait. The button shows the download progress, then the app closes "
                "and reopens by itself on the new version. This takes a minute or two.",
                "<b>Do not close the window while it is working.</b>",
            ]
        )
    )
    story.append(Spacer(1, 10))
    story.append(
        callout(
            "Things worth knowing",
            [
                "<b>Nothing of yours is lost.</b> All your data lives in the "
                "shared database \u2014 an update only replaces the program itself.",
                "<b>You never download the installer again.</b> Steps 1\u20133 "
                "above are one time only.",
                "<b>If an update fails</b>, the app keeps working on the current "
                "version. Tell Nurul so it can be looked into.",
            ],
            accent=BLUE,
            background=BLUE_BG,
        )
    )

    # Common questions
    story.append(eyebrow("Common questions"))
    story.append(h2("Common questions"))
    story.append(
        data_table(
            ["Question", "Answer"],
            [
                [
                    "<b>Do I need to save?</b>",
                    "Your changes go to the shared database when you save the "
                    "record. Watch for the confirmation message. If you are not "
                    "sure a change went through, close the record and open it "
                    "again to check.",
                ],
                [
                    "<b>Will my colleague see my updates?</b>",
                    "Yes. The app runs on your PC, but everyone shares the same "
                    "database. If two of you have it open, you are working on the "
                    "same jobs. Refresh to see each other's latest changes.",
                ],
                [
                    "<b>A customer is missing.</b>",
                    "Check your filter first \u2014 you may be on <b>New / ready "
                    "to schedule</b> rather than <b>All active jobs</b>. If they "
                    "are genuinely missing, tell Nurul; do not add them manually "
                    "somewhere else.",
                ],
                [
                    "<b>A customer paid but is not showing.</b>",
                    "Customers appear at 59% payment. Below that they need "
                    "management approval as a special case.",
                ],
                [
                    "<b>Can I use it at home / on site?</b>",
                    "Yes, as long as you have internet. It does not need to be on "
                    "the office network.",
                ],
            ],
            widths=[CONTENT_W * 0.32, CONTENT_W * 0.68],
        )
    )

    # Troubleshooting
    story.append(eyebrow("Troubleshooting"))
    story.append(h2("If something goes wrong"))
    story.append(
        data_table(
            ["What you see", "What to do"],
            [
                [
                    "Blue \u201cWindows protected your PC\u201d screen",
                    "Normal. Click <b>More info</b> \u2192 <b>Run anyway</b>",
                ],
                [
                    "Window is blank or white",
                    "Wait 10 seconds. If still blank, close it completely and reopen",
                ],
                [
                    "Seeing DEMO CUSTOMER names",
                    "Not connected. Check internet, reopen. Do not enter any data",
                ],
                [
                    "Warning bar across the top",
                    "Read it \u2014 it explains what is not working",
                ],
                ["App will not start at all", "Restart your PC, then try again"],
                [
                    "An update failed",
                    "Tell Nurul \u2014 the app keeps working on the current version",
                ],
                [
                    "Anything else",
                    "Contact Nurul. Say what you were doing and what you saw",
                ],
            ],
            widths=[CONTENT_W * 0.38, CONTENT_W * 0.62],
        )
    )
    # Kept together so the closing note never orphans onto a page of its own.
    story.append(
        KeepTogether(
            [
                Spacer(1, 14),
                callout(
                    "Please report problems rather than working around them.",
                    [
                        "In these early weeks, issues get fixed quickly \u2014 but "
                        "only if someone says something. If you find yourself going "
                        "back to Excel to get something done, that is exactly the "
                        "thing worth reporting.",
                        "<b>Nurul</b> \u2014 for anything about the app: problems, "
                        "questions, missing customers, or suggestions for what "
                        "would make it easier to use.",
                    ],
                    accent=BLUE,
                    background=BLUE_BG,
                ),
                Spacer(1, 14),
                para(
                    f"<font color='#64748B' size='9'>This is version {VERSION}. "
                    "Nothing is stored on your PC \u2014 all data lives in the "
                    "shared database, so there is nothing to back up and nothing "
                    "lost if your PC is replaced. To uninstall: Settings \u2192 "
                    "Apps \u2192 Installation System \u2192 Uninstall.</font>"
                ),
            ]
        )
    )

    return story


def main():
    global S
    register_fonts()
    S = build_styles()

    OUT.parent.mkdir(parents=True, exist_ok=True)

    doc = BaseDocTemplate(
        str(OUT),
        pagesize=A4,
        title="Installation Dashboard \u2014 Install & Update Guide",
        author="Eternalgy",
        subject="Installation System user guide",
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=MARGIN,
    )

    cover_frame = Frame(
        MARGIN,
        46,
        CONTENT_W,
        PAGE_H - HEADER_H - 46 - 22,
        id="cover",
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
    )
    body_frame = Frame(
        MARGIN,
        46,
        CONTENT_W,
        PAGE_H - BANNER_H - 46 - 26,
        id="body",
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
    )

    doc.addPageTemplates(
        [
            PageTemplate(id="cover", frames=[cover_frame], onPage=on_first_page),
            PageTemplate(id="body", frames=[body_frame], onPage=on_later_pages),
        ]
    )

    doc.build(build_story())
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
