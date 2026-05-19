import { describe, it, expect } from "vitest";

// We can't easily import the open-sse switch logic without real PROVIDERS config,
// so verify the wrapper function shape directly via dynamic import.

describe("xai/token-refresh wrapper", () => {
  it("refreshXaiToken module loads without throwing", async () => {
    // Just verify the file imports cleanly. The actual wrapper is internal.
    const mod = await import("../../open-sse/services/tokenRefresh.js");
    expect(typeof mod.refreshTokenByProvider).toBe("function");
    expect(typeof mod.formatProviderCredentials).toBe("function");
  });

  it("formatProviderCredentials returns Bearer-shape for xai", async () => {
    const mod = await import("../../open-sse/services/tokenRefresh.js");
    const out = mod.formatProviderCredentials(
      "xai",
      { apiKey: "k", accessToken: "t", refreshToken: "r" },
      null
    );
    expect(out).toEqual({ apiKey: "k", accessToken: "t" });
  });

  it("refreshTokenByProvider returns null when refreshToken missing", async () => {
    const mod = await import("../../open-sse/services/tokenRefresh.js");
    const out = await mod.refreshTokenByProvider("xai", { refreshToken: "" }, null);
    expect(out).toBeNull();
  });
});
