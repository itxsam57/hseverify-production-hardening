#!/usr/bin/env python3
"""Deduplicate prior scoped evidence into the existing 4,975 planning slots.

A green old test or log can be linked as a *scoped observation* only when the
original old A28 clause explicitly mentions the dimension. This NEVER means
one of the 4,975 dimensions or 218 scenarios is FULLY VERIFIED on final stage.
Unmapped historic test identities remain reusable in the existing 218 ledger.
"""
from __future__ import annotations
import argparse
import collections
import csv
import json
from pathlib import Path
import re
import subprocess

ROOT=Path(__file__).resolve().parent.parent
PLAN=ROOT/'docs/qa/evidence/QA_4975_PROVISIONAL_REGISTER_20261114.csv'
OLD=ROOT/'docs/qa/evidence/MASTERPLAN_218_LEGACY_216_OBSERVATIONS.json'
PRIOR=ROOT/'docs/qa/evidence/MASTERPLAN_218_EXECUTED_TESTS.json'
OUTPUT=ROOT/'docs/qa/evidence/MASTERPLAN_218_4975_DEDUP_PROGRESS_20261114.csv'
SUMMARY=ROOT/'docs/qa/evidence/MASTERPLAN_218_4975_DEDUP_SUMMARY_20261114.json'
BASELINE_QA_SHA='1c9954a770edb9e9f1a23b1bab59e680fb5bdcc5'

# Dimension signals are ONLY hints that an old scoped clause exists, not a
# claim that the entire compound dimension passed. Deliberately exclude the
# final provider/staging/owner gate: no old record can satisfy it.
RULES={
 'browser_controls_and_navigation':r'(?i)\b(chromium|browser|form|button|dashboard|ui|navigation|page|portal)\b',
 'responsive_keyboard_accessibility':r'(?i)(?:320px|390px|1440px|1280px|\bmobile\b|\bdesktop\b|\bkeyboard\b|\bviewport\b|\bfocus\b|\btab key\b|\baccessibility\b|\bresponsive\b)',
 'positive_workflow':r'(?i)\b(completes?|succeeds?|persisted|approved?|submitted?|accepts?|allowed?|delivered?|saved|shows|reaches|routed|generated|issued|successfully)\b',
 'invalid_input_rejection':r'(?i)\b(rejects?|denies|denied|blocks?|invalid|malformed|wrong|unauthorized|refused|400|403|404|not found)\b',
 'retry_refresh_duplicate':r'(?i)\b(retry|retries|refresh|reload|duplicate|replayed|resubmi\w*|resend|reconnect)\b',
 'expiry_timeout_cancellation':r'(?i)\b(expir\w*|timeout|timed.out|cancell?\w*|revok\w*|log.?out|sign.?out|lockout)\b',
 'outage_interruption_recovery':r'(?i)\b(offline|outage|restor\w*|recover\w*|interrupt\w*|disconnect\w*|reconnect\w*|resume|rollback|down.and.up)\b',
 'concurrency_race':r'(?i)\b(race|concurren\w*|simultaneous\w*|two.tabs|parallel|two.sessions|competing|in.flight)\b',
 'cross_role_notifications':r'(?i)\b(notifications?|receiv\w*|deep.links?|outbox|queue|intake|inbox|handoff)\b',
 'database_audit_history':r'(?i)\b(database|db|pglite|persist\w*|audit|history|immutable|recorded|stored)\b',
 'role_tenant_api_pentest':r'(?i)\b(cross.tenant|bola|idor|forged|foreign|unauthorized|permission|access.denied|wrong.role|private.file|cross.account|copied.token|other.worker|other.company)\b',
}
BROWSER_ONLY={'browser_controls_and_navigation','responsive_keyboard_accessibility'}


def load_inputs():
    with PLAN.open(newline='') as f:planned=list(csv.DictReader(f))
    old=json.loads(OLD.read_text()); prior=json.loads(PRIOR.read_text())
    if len(planned)!=4975 or len({r['check_id'] for r in planned})!=4975:
        raise ValueError('Frozen preliminary 4975 baseline missing/duplicate')
    expected={'scenario_dimension':2616,'security_candidate':2008,'responsive_page':351}
    if collections.Counter(r['category'] for r in planned)!=expected:raise ValueError('Category totals drift')
    if len(old['scenarios'])!=218 or len(prior['cases'])!=1566:raise ValueError('Original 218 or source 1566 changed')
    if old['counts']['total_scoped_observation_references']!=316:raise ValueError('Old 316 evidence ref total changed')
    if old['counts']['old_log_references_with_clean_green_run_summary']!=307:raise ValueError('Old 307 clean logs changed')
    if prior['counts']['previous_green_distinct_source_matched_cases']!=1392:raise ValueError('Old passing source case identities changed')
    return planned,old,prior


def bounded_assertion_text(text: str) -> str:
    """Do not mark an old check because it is described as *not tested*."""
    disclaimer = re.compile(
        r'(?i)\b(not tested|not covered|still open|still need|remain open|remains open|'
        r'not verified|missing|incomplete|outstanding|does not claim|not exercised|'
        r'not proven|not validated|only mocked|provider inactive|mock only|not activated)\b'
    )
    # The original scope prose contains positive clauses and explicit caveats.
    # Discard any semicolon- or sentence-separated clause with an unmet gate.
    return ' '.join(segment for segment in re.split(r'[.;]\s+', text)
                    if segment.strip() and not disclaimer.search(segment))


def relevant_dimensions(kind:str,text:str)->set[str]:
    text=bounded_assertion_text(text)
    out=set()
    for dimension,expression in RULES.items():
        if dimension in BROWSER_ONLY and kind!='BROWSER':continue
        if re.search(expression,text):out.add(dimension)
    return out


def reconcile()->tuple[list[dict],dict]:
    planned,old,prior=load_inputs()
    old_by_id={r['id']:r for r in old['scenarios']}
    direct_by_id=collections.defaultdict(set)
    case_by_id={x['case_id']:x for x in prior['cases']}
    for case in prior['cases']:
        if case['test_execution']=='NO_PASS_LOG_EVIDENCE':continue
        for sid in case['scenario_ids']:
            direct_by_id[sid].add(case['case_id'])
    assert len(old_by_id)==218
    links=collections.defaultdict(lambda: {'clean':set(),'mixed':set(),'case':set()})
    for sid,row in old_by_id.items():
        for e in row['old_scoped_evidence']:
            dimensions=relevant_dimensions(e['kind'],e['old_scoped_clause'])
            for d in dimensions:
                key=f'SCENARIO:{sid}:{list(RULES).index(d)+1:02d}'
                if e['log_evidence_status']=='CLEAN_OLD_TEST_LOG':links[key]['clean'].add(e['observation_id'])
                else:links[key]['mixed'].add(e['observation_id'])
                # Names linked by the SAME old log are only reusable case hints.
                for cid in e['candidate_current_source_case_ids_FROM_SHARED_OLD_LOG_NOT_AUTOMATIC_SCENARIO_PASS']:
                    links[key]['case'].add(cid)
    # Independently associated passing test cases may suggest the same
    # dimension; do not auto-certify an old test based on only its title.
    for sid,case_ids in direct_by_id.items():
        for cid in case_ids:
            case=case_by_id[cid]
            for d in relevant_dimensions('BROWSER' if '/browser/' in case['file'] else 'NATIVE',case['title']):
                key=f'SCENARIO:{sid}:{list(RULES).index(d)+1:02d}'
                links[key]['case'].add(cid)
    out=[];counter=collections.Counter();historical_obs_ids=set();observed_case_ids=set()
    for item in planned:
        ck=item['check_id'];ev=links.get(ck,{'clean':set(),'mixed':set(),'case':set()})
        green=sorted(ev['clean']);mixed=sorted(ev['mixed']);cases=sorted(ev['case'])
        observed_case_ids.update(cases)
        historical_obs_ids.update(green)
        if green: state='OLD_SCOPED_CLAUSE_PARTIAL_REVIEW_REQUIRED'
        elif mixed: state='OLD_MIXED_LOG_UNCERTAIN_REVIEW_REQUIRED'
        elif cases: state='PRIOR_PASSED_CASE_TITLE_CANDIDATE_REVIEW_REQUIRED'
        else: state='NO_EXACT_DIMENSION_LINK_FROM_OLD_EVIDENCE'
        counter[state]+=1
        out.append({
            **item,
            'historical_coverage_link_state':state,
            'distinct_clean_old_clause_ids':'; '.join(green),
            'distinct_mixed_old_clause_ids':'; '.join(mixed),
            'prior_passing_source_case_ids_candidate_not_auto_credited':'; '.join(cases),
            'historical_observation_is_full_dimension_pass':'NO',
            'final_stage_fully_certified':'NO',
            'remaining_full_release_assertion':'YES',
            'next_action':{
                'OLD_SCOPED_CLAUSE_PARTIAL_REVIEW_REQUIRED':'Reuse old log and scoped behavior; verify missing steps on final SHA',
                'OLD_MIXED_LOG_UNCERTAIN_REVIEW_REQUIRED':'Resolve mixed log outcome before using old result',
                'PRIOR_PASSED_CASE_TITLE_CANDIDATE_REVIEW_REQUIRED':'Read passing test and match real assertions before scenario credit',
                'NO_EXACT_DIMENSION_LINK_FROM_OLD_EVIDENCE':'Search 1392-case evidence and 216 old map first; test actual missing behavior only',
            }[state],
        })
    assert len(out)==4975
    assert sum(counter.values())==4975
    assert all(x['release_certification']=='NOT_CERTIFIED' and x['final_stage_fully_certified']=='NO' for x in out)
    assert counter['OLD_SCOPED_CLAUSE_PARTIAL_REVIEW_REQUIRED']>0
    assert sum(counter[x] for x in counter if x!='NO_EXACT_DIMENSION_LINK_FROM_OLD_EVIDENCE') <=2616
    # Scenario-level detail is part of the SAME original 218 master ledger.
    per_id=collections.defaultdict(lambda:collections.Counter())
    for cell in out:
        if cell['category']=='scenario_dimension':
            per_id[cell['frozen_scenario_id']][cell['historical_coverage_link_state']]+=1
    if len(per_id)!=218:raise ValueError('Some frozen scenario has missing preliminary dimensions')
    by_scenario={sid:{**dict(count), 'all_12_planned_dimensions':sum(count.values()),
                      'full_release_certified_dimensions':0} for sid,count in sorted(per_id.items())}
    assert all(x['all_12_planned_dimensions']==12 for x in by_scenario.values())
    summary={
        'per_frozen_scenario_dimension_progress':by_scenario,
        'source_sha_at_initial_plan':planned[0]['candidate_source_sha'],
        'source_sha_at_reconciliation':BASELINE_QA_SHA,
        'canonical_scenarios':218,
        'planned_check_slots':len(out),
        'planned_check_category_counts':dict(collections.Counter(x['category'] for x in out)),
        'slot_historical_link_states':dict(sorted(counter.items())),
        'historically_evidenced_distinct_planned_slots_NOT_COMPLETE':counter['OLD_SCOPED_CLAUSE_PARTIAL_REVIEW_REQUIRED'],
        'historical_mixed_or_source_case_title_only_slots_NOT_COMPLETE':counter['OLD_MIXED_LOG_UNCERTAIN_REVIEW_REQUIRED']+counter['PRIOR_PASSED_CASE_TITLE_CANDIDATE_REVIEW_REQUIRED'],
        'planned_slots_without_any_precise_old_dimension_link':counter['NO_EXACT_DIMENSION_LINK_FROM_OLD_EVIDENCE'],
        'planned_slots_not_final_stage_certified':len(out),
        'final_stage_certified_slots':0,
        'scoped_prior_source_tests_green_distinct':prior['counts']['previous_green_distinct_source_matched_cases'],
        'scoped_source_test_case_total':prior['counts']['static_existing_distinct_test_cases'],
        'previous_green_source_cases_without_a_precise_planned_dimension_link':prior['counts']['previous_green_distinct_source_matched_cases']-len(observed_case_ids),
        'source_cases_used_in_preliminary_dimension_candidate_links':len(observed_case_ids),
        'old_clean_unique_observation_ids_used_for_preliminary_dimension_links':len(historical_obs_ids),
        'old_scoped_scenario_claims':old['counts']['scenarios_with_any_historical_scoped_observation'],
        'release_scenarios_fully_verified':0,
        'release_decision':'NO_GO',
        'important_limitations':[
            'A historical mapped scoped clause is not a fully passing compound 4975 slot; it is evidence for one or more substeps.',
            'Conservative regex mapping may miss earlier valid tests; no evidence is thrown away, it remains in original 1392 source cases or 316 old scoped logs.',
            'Source-case titles without exact scenario+dimension assertions remain candidate-only; no lexical auto PASS.',
            'Security attack-family and responsive-page planning slots require explicit entrypoint/viewport/source-specific test attribution, not generic role or browser logs.',
            'All 4975 final protected-stage checks remain pending; no actual new application tests were performed during this audit.',
            '4975 is a provisional planning denominator, not the finite exact future executable test count. Increase with proven mandatory cases.',
        ],
    }
    return out,summary


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--verify',action='store_true')
    args=p.parse_args()
    rows,summary=reconcile()
    if args.verify:
        if not OUTPUT.exists() or not SUMMARY.exists():raise ValueError('Reconciled coverage files missing')
        with OUTPUT.open(newline='') as fp:
            saved=list(csv.DictReader(fp))
        if saved!=rows:raise ValueError('Merged 4975 case evidence view changed')
        current=json.loads(SUMMARY.read_text())
        if current!=summary:raise ValueError('Existing summary differs from exact inputs')
    else:
        OUTPUT.parent.mkdir(parents=True,exist_ok=True)
        with OUTPUT.open('w',newline='') as fp:
            writer=csv.DictWriter(fp,fieldnames=list(rows[0]),lineterminator='\n')
            writer.writeheader();writer.writerows(rows)
        SUMMARY.write_text(json.dumps(summary,indent=2,sort_keys=True)+'\n')
    print(json.dumps({k:summary[k] for k in ('planned_check_slots','slot_historical_link_states','historically_evidenced_distinct_planned_slots_NOT_COMPLETE','historical_mixed_or_source_case_title_only_slots_NOT_COMPLETE','planned_slots_without_any_precise_old_dimension_link','final_stage_certified_slots','scoped_prior_source_tests_green_distinct','source_cases_used_in_preliminary_dimension_candidate_links')},indent=2,sort_keys=True))

if __name__=='__main__':main()
