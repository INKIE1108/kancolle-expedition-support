# Supabase セットアップ v2.2

## 1. SQLを実行

Supabase Dashboard > SQL Editor で `supabase/schema.sql` を実行します。

v2.0から更新する場合も、同じSQLを再実行してOKです。`webhook_url` カラムと `active_timers` テーブルが追加されます。

## 2. Vercel環境変数

Vercel Project > Environment Variables に以下を登録します。

```txt
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
CRON_SECRET=ランダム文字列
```

`VITE_` 付きの値はブラウザ側で使われます。`SUPABASE_SERVICE_ROLE_KEY` には絶対に `VITE_` を付けないでください。

## 3. Redeploy

環境変数を追加・変更したらVercelでRedeployしてください。

## 4. アプリで確認

1. 提督アカウントでログイン
2. Discord Webhook URLを入力
3. `クラウドへ保存`
4. 艦隊カードの `通知予約` をON
5. 遠征開始
6. Supabaseの `active_timers` と `scheduled_notifications` に行が入ることを確認

## 5. 通知の実行

`/api/cron-dispatch` を外部Cronから定期的に呼びます。

```bash
curl -X POST https://<your-app>.vercel.app/api/cron-dispatch \
  -H "Authorization: Bearer <CRON_SECRET>"
```

期限切れの `pending` 通知があると、各通知行に保存された `webhook_url` へDiscord通知します。
