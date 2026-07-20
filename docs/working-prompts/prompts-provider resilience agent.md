Implement a deterministic Provider Resilience Agent for the AI Lucky
Wallpaper generation backend.

Goal:
Unify primary provider execution, fallback decisions, asynchronous
prediction handling, provider output normalization, and observability
behind one agent workflow.

The agent is an application workflow, not an autonomous LLM agent.
All provider switching and retry decisions must be deterministic and
configuration-driven.

Required workflow:

1. Receive the normalized GenerationRequest and GenerationContext.
2. Resolve the configured primary and fallback providers.
3. Execute the primary provider through the existing Provider Adapter.
4. Normalize any provider error without discarding the original:
   - provider
   - model
   - httpStatus
   - providerStatus
   - providerCode
   - providerMessage
   - retryable
   - correlationId
5. Evaluate fallback eligibility using a dedicated fallback policy.
6. Never fallback for:
   - invalid input
   - authentication or user authorization failures
   - daily limit failures
   - invalid reference images
   - content policy rejection
7. Fallback only for infrastructure/provider failures such as:
   - timeout
   - rate limit
   - provider unavailable
   - provider internal error
   - invalid provider response
   - unknown provider failure
8. Add a Replicate FLUX provider adapter.
9. Support Replicate asynchronous predictions:
   - create prediction
   - persist prediction ID
   - map prediction states
   - wait by bounded polling in the first implementation
   - design the interface so webhook completion can be added later
10. Normalize successful Replicate output into the existing
    GenerationResult contract.
11. Do not store a temporary Replicate URL as the final wallpaper URL.
    Pass the normalized result to the existing Storage Service.
12. Preserve the existing frontend polling and job status contract.
13. Limit execution to:
    - one primary attempt
    - one fallback provider
    - bounded retry and timeout
14. Add structured events:
    - generation_primary_started
    - generation_primary_failed
    - generation_fallback_started
    - replicate_prediction_created
    - replicate_prediction_processing
    - generation_fallback_succeeded
    - generation_fallback_failed
15. Never log API tokens, authorization headers, signed URL query
    parameters, base64 image content, or full user prompts.
16. Add unit tests for:
    - primary success
    - fallback-eligible primary failure
    - non-fallback-eligible failure
    - Replicate prediction success
    - Replicate prediction failure
    - Replicate prediction timeout
    - invalid Replicate output
    - both providers failing
    - no duplicate Job completion
17. Preserve the current Generation Orchestrator, Prompt Registry,
    Storage Service, frontend API contract, and database RLS behavior.

Proposed files:

- agents/provider-resilience-agent.ts
- providers/replicate-flux-provider.ts
- providers/provider-registry.ts
- fallback/fallback-policy.ts
- predictions/prediction-runner.ts
- contracts/provider-error.ts

Before implementation:
- inspect the current provider adapter and generation service
- identify the smallest integration point
- present the implementation plan
- do not create a second competing orchestrator