#!/usr/bin/env python3
"""
Box feeder: push sanitized book pulse to money-desk-watchman.
Observe-only. No Coinbase keys. Reads live.json; POSTs to Worker with ADMIN_TOKEN.

Usage:
  python3 scripts/push-book-pulse.py
  WATCHMAN_URL=https://money-desk-watchman.coachmeza42.workers.dev python3 scripts/push-book-pulse.py

Desk/Coinbase cron: call this script after each live.json refresh (or curl the same JSON
to POST /admin/book-pulse with x-admin-token). Do not invent Meza Task Scheduler —
wire whatever scheduler already owns the Desk refresh.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_URL = "https://money-desk-watchman.coachmeza42.workers.dev"

LIVE_CANDIDATES = [
    Path("/workspace/jarvis-hud/live.json"),
    Path("/workspace/jarvis-os/live.json"),
    Path.home() / "jarvis-hud" / "live.json",
    ROOT.parent.parent / "jarvis-hud" / "live.json",
]

# Coinbase SoT for Predict fun-sleeve running net (Desk maps into book-pulse)
SLEEVE_SOT = Path("/workspace/audit/predict/sleeve_net.json")


def load_admin_token() -> str:
    env = os.environ.get("ADMIN_TOKEN", "").strip()
    if env:
        return env
    dev = ROOT / ".dev.vars"
    if not dev.is_file():
        raise SystemExit(f"ADMIN_TOKEN missing and {dev} not found")
    for line in dev.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        if k.strip() == "ADMIN_TOKEN":
            tok = v.strip().strip('"').strip("'")
            if tok:
                return tok
    raise SystemExit("ADMIN_TOKEN not found in env or .dev.vars")


def find_live() -> Path:
    override = os.environ.get("LIVE_JSON", "").strip()
    if override:
        p = Path(override)
        if not p.is_file():
            raise SystemExit(f"LIVE_JSON not found: {p}")
        return p
    for p in LIVE_CANDIDATES:
        if p.is_file():
            return p
    raise SystemExit("live.json not found in known paths")


def num_or_none(v: Any) -> float | None:
    if v is None:
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if n != n:  # NaN
        return None
    return n



def sleeve_net_from_sot(live_fallback: Any = None) -> float | None:
    """Prefer /workspace/audit/predict/sleeve_net.json; else live.json; never invent."""
    if SLEEVE_SOT.is_file():
        try:
            data = json.loads(SLEEVE_SOT.read_text())
            if isinstance(data, dict):
                n = num_or_none(data.get("predict_sleeve_net", data.get("sleeve_net")))
                if n is not None:
                    return n
        except (OSError, json.JSONDecodeError):
            pass
    return num_or_none(live_fallback)


def pulse_as_of(live: dict[str, Any]) -> str:
    """Snapshot time for Worker as_of reject.

    Only live.json ``as_of`` (explicit book snapshot). Never overlay as_of, never
    unrelated live ``ts`` fields that can be older than pulse_stale_minutes.
    """
    v = live.get("as_of")
    if isinstance(v, str) and v.strip():
        return v.strip()
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def build_pulse(live: dict[str, Any]) -> dict[str, Any]:
    """Map available live.json fields; null if missing — never invent numbers."""
    open_orders = live.get("open_orders")
    open_count: int | None
    if isinstance(open_orders, list):
        open_count = len(open_orders)
    elif open_orders is None and "open_order_count" in live:
        n = num_or_none(live.get("open_order_count"))
        open_count = int(n) if n is not None else None
    else:
        open_count = None

    # dry_usd: prefer explicit dry_usd / dry_usdc; else map usd_cash (dry powder proxy)
    dry = num_or_none(live.get("dry_usd"))
    if dry is None:
        dry = num_or_none(live.get("dry_usdc"))
    if dry is None:
        dry = num_or_none(live.get("usd_cash"))

    wreck_pause = num_or_none(live.get("wreck_pause"))
    wreck_kill = num_or_none(live.get("wreck_kill"))

    pulse = {
        "book_mark_usd": num_or_none(live.get("book_mark_usd", live.get("book_mark"))),
        "wreck_pause_usd": wreck_pause if wreck_pause is not None else 113,
        "wreck_kill_usd": wreck_kill if wreck_kill is not None else 92,
        "open_order_count": open_count,
        "morpho_usd": num_or_none(live.get("morpho_usd", live.get("morpho_usdc"))),
        "dry_usd": dry,
        "predict_sleeve_net": sleeve_net_from_sot(
            live.get("predict_sleeve_net", live.get("sleeve_net"))
        ),
        "soft_cap_util_pct": num_or_none(live.get("soft_cap_util_pct")),
        "as_of": pulse_as_of(live),
    }
    return pulse


def dark_fields(pulse: dict[str, Any]) -> list[str]:
    dark = []
    for k in (
        "book_mark_usd",
        "open_order_count",
        "morpho_usd",
        "dry_usd",
        "predict_sleeve_net",
        "soft_cap_util_pct",
    ):
        if pulse.get(k) is None:
            dark.append(k)
    return dark


SLEEVE_NET_PATH = Path("/workspace/audit/predict/sleeve_net.json")

OVERLAY_CANDIDATES = [
    Path("/workspace/jarvis-hud/desk-overlay.json"),
    Path("/workspace/projects/money-desk-watchman/desk-overlay.json"),
]

OVERLAY_SOFT_CAP_KEYS = ("soft_cap_util_pct",)


def load_json_object(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def first_numeric(obj: dict[str, Any], keys: tuple[str, ...]) -> float | None:
    for k in keys:
        if k in obj:
            n = num_or_none(obj.get(k))
            if n is not None:
                return n
    return None


def find_overlay() -> tuple[Path | None, dict[str, Any] | None]:
    for p in OVERLAY_CANDIDATES:
        data = load_json_object(p)
        if data is not None:
            return p, data
    return None, None


def apply_dark_field_overlays(pulse: dict[str, Any]) -> dict[str, Any]:
    """Fill dark fields only — never invent.

    predict_sleeve_net (Coinbase-locked): first existing numeric wins from
      1) /workspace/audit/predict/sleeve_net.json (predict_sleeve_net|sleeve_net|net)
      2) desk-overlay.json (predict_sleeve_net)
    soft_cap_util_pct: overlay only if present (never invent).
    """
    meta: dict[str, Any] = {"sleeve_source": None, "overlay_path": None, "overlay_note": None, "overlay_as_of": None}

    sleeve = None
    sleeve_obj = load_json_object(SLEEVE_NET_PATH)
    if sleeve_obj is not None:
        sleeve = first_numeric(sleeve_obj, ("predict_sleeve_net", "sleeve_net", "net"))
        if sleeve is not None:
            meta["sleeve_source"] = str(SLEEVE_NET_PATH)

    overlay_path, overlay = find_overlay()
    if overlay is not None:
        meta["overlay_path"] = str(overlay_path)
        if "note" in overlay:
            meta["overlay_note"] = overlay.get("note")
        if "as_of" in overlay:
            meta["overlay_as_of"] = overlay.get("as_of")
        if sleeve is None:
            sleeve = first_numeric(overlay, ("predict_sleeve_net",))
            if sleeve is not None:
                meta["sleeve_source"] = str(overlay_path)

        # soft_cap_util_pct only from overlay when present — never invent
        if pulse.get("soft_cap_util_pct") is None:
            sc = first_numeric(overlay, OVERLAY_SOFT_CAP_KEYS)
            if sc is not None:
                pulse["soft_cap_util_pct"] = sc

        # morpho_convert_blocked: truthy overlay -> include true on pulse (mute dry-idle)
        raw_blocked = overlay.get("morpho_convert_blocked")
        if raw_blocked in (True, 1, "1", "true", "True", "yes", "YES"):
            pulse["morpho_convert_blocked"] = True
        elif raw_blocked in (False, 0, "0", "false", "False"):
            pulse["morpho_convert_blocked"] = False

    if sleeve is not None:
        pulse["predict_sleeve_net"] = sleeve

    pulse["_overlay_meta"] = meta  # stripped before POST
    return pulse


def main() -> int:
    live_path = find_live()
    live = json.loads(live_path.read_text())
    if not isinstance(live, dict):
        raise SystemExit("live.json must be an object")
    pulse = build_pulse(live)
    pulse = apply_dark_field_overlays(pulse)
    meta = pulse.pop("_overlay_meta", {})
    dark = dark_fields(pulse)
    url = os.environ.get("WATCHMAN_URL", DEFAULT_URL).rstrip("/") + "/admin/book-pulse"
    token = load_admin_token()
    body = json.dumps(pulse).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "content-type": "application/json",
            "x-admin-token": token,
            "user-agent": "money-desk-watchman-feeder/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            status = resp.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code}: {raw[:500]}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"request failed: {e}", file=sys.stderr)
        return 1

    out = {
        "status": status,
        "live": str(live_path),
        "pulse": pulse,
        "dark_fields": dark,
        "sleeve_source": meta.get("sleeve_source"),
        "overlay_path": meta.get("overlay_path"),
        "response": json.loads(raw),
    }
    print(json.dumps(out, indent=2))
    if dark:
        print(f"dark_fields: {', '.join(dark)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    # fix accidental Ellipsis typo guard — num_or_none cleaned below
    sys.exit(main())
