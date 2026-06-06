# 艦これ遠征サポート v1.3

艦これの遠征タイマー、終了予定時刻、PC通知、Discord通知、成功条件確認、攻略支援、帰投記録、PWA、バックアップをまとめた手動操作前提ツールです。

## v1.2 / v1.3 の主な変更

- v1.2: 遠征データをJSON化
  - 実データ: `public/data/expeditions.json`
  - フォールバック: `src/data/expeditions-fallback.json`
  - 起動時に `/data/expeditions.json` を読み込み、失敗時は内蔵フォールバックで継続します。
- v1.3: Discord Webhook安全モードを追加
  - `api/discord-notify.js` 経由で通知します。
  - VercelのEnvironment Variablesに `DISCORD_WEBHOOK_URL` を設定すると、ブラウザ側にWebhook URLを保存せずに通知できます。
  - 既存の「個人URLモード」も残してあります。

## ローカル起動

```bash
npm install
npm run dev
```

## ビルド確認

```bash
npm run build
npm run preview
```

## Web公開

Vercel推奨です。

- Build Command: `npm run build`
- Output Directory: `dist`
- Framework: `Vite`

## Discord安全モードの使い方

1. Vercel Dashboardを開く
2. 対象Projectを開く
3. Settings → Environment Variables
4. Name: `DISCORD_WEBHOOK_URL`
5. Value: DiscordのWebhook URL
6. Environment: Production / Preview / Development 必要に応じて選択
7. Save
8. DeploymentsからRedeploy、またはGitHubへpushして再デプロイ
9. アプリの通知設定で「安全モード」を選び、Discordテストを押す

## ユーザーログインについて

現時点ではログイン機能は未実装です。提督ごとのデータ管理を入れる場合は、Supabase Auth + Supabase Database、または Firebase Authentication + Firestore が候補です。

## 注意

このツールは艦これ本体の通信取得・自動操作・補給/再出発の自動クリックは行いません。補給、再出発、編成確認は手動で行う前提です。
