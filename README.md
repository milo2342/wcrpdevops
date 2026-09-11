# Discord Cross-Server Role Sync

A Discord bot that mirrors selected role names across every server that shares the bot.

There are no hard-coded guild IDs, Discord IDs, or client IDs. The only required secret is your bot token.

## What it does

If `Administrator` is configured as a synced role name and a member receives a role named exactly `Administrator` in one server, the bot gives that member the role named exactly `Administrator` in their other mutual servers where that role exists and the bot can manage it.

The same applies to removals. If the configured role is removed in one server, the matching role is removed from the member in the other mutual servers.

When a member joins a new server that already has the bot, the bot checks the member's configured roles in the other mutual servers and gives them matching exact-name roles in the new server.

Role names are case-sensitive and must match exactly.

## Files

All files are at the repository root. No folders are required.

- `index.js`
- `package.json`
- `.env.example`
- `.gitignore`
- `sync-roles.json`
- `README.md`

## Setup

1. Create a Discord application and bot in the Discord Developer Portal.
2. Enable **Server Members Intent** under Bot > Privileged Gateway Intents.
3. Invite the bot to every server that should share roles.
4. Give the bot **Manage Roles** permission.
5. In every server, move the bot's highest role above every role it needs to assign/remove.
6. Copy `.env.example` to `.env` and add your token:

```env
DISCORD_TOKEN=YOUR_BOT_TOKEN
```

Do not commit `.env` to GitHub.

Install and run:

```bash
npm install
npm start
```

## Commands

### `/syncrole add role:<role>`
Adds that role's exact name to the global sync list.

Example: choose the `Administrator` role. From then on, any role named exactly `Administrator` is mirrored between mutual servers.

### `/syncrole remove name:<exact name>`
Stops synchronizing that exact role name.

### `/syncrole list`
Shows every role name currently configured for synchronization.

### `/syncmember user:<member>`
Manually backfills a member's configured roles across every mutual server. Useful for members who were already in multiple servers before the bot was installed.

All configuration commands require Discord Administrator permission.

## Important Discord limitations

- The bot can only assign/remove roles below its highest role.
- Managed/integration roles cannot be synchronized.
- The same role name must exist in each destination server.
- The bot must share both servers with the member.
- The member must be present in the destination server before a role can be assigned there.

## Hosting

No guild ID or client ID environment variable is required. Global slash commands are registered using the logged-in bot application automatically.

If your host uses an ephemeral filesystem, `sync-roles.json` can reset when the container is rebuilt. In that case, either keep the desired role names committed in `sync-roles.json` or attach persistent storage.
