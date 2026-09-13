"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingInputError = exports.BillingConflictError = exports.BillingAccessError = exports.BILLING_MANAGE_PERMISSION = exports.BILLING_READ_PERMISSION = void 0;
exports.billingId = billingId;
exports.normalizeCurrency = normalizeCurrency;
exports.normalizeIdempotencyKey = normalizeIdempotencyKey;
exports.positiveInteger = positiveInteger;
const auth_domain_1 = require("../auth/auth-domain");
exports.BILLING_READ_PERMISSION = "company.billing.read";
exports.BILLING_MANAGE_PERMISSION = "company.billing.manage";
class BillingAccessError extends Error {
    constructor(message = "Billing access was denied.") { super(message); this.name = "BillingAccessError"; }
}
exports.BillingAccessError = BillingAccessError;
class BillingConflictError extends Error {
    constructor(message = "The billing operation conflicts with current state.") { super(message); this.name = "BillingConflictError"; }
}
exports.BillingConflictError = BillingConflictError;
class BillingInputError extends Error {
    constructor(message = "Billing input is invalid.") { super(message); this.name = "BillingInputError"; }
}
exports.BillingInputError = BillingInputError;
function billingId(prefix) { return (0, auth_domain_1.createIdentifier)(prefix); }
function normalizeCurrency(value) {
    const currency = value.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency))
        throw new BillingInputError("Currency must be a three-letter code.");
    return currency;
}
function normalizeIdempotencyKey(value) {
    const key = value.trim();
    if (key.length < 3 || key.length > 160)
        throw new BillingInputError("Idempotency key is invalid.");
    return key;
}
function positiveInteger(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0)
        throw new BillingInputError(`${label} must be a positive integer.`);
    return value;
}
