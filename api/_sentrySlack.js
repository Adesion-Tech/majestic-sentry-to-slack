// api/_sentrySlack.js

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
        const t = tags.find((pair) => Array.isArray(pair) && pair[0] === key);
        return t ? t[1] : undefined;
    } catch {
        return undefined;
    }
}

export function formatSlackMessage(body) {
    const action = body?.action;
    const ev = body?.data?.event ?? {};

    const level = (ev.level || getTag(ev.tags, "level") || "error").toLowerCase();
    const emoji = LEVEL_EMOJI[level] || "🚨";

    // Pretty title parts
    const environment = ev.environment || getTag(ev.tags, "environment") || "unknown";
    const errorType = ev?.metadata?.type;
    const shortTitle =
        ev?.metadata?.value ||
        ev.title ||
        ev.message ||
        ev?.logentry?.formatted ||
        "Sentry Event";

    // Final, prettier title: [env] LEVEL • short message
    const prettyTitle = `${level.toUpperCase()} • ${shortTitle}`;

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

    const timestampISO =
        ev.datetime ||
        (ev.timestamp ? new Date(ev.timestamp * 1000).toISOString() : undefined);

    const fields = [];
    // Surface environment explicitly
    fields.push({type: "mrkdwn", text: `*Env:*\n${environment}`});
    if (timestampISO) fields.push({type: "mrkdwn", text: `*When:*\n${timestampISO}`});
    if (browser) fields.push({type: "mrkdwn", text: `*Browser:*\n${browser}`});
    if (os) fields.push({type: "mrkdwn", text: `*OS:*\n${os}`});
    if (userBits) fields.push({type: "mrkdwn", text: `*User:*\n${userBits}`});

    const links = [];
    if (eventWebUrl) links.push(`<${eventWebUrl}|Open in Sentry>`);
    if (issueApiUrl) links.push(`<${issueApiUrl}|Issue API>`);
    if (reqUrl) links.push(`<${reqUrl}|Request URL>`);

    // Context line (compact metadata)
    const contextItems = [
        projectId ? `Project: ${projectId}` : null,
        issueId ? `Issue: ${issueId}` : null,
        errorType ? `Type: ${errorType}` : null,
    ].filter(Boolean);

    return {
        text: `${emoji} ${prettyTitle}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text:
                        `*${emoji} ${prettyTitle}*` +
                        (action ? `  •  _${action}_` : "") +
                        (culprit ? `\n*Culprit:* \`${culprit}\`` : ""),
                },
            },
            ...(fields.length ? [{type: "section", fields}] : []),
            ...(links.length
                ? [{type: "context", elements: [{type: "mrkdwn", text: links.join("  •  ")}]}]
                : []),
            ...(contextItems.length
                ? [{type: "context", elements: [{type: "mrkdwn", text: contextItems.join("  •  ")}]}]
                : []),
            {type: "divider"},
        ],
    };
}

export async function postToSlack(channel, payload) {
    const token = process.env.SLACK_APP_AUTH_TOKEN;
    if (!token) throw new Error("Missing SLACK_APP_AUTH_TOKEN");

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
        await new Promise((r) => setTimeout(r, (isNaN(retryAfter) ? 1 : retryAfter) * 1000));
        return postToSlack(channel, payload);
    }

    const data = await resp.json().catch(() => ({}));
    if (!data.ok) {
        throw new Error(`Slack API error: ${data.error || resp.statusText}`);
    }
    return data;
}

export function methodGuard(req, res) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        res.status(405).json({error: "Method not allowed"});
        return false;
    }
    return true;
}
