import "dotenv/config";
import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

let accessToken = process.env.ACCESS_TOKEN;
const clientId = process.env.CLIENT_ID;
const refreshToken = process.env.REFRESH_TOKEN;

const cache = new Map();
const CACHE_DURATION = 60 * 1000; // 1 minute

async function refreshAccessToken() {
  console.log("Refreshing Twitch token...");
  const url = `https://twitchtokengenerator.com/api/refresh/${refreshToken}`;

  const res = await fetch(url);
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    console.error("Refresh endpoint did not return valid JSON:", text);
    throw new Error("Token refresh failed (invalid JSON)");
  }

  console.log("🔍 Refresh response:", data);

  // TwitchTokenGenerator sometimes sends "token" or "access_token"
  const newToken = data.token || data.access_token;
  if (!newToken) {
    console.error("No token found in refresh response:", data);
    throw new Error("Token refresh failed (no token)");
  }

  accessToken = newToken;

  if (data.refresh) {
    console.log("Updating refresh token...");
    process.env.REFRESH_TOKEN = data.refresh;
  }

  console.log("Token refreshed successfully");
  return accessToken;
}

async function getStreamData(user) {
  const response = await fetch(`https://api.twitch.tv/helix/streams?user_login=${user}`, {
    headers: {
      "Client-ID": clientId,
      "Authorization": `Bearer ${accessToken}`,
    },
  });

  if (response.status === 401) {
    console.log("Token expired, refreshing...");
    await refreshAccessToken();
    return getStreamData(user); // retry once
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return response.json();
}

app.get("/api/stream", async (req, res) => {
  const { user } = req.query;
  if (!user) return res.status(400).json({ error: "Missing ?user=<twitch_name>" });

  const cacheKey = user.toLowerCase();
  const now = Date.now();

  for (const [key, { timestamp }] of cache.entries()) {
    if (now - timestamp > CACHE_DURATION) cache.delete(key);
  }

  try {
    const data = await getStreamData(user);

    const isLive = Array.isArray(data.data) && data.data.length > 0;

    cache.set(cacheKey, { data, timestamp: now });

    res.json({ cached: false, is_live: isLive, data });
  } catch (err) {
    console.error("Error fetching Twitch data:", err);

    if (cache.has(cacheKey)) {
      const { data } = cache.get(cacheKey);
      const isLive = Array.isArray(data.data) && data.data.length > 0;
      return res.json({ cached: true, is_live: isLive, data, warning: "Using cached data due to error" });
    }

    res.status(500).json({ is_live: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
