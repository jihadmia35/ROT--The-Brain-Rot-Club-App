export const SECURE_STORE_MAX_CHUNK_BYTES = 1800;

export type SecureStoreBackend = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
};

export type AuthStorageAdapter = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export function sanitizeSecureStoreKey(key: string): string {
  const cleaned = key.replace(/[^A-Za-z0-9._-]/g, '_');
  return cleaned.length > 0 ? cleaned : 'rot_key';
}

function utf8ByteLengthOfCodePoint(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

/**
 * Splits a string into chunks guaranteed not to exceed `maxBytes` when UTF-8 encoded,
 * without splitting UTF-16 surrogate pairs.
 */
export function splitIntoUtf8Chunks(
  value: string,
  maxBytes: number = SECURE_STORE_MAX_CHUNK_BYTES
): string[] {
  if (value.length === 0) {
    return [''];
  }
  const safeMax = Math.max(64, maxBytes);
  const chunks: string[] = [];
  let currentStart = 0;
  let currentBytes = 0;
  let i = 0;

  while (i < value.length) {
    const codeUnit = value.charCodeAt(i);
    const isHighSurrogate =
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      i + 1 < value.length &&
      value.charCodeAt(i + 1) >= 0xdc00 &&
      value.charCodeAt(i + 1) <= 0xdfff;

    const charStep = isHighSurrogate ? 2 : 1;
    const codePoint = isHighSurrogate
      ? ((codeUnit - 0xd800) << 10) + (value.charCodeAt(i + 1) - 0xdc00) + 0x10000
      : codeUnit;
    const charBytes = utf8ByteLengthOfCodePoint(codePoint);

    if (currentBytes + charBytes > safeMax && i > currentStart) {
      chunks.push(value.slice(currentStart, i));
      currentStart = i;
      currentBytes = 0;
    }

    currentBytes += charBytes;
    i += charStep;
  }

  if (currentStart < value.length) {
    chunks.push(value.slice(currentStart));
  }

  return chunks;
}

/**
 * Creates a Supabase-compatible async storage adapter backed by SecureStore
 * with transparent UTF-8-safe chunking so large JWT sessions (>2048 bytes)
 * never fail or truncate on Android Keystore.
 */
export function createChunkedSecureStorage(
  backend: SecureStoreBackend,
  maxChunkBytes: number = SECURE_STORE_MAX_CHUNK_BYTES
): AuthStorageAdapter {
  const chunkCountKey = (safeKey: string) => `${safeKey}.__chunks`;
  const chunkPartKey = (safeKey: string, index: number) => `${safeKey}.__chunk_${index}`;

  async function readExistingChunkCount(safeKey: string): Promise<number> {
    const rawCount = await backend.getItemAsync(chunkCountKey(safeKey));
    if (!rawCount) return 0;
    const parsed = Number.parseInt(rawCount, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  return {
    async getItem(key: string): Promise<string | null> {
      const safeKey = sanitizeSecureStoreKey(key);
      const count = await readExistingChunkCount(safeKey);
      if (count > 0) {
        const parts: string[] = [];
        for (let i = 0; i < count; i++) {
          const part = await backend.getItemAsync(chunkPartKey(safeKey, i));
          if (part === null) {
            return null;
          }
          parts.push(part);
        }
        return parts.join('');
      }
      return backend.getItemAsync(safeKey);
    },

    async setItem(key: string, value: string): Promise<void> {
      const safeKey = sanitizeSecureStoreKey(key);
      const previousCount = await readExistingChunkCount(safeKey);
      const chunks = splitIntoUtf8Chunks(value, maxChunkBytes);

      if (chunks.length <= 1) {
        await backend.setItemAsync(safeKey, chunks[0] ?? '');
        if (previousCount > 0) {
          await backend.deleteItemAsync(chunkCountKey(safeKey));
          for (let i = 0; i < previousCount; i++) {
            await backend.deleteItemAsync(chunkPartKey(safeKey, i));
          }
        }
        return;
      }

      for (let i = 0; i < chunks.length; i++) {
        await backend.setItemAsync(chunkPartKey(safeKey, i), chunks[i]);
      }
      await backend.setItemAsync(chunkCountKey(safeKey), String(chunks.length));
      await backend.deleteItemAsync(safeKey);

      for (let i = chunks.length; i < previousCount; i++) {
        await backend.deleteItemAsync(chunkPartKey(safeKey, i));
      }
    },

    async removeItem(key: string): Promise<void> {
      const safeKey = sanitizeSecureStoreKey(key);
      const previousCount = await readExistingChunkCount(safeKey);
      await backend.deleteItemAsync(safeKey);
      await backend.deleteItemAsync(chunkCountKey(safeKey));
      for (let i = 0; i < previousCount; i++) {
        await backend.deleteItemAsync(chunkPartKey(safeKey, i));
      }
    },
  };
}
