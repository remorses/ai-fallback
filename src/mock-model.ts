import { LanguageModelV4 } from '@ai-sdk/provider'

function notImplemented(): never {
    throw new Error('Not implemented')
}

export class MockLanguageModelV4 implements LanguageModelV4 {
    readonly specificationVersion = 'v4' as const

    private _supportedUrls: () => LanguageModelV4['supportedUrls']

    readonly provider: LanguageModelV4['provider']
    readonly modelId: LanguageModelV4['modelId']

    doGenerate: LanguageModelV4['doGenerate']
    doStream: LanguageModelV4['doStream']

    doGenerateCalls: Parameters<LanguageModelV4['doGenerate']>[0][] = []
    doStreamCalls: Parameters<LanguageModelV4['doStream']>[0][] = []

    constructor({
        provider = 'mock-provider',
        modelId = 'mock-model-id',
        supportedUrls = {},
        doGenerate = notImplemented,
        doStream = notImplemented,
    }: {
        provider?: LanguageModelV4['provider']
        modelId?: LanguageModelV4['modelId']
        supportedUrls?:
            | LanguageModelV4['supportedUrls']
            | (() => LanguageModelV4['supportedUrls'])
        doGenerate?:
            | LanguageModelV4['doGenerate']
            | Awaited<ReturnType<LanguageModelV4['doGenerate']>>
            | Awaited<ReturnType<LanguageModelV4['doGenerate']>>[]
        doStream?:
            | LanguageModelV4['doStream']
            | Awaited<ReturnType<LanguageModelV4['doStream']>>
            | Awaited<ReturnType<LanguageModelV4['doStream']>>[]
    } = {}) {
        this.provider = provider
        this.modelId = modelId
        this.doGenerate = async (options) => {
            this.doGenerateCalls.push(options)

            if (typeof doGenerate === 'function') {
                return doGenerate(options)
            } else if (Array.isArray(doGenerate)) {
                return doGenerate[this.doGenerateCalls.length]
            } else {
                return doGenerate
            }
        }
        this.doStream = async (options) => {
            this.doStreamCalls.push(options)

            if (typeof doStream === 'function') {
                return doStream(options)
            } else if (Array.isArray(doStream)) {
                return doStream[this.doStreamCalls.length]
            } else {
                return doStream
            }
        }
        this._supportedUrls =
            typeof supportedUrls === 'function'
                ? supportedUrls
                : async () => supportedUrls
    }

    get supportedUrls() {
        return this._supportedUrls()
    }
}
