import type { TrustedAuditActor } from "../audit/audit-domain";
import {
  RequiredOutboxMissingError,
  type EnqueueOutboxJobInput,
  type OutboxJobRecord,
  type OutboxJobType
} from "./outbox-domain";

export interface OutboxTransactionExecutor<Transaction> {
  transaction<Result>(
    operation: (transaction: Transaction) => Promise<Result>
  ): Promise<Result>;
}

export async function runRequiredOutboxTransactionCore<
  Result,
  Transaction
>(input: {
  executor: OutboxTransactionExecutor<Transaction>;
  actor: TrustedAuditActor;
  enqueue<T extends OutboxJobType>(
    transaction: Transaction,
    actor: TrustedAuditActor,
    job: EnqueueOutboxJobInput<T>
  ): Promise<OutboxJobRecord>;
  operation(context: {
    transaction: Transaction;
    enqueueRequired<T extends OutboxJobType>(
      job: EnqueueOutboxJobInput<T>
    ): Promise<OutboxJobRecord>;
  }): Promise<Result>;
}): Promise<Result> {
  return input.executor.transaction(async (transaction) => {
    let requiredEnqueueCalls = 0;
    const result = await input.operation({
      transaction,
      enqueueRequired: async <T extends OutboxJobType>(
        job: EnqueueOutboxJobInput<T>
      ) => {
        const persisted = await input.enqueue(
          transaction,
          input.actor,
          job
        );
        requiredEnqueueCalls += 1;
        return persisted;
      }
    });
    if (requiredEnqueueCalls < 1) {
      throw new RequiredOutboxMissingError();
    }
    return result;
  });
}
