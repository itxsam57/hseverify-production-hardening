import "server-only";

import { SecureFileAccessContractError } from "./secure-file-access-domain";

const DECIMAL_CONTENT_LENGTH = /^[0-9]+$/;

function parseDeclaredLength(value: string | null, maxBytes: number): void {
  if (value === null) return;
  if (!DECIMAL_CONTENT_LENGTH.test(value)) {
    throw new SecureFileAccessContractError("The request body is invalid.");
  }
  const declared = BigInt(value);
  if (declared > BigInt(maxBytes)) {
    throw new SecureFileAccessContractError("The request body is too large.");
  }
}

async function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The request is already being denied. A transport cancellation failure must
    // not convert a bounded bad request into a server-side authorization error.
  }
}

export async function readBoundedSecureFileAccessJson(
  request: Request,
  maxBytes: number
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new SecureFileAccessContractError("The request body limit is invalid.");
  }

  parseDeclaredLength(request.headers.get("content-length"), maxBytes);
  if (request.body === null) {
    throw new SecureFileAccessContractError("The request body is invalid.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await cancelReader(reader);
        throw new SecureFileAccessContractError("The request body is too large.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof SecureFileAccessContractError) throw error;
    throw new SecureFileAccessContractError("The request body could not be read.");
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SecureFileAccessContractError("The request body is invalid.");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SecureFileAccessContractError("The request body is invalid.");
  }
}
