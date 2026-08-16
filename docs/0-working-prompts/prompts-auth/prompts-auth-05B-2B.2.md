請修正 staging 的 wallet-ops CORS 預檢錯誤，不得重構，不得部署 production。

現象：
從 http://localhost:5588/gacha.html 呼叫：
https://<project-ref>.supabase.co/functions/v1/wallet-ops/gacha-draw

瀏覽器顯示：
Response to preflight request doesn't pass access control check:
It does not have HTTP ok status.

要求：

1. 先從 Network/Edge Function logs 確認 OPTIONS 的實際 status：
- 404：確認 wallet-ops 是否部署到正確 staging project。
- 401：確認 JWT gateway/config，但不得直接關閉身份驗證。
- 403：確認 localhost:5588 是否缺少於 CORS allowlist。
- 500/503：修正 function boot/import/env 錯誤。

2. wallet-ops 必須在解析路由、JSON及驗證 JWT之前處理 OPTIONS：

if (req.method === "OPTIONS") {
  return new Response("ok", {
    status: 200,
    headers: corsHeaders
  });
}

3. 所有成功與錯誤 response 都必須包含相同 CORS headers，至少允許：
- http://localhost:5500
- http://localhost:5588
- staging 網址

不得使用任意 Origin 搭配 credentials。
不得加入 production 未確認網址。

4. 允許 headers 必須涵蓋 Supabase client 使用的：
authorization, x-client-info, apikey, content-type

允許 methods 至少包含：
POST, OPTIONS

可優先使用官方：
import { corsHeaders } from "@supabase/supabase-js/cors";

5. wallet-ops 必須維持使用者 JWT 驗證：
- 不得因修 CORS 就移除 resolveAuthenticatedUser。
- 不得改成公開 wallet API。
- 除非能證明 gateway 阻擋 OPTIONS，否則不得設定 verify_jwt=false。
- 若不得不關閉 gateway verify_jwt，handler 內仍必須嚴格驗證使用者 access token；未驗證請求回 401。

6. 只部署 wallet-ops 到已確認的 staging project。

7. 部署後驗證：
- OPTIONS 回 200/204。
- Access-Control-Allow-Origin 與 http://localhost:5588 相符。
- 實際 POST 不再出現 CORS。
- 無 JWT 的 POST 回 401。
- 有效匿名／正式使用者 JWT 可呼叫。
- 抽獎只扣款、發獎一次。
- retry 沿用原 idempotency key。

輸出 review-auth-05C-wallet-ops-cors-hotfix.md，記錄根因、OPTIONS status、修改檔案、部署目標及測試結果。不得部署 production。