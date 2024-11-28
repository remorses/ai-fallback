### AI Fallback

Automatically switch between AI model providers when one experiences downtime or errors.

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
npm install ai-fallback
```

---

### Models Fallback Reset

Reset to the primary model after a delay (e.g., 1 minute):

```javascript
const model = createFallback({
    models: [anthropic('claude-3-haiku-20240307'), openai('gpt-3.5-turbo')],
    resetAfterMs: 60000, // Reset after 1 minute
    onError: (error, modelId) => {
        console.error(`Error with model ${modelId}:`, error)
    },
    modelResetInterval: 60000, // Reset to first model after 1 minute of the first error
})
```

---

### Usage

#### Create a Fallback Model

```javascript
import { createFallback } from 'ai-fallback'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'

const model = createFallback({
    models: [
        createAnthropic('claude-3-haiku-20240307'),
        createOpenAI('gpt-3.5-turbo'),
    ],
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
