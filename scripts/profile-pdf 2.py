#!/usr/bin/env python3

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
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


GREEN = colors.HexColor("#197A52")
GREEN_DARK = colors.HexColor("#0F4F36")
GREEN_SOFT = colors.HexColor("#EDF7F1")
INK = colors.HexColor("#17231E")
MUTED = colors.HexColor("#66736D")
BORDER = colors.HexColor("#D9E6DF")
SURFACE = colors.HexColor("#F8FBF9")
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
    return (
        str(value or "")
        .replace("\u2010", "-")
        .replace("\u2011", "-")
        .replace("\u2012", "-")
        .replace("\u2013", "-")
        .replace("\u2014", "-")
        .replace("\u2212", "-")
        .strip()
    )


def safe(value):
    return html.escape(clean_text(value)).replace("\n", "<br/>")


def format_date(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.strftime("%B %d, %Y at %H:%M")
    except Exception:
        return clean_text(value)


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
    canvas.drawString(35 * mm, height - 23 * mm, "Private contact intelligence")
    canvas.setStrokeColor(BORDER)
    canvas.line(18 * mm, height - 30 * mm, width - 18 * mm, height - 30 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont(FONT, 7.5)
    canvas.drawString(18 * mm, 12 * mm, "Private profile generated locally by AmirOS")
    canvas.drawRightString(width - 18 * mm, 12 * mm, f"Page {document.page}")
    canvas.restoreState()


def build_pdf(payload):
    global LOGO_PATH
    LOGO_PATH = clean_text(payload.get("logoPath"))
    output = io.BytesIO()
    document = SimpleDocTemplate(
        output,
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=37 * mm,
        bottomMargin=20 * mm,
        title=f"AmirOS profile - {clean_text(payload.get('contactName'))}",
        author="AmirOS",
        subject="Private contact profile analysis",
    )
    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "ProfileTitle",
        parent=styles["Title"],
        fontName=FONT,
        fontSize=25,
        leading=30,
        textColor=INK,
        alignment=TA_LEFT,
        spaceAfter=5 * mm,
    )
    eyebrow = ParagraphStyle(
        "Eyebrow",
        parent=styles["Normal"],
        fontName=FONT,
        fontSize=8,
        leading=10,
        textColor=GREEN,
        uppercase=True,
        spaceAfter=2 * mm,
    )
    body = ParagraphStyle(
        "Body",
        parent=styles["BodyText"],
        fontName=FONT,
        fontSize=10,
        leading=15,
        textColor=INK,
        spaceAfter=2.5 * mm,
    )
    section = ParagraphStyle(
        "Section",
        parent=body,
        fontSize=13,
        leading=17,
        textColor=GREEN_DARK,
        spaceBefore=4 * mm,
        spaceAfter=2 * mm,
    )
    bullet = ParagraphStyle(
        "Bullet",
        parent=body,
        leftIndent=4 * mm,
        firstLineIndent=-3 * mm,
        bulletIndent=0,
        spaceAfter=1.5 * mm,
    )
    small = ParagraphStyle(
        "Small",
        parent=body,
        fontSize=8.5,
        leading=12,
        textColor=MUTED,
    )

    contact_name = clean_text(payload.get("contactName")) or "WhatsApp contact"
    story = [
        Paragraph("CONTACT PROFILE", eyebrow),
        Paragraph(safe(contact_name), title),
    ]

    metadata = [
        [Paragraph("<b>Relationship</b>", small), Paragraph("<b>Tone</b>", small), Paragraph("<b>Language</b>", small)],
        [
            Paragraph(safe(payload.get("relationship") or "Contact"), body),
            Paragraph(safe(payload.get("tone") or "Automatic"), body),
            Paragraph(safe(payload.get("language") or "Automatic"), body),
        ],
    ]
    metadata_table = Table(metadata, colWidths=[54 * mm, 54 * mm, 54 * mm])
    metadata_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), GREEN_SOFT),
        ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story.extend([
        metadata_table,
        Spacer(1, 6 * mm),
        Paragraph("Profile analysis", section),
    ])

    summary_lines = clean_text(payload.get("summary")).splitlines()
    for raw_line in summary_lines:
        line = raw_line.strip()
        if not line:
            story.append(Spacer(1, 1.5 * mm))
        elif line.startswith(("-", "•", "*")):
            story.append(Paragraph(f"- {safe(line[1:].strip())}", bullet))
        elif len(line) <= 70 and not line.endswith((".", "!", "?", ":")):
            story.append(Paragraph(f"<b>{safe(line)}</b>", section))
        else:
            story.append(Paragraph(safe(line), body))

    manual_items = payload.get("manualMemory") or []
    if manual_items:
        memory_content = [Paragraph("Operator-saved memory", section)]
        for item in manual_items:
            memory_content.append(Paragraph(f"- {safe(item)}", bullet))
        story.extend([Spacer(1, 3 * mm), KeepTogether(memory_content)])

    generated_at = format_date(payload.get("generatedAt"))
    source_count = int(payload.get("sourceMessageCount") or 0)
    story.extend([
        Spacer(1, 5 * mm),
        Table(
            [[Paragraph(
                f"<b>Analysis details</b><br/>Generated {safe(generated_at)} from {source_count} tracked incoming messages and {len(manual_items)} manual memory items. AI observations can be incomplete or uncertain and should be reviewed before relying on them.",
                small,
            )]],
            colWidths=[162 * mm],
            style=TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), SURFACE),
                ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
                ("LEFTPADDING", (0, 0), (-1, -1), 11),
                ("RIGHTPADDING", (0, 0), (-1, -1), 11),
                ("TOPPADDING", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
            ]),
        ),
    ])

    document.build(story, onFirstPage=draw_page, onLaterPages=draw_page)
    return output.getvalue()


def main():
    payload = json.load(sys.stdin)
    sys.stdout.buffer.write(build_pdf(payload))


if __name__ == "__main__":
    main()
