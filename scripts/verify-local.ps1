Write-Host "== Syntax Check =="

node --check js/services/wallpaper/generation-service.js
node --check js/services/wallpaper/generation-validator.js
node --check js/services/wallpaper/generation-repository.js
node --check js/services/wallpaper/response-dto.js
node --check js/services/wallpaper/generation-query-service.js
node --check js/services/wallpaper/generation-query-repository.js
node --check js/services/wallpaper/progress-response-dto.js
node --check js/api/wallpaper-generation-status-controller.js
node --check js/services/wallpaper/wallpaper-generation-client.js
node --check js/services/wallpaper/wallpaper-polling-service.js
node --check js/services/wallpaper/wallpaper-result-presenter.js
node --check js/services/wallpaper/wallpaper-selection-service.js
node --check js/services/wallpaper/job-repository.js
node --check js/services/wallpaper/job-service.js
node --check js/services/wallpaper/points-repository.js
node --check js/services/wallpaper/points-service.js
node --check js/services/wallpaper/usage-repository.js
node --check js/services/wallpaper/usage-service.js
node --check js/services/wallpaper/generation-orchestrator.js
node --check js/services/logging/correlation-id.js
node --check js/services/logging/generation-logger.js
node --check js/services/logging/generation-tracing.js
node --check js/services/ai/provider-adapter.js
node --check js/services/ai/provider-factory.js
node --check js/services/ai/gemini-provider.js
node --check js/services/ai/provider-types.js
node --check js/services/ai/wallpaper-provider-adapter.js
node --check js/services/storage/wallpaper-storage-uploader.js
node --check js/pages/wallpaper.js
node --check supabase/functions/_shared/wallpaper-generate-handler.js
node --check supabase/functions/_shared/wallpaper-status-handler.js

Write-Host ""

Write-Host "== Unit Tests =="

node --test `
  "js/services/ai/__tests__/*.test.js" `
  "js/services/prompt/__tests__/*.test.js" `
  "js/services/wallpaper/__tests__/*.test.js" `
  "js/services/storage/__tests__/*.test.js" `
  "supabase/functions/_shared/__tests__/*.test.js"

Write-Host ""

Write-Host "Verification Complete"