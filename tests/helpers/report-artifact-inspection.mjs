import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
export function parsedReportPdf(bytes){
 const raw=Buffer.from(bytes);
 assert.ok(raw.subarray(0,9).toString("ascii")==="%PDF-1.4\n","Actual PDF bytes must carry the PDF signature.");
 // Preserve literal line-ending hyphens in identifiers; default extraction dehyphenates them.
 const result=spawnSync("pdftotext",["-layout","-","-"],{input:raw,encoding:"utf8",maxBuffer:16*1024*1024});
 assert.equal(result.status,0,result.stderr || "The actual PDF parser must accept this export.");
 return result.stdout;
}
