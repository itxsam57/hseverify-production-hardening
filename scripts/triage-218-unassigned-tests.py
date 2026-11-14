#!/usr/bin/env python3
"""Generate read-only scenario-name suggestions for previously unmapped tests.

A suggested ID is NOT proof of coverage and is NEVER credited to the 218 ledger.
"""
import argparse
import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs/qa/evidence/MASTERPLAN_218_UNATTRIBUTED_CASE_REVIEW_20261114.csv'
STOP = {'worker','company','browser','actual','test','tests','real','user','owner','admin',
        'that','this','with','from','where','should','never','there','current','state',
        'role','roles','other','when','each','only','case','cases','source','result',
        'runtime','code','data','session','sessions','pass','failed','valid','same',
        'without','then','into','next','work','also','direct','different','cross'}


def words(text):
    return {word for word in re.findall(r'[a-z]{4,}', text.lower()) if word not in STOP}


def build():
    prior=json.loads((ROOT/'docs/qa/evidence/MASTERPLAN_218_EXECUTED_TESTS.json').read_text())
    legacy=json.loads((ROOT/'docs/qa/evidence/MASTERPLAN_218_LEGACY_216_OBSERVATIONS.json').read_text())
    frozen=json.loads((ROOT/'docs/qa/2026-10-02-evidence.json').read_text())['expanded_scenario_verification']['scenarios']
    already={x['case_id'] for x in prior['cases'] if x['scenario_ids']}
    already.update(cid for row in legacy['scenarios'] for cid in row['candidate_case_ids_from_old_logs_NOT_COVERAGE_CERTIFICATION'])
    need=[x for x in prior['cases'] if x['case_id'] not in already]
    if len(need)!=1110:
        raise ValueError('Unmapped case count drift: reconcile prior evidence first')
    dest=[(r['id'],words(r['scenario']),words(r['family'])) for r in frozen]
    rows=[]
    for case in sorted(need,key=lambda x:x['case_id']):
        title=words(case['title'])
        filename=words(case['file'].replace('-',' ').replace('_',' ').replace('/',' '))
        candidates=[]
        for sid,stem,family in dest:
            score=4*len(title&stem)+2*len(filename&stem)+len(title&family)+len(filename&family)
            if score>=3:candidates.append((score,sid))
        candidates.sort(key=lambda x:(-x[0],x[1]))
        candidates=candidates[:3]
        rows.append({
            'case_id':case['case_id'], 'source_file':case['file'], 'test_title':case['title'],
            'previous_execution_evidence':case['test_execution'],
            'suggested_frozen_ids_UNREVIEWED':'; '.join(i for _,i in candidates),
            'text_overlap_score_NOT_PROOF':'; '.join(str(n) for n,_ in candidates),
            'review_status':'TEXT_SUGGESTION_ONLY_NO_COVERAGE_CREDIT' if candidates else 'CROSS_CUTTING_OR_NO_TEXT_MATCH',
            'full_masterplan_verification':'NOT_FULLY_VERIFIED'
        })
    assert len(rows)==1110
    assert sum(r['previous_execution_evidence']=='NO_PASS_LOG_EVIDENCE' for r in rows)==173
    assert sum(r['previous_execution_evidence']!='NO_PASS_LOG_EVIDENCE' for r in rows)==937
    return rows


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--verify',action='store_true')
    args=parser.parse_args()
    rows=build()
    if args.verify:
        with OUT.open(newline='') as fp:old=list(csv.DictReader(fp))
        if old!=rows:raise ValueError('Unmapped test review view has changed')
    else:
        OUT.parent.mkdir(parents=True,exist_ok=True)
        with OUT.open('w',newline='') as fp:
            out=csv.DictWriter(fp,fieldnames=list(rows[0]),lineterminator='\n')
            out.writeheader();out.writerows(rows)
    print(json.dumps({'unassigned_case_identities':len(rows),
                      'previously_green_unassigned':937,
                      'unproven_unassigned':173,
                      'cases_with_nonbinding_text_suggestions':sum(bool(r['suggested_frozen_ids_UNREVIEWED']) for r in rows),
                      'cases_with_no_text_suggestion':sum(not r['suggested_frozen_ids_UNREVIEWED'] for r in rows),
                      'auto_promoted_to_full_verified':0},sort_keys=True))

if __name__=='__main__':main()
