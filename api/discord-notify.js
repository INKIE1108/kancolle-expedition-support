export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).send("Method Not Allowed");
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    return response.status(500).send("DISCORD_WEBHOOK_URL is not set on Vercel.");
  }

  try {
    const body = request.body || {};
    const content = typeof body.content === "string" ? body.content.slice(0, 1900) : "";
    if (!content.trim()) {
      return response.status(400).send("content is required.");
    }

    const discordResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content })
    });

    if (!discordResponse.ok) {
      const errorText = await discordResponse.text().catch(() => "");
      return response.status(502).send(`Discord webhook failed: ${discordResponse.status} ${errorText}`);
    }

    return response.status(204).end();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return response.status(500).send(message);
  }
}
