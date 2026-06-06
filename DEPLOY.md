# Deploy Guide v1.3

## 1. GitHubへ反映

v1.1ですでにGitHub連携済みの場合、v1.3のファイルで上書きしたあと以下を実行します。

```bash
git rm package-lock.json
npm install
git add .
git commit -m "Release v1.3 json data and secure discord webhook"
git push
```

`package-lock.json` は配布ZIP側の環境差で問題が出やすいため、このプロジェクトではGit管理から外しています。

## 2. Vercel Environment Variablesを設定

Discord安全モードを使う場合だけ必要です。

- Project → Settings → Environment Variables
- Name: `DISCORD_WEBHOOK_URL`
- Value: Discord Webhook URL
- Environment: Production / Preview / Development
- Save

保存後、再デプロイしてください。

## 3. アプリ側設定

公開URLを開き、通知設定で以下を選びます。

- 個人URLモード: ブラウザ側にWebhook URLを保存する従来方式
- 安全モード: Vercel側の `DISCORD_WEBHOOK_URL` を使う方式

安全モードではWebhook URL入力欄は不要です。

## 4. 遠征データ更新

遠征データを更新したい場合は、まず以下を編集します。

```txt
public/data/expeditions.json
```

フォールバックも同じ内容にしたい場合は、以下にもコピーします。

```txt
src/data/expeditions-fallback.json
```

その後、ビルド確認してpushします。

```bash
npm run build
git add .
git commit -m "Update expedition data"
git push
```
