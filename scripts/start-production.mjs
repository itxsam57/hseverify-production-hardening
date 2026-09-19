import { resolve } from "node:path";

const projectRoot = process.cwd();
const standaloneRoot = resolve(projectRoot, ".next", "standalone");
process.chdir(standaloneRoot);
await import(resolve(standaloneRoot, "server.js"));
