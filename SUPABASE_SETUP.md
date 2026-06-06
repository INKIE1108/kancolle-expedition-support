# Supabaseログイン・サーバー側通知セットアップ

## 1. Supabaseプロジェクト作成

1. SupabaseでNew projectを作る
2. Project Settings > API を開く
3. Project URL と anon public key をコピー
4. service_role key もコピー（これは絶対に公開しない）

## 2. SQLを実行

Supabase Dashboard > SQL Editor で `supabase/schema.sql` の内容を実行する。

作成されるテーブル:

- `user_settings`: 提督ごとのお気に入り、プリセット、履歴などのクラウド保存
- `scheduled_notifications`: サーバー側通知予約

どちらもRLSを有効化して、ログインした本人の行だけ読み書きできるようにしている。

## 3. Vercel環境変数

Vercel Project > Settings > Environment Variables で以下をProductionに追加する。

```txt
VITE_SUPABASE_URL=Supabase Project URL
VITE_SUPABASE_ANON_KEY=Supabase anon public key
SUPABASE_SERVICE_ROLE_KEY=Supabase service_role key
DISCORD_WEBHOOK_URL=Discord Webhook URL
CRON_SECRET=好きな長いランダム文字列
```

保存後、必ずRedeployする。

## 4. サーバー側通知の起動方法

遠征開始時にアプリ側が `scheduled_notifications` に通知予約を入れる。
通知送信は `/api/cron-dispatch` を定期的に呼ぶことで実行される。

例:

```txt
https://kancolle-expedition-support.vercel.app/api/cron-dispatch
```

`CRON_SECRET` を設定している場合は、外部Cronサービス側でHTTP Headerに以下を付ける。

```txt
Authorization: Bearer <CRON_SECRET>
```

Vercel HobbyのCronは頻繁な実行に制限があるため、数分おき通知を安定させるなら外部CronサービスやCloudflare Workers Cronの利用を推奨。
