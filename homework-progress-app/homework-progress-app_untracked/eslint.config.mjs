import next from "eslint-config-next";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  ...next,

  // TS/TSX にだけ TypeScript ESLint を有効化
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsparser,
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // 移行中：error だと止まるので warning
      "@typescript-eslint/no-explicit-any": "warn",

      // 移行中：warning
      "react-hooks/exhaustive-deps": "warn",

      // 本プロジェクトでは token 読み込み等で setState を effect 内で行う箇所が多いので停止
      "react-hooks/set-state-in-effect": "off",
    },
  },
];