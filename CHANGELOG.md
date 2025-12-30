# ai-fallback

## 2.0.0

### Major Changes

-   Upgrade to AI SDK v6 (LanguageModelV3)
-   Update `@ai-sdk/provider` to 3.0.0
-   Update `@ai-sdk/provider-utils` to 4.0.1
-   Change specification version from `v2` to `v3`

## 1.0.8

### Patch Changes

-   Handle more error string variants for rate limiting (camelCase, PascalCase, with spaces, without underscores)

## 1.0.7

### Patch Changes

-   handle groq status 498

## 1.0.6

### Patch Changes

-   Upgrade old ai packages

## 1.0.5

### Patch Changes

-   Export defaultShouldRetryThisError

## 1.0.4

### Patch Changes

-   Use latest version of ai packages

## 1.0.3

### Patch Changes

-   fix infinite retries

## 1.0.2

### Patch Changes

-   Handle anthropic errors after stream start as part errors

## 1.0.1

### Patch Changes

-   Add support for object errors thrown by anthropic

## 1.0.0

### Major Changes

-   423b412: Add support for AI sdk v5

## 0.1.5

### Patch Changes

-   Softer deps versions to prevent tsc issues

## 0.1.4

### Patch Changes

-   Do not store model id globally

## 0.1.3

### Patch Changes

-   Do not throw in case a model throws a non Error instance

## 0.1.2

### Patch Changes

-   Update deps

## 0.1.1

### Patch Changes

-   Removed wrong module export in package.json

## 0.1.0

### Minor Changes

-   Handle more status code errors

## 0.0.6

### Patch Changes

-   use error status code if available

## 0.0.5

### Patch Changes

-   Handle more errors like service unavailable

## 0.0.4

### Patch Changes

-   Add retryAfterOutput to retry even if error is thrown after stream started

## 0.0.3

### Patch Changes

-   Removed logger option

## 0.0.2

### Patch Changes

-   Fix repo url

## 0.0.1

### Patch Changes

-   Init
