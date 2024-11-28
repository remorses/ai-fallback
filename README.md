# AI Fallback

Automatically switch between AI model providers when one experiences downtime or errors.

## Why?

When building AI applications, reliability is crucial. AI providers can experience:

-   Rate limiting
-   Service outages
-   API errors
-   Capacity issues
-   Timeouts

This package allows you to specify multiple AI models as fallbacks. If the primary model fails, it automatically switches to the next available model, ensuring your application stays operational.

### Models Fallback Reset

By default, the fallback system will remember which model it switched to after an error. You can configure it to reset back to the primary model after a specified time period:

    const model = createFallback({
        models: [
            anthropic('claude-3-haiku-20240307'),
            openai('gpt-3.5-turbo')
        ],
        resetAfterMs: 60000 // Reset to primary model after 1 minute
    })

This ensures that your application attempts to use the primary model again after the specified delay, rather than staying on the fallback indefinitely. This is useful when the primary model experiences temporary issues that resolve themselves.

## Installation

    npm install ai-fallback

## Usage

Create a fallback model by providing multiple AI models in priority order:

    import { createFallback } from 'ai-fallback'
    import { createOpenAI } from '@ai-sdk/openai'
    import { createAnthropic } from '@ai-sdk/anthropic'

    const model = createFallback({
        models: [
            anthropic('claude-3-haiku-20240307'),
            openai('gpt-3.5-turbo')
        ],
    })

### Text Generation

Generate text with automatic fallback:

    const result = await generateText({
        model,
        system: 'You are a helpful assistant.',
        messages: [
            { role: 'user', content: 'Count from 1 to 5.' }
        ],
    })

### Streaming Responses

Stream text responses:

    const stream = await streamText({
        model,
        system: 'You are a helpful assistant.',
        messages: [
            { role: 'user', content: 'Count from 1 to 5.' }
        ],
    })

    for await (const chunk of stream.textStream) {
        console.log(chunk)
    }

### Structured Output

Stream typed objects using Zod schemas:

    const stream = await streamObject({
        model,
        system: 'You are a helpful assistant.',
        messages: [
            {
                role: 'user',
                content: 'Give me a person object with name and age properties.'
            }
        ],
        schema: z.object({
            name: z.string(),
            age: z.number(),
        }),
    })

    for await (const chunk of stream.partialObjectStream) {
        console.log(chunk)
    }
