import { createHash } from "node:crypto";
export type PublicInquiry = Readonly<{
  kind: "contact" | "demo"; name: string; email: string;
  company: string; message: string; submissionNonce: string;
}>;
export class InquiryValidationError extends Error {}
function text(value: unknown, label: string, min: number, max: number, multiline = false): string {
  if (typeof value !== "string") throw new InquiryValidationError(label + " is required.");
  const result = value.trim();
  if (result.length < min || result.length > max ||
      (multiline ? /[\u0000]/ : /[\u0000-\u001f\u007f]/).test(result))
    throw new InquiryValidationError(label + " must contain " + min + " to " + max + " characters.");
  return result;
}
export function normalizeInquiry(input: Record<string, unknown>): PublicInquiry {
  if (input.kind !== "contact" && input.kind !== "demo") throw new InquiryValidationError("Choose a valid request type.");
  if (input.website !== undefined && input.website !== "") throw new InquiryValidationError("Reload the form and try again.");
  const email = text(input.email, "Email address", 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InquiryValidationError("Enter a valid email address.");
  const submissionNonce = text(input.submissionNonce, "Submission reference", 24, 80);
  if (!/^[A-Za-z0-9_-]+$/.test(submissionNonce)) throw new InquiryValidationError("Reload the form and try again.");
  return Object.freeze({
    kind: input.kind, name: text(input.name, "Name", 2, 120), email,
    company: text(input.company ?? "", "Company", 0, 160),
    message: text(input.message, "Message", 10, 4000, true), submissionNonce
  });
}
export function inquirySubmissionKey(nonce: string): string {
  return createHash("sha256").update("public-inquiry:v1:" + nonce).digest("hex");
}
