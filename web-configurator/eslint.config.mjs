import js from "@eslint/js";
import {
  defineConfigWithVueTs,
  vueTsConfigs,
} from "@vue/eslint-config-typescript";
import prettierConfig from "@vue/eslint-config-prettier";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";

export default defineConfigWithVueTs(
  {
    name: "app/files-to-lint",
    files: ["**/*.{vue,js,jsx,cjs,mjs,ts,tsx,cts,mts}"],
  },
  {
    name: "app/files-to-ignore",
    ignores: [
      "public/**",
      "dist/**",
      "dist-ssr/**",
      "coverage/**",
      "_work/**",
      "tmp/**",
    ],
  },
  js.configs.recommended,
  pluginVue.configs["flat/recommended"],
  vueTsConfigs.recommendedTypeChecked,
  {
    // Plain JS files (config scripts, Node CLI tools) are not part of a TS project
    name: "app/disable-type-checked-for-js",
    files: ["**/*.{js,mjs,cjs}"],
    ...vueTsConfigs.disableTypeChecked[0],
  },
  {
    // Node.js CLI scripts (require, process)
    name: "app/node-tools",
    files: ["tools/**/*.{js,mjs}"],
    languageOptions: { globals: { ...globals.node } },
  },
  prettierConfig,
  {
    name: "app/rules",
    rules: {
      // Formatting is enforced, not advisory: a Prettier violation fails `lint:check`.
      // The tree was swept clean in the chore/prettier-format-sweep PR; `npm run format`
      // fixes any new drift. (SCSS/Markdown/JSON live outside ESLint — `format:check`
      // covers those.)
      "prettier/prettier": "error",
      quotes: [
        "error",
        "double",
        {
          avoidEscape: true,
          allowTemplateLiterals: true,
        },
      ],
      // Kept at "warn" (severity parity with the previous ESLint 8 setup, where these
      // reported as warnings or did not exist). To be ratcheted to "error" over time.
      "@typescript-eslint/no-explicit-any": "warn",
      // Intentionally-unused bindings are marked by a leading underscore, which is
      // what the ignore patterns below match.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-duplicate-enum-values": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-wrapper-object-types": "warn",
      // Type-aware rules with large existing-violation counts — "warn" until the
      // backlog is worked off; new code should not add any.
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-unsafe-enum-comparison": "warn",
      "@typescript-eslint/require-await": "warn",
      // New in ESLint 10's recommended config, with an existing-violation backlog —
      // kept at "warn" until worked off, same policy as the rules above. New code
      // should not add any.
      "no-useless-assignment": "warn",
      "preserve-caught-error": "warn",
      // Off: its autofix removes assertions that vue-tsc still requires
      // (ESLint's project service and vue-tsc disagree on these files),
      // breaking type-check. Cannot be "warn" — --fix would re-remove them.
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
);
