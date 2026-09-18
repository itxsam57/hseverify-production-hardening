#!/usr/bin/env python3
"""Minimal durable state and evidence gate for Universal Project Autopilot."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = 2
SUPPORTED_SCHEMA_VERSIONS = {1, 2}
ALLOWED_GATES = {"code", "ui", "purpose", "security", "deployment"}
ALLOWED_RESULTS = {"pass", "fail", "blocked"}
ALLOWED_STATES = {"ACTIVE", "OWNER_REQUIRED", "WAIT_EXTERNAL", "BLOCKED", "COMPLETE"}
ALLOWED_CYCLE_PHASES = {
    "preflight",
    "recovery",
    "test-red",
    "implementing",
    "verifying",
    "ready-to-complete",
    "blocked",
}
HARD_BOUNDARY_REASONS = {
    "context-limit",
    "model-quota",
    "tool-quota",
    "forced-model-switch",
    "runtime-deadline",
}
SHA256_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _state_dir(root: Path | str) -> Path:
    return Path(root).resolve() / ".autopilot"


def _git_head(root: Path | str, require_clean_project: bool = False) -> str:
    project_root = Path(root).resolve()
    completed = subprocess.run(
        ["git", "rev-parse", "--verify", "HEAD"],
        cwd=project_root,
        check=False,
        text=True,
        capture_output=True,
    )
    if completed.returncode != 0:
        raise ValueError("project must be a Git repository with at least one commit")
    head = completed.stdout.strip()
    if require_clean_project:
        status = subprocess.run(
            [
                "git",
                "status",
                "--porcelain=v1",
                "--untracked-files=all",
                "--",
                ".",
                ":(exclude).autopilot",
                ":(exclude).autopilot/**",
            ],
            cwd=project_root,
            check=False,
            text=True,
            capture_output=True,
        )
        if status.returncode != 0:
            raise ValueError("could not inspect Git working tree")
        if status.stdout.strip():
            raise ValueError("uncommitted project changes prevent exact-SHA evidence")
    return head


def _assert_current_sha(root: Path | str, sha: str) -> None:
    head = _git_head(root, require_clean_project=True)
    if sha != head:
        raise ValueError(f"evidence SHA {sha} does not match repository HEAD {head}")


def _git_text(root: Path | str, args: list[str], error: str) -> str:
    completed = subprocess.run(
        ["git", *args],
        cwd=Path(root).resolve(),
        check=False,
        text=True,
        capture_output=True,
    )
    if completed.returncode != 0:
        raise ValueError(error)
    return completed.stdout.strip()


def _git_bytes(root: Path | str, args: list[str], error: str) -> bytes:
    completed = subprocess.run(
        ["git", *args],
        cwd=Path(root).resolve(),
        check=False,
        capture_output=True,
    )
    if completed.returncode != 0:
        raise ValueError(error)
    return completed.stdout


def _git_branch(root: Path | str) -> str:
    branch = _git_text(
        root,
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        "autopilot cycles require a named Git branch, not detached HEAD",
    )
    if not branch:
        raise ValueError("autopilot cycles require a named Git branch")
    return branch


def _detect_shared_branch(root: Path | str) -> str | None:
    completed = subprocess.run(
        ["git", "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
        cwd=Path(root).resolve(),
        check=False,
        text=True,
        capture_output=True,
    )
    if completed.returncode == 0 and completed.stdout.strip().startswith("origin/"):
        return completed.stdout.strip().split("/", 1)[1]
    for candidate in ("main", "master", "trunk", "develop", "production"):
        exists = subprocess.run(
            ["git", "show-ref", "--verify", "--quiet", f"refs/heads/{candidate}"],
            cwd=Path(root).resolve(),
            check=False,
        )
        if exists.returncode == 0:
            return candidate
    return None


def _repo_identity(root: Path | str) -> dict[str, Any]:
    roots = _git_text(
        root,
        ["rev-list", "--max-parents=0", "HEAD"],
        "could not identify repository history",
    ).splitlines()
    remote = subprocess.run(
        ["git", "remote", "get-url", "origin"],
        cwd=Path(root).resolve(),
        check=False,
        text=True,
        capture_output=True,
    )
    remote_value = remote.stdout.strip() if remote.returncode == 0 else ""
    return {
        "root_commits": sorted(roots),
        "origin_sha256": hashlib.sha256(remote_value.encode("utf-8")).hexdigest(),
    }


def _workspace_snapshot(root: Path | str) -> dict[str, Any]:
    project_root = Path(root).resolve()
    pathspec = ["--", ".", ":(exclude).autopilot", ":(exclude).autopilot/**"]
    status = _git_bytes(
        root,
        ["status", "--porcelain=v1", "--untracked-files=all", *pathspec],
        "could not inspect Git working tree",
    )
    unstaged = _git_bytes(
        root,
        ["diff", "--binary", "--no-ext-diff", *pathspec],
        "could not fingerprint unstaged changes",
    )
    staged = _git_bytes(
        root,
        ["diff", "--cached", "--binary", "--no-ext-diff", *pathspec],
        "could not fingerprint staged changes",
    )
    content = _git_bytes(
        root,
        ["diff", "HEAD", "--binary", "--no-ext-diff", *pathspec],
        "could not fingerprint workspace content",
    )
    untracked_raw = _git_bytes(
        root,
        ["ls-files", "--others", "--exclude-standard", "-z", *pathspec],
        "could not fingerprint untracked changes",
    )
    recovery_pathspec = [
        "--",
        ".",
        ":(exclude).autopilot",
        ":(exclude).autopilot/**",
        ":(exclude)AGENTS.md",
        ":(exclude).gitignore",
        ":(exclude).github/workflows/autopilot-compliance.yml",
    ]
    recovery_content = _git_bytes(
        root,
        ["diff", "HEAD", "--binary", "--no-ext-diff", *recovery_pathspec],
        "could not fingerprint adopted recovery content",
    )
    recovery_untracked_raw = _git_bytes(
        root,
        ["ls-files", "--others", "--exclude-standard", "-z", *recovery_pathspec],
        "could not fingerprint adopted recovery files",
    )

    def hash_untracked(raw: bytes) -> Any:
        hasher = hashlib.sha256()
        for raw_name in sorted(item for item in raw.split(b"\0") if item):
            name = raw_name.decode("utf-8", errors="surrogateescape")
            path = project_root / name
            hasher.update(raw_name)
            hasher.update(b"\0")
            if path.is_symlink():
                hasher.update(os.readlink(path).encode("utf-8", errors="surrogateescape"))
            elif path.is_file():
                with path.open("rb") as handle:
                    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                        hasher.update(chunk)
            hasher.update(b"\0")
        return hasher

    untracked_hasher = hash_untracked(untracked_raw)
    recovery_untracked_hasher = hash_untracked(recovery_untracked_raw)
    paths = []
    for line in status.decode("utf-8", errors="replace").splitlines():
        value = line[3:] if len(line) > 3 else line
        if " -> " in value:
            value = value.split(" -> ", 1)[1]
        paths.append(value)
    fingerprint = hashlib.sha256(status + b"\0" + unstaged + b"\0" + staged).digest()
    fingerprint = hashlib.sha256(fingerprint + untracked_hasher.digest()).hexdigest()
    return {
        "dirty": bool(status),
        "paths": sorted(paths),
        "fingerprint_sha256": fingerprint,
        "status_sha256": hashlib.sha256(status).hexdigest(),
        "unstaged_sha256": hashlib.sha256(unstaged).hexdigest(),
        "staged_sha256": hashlib.sha256(staged).hexdigest(),
        "content_sha256": hashlib.sha256(content + b"\0" + untracked_hasher.digest()).hexdigest(),
        "recovery_content_sha256": hashlib.sha256(
            recovery_content + b"\0" + recovery_untracked_hasher.digest()
        ).hexdigest(),
        "untracked_sha256": untracked_hasher.hexdigest(),
    }


def _recovery_workspace_dirty(root: Path | str) -> bool:
    pathspec = [
        "--",
        ".",
        ":(exclude).autopilot",
        ":(exclude).autopilot/**",
        ":(exclude)AGENTS.md",
        ":(exclude).gitignore",
        ":(exclude).github/workflows/autopilot-compliance.yml",
    ]
    status = _git_bytes(
        root,
        ["status", "--porcelain=v1", "--untracked-files=all", *pathspec],
        "could not inspect recovery working tree",
    )
    return bool(status)


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"missing autopilot file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid JSON in {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"expected JSON object in {path}")
    return value


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, indent=2, sort_keys=True) + "\n"
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def _object_sha256(value: dict[str, Any]) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _valid_artifact_digest(value: Any) -> bool:
    return isinstance(value, str) and SHA256_PATTERN.fullmatch(value) is not None


def _gate_has_v2_provenance(gate_status: Any) -> bool:
    return (
        isinstance(gate_status, dict)
        and isinstance(gate_status.get("command_id"), str)
        and bool(gate_status["command_id"].strip())
        and isinstance(gate_status.get("command_argv"), list)
        and bool(gate_status["command_argv"])
        and all(isinstance(item, str) and item for item in gate_status["command_argv"])
        and isinstance(gate_status.get("command_sha"), str)
        and bool(gate_status["command_sha"])
        and _valid_artifact_digest(gate_status.get("artifact_digest"))
        and isinstance(gate_status.get("artifact_bytes"), int)
        and gate_status["artifact_bytes"] >= 0
        and isinstance(gate_status.get("acceptance"), list)
        and bool(gate_status["acceptance"])
    )


def _feature_has_v2_provenance(feature: dict[str, Any]) -> bool:
    statuses = feature.get("gate_status", {})
    return all(
        _gate_has_v2_provenance(statuses.get(gate))
        for gate in feature.get("required_gates", [])
    )


def _artifact_metadata(root: Path | str, artifact_path: Path | str) -> dict[str, Any]:
    project_root = Path(root).resolve()
    candidate = Path(artifact_path)
    if not candidate.is_absolute():
        candidate = project_root / candidate
    try:
        resolved = candidate.resolve(strict=True)
    except FileNotFoundError as exc:
        raise ValueError("checkpoint artifact file does not exist") from exc
    if not resolved.is_relative_to(project_root) or not resolved.is_file():
        raise ValueError("checkpoint artifact file must be a regular file inside the project")
    digest = hashlib.sha256()
    size = 0
    with resolved.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
            size += len(chunk)
    return {
        "artifact": resolved.relative_to(project_root).as_posix(),
        "artifact_digest": f"sha256:{digest.hexdigest()}",
        "artifact_bytes": size,
    }


def init_project(
    root: Path | str,
    mission: str,
    project_name: str,
    ui_required: bool,
    deployment_required: bool,
) -> None:
    if not mission.strip() or not project_name.strip():
        raise ValueError("project name and mission are required")
    if not isinstance(ui_required, bool) or not isinstance(deployment_required, bool):
        raise ValueError("UI and deployment applicability must be declared")
    directory = _state_dir(root)
    contract_files = {
        "mission.json",
        "features.json",
        "state.json",
        "quality.json",
        "evidence.ndjson",
    }
    if directory.exists() and any((directory / name).exists() for name in contract_files):
        raise ValueError(f"autopilot state already exists: {directory}")
    directory.mkdir(parents=True, exist_ok=True)
    created_at = _now()
    _write_json(
        directory / "mission.json",
        {
            "schema_version": SCHEMA_VERSION,
            "project_name": project_name.strip(),
            "mission": mission.strip(),
            "ui_required": ui_required,
            "deployment_required": deployment_required,
            "created_at": created_at,
            "updated_at": created_at,
        },
    )
    _write_json(directory / "features.json", {"schema_version": SCHEMA_VERSION, "features": []})
    _write_json(
        directory / "state.json",
        {
            "schema_version": SCHEMA_VERSION,
            "status": "ACTIVE",
            "current_feature_id": None,
            "verified_sha": None,
            "next_action": "Compile the complete feature ledger from product and repository evidence",
            "blocker": None,
            "owner_question": None,
            "cycle": None,
            "handover": None,
            "last_handover": None,
            "known_red": None,
            "heartbeat_at": created_at,
            "updated_at": created_at,
        },
    )
    _write_json(
        directory / "quality.json",
        {
            "schema_version": SCHEMA_VERSION,
            "commands": [],
            "notes": "Record project-native commands as argv arrays; never store secrets.",
        },
    )
    (directory / "evidence.ndjson").write_text("", encoding="utf-8")


def _features(root: Path | str) -> tuple[Path, dict[str, Any]]:
    path = _state_dir(root) / "features.json"
    data = _read_json(path)
    if not isinstance(data.get("features"), list):
        raise ValueError("features.json must contain a features array")
    return path, data


def _find_feature(data: dict[str, Any], feature_id: str) -> dict[str, Any]:
    for feature in data["features"]:
        if feature.get("id") == feature_id:
            return feature
    raise ValueError(f"unknown feature: {feature_id}")


def _state(root: Path | str) -> tuple[Path, dict[str, Any]]:
    path = _state_dir(root) / "state.json"
    return path, _read_json(path)


def _require_active_cycle(
    root: Path | str, feature_id: str | None = None, allow_handover: bool = False
) -> tuple[Path, dict[str, Any], dict[str, Any]]:
    path, state = _state(root)
    cycle = state.get("cycle")
    if not isinstance(cycle, dict):
        raise ValueError("a validated active cycle is required before project work or evidence")
    if state.get("handover") is not None and not allow_handover:
        raise ValueError("resume the pending handover before continuing the active cycle")
    if feature_id is not None and cycle.get("feature_id") != feature_id:
        raise ValueError(
            f"active cycle is bound to {cycle.get('feature_id')}, not {feature_id}"
        )
    branch = _git_branch(root)
    if cycle.get("branch") != branch:
        raise ValueError(
            f"active cycle branch {cycle.get('branch')} does not match current branch {branch}"
        )
    return path, state, cycle


def begin_cycle(
    root: Path | str,
    feature_id: str,
    acceptance: Iterable[str],
    next_action: str,
    shared_branch: str | None = None,
    allow_shared_branch: bool = False,
    shared_branch_exception_reason: str | None = None,
    adopt_dirty_recovery: bool = False,
) -> dict[str, Any]:
    criteria = list(acceptance) if not isinstance(acceptance, str) else [acceptance]
    criteria = [item.strip() for item in criteria if isinstance(item, str) and item.strip()]
    if not criteria:
        raise ValueError("at least one observable acceptance criterion is required")
    if not next_action.strip():
        raise ValueError("an exact next action is required")
    branch = _git_branch(root)
    automatically_detected_shared = _detect_shared_branch(root)
    if (
        shared_branch
        and automatically_detected_shared
        and shared_branch != automatically_detected_shared
    ):
        raise ValueError(
            f"explicit shared branch {shared_branch} conflicts with detected default "
            f"{automatically_detected_shared}"
        )
    detected_shared = automatically_detected_shared or shared_branch
    if adopt_dirty_recovery and detected_shared and branch == detected_shared:
        raise ValueError(
            "dirty recovery requires an isolated branch; create one before adopting inherited work"
        )
    if detected_shared and branch == detected_shared and not allow_shared_branch:
        raise ValueError(
            "project writes cannot begin on the shared/default branch; create an isolated branch "
            "or explicitly document the repository exception"
        )
    if allow_shared_branch and branch == detected_shared and not (
        shared_branch_exception_reason and shared_branch_exception_reason.strip()
    ):
        raise ValueError("a shared/default branch exception requires a concrete reason")
    head = _git_head(root, require_clean_project=not adopt_dirty_recovery)
    adopted_workspace = _workspace_snapshot(root) if adopt_dirty_recovery else None
    if adopt_dirty_recovery and not adopted_workspace["dirty"]:
        raise ValueError("dirty recovery adoption requires inherited uncommitted project changes")
    state_path, state = _state(root)
    if state.get("handover") is not None:
        raise ValueError("resume the pending handover instead of starting a new cycle")
    if state.get("cycle") is not None:
        raise ValueError("an active cycle already exists")
    known_red = state.get("known_red")
    if isinstance(known_red, dict) and known_red.get("feature_id") != feature_id:
        raise ValueError(
            f"known-red feature {known_red.get('feature_id')} must be repaired before {feature_id}"
        )
    validation_errors = validate_project(root, check_completion=False)
    if validation_errors:
        raise ValueError(
            "autopilot state must validate before a cycle begins: "
            + "; ".join(dict.fromkeys(validation_errors))
        )
    features_path, features = _features(root)
    feature = _find_feature(features, feature_id)
    unmet_dependencies = [
        dependency
        for dependency in feature.get("dependencies", [])
        if _find_feature(features, dependency).get("status") != "passed"
    ]
    if unmet_dependencies:
        raise ValueError(f"unmet dependencies: {', '.join(unmet_dependencies)}")
    if (
        feature.get("status") == "passed"
        and feature.get("verified_sha") == head
        and _feature_has_v2_provenance(feature)
    ):
        raise ValueError(f"feature {feature_id} is already passed at the current HEAD")
    if feature.get("status") == "passed":
        feature["status"] = "in_progress"
        feature["verified_sha"] = None
        feature["updated_at"] = _now()
        _write_json(features_path, features)
    now = _now()
    cycle = {
        "id": uuid.uuid4().hex,
        "feature_id": feature_id,
        "acceptance": criteria,
        "required_gates": list(feature["required_gates"]),
        "branch": branch,
        "shared_branch": detected_shared,
        "shared_branch_exception": bool(allow_shared_branch and branch == detected_shared),
        "shared_branch_exception_reason": (
            shared_branch_exception_reason.strip()
            if shared_branch_exception_reason and allow_shared_branch and branch == detected_shared
            else None
        ),
        "base_sha": head,
        "working_sha": head,
        "phase": "recovery" if adopt_dirty_recovery else "preflight",
        "adopted_workspace": adopted_workspace,
        "commands": [],
        "next_action": next_action.strip(),
        "started_at": now,
        "updated_at": now,
    }
    state.update(
        {
            "schema_version": SCHEMA_VERSION,
            "status": "ACTIVE",
            "current_feature_id": feature_id,
            "verified_sha": None,
            "next_action": next_action.strip(),
            "blocker": None,
            "owner_question": None,
            "cycle": cycle,
            "handover": None,
            "heartbeat_at": now,
            "updated_at": now,
        }
    )
    _write_json(state_path, state)
    return cycle


def checkpoint_cycle(
    root: Path | str,
    phase: str,
    next_action: str,
    command: list[str] | None = None,
    result: str | None = None,
    artifact_digest: str | None = None,
    gate: str | None = None,
    artifact_path: Path | str | None = None,
) -> dict[str, Any]:
    if phase not in ALLOWED_CYCLE_PHASES:
        raise ValueError(f"invalid cycle phase: {phase}")
    if not next_action.strip():
        raise ValueError("an exact next action is required")
    if (command is None) != (result is None):
        raise ValueError("command and result must be recorded together")
    if result is not None and result not in ALLOWED_RESULTS:
        raise ValueError(f"invalid command result: {result}")
    if command is not None and (not command or not all(isinstance(item, str) and item for item in command)):
        raise ValueError("command must be a non-empty argv array")
    if command is not None and gate not in ALLOWED_GATES:
        raise ValueError("a command checkpoint requires a valid gate")
    if command is not None and artifact_path is None:
        raise ValueError("a command checkpoint requires an existing artifact file")
    if command is not None and artifact_digest is not None:
        raise ValueError("caller-supplied artifact digests are not accepted; provide the artifact file")
    if phase == "test-red" and (command is None or result != "fail"):
        raise ValueError("the test-red phase requires a recorded failing command and artifact")
    path, state, cycle = _require_active_cycle(root)
    prior_phase = cycle.get("phase")
    has_failing_reproduction = any(
        isinstance(item, dict) and item.get("result") == "fail"
        for item in cycle.get("commands", [])
    )
    if phase == "implementing" and not has_failing_reproduction:
        raise ValueError("implementing requires a prior test-red failing reproduction")
    if prior_phase == "recovery" and phase in {"verifying", "ready-to-complete"}:
        raise ValueError("recovery must pass through test-red before verification")
    if gate is not None and gate not in cycle.get("required_gates", []):
        raise ValueError(f"gate {gate} is not required by the active feature")
    if command is not None:
        artifact = _artifact_metadata(root, artifact_path)
        command_sha = _git_head(root, require_clean_project=result == "pass")
        cycle.setdefault("commands", []).append(
            {
                "id": uuid.uuid4().hex,
                "argv": command,
                "gate": gate,
                "result": result,
                "sha": command_sha,
                **artifact,
                "recorded_at": _now(),
            }
        )
        if result == "fail":
            state["known_red"] = {
                "feature_id": cycle["feature_id"],
                "summary": f"{gate} command failed during cycle {cycle['id']}",
                "recorded_at": _now(),
            }
    cycle.update(
        {
            "phase": phase,
            "working_sha": _git_head(root),
            "next_action": next_action.strip(),
            "updated_at": _now(),
        }
    )
    state.update(
        {
            "next_action": next_action.strip(),
            "heartbeat_at": _now(),
            "updated_at": _now(),
        }
    )
    _write_json(path, state)
    return cycle


def prepare_handover(
    root: Path | str,
    reason: str,
    boundary_evidence: str,
    safe_atomic_cycle_possible: bool,
) -> dict[str, Any]:
    if reason not in HARD_BOUNDARY_REASONS:
        raise ValueError("handover requires an observed hard runtime boundary")
    if not boundary_evidence.strip():
        raise ValueError("handover requires concrete platform/runtime boundary evidence")
    if safe_atomic_cycle_possible:
        raise ValueError("finish the safe atomic cycle before considering handover")
    path, state, cycle = _require_active_cycle(root)
    commands = cycle.get("commands", [])
    now = _now()
    packet = {
        "schema_version": SCHEMA_VERSION,
        "id": uuid.uuid4().hex,
        "reason": reason,
        "boundary_evidence": boundary_evidence.strip(),
        "created_at": now,
        "repository": _repo_identity(root),
        "branch": _git_branch(root),
        "head_sha": _git_head(root),
        "workspace": _workspace_snapshot(root),
        "feature_id": cycle["feature_id"],
        "cycle_id": cycle["id"],
        "phase": cycle["phase"],
        "acceptance": list(cycle["acceptance"]),
        "required_gates": list(cycle["required_gates"]),
        "passed_commands": [item for item in commands if item.get("result") == "pass"],
        "failed_commands": [item for item in commands if item.get("result") == "fail"],
        "blocker": state.get("blocker"),
        "constraints": {
            "preserve_user_changes": True,
            "no_replanning_before_exact_resume": True,
            "handover_is_last_resort": True,
        },
        "next_action": cycle["next_action"],
        "continuation_contract": (
            "Load universal-project-autopilot; run resume-handover; execute the exact next_action "
            "without replanning. Remain responsible for finishing. Hand over again only at an "
            "observed hard runtime boundary when no safe atomic cycle can still finish."
        ),
    }
    packet["packet_sha256"] = _object_sha256(packet)
    state.update(
        {
            "handover": packet,
            "next_action": f"Resume handover {packet['id']} and {cycle['next_action']}",
            "heartbeat_at": now,
            "updated_at": now,
        }
    )
    _write_json(path, state)
    return packet


def resume_handover(root: Path | str) -> dict[str, Any]:
    path, state = _state(root)
    packet = state.get("handover")
    if not isinstance(packet, dict):
        raise ValueError("no pending handover exists")
    expected_packet_digest = packet.get("packet_sha256")
    digest_payload = dict(packet)
    digest_payload.pop("packet_sha256", None)
    if not isinstance(expected_packet_digest, str) or expected_packet_digest != _object_sha256(
        digest_payload
    ):
        raise ValueError("handover packet digest does not match")
    cycle = state.get("cycle")
    if not isinstance(cycle, dict) or cycle.get("id") != packet.get("cycle_id"):
        raise ValueError("handover cycle does not match durable state")
    if any(
        cycle.get(cycle_key) != packet.get(packet_key)
        for cycle_key, packet_key in [
            ("feature_id", "feature_id"),
            ("phase", "phase"),
            ("acceptance", "acceptance"),
            ("required_gates", "required_gates"),
            ("next_action", "next_action"),
        ]
    ):
        raise ValueError("handover cycle content does not match durable state")
    if packet.get("repository") != _repo_identity(root):
        raise ValueError("handover repository identity does not match")
    if packet.get("branch") != _git_branch(root):
        raise ValueError("handover branch does not match current branch")
    if packet.get("head_sha") != _git_head(root):
        raise ValueError("handover HEAD does not match current HEAD")
    packet_workspace = packet.get("workspace")
    current_workspace = _workspace_snapshot(root)
    if not isinstance(packet_workspace, dict) or any(
        current_workspace.get(key) != value for key, value in packet_workspace.items()
    ):
        raise ValueError("handover workspace fingerprint does not match")
    now = _now()
    last_handover = dict(packet)
    last_handover["resumed_at"] = now
    state.update(
        {
            "schema_version": SCHEMA_VERSION,
            "status": "ACTIVE",
            "handover": None,
            "last_handover": last_handover,
            "next_action": packet["next_action"],
            "heartbeat_at": now,
            "updated_at": now,
        }
    )
    cycle["updated_at"] = now
    cycle["phase"] = packet["phase"]
    cycle["next_action"] = packet["next_action"]
    _write_json(path, state)
    return {
        "handover_id": packet["id"],
        "feature_id": packet["feature_id"],
        "phase": packet["phase"],
        "next_action": packet["next_action"],
        "continuation_contract": packet["continuation_contract"],
    }


def add_feature(
    root: Path | str,
    feature_id: str,
    title: str,
    why: str,
    user: str,
    expected_outcome: str,
    required_gates: Iterable[str],
    dependencies: Iterable[str],
    priority: int = 50,
) -> None:
    required = list(dict.fromkeys(required_gates))
    deps = list(dict.fromkeys(dependencies))
    if not all(v.strip() for v in [feature_id, title, why, user, expected_outcome]):
        raise ValueError("feature id, title, why, user, and expected outcome are required")
    invalid = sorted(set(required) - ALLOWED_GATES)
    if invalid:
        raise ValueError(f"invalid gates: {', '.join(invalid)}")
    if "code" not in required or "purpose" not in required or "security" not in required:
        raise ValueError("every feature requires code, purpose, and security gates")
    mission = _read_json(_state_dir(root) / "mission.json")
    if mission.get("ui_required") is True and "ui" not in required:
        raise ValueError("every feature in a UI project requires the UI gate")
    if not isinstance(priority, int) or not 0 <= priority <= 100:
        raise ValueError("feature priority must be an integer from 0 to 100")
    path, data = _features(root)
    existing = {item.get("id") for item in data["features"]}
    if feature_id in existing:
        raise ValueError(f"duplicate feature: {feature_id}")
    missing_dependencies = sorted(set(deps) - existing)
    if missing_dependencies:
        raise ValueError(f"unknown dependencies: {', '.join(missing_dependencies)}")
    data["features"].append(
        {
            "id": feature_id,
            "title": title.strip(),
            "why": why.strip(),
            "user": user.strip(),
            "expected_outcome": expected_outcome.strip(),
            "required_gates": required,
            "dependencies": deps,
            "priority": priority,
            "status": "planned",
            "gate_status": {},
            "verified_sha": None,
            "updated_at": _now(),
        }
    )
    _write_json(path, data)
    _reopen_if_complete(root, f"Execute newly added feature {feature_id}")


def mark_known_red(root: Path | str, feature_id: str, summary: str) -> None:
    if not summary.strip():
        raise ValueError("known-red summary is required")
    state_path, state = _state(root)
    cycle = state.get("cycle")
    existing_pending = state.get("pending_known_red")
    if isinstance(existing_pending, dict) and _recovery_workspace_dirty(root):
        raise ValueError(
            "pending known-red fingerprint cannot be replaced while product work is dirty"
        )
    features_path, features = _features(root)
    feature = _find_feature(features, feature_id)
    feature["status"] = "in_progress"
    feature["verified_sha"] = None
    feature["priority"] = 100
    feature["updated_at"] = _now()
    _write_json(features_path, features)
    now = _now()
    if isinstance(cycle, dict) and cycle.get("feature_id") != feature_id:
        pending = {
            "feature_id": feature_id,
            "summary": summary.strip(),
            "recorded_at": now,
        }
        if _recovery_workspace_dirty(root):
            pending["workspace"] = _workspace_snapshot(root)
            next_action = (
                f"Reach a clean safe atomic checkpoint, then run mark-known-red again for "
                f"{feature_id}"
            )
            cycle["next_action"] = next_action
            cycle["updated_at"] = now
            state.update(
                {
                    "pending_known_red": pending,
                    "next_action": next_action,
                    "updated_at": now,
                    "heartbeat_at": now,
                }
            )
            _write_json(state_path, state)
            return
        state["preempted_feature"] = {
            "feature_id": cycle["feature_id"],
            "acceptance": list(cycle.get("acceptance", [])),
            "next_action": cycle.get("next_action"),
            "preempted_at": now,
        }
        state["cycle"] = None
        state["current_feature_id"] = None
    state.update(
        {
            "status": "ACTIVE",
            "known_red": {
                "feature_id": feature_id,
                "summary": summary.strip(),
                "recorded_at": now,
            },
            "next_action": (
                cycle.get("next_action")
                if isinstance(cycle, dict) and cycle.get("feature_id") == feature_id
                else f"Begin recovery cycle for known-red feature {feature_id}"
            ),
            "pending_known_red": None,
            "blocker": None,
            "owner_question": None,
            "updated_at": now,
            "heartbeat_at": now,
        }
    )
    _write_json(state_path, state)


def record_evidence(
    root: Path | str,
    feature_id: str,
    gate: str,
    result: str,
    sha: str,
    summary: str,
    artifact: str,
    command_id: str | None = None,
) -> None:
    if gate not in ALLOWED_GATES:
        raise ValueError(f"invalid gate: {gate}")
    if result not in ALLOWED_RESULTS:
        raise ValueError(f"invalid result: {result}")
    if not sha.strip() or not summary.strip() or not artifact.strip():
        raise ValueError("sha, summary, and artifact are required")
    state_path, state, cycle = _require_active_cycle(root, feature_id)
    if result == "pass" and cycle.get("phase") not in {"verifying", "ready-to-complete"}:
        raise ValueError("passing evidence requires a verifying cycle phase")
    matching_commands = [
        command
        for command in cycle.get("commands", [])
        if command.get("id") == command_id
        and command.get("gate") == gate
        and command.get("result") == result
        and command.get("sha") == sha.strip()
        and _valid_artifact_digest(command.get("artifact_digest"))
    ]
    if not matching_commands:
        qualifier = "passed verification" if result == "pass" else result
        raise ValueError(
            f"evidence requires a matching {qualifier} command at the current evidence SHA"
        )
    command_record = matching_commands[-1]
    current_artifact = _artifact_metadata(root, command_record["artifact"])
    if any(current_artifact[key] != command_record.get(key) for key in current_artifact):
        raise ValueError("checkpoint artifact changed after the command result was recorded")
    if artifact.strip() != command_record["artifact"]:
        raise ValueError("evidence artifact must match the checkpointed artifact file")
    _assert_current_sha(root, sha.strip())
    path, data = _features(root)
    feature = _find_feature(data, feature_id)
    if gate not in feature["required_gates"]:
        raise ValueError(f"gate {gate} is not required for {feature_id}")
    record = {
        "schema_version": SCHEMA_VERSION,
        "feature_id": feature_id,
        "gate": gate,
        "result": result,
        "sha": sha.strip(),
        "summary": summary.strip(),
        "artifact": artifact.strip(),
        "command_id": command_record["id"],
        "command_argv": command_record["argv"],
        "command_sha": command_record["sha"],
        "artifact_digest": command_record["artifact_digest"],
        "artifact_bytes": command_record["artifact_bytes"],
        "acceptance": list(cycle["acceptance"]),
        "recorded_at": _now(),
    }
    with (_state_dir(root) / "evidence.ndjson").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, sort_keys=True) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    feature["gate_status"][gate] = {
        "result": result,
        "sha": sha.strip(),
        "summary": summary.strip(),
        "artifact": artifact.strip(),
        "command_id": command_record["id"],
        "command_argv": command_record["argv"],
        "command_sha": command_record["sha"],
        "artifact_digest": command_record["artifact_digest"],
        "artifact_bytes": command_record["artifact_bytes"],
        "acceptance": list(cycle["acceptance"]),
        "recorded_at": record["recorded_at"],
    }
    if result != "pass" or (feature.get("verified_sha") and feature["verified_sha"] != sha.strip()):
        feature["status"] = "in_progress"
        feature["verified_sha"] = None
    feature["updated_at"] = _now()
    _write_json(path, data)
    cycle["working_sha"] = sha.strip()
    cycle["updated_at"] = _now()
    state["heartbeat_at"] = _now()
    state["updated_at"] = _now()
    _write_json(state_path, state)


def complete_feature(root: Path | str, feature_id: str, sha: str) -> None:
    state_path, state, cycle = _require_active_cycle(root, feature_id)
    if cycle.get("phase") not in {"verifying", "ready-to-complete"}:
        raise ValueError("feature completion requires a verifying cycle phase")
    _assert_current_sha(root, sha)
    path, data = _features(root)
    feature = _find_feature(data, feature_id)
    missing = []
    for gate in feature["required_gates"]:
        current = feature["gate_status"].get(gate, {})
        if current.get("result") != "pass" or current.get("sha") != sha:
            missing.append(gate)
    if missing:
        raise ValueError(f"missing passing gates: {', '.join(missing)}")
    feature["status"] = "passed"
    feature["verified_sha"] = sha
    feature["updated_at"] = _now()
    _write_json(path, data)
    if isinstance(state.get("known_red"), dict) and state["known_red"].get(
        "feature_id"
    ) == feature_id:
        state["known_red"] = None
        _write_json(state_path, state)
    pending_known_red = state.get("pending_known_red")
    if isinstance(pending_known_red, dict):
        state["known_red"] = {
            key: pending_known_red[key]
            for key in ("feature_id", "summary", "recorded_at")
            if key in pending_known_red
        }
        state["pending_known_red"] = None
        _write_json(state_path, state)
    following = next_feature(root)
    state.update(
        {
            "cycle": None,
            "current_feature_id": None,
            "next_action": (
                f"Begin a validated cycle for {following['id']}"
                if following
                else "Run complete-project at the verified candidate SHA"
            ),
            "heartbeat_at": _now(),
            "updated_at": _now(),
        }
    )
    _write_json(state_path, state)


def next_feature(root: Path | str) -> dict[str, Any] | None:
    try:
        _, current_state = _state(root)
        known_red = current_state.get("known_red")
        if isinstance(known_red, dict):
            _, known_features = _features(root)
            return _find_feature(known_features, known_red["feature_id"])
    except (ValueError, KeyError):
        pass
    _, data = _features(root)
    passed = {item["id"] for item in data["features"] if item.get("status") == "passed"}
    ready = [
        (index, feature)
        for index, feature in enumerate(data["features"])
        if feature.get("status") != "passed" and set(feature.get("dependencies", [])) <= passed
    ]
    if not ready:
        try:
            head = _git_head(root)
        except ValueError:
            return None
        stale = [
            (index, feature)
            for index, feature in enumerate(data["features"])
            if feature.get("status") == "passed"
            and (
                feature.get("verified_sha") != head
                or not _feature_has_v2_provenance(feature)
            )
        ]
        if not stale:
            return None
        return max(stale, key=lambda item: (item[1].get("priority", 50), -item[0]))[1]
    return max(ready, key=lambda item: (item[1].get("priority", 50), -item[0]))[1]


def _reopen_if_complete(root: Path | str, next_action: str) -> None:
    path = _state_dir(root) / "state.json"
    state = _read_json(path)
    if state.get("pending_known_red") is not None:
        raise ValueError("pending known-red preemption must be resolved before generic state changes")
    if state.get("status") != "COMPLETE":
        return
    state.update(
        {
            "status": "ACTIVE",
            "verified_sha": None,
            "next_action": next_action,
            "blocker": None,
            "owner_question": None,
            "heartbeat_at": _now(),
            "updated_at": _now(),
        }
    )
    _write_json(path, state)


def set_state(
    root: Path | str,
    status: str,
    next_action: str,
    blocker: str | None = None,
    owner_question: str | None = None,
    current_feature_id: str | None = None,
    verified_sha: str | None = None,
) -> None:
    if status not in ALLOWED_STATES:
        raise ValueError(f"invalid state: {status}")
    if status == "COMPLETE":
        raise ValueError("use complete-project; generic state transitions cannot set COMPLETE")
    if not next_action.strip():
        raise ValueError("an exact next action is required")
    path = _state_dir(root) / "state.json"
    state = _read_json(path)
    cycle = state.get("cycle")
    if isinstance(cycle, dict):
        cycle_feature = cycle.get("feature_id")
        if current_feature_id is not None and current_feature_id != cycle_feature:
            raise ValueError("generic state update cannot switch the active cycle feature")
        current_feature_id = cycle_feature
        cycle["next_action"] = next_action.strip()
        cycle["updated_at"] = _now()
    if status == "OWNER_REQUIRED" and not (owner_question and owner_question.strip()):
        raise ValueError("OWNER_REQUIRED requires one concrete owner question")
    if status in {"WAIT_EXTERNAL", "BLOCKED"} and not (blocker and blocker.strip()):
        raise ValueError(f"{status} requires concrete blocker evidence")
    state.update(
        {
            "status": status,
            "next_action": next_action.strip(),
            "blocker": blocker,
            "owner_question": owner_question,
            "current_feature_id": current_feature_id,
            "verified_sha": verified_sha,
            "heartbeat_at": _now(),
            "updated_at": _now(),
        }
    )
    _write_json(path, state)


def complete_project(root: Path | str, sha: str) -> None:
    directory = _state_dir(root)
    mission = _read_json(directory / "mission.json")
    _, data = _features(root)
    unfinished = [
        str(item.get("id", "<malformed>"))
        for item in data["features"]
        if not isinstance(item, dict) or item.get("status") != "passed"
    ]
    if not data["features"]:
        raise ValueError("cannot complete a project with an empty feature ledger")
    if unfinished:
        raise ValueError(f"unfinished features: {', '.join(unfinished)}")
    _, current_state = _state(root)
    if current_state.get("known_red") is not None:
        raise ValueError("known-red failure remains unresolved")
    if current_state.get("cycle") is not None or current_state.get("handover") is not None:
        raise ValueError("finish the active cycle and clear any handover before project completion")
    _assert_current_sha(root, sha)
    errors = validate_project(root)
    errors.extend(_readiness_errors(mission, data, sha))
    if errors:
        raise ValueError("; ".join(dict.fromkeys(errors)))
    path = directory / "state.json"
    state = _read_json(path)
    state.update(
        {
            "status": "COMPLETE",
            "next_action": "No remaining approved work",
            "blocker": None,
            "owner_question": None,
            "current_feature_id": None,
            "verified_sha": sha,
            "heartbeat_at": _now(),
            "updated_at": _now(),
        }
    )
    _write_json(path, state)


def _parse_evidence(
    directory: Path,
    feature_map: dict[str, dict[str, Any]],
    errors: list[str],
) -> dict[tuple[str, str], dict[str, Any]]:
    latest: dict[tuple[str, str], dict[str, Any]] = {}
    path = directory / "evidence.ndjson"
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (FileNotFoundError, UnicodeDecodeError) as exc:
        errors.append(f"invalid evidence log: {exc}")
        return latest
    required_fields = {
        "schema_version",
        "feature_id",
        "gate",
        "result",
        "sha",
        "summary",
        "artifact",
        "recorded_at",
    }
    for line_number, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            errors.append(f"evidence line {line_number} is invalid JSON: {exc.msg}")
            continue
        if not isinstance(record, dict) or not required_fields <= set(record):
            errors.append(f"evidence line {line_number} has an invalid schema")
            continue
        if record.get("schema_version") == 2 and not {
            "command_id",
            "command_argv",
            "command_sha",
            "artifact_digest",
            "artifact_bytes",
            "acceptance",
        } <= set(record):
            errors.append(f"evidence line {line_number} lacks command provenance")
            continue
        feature = feature_map.get(record.get("feature_id"))
        if feature is None:
            errors.append(f"evidence line {line_number} references an unknown feature")
            continue
        gate = record.get("gate")
        if gate not in feature.get("required_gates", []):
            errors.append(f"evidence line {line_number} references an undeclared gate")
            continue
        if record.get("result") not in ALLOWED_RESULTS:
            errors.append(f"evidence line {line_number} has an invalid result")
            continue
        if record.get("schema_version") not in SUPPORTED_SCHEMA_VERSIONS:
            errors.append(f"evidence line {line_number} has an unsupported schema version")
            continue
        if not all(
            isinstance(record.get(field), str) and record[field].strip()
            for field in ["sha", "summary", "artifact", "recorded_at"]
        ):
            errors.append(f"evidence line {line_number} has empty required values")
            continue
        if record.get("schema_version") == 2 and (
            not isinstance(record.get("command_id"), str)
            or not record["command_id"].strip()
            or not isinstance(record.get("command_sha"), str)
            or record["command_sha"] != record.get("sha")
            or not _valid_artifact_digest(record.get("artifact_digest"))
            or not isinstance(record.get("artifact_bytes"), int)
            or record["artifact_bytes"] < 0
            or not isinstance(record.get("command_argv"), list)
            or not record["command_argv"]
            or not all(
                isinstance(item, str) and item for item in record["command_argv"]
            )
            or not isinstance(record.get("acceptance"), list)
            or not record["acceptance"]
        ):
            errors.append(f"evidence line {line_number} has invalid command provenance")
            continue
        latest[(record["feature_id"], gate)] = record
    return latest


def _readiness_errors(
    mission: dict[str, Any],
    features: dict[str, Any],
    sha: str,
) -> list[str]:
    errors: list[str] = []
    items = [item for item in features.get("features", []) if isinstance(item, dict)]
    stale = [item.get("id", "<malformed>") for item in items if item.get("verified_sha") != sha]
    if stale:
        errors.append(f"features not verified at {sha}: {', '.join(str(item) for item in stale)}")
    weak_provenance = [
        item.get("id", "<malformed>") for item in items if not _feature_has_v2_provenance(item)
    ]
    if weak_provenance:
        errors.append(
            "features lack V2 command/artifact provenance: "
            + ", ".join(str(item) for item in weak_provenance)
        )

    def has_project_proof(gate: str) -> bool:
        return any(
            gate in item.get("required_gates", [])
            and item.get("gate_status", {}).get(gate, {}).get("result") == "pass"
            and item.get("gate_status", {}).get(gate, {}).get("sha") == sha
            for item in items
        )

    if mission.get("ui_required") is True and not has_project_proof("ui"):
        errors.append("required UI proof is missing at the candidate SHA")
    if mission.get("deployment_required") is True and not has_project_proof("deployment"):
        errors.append("required deployment proof is missing at the candidate SHA")
    return errors


def validate_project(root: Path | str, check_completion: bool = True) -> list[str]:
    errors: list[str] = []
    directory = _state_dir(root)
    for name in ["mission.json", "features.json", "state.json", "quality.json", "evidence.ndjson"]:
        if not (directory / name).is_file():
            errors.append(f"missing {name}")
    if errors:
        return errors
    try:
        mission = _read_json(directory / "mission.json")
        _, features = _features(root)
        state = _read_json(directory / "state.json")
        quality = _read_json(directory / "quality.json")
        for filename, document in [
            ("mission.json", mission),
            ("features.json", features),
            ("state.json", state),
            ("quality.json", quality),
        ]:
            if document.get("schema_version") not in SUPPORTED_SCHEMA_VERSIONS:
                errors.append(f"{filename} has an unsupported schema version")
        if not mission.get("mission"):
            errors.append("mission is empty")
        for field in ["ui_required", "deployment_required"]:
            if not isinstance(mission.get(field), bool):
                errors.append(f"mission must explicitly declare {field}")
        if not isinstance(quality.get("commands"), list):
            errors.append("quality commands must be an array")

        items = features["features"]
        ids = [item.get("id") for item in items if isinstance(item, dict)]
        if len(ids) != len(items) or any(not isinstance(item, str) or not item for item in ids):
            errors.append("every feature requires a valid id")
        if len(ids) != len(set(ids)):
            errors.append("feature ids are not unique")
        feature_map = {item["id"]: item for item in items if isinstance(item, dict) and item.get("id")}
        known = set(feature_map)
        for item in feature_map.values():
            feature_id = item["id"]
            missing = set(item.get("dependencies", [])) - known
            if missing:
                errors.append(f"{feature_id} has unknown dependencies: {', '.join(sorted(missing))}")
            gates = item.get("required_gates")
            if not isinstance(gates, list) or not {"code", "purpose", "security"} <= set(gates):
                errors.append(f"{feature_id} is missing mandatory gates")
            if not isinstance(item.get("priority", 50), int) or not 0 <= item.get("priority", 50) <= 100:
                errors.append(f"{feature_id} has invalid priority")
            if not isinstance(item.get("gate_status"), dict):
                errors.append(f"{feature_id} gate_status must be an object")

        latest = _parse_evidence(directory, feature_map, errors)
        evidence_fields = ["result", "sha", "summary", "artifact", "recorded_at"]
        for feature_id, item in feature_map.items():
            gate_status = item.get("gate_status", {}) if isinstance(item.get("gate_status"), dict) else {}
            undeclared = set(gate_status) - set(item.get("required_gates", []))
            if undeclared:
                errors.append(f"{feature_id} stores undeclared gate status: {', '.join(sorted(undeclared))}")
            for gate in item.get("required_gates", []):
                record = latest.get((feature_id, gate))
                stored = gate_status.get(gate)
                expected = (
                    {
                        field: record[field]
                        for field in [
                            *evidence_fields,
                            "command_id",
                            "command_argv",
                            "command_sha",
                            "artifact_digest",
                            "artifact_bytes",
                            "acceptance",
                        ]
                        if field in record
                    }
                    if record
                    else None
                )
                if stored != expected:
                    errors.append(f"{feature_id} {gate} status does not match evidence log")
                if record and record.get("schema_version") == 2:
                    try:
                        artifact = _artifact_metadata(root, record["artifact"])
                        if (
                            artifact["artifact_digest"] != record.get("artifact_digest")
                            or artifact["artifact_bytes"] != record.get("artifact_bytes")
                        ):
                            errors.append(f"{feature_id} {gate} artifact digest does not match")
                    except ValueError as exc:
                        errors.append(f"{feature_id} {gate} artifact is invalid: {exc}")
            if item.get("status") == "passed":
                verified_sha = item.get("verified_sha")
                for gate in item.get("required_gates", []):
                    current = gate_status.get(gate, {})
                    if current.get("result") != "pass" or current.get("sha") != verified_sha:
                        errors.append(f"passed feature {feature_id} lacks current passing {gate} evidence")

        if state.get("status") not in ALLOWED_STATES:
            errors.append("state status is invalid")
        known_red = state.get("known_red")
        if known_red is not None and (
            not isinstance(known_red, dict)
            or known_red.get("feature_id") not in feature_map
            or not isinstance(known_red.get("summary"), str)
            or not known_red["summary"].strip()
        ):
            errors.append("known-red state is invalid")
        pending_known_red = state.get("pending_known_red")
        if pending_known_red is not None and (
            not isinstance(pending_known_red, dict)
            or pending_known_red.get("feature_id") not in feature_map
            or not isinstance(pending_known_red.get("summary"), str)
            or not pending_known_red["summary"].strip()
            or not isinstance(pending_known_red.get("workspace"), dict)
            or not pending_known_red["workspace"].get("recovery_content_sha256")
        ):
            errors.append("pending known-red state is invalid")
        try:
            head = _git_head(root, require_clean_project=False)
        except ValueError as exc:
            errors.append(str(exc))
            head = None
        cycle = state.get("cycle")
        handover = state.get("handover")
        if cycle is not None:
            if not isinstance(cycle, dict):
                errors.append("active cycle must be an object")
            else:
                required_cycle_fields = {
                    "id",
                    "feature_id",
                    "acceptance",
                    "required_gates",
                    "branch",
                    "base_sha",
                    "working_sha",
                    "phase",
                    "commands",
                    "next_action",
                }
                if not required_cycle_fields <= set(cycle):
                    errors.append("active cycle has an invalid schema")
                if cycle.get("feature_id") not in feature_map:
                    errors.append("active cycle references an unknown feature")
                elif cycle.get("required_gates") != feature_map[cycle["feature_id"]].get(
                    "required_gates"
                ):
                    errors.append("active cycle gates do not match its feature")
                if state.get("current_feature_id") != cycle.get("feature_id"):
                    errors.append("state current feature does not match active cycle")
                if handover is None and state.get("next_action") != cycle.get("next_action"):
                    errors.append("state next action does not match active cycle")
                if cycle.get("phase") not in ALLOWED_CYCLE_PHASES:
                    errors.append("active cycle phase is invalid")
                if not isinstance(cycle.get("acceptance"), list) or not cycle.get("acceptance"):
                    errors.append("active cycle acceptance is empty")
                commands = cycle.get("commands")
                if not isinstance(commands, list):
                    errors.append("active cycle commands must be an array")
                else:
                    for command in commands:
                        if not isinstance(command, dict) or not {
                            "id",
                            "argv",
                            "gate",
                            "result",
                            "sha",
                            "artifact",
                            "artifact_digest",
                            "artifact_bytes",
                            "recorded_at",
                        } <= set(command):
                            errors.append("active cycle contains an invalid command checkpoint")
                            continue
                        if (
                            not isinstance(command.get("id"), str)
                            or not command["id"]
                            or command.get("gate") not in cycle.get("required_gates", [])
                            or command.get("result") not in ALLOWED_RESULTS
                            or not isinstance(command.get("sha"), str)
                            or not command["sha"]
                            or not isinstance(command.get("artifact"), str)
                            or not command["artifact"]
                            or not _valid_artifact_digest(command.get("artifact_digest"))
                            or not isinstance(command.get("artifact_bytes"), int)
                            or not isinstance(command.get("argv"), list)
                            or not command["argv"]
                        ):
                            errors.append("active cycle contains invalid command provenance")
                if cycle.get("shared_branch_exception") and not cycle.get(
                    "shared_branch_exception_reason"
                ):
                    errors.append("active cycle shared-branch exception has no reason")
                try:
                    if cycle.get("branch") != _git_branch(root):
                        errors.append("active cycle branch does not match current branch")
                except ValueError as exc:
                    errors.append(str(exc))
        if handover is not None:
            if not isinstance(handover, dict):
                errors.append("handover must be an object")
            else:
                required_handover_fields = {
                    "id",
                    "reason",
                    "repository",
                    "branch",
                    "head_sha",
                    "workspace",
                    "feature_id",
                    "cycle_id",
                    "next_action",
                    "continuation_contract",
                    "packet_sha256",
                }
                if not required_handover_fields <= set(handover):
                    errors.append("handover has an invalid schema")
                if handover.get("reason") not in HARD_BOUNDARY_REASONS:
                    errors.append("handover reason is not a hard runtime boundary")
                digest_payload = dict(handover)
                expected_digest = digest_payload.pop("packet_sha256", None)
                if expected_digest != _object_sha256(digest_payload):
                    errors.append("handover packet digest does not match")
                if isinstance(cycle, dict) and any(
                    cycle.get(cycle_key) != handover.get(packet_key)
                    for cycle_key, packet_key in [
                        ("id", "cycle_id"),
                        ("feature_id", "feature_id"),
                        ("phase", "phase"),
                        ("acceptance", "acceptance"),
                        ("required_gates", "required_gates"),
                        ("next_action", "next_action"),
                    ]
                ):
                    errors.append("handover content does not match active cycle")
                try:
                    if handover.get("workspace") != _workspace_snapshot(root):
                        errors.append("handover workspace fingerprint does not match")
                except ValueError as exc:
                    errors.append(str(exc))
        if state.get("status") == "COMPLETE" and check_completion:
            if not items:
                errors.append("COMPLETE with an empty feature ledger")
            unfinished = [
                str(item.get("id", "<malformed>"))
                for item in items
                if not isinstance(item, dict) or item.get("status") != "passed"
            ]
            if unfinished:
                errors.append(f"COMPLETE with unfinished features: {', '.join(unfinished)}")
            if not state.get("verified_sha") or state.get("verified_sha") != head:
                errors.append("COMPLETE state SHA does not match repository HEAD")
            try:
                _git_head(root, require_clean_project=True)
            except ValueError as exc:
                errors.append(str(exc))
            if cycle is not None or handover is not None:
                errors.append("COMPLETE state cannot retain an active cycle or handover")
            if head:
                errors.extend(_readiness_errors(mission, features, head))
    except (ValueError, TypeError, AttributeError, KeyError) as exc:
        errors.append(str(exc))
    return errors


def summary(root: Path | str) -> dict[str, Any]:
    state = _read_json(_state_dir(root) / "state.json")
    _, features = _features(root)
    counts: dict[str, int] = {}
    for item in features["features"]:
        counts[item["status"]] = counts.get(item["status"], 0) + 1
    return {"state": state, "feature_counts": counts, "next_feature": next_feature(root)}


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".", help="project root")
    sub = parser.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init")
    init.add_argument("--project-name", required=True)
    init.add_argument("--mission", required=True)
    init.add_argument("--ui-required", action=argparse.BooleanOptionalAction, required=True)
    init.add_argument("--deployment-required", action=argparse.BooleanOptionalAction, required=True)
    add = sub.add_parser("add-feature")
    for option in ["id", "title", "why", "user", "outcome"]:
        add.add_argument(f"--{option}", required=True)
    add.add_argument("--gates", default="code,purpose,security")
    add.add_argument("--depends-on", default="")
    add.add_argument("--priority", type=int, default=50)
    known_red = sub.add_parser("mark-known-red")
    known_red.add_argument("--id", required=True)
    known_red.add_argument("--summary", required=True)
    begin = sub.add_parser("begin-cycle")
    begin.add_argument("--id", required=True)
    begin.add_argument("--accept", action="append", required=True)
    begin.add_argument("--next-action", required=True)
    begin.add_argument("--shared-branch")
    begin.add_argument("--allow-shared-branch", action="store_true")
    begin.add_argument("--shared-branch-exception-reason")
    begin.add_argument("--adopt-dirty-recovery", action="store_true")
    checkpoint = sub.add_parser("checkpoint-cycle")
    checkpoint.add_argument("--phase", required=True, choices=sorted(ALLOWED_CYCLE_PHASES))
    checkpoint.add_argument("--next-action", required=True)
    checkpoint.add_argument("--command-json")
    checkpoint.add_argument("--result", choices=sorted(ALLOWED_RESULTS))
    checkpoint.add_argument("--artifact-file")
    checkpoint.add_argument("--gate", choices=sorted(ALLOWED_GATES))
    evidence = sub.add_parser("evidence")
    for option in ["id", "gate", "result", "sha", "summary", "artifact"]:
        evidence.add_argument(f"--{option}", required=True)
    evidence.add_argument("--command-id", required=True)
    complete = sub.add_parser("complete-feature")
    complete.add_argument("--id", required=True)
    complete.add_argument("--sha", required=True)
    project = sub.add_parser("complete-project")
    project.add_argument("--sha", required=True)
    state = sub.add_parser("set-state")
    state.add_argument("--status", required=True, choices=sorted(ALLOWED_STATES - {"COMPLETE"}))
    state.add_argument("--next-action", required=True)
    state.add_argument("--blocker")
    state.add_argument("--owner-question")
    state.add_argument("--current-feature-id")
    state.add_argument("--sha")
    handover = sub.add_parser("prepare-handover")
    handover.add_argument("--reason", required=True, choices=sorted(HARD_BOUNDARY_REASONS))
    handover.add_argument("--boundary-evidence", required=True)
    handover.add_argument("--no-safe-atomic-cycle", action="store_true", required=True)
    sub.add_parser("resume-handover")
    sub.add_parser("validate")
    sub.add_parser("status")
    return parser


def main() -> int:
    args = _parser().parse_args()
    root = Path(args.root)
    try:
        if args.command == "init":
            init_project(
                root,
                args.mission,
                args.project_name,
                args.ui_required,
                args.deployment_required,
            )
        elif args.command == "add-feature":
            add_feature(
                root,
                args.id,
                args.title,
                args.why,
                args.user,
                args.outcome,
                [item for item in args.gates.split(",") if item],
                [item for item in args.depends_on.split(",") if item],
                args.priority,
            )
        elif args.command == "mark-known-red":
            mark_known_red(root, args.id, args.summary)
        elif args.command == "begin-cycle":
            begin_cycle(
                root,
                args.id,
                args.accept,
                args.next_action,
                args.shared_branch,
                args.allow_shared_branch,
                args.shared_branch_exception_reason,
                args.adopt_dirty_recovery,
            )
        elif args.command == "checkpoint-cycle":
            command = None
            if args.command_json:
                command = json.loads(args.command_json)
                if not isinstance(command, list):
                    raise ValueError("--command-json must be an argv JSON array")
            checkpoint_cycle(
                root,
                args.phase,
                args.next_action,
                command=command,
                result=args.result,
                gate=args.gate,
                artifact_path=args.artifact_file,
            )
        elif args.command == "evidence":
            record_evidence(
                root,
                args.id,
                args.gate,
                args.result,
                args.sha,
                args.summary,
                args.artifact,
                args.command_id,
            )
        elif args.command == "complete-feature":
            complete_feature(root, args.id, args.sha)
        elif args.command == "complete-project":
            complete_project(root, args.sha)
        elif args.command == "set-state":
            set_state(
                root,
                args.status,
                args.next_action,
                args.blocker,
                args.owner_question,
                args.current_feature_id,
                args.sha,
            )
        elif args.command == "prepare-handover":
            packet = prepare_handover(
                root,
                args.reason,
                args.boundary_evidence,
                safe_atomic_cycle_possible=not args.no_safe_atomic_cycle,
            )
            print(json.dumps(packet, indent=2))
            return 0
        elif args.command == "resume-handover":
            print(json.dumps(resume_handover(root), indent=2))
            return 0
        elif args.command == "validate":
            errors = validate_project(root)
            print(json.dumps({"valid": not errors, "errors": errors}, indent=2))
            return 1 if errors else 0
        elif args.command == "status":
            print(json.dumps(summary(root), indent=2))
            return 0
        if args.command not in {"validate", "status"}:
            print(json.dumps(summary(root), indent=2))
        return 0
    except ValueError as exc:
        print(json.dumps({"error": str(exc)}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
