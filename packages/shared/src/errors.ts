export const ERROR_CODES = {
  INVALID_PARAMS: 400,
  UNSUPPORTED_CHAIN: 400,
  UNSUPPORTED_TOKEN: 400,
  AMOUNT_TOO_SMALL: 400,
  AMOUNT_TOO_LARGE: 400,
  CALLS_REVERTED: 400,
  NO_ROUTE: 404,
  QUOTE_NOT_FOUND: 404,
  QUOTE_EXPIRED: 410,
  ORDER_NOT_FOUND: 404,
  PROVIDER_ERROR: 502,
  PROVIDER_TIMEOUT: 504,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 429,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class LayerHopError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
    /** Send `details` to the client (`error.details`). Off by default: details often hold raw provider bodies. */
    public readonly exposeDetails = false,
  ) {
    super(message);
    this.name = "LayerHopError";
  }
  get status(): number {
    return ERROR_CODES[this.code];
  }
  toJSON(requestId?: string) {
    return {
      error: {
        code: this.code, message: this.message, requestId, docsUrl: `https://docs.layerhop.com/errors/${this.code}`,
        ...(this.exposeDetails && this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}
