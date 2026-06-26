import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["agent/__tests__/**"],
  },
  {
    files: ["agent/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      "no-console": "error",
    },
  },
);
