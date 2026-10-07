const oid=(prefix,c)=>prefix+"_"+c.repeat(24);
export async function seedPermanentWorkerId(database, worker, c, NOW = "2026-10-01T00:00:00.123Z") {
  const identityId=oid("worker_identity",c), versionId=oid("identity_version",c), checkId=oid("identity_duplicate_check",c), permanentWorkerId=oid("worker_id",c);
  await database.query(`INSERT INTO worker_identities
    (identity_id,worker_account_id,lifecycle_status,current_version_number,lock_version,created_at,updated_at)
    VALUES ($1,$2,'draft',1,1,$3,$3)`,[identityId,worker.accountId,NOW]);
  await database.query(`INSERT INTO worker_identity_versions
    (identity_version_id,identity_id,version_number,parent_version_id,version_kind,version_status,created_by_account_id,created_at,submitted_at)
    VALUES ($1,$2,1,NULL,'initial','submitted',$3,$4,$4)`,[versionId,identityId,worker.accountId,NOW]);
  for (const [status,lock] of [["submitted",2],["automated_checks",3],["manual_review",4],["verified",5]])
    await database.query(`UPDATE worker_identities SET lifecycle_status=$2,lock_version=$3 WHERE identity_id=$1`,[identityId,status,lock]);
  await database.query(`INSERT INTO worker_identity_duplicate_checks
    (check_id,identity_id,identity_version_id,worker_account_id,check_sequence,check_status,created_at)
    VALUES ($1,$2,$3,$4,1,'clear',$5)`,[checkId,identityId,versionId,worker.accountId,NOW]);
  await database.query(`INSERT INTO worker_identity_worker_ids
    (permanent_worker_id,identity_id,identity_version_id,worker_account_id,issued_by_component,issued_at)
    VALUES ($1,$2,$3,$4,'identity-assurance',$5)`,[permanentWorkerId,identityId,versionId,worker.accountId,NOW]);
  return permanentWorkerId;
}

