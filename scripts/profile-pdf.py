#!/usr/bin/env python3

import base64
import html
import io
import json
import os
import sys
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Flowable, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


GREEN = colors.HexColor("#197A52")
GREEN_DARK = colors.HexColor("#0F4F36")
GREEN_SOFT = colors.HexColor("#EDF7F1")
NAVY = colors.HexColor("#112A23")
INK = colors.HexColor("#17231E")
MUTED = colors.HexColor("#66736D")
BORDER = colors.HexColor("#D9E6DF")
SURFACE = colors.HexColor("#F8FBF9")
AMBER = colors.HexColor("#B56D12")
LOGO_PATH = ""


def register_fonts():
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            pdfmetrics.registerFont(TTFont("AmirosSans", path))
            return "AmirosSans"
    return "Helvetica"


FONT = register_fonts()


def clean_text(value):
    return (str(value or "").replace("\u2010", "-").replace("\u2011", "-")
            .replace("\u2012", "-").replace("\u2013", "-").replace("\u2014", "-")
            .replace("\u2212", "-").strip())


def safe(value):
    return html.escape(clean_text(value)).replace("\n", "<br/>")


def format_date(value):
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).strftime("%B %d, %Y at %H:%M")
    except Exception:
        return clean_text(value)


class ProfileAvatar(Flowable):
    def __init__(self, name, image_payload=None, size=28 * mm):
        super().__init__()
        self.width = self.height = size
        self.name = clean_text(name)
        self.reader = None
        try:
            encoded = (image_payload or {}).get("data")
            if encoded:
                self.reader = ImageReader(io.BytesIO(base64.b64decode(encoded)))
        except Exception:
            self.reader = None

    def draw(self):
        radius = self.width / 2
        self.canv.saveState()
        path = self.canv.beginPath()
        path.circle(radius, radius, radius)
        self.canv.clipPath(path, stroke=0, fill=0)
        if self.reader:
            source_width, source_height = self.reader.getSize()
            scale = max(self.width / source_width, self.height / source_height)
            draw_width, draw_height = source_width * scale, source_height * scale
            self.canv.drawImage(self.reader, (self.width - draw_width) / 2, (self.height - draw_height) / 2,
                                width=draw_width, height=draw_height, mask="auto")
        else:
            self.canv.setFillColor(GREEN_SOFT)
            self.canv.rect(0, 0, self.width, self.height, fill=1, stroke=0)
            initials = "".join(part[:1] for part in self.name.split()[:2]).upper() or "A"
            self.canv.setFillColor(GREEN_DARK)
            self.canv.setFont(FONT, 13)
            self.canv.drawCentredString(radius, radius - 4, initials)
        self.canv.restoreState()
        self.canv.setStrokeColor(BORDER)
        self.canv.setLineWidth(0.8)
        self.canv.circle(radius, radius, radius, fill=0, stroke=1)


def draw_page(canvas, document):
    width, height = A4
    canvas.saveState()
    if LOGO_PATH and os.path.exists(LOGO_PATH):
        canvas.drawImage(LOGO_PATH, 18 * mm, height - 27 * mm, width=18 * mm, height=18 * mm,
                         preserveAspectRatio=True, anchor="c", mask="auto")
    canvas.setFillColor(INK)
    canvas.setFont(FONT, 16)
    canvas.drawString(35 * mm, height - 18.5 * mm, "AmirOS")
    canvas.setFillColor(MUTED)
    canvas.setFont(FONT, 8)
    canvas.drawString(35 * mm, height - 23 * mm, "Private relationship intelligence")
    canvas.setStrokeColor(BORDER)
    canvas.line(18 * mm, height - 30 * mm, width - 18 * mm, height - 30 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont(FONT, 7.5)
    canvas.drawString(18 * mm, 12 * mm, "Private analysis generated locally by AmirOS")
    canvas.drawRightString(width - 18 * mm, 12 * mm, f"Page {document.page}")
    canvas.restoreState()


def build_pdf(payload):
    global LOGO_PATH
    LOGO_PATH = clean_text(payload.get("logoPath"))
    output = io.BytesIO()
    document = SimpleDocTemplate(
        output, pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm,
        topMargin=37 * mm, bottomMargin=20 * mm,
        title=f"AmirOS profile - {clean_text(payload.get('contactName'))}",
        author="AmirOS", subject="Private relationship profile analysis",
    )
    styles = getSampleStyleSheet()
    body = ParagraphStyle("Body", parent=styles["BodyText"], fontName=FONT, fontSize=9.6,
                          leading=14.2, textColor=INK, spaceAfter=2.2 * mm)
    title = ParagraphStyle("ProfileTitle", parent=body, fontSize=24, leading=28,
                           textColor=INK, spaceAfter=1.4 * mm)
    subtitle = ParagraphStyle("Subtitle", parent=body, fontSize=9, leading=13, textColor=MUTED)
    eyebrow = ParagraphStyle("Eyebrow", parent=body, fontSize=7.7, leading=9, textColor=GREEN,
                             spaceAfter=1.5 * mm)
    section = ParagraphStyle("Section", parent=body, fontSize=13, leading=17, textColor=GREEN_DARK,
                             spaceBefore=5 * mm, spaceAfter=2.5 * mm)
    subsection = ParagraphStyle("Subsection", parent=body, fontSize=10.5, leading=14,
                                textColor=NAVY, spaceBefore=2.5 * mm, spaceAfter=1.5 * mm)
    bullet = ParagraphStyle("Bullet", parent=body, leftIndent=4 * mm, firstLineIndent=-3 * mm,
                            bulletIndent=0, spaceAfter=1.3 * mm)
    small = ParagraphStyle("Small", parent=body, fontSize=8, leading=11.5, textColor=MUTED)
    metric = ParagraphStyle("Metric", parent=body, fontSize=15, leading=18, textColor=GREEN_DARK)

    contact_name = clean_text(payload.get("contactName")) or "WhatsApp contact"
    profile_kind = "GROUP RELATIONSHIP PROFILE" if payload.get("isGroup") else "PRIVATE CONTACT PROFILE"
    hero_copy = [
        Paragraph(profile_kind, eyebrow),
        Paragraph(safe(contact_name), title),
        Paragraph(f"{safe(payload.get('relationship') or 'Contact')} | {safe(payload.get('tone') or 'Automatic')} tone | {safe(payload.get('language') or 'Automatic')}", subtitle),
    ]
    hero = Table([[ProfileAvatar(contact_name, payload.get("profileImage")), hero_copy]], colWidths=[35 * mm, 127 * mm])
    hero.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SURFACE), ("BOX", (0, 0), (-1, -1), 0.7, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (0, 0), 8),
        ("RIGHTPADDING", (0, 0), (0, 0), 8), ("LEFTPADDING", (1, 0), (1, 0), 12),
        ("RIGHTPADDING", (1, 0), (1, 0), 12), ("TOPPADDING", (0, 0), (-1, -1), 11),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 11),
    ]))

    source_count = int(payload.get("sourceMessageCount") or 0)
    manual_items = payload.get("manualMemory") or []
    insights = payload.get("insights") or []
    commitments = payload.get("commitments") or []
    metrics = Table([[Paragraph(f"<b>{source_count}</b><br/><font size='8' color='#66736D'>tracked messages</font>", metric),
                      Paragraph(f"<b>{len(insights)}</b><br/><font size='8' color='#66736D'>active insights</font>", metric),
                      Paragraph(f"<b>{len(commitments)}</b><br/><font size='8' color='#66736D'>open commitments</font>", metric)]],
                    colWidths=[54 * mm, 54 * mm, 54 * mm])
    metrics.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), GREEN_SOFT), ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, BORDER), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"), ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))

    story = [hero, Spacer(1, 4 * mm), metrics, Paragraph("Profile analysis", section)]
    for raw_line in clean_text(payload.get("summary")).splitlines():
        line = raw_line.strip()
        if not line:
            story.append(Spacer(1, 1.2 * mm))
        elif line.startswith(("-", "•", "*")):
            story.append(Paragraph(f"- {safe(line[1:].strip())}", bullet))
        elif len(line) <= 75 and not line.endswith((".", "!", "?", ":")):
            story.append(Paragraph(f"<b>{safe(line)}</b>", subsection))
        else:
            story.append(Paragraph(safe(line), body))

    if insights:
        rows = [[Paragraph("Signal", small), Paragraph("Evidence-backed detail", small), Paragraph("Confidence", small)]]
        for item in insights[:16]:
            evidence = item.get("evidence") or {}
            detail = f"<b>{safe(item.get('content'))}</b><br/><font size='7.5' color='#66736D'>{safe(evidence.get('senderName') or contact_name)}: {safe(evidence.get('excerpt'))}</font>"
            rows.append([Paragraph(safe(item.get("kind", "fact")).replace("_", " ").title(), small), Paragraph(detail, body), Paragraph(f"{round(float(item.get('confidence') or 0) * 100)}%", small)])
        table = Table(rows, colWidths=[28 * mm, 112 * mm, 22 * mm], repeatRows=1)
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), NAVY), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.45, BORDER), ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SURFACE]),
        ]))
        story.extend([Paragraph("Relationship intelligence", section), table])

    if commitments:
        block = [Paragraph("Open commitments", section)]
        for item in commitments:
            owner = "Amir" if item.get("owner") == "me" else clean_text(item.get("assigneeName")) or "Contact"
            block.append(Paragraph(f"- <b>{safe(owner)}</b>: {safe(item.get('content'))}", bullet))
        story.append(KeepTogether(block))

    style_profile = payload.get("styleProfile") or {}
    if style_profile:
        style_rows = [[Paragraph("Message length", small), Paragraph("Emoji use", small), Paragraph("Formality", small)],
                      [Paragraph(safe(style_profile.get("messageLength")), body), Paragraph(safe(style_profile.get("emojiUse")), body), Paragraph(safe(style_profile.get("formality")), body)]]
        style_table = Table(style_rows, colWidths=[54 * mm, 54 * mm, 54 * mm])
        style_table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), SURFACE), ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
                                         ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 8),
                                         ("RIGHTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 7),
                                         ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
        style_block = [Paragraph("Communication style", section), Paragraph(safe(style_profile.get("summary")), body), style_table]
        style_block.extend(Paragraph(f"- {safe(guidance)}", bullet) for guidance in style_profile.get("replyGuidance") or [])
        story.append(KeepTogether(style_block))

    group_summary = payload.get("groupSummary") or {}
    if group_summary:
        story.extend([Paragraph("Group dynamics", section), Paragraph(safe(group_summary.get("summary")), body)])
        for heading, key in [("Decisions", "decisions"), ("Tasks", "tasks"), ("Open questions", "unansweredQuestions")]:
            values = group_summary.get(key) or []
            if values:
                story.append(Paragraph(f"<b>{heading}</b>", subsection))
                story.extend(Paragraph(f"- {safe(item)}", bullet) for item in values)

    if manual_items:
        memory_content = [Paragraph("Operator-saved memory", section)]
        memory_content.extend(Paragraph(f"- {safe(item)}", bullet) for item in manual_items)
        story.append(KeepTogether(memory_content))

    generated_at = format_date(payload.get("generatedAt"))
    note = (f"<b>Analysis details</b><br/>Generated {safe(generated_at)} from {source_count} tracked incoming messages "
            f"and {len(manual_items)} manual memory items. Inferences are evidence-backed where available, but may still be incomplete and should be reviewed.")
    story.extend([Spacer(1, 5 * mm), Table([[Paragraph(note, small)]], colWidths=[162 * mm], style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SURFACE), ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 11), ("RIGHTPADDING", (0, 0), (-1, -1), 11),
        ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))])

    document.build(story, onFirstPage=draw_page, onLaterPages=draw_page)
    return output.getvalue()


def main():
    payload = json.load(sys.stdin)
    sys.stdout.buffer.write(build_pdf(payload))


if __name__ == "__main__":
    main()
