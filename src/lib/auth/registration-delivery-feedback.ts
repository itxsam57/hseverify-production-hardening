import type { RegistrationDeliveryStatus } from "./registration-delivery-repository";

export function registrationDeliveryFeedback(status: RegistrationDeliveryStatus | null | undefined): string {
  switch (status) {
    case "accepted": return "The delivery provider accepted your verification message. Check the contact shown below.";
    case "terminal": return "Verification delivery failed. Wait for the resend timer, then request a new code.";
    case "unknown": return "We could not confirm verification delivery. Check your messages before requesting a new code when the resend timer allows.";
    case "obsolete": return "This verification request is no longer active. Request a new code.";
    default: return "Your verification message is queued. Check the contact shown below shortly.";
  }
}
