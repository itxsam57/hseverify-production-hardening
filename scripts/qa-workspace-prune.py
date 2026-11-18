#!/usr/bin/env python3
"""Conservative removal of *regenerable* files from inactive Git worktrees.

No Git tracked/untracked source, raw test receipts, database, or worktree is removed.
Dry-run by default. Intended to run after a test unit/CI handoff or when disk low.
"""
import argparse
import json
import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path


TARGETS = ("node_modules", ".next")
KEEP_NAMES = {"chatmcpforhandsoffacess", "hseverify-local-tools"}


def git(root, *args):
    return subprocess.run(
        ("git", "-C", str(root), *args),
        text=True, capture_output=True, check=False, timeout=15,
    )


def active_process_roots():
    """Treat any readable process cwd as live; never prune its parent worktree."""
    roots = set()
    proc = Path("/proc")
    if not proc.is_dir():
        return roots
    for item in proc.iterdir():
        if not item.name.isdecimal():
            continue
        try:
            roots.add(Path(os.readlink(item / "cwd")).resolve())
        except (FileNotFoundError, ProcessLookupError, PermissionError, OSError):
            continue
    return roots


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[2]))
    parser.add_argument("--older-than-days", type=float, default=3)
    parser.add_argument("--min-free-gib", type=float, default=20)
    parser.add_argument("--max-entries", type=int, default=16)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--receipt")
    args = parser.parse_args()
    if args.older_than_days < 0 or args.min_free_gib < 0 or args.max_entries < 0:
        parser.error("negative limits are forbidden")
    root = Path(args.root).resolve(strict=True)
    if not root.is_dir() or root == Path("/"):
        parser.error("refusing unsafe workspace root")

    # Any worktree referencing another's dependency install keeps that target alive.
    linked_targets = set()
    for item in root.iterdir():
        link = item / "node_modules"
        if link.is_symlink() and link.exists():
            linked_targets.add(link.resolve())
    active = active_process_roots()
    self_worktree = Path(__file__).resolve().parent.parent
    candidates, skipped = [], []
    now = datetime.now(timezone.utc).timestamp()
    for worktree in sorted(root.iterdir()):
        if not worktree.is_dir() or worktree.is_symlink():
            continue
        if worktree.name in KEEP_NAMES or worktree.resolve() == self_worktree:
            continue
        if not (worktree / ".git").exists():
            continue
        if any(p == worktree or worktree in p.parents for p in active):
            skipped.append({"worktree": worktree.name, "reason": "active_process"})
            continue
        status = git(worktree, "status", "--porcelain=v1", "--untracked-files=normal")
        if status.returncode != 0 or status.stdout.strip():
            skipped.append({"worktree": worktree.name, "reason": "dirty_or_git_unavailable"})
            continue
        for name in TARGETS:
            target = worktree / name
            if target.is_symlink() or not target.is_dir():
                continue
            if target.resolve() in linked_targets:
                skipped.append({"worktree": worktree.name, "reason": "shared_dependency_target"})
                continue
            if (now - target.stat().st_mtime) < args.older_than_days * 86400:
                continue
            ignored = git(worktree, "check-ignore", "-q", "--", name)
            tracked = git(worktree, "ls-files", "--", name)
            if ignored.returncode != 0 or tracked.returncode != 0 or tracked.stdout.strip():
                skipped.append({"worktree": worktree.name, "reason": "not_ignored_or_tracked"})
                continue
            if target.resolve().parent != worktree.resolve():
                continue
            candidates.append(target)

    candidates.sort(key=lambda p: (p.stat().st_mtime, str(p)))
    before = shutil.disk_usage(root).free
    removed = []
    if args.apply:
        for target in candidates[:args.max_entries]:
            if shutil.disk_usage(root).free >= args.min_free_gib * (1024 ** 3):
                break
            worktree = target.parent
            # Recheck the safety invariants immediately before deletion.
            if target.is_symlink() or not target.is_dir() or target.resolve().parent != worktree.resolve():
                continue
            if target.resolve() in linked_targets:
                continue
            if any(p == worktree or worktree in p.parents for p in active_process_roots()):
                continue
            if git(worktree, "status", "--porcelain=v1", "--untracked-files=normal").stdout.strip():
                continue
            if git(worktree, "check-ignore", "-q", "--", target.name).returncode != 0:
                continue
            if git(worktree, "ls-files", "--", target.name).stdout.strip():
                continue
            shutil.rmtree(target)
            removed.append(str(target.relative_to(root)))
    after = shutil.disk_usage(root).free
    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "workspace": str(root),
        "applied": args.apply,
        "eligible": [str(p.relative_to(root)) for p in candidates],
        "removed": removed,
        "skipped": skipped,
        "free_gib": round(after / (1024 ** 3), 2),
        "freed_gib": round((after - before) / (1024 ** 3), 2),
        "protection": "No source, untracked evidence, PostgreSQL data, audit logs or Git worktrees ever deleted",
    }
    if args.receipt:
        receipt = Path(args.receipt).resolve()
        if not receipt.is_relative_to(root):
            parser.error("receipt must remain inside the authorized workspace")
        receipt.parent.mkdir(parents=True, exist_ok=True)
        receipt.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2) if args.json else (
        f"eligible={len(candidates)} removed={len(removed)} free_gib={result['free_gib']} "
        f"freed_gib={result['freed_gib']}; dry_run={not args.apply}"
    ))


if __name__ == "__main__":
    main()
