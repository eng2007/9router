import { videosGenerate } from "@/lib/providers/xai/videos.js";
import { getProviderCredentials } from "@/sse/services/auth.js";
import { checkAndRefreshToken } from "@/sse/services/tokenRefresh.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

async function resolveXaiAccount(request) {
  // 1) Bearer header → API key fast path
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return { authType: "apikey", apiKey: m[1] };

  // 2) DB-backed connection
  const preferred = request.headers.get("x-connection-id") || null;
  const conn = await getProviderCredentials("xai", null, null, {
    preferredConnectionId: preferred,
  });
  if (!conn) return null;
  await checkAndRefreshToken(conn).catch(() => {});
  return {
    authType: conn.authType || "oauth",
    apiKey: conn.apiKey,
    accessToken: conn.accessToken,
    refreshToken: conn.refreshToken,
    expiresAt: conn.expiresAt,
  };
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const account = await resolveXaiAccount(request);
  if (!account) return Response.json({ error: "No xAI connection" }, { status: 401 });

  try {
    const idem = request.headers.get("Idempotency-Key") || undefined;
    const json = await videosGenerate({ request: body, account, idempotencyKey: idem });
    return Response.json(json);
  } catch (err) {
    return Response.json(
      { error: err?.message || String(err) },
      { status: err?.status || 500 }
    );
  }
}
