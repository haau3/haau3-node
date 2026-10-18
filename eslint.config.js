import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "src/generated/", "node_modules/", "test-types/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The generator and the spec are untyped JSON by nature.
      "@typescript-eslint/no-explicit-any": ["error", { ignoreRestArgs: true }],
    },
  },
  {
    files: ["scripts/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
