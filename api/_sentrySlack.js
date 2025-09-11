// api/_sentrySlack.js
// -----------------------------------------------------------------------------
// Purpose:
//   Utilities used by your Vercel API routes to:
//     1) Parse Sentry webhook payloads
//     2) Build a readable Slack Block Kit message
//     3) Post the message using your Slack App Bot token (chat.postMessage)
//
// Requirements (Slack):
//   - Env var: SLACK_APP_AUTH_TOKEN = xoxb-... (Bot User OAuth Token)
//   - Your app must have scope: chat:write  (and chat:write.public if posting
//     to public channels the bot isn’t a member of)
//   - Invite the bot to the target channels
//
// -----------------------------------------------------------------------------

export const config = {
    api: {bodyParser: {sizeLimit: "2mb"}},
};

const LEVEL_EMOJI = {
    fatal: "🔥",
    error: "🚨",
    warning: "⚠️",
    info: "ℹ️",
    debug: "🐞",
};

function getTag(tags = [], key) {
    try {
        const t = tags.find(pair => Array.isArray(pair) && pair[0] === key);
        return t ? t[1] : undefined;
    } catch {
        return undefined;
    }
}

function toSlackDate(ev) {
    let epochSeconds = null;

    if (ev?.datetime) {
        const ms = Date.parse(ev.datetime);
        if (!Number.isNaN(ms)) epochSeconds = Math.floor(ms / 1000);
    } else if (typeof ev?.timestamp === "number") {
        epochSeconds = Math.floor(ev.timestamp);
    }

    if (epochSeconds == null) return null;

    return `<!date^${epochSeconds}^{date_short_pretty} {time}|${new Date(
        epochSeconds * 1000
    ).toISOString()}>`;
}

/**
 * Build a Slack Block Kit payload from a Sentry webhook body.
 */
export function formatSlackMessage(body) {
    const action = body?.action;
    const ev = body?.data?.event ?? {};

    const level = (ev.level || getTag(ev.tags, "level") || "error").toLowerCase();
    const emoji = LEVEL_EMOJI[level] || "🚨";

    // Env comes either from event.environment or tags
    const environment =
        ev.environment || getTag(ev.tags, "environment") || "unknown";

    // Better title: [env] LEVEL: message
    const shortTitle =
        ev.metadata?.value ||
        ev.title ||
        ev.message ||
        ev?.logentry?.formatted ||
        "Sentry Event";

    const culprit =
        ev.culprit ||
        ev.location ||
        ev.metadata?.filename ||
        "";

    const projectId = ev.project;
    const issueId = ev.issue_id;

    const eventWebUrl = ev.web_url;
    const issueApiUrl = ev.issue_url;
    const reqUrl = ev.request?.url || getTag(ev.tags, "url");

    const browser =
        ev?.contexts?.browser?.name && ev?.contexts?.browser?.version
            ? `${ev.contexts.browser.name} ${ev.contexts.browser.version}`
            : getTag(ev.tags, "browser");

    const os =
        ev?.contexts?.client_os?.name && ev?.contexts?.client_os?.version
            ? `${ev.contexts.client_os.name} ${ev.contexts.client_os.version}`
            : getTag(ev.tags, "client_os");

    const userBits = [
        ev.user?.email,
        ev.user?.id || getTag(ev.tags, "user"),
    ].filter(Boolean).join(" • ");

    const slackWhen = toSlackDate(ev);

    const fields = [];
    if (projectId) fields.push({type: "mrkdwn", text: `*Project ID:*\n${projectId}`});
    if (issueId) fields.push({type: "mrkdwn", text: `*Issue ID:*\n${issueId}`});
    if (environment) fields.push({type: "mrkdwn", text: `*Env:*\n${environment}`});
    if (slackWhen) fields.push({type: "mrkdwn", text: `*When:*\n${slackWhen}`});
    if (browser) fields.push({type: "mrkdwn", text: `*Browser:*\n${browser}`});
    if (os) fields.push({type: "mrkdwn", text: `*OS:*\n${os}`});
    if (userBits) fields.push({type: "mrkdwn", text: `*User:*\n${userBits}`});

    const links = [];
    if (eventWebUrl) links.push(`<${eventWebUrl}|Open in Sentry>`);
    if (issueApiUrl) links.push(`<${issueApiUrl}|Issue API>`);
    if (reqUrl) links.push(`<${reqUrl}|Request URL>`);

    return {
        text: `${emoji} [${environment}] ${level.toUpperCase()}: ${shortTitle}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text:
                        `*${emoji} [${environment}] Sentry ${level.toUpperCase()}*` +
                        (action ? `  •  _${action}_` : "") +
                        `\n*Title:* ${shortTitle}` +
                        (culprit ? `\n*Culprit:* \`${culprit}\`` : ""),
                },
            },
            ...(fields.length ? [{type: "section", fields}] : []),
            ...(links.length
                ? [{type: "context", elements: [{type: "mrkdwn", text: links.join("  •  ")}]}]
                : []),
            {type: "divider"},
        ],
    };
}

/**
 * Send a message to Slack via chat.postMessage using your Slack App Bot token.
 */
export async function postToSlack(channel, payload) {
    const token = process.env.SLACK_APP_AUTH_TOKEN;
    if (!token) throw new Error("Missing SLACK_APP_AUTH_TOKEN");
    if (!channel) throw new Error("Missing Slack channel id");

    const resp = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({channel, ...payload}),
    });

    if (resp.status === 429) {
        const retryAfter = parseInt(resp.headers.get("retry-after") || "1", 10);
        await new Promise(r => setTimeout(r, (Number.isFinite(retryAfter) ? retryAfter : 1) * 1000));
        return postToSlack(channel, payload);
    }

    const data = await resp.json().catch(() => ({}));
    if (!data.ok) {
        throw new Error(`Slack API error: ${data.error || resp.statusText}`);
    }
    return data;
}

/**
 * Restrict route to POST; respond 405 otherwise.
 */
export function methodGuard(req, res) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        res.status(405).json({error: "Method not allowed"});
        return false;
    }
    return true;
}
