# デプロイ手順 v2.0

## 通常更新

```bash
npm install
npm run build
git add .
git commit -m "Release v2.0 mobile auth and server notifications"
git push
```

Vercelが自動デプロイします。

## Vercel環境変数

Discord安全モードだけ使う場合:

```txt
DISCORD_WEBHOOK_URL=
```

Supabaseログイン・クラウド同期・サーバー側通知も使う場合:

```txt
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
```

追加後はRedeployが必要です。

## Supabase

`supabase/schema.sql` をSupabase SQL Editorで実行します。
詳細は `SUPABASE_SETUP.md` を参照してください。
