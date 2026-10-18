import type { FailoverResult } from "./types.js";

/**
 * Checks if an error represents a rate limit, capacity exhaustion, or transient server failure.
 */
export function isFailoverCandidate(err: unknown): boolean {
  if (!err) return false;
  const errorObj = err as any;
  const status = errorObj.status || errorObj.statusCode || errorObj.code;
  if (status === 429 || status === 503 || status === 502 || status === 504) {
    return true;
  }
  const msg = String(errorObj.message || err).toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("quota") ||
    msg.includes("resource_exhausted") ||
    msg.includes("overloaded") ||
    msg.includes("capacity") ||
    msg.includes("too many requests")
  );
}

/**
 * Executes a prioritized chain of provider invocations.
 * If provider n throws a failover candidate error (or any error if multiple exist),
 * seamlessly cascades to provider n+1.
 */
export async function executeWithFailover<T>(
  providers: Array<() => Promise<T>>
): Promise<FailoverResult<T>> {
  if (providers.length === 0) {
    throw new Error("executeWithFailover: At least one provider function must be supplied.");
  }

  let lastError: unknown;
  for (let i = 0; i < providers.length; i++) {
    try {
      const result = await providers[i]();
      return {
        result,
        failoverOccurred: i > 0,
        attempts: i + 1,
      };
    } catch (err) {
      lastError = err;
      // If this is the last provider in the chain, we cannot fail over further
      if (i === providers.length - 1) {
        break;
      }
      // If we have alternative providers, log warning and cascade
      console.warn(`[Proxy Failover] Provider ${i + 1} failed: ${(err as any).message || err}. Cascading to fallback provider...`);
    }
  }

  throw lastError;
}
