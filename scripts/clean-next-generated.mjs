import { cleanAllNextGeneratedOutput } from "./lib/next-build-system.mjs";

const removed = await cleanAllNextGeneratedOutput();
for (const path of removed) console.log(`Removed generated Next output: ${path}`);
