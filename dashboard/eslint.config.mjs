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
]);

export default eslintConfig;
