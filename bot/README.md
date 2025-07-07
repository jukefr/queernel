# Queernel 42 Student Verification Bot

A Discord bot that automatically verifies 42 students when they join the Queernel Discord server using the 42 API OAuth2 flow.

## Features

- 🎉 **Automatic Welcome**: Sends a welcome message with verification instructions when new members join
- 🔐 **42 OAuth2 Integration**: Secure verification using 42's official OAuth2 API
- ✅ **Role Assignment**: Automatically assigns the "42" role to verified students
- 📱 **DM Support**: Sends verification links via direct messages
- 🛡️ **Security**: Uses state parameters to prevent CSRF attacks
- 📊 **Health Monitoring**: Built-in health check endpoint
- 🔍 **Debug Logging**: Comprehensive debug logging for troubleshooting

## Prerequisites

Before setting up the bot, you'll need:

1. **Discord Bot Token**: Create a Discord application and bot at [Discord Developer Portal](https://discord.com/developers/applications)
2. **42 API Credentials**: Register your application at [42 API](https://api.intra.42.fr/oauth/applications)
3. **Discord Server**: The Queernel Discord server where the bot will operate
4. **42 Role**: A role named "42" in your Discord server

## Setup Instructions

### 1. Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to the "Bot" section and create a bot
4. Copy the bot token
5. Enable the following intents:
   - Server Members Intent
   - Message Content Intent
6. Go to "OAuth2" → "URL Generator"
7. Select scopes: `bot`, `applications.commands`
8. Select permissions: `Manage Roles`, `Send Messages`, `Use Slash Commands`
9. Copy the generated URL and invite the bot to your server

### 2. 42 API Application Setup

1. Go to [42 API Applications](https://api.intra.42.fr/oauth/applications)
2. Create a new application
3. Set the redirect URI to: `http://localhost:3000/auth/callback` (for development)
4. Copy the Client ID and Client Secret

### 3. Discord Server Setup

1. Create a role named "42" in your Discord server
2. Copy the role ID (right-click the role → Copy ID)
3. Copy your server ID (right-click the server name → Copy ID)

### 4. Environment Configuration

1. Copy `env.example` to `.env`
2. Fill in all the required environment variables:

```env
# Discord Bot Configuration
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_client_id_here
DISCORD_GUILD_ID=your_queernel_server_id_here
DISCORD_42_ROLE_ID=your_42_role_id_here

# 42 API Configuration
FORTYTWO_CLIENT_ID=your_42_client_id_here
FORTYTWO_CLIENT_SECRET=your_42_client_secret_here
FORTYTWO_REDIRECT_URI=http://localhost:3000/auth/callback

# Server Configuration
PORT=3000
BASE_URL=http://localhost:3000

# Debug Configuration
DEBUG=false
```

### 5. Installation and Running

1. Install dependencies:
```bash
npm install
```

2. Start the bot:
```bash
npm start
```

For development with auto-restart:
```bash
npm run dev
```

## How It Works

### 1. Member Joins Server
When a new member joins the Queernel Discord server:
- The bot detects the join event
- Generates a secure state parameter
- Creates an OAuth2 authorization URL
- Sends a welcome message with verification instructions via DM

### 2. User Verifies with 42
The user clicks the verification link and:
- Is redirected to 42's authorization page
- Logs in with their 42 account
- Grants permission to the application
- Is redirected back to the bot's callback URL

### 3. Verification Process
The bot:
- Receives the authorization code
- Exchanges it for an access token
- Fetches user information from 42 API
- Verifies the user is a 42 student
- Assigns the "42" role
- Sends a success confirmation

## API Endpoints

- `GET /auth/callback` - OAuth2 callback endpoint
- `GET /health` - Health check endpoint

## Security Features

- **State Parameter**: Prevents CSRF attacks
- **Secure Token Exchange**: Server-to-server communication
- **Error Handling**: Comprehensive error handling and user feedback
- **Input Validation**: Validates all OAuth2 parameters

## Debug Mode

The bot includes comprehensive debug logging that can be enabled by setting the `DEBUG` environment variable to `true`:

```env
DEBUG=true
```

When debug mode is enabled, the bot will log detailed information about:

- **Discord Events**: All Discord interactions, member joins, and command executions
- **OAuth2 Flow**: Complete OAuth2 authorization flow with request/response details
- **API Calls**: All 42 API requests and responses (with sensitive data masked)
- **Verification Process**: Step-by-step verification process for each user
- **Role Operations**: Role assignments and removals
- **Error Details**: Detailed error information for troubleshooting

### Debug Log Examples

```
[2025-01-28T10:30:15.123Z] DEBUG: Discord Event: Guild Member Add
[2025-01-28T10:30:15.124Z] DEBUG: Event Data: {"userId":"123456789","username":"user#1234","guildId":"987654321","guildName":"Queernel"}

[2025-01-28T10:30:15.125Z] DEBUG: OAuth2 Flow: Authorization URL Created
[2025-01-28T10:30:15.126Z] DEBUG: OAuth2 Data: {"clientId":"***MASKED***","redirectUri":"http://localhost:3000/auth/callback","state":"abc123..."}

[2025-01-28T10:30:20.456Z] DEBUG: HTTP POST https://api.intra.42.fr/oauth/token
[2025-01-28T10:30:20.457Z] DEBUG: Headers: {"Content-Type":"application/x-www-form-urlencoded"}
[2025-01-28T10:30:20.458Z] DEBUG: Body: {"grant_type":"authorization_code","client_id":"***MASKED***","client_secret":"***MASKED***","code":"***MASKED***","redirect_uri":"http://localhost:3000/auth/callback"}
```

**Note**: All sensitive data (tokens, secrets, authorization codes) are automatically masked in debug logs for security.

## Production Deployment

For production deployment:

1. **Update Redirect URI**: Change `FORTYTWO_REDIRECT_URI` to your production domain
2. **Use HTTPS**: Ensure your callback server uses HTTPS
3. **Database Storage**: Replace the in-memory `pendingVerifications` Map with a proper database
4. **Environment Variables**: Use proper environment variable management
5. **Process Manager**: Use PM2 or similar for process management
6. **Reverse Proxy**: Use Nginx or similar for SSL termination
7. **Debug Mode**: Set `DEBUG=false` in production for security

## Troubleshooting

### Common Issues

1. **Bot not responding to joins**
   - Check if the bot has the "Server Members Intent" enabled
   - Verify the bot is in the correct server
   - Check console logs for errors
   - Enable debug mode for detailed logging

2. **OAuth2 callback fails**
   - Verify the redirect URI matches exactly in 42 API settings
   - Check that all environment variables are set correctly
   - Ensure the callback server is accessible
   - Enable debug mode to see detailed OAuth2 flow logs

3. **Role assignment fails**
   - Verify the bot has "Manage Roles" permission
   - Check that the role ID is correct
   - Ensure the bot's role is higher than the "42" role in the hierarchy
   - Enable debug mode to see role operation details

### Debug Mode

Enable debug logging by setting:
```env
DEBUG=true
```

This will provide detailed logs for all bot operations, making it easier to identify and fix issues.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For support, please open an issue on GitHub or contact the Queernel team. 