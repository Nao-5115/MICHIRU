// パネルの組み立て: 機能モジュールを元の panel.js と同じ順に読み込み、共有オブジェクト c に登録していく
import { installState } from "./core/state.js";
import { installDom } from "./core/dom.js";
import { installShell } from "./core/shell.js";
import { installGeometry } from "./core/geometry.js";
import { installMessaging } from "./core/messaging.js";
import { installStorage } from "./core/storage.js";
import { installCommon } from "./core/common.js";
import { installTripTab } from "./tabs/trip.js";
import { installScheduleTab } from "./tabs/schedule.js";
import { installPrefsFloat } from "./map/prefs-float.js";
import { installVoteTab } from "./tabs/vote.js";
import { installSpotsTab } from "./tabs/spots.js";
import { installOverlay } from "./map/overlay.js";
import { installRouteTab } from "./tabs/route.js";
import { installRegisterTab } from "./tabs/register.js";
import { installMyEvents } from "./tabs/my-events.js";
import { installRender } from "./core/render.js";
import { installBoot } from "./core/boot.js";

export function main() {
  if (document.getElementById("tripassist-host")) return;
  const ctx = {};
  installState(ctx);
  installDom(ctx);
  installShell(ctx);
  installGeometry(ctx);
  installMessaging(ctx);
  installStorage(ctx);
  installCommon(ctx);
  installTripTab(ctx);
  installScheduleTab(ctx);
  installPrefsFloat(ctx);
  installVoteTab(ctx);
  installSpotsTab(ctx);
  installOverlay(ctx);
  installRouteTab(ctx);
  installRegisterTab(ctx);
  installMyEvents(ctx);
  installRender(ctx);
  installBoot(ctx);
}
