// バンドラ設定: Firebase SDK をツリーシェイクして拡張機能内に同梱する（リモートホストコードを含めない）。
// 出力: dist/ （この dist フォルダを Chrome に読み込む）
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import replace from "@rollup/plugin-replace";
import terser from "@rollup/plugin-terser";
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";

const dev = !!process.env.DEV;

// .env ファイルから API キーを読み込む（ファイルがない場合は空文字）
function loadEnv() {
  try {
    // 1. ファイルを読み込み、BOMを除去し、改行コードをLF(\n)に統一する
    let text = readFileSync(".env", "utf-8");
    text = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

    const env = {};
    for (const line of text.split("\n")) {
      const trimmedLine = line.trim();

      // 空行やコメント行(#で始まる行)はスキップ
      if (!trimmedLine || trimmedLine.startsWith("#")) continue;

      // 2. 厳密な正規表現をやめ、最初の「=」でキーと値に分割する
      const match = trimmedLine.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim(); // キー側の余白や見えない文字を削除
        const value = match[2].replace(/^["'`]|["'`]$/g, "").trim(); // 値側の引用符や余白を削除
        env[key] = value;
      }
    }
    return env;
  } catch (e) {
    console.warn("[trip-assist] .env 読み込みエラー:", e.message);
    return {};
  }
}
const ENV = loadEnv();
const GEMINI_KEY = process.env.GEMINI_KEY || ENV.GEMINI_KEY || "";
const MAPS_KEY = process.env.MAPS_KEY || ENV.MAPS_KEY || "";
if (!GEMINI_KEY)
  console.warn(
    "[trip-assist] 警告: GEMINI_KEY が未設定です。.env ファイルを確認してください。",
  );

const plugins = () => [
  replace({
    preventAssignment: true,
    "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production"),
    __GEMINI_KEY__: JSON.stringify(GEMINI_KEY),
    __MAPS_KEY__: JSON.stringify(MAPS_KEY),
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
