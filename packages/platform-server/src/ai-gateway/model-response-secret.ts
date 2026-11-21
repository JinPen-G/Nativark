/** Reject a credential and its known deterministic encodings before delivery.
 * Not a general sensitive-data classifier: protocol/input bounds and current
 * authorization remain with callers. No secret or derived form is persisted. */
export class ModelResponseSecretGuard {
  private readonly patterns: Array<{ value: string; fallback: Uint32Array }>;

  constructor(credential: string) {
    const bytes = Buffer.from(credential, 'utf8');
    const values = credential ? [...new Set([credential, bytes.toString('base64'),
      bytes.toString('base64').replace(/=+$/u, ''), bytes.toString('base64url'),
      bytes.toString('hex'), bytes.toString('hex').toUpperCase(), encodeURIComponent(credential),
      JSON.stringify(credential).slice(1, -1)])] : [];
    // Build each failure table once per invocation/stream. Linear suffix scans
    // avoid quadratic slice/endsWith loops for the maximum-length credentials.
    this.patterns = values.map(value => {
      const fallback = new Uint32Array(value.length);
      for (let index = 1, matched = 0; index < value.length; index++) {
        while (matched && value[index] !== value[matched]) matched = fallback[matched - 1];
        if (value[index] === value[matched]) matched++;
        fallback[index] = matched;
      }
      return { value, fallback };
    });
  }

  private containsText(value: string) { return this.patterns.some(pattern => value.includes(pattern.value)); }

  contains(value: unknown): boolean {
    if (!this.patterns.length) return false;
    const seen = new Set<object>();
    const visit = (item: unknown): boolean => {
      if (typeof item === 'string') return this.containsText(item);
      if (!item || typeof item !== 'object' || seen.has(item)) return false;
      seen.add(item);
      return Object.entries(item).some(([key, child]) => this.containsText(key) || visit(child));
    };
    if (visit(value)) return true;
    // Keep the original cross-field serialized check after decoded keys/values.
    const serialized = JSON.stringify(value);
    return typeof serialized === 'string' && this.containsText(serialized);
  }

  /** Null rejects a complete echo. Otherwise release only text before every
   * possible raw/encoded prefix; a terminal caller may flush a safe partial tail. */
  releaseLength(text: string): number | null {
    if (this.containsText(text)) return null;
    let held = 0;
    for (const { value, fallback } of this.patterns) {
      let matched = 0;
      // A proper prefix is shorter than the pattern. Only this bounded tail
      // can affect withholding, irrespective of already delivered text length.
      for (let index = Math.max(0, text.length - value.length + 1); index < text.length; index++) {
        while (matched && text[index] !== value[matched]) matched = fallback[matched - 1];
        if (text[index] === value[matched]) matched++;
      }
      held = Math.max(held, matched);
    }
    return text.length - held;
  }
}

export function modelResponseContainsSecret(value: unknown, credential: string): boolean {
  return new ModelResponseSecretGuard(credential).contains(value);
}
