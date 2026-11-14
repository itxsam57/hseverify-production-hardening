#!/usr/bin/env python3
"""M1.01.01: production preflight must reject runtime-invalid configurations.

No database, HTTP server, external provider, or real secret is used. This test
exercises both validators against identical synthetic configuration objects.
"""
import json
import os
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DRILL = r'''
import { validateScriptEnvironment } from './scripts/lib/environment.mjs';
import { loadTs } from './scripts/interview-test-ts-loader.mjs';
const { validateRuntimeEnvironment } = loadTs('src/lib/config/environment.ts');
const base = {
  NODE_ENV: 'production', HSE_APP_ENV: 'production', HSE_DATABASE_DRIVER: 'postgres',
  DATABASE_URL: 'postgres://synthetic:synthetic@127.0.0.1:5432/validation_only',
  HSE_SESSION_SECRET: 'synthetic-session-secret-at-least-32-characters',
  HSE_AUTH_PEPPER: 'synthetic-auth-pepper-at-least-32-characters',
  HSE_CREDENTIAL_SIGNING_SECRET: 'synthetic-signing-secret-at-least-32-characters',
  HSE_RELEASE_SHA: '0123456789abcdef0123456789abcdef01234567',
  HSE_ENABLE_WORKER_DEMO_AUTH: 'false', HSE_USE_WORKER_DEMO_DATA: 'false',
  HSE_ENABLE_AUTH_SANDBOX: 'false'
};
const cases = {
  public_http_origin: { HSE_PUBLIC_BASE_URL: 'http://public.example.org' },
  public_embedded_path: { HSE_PUBLIC_BASE_URL: 'https://public.example.org/subpath' },
  otp_email_missing_sender: { HSE_OTP_EMAIL_API_KEY: 'synthetic-email-api-key' },
  otp_sms_invalid_sid: { HSE_OTP_SMS_ACCOUNT_SID: 'invalid',
    HSE_OTP_SMS_AUTH_TOKEN: 'synthetic-sms-token', HSE_OTP_SMS_FROM: '+15555555555' },
  valid_synthetic_prod: { HSE_PUBLIC_BASE_URL: 'https://public.example.org',
    HSE_OTP_EMAIL_API_KEY: 'synthetic-email-api-key', HSE_OTP_EMAIL_FROM: 'no-reply@example.org',
    HSE_OTP_SMS_ACCOUNT_SID: 'AC' + 'a'.repeat(32),
    HSE_OTP_SMS_AUTH_TOKEN: 'synthetic-sms-token', HSE_OTP_SMS_FROM: '+15555555555' }
};
const output = {};
for (const [name, changes] of Object.entries(cases)) {
  output[name] = {};
  for (const [validatorName, validator] of [
    ['script', validateScriptEnvironment], ['runtime', validateRuntimeEnvironment]
  ]) {
    try { validator({ ...base, ...changes }); output[name][validatorName] = { accepted: true }; }
    catch (err) { output[name][validatorName] = {
      accepted: false, categories: (err.issues || []).map(issue =>
        /PUBLIC_BASE_URL/.test(issue) ? 'public_url' :
        /OTP email/.test(issue) ? 'otp_email' :
        /OTP SMS/.test(issue) ? 'otp_sms' : 'other')
    }; }
  }
}
console.log(JSON.stringify(output));
'''

class M10101RuntimePreflightParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        execution = subprocess.run(
            ['node', '--input-type=module', '--eval', DRILL], cwd=ROOT,
            text=True, capture_output=True, timeout=45,
        )
        if execution.returncode:
            raise AssertionError(f'Native isolated validation failed: {execution.stderr[-1200:]}')
        cls.results = json.loads(execution.stdout.strip().splitlines()[-1])

    def assert_denied_by_both(self, name, category):
        for validator in ('script', 'runtime'):
            result = self.results[name][validator]
            self.assertFalse(result['accepted'], f'{validator} unexpectedly accepted {name}')
            self.assertIn(category, result['categories'], f'{validator} incorrect reason for {name}')

    def test_public_base_url_invalid_http_or_path_denied_by_preflight_and_runtime(self):
        self.assert_denied_by_both('public_http_origin', 'public_url')
        self.assert_denied_by_both('public_embedded_path', 'public_url')

    def test_partially_configured_email_provider_denied_by_preflight_and_runtime(self):
        self.assert_denied_by_both('otp_email_missing_sender', 'otp_email')

    def test_malformed_sms_provider_denied_by_preflight_and_runtime(self):
        self.assert_denied_by_both('otp_sms_invalid_sid', 'otp_sms')

    def test_valid_synthetic_prod_config_accepted_without_any_provider_call(self):
        self.assertTrue(self.results['valid_synthetic_prod']['script']['accepted'])
        self.assertTrue(self.results['valid_synthetic_prod']['runtime']['accepted'])

    def test_actual_deployment_cli_rejects_invalid_public_origin_and_provider(self):
        # No live DB or provider is contacted. The CLI must fail closed before startup.
        base = {
            'PATH': os.environ.get('PATH', ''), 'HOME': os.environ.get('HOME', '/tmp'),
            'NODE_ENV': 'production', 'HSE_APP_ENV': 'production',
            'HSE_DATABASE_DRIVER': 'postgres',
            'DATABASE_URL': 'postgres://synthetic:synthetic@127.0.0.1:5432/validation_only',
            'HSE_SESSION_SECRET': 'synthetic-session-secret-at-least-32-characters',
            'HSE_AUTH_PEPPER': 'synthetic-auth-pepper-at-least-32-characters',
            'HSE_CREDENTIAL_SIGNING_SECRET': 'synthetic-signing-secret-at-least-32-characters',
            'HSE_RELEASE_SHA': '0123456789abcdef0123456789abcdef01234567',
            'HSE_ENABLE_WORKER_DEMO_AUTH': 'false',
            'HSE_USE_WORKER_DEMO_DATA': 'false',
            'HSE_ENABLE_AUTH_SANDBOX': 'false'
        }
        for overrides, expected in (
            ({'HSE_PUBLIC_BASE_URL': 'http://public.example.org'}, 'HSE_PUBLIC_BASE_URL'),
            ({'HSE_OTP_EMAIL_API_KEY': 'synthetic-email-api-key'}, 'OTP email'),
            ({'HSE_OTP_SMS_ACCOUNT_SID': 'invalid'}, 'OTP SMS')
        ):
            run = subprocess.run(['node', 'scripts/validate-environment.mjs'],
                                 cwd=ROOT, env={**base, **overrides},
                                 capture_output=True, text=True, timeout=12)
            self.assertNotEqual(run.returncode, 0, str(overrides))
            self.assertIn(expected, run.stderr + run.stdout)
            self.assertNotIn(base['HSE_SESSION_SECRET'], run.stderr + run.stdout)

    def test_actual_deployment_cli_accepts_synthetic_valid_settings_without_connecting(self):
        env = {
            'PATH': os.environ.get('PATH',''), 'HOME': os.environ.get('HOME','/tmp'),
            'NODE_ENV': 'production', 'HSE_APP_ENV': 'production',
            'HSE_DATABASE_DRIVER': 'postgres',
            'DATABASE_URL': 'postgres://synthetic:synthetic@127.0.0.1:5432/validation_only',
            'HSE_SESSION_SECRET': 'synthetic-session-secret-at-least-32-characters',
            'HSE_AUTH_PEPPER': 'synthetic-auth-pepper-at-least-32-characters',
            'HSE_CREDENTIAL_SIGNING_SECRET': 'synthetic-signing-secret-at-least-32-characters',
            'HSE_RELEASE_SHA': '0123456789abcdef0123456789abcdef01234567',
            'HSE_PUBLIC_BASE_URL': 'https://public.example.org',
            'HSE_OTP_EMAIL_API_KEY': 'synthetic-email-api-key',
            'HSE_OTP_EMAIL_FROM': 'no-reply@example.org'
        }
        run = subprocess.run(['node','scripts/validate-environment.mjs'],
                             cwd=ROOT, env=env, capture_output=True, text=True, timeout=12)
        self.assertEqual(run.returncode, 0, run.stderr[-800:])

if __name__ == '__main__':
    unittest.main(verbosity=2)
