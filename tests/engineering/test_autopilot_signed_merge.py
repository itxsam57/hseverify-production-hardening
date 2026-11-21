"""Fail-closed regression tests for GitHub-created merge commits in release CI."""

from __future__ import annotations

import importlib.util
import os
import shutil
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
MERGE = "1fcd675c66aae19fce068035fb38f78deed6ad60"
BASE = "0ba89d31b91eb8c7a8bf5cc58cb79c8f8908d377"
PIN = "968479A1AFF927E37D1A566BB5690EEEBB952194"

spec = importlib.util.spec_from_file_location("hse_autopilot_guard_under_test", ROOT / ".autopilot/guard.py")
if spec is None or spec.loader is None:
    raise RuntimeError("guard module cannot be loaded")
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


def git(root: Path, *args: str, env: dict[str, str] | None = None) -> str:
    completed = subprocess.run(
        ["git", *args], cwd=root, text=True, capture_output=True, check=False,
        env={**os.environ, **(env or {})}
    )
    if completed.returncode != 0:
        raise AssertionError(f"git {' '.join(args)}: {completed.stderr}")
    return completed.stdout.strip()


class SignedMergeComplianceTests(unittest.TestCase):
    def test_actual_github_signature_and_both_source_commits_are_audited(self) -> None:
        result = guard.check_ci(ROOT, [MERGE])
        self.assertEqual(result["receipt"], "AUTOPILOT_V4_CI_COMPLIANT")
        self.assertEqual(result["authenticated_source_commits"], 3)
        all_from_base = guard.check_ci(ROOT, guard._commits_for_range(ROOT, BASE, MERGE))
        self.assertEqual(all_from_base["checked_commits"], 3)

    def test_pinned_key_fingerprint_must_match_actual_merge_signature(self) -> None:
        with patch.object(guard, "GITHUB_MERGE_SIGNER_FINGERPRINT", "0" * 40):
            with self.assertRaisesRegex(ValueError, "pinned GitHub merge signature"):
                guard.check_ci(ROOT, [MERGE])

    def test_missing_pinned_public_key_fails_closed(self) -> None:
        with patch.object(guard, "GITHUB_MERGE_PUBLIC_KEY", "tests/engineering/fixtures/absent-key.asc"):
            with self.assertRaisesRegex(ValueError, "signing key is missing"):
                guard.check_ci(ROOT, [MERGE])

    def test_every_second_parent_commit_must_pass_audit(self) -> None:
        checked: list[str] = []
        message = guard._commit_message(ROOT, MERGE)

        def reject_unaudited(sha: str) -> None:
            checked.append(sha)
            raise ValueError("unaudited PR source commit")

        with self.assertRaisesRegex(ValueError, "unaudited PR source"):
            guard._validate_signed_github_merge(ROOT, MERGE, message, reject_unaudited)
        self.assertEqual(len(checked), 1)

    def test_nonstandard_merge_tree_is_rejected_even_with_valid_github_signature(self) -> None:
        real_run_git = guard._run_git
        def forged_merge_tree(root: Path, args: list[str], error: str) -> str:
            if args[0] == "merge-tree":
                return "f" * 40
            return real_run_git(root, args, error)
        with patch.object(guard, "_run_git", side_effect=forged_merge_tree):
            with self.assertRaisesRegex(ValueError, "non-standard merge-tree"):
                guard._validate_signed_github_merge(
                    ROOT, MERGE, guard._commit_message(ROOT, MERGE), lambda sha: None
                )

    def test_forged_git_committer_and_pr_message_are_not_signature_evidence(self) -> None:
        with tempfile.TemporaryDirectory(prefix="hse-unsigned-merge-test-") as temp:
            repo = Path(temp)
            git(repo, "init", "-q", "-b", "main")
            git(repo, "config", "user.name", "Test Author")
            git(repo, "config", "user.email", "test@example.invalid")
            (repo / "base.txt").write_text("base\n")
            git(repo, "add", ".")
            git(repo, "commit", "-qm", "base")
            git(repo, "checkout", "-qb", "feature")
            (repo / "feature.txt").write_text("feature\n")
            git(repo, "add", ".")
            git(repo, "commit", "-qm", "feature without Autopilot trailers")
            git(repo, "checkout", "-q", "main")
            (repo / "main.txt").write_text("main\n")
            git(repo, "add", ".")
            git(repo, "commit", "-qm", "other parent")
            git(
                repo, "merge", "--no-ff", "-m",
                "Merge pull request #63 from example/feature", "feature",
                env={"GIT_COMMITTER_NAME": "GitHub", "GIT_COMMITTER_EMAIL": "noreply@github.com"}
            )
            fake_merge = git(repo, "rev-parse", "HEAD")
            fake_msg = git(repo, "show", "-s", "--format=%B", fake_merge)
            trusted_fixture = repo / guard.GITHUB_MERGE_PUBLIC_KEY
            trusted_fixture.parent.mkdir(parents=True)
            shutil.copyfile(ROOT / guard.GITHUB_MERGE_PUBLIC_KEY, trusted_fixture)
            self.assertEqual(
                git(repo, "merge-tree", "--write-tree", f"{fake_merge}^1", f"{fake_merge}^2"),
                git(repo, "rev-parse", f"{fake_merge}^{{tree}}")
            )
            with self.assertRaisesRegex(ValueError, "valid pinned GitHub merge signature"):
                guard._validate_signed_github_merge(repo, fake_merge, fake_msg, lambda sha: None)

    def test_missing_trailer_on_normal_commit_still_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory(prefix="hse-trailer-check-") as temp:
            repo = Path(temp)
            git(repo, "init", "-q")
            git(repo, "config", "user.name", "Test Author")
            git(repo, "config", "user.email", "test@example.invalid")
            git(repo, "commit", "--allow-empty", "-qm", "regular commit without audit trailers")
            sha = git(repo, "rev-parse", "HEAD")
            with self.assertRaisesRegex(ValueError, "missing or invalid Autopilot-Cycle"):
                guard._validate_signed_github_merge(
                    repo, sha, "regular commit without audit trailers", lambda x: None
                )

    def test_guard_install_preserves_stronger_existing_workflow(self) -> None:
        with tempfile.TemporaryDirectory(prefix="hse-guard-install-") as temp:
            repo = Path(temp)
            git(repo, "init", "-q")
            wf = repo / ".github/workflows/autopilot-compliance.yml"
            wf.parent.mkdir(parents=True)
            original = (
                "name: Autopilot Compliance\n"
                "# UNIVERSAL_AUTOPILOT_V3_WORKFLOW\n"
                "# Custom stricter canonical-range and security checks MUST remain\n"
                "      - name: Verify guarded commits\n"
                "        run: |\n"
                '          python .autopilot/guard.py ci --root . --base-sha "$base" --head-sha "$head"\n'
            )
            wf.write_text(original)
            with (
                patch.object(guard, "_read_state", return_value={"cycle": None}),
                patch.object(guard, "_activate_project_hook_directory"),
                patch.object(guard, "_install_hook")
            ):
                guard.install_guard(repo, ROOT / ".autopilot/guard.py")
            self.assertEqual(wf.read_text(), original)


    def test_guard_install_rejects_marker_only_workflow(self) -> None:
        with tempfile.TemporaryDirectory(prefix="hse-guard-missing-gate-") as temp:
            repo = Path(temp)
            git(repo, "init", "-q")
            wf = repo / ".github/workflows/autopilot-compliance.yml"
            wf.parent.mkdir(parents=True)
            wf.write_text("name: Placeholder\\n# UNIVERSAL_AUTOPILOT_V3_WORKFLOW\\n")
            with (
                patch.object(guard, "_read_state", return_value={"cycle": None}),
                patch.object(guard, "_activate_project_hook_directory"),
                patch.object(guard, "_install_hook")
            ):
                with self.assertRaisesRegex(ValueError, "no executable guard"):
                    guard.install_guard(repo, ROOT / ".autopilot/guard.py")


if __name__ == "__main__":
    unittest.main()
