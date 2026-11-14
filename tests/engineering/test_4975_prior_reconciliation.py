#!/usr/bin/env python3
"""Past scoped work is reused, deduped, but never promoted to release PASS."""
import csv
import importlib.util
import json
import subprocess
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('reconcile4975',ROOT/'scripts/reconcile-4975-prior-coverage.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Dedup4975Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows,cls.summary=module.reconcile()

    def test_exact_4975_id_dedup(self):
        self.assertEqual(len(self.rows),4975)
        self.assertEqual(len({r['check_id'] for r in self.rows}),4975)
        self.assertEqual(self.summary['planned_check_category_counts'],{
            'scenario_dimension':2616,'security_candidate':2008,'responsive_page':351})

    def test_historic_qualified_and_unqualified_counts_remain_separate(self):
        self.assertEqual(self.summary['slot_historical_link_states'],{
            'OLD_SCOPED_CLAUSE_PARTIAL_REVIEW_REQUIRED':693,
            'OLD_MIXED_LOG_UNCERTAIN_REVIEW_REQUIRED':17,
            'PRIOR_PASSED_CASE_TITLE_CANDIDATE_REVIEW_REQUIRED':37,
            'NO_EXACT_DIMENSION_LINK_FROM_OLD_EVIDENCE':4228})
        self.assertEqual(self.summary['scoped_prior_source_tests_green_distinct'],1392)
        self.assertEqual(self.summary['scoped_source_test_case_total'],1566)
        self.assertEqual(self.summary['final_stage_certified_slots'],0)
        self.assertEqual(self.summary['release_scenarios_fully_verified'],0)
        self.assertEqual(self.summary['planned_slots_not_final_stage_certified'],4975)
        self.assertEqual(self.summary['release_decision'],'NO_GO')

    def test_earlier_provider_and_security_audits_not_improperly_certified(self):
        self.assertTrue(all(r['release_certification']=='NOT_CERTIFIED' and
                            r['final_stage_fully_certified']=='NO' for r in self.rows))
        self.assertTrue(all(r['historical_coverage_link_state']=='NO_EXACT_DIMENSION_LINK_FROM_OLD_EVIDENCE'
                            for r in self.rows if r['category'] in ('security_candidate','responsive_page')))
        self.assertTrue(all(r['historical_coverage_link_state']=='NO_EXACT_DIMENSION_LINK_FROM_OLD_EVIDENCE'
                            for r in self.rows if r['check_dimension']=='genuine_provider_stage_owner_uat'))

    def test_case_ids_and_old_observation_ids_not_repeated_for_one_slot(self):
        for r in self.rows:
            for key in ('distinct_clean_old_clause_ids','distinct_mixed_old_clause_ids',
                        'prior_passing_source_case_ids_candidate_not_auto_credited'):
                observed=[v for v in r[key].split('; ') if v]
                self.assertEqual(len(observed),len(set(observed)))
            self.assertEqual(r['historical_observation_is_full_dimension_pass'],'NO')

    def test_unverified_caveat_is_not_misread_as_a_pass(self):
        self.assertNotIn('expiry_timeout_cancellation', module.relevant_dimensions(
            'BROWSER','Real Worker browser registration works; resend, expiry not tested'))
        self.assertIn('browser_controls_and_navigation',module.relevant_dimensions(
            'BROWSER','Actual real Chromium dashboard; later approval not tested'))
        self.assertNotIn('browser_controls_and_navigation',module.relevant_dimensions(
            'NATIVE','Real Chromium browser route tested with a pure unit test'))

    def test_each_frozen_scenario_keeps_all_12_planned_gates(self):
        progress=self.summary['per_frozen_scenario_dimension_progress']
        self.assertEqual(len(progress),218)
        self.assertTrue(all(row['all_12_planned_dimensions']==12 and
                            row['full_release_certified_dimensions']==0 for row in progress.values()))

    def test_original_218_release_ledger_reports_scoped_4975_not_release_pass(self):
        proc=subprocess.run(['node','scripts/reconcile-current-release-218.mjs'],cwd=ROOT,
                            capture_output=True,text=True,timeout=20)
        self.assertEqual(proc.returncode,0,proc.stderr)
        ledger=json.loads((ROOT/'.autopilot/artifacts/current-release-218-ledger.json').read_text())
        coverage=ledger['planned_check_progress']
        self.assertEqual(coverage['planning_slots_total'],4975)
        self.assertEqual(coverage['historically_scoped_partial_not_certified'],693)
        self.assertEqual(coverage['uncertain_mixed_or_title_only_not_certified'],54)
        self.assertEqual(coverage['without_precise_old_dimension_link'],4228)
        self.assertEqual(coverage['final_stage_certified'],0)
        self.assertEqual(ledger['counts']['full_verified'],0)
        self.assertEqual(ledger['release']['decision'],'NO_GO')
        self.assertEqual(len(ledger['scenarios']),218)
        self.assertEqual(sum(x['previous_partial_dimension_links']['old_scoped_clauses_incomplete']
                             for x in ledger['scenarios']),693)

    def test_tampering_final_stage_certification_fails_closed(self):
        program="""import {readFileSync} from 'node:fs';
import {buildCurrentReleaseLedger} from './scripts/lib/current-release-218-ledger.mjs';
const read = p => JSON.parse(readFileSync(p,'utf8'));
const source=read('docs/qa/2026-10-02-evidence.json');
const priorTestEvidence=read('docs/qa/evidence/MASTERPLAN_218_EXECUTED_TESTS.json');
const legacy216Evidence=read('docs/qa/evidence/MASTERPLAN_218_LEGACY_216_OBSERVATIONS.json');
const coverage4975Evidence=read('docs/qa/evidence/MASTERPLAN_218_4975_DEDUP_SUMMARY_20261114.json');
coverage4975Evidence.final_stage_certified_slots=1;
buildCurrentReleaseLedger({source,commitSha:'1c9954a770edb9e9f1a23b1bab59e680fb5bdcc5',priorTestEvidence,
  legacy216Evidence,coverage4975Evidence});
"""
        proc=subprocess.run(['node','--input-type=module','-e',program],cwd=ROOT,
                            capture_output=True,text=True,timeout=20)
        self.assertNotEqual(proc.returncode,0)
        self.assertIn('1 !== 0',proc.stderr)

    def test_on_disk_view_matches_exact_reconciliation(self):
        with module.OUTPUT.open(newline='') as fp:
            observed=list(csv.DictReader(fp))
        self.assertEqual(observed,self.rows)
        self.assertEqual(json.loads(module.SUMMARY.read_text()),self.summary)

if __name__=='__main__':unittest.main(verbosity=2)
