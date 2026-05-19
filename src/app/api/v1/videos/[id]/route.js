import { videosGet } from "@/lib/providers/xai/videos.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** GET /v1/videos/{id} — poll status of an async video job (xAI) */
export async function GET(request, { params }) {
  const { id } = await params;
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return Response.json({ error: "Missing Bearer token" }, { status: 401 });
  const account = { authType: "apikey", apiKey: m[1] };

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
