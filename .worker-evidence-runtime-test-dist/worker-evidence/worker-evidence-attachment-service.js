"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkerEvidenceAttachmentService = exports.WORKER_EVIDENCE_ATTACHMENT_KINDS = void 0;
const node_crypto_1 = require("node:crypto");
const secure_file_domain_1 = require("../secure-files/secure-file-domain");
const secure_file_upload_domain_1 = require("../secure-files/secure-file-upload-domain");
const worker_employment_leaving_letter_repository_1 = require("./worker-employment-leaving-letter-repository");
const worker_evidence_domain_1 = require("./worker-evidence-domain");
const worker_evidence_file_candidate_repository_1 = require("./worker-evidence-file-candidate-repository");
const worker_evidence_repository_1 = require("./worker-evidence-repository");
exports.WORKER_EVIDENCE_ATTACHMENT_KINDS = [
    "primary_certificate",
    "supporting_evidence",
    "experience_evidence",
    "employment_evidence",
    "skill_evidence"
];
function assertAttachmentKindForRecord(kind, attachmentKind) {
    const valid = (kind === "qualification" &&
        (attachmentKind === "primary_certificate" ||
            attachmentKind === "supporting_evidence")) ||
        (kind === "experience" && attachmentKind === "experience_evidence") ||
        (kind === "employment" && attachmentKind === "employment_evidence") ||
        (kind === "skill" && attachmentKind === "skill_evidence");
    if (!valid) {
        throw new worker_evidence_domain_1.WorkerEvidenceContractError("That evidence file type does not belong to this Worker record.");
    }
}
function assertExpectedSecureFile(file, input) {
    if (!file ||
        file.ownerAccountId !== input.accountId ||
        file.ownerRole !== "worker" ||
        file.tenantId !== null ||
        file.membershipId !== null ||
        file.reservationKey !== input.reservationKey ||
        file.displayFilename !== input.displayFilename ||
        (input.lifecycleStatus !== undefined &&
            file.lifecycleStatus !== input.lifecycleStatus)) {
        throw new worker_evidence_domain_1.WorkerEvidenceAttachmentUnavailableError();
    }
    return file;
}
function pendingCandidate(candidate, file) {
    return Object.freeze({
        candidateId: candidate.candidateId,
        recordId: candidate.recordId,
        versionId: candidate.versionId,
        bindingKind: candidate.bindingKind,
        secureFileId: candidate.secureFileId,
        displayFilename: candidate.displayFilename,
        expectedActiveBindingId: candidate.expectedActiveBindingId,
        scanStatus: file.lifecycleStatus,
        createdAt: candidate.createdAt
    });
}
function assertScannableCandidateFile(file) {
    if (file.lifecycleStatus === "unsafe" || file.lifecycleStatus === "scan_failed") {
        throw new worker_evidence_domain_1.WorkerEvidenceAttachmentUnavailableError(file.lifecycleStatus === "unsafe"
            ? "Worker evidence file failed malware safety checks."
            : "Worker evidence file security scanning failed.");
    }
    if (file.lifecycleStatus !== "quarantined" &&
        file.lifecycleStatus !== "scan_pending" &&
        file.lifecycleStatus !== "available") {
        throw new worker_evidence_domain_1.WorkerEvidenceAttachmentUnavailableError();
    }
}
function workerEvidenceBusinessReference(input) {
    const nonce = (0, node_crypto_1.randomBytes)(6).toString("hex");
    return [
        "worker-evidence",
        input.recordId,
        input.versionId,
        input.attachmentKind,
        nonce
    ].join(":");
}
function workerLeavingLetterBusinessReference(input) {
    const nonce = (0, node_crypto_1.randomBytes)(6).toString("hex");
    return [
        "worker-evidence",
        input.recordId,
        input.versionId,
        "leaving_letter",
        nonce
    ].join(":");
}
class WorkerEvidenceAttachmentService {
    secureFiles;
    secureUploads;
    secureScans;
    settleFileScan;
    now;
    repository;
    leavingLetters;
    candidates;
    constructor(clientPromise, secureFiles, secureUploads, secureScans, settleFileScan = async () => undefined, now = () => new Date()) {
        this.secureFiles = secureFiles;
        this.secureUploads = secureUploads;
        this.secureScans = secureScans;
        this.settleFileScan = settleFileScan;
        this.now = now;
        this.repository = new worker_evidence_repository_1.DatabaseWorkerEvidenceRepository(clientPromise);
        this.leavingLetters = new worker_employment_leaving_letter_repository_1.DatabaseWorkerEmploymentLeavingLetterRepository(clientPromise);
        this.candidates = new worker_evidence_file_candidate_repository_1.DatabaseWorkerEvidenceFileCandidateRepository(clientPromise);
    }
    async uploadAndBind(principal, input) {
        const worker = (0, worker_evidence_domain_1.assertWorkerEvidencePrincipal)(principal);
        const recordId = input.recordId.trim();
        const versionId = input.versionId.trim();
        const current = await this.repository.findCurrentForWorker(worker.accountId, recordId);
        if (!current)
            throw new worker_evidence_domain_1.WorkerEvidenceNotFoundError();
        if (current.currentVersion.versionId !== versionId ||
            current.currentVersion.status !== "draft") {
            throw new worker_evidence_domain_1.WorkerEvidenceConflictError("Evidence files can only be changed on the current draft version.");
        }
        assertAttachmentKindForRecord(current.kind, input.attachmentKind);
        const displayFilename = (0, worker_evidence_domain_1.normalizeOptionalText)(input.originalFilename, 240);
        if (!displayFilename) {
            throw new worker_evidence_domain_1.WorkerEvidenceContractError("Evidence filename is required.");
        }
        if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength < 1) {
            throw new worker_evidence_domain_1.WorkerEvidenceContractError("Evidence file is required.");
        }
        const businessReference = workerEvidenceBusinessReference({
            recordId,
            versionId,
            attachmentKind: input.attachmentKind
        });
        const owner = (0, secure_file_domain_1.bindTrustedSecureFileOwner)(worker);
        const expectedReservation = (0, secure_file_domain_1.createSecureFileReservationIntent)({
            owner,
            businessReference,
            displayFilename
        });
        const reservation = await this.secureFiles.reserveForPrincipal({
            principal: worker,
            businessReference,
            displayFilename
        });
        const reserved = assertExpectedSecureFile(reservation.file, {
            accountId: worker.accountId,
            reservationKey: expectedReservation.reservationKey,
            displayFilename,
            lifecycleStatus: "reserved"
        });
        const policy = (0, secure_file_upload_domain_1.createTrustedSecureFileUploadPolicy)({
            policyKey: `worker.evidence.${input.attachmentKind}`,
            allowedKinds: ["pdf", "png", "jpeg"],
            maxBytes: secure_file_upload_domain_1.SECURE_FILE_UPLOAD_DEFAULT_MAX_BYTES
        });
        await this.secureUploads.quarantineForPrincipal({
            principal: worker,
            fileId: reserved.fileId,
            originalFilename: displayFilename,
            declaredMime: input.declaredMime,
            bytes: input.bytes,
            policy
        });
        await this.secureScans.scheduleForPrincipal({
            principal: worker,
            fileRef: reserved.fileId
        });
        await this.settleFileScan(worker, reserved.fileId);
        const observed = assertExpectedSecureFile(await this.secureFiles.findForPrincipal(worker, reserved.fileId), {
            accountId: worker.accountId,
            reservationKey: expectedReservation.reservationKey,
            displayFilename
        });
        assertScannableCandidateFile(observed);
        const candidate = await this.candidates.create({
            workerAccountId: worker.accountId,
            candidateId: (0, worker_evidence_domain_1.createWorkerEvidenceId)("evidence_file_candidate"),
            recordId,
            versionId,
            bindingKind: input.attachmentKind,
            secureFileId: observed.fileId,
            reservationKey: expectedReservation.reservationKey,
            displayFilename,
            expectedActiveBindingId: input.expectedActiveAttachmentId?.trim() || null,
            now: this.now().toISOString()
        });
        if (!candidate)
            throw new worker_evidence_domain_1.WorkerEvidenceNotFoundError();
        if (observed.lifecycleStatus === "available") {
            const finalized = await this.finalizePendingCandidate(worker, candidate.candidateId);
            if (!("attachmentId" in finalized)) {
                throw new worker_evidence_domain_1.WorkerEvidenceConflictError("The evidence candidate finalized into the wrong binding type.");
            }
            return finalized;
        }
        return pendingCandidate(candidate, observed);
    }
    async finalizePendingCandidate(principal, candidateIdInput) {
        const worker = (0, worker_evidence_domain_1.assertWorkerEvidencePrincipal)(principal);
        const candidateId = candidateIdInput.trim();
        if (!candidateId)
            throw new worker_evidence_domain_1.WorkerEvidenceNotFoundError();
        const candidate = await this.candidates.findForWorker(worker.accountId, candidateId);
        if (!candidate || candidate.status !== "pending") {
            throw new worker_evidence_domain_1.WorkerEvidenceNotFoundError();
        }
        const scanned = assertExpectedSecureFile(await this.secureFiles.findForPrincipal(worker, candidate.secureFileId), {
            accountId: worker.accountId,
            reservationKey: candidate.reservationKey,
            displayFilename: candidate.displayFilename,
            lifecycleStatus: "available"
        });
        const now = this.now().toISOString();
        if (candidate.bindingKind === "leaving_letter") {
            const finalized = await this.candidates.finalizeLeavingLetter({
                principal: worker,
                workerAccountId: worker.accountId,
                candidateId: candidate.candidateId,
                secureFileId: scanned.fileId,
                leavingLetterId: (0, worker_evidence_domain_1.createWorkerEvidenceId)("leaving_letter"),
                now
            });
            if (!finalized)
                throw new worker_evidence_domain_1.WorkerEvidenceNotFoundError();
            return finalized;
        }
        const finalized = await this.candidates.finalizeAttachment({
            principal: worker,
            workerAccountId: worker.accountId,
            candidateId: candidate.candidateId,
            secureFileId: scanned.fileId,
            attachmentId: (0, worker_evidence_domain_1.createWorkerEvidenceId)("evidence_attachment"),
            now
        });
        if (!finalized)
            throw new worker_evidence_domain_1.WorkerEvidenceNotFoundError();
        return finalized;
    }
    async listPendingForRecord(principal, recordIdInput) {
        const worker = (0, worker_evidence_domain_1.assertWorkerEvidencePrincipal)(principal);
        const recordId = recordIdInput.trim();
        const current = await this.repository.findCurrentForWorker(worker.accountId, recordId);
        if (!current)
            throw new worker_evidence_domain_1.WorkerEvidenceNotFoundError();
        const candidates = await this.candidates.listForWorker(worker.accountId, recordId);
        const pending = [];
        for (const candidate of candidates) {
            if (candidate.status !== "pending")
                continue;
            const file = assertExpectedSecureFile(await this.secureFiles.findForPrincipal(worker, candidate.secureFileId), {
                accountId: worker.accountId,
                reservationKey: candidate.reservationKey,
                displayFilename: candidate.displayFilename
            });
            pending.push(pendingCandidate(candidate, file));
        }
        return Object.freeze(pending);
    }
    async listForRecord(principal, recordIdInput) {
        const worker = (0, worker_evidence_domain_1.assertWorkerEvidencePrincipal)(principal);
        const recordId = recordIdInput.trim();
        const current = await this.repository.findCurrentForWorker(worker.accountId, recordId);
        if (!current)
            throw new worker_evidence_domain_1.WorkerEvidenceNotFoundError();
        return (await this.repository.listAttachmentsForWorker(worker.accountId, recordId));
    }
    async uploadLeavingLetter(principal, input) {
        const worker = (0, worker_evidence_domain_1.assertWorkerEvidencePrincipal)(principal);
        const recordId = input.recordId.trim();
        const versionId = input.versionId.trim();
        const current = await this.repository.findCurrentForWorker(worker.accountId, recordId);
        if (!current || current.kind !== "employment") {
            throw new worker_evidence_domain_1.WorkerEvidenceNotFoundError();
        }
        if (current.lifecycleStatus !== "ended" ||
            current.currentVersion.versionId !== versionId ||
            current.currentVersion.status !== "submitted") {
            throw new worker_evidence_domain_1.WorkerEvidenceConflictError("A leaving letter can only be attached to the current submitted ended employment version.");
        }
        const displayFilename = (0, worker_evidence_domain_1.normalizeOptionalText)(input.originalFilename, 240);
        if (!displayFilename) {
            throw new worker_evidence_domain_1.WorkerEvidenceContractError("Leaving letter filename is required.");
        }
        if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength < 1) {
            throw new worker_evidence_domain_1.WorkerEvidenceContractError("Leaving letter file is required.");
        }
        const businessReference = workerLeavingLetterBusinessReference({
            recordId,
            versionId
        });
        const owner = (0, secure_file_domain_1.bindTrustedSecureFileOwner)(worker);
        const expectedReservation = (0, secure_file_domain_1.createSecureFileReservationIntent)({
            owner,
            businessReference,
            displayFilename
        });
        const reservation = await this.secureFiles.reserveForPrincipal({
            principal: worker,
            businessReference,
            displayFilename
        });
        const reserved = assertExpectedSecureFile(reservation.file, {
            accountId: worker.accountId,
            reservationKey: expectedReservation.reservationKey,
            displayFilename,
            lifecycleStatus: "reserved"
        });
        const policy = (0, secure_file_upload_domain_1.createTrustedSecureFileUploadPolicy)({
            policyKey: "worker.evidence.leaving_letter",
            allowedKinds: ["pdf", "png", "jpeg"],
            maxBytes: secure_file_upload_domain_1.SECURE_FILE_UPLOAD_DEFAULT_MAX_BYTES
        });
        await this.secureUploads.quarantineForPrincipal({
            principal: worker,
            fileId: reserved.fileId,
            originalFilename: displayFilename,
            declaredMime: input.declaredMime,
            bytes: input.bytes,
            policy
        });
        await this.secureScans.scheduleForPrincipal({
            principal: worker,
            fileRef: reserved.fileId
        });
        await this.settleFileScan(worker, reserved.fileId);
        const observed = assertExpectedSecureFile(await this.secureFiles.findForPrincipal(worker, reserved.fileId), {
            accountId: worker.accountId,
            reservationKey: expectedReservation.reservationKey,
            displayFilename
        });
        assertScannableCandidateFile(observed);
        const candidate = await this.candidates.create({
            workerAccountId: worker.accountId,
            candidateId: (0, worker_evidence_domain_1.createWorkerEvidenceId)("evidence_file_candidate"),
            recordId,
            versionId,
            bindingKind: "leaving_letter",
            secureFileId: observed.fileId,
            reservationKey: expectedReservation.reservationKey,
            displayFilename,
            expectedActiveBindingId: input.expectedActiveLeavingLetterId?.trim() || null,
            now: this.now().toISOString()
        });
        if (!candidate)
            throw new worker_evidence_domain_1.WorkerEvidenceNotFoundError();
        if (observed.lifecycleStatus === "available") {
            const finalized = await this.finalizePendingCandidate(worker, candidate.candidateId);
            if (!("leavingLetterId" in finalized)) {
                throw new worker_evidence_domain_1.WorkerEvidenceConflictError("The leaving-letter candidate finalized into the wrong binding type.");
            }
            return finalized;
        }
        return pendingCandidate(candidate, observed);
    }
    async listLeavingLetters(principal, recordIdInput) {
        const worker = (0, worker_evidence_domain_1.assertWorkerEvidencePrincipal)(principal);
        const recordId = recordIdInput.trim();
        const current = await this.repository.findCurrentForWorker(worker.accountId, recordId);
        if (!current || current.kind !== "employment") {
            throw new worker_evidence_domain_1.WorkerEvidenceNotFoundError();
        }
        return this.leavingLetters.listForWorker(worker.accountId, recordId);
    }
}
exports.WorkerEvidenceAttachmentService = WorkerEvidenceAttachmentService;
