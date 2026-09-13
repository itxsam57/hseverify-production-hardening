"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrivateObjectStorageError = exports.PrivateObjectConflictError = void 0;
exports.createLocalTestPrivateObjectStorage = createLocalTestPrivateObjectStorage;
const node_path_1 = require("node:path");
const private_object_storage_core_1 = require("./private-object-storage-core");
var private_object_storage_core_2 = require("./private-object-storage-core");
Object.defineProperty(exports, "PrivateObjectConflictError", { enumerable: true, get: function () { return private_object_storage_core_2.PrivateObjectConflictError; } });
Object.defineProperty(exports, "PrivateObjectStorageError", { enumerable: true, get: function () { return private_object_storage_core_2.PrivateObjectStorageError; } });
function createLocalTestPrivateObjectStorage(appEnvironment) {
    const trustedBasePath = process.cwd();
    return new private_object_storage_core_1.LocalTestPrivateObjectStorage({
        appEnvironment,
        trustedBasePath,
        rootPath: (0, node_path_1.resolve)(trustedBasePath, ".data", "private-objects")
    });
}
