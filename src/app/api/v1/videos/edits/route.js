import { videosEdit } from "@/lib/providers/xai/videos.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/videos/edits — multipart upload, xAI only */
export async function POST(request) {
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return Response.json({ error: "Missing Bearer token" }, { status: 401 });
  const account = { authType: "apikey", apiKey: m[1] };

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid multipart body" }, { status: 400 });
  }

  try {
    const idem = request.headers.get("Idempotency-Key") || undefined;
    const json = await videosEdit({ formData, account, idempotencyKey: idem });
    return Response.json(json);
  } catch (err) {
    return Response.json(
      { error: err?.message || String(err) },
      { status: err?.status || 500 }
    );
  }
}
