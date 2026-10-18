import { defineConfig } from "tsdown";

// ESM and CommonJS, each with its own declarations. @types/fhir stays a dependency the declarations
// import from (`fhir/r4.js`), never copied into them.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  platform: "node",
  target: "node22",
  dts: true,
  clean: true,
  sourcemap: false,
  deps: { neverBundle: [/^fhir\//] },
});
