require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.DISCORD_TOKEN;
const CONFIG_PATH = path.join(__dirname, 'sync-roles.json');

if (!TOKEN) {
  throw new Error('Missing DISCORD_TOKEN. Add it to your environment or .env file.');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

function loadRoleNames() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!Array.isArray(parsed.roles)) return [];
    return [...new Set(parsed.roles.filter((name) => typeof name === 'string' && name.trim()).map((name) => name.trim()))];
  } catch (error) {
    console.warn(`Could not read sync-roles.json: ${error.message}`);
    return [];
  }
}

function saveRoleNames(roleNames) {
  const clean = [...new Set(roleNames.map((name) => String(name).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const tempPath = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify({ roles: clean }, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, CONFIG_PATH);
  return clean;
}

function isConfiguredRoleName(name) {
  return loadRoleNames().includes(name);
}

function memberHasRoleName(member, roleName) {
  return member.roles.cache.some((role) => role.id !== member.guild.id && role.name === roleName);
}

function getManageableRoleByExactName(guild, roleName) {
  const matches = guild.roles.cache
    .filter((role) => role.id !== guild.id && !role.managed && role.name === roleName && role.editable)
    .sort((a, b) => b.position - a.position);

  return matches.first() || null;
}

async function getMember(guild, userId) {
  return guild.members.cache.get(userId) || guild.members.fetch(userId).catch(() => null);
}

async function applyRoleStateToOtherGuilds(sourceGuildId, userId, roleName, shouldHaveRole) {
  for (const guild of client.guilds.cache.values()) {
    if (guild.id === sourceGuildId) continue;

    const member = await getMember(guild, userId);
    if (!member || member.user.bot) continue;

    const targetRole = getManageableRoleByExactName(guild, roleName);
    if (!targetRole) continue;

    const alreadyHas = member.roles.cache.has(targetRole.id);

    try {
      if (shouldHaveRole && !alreadyHas) {
        await member.roles.add(targetRole, `Cross-server role sync: ${roleName}`);
        console.log(`Added "${roleName}" to ${member.user.tag} in ${guild.name}.`);
      } else if (!shouldHaveRole && alreadyHas) {
        await member.roles.remove(targetRole, `Cross-server role sync: ${roleName}`);
        console.log(`Removed "${roleName}" from ${member.user.tag} in ${guild.name}.`);
      }
    } catch (error) {
      console.warn(`Could not sync "${roleName}" for ${member.user.tag} in ${guild.name}: ${error.message}`);
    }
  }
}

async function backfillMember(userId) {
  const roleNames = loadRoleNames();
  const memberships = [];

  for (const guild of client.guilds.cache.values()) {
    const member = await getMember(guild, userId);
    if (member && !member.user.bot) memberships.push(member);
  }

  const heldRoleNames = new Set();
  for (const roleName of roleNames) {
    if (memberships.some((member) => memberHasRoleName(member, roleName))) {
      heldRoleNames.add(roleName);
    }
  }

  let added = 0;
  for (const member of memberships) {
    for (const roleName of heldRoleNames) {
      const targetRole = getManageableRoleByExactName(member.guild, roleName);
      if (!targetRole || member.roles.cache.has(targetRole.id)) continue;

      try {
        await member.roles.add(targetRole, `Manual cross-server role backfill: ${roleName}`);
        added += 1;
      } catch (error) {
        console.warn(`Could not backfill "${roleName}" for ${member.user.tag} in ${member.guild.name}: ${error.message}`);
      }
    }
  }

  return { guildCount: memberships.length, added, heldRoleNames: [...heldRoleNames] };
}

async function syncNewMember(member) {
  if (member.user.bot) return;

  const roleNames = loadRoleNames();
  if (!roleNames.length) return;

  for (const roleName of roleNames) {
    let foundInAnotherGuild = false;

    for (const guild of client.guilds.cache.values()) {
      if (guild.id === member.guild.id) continue;
      const otherMember = await getMember(guild, member.id);
      if (otherMember && memberHasRoleName(otherMember, roleName)) {
        foundInAnotherGuild = true;
        break;
      }
    }

    if (!foundInAnotherGuild) continue;

    const targetRole = getManageableRoleByExactName(member.guild, roleName);
    if (!targetRole || member.roles.cache.has(targetRole.id)) continue;

    try {
      await member.roles.add(targetRole, `Joined server with synced role: ${roleName}`);
      console.log(`Auto-added "${roleName}" to ${member.user.tag} in ${member.guild.name}.`);
    } catch (error) {
      console.warn(`Could not add "${roleName}" to ${member.user.tag} in ${member.guild.name}: ${error.message}`);
    }
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName('syncrole')
    .setDescription('Configure exact role names that sync across every server using this bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add a role name to the global sync list')
        .addRoleOption((option) =>
          option
            .setName('role')
            .setDescription('Role to sync by exact name across servers')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove an exact role name from the global sync list')
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription('Exact role name to stop syncing')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List every configured synced role name')),

  new SlashCommandBuilder()
    .setName('syncmember')
    .setDescription('Backfill a member\'s configured roles across all mutual servers')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((option) =>
      option.setName('user').setDescription('Member to synchronize').setRequired(true),
    ),
].map((command) => command.toJSON());

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}.`);
  console.log(`Connected to ${client.guilds.cache.size} guild(s).`);

  try {
    await client.application.commands.set(commands);
    console.log(`Registered ${commands.length} global command group(s).`);
  } catch (error) {
    console.error('Failed to register global commands:', error);
  }

  const roleNames = loadRoleNames();
  console.log(`Configured synced role names: ${roleNames.length ? roleNames.join(', ') : 'none'}`);
});

client.on('guildMemberAdd', async (member) => {
  await syncNewMember(member).catch((error) => console.error('guildMemberAdd sync error:', error));
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  if (newMember.user.bot) return;

  const roleNames = loadRoleNames();
  for (const roleName of roleNames) {
    const hadRole = memberHasRoleName(oldMember, roleName);
    const hasRole = memberHasRoleName(newMember, roleName);
    if (hadRole === hasRole) continue;

    await applyRoleStateToOtherGuilds(newMember.guild.id, newMember.id, roleName, hasRole);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!['syncrole', 'syncmember'].includes(interaction.commandName)) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);

  try {
    if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.editReply('Administrator permission is required.');
    }

    if (interaction.commandName === 'syncrole') {
      const subcommand = interaction.options.getSubcommand();
      let roleNames = loadRoleNames();

      if (subcommand === 'add') {
        const role = interaction.options.getRole('role', true);
        if (role.id === interaction.guild.id) return interaction.editReply('The @everyone role cannot be synchronized.');
        if (role.managed) return interaction.editReply('Managed/integration roles cannot be synchronized.');

        if (!roleNames.includes(role.name)) {
          roleNames.push(role.name);
          roleNames = saveRoleNames(roleNames);
        }

        return interaction.editReply(`Now syncing the exact role name: **${role.name}**\n\nAny matching role name in other servers using this bot will be mirrored when members join or their role changes.`);
      }

      if (subcommand === 'remove') {
        const name = interaction.options.getString('name', true).trim();
        const before = roleNames.length;
        roleNames = saveRoleNames(roleNames.filter((roleName) => roleName !== name));

        return interaction.editReply(
          before === roleNames.length
            ? `**${name}** was not in the sync list.`
            : `Stopped syncing the exact role name: **${name}**`,
        );
      }

      if (subcommand === 'list') {
        return interaction.editReply(
          roleNames.length
            ? `Configured synced role names:\n${roleNames.map((name) => `- ${name}`).join('\n')}`
            : 'No role names are currently configured for synchronization.',
        );
      }
    }

    if (interaction.commandName === 'syncmember') {
      const user = interaction.options.getUser('user', true);
      const result = await backfillMember(user.id);

      return interaction.editReply(
        `Synchronized ${user.tag} across ${result.guildCount} mutual server(s).\n` +
        `Matching configured roles found: ${result.heldRoleNames.length ? result.heldRoleNames.join(', ') : 'none'}\n` +
        `Roles added: ${result.added}`,
      );
    }
  } catch (error) {
    console.error('Interaction error:', error);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('Something went wrong while processing that command. Check the bot console for details.').catch(() => null);
    }
  }
});

client.login(TOKEN);
