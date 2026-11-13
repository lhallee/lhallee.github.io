"""Stamp each local stylesheet and script link in index.html with a hash of the file it points to.

A browser keeps a stylesheet or a script for a while after it first loads it, and a reload of the
page does not always ask for them again, so an edit can go unseen. The stamp changes the link
whenever the file changes, and the browser then fetches the new file. Run this after changing
anything under assets/.

    python tools/stamp_assets.py
"""
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LINK = re.compile(r'(?P<attribute>href|src)="(?P<path>assets/[^"?]+\.(?:css|js))(?:\?v=[0-9a-f]+)?"')


def stamp(match: re.Match) -> str:
    path = match.group("path")
    # Line endings are set by the checkout, so they are left out of the hash.
    content = (ROOT / path).read_bytes().replace(b"\r\n", b"\n")
    digest = hashlib.sha256(content).hexdigest()[:10]
    return f'{match.group("attribute")}="{path}?v={digest}"'


def main() -> None:
    page = ROOT / "index.html"
    text = page.read_text(encoding="utf-8")
    stamped, count = LINK.subn(stamp, text)
    assert count > 0, "index.html links no local stylesheet or script"
    if stamped != text:
        page.write_text(stamped, encoding="utf-8", newline="\n")
    print(f"stamped {count} links in index.html")


if __name__ == "__main__":
    main()
