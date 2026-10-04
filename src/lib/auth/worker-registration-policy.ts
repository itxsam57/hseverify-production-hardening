export const WORKER_REGISTRATION_POLICY = Object.freeze({
  termsVersion: "worker-registration-terms-v1",
  privacyVersion: "worker-registration-privacy-v1",
  termsLabel: "I accept the HSE Verify terms for this Worker account.",
  privacyLabel: "I accept the privacy notice for Worker registration data."
});

export function normalizeWorkerRegistrationCountry(value: unknown): string {
  const country = typeof value === "string" ? value.trim() : "";
  if (country.length < 2 || country.length > 100 || /[\u0000-\u001f\u007f]/.test(country)) {
    throw new Error("Enter a valid country.");
  }
  return country;
}
