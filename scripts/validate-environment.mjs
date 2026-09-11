import { readProjectEnvironment } from "./lib/environment.mjs";

const environment = readProjectEnvironment();
console.log(
  `Environment valid: ${environment.appEnvironment}, database=${environment.databaseDriver}, release=${environment.releaseSha}.`
);
