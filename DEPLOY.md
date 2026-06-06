# 艦これ遠征サポート v1.1 Web公開手順

このプロジェクトは React + Vite の静的Webアプリです。公開時は `npm run build` で `dist/` を作り、その `dist/` を Vercel / Cloudflare Pages / GitHub Pages などへ配置します。

## 0. ローカル確認

```bash
npm install
npm run deploy:check
npm run preview
```

`npm run preview` 後に表示されるURLを開いて、v1.1表記、PWA設定、通知設定、遠征タイマーが動くか確認してください。

## 1. GitHubにアップロードする

### コマンドで行う場合

```bash
git init
git add .
git commit -m "Release v1.1 web publish support"
git branch -M main
git remote add origin https://github.com/<GitHubユーザー名>/<リポジトリ名>.git
git push -u origin main
```

`<GitHubユーザー名>` と `<リポジトリ名>` は自分のものに置き換えてください。

### GitHub Desktopで行う場合

1. GitHub Desktopを開く
2. `File` → `Add local repository`
3. このフォルダを選択
4. `Publish repository` を押す
5. Private/Publicを選ぶ
6. `Publish repository` を押す

個人利用なら Private でもOKです。VercelやCloudflare Pagesから接続する場合は、接続時にリポジトリへのアクセス許可を与えます。

## 2. Vercelで公開する（おすすめ・一番簡単）

1. VercelにGitHubアカウントでログイン
2. `Add New...` → `Project`
3. GitHubリポジトリをImport
4. Framework Preset が `Vite` になっていることを確認
5. Build Command: `npm run build`
6. Output Directory: `dist`
7. Deploy

公開後、`https://xxxxx.vercel.app` のようなURLが発行されます。PCやスマホでそのURLを開いて使えます。

## 3. Cloudflare Pagesで公開する

1. Cloudflare Dashboardを開く
2. `Workers & Pages` → `Create application` → `Pages`
3. `Connect to Git` を選択
4. GitHubリポジトリを選択
5. Build command: `npm run build`
6. Build output directory: `dist`
7. Deploy

Cloudflare Pages用に `public/_headers` と `public/_redirects` を同梱済みです。

## 4. GitHub Pagesで公開する

このプロジェクトには `.github/workflows/github-pages.yml` を同梱しています。

1. GitHubリポジトリの `Settings` を開く
2. `Pages` を開く
3. Source を `GitHub Actions` にする
4. `main` にpushする
5. Actionsが完了したら `https://<ユーザー名>.github.io/<リポジトリ名>/` で公開されます

GitHub Pagesはサブパス公開になることが多いため、Workflow内で `VITE_BASE_PATH=/<リポジトリ名>/` を指定しています。

## 5. 公開後の確認項目

- 公開URLで画面が開く
- 上部に `v1.1` と表示される
- PWA実用設定にオンライン表示が出る
- スマホで開いて「ホーム画面に追加」できる
- 設定を書き出し/読み込みできる
- Discord Webhook URLを入力してテスト通知できる
- ページを再読み込みしてもお気に入りやプリセットが残る

## 6. 注意：Discord Webhook URL

Webhook URLはブラウザのLocalStorageに保存しています。自分だけが使う場合は扱いやすいですが、共有端末では注意してください。

アプリのソースコードにWebhook URLを直書きしないでください。将来的には Cloudflare Workers などを使って、Webhook URLをサーバー側の環境変数に隠す構成にするのがおすすめです。

## 7. 更新手順

コードを変更したら、以下の流れです。

```bash
npm run deploy:check
git add .
git commit -m "Update app"
git push
```

Vercel / Cloudflare Pages / GitHub Pages は、push後に自動で再デプロイされます。
