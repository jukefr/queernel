const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const FortyTwoAPI = require('./fortytwo-api');
const { add42Role, remove42Role, has42Role, createErrorEmbed } = require('./utils');
const { debugLog, debugDiscordEvent } = require('./debug');

// Initialize 42 API
const fortyTwoAPI = new FortyTwoAPI(
  process.env.FORTYTWO_CLIENT_ID,
  process.env.FORTYTWO_CLIENT_SECRET
);

const commands = [
  // Test command for debugging
  new SlashCommandBuilder()
    .setName('test')
    .setDescription('Test command to verify bot is working'),

  // Manual verification command
  new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Manually verify a user with their 42 login')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The user to verify')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('login')
        .setDescription('The 42 login of the user')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  // Check verification status
  new SlashCommandBuilder()
    .setName('check')
    .setDescription('Check if a user is verified')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The user to check')
        .setRequired(true)
    ),

  // Remove verification
  new SlashCommandBuilder()
    .setName('unverify')
    .setDescription('Remove 42 verification from a user')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The user to unverify')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  // Bot status
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check bot status and statistics')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  // Debug permissions
  new SlashCommandBuilder()
    .setName('debug-permissions')
    .setDescription('Debug bot permissions and role hierarchy')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  // Help command
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show help information about the bot')
];

/**
 * Handle slash command interactions
 * @param {CommandInteraction} interaction - Discord interaction
 * @param {Map} pendingVerifications - Map of pending verifications
 */
async function handleCommands(interaction, pendingVerifications) {
  const { commandName } = interaction;

  debugDiscordEvent('Command Execution Started', {
    commandName,
    userId: interaction.user.id,
    username: interaction.user.tag,
    guildId: interaction.guildId,
    channelId: interaction.channelId
  });

  try {
    switch (commandName) {
      case 'test':
        await handleTestCommand(interaction);
        break;
      case 'verify':
        await handleVerifyCommand(interaction);
        break;
      case 'check':
        await handleCheckCommand(interaction);
        break;
      case 'unverify':
        await handleUnverifyCommand(interaction);
        break;
      case 'status':
        await handleStatusCommand(interaction, pendingVerifications);
        break;
      case 'debug-permissions':
        await handleDebugPermissionsCommand(interaction);
        break;
      case 'help':
        await handleHelpCommand(interaction);
        break;
      default:
        debugLog('Unknown Command', { commandName });
        await interaction.reply({ 
          content: 'Unknown command', 
          ephemeral: true 
        });
    }
    
    debugDiscordEvent('Command Execution Completed', {
      commandName,
      userId: interaction.user.id,
      username: interaction.user.tag,
      success: true
    });
  } catch (error) {
    debugDiscordEvent('Command Execution Failed', {
      commandName,
      userId: interaction.user.id,
      username: interaction.user.tag,
      error: error.message
    });
    console.error(`Error handling command ${commandName}:`, error);
    await interaction.reply({ 
      content: `An error occurred: ${error.message}`, 
      ephemeral: true 
    });
  }
}

/**
 * Handle test command
 * @param {CommandInteraction} interaction - Discord interaction
 */
async function handleTestCommand(interaction) {
  debugLog('Test Command Executed', {
    userId: interaction.user.id,
    username: interaction.user.tag,
    guildName: interaction.guild?.name
  });

  const embed = new EmbedBuilder()
    .setColor('#00ff00')
    .setTitle('✅ Bot Test Successful!')
    .setDescription('The bot is working correctly!')
    .addFields(
      { name: 'User', value: interaction.user.tag, inline: true },
      { name: 'Server', value: interaction.guild?.name || 'DM', inline: true },
      { name: 'Timestamp', value: new Date().toISOString(), inline: true }
    )
    .setFooter({ text: 'Queernel Bot - Test Command' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * Handle verify command
 * @param {CommandInteraction} interaction - Discord interaction
 */
async function handleVerifyCommand(interaction) {
  const user = interaction.options.getUser('user');
  const login = interaction.options.getString('login');
  const member = await interaction.guild.members.fetch(user.id);

  debugLog('Verify Command Started', {
    targetUserId: user.id,
    targetUsername: user.tag,
    login,
    executorId: interaction.user.id,
    executorUsername: interaction.user.tag
  });

  await interaction.deferReply({ ephemeral: true });

  try {
    // Check if user already has the role
    if (has42Role(member, process.env.DISCORD_42_ROLE_ID)) {
      debugLog('Verify Command - User Already Verified', {
        targetUserId: user.id,
        targetUsername: user.tag
      });
      return interaction.editReply({
        content: `✅ ${user.tag} is already verified with the 42 role.`,
        ephemeral: true
      });
    }

    // Get user data from 42 API
    debugLog('Verify Command - Fetching User Data', { login });
    const userData = await fortyTwoAPI.getUserByLogin(login);
    
    // Validate student status
    if (!fortyTwoAPI.validateStudentStatus(userData)) {
      debugLog('Verify Command - User Validation Failed', {
        login,
        isStaff: userData['staff?'],
        hasCursus: !!userData.cursus_users?.length,
        hasCampus: !!userData.campus?.length,
        isActive: userData['active?']
      });
      return interaction.editReply({
        content: `❌ The provided login is not a valid 42 student or is staff.`,
        ephemeral: true
      });
    }

    // Add the 42 role
    const success = await add42Role(member, process.env.DISCORD_42_ROLE_ID);
    
    if (success) {
      debugLog('Verify Command - Manual Verification Successful', {
        targetUserId: user.id,
        targetUsername: user.tag,
        login: userData.login,
        displayName: userData.displayname
      });

      const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('✅ Manual Verification Successful')
        .setDescription(`Successfully verified ${user.tag} as a 42 student.`)
        .addFields(
          { name: 'Status', value: '✅ Verified 42 Student', inline: true },
          { name: 'Campus', value: fortyTwoAPI.getPrimaryCampus(userData) || 'Unknown', inline: true },
          { name: 'Level', value: fortyTwoAPI.getCurrentLevel(userData)?.toString() || 'Unknown', inline: true }
        )
        .setFooter({ text: `Verified by ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], ephemeral: true });
      
      // Notify the user
      try {
        const userEmbed = new EmbedBuilder()
          .setColor('#00ff00')
          .setTitle('✅ Verification Completed')
          .setDescription('You have been manually verified as a 42 student by an administrator.')
          .addFields(
            { name: 'Status', value: '✅ Verified 42 Student', inline: true }
          )
          .setFooter({ text: 'Queernel Bot - 42 Student Verification' })
          .setTimestamp();

        await user.send({ embeds: [userEmbed] });
        debugLog('Verify Command - User DM Sent', { targetUserId: user.id });
      } catch (dmError) {
        debugLog('Verify Command - User DM Failed', { 
          targetUserId: user.id, 
          error: dmError.message 
        });
        console.log(`Could not send verification DM to ${user.tag}`);
      }
    } else {
      debugLog('Verify Command - Role Addition Failed', {
        targetUserId: user.id,
        targetUsername: user.tag,
        login
      });
      await interaction.editReply({
        content: `❌ Failed to add 42 role to ${user.tag}.`,
        ephemeral: true
      });
    }
  } catch (error) {
    debugLog('Verify Command - Error', {
      targetUserId: user.id,
      targetUsername: user.tag,
      login,
      error: error.message
    });
    await interaction.editReply({
      content: `❌ Error during verification: ${error.message}`,
      ephemeral: true
    });
  }
}

/**
 * Handle check command
 * @param {CommandInteraction} interaction - Discord interaction
 */
async function handleCheckCommand(interaction) {
  const user = interaction.options.getUser('user');
  const member = await interaction.guild.members.fetch(user.id);

  const hasRole = has42Role(member, process.env.DISCORD_42_ROLE_ID);
  
  const embed = new EmbedBuilder()
    .setColor(hasRole ? '#00ff00' : '#ff9900')
    .setTitle('🔍 Verification Status Check')
    .setDescription(`Verification status for ${user.tag}`)
    .addFields(
      { 
        name: '42 Role Status', 
        value: hasRole ? '✅ Has 42 role' : '❌ No 42 role', 
        inline: true 
      },
      { 
        name: 'Member Since', 
        value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, 
        inline: true 
      }
    )
    .setThumbnail(user.displayAvatarURL())
    .setFooter({ text: `Checked by ${interaction.user.tag}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * Handle unverify command
 * @param {CommandInteraction} interaction - Discord interaction
 */
async function handleUnverifyCommand(interaction) {
  const user = interaction.options.getUser('user');
  const member = await interaction.guild.members.fetch(user.id);

  await interaction.deferReply({ ephemeral: true });

  try {
    // Check if user has the role
    if (!has42Role(member, process.env.DISCORD_42_ROLE_ID)) {
      return interaction.editReply({
        content: `❌ ${user.tag} is not verified with the 42 role.`,
        ephemeral: true
      });
    }

    // Remove the 42 role
    const success = await remove42Role(member, process.env.DISCORD_42_ROLE_ID);
    
    if (success) {
      const embed = new EmbedBuilder()
        .setColor('#ff9900')
        .setTitle('🔄 Verification Removed')
        .setDescription(`Successfully removed 42 verification from ${user.tag}.`)
        .setFooter({ text: `Removed by ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], ephemeral: true });
      
      // Notify the user
      try {
        const userEmbed = new EmbedBuilder()
          .setColor('#ff9900')
          .setTitle('🔄 Verification Removed')
          .setDescription('Your 42 student verification has been removed by an administrator.')
          .setFooter({ text: 'Queernel Bot - 42 Student Verification' })
          .setTimestamp();

        await user.send({ embeds: [userEmbed] });
      } catch (dmError) {
        console.log(`Could not send unverification DM to ${user.tag}`);
      }
    } else {
      await interaction.editReply({
        content: `❌ Failed to remove 42 role from ${user.tag}. Please check bot permissions.`,
        ephemeral: true
      });
    }

  } catch (error) {
    console.error('Unverify command error:', error);
    await interaction.editReply({
      content: `❌ Error removing verification from ${user.tag}: ${error.message}`,
      ephemeral: true
    });
  }
}

/**
 * Handle status command
 * @param {CommandInteraction} interaction - Discord interaction
 * @param {Map} pendingVerifications - Map of pending verifications
 */
async function handleStatusCommand(interaction, pendingVerifications) {
  const guild = interaction.guild;
  const role = guild.roles.cache.get(process.env.DISCORD_42_ROLE_ID);
  
  const verifiedCount = role ? role.members.size : 0;
  const totalMembers = guild.memberCount;
  const pendingCount = pendingVerifications.size;

  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('🤖 Bot Status')
    .setDescription('Current status of the Queernel 42 verification bot')
    .addFields(
      { name: 'Bot Status', value: '✅ Online', inline: true },
      { name: 'Server', value: guild.name, inline: true },
      { name: '42 Role', value: role ? '✅ Found' : '❌ Not Found', inline: true },
      { name: 'Verified Members', value: verifiedCount.toString(), inline: true },
      { name: 'Total Members', value: totalMembers.toString(), inline: true },
      { name: 'Pending Verifications', value: pendingCount.toString(), inline: true },
      { name: 'Verification Rate', value: `${((verifiedCount / totalMembers) * 100).toFixed(1)}%`, inline: true }
    )
    .setFooter({ text: 'Queernel Bot - 42 Student Verification' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * Handle debug permissions command
 * @param {CommandInteraction} interaction - Discord interaction
 */
async function handleDebugPermissionsCommand(interaction) {
  const guild = interaction.guild;
  const botMember = guild.members.cache.get(interaction.client.user.id);
  const botHighestRole = botMember.roles.highest;
  const targetRole = guild.roles.cache.get(process.env.DISCORD_42_ROLE_ID);
  
  debugLog('Debug Permissions Command Executed', {
    guildId: guild.id,
    guildName: guild.name,
    botId: interaction.client.user.id,
    botTag: interaction.client.user.tag
  });

  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('🔧 Bot Permissions Debug')
    .setDescription('Debug information about bot permissions and role hierarchy')
    .addFields(
      { 
        name: '🤖 Bot Information', 
        value: `**ID:** ${interaction.client.user.id}\n**Tag:** ${interaction.client.user.tag}\n**Highest Role:** ${botHighestRole.name}`, 
        inline: false 
      },
      { 
        name: '🎭 Bot Permissions', 
        value: `**Manage Roles:** ${botMember.permissions.has('ManageRoles') ? '✅ Yes' : '❌ No'}\n**Administrator:** ${botMember.permissions.has('Administrator') ? '✅ Yes' : '❌ No'}`, 
        inline: true 
      },
      { 
        name: '📊 Role Hierarchy', 
        value: `**Bot Role Position:** ${botHighestRole.position}\n**42 Role Position:** ${targetRole ? targetRole.position : 'Not Found'}`, 
        inline: true 
      },
      { 
        name: '🎯 42 Role Status', 
        value: targetRole ? 
          `**Name:** ${targetRole.name}\n**ID:** ${targetRole.id}\n**Position:** ${targetRole.position}\n**Can Manage:** ${botHighestRole.position > targetRole.position ? '✅ Yes' : '❌ No'}` : 
          '❌ 42 role not found', 
        inline: false 
      }
    )
    .setFooter({ text: `Debug by ${interaction.user.tag}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * Handle help command
 * @param {CommandInteraction} interaction - Discord interaction
 */
async function handleHelpCommand(interaction) {
  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('❓ Bot Help')
    .setDescription('Available commands for the Queernel 42 verification bot')
    .addFields(
      { 
        name: '/test', 
        value: 'Test command to verify bot is working', 
        inline: false 
      },
      { 
        name: '/verify', 
        value: 'Manually verify a user with their 42 login (Admin only)', 
        inline: false 
      },
      { 
        name: '/check', 
        value: 'Check if a user is verified with the 42 role', 
        inline: false 
      },
      { 
        name: '/unverify', 
        value: 'Remove 42 verification from a user (Admin only)', 
        inline: false 
      },
      { 
        name: '/status', 
        value: 'Check bot status and server statistics (Admin only)', 
        inline: false 
      },
      { 
        name: '/debug-permissions', 
        value: 'Debug bot permissions and role hierarchy (Admin only)', 
        inline: false 
      },
      { 
        name: '/help', 
        value: 'Show this help message', 
        inline: false 
      }
    )
    .addFields(
      { 
        name: '📋 How it works', 
        value: 'When new members join, they receive a DM with a verification link. Clicking the link redirects them to 42\'s OAuth2 page where they can log in and grant permission to verify their student status.', 
        inline: false 
      },
      { 
        name: '🔐 Security', 
        value: 'The bot uses OAuth2 with state parameters to prevent CSRF attacks. All verification is done server-side and no sensitive data is stored.', 
        inline: false 
      }
    )
    .setFooter({ text: 'Queernel Bot - 42 Student Verification' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

module.exports = {
  commands,
  handleCommands
}; 