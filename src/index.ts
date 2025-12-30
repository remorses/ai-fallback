import {
    LanguageModelV3,
    LanguageModelV3CallOptions,
    LanguageModelV3StreamPart,
    LanguageModelV3GenerateResult,
    LanguageModelV3StreamResult,
} from '@ai-sdk/provider'

interface Settings {
    models: Array<LanguageModelV3>
    retryAfterOutput?: boolean
    modelResetInterval?: number
    shouldRetryThisError?: (error: Error) => boolean
    onError?: (error: Error, modelId: string) => void | Promise<void>
}

export function createFallback(settings: Settings): FallbackModel {
    return new FallbackModel(settings)
}

const retryableStatusCodes = [
    401, // wrong API key
    403, // permission error, like cannot access model or from a non accessible region
    408, // request timeout
    409, // conflict
    413, // payload too large
    429, // too many requests/rate limits
    498, // groq flex rate limit https://console.groq.com/docs/errors
    500, // server error (and above)
]
// Common error messages/codes that indicate server overload or temporary issues
const retryableErrors = [
    'overloaded',
    'service unavailable',
    'bad gateway',
    'too many requests',
    'toomanyrequests', // camelCase/PascalCase variant
    'too many requests', // camelCase/PascalCase variant
    'internal server error',
    'gateway timeout',
    'rate_limit',
    'ratelimit', // variant without underscore
    'rate limit', // variant with space
    'wrong-key',
    'unexpected',
    'capacity',
    'timeout',
    'server_error',
    '429', // Too Many Requests
    '500', // Internal Server Error
    '502', // Bad Gateway
    '503', // Service Unavailable
    '504', // Gateway Timeout
]

export function defaultShouldRetryThisError(error: any): boolean {
    let statusCode = error?.['statusCode']

    if (
        statusCode &&
        (retryableStatusCodes.includes(statusCode) || statusCode > 500)
    ) {
        return true
    }

    if (error?.message) {
        const errorString = error.message.toLowerCase() || ''
        return retryableErrors.some((errType) => errorString.includes(errType))
    }
    if (error && typeof error === 'object') {
        const errorString = JSON.stringify(error).toLowerCase() || ''
        return retryableErrors.some((errType) => errorString.includes(errType))
    }
    return false
}

export class FallbackModel implements LanguageModelV3 {
    readonly specificationVersion = 'v3' as const

    get supportedUrls():
        | Record<string, RegExp[]>
        | PromiseLike<Record<string, RegExp[]>> {
        return this.settings.models[this.currentModelIndex].supportedUrls
    }

    get modelId(): string {
        return this.settings.models[this.currentModelIndex].modelId
    }
    readonly settings: Settings

    currentModelIndex: number = 0
    private lastModelReset: number = Date.now()
    private readonly modelResetInterval: number
    retryAfterOutput: boolean
    constructor(settings: Settings) {
        this.settings = settings
        this.modelResetInterval = settings.modelResetInterval ?? 3 * 60 * 1000 // Default 3 minutes in ms
        this.retryAfterOutput = settings.retryAfterOutput ?? true

        if (!this.settings.models[this.currentModelIndex]) {
            throw new Error('No models available in settings')
        }
    }

    get provider(): string {
        return this.settings.models[this.currentModelIndex].provider
    }

    private checkAndResetModel() {
        const now = Date.now()
        if (
            now - this.lastModelReset >= this.modelResetInterval &&
            this.currentModelIndex !== 0
        ) {
            this.currentModelIndex = 0
            this.lastModelReset = now
        }
    }

    private switchToNextModel() {
        this.currentModelIndex =
            (this.currentModelIndex + 1) % this.settings.models.length
    }

    private async retry<T>(fn: () => PromiseLike<T>): Promise<T> {
        let lastError: Error | undefined
        const initialModel = this.currentModelIndex

        do {
            try {
                return await fn()
            } catch (error) {
                lastError = error as Error
                // Only retry if it's a server/capacity error
                const shouldRetry =
                    this.settings.shouldRetryThisError ||
                    defaultShouldRetryThisError
                if (!shouldRetry(lastError)) {
                    throw lastError
                }

                if (this.settings.onError) {
                    await this.settings.onError(lastError, this.modelId)
                }
                this.switchToNextModel()

                // If we've tried all models, throw the last error
                if (this.currentModelIndex === initialModel) {
                    throw lastError
                }
            }
        } while (true)
    }

    doGenerate(options: LanguageModelV3CallOptions): PromiseLike<LanguageModelV3GenerateResult> {
        this.checkAndResetModel()
        return this.retry(() =>
            this.settings.models[this.currentModelIndex].doGenerate(options),
        )
    }

    doStream(options: LanguageModelV3CallOptions): PromiseLike<LanguageModelV3StreamResult> {
        this.checkAndResetModel()
        let self = this
        const shouldRetry =
            this.settings.shouldRetryThisError || defaultShouldRetryThisError
        return this.retry(async () => {
            const result =
                await self.settings.models[this.currentModelIndex].doStream(
                    options,
                )

            let hasStreamedAny = false
            // Wrap the stream to handle errors and switch providers if needed
            const wrappedStream = new ReadableStream<LanguageModelV3StreamPart>(
                {
                    async start(controller) {
                        let reader: ReadableStreamDefaultReader<LanguageModelV3StreamPart> | null =
                            null
                        let nextReader: ReadableStreamDefaultReader<LanguageModelV3StreamPart> | null =
                            null

                        try {
                            reader = result.stream.getReader()

                            while (true) {
                                const result = await reader.read()

                                const { done, value } = result
                                if (
                                    !hasStreamedAny &&
                                    value &&
                                    typeof value === 'object' &&
                                    'error' in value
                                ) {
                                    const error = value.error as any
                                    if (shouldRetry(error)) {
                                        throw error
                                    }
                                }

                                if (done) break
                                controller.enqueue(value)

                                if (value?.type !== 'stream-start') {
                                    hasStreamedAny = true
                                }
                            }
                            controller.close()
                        } catch (error) {
                            if (self.settings.onError) {
                                await self.settings.onError(
                                    error as Error,
                                    self.modelId,
                                )
                            }

                            if (!hasStreamedAny || self.retryAfterOutput) {
                                self.switchToNextModel()

                                // TODO should be initialModel instead?
                                if (self.currentModelIndex === 0) {
                                    controller.error(error)
                                    return
                                }

                                try {
                                    const nextResult =
                                        await self.doStream(options)
                                    nextReader = nextResult.stream.getReader()
                                    while (true) {
                                        const { done, value } =
                                            await nextReader.read()
                                        if (done) break
                                        controller.enqueue(value)
                                    }
                                    controller.close()
                                } catch (nextError) {
                                    controller.error(nextError)
                                } finally {
                                    try {
                                        nextReader?.releaseLock()
                                    } catch (e) {
                                        // Ignore release errors
                                    }
                                }
                                return
                            }
                            controller.error(error)
                        } finally {
                            try {
                                reader?.releaseLock()
                            } catch (e) {
                                // Ignore release errors
                            }
                        }
                    },
                },
            )

            return {
                ...result,
                stream: wrappedStream,
                request: result.request,
                response: result.response,
            }
        })
    }
}
