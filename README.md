# 艦これ遠征サポート v2.1

艦これの遠征タイマー、終了予定時刻、Discord通知予約、成功条件確認、攻略支援、帰投記録、PWA、提督ログイン同期をまとめた手動操作前提ツールです。

## v2.1 の主な変更

- スマホ下部タブ（タイマー / 攻略 / 一覧 / 設定）の表示切替を修正
- 実行中タイマーをクラウド同期できる `active_timers` テーブルに対応
- Discord通知はシンプル化し、提督ごとの個人Webhook URL + サーバー側通知予約に一本化
- 通知設定UIから安全モード/個人URLモード/端末内通知の選択を削除
- 現在時刻の表示が枠からはみ出しにくいよう調整
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

`DISCORD_WEBHOOK_URL` はv2.1では通常不要です。旧安全モード互換やフォールバック用として残しても動きます。

## Supabase SQL

`supabase/schema.sql` をSupabase SQL Editorで実行してください。v2.1では以下を使います。

- `user_settings`: 提督ごとの設定・お気に入り・プリセット・Webhook URLなど
- `active_timers`: 実行中タイマーの同期
- `scheduled_notifications`: サーバー側Discord通知予約

