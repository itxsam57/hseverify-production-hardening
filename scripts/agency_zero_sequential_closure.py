#!/usr/bin/env python3
"""Read-only sequential ZERO closure gate; advancing requires every real signoff.

The frozen 58-batch attempt inventory is historical and never reset. This gate
does not award passes. It refuses batch switching while the active original
batch has any incomplete exact-SHA/three-discipline attestation.
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

from agency_zero_control import (
    CANDIDATE, CURSOR, EVIDENCE, MANIFEST, MAX_ITEMS,
    current_evidence, load_json, manifest_from_source, pinned_candidate_sha
)

def read_state():
    manifest = load_json(MANIFEST)
    if manifest != manifest_from_source():
        raise ValueError("Frozen original 218/58 manifest mismatch")
    if manifest.get("original_scenario_count") != 218 or len(manifest.get("batches", [])) != 58:
        raise ValueError("Cannot change original queue count")
    if any(not (1 <= len(x["units"]) <= MAX_ITEMS) for x in manifest["batches"]):
        raise ValueError("Batch unit limit exceeded")
    cursor = load_json(CURSOR)
    pinned = load_json(CANDIDATE).get("source_commit_sha")
    if cursor.get("application_source_sha") != pinned:
        raise ValueError("Cursor source SHA not equal to approved candidate")
    if cursor.get("closure_policy") != "STRICT_SEQUENTIAL_FULL_ONLY":
        raise ValueError("Sequential closure contract missing")
    active = cursor.get("closure_active_batch_id")
    ids = [x["batch_id"] for x in manifest["batches"]]
    if active not in ids:
        raise ValueError("Invalid active closure batch")
    if len(cursor.get("attempted_batches", [])) != 58 or len(cursor.get("revisit_batches", [])) > 58:
        raise ValueError("Cannot reset or add historical original batches")
    attestations = load_json(EVIDENCE).get("technical_attestations", [])
    if len(attestations) != 218 or len({a.get("scenario_id") for a in attestations}) != 218:
        raise ValueError("Original 218 technical attestation slots changed")
    accepted = {sid for (sid, sha) in current_evidence(manifest) if sha == pinned}
    idx = ids.index(active)
    prior = {u["scenario_id"] for x in manifest["batches"][:idx] for u in x["units"]}
    if prior - accepted:
        raise ValueError("Active closure skips a previous unfinished batch")
    unit_ids = [u["scenario_id"] for u in manifest["batches"][idx]["units"]]
    missing = [sid for sid in unit_ids if sid not in accepted]
    return manifest, cursor, active, unit_ids, missing, accepted

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    op = parser.add_mutually_exclusive_group(required=True)
    op.add_argument("--status", action="store_true")
    op.add_argument("--assert-batch", metavar="ZERO-001")
    op.add_argument("--advance-closure", action="store_true")
    args = parser.parse_args()
    manifest, cursor, active, units, missing, accepted = read_state()
    if args.status:
        try:
            pinned_candidate_sha()
            drift = "CLEAN"
        except ValueError as e:
            drift = "BLOCKED: " + str(e)
        print("ZERO | SEQUENTIAL CLOSURE ACTIVE", active,
              "| FULL", str(len(units)-len(missing))+"/"+str(len(units)),
              "| TECH TOTAL", str(len(accepted))+"/218",
              "| MISSING", ",".join(missing) if missing else "NONE",
              "| QA SOURCE GUARD", drift)
        print("ZERO | NO NEXT BATCH until all active original workflows, 3 reviews and applicable adapters PASS")
        return 0
    if args.assert_batch is not None:
        if args.assert_batch != active:
            print("ZERO | SEQUENTIAL BLOCK: requested", args.assert_batch,
                  "but active", active, "incomplete", ",".join(missing) or "needs explicit advancement",
                  file=sys.stderr)
            return 2
        if not missing:
            print("ZERO | ACTIVE BATCH FULL: explicit reviewed advance needed", file=sys.stderr)
            return 2
        print("ZERO | ALLOWED ACTIVE BATCH", active,
              "| NO CERTIFICATION AWARDED | SOURCE WORKTREE MUST MATCH PIN")
        return 0
    if missing:
        print("ZERO | CANNOT ADVANCE", active, "| UNVERIFIED", ",".join(missing), file=sys.stderr)
        return 2
    # Advancing checks that the moving QA branch has no unreviewed app drift,
    # in addition to requiring all per-SHA independent reviewer attestations.
    pinned_candidate_sha()
    batch_ids = [x["batch_id"] for x in manifest["batches"]]
    idx = batch_ids.index(active)
    if idx == len(batch_ids)-1:
        print("ZERO | FINAL BATCH FULL: independent final whole-system gate remains")
        return 0
    next_id = batch_ids[idx+1]
    cursor["closure_active_batch_id"] = next_id
    cursor["next_action"] = ("Previous "+active+" full verified on approved candidate; "+
                             "strict closure active "+next_id+"; no scope expansion.")
    CURSOR.write_text(json.dumps(cursor, indent=2)+"\n", encoding="utf-8")
    print("ZERO | REVIEWED SEQUENTIAL ADVANCE", active, "->", next_id)
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, KeyError, OSError, json.JSONDecodeError) as err:
        print("ZERO | SEQUENTIAL GATE ERROR:", err, file=sys.stderr)
        sys.exit(2)
