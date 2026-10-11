# Storage architecture

A Git branch is not a live database. MongoDB Atlas stores runtime data.

Suggested collections:
- settings: per-guild configuration and review/log channel IDs
- rules: rule IDs, descriptions, points and enabled status
- modlogs: user, guild, rule ID, points, moderator decision and timestamps
- giveaways: prize, channel, status, absolute endsAt and winner ID
- point_totals: optional cache; derive totals from logs if stale

Use indexes and retention policies. Avoid storing message contents longer than necessary. Never commit credentials or real production dumps.
