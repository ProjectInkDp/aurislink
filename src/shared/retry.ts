import { log } from './reporter.js'

export interface RetryOptions {
  maxAttempts?: number
  initialDelayMs?: number
  maxDelayMs?: number
  backoffMultiplier?: number
  shouldRetry?: (error: any, attempt: number) => boolean
}

export interface RetryResult<T> {
  success: boolean
  data?: T
  error?: Error
  attempts: number
  totalTimeMs: number
}

/**
 * RetryManager
 * Implements retry logic with exponential backoff
 */
export class RetryManager {
  private static readonly DEFAULT_OPTIONS: Required<RetryOptions> = {
    maxAttempts: 3,
    initialDelayMs: 100,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
    shouldRetry: (error: any) => {
      // Retry on network errors, timeouts, and 5xx errors
      if (error?.code === 'ECONNREFUSED' || error?.code === 'ETIMEDOUT') return true
      if (error?.status >= 500) return true
      if (error?.status === 429) return true // Rate limit
      return false
    },
  }

  /**
   * Execute function with retry logic
   */
  static async execute<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {},
  ): Promise<RetryResult<T>> {
    const opts = { ...this.DEFAULT_OPTIONS, ...options }
    const startTime = Date.now()
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
      try {
        const data = await fn()
        const totalTimeMs = Date.now() - startTime
        return { success: true, data, attempts: attempt, totalTimeMs }
      } catch (error) {
        lastError = error as Error
        const shouldRetry = opts.shouldRetry(error, attempt)

        if (!shouldRetry || attempt === opts.maxAttempts) {
          const totalTimeMs = Date.now() - startTime
          return {
            success: false,
            error: lastError,
            attempts: attempt,
            totalTimeMs,
          }
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          opts.initialDelayMs * Math.pow(opts.backoffMultiplier, attempt - 1),
          opts.maxDelayMs,
        )

        log(
          'warn',
          'RetryManager',
          `Attempt ${attempt}/${opts.maxAttempts} failed: ${lastError.message}. Retrying in ${delay}ms...`,
        )

        // Wait before retrying
        await this._sleep(delay)
      }
    }

    const totalTimeMs = Date.now() - startTime
    return {
      success: false,
      error: lastError || new Error('Unknown error'),
      attempts: opts.maxAttempts,
      totalTimeMs,
    }
  }

  /**
   * Sleep utility
   */
  private static _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Get retry delay for specific attempt
   */
  static getDelay(
    attempt: number,
    initialDelayMs: number = 100,
    backoffMultiplier: number = 2,
    maxDelayMs: number = 5000,
  ): number {
    return Math.min(
      initialDelayMs * Math.pow(backoffMultiplier, attempt - 1),
      maxDelayMs,
    )
  }

  /**
   * Check if error is retryable
   */
  static isRetryable(error: any): boolean {
    if (error?.code === 'ECONNREFUSED' || error?.code === 'ETIMEDOUT') return true
    if (error?.status >= 500) return true
    if (error?.status === 429) return true
    return false
  }
}

/**
 * Decorator for automatic retry
 */
export function Retry(options: RetryOptions = {}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value

    descriptor.value = async function (...args: any[]) {
      const result = await RetryManager.execute(
        () => originalMethod.apply(this, args),
        options,
      )

      if (!result.success) {
        throw result.error
      }

      return result.data
    }

    return descriptor
  }
}
