import { videosGenerate } from "@/lib/providers/xai/videos.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/**
 * POST /v1/videos/generations
 *
 * xAI-only endpoint. Caller must provide an xAI account (OAuth or API key).
 * Connection lookup is delegated to the existing provider auth resolver via
 * a stub for now — wired in by the chat handler refactor (Phase 9).
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Resolve account from request (apikey or oauth) — minimal inline resolver.
  // The chat handler does the heavy lifting; here we accept Authorization Bearer.
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) {
    return Response.json({ error: "Missing Bearer token" }, { status: 401 });
  }
  const account = { authType: "apikey", apiKey: m[1] };

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
