import { spawnSync } from "node:child_process";
for(const args of [["--test","tests/platform/framework-effective-policy-contract.test.mjs"],["scripts/run-effective-policy-runtime-tests.mjs"]]){const r=spawnSync(process.execPath,args,{stdio:"inherit"});if(r.status!==0)process.exit(r.status??1);}
