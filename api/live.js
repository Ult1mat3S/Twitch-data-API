import "dotenv/config";

let accessToken = process.env.ACCESS_TOKEN;
const clientId = process.env.CLIENT_ID;
const refreshToken = process.env.REFRESH_TOKEN;

const cache = new Map();
const CACHE_DURATION = 60 * 1000; // 1 minute

// Refresh Twitch token using TwitchTokenGenerator
async function refreshAccessToken() {
  console.log("Refreshing Twitch token...");
  const url = `https://twitchtokengenerator.com/api/refresh/${refreshToken}`;
  const res = await fetch(url);
  const data = await res.json();

  if (!data || !data.token) {
    console.error("Failed to refresh token:", data);
    throw new Error("Token refresh failed");
  }

  accessToken = data.token;
  console.log("Token refreshed successfully");
  return accessToken;
}

export default async function handler(req, res) {
  const { user } = req.query;
  if (!user) return res.status(400).json({ error: "Missing ?user=<twitch_name>" });

  const cacheKey = user.toLowerCase();
  const now = Date.now();

  // Serve cached data if valid
  if (cache.has(cacheKey)) {
    const { data, timestamp } = cache.get(cacheKey);
    if (now - timestamp < CACHE_DURATION) {
      return res.status(200).json({ cached: true, data });
    }
  }

  async function fetchStreamData() {
    const response = await fetch(`https://api.twitch.tv/helix/streams?user_login=${user}`, {
      headers: {
        "Client-ID": clientId,
        "Authorization": `Bearer ${accessToken}`,
      },
    });

    // If token is invalid or expired, refresh it
    if (response.status === 401) {
      await refreshAccessToken();
      // Retry once after refresh
      return fetchStreamData();
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error);
    }

    return response.json();
  }

  try {
    const data = await fetchStreamData();
    cache.set(cacheKey, { data, timestamp: now });
    res.status(200).json({ cached: false, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch Twitch data" });
  }
}
