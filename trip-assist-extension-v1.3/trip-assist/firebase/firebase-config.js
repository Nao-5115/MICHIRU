// =====================================================
// firebase-config.js — Firebase 接続設定
// =====================================================
// Firebase コンソール (https://console.firebase.google.com) で
// アプリを追加したときに表示された firebaseConfig を貼り付けてください。
// このファイルは .gitignore に追加し、公開リポジトリには含めないこと。
// =====================================================

const firebaseConfig = {
  apiKey: "AIzaSyAmDdh__tk-5OCx88KguX4ZJGWTTuAbGhI",
  authDomain: "sage-byte-510900-e0.firebaseapp.com",
  databaseURL: "https://sage-byte-510900-e0-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "sage-byte-510900-e0",
  storageBucket: "sage-byte-510900-e0.firebasestorage.app",
  messagingSenderId: "657617351264",
  appId: "1:657617351264:web:81e31423dd15807a100905"
};

// 他のスクリプトから参照できるようにグローバルに公開
window._firebaseConfig = firebaseConfig;
