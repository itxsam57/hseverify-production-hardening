#!/usr/bin/env python3
"""Fail closed if signed M1.01.01 QA ledger still says PR/CI pending."""
import json, subprocess, sys, pathlib
path='docs/qa/218_VERTICAL_EXECUTION_CURSOR.json'
source=sys.argv[1] if len(sys.argv)>1 else '--working'
if source=='--base':
    payload=subprocess.check_output(['git','show',f'HEAD:{path}'],text=True)
elif source=='--working':
    payload=pathlib.Path(path).read_text()
else:
    raise SystemExit('usage: ... --base|--working')
cursor=json.loads(payload)
assert cursor['current_focus_scenario_id']=='M1.01.01', 'wrong frozen focus'
assert 'PENDING' not in cursor['current_focus_phase'], 'RED: signed PR201 merged, 91/91 hosted success, but cursor still falsely says PENDING'
assert '85554af4aac9dd110627a3176425bf8bf07eff2b' in cursor['last_completed_action'], 'RED: active signed SHA 855 not reflected in canonical cursor'
assert 'M1.01.01' in cursor['next_exact_action'], 'RED: next action not grounded to first frozen scenario'
print('PASS signed855 parity: accurate current SHA; no completed PR marked pending; first frozen ID still M1.01.01')
