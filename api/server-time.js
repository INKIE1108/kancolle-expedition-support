export default function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const now = Date.now();
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(200).json({ ok: true, serverTimeMs: now, serverTimeIso: new Date(now).toISOString() });
}
