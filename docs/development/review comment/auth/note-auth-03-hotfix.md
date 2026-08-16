| 項目                             | 判定     | 說明                                               |   |                                         |
| ------------------------------ | ------ | ------------------------------------------------ | - | --------------------------------------- |
| Identity 驗證邏輯改為 OR             | ✅ PASS | `isEmailVerified()                               |   | isGoogleVerified()` 符合原始需求「至少一種永久登入身分」。 |
| Session / JWT / Anonymous 條件保留 | ✅ PASS | 沒有放寬其他安全條件，只修正 Identity 判斷。                      |   |                                         |
| 單元測試更新                         | ✅ PASS | 移除舊 AND 測試，新增 Email-only、Google-only、皆無三種 OR 情境。 |   |                                         |
| 不影響 UI / Database / Checkout   | ✅ PASS | Hotfix 範圍控制得很好，沒有引入其他變更。                         |   |                                         |
| Regression                     | ✅ PASS | 279/279 測試全部通過。                                  |   |                                         |
建議同步更新規格

除了程式修正，我也建議同步修改 003-spec-auth-subscription.md，避免未來有人依照舊文字再次實作成 Email && Google。

建議將 Official User 定義明確寫成：

「已驗證至少一種可再次登入的永久 Identity（Email、Google 或其他支援的 Identity）即可視為 Official User。」

如此規格與程式就會保持一致，也能避免後續維護時再次出現相同的歧義。