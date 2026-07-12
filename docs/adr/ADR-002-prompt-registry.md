# Future Enhancements (Post-MVP)

## Cache Key Strategy

Current implementation caches by promptType.

Future implementation SHOULD support:

cacheKey =
promptType + version

This enables prompt rollback and version isolation.

---

## Metadata Validation

Prompt metadata SHOULD support schema validation.

Example:

metadata.schemaVersion

Missing schemaVersion SHOULD produce a warning,
not a runtime failure.

---

## Prompt Metrics

Prompt Loader SHOULD expose runtime metrics.

Example:

{
    source: "database",
    durationMs: 14
}

or

{
    source: "fallback",
    durationMs: 0
}

This will integrate with future observability dashboards.

---

## TTL Expiration Tests

Current tests cover:

✓ Success
✓ Fallback
✓ Invalid template

Future tests SHOULD include:

- cache expiration
- cache refresh
- stale cache rejection