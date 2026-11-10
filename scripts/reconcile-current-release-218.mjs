#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildCurrentReleaseLedger } from "./lib/current-release-218-ledger.mjs";

const commitSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const source = JSON.parse(await readFile(resolve("docs/qa/2026-10-02-evidence.json"), "utf8"));
const report = buildCurrentReleaseLedger({ source, commitSha });
const artifact = resolve(".autopilot/artifacts/current-release-218-ledger.json");
await mkdir(resolve(".autopilot/artifacts"), { recursive: true });
await writeFile(artifact, JSON.stringify(report, null, 2) + "\n", "utf8");

console.log(JSON.stringify({
  exact_sha: report.exact_sha,
  frozen_scenarios: report.counts.total,
  frozen_bricks: report.frozen_bricks,
  fully_verified: report.counts.full_verified,
  in_progress: report.counts.in_progress,
  blocked_external_known: report.counts.blocked_external_known,
  not_started: report.counts.not_started,
  release_decision: report.release.decision,
  artifact
}, null, 2));
