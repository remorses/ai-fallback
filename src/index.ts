import {
    LanguageModelV4,
    LanguageModelV4CallOptions,
    LanguageModelV4StreamPart,
    LanguageModelV4GenerateResult,
    LanguageModelV4StreamResult,
} from '@ai-sdk/provider'

interface Settings {
    models: Array<LanguageModelV4 | FallbackModelSettings>
    retryAfterOutput?: boolean
    modelResetInterval?: number
    /** If the first token (including thinking/reasoning) takes longer than this (ms), abort and try the next model. */
    timeToFirstTokenTimeout?: number
    shouldRetryThisError?: (error: Error) => boolean
    onError?: (error: Error, modelId: string) => void | Promise<void>
}

export type FallbackModelSettings = {
    model: LanguageModelV4
    providerOptions?: LanguageModelV4CallOptions['providerOptions']
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

/** Sentinel error class for TTFT timeouts. Always triggers retry regardless of
 *  the user-provided shouldRetryThisError predicate. */
export class TimeToFirstTokenTimeoutError extends Error {
    readonly name = 'TimeToFirstTokenTimeoutError'
    constructor() {
        super('Time to first token timeout')
    }
}

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

/** Returns true if the stream part carries actual generated content.
 *  Metadata/lifecycle chunks like stream-start, text-start, text-end,
 *  response-metadata, raw, finish are excluded so the TTFT timer keeps
 *  running until real output arrives. */
function isContentChunk(part: LanguageModelV4StreamPart): boolean {
    switch (part.type) {
        case 'text-delta':
        case 'reasoning-delta':
        case 'tool-input-delta':
        case 'tool-call':
        case 'tool-result':
        case 'tool-approval-request':
        case 'file':
        case 'reasoning-file':
        case 'custom':
            return true
        default:
            return false
    }
}

/** Creates a TTFT deadline: a promise that rejects after `ms` with a
 *  TimeToFirstTokenTimeoutError, plus a clear() to cancel the timer. */
function createTtftDeadline(ms: number) {
    let timer: ReturnType<typeof setTimeout> | undefined
    const promise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeToFirstTokenTimeoutError()), ms)
    })
    return {
        promise,
        clear() {
            if (timer !== undefined) {
                clearTimeout(timer)
                timer = undefined
            }
        },
    }
}

/** Combines two AbortSignals so that if either fires the result fires too. */
function composeAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    if (a.aborted || b.aborted) {
        controller.abort()
        return controller.signal
    }
    a.addEventListener('abort', onAbort, { once: true })
    b.addEventListener('abort', onAbort, { once: true })
    return controller.signal
}

function getModel(model: LanguageModelV4 | FallbackModelSettings): LanguageModelV4 {
    return 'model' in model ? model.model : model
}

function getModelProviderOptions(
    model: LanguageModelV4 | FallbackModelSettings,
): LanguageModelV4CallOptions['providerOptions'] | undefined {
    return 'model' in model ? model.providerOptions : undefined
}

function mergeProviderOptions(
    options?: LanguageModelV4CallOptions['providerOptions'],
    modelOptions?: LanguageModelV4CallOptions['providerOptions'],
): LanguageModelV4CallOptions['providerOptions'] | undefined {
    if (!modelOptions) {
        return options
    }

    const merged = { ...(options ?? {}) }

    for (const [provider, providerOptions] of Object.entries(modelOptions)) {
        merged[provider] = {
            ...(merged[provider] ?? {}),
            ...providerOptions,
        }
    }

    return merged
}

export class FallbackModel implements LanguageModelV4 {
    readonly specificationVersion = 'v4' as const

    get supportedUrls():
        | Record<string, RegExp[]>
        | PromiseLike<Record<string, RegExp[]>> {
        return this.currentModel.supportedUrls
    }

    get modelId(): string {
        return this.currentModel.modelId
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
        return this.currentModel.provider
    }

    private get currentModel(): LanguageModelV4 {
        return getModel(this.settings.models[this.currentModelIndex])
    }

    private get currentModelProviderOptions():
        | LanguageModelV4CallOptions['providerOptions']
        | undefined {
        return getModelProviderOptions(this.settings.models[this.currentModelIndex])
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
                // TTFT timeout errors always trigger retry regardless of the
                // user-provided shouldRetryThisError predicate.
                if (!(lastError instanceof TimeToFirstTokenTimeoutError)) {
                    const shouldRetry =
                        this.settings.shouldRetryThisError ||
                        defaultShouldRetryThisError
                    if (!shouldRetry(lastError)) {
                        throw lastError
                    }
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

    private optionsForCurrentModel(
        options: LanguageModelV4CallOptions,
    ): LanguageModelV4CallOptions {
        const providerOptions = mergeProviderOptions(
            options.providerOptions,
            this.currentModelProviderOptions,
        )

        if (providerOptions === options.providerOptions) {
            return options
        }

        return {
            ...options,
            providerOptions,
        }
    }

    doGenerate(options: LanguageModelV4CallOptions): PromiseLike<LanguageModelV4GenerateResult> {
        this.checkAndResetModel()
        const ttftTimeout = this.settings.timeToFirstTokenTimeout
        return this.retry(async () => {
            if (ttftTimeout == null || ttftTimeout <= 0) {
                return this.currentModel.doGenerate(
                    this.optionsForCurrentModel(options),
                )
            }
            const deadline = createTtftDeadline(ttftTimeout)
            const abortController = new AbortController()
            const mergedOptions = this.optionsForCurrentModel(options)
            try {
                return await Promise.race([
                    this.currentModel.doGenerate({
                        ...mergedOptions,
                        abortSignal: mergedOptions.abortSignal
                            ? composeAbortSignals(mergedOptions.abortSignal, abortController.signal)
                            : abortController.signal,
                    }),
                    deadline.promise,
                ])
            } catch (error) {
                abortController.abort()
                throw error
            } finally {
                deadline.clear()
            }
        })
    }

    doStream(options: LanguageModelV4CallOptions): PromiseLike<LanguageModelV4StreamResult> {
        this.checkAndResetModel()
        let self = this
        const shouldRetry =
            this.settings.shouldRetryThisError || defaultShouldRetryThisError
        return this.retry(async () => {
            const ttftTimeout = self.settings.timeToFirstTokenTimeout
            const hasTtft = ttftTimeout != null && ttftTimeout > 0

            // Start the TTFT deadline *before* calling doStream so the
            // initial HTTP round-trip is also covered by the timeout.
            const deadline = hasTtft ? createTtftDeadline(ttftTimeout) : undefined
            const abortController = hasTtft ? new AbortController() : undefined

            const mergedOptions = self.optionsForCurrentModel(options)
            const optionsWithAbort =
                abortController
                    ? {
                          ...mergedOptions,
                          abortSignal: mergedOptions.abortSignal
                              ? composeAbortSignals(mergedOptions.abortSignal, abortController.signal)
                              : abortController.signal,
                      }
                    : mergedOptions

            let result: LanguageModelV4StreamResult
            try {
                result = deadline
                    ? await Promise.race([
                          self.currentModel.doStream(optionsWithAbort),
                          deadline.promise,
                      ])
                    : await self.currentModel.doStream(optionsWithAbort)
            } catch (error) {
                // If doStream() itself times out (slow HTTP handshake),
                // abort the provider request and clean up the timer.
                deadline?.clear()
                abortController?.abort()
                throw error
            }

            // Two separate booleans:
            // - hasEmittedOutput: has any non-stream-start chunk been sent to
            //   the caller? Used for retry safety (don't mix two models' output).
            // - hasSatisfiedTtft: has a content-bearing chunk arrived? Used to
            //   clear the TTFT deadline.
            let hasEmittedOutput = false
            let hasSatisfiedTtft = false
            // Wrap the stream to handle errors and switch providers if needed
            const wrappedStream = new ReadableStream<LanguageModelV4StreamPart>(
                {
                    async start(controller) {
                        let reader: ReadableStreamDefaultReader<LanguageModelV4StreamPart> | null =
                            null
                        let nextReader: ReadableStreamDefaultReader<LanguageModelV4StreamPart> | null =
                            null

                        try {
                            reader = result.stream.getReader()

                            while (true) {
                                const readPromise = reader.read()
                                // Race reads against the TTFT deadline until
                                // actual content arrives.
                                const { done, value } =
                                    deadline && !hasSatisfiedTtft
                                        ? await Promise.race([readPromise, deadline.promise])
                                        : await readPromise

                                if (
                                    !hasEmittedOutput &&
                                    value &&
                                    typeof value === 'object' &&
                                    'error' in value
                                ) {
                                    const error = value.error as any
                                    if (shouldRetry(error)) {
                                        deadline?.clear()
                                        throw error
                                    }
                                }

                                if (done) {
                                    deadline?.clear()
                                    break
                                }
                                controller.enqueue(value)

                                if (value?.type !== 'stream-start') {
                                    hasEmittedOutput = true
                                }

                                // Only clear TTFT on content-bearing chunks.
                                // Lifecycle/metadata chunks like stream-start,
                                // text-start, response-metadata don't count.
                                if (isContentChunk(value)) {
                                    hasSatisfiedTtft = true
                                    deadline?.clear()
                                }
                            }
                            controller.close()
                        } catch (error) {
                            deadline?.clear()
                            abortController?.abort()

                            if (self.settings.onError) {
                                await self.settings.onError(
                                    error as Error,
                                    self.modelId,
                                )
                            }

                            if (!hasEmittedOutput || self.retryAfterOutput) {
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
