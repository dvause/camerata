// Structured engine errors: every refusal names the rule it enforced.
// Surfaces as {code, message} — never a stack trace.
export class EngineError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function fail(code: string, message: string): never {
  throw new EngineError(code, message);
}
