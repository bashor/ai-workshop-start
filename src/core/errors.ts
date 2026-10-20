/** A failure explained to the user: the CLI prints the message and exits with code 1. */
export class AtlasError extends Error {}

/** GitHub's rate limit: whatever is asked next fails the same way. */
export class RateLimitError extends AtlasError {}
