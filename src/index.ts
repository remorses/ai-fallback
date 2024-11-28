import {
    LanguageModelV1,
    LanguageModelV1CallOptions,
    LanguageModelV1CallWarning,
    LanguageModelV1FinishReason,
    LanguageModelV1FunctionToolCall,
    LanguageModelV1LogProbs,
    LanguageModelV1ProviderMetadata,
    LanguageModelV1StreamPart,
} from '@ai-sdk/provider'

interface Settings {
    models: Array<LanguageModelV1>
    modelResetInterval?: number
    shouldRetryThisError?: (error: Error) => boolean
    onError?: (error: Error, modelId: string) => void | Promise<void>
}

export function createFallback(settings: Settings): FallbackModel {
    return new FallbackModel(settings)
}

declare global {
    var __aiModelId: string | undefined
}

// Default error retry logic
function defaultShouldRetryThisError(error: Error): boolean {
    // Common error messages/codes that indicate server overload or temporary issues
    const retryableErrors = [
        'overloaded',
        'rate_limit',
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

    const errorString = error.message.toLowerCase()
    return retryableErrors.some((errType) =>
        errorString.includes(errType.toLowerCase()),
    )
}

export class FallbackModel implements LanguageModelV1 {
    readonly specificationVersion = 'v1'

    get supportsStructuredOutputs(): boolean {
        return this.settings.models[this.currentModelIndex]
            .supportsStructuredOutputs!
    }

    get modelId(): string {
        return this.settings.models[this.currentModelIndex].modelId
    }
    readonly settings: Settings

    currentModelIndex: number = 0
    private lastModelReset: number = Date.now()
    private readonly modelResetInterval: number

    constructor(settings: Settings) {
        this.settings = settings
        this.modelResetInterval = settings.modelResetInterval ?? 3 * 60 * 1000 // Default 3 minutes in ms

        // Use globalThis.modelId if defined to find initial model
        if (globalThis.__aiModelId) {
            const modelIndex = settings.models.findIndex(
                (p) => p.modelId === globalThis.__aiModelId,
            )
            if (modelIndex !== -1) {
                this.currentModelIndex = modelIndex
            }
        }

        if (!this.settings.models[this.currentModelIndex]) {
            throw new Error('No models available in settings')
        }
        globalThis.__aiModelId =
            this.settings.models[this.currentModelIndex].modelId
    }

    get defaultObjectGenerationMode(): 'json' | 'tool' | undefined {
        return this.settings.models[this.currentModelIndex]
            .defaultObjectGenerationMode
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
            globalThis.__aiModelId = this.settings.models[0].modelId
            this.lastModelReset = now
        }
    }

    private switchToNextModel() {
        this.currentModelIndex =
            (this.currentModelIndex + 1) % this.settings.models.length
        globalThis.__aiModelId =
            this.settings.models[this.currentModelIndex].modelId
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

    doGenerate(options: LanguageModelV1CallOptions): PromiseLike<{
        text?: string
        toolCalls?: Array<LanguageModelV1FunctionToolCall>
        finishReason: LanguageModelV1FinishReason
        usage: { promptTokens: number; completionTokens: number }
        rawCall: { rawPrompt: unknown; rawSettings: Record<string, unknown> }
        rawResponse?: { headers?: Record<string, string> }
        request?: { body?: string }
        response?: { id?: string; timestamp?: Date; modelId?: string }
        warnings?: LanguageModelV1CallWarning[]
        providerMetadata?: LanguageModelV1ProviderMetadata
        logprobs?: LanguageModelV1LogProbs
    }> {
        this.checkAndResetModel()
        return this.retry(() =>
            this.settings.models[this.currentModelIndex].doGenerate(options),
        )
    }

    doStream(options: LanguageModelV1CallOptions): PromiseLike<{
        stream: ReadableStream<LanguageModelV1StreamPart>
        rawCall: { rawPrompt: unknown; rawSettings: Record<string, unknown> }
        rawResponse?: { headers?: Record<string, string> }
        request?: { body?: string }
        warnings?: LanguageModelV1CallWarning[]
    }> {
        this.checkAndResetModel()
        return this.retry(async () => {
            const result = await this.settings.models[
                this.currentModelIndex
            ].doStream(options)
            const self = this

            // Wrap the stream to handle errors and switch providers if needed
            const wrappedStream = new ReadableStream<LanguageModelV1StreamPart>(
                {
                    async start(controller) {
                        try {
                            const reader = result.stream.getReader()
                            while (true) {
                                const { done, value } = await reader.read()
                                if (done) break
                                controller.enqueue(value)
                            }
                            controller.close()
                        } catch (error) {
                            if (self.settings.onError) {
                                await self.settings.onError(
                                    error as Error,
                                    self.modelId,
                                )
                            }
                            self.switchToNextModel()
                            throw error
                        }
                    },
                },
            )

            return {
                ...result,
                stream: wrappedStream,
            }
        })
    }
}
