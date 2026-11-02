import "server-only";
import type {DatabaseClient} from "../database/database";
import {EvidenceReviewConflictError} from "./evidence-review-domain";

export async function reviewerCapacity(database:DatabaseClient,accountId:string,lock=false):Promise<{limit:number;open:number;revision:number}|null>{
 const schema=await database.query<{relation:string|null}>("SELECT to_regclass('reviewer_capacity_locks') AS relation");
 if(!schema.rows[0]?.relation)return null; // Explicit historical migration ceilings only.
 if(lock){
  const row=await database.query("SELECT account_id FROM reviewer_capacity_locks WHERE account_id=$1 FOR UPDATE",[accountId]);
  if(!row.rows[0])throw new EvidenceReviewConflictError("Reviewer capacity configuration is unavailable.");
 }
 const settings=(await database.query<{limit:number;revision:number}>(`SELECT COALESCE(latest.max_open_reviews,defaults.max_open_reviews) AS limit,COALESCE(latest.capacity_sequence,0)::integer AS revision
  FROM review_quality_defaults defaults LEFT JOIN LATERAL(SELECT max_open_reviews,capacity_sequence FROM reviewer_capacity_revisions WHERE account_id=$1 ORDER BY capacity_sequence DESC LIMIT 1)latest ON TRUE WHERE defaults.singleton=TRUE`,[accountId])).rows[0];
 if(!settings)throw new EvidenceReviewConflictError("Reviewer capacity configuration is unavailable.");
 const count=(await database.query<{open:number}>("SELECT platform_reviewer_open_reviews($1) AS open",[accountId])).rows[0];
 return {limit:settings.limit,open:count.open,revision:settings.revision};
}
