### AI Fallback

Automatically switch between AI model providers when one experiences downtime or errors.

> [!warning]
> **Version compatibility:**
> - Use `ai-fallback` **version 0** for **AI SDK v4**.<br>
> - Use `ai-fallback` **version 1** for **AI SDK v5** (currently in beta).

#### Why?

AI providers can encounter:

-   Rate limiting
-   Service outages
-   API errors
-   Capacity issues
-   Timeouts

This package ensures reliability by specifying multiple AI models as fallbacks. It automatically switches to the next available model if the primary fails, maintaining application uptime.

---

### Installation

```bash
npm install ai-fallback@0 # use version 0.x.x for AI sdk v4
```

---

### Models Fallback Reset

Reset to the primary model after a delay (e.g., 1 minute):

```javascript
const model = createFallback({
    models: [
        anthropic('claude-3-haiku-20240307'), // Use Claude as preferred model
        openai('gpt-3.5-turbo'),
    ],
    onError: (error, modelId) => {
        console.error(`Error with model ${modelId}:`, error)
    },
    modelResetInterval: 60000, // Reset to first model after 1 minute of the first error
})
```

---

### Provider Metadata

Track which model actually handled your request:

#### For generateText

```javascript
const result = await generateText({
    model,
    messages: [{ role: 'user', content: 'Hello' }],
})

// Access the fallback metadata
console.log(result.response?.providerMetadata?.fallback)
// Output: {
//   modelUsed: 'gpt-3.5-turbo',  // The actual model that handled the request
//   modelIndex: 0,                // Index in the models array
//   provider: 'openai'            // Provider name
// }
```

#### For streamText

```javascript
const stream = await streamText({
    model,
    messages: [{ role: 'user', content: 'Hello' }],
})

// Access the fallback metadata
console.log(stream.response?.fallbackMetadata)
// Output: {
//   modelUsed: 'claude-3-haiku-20240307',
//   modelIndex: 1,
//   provider: 'anthropic'
// }
```

---

### Usage

#### Create a Fallback Model

```javascript
import { createFallback } from 'ai-fallback'
import { openai } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'

const model = createFallback({
    models: [anthropic('claude-3-haiku-20240307'), openai('gpt-3.5-turbo')],
})
```


---

### Text Generation

Generate text with automatic fallback:

```javascript
const result = await generateText({
    model,
    system: 'You are a helpful assistant.',
    messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
})
```

---

### Streaming Responses

Stream text responses:

```javascript
const stream = await streamText({
    model,
    system: 'You are a helpful assistant.',
    messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
})

for await (const chunk of stream.textStream) {
    console.log(chunk)
}
```

---

### Structured Output

Stream typed objects using `Zod` schemas:

```javascript
import { z } from 'zod'

const stream = await streamObject({
    model,
    system: 'You are a helpful assistant.',
    messages: [
        {
            role: 'user',
            content: 'Give me a person object with name and age properties.',
        },
    ],
    schema: z.object({
        name: z.string(),
        age: z.number(),
    }),
})

for await (const chunk of stream.partialObjectStream) {
    console.log(chunk)
}
```
