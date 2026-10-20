/**
 * A structured error with a stable machine-readable code.
 * CLI and MCP surfaces use this to return clean errors to agents.
 */
export class VigoError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "VigoError";
    this.code = code;
    this.details = details;
  }
}

export function asVigoError(error: unknown, code = "E_INTERNAL"): VigoError {
  if (error instanceof VigoError) return error;
  if (error instanceof Error) return new VigoError(code, error.message);
  return new VigoError(code, String(error));
}
