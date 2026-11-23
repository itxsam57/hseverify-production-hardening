# Masterplan evidence and two independent readiness gates

**Only one frozen Masterplan exists:** `docs/qa/evidence/MASTERPLAN_218_ALL_PREVIOUS_EVIDENCE_ACTIONS_20261114.csv` (218 IDs). `docs/qa/AGENCY_ZERO_BATCHES.json` is an automatically validated grouped view, not a second list of scenarios. `docs/qa/AGENCY_ZERO_EVIDENCE.json` is an attestation receipt register, not a second ledger.

## Current owner testing readiness (owner-defined FULLY VERIFIED)

`python3 scripts/agency_zero_control.py --check` validates 218 unique ordered cases/37 bricks/58 related batches with no batch greater than five.

`python3 scripts/agency_zero_control.py --status` reports **TECH FULLY VERIFIED on exact current SHA**. An evidence receipt requires successful real workflow/browser/API/DB/UI, engineer, cybersecurity and reviewer checks plus adapter-contract acceptance where applicable, and no known open high/critical finding. Historical evidence is linked, not counted as verified until applicable and reviewed on the candidate. Incomplete/blocked reports never count.

## Later production release certification

`npm run audit:current-218-scenarios` is the prior strict **production release** gate. It will remain 0/218 until full protected stage, live provider acceptance, owner UAT and final exact-SHA signoff exist. It **must not be used to claim technical owner-testing readiness is stuck**, and technical passes must not be misreported as launched or externally certified.

`npm run audit:historical-218-evidence` is a forensics tool only and may require archived legacy logs. Keep existing source-case IDs, 4,975 provisional dimensions and historical scoped green evidence without claiming full attestation.

Read [AGENCY_ZERO_PROTOCOL.md](AGENCY_ZERO_PROTOCOL.md) for the current definitive process and exact safe security-testing scope.
