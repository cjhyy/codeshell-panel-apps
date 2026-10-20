/**
 * DSL file codec — local decryption with server-fetched keys.
 *
 * Flow:
 *   1. Plugin startup → GET /api/dsl/key → all versioned AES keys
 *   2. User drops .dsl → read version byte → pick matching key → decrypt locally
 *   3. File never leaves the client
 *
 * Key rotation: server adds new version, old .dsl files still
 * decrypt because we cache ALL versions.
 */

const MAGIC = 'H2F\x01\x00';
const IV_LENGTH = 12;

// version → CryptoKey
let keyCache: Map<number, CryptoKey> = new Map();
let lastServerUrl: string | null = null;

/** Fetch all versioned keys from server (cached until server URL changes) */
export async function fetchKeys(serverUrl: string): Promise<void> {
  if (keyCache.size > 0 && lastServerUrl === serverUrl) return;

  const res = await fetch(`${serverUrl}/api/dsl/key`);
  if (!res.ok) throw new Error('Failed to fetch decryption keys');

  const { keys } = await res.json() as { keys: Array<{ version: number; key: string }> };

  keyCache = new Map();
  for (const { version, key } of keys) {
    const raw = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey(
      'raw', raw, { name: 'AES-GCM' }, false, ['decrypt'],
    );
    keyCache.set(version, cryptoKey);
  }
  lastServerUrl = serverUrl;
}

/** Clear cache (call when server URL changes) */
export function clearKeyCache() {
  keyCache = new Map();
  lastServerUrl = null;
}

/** Decrypt a .dsl file locally */
export async function decodeDSL(serverUrl: string, dslContent: string): Promise<unknown> {
  await fetchKeys(serverUrl);

  // Parse header
  if (!dslContent.startsWith(MAGIC)) {
    throw new Error('Invalid DSL file: missing header');
  }
  const version = dslContent.charCodeAt(MAGIC.length);
  const b64 = dslContent.slice(MAGIC.length + 1);

  // Find key for this version
  let key = keyCache.get(version);
  if (!key) {
    // Maybe keys were rotated — refetch once
    clearKeyCache();
    await fetchKeys(serverUrl);
    key = keyCache.get(version);
  }
  if (!key) {
    throw new Error(`Unsupported DSL version: ${version}. The file may require a newer server.`);
  }

  // Decode base64
  let combined: Uint8Array;
  try {
    const binary = atob(b64);
    combined = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) combined[i] = binary.charCodeAt(i);
  } catch {
    throw new Error('Invalid DSL file: corrupted payload');
  }

  if (combined.length < IV_LENGTH + 1) {
    throw new Error('Invalid DSL file: payload too short');
  }

  // AES-GCM: Web Crypto expects iv + (ciphertext || authTag)
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertextWithTag = combined.slice(IV_LENGTH);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertextWithTag,
    );
  } catch {
    throw new Error('Invalid DSL file: decryption failed');
  }

  return JSON.parse(new TextDecoder().decode(plaintext));
}
