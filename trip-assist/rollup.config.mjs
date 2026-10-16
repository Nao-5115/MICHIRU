// バンドラ設定: Firebase SDK をツリーシェイクして拡張機能内に同梱する（リモートホストコードを含めない）。
// 出力: dist/ （この dist フォルダを Chrome に読み込む）
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import replace from "@rollup/plugin-replace";
import terser from "@rollup/plugin-terser";
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const dev = !!process.env.DEV;

const plugins = () => [
  replace({
    preventAssignment: true,
    "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production"),
  }),
  nodeResolve({ browser: true }), // Firebase の browser 向けエントリを解決
  commonjs(),
  json(), // firebase-config.json を読み込む
  ...(dev ? [] : [terser()]),
];

const bundle = (input, file, extra = []) => ({
  input,
  output: { file: `dist/${file}`, format: "iife" },
  plugins: [...extra, ...plugins()],
});

// 最初のバンドル開始時に dist を作り直し、static/ の内容（manifest, CSS, HTML）をコピーする
const copyStatic = () => ({
  name: "copy-static",
  buildStart() {
    rmSync("dist", { recursive: true, force: true });
    mkdirSync("dist", { recursive: true });
    for (const name of readdirSync("static")) {
      copyFileSync(join("static", name), join("dist", name));
    }
  },
});

export default [
  bundle("src/background.js", "background.js", [copyStatic()]), // Service Worker
  bundle("src/offscreen.js", "offscreen.js"), // Firebase（offscreen ドキュメント）
  bundle("src/panel.js", "content.js"), // Google マップ上のサイドパネル
];
