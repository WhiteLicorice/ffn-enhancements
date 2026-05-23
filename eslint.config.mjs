import noUnsanitized from "eslint-plugin-no-unsanitized";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
    {
        ignores: [
            "node_modules/**",
            "dist/**",
            "dist-chrome/**",
            "dist-firefox/**",
            "scripts/**",
            "src/__tests__/**",
        ],
    },
    {
        files: ["src/**/*.ts"],
        linterOptions: {
            reportUnusedDisableDirectives: "off",
        },
        languageOptions: {
            parser: tsParser,
        },
        plugins: {
            "no-unsanitized": noUnsanitized,
            "@typescript-eslint": tsPlugin,
        },
        rules: {
            "no-unsanitized/property": "error",
            "no-unsanitized/method": "error",
        },
    },
];
