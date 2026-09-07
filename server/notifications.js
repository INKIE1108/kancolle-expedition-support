export const MAX_ATTEMPTS = 5;
export function isDiscordWebhook(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['discord.com', 'discordapp.com'].includes(url.hostname)
      && /^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname)
      && !url.search && !url.hash;
  } catch { return false; }
}
export function isPushEndpoint(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
      (['fcm.googleapis.com', 'updates.push.services.mozilla.com'].includes(u.hostname)
        || /(^|\.)notify\.windows\.com$/.test(u.hostname)
        || /(^|\.)push\.apple\.com$/.test(u.hostname));
  } catch { return false; }
}
export function pushPayload(item) {
  return JSON.stringify({ title: '艦これ遠征サポート', body: String(item.content).replace(/\*\*/g, '').split('\n').slice(0, 4).join('\n'),
    tag: `kancolle-${item.id}`, url: '/' });
}

// Persist each successful destination before retrying. External delivery and database commits
// cannot be atomic: a process crash immediately after delivery can still cause a duplicate.
export async function deliverNotification(db, item, { sendDiscord, sendPush, pushConfigured }) {
  const delivered = { ...(item.delivery_state || {}) };
  const errors = [];
  const save = async () => {
    const { error } = await db.from('scheduled_notifications').update({ delivery_state: delivered })
      .eq('id', item.id).eq('status', 'processing').eq('attempts', item.attempts);
    if (error) throw error;
  };
  // Serialize destination checkpoints to avoid losing keys with concurrent update writes.
  if (item.webhook_url && item.webhook_url !== 'push-only' && !delivered.discord) {
    try {
      if (!isDiscordWebhook(item.webhook_url)) throw new Error('Discord Webhook URLが不正です');
      await sendDiscord(item.webhook_url, item.content);
      delivered.discord = true;
      await save();
    } catch (error) { errors.push(String(error.message)); }
  }
  const { data: subscriptions, error } = await db.from('push_subscriptions').select('id,endpoint,p256dh,auth')
    .eq('user_id', item.user_id).eq('enabled', true);
  if (error) throw error;
  const pending = (subscriptions || []).filter(s => !delivered[`push:${s.id}`]);
  if (pending.length && !pushConfigured) errors.push('Push配信キーが未設定です');
  if (pushConfigured) {
    // Network work can run concurrently; persist the combined results before changing status.
    const outcomes = await Promise.all(pending.map(async subscription => {
      try {
        if (!isPushEndpoint(subscription.endpoint)) throw new Error('Unsupported push endpoint');
        await sendPush(subscription, pushPayload(item));
        return { subscription, ok: true };
      } catch (error) { return { subscription, error }; }
    }));
    for (const result of outcomes) {
      if (result.ok) delivered[`push:${result.subscription.id}`] = true;
      else if ([404, 410].includes(result.error?.statusCode)) {
        const { error } = await db.from('push_subscriptions').update({ enabled: false }).eq('id', result.subscription.id);
        if (error) errors.push(error.message);
      } else errors.push(String(result.error?.message || 'push_error'));
    }
    await save();
  }
  if (!Object.keys(delivered).length && !errors.length) errors.push('有効な通知先がありません');
  return { delivered, errors };
}

export function deliveryUpdate(item, result, now = Date.now()) {
  const failed = result.errors.length > 0;
  return {
    status: failed ? (item.attempts >= MAX_ATTEMPTS ? 'error' : 'pending') : 'sent',
    delivery_state: result.delivered,
    error_message: failed ? result.errors.join('; ').slice(0, 1000) : null,
    sent_at: failed ? null : new Date(now).toISOString(),
    next_attempt_at: failed ? new Date(now + Math.min(30, 2 ** item.attempts) * 60000).toISOString() : null,
    claimed_at: null
  };
}
