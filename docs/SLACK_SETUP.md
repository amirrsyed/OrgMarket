# Slack app setup

The Slack surface (D18) runs inside `apps/web` — no separate service. One Slack app
per install; each workspace maps to one org via `slack_connections` (or env vars for
local dev).

## 1. Create the app from a manifest

At https://api.slack.com/apps → **Create New App → From an app manifest**, pick the
workspace, and paste (replace `YOUR_HOST` with the deployed origin, e.g.
`https://orgmarket.vercel.app`; for local dev use a tunnel such as `ngrok http 3000`):

```yaml
display_information:
  name: OrgMarket
  description: A forecasting layer for planning.
  background_color: "#0f172a"
features:
  bot_user:
    display_name: orgmarket
    always_online: true
  slash_commands:
    - command: /om
      url: https://YOUR_HOST/api/slack/commands
      description: List open markets or post the digest
      usage_hint: "list | digest"
      should_escape: false
oauth_config:
  scopes:
    bot:
      - chat:write
      - commands
      - users:read
      - users:read.email
settings:
  interactivity:
    is_enabled: true
    request_url: https://YOUR_HOST/api/slack/interactions
  event_subscriptions:
    request_url: https://YOUR_HOST/api/slack/events
  org_deploy_enabled: false
  socket_mode_enabled: false
```

## 2. Install and collect credentials

Install the app to the workspace, then collect:

- **Bot token** (`xoxb-…`): OAuth & Permissions page
- **Signing secret**: Basic Information page
- **Channel id** (`C…`): right-click the target channel → copy link → last path segment.
  Invite the bot to that channel (`/invite @orgmarket`).
- **Team id** (`T…`): visible in the workspace URL or any interaction payload.

## 3. Configure OrgMarket

Environment (always required):

```
SLACK_SIGNING_SECRET=…       # verifies inbound webhooks
DIGEST_SECRET=…              # gates POST /api/slack/digest
APP_URL=https://YOUR_HOST    # used in message links
```

Then either insert a row in `slack_connections`
(`org_id, team_id, bot_token, channel_id`) — the multi-tenant path — or, for local
dev with the demo org, set:

```
SLACK_BOT_TOKEN=xoxb-…
SLACK_CHANNEL_ID=C…
SLACK_TEAM_ID=T…          # optional; unset = accept any team (dev only)
SLACK_ORG_ID=org-meridian  # optional; defaults to the demo org
```

Bot tokens are stored plaintext in v0.1 — encrypt at rest before external pilots
(SPEC §6).

## 4. What it does

- **New market / resolution** → announcement in the channel (fires from the web
  admin actions; a Slack outage never fails the web action).
- **One-tap forecasting** on binary markets: bucket buttons (≈15/35/50/65/85%) trade
  toward the target, capped at ₥25 per tap; the message updates with the new price
  and the tapper gets an ephemeral receipt. Identity = workspace-verified email
  matched to the member's email, cached thereafter.
- **`/om`** → ephemeral list of open markets; **`/om digest`** → posts the digest.
- **Weekly digest**: schedule `POST https://YOUR_HOST/api/slack/digest` with header
  `x-digest-secret: $DIGEST_SECRET` (Vercel cron / GitHub Actions schedule).
