# AurisLink Test Suite

Automated tests for AurisLink with coverage for cache, retry, and providers.

## 📋 Structure

```
tests/
├── cache.test.ts       # Tests for intelligent cache system
├── retry.test.ts       # Tests for retry with exponential backoff
├── providers.test.ts   # Tests for providers (YouTube, etc)
└── README.md           # This file
```

## 🚀 Running Tests

### Run all tests
```bash
npm test
```

### Watch mode (rerun on save)
```bash
npm run test:watch
```

### With code coverage
```bash
npm run test:coverage
```

### Run specific test
```bash
npm test -- cache.test.ts
npm test -- retry.test.ts
npm test -- providers.test.ts
```

## 📊 Test Coverage

### Cache Tests (15+ tests)
- ✅ Basic operations (set, get, delete, clear)
- ✅ TTL expiration
- ✅ LRU eviction (Least Recently Used)
- ✅ Statistics (hits, misses, hit rate)
- ✅ Automatic cleanup

**File:** `cache.test.ts`

```typescript
// Usage example
const cache = new IntelligentCache(3600, 100) // 1 hour, max 100 entries
cache.set('key1', 'value1')
const value = cache.get('key1')
const stats = cache.getStats()
```

### Retry Tests (20+ tests)
- ✅ Successful execution
- ✅ Automatic retry
- ✅ Exponential backoff (100ms → 200ms → 400ms)
- ✅ Retryable error detection
- ✅ Custom retry logic

**File:** `retry.test.ts`

```typescript
// Usage example
const result = await RetryManager.execute(
  () => fetchFromYouTube(),
  {
    maxAttempts: 3,
    initialDelayMs: 100,
    backoffMultiplier: 2,
    shouldRetry: (error) => error.status >= 500
  }
)

if (result.success) {
  console.log(`Success after ${result.attempts} attempts`)
} else {
  console.error(`Failed: ${result.error}`)
}
```

### Provider Tests (10+ tests)
- ✅ Provider initialization
- ✅ URL validation
- ✅ Setup and configuration
- ✅ Cookie generation

**File:** `providers.test.ts`

```typescript
// Usage example
const config = createMockConfig()
const youtube = new YoutubeSource(config)
await youtube.setup()
```

## 📈 Current Results

```
Test Suites: 3 total
Tests:       47 total
  ✅ Passed: 44 (93.6%)
  ❌ Failed: 3 (timing edge cases)

Coverage:
  Lines:       ~70%
  Functions:   ~65%
  Branches:    ~60%
```

## 🔧 Jest Configuration

**File:** `jest.config.js`

- Preset: `ts-jest/presets/default-esm`
- Environment: `node`
- Timeout: 10 seconds
- Module mapper: Supports `.js` imports

## 📝 Writing New Tests

### Basic template
```typescript
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'

describe('MyFeature', () => {
  let instance: MyClass

  beforeEach(() => {
    instance = new MyClass()
  })

  afterEach(() => {
    instance.cleanup()
  })

  it('should do something', () => {
    const result = instance.doSomething()
    expect(result).toBe(expectedValue)
  })
})
```

### Best practices
1. Use `describe` to group related tests
2. Use `beforeEach` for common setup
3. Use `afterEach` for cleanup
4. Write independent tests (don't depend on each other)
5. Use descriptive names: `should...`, `should not...`
6. Test both success AND failure cases

## 🐛 Troubleshooting

### Error: "Cannot find module"
Make sure build was run:
```bash
npm run build
npm test
```

### Slow tests
Increase timeout in `jest.config.js`:
```javascript
testTimeout: 20000 // 20 seconds
```

### TypeScript error
Check if `ts-jest` is installed:
```bash
npm install --save-dev ts-jest @types/jest
```

## 🚀 Next Steps

- [ ] Add integration tests with real server
- [ ] Increase coverage to 80%+
- [ ] Add load tests
- [ ] Integrate with CI/CD pipeline
- [ ] Generate HTML coverage report

## 📚 References

- [Jest Documentation](https://jestjs.io/)
- [ts-jest Documentation](https://kulshekhar.github.io/ts-jest/)
- [Testing Best Practices](https://jestjs.io/docs/getting-started)
