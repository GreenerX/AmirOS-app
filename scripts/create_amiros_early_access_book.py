#!/usr/bin/env python3
"""Build the AmirOS early-access marketing product book."""

from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image, ImageOps
from reportlab.lib.colors import Color, HexColor, white
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
MARKETING = ROOT / "output" / "marketing"
PDF_OUTPUT = ROOT / "output" / "pdf"
SCREENSHOTS = MARKETING / "screenshots"
VISUALS = MARKETING / "visuals"
BRAND = ROOT / "design" / "brand"

OUT = MARKETING / "AmirOS_Early_Access_Product_Book.pdf"
OUT_COPY = PDF_OUTPUT / "AmirOS_Early_Access_Product_Book.pdf"

PAGE_W = 960
PAGE_H = 540

INK = HexColor("#102A32")
FOREST = HexColor("#123E31")
FOREST_DARK = HexColor("#0B2D25")
GREEN = HexColor("#2E8B68")
MINT = HexColor("#6EE7B7")
MINT_PALE = HexColor("#EAF8F1")
PAPER = HexColor("#F5F8F6")
WARM_WHITE = HexColor("#FCFDFB")
STONE = HexColor("#DDE6E2")
SLATE = HexColor("#657A80")
GOLD = HexColor("#C99957")
BLUE = HexColor("#2B6F8B")
SOFT_BLUE = HexColor("#EAF4F8")

LIFESTYLE_HOME = VISUALS / "AmirOS_Product_In_Use_Home_Office.png"
LIFESTYLE_EXEC = VISUALS / "AmirOS_Product_In_Use_Executive.png"
OVERVIEW = SCREENSHOTS / "01_AmirOS_Overview.png"
INBOX = SCREENSHOTS / "02_AmirOS_Inbox.png"
BRIEFING = SCREENSHOTS / "03_AmirOS_Intelligence_Briefing.png"
KNOWLEDGE = SCREENSHOTS / "04_AmirOS_Knowledge.png"
CALENDAR = SCREENSHOTS / "05_AmirOS_Calendar.png"
ASK = SCREENSHOTS / "06_Ask_AmirOS.png"
SETTINGS = SCREENSHOTS / "AmirOS_Assistant_Controls.png"
LOGO = MARKETING / "amiros-mark-v2-cropped.png"


def register_fonts() -> None:
    candidates = {
        "AmirBody": Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
        "AmirBodyBold": Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
        "AmirDisplay": Path("/System/Library/Fonts/Supplemental/Arial Black.ttf"),
        "AmirItalic": Path("/System/Library/Fonts/Supplemental/Arial Italic.ttf"),
    }
    for name, path in candidates.items():
        if path.exists():
            pdfmetrics.registerFont(TTFont(name, str(path)))


register_fonts()
BODY = "AmirBody" if "AmirBody" in pdfmetrics.getRegisteredFontNames() else "Helvetica"
BOLD = "AmirBodyBold" if "AmirBodyBold" in pdfmetrics.getRegisteredFontNames() else "Helvetica-Bold"
DISPLAY = "AmirDisplay" if "AmirDisplay" in pdfmetrics.getRegisteredFontNames() else BOLD
ITALIC = "AmirItalic" if "AmirItalic" in pdfmetrics.getRegisteredFontNames() else "Helvetica-Oblique"


def set_alpha(c: canvas.Canvas, fill: float | None = None, stroke: float | None = None) -> None:
    if fill is not None and hasattr(c, "setFillAlpha"):
        c.setFillAlpha(fill)
    if stroke is not None and hasattr(c, "setStrokeAlpha"):
        c.setStrokeAlpha(stroke)


def fit_image(path: Path, width: int, height: int, *, contain: bool = False) -> ImageReader:
    with Image.open(path) as src:
        image = src.convert("RGB")
        target = (max(1, width), max(1, height))
        if contain:
            fitted = ImageOps.contain(image, target, method=Image.Resampling.LANCZOS)
            backdrop = Image.new("RGB", target, "white")
            backdrop.paste(fitted, ((target[0] - fitted.width) // 2, (target[1] - fitted.height) // 2))
            image = backdrop
        else:
            image = ImageOps.fit(image, target, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
        return ImageReader(image.copy())


def draw_cover_image(c: canvas.Canvas, path: Path, x: float, y: float, w: float, h: float) -> None:
    c.drawImage(fit_image(path, int(w * 2), int(h * 2)), x, y, w, h, mask="auto")


def rounded_clip(c: canvas.Canvas, x: float, y: float, w: float, h: float, radius: float):
    path = c.beginPath()
    path.roundRect(x, y, w, h, radius)
    c.clipPath(path, stroke=0, fill=0)


def draw_logo(c: canvas.Canvas, x: float, y: float, size: float, *, wordmark: bool = True, light: bool = False) -> None:
    c.setFillColor(WARM_WHITE)
    c.roundRect(x, y, size, size, size * 0.22, stroke=0, fill=1)
    padding = size * 0.08
    c.drawImage(str(LOGO), x + padding, y + padding, size - padding * 2, size - padding * 2, mask="auto")
    if wordmark:
        c.setFillColor(white if light else INK)
        c.setFont(DISPLAY, size * 0.56)
        c.drawString(x + size + 10, y + size * 0.27, "AmirOS")


def wrap_lines(text: str, font: str, size: float, max_width: float) -> list[str]:
    lines: list[str] = []
    for paragraph in text.split("\n"):
        words = paragraph.split()
        if not words:
            lines.append("")
            continue
        current = words[0]
        for word in words[1:]:
            candidate = f"{current} {word}"
            if pdfmetrics.stringWidth(candidate, font, size) <= max_width:
                current = candidate
            else:
                lines.append(current)
                current = word
        lines.append(current)
    return lines


def draw_text(
    c: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    width: float,
    *,
    font: str = BODY,
    size: float = 12,
    color=INK,
    leading: float | None = None,
    max_lines: int | None = None,
) -> float:
    lines = wrap_lines(text, font, size, width)
    if max_lines is not None and len(lines) > max_lines:
        lines = lines[:max_lines]
        while lines and pdfmetrics.stringWidth(lines[-1] + "...", font, size) > width:
            lines[-1] = lines[-1][:-1]
        if lines:
            lines[-1] += "..."
    line_height = leading or size * 1.28
    c.setFillColor(color)
    c.setFont(font, size)
    cursor = y
    for line in lines:
        c.drawString(x, cursor, line)
        cursor -= line_height
    return cursor


def pill(c: canvas.Canvas, text: str, x: float, y: float, *, fill=MINT_PALE, color=FOREST, width: float | None = None) -> float:
    c.setFont(BOLD, 8)
    calculated = pdfmetrics.stringWidth(text, BOLD, 8) + 20
    w = width or calculated
    c.setFillColor(fill)
    c.roundRect(x, y, w, 22, 11, stroke=0, fill=1)
    c.setFillColor(color)
    c.drawCentredString(x + w / 2, y + 7, text.upper())
    return w


def shadow_card(c: canvas.Canvas, x: float, y: float, w: float, h: float, radius: float = 18, fill=WARM_WHITE) -> None:
    c.saveState()
    set_alpha(c, fill=0.12)
    c.setFillColor(INK)
    c.roundRect(x + 5, y - 7, w, h, radius, stroke=0, fill=1)
    c.restoreState()
    c.setFillColor(fill)
    c.roundRect(x, y, w, h, radius, stroke=0, fill=1)
    c.setStrokeColor(STONE)
    c.setLineWidth(0.8)
    c.roundRect(x, y, w, h, radius, stroke=1, fill=0)


def screenshot_card(c: canvas.Canvas, path: Path, x: float, y: float, w: float, h: float, *, radius: float = 16) -> None:
    shadow_card(c, x, y, w, h, radius, WARM_WHITE)
    pad = 7
    c.saveState()
    rounded_clip(c, x + pad, y + pad, w - pad * 2, h - pad * 2, max(6, radius - 5))
    c.drawImage(
        fit_image(path, int((w - pad * 2) * 2), int((h - pad * 2) * 2)),
        x + pad,
        y + pad,
        w - pad * 2,
        h - pad * 2,
        mask="auto",
    )
    c.restoreState()


def overlay_screenshot_logo(
    c: canvas.Canvas,
    x: float,
    y: float,
    w: float,
    h: float,
    *,
    source_x: float,
    source_y: float,
    source_w: float,
    source_h: float,
    padding_ratio: float = 0.08,
) -> None:
    """Place the canonical AmirOS mark over a branded area in a 1280x720 capture."""
    pad = 7
    inner_x = x + pad
    inner_y = y + pad
    inner_w = w - pad * 2
    inner_h = h - pad * 2
    mark_x = inner_x + (source_x / 1280) * inner_w
    mark_y = inner_y + ((720 - source_y - source_h) / 720) * inner_h
    mark_w = (source_w / 1280) * inner_w
    mark_h = (source_h / 720) * inner_h
    radius = min(mark_w, mark_h) * 0.17
    c.setFillColor(WARM_WHITE)
    c.roundRect(mark_x, mark_y, mark_w, mark_h, radius, stroke=0, fill=1)
    logo_pad = min(mark_w, mark_h) * padding_ratio
    c.drawImage(
        str(LOGO),
        mark_x + logo_pad,
        mark_y + logo_pad,
        mark_w - logo_pad * 2,
        mark_h - logo_pad * 2,
        mask="auto",
    )


def overlay_sidebar_logo(c: canvas.Canvas, x: float, y: float, w: float, h: float) -> None:
    overlay_screenshot_logo(
        c,
        x,
        y,
        w,
        h,
        source_x=19,
        source_y=25,
        source_w=44,
        source_h=44,
        padding_ratio=0.10,
    )


def overlay_inbox_media_logo(c: canvas.Canvas, x: float, y: float, w: float, h: float) -> None:
    overlay_screenshot_logo(
        c,
        x,
        y,
        w,
        h,
        source_x=398,
        source_y=165,
        source_w=360,
        source_h=360,
        padding_ratio=0.06,
    )


def small_rule(c: canvas.Canvas, x: float, y: float, w: float, color=MINT) -> None:
    c.setStrokeColor(color)
    c.setLineWidth(4)
    c.setLineCap(1)
    c.line(x, y, x + w, y)


def page_footer(c: canvas.Canvas, page: int, *, light: bool = False) -> None:
    color = Color(1, 1, 1, alpha=0.72) if light else SLATE
    c.setFillColor(color)
    c.setFont(BODY, 7.5)
    c.drawString(36, 20, "AMIROS EARLY ACCESS  /  PRIVATE BETA")
    c.drawRightString(PAGE_W - 36, 20, f"{page:02d}  -  © 2026 Amir Friedman")


def page_header(c: canvas.Canvas, eyebrow: str, title: str, subtitle: str, page: int) -> None:
    c.setFillColor(PAPER)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    c.setFillColor(GREEN)
    c.setFont(BOLD, 8)
    c.drawString(44, 496, eyebrow.upper())
    c.setFillColor(INK)
    c.setFont(DISPLAY, 29)
    c.drawString(44, 455, title)
    draw_text(c, subtitle, 44, 426, 820, font=BODY, size=12, color=SLATE, leading=16, max_lines=2)
    page_footer(c, page)


def benefit_card(c: canvas.Canvas, number: str, title: str, copy: str, x: float, y: float, w: float, color=GREEN) -> None:
    shadow_card(c, x, y, w, 78, 14, WARM_WHITE)
    c.setFillColor(color)
    c.circle(x + 27, y + 51, 15, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont(BOLD, 10)
    c.drawCentredString(x + 27, y + 47, number)
    c.setFillColor(INK)
    c.setFont(BOLD, 12)
    c.drawString(x + 51, y + 53, title)
    draw_text(c, copy, x + 51, y + 35, w - 68, size=8.5, color=SLATE, leading=11, max_lines=2)


def build() -> None:
    MARKETING.mkdir(parents=True, exist_ok=True)
    PDF_OUTPUT.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=(PAGE_W, PAGE_H), pageCompression=1)
    c.setTitle("AmirOS Early Access Product Book")
    c.setAuthor("Amir Friedman")
    c.setSubject("Early-customer marketing overview for AmirOS")

    # 1 - Cover
    draw_cover_image(c, LIFESTYLE_HOME, 0, 0, PAGE_W, PAGE_H)
    c.saveState()
    set_alpha(c, fill=0.82)
    c.setFillColor(FOREST_DARK)
    c.rect(0, 0, 500, PAGE_H, stroke=0, fill=1)
    set_alpha(c, fill=0.45)
    c.rect(500, 0, 120, PAGE_H, stroke=0, fill=1)
    c.restoreState()
    draw_logo(c, 48, 450, 42, light=True)
    pill(c, "Early access - private beta", 48, 397, fill=Color(1, 1, 1, alpha=0.14), color=white)
    c.setFillColor(white)
    c.setFont(DISPLAY, 34)
    draw_text(c, "The relationship intelligence layer for WhatsApp.", 48, 351, 420, font=DISPLAY, size=34, color=white, leading=39)
    draw_text(c, "Remember context. Reply in your own voice. Turn important conversations into useful next steps.", 48, 226, 388, font=BODY, size=14, color=HexColor("#E7F3EE"), leading=20)
    x = 48
    for label in ("Remembers context", "Replies like you", "Turns chats into action"):
        w = pill(c, label, x, 126, fill=Color(1, 1, 1, alpha=0.14), color=white)
        x += w + 8
    c.setFillColor(Color(1, 1, 1, alpha=0.78))
    c.setFont(BODY, 9)
    c.drawString(48, 84, "Built for people whose relationships, plans, and work already live in WhatsApp.")
    page_footer(c, 1, light=True)
    c.showPage()

    # 2 - Problem
    page_header(
        c,
        "THE PROBLEM",
        "Your life already happens in WhatsApp.",
        "The conversations are rich. The context is scattered. The important follow-through is easy to lose.",
        2,
    )
    benefit_card(c, "01", "Context gets buried", "Names, preferences, relationships, and previous decisions disappear into chat history.", 44, 316, 318)
    benefit_card(c, "02", "Commitments slip", "A plan, promise, or date can be obvious in the moment and invisible a week later.", 44, 222, 318, BLUE)
    benefit_card(c, "03", "Generic AI feels wrong", "A useful assistant needs to understand who is speaking, what they know, and how you sound.", 44, 128, 318, GOLD)
    screenshot_card(c, INBOX, 390, 112, 522, 294, radius=20)
    overlay_sidebar_logo(c, 390, 112, 522, 294)
    overlay_inbox_media_logo(c, 390, 112, 522, 294)
    c.setFillColor(FOREST)
    c.roundRect(430, 92, 442, 42, 13, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont(BOLD, 11)
    c.drawCentredString(651, 107, "AmirOS keeps the relationship, message, and response controls together.")
    c.showPage()

    # 3 - Overview
    c.setFillColor(FOREST_DARK)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    draw_logo(c, 44, 474, 32, light=True)
    c.setFillColor(MINT)
    c.setFont(BOLD, 8)
    c.drawString(44, 446, "THE DAILY COMMAND CENTER")
    c.setFillColor(white)
    c.setFont(DISPLAY, 29)
    c.drawString(44, 409, "See what matters before you open every chat.")
    draw_text(c, "A single view of unread conversations, the next event, saved relationship knowledge, current model usage, and the highest-priority follow-up.", 44, 384, 760, size=12, color=HexColor("#CFE3DA"), leading=16)
    screenshot_card(c, OVERVIEW, 44, 70, 872, 280, radius=18)
    for x, title in ((56, "One next action"), (280, "One source of truth"), (536, "One glance at cost"), (748, "One calm start")):
        c.setFillColor(MINT)
        c.circle(x, 48, 3.2, stroke=0, fill=1)
        c.setFillColor(white)
        c.setFont(BOLD, 9)
        c.drawString(x + 10, 45, title)
    page_footer(c, 3, light=True)
    c.showPage()

    # 4 - Intelligence
    page_header(
        c,
        "RELATIONSHIP INTELLIGENCE",
        "Remember who said what - and why it matters.",
        "Incoming messages become reviewable signals, confirmed knowledge, open commitments, and next-best actions.",
        4,
    )
    screenshot_card(c, BRIEFING, 398, 103, 518, 291, radius=18)
    overlay_sidebar_logo(c, 398, 103, 518, 291)
    small_rule(c, 44, 379, 44)
    draw_text(c, "A memory system\nwith judgment.", 44, 348, 304, font=DISPLAY, size=19, color=INK, leading=22)
    draw_text(c, "AmirOS watches for useful information without silently turning every sentence into a permanent fact.", 44, 292, 305, size=10.5, color=SLATE, leading=14)
    y = 216
    for num, title, copy in (
        ("01", "Detect", "Facts, preferences, relationships, dates, replies, and promises."),
        ("02", "Review", "See the source message and approve or dismiss the suggestion."),
        ("03", "Use", "Bring confirmed context into replies, answers, and plans."),
    ):
        c.setFillColor(MINT_PALE)
        c.roundRect(44, y - 4, 304, 54, 12, stroke=0, fill=1)
        c.setFillColor(GREEN)
        c.setFont(BOLD, 9)
        c.drawString(58, y + 28, num)
        c.setFillColor(INK)
        c.setFont(BOLD, 10.5)
        c.drawString(95, y + 28, title)
        draw_text(c, copy, 95, y + 13, 236, size=8.2, color=SLATE, leading=10, max_lines=2)
        y -= 68
    c.showPage()

    # 5 - Reply controls
    page_header(
        c,
        "PERSONALIZED REPLIES",
        "Reply like yourself, not like a chatbot.",
        "Tone, relationship, language, writing style, custom instructions, and knowledge access can be different for every chat.",
        5,
    )
    screenshot_card(c, INBOX, 44, 80, 610, 310, radius=18)
    overlay_inbox_media_logo(c, 44, 80, 610, 310)
    c.setFillColor(WARM_WHITE)
    c.roundRect(684, 80, 232, 323, 18, stroke=0, fill=1)
    c.setStrokeColor(STONE)
    c.roundRect(684, 80, 232, 323, 18, stroke=1, fill=0)
    c.setFillColor(GREEN)
    c.setFont(BOLD, 8)
    c.drawString(706, 370, "CONTROL PER CONVERSATION")
    draw_text(c, "Your voice.\nYour rules.", 706, 342, 186, font=DISPLAY, size=18, color=INK, leading=21)
    draw_text(c, "Choose how much autonomy feels right - without changing the rest of your inbox.", 706, 292, 186, size=9.5, color=SLATE, leading=13)
    y = 230
    for mode, color, copy in (
        ("SUGGEST", GOLD, "Review the draft before it sends."),
        ("AUTO", GREEN, "Reply automatically in trusted chats."),
        ("OFF", SLATE, "Only respond when explicitly triggered."),
    ):
        c.setFillColor(color)
        c.roundRect(706, y, 66, 24, 12, stroke=0, fill=1)
        c.setFillColor(white)
        c.setFont(BOLD, 8)
        c.drawCentredString(739, y + 8, mode)
        draw_text(c, copy, 782, y + 15, 110, size=8.3, color=INK, leading=10, max_lines=2)
        y -= 45
    c.setFillColor(MINT_PALE)
    c.roundRect(706, 88, 186, 42, 13, stroke=0, fill=1)
    c.setFillColor(FOREST)
    c.setFont(BOLD, 9)
    c.drawString(721, 112, "Knowledge scope")
    draw_text(c, "Grant calendar or broader memory access only where useful.", 721, 99, 156, size=7.5, color=SLATE, leading=8.5, max_lines=2)
    c.showPage()

    # 6 - Ask AmirOS
    draw_cover_image(c, LIFESTYLE_EXEC, 0, 0, PAGE_W, PAGE_H)
    c.saveState()
    set_alpha(c, fill=0.72)
    c.setFillColor(FOREST_DARK)
    c.rect(520, 0, 440, PAGE_H, stroke=0, fill=1)
    c.restoreState()
    screenshot_card(c, ASK, 44, 92, 552, 311, radius=18)
    overlay_sidebar_logo(c, 44, 92, 552, 311)
    pill(c, "ASK AMIROS", 620, 432, fill=Color(1, 1, 1, alpha=0.14), color=white)
    c.setFillColor(white)
    c.setFont(DISPLAY, 28)
    draw_text(c, "Ask across relationships and your calendar.", 620, 390, 292, font=DISPLAY, size=28, color=white, leading=34)
    draw_text(c, "Ask what needs attention, what someone prefers, or what is already planned - then continue with a natural follow-up.", 620, 285, 270, size=12, color=HexColor("#D7E8E1"), leading=17)
    for label, y in (("Contacts & chats", 205), ("Confirmed calendar", 169), ("Source-aware answers", 133)):
        c.setFillColor(MINT)
        c.circle(630, y + 4, 4, stroke=0, fill=1)
        c.setFillColor(white)
        c.setFont(BOLD, 10)
        c.drawString(645, y, label)
    page_footer(c, 6, light=True)
    c.showPage()

    # 7 - Calendar
    page_header(
        c,
        "CHAT TO CALENDAR",
        "Turn plans into events, with evidence attached.",
        "AmirOS detects a date or time, proposes a useful title, and keeps the original message available for review.",
        7,
    )
    screenshot_card(c, CALENDAR, 44, 114, 872, 286, radius=18)
    labels = (
        ("1", "Detect", "A plan appears in a message."),
        ("2", "Confirm", "Edit the title, date, or time."),
        ("3", "Use", "Save to AmirOS, Google, or Apple Calendar."),
    )
    x = 72
    for num, title, copy in labels:
        c.setFillColor(FOREST)
        c.circle(x, 73, 15, stroke=0, fill=1)
        c.setFillColor(white)
        c.setFont(BOLD, 9)
        c.drawCentredString(x, 70, num)
        c.setFillColor(INK)
        c.setFont(BOLD, 10.5)
        c.drawString(x + 26, 77, title)
        c.setFillColor(SLATE)
        c.setFont(BODY, 8.2)
        c.drawString(x + 26, 62, copy)
        x += 285
    c.showPage()

    # 8 - Control
    page_header(
        c,
        "CONTROL BY DESIGN",
        "Powerful enough to help. Explicit enough to trust.",
        "Early customers can tune the assistant instead of accepting a one-size-fits-all automation layer.",
        8,
    )
    screenshot_card(c, SETTINGS, 44, 88, 608, 312, radius=18)
    x = 682
    cards = (
        ("MODEL CHOICE", "Choose text, image, and transcription models - or use a cost preset."),
        ("ASSISTANT AVAILABILITY", "Pause the bot from settings while the linked device and app remain visible."),
        ("COLOR THEMES", "Match AmirOS to the workspace with a premium system-wide palette."),
        ("SCOPED ACCESS", "Control calendar and knowledge access per chat and per trigger source."),
    )
    y = 340
    for title, copy in cards:
        c.setFillColor(WARM_WHITE)
        c.roundRect(x, y, 234, 60, 13, stroke=0, fill=1)
        c.setStrokeColor(STONE)
        c.roundRect(x, y, 234, 60, 13, stroke=1, fill=0)
        c.setFillColor(GREEN)
        c.setFont(BOLD, 8)
        c.drawString(x + 16, y + 39, title)
        draw_text(c, copy, x + 16, y + 23, 202, size=8.2, color=SLATE, leading=10, max_lines=2)
        y -= 72
    c.showPage()

    # 9 - CTA
    draw_cover_image(c, LIFESTYLE_EXEC, 0, 0, PAGE_W, PAGE_H)
    c.saveState()
    set_alpha(c, fill=0.92)
    c.setFillColor(FOREST_DARK)
    c.rect(390, 0, 570, PAGE_H, stroke=0, fill=1)
    set_alpha(c, fill=0.50)
    c.rect(270, 0, 120, PAGE_H, stroke=0, fill=1)
    c.restoreState()
    draw_logo(c, 612, 453, 42, light=True)
    pill(c, "EARLY ACCESS", 612, 388, fill=Color(1, 1, 1, alpha=0.14), color=white)
    c.setFillColor(white)
    draw_text(c, "Remember more.\nReply better.\nKeep life moving.", 612, 348, 306, font=DISPLAY, size=31, color=white, leading=37)
    draw_text(c, "A private command center for the conversations that run your life.", 612, 206, 300, font=BODY, size=13, color=HexColor("#DDECE6"), leading=18)
    c.setFillColor(MINT)
    c.roundRect(612, 121, 282, 42, 21, stroke=0, fill=1)
    c.setFillColor(FOREST_DARK)
    c.setFont(BOLD, 10)
    c.drawCentredString(753, 136, "JOIN THE EARLY ACCESS CONVERSATION")
    c.setFillColor(Color(1, 1, 1, alpha=0.78))
    draw_text(c, "For founders, operators, consultants, and relationship-driven professionals.", 612, 92, 286, font=BODY, size=8.5, color=Color(1, 1, 1, alpha=0.78), leading=11)
    page_footer(c, 9, light=True)
    c.showPage()

    c.save()
    shutil.copyfile(OUT, OUT_COPY)
    print(OUT)
    print(OUT_COPY)


if __name__ == "__main__":
    build()
