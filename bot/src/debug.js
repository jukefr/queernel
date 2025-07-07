// Debug utility for detailed logging
const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

// Helper function to mask sensitive data in URLs and objects
function maskSensitiveData(data, sensitiveKeys = ['token', 'secret', 'password', 'authorization']) {
  if (typeof data === 'string') {
    // Mask tokens in URLs
    return data.replace(/([?&](token|secret|password|authorization)=)([^&]*)/gi, '$1***MASKED***');
  }
  
  if (typeof data === 'object' && data !== null) {
    const masked = Array.isArray(data) ? [] : {};
    
    for (const [key, value] of Object.entries(data)) {
      if (sensitiveKeys.some(sensitiveKey => 
        key.toLowerCase().includes(sensitiveKey.toLowerCase())
      )) {
        masked[key] = '***MASKED***';
      } else if (typeof value === 'object' && value !== null) {
        masked[key] = maskSensitiveData(value, sensitiveKeys);
      } else {
        masked[key] = value;
      }
    }
    
    return masked;
  }
  
  return data;
}

// Debug logging functions
function debugLog(message, data = null) {
  if (!DEBUG) return;
  
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] DEBUG:`;
  
  if (data) {
    const maskedData = maskSensitiveData(data);
    console.log(`${prefix} ${message}`, JSON.stringify(maskedData, null, 2));
  } else {
    console.log(`${prefix} ${message}`);
  }
}

function debugRequest(method, url, headers = {}, body = null) {
  if (!DEBUG) return;
  
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] DEBUG:`;
  
  console.log(`${prefix} HTTP ${method.toUpperCase()} ${url}`);
  
  if (Object.keys(headers).length > 0) {
    const maskedHeaders = maskSensitiveData(headers);
    console.log(`${prefix} Headers:`, JSON.stringify(maskedHeaders, null, 2));
  }
  
  if (body) {
    const maskedBody = maskSensitiveData(body);
    console.log(`${prefix} Body:`, JSON.stringify(maskedBody, null, 2));
  }
}

function debugResponse(statusCode, headers = {}, body = null) {
  if (!DEBUG) return;
  
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] DEBUG:`;
  
  console.log(`${prefix} Response Status: ${statusCode}`);
  
  if (Object.keys(headers).length > 0) {
    const maskedHeaders = maskSensitiveData(headers);
    console.log(`${prefix} Response Headers:`, JSON.stringify(maskedHeaders, null, 2));
  }
  
  if (body) {
    const maskedBody = maskSensitiveData(body);
    console.log(`${prefix} Response Body:`, JSON.stringify(maskedBody, null, 2));
  }
}

function debugDiscordEvent(event, data = null) {
  if (!DEBUG) return;
  
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] DEBUG:`;
  
  console.log(`${prefix} Discord Event: ${event}`);
  
  if (data) {
    const maskedData = maskSensitiveData(data);
    console.log(`${prefix} Event Data:`, JSON.stringify(maskedData, null, 2));
  }
}

function debugOAuth2Flow(step, data = null) {
  if (!DEBUG) return;
  
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] DEBUG:`;
  
  console.log(`${prefix} OAuth2 Flow: ${step}`);
  
  if (data) {
    const maskedData = maskSensitiveData(data);
    console.log(`${prefix} OAuth2 Data:`, JSON.stringify(maskedData, null, 2));
  }
}

function debugVerification(step, userId, data = null) {
  if (!DEBUG) return;
  
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] DEBUG:`;
  
  console.log(`${prefix} Verification [${step}] for user: ${userId}`);
  
  if (data) {
    const maskedData = maskSensitiveData(data);
    console.log(`${prefix} Verification Data:`, JSON.stringify(maskedData, null, 2));
  }
}

module.exports = {
  DEBUG,
  debugLog,
  debugRequest,
  debugResponse,
  debugDiscordEvent,
  debugOAuth2Flow,
  debugVerification,
  maskSensitiveData
}; 