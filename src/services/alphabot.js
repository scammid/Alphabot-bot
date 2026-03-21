const axios = require('axios');

const BASE_URL = 'https://api.alphabot.app/v1';

function createClient(apiKey) {
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
}

async function validateApiKey(apiKey) {
  try {
    const client = createClient(apiKey);
    const res = await client.get('/raffles', { params: { status: 'active', pageSize: 1 } });
    if (res.data?.success) return { valid: true, data: res.data };
    return { valid: false, error: 'Invalid response' };
  } catch (err) {
    const status = err.response?.status;
    const message = err.response?.data?.errors?.[0]?.message || err.message;
    if (status === 401) return { valid: false, error: 'Invalid API key' };
    return { valid: false, error: message };
  }
}

async function getOpenRaffles(apiKey, teamIds = []) {
  try {
    const client = createClient(apiKey);
    let allRaffles = [];
    if (teamIds.length > 0) {
      for (const alpha of teamIds) {
        const res = await client.get('/raffles', { params: { status: 'active', pageSize: 50, alpha } });
        allRaffles = [...allRaffles, ...(res.data?.data?.raffles || [])];
      }
    } else {
      const res = await client.get('/raffles', { params: { status: 'active', pageSize: 50 } });
      allRaffles = res.data?.data?.raffles || [];
    }
    console.log(`[Alphabot] [ALL] Found ${allRaffles.length} active raffle(s)`);
    return { success: true, raffles: allRaffles };
  } catch (err) {
    const status = err.response?.status;
    const message = err.response?.data?.errors?.[0]?.message || err.message;
    console.error('[Alphabot] getOpenRaffles error:', status, message);
    if (status === 401) return { success: false, error: message, invalidKey: true };
    if (status === 429) return { success: false, error: message, rateLimited: true };
    return { success: false, error: message };
  }
}

async function getMyCommunityRaffles(apiKey) {
  try {
    const client = createClient(apiKey);
    const res = await client.get('/raffles', {
      params: { status: 'active', pageSize: 50, scope: 'community' }
    });
    const raffles = res.data?.data?.raffles || [];
    console.log(`[Alphabot] [COMMUNITY] Found ${raffles.length} community raffle(s)`);
    return { success: true, raffles };
  } catch (err) {
    const status = err.response?.status;
    const message = err.response?.data?.errors?.[0]?.message || err.message;
    console.error('[Alphabot] getMyCommunityRaffles error:', status, message);
    if (status === 401) return { success: false, error: message, invalidKey: true };
    if (status === 429) return { success: false, error: message, rateLimited: true };
    return { success: false, error: message };
  }
}

async function enterRaffle(apiKey, slug) {
  try {
    const client = createClient(apiKey);
    const res = await client.post('/register', { slug });
    const validation = res.data?.data?.validation;
    const success = validation?.success;
    const reason = validation?.reason;
    const resultMd = res.data?.data?.resultMd || '';

    if (success === false && reason) {
      if (reason.toLowerCase().includes('already')) {
        return { success: false, alreadyEntered: true, error: reason };
      }
      // Detect Twitter/X account issues
      if (
        reason.toLowerCase().includes('twitter') ||
        reason.toLowerCase().includes('x account') ||
        resultMd.toLowerCase().includes('twitter') ||
        resultMd.toLowerCase().includes('x account') ||
        (validation?.twitterValid === false)
      ) {
        return { success: false, ineligible: true, twitterIssue: true, error: reason };
      }
      return { success: false, ineligible: true, error: reason };
    }
    return { success: true, data: res.data };
  } catch (err) {
    const status = err.response?.status;
    const message = err.response?.data?.errors?.[0]?.message || err.message;
    if (status === 401) return { success: false, invalidKey: true, error: message };
    if (status === 429) return { success: false, rateLimited: true, error: message };
    if (message?.toLowerCase().includes('already')) {
      return { success: false, alreadyEntered: true, error: message };
    }
    if (status === 400) return { success: false, ineligible: true, error: message };
    return { success: false, error: message };
  }
}

// Check if user has won any raffles
async function checkWins(apiKey) {
  try {
    const client = createClient(apiKey);
    const res = await client.get('/raffles', {
      params: { status: 'active', filter: 'winners', pageSize: 50 }
    });
    const raffles = res.data?.data?.raffles || [];
    return { success: true, wins: raffles };
  } catch (err) {
    return { success: false, wins: [] };
  }
}

module.exports = {
  validateApiKey,
  getOpenRaffles,
  getMyCommunityRaffles,
  enterRaffle,
  checkWins,
};
