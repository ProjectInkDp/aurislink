import { describe, it, expect, beforeEach } from '@jest/globals'
import { RetryManager } from '../src/shared/retry.js'

describe('RetryManager', () => {
  describe('Successful Execution', () => {
    it('should execute function successfully on first attempt', async () => {
      const fn = async () => 'success'
      const result = await RetryManager.execute(fn)

      expect(result.success).toBe(true)
      expect(result.data).toBe('success')
      expect(result.attempts).toBe(1)
    })

    it('should return data from function', async () => {
      const fn = async () => ({ id: 1, name: 'test' })
      const result = await RetryManager.execute(fn)

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ id: 1, name: 'test' })
    })
  })

  describe('Retry Logic', () => {
    it('should retry on failure', async () => {
      let attempts = 0
      const fn = async () => {
        attempts++
        if (attempts < 2) throw new Error('Network error')
        return 'success'
      }

      const result = await RetryManager.execute(fn, {
        maxAttempts: 3,
        initialDelayMs: 10,
      })

      expect(result.success).toBe(true)
      expect(result.attempts).toBe(2)
    })

    it('should fail after max attempts', async () => {
      const fn = async () => {
        throw new Error('Persistent error')
      }

      const result = await RetryManager.execute(fn, {
        maxAttempts: 3,
        initialDelayMs: 10,
        shouldRetry: () => true,
      })

      expect(result.success).toBe(false)
      expect(result.attempts).toBe(3)
      expect(result.error?.message).toBe('Persistent error')
    })

    it('should not retry non-retryable errors', async () => {
      let attempts = 0
      const fn = async () => {
        attempts++
        throw new Error('Bad request')
      }

      const result = await RetryManager.execute(fn, {
        maxAttempts: 3,
        initialDelayMs: 10,
        shouldRetry: () => false,
      })

      expect(result.success).toBe(false)
      expect(result.attempts).toBe(1)
    })
  })

  describe('Exponential Backoff', () => {
    it('should calculate correct backoff delays', () => {
      const delay1 = RetryManager.getDelay(1, 100, 2, 5000)
      const delay2 = RetryManager.getDelay(2, 100, 2, 5000)
      const delay3 = RetryManager.getDelay(3, 100, 2, 5000)

      expect(delay1).toBe(100)
      expect(delay2).toBe(200)
      expect(delay3).toBe(400)
    })

    it('should respect max delay', () => {
      const delay = RetryManager.getDelay(10, 100, 2, 1000)
      expect(delay).toBeLessThanOrEqual(1000)
    })

    it('should apply backoff between retries', async () => {
      const startTime = Date.now()
      let attempts = 0

      const fn = async () => {
        attempts++
        if (attempts < 3) throw new Error('Error')
        return 'success'
      }

      const result = await RetryManager.execute(fn, {
        maxAttempts: 3,
        initialDelayMs: 50,
        backoffMultiplier: 2,
      })

      const elapsed = Date.now() - startTime
      // Should have at least 50ms + 100ms = 150ms delay
      expect(elapsed).toBeGreaterThanOrEqual(100)
      expect(result.success).toBe(true)
    })
  })

  describe('Error Detection', () => {
    it('should detect connection refused errors', () => {
      const error = { code: 'ECONNREFUSED' }
      expect(RetryManager.isRetryable(error)).toBe(true)
    })

    it('should detect timeout errors', () => {
      const error = { code: 'ETIMEDOUT' }
      expect(RetryManager.isRetryable(error)).toBe(true)
    })

    it('should detect 5xx errors', () => {
      const error = { status: 500 }
      expect(RetryManager.isRetryable(error)).toBe(true)
    })

    it('should detect rate limit errors', () => {
      const error = { status: 429 }
      expect(RetryManager.isRetryable(error)).toBe(true)
    })

    it('should not retry 4xx errors', () => {
      const error = { status: 400 }
      expect(RetryManager.isRetryable(error)).toBe(false)
    })
  })

  describe('Statistics', () => {
    it('should track total time', async () => {
      const fn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return 'success'
      }

      const result = await RetryManager.execute(fn)
      expect(result.totalTimeMs).toBeGreaterThanOrEqual(50)
    })

    it('should track attempts count', async () => {
      let attempts = 0
      const fn = async () => {
        attempts++
        if (attempts < 2) throw new Error('Error')
        return 'success'
      }

      const result = await RetryManager.execute(fn, {
        maxAttempts: 3,
        initialDelayMs: 10,
      })

      expect(result.attempts).toBe(2)
    })
  })

  describe('Custom Retry Logic', () => {
    it('should use custom shouldRetry function', async () => {
      let attempts = 0
      const fn = async () => {
        attempts++
        throw new Error('Custom error')
      }

      const result = await RetryManager.execute(fn, {
        maxAttempts: 3,
        initialDelayMs: 10,
        shouldRetry: (error, attempt) => attempt < 2,
      })

      expect(result.attempts).toBe(2)
    })

    it('should pass attempt number to shouldRetry', async () => {
      const attemptNumbers: number[] = []
      const fn = async () => {
        throw new Error('Error')
      }

      await RetryManager.execute(fn, {
        maxAttempts: 3,
        initialDelayMs: 10,
        shouldRetry: (error, attempt) => {
          attemptNumbers.push(attempt)
          return attempt < 3
        },
      })

      expect(attemptNumbers).toContain(1)
      expect(attemptNumbers).toContain(2)
      expect(attemptNumbers).toContain(3)
    })
  })
})
