import { test, expect } from 'vitest'
import { z } from 'zod'
import { createFallback } from './index.js'
import { createOpenAI } from '@ai-sdk/openai'
import { createGroq } from '@ai-sdk/groq'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText, streamText, streamObject, tool } from 'ai'
import { convertArrayToReadableStream } from '@ai-sdk/provider-utils/test'
import {
    LanguageModelV2StreamPart,
    LanguageModelV2CallWarning,
} from '@ai-sdk/provider'
import { MockLanguageModelV2 } from './mock-model.js'

const openai = createOpenAI({
    apiKey: process.env.OPENAI_KEY,
})

const anthropic = createAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
})

test('createProvider works', async () => {
    const model = createFallback({
        models: [anthropic('claude-3-haiku-20240307'), openai('gpt-3.5-turbo')],
    })

    const result = await generateText({
        model,
        system: 'You are a sentiment analysis expert. Analyze the sentiment of any text provided and respond with either POSITIVE, NEGATIVE, or NEUTRAL.',
        messages: [
            { role: 'user', content: 'I love this product! It works great.' },
        ],
    })

    expect(result.text).toMatchInlineSnapshot('"POSITIVE"')
})

test('switches model on error', async () => {
    const model = createFallback({
        models: [
            createOpenAI({ apiKey: 'wrong-key' })('gpt-3.5-turbo'),
            anthropic('claude-3-haiku-20240307'),
        ],
    })

    model.currentModelIndex = 0

    const result = await generateText({
        model,
        system: 'You only respond hello',
        messages: [{ role: 'user', content: 'Say hello' }],
    })

    // After error with OpenAI, should have switched to Anthropic
    expect(model.currentModelIndex).toBe(1)
    expect(model.modelId).toBe('claude-3-haiku-20240307')
    expect(result.text).toBeTruthy()
    model.currentModelIndex = 0
})

test('groq switches model on error, switches to third model', async () => {
    const model = createFallback({
        models: [
            createGroq({ apiKey: 'wrong-key' })('gpt-3.5-turbo'),
            createOpenAI({ apiKey: 'wrong-key' })('gpt-3.5-turbo'),
            anthropic('claude-3-haiku-20240307'),
        ],
    })

    model.currentModelIndex = 0

    const result = await generateText({
        model,
        system: 'You only respond hello',
        messages: [{ role: 'user', content: 'Say hello' }],
    })

    // After error with OpenAI, should have switched to Anthropic
    expect(model.currentModelIndex).toBe(2)
    expect(model.modelId).toMatchInlineSnapshot(`"claude-3-haiku-20240307"`)
    expect(result.text).toBeTruthy()
    model.currentModelIndex = 0
})

test('shouldRetryThisError works with non-existent model error', async () => {
    let called = false
    const model = createFallback({
        models: [
            openai('non-existent-model'),
            anthropic('claude-3-haiku-20240307'),
        ],
        shouldRetryThisError: (error) => {
            called = true
            // console.error(error)
            return error.message.toLowerCase().includes('does not exist')
        },
    })

    model.currentModelIndex = 0

    const result = await generateText({
        model,
        system: 'You only respond hello',
        messages: [{ role: 'user', content: 'Say hello' }],
    })
    expect(called).toBe(true)

    // Should switch to Anthropic after OpenAI error
    expect(model.currentModelIndex).toBe(1)
    expect(model.modelId).toBe('claude-3-haiku-20240307')
    expect(result.text).toBeTruthy()
    model.currentModelIndex = 0
})

test('streamText works', async () => {
    const model = createFallback({
        models: [anthropic('claude-3-haiku-20240307'), openai('gpt-3.5-turbo')],
    })

    const stream = await streamText({
        model,
        system: 'You are a helpful assistant.',
        messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
    })

    let text = ''
    for await (const chunk of stream.textStream) {
        text += chunk
    }

    expect(text).toContain('1')
    expect(text).toContain('5')
})

test('streamObject works', async () => {
    const model = createFallback({
        models: [openai('gpt-4.1-mini'), anthropic('claude-3-haiku-20240307')],
    })

    const stream = await streamObject({
        model,
        system: 'You are a helpful assistant.',
        messages: [
            {
                role: 'user',
                content:
                    'Give me a person object with name set to "Tommy" and age set to 5 properties.',
            },
        ],
        schema: z.object({
            name: z.string(),
            age: z.number(),
        }),
    })

    let result
    for await (const chunk of stream.partialObjectStream) {
        result = chunk
    }
    expect(await stream.object).toMatchInlineSnapshot(`
      {
        "age": 5,
        "name": "Tommy",
      }
    `)

    expect(result).toHaveProperty('name')
    expect(result).toHaveProperty('age')
    expect(typeof result.name).toBe('string')
    expect(typeof result.age).toBe('number')
})

test('ReadableStream works like i expect', async () => {
    // Create a stream that will error
    const errorStream = new ReadableStream({
        start(controller) {
            controller.error(new Error('Test stream error'))
        },
    })

    // Test that the error is thrown when consuming the stream
    let error: Error | undefined
    try {
        const reader = errorStream.getReader()
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            // Should not get here
            console.log(value)
        }
    } catch (e) {
        error = e as Error
    }

    expect(error).toBeDefined()
    expect(error?.message).toBe('Test stream error')
})

test('fallback switches models on stream error before any output', async () => {
    // Create OpenAI client that errors immediately
    const errorOpenAI = createOpenAI({
        apiKey: process.env.OPENAI_KEY,
        fetch: async (url, options) => {
            const stream = new ReadableStream({
                start(controller) {
                    // Error immediately before streaming any data
                    controller.error(new Error('Injected immediate error'))
                },
            })

            return new Response(stream, {
                // headers: result.headers,
                // status: result.status,
                // statusText: result.statusText,
            })
        },
    })

    let err
    const model = createFallback({
        models: [errorOpenAI('gpt-3.5-turbo'), openai('gpt-3.5-turbo')],
        onError(error, modelId) {
            err = error
        },
    })
    model.currentModelIndex = 0

    const { textStream } = await streamText({
        model,
        messages: [
            {
                role: 'user',
                content: 'Say only "hello". only that and nothing else',
            },
        ],
    })

    let text = ''
    for await (const chunk of textStream) {
        text += chunk
    }

    expect(err?.message).toBe('Injected immediate error')
    console.log({ text })
    expect(text).toBeTruthy() // Verify we got some text after fallback
    expect(model.currentModelIndex).toBe(1) // Should have switched to second model
})

test('fallback switches models on stream error after some output', async () => {
    // Create OpenAI client that errors after first token
    const errorOpenAI = createOpenAI({
        apiKey: process.env.OPENAI_KEY,
        fetch: async (url, options) => {
            const result = await fetch(url, options)
            const originalBody = result.body
            if (!originalBody) throw new Error('No response body')

            const reader = originalBody.getReader()
            const stream = new ReadableStream({
                async start(controller) {
                    {
                        const { value } = await reader.read()
                        // console.log(new TextDecoder().decode(value))
                        controller.enqueue(value)
                    }
                    {
                        const { value } = await reader.read()
                        // console.log(new TextDecoder().decode(value))
                        controller.enqueue(value)
                    }

                    controller.error(
                        new Error('Injected error after first token'),
                    )
                },
            })

            return new Response(stream, {
                headers: result.headers,
                status: result.status,
                statusText: result.statusText,
            })
        },
    })

    let err
    let text = ''
    const model = createFallback({
        models: [errorOpenAI('gpt-3.5-turbo'), openai('gpt-3.5-turbo')],
        retryAfterOutput: true,
        onError(error, modelId) {
            err = error
            text += 'ERROR'
        },
    })
    model.currentModelIndex = 0

    const { textStream } = await streamText({
        model,
        messages: [
            {
                role: 'user',
                content: 'Say only "hello" 3 times. only that and nothing else',
            },
        ],
    })

    for await (const chunk of textStream) {
        text += chunk
    }

    expect(err?.message).toBe('Injected error after first token')
    console.log({ text })
    expect(text).toBeTruthy() // Verify we got some text after fallback
    expect(model.currentModelIndex).toBe(1) // Should have switched to second model
})

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}


test('handles overloaded_error from reader.read() and retries with fallback model', async () => {
    const encounteredErrors: any[] = []

    const model = createFallback({
        models: [
            new MockLanguageModelV2({
                doStream: async () => ({
                    stream: convertArrayToReadableStream([
                        {
                            type: 'stream-start',
                        },
                        {
                            type: 'error',
                            error: 'Overloaded',
                        },
                    ] as LanguageModelV2StreamPart[]),
                }),
            }),
            openai('gpt-4.1-mini'),
            anthropic('claude-3-haiku-20240307'),
        ],
        shouldRetryThisError: (error) => {
            encounteredErrors.push(error)
            return true
        },
        onError: async (error, modelId) => {
            console.log(`Error from model ${modelId}:`, error)
        },
    })

    model.currentModelIndex = 0

    const res = streamText({
        model,
        temperature: 0,
        messages: [
            {
                role: 'user',
                content: 'say "hello" 3 times with spaces. exactly that and nothing else',
            },
        ],
    })
    await res.consumeStream()
    const result = await res.text
    expect(result).toBeTruthy()
    expect(result).toMatchInlineSnapshot(`"hello hello hello"`)
    expect(encounteredErrors.length).toMatchInlineSnapshot(`1`)
    expect(encounteredErrors[0]).toMatchInlineSnapshot(`"Overloaded"`)

    expect(model.currentModelIndex).toMatchInlineSnapshot(`1`)
    expect(model.modelId).toMatchInlineSnapshot(`"gpt-4.1-mini"`)
}, 1000 * 10)
