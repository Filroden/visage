/**
 * Generates a cryptographically secure random ID string.
 * Uses the Web Crypto API for secure random number generation.
 * @returns {string} A 16-character random string containing alphanumeric characters
 * @throws {Error} If the crypto API is not available or fails
 */
export function newFoundryID() {
  // Check if crypto is available
  if (typeof crypto === 'undefined') {
    throw new Error('Crypto API is not available in this environment');
  }

  const CODEX = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const ID_LENGTH = 16;

  // Create a Uint8Array for storing random values
  const randomValues = new Uint8Array(ID_LENGTH);

  // Get cryptographically secure random values
  crypto.getRandomValues(randomValues);

  // Convert random bytes to characters from CODEX
  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    // Use modulo to map the random byte to a valid index in CODEX
    const index = randomValues[i] % CODEX.length;
    id += CODEX[index];
  }

  return id;
}

// if (import.meta.url === `file://${process.argv[1]}`) {
  console.info(`NEW Foundry ID: ${newFoundryID()}`);
// }
