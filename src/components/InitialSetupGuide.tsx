type Props = {
  loggedIn: boolean;
  webhookRegistered: boolean;
  deviceRegistered: boolean;
  testNotificationDone: boolean;
  expeditionStarted: boolean;
  onJumpAccount?: () => void;
  onJumpNotification?: () => void;
  onJumpTimer?: () => void;
};

type GuideItem = {
  label: string;
  description: string;
  done: boolean;
  actionLabel: string;
  onAction?: () => void;
};

export function InitialSetupGuide({
  loggedIn,
  webhookRegistered,
  deviceRegistered,
  testNotificationDone,
  expeditionStarted,
  onJumpAccount,
  onJumpNotification,
  onJumpTimer
}: Props) {
  const items: GuideItem[] = [
    {
      label: "提督アカウント登録",
      description: "メールアドレスとパスワードでログインして、端末間で設定を同期できるようにする。",
      done: loggedIn,
      actionLabel: "アカウント欄へ",
      onAction: onJumpAccount
    },
    {
      label: "Discord Webhook URL登録",
      description: "遠征終了をDiscordチャンネルへ送れるようにする。",
      done: webhookRegistered,
      actionLabel: "通知設定へ",
      onAction: onJumpNotification
    },
    {
      label: "スマホ通知を有効化",
      description: "スマホやPCのPWA通知を受け取れるように、この端末を通知先として登録する。",
      done: deviceRegistered,
      actionLabel: "通知端末へ",
      onAction: onJumpNotification
    },
    {
      label: "通知テスト",
      description: "Discord通知とスマホ/PWA通知が実際に届くか確認する。",
      done: testNotificationDone,
      actionLabel: "テストする",
      onAction: onJumpNotification
    },
    {
      label: "遠征開始",
      description: "通知予約ONのまま遠征を開始して、終了時に通知が来るか確認する。",
      done: expeditionStarted,
      actionLabel: "タイマーへ",
      onAction: onJumpTimer
    }
  ];

  const doneCount = items.filter((item) => item.done).length;
  const allDone = doneCount === items.length;

  return (
    <section className="setup-guide-card">
      <div className="mini-heading">FIRST SETUP</div>
      <div className="setup-guide-header">
        <div>
          <h2>初回設定ガイド</h2>
          <p>
            初めて使う人は、上から順番に進めるだけで遠征通知を使えるようになるよ。
          </p>
        </div>
        <div className="setup-progress">
          {doneCount} / {items.length}
        </div>
      </div>

      <div className="setup-progress-bar">
        <div style={{ width: `${(doneCount / items.length) * 100}%` }} />
      </div>

      {allDone ? (
        <div className="setup-complete-message">
          初回設定は完了！あとは遠征を選んで通知予約ONで開始すればOK。
        </div>
      ) : null}

      <div className="setup-guide-list">
        {items.map((item, index) => (
          <div className={`setup-guide-item ${item.done ? "done" : ""}`} key={item.label}>
            <div className="setup-guide-check">
              {item.done ? "✓" : index + 1}
            </div>

            <div className="setup-guide-body">
              <strong>{item.label}</strong>
              <p>{item.description}</p>
            </div>

            <button type="button" onClick={item.onAction} disabled={item.done && allDone}>
              {item.done ? "完了" : item.actionLabel}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
