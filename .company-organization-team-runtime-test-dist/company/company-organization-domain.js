"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompanyOrganizationConflictError = exports.CompanyOrganizationNotFoundError = exports.CompanyOrganizationInputError = exports.COMPANY_UNIT_STATUSES = void 0;
exports.normalizeCompanyUnitDraft = normalizeCompanyUnitDraft;
exports.createCompanySiteId = createCompanySiteId;
exports.createCompanyDepartmentId = createCompanyDepartmentId;
exports.normalizeCompanyUnitRevision = normalizeCompanyUnitRevision;
const auth_domain_1 = require("../auth/auth-domain");
exports.COMPANY_UNIT_STATUSES = ["active", "archived"];
class CompanyOrganizationInputError extends Error {
    constructor(message) {
        super(message);
        this.name = "CompanyOrganizationInputError";
    }
}
exports.CompanyOrganizationInputError = CompanyOrganizationInputError;
class CompanyOrganizationNotFoundError extends Error {
    constructor() {
        super("The Company organization record could not be found.");
        this.name = "CompanyOrganizationNotFoundError";
    }
}
exports.CompanyOrganizationNotFoundError = CompanyOrganizationNotFoundError;
class CompanyOrganizationConflictError extends Error {
    constructor(message = "The Company organization record changed. Reload and try again.") {
        super(message);
        this.name = "CompanyOrganizationConflictError";
    }
}
exports.CompanyOrganizationConflictError = CompanyOrganizationConflictError;
function normalizeText(value, label, min, max) {
    const normalized = value.trim().replace(/\s+/g, " ");
    if (normalized.length < min || normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) {
        throw new CompanyOrganizationInputError(`${label} must contain ${min} to ${max} safe characters.`);
    }
    return normalized;
}
function normalizeWebsite(value) {
    const normalized = value.trim();
    if (normalized.length < 5 || normalized.length > 240) {
        throw new CompanyOrganizationInputError("Website must contain 5 to 240 characters.");
    }
    let parsed;
    try {
        parsed = new URL(normalized);
    }
    catch {
        throw new CompanyOrganizationInputError("Enter a valid Company website URL.");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new CompanyOrganizationInputError("Company website must use HTTP or HTTPS.");
    }
    parsed.hash = "";
    const result = parsed.toString();
    if (result.length > 240) {
        throw new CompanyOrganizationInputError("Company website exceeds 240 characters.");
    }
    return result;
}
function normalizeRegistrationNumber(value) {
    const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
    if (!normalized)
        return null;
    if (normalized.length > 120 || /[\u0000-\u001f\u007f]/.test(normalized)) {
        throw new CompanyOrganizationInputError("Company registration number exceeds 120 safe characters.");
    }
    return normalized;
}
function normalizeCompanyUnitDraft(input) {
    let email;
    try {
        email = (0, auth_domain_1.normalizeEmail)(input.email);
    }
    catch {
        throw new CompanyOrganizationInputError("Enter a valid Company unit email address.");
    }
    return Object.freeze({
        name: normalizeText(input.name, "Name", 2, 160),
        formattedAddress: normalizeText(input.formattedAddress, "Address", 2, 500),
        phone: normalizeText(input.phone, "Phone", 3, 32),
        website: normalizeWebsite(input.website),
        email,
        registrationNumber: normalizeRegistrationNumber(input.registrationNumber)
    });
}
function createCompanySiteId() {
    return (0, auth_domain_1.createIdentifier)("site");
}
function createCompanyDepartmentId() {
    return (0, auth_domain_1.createIdentifier)("department");
}
function normalizeCompanyUnitRevision(value) {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new CompanyOrganizationInputError("Company unit revision is invalid.");
    }
    return value;
}
