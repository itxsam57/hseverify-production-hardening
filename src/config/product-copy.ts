export const PRODUCT_COPY = {
  workerRegistration: {
    pageEyebrow: "Worker registration",
    pageTitle: "Create your Worker account",
    pageDescription:
      "Enter your details, then verify your email and phone before signing in.",
    cardEyebrow: "Worker access",
    cardTitle: "Register",
    cardDescription: "Use contact details you can access now.",
    phoneHint: "Include the country code, for example +923001234567.",
    passwordHint:
      "Use at least 12 characters with an uppercase letter, lowercase letter, number and symbol.",
    verificationOrder: "Email is verified first, then your phone.",
    emailStepTitle: "Verify your email",
    phoneStepTitle: "Verify your phone",
    codeHint: "Enter the latest six-digit code.",
    sandboxLabel: "Open test-code inbox"
  }
} as const;

export const DEFERRED_INTEGRATIONS = {
  otpDelivery: {
    owner: "Authentication",
    currentMode: "Encrypted local sandbox",
    providerEntryPoint: "src/lib/auth/worker-registration-service.ts",
    sandboxReader: "src/lib/auth/auth-sandbox-service.ts",
    productionTarget:
      "Replace delivery behind an OTP provider adapter without changing registration state transitions."
  },
  payments: {
    owner: "Billing",
    currentMode: "Deferred until the core assurance workflow is complete",
    providerEntryPoint: "Future M3.05 billing adapter",
    productionTarget:
      "Keep payment intents, webhooks and reconciliation behind one provider interface."
  },
  video: {
    owner: "Interview",
    currentMode: "Deferred until the interview workflow backbone exists",
    providerEntryPoint: "Future M2.12 video adapter",
    productionTarget:
      "Keep rooms, recordings and provider health behind one provider interface."
  }
} as const;
