function fmtISO(x) {
    if (!x) return undefined;
    try {
        // Accept ISO string or epoch seconds
        if (typeof x === "number") return new Date(x * 1000).toISOString();
        if (/^\d+$/.test(String(x))) return new Date(Number(x) * 1000).toISOString();
        return new Date(x).toISOString();
    } catch {
        return undefined;
    }
}

const LEVEL_ALIAS = {
    fatal: ":fire:",
    error: ":rotating_light:",
    warning: ":warning:",
    info: ":information_source:",
    debug: ":beetle:",
};
const STATUS_EMOJI = {
    unresolved: ":red_circle:",
    resolved: ":white_check_mark:",
    ignored: ":zzz:",
};

export function formatSlackMessage(body) {
    // --- Normalization for both Sentry event webhooks and Issue API responses ---
    const ev = body?.data?.event ?? {};     // event-style
    const issue = (!body?.data?.event && body?.id && body?.title) ? body : null; // issue-style

    const level =
        (ev.level ||
            (Array.isArray(ev.tags) && ev.tags.find(t => t[0] === "level")?.[1]) ||
            issue?.level ||
            "error").toLowerCase();

    const status = issue?.status || ev?.issue_status; // ev.issue_status rarely present
    const substatus = issue?.substatus;
    const priority = issue?.priority || ev?.issue_priority;

    const baseEmoji = LEVEL_ALIAS[level] || ":rotating_light:";
    const statusEmoji = STATUS_EMOJI[status] || "";
    const escalatingEmoji = substatus === "escalating" ? " :chart_with_upwards_trend:" : "";

    const title =
        issue?.title ||
        ev.title ||
        ev.message ||
        ev?.logentry?.formatted ||
        "Sentry Event";

    const culprit =
        issue?.culprit ||
        ev.culprit ||
        ev.location ||
        ev.metadata?.filename ||
        "";

    const environment =
        ev.environment ||
        (Array.isArray(ev.tags) && ev.tags.find(t => t[0] === "environment")?.[1]) ||
        undefined;

    const errorType =
        issue?.metadata?.type ||
        ev?.metadata?.type ||
        undefined;

    const projectName =
        issue?.project?.name ||
        ev.project_slug ||
        ev.project ||
        undefined;

    const projectSlug =
        issue?.project?.slug ||
        ev.project_slug ||
        undefined;

    const platform =
        issue?.platform ||
        ev.platform ||
        ev?.contexts?.runtime?.name ||
        undefined;

    const eventWebUrl = ev.web_url || issue?.permalink;
    const issueApiUrl = ev.issue_url || (issue?.permalink ? `${issue.permalink}events/` : undefined);

    const reqUrl =
        ev.request?.url ||
        (Array.isArray(ev.tags) && ev.tags.find(t => t[0] === "url")?.[1]) ||
        undefined;

    const browser =
        (ev?.contexts?.browser?.name && ev?.contexts?.browser?.version)
            ? `${ev.contexts.browser.name} ${ev.contexts.browser.version}`
            : (Array.isArray(ev.tags) && ev.tags.find(t => t[0] === "browser")?.[1]) ||
            (Array.isArray(ev.tags) && ev.tags.find(t => t[0] === "browser.name")?.[1]) ||
            undefined;

    const os =
        (ev?.contexts?.client_os?.name && ev?.contexts?.client_os?.version)
            ? `${ev.contexts.client_os.name} ${ev.contexts.client_os.version}`
            : (Array.isArray(ev.tags) && ev.tags.find(t => t[0] === "client_os")?.[1]) ||
            (Array.isArray(ev.tags) && ev.tags.find(t => t[0] === "client_os.name")?.[1]) ||
            undefined;

    const userBits = [
        ev.user?.email,
        ev.user?.id ||
        (Array.isArray(ev.tags) && ev.tags.find(t => t[0] === "user")?.[1]),
    ].filter(Boolean).join(" • ");

    // Timestamps
    const timestampISO =
        ev.datetime || fmtISO(ev.timestamp);
    const firstSeen = issue?.firstSeen ? fmtISO(issue.firstSeen) : undefined;
    const lastSeen = issue?.lastSeen ? fmtISO(issue.lastSeen) : undefined;

    // Counts
    const eventCount = issue?.count ? Number(issue.count) : undefined;
    const userCount = issue?.userCount ?? undefined;

    // Releases
    const firstRel = issue?.firstRelease?.shortVersion || issue?.firstRelease?.versionInfo?.description;
    const lastRel = issue?.lastRelease?.shortVersion || issue?.lastRelease?.versionInfo?.description;

    // --- Compose fields grid (Blocks "fields" expect pairs of mrkdwn) ---
    const fields = [];

    if (environment) fields.push({type: "mrkdwn", text: `*Env:*\n${environment}`});
    if (priority) fields.push({type: "mrkdwn", text: `*Priority:*\n${priority}`});

    if (status) fields.push({type: "mrkdwn", text: `*Status:*\n${status}${substatus ? ` (${substatus})` : ""}`});
    if (level) fields.push({type: "mrkdwn", text: `*Level:*\n${level}`});

    if (eventCount != null) fields.push({type: "mrkdwn", text: `*Events:*\n${eventCount}`});
    if (userCount != null) fields.push({type: "mrkdwn", text: `*Users:*\n${userCount}`});

    // Prefer issue timeframe; fall back to event timestamp
    if (firstSeen || timestampISO) fields.push({type: "mrkdwn", text: `*First seen:*\n${firstSeen || timestampISO}`});
    if (lastSeen) fields.push({type: "mrkdwn", text: `*Last seen:*\n${lastSeen}`});

    if (browser) fields.push({type: "mrkdwn", text: `*Browser:*\n${browser}`});
    if (os) fields.push({type: "mrkdwn", text: `*OS:*\n${os}`});
    if (userBits) fields.push({type: "mrkdwn", text: `*User:*\n${userBits}`});

    if (firstRel) fields.push({type: "mrkdwn", text: `*First release:*\n\`${firstRel}\``});
    if (lastRel) fields.push({type: "mrkdwn", text: `*Last release:*\n\`${lastRel}\``});

    // --- Context line (project / platform / shortId) ---
    const shortId = issue?.shortId || ev?.event_id;
    const contextItems = [
        projectName ? `Project: ${projectName}` : null,
        projectSlug ? `Slug: ${projectSlug}` : null,
        platform ? `Platform: ${platform}` : null,
        shortId ? `ID: ${shortId}` : null,
        errorType ? `Type: ${errorType}` : null,
    ].filter(Boolean);

    // --- Useful links ---
    const linkTexts = [];
    if (eventWebUrl) linkTexts.push(`<${eventWebUrl}|Open in Sentry>`);
    if (issueApiUrl) linkTexts.push(`<${issueApiUrl}|Events in Issue>`);
    if (reqUrl) linkTexts.push(`<${reqUrl}|Request URL>`);

    // --- Header & detail sections ---
    const headerLines = [
        `*${baseEmoji}${statusEmoji ? " " + statusEmoji : ""}${escalatingEmoji} Sentry ${level.toUpperCase()}*${(status || substatus) ? `  •  _${[status, substatus].filter(Boolean).join(" / ")}_` : ""}`,
        `*Title:* ${title}`,
        ...(culprit ? [`*Culprit:* \`${culprit}\``] : []),
        ...(issue?.metadata?.filename || ev?.metadata?.filename || ev?.metadata?.function
                ? [
                    `*Where:* \`${issue?.metadata?.filename || ev?.metadata?.filename || ""}${(issue?.metadata?.function || ev?.metadata?.function) ? `#${issue?.metadata?.function || ev?.metadata?.function}` : ""}\``
                ]
                : []
        ),
    ].join("\n");

    const blocks = [
        {type: "section", text: {type: "mrkdwn", text: headerLines}},
        ...(fields.length ? [{type: "section", fields}] : []),
        ...(contextItems.length
            ? [{type: "context", elements: [{type: "mrkdwn", text: contextItems.join("  •  ")}]}]
            : []),
        {type: "divider"},
        ...(linkTexts.length
            ? [{type: "context", elements: [{type: "mrkdwn", text: linkTexts.join("  •  ")}]}]
            : []),
    ];

    return {
        text: `${baseEmoji} Sentry ${level.toUpperCase()}: ${title}`,
        blocks,
    };
}
