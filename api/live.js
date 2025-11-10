import "dotenv/config";

let accessToken = process.env.ACCESS_TOKEN;
const clientId = process.env.CLIENT_ID;
const refreshToken = process.env.REFRESH_TOKEN;

// In-memory cache (works only per cold start)
const cache = new Map();
const CACHE_DURATION = 60 * 1000; // 1 minute

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

// Handler
export default async function handler(req, res) {
  const { user } = req.query;
  if (!user) return res.status(400).json({ error: "Missing ?user=<twitch_name>" });

  const cacheKey = user.toLowerCase();
  const now = Date.now();

  for (const [key, { timestamp }] of cache.entries()) {
    if (now - timestamp > CACHE_DURATION) cache.delete(key);
  }

  if (cache.has(cacheKey)) {
    const { data } = cache.get(cacheKey);
    const isLive = Array.isArray(data.data) && data.data.length > 0;
    return res.status(200).json({ cached: true, is_live: isLive, data });
  }

  async function fetchStreamData() {
    const response = await fetch(`https://api.twitch.tv/helix/streams?user_login=${user}`, {
      headers: {
        "Client-ID": clientId,
        "Authorization": `Bearer ${accessToken}`,
      },
    });

    if (response.status === 401) {
      await refreshAccessToken();
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
    const isLive = Array.isArray(data.data) && data.data.length > 0;
    cache.set(cacheKey, { data, timestamp: now });

    res.status(200).json({ cached: false, is_live: isLive, data });
  } catch (err) {
    console.error("Failed to fetch Twitch data:", err);

    if (cache.has(cacheKey)) {
      const { data } = cache.get(cacheKey);
      const isLive = Array.isArray(data.data) && data.data.length > 0;
      return res.status(200).json({ cached: true, is_live: isLive, data, warning: "Using cached data due to error" });
    }

    res.status(500).json({ is_live: false, error: "Failed to fetch Twitch data" });
  }
}
