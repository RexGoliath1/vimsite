/**
 * worker.js — Cloudflare Worker entry point for vimsite
 *
 * Routes:
 *   /api/tle/gnss  — server-side TLE proxy cache (fetches Celestrak once per 12h)
 *   /*             — static site assets (delegated to env.ASSETS)
 *
 * Caching strategy:
 *   - Cloudflare edge cache (caches.default): shared across all edge nodes,
 *     keyed on the incoming request URL, TTL = 12 hours via Cache-Control header.
 *   - Browser cache (gnss-hud.js Cache API): second layer, validates JSON before
 *     storing, TTL = 12 hours. Guards against any bad responses slipping through.
 *
 * On upstream failure: returns HTTP 502 with a JSON error body so gnss-hud.js
 * can surface the error in the propagation mode banner instead of showing a
 * cryptic network error.
 */

const CELESTRAK_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=gnss&FORMAT=json';
const TLE_CACHE_TTL_SECONDS = 12 * 60 * 60; // 12 hours

// Validate a GitHub PAT by checking read access to this repo.
// Returns true if the token is valid, false otherwise.
const GITHUB_VALIDATE_URL = 'https://api.github.com/repos/RexGoliath1/vimsite/git/ref/heads/main';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/tle/gnss') {
      return handleTleRequest(request, ctx);
    }

    if (url.pathname === '/api/gnss/live') {
      return handleGnssLive(request, env);
    }

    // All other requests: serve static site assets.
    // env.ASSETS is the static asset binding from wrangler.jsonc.
    return env.ASSETS.fetch(request);
  },
};

async function handleTleRequest(request, ctx) {
  // Use the incoming request URL as the cache key so all Cloudflare edge
  // nodes share a single cached entry (e.g. vimsite.sgoncia.workers.dev/api/tle/gnss).
  const cacheKey = new Request(request.url, { method: 'GET' });
  const cache = caches.default;

  // --- Edge cache hit ---
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  // --- Cache miss: fetch from Celestrak ---
  let body;
  try {
    const upstream = await fetch(CELESTRAK_URL);
    if (!upstream.ok) {
      return jsonError(502, `Celestrak returned HTTP ${upstream.status}`);
    }
    body = await upstream.text();
  } catch (err) {
    return jsonError(502, `Celestrak fetch failed: ${err.message}`);
  }

  // --- Validate: must be a non-empty JSON array ---
  try {
    const parsed = JSON.parse(body);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return jsonError(502, 'Celestrak response is not a non-empty JSON array');
    }
  } catch {
    return jsonError(502, 'Celestrak response is not valid JSON');
  }

  // --- Build response and store in edge cache ---
  const response = new Response(body, {
    headers: {
      'Content-Type': 'application/json',
      // Cache-Control tells Cloudflare's edge cache how long to keep this.
      'Cache-Control': `public, max-age=${TLE_CACHE_TTL_SECONDS}`,
    },
  });

  // waitUntil: cache.put runs after the response is sent — don't block the caller.
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function handleGnssLive(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return jsonError(403, 'Authentication required');
  }

  // Validate the GitHub PAT against the repo.
  const valid = await validateGitHubPat(authHeader);
  if (!valid) {
    return jsonError(403, 'Invalid or expired token');
  }

  // Local dev fallback — no R2 binding available in `wrangler dev` without
  // a real bucket. Serve a local fixture instead.
  if (!env.GNSS_DATA) {
    try {
      const res = await fetch('http://localhost:8765/constellation_fixture.json');
      if (!res.ok) {
        return jsonError(503, `Local fixture returned HTTP ${res.status}`);
      }
      const body = await res.text();
      return new Response(body, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      return jsonError(503, `Local fixture fetch failed: ${err.message}`);
    }
  }

  // Fetch live data from R2.
  const obj = await env.GNSS_DATA.get('constellation.json');
  if (!obj) {
    return jsonError(403, 'Data not available');
  }

  const body = await obj.text();
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

async function validateGitHubPat(authHeader) {
  try {
    const res = await fetch(GITHUB_VALIDATE_URL, {
      headers: {
        Authorization: authHeader,
        'User-Agent': 'vimsite-worker',
      },
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
