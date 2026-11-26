# ZERO | PR255 governance + operations CI repair

Original FULL 0/218; ZERO-001 0/4; owner testing ready NO. This work is isolated QA only, no product changes.

CI exact SHA 3333929: V4 compliance runs 45813176855/45813241980 FAILED because audit session 319ef018 lacked recorded activity. 218 CI run 45813240098 FAILED because dry-run cache pruning test did not find eligible clean/node_modules, but original skip reason was not logged.

Genuine V4 activity now records existing P0001 written-review red-to-green, not synthetic activity. Existing guard CI validation passes locally. The independent prune fixture now sets ignored generated node_modules and .next mtime two minutes old before the scanner. It does not change pruning logic, evidence rules, dry-run nondeletion or dirty/symlink safety assertions. Failure now reports full eligibility diagnostics. Time/FS precision is suspected, not proven root cause.

Original related prune test 2/2 PASS, separate full operations gate 7/7 PASS (these are release checks, NOT seven original 218 scenarios).
pr255_218_ci_red: exit=0 SHA256 9c4bf60b18c6a0f2ab249160108a3b5e657c668f9d8133acbb1bd61b718be25a
pr255_compliance_red: exit=0 SHA256 894ca3600b4125d2388e81cdf0112dc2cc23d09fc48932fee7a0b3a7e9e46832
prune_two_green: exit=0 SHA256 b3b4418a9f20ff7ecf82c0fd58959c8e856f431b2375d72c78201ad603c7d113
qaops_seven_green: exit=0 SHA256 aa1fb387b15c2013b07082d00d87e155a5eeb1041b171887dda726242a466329
v4_recorded_activity_cicheck: exit=0 SHA256 726af5a02c42f1a842df7ec263f8cd19676a3bdfba79d310195ea12094b4363f

ENGINEER: scoped PASS; CYBERSECURITY: unchanged cleanup policy checked, full pentest still open; REVIEWER: AI reviewed red CI and local raw hashes, no TECH FULL.

Private ECR /home/ubuntu/work/.hse-qa-tmp/agency-zero-sequential-closure-001/ZERO001-PR255-GOVERNANCE-OPS-REPAIR-ECR-20261126.json SHA256 ed018994b14403175628bb026d08ba55c2a5f5371dc76761d8a06d10455d514f. Next: guarded commit and hosted exact-source rerun, pending full independent audit of 3333929 and new candidate.
