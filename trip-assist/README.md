# 旅行の日程調整・ルート決定アシスト

Google マップ上のサイドパネルで、旅行の日程調整、訪問候補の投票、ルート作成を行う Chrome 拡張機能です。旅行の共有には Firebase Realtime Database、Google カレンダーの読み書きには Google OAuth を使います。

## まず使う（既存プロジェクトを利用）

このリポジトリには、利用中の Firebase と Google OAuth の設定が入っています。通常の利用者は設定ファイルを編集する必要はありません。

### 必要なもの

- Chrome 116 以降
- Node.js 18 以降（20 LTS 推奨）
- Google アカウント
- OAuth のテストユーザーに登録されたアカウント

### クローンして Chrome に読み込む

リポジトリをクローンし、PowerShell などで `trip-assist` フォルダに移動して実行します。

```powershell
npm ci
npm run build
npm run verify
```

ビルドが終わったら、Chrome で `chrome://extensions` を開きます。

1. 「デベロッパーモード」をオンにする
2. 「パッケージ化されていない拡張機能を読み込む」を押す
3. リポジトリ内の **`trip-assist/dist`** フォルダを選ぶ

`trip-assist` のルートや `src`、`static` ではなく、ビルド後の `dist` を選んでください。ソースを更新したときは `npm run build` を実行し、拡張機能管理画面で再読み込みします。

### 編集しなくてよいファイル

既存の共有プロジェクトを使う場合、次のファイルはそのまま使います。

- `firebase-config.json` — 接続先 Firebase プロジェクトの設定
- `static/manifest.json` — 拡張機能の権限、固定 ID、Google OAuth クライアント ID
- `database.rules.json` — Firebase Realtime Database のアクセス制御ルール
- `dist/` — ビルドで生成される Chrome 読み込み用ファイル。直接編集せず、`npm run build` で作り直します

`database.rules.json` はルールの原本です。クローンやビルドをしても Firebase Console 上のルールは自動で変更されません。既存の共有プロジェクトでは管理者が設定済みのルールを使います。

Google OAuth が「テスト」状態の場合、利用する Google アカウントは管理者が OAuth のテストユーザーに追加しておく必要があります。追加されていないアカウントはログインできません。

## 使い方

1. Google マップを開き、右上の「旅」ボタンからパネルを開きます。
2. 「旅行」タブで Google にサインインします。
3. 旅行を新規作成するか、幹事から招待された旅行を選びます。作成者が幹事になります。
4. 幹事が候補日を追加し、メンバーが出欠を入力します。回答は共有され、幹事が日程を確定します。
5. Google マップ上の場所を候補に追加し、メンバーが投票します。幹事は採用した場所を訪問地点に取り込めます。
6. 「スポット」タブでは、カテゴリ・評価・レビュー付きのおすすめスポットを全利用者向けに登録できます。最新100件が一覧・地図上のマーカーに表示され、近くのレビューも探せます。
7. 幹事は訪問順、車・電車、出発時刻、滞在時間を設定してしおりを作ります。
8. 確定した日程を幹事の Google カレンダーに登録できます。登録時にメンバーへ招待メールを送信できます。

## 役割

| 操作 | 幹事 | メンバー |
| --- | --- | --- |
| 旅行の作成 | 可能 | 可能（作成者が幹事） |
| メンバーの招待・解除、旅行の削除 | 可能 | 不可 |
| 候補日の追加・削除、日程の確定 | 可能 | 不可 |
| 自分の出欠の入力 | 可能 | 可能 |
| 候補地点の追加・投票 | 可能 | 可能 |
| 候補地点の削除 | 全件 | 自分が追加した地点 |
| 候補地点の採用 | 可能 | 不可 |
| 訪問地点・しおりの編集、カレンダー登録 | 可能 | 不可 |
| 全体共有スポットの閲覧・登録 | 可能 | 可能 |
| 全体共有スポットの削除 | 自分の登録分 | 自分の登録分 |

## データの保存と共有

- 旅行、メンバー、候補日、出欠、候補地点、投票、候補地点の採用状態は Firebase で共有します。
- おすすめスポット一覧も同じ Realtime Database で全利用者に共有されます。ログイン済みの利用者は閲覧・登録ができ、削除できるのは自分が登録したスポットだけです。
- 訪問地点リスト、しおり、区間ごとの移動手段、確定日程、拡張機能から登録したカレンダー予定の記録は、幹事の Chrome 内に保存します。他の PC には自動で引き継がれません。
- カレンダー予定そのものは Google カレンダーに保存されます。旅行を削除しても、登録済み予定は自動削除されません。
- v1.2 以前のローカルデータは v2.0 に自動移行されません。

## 設定を変更する管理者向け

この節は、別の Firebase / Google Cloud プロジェクトに切り替える場合だけ必要です。通常のクローン利用では設定を変更しません。

1. Firebase Authentication で Google ログインを有効にします。
2. Realtime Database を作成し、`database.rules.json` の内容を Firebase Console のルールに反映します。スポットカタログを使うには、`spots` のルールと `registeredAt` のインデックスも含めて公開してください。
3. Firebase の Web アプリ設定で `firebase-config.json` を更新します。
4. Firebase と同じ Google Cloud プロジェクトで Google Calendar API を有効にします。
5. OAuth 同意画面を設定し、`openid`、`userinfo.email`、`userinfo.profile`、`calendar.events` のスコープを用意します。
6. Chrome 拡張機能用 OAuth クライアントを設定し、`static/manifest.json` の `oauth2.client_id` を更新します。OAuth クライアントには拡張機能 ID **`kdhojbgokcianbdogkbnmamllolhaohm`** を登録します。
7. OAuth がテスト状態なら、利用者の Google アカウントをテストユーザーに追加します。
8. `npm run build` を実行し、Chrome で `dist` を再読み込みします。

拡張機能 ID を固定している `static/manifest.json` の `key` は変更しないでください。変更すると拡張機能 ID が変わり、OAuth クライアントの登録と一致しなくなります。`dist/manifest.json` を直接直しても、次のビルドで上書きされます。

旧版が Firestore に保存していたスポットデータがある場合、この版の Realtime Database には自動移行されません。必要なデータは別途移行してください。

Firebase の Web 設定値や OAuth クライアント ID は接続先を示す値です。Firebase のデータ保護は `database.rules.json` に対応する Console 上のルールと認証で行います。秘密鍵やサービスアカウントの JSON はリポジトリに追加しないでください。

## フォルダ構成

```text
trip-assist/
├─ src/
│  ├─ background.js   # OAuth、Google Calendar API、offscreen の管理
│  ├─ offscreen.js    # Firebase Authentication / Realtime Database 接続
│  ├─ lib.js          # 日付、出欠集計、距離、しおり等の共通ロジック
│  └─ panel.js        # Google マップ上のサイドパネル
├─ static/
│  ├─ manifest.json   # Chrome 拡張機能の設定
│  ├─ offscreen.html  # Firebase 接続用ドキュメント
│  └─ panel.css       # サイドパネルのスタイル
├─ scripts/
│  └─ verify-no-remote-code.mjs
├─ test/              # 自動テスト
├─ testing/           # テスト用補助コード
├─ firebase-config.json
├─ database.rules.json
├─ package.json
├─ package-lock.json
├─ rollup.config.mjs
└─ dist/              # ビルド出力。Chrome にはこのフォルダを読み込む
```

## トラブルシューティング

- **拡張機能を読み込めない / manifest が見つからない**: `dist` を選んでいるか確認し、必要なら `npm run build` を実行します。
- **`npm ci` やビルドで止まる**: `trip-assist` フォルダ内でコマンドを実行しているか確認します。
- **Google ログインで 403 / access_denied**: ログインに使ったアカウントが、現在の OAuth プロジェクトのテストユーザーに追加されているか確認します。OAuth クライアント ID が `static/manifest.json` の設定と一致することも確認します。
- **Firebase に接続できない**: `firebase-config.json` の接続先、Authentication の Google プロバイダー、Realtime Database の Console 上のルールを確認します。
- **カレンダーを読めない / 登録できない**: Google Calendar API が有効か、Google アカウントで必要な権限を許可したか確認します。
- **ソースの変更が Chrome に反映されない**: `npm run build` の後、`chrome://extensions` で拡張機能を再読み込みし、Google マップのタブも再読み込みします。

## 開発用コマンド

```powershell
npm ci
npm run build
npm run verify
npm test
```

`npm run verify` は `dist/` に外部ホストから JavaScript を読み込む参照がないことを確認します。
