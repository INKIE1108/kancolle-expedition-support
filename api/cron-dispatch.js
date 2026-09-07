import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { deliverNotification, deliveryUpdate, MAX_ATTEMPTS } from '../server/notifications.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ ok: false });
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ ok: false, error: 'CRON_SECRET is not configured' });
  const auth = req.headers.authorization;
  // Secrets in URLs leak into access logs; support only headers.
  if (auth !== `Bearer ${secret}` && req.headers['x-cron-secret'] !== secret) return res.status(401).json({ ok: false });
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(500).json({ ok: false, error: 'Supabase is not configured' });
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const publicKey = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const pushConfigured = Boolean(publicKey && privateKey);
  const now = new Date().toISOString();
  try {
    if (pushConfigured) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:example@example.com', publicKey, privateKey);
    // Recover abandoned claims after a ten-minute lease. Never touch cancelled rows.
    const { error: recoveryError } = await db.from('scheduled_notifications').update({ status: 'pending', claimed_at: null })
      .eq('status', 'processing').lt('claimed_at', new Date(Date.now() - 600000).toISOString());
    if (recoveryError) throw recoveryError;
    const { data, error } = await db.from('scheduled_notifications').select('*').eq('status', 'pending')
      .lte('end_at', now).or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
      .order('end_at', { ascending: true }).limit(5);
    if (error) throw error;
    const results = await Promise.all((data || []).map(async row => {
      // Compare-and-set claim: overlapping dispatches cannot both win this row.
      const { data: item, error } = await db.from('scheduled_notifications')
        .update({ status: 'processing', attempts: row.attempts + 1, claimed_at: now })
        .eq('id', row.id).eq('status', 'pending').eq('attempts', row.attempts).select('*').maybeSingle();
      if (error) throw error;
      if (!item) return { id: row.id, status: 'claimed_elsewhere' };
      let result;
      try {
        if (row.attempts >= MAX_ATTEMPTS) throw new Error('通知再送の上限に達しました');
        result = await deliverNotification(db, item, {
          pushConfigured,
          sendDiscord: async (webhookUrl, content) => {
            const response = await fetch(webhookUrl, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
              headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, allowed_mentions: { parse: [] } }) });
            if (!response.ok) throw new Error(`Discord ${response.status}`);
          },
          sendPush: (s, payload) => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { timeout: 8000 })
        });
      } catch (error) {
        // Read back destination checkpoints so an error never wipes successful deliveries.
        const { data: saved, error: readError } = await db.from('scheduled_notifications').select('delivery_state').eq('id', item.id).single();
        if (readError) throw readError;
        result = { delivered: saved.delivery_state || {}, errors: [String(error.message)] };
      }
      const update = deliveryUpdate(item, result);
      const { data: updated, error: updateError } = await db.from('scheduled_notifications').update(update)
        .eq('id', item.id).eq('status', 'processing').eq('attempts', item.attempts).select('id');
      if (updateError) throw updateError;
      return { id: item.id, status: updated?.length ? update.status : 'cancelled', attempts: item.attempts };
    }));
    const failed = results.filter(r => r.status === 'error').length;
    return res.status(failed ? 502 : 200).json({ ok: failed === 0, checkedAt: now, count: results.length, retrying: results.filter(r => r.status === 'pending').length, failed, results });
  } catch (error) { return res.status(500).json({ ok: false, error: String(error.message) }); }
}
