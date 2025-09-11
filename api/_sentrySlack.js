// api/_sentrySlack.js
// -----------------------------------------------------------------------------
// Purpose:
//   Format compact, readable Slack alerts from Sentry webhooks and send them
//   using your Slack App Bot token.
//
// Env required (Vercel → Project → Settings → Environment Variables):
//   - SLACK_APP_AUTH_TOKEN = xoxb-... (Bot User OAuth Token)
// Scopes required (Slack):
//   - chat:write  (+ chat:write.public if posting to public channels your bot isn't in)
// -----------------------------------------------------------------------------

export const config = {
    api: { bodyParser: { sizeLimit: "2mb" } },
};

const LEVEL_EMOJI = {
    fatal: "🔥",
    error: "🚨",
    warning: "⚠️",
    info: "ℹ️",
    debug: "🐞",
};

// ---------- tiny helpers (keep things pretty) ----------
function getTag(tags = [], key) {
    try {
        const t = tags.find(pair => Array.isArray(pair) && pair[0] === key);
        return t ? t[1] : undefined;
    } catch {
        return undefined;
    }
}

function ellipsize(str, max = 120) {
    if (!str || typeof str !== "string") return str;
    return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

function shortenPath(p, keep = 2) {
    if (!p || typeof p !== "string") return p;
    const parts = p.split("/").filter(Boolean);
    if (parts.length <= keep) return p;
    return `…/${parts.slice(-keep).join("/")}`;
}

function toSlackDate(ev) {
    let epoch = null;
    if (ev?.datetime) {
        const ms = Date.parse(ev.datetime);
        if (!Number.isNaN(ms)) epoch = Math.floor(ms / 1000);
    } else if (typeof ev?.timestamp === "number") {
        epoch = Math.floor(ev.timestamp);
    }
    if (epoch == null) return null;
    return `<!date^${epoch}^{date_short_pretty} {time}|${new Date(epoch * 1000).toISOString()}>`;
}

function isFrontend(ev) {
    // Heuristic: if Sentry reports browser context/tags, treat as frontend
    return Boolean(
        ev?.contexts?.browser?.name ||
        getTag(ev?.tags, "browser") ||
        getTag(ev?.tags, "client_os")
    );
}

// ---------- main formatter ----------
export function formatSlackMessage(body) {
    const action = body?.action;               // e.g., "triggered"
    const ev = body?.data?.event ?? {};
    const level = (ev.level || getTag(ev.tags, "level") || "error").toLowerCase();
    const emoji = LEVEL_EMOJI[level] || "🚨";
    const environment = ev.environment || getTag(ev.tags, "environment") || "unknown";

    // Build a concise, readable header title
    const errorType = ev.metadata?.type || "";
    const rawMessage =
        ev.metadata?.value ||
        ev.title ||
        ev.message ||
        ev?.logentry?.formatted ||
        "Sentry Event";

    const shortMessage = ellipsize(rawMessage, 100);
    const headerTitle = `[${environment}] ${level.toUpperCase()} • ${shortMessage}`;

    // Keep culprit short (last 2 path parts)
    const culprit =
        ev.culprit ||
        ev.location ||
        ev.metadata?.filename ||
        "";
    const niceCulprit = culprit ? shortenPath(culprit, 2) : "";

    const slackWhen = toSlackDate(ev);

    // Useful links
    const eventWebUrl = ev.web_url;
    const issueApiUrl = ev.issue_url;
    const reqUrl = ev.request?.url || getTag(ev.tags, "url");

    // Select a few high-signal fields (max ~4)
    const fields = [];
    if (slackWhen) fields.push({ type: "mrkdwn", text: `*When:*\n${slackWhen}` });
    fields.push({ type: "mrkdwn", text: `*Env:*\n${environment}` });

    if (isFrontend(ev)) {
        const browser =
            ev?.contexts?.browser?.name && ev?.contexts?.browser?.version
                ? `${ev.contexts.browser.name} ${ev.contexts.browser.version}`
                : getTag(ev.tags, "browser");
        const os =
            ev?.contexts?.client_os?.name && ev?.contexts?.client_os?.version
                ? `${ev.contexts.client_os.name} ${ev.contexts.client_os.version}`
                : getTag(ev.tags, "client_os");
        if (browser) fields.push({ type: "mrkdwn", text: `*Browser:*\n${browser}` });
        if (os) fields.push({ type: "mrkdwn", text: `*OS:*\n${os}` });
    } else {
        // Backend: prefer request URL if present
        if (reqUrl) fields.push({ type: "mrkdwn", text: `*Request:*\n<${reqUrl}|Open>` });
    }

    const userBits = [ev.user?.email, ev.user?.id || getTag(ev.tags, "user")]
        .filter(Boolean).join(" • ");
    if (userBits) fields.push({ type: "mrkdwn", text: `*User:*\n${userBits}` });

    // Cap fields to avoid clutter
    const MAX_FIELDS = 4;
    const compactFields = fields.slice(0, MAX_FIELDS);

    // Light context with IDs (subtle, non-distracting)
    const projectId = ev.project;
    const issueId = ev.issue_id;
    const contextItems = [
        projectId ? `Project: ${projectId}` : null,
        issueId ? `Issue: ${issueId}` : null,
        errorType ? `Type: ${errorType}` : null,
    ].filter(Boolean);

    // Build blocks
    const blocks = [
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text:
                    `*${emoji} ${headerTitle}*` +
                    (action ? `  •  _${action}_` : "") +
                    (niceCulprit ? `\n*Culprit:* \`${niceCulprit}\`` : ""),
            },
        },
        ...(compactFields.length ? [{ type: "section", fields: compactFields }] : []),
        ...(contextItems.length
            ? [{ type: "context", elements: [{ type: "mrkdwn", text: contextItems.join("  •  ") }] }]
            : []),
        ...(eventWebUrl || reqUrl || issueApiUrl
            ? [{
                type: "actions",
                elements: [
                    ...(eventWebUrl ? [{ type: "button", text: { type: "plain_text", text: "Open in Sentry" }, url: eventWebUrl }] : []),
                    ...(reqUrl ? [{ type: "button", text: { type: "plain_text", text: "Request" }, url: reqUrl }] : []),
                    ...(issueApiUrl ? [{ type: "button", text: { type: "plain_text", text: "Issue API" }, url: issueApiUrl }] : []),
                ],
            }]
            : []),
        { type: "divider" },
    ];

    return {
        text: `${emoji} ${headerTitle}`, // fallback (notifications/previews)
        blocks,
    };
}

// ---------- sender ----------
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
        body: JSON.stringify({ channel, ...payload }),
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

// ---------- method guard ----------
export function methodGuard(req, res) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        res.status(405).json({ error: "Method not allowed" });
        return false;
    }
    return true;
}
