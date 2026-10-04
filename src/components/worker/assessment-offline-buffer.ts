"use client";

// Only ciphertext and a non-extractable browser key are persisted. Server revisions
// remain authoritative; this buffer never commits an answer or changes an attempt.
export type PendingAssessmentEdit = Readonly<{
  value: string;
  revision: number | null;
  expiresAt: number;
}>;

let tabIdPromise: Promise<string> | null = null;

export async function pendingAssessmentTabReference(reference: string): Promise<string> {
  tabIdPromise ??= new Promise<string>((resolve, reject) => {
    if (!navigator.locks) {
      reject(new Error("This browser cannot safely isolate offline assessment edits."));
      return;
    }
    const storageKey = "hse-assessment-buffer-tab";
    const acquire = (id: string, retries = 2): void => {
      void navigator.locks.request(`hse-assessment-tab:${id}`, { ifAvailable: true }, lock => {
        if (!lock) {
          if (retries === 0) throw new Error("Offline tab isolation failed.");
          acquire(crypto.randomUUID(), retries - 1);
          return;
        }
        sessionStorage.setItem(storageKey, id);
        resolve(id);
        // The browser releases this lock when the document ends. A reload keeps
        // its stored ID; a duplicated tab must select a different, unlocked ID.
        return new Promise<void>(() => undefined);
      }).catch(reject);
    };
    acquire(sessionStorage.getItem(storageKey) ?? crypto.randomUUID());
  }).catch(error => { tabIdPromise = null; throw error; });
  return `${reference}:${await tabIdPromise}`;
}

const DATABASE = "hse-assessment-pending";
const STORE = "pending";
const KEY = "encryption-key";

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
  });
}

async function open(): Promise<IDBDatabase> {
  const operation = indexedDB.open(DATABASE, 1);
  operation.onupgradeneeded = () => operation.result.createObjectStore(STORE);
  return request(operation);
}

async function transact<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const database = await open();
  try {
    const transaction = database.transaction(STORE, mode);
    const completed = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    const [result] = await Promise.all([request(operation(transaction.objectStore(STORE))), completed]);
    return result;
  } finally {
    database.close();
  }
}

let keyPromise: Promise<CryptoKey> | null = null;
function encryptionKey(): Promise<CryptoKey> {
  return keyPromise ??= (async () => {
    const existing = await transact("readonly", store => store.get(KEY));
    if (existing) return existing as CryptoKey;
    const generated = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    // add, rather than put, preserves the key another tab may have created.
    try {
      await transact("readwrite", store => store.add(generated, KEY));
      return generated;
    } catch {
      const shared = await transact("readonly", store => store.get(KEY));
      if (!shared) throw new Error("Offline encryption key unavailable.");
      return shared as CryptoKey;
    }
  })().catch(error => { keyPromise = null; throw error; });
}

export async function savePendingAssessmentEdit(
  reference: string, value: string, revision: number | null
): Promise<void> {
  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(reference) },
    key, new TextEncoder().encode(JSON.stringify({ value, revision, expiresAt }))
  );
  await transact("readwrite", store => store.put({ iv, ciphertext, expiresAt }, reference));
}

export async function clearPendingAssessmentEdit(reference: string): Promise<void> {
  await transact("readwrite", store => store.delete(reference));
}

export async function loadPendingAssessmentEdit(reference: string): Promise<PendingAssessmentEdit | null> {
  const record = await transact("readonly", store => store.get(reference));
  if (!record) return null;
  try {
    if (record.expiresAt <= Date.now()) throw new Error("Expired.");
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: record.iv, additionalData: new TextEncoder().encode(reference) },
      await encryptionKey(), record.ciphertext
    );
    const edit = JSON.parse(new TextDecoder().decode(plaintext));
    if (typeof edit.value !== "string" || edit.value.length > 100_000 ||
        !(edit.revision === null || Number.isSafeInteger(edit.revision)) ||
        edit.expiresAt !== record.expiresAt) throw new Error("Invalid.");
    return edit;
  } catch {
    await clearPendingAssessmentEdit(reference);
    return null;
  }
}
