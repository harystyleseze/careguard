# Agent Testing Guide

## Dependency Injection Pattern

### MPP Client Factory

The MPP client uses a factory pattern to support dependency injection in tests. This prevents shared state contamination when tests run in parallel.

#### Problem

Previously, the MPP client was a module-scoped singleton:

```typescript
// ❌ Old approach - shared state across tests
const mppClient = Mppx.create({ ... });
let lastMppTxHash: string | undefined; // Global state!
```

This caused issues:
- Tests running in parallel shared the same client instance
- `lastMppTxHash` leaked between tests
- One test's success could contaminate another's assertions

#### Solution

Use a factory function to create isolated client instances:

```typescript
// ✅ New approach - isolated instances
import { createMppClient, setMppClient } from './mpp-client.ts';

// In production code
let mppClient = createMppClient({ keypair: agentKeypair });

// In tests
const testClient = createMppClient({ keypair: testKeypair });
setMppClient(testClient);
```

#### Benefits

1. **Isolated State**: Each test gets its own client with independent `lastTxHash`
2. **Parallel Execution**: Tests can run with `vitest --pool=threads` safely
3. **Deterministic**: No cross-test contamination
4. **Testable**: Easy to mock and verify behavior

#### Usage in Tests

```typescript
import { describe, it, beforeEach } from 'vitest';
import { createMppClient, setMppClient } from '../mpp-client.ts';
import { Keypair } from '@stellar/stellar-sdk';

describe('Payment tests', () => {
  beforeEach(() => {
    // Create a fresh client for each test
    const testKeypair = Keypair.random();
    const testClient = createMppClient({ keypair: testKeypair });
    setMppClient(testClient);
  });

  it('processes payment without contamination', async () => {
    // This test has its own isolated MPP client
    // ...
  });
});
```

#### Running Tests in Parallel

```bash
# Verify tests are deterministic with parallel execution
vitest --pool=threads

# Run with coverage
vitest --coverage
```

## Best Practices

### 1. Always Reset State Between Tests

```typescript
beforeEach(() => {
  // Reset any shared state
  const freshClient = createMppClient({ keypair: testKeypair });
  setMppClient(freshClient);
});
```

### 2. Use Factory Functions for Stateful Dependencies

Any dependency that maintains state should use a factory pattern:
- MPP clients
- Database connections
- Cache instances
- HTTP clients with state

### 3. Avoid Module-Scoped Singletons

```typescript
// ❌ Bad - module-scoped singleton
const client = new Client();
export { client };

// ✅ Good - factory function
export function createClient(options) {
  return new Client(options);
}
```

### 4. Document DI Points

Mark functions that accept injected dependencies:

```typescript
/**
 * Set a custom MPP client instance (for testing/DI).
 * @param client - MPP client instance to use
 */
export function setMppClient(client: MppClientInstance) {
  mppClient = client;
}
```

## Related Issues

- #171: Module-scoped MPP client + lastMppTxHash leak across tests
- See `agent/mpp-client.ts` for implementation
- See `agent/__tests__/mpp-client.test.ts` for examples
