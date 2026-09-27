import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "node_modules/**", "drizzle/**", "public/**"],
  },
  {
    rules: {
      // Server actions intentionally accept `unknown` and validate with Zod.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // The App Router has no pages/_document; a stylesheet link in the root
      // layout applies to every route, so this rule does not apply here.
      "@next/next/no-page-custom-font": "off",
    },
  },
];
