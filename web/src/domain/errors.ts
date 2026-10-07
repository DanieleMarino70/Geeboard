/* Platform errors.

   Every failure that crosses a boundary — API response, server action,
   runtime call — carries a stable machine code alongside a sentence a
   person can act on. The code is what a client switches on; the message
   is what an operator reads; `details` says which step failed without
   handing out a stack trace or a hostname.

   Anything technical enough to be useful only in a log stays in `cause`,
   which is never serialised. */

export type ErrorCode =
  // Access
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INSUFFICIENT_SCOPE"
  // Shape of the request
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  // The game catalog
  | "GAME_NOT_FOUND"
  | "GAME_VERSION_NOT_FOUND"
  | "GAME_VERSION_UNSUPPORTED"
  | "VERSION_PROVIDER_FAILED"
  // Placement and capacity
  | "NODE_NOT_FOUND"
  | "NODE_UNAVAILABLE"
  | "NODE_INCOMPATIBLE"
  | "CAPACITY_EXHAUSTED"
  | "NO_PORTS_AVAILABLE"
  // The runtime on the far side of a node agent
  | "RUNTIME_UNREACHABLE"
  | "RUNTIME_REJECTED"
  | "RUNTIME_NOT_ATTACHED"
  | "SERVER_INSTALLATION_FAILED"
  | "SERVER_STATE_INVALID"
  // Mods, and the workshop they are chosen from
  | "MOD_PROVIDER_FAILED"
  | "MOD_SEARCH_UNAVAILABLE"
  | "MOD_KEY_REFUSED"
  // The DNS provider a server's record is kept with
  | "DNS_PROVIDER_FAILED"
  | "DNS_TOKEN_REFUSED"
  | "DNS_RECORD_CONFLICT"
  // What the panel stored, and cannot open with the key it has been given
  | "SECRETS_UNREADABLE"
  // Anything we did not anticipate
  | "INTERNAL";

/** What the client is told. Never contains anything sensitive. */
export interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  INSUFFICIENT_SCOPE: 403,
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  GAME_NOT_FOUND: 404,
  GAME_VERSION_NOT_FOUND: 404,
  GAME_VERSION_UNSUPPORTED: 422,
  VERSION_PROVIDER_FAILED: 502,
  NODE_NOT_FOUND: 404,
  NODE_UNAVAILABLE: 409,
  NODE_INCOMPATIBLE: 422,
  CAPACITY_EXHAUSTED: 409,
  NO_PORTS_AVAILABLE: 409,
  RUNTIME_UNREACHABLE: 502,
  RUNTIME_REJECTED: 422,
  RUNTIME_NOT_ATTACHED: 409,
  SERVER_INSTALLATION_FAILED: 500,
  SERVER_STATE_INVALID: 409,
  MOD_PROVIDER_FAILED: 502,
  /* Not a fault: this installation has no Steam key, so it can add a mod
     by its link and cannot browse for one. */
  MOD_SEARCH_UNAVAILABLE: 409,
  /* Steam turned the key down: revoked, mistyped, or never a key. The
     request was fine; what the panel sent upstream was not. */
  MOD_KEY_REFUSED: 502,
  /* The provider did not answer, or answered with something other than
     a refusal of the token; the token it turned down; and a record at
     the name that is not the panel's to change. */
  DNS_PROVIDER_FAILED: 502,
  DNS_TOKEN_REFUSED: 502,
  DNS_RECORD_CONFLICT: 409,
  SECRETS_UNREADABLE: 500,
  INTERNAL: 500,
};

export class PlatformError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "PlatformError";
    this.code = code;
    this.details = options.details;
  }

  /** The HTTP status this failure deserves. */
  get status(): number {
    return STATUS[this.code];
  }

  /** The serialisable half — this is what a client ever sees. */
  toBody(): ErrorBody {
    return this.details
      ? { code: this.code, message: this.message, details: this.details }
      : { code: this.code, message: this.message };
  }
}

/* The key a stored secret was sealed with is not the one the panel has now. Said in the words of the cause and not OpenSSL's ("Unsupported
   state or unable to authenticate data"), which is all there was: an edited `.env`, a restored dump beside another key, or a `rekey` finished
   without the new value swapped in. */
export const SECRETS_KEY_SENTENCE = "SECRETS_KEY is not the key these secrets were sealed with";

export class SecretsKeyError extends Error {
  constructor(cause?: unknown) {
    super(SECRETS_KEY_SENTENCE, { cause });
    this.name = "SecretsKeyError";
  }
}

/* An unknown throw still has to answer as something. Deliberately
   generic: whatever the original message was, it was written for a log,
   not for whoever is holding the request. */
export function asPlatformError(error: unknown): PlatformError {
  if (error instanceof PlatformError) return error;
  if (error instanceof SecretsKeyError) {
    return new PlatformError(
      "SECRETS_UNREADABLE",
      `The panel cannot read what it stored: ${SECRETS_KEY_SENTENCE}. Put the previous value back in deploy/panel/.env and restart; if you were changing the key, finish with rekey (docs/security.md#changing-secrets_key).`,
      { cause: error },
    );
  }
  return new PlatformError("INTERNAL", "Something went wrong on our side.", { cause: error });
}
