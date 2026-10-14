// ビルド結果（dist/）にリモートホストコードの読み込み先が残っていないか検査する。
// Manifest V3 では拡張機能自身のファイル以外のコードを読み込めない（Chrome ウェブストア審査の対象）。
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
if (!existsSync(dist)) { console.error('dist/ がありません。先に npm run build を実行してください。'); process.exit(1); }

const forbidden = [
  [/apis\.google\.com\/js/, 'Google API ローダー (gapi)'],
  [/gstatic\.com\/firebasejs/, 'Firebase CDN'],
  [/www\.google\.com\/recaptcha/, 'reCAPTCHA'],
  [/recaptcha\/(api|enterprise)\.js/, 'reCAPTCHA スクリプト'],
  [/googletagmanager\.com/, 'Google Tag Manager']
];

let bad = 0;
for (const f of readdirSync(dist).filter((n) => n.endsWith('.js') || n.endsWith('.html'))) {
  const text = readFileSync(join(dist, f), 'utf8');
  for (const [re, label] of forbidden) {
    if (re.test(text)) { console.error(`NG: ${f} に ${label} への参照があります（${re}）`); bad++; }
  }
  if (/<script[^>]+src=["']https?:/i.test(text)) { console.error(`NG: ${f} が外部の script を読み込んでいます`); bad++; }
}

const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
if (String(manifest.oauth2?.client_id || '').includes('YOUR_CLIENT_ID')) console.warn('注意: static/manifest.json の oauth2.client_id が未設定です。');
const cfg = JSON.parse(readFileSync('firebase-config.json', 'utf8'));
if (Object.values(cfg).some((v) => String(v).includes('YOUR_'))) console.warn('注意: firebase-config.json に未設定の項目があります。');

if (bad) { console.error(`\n検査に失敗しました（${bad} 件）。README の「リモートコードが検出された場合」を参照してください。`); process.exit(1); }
console.log('OK: dist/ にリモートホストコードへの参照は見つかりませんでした。');
