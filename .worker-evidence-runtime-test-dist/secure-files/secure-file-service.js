"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecureFileService = void 0;
exports.getSecureFileService = getSecureFileService;
const secure_file_domain_1 = require("./secure-file-domain");
const secure_file_repository_1 = require("./secure-file-repository");
class SecureFileService {
    repository;
    constructor(repository = (0, secure_file_repository_1.getSecureFileRepository)()) {
        this.repository = repository;
    }
    reserveForPrincipal(input) {
        const owner = (0, secure_file_domain_1.bindTrustedSecureFileOwner)(input.principal);
        const intent = (0, secure_file_domain_1.createSecureFileReservationIntent)({
            owner,
            businessReference: input.businessReference,
            displayFilename: input.displayFilename
        });
        return this.repository.reserve(owner, intent);
    }
    listForPrincipal(principal, options) {
        return this.repository.listForPrincipal(principal, options);
    }
    findForPrincipal(principal, fileId) {
        return this.repository.findForPrincipal(principal, fileId);
    }
}
exports.SecureFileService = SecureFileService;
let service = null;
function getSecureFileService() {
    service ??= new SecureFileService();
    return service;
}
