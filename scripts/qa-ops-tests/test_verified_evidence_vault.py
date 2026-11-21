import importlib.util
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path

MODULE = Path(__file__).resolve().parents[1] / "qa-verified-evidence-vault.py"
spec = importlib.util.spec_from_file_location("qa_vault", MODULE)
vault = importlib.util.module_from_spec(spec)
if spec.loader is not None:
    spec.loader.exec_module(vault)


def git(cwd, *args):
    run = subprocess.run(["git", "-C", str(cwd), *args], text=True, capture_output=True)
    if run.returncode:
        raise RuntimeError(run.stderr)


class EvidenceVaultSafetyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="hse-qa-vault-test-")
        self.root = Path(self.tmp.name)
        self.worktree = self.root / "hseverify-m11103-fixture"
        self.worktree.mkdir()
        git(self.worktree, "init", "-q")
        (self.worktree / ".gitignore").write_text(".autopilot/artifacts/\n")
        (self.worktree / "AGENTS.md").write_text("critical tracked source\n")
        git(self.worktree, "add", ".")
        git(self.worktree, "-c", "user.email=qa@example.test", "-c", "user.name=QA", "commit", "-qm", "test")
        self.artifacts = self.worktree / ".autopilot/artifacts"
        self.artifacts.mkdir(parents=True)
        self.safe = self.artifacts / "safe-test.log"
        self.safe.write_text("Synthetic Worker -> Verifier evidence: PASS\n")

    def tearDown(self):
        self.tmp.cleanup()

    def test_archive_contains_exact_file_hash_and_recoverable_paths(self):
        snapshot = vault.collect_evidence(self.worktree, min_age_seconds=0)
        self.assertEqual([x["path"] for x in snapshot], [".autopilot/artifacts/safe-test.log"])
        archive = self.root / "backup.tar.gz"
        manifest = vault.write_archive(archive, self.worktree, snapshot)
        self.assertTrue(vault.verify_archive(archive, manifest))
        with tarfile.open(archive, "r:gz") as tf:
            self.assertTrue(tf.getmember(".autopilot/artifacts/safe-test.log"))
            self.assertEqual(json.load(tf.extractfile("_hse_verify_manifest.json"))["files"], snapshot)

    def test_remote_checksum_mismatch_prevents_pruning(self):
        snapshot = vault.collect_evidence(self.worktree, min_age_seconds=0)
        archive = self.root / "backup.tar.gz"
        manifest = vault.write_archive(archive, self.worktree, snapshot)
        remote = self.root / "from-github.tar.gz"
        shutil.copy2(archive, remote)
        self.assertTrue(vault.verify_remote_copy(archive, remote, manifest))
        remote.write_bytes(b"tampered")
        self.assertFalse(vault.verify_remote_copy(archive, remote, manifest))
        deleted = vault.prune_remote_verified(self.worktree, snapshot, False, remote_sha_verified=True, active=False)
        self.assertEqual(deleted, [])
        self.assertTrue(self.safe.exists())

    def test_dirty_unpushed_source_never_deleted_even_with_verified_remote_archive(self):
        snapshot = vault.collect_evidence(self.worktree, min_age_seconds=0)
        (self.worktree / "AGENTS.md").write_text("UNPUSHED essential source\n")
        deleted = vault.prune_remote_verified(self.worktree, snapshot, True, remote_sha_verified=True, active=False)
        self.assertEqual(deleted, [])
        self.assertEqual((self.worktree / "AGENTS.md").read_text(), "UNPUSHED essential source\n")
        self.assertTrue(self.safe.exists())

    def test_clean_remote_verified_original_file_only_is_pruned(self):
        snapshot = vault.collect_evidence(self.worktree, min_age_seconds=0)
        deleted = vault.prune_remote_verified(self.worktree, snapshot, True, remote_sha_verified=True, active=False)
        self.assertEqual(deleted, [".autopilot/artifacts/safe-test.log"])
        self.assertFalse(self.safe.exists())
        self.assertTrue((self.worktree / "AGENTS.md").exists())

    def test_file_modified_after_backup_stays_and_symlink_outside_is_untouched(self):
        other = self.root / "private.txt"
        other.write_text("not part of QA evidence")
        (self.artifacts / "outside.log").symlink_to(other)
        snapshot = vault.collect_evidence(self.worktree, min_age_seconds=0)
        self.assertEqual(len(snapshot), 1)
        self.safe.write_text("changed since upload\n")
        self.assertEqual(vault.prune_remote_verified(self.worktree, snapshot, True, True, False), [])
        self.assertTrue(self.safe.exists())
        self.assertTrue(other.exists())

    def test_active_process_never_deleted_and_sensitive_token_blocks_upload(self):
        snapshot = vault.collect_evidence(self.worktree, min_age_seconds=0)
        self.assertEqual(vault.prune_remote_verified(self.worktree, snapshot, True, True, True), [])
        self.safe.write_text("github_pat_" + "A" * 45)
        with self.assertRaisesRegex(ValueError, "credential|sensitive"):
            vault.collect_evidence(self.worktree, min_age_seconds=0)

    def test_nested_dependency_caches_are_not_evidence(self):
        cache = self.artifacts / "node_modules"
        cache.mkdir()
        (cache / "built.js").write_text("disposable")
        next_cache = self.artifacts / ".next"
        next_cache.mkdir()
        (next_cache / "manifest.json").write_text("{}")
        self.assertEqual(len(vault.collect_evidence(self.worktree, min_age_seconds=0)), 1)

    def test_already_remote_verified_unchanged_dirty_worktree_does_not_starve_next_backup(self):
        snapshot = vault.collect_evidence(self.worktree, min_age_seconds=0)
        manifest = vault._canonical_manifest(self.worktree, snapshot)
        tag = vault.snapshot_tag(manifest)
        index = {self.worktree.name: {"tag": tag, "remote_verified": True}}
        self.assertTrue(vault.should_skip_unchanged_dirty(index, self.worktree, manifest, is_dirty=True))
        self.safe.write_text("new receipt requiring backup")
        changed = vault._canonical_manifest(self.worktree, vault.collect_evidence(self.worktree, 0))
        self.assertFalse(vault.should_skip_unchanged_dirty(index, self.worktree, changed, is_dirty=True))
        self.assertFalse(vault.should_skip_unchanged_dirty(index, self.worktree, manifest, is_dirty=False))

    def test_verified_private_archive_can_restore_receipt_without_overwriting_source(self):
        snapshot = vault.collect_evidence(self.worktree, min_age_seconds=0)
        archive = self.root / "backup.tar.gz"
        manifest = vault.write_archive(archive, self.worktree, snapshot)
        tag = vault.snapshot_tag(manifest)
        restored = self.root / "restored"
        restored.mkdir()
        recovered = vault.restore_local_archive(archive, tag, restored)
        self.assertEqual(recovered, 1)
        target = restored / self.worktree.name / ".autopilot/artifacts/safe-test.log"
        self.assertEqual(target.read_bytes(), self.safe.read_bytes())
        with self.assertRaisesRegex(ValueError, "overwrite|already"):
            vault.restore_local_archive(archive, tag, restored)
        with self.assertRaisesRegex(ValueError, "tag|integrity"):
            vault.restore_local_archive(archive, "qa-raw-" + "0"*32, self.root / "bad-restore")

    def test_systemd_timer_is_scheduled_and_never_prunes_unverified_bytes(self):
        service = (MODULE.parents[1] / "ops/systemd/hseverify-qa-evidence-janitor.service").read_text()
        timer = (MODULE.parents[1] / "ops/systemd/hseverify-qa-evidence-janitor.timer").read_text()
        self.assertIn("User=ubuntu", service)
        self.assertIn("qa-verified-evidence-vault.py", service)
        self.assertIn("--apply", service)
        self.assertIn("Persistent=true", timer)
        self.assertIn("OnCalendar=", timer)
        self.assertIn("hseverify-qa-evidence-janitor.service", timer)


if __name__ == "__main__":
    unittest.main()
