# THE DC BOT

Discord community bot starter with Firebase Cloud Firestore persistence, configurable rules, promotion-channel signals, moderator review, persistent giveaway data, and a dashboard scaffold.

## Current status

This is an evolving implementation; test in a private Discord server first. Implemented modules include welcome/goodbye, configurable text-rule checks, slash-command and dashboard moderation, persistent timeout/temporary-ban recovery, retryable giveaway result announcements, member profiles and reputation announcements, moderation points, private parties with working activity tracking, community missions, Smart Chat Companion Q&A recap, and Chat Health snapshots. Text-rule detectors include rapid/repeated messages, links/invites, mentions, emoji/sticker/attachment spam, caps, character floods, promotion signals, and configurable blacklist phrases. Voice rules cannot infer spoken content; test rules in a private server before relying on them.

## Structure

- `bot/` — Discord.js bot and Firebase Admin SDK
- `dashboard/` — Next.js dashboard scaffold
- `storage/` — storage and backup notes
- `railway.json` and `vercel.json` — deployment examples

## Firebase setup

1. Open [Firebase Console](https://console.firebase.google.com/) and create a project.
2. In **Build → Firestore Database**, create a Cloud Firestore database.
3. In **Project settings → Service accounts**, generate a private service-account key for server-side use.
4. In Railway, add a variable named `FIREBASE_SERVICE_ACCOUNT_JSON`. Paste the entire service-account JSON file contents as the value. Keep the JSON private.
5. Add `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_GUILD_ID` in Railway variables. The bot now registers guild slash commands on startup when the ID variables are present.
6. Install dependencies in `bot/` using `npm install`, then start with `npm start`.
7. In Discord Developer Portal → Bot, enable **Server Members Intent** so welcome/goodbye join/leave events can fire. Message Content Intent is also used by the existing message review module.

For local testing, create `bot/.env` and set the same variables. The service-account JSON must be on one line if pasted into an environment-variable editor; escaped newline characters in `private_key` are handled by the code.

## Firestore collections

- `modlogs` — moderator review records
- `rules` — optional server-specific rules
- `giveaways` — persistent giveaway data
- `_health/connection` — Firebase connection check and periodic bot heartbeat
- `guildSettings` — per-server dashboard configuration
- `scheduledActions` — persistent timed punishment jobs and retry state
- `memberProfiles`, `reputationEvents`, `moderationPointsEvents` — member stats and moderation point/reputation history
- `parties` — private party ownership, membership, and expiry
- `missions` — community mission progress
- `companionQuestions` — 24-hour Q&A recap records
- `chatHealthDaily`, `chatHealthSnapshots` — daily chat activity and seven-snapshot retention

The bot uses Firebase Admin SDK on the server, which bypasses client Firestore security rules. Keep the service-account key secret, never commit it, and do not grant public database access. Use Firestore security rules to deny direct client access unless a properly authenticated dashboard is added later.

Potentially ambiguous messages are sent for moderator review rather than automatically punished. Giveaway records store absolute end timestamps, so restarts do not reset the timer.

## Dashboard setup (Vercel)

Deploy the `dashboard/` directory as the Vercel project root. Add these environment variables in Vercel Project Settings → Environment Variables:

- `DISCORD_CLIENT_ID` — your Discord application's Application ID
- `DISCORD_CLIENT_SECRET` — the OAuth2 client secret (keep private)
- `DISCORD_REDIRECT_URI` — exactly `https://YOUR-VERCEL-DOMAIN/api/auth/discord/callback`
- `SESSION_SECRET` — a random secret with at least 32 characters
- `FIREBASE_SERVICE_ACCOUNT_JSON` — the complete Firebase service-account JSON, stored only as a server-side environment variable
- `DISCORD_TOKEN` — bot token, required by the dashboard's channel picker and moderation actions; never expose it to client code

In the Discord Developer Portal, open your application → OAuth2 and add the exact same callback URL under **Redirects**. The URL in Discord and `DISCORD_REDIRECT_URI` must match exactly, including HTTPS, domain, path, and trailing slash choice. After changing environment variables, redeploy the Vercel project.

The dashboard only lists servers where the signed-in Discord user owns the server or has Manage Server permission. Keep OAuth secrets and Firebase service-account JSON out of browser code and Git commits.

The dashboard and slash commands share per-server `guildSettings` for welcome/goodbye, rules, and spam policies. The dashboard includes server-scoped moderation logs, one-click moderation points, giveaway creation/listing, Chat Health analytics, and encrypted AI-key settings. The bot's moderation API uses Discord permissions and role hierarchy; the bot must be allowed to timeout/kick/ban members and manage party channels. The health panel reports the bot online only when a recent Firestore heartbeat is present.


## Gemini / DeepSeek AI moderation

AI moderation is opt-in per Discord server. A server manager uses `/ai-setup` and chooses Google Gemini or DeepSeek. The bot opens a private interaction modal, validates the API key with the provider, and only then saves it. Keys are encrypted in Firestore using AES-256-GCM; they are not written to source code or logs.

### Required environment variable

Add `AI_KEY_ENCRYPTION_SECRET` to Railway service variables. It must be a randomly generated secret of at least 32 characters. Keep it private, back it up securely, and never commit it to GitHub. If this secret is changed, saved keys can no longer be decrypted and each server must configure its key again.

### Setup

1. Create an API key from [Google AI Studio](https://aistudio.google.com/app/apikey) or the [DeepSeek platform](https://platform.deepseek.com/api_keys). Free quotas and billing depend on the provider and account.
2. Add `AI_KEY_ENCRYPTION_SECRET` in Railway and redeploy.
3. Run `/ai-setup` in Discord and select a provider. Paste the key only into the private modal. A failed provider check will not save it.
4. Add rules with `/rules-set`, one rule per line. Be explicit about action and duration, e.g. `Spam: timeout for 10 minutes`. State channel exceptions and exemptions clearly.
5. Run `/diagnose` to check Firestore, provider configuration, key decryption and provider authentication. It never displays the key.
6. Run `/dashboard` to get the dashboard URL. Configured welcome messages also include that link.

### Security notes and limitations

- Encrypted keys and AI settings are stored under each Discord server's own settings document. The Discord user who configured the key is recorded as its owner.
- This is encryption at rest, **not end-to-end encryption**. The bot must decrypt a key in memory to call the provider. A compromised bot host together with the encryption secret could expose it. Use a dedicated key, provider spending limits, restricted Railway access, and revoke/rotate exposed keys.
- AI classification sends the configured rules, channel name and message text to the selected provider. Review that provider's privacy and data-retention terms before enabling it.
- The AI is instructed to classify only saved rules. Uncertain cases are sent for moderator review. Automatic timeout is only considered for a high-confidence finding when the matched rule explicitly contains a timeout duration. Administrators and Manage Server members are exempt from that automatic timeout path.
- A successful key check confirms current authentication only. It does not guarantee credit balance, future uptime, or complete security. `/diagnose` cannot reliably read remaining API credits; check the provider's billing dashboard if requests stop working.
- Commands are currently registered to `DISCORD_GUILD_ID` at startup. For servers where commands do not appear, register the commands for that server or switch to global command registration.


AI usage note: To reduce token spend, the AI path first uses lightweight candidate signals (links/invites, repeated characters, long messages, mass mentions, and selected rule-related keywords). This is a cost-saving prefilter, so it can miss subtle violations that do not trigger those signals; it is not a guarantee that every message is AI-reviewed. Provider free tiers and pricing can change.


## Persistent timers and restart recovery

Timed actions are stored in the existing Firestore project in a new `scheduledActions` collection. Existing collections and Firebase configuration are not cleared or reset.

- Bot-managed timeouts are recorded with an absolute expiry timestamp.
- Optional temporary `/ban` uses `duration_hours` (1–8760); omit it for a permanent ban.
- On startup and every 15 seconds, the bot checks due actions against the current time rather than restarting their duration.
- Expired timed bans are unbanned and expired timeouts are reconciled; the bot attempts a direct-message notification and records completion/DM delivery in moderation logs.
- Failed scheduled actions are retried with backoff and marked failed after five attempts; inspect Railway logs and Firestore `scheduledActions` for failures.
- Giveaway records in the existing `giveaways` collection retain their saved `endsAt`; this timer worker does not erase giveaway or other existing Firebase data.

After deploying this branch, run `npm run deploy-commands` from the `bot` directory once so Discord updates the optional `/ban duration_hours` option. Ensure the bot role has Ban Members and Moderate Members permissions and can DM members where their privacy settings allow it.


## New community commands

- `/giveaway-create`, `/giveaway-join`, `/giveaway-list` — persistent giveaways with absolute end timestamps and winner announcement after downtime recovery.
- `/profile`, `/rep-add`, `/points-add` — member profile, reputation, and moderation points.
- `/party-config`, `/party-list`, `/party-create`, `/party-join`, `/party-leave`, `/party-close` — public party finder, private owner-managed or temporary party channels, inactivity warning and auto-close.
- `/welcome-setup` and `/goodbye-setup` — direct channel/template setup commands.
- `/mission-create`, `/mission-progress`, `/mission-list` — persistent community progress goals.
- `/companion ask`, `/companion recap` — uses the server's configured Gemini/DeepSeek provider and can DM the member's active Q&A recap; records expire after 24 hours.
- `/chat-health` — moderator-only seven-day activity summary.

Run `npm run deploy-commands` from `bot/` after updating the bot. The dashboard deployment needs its existing OAuth, session, Firebase, and Discord bot environment variables. The new API routes are server-side only; never put service-account credentials or the Discord token in browser code.
