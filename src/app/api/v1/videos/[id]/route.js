import { videosGet } from "@/lib/providers/xai/videos.js";
import { getProviderCredentials } from "@/sse/services/auth.js";
import { checkAndRefreshToken } from "@/sse/services/tokenRefresh.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

async function resolveXaiAccount(request) {
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return { authType: "apikey", apiKey: m[1] };
  const preferred = request.headers.get("x-connection-id") || null;
  const conn = await getProviderCredentials("xai", null, null, { preferredConnectionId: preferred });
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

/** GET /v1/videos/{id} — poll status of an async video job (xAI) */
export async function GET(request, { params }) {
  const { id } = await params;
  const account = await resolveXaiAccount(request);
  if (!account) return Response.json({ error: "No xAI connection" }, { status: 401 });

  try {
    const json = await videosGet({ id, account });
    return Response.json(json);
  } catch (err) {
    return Response.json(
      { error: err?.message || String(err) },
      { status: err?.status || 500 }
    );
  }
}
