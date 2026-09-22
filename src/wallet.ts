/**
 * Solana wallet address validation: base58 alphabet AND a real 32-byte decode.
 *
 * The alphabet/length regex alone accepts strings that are not valid Solana
 * public keys (e.g. 44 base58 chars can decode to 33 bytes). A Solana wallet
 * is exactly 32 bytes (an ed25519 public key), so decode and check the byte
 * length. No new dependency: the decoder below is a minimal base58
 * implementation (Bitcoin alphabet, which matches Solana's).
 */

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58 without 0, O, I, l: the Solana wallet alphabet, 32-44 chars. */
const BASE58_WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Decode a base58 string to bytes. Throws on invalid characters. */
export function base58Decode(s: string): Uint8Array {
  let num = 0n;
  for (const ch of s) {
    const digit = BASE58_ALPHABET.indexOf(ch);
    if (digit === -1) throw new Error(`invalid base58 character: ${ch}`);
    num = num * 58n + BigInt(digit);
  }
  // Leading "1"s are leading zero bytes.
  let leadingZeros = 0;
  for (const ch of s) {
    if (ch === "1") leadingZeros += 1;
    else break;
  }
  const tail: number[] = [];
  while (num > 0n) {
    tail.unshift(Number(num & 0xffn));
    num >>= 8n;
  }
  return new Uint8Array([...new Array<number>(leadingZeros).fill(0), ...tail]);
}

/**
 * True only for strings that are valid base58 AND decode to exactly 32
 * bytes (a real Solana ed25519 public key).
 */
export function isValidWallet(wallet: string): boolean {
  if (!BASE58_WALLET_RE.test(wallet)) return false;
  try {
    return base58Decode(wallet).length === 32;
  } catch {
    return false;
  }
}
