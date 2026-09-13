"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkerEvidenceService = void 0;
const worker_evidence_domain_1 = require("./worker-evidence-domain");
const worker_evidence_repository_1 = require("./worker-evidence-repository");
function assertExpectedRevision(value) {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new worker_evidence_domain_1.WorkerEvidenceContractError("Worker evidence revision is invalid.");
    }
    return value;
}
function required(value, label) {
    if (!value)
        throw new worker_evidence_domain_1.WorkerEvidenceContractError(`${label} is required.`);
    return value;
}
function normalizeQualification(input) {
    const issueDate = (0, worker_evidence_domain_1.normalizeOptionalDate)(input.issueDate);
    const expiryDate = (0, worker_evidence_domain_1.normalizeOptionalDate)(input.expiryDate);
    (0, worker_evidence_domain_1.assertDateRange)(issueDate, expiryDate);
    return Object.freeze({
        title: (0, worker_evidence_domain_1.normalizeOptionalText)(input.title, 240),
        category: (0, worker_evidence_domain_1.normalizeOptionalText)(input.category, 160),
        issuingOrganization: (0, worker_evidence_domain_1.normalizeOptionalText)(input.issuingOrganization, 240),
        learningProvider: (0, worker_evidence_domain_1.normalizeOptionalText)(input.learningProvider, 240),
        certificateNumber: (0, worker_evidence_domain_1.normalizeOptionalText)(input.certificateNumber, 160),
        issueDate,
        expiryDate,
        level: (0, worker_evidence_domain_1.normalizeOptionalText)(input.level, 120),
        country: (0, worker_evidence_domain_1.normalizeOptionalText)(input.country, 120),
        verificationUrl: (0, worker_evidence_domain_1.normalizeVerificationUrl)(input.verificationUrl),
        declarationAccepted: input.declarationAccepted === true
    });
}
function normalizeExperience(input) {
    const startDate = (0, worker_evidence_domain_1.normalizeOptionalDate)(input.startDate);
    const endDate = (0, worker_evidence_domain_1.normalizeOptionalDate)(input.endDate);
    (0, worker_evidence_domain_1.assertDateRange)(startDate, endDate);
    if (input.status !== "current" && input.status !== "ended") {
        throw new worker_evidence_domain_1.WorkerEvidenceContractError("Experience status is invalid.");
    }
    if (input.status === "current" && endDate !== null) {
        throw new worker_evidence_domain_1.WorkerEvidenceContractError("Current experience cannot have an end date.");
    }
    if (input.status === "ended" && endDate === null) {
        throw new worker_evidence_domain_1.WorkerEvidenceContractError("Ended experience requires an end date.");
    }
    return Object.freeze({
        companyName: (0, worker_evidence_domain_1.normalizeOptionalText)(input.companyName, 240),
        roleTitle: (0, worker_evidence_domain_1.normalizeOptionalText)(input.roleTitle, 240),
        duties: (0, worker_evidence_domain_1.normalizeOptionalMultiline)(input.duties, 4000),
        country: (0, worker_evidence_domain_1.normalizeOptionalText)(input.country, 120),
        startDate,
        endDate,
        status: input.status
    });
}
function normalizeEmployment(input) {
    const startDate = (0, worker_evidence_domain_1.normalizeOptionalDate)(input.startDate);
    const endDate = (0, worker_evidence_domain_1.normalizeOptionalDate)(input.endDate);
    (0, worker_evidence_domain_1.assertDateRange)(startDate, endDate);
    if (input.status !== "current" && input.status !== "ended") {
        throw new worker_evidence_domain_1.WorkerEvidenceContractError("Employment status is invalid.");
    }
    if (input.status === "current" && endDate !== null) {
        throw new worker_evidence_domain_1.WorkerEvidenceContractError("Current employment cannot have an end date.");
    }
    if (input.status === "ended" && endDate === null) {
        throw new worker_evidence_domain_1.WorkerEvidenceContractError("Ended employment requires an end date.");
    }
    return Object.freeze({
        companyName: (0, worker_evidence_domain_1.normalizeOptionalText)(input.companyName, 240),
        roleTitle: (0, worker_evidence_domain_1.normalizeOptionalText)(input.roleTitle, 240),
        duties: (0, worker_evidence_domain_1.normalizeOptionalMultiline)(input.duties, 4000),
        country: (0, worker_evidence_domain_1.normalizeOptionalText)(input.country, 120),
        startDate,
        endDate,
        status: input.status,
        endReason: (0, worker_evidence_domain_1.normalizeOptionalMultiline)(input.endReason, 1000)
    });
}
function normalizeSkill(input) {
    if (input.experienceMonths !== null &&
        (!Number.isSafeInteger(input.experienceMonths) || input.experienceMonths < 0)) {
        throw new worker_evidence_domain_1.WorkerEvidenceContractError("Skill experience duration is invalid.");
    }
    return Object.freeze({
        skillName: (0, worker_evidence_domain_1.normalizeOptionalText)(input.skillName, 240),
        category: (0, worker_evidence_domain_1.normalizeOptionalText)(input.category, 160),
        proficiencyClaim: (0, worker_evidence_domain_1.normalizeOptionalText)(input.proficiencyClaim, 160),
        experienceMonths: input.experienceMonths,
        relatedTrade: (0, worker_evidence_domain_1.normalizeOptionalText)(input.relatedTrade, 160),
        assuranceStatus: "self_declared"
    });
}
function validateSubmission(record) {
    const details = record.currentVersion.details;
    if (record.kind === "qualification") {
        const qualification = details;
        required(qualification.title, "Qualification title");
        required(qualification.category, "Qualification category");
        required(qualification.issuingOrganization, "Issuing organization");
        required(qualification.certificateNumber, "Certificate or candidate number");
        required(qualification.issueDate, "Qualification issue date");
        required(qualification.level, "Qualification level");
        required(qualification.country, "Qualification country");
        if (!qualification.declarationAccepted) {
            throw new worker_evidence_domain_1.WorkerEvidenceContractError("Accept the qualification declaration before submitting.");
        }
        return;
    }
    if (record.kind === "experience") {
        const experience = details;
        required(experience.companyName, "Experience company");
        required(experience.roleTitle, "Experience role");
        required(experience.country, "Experience country");
        required(experience.startDate, "Experience start date");
        return;
    }
    if (record.kind === "employment") {
        const employment = details;
        required(employment.companyName, "Employment company");
        required(employment.roleTitle, "Employment role");
        required(employment.country, "Employment country");
        required(employment.startDate, "Employment start date");
        return;
    }
    const skill = details;
    required(skill.skillName, "Skill name");
    required(skill.category, "Skill category");
    required(skill.proficiencyClaim, "Skill proficiency claim");
    if (skill.experienceMonths === null) {
        throw new worker_evidence_domain_1.WorkerEvidenceContractError("Skill experience duration is required.");
    }
    if (skill.assuranceStatus !== "self_declared") {
        throw new worker_evidence_domain_1.WorkerEvidenceContractError("Worker skill submissions must remain self-declared.");
    }
}
class WorkerEvidenceService {
    now;
    repository;
    constructor(clientPromise, now = () => new Date()) {
        this.now = now;
        this.repository = new worker_evidence_repository_1.DatabaseWorkerEvidenceRepository(clientPromise);
    }
    worker(principal) {
        return (0, worker_evidence_domain_1.assertWorkerEvidencePrincipal)(principal);
    }
    nowIso() {
        return this.now().toISOString();
    }
    async currentOrThrow(principal, recordId) {
        const worker = this.worker(principal);
        const record = await this.repository.findCurrentForWorker(worker.accountId, recordId.trim());
        if (!record)
            throw new worker_evidence_domain_1.WorkerEvidenceNotFoundError();
        return record;
    }
    async createDraft(principal, kind) {
        const worker = this.worker(principal);
        if (!["qualification", "experience", "employment", "skill"].includes(kind)) {
            throw new worker_evidence_domain_1.WorkerEvidenceContractError("Worker evidence kind is invalid.");
        }
        return this.repository.createDraft({
            principal: worker,
            workerAccountId: worker.accountId,
            kind,
            recordId: (0, worker_evidence_domain_1.createWorkerEvidenceId)("evidence_record"),
            versionId: (0, worker_evidence_domain_1.createWorkerEvidenceId)("evidence_version"),
            now: this.nowIso()
        });
    }
    async findCurrent(principal, recordId) {
        return this.currentOrThrow(principal, recordId);
    }
    async listCurrent(principal) {
        const worker = this.worker(principal);
        return this.repository.listCurrentForWorker(worker.accountId);
    }
    async listVersions(principal, recordId) {
        const current = await this.currentOrThrow(principal, recordId);
        return this.repository.listVersionsForWorker(current.workerAccountId, current.recordId);
    }
    async saveQualificationDraft(principal, input) {
        const worker = this.worker(principal);
        assertExpectedRevision(input.expectedRevision);
        const saved = await this.repository.saveQualificationDraft(worker, worker.accountId, input, normalizeQualification(input), this.nowIso());
        if (!saved)
            throw new worker_evidence_domain_1.WorkerEvidenceNotFoundError();
        return saved;
    }
    async saveExperienceDraft(principal, input) {
        const worker = this.worker(principal);
        assertExpectedRevision(input.expectedRevision);
        const saved = await this.repository.saveExperienceDraft(worker, worker.accountId, input, normalizeExperience(input), this.nowIso());
        if (!saved)
            throw new worker_evidence_domain_1.WorkerEvidenceNotFoundError();
        return saved;
    }
    async saveEmploymentDraft(principal, input) {
        const worker = this.worker(principal);
        assertExpectedRevision(input.expectedRevision);
        const saved = await this.repository.saveEmploymentDraft(worker, worker.accountId, input, normalizeEmployment(input), this.nowIso());
        if (!saved)
            throw new worker_evidence_domain_1.WorkerEvidenceNotFoundError();
        return saved;
    }
    async saveSkillDraft(principal, input) {
        const worker = this.worker(principal);
        assertExpectedRevision(input.expectedRevision);
        const saved = await this.repository.saveSkillDraft(worker, worker.accountId, input, normalizeSkill(input), this.nowIso());
        if (!saved)
            throw new worker_evidence_domain_1.WorkerEvidenceNotFoundError();
        return saved;
    }
    async submit(principal, recordId, expectedRevision) {
        const current = await this.currentOrThrow(principal, recordId);
        assertExpectedRevision(expectedRevision);
        if (current.currentVersion.status !== "draft" || current.currentVersion.revision !== expectedRevision) {
            const { WorkerEvidenceConflictError } = await Promise.resolve().then(() => __importStar(require("./worker-evidence-domain")));
            throw new WorkerEvidenceConflictError();
        }
        validateSubmission(current);
        const submitted = await this.repository.submitDraft({
            principal: this.worker(principal),
            workerAccountId: current.workerAccountId,
            recordId: current.recordId,
            expectedRevision,
            now: this.nowIso()
        });
        if (!submitted)
            throw new worker_evidence_domain_1.WorkerEvidenceNotFoundError();
        return submitted;
    }
    async startRevision(principal, recordId, expectedRevision) {
        const current = await this.currentOrThrow(principal, recordId);
        assertExpectedRevision(expectedRevision);
        const revised = await this.repository.startRevision({
            principal: this.worker(principal),
            workerAccountId: current.workerAccountId,
            recordId: current.recordId,
            expectedRevision,
            newVersionId: (0, worker_evidence_domain_1.createWorkerEvidenceId)("evidence_version"),
            now: this.nowIso()
        });
        if (!revised)
            throw new worker_evidence_domain_1.WorkerEvidenceNotFoundError();
        return revised;
    }
    async endEmployment(principal, recordId, expectedRevision, endDateInput, endReasonInput = null) {
        const current = await this.currentOrThrow(principal, recordId);
        if (current.kind !== "employment")
            throw new worker_evidence_domain_1.WorkerEvidenceNotFoundError();
        assertExpectedRevision(expectedRevision);
        const endDate = (0, worker_evidence_domain_1.normalizeOptionalDate)(endDateInput);
        if (!endDate)
            throw new worker_evidence_domain_1.WorkerEvidenceContractError("Employment end date is required.");
        const employment = current.currentVersion.details;
        (0, worker_evidence_domain_1.assertDateRange)(employment.startDate, endDate);
        const ended = await this.repository.endEmployment({
            principal: this.worker(principal),
            workerAccountId: current.workerAccountId,
            recordId: current.recordId,
            expectedRevision,
            newVersionId: (0, worker_evidence_domain_1.createWorkerEvidenceId)("evidence_version"),
            endDate,
            endReason: (0, worker_evidence_domain_1.normalizeOptionalMultiline)(endReasonInput, 1000),
            now: this.nowIso()
        });
        if (!ended)
            throw new worker_evidence_domain_1.WorkerEvidenceNotFoundError();
        return ended;
    }
    async markSkillInactive(principal, recordId, expectedRevision) {
        const current = await this.currentOrThrow(principal, recordId);
        if (current.kind !== "skill")
            throw new worker_evidence_domain_1.WorkerEvidenceNotFoundError();
        assertExpectedRevision(expectedRevision);
        const inactive = await this.repository.markSkillInactive({
            principal: this.worker(principal),
            workerAccountId: current.workerAccountId,
            recordId: current.recordId,
            expectedRevision,
            newVersionId: (0, worker_evidence_domain_1.createWorkerEvidenceId)("evidence_version"),
            now: this.nowIso()
        });
        if (!inactive)
            throw new worker_evidence_domain_1.WorkerEvidenceNotFoundError();
        return inactive;
    }
}
exports.WorkerEvidenceService = WorkerEvidenceService;
