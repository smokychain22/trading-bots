import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/", "coverage/", "node_modules/"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
  {
    files: ["public/assets/*.js"],
    languageOptions: {
      globals: Object.fromEntries(
        [
          "URL",
          "location",
          "document",
          "history",
          "navigator",
          "localStorage",
          "fetch",
          "AbortController",
          "AbortSignal",
          "FormData",
          "crypto",
          "setTimeout",
          "clearTimeout",
        ].map((name) => [name, "readonly"]),
      ),
    },
  },
);
