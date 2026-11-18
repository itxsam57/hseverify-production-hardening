#!/usr/bin/env python3
"""Back up synthetic QA receipts to a PRIVATE GitHub Release; delete only after SHA256 roundtrip.

Fail closed: real data/secret indicators, dirty source, active work, unknown
GitHub source SHA or failed download always prevent deletion. No git clean.
This is an evidence janitor, not a release/218-scenario certification tool.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import subprocess
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

VAULT = "itxsam57/hseverify-qa-evidence-vault"
SOURCE = "itxsam57/hseverify-production-hardening"
MANIFEST_NAME = "_hse_verify_manifest.json"
SKIP_DIRS = frozenset({"node_modules", ".next", "__pycache__", ".cache", ".git"})
SECRET_PATTERNS = (
    re.compile(rb"github_pat_[A-Za-z0-9_]{25,}"),
    re.compile(rb"gh[pousr]_[A-Za-z0-9]{28,}"),
    re.compile(rb"sk-[A-Za-z0-9_-]{30,}"),
    re.compile(rb"-----BEGIN (?:OPENSSH |RSA |EC |ENCRYPTED )?PRIVATE KEY-----"),
    re.compile(rb"(?i)authorization:\s*bearer\s+[A-Za-z0-9_.=-]{30,}"),
    re.compile(rb"(?i)(?:password|secret|api[_-]?key)\s*[:=]\s*['\"]?[A-Za-z0-9_+/=-]{28,}")
)
TEXT_TYPES = frozenset({".log", ".txt", ".json", ".ndjson", ".tsv", ".csv",
                        ".md", ".py", ".sh", ".js", ".mjs", ".cjs", ".ts", ".yaml", ".yml"})
NAME_ROOT = ".autopilot/artifacts/"


def sha256_file(path: Path) -> str:
    dig = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            dig.update(chunk)
    return dig.hexdigest()


def sensitive_file(path: Path) -> bool:
    if path.suffix.lower() not in TEXT_TYPES:
        return False
    # Read in bounded chunks; avoid printing or returning any detected secret.
    old = b""
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            sample = old + chunk
            if any(pattern.search(sample) for pattern in SECRET_PATTERNS):
                return True
            old = sample[-128:]
    return False


def git(worktree: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(worktree), *args],
                          text=True, capture_output=True, timeout=18, check=False)


def git_sha(worktree: Path) -> str | None:
    answer = git(worktree, "rev-parse", "HEAD")
    sha = answer.stdout.strip()
    return sha if answer.returncode == 0 and re.fullmatch(r"[0-9a-f]{40}", sha) else None


def dirty(worktree: Path) -> bool:
    p = git(worktree, "status", "--porcelain=v1", "--untracked-files=normal")
    return p.returncode != 0 or bool(p.stdout.strip())


def is_source_repo(worktree: Path) -> bool:
    p = git(worktree, "remote", "get-url", "origin")
    return p.returncode == 0 and bool(re.fullmatch(
        r"(?:https://github\.com/|git@github\.com:)itxsam57/hseverify-production-hardening(?:\.git)?",
        p.stdout.strip()
    ))


def active_worktrees() -> set[Path]:
    roots: set[Path] = set()
    proc = Path("/proc")
    if not proc.exists():
        return roots
    for proc_dir in proc.iterdir():
        if not proc_dir.name.isdigit():
            continue
        try:
            roots.add(Path(os.readlink(proc_dir / "cwd")).resolve())
        except (OSError, PermissionError):
            pass
    return roots


def process_in_tree(worktree: Path, active: set[Path]) -> bool:
    worktree = worktree.resolve()
    return any(path == worktree or worktree in path.parents for path in active)


def collect_evidence(worktree: Path, min_age_seconds: float = 86400) -> list[dict]:
    root = worktree / ".autopilot" / "artifacts"
    if not root.is_dir() or root.is_symlink():
        return []
    now = datetime.now(timezone.utc).timestamp()
    files = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        relative = path.relative_to(worktree)
        if any(part in SKIP_DIRS for part in relative.parts[len(Path(NAME_ROOT).parts): -1]):
            continue
        if not relative.as_posix().startswith(NAME_ROOT) or path.resolve().parent == Path("/"):
            continue
        st = path.stat()
        if now - st.st_mtime < min_age_seconds:
            continue
        if sensitive_file(path):
            raise ValueError("potential sensitive credential evidence; do not automatically upload")
        files.append({"path": relative.as_posix(), "size": st.st_size,
                      "sha256": sha256_file(path), "mtime_ns": st.st_mtime_ns})
    return files


def _canonical_manifest(worktree: Path, files: list[dict]) -> dict:
    return {
        "schema": 1, "repository": SOURCE, "worktree": worktree.name,
        "source_sha": git_sha(worktree), "files": files,
        "disclaimer": "Historical QA receipts; NOT protected-stage 218 verification or production-ready evidence"
    }


def write_archive(dest: Path, worktree: Path, files: list[dict]) -> dict:
    manifest = _canonical_manifest(worktree, files)
    with tarfile.open(dest, "w:gz") as archive:
        for row in files:
            path = worktree / row["path"]
            if path.is_symlink() or not path.is_file() or sha256_file(path) != row["sha256"]:
                raise ValueError("source file changed while creating backup")
            info = tarfile.TarInfo(row["path"])
            info.size = row["size"]
            info.mode = 0o600
            with path.open("rb") as source:
                archive.addfile(info, source)
        data = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
        info = tarfile.TarInfo(MANIFEST_NAME)
        info.size = len(data)
        info.mode = 0o600
        archive.addfile(info, io.BytesIO(data))
    if not verify_archive(dest, manifest):
        raise ValueError("local archive failed internal SHA256 verification")
    return manifest


def verify_archive(archive_path: Path, expected: dict) -> bool:
    try:
        with tarfile.open(archive_path, "r:gz") as archive:
            items = archive.getmembers()
            files = {member.name: member for member in items}
            expected_names = {row["path"] for row in expected["files"]} | {MANIFEST_NAME}
            if set(files) != expected_names or any(not x.isfile() for x in items):
                return False
            manifest_source = archive.extractfile(MANIFEST_NAME)
            if manifest_source is None or json.load(manifest_source) != expected:
                return False
            for row in expected["files"]:
                member = files[row["path"]]
                if member.size != row["size"]:
                    return False
                stream = archive.extractfile(member)
                if stream is None:
                    return False
                dig = hashlib.sha256()
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    dig.update(block)
                if dig.hexdigest() != row["sha256"]:
                    return False
            return True
    except (OSError, ValueError, tarfile.TarError, KeyError, json.JSONDecodeError):
        return False


def verify_remote_copy(local: Path, downloaded: Path, manifest: dict) -> bool:
    return downloaded.is_file() and sha256_file(local) == sha256_file(downloaded) and verify_archive(downloaded, manifest)


def prune_remote_verified(worktree: Path, files: list[dict], remote_verified: bool,
                          remote_sha_verified: bool, active: bool) -> list[str]:
    if not remote_verified or not remote_sha_verified or active or dirty(worktree):
        return []
    root = (worktree / ".autopilot/artifacts").resolve()
    deleted = []
    for row in files:
        relative = row["path"]
        if not relative.startswith(NAME_ROOT):
            continue
        path = worktree / relative
        if path.is_symlink() or not path.is_file() or path.resolve() == root or root not in path.resolve().parents:
            continue
        if dirty(worktree):
            break
        try:
            before = path.stat()
            if before.st_size != row["size"] or before.st_mtime_ns != row["mtime_ns"]:
                continue
            if sha256_file(path) != row["sha256"]:
                continue
            after = path.stat()
            if (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_size) != (
                    after.st_dev, after.st_ino, after.st_mtime_ns, after.st_size):
                continue
            path.unlink()
            deleted.append(relative)
        except (FileNotFoundError, OSError):
            continue
    return deleted


def restore_local_archive(archive_path: Path, expected_tag: str, destination: Path) -> int:
    """Explicit restore into a separate directory; never overwrite local work."""
    with tarfile.open(archive_path, "r:gz") as archive:
        member = archive.extractfile(MANIFEST_NAME)
        if member is None:
            raise ValueError("integrity: missing backup manifest")
        manifest = json.load(member)
        if snapshot_tag(manifest) != expected_tag or not verify_archive(archive_path, manifest):
            raise ValueError("integrity: backup tag or SHA256 does not match")
        name = manifest.get("worktree")
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9._-]+", name) or name in {".", ".."}:
            raise ValueError("invalid worktree path in signed manifest")
        destination.mkdir(parents=True, exist_ok=True)
        root = destination.resolve()
        targets = []
        for row in manifest["files"]:
            relative = row["path"]
            if not relative.startswith(NAME_ROOT):
                raise ValueError("integrity: unsafe evidence member path")
            target = root / name / relative
            if not target.resolve().is_relative_to(root) or target.exists() or target.is_symlink():
                raise ValueError("restore would overwrite existing file or escape safe destination")
            targets.append((row, target))
        count = 0
        for row, target in targets:
            target.parent.mkdir(parents=True, exist_ok=True)
            data = archive.extractfile(row["path"])
            if data is None:
                raise ValueError("missing archived evidence file")
            dig = hashlib.sha256()
            try:
                with target.open("xb") as output:
                    for block in iter(lambda: data.read(1024 * 1024), b""):
                        output.write(block)
                        dig.update(block)
                target.chmod(0o600)
                if dig.hexdigest() != row["sha256"]:
                    raise ValueError("restored bytes failed SHA256")
            except BaseException:
                target.unlink(missing_ok=True)
                raise
            count += 1
        return count


def gh(*args: str, timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(["gh", *args], capture_output=True, text=True,
                          check=False, timeout=timeout)


def vault_is_private() -> bool:
    r = gh("api", f"repos/{VAULT}", "--jq", ".private")
    return r.returncode == 0 and r.stdout.strip() == "true"


def remote_source_verified(worktree: Path, sha: str | None) -> bool:
    if not sha or not is_source_repo(worktree):
        return False
    r = gh("api", f"repos/{SOURCE}/commits/{sha}", "--jq", ".sha")
    return r.returncode == 0 and r.stdout.strip() == sha


def load_index(workspace: Path) -> dict:
    path = workspace / ".hseverify-qa-vault-verified-index.json"
    if not path.is_file() or path.is_symlink():
        return {}
    try:
        data = json.loads(path.read_text())
        if not isinstance(data, dict):
            return {}
        return data
    except (OSError, ValueError):
        return {}


def save_index(workspace: Path, index: dict) -> None:
    path = workspace / ".hseverify-qa-vault-verified-index.json"
    # Local cache only, no raw evidence; remote GitHub release is authoritative.
    with tempfile.NamedTemporaryFile(
        "w", prefix=".qa-vault-index-", dir=workspace, delete=False
    ) as temporary:
        os.chmod(temporary.name, 0o600)
        json.dump(index, temporary, sort_keys=True, indent=2)
        temporary.write("\n")
        temp_name = temporary.name
    os.replace(temp_name, path)


def should_skip_unchanged_dirty(index: dict, worktree: Path, manifest: dict,
                                is_dirty: bool) -> bool:
    if not is_dirty:
        return False
    previous = index.get(worktree.name, {})
    return previous.get("remote_verified") is True and previous.get("tag") == snapshot_tag(manifest)


def snapshot_tag(manifest: dict) -> str:
    content = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    return "qa-raw-" + hashlib.sha256(content).hexdigest()[:32]


def upload_and_verify(worktree: Path, files: list[dict]) -> tuple[bool, str]:
    with tempfile.TemporaryDirectory(prefix="hse-qa-remote-roundtrip-") as tmp:
        temporary = Path(tmp)
        manifest = _canonical_manifest(worktree, files)
        tag = snapshot_tag(manifest)
        archive = temporary / "hse-qa-evidence.tar.gz"
        write_archive(archive, worktree, files)
        # A matching immutable content address can be safely reused without
        # minting repeated Releases for unchanged dirty evidence.
        view = gh("release", "view", tag, "--repo", VAULT, "--json", "tagName")
        if view.returncode != 0:
            release = gh("release", "create", tag, str(archive),
                         "--repo", VAULT, "--target", "main",
                         "--title", f"QA evidence snapshot {tag}",
                         "--notes", f"Private synthetic QA raw evidence. Manifest SHA256 {hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()}. Never treat as final release certification.",
                         timeout=180)
            if release.returncode:
                return False, tag
        downloaded = temporary / "download"
        downloaded.mkdir()
        r = gh("release", "download", tag, "--repo", VAULT,
               "--pattern", archive.name, "--dir", str(downloaded), timeout=180)
        if r.returncode:
            return False, tag
        return verify_remote_copy(archive, downloaded / archive.name, manifest), tag


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--workspace-root", default="/home/ubuntu/work")
    p.add_argument("--apply", action="store_true", help="upload, verify downloaded archive, then prune only safe originals")
    p.add_argument("--min-age-hours", type=float, default=24)
    p.add_argument("--max-worktrees", type=int, default=16)
    p.add_argument("--json", action="store_true")
    p.add_argument("--receipt")
    p.add_argument("--restore-release", help="Explicitly download this verified private Release tag")
    p.add_argument("--restore-dir", help="Separate non-overwriting receipt restoration destination")
    args = p.parse_args()
    if args.restore_release:
        if not args.restore_dir or not re.fullmatch(r"qa-raw-[0-9a-f]{32}", args.restore_release):
            p.error("valid --restore-release and --restore-dir required")
        if not vault_is_private():
            raise SystemExit("BLOCKED: evidence vault is not private")
        with tempfile.TemporaryDirectory(prefix="hse-vault-restore-") as scratch:
            download = gh("release", "download", args.restore_release, "--repo", VAULT,
                          "--pattern", "hse-qa-evidence.tar.gz", "--dir", scratch, timeout=180)
            if download.returncode:
                raise SystemExit("BLOCKED: private release not downloadable")
            count = restore_local_archive(Path(scratch) / "hse-qa-evidence.tar.gz",
                                          args.restore_release, Path(args.restore_dir))
            print(f"RESTORED_VERIFIED: {count} QA receipt files; no existing files overwritten")
        return
    if args.min_age_hours < 0 or not (1 <= args.max_worktrees <= 100):
        p.error("invalid cleanup limits")
    workspace = Path(args.workspace_root).resolve(strict=True)
    if workspace == Path("/") or not workspace.is_dir():
        p.error("unsafe root")
    if args.apply and not vault_is_private():
        raise SystemExit("BLOCKED: private GitHub evidence vault missing or is public")

    active = active_worktrees()
    index = load_index(workspace)
    results = []
    attempted = 0
    for worktree in sorted(workspace.iterdir()):
        if attempted >= args.max_worktrees:
            break
        if not worktree.is_dir() or not (worktree / ".git").exists():
            continue
        if worktree.resolve() == Path(__file__).resolve().parent.parent:
            continue
        if process_in_tree(worktree, active):
            continue
        if not is_source_repo(worktree):
            continue
        try:
            files = collect_evidence(worktree, min_age_seconds=args.min_age_hours * 3600)
        except (ValueError, OSError) as error:
            results.append({"worktree": worktree.name, "status": "BLOCKED_SENSITIVE_OR_UNREADABLE",
                            "reason": str(error).split(";")[0]})
            continue
        if not files:
            continue
        is_dirty = dirty(worktree)
        current_manifest = _canonical_manifest(worktree, files)
        if should_skip_unchanged_dirty(index, worktree, current_manifest, is_dirty):
            results.append({"worktree": worktree.name, "status": "ALREADY_REMOTE_VERIFIED_UNCHANGED_DIRTY",
                            "files": len(files), "deleted": 0})
            continue
        attempted += 1
        row = {"worktree": worktree.name, "source_sha": git_sha(worktree),
               "files": len(files), "bytes": sum(x["size"] for x in files),
               "clean": not is_dirty, "status": "DRY_RUN", "deleted": 0}
        if args.apply:
            try:
                verified, tag = upload_and_verify(worktree, files)
                row["vault_release"] = tag
                row["remote_archive_sha256_verified"] = verified
                if verified:
                    index[worktree.name] = {"tag": tag, "remote_verified": True,
                                            "source_sha": row["source_sha"],
                                            "validated_utc": datetime.now(timezone.utc).isoformat()}
                    save_index(workspace, index)
                remote_code = remote_source_verified(worktree, row["source_sha"])
                row["remote_source_sha_verified"] = remote_code
                if verified:
                    deleted = prune_remote_verified(worktree, files, True, remote_code,
                                                    process_in_tree(worktree, active_worktrees()))
                    row["deleted"] = len(deleted)
                row["status"] = ("BACKED_UP_VERIFIED_AND_PRUNED" if row["deleted"]
                                 else "BACKED_UP_VERIFIED_PRESERVED" if verified
                                 else "BLOCKED_REMOTE_VERIFICATION")
            except (OSError, subprocess.TimeoutExpired, ValueError) as error:
                row["status"] = "BLOCKED_ERROR_NO_DELETE"
                row["error_type"] = type(error).__name__
        results.append(row)
    report = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "vault": VAULT, "applied": args.apply, "worktrees_considered": attempted,
        "files_backed_up_and_verified": sum(x["files"] for x in results if x.get("remote_archive_sha256_verified")),
        "files_deleted": sum(x["deleted"] for x in results if x.get("deleted")),
        "results": results,
        "safety": "No deletion without private GitHub download SHA256 proof and clean/idle remote-pushed exact code SHA"
    }
    if args.receipt:
        receipt = Path(args.receipt).resolve()
        if not receipt.is_relative_to(workspace):
            p.error("receipt must be inside workspace")
        receipt.parent.mkdir(parents=True, exist_ok=True)
        receipt.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2) if args.json else (
        f"worktrees={attempted} backed_files={report['files_backed_up_and_verified']} "
        f"deleted_files={report['files_deleted']} applied={args.apply}"
    ))


if __name__ == "__main__":
    main()
