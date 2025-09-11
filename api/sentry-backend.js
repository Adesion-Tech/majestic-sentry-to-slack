// api/sentry-backend.js
import { config as sharedConfig, formatSlackMessage, postToSlack, methodGuard } from "./_sentrySlack.js";

export const config = sharedConfig;

export default async function handler(req, res) {
  if (!methodGuard(req, res)) return;

  try {
    const channel = process.env.SLACK_CHANNEL_BACKEND;
    if (!channel) return res.status(500).json({ error: "Missing SLACK_CHANNEL_BACKEND" });

    const payload = formatSlackMessage(req.body || {});
    await postToSlack(channel, payload);

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("sentry-backend error:", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
}
