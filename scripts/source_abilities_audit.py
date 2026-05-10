#!/usr/bin/env python3
"""
Generate source baseline artifacts for ability gameplay audit.

Sources:
- PDF glossary (local file path)
- Fandom "List of Abilities"
- YouTube metadata (optional, via yt-dlp)
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import re
import subprocess
import sys
import urllib.request
from html import unescape


DEFAULT_PDF = r"C:/Users/samue/Downloads/ef4967_01c5d6074faa4a299333adacdd51064b.pdf"
FANDOM_URL = "https://chaotic.fandom.com/wiki/List_of_Abilities"
FANDOM_API_URL = "https://chaotic.fandom.com/api.php?action=parse&page=List_of_Abilities&prop=text&format=json&formatversion=2"
YOUTUBE_URL = "https://www.youtube.com/watch?v=k-aq-RxpqL8"


def strip_html(value: str) -> str:
    text = re.sub(r"(?is)<script.*?>.*?</script>", " ", value)
    text = re.sub(r"(?is)<style.*?>.*?</style>", " ", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = unescape(text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def extract_pdf_text(pdf_path: str) -> dict:
    if not pdf_path or not os.path.exists(pdf_path):
        return {"ok": False, "error": f"PDF not found: {pdf_path}"}
    try:
        from pypdf import PdfReader  # type: ignore
    except Exception as exc:  # pragma: no cover - env dependent
        return {"ok": False, "error": f"pypdf unavailable: {exc}"}

    try:
        reader = PdfReader(pdf_path)
        pages = []
        for idx, page in enumerate(reader.pages, start=1):
            raw = (page.extract_text() or "").replace("\u200b", " ").strip()
            pages.append({"page": idx, "text": raw})
        all_text = "\n\n".join(item["text"] for item in pages)
        terms = []
        for line in re.split(r"[\r\n]+", all_text):
            cleaned = line.strip(" :-\t")
            if len(cleaned) < 3 or len(cleaned) > 80:
                continue
            if re.match(r"^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9'()\/\-\s]+$", cleaned):
                if cleaned.lower() in {"exemplo", "exemplos"}:
                    continue
                if cleaned.lower() not in {t.lower() for t in terms}:
                    terms.append(cleaned)
        return {
            "ok": True,
            "path": pdf_path,
            "pages": len(pages),
            "sampleTerms": terms[:120],
            "sampleText": all_text[:12000],
        }
    except Exception as exc:  # pragma: no cover - parsing variance
        return {"ok": False, "error": f"Failed to parse PDF: {exc}"}


def fetch_fandom() -> dict:
    def parse_html_payload(html: str, source_label: str) -> dict:
        plain = strip_html(html)
        heading_matches = re.findall(
            r'(?is)<h[23][^>]*>\s*(.*?)\s*</h[23]>',
            html,
        )
        headings = []
        for heading in heading_matches:
            value = strip_html(heading).strip()
            if not value:
                continue
            if value not in headings:
                headings.append(value)
        return {
            "ok": True,
            "url": FANDOM_URL,
            "source": source_label,
            "headings": headings[:200],
            "sampleText": plain[:18000],
        }

    try:
        req = urllib.request.Request(
            FANDOM_URL,
            headers={"User-Agent": "Mozilla/5.0 (ChaoticLegacyAudit/1.0)"},
        )
        with urllib.request.urlopen(req, timeout=30) as response:
            html = response.read().decode("utf-8", errors="replace")
        return parse_html_payload(html, "direct_html")
    except Exception as exc:  # pragma: no cover - network variance
        direct_error = str(exc)
    try:
        req = urllib.request.Request(
            FANDOM_API_URL,
            headers={"User-Agent": "Mozilla/5.0 (ChaoticLegacyAudit/1.0)"},
        )
        with urllib.request.urlopen(req, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace"))
        html = str(((payload or {}).get("parse") or {}).get("text") or "")
        if not html:
            raise RuntimeError("fandom api parse.text empty")
        return parse_html_payload(html, "api_parse")
    except Exception as exc:  # pragma: no cover - network variance
        return {"ok": False, "url": FANDOM_URL, "error": f"direct={direct_error}; api={exc}"}


def fetch_youtube_meta() -> dict:
    try:
        completed = subprocess.run(
            [
                "yt-dlp",
                "--print",
                "title",
                "--print",
                "channel",
                "--print",
                "upload_date",
                "--print",
                "description",
                YOUTUBE_URL,
            ],
            capture_output=True,
            text=True,
            timeout=45,
            check=False,
        )
    except Exception as exc:  # pragma: no cover - binary/env variance
        return {"ok": False, "url": YOUTUBE_URL, "error": str(exc)}

    if completed.returncode != 0:
        return {
            "ok": False,
            "url": YOUTUBE_URL,
            "error": completed.stderr.strip() or completed.stdout.strip() or f"yt-dlp exit={completed.returncode}",
        }

    lines = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
    payload = {
        "title": lines[0] if len(lines) > 0 else "",
        "channel": lines[1] if len(lines) > 1 else "",
        "uploadDate": lines[2] if len(lines) > 2 else "",
        "description": "\n".join(lines[3:]) if len(lines) > 3 else "",
    }
    return {"ok": True, "url": YOUTUBE_URL, **payload}


def write_outputs(export_dir: str, payload: dict) -> tuple[str, str]:
    os.makedirs(export_dir, exist_ok=True)
    json_path = os.path.join(export_dir, "effects_sources_snapshot.json")
    md_path = os.path.join(export_dir, "effects_sources_snapshot.md")
    with open(json_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)

    md_lines = [
        "# Ability Sources Snapshot",
        "",
        f"- Generated at: `{payload.get('generatedAt', '')}`",
        f"- Scope: `{payload.get('scope', '')}`",
        "",
        "## Fandom",
        f"- Status: `{payload['fandom'].get('ok')}`",
    ]
    if payload["fandom"].get("ok"):
        md_lines.append(f"- Headings captured: `{len(payload['fandom'].get('headings', []))}`")
    else:
        md_lines.append(f"- Error: `{payload['fandom'].get('error', 'unknown')}`")

    md_lines += [
        "",
        "## PDF",
        f"- Status: `{payload['pdf'].get('ok')}`",
    ]
    if payload["pdf"].get("ok"):
        md_lines.append(f"- Pages: `{payload['pdf'].get('pages', 0)}`")
        md_lines.append(f"- Sample terms captured: `{len(payload['pdf'].get('sampleTerms', []))}`")
    else:
        md_lines.append(f"- Error: `{payload['pdf'].get('error', 'unknown')}`")

    md_lines += [
        "",
        "## YouTube",
        f"- Status: `{payload['youtube'].get('ok')}`",
    ]
    if payload["youtube"].get("ok"):
        md_lines.append(f"- Title: `{payload['youtube'].get('title', '')}`")
        md_lines.append(f"- Channel: `{payload['youtube'].get('channel', '')}`")
        md_lines.append(f"- Upload date: `{payload['youtube'].get('uploadDate', '')}`")
    else:
        md_lines.append(f"- Error: `{payload['youtube'].get('error', 'unknown')}`")

    with open(md_path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(md_lines).strip() + "\n")
    return json_path, md_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate source snapshots for ability audit.")
    parser.add_argument("--pdf", default=DEFAULT_PDF, help="Path to glossary PDF file.")
    parser.add_argument("--export-dir", default=os.path.join("exports"), help="Export output directory.")
    args = parser.parse_args()

    payload = {
        "generatedAt": _dt.datetime.utcnow().isoformat() + "Z",
        "scope": "DOP,ZOTH,SS",
        "precedence": "PDF+Fandom > video",
        "fandom": fetch_fandom(),
        "pdf": extract_pdf_text(args.pdf),
        "youtube": fetch_youtube_meta(),
    }

    json_path, md_path = write_outputs(args.export_dir, payload)
    print(
        json.dumps(
            {
                "ok": True,
                "json": json_path.replace("\\", "/"),
                "markdown": md_path.replace("\\", "/"),
                "fandom_ok": payload["fandom"].get("ok", False),
                "pdf_ok": payload["pdf"].get("ok", False),
                "youtube_ok": payload["youtube"].get("ok", False),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
