// api/sentry-frontend.js
import {config as sharedConfig, formatSlackMessage, methodGuard, postToSlack} from "./_sentrySlack.js";

export const config = sharedConfig;

export default async function handler(req, res) {
    if (!methodGuard(req, res)) return;

    const channel = process.env.SLACK_CHANNEL_FRONTEND;
    if (!channel) return res.status(500).json({error: "Missing SLACK_CHANNEL_FRONTEND"});

    try {
        const payload = formatSlackMessage(req.body || {});
        await postToSlack(channel, payload);

        res.status(200).json({ok: true});
    } catch (err) {
        console.error("sentry-frontend error:", err);
        res.status(500).json({error: String(err?.message || err)});
    }
}
