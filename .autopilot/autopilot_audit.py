#!/usr/bin/env python3
"""Tamper-evident coding-session audit log for Universal Project Autopilot V4."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import subprocess
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from contextlib import contextmanager


GENESIS = "0" * 64


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def audit_dir(root: str | Path) -> Path:
    path = Path(root).resolve() / ".autopilot" / "audit"
    path.mkdir(parents=True, exist_ok=True)
    return path


def workspace_sha256(root: str | Path) -> str:
    project = Path(root).resolve()
    completed = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=project, capture_output=True, check=False,
    )
    if completed.returncode != 0:
        raise ValueError("could not fingerprint workspace for audit close")
    digest = hashlib.sha256()
    for raw_name in sorted(item for item in completed.stdout.split(b"\0") if item):
        name = raw_name.decode("utf-8", errors="surrogateescape")
        if name == ".autopilot" or name.startswith(".autopilot/"):
            continue
        path = project / name
        digest.update(raw_name); digest.update(b"\0")
        if path.is_symlink():
            digest.update(os.readlink(path).encode("utf-8", errors="surrogateescape"))
        elif path.is_file():
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
        digest.update(b"\0")
    return digest.hexdigest()


def canonical(value: dict[str, Any]) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def read_events(root: str | Path) -> list[dict[str, Any]]:
    path = audit_dir(root) / "events.ndjson"
    if not path.exists():
        return []
    events: list[dict[str, Any]] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid audit JSON at line {number}") from exc
        if not isinstance(item, dict):
            raise ValueError(f"invalid audit event at line {number}")
        events.append(item)
    return events


def verify_events(events: list[dict[str, Any]]) -> tuple[bool, str]:
    previous = GENESIS
    for index, event in enumerate(events, 1):
        supplied = event.get("event_sha256")
        payload = dict(event)
        payload.pop("event_sha256", None)
        if payload.get("previous_sha256") != previous:
            return False, f"broken previous hash at event {index}"
        actual = hashlib.sha256(canonical(payload)).hexdigest()
        if supplied != actual:
            return False, f"event hash mismatch at event {index}"
        previous = actual
    return True, previous


@contextmanager
def audit_lock(root: str | Path):
    path = audit_dir(root) / "write.lock"
    with path.open("a+b") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _append_unlocked(root: str | Path, payload: dict[str, Any]) -> dict[str, Any]:
    directory = audit_dir(root)
    events = read_events(root)
    valid, tail = verify_events(events)
    if not valid:
        raise ValueError(tail)
    event = {**payload, "recorded_at": now(), "previous_sha256": tail}
    event["event_sha256"] = hashlib.sha256(canonical(event)).hexdigest()
    path = directory / "events.ndjson"
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    try:
        os.write(descriptor, canonical(event) + b"\n")
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    return event


def append(root: str | Path, payload: dict[str, Any]) -> dict[str, Any]:
    with audit_lock(root):
        return _append_unlocked(root, payload)


def sessions(events: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for event in events:
        session_id = event.get("session_id")
        if not isinstance(session_id, str):
            continue
        record = result.setdefault(session_id, {"session_id": session_id, "events": 0, "activities": 0})
        record["events"] += 1
        record["last_recorded_at"] = event.get("recorded_at")
        if event.get("event") == "session-start":
            record.update({
                "started_at": event.get("recorded_at"), "skills": event.get("skills", []),
                "tools": event.get("tools", []), "runtime": event.get("runtime"),
                "specialists": [],
                "chat_ref_sha256": event.get("chat_ref_sha256"), "outcome": "open",
                "cycle_id": event.get("cycle_id"), "feature_id": event.get("feature_id"),
            })
        elif event.get("event") == "activity" and event.get("kind") in {
            "skill", "tool", "specialist"
        }:
            field = {"skill": "skills", "tool": "tools", "specialist": "specialists"}[
                event["kind"]
            ]
            values = record.setdefault(field, [])
            name = event.get("name")
            if isinstance(name, str) and name not in values:
                values.append(name)
            record["activities"] += 1
        elif event.get("event") == "activity":
            record["activities"] += 1
        elif event.get("event") == "session-close":
            record["outcome"] = event.get("outcome")
            record["workspace_sha256"] = event.get("workspace_sha256")
    return result


def cmd_start(args: argparse.Namespace) -> dict[str, Any]:
    skills = sorted(set(args.skill or []))
    tools = sorted(set(args.tool or []))
    if not skills or not tools or not args.runtime.strip():
        raise ValueError("start requires at least one --skill, one --tool, and --runtime")
    with audit_lock(args.root):
        open_sessions = [item for item in sessions(read_events(args.root)).values()
                         if item.get("outcome") == "open"]
        if open_sessions:
            raise ValueError(
                f"an audit session is already open: {open_sessions[0]['session_id']}; "
                "record/close it instead of creating an overlapping chat record"
            )
        session_id = str(uuid.uuid4())
        chat_hash = hashlib.sha256(args.chat_ref.encode()).hexdigest() if args.chat_ref else None
        cycle_id = feature_id = None
        state_path = Path(args.root).resolve() / ".autopilot" / "state.json"
        if state_path.is_file():
            try:
                state = json.loads(state_path.read_text(encoding="utf-8"))
                cycle = state.get("cycle") if isinstance(state, dict) else None
                if isinstance(cycle, dict):
                    cycle_id, feature_id = cycle.get("id"), cycle.get("feature_id")
            except json.JSONDecodeError as exc:
                raise ValueError("invalid autopilot state prevents an attributable session") from exc
        if state_path.is_file() and (not cycle_id or not feature_id):
            raise ValueError("an active cycle is required before starting the audit session")
        event = _append_unlocked(args.root, {
            "event": "session-start", "session_id": session_id, "skills": skills,
            "tools": tools, "runtime": args.runtime.strip(), "chat_ref_sha256": chat_hash,
            "cycle_id": cycle_id, "feature_id": feature_id,
        })
    return {
        "receipt": "AUTOPILOT_V4_ACTIVE", "session_id": session_id,
        "skills": skills, "tools": tools, "runtime": args.runtime.strip(),
        "cycle_id": cycle_id, "feature_id": feature_id,
        "audit_tail_sha256": event["event_sha256"],
    }


def require_open(root: str | Path, session_id: str) -> None:
    record = sessions(read_events(root)).get(session_id)
    if not record or record.get("outcome") != "open":
        raise ValueError("session is missing or already closed")


def cmd_record(args: argparse.Namespace) -> dict[str, Any]:
    require_open(args.root, args.session_id)
    event = append(args.root, {
        "event": "activity", "session_id": args.session_id, "kind": args.kind,
        "name": args.name, "purpose": args.purpose, "result": args.result,
    })
    return {"receipt": "AUTOPILOT_V4_ACTIVITY_RECORDED", "session_id": args.session_id,
            "audit_tail_sha256": event["event_sha256"]}


def cmd_close(args: argparse.Namespace) -> dict[str, Any]:
    require_open(args.root, args.session_id)
    event = append(args.root, {"event": "session-close", "session_id": args.session_id,
                               "outcome": args.outcome,
                               "workspace_sha256": workspace_sha256(args.root)})
    return {"receipt": "AUTOPILOT_V4_SESSION_CLOSED", "session_id": args.session_id,
            "outcome": args.outcome, "audit_tail_sha256": event["event_sha256"]}


def build_report(args: argparse.Namespace) -> dict[str, Any]:
    events = read_events(args.root)
    valid, detail = verify_events(events)
    if not valid:
        return {"receipt": "AUTOPILOT_V4_AUDIT_INVALID", "chain_valid": False, "error": detail}
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=args.stale_minutes)
    records = list(sessions(events).values())
    counts: dict[str, int] = {}
    for record in records:
        outcome = record.get("outcome", "open")
        if outcome == "open":
            last = datetime.fromisoformat(record["last_recorded_at"])
            outcome = "abandoned-or-running" if last <= cutoff else "running"
        counts[outcome] = counts.get(outcome, 0) + 1
        record["watchdog_status"] = outcome
    return {"receipt": "AUTOPILOT_V4_AUDIT_REPORT", "chain_valid": True,
            "audit_tail_sha256": detail, "counts": counts, "sessions": records}


def parser() -> argparse.ArgumentParser:
    top = argparse.ArgumentParser(description=__doc__)
    sub = top.add_subparsers(dest="command", required=True)
    start = sub.add_parser("start")
    start.add_argument("--root", default="."); start.add_argument("--skill", action="append")
    start.add_argument("--tool", action="append"); start.add_argument("--runtime", required=True)
    start.add_argument("--chat-ref", default="")
    record = sub.add_parser("record")
    record.add_argument("--root", default="."); record.add_argument("--session-id", required=True)
    record.add_argument("--kind", choices=("skill", "tool", "specialist", "command", "status"), required=True)
    record.add_argument("--name", required=True); record.add_argument("--purpose", required=True)
    record.add_argument("--result", choices=("start", "pass", "fail", "blocked"), required=True)
    close = sub.add_parser("close")
    close.add_argument("--root", default="."); close.add_argument("--session-id", required=True)
    close.add_argument("--outcome", choices=("complete", "blocked", "handover", "owner-required"), required=True)
    for name in ("report", "verify"):
        command = sub.add_parser(name); command.add_argument("--root", default=".")
        command.add_argument("--stale-minutes", type=int, default=30)
    return top


def main() -> int:
    args = parser().parse_args()
    try:
        if args.command == "start": result = cmd_start(args)
        elif args.command == "record": result = cmd_record(args)
        elif args.command == "close": result = cmd_close(args)
        else: result = build_report(args)
        code = 2 if result.get("chain_valid") is False else 0
    except ValueError as exc:
        result = {"receipt": "AUTOPILOT_V4_AUDIT_BLOCKED", "error": str(exc)}; code = 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
