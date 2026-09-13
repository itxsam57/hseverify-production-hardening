"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SandboxBillingProvider = void 0;
exports.signBillingWebhook = signBillingWebhook;
exports.billingPayloadHash = billingPayloadHash;
exports.verifyBillingWebhook = verifyBillingWebhook;
exports.parseBillingProviderEvent = parseBillingProviderEvent;
const node_crypto_1 = require("node:crypto");
const billing_domain_1 = require("./billing-domain");
function signBillingWebhook(rawBody, secret) {
    if (secret.length < 16)
        throw new billing_domain_1.BillingInputError("Billing webhook secret is too short.");
    return (0, node_crypto_1.createHmac)("sha256", secret).update(rawBody, "utf8").digest("hex");
}
function billingPayloadHash(rawBody) { return (0, node_crypto_1.createHash)("sha256").update(rawBody, "utf8").digest("hex"); }
function verifyBillingWebhook(rawBody, signature, secret) {
    const expected = Buffer.from(signBillingWebhook(rawBody, secret), "hex");
    let supplied;
    try {
        supplied = Buffer.from(signature.trim(), "hex");
    }
    catch {
        throw new billing_domain_1.BillingAccessError();
    }
    if (supplied.length !== expected.length || !(0, node_crypto_1.timingSafeEqual)(supplied, expected))
        throw new billing_domain_1.BillingAccessError();
}
class SandboxBillingProvider {
    mode = "sandbox";
    createCheckoutReference() { return `sandbox_checkout_${(0, billing_domain_1.billingId)("billing").slice(-24)}`; }
    createRefundReference() { return `sandbox_refund_${(0, billing_domain_1.billingId)("billing").slice(-24)}`; }
}
exports.SandboxBillingProvider = SandboxBillingProvider;
function parseBillingProviderEvent(rawBody) {
    let value;
    try {
        value = JSON.parse(rawBody);
    }
    catch {
        throw new billing_domain_1.BillingInputError("Provider webhook payload is invalid JSON.");
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new billing_domain_1.BillingInputError("Provider webhook payload is invalid.");
    const row = value;
    if (typeof row.id !== "string" || row.id.trim().length < 8 || typeof row.type !== "string" || !Number.isSafeInteger(row.amountMinor) || typeof row.currency !== "string")
        throw new billing_domain_1.BillingInputError("Provider webhook payload is incomplete.");
    const base = { id: row.id.trim(), amountMinor: Number(row.amountMinor), currency: row.currency.trim().toUpperCase() };
    if (base.amountMinor <= 0 || !/^[A-Z]{3}$/.test(base.currency))
        throw new billing_domain_1.BillingInputError("Provider webhook amount or currency is invalid.");
    if (row.type === "payment.captured" && typeof row.checkoutReference === "string" && row.checkoutReference.trim())
        return Object.freeze({ ...base, type: "payment.captured", checkoutReference: row.checkoutReference.trim() });
    if (row.type === "refund.succeeded" && typeof row.refundReference === "string" && row.refundReference.trim())
        return Object.freeze({ ...base, type: "refund.succeeded", refundReference: row.refundReference.trim() });
    throw new billing_domain_1.BillingInputError("Provider webhook event type is unsupported.");
}
