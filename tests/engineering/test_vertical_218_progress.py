#!/usr/bin/env python3
"""Fail-closed status and permanent owner rule contract."""
import csv
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]

class VerticalProtocolTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rules = (ROOT/'AGENTS.md').read_text()
        cls.mission = (ROOT/'docs/qa/PROJECT_MISSION_218_FULL_VERIFICATION_PENTEST.md').read_text()
        cls.protocol = (ROOT/'docs/qa/218_VERTICAL_EXECUTION_PROTOCOL.md').read_text()
        cls.cursor = json.loads((ROOT/'docs/qa/218_VERTICAL_EXECUTION_CURSOR.json').read_text())
        with (ROOT/'docs/qa/evidence/MASTERPLAN_218_ALL_PREVIOUS_EVIDENCE_ACTIONS_20261114.csv').open(newline='') as f:
            cls.queue = list(csv.DictReader(f))
        run = subprocess.run(['node','scripts/qa-progress-218.mjs','--json'],cwd=ROOT,capture_output=True,text=True,timeout=20)
        if run.returncode: raise AssertionError(run.stderr)
        cls.report = json.loads(run.stdout)

    def test_permanent_rules_and_resume_files(self):
        self.assertIn('HSEVERIFY-PERMANENT-218-VERTICAL:BEGIN',self.rules)
        self.assertIn('UNIVERSAL-AUTOPILOT-V3:BEGIN',self.rules)
        for text in (self.rules,self.mission):
            self.assertIn('218_VERTICAL_EXECUTION_PROTOCOL.md',text)
        for text in (self.rules,self.mission,self.protocol):
            for value in ('qa:progress-218','4,975','693','54','4,228','1,392','1,566'):
                self.assertIn(value,text)

    def test_order_still_exact_frozen_218_and_37_bricks(self):
        ids=[r['frozen_id'] for r in self.queue]
        self.assertEqual(len(ids),len(set(ids)))
        self.assertEqual((len(ids),len({x['brick'] for x in self.queue})),(218,37))
        self.assertEqual((ids[0],ids[-1]),('M1.01.01','M3.12.04'))
        self.assertIn(self.cursor['current_focus_scenario_id'],ids)
        self.assertEqual(self.report['focus_scenario'],self.cursor['current_focus_scenario_id'])
        self.assertNotEqual(self.report['focus_scenario_status'],'FULLY_VERIFIED')
        self.assertTrue(self.cursor['no_new_localhost_environment_by_default'])
        self.assertIsNone(self.cursor['active_test_pid'])

    def test_all_owner_counts_in_one_machine_scoreboard(self):
        p=self.report
        for field,want in [('fully_verified',0),('scenarios_total',218),('scenarios_remaining',218),
                           ('scoped_historical_green_source_cases',1392),('scoped_historical_source_cases_total',1566),
                           ('source_cases_without_matched_green',174),('old_scoped_ids_not_full',216),
                           ('planned_old_partial_links_not_passed',693),('planned_uncertain_links',54),
                           ('planned_without_precise_old_link',4228),('planned_check_slots_total',4975),
                           ('final_stage_certified_planned_checks',0),('blocked_external_known',10),
                           ('preliminary_pentest_attack_slots',2008)]:
            self.assertEqual(p[field],want,field)
        self.assertIsNone(p['unresolved_high_critical_findings_count'])
        self.assertIsNone(p['independent_pentest_completed_verified_count'])
        self.assertEqual((p['release'],p['pentest']),('NO_GO','INCOMPLETE'))
        self.assertEqual(len(p['taskbar']),4)
        self.assertIn('PLANNED 693/4,975 PARTIAL',p['taskbar'][2])

    def test_short_text_output_includes_every_counter(self):
        result=subprocess.run(['node','scripts/qa-progress-218.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=20)
        self.assertEqual(result.returncode,0,result.stderr)
        for line in self.report['taskbar']:self.assertIn(line,result.stdout)
        self.assertIn('NOW '+self.cursor['current_focus_scenario_id'],result.stdout)

if __name__ == '__main__': unittest.main(verbosity=2)
