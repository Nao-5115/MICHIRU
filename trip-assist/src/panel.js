// Google マップ上に重ねて表示するサイドパネル（Shadow DOM で独立。マップの DOM には依存しない）
//
// データの置き場所:
//  ・Firebase（リアルタイム共有）: メンバー・候補日・出欠・候補地点・投票・採用した地点  → offscreen.js が接続し、chrome.storage.local の fb:* に中継
//  ・chrome.storage.local（幹事のローカルのみ）: 訪問地点・しおり設定・区間ごとの移動手段・確定日程・登録済みカレンダー予定 → local:<旅行ID>
import { main } from "./panel/index.js";

main();
