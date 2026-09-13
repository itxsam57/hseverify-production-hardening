"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecureFileUploadService = void 0;
exports.getSecureFileUploadService = getSecureFileUploadService;
const audit_domain_1 = require("../audit/audit-domain");
const server_environment_1 = require("../config/server-environment");
const secure_file_domain_1 = require("./secure-file-domain");
const private_object_storage_1 = require("./private-object-storage");
const secure_file_upload_domain_1 = require("./secure-file-upload-domain");
const secure_file_upload_repository_1 = require("./secure-file-upload-repository");
const secure_file_service_1 = require("./secure-file-service");
class SecureFileUploadService {
    files;
    uploads;
    storage;
    constructor(files, uploads, storage) {
        this.files = files;
        this.uploads = uploads;
        this.storage = storage;
    }
    async quarantineForPrincipal(input) {
        const file = await this.files.findForPrincipal(input.principal, input.fileId);
        if (!file)
            throw new secure_file_domain_1.SecureFileAccessDeniedError();
        this.assertUploadableState(file);
        const validated = (0, secure_file_upload_domain_1.validateSecureFileUpload)({
            policy: input.policy,
            fileId: file.fileId,
            objectKey: file.objectKey,
            reservedDisplayFilename: file.displayFilename,
            originalFilename: input.originalFilename,
            declaredMime: input.declaredMime,
            bytes: input.bytes
        });
        const bytes = (0, secure_file_upload_domain_1.materializeValidatedSecureFileUploadBytes)(validated);
        try {
            await this.storage.put(file.objectKey, bytes);
        }
        catch (error) {
            if (error instanceof private_object_storage_1.PrivateObjectConflictError) {
                throw new secure_file_upload_domain_1.SecureFileUploadValidationError("stored_object_inconsistent");
            }
            throw error;
        }
        const storedStat = await this.storage.stat(file.objectKey);
        if (!storedStat) {
            throw new secure_file_upload_domain_1.SecureFileUploadValidationError("stored_object_inconsistent");
        }
        const stored = (0, secure_file_upload_domain_1.confirmStoredSecureFileUpload)(validated, storedStat);
        const owner = (0, secure_file_domain_1.bindTrustedSecureFileOwner)(input.principal);
        const actor = (0, audit_domain_1.bindTrustedAuditActor)(input.principal);
        return this.uploads.finalizeQuarantine(owner, actor, stored);
    }
    assertUploadableState(file) {
        if (file.lifecycleStatus !== "reserved" && file.lifecycleStatus !== "quarantined") {
            throw new secure_file_domain_1.SecureFileReservationConflictError();
        }
    }
}
exports.SecureFileUploadService = SecureFileUploadService;
let service = null;
function getSecureFileUploadService() {
    if (service)
        return service;
    const environment = (0, server_environment_1.getServerEnvironment)();
    if (environment.appEnvironment !== "development" &&
        environment.appEnvironment !== "test") {
        throw new secure_file_upload_domain_1.SecureFileUploadValidationError("invalid_policy");
    }
    service = new SecureFileUploadService((0, secure_file_service_1.getSecureFileService)(), (0, secure_file_upload_repository_1.getSecureFileUploadRepository)(), (0, private_object_storage_1.createLocalTestPrivateObjectStorage)(environment.appEnvironment));
    return service;
}
