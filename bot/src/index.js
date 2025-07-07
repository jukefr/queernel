require('dotenv').config();
const { Client, GatewayIntentBits, Events, EmbedBuilder, REST, Routes } = require('discord.js');
const express = require('express');
const crypto = require('crypto');

// Import custom modules
const FortyTwoAPI = require('./fortytwo-api');
const { 
  createWelcomeEmbed, 
  createSuccessEmbed, 
  createErrorEmbed,
  cleanupExpiredVerifications,
  generateState,
  createAuthUrl
} = require('./utils');
const { commands, handleCommands } = require('./commands');
const { debugLog, debugDiscordEvent, debugVerification, debugOAuth2Flow } = require('./debug');

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ]
});

// Initialize Express server for OAuth2 callback
const app = express();
const PORT = process.env.PORT || 3000;

// Initialize 42 API
const fortyTwoAPI = new FortyTwoAPI(
  process.env.FORTYTWO_CLIENT_ID,
  process.env.FORTYTWO_CLIENT_SECRET
);

// Store pending verifications (in production, use a proper database)
const pendingVerifications = new Map();

// Register slash commands
async function registerCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    
    debugLog('Starting command registration');
    console.log('Started refreshing application (/) commands.');

    // Register commands for the specific guild (server) instead of globally
    // This makes them appear immediately and only in your server
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
      { body: commands.map(command => command.toJSON()) }
    );

    debugLog('Command registration successful', { 
      guildId: process.env.DISCORD_GUILD_ID,
      commandCount: commands.length 
    });
    console.log('Successfully reloaded guild (/) commands.');
  } catch (error) {
    debugLog('Command registration failed', { error: error.message });
    console.error('Error registering commands:', error);
  }
}

// Discord bot events
client.once(Events.ClientReady, async () => {
  debugDiscordEvent('Client Ready', { 
    botTag: client.user.tag,
    botId: client.user.id,
    guildCount: client.guilds.cache.size
  });
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Bot is ready to verify 42 students!`);
  
  // Register slash commands
  await registerCommands();
  
  // Set up periodic cleanup of expired verifications
  setInterval(() => {
    const beforeCount = pendingVerifications.size;
    cleanupExpiredVerifications(pendingVerifications);
    const afterCount = pendingVerifications.size;
    if (beforeCount !== afterCount) {
      debugLog(`Cleaned up ${beforeCount - afterCount} expired verifications`);
    }
  }, 5 * 60 * 1000); // Clean up every 5 minutes
});

// Handle slash command interactions
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  debugDiscordEvent('Command Interaction', {
    commandName: interaction.commandName,
    userId: interaction.user.id,
    username: interaction.user.tag,
    guildId: interaction.guildId,
    channelId: interaction.channelId
  });

  await handleCommands(interaction, pendingVerifications);
});

// Handle new member joins
client.on(Events.GuildMemberAdd, async (member) => {
  // Only process if it's the Queernel server
  if (member.guild.id !== process.env.DISCORD_GUILD_ID) return;

  debugDiscordEvent('Guild Member Add', {
    userId: member.user.id,
    username: member.user.tag,
    guildId: member.guild.id,
    guildName: member.guild.name
  });

  console.log(`New member joined: ${member.user.tag} (${member.user.id})`);

  // Check if user already has the 42 role
  const hasRole = member.roles.cache.has(process.env.DISCORD_42_ROLE_ID);
  if (hasRole) {
    debugVerification('Skip - Already has role', member.user.id, { hasRole });
    console.log(`${member.user.tag} already has the 42 role, skipping verification`);
    return;
  }

  // Generate state parameter for OAuth2 security
  const state = generateState();
  
  // Store the verification attempt
  pendingVerifications.set(state, {
    discordUserId: member.user.id,
    discordUsername: member.user.tag,
    timestamp: Date.now()
  });

  debugVerification('Verification Started', member.user.id, { 
    state,
    pendingVerificationsCount: pendingVerifications.size 
  });

  // Create OAuth2 authorization URL
  const authUrl = createAuthUrl(
    process.env.FORTYTWO_CLIENT_ID,
    process.env.FORTYTWO_REDIRECT_URI,
    state
  );

  debugOAuth2Flow('Authorization URL Created', { 
    state,
    redirectUri: process.env.FORTYTWO_REDIRECT_URI,
    hasAuthUrl: !!authUrl 
  });

  // Create welcome embed
  const welcomeEmbed = createWelcomeEmbed(member.user, authUrl);

  try {
    // Send welcome message with verification link
    await member.send({ embeds: [welcomeEmbed] });
    debugVerification('Welcome DM Sent', member.user.id, { success: true });
    console.log(`Sent verification link to ${member.user.tag}`);
  } catch (error) {
    debugVerification('Welcome DM Failed', member.user.id, { error: error.message });
    console.error(`Could not send DM to ${member.user.tag}:`, error.message);
    
    // If DM fails, try to send in a public channel
    const guild = member.guild;
    const systemChannel = guild.systemChannel;
    
    if (systemChannel) {
      const publicEmbed = new EmbedBuilder()
        .setColor('#ff9900')
        .setTitle('Welcome Message')
        .setDescription(`${member.user}, I couldn't send you a DM. Please enable DMs from server members to receive your verification link.`)
        .setFooter({ text: 'Queernel Bot' })
        .setTimestamp();
      
      await systemChannel.send({ embeds: [publicEmbed] });
      debugVerification('Public Welcome Sent', member.user.id, { channelId: systemChannel.id });
    }
  }
});

// Express routes for OAuth2 callback
app.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;

  debugOAuth2Flow('Callback Received', { 
    hasCode: !!code,
    hasState: !!state,
    hasError: !!error,
    queryParams: Object.keys(req.query)
  });

  if (error) {
    debugOAuth2Flow('Callback Error', { error });
    return res.send(`
      <html>
        <head><title>Verification Failed</title></head>
        <body>
          <h1>❌ Verification Failed</h1>
          <p>Error: ${error}</p>
          <p>Please try again or contact an administrator.</p>
        </body>
      </html>
    `);
  }

  if (!code || !state) {
    debugOAuth2Flow('Callback Missing Parameters', { code: !!code, state: !!state });
    return res.send(`
      <html>
        <head><title>Verification Failed</title></head>
        <body>
          <h1>❌ Verification Failed</h1>
          <p>Missing authorization code or state parameter.</p>
          <p>Please try again.</p>
        </body>
      </html>
    `);
  }

  // Verify state parameter
  const verification = pendingVerifications.get(state);
  if (!verification) {
    debugOAuth2Flow('Invalid State Parameter', { state, pendingVerificationsCount: pendingVerifications.size });
    return res.send(`
      <html>
        <head><title>Verification Failed</title></head>
        <body>
          <h1>❌ Verification Failed</h1>
          <p>Invalid or expired verification request.</p>
          <p>Please try joining the server again.</p>
        </body>
      </html>
    `);
  }

  debugVerification('State Validated', verification.discordUserId, { state });

  try {
    // Exchange code for access token
    debugOAuth2Flow('Starting Token Exchange', { code: code.substring(0, 10) + '...' });
    const tokenResponse = await fortyTwoAPI.exchangeCodeForToken(code, process.env.FORTYTWO_REDIRECT_URI);
    const { access_token } = tokenResponse;

    debugOAuth2Flow('Token Exchange Complete', { hasAccessToken: !!access_token });

    // Get user information from 42 API
    debugOAuth2Flow('Getting User Info');
    const userData = await fortyTwoAPI.getUserInfo(access_token);
    
    debugVerification('User Info Retrieved', verification.discordUserId, {
      login: userData.login,
      displayName: userData.displayname,
      email: userData.email
    });
    
    // Validate student status
    if (!fortyTwoAPI.validateStudentStatus(userData)) {
      debugVerification('Student Validation Failed', verification.discordUserId, {
        login: userData.login,
        isStaff: userData['staff?'],
        hasCursus: !!userData.cursus_users?.length,
        hasCampus: !!userData.campus?.length,
        isActive: userData['active?']
      });
      throw new Error('User is not a valid 42 student or is staff');
    }

    debugVerification('Student Validation Passed', verification.discordUserId, {
      login: userData.login,
      displayName: userData.displayname
    });

    console.log(`42 user verified: ${userData.login} (${userData.displayname})`);

    // Find the member in the Discord server
    const guild = client.guilds.cache.get(process.env.DISCORD_GUILD_ID);
    if (!guild) {
      debugVerification('Guild Not Found', verification.discordUserId, { guildId: process.env.DISCORD_GUILD_ID });
      throw new Error('Guild not found');
    }

    const member = await guild.members.fetch(verification.discordUserId);
    if (!member) {
      debugVerification('Member Not Found', verification.discordUserId, { guildId: guild.id });
      throw new Error('Member not found in guild');
    }

    // Add the 42 role
    const role = guild.roles.cache.get(process.env.DISCORD_42_ROLE_ID);
    if (!role) {
      debugVerification('Role Not Found', verification.discordUserId, { roleId: process.env.DISCORD_42_ROLE_ID });
      throw new Error('42 role not found');
    }

    // Debug role and bot permissions
    const botMember = guild.members.cache.get(client.user.id);
    const botHighestRole = botMember.roles.highest;
    const targetRole = role;
    
    debugVerification('Role Assignment Debug', verification.discordUserId, {
      botId: client.user.id,
      botHighestRoleId: botHighestRole.id,
      botHighestRoleName: botHighestRole.name,
      botHighestRolePosition: botHighestRole.position,
      targetRoleId: targetRole.id,
      targetRoleName: targetRole.name,
      targetRolePosition: targetRole.position,
      canManageRoles: botMember.permissions.has('ManageRoles'),
      botCanManageTargetRole: botHighestRole.position > targetRole.position
    });

    try {
      await member.roles.add(role);
      debugVerification('Role Added Successfully', verification.discordUserId, {
        roleId: role.id,
        roleName: role.name
      });
    } catch (roleError) {
      debugVerification('Role Assignment Failed', verification.discordUserId, {
        error: roleError.message,
        errorCode: roleError.code,
        botHighestRolePosition: botHighestRole.position,
        targetRolePosition: targetRole.position,
        canManageRoles: botMember.permissions.has('ManageRoles')
      });
      throw new Error(`Failed to assign role: ${roleError.message}`);
    }

    // Send success message
    const successEmbed = createSuccessEmbed(userData);

    try {
      await member.send({ embeds: [successEmbed] });
      debugVerification('Success DM Sent', verification.discordUserId, { success: true });
    } catch (dmError) {
      debugVerification('Success DM Failed', verification.discordUserId, { error: dmError.message });
      console.log(`Could not send success DM to ${member.user.tag}`);
    }

    // Clean up
    pendingVerifications.delete(state);
    debugVerification('Verification Complete', verification.discordUserId, {
      pendingVerificationsCount: pendingVerifications.size
    });

    // Send success page
    res.send(`
      <html>
        <head>
          <title>Verification Successful</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            .success { color: #00ff00; }
            .container { max-width: 600px; margin: 0 auto; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1 class="success">✅ Verification Successful!</h1>
            <h2>Welcome to Queernel!</h2>
            <p>You have been successfully verified as a 42 student.</p>
            <p>The "42" role has been added to your Discord account.</p>
            <p>You can now close this window and return to Discord.</p>
            <hr>
            <p><small>42 Login: ${userData.login}</small></p>
          </div>
        </body>
      </html>
    `);

  } catch (error) {
    debugVerification('Verification Failed', verification.discordUserId, { error: error.message });
    console.error('Verification error:', error.message);
    
    // Clean up
    pendingVerifications.delete(state);

    res.send(`
      <html>
        <head><title>Verification Failed</title></head>
        <body>
          <h1>❌ Verification Failed</h1>
          <p>An error occurred during verification: ${error.message}</p>
          <p>Please try again or contact an administrator.</p>
        </body>
      </html>
    `);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  const healthData = { 
    status: 'ok', 
    bot: client.user ? 'connected' : 'disconnected',
    pendingVerifications: pendingVerifications.size,
    uptime: process.uptime(),
    memory: process.memoryUsage()
  };
  
  debugLog('Health Check', healthData);
  
  res.json(healthData);
});

// Start the Express server
app.listen(PORT, () => {
  debugLog('Express Server Started', { port: PORT });
  console.log(`OAuth2 callback server running on port ${PORT}`);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN); 