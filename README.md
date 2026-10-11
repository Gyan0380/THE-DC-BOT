# THE DC BOT

Discord community bot starter with Firebase Cloud Firestore persistence, configurable rules, promotion-channel signals, moderator review, persistent giveaway data, and a dashboard scaffold.

## Current status

This is a starter implementation, not a production-ready bot. Test in a private Discord server first. The dashboard is a UI scaffold; Discord OAuth and secure live dashboard APIs are not connected yet. The giveaway persistence helpers are implemented, but complete giveaway slash commands and winner selection are not yet wired into the bot.

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
- `_health/connection` — connection check written at startup

The bot uses Firebase Admin SDK on the server, which bypasses client Firestore security rules. Keep the service-account key secret, never commit it, and do not grant public database access. Use Firestore security rules to deny direct client access unless a properly authenticated dashboard is added later.

Potentially ambiguous messages are sent for moderator review rather than automatically punished. Giveaway records store absolute end timestamps, so restarts do not reset the timer.
