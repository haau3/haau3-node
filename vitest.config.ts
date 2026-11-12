import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // A shell's own HAAU3_ENVIRONMENT or HAAU3_BASE_URL would change which host every client in the
    // suite calls, so the suite starts with neither; a test that needs one sets it.
    env: { HAAU3_ENVIRONMENT: "", HAAU3_BASE_URL: "" },
  },
});
