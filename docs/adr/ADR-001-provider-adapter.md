# Future Enhancements (Post-MVP)

The following improvements were identified during architecture review.
They are approved enhancements but are intentionally deferred to Phase 2
to avoid delaying MVP delivery.

## Provider Capability Discovery

Provider Adapter SHOULD support capability discovery in the future.

Example:

supports("image")
supports("vision")
supports("face_swap")
supports("streaming")

Business Layer MUST NOT determine provider capability by provider name.

---

## Provider Version Metadata

Adapter responses SHOULD include:

- provider
- providerVersion
- model

Example:

{
  "provider": "gemini",
  "providerVersion": "2.5",
  "model": "flash-image-preview"
}

---

## Correlation ID

Every request SHOULD include an internal correlationId.

Example lifecycle:

Wallpaper Generation
    ↓
Generation Job
    ↓
Provider Adapter
    ↓
AI Provider

This enables distributed tracing and debugging.

---

## Metrics Hook

Provider Adapter SHOULD expose an optional metrics hook.

Example:

onMetrics({
    provider,
    model,
    durationMs,
    success
})

Implementation is deferred.

---

## Streaming Support

Provider Adapter SHOULD support future streaming capability.

Example:

supportsStreaming()

Streaming is not required for MVP.