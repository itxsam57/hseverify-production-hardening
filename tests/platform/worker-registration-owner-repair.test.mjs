import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

async function source(path) {
  return readFile(resolve(process.cwd(), path), "utf8");
}

test("Worker OTP uses a challenge-bound normal POST transition", async () => {
  const [
    forms,
    verificationPage,
    submitRoute,
    resendRoute,
    binding,
    requestHelper
  ] = await Promise.all([
    source("src/app/worker/register/registration-forms.tsx"),
    source("src/app/worker/register/verify/page.tsx"),
    source("src/app/worker/register/verify/submit/route.ts"),
    source("src/app/worker/register/verify/resend/route.ts"),
    source("src/lib/auth/worker-registration-challenge-binding.ts"),
    source("src/lib/http/registration-request.ts")
  ]);

  assert.match(forms, /action="\/worker\/register\/verify\/submit"/);
  assert.match(forms, /action="\/worker\/register\/verify\/resend"/);
  assert.match(forms, /method="post"/);
  assert.match(forms, /name="challengeId" type="hidden"/);
  assert.doesNotMatch(forms, /useActionState\(\s*verifyWorkerRegistration/);
  assert.doesNotMatch(forms, /useActionState\(\s*resendWorkerRegistrationCode/);

  assert.match(verificationPage, /export const dynamic = "force-dynamic"/);
  assert.match(verificationPage, /readWorkerRegistrationChallengeBinding/);
  assert.match(verificationPage, /key=\{`\$\{pendingStep\}:\$\{challengeId/);

  assert.match(submitRoute, /BUILD-PIN AUTH-REG-OTP-POST/);
  assert.match(submitRoute, /BUILD-PIN AUTH-REG-OTP-ERROR-BOUNDARY/);
  assert.match(submitRoute, /isSameOriginRegistrationPost/);
  assert.match(submitRoute, /registrationRedirectUrl\(request, path\)/);
  assert.match(submitRoute, /binding\.challengeId !== challengeId/);
  assert.match(submitRoute, /registrationRouteRequestFingerprint\(request\)/);
  assert.match(submitRoute, /if \(!\(error instanceof RegistrationServiceError\)\) throw error/);
  assert.match(submitRoute, /Cache-Control/);
  assert.match(submitRoute, /no-store/);
  assert.doesNotMatch(submitRoute, /new URL\(path, request\.url\)/);
  assert.doesNotMatch(submitRoute, /revalidatePath/);

  assert.match(resendRoute, /service\.resend/);
  assert.match(resendRoute, /registrationRedirectUrl\(request, path\)/);
  assert.match(resendRoute, /registrationRouteRequestFingerprint\(request\)/);
  assert.match(resendRoute, /if \(!\(error instanceof RegistrationServiceError\)\) throw error/);
  assert.match(resendRoute, /status=resent/);
  assert.doesNotMatch(resendRoute, /new URL\(path, request\.url\)/);
  assert.doesNotMatch(resendRoute, /revalidatePath/);

  assert.match(requestHelper, /registrationRequestFingerprint\(\)/);
  assert.match(requestHelper, /registrationRouteRequestFingerprint\(request: Request\)/);
  assert.match(requestHelper, /registrationRedirectUrl\(request: Request, path: string\)/);
  assert.match(requestHelper, /allowedRegistrationOrigins/);
  assert.match(requestHelper, /fingerprintFromHeaders/);
  assert.match(requestHelper, /next\/headers/);
  assert.match(binding, /worker-registration-flow/);
  assert.match(binding, /findLatestActiveChallengeForUpdate/);
  assert.match(binding, /challengeId: challenge\?\.challengeId/);
});

test("Worker registration remains a simple one-column editable surface", async () => {
  const forms = await source(
    "src/app/worker/register/registration-forms.tsx"
  );
  const copy = await source("src/config/product-copy.ts");

  assert.match(forms, /PRODUCT_COPY\.workerRegistration/);
  assert.doesNotMatch(forms, /styles\.twoColumn/);
  assert.doesNotMatch(forms, /styles\.securityList/);
  assert.match(copy, /DEFERRED_INTEGRATIONS/);
});
