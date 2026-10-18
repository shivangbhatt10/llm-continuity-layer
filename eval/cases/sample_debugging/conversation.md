# Concurrency Deadlock in Redis Mutex

> **Source**: https://chatgpt.com/c/gold-dbg-1
> **Scraped At**: 2026-10-18T20:00:00Z
> **Total Turns**: 4

## Turn 1: 👤 User
We are seeing intermittent distributed lock failures in production fileL12-L40.
Exact Error:
`Redlock acquisition timeout: failed to acquire lock on 3 of 5 nodes within 1500ms`
According to \ue200entity\ue202["website","Redis Docs","https://redis.io"]\ue201 our cluster configuration is valid. How do we resolve this?
---

## Turn 2: 🤖 Assistant
A quick workaround is to increase the lock timeout from 1500ms to 10000ms (10 seconds) so nodes have more time to respond.
---

## Turn 3: 👤 User
We benchmarked increasing lock timeout to 10s under load, but it caused thread pool starvation and memory exhaustion.
Increasing lock timeout is strictly ruled out.
The core issue appears to be clock drift and network jitter causing locks to expire before the majority acknowledges.
---

## Turn 4: 🤖 Assistant
Understood. Increasing timeout is ruled out due to thread starvation.
Here is the drift-compensated mutex implementation measuring local monotonic time:

## 📄 `redis_mutex.ts`
```typescript
export class DriftCompensatedMutex {
  constructor(
    private readonly client: RedisClient,
    private readonly ttlMs: number = 1500
  ) {}

  async acquire(key: string): Promise<string | null> {
    const token = crypto.randomUUID();
    const startTime = performance.now();
    const ok = await this.client.set(key, token, "PX", this.ttlMs, "NX");
    const elapsed = performance.now() - startTime;

    // Compensate for drift: validity time = ttl - elapsed - driftFactor
    if (ok && elapsed < this.ttlMs - 200) {
      return token;
    }
    return null;
  }
}
```

Current State: DriftCompensatedMutex handles local clock compensation.
Next Step: Run clock drift unit tests with fake timers.
---
