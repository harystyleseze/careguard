import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='localStorage'][callee.property.name='setItem']",
          message:
            "Do not persist dashboard data to localStorage. See docs/SECURITY.md for the approved exception process.",
        },
        {
          selector:
            "CallExpression[callee.object.object.name='window'][callee.object.property.name='localStorage'][callee.property.name='setItem']",
          message:
            "Do not persist dashboard data to localStorage. See docs/SECURITY.md for the approved exception process.",
        },
        {
          selector:
            "CallExpression[callee.object.name='sessionStorage'][callee.property.name='setItem']",
          message:
            "Do not persist dashboard data to sessionStorage. See docs/SECURITY.md for the approved exception process.",
        },
        {
          selector:
            "CallExpression[callee.object.object.name='window'][callee.object.property.name='sessionStorage'][callee.property.name='setItem']",
          message:
            "Do not persist dashboard data to sessionStorage. See docs/SECURITY.md for the approved exception process.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // #96: the dashboard never persists anything to localStorage/sessionStorage
  // — both can leak PII/PHI or auth tokens across reloads on a shared device.
  // Genuine exceptions need a code-owner-reviewed `eslint-disable` comment
  // and a documented entry under docs/SECURITY.md.
  {
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    rules: {
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
