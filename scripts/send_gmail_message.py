from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
from pathlib import Path

from chrome_cdp import CdpPage, close_tab, detect_mcp_chrome_port, find_tab, http_json, open_new_tab


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--to", required=True)
    parser.add_argument("--subject", required=True)
    parser.add_argument("--body-file")
    parser.add_argument("--body")
    parser.add_argument("--port", type=int)
    return parser.parse_args()


def open_compose_target(port: int, compose_url: str) -> tuple[dict[str, object], bool]:
        try:
                return open_new_tab(port, compose_url), True
        except Exception:
                tabs = http_json(port, "/json/list")
                try:
                        tab = find_tab(tabs, tab_id=None, url_substring="mail.google.com", title_substring=None)
                except RuntimeError:
                        page_tabs = [tab for tab in tabs if tab.get("type") == "page"]
                        if not page_tabs:
                                raise SystemExit("No browser tabs are available for Gmail automation.")
                        tab = page_tabs[0]
                return tab, False


def wait_for_send_button(page: CdpPage, timeout_seconds: int) -> dict[str, object]:
        deadline = time.time() + timeout_seconds
        last_state: dict[str, object] = {
                "status": "waiting",
                "reason": "compose_not_ready",
        }

        while time.time() < deadline:
                state = page.evaluate(
                    r"""
(() => {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const candidates = [...document.querySelectorAll('div[role="button"], button, [command="Send"]')];
    const sendButton = candidates.find((el) => {
        const label = normalize(
            el.getAttribute('aria-label') ||
            el.getAttribute('data-tooltip') ||
            el.getAttribute('title') ||
            el.innerText ||
            el.textContent
        );
        return /^send\b/i.test(label);
    });
    const disabled = Boolean(
        sendButton &&
        (sendButton.hasAttribute('disabled') || sendButton.getAttribute('aria-disabled') === 'true')
    );
    const bodyText = normalize(document.body?.innerText || '');
    return {
        status: sendButton && !disabled ? 'ready' : 'waiting',
        reason: sendButton ? (disabled ? 'send_disabled' : 'ready') : 'send_missing',
        href: location.href,
        title: document.title,
        readyState: document.readyState,
        hasComposeSurface: Boolean(document.querySelector('div[role="dialog"], form[role="presentation"], [gh="cm"]')),
        signInDetected: /sign in/i.test(bodyText) && !/message sent/i.test(bodyText),
        buttonLabel: sendButton
            ? normalize(
                    sendButton.getAttribute('aria-label') ||
                        sendButton.getAttribute('data-tooltip') ||
                        sendButton.getAttribute('title') ||
                        sendButton.innerText ||
                        sendButton.textContent
                )
            : null,
    };
})()
"""
                )
                if isinstance(state, dict):
                        last_state = state
                        if state.get("signInDetected"):
                                return state
                        if state.get("status") == "ready":
                                return state
                time.sleep(1)

        return last_state


def click_send_button(page: CdpPage) -> dict[str, object]:
        result = page.evaluate(
            r"""
(() => {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const candidates = [...document.querySelectorAll('div[role="button"], button, [command="Send"]')];
    const sendButton = candidates.find((el) => {
        const label = normalize(
            el.getAttribute('aria-label') ||
            el.getAttribute('data-tooltip') ||
            el.getAttribute('title') ||
            el.innerText ||
            el.textContent
        );
        return /^send\b/i.test(label);
    });
    if (!sendButton) {
        return { status: 'missing', reason: 'send_missing' };
    }
    if (sendButton.hasAttribute('disabled') || sendButton.getAttribute('aria-disabled') === 'true') {
        return { status: 'disabled', reason: 'send_disabled' };
    }
    sendButton.scrollIntoView({ block: 'center', inline: 'center' });
    sendButton.click();
    sendButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return {
        status: 'clicked',
        label: normalize(
            sendButton.getAttribute('aria-label') ||
            sendButton.getAttribute('data-tooltip') ||
            sendButton.getAttribute('title') ||
            sendButton.innerText ||
            sendButton.textContent
        )
    };
})()
"""
        )
        return result if isinstance(result, dict) else {"status": "unknown", "result": result}


def main() -> int:
    args = parse_args()
    body = args.body
    if args.body_file:
        body = Path(args.body_file).read_text(encoding="utf-8")
    if body is None:
        raise SystemExit("Provide --body or --body-file.")

    port = args.port or detect_mcp_chrome_port()
    compose_url = (
        "https://mail.google.com/mail/?view=cm&fs=1&tf=1&"
        + urllib.parse.urlencode({"to": args.to, "su": args.subject, "body": body})
    )
    tab, created_new_tab = open_compose_target(port, compose_url)
    created_tab_id = tab.get("id") if created_new_tab else None

    page = CdpPage(tab["webSocketDebuggerUrl"])
    try:
        page.enable()
        if not created_new_tab:
            page.navigate(compose_url)

        ready_state = wait_for_send_button(page, timeout_seconds=30)
        if ready_state.get("signInDetected"):
            print(
                json.dumps(
                    {
                        "status": "error",
                        "reason": "Gmail is not signed in in the automation browser session.",
                        "details": ready_state,
                    },
                    indent=2,
                )
            )
            return 1

        if ready_state.get("status") != "ready":
            print(
                json.dumps(
                    {
                        "status": "error",
                        "reason": "Send button not found.",
                        "details": ready_state,
                    },
                    indent=2,
                )
            )
            return 1

        click_result = click_send_button(page)
        if click_result.get("status") != "clicked":
            print(
                json.dumps(
                    {
                        "status": "error",
                        "reason": "Send button could not be clicked.",
                        "details": click_result,
                    },
                    indent=2,
                )
            )
            return 1

        time.sleep(3)
        print(
            json.dumps(
                {
                    "status": "ok",
                    "to": args.to,
                    "subject": args.subject,
                    "tabMode": "new_tab" if created_new_tab else "existing_tab",
                },
                indent=2,
            )
        )
        return 0
    finally:
        page.close()
        if created_tab_id:
            try:
                close_tab(port, str(created_tab_id))
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
