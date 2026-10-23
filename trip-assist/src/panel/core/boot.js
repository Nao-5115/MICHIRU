// 起動処理（保存済み状態の復元・offscreen の起動）

export function installBoot(c) {
  const { boot, flash } = c;
  boot().catch((e) => flash("起動に失敗しました: " + e.message, "err"));

  Object.assign(c, {  });
}
