// 共有状態（S）と、スポット分類・色・アイコンなどの定数

export function installState(c) {

  const S = {
    tab: "trip",
    open: false,
    auth: { state: "unknown" },
    trips: [],
    trip: null,
    tripId: null,
    local: null,
    nav: null,
    spots: null,
    spotsError: "",
    events: null,
    dragId: null,
    pendingScroll: null,
    selDel: new Set(),
    delResults: null,
    regResults: null,
    regBusy: false,
    geo: null,
    ghost: true,
    aiSuggesting: false,
    aiResults: null,
    aiError: "",
    mailOnInvite: true,
  };
  const L = () => S.local;
  const SPOT_CATEGORIES = [
    "観光スポット",
    "飲食店",
    "穴場スポット",
    "カフェ",
    "ショッピング",
    "自然・景色",
    "その他",
  ];
  const SPOT_COLORS = {
    観光スポット: "#1a73e8",
    飲食店: "#e53935",
    穴場スポット: "#7b1fa2",
    カフェ: "#f57c00",
    ショッピング: "#0097a7",
    "自然・景色": "#388e3c",
    その他: "#616161",
  };
  const SPOT_ICONS = {
    "観光スポット": { label: "観光", svg: '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>' },
    "飲食店":     { label: "飲食",  svg: '<path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"/>' },
    "穴場スポット": { label: "穴場",  svg: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5.5-2.5l7.51-3.49 3.49-7.51-7.51 3.49-3.49 7.51zm5.5-6.6c.61 0 1.1.49 1.1 1.1s-.49 1.1-1.1 1.1-1.1-.49-1.1-1.1.49-1.1 1.1-1.1z"/>' },
    "カフェ":     { label: "カフェ", svg: '<path d="M20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.11 0 2-.89 2-2V5c0-1.11-.89-2-2-2zm0 5h-2V5h2v3zM4 19h16v2H4z"/>' },
    "ショッピング": { label: "ショッピング", svg: '<path d="M18 6h-2c0-2.21-1.79-4-4-4S8 3.79 8 6H6c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h12c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6-2c1.1 0 2 .9 2 2h-4c0-1.1.9-2 2-2zm0 10c-2.21 0-4-1.79-4-4h2c0 1.1.9 2 2 2s2-.9 2-2h2c0 2.21-1.79 4-4 4z"/>' },
    "自然・景色": { label: "自然",  svg: '<path d="M17 12h2L12 2 5.05 12H7l-3.9 6h8.45V22h1.1v-4H21L17 12zm-9.24 4l2.99-4.52.25-.38.25.38L14.24 16H7.76z"/>' },
    "その他":     { label: "その他", svg: '<path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>' },
  };

  Object.assign(c, { S, L, SPOT_CATEGORIES, SPOT_COLORS, SPOT_ICONS });
}
