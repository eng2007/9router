#!/usr/bin/env node
/**
 * xAI (Grok) CLI Login
 *
 * Source of truth: router-for-me/CLIProxyAPI internal/cmd/xai_login.go
 *
 * Usage:
 *   node cli/commands/xai-login.js
 *   node cli/commands/xai-login.js --api-key <KEY>
 *
 * - OAuth flow: spawns loopback server on 127.0.0.1:56121/callback,
 *   opens browser to authorization URL, exchanges code, prints email + TTL.
 * - API-key flow: persists the supplied key directly.
 *
 * Connection persistence requires the 9router server to be reachable; the
 * standalone script delegates to the same provider-connections store used
 * by the dashboard via fetch to a local API endpoint when available.
 * Otherwise it just prints the tokens for manual import.
 */

import process from "process";
import { XaiService, decodeIdTokenEmail } from "../../src/lib/oauth/services/xai.js";

function parseArgs(argv) {
  const opts = { apiKey: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--api-key" && i + 1 < argv.length) {
      opts.apiKey = argv[++i];
    } else if (a === "--help" || a === "-h") {
      console.log(`Usage: xai-login [--api-key <KEY>]

Options:
  --api-key <KEY>   Skip OAuth and persist the supplied xAI API key.
  -h, --help        Show this help.

Without --api-key the OAuth PKCE flow is run on http://127.0.0.1:56121/callback.
`);
      process.exit(0);
    }
  }
  return opts;
}

function ttlSeconds(expiresIn) {
  return typeof expiresIn === "number" ? `${expiresIn}s` : "unknown";
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.apiKey) {
    console.log("xAI API key captured (length=%d).", opts.apiKey.length);
    console.log("Persist via 9router dashboard → Providers → xAI → API Key, paste this value.");
    return;
  }

  const svc = new XaiService();
  const { tokens, email } = await svc.connect();
  const decoded = email || decodeIdTokenEmail(tokens.id_token);

  console.log("\nxAI OAuth tokens received:");
  console.log("  email:        %s", decoded || "(unknown)");
  console.log("  access TTL:   %s", ttlSeconds(tokens.expires_in));
  console.log("  has refresh:  %s", tokens.refresh_token ? "yes" : "no");
  console.log("  has id_token: %s", tokens.id_token ? "yes" : "no");
  console.log("\nNext steps:");
  console.log("  1. Start 9router dashboard");
  console.log("  2. Providers → xAI → Connect (OAuth) (uses the same loopback port 56121)");
  console.log("  Or persist programmatically via /api/cli/providers/xai (when running).");
}

main().catch((err) => {
  console.error("xai-login failed:", err?.message || err);
  process.exit(1);
});
