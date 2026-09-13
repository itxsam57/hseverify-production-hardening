"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecureFileScanService = void 0;
exports.getSecureFileScanService = getSecureFileScanService;
const secure_file_scan_repository_1 = require("./secure-file-scan-repository");
class SecureFileScanService {
    repository;
    constructor(repository = new secure_file_scan_repository_1.DatabaseSecureFileScanRepository()) {
        this.repository = repository;
    }
    scheduleForPrincipal(input) {
        return this.repository.scheduleForPrincipal(input);
    }
}
exports.SecureFileScanService = SecureFileScanService;
let service = null;
function getSecureFileScanService() {
    service ??= new SecureFileScanService();
    return service;
}
