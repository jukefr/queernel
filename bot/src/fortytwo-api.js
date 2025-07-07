const axios = require('axios');
const { debugRequest, debugResponse, debugOAuth2Flow } = require('./debug');

class FortyTwoAPI {
  constructor(clientId, clientSecret) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.baseURL = 'https://api.intra.42.fr';
  }

  /**
   * Exchange authorization code for access token
   * @param {string} code - Authorization code from OAuth2 callback
   * @param {string} redirectUri - OAuth2 redirect URI
   * @returns {Promise<Object>} - Token response
   */
  async exchangeCodeForToken(code, redirectUri) {
    try {
      const url = `${this.baseURL}/oauth/token`;
      const body = {
        grant_type: 'authorization_code',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: code,
        redirect_uri: redirectUri
      };
      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded'
      };

      debugOAuth2Flow('Token Exchange Request', { url, body, headers });
      debugRequest('POST', url, headers, body);

      const response = await axios.post(url, body, { headers });

      debugResponse(response.status, response.headers, response.data);
      debugOAuth2Flow('Token Exchange Success', { 
        status: response.status, 
        hasAccessToken: !!response.data.access_token 
      });

      return response.data;
    } catch (error) {
      debugOAuth2Flow('Token Exchange Error', { 
        status: error.response?.status,
        error: error.response?.data || error.message 
      });
      console.error('Token exchange error:', error.response?.data || error.message);
      throw new Error(`Failed to exchange code for token: ${error.response?.data?.error_description || error.message}`);
    }
  }

  /**
   * Get user information using access token
   * @param {string} accessToken - OAuth2 access token
   * @returns {Promise<Object>} - User data from 42 API
   */
  async getUserInfo(accessToken) {
    try {
      const url = `${this.baseURL}/v2/me`;
      const headers = {
        'Authorization': `Bearer ${accessToken}`
      };

      debugOAuth2Flow('Get User Info Request', { url, headers });
      debugRequest('GET', url, headers);

      const response = await axios.get(url, { headers });

      debugResponse(response.status, response.headers, response.data);
      debugOAuth2Flow('Get User Info Success', { 
        status: response.status,
        userLogin: response.data.login,
        userDisplayName: response.data.displayname
      });

      return response.data;
    } catch (error) {
      debugOAuth2Flow('Get User Info Error', { 
        status: error.response?.status,
        error: error.response?.data || error.message 
      });
      console.error('Get user info error:', error.response?.data || error.message);
      throw new Error(`Failed to get user info: ${error.response?.data?.error_description || error.message}`);
    }
  }

  /**
   * Get user information by login
   * @param {string} login - 42 login
   * @returns {Promise<Object>} - User data from 42 API
   */
  async getUserByLogin(login) {
    try {
      const url = `${this.baseURL}/v2/users/${login}`;
      
      debugOAuth2Flow('Get User By Login Request', { url, login });
      debugRequest('GET', url);

      const response = await axios.get(url);

      debugResponse(response.status, response.headers, response.data);
      debugOAuth2Flow('Get User By Login Success', { 
        status: response.status,
        userLogin: response.data.login,
        userDisplayName: response.data.displayname
      });

      return response.data;
    } catch (error) {
      debugOAuth2Flow('Get User By Login Error', { 
        status: error.response?.status,
        error: error.response?.data || error.message 
      });
      console.error('Get user by login error:', error.response?.data || error.message);
      throw new Error(`Failed to get user by login: ${error.response?.data?.error_description || error.message}`);
    }
  }

  /**
   * Get user's cursus information
   * @param {string} accessToken - OAuth2 access token
   * @returns {Promise<Array>} - Cursus data
   */
  async getUserCursus(accessToken) {
    try {
      const url = `${this.baseURL}/v2/me/cursus_users`;
      const headers = {
        'Authorization': `Bearer ${accessToken}`
      };

      debugOAuth2Flow('Get User Cursus Request', { url, headers });
      debugRequest('GET', url, headers);

      const response = await axios.get(url, { headers });

      debugResponse(response.status, response.headers, response.data);
      debugOAuth2Flow('Get User Cursus Success', { 
        status: response.status,
        cursusCount: response.data.length
      });

      return response.data;
    } catch (error) {
      debugOAuth2Flow('Get User Cursus Error', { 
        status: error.response?.status,
        error: error.response?.data || error.message 
      });
      console.error('Get user cursus error:', error.response?.data || error.message);
      throw new Error(`Failed to get user cursus: ${error.response?.data?.error_description || error.message}`);
    }
  }

  /**
   * Get user's campus information
   * @param {string} accessToken - OAuth2 access token
   * @returns {Promise<Array>} - Campus data
   */
  async getUserCampus(accessToken) {
    try {
      const url = `${this.baseURL}/v2/me/campus_users`;
      const headers = {
        'Authorization': `Bearer ${accessToken}`
      };

      debugOAuth2Flow('Get User Campus Request', { url, headers });
      debugRequest('GET', url, headers);

      const response = await axios.get(url, { headers });

      debugResponse(response.status, response.headers, response.data);
      debugOAuth2Flow('Get User Campus Success', { 
        status: response.status,
        campusCount: response.data.length
      });

      return response.data;
    } catch (error) {
      debugOAuth2Flow('Get User Campus Error', { 
        status: error.response?.status,
        error: error.response?.data || error.message 
      });
      console.error('Get user campus error:', error.response?.data || error.message);
      throw new Error(`Failed to get user campus: ${error.response?.data?.error_description || error.message}`);
    }
  }

  /**
   * Validate if user is a current 42 student
   * @param {Object} userData - User data from 42 API
   * @returns {boolean} - True if user is a current student
   */
  validateStudentStatus(userData) {
    // Check if user has required fields
    if (!userData || !userData.login || !userData.email) {
      return false;
    }

    // Check if user is not staff
    if (userData['staff?']) {
      return false;
    }

    // Check if user has active cursus (using cursus_users array)
    if (!userData.cursus_users || userData.cursus_users.length === 0) {
      return false;
    }

    // Check if user has at least one active campus
    if (!userData.campus || userData.campus.length === 0) {
      return false;
    }

    // Additional validation: check if user is active
    if (userData['active?'] === false) {
      return false;
    }

    // Additional validation: check if user has a valid pool year (indicating they're a student)
    if (!userData.pool_year && !userData.pool_month) {
      // This might be too strict, so we'll keep it as a warning
      console.warn(`User ${userData.login} has no pool year/month - might be a staff member`);
    }

    return true;
  }

  /**
   * Get user's primary campus name
   * @param {Object} userData - User data from 42 API
   * @returns {string|null} - Campus name or null
   */
  getPrimaryCampus(userData) {
    if (!userData.campus || userData.campus.length === 0) {
      return null;
    }
    return userData.campus[0].name;
  }

  /**
   * Get user's primary cursus name
   * @param {Object} userData - User data from 42 API
   * @returns {string|null} - Cursus name or null
   */
  getPrimaryCursus(userData) {
    if (!userData.cursus_users || userData.cursus_users.length === 0) {
      return null;
    }
    return userData.cursus_users[0].cursus.name;
  }

  /**
   * Get user's current level
   * @param {Object} userData - User data from 42 API
   * @returns {number|null} - Current level or null
   */
  getCurrentLevel(userData) {
    if (!userData.cursus_users || userData.cursus_users.length === 0) {
      return null;
    }
    return userData.cursus_users[0].level;
  }

  /**
   * Create a comprehensive user summary
   * @param {Object} userData - User data from 42 API
   * @returns {Object} - User summary
   */
  createUserSummary(userData) {
    return {
      login: userData.login,
      displayName: userData.displayname,
      email: userData.email,
      campus: this.getPrimaryCampus(userData),
      cursus: this.getPrimaryCursus(userData),
      level: this.getCurrentLevel(userData),
      poolYear: userData.pool_year,
      poolMonth: userData.pool_month,
      correctionPoints: userData.correction_point,
      wallet: userData.wallet,
      isStaff: userData['staff?'] || false,
      imageUrl: userData.image_url,
      location: userData.location
    };
  }
}

module.exports = FortyTwoAPI; 