import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "qa-workspace-prune.py"


class CacheSourceBackupTest(unittest.TestCase):
    def test_no_remote_source_sha_prevents_generated_cache_removal(self):
        with tempfile.TemporaryDirectory(prefix="hse-cache-sha-test-") as tmp:
            root = Path(tmp)
            worktree = root / "hseverify-old-test"
            worktree.mkdir()
            for args in [
                ["init", "-q"],
            ]:
                self.assertEqual(subprocess.run(["git", "-C", str(worktree), *args], capture_output=True).returncode, 0)
            (worktree / ".gitignore").write_text("node_modules/\n.next/\n")
            (worktree / "tracked.txt").write_text("essential source")
            for args in [["add", "."], ["-c", "user.email=qa@example.test", "-c", "user.name=QA",
                                       "commit", "-qm", "fixture"]]:
                self.assertEqual(subprocess.run(["git", "-C", str(worktree), *args], capture_output=True).returncode, 0)
            deps = worktree / "node_modules"
            deps.mkdir()
            (deps / "cached.js").write_text("generated")
            output = subprocess.run([
                "python3", str(SCRIPT), "--root", str(root), "--older-than-days", "0",
                "--min-free-gib", "999999", "--max-entries", "1", "--require-remote", "--apply", "--json"
            ], capture_output=True, text=True)
            self.assertEqual(output.returncode, 0, output.stderr)
            result = json.loads(output.stdout)
            self.assertEqual(result["removed"], [])
            self.assertTrue((deps / "cached.js").exists())
            self.assertTrue(any(item["reason"] == "source_sha_not_on_github" for item in result["skipped"]))


if __name__ == "__main__":
    unittest.main()
