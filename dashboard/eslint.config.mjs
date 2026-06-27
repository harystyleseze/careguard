import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".tsbuild/**",
  ]),
  // #96: the dashboard never persists anything to localStorage/sessionStorage
  // — both can leak PII/PHI or auth tokens across reloads on a shared device.
  // Genuine exceptions need a code-owner-reviewed `eslint-disable` comment
  // and a documented entry under docs/SECURITY.md.
  {
    files: ["src/**/*.{js,jsx,ts,tsx}", "tests/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/incompatible-library": "off",
      "react-hooks/immutability": "off",
      "prefer-const": "warn",
      "no-restricted-properties": [
        "error",
        {
          object: "localStorage",
          property: "setItem",
          message:
            "Do not persist data to localStorage — see docs/SECURITY.md (localStorage policy) for the exception process.",
        },
        {
          object: "sessionStorage",
          property: "setItem",
          message:
            "Do not persist data to sessionStorage — see docs/SECURITY.md (localStorage policy) for the exception process.",
        },
      ],
    },
  },
]);

export default eslintConfig;
