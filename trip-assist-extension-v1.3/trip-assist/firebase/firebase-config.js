// =====================================================
// firebase-config.js — Firebase 接続設定
// =====================================================
// Firebase コンソール (https://console.firebase.google.com) で
// アプリを追加したときに表示された firebaseConfig を貼り付けてください。
// このファイルは .gitignore に追加し、公開リポジトリには含めないこと。
// =====================================================

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// 他のスクリプトから参照できるようにグローバルに公開
window._firebaseConfig = firebaseConfig;
