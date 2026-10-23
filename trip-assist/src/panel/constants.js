// パネル全体で使う定数（ローカル保存キー・既定値など）

export const K = {
  cur: "app:currentTripId",
  nav: "app:nav",
  auth: "fb:auth",
  trips: "fb:trips",
  trip: "fb:trip",
  spots: "fb:spots",
};

export const lk = (id) => "local:" + id;

export const rid = () => Math.random().toString(36).slice(2, 10);

export const DEF_LOCAL = () => ({
  places: [],
  legModes: {},
  confirmedId: null,
  events: [],
  settings: {
    speedCar: 40,
    speedTrain: 35,
    detourCar: 1.3,
    detourTrain: 1.3,
    startTime: "09:00",
    defaultStay: 60,
    stays: {},
    wholeMode: "car",
    invite: true,
    timed: false,
  },
});
