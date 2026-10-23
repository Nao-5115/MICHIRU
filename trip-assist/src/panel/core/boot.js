// 起動処理（保存済み状態の復元・offscreen の起動）

export function installBoot(ctx) {
  const { boot, flash } = ctx;
  boot().catch((error) => flash("起動に失敗しました: " + error.message, "err"));

  Object.assign(ctx, {  });
}
