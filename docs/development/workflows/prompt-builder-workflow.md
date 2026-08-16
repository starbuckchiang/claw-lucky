1.
Generation Service

↓

Mascot Repository

↓

完整 DTO

↓

Prompt Builder (Prompt Builder 不應自己查 mascot, 是一個pure function)


2.
Generation Service

↓

Prompt Context Resolver(新增)

↓

WallpaperPromptInput

↓

Prompt Builder

↓

Prompt

## Resolver負責：
UUID

↓

完整 mascot

UUID

↓

完整 gift

↓

日期

↓

style

↓

Builder


3. 
Generation Service
        │
        ▼
Prompt Context Resolver
        │
        ▼
Prompt Validator(新增)
        │
        ▼
Wallpaper Prompt Builder
        │
        ▼
Prompt Snapshot (修訂)
        │
        ▼
Provider Adapter

4. 部署到 Supabase（至少 Edge Function 更新）後，才能走完這整條鏈路

使用者
    ↓
Web UI
    ↓
Edge Function
    ↓
Generation Service
    ↓
Prompt Builder
    ↓
Gemini API
    ↓
Image
    ↓
Storage
    ↓
回傳給使用者