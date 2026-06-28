---
'ai-fallback': major
---

Upgrade to AI SDK v7 (`ai@7.x`) and `@ai-sdk/provider` v4 (`LanguageModelV4`).

The `FallbackModel` class now implements `LanguageModelV4` with `specificationVersion: 'v4'`, compatible with the latest provider packages (`@ai-sdk/openai@4.x`, `@ai-sdk/anthropic@4.x`, `@ai-sdk/google@4.x`, etc.).

```ts
import { createFallback } from 'ai-fallback'
import { openai } from '@ai-sdk/openai'    // v4.x
import { anthropic } from '@ai-sdk/anthropic' // v4.x

const model = createFallback({
  models: [anthropic('claude-sonnet-4-20250514'), openai('gpt-4.1-mini')],
})
```

Peer dependency requirements:
- `@ai-sdk/provider` >= 4.0.0
- `@ai-sdk/provider-utils` >= 5.0.0

Closes #20
