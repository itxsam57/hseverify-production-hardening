#!/usr/bin/env python3
"""Repository-side enforcement for Universal Project Autopilot V4."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import stat
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable


AGENTS_BEGIN = "<!-- UNIVERSAL-AUTOPILOT-V3:BEGIN -->"
AGENTS_END = "<!-- UNIVERSAL-AUTOPILOT-V3:END -->"
GITIGNORE_BEGIN = "# UNIVERSAL-AUTOPILOT-V3:BEGIN"
GITIGNORE_END = "# UNIVERSAL-AUTOPILOT-V3:END"
ZERO_SHA = "0" * 40
ALLOWED_COMMIT_PHASES = {"test-red", "recovery", "implementing", "verifying", "ready-to-complete"}
VALID_CYCLE_PHASES = ALLOWED_COMMIT_PHASES | {"preflight", "blocked"}


AGENTS_BLOCK = f"""{AGENTS_BEGIN}
## Universal Project Autopilot V4 — mandatory and observable

This repository is guarded. For every coding, debugging, continuation, CI, UI, deployment, or release task:

1. Load `universal-project-autopilot` before any mutating tool call.
2. Initialize/repair state if needed, then install or refresh the repository guard from the installed skill before requesting a receipt.
3. Start exactly one audit session with `.autopilot/autopilot_audit.py start`, declaring every active skill, material tool, and runtime. Then run `python .autopilot/guard.py session --root .` and show its JSON receipt to the user.
4. Record each newly used skill, specialist, material tool/command, gate result, blocker, and status change with `autopilot_audit.py record`. Close the session only as complete, blocked, owner-required, or exact handover.
5. If receipt or audit validation fails, make no product/code mutation. Reconcile Git, failed CI, broken UI/runtime, inherited dirty work, and audit state first.
6. Known-red CI, startup, browser, security, or purpose behavior is the highest-priority feature until repaired and reverified. Record it with `mark-known-red`.
7. Never use `--no-verify`, disable hooks, forge commit trailers, remove this block, or weaken the compliance workflow.
8. Do not claim completion unless `complete-project` succeeds at the exact clean SHA and the real UI/purpose/security/deployment gates applicable to the project pass.

Routine continuation never requires the owner to type `continue`. A response boundary is not a work boundary.
{AGENTS_END}
"""


GITIGNORE_BLOCK = f"""{GITIGNORE_BEGIN}
.autopilot/*
!.autopilot/guard.py
!.autopilot/autopilot_state.py
!.autopilot/autopilot_audit.py
!.autopilot/audit/
.autopilot/audit/*
!.autopilot/audit/events.ndjson
{GITIGNORE_END}
"""


WORKFLOW = """name: Autopilot Compliance
# UNIVERSAL_AUTOPILOT_V3_WORKFLOW

on:
  pull_request:
  push:

permissions:
  contents: read

jobs:
  compliance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          ref: ${{ github.event.pull_request.head.sha || github.sha }}
      - name: Verify guarded commits
        env:
          EVENT_NAME: ${{ github.event_name }}
          BEFORE_SHA: ${{ github.event.before }}
          PR_BASE_SHA: ${{ github.event.pull_request.base.sha }}
          PR_HEAD_SHA: ${{ github.event.pull_request.head.sha }}
          HEAD_SHA: ${{ github.sha }}
          DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}
        run: |
          base="$BEFORE_SHA"
          head="$HEAD_SHA"
          if [ "$EVENT_NAME" = "pull_request" ]; then base="$PR_BASE_SHA"; head="$PR_HEAD_SHA"; fi
          if [ "$base" = "0000000000000000000000000000000000000000" ]; then
            candidate="$(git merge-base "origin/$DEFAULT_BRANCH" "$head" 2>/dev/null || true)"
            if [ -n "$candidate" ] && [ "$candidate" != "$head" ]; then base="$candidate"; fi
          fi
          python .autopilot/guard.py ci --root . --base-sha "$base" --head-sha "$head"
"""


def _run_git(root: Path | str, args: list[str], error: str) -> str:
    completed = subprocess.run(
        ["git", *args], cwd=Path(root).resolve(), text=True, capture_output=True, check=False
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip()
        raise ValueError(f"{error}{': ' + detail if detail else ''}")
    return completed.stdout.strip()


def _root(root: Path | str) -> Path:
    project = Path(root).resolve()
    actual = Path(_run_git(project, ["rev-parse", "--show-toplevel"], "not a Git repository")).resolve()
    if actual != project:
        raise ValueError(f"--root must be the Git repository root: {actual}")
    return project


def _branch(root: Path | str) -> str:
    return _run_git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], "named branch required")


def _head(root: Path | str) -> str:
    return _run_git(root, ["rev-parse", "--verify", "HEAD"], "repository requires a commit")


def _read_state(root: Path | str) -> dict[str, Any]:
    path = Path(root).resolve() / ".autopilot" / "state.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        raise ValueError(
            "AUTOPILOT_V3_RECOVERY_REQUIRED: missing or invalid .autopilot/state.json"
        ) from exc
    if not isinstance(value, dict):
        raise ValueError("AUTOPILOT_V3_RECOVERY_REQUIRED: state must be an object")
    return value


def _active(root: Path | str) -> tuple[dict[str, Any], dict[str, Any], str]:
    state = _read_state(root)
    if state.get("handover") is not None:
        raise ValueError("pending handover: run resume-handover before any mutation")
    cycle = state.get("cycle")
    if not isinstance(cycle, dict) or state.get("status") != "ACTIVE":
        raise ValueError("AUTOPILOT_V3_RECOVERY_REQUIRED: a valid active cycle is required")
    branch = _branch(root)
    if cycle.get("branch") != branch:
        raise ValueError(
            f"active-cycle branch {cycle.get('branch')} does not match current branch {branch}"
        )
    if state.get("current_feature_id") != cycle.get("feature_id"):
        raise ValueError("state feature does not match the active cycle")
    if not cycle.get("id") or not cycle.get("feature_id"):
        raise ValueError("active cycle is missing its ID or feature")
    if cycle.get("phase") not in VALID_CYCLE_PHASES:
        raise ValueError("active cycle phase is invalid")
    if not isinstance(cycle.get("acceptance"), list) or not cycle["acceptance"]:
        raise ValueError("active cycle acceptance is empty")
    if not isinstance(cycle.get("required_gates"), list) or not {
        "code",
        "purpose",
        "security",
    } <= set(cycle["required_gates"]):
        raise ValueError("active cycle required gates are invalid")
    if not isinstance(cycle.get("commands"), list):
        raise ValueError("active cycle commands must be an array")
    if cycle.get("phase") in {"implementing", "verifying", "ready-to-complete"} and not any(
        isinstance(item, dict) and item.get("result") == "fail"
        for item in cycle["commands"]
    ):
        raise ValueError("active implementation/verification cycle lacks a failing reproduction")
    if state.get("next_action") != cycle.get("next_action"):
        raise ValueError("state next action does not match the active cycle")
    pending_known_red = state.get("pending_known_red")
    if pending_known_red is not None:
        expected = (
            pending_known_red.get("workspace", {}).get("recovery_content_sha256")
            if isinstance(pending_known_red, dict)
            else None
        )
        if not expected or _workspace_content_sha256(root) != expected:
            raise ValueError(
                "pending known-red preemption is now mandatory; rerun mark-known-red before "
                "further project mutation"
            )
    return state, cycle, branch


def _validate_project_contract(root: Path) -> None:
    engine_path = root / ".autopilot" / "autopilot_state.py"
    if not engine_path.is_file():
        raise ValueError("AUTOPILOT_V3_RECOVERY_REQUIRED: state validator is not installed")
    spec = importlib.util.spec_from_file_location("autopilot_v3_project_state", engine_path)
    if spec is None or spec.loader is None:
        raise ValueError("AUTOPILOT_V3_RECOVERY_REQUIRED: state validator cannot load")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    errors = module.validate_project(root)
    if errors:
        raise ValueError("AUTOPILOT_V3_RECOVERY_REQUIRED: " + "; ".join(dict.fromkeys(errors)))


def _verify_guard_installation(root: Path) -> None:
    agents = root / "AGENTS.md"
    workflow = root / ".github" / "workflows" / "autopilot-compliance.yml"
    if not agents.is_file() or AGENTS_BEGIN not in agents.read_text(encoding="utf-8"):
        raise ValueError("AUTOPILOT_V3_RECOVERY_REQUIRED: managed AGENTS.md block is missing")
    if not workflow.is_file() or "UNIVERSAL_AUTOPILOT_V3_WORKFLOW" not in workflow.read_text(
        encoding="utf-8"
    ):
        raise ValueError("AUTOPILOT_V3_RECOVERY_REQUIRED: compliance workflow is missing")
    for name in ("pre-commit", "prepare-commit-msg", "pre-push"):
        hook = _hook_path(root, name)
        if not hook.is_file() or "UNIVERSAL_AUTOPILOT_V3_WRAPPER" not in hook.read_text(
            encoding="utf-8", errors="replace"
        ):
            raise ValueError(f"AUTOPILOT_V3_RECOVERY_REQUIRED: {name} guard hook is missing")


def _active_audit_session(root: Path) -> dict[str, Any]:
    audit_path = root / ".autopilot" / "autopilot_audit.py"
    if not audit_path.is_file():
        raise ValueError("AUTOPILOT_V4_AUDIT_REQUIRED: audit watchdog is not installed")
    spec = importlib.util.spec_from_file_location("autopilot_v4_project_audit", audit_path)
    if spec is None or spec.loader is None:
        raise ValueError("AUTOPILOT_V4_AUDIT_REQUIRED: audit watchdog cannot load")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    events = module.read_events(root)
    valid, detail = module.verify_events(events)
    if not valid:
        raise ValueError(f"AUTOPILOT_V4_AUDIT_INVALID: {detail}")
    open_sessions = [item for item in module.sessions(events).values() if item.get("outcome") == "open"]
    if len(open_sessions) != 1:
        raise ValueError(
            "AUTOPILOT_V4_AUDIT_REQUIRED: exactly one open coding-chat session is required"
        )
    current = open_sessions[0]
    try:
        last_activity = datetime.fromisoformat(current["last_recorded_at"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("AUTOPILOT_V4_AUDIT_REQUIRED: session timestamp is invalid") from exc
    if last_activity < datetime.now(timezone.utc) - timedelta(minutes=30):
        raise ValueError(
            "AUTOPILOT_V4_AUDIT_REQUIRED: session is stale; record a current status heartbeat"
        )
    if "universal-project-autopilot" not in current.get("skills", []):
        raise ValueError("AUTOPILOT_V4_AUDIT_REQUIRED: autopilot skill was not disclosed")
    if current.get("cycle_id") is None or current.get("feature_id") is None:
        raise ValueError("AUTOPILOT_V4_AUDIT_REQUIRED: session lacks cycle attribution")
    return current


def _audit_session_for_commit(root: Path) -> dict[str, Any]:
    try:
        return _active_audit_session(root)
    except ValueError as active_error:
        audit_path = root / ".autopilot" / "autopilot_audit.py"
        if not audit_path.is_file():
            raise active_error
        spec = importlib.util.spec_from_file_location("autopilot_v4_commit_audit", audit_path)
        if spec is None or spec.loader is None:
            raise active_error
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        events = module.read_events(root)
        valid, _ = module.verify_events(events)
        records = list(module.sessions(events).values()) if valid else []
        if not records:
            raise active_error
        latest = records[-1]
        if latest.get("outcome") not in {"complete", "blocked", "handover", "owner-required"}:
            raise active_error
        if latest.get("workspace_sha256") != module.workspace_sha256(root):
            raise ValueError(
                "AUTOPILOT_V4_AUDIT_REQUIRED: workspace changed after session close"
            )
        return latest


def _audit_session_for_push(root: Path) -> dict[str, Any]:
    try:
        return _active_audit_session(root)
    except ValueError as active_error:
        audit_path = root / ".autopilot" / "autopilot_audit.py"
        if not audit_path.is_file():
            raise active_error
        spec = importlib.util.spec_from_file_location("autopilot_v4_push_audit", audit_path)
        if spec is None or spec.loader is None:
            raise active_error
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        events = module.read_events(root)
        valid, _ = module.verify_events(events)
        records = list(module.sessions(events).values()) if valid else []
        if not records or records[-1].get("outcome") == "open":
            raise active_error
        message = _commit_message(root, _head(root))
        expected = f"Autopilot-Session: {records[-1]['session_id']}"
        if message.splitlines().count(expected) != 1:
            raise ValueError(
                "AUTOPILOT_V4_AUDIT_REQUIRED: pushed closed session is not the guarded HEAD"
            )
        return records[-1]


def check_session(root: Path | str) -> dict[str, Any]:
    project = _root(root)
    _verify_guard_installation(project)
    state, cycle, branch = _active(project)
    _validate_project_contract(project)
    audit = _active_audit_session(project)
    return {
        "receipt": "AUTOPILOT_V4_ACTIVE",
        "session_id": audit["session_id"],
        "skills": audit["skills"],
        "tools": audit["tools"],
        "runtime": audit["runtime"],
        "status": state["status"],
        "cycle_id": cycle["id"],
        "feature_id": cycle["feature_id"],
        "phase": cycle.get("phase"),
        "branch": branch,
        "head_sha": _head(project),
        "next_action": cycle.get("next_action") or state.get("next_action"),
    }


def _staged_paths(root: Path | str) -> list[str]:
    output = _run_git(root, ["diff", "--cached", "--name-only"], "cannot inspect index")
    return [line for line in output.splitlines() if line]


def _workspace_content_sha256(root: Path | str) -> str:
    project = Path(root).resolve()
    pathspec = [
        "--",
        ".",
        ":(exclude).autopilot",
        ":(exclude).autopilot/**",
        ":(exclude)AGENTS.md",
        ":(exclude).gitignore",
        ":(exclude).github/workflows/autopilot-compliance.yml",
    ]
    diff = subprocess.run(
        ["git", "diff", "HEAD", "--binary", "--no-ext-diff", *pathspec],
        cwd=project,
        check=False,
        capture_output=True,
    )
    if diff.returncode != 0:
        raise ValueError("could not fingerprint recovery workspace")
    untracked = subprocess.run(
        ["git", "ls-files", "--others", "--exclude-standard", "-z", *pathspec],
        cwd=project,
        check=False,
        capture_output=True,
    )
    if untracked.returncode != 0:
        raise ValueError("could not fingerprint recovery untracked files")
    untracked_hasher = hashlib.sha256()
    for raw_name in sorted(item for item in untracked.stdout.split(b"\0") if item):
        name = raw_name.decode("utf-8", errors="surrogateescape")
        path = project / name
        untracked_hasher.update(raw_name)
        untracked_hasher.update(b"\0")
        if path.is_symlink():
            untracked_hasher.update(os.readlink(path).encode("utf-8", errors="surrogateescape"))
        elif path.is_file():
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    untracked_hasher.update(chunk)
        untracked_hasher.update(b"\0")
    return hashlib.sha256(diff.stdout + b"\0" + untracked_hasher.digest()).hexdigest()


def _is_enforcement_path(path: str) -> bool:
    return (
        path == "AGENTS.md"
        or path == ".gitignore"
        or path == ".autopilot/guard.py"
        or path == ".autopilot/autopilot_state.py"
        or path.startswith(".autopilot/")
        or path == ".github/workflows/autopilot-compliance.yml"
    )


def check_pre_commit(root: Path | str) -> dict[str, Any]:
    project = _root(root)
    _, cycle, branch = _active(project)
    _verify_guard_installation(project)
    _validate_project_contract(project)
    audit = _audit_session_for_commit(project)
    project_changes = [path for path in _staged_paths(project) if not _is_enforcement_path(path)]
    phase = cycle.get("phase")
    if phase == "recovery" and project_changes:
        adopted = cycle.get("adopted_workspace")
        expected = adopted.get("recovery_content_sha256") if isinstance(adopted, dict) else None
        if not expected or _workspace_content_sha256(project) != expected:
            raise ValueError(
                "project commit exceeds the adopted recovery workspace; record a failing "
                "reproduction/test-red checkpoint before new product changes"
            )
    if project_changes and phase not in ALLOWED_COMMIT_PHASES:
        raise ValueError(
            "project commit blocked: checkpoint the required test-red or recovery phase first"
        )
    if project_changes and phase != "recovery" and not any(
        isinstance(item, dict) and item.get("result") == "fail"
        for item in cycle.get("commands", [])
    ):
        raise ValueError(
            "project commit blocked: record a failing reproduction/test-red checkpoint first"
        )
    return {
        "receipt": "AUTOPILOT_V4_COMMIT_ALLOWED",
        "session_id": audit["session_id"],
        "cycle_id": cycle["id"],
        "feature_id": cycle["feature_id"],
        "phase": phase,
        "branch": branch,
        "staged_project_files": len(project_changes),
    }


def prepare_commit_message(root: Path | str, message_file: Path | str) -> dict[str, Any]:
    project = _root(root)
    _, cycle, _ = _active(project)
    _verify_guard_installation(project)
    _validate_project_contract(project)
    audit = _audit_session_for_commit(project)
    path = Path(message_file)
    text = path.read_text(encoding="utf-8")
    trailers = {
        "Autopilot-Cycle": str(cycle["id"]),
        "Autopilot-Feature": str(cycle["feature_id"]),
        "Autopilot-Session": str(audit["session_id"]),
    }
    lines = text.splitlines()
    for key, value in trailers.items():
        prefix = f"{key}:"
        lines = [line for line in lines if not line.startswith(prefix)]
        lines.append(f"{key}: {value}")
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return {"receipt": "AUTOPILOT_V4_TRAILERS_ADDED", **trailers}


def _default_branch(root: Path | str, remote_name: str = "origin") -> str:
    completed = subprocess.run(
        ["git", "symbolic-ref", "--quiet", "--short", f"refs/remotes/{remote_name}/HEAD"],
        cwd=Path(root).resolve(), text=True, capture_output=True, check=False,
    )
    if completed.returncode == 0 and completed.stdout.strip().startswith(f"{remote_name}/"):
        return completed.stdout.strip().split("/", 1)[1]
    configured = subprocess.run(
        ["git", "config", "--local", "--get", "autopilot.sharedBranch"],
        cwd=Path(root).resolve(),
        text=True,
        capture_output=True,
        check=False,
    )
    if configured.returncode == 0 and configured.stdout.strip():
        return configured.stdout.strip()
    remote_exists = subprocess.run(
        ["git", "remote", "get-url", remote_name],
        cwd=Path(root).resolve(),
        capture_output=True,
        check=False,
    ).returncode == 0
    if remote_exists:
        raise ValueError(
            f"default branch for remote {remote_name} is unknown; set local "
            "autopilot.sharedBranch explicitly"
        )
    for candidate in ("main", "master", "trunk", "develop", "production"):
        exists = subprocess.run(
            ["git", "show-ref", "--verify", "--quiet", f"refs/heads/{candidate}"],
            cwd=Path(root).resolve(), check=False,
        )
        if exists.returncode == 0:
            return candidate
    return "main"


def check_pre_push(
    root: Path | str,
    updates: Iterable[tuple[str, str, str, str]],
    remote_name: str = "origin",
) -> dict[str, Any]:
    project = _root(root)
    state = _read_state(project)
    default = _default_branch(project, remote_name)
    checked = 0
    for local_ref, local_sha, remote_ref, _remote_sha in updates:
        remote_branch = remote_ref.removeprefix("refs/heads/")
        if local_sha == ZERO_SHA:
            if remote_ref == f"refs/heads/{default}":
                raise ValueError(f"deletion of default branch {default} is blocked")
            continue
        checked += 1
        if remote_ref.startswith("refs/tags/"):
            commit_sha = _run_git(
                project,
                ["rev-parse", f"{local_sha}^{{commit}}"],
                "tag must resolve to a commit",
            )
            if state.get("status") != "COMPLETE" or state.get("verified_sha") != commit_sha:
                raise ValueError("tag push blocked: COMPLETE exact-SHA state required")
            _validate_project_contract(project)
            continue
        if not remote_ref.startswith("refs/heads/"):
            raise ValueError(f"unsupported push destination: {remote_ref}")
        if remote_branch == default:
            if (
                state.get("status") != "COMPLETE"
                or state.get("cycle") is not None
                or state.get("handover") is not None
                or state.get("verified_sha") != local_sha
            ):
                raise ValueError(
                    f"push to default branch {default} blocked: COMPLETE exact-SHA state required"
                )
            _validate_project_contract(project)
        else:
            if state.get("status") == "COMPLETE" and state.get("verified_sha") == local_sha:
                _validate_project_contract(project)
                continue
            _, cycle, _ = _active(project)
            _verify_guard_installation(project)
            _validate_project_contract(project)
            _audit_session_for_push(project)
            if remote_branch != cycle.get("branch"):
                raise ValueError(
                    f"feature push destination {remote_branch} does not match active cycle branch "
                    f"{cycle.get('branch')}"
                )
            if local_sha != _head(project):
                raise ValueError(f"push of {local_ref} is not the checked-out guarded HEAD")
    return {"receipt": "AUTOPILOT_V4_PUSH_ALLOWED", "allowed_updates": checked}


def _commit_message(root: Path | str, sha: str) -> str:
    return _run_git(root, ["show", "-s", "--format=%B", sha], f"cannot read commit {sha}")


def check_ci(root: Path | str, commits: Iterable[str]) -> dict[str, Any]:
    project = _root(root)
    audit_path = project / ".autopilot" / "autopilot_audit.py"
    if not audit_path.is_file():
        raise ValueError("autopilot audit watchdog is missing")
    spec = importlib.util.spec_from_file_location("autopilot_v4_ci_audit", audit_path)
    if spec is None or spec.loader is None:
        raise ValueError("autopilot audit watchdog cannot load")
    audit_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(audit_module)
    audit_events = audit_module.read_events(project)
    audit_valid, audit_detail = audit_module.verify_events(audit_events)
    if not audit_valid:
        raise ValueError(f"invalid autopilot audit chain: {audit_detail}")
    known_sessions = audit_module.sessions(audit_events)
    checked = 0
    for sha in commits:
        if not sha or sha == ZERO_SHA:
            continue
        message = _commit_message(project, sha)
        parsed: dict[str, list[str]] = {}
        for line in message.splitlines():
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            if key in {"Autopilot-Cycle", "Autopilot-Feature", "Autopilot-Session"}:
                parsed.setdefault(key, []).append(value.strip())
        for key in ("Autopilot-Cycle", "Autopilot-Feature", "Autopilot-Session"):
            values = parsed.get(key, [])
            if len(values) != 1 or not values[0] or any(char.isspace() for char in values[0]):
                raise ValueError(f"commit {sha} has missing or invalid {key} trailer")
        session = known_sessions.get(parsed["Autopilot-Session"][0])
        if session is None:
            raise ValueError(f"commit {sha} references an unknown Autopilot-Session")
        if session.get("cycle_id") != parsed["Autopilot-Cycle"][0]:
            raise ValueError(f"commit {sha} cycle trailer does not match its audit session")
        if session.get("feature_id") != parsed["Autopilot-Feature"][0]:
            raise ValueError(f"commit {sha} feature trailer does not match its audit session")
        if session.get("activities", 0) < 1:
            raise ValueError(f"commit {sha} audit session contains no recorded activity")
        checked += 1
    if checked == 0:
        raise ValueError("no commits were supplied to the compliance check")
    return {"receipt": "AUTOPILOT_V4_CI_COMPLIANT", "checked_commits": checked}


def _replace_managed_block(path: Path, begin: str, end: str, block: str) -> None:
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    start = existing.find(begin)
    finish = existing.find(end)
    if start >= 0 and finish >= start:
        finish += len(end)
        existing = existing[:start].rstrip() + "\n\n" + existing[finish:].lstrip()
    payload = existing.rstrip()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text((payload + "\n\n" if payload else "") + block.rstrip() + "\n", encoding="utf-8")


def _hook_path(root: Path, name: str) -> Path:
    raw = _run_git(root, ["rev-parse", "--git-path", f"hooks/{name}"], "cannot locate Git hooks")
    path = Path(raw)
    return path if path.is_absolute() else root / path


def _hook_wrapper(name: str) -> str:
    if name == "pre-commit":
        action = (
            '"$PYTHON" "$ROOT/.autopilot/guard.py" pre-commit --root "$ROOT" || exit $?\n'
            'if [ -x "$USER_HOOK" ]; then "$USER_HOOK" "$@" || exit $?; fi\n'
            '"$PYTHON" "$ROOT/.autopilot/guard.py" pre-commit --root "$ROOT"'
        )
    elif name == "prepare-commit-msg":
        action = '"$PYTHON" "$ROOT/.autopilot/guard.py" prepare-commit-msg --root "$ROOT" --message-file "$1"'
    elif name == "pre-push":
        action = (
            'INPUT_FILE="$(mktemp)"\ncat > "$INPUT_FILE"\n'
            '"$PYTHON" "$ROOT/.autopilot/guard.py" pre-push --root "$ROOT" --remote-name "$1" --updates-file "$INPUT_FILE" || { code=$?; rm -f "$INPUT_FILE"; exit "$code"; }\n'
            'if [ -x "$USER_HOOK" ]; then "$USER_HOOK" "$@" < "$INPUT_FILE" || { code=$?; rm -f "$INPUT_FILE"; exit "$code"; }; fi\n'
            '"$PYTHON" "$ROOT/.autopilot/guard.py" pre-push --root "$ROOT" --remote-name "$1" --updates-file "$INPUT_FILE"\n'
            'code=$?\nrm -f "$INPUT_FILE"\nexit "$code"'
        )
    else:
        raise ValueError(f"unsupported hook: {name}")
    user_call = ""
    if name == "prepare-commit-msg":
        user_call = 'if [ -x "$USER_HOOK" ]; then "$USER_HOOK" "$@" || exit $?; fi\n'
    return f"""#!/bin/sh
# UNIVERSAL_AUTOPILOT_V3_WRAPPER
ROOT="$(git rev-parse --show-toplevel)" || exit 2
USER_HOOK="$ROOT/.autopilot/hooks/{name}.user"
if command -v python3 >/dev/null 2>&1; then PYTHON=python3; else PYTHON=python; fi
{user_call}{action}
"""


def _install_hook(root: Path, name: str) -> None:
    target = _hook_path(root, name)
    backup = root / ".autopilot" / "hooks" / f"{name}.user"
    target.parent.mkdir(parents=True, exist_ok=True)
    backup.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        current = target.read_text(encoding="utf-8", errors="replace")
        if "UNIVERSAL_AUTOPILOT_V3_WRAPPER" not in current and not backup.exists():
            shutil.copy2(target, backup)
            backup.chmod(backup.stat().st_mode | stat.S_IXUSR)
    target.write_text(_hook_wrapper(name), encoding="utf-8")
    target.chmod(target.stat().st_mode | stat.S_IXUSR)


def _activate_project_hook_directory(root: Path) -> None:
    existing: dict[str, Path] = {
        name: _hook_path(root, name)
        for name in ("pre-commit", "prepare-commit-msg", "pre-push")
    }
    backup_dir = root / ".autopilot" / "hooks"
    backup_dir.mkdir(parents=True, exist_ok=True)
    for name, path in existing.items():
        backup = backup_dir / f"{name}.user"
        if path.exists() and not backup.exists():
            current = path.read_text(encoding="utf-8", errors="replace")
            if "UNIVERSAL_AUTOPILOT_V3_WRAPPER" not in current:
                shutil.copy2(path, backup)
                backup.chmod(backup.stat().st_mode | stat.S_IXUSR)
    git_dir = Path(
        _run_git(root, ["rev-parse", "--absolute-git-dir"], "cannot locate Git directory")
    ).resolve()
    hooks_dir = git_dir / "autopilot-hooks"
    hooks_dir.mkdir(parents=True, exist_ok=True)
    for directory in {path.parent for path in existing.values()}:
        if not directory.is_dir() or directory.resolve() == hooks_dir.resolve():
            continue
        for source in directory.iterdir():
            destination = hooks_dir / source.name
            if source.is_file() and not source.name.endswith(".sample") and not destination.exists():
                shutil.copy2(source, destination)
    _run_git(
        root,
        ["config", "--local", "core.hooksPath", str(hooks_dir)],
        "cannot configure project-local hooks",
    )


def install_guard(root: Path | str, source: Path | str) -> dict[str, Any]:
    project = _root(root)
    installed_state = _read_state(project)
    source_path = Path(source).resolve()
    if not source_path.is_file():
        raise ValueError("guard source is missing")
    destination = project / ".autopilot" / "guard.py"
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source_path != destination.resolve():
        shutil.copy2(source_path, destination)
    destination.chmod(destination.stat().st_mode | stat.S_IXUSR)
    state_source = source_path.parent / "autopilot_state.py"
    state_destination = project / ".autopilot" / "autopilot_state.py"
    if not state_source.is_file():
        raise ValueError("autopilot state validator source is missing")
    if state_source.resolve() != state_destination.resolve():
        shutil.copy2(state_source, state_destination)
    state_destination.chmod(state_destination.stat().st_mode | stat.S_IXUSR)
    audit_source = source_path.parent / "autopilot_audit.py"
    audit_destination = project / ".autopilot" / "autopilot_audit.py"
    if not audit_source.is_file():
        raise ValueError("autopilot audit watchdog source is missing")
    if audit_source.resolve() != audit_destination.resolve():
        shutil.copy2(audit_source, audit_destination)
    audit_destination.chmod(audit_destination.stat().st_mode | stat.S_IXUSR)
    _replace_managed_block(project / "AGENTS.md", AGENTS_BEGIN, AGENTS_END, AGENTS_BLOCK)
    _replace_managed_block(
        project / ".gitignore", GITIGNORE_BEGIN, GITIGNORE_END, GITIGNORE_BLOCK
    )
    workflow = project / ".github" / "workflows" / "autopilot-compliance.yml"
    workflow.parent.mkdir(parents=True, exist_ok=True)
    if workflow.exists() and "UNIVERSAL_AUTOPILOT_V3_WORKFLOW" not in workflow.read_text(
        encoding="utf-8", errors="replace"
    ):
        backup = project / ".autopilot" / "backups" / "autopilot-compliance.user.yml"
        backup.parent.mkdir(parents=True, exist_ok=True)
        if not backup.exists():
            shutil.copy2(workflow, backup)
    workflow.write_text(WORKFLOW, encoding="utf-8")
    _activate_project_hook_directory(project)
    for name in ("pre-commit", "prepare-commit-msg", "pre-push"):
        _install_hook(project, name)
    cycle = installed_state.get("cycle")
    if isinstance(cycle, dict) and isinstance(cycle.get("shared_branch"), str) and cycle[
        "shared_branch"
    ]:
        _run_git(
            project,
            ["config", "--local", "autopilot.sharedBranch", cycle["shared_branch"]],
            "cannot configure the guarded shared branch",
        )
    return {
        "receipt": "AUTOPILOT_V4_GUARD_INSTALLED",
        "root": str(project),
        "files": [
            ".autopilot/guard.py",
            ".autopilot/autopilot_state.py",
            ".autopilot/autopilot_audit.py",
            "AGENTS.md",
            ".gitignore",
            ".github/workflows/autopilot-compliance.yml",
        ],
        "hooks": ["pre-commit", "prepare-commit-msg", "pre-push"],
    }


def _updates(path: Path | str) -> list[tuple[str, str, str, str]]:
    values = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) != 4:
            raise ValueError("invalid pre-push update line")
        values.append(tuple(parts))
    return values


def _commits_for_range(root: Path, base: str | None, head: str) -> list[str]:
    if base and base != ZERO_SHA:
        output = _run_git(root, ["rev-list", "--reverse", f"{base}..{head}"], "cannot enumerate commits")
        commits = [line for line in output.splitlines() if line]
        return commits or [head]
    return [head]


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("session", "pre-commit"):
        command = sub.add_parser(name)
        command.add_argument("--root", default=".")
    prepare = sub.add_parser("prepare-commit-msg")
    prepare.add_argument("--root", default=".")
    prepare.add_argument("--message-file", required=True)
    push = sub.add_parser("pre-push")
    push.add_argument("--root", default=".")
    push.add_argument("--updates-file", required=True)
    push.add_argument("--remote-name", default="origin")
    ci = sub.add_parser("ci")
    ci.add_argument("--root", default=".")
    ci.add_argument("--base-sha")
    ci.add_argument("--head-sha", required=True)
    install = sub.add_parser("install")
    install.add_argument("--root", default=".")
    return parser


def main() -> int:
    args = _parser().parse_args()
    root = Path(args.root)
    try:
        if args.command == "session":
            result = check_session(root)
        elif args.command == "pre-commit":
            result = check_pre_commit(root)
        elif args.command == "prepare-commit-msg":
            result = prepare_commit_message(root, args.message_file)
        elif args.command == "pre-push":
            result = check_pre_push(root, _updates(args.updates_file), args.remote_name)
        elif args.command == "ci":
            project = _root(root)
            commits = _commits_for_range(project, args.base_sha, args.head_sha)
            result = check_ci(project, commits)
        elif args.command == "install":
            result = install_guard(root, Path(__file__))
        else:
            raise ValueError("unknown command")
        print(json.dumps(result, indent=2))
        return 0
    except ValueError as exc:
        print(json.dumps({"receipt": "AUTOPILOT_V4_BLOCKED", "error": str(exc)}, indent=2))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
