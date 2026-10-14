// =====================================================
// firebase-init.js — Firebase & Firestore 初期化
// =====================================================
// firebase-config.js が先にロードされていること。
// manifest.json の content_scripts 順序:
//   firebase-app-compat.js → firebase-firestore-compat.js
//   → firebase-config.js → firebase-init.js → lib.js → panel.js
// =====================================================

(function () {
  'use strict';

  if (!window._firebaseConfig) {
    console.error('[TripAssist] firebase-config.js が読み込まれていません。');
    return;
  }

  // Firebase アプリの重複初期化を防ぐ
  if (!firebase.apps.length) {
    firebase.initializeApp(window._firebaseConfig);
  }

  // Firestore インスタンスをグローバルに公開（panel.js から使用）
  window._db = firebase.firestore();

  console.log('[TripAssist] Firebase 初期化完了');
})();
