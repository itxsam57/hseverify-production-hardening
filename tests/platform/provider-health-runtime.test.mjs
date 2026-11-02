import assert from "node:assert/strict";
import test from "node:test";
import { getProviderHealth, getProviderAdapterState } from "../../src/lib/integrations/provider-health-domain.ts";

const environment = (appEnvironment, providers) => ({ appEnvironment, registrationOtpProviders: providers });
test("production never describes disabled fixtures as available", () => {
 const rows = getProviderHealth(environment("production"));
 for (const key of ["email", "sms", "payment", "liveness"]) {
  const row = rows.find(item => item.provider === key);
  assert.equal(row.status, "disabled");
  assert.equal(row.reason, "external_configuration_required");
  assert.equal(row.adapter, "external");
 }
 const scanner = rows.find(item => item.provider === "malware_scanning");
 assert.equal(scanner.adapter, "external");
 assert.equal(scanner.status, "configured");
 assert.equal(scanner.reason, "configured_not_verified");
});
test("complete actual email and SMS settings are configuration, not delivery evidence", () => {
 const rows = getProviderHealth(environment("production", {emailApiKey:"test-private-key", emailFrom:"service@example.test", smsAccountSid:"AC"+"a".repeat(32), smsAuthToken:"test-token", smsFrom:"+15551234567"}));
 for (const key of ["email", "sms"]) {
  const row = rows.find(item => item.provider === key);
  assert.equal(row.configured, true);
  assert.equal(row.status, "configured");
  assert.equal(row.reason, "configured_not_verified");
  assert.equal(row.observedAvailability, "not_checked");
 }
 assert.ok(!JSON.stringify(rows).includes("test-private-key"));
 assert.ok(!JSON.stringify(rows).includes("test-token"));
});
test("partial provider settings cannot enable a provider", () => {
 const rows = getProviderHealth(environment("production", {emailApiKey:"only-key", smsAccountSid:"AC"+"a".repeat(32)}));
 assert.equal(rows.find(item => item.provider === "email").configured, false);
 assert.equal(rows.find(item => item.provider === "sms").configured, false);
});
test("development fixtures and built-in video remain explicitly limited", () => {
 const rows = getProviderHealth(environment("test"));
 for (const key of ["email", "malware_scanning"]) {
  const row = rows.find(item => item.provider === key);
  assert.equal(row.status, "ready");
  assert.equal(row.reason, "local_fixture_available");
  assert.equal(row.configured, false);
 }
 const video = rows.find(item => item.provider === "video");
 assert.equal(video.reason, "built_in_available");
 assert.equal(video.observedAvailability, "not_checked");
});

test("all six adapter boundaries and development activation remain explicit", () => {
 const config = environment("development");
 const rows = getProviderHealth(config);
 assert.deepEqual(rows.map(row => row.provider), ["email", "sms", "payment", "video", "liveness", "malware_scanning"]);
 assert.deepEqual(getProviderAdapterState(config).filter(row => row.enabled).map(row => row.provider), ["email", "video", "malware_scanning"]);
 assert.equal(rows.find(row => row.provider === "video").productionActivation, "enabled");
 for (const key of ["email", "sms", "payment", "liveness", "malware_scanning"]) assert.equal(rows.find(row => row.provider === key).productionActivation, "requires_configuration");
});
test("preview selects real scanner rather than test fixture and never certifies it", () => {
 const scanner = getProviderHealth(environment("preview")).find(row => row.provider === "malware_scanning");
 assert.equal(scanner.adapter, "external");
 assert.equal(scanner.productionActivation, "configured_unverified");
 assert.equal(scanner.observedAvailability, "not_checked");
});
