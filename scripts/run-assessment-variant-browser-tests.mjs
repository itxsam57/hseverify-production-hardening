import {spawnSync} from "node:child_process";
const variants=[
 ["controlled-review",{HSE_MASTERPLAN_DELIVERY_MODE:"CONTROLLED_REVIEW"}],
 ["section-review",{HSE_MASTERPLAN_DELIVERY_MODE:"SECTION_REVIEW"}],
 ["mcq-offline",{HSE_MASTERPLAN_CONTENT_MODE:"MCQ_ONLY",HSE_MASTERPLAN_MCQ_OFFLINE:"true"}],
 ["written-offline",{HSE_MASTERPLAN_CONTENT_MODE:"WRITTEN_ONLY",HSE_MASTERPLAN_OFFLINE_RECOVERY:"true"}],
 ["written-offline-tabs",{HSE_MASTERPLAN_OFFLINE_RECOVERY:"true",HSE_MASTERPLAN_OFFLINE_TABS:"true"}],
 ["written-offline-opener",{HSE_MASTERPLAN_OFFLINE_RECOVERY:"true",HSE_MASTERPLAN_OFFLINE_OPENER:"true"}],
 ["emergency-resume",{HSE_MASTERPLAN_RECOVERY_MODE:"resume"}],
 ["emergency-replacement",{HSE_MASTERPLAN_RECOVERY_MODE:"replacement"}],
 ["timing-accommodation",{HSE_MASTERPLAN_TIMING:"true"}]
];
const selected=process.argv[2];
if(selected&&!variants.some(([name])=>name===selected))throw new Error("Unknown assessment variant");
for(const [name,flags]of variants){
 if(selected&&name!==selected)continue;
 const environment={...process.env};
 for(const key of Object.keys(environment))if(key.startsWith("HSE_MASTERPLAN_"))delete environment[key];
 Object.assign(environment,{HSE_MASTERPLAN_CONTENT_MODE:"COMBINED",HSE_MASTERPLAN_DELIVERY_MODE:"STRICT",...flags});
 console.log("Assessment variant: "+name);
 const result=spawnSync(process.execPath,["--test","tests/browser/masterplan-worker-credential-e2e.browser.test.mjs"],{env:environment,stdio:"inherit"});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status??1);
}
