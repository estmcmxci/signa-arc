// Approver keys for the Privy 2-of-2 quorum: plain WebCrypto P-256 keys, imported and
// stored non-extractable in this origin's IndexedDB. These are NOT passkeys — no
// WebAuthn ceremony, no platform authenticator, no attestation. A page script can ask
// the stored key to sign, but can never read the private key material back out, and
// nothing here ever transmits it. Mirrors packages/privy-waiver/ui/approver.html's
// keyStore/importKeyFor, the reference implementation for this browser-side handling.

const ALG: EcKeyImportParams & EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };
const DB_NAME = 'signa-approver-keys';
const STORE = 'keys';

export type ApproverKey = { publicKey: string; privateKey: CryptoKey };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
  });
}

const toBase64 = (buffer: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(buffer)));
const fromBase64 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text.trim()), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;

export async function loadApproverKey(role: string): Promise<ApproverKey | undefined> {
  return withStore('readonly', (store) => store.get(role));
}

export async function forgetApproverKey(role: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(role));
}

/**
 * Imports a base64 PKCS8 private key for one approver role. The public key is derived
 * through a short-lived extractable copy that never leaves this function; only the
 * non-extractable signing key is written to IndexedDB.
 */
export async function importApproverKey(role: string, encodedPkcs8: string): Promise<ApproverKey> {
  const pkcs8 = fromBase64(encodedPkcs8.replace(/^wallet-auth:/, ''));
  const readable = await crypto.subtle.importKey('pkcs8', pkcs8, ALG, true, ['sign']);
  const { d: _d, key_ops: _keyOps, ...publicJwk } = await crypto.subtle.exportKey('jwk', readable);
  const verifyKey = await crypto.subtle.importKey('jwk', { ...publicJwk, key_ops: ['verify'] }, ALG, true, ['verify']);
  const publicKey = toBase64(await crypto.subtle.exportKey('spki', verifyKey));
  const privateKey = await crypto.subtle.importKey('pkcs8', pkcs8, ALG, false, ['sign']);
  const key: ApproverKey = { publicKey, privateKey };
  await withStore('readwrite', (store) => store.put(key, role));
  return key;
}

/** ECDSA over SHA-256, returned as base64 P1363 — what POST /api/actions/{id}/approve expects with encoding:"p1363". */
export async function signWithApproverKey(key: ApproverKey, text: string): Promise<string> {
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.privateKey, new TextEncoder().encode(text));
  return toBase64(signature);
}
