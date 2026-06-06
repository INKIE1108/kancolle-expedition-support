# 艦これ遠征サポート v1.1

艦これの遠征タイマー、終了予定時刻、PC通知、Discord通知、成功条件確認、攻略支援、帰投記録、PWA、バックアップをまとめた手動操作前提ツールです。

v1.1では、Vercel / Cloudflare Pages / GitHub Pages へ公開しやすい構成を追加しました。

## できること

- 第2〜第4艦隊の遠征タイマー管理
- 全63件の遠征データ表示
- お気に入り追加・解除・並び替え
- おすすめ遠征セット
- カスタムプリセット作成
- 攻略支援
- 今日の獲得資材記録
- PC通知
- Discord Webhook通知
- PWAインストール
- オフライン用Service Worker
- 設定バックアップ書き出し/読み込み
- 補助パネルの折りたたみ表示

## ローカル実行

```bash
npm install
npm run dev
```

表示されたURLをブラウザで開きます。

## 本番ビルド確認

```bash
npm run deploy:check
npm run preview
```

## Web公開

詳しい手順は [DEPLOY.md](./DEPLOY.md) を見てください。

おすすめは Vercel です。

- Build Command: `npm run build`
- Output Directory: `dist`
- Framework: `Vite`

## 注意

このツールは艦これ本体の通信取得、自動クリック、自動補給、自動遠征再出発などは行いません。補給や再出発はユーザーが手動で行う前提です。

遠征条件は更新・検証変更が起こる可能性があります。マンスリー遠征やドラム缶系遠征は、出撃前に最新情報も確認してください。
