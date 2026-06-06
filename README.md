# 艦これ遠征サポート v2.0

艦これの遠征タイマー、終了予定時刻、PC通知、Discord通知、成功条件確認、攻略支援、帰投記録、PWA、Web公開、外部JSON、提督ログイン、クラウド同期、サーバー側通知予約をまとめた手動操作前提ツールです。

## v2.0の主な追加

- v1.4: スマホUI最適化
  - スマホ下部タブ: タイマー / 攻略 / 一覧 / 設定
  - 艦隊カード簡易表示切替
  - スマホでは必要な画面だけ表示しやすい構成
- v1.5: Supabaseログインと提督別データ保存
  - メール・パスワードログイン
  - お気に入り、プリセット、履歴、設定をクラウド保存/読込
- v2.0: サーバー側通知の土台
  - 遠征開始時にSupabaseへ通知予約
  - `/api/cron-dispatch` で期限切れ通知をDiscordへ送信

## 開発

```bash
npm install
npm run dev
```

## ビルド

```bash
npm run build
```

## デプロイ

Vercel推奨。

- Build Command: `npm run build`
- Output Directory: `dist`

## 環境変数

`.env.example` を参照してください。Supabase連携を使わない場合、従来通りLocalStorageのみで動きます。

詳しいSupabase設定は `SUPABASE_SETUP.md` を参照してください。
