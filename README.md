# THE DC BOT

Discord community bot starter with Firebase Cloud Firestore persistence, configurable rules, promotion-channel signals, moderator review, persistent giveaway data, and a dashboard scaffold.

## Current status

This is an evolving implementation; test in a private Discord server first. Welcome/goodbye handlers, rules configuration, slash-command moderation (timeout, untimeout, kick, ban, clear, modlogs), and dashboard moderation controls are implemented. Giveaway persistence helpers exist, but complete giveaway slash commands and winner selection are not yet wired into the bot.

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

The dashboard and slash commands share per-server `guildSettings` for welcome/goodbye and rules. In the dashboard, choose channels, customize messages, and save. The bot's moderation API uses Discord permissions and role hierarchy; the bot must be allowed to timeout/kick/ban members. The health panel reports the bot online only when a recent Firestore heartbeat is present.


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
