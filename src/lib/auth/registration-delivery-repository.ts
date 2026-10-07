import "server-only";

import { DatabaseOutboxRepository } from "../outbox/outbox-repository";
import type { DatabaseClient } from "../database/database";

export type RegistrationDeliveryIntent = Readonly<{
  deliveryId: string; challengeId: string; encryptedPayload: string; createdAt: string;
}>;

export async function enqueueRegistrationDelivery(
  database: DatabaseClient, input: RegistrationDeliveryIntent
): Promise<void> {
  await insertDeliveryIntent(database,input);
  await new DatabaseOutboxRepository(Promise.resolve(database)).enqueueRegistrationDelivery(database,input.deliveryId);
}

export type RegistrationDeliveryStatus = "queued" | "dispatching" | "accepted" | "terminal" | "unknown" | "obsolete";

export async function readRegistrationDeliveryStatus(
  database: DatabaseClient, challengeId: string
): Promise<RegistrationDeliveryStatus | null> {
  const result = await database.query<{status: RegistrationDeliveryStatus}>(
    "SELECT status FROM auth_registration_delivery_intents WHERE challenge_id=$1", [challengeId]
  );
  return result.rows[0]?.status ?? null;
}

async function insertDeliveryIntent(database: DatabaseClient, input: RegistrationDeliveryIntent): Promise<void> {
  await database.query(
    `INSERT INTO auth_registration_delivery_intents
      (delivery_id,challenge_id,status,payload_ciphertext,created_at,updated_at)
     VALUES($1,$2,'queued',$3,$4,$4)`,
    [input.deliveryId,input.challengeId,input.encryptedPayload,input.createdAt]
  );
}

export async function enqueueRecoveryDelivery(database: DatabaseClient, input: RegistrationDeliveryIntent): Promise<void> {
  await insertDeliveryIntent(database,input);
  await new DatabaseOutboxRepository(Promise.resolve(database)).enqueueRecoveryDelivery(database,input.deliveryId);
}
