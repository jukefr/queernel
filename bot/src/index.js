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

// Remove slash commands
async function removeCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    
    debugLog('Starting command removal');
    console.log('Started removing application (/) commands.');

    // First, get existing commands to see what we're removing
    try {
      const guildCommands = await rest.get(
        Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID)
      );
      const globalCommands = await rest.get(
        Routes.applicationCommands(process.env.DISCORD_CLIENT_ID)
      );
      
      console.log(`Found ${guildCommands.length} guild commands and ${globalCommands.length} global commands to remove`);
      debugLog('Existing commands found', { 
        guildCommands: guildCommands.length,
        globalCommands: globalCommands.length,
        guildCommandNames: guildCommands.map(cmd => cmd.name),
        globalCommandNames: globalCommands.map(cmd => cmd.name)
      });
    } catch (error) {
      console.log('Could not fetch existing commands:', error.message);
    }

    // Remove all commands for the specific guild
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
      { body: [] }
    );

    // Also remove global commands (in case any were registered globally)
    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: [] }
    );

    debugLog('Command removal successful', { 
      guildId: process.env.DISCORD_GUILD_ID
    });
    console.log('Successfully removed all guild and global (/) commands.');
  } catch (error) {
    debugLog('Command removal failed', { error: error.message });
    console.error('Error removing commands:', error);
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
  
  // Remove slash commands
  await removeCommands();
  
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

    console.log(`42 user verified successfully`);

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

    // Store user data for rules acceptance step
    pendingVerifications.set(state, {
      ...verification,
      userData: userData,
      step: 'rules_pending'
    });

    debugVerification('Rules Step Initiated', verification.discordUserId, {
      login: userData.login,
      displayName: userData.displayname
    });

    // Send rules acceptance page
    res.send(`
      <html>
        <head>
          <title>Queernel Rules - Accept to Continue</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              text-align: center; 
              padding: 50px; 
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              min-height: 100vh;
              margin: 0;
            }
            .container { 
              max-width: 600px; 
              margin: 0 auto; 
              background: rgba(255, 255, 255, 0.1);
              padding: 40px;
              border-radius: 15px;
              backdrop-filter: blur(10px);
              box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            }
            .rules-box {
              background: rgba(255, 255, 255, 0.2);
              padding: 30px;
              border-radius: 10px;
              margin: 20px 0;
              border: 2px solid rgba(255, 255, 255, 0.3);
            }
            .rule-text {
              font-size: 18px;
              font-weight: bold;
              margin: 20px 0;
              line-height: 1.6;
            }
            .buttons {
              display: flex;
              gap: 20px;
              justify-content: center;
              margin-top: 30px;
            }
            .btn {
              padding: 15px 30px;
              border: none;
              border-radius: 8px;
              font-size: 16px;
              font-weight: bold;
              cursor: pointer;
              text-decoration: none;
              display: inline-block;
              transition: all 0.3s ease;
            }
            .btn-accept {
              background: #4CAF50;
              color: white;
            }
            .btn-accept:hover {
              background: #45a049;
              transform: translateY(-2px);
            }
            .btn-decline {
              background: #f44336;
              color: white;
            }
            .btn-decline:hover {
              background: #da190b;
              transform: translateY(-2px);
            }
            .welcome-text {
              font-size: 24px;
              margin-bottom: 20px;
            }
            .user-info {
              background: rgba(255, 255, 255, 0.1);
              padding: 15px;
              border-radius: 8px;
              margin: 20px 0;
              font-size: 14px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🎉 Welcome to Queernel!</h1>
            <div class="welcome-text">You have been verified as a 42 student</div>
            
            <div class="user-info">
              <strong>Status:</strong> ✅ Verified 42 Student
            </div>

            <div class="rules-box">
              <h2>📋 Rules Acceptance Required</h2>
              <div class="rule-text">
                Je m'identifie comme queer / I identify as queer
              </div>
              <p>Please read and accept the rules above to continue with the verification process.</p>
            </div>

            <div class="buttons">
              <a href="/auth/rules/accept?state=${state}" class="btn btn-accept">✅ Accept & Continue</a>
              <a href="/auth/rules/decline?state=${state}" class="btn btn-decline">❌ Decline & Exit</a>
            </div>
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

// Rules acceptance route
app.get('/auth/rules/accept', async (req, res) => {
  const { state } = req.query;

  debugOAuth2Flow('Rules Acceptance Requested', { state });

  if (!state) {
    debugOAuth2Flow('Rules Acceptance Missing State', { state });
    return res.send(`
      <html>
        <head><title>Error</title></head>
        <body>
          <h1>❌ Error</h1>
          <p>Missing state parameter.</p>
          <p>Please try joining the server again.</p>
        </body>
      </html>
    `);
  }

  // Verify state parameter
  const verification = pendingVerifications.get(state);
  if (!verification || verification.step !== 'rules_pending') {
    debugOAuth2Flow('Invalid Rules State', { state, step: verification?.step });
    return res.send(`
      <html>
        <head><title>Error</title></head>
        <body>
          <h1>❌ Error</h1>
          <p>Invalid or expired verification request.</p>
          <p>Please try joining the server again.</p>
        </body>
      </html>
    `);
  }

  debugVerification('Rules Accepted', verification.discordUserId, {
    login: verification.userData.login,
    displayName: verification.userData.displayname
  });

  try {
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
    const successEmbed = createSuccessEmbed(verification.userData);

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
            body { 
              font-family: Arial, sans-serif; 
              text-align: center; 
              padding: 50px; 
              background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
              color: white;
              min-height: 100vh;
              margin: 0;
            }
            .container { 
              max-width: 600px; 
              margin: 0 auto; 
              background: rgba(255, 255, 255, 0.1);
              padding: 40px;
              border-radius: 15px;
              backdrop-filter: blur(10px);
              box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            }
            .success-icon {
              font-size: 64px;
              margin-bottom: 20px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success-icon">✅</div>
            <h1>Verification Successful!</h1>
            <h2>Welcome to Queernel!</h2>
            <p>You have successfully accepted the rules and been verified as a 42 student.</p>
            <p>The "42" role has been added to your Discord account.</p>
            <p>You can now close this window and return to Discord.</p>
          </div>
        </body>
      </html>
    `);

  } catch (error) {
    debugVerification('Rules Acceptance Failed', verification.discordUserId, { error: error.message });
    console.error('Rules acceptance error:', error.message);
    
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

// Rules decline route
app.get('/auth/rules/decline', async (req, res) => {
  const { state } = req.query;

  debugOAuth2Flow('Rules Decline Requested', { state });

  if (!state) {
    debugOAuth2Flow('Rules Decline Missing State', { state });
    return res.send(`
      <html>
        <head><title>Error</title></head>
        <body>
          <h1>❌ Error</h1>
          <p>Missing state parameter.</p>
          <p>Please try joining the server again.</p>
        </body>
      </html>
    `);
  }

  // Verify state parameter
  const verification = pendingVerifications.get(state);
  if (!verification || verification.step !== 'rules_pending') {
    debugOAuth2Flow('Invalid Rules State', { state, step: verification?.step });
    return res.send(`
      <html>
        <head><title>Error</title></head>
        <body>
          <h1>❌ Error</h1>
          <p>Invalid or expired verification request.</p>
          <p>Please try joining the server again.</p>
        </body>
      </html>
    `);
  }

  debugVerification('Rules Declined', verification.discordUserId, {
    login: verification.userData.login,
    displayName: verification.userData.displayname
  });

  // Clean up
  pendingVerifications.delete(state);

  // Send decline page
  res.send(`
    <html>
      <head>
        <title>Verification Declined</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background: linear-gradient(135deg, #f44336 0%, #da190b 100%);
            color: white;
            min-height: 100vh;
            margin: 0;
          }
          .container { 
            max-width: 600px; 
            margin: 0 auto; 
            background: rgba(255, 255, 255, 0.1);
            padding: 40px;
            border-radius: 15px;
            backdrop-filter: blur(10px);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
          }
          .decline-icon {
            font-size: 64px;
            margin-bottom: 20px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="decline-icon">❌</div>
          <h1>Verification Declined</h1>
          <h2>Rules Not Accepted</h2>
          <p>You have declined to accept the Queernel rules.</p>
          <p>You will not receive the "42" role and cannot access all server features.</p>
          <p>If you change your mind, you can try joining the server again.</p>
        </div>
      </body>
    </html>
  `);
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