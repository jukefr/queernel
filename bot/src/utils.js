const { EmbedBuilder } = require('discord.js');
const { debugLog, debugOAuth2Flow } = require('./debug');

/**
 * Check if a user has the 42 role
 * @param {GuildMember} member - Discord guild member
 * @param {string} roleId - The 42 role ID
 * @returns {boolean} - True if user has the role
 */
function has42Role(member, roleId) {
  const hasRole = member.roles.cache.has(roleId);
  debugLog('Role Check', { 
    userId: member.user.id, 
    username: member.user.tag, 
    roleId, 
    hasRole 
  });
  return hasRole;
}

/**
 * Add the 42 role to a member
 * @param {GuildMember} member - Discord guild member
 * @param {string} roleId - The 42 role ID
 * @returns {Promise<boolean>} - True if role was added successfully
 */
async function add42Role(member, roleId) {
  try {
    const role = member.guild.roles.cache.get(roleId);
    if (!role) {
      debugLog('Role Not Found', { roleId, guildId: member.guild.id });
      throw new Error('42 role not found');
    }
    
    await member.roles.add(role);
    debugLog('Role Added Successfully', { 
      userId: member.user.id, 
      username: member.user.tag, 
      roleId, 
      roleName: role.name 
    });
    return true;
  } catch (error) {
    debugLog('Role Addition Failed', { 
      userId: member.user.id, 
      username: member.user.tag, 
      roleId, 
      error: error.message 
    });
    console.error(`Failed to add 42 role to ${member.user.tag}:`, error.message);
    return false;
  }
}

/**
 * Remove the 42 role from a member
 * @param {GuildMember} member - Discord guild member
 * @param {string} roleId - The 42 role ID
 * @returns {Promise<boolean>} - True if role was removed successfully
 */
async function remove42Role(member, roleId) {
  try {
    const role = member.guild.roles.cache.get(roleId);
    if (!role) {
      debugLog('Role Not Found for Removal', { roleId, guildId: member.guild.id });
      throw new Error('42 role not found');
    }
    
    await member.roles.remove(role);
    debugLog('Role Removed Successfully', { 
      userId: member.user.id, 
      username: member.user.tag, 
      roleId, 
      roleName: role.name 
    });
    return true;
  } catch (error) {
    debugLog('Role Removal Failed', { 
      userId: member.user.id, 
      username: member.user.tag, 
      roleId, 
      error: error.message 
    });
    console.error(`Failed to remove 42 role from ${member.user.tag}:`, error.message);
    return false;
  }
}

/**
 * Create a welcome embed for new members
 * @param {User} user - Discord user
 * @param {string} authUrl - OAuth2 authorization URL
 * @returns {EmbedBuilder} - Discord embed
 */
function createWelcomeEmbed(user, authUrl) {
  debugLog('Creating Welcome Embed', { 
    userId: user.id, 
    username: user.tag, 
    hasAuthUrl: !!authUrl 
  });
  
  return new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('Welcome to Queernel! 🎉')
    .setDescription(`Hello ${user}! Welcome to the Queernel Discord server.`)
    .addFields(
      { 
        name: '🔐 42 Student Verification Required', 
        value: 'To access all server features, please verify that you are a 42 student by logging in with your 42 account.' 
      },
      { 
        name: '📋 What happens next?', 
        value: '1. Click the verification link below\n2. Log in with your 42 account\n3. Grant permission to verify your student status\n4. Review and accept the server rules\n5. You\'ll receive the "42" role automatically' 
      },
      { 
        name: '🔗 Verification Link', 
        value: `[Click here to verify with 42](${authUrl})` 
      }
    )
    .setFooter({ text: 'Queernel Bot - 42 Student Verification' })
    .setTimestamp();
}

/**
 * Create a success embed for verified users
 * @param {Object} userData - 42 API user data
 * @returns {EmbedBuilder} - Discord embed
 */
function createSuccessEmbed(userData) {
  debugLog('Creating Success Embed', { 
    login: userData.login, 
    displayName: userData.displayname 
  });
  
  return new EmbedBuilder()
    .setColor('#00ff00')
    .setTitle('✅ Verification Successful!')
    .setDescription('Welcome to Queernel! You have been successfully verified as a 42 student and have accepted the server rules.')
    .addFields(
      { name: 'Status', value: '✅ Verified 42 Student', inline: true },
      { name: 'Rules', value: '✅ Accepted', inline: true }
    )
    .setFooter({ text: 'Queernel Bot - 42 Student Verification' })
    .setTimestamp();
}

/**
 * Create an error embed for failed verifications
 * @param {string} error - Error message
 * @returns {EmbedBuilder} - Discord embed
 */
function createErrorEmbed(error) {
  debugLog('Creating Error Embed', { error });
  
  return new EmbedBuilder()
    .setColor('#ff0000')
    .setTitle('❌ Verification Failed')
    .setDescription(`An error occurred during verification: ${error}`)
    .addFields(
      { 
        name: 'What to do?', 
        value: 'Please try joining the server again or contact an administrator if the problem persists.' 
      }
    )
    .setFooter({ text: 'Queernel Bot - 42 Student Verification' })
    .setTimestamp();
}

/**
 * Clean up expired verification attempts
 * @param {Map} pendingVerifications - Map of pending verifications
 * @param {number} maxAge - Maximum age in milliseconds (default: 10 minutes)
 */
function cleanupExpiredVerifications(pendingVerifications, maxAge = 10 * 60 * 1000) {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [state, verification] of pendingVerifications.entries()) {
    if (now - verification.timestamp > maxAge) {
      pendingVerifications.delete(state);
      cleanedCount++;
      debugLog('Cleaned Expired Verification', { 
        state, 
        username: verification.discordUsername,
        age: now - verification.timestamp 
      });
      console.log(`Cleaned up expired verification for ${verification.discordUsername}`);
    }
  }
  
  if (cleanedCount > 0) {
    debugLog('Cleanup Complete', { 
      cleanedCount, 
      remainingCount: pendingVerifications.size 
    });
  }
}

/**
 * Validate 42 user data
 * @param {Object} userData - User data from 42 API
 * @returns {boolean} - True if valid 42 student
 */
function validate42User(userData) {
  // Basic validation - check if user has required fields
  if (!userData || !userData.login || !userData.email) {
    debugLog('User Validation Failed - Missing Fields', { 
      hasUserData: !!userData,
      hasLogin: !!userData?.login,
      hasEmail: !!userData?.email 
    });
    return false;
  }
  
  // Check if user has any cursus (indicating they're a student) - using cursus_users array
  if (!userData.cursus_users || userData.cursus_users.length === 0) {
    debugLog('User Validation Failed - No Cursus', { 
      login: userData.login,
      cursusCount: userData.cursus_users?.length || 0 
    });
    return false;
  }
  
  debugLog('User Validation Passed', { 
    login: userData.login,
    cursusCount: userData.cursus_users.length 
  });
  
  // Additional validation can be added here
  // For example, check if user is not staff, has valid campus, etc.
  
  return true;
}

/**
 * Generate a secure state parameter
 * @returns {string} - Random hex string
 */
function generateState() {
  const crypto = require('crypto');
  const state = crypto.randomBytes(32).toString('hex');
  debugLog('Generated State Parameter', { state });
  return state;
}

/**
 * Create OAuth2 authorization URL
 * @param {string} clientId - 42 API client ID
 * @param {string} redirectUri - OAuth2 redirect URI
 * @param {string} state - State parameter
 * @returns {string} - Authorization URL
 */
function createAuthUrl(clientId, redirectUri, state) {
  const url = new URL('https://api.intra.42.fr/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'public');
  url.searchParams.set('state', state);
  
  const authUrl = url.toString();
  
  debugOAuth2Flow('Authorization URL Created', { 
    clientId,
    redirectUri,
    state,
    authUrl: authUrl.replace(/client_id=([^&]+)/, 'client_id=***MASKED***')
  });
  
  return authUrl;
}

module.exports = {
  has42Role,
  add42Role,
  remove42Role,
  createWelcomeEmbed,
  createSuccessEmbed,
  createErrorEmbed,
  cleanupExpiredVerifications,
  validate42User,
  generateState,
  createAuthUrl
}; 