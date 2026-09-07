// Legacy shared-webhook relay is intentionally retired. Notification reservations are
// authenticated through Supabase RLS and use the account's own destination instead.
export default function handler(_request, response) {
  response.setHeader('Cache-Control', 'no-store');
  return response.status(410).json({ error: '通知設定から個別WebhookまたはPush通知を利用してください。' });
}
