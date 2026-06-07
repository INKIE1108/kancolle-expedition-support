# 艦これ遠征サポート v2.2

艦これ本体は手動操作のまま、遠征タイマー、終了予定時刻、Discord通知予約、成功条件確認、攻略支援、帰投記録、PWA、提督ログイン同期をまとめて管理するサポートツールです。

## v2.2 の主な変更

- 初めて触る人にも伝わりやすいよう、提督ログイン、PWA、通知設定の説明文を整理
- 端末ごとの時計ズレによる残り時間差を減らすため、Vercel API `/api/server-time` でサーバー時刻同期を追加
- タイマー開始時の `startAt` / `endAt` をサーバー時刻補正後の時刻で作成
- ヘッダーの現在時刻欄に「サーバー時刻と同期中」などの状態を表示

## v2.1 から継続している主な機能

- スマホ下部タブ（タイマー / 攻略 / 一覧 / 設定）の表示切替
- 実行中タイマーをクラウド同期できる `active_timers` テーブル対応
- Discord通知は提督ごとの個人Webhook URL + サーバー側通知予約に一本化
- 簡易カードでもお気に入りショートカット（★02など）を表示

## 起動

```bash
npm install
npm run dev
```

## ビルド

```bash
npm run build
```

## Vercel 環境変数

最低限必要です。

```txt
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
CRON_SECRET=ランダム文字列
```

`DISCORD_WEBHOOK_URL` はv2.2では通常不要です。旧安全モード互換やフォールバック用として残しても動きます。

## Supabase SQL

`supabase/schema.sql` をSupabase SQL Editorで実行してください。

- `user_settings`: 提督ごとの設定・お気に入り・プリセット・Webhook URLなど
- `active_timers`: 実行中タイマーの同期
- `scheduled_notifications`: サーバー側Discord通知予約
