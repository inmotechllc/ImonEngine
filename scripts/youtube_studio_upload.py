from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

import chrome_cdp


def _wait_for(page: chrome_cdp.CdpPage, expression: str, *, attempts: int = 20, delay: float = 1.0) -> bool:
    for _ in range(attempts):
        try:
            if page.evaluate(expression):
                return True
        except Exception:
            pass
        time.sleep(delay)
    return False


def _click_by_text(page: chrome_cdp.CdpPage, labels: list[str]) -> bool:
    expression = f"""
(() => {{
  const labels = {json.dumps(labels)};
  const elements = [
    ...document.querySelectorAll('button'),
    ...document.querySelectorAll('ytcp-button'),
    ...document.querySelectorAll('tp-yt-paper-item'),
    ...document.querySelectorAll('[role="button"]')
  ];
  for (const label of labels) {{
    const match = elements.find((candidate) =>
      ((candidate.innerText || candidate.textContent || '').trim().toLowerCase()) === label.toLowerCase()
    );
    if (match) {{
      match.click();
      return true;
    }}
  }}
  return false;
}})()
"""
    try:
        return bool(page.evaluate(expression))
    except Exception:
        return False


def _set_textbox(page: chrome_cdp.CdpPage, index: int, value: str) -> bool:
    expression = f"""
(() => {{
  const fields = [...document.querySelectorAll('textarea, input[type="text"]')]
    .filter((candidate) => !candidate.disabled && candidate.offsetParent !== null);
  const target = fields[{index}] || null;
  if (!target) return false;
  const proto = Object.getPrototypeOf(target);
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor && descriptor.set) descriptor.set.call(target, {json.dumps(value)});
  else target.value = {json.dumps(value)};
  target.dispatchEvent(new Event('input', {{ bubbles: true }}));
  target.dispatchEvent(new Event('change', {{ bubbles: true }}));
  return true;
}})()
"""
    try:
        return bool(page.evaluate(expression))
    except Exception:
        return False


def _result(**kwargs: Any) -> None:
    print(json.dumps(kwargs, indent=2))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Open the signed-in YouTube Studio session and hand off a ClipBaiters upload."
    )
    parser.add_argument("--video", required=True, help="Path to the rendered MP4 file.")
    parser.add_argument("--metadata", required=True, help="Path to a JSON metadata file.")
    parser.add_argument("--channel-url")
    parser.add_argument("--channel-handle")
    parser.add_argument("--port", type=int, help="Chrome remote debugging port.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate the payload and emit the command plan without touching the browser session."
    )
    return parser


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    args = build_parser().parse_args()
    video_path = Path(args.video).expanduser().resolve()
    metadata_path = Path(args.metadata).expanduser().resolve()
    if not video_path.exists():
        raise SystemExit(f"Missing video file: {video_path}")
    if not metadata_path.exists():
        raise SystemExit(f"Missing metadata file: {metadata_path}")

    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if args.dry_run:
        _result(
            status="publishing",
            notes=[
                "Dry run only: validated the video and metadata payload.",
                "No browser interaction was attempted.",
            ],
        )
        return

    port = args.port or chrome_cdp.detect_mcp_chrome_port()
    tab = chrome_cdp.open_new_tab(port, "https://studio.youtube.com")
    page = chrome_cdp.CdpPage(tab["webSocketDebuggerUrl"])
    page.enable()

    try:
        page.navigate("https://studio.youtube.com")
        time.sleep(3)

        created_upload_dialog = False
        if _click_by_text(page, ["Create"]):
            time.sleep(1)
            created_upload_dialog = _click_by_text(page, ["Upload videos", "Upload video"])
        else:
            created_upload_dialog = _click_by_text(page, ["Upload videos", "Upload video"])
        if created_upload_dialog:
            time.sleep(2)

        has_file_input = _wait_for(
            page,
            "(() => document.querySelectorAll('input[type=\"file\"]').length > 0)()",
            attempts=10,
            delay=1.0,
        )
        if not has_file_input:
            _result(
                status="blocked",
                notes=[
                    "YouTube Studio upload input was not found.",
                    "Keep the signed-in Studio session open and retry once the Create > Upload videos flow is visible.",
                ],
            )
            return

        page.upload_files("input[type=\"file\"]", 0, [str(video_path)])
        time.sleep(4)
        _set_textbox(page, 0, metadata.get("title") or video_path.stem)
        _set_textbox(page, 1, metadata.get("description") or "")

        notes = [
            f"Opened YouTube Studio on port {port} and attached {video_path.name} to the upload flow.",
            "Verify the active Studio channel before completing the upload; this helper does not switch channels automatically.",
        ]
        if args.channel_handle:
            notes.append(f"Requested channel handle: {args.channel_handle}")
        if args.channel_url:
            notes.append(f"Requested public channel URL: {args.channel_url}")

        _result(
            status="publishing",
            notes=notes,
        )
    finally:
        page.close()


if __name__ == "__main__":
    main()
