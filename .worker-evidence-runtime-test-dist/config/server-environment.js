"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getServerEnvironment = getServerEnvironment;
const environment_1 = require("./environment");
let cachedEnvironment = null;
function getServerEnvironment() {
    cachedEnvironment ??= (0, environment_1.validateRuntimeEnvironment)(process.env);
    return cachedEnvironment;
}
