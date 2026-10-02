/** Runs `check` up to `attempts` times, `delayMs` apart; resolves true as soon as it passes. */
export async function pollUntil(
  check: () => boolean,
  attempts: number,
  delayMs: number,
): Promise<boolean> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (check()) return true;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}
