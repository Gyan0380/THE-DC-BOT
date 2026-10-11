# THE DC BOT

Starter project for a Discord community bot with configurable rules, promotion-channel signals, moderator review, persistent giveaways, and a dashboard scaffold.

## Current status
This is a starter implementation, not a production-ready bot. Test in a private Discord server first. The dashboard is a UI scaffold; Discord OAuth and secure live dashboard APIs are not connected yet.

## Structure
- bot/ — Discord.js bot and MongoDB persistence
- dashboard/ — Next.js dashboard scaffold
- storage/ — database design, migration and backup notes
- railway.json and vercel.json — deployment examples

## Setup
1. Use Node.js 20 or newer.
2. Copy .env.example to bot/.env and set credentials.
3. In bot/, run npm install, npm run deploy-commands, then npm start.
4. Configure MongoDB Atlas and restrict network access.
5. Implement dashboard OAuth and server-side authorization before production.

Potentially ambiguous messages are sent for moderator review rather than automatically punished. Giveaways store absolute endsAt timestamps, so downtime does not restart the timer. Never commit tokens or database credentials.
