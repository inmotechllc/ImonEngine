from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Any

from chrome_cdp import CdpPage, close_tab, detect_mcp_chrome_port, find_tab, http_json, open_new_tab


SEARCH_TIMEOUT_SECONDS = 30
THREAD_TIMEOUT_SECONDS = 30


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec-file", required=True)
    parser.add_argument("--port", type=int)
    return parser.parse_args()


def open_search_target(port: int, search_url: str) -> tuple[dict[str, object], bool]:
    try:
        return open_new_tab(port, search_url), True
    except Exception:
        tabs = http_json(port, "/json/list")
        try:
            tab = find_tab(tabs, tab_id=None, url_substring="mail.google.com", title_substring=None)
        except RuntimeError:
            page_tabs = [tab for tab in tabs if tab.get("type") == "page"]
            if not page_tabs:
                raise SystemExit("No browser tabs are available for Gmail inbox automation.")
            tab = page_tabs[0]
        return tab, False


def wait_for_search_state(page: CdpPage, timeout_seconds: int) -> dict[str, object]:
    deadline = time.time() + timeout_seconds
    last_state: dict[str, object] = {
        "status": "waiting",
        "reason": "search_not_ready",
    }

    while time.time() < deadline:
        state = page.evaluate(
            r"""
(() => {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const bodyText = normalize(document.body?.innerText || '');
    const rows = [...document.querySelectorAll('tr[role="row"]')]
        .filter((row) => row.querySelector('span[email], .yP, .bqe'));
    const noResults = /no messages matched your search|did not match any messages/i.test(bodyText);
    return {
        status: rows.length > 0 || noResults ? 'ready' : 'waiting',
        reason: rows.length > 0 ? 'results_ready' : (noResults ? 'no_results' : 'search_pending'),
        rowCount: rows.length,
        signInDetected: /sign in/i.test(bodyText) && !/message sent/i.test(bodyText),
        title: document.title,
        href: location.href,
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


def open_first_result(page: CdpPage) -> dict[str, object]:
    result = page.evaluate(
        r"""
(() => {
    const rows = [...document.querySelectorAll('tr[role="row"]')]
        .filter((row) => row.querySelector('span[email], .yP, .bqe'));
    const row = rows[0];
    if (!row) {
        return { status: 'missing' };
    }
    const threadId = row.getAttribute('data-legacy-thread-id') || row.dataset.legacyThreadId || null;
    const anchor = row.querySelector('a[href]');
    (anchor || row).click();
    return { status: 'clicked', threadId };
})()
"""
    )
    return result if isinstance(result, dict) else {"status": "unknown", "result": result}


def wait_for_thread(page: CdpPage, timeout_seconds: int) -> dict[str, object]:
    deadline = time.time() + timeout_seconds
    last_state: dict[str, object] = {
        "status": "waiting",
        "reason": "thread_not_ready",
    }

    while time.time() < deadline:
        state = page.evaluate(
            r"""
(() => {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const bodyText = normalize(document.body?.innerText || '');
    const messageNodes = [...document.querySelectorAll('div.adn, [data-legacy-message-id]')];
    return {
        status: messageNodes.length > 0 ? 'ready' : 'waiting',
        reason: messageNodes.length > 0 ? 'thread_ready' : 'thread_pending',
        messageCount: messageNodes.length,
        signInDetected: /sign in/i.test(bodyText) && !/message sent/i.test(bodyText),
        title: document.title,
        href: location.href,
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


def extract_latest_inbound(page: CdpPage, recipient: str) -> dict[str, Any]:
    result = page.evaluate(
        f"""
(() => {{
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const normalizeEmail = (value) => normalize(value).toLowerCase();
    const recipient = {json.dumps(recipient.lower())};
    const parseTimestamp = (value) => {{
        if (!value) return null;
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }};
    const subject = normalize((document.title || '').replace(/\\s*-\\s*Gmail.*$/, ''));
    const nodes = [...document.querySelectorAll('div.adn, [data-legacy-message-id]')];
    const messages = nodes.map((node, index) => {{
        const container = node.closest('[data-legacy-message-id]') || node;
        const senderEl = container.querySelector('.gD[email], .gD, span[email], [data-hovercard-id]');
        const sender = normalizeEmail(
            senderEl?.getAttribute('email') ||
            senderEl?.getAttribute('data-hovercard-id') ||
            senderEl?.textContent ||
            ''
        );
        const bodyEl = container.querySelector('div.a3s.aiL, div.a3s, div.ii.gt');
        const body = normalize(bodyEl?.innerText || bodyEl?.textContent || '');
        const timeEl = container.querySelector('span.g3');
        const receivedAt = parseTimestamp(timeEl?.getAttribute('title') || timeEl?.textContent || '') || new Date().toISOString();
        return {{
            index,
            externalMessageId: container.getAttribute('data-legacy-message-id') || container.getAttribute('id') || null,
            sender,
            body,
            receivedAt,
        }};
    }});
    const inbound = messages.filter((message) => message.sender === recipient && message.body);
    const latest = inbound.length > 0 ? inbound[inbound.length - 1] : null;
    return {{
        externalThreadId: location.hash || location.href,
        subject: subject || null,
        latest,
        messageCount: messages.length,
    }};
}})()
"""
    )
    return result if isinstance(result, dict) else {"latest": None}


def sync_candidate(port: int, candidate: dict[str, Any]) -> dict[str, Any]:
    recipient = str(candidate.get("recipient") or "").strip()
    subject = str(candidate.get("subject") or "").strip()
    lead_id = str(candidate.get("leadId") or "").strip()
    if not recipient or not subject or not lead_id:
        return {
            "leadId": lead_id or None,
            "status": "error",
            "reason": "Missing leadId, recipient, or subject in inbox sync candidate.",
        }

    query = f'in:anywhere from:({recipient}) subject:("{subject}") newer_than:30d'
    search_url = "https://mail.google.com/mail/u/0/#search/" + urllib.parse.quote(query, safe="")
    tab, created_new_tab = open_search_target(port, search_url)
    created_tab_id = tab.get("id") if created_new_tab else None
    page = CdpPage(tab["webSocketDebuggerUrl"])

    try:
        page.enable()
        if not created_new_tab:
            page.navigate(search_url)

        search_state = wait_for_search_state(page, SEARCH_TIMEOUT_SECONDS)
        if search_state.get("signInDetected"):
            return {
                "leadId": lead_id,
                "status": "error",
                "reason": "Gmail is not signed in in the automation browser session.",
                "details": search_state,
            }
        if search_state.get("reason") == "no_results":
            return {
                "leadId": lead_id,
                "status": "no_reply",
                "recipient": recipient,
                "subject": subject,
            }
        if search_state.get("status") != "ready":
            return {
                "leadId": lead_id,
                "status": "error",
                "reason": "Search results did not load in time.",
                "details": search_state,
            }

        click_result = open_first_result(page)
        if click_result.get("status") != "clicked":
            return {
                "leadId": lead_id,
                "status": "error",
                "reason": "Could not open the matching Gmail thread.",
                "details": click_result,
            }

        thread_state = wait_for_thread(page, THREAD_TIMEOUT_SECONDS)
        if thread_state.get("signInDetected"):
            return {
                "leadId": lead_id,
                "status": "error",
                "reason": "Gmail is not signed in in the automation browser session.",
                "details": thread_state,
            }
        if thread_state.get("status") != "ready":
            return {
                "leadId": lead_id,
                "status": "error",
                "reason": "Thread view did not load in time.",
                "details": thread_state,
            }

        extracted = extract_latest_inbound(page, recipient)
        latest = extracted.get("latest")
        if not latest:
            return {
                "leadId": lead_id,
                "status": "no_reply",
                "recipient": recipient,
                "subject": subject,
            }

        return {
            "leadId": lead_id,
            "status": "reply_found",
            "recipient": recipient,
            "subject": extracted.get("subject") or subject,
            "externalThreadId": extracted.get("externalThreadId"),
            "externalMessageId": latest.get("externalMessageId"),
            "fromAddress": latest.get("sender") or recipient,
            "body": latest.get("body"),
            "receivedAt": latest.get("receivedAt"),
        }
    finally:
        page.close()
        if created_tab_id:
            try:
                close_tab(port, str(created_tab_id))
            except Exception:
                pass


def main() -> int:
    args = parse_args()
    spec = json.loads(Path(args.spec_file).read_text(encoding="utf-8"))
    candidates = spec.get("candidates") if isinstance(spec, dict) else None
    if not isinstance(candidates, list):
        raise SystemExit("Spec file must contain a top-level candidates array.")

    port = args.port or detect_mcp_chrome_port()
    results = [sync_candidate(port, candidate) for candidate in candidates]
    print(
        json.dumps(
            {
                "status": "ok",
                "checked": len(candidates),
                "results": results,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
