import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "src/generated/", "node_modules/", "test-types/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The generator, the scripts and the tests read the spec, which is untyped JSON.
    files: ["scripts/**/*.ts", "test/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
