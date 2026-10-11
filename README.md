# THE DC BOT

Discord community bot starter with Firebase Cloud Firestore persistence, configurable rules, promotion-channel signals, moderator review, persistent giveaway data, and a dashboard scaffold.

## Current status

This is an evolving starter implementation, not a production-ready bot. Test in a private Discord server first. The dashboard now has Discord OAuth routes, signed server-side sessions, server-specific Firestore settings, and live Firebase/bot health reporting. Some controls are configuration-only until their corresponding bot handlers are implemented. Giveaway persistence helpers exist, but complete giveaway slash commands and winner selection are not yet wired into the bot.

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
5. Add `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_GUILD_ID` in Railway variables.
6. Install dependencies in `bot/` using `npm install`, then run `npm run deploy-commands` once and start with `npm start`.

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

In the Discord Developer Portal, open your application → OAuth2 and add the exact same callback URL under **Redirects**. The URL in Discord and `DISCORD_REDIRECT_URI` must match exactly, including HTTPS, domain, path, and trailing slash choice. After changing environment variables, redeploy the Vercel project.

The dashboard only lists servers where the signed-in Discord user owns the server or has Manage Server permission. Keep OAuth secrets and Firebase service-account JSON out of browser code and Git commits.

The dashboard can save configuration to Firestore, but settings do not automatically activate bot behavior unless the relevant bot handler reads and enforces those settings. The health panel reports the bot online only when a recent Firestore heartbeat is present.
