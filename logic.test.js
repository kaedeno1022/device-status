// logic.js の判定・整形が、境界値と異常な入力でも仕様どおりの結果を返すことを確かめる
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  levelLatency, levelDownlink, levelBattery,
  escapeHtml, fmtBytes, fmtDuration, fmtTime, fmtMs,
  connTypeLabel, effectiveTypeLabel, batteryTimeText,
  latencyEventFor, connChanges, latencyStats, niceMax, median, axisMax,
  fmtMbps, levelSpeed, summarizeSpeed, createRecorder,
  computeTiming, timingRows, ipRows,
} from "./logic.js";

// ---------- 判定 ----------
test("応答時間は 100ms 未満で良好、300ms 未満で注意、それ以上は不良", () => {
  assert.equal(levelLatency(0), "good");
  assert.equal(levelLatency(99), "good");
  assert.equal(levelLatency(100), "warn");
  assert.equal(levelLatency(299), "warn");
  assert.equal(levelLatency(300), "bad");
});

test("応答時間が計測できなければ判定なし", () => {
  assert.equal(levelLatency(null), "na");
  assert.equal(levelLatency(undefined), "na");
});

test("下り帯域は 5Mbps 以上で良好、1.5Mbps 以上で注意、それ未満は不良", () => {
  assert.equal(levelDownlink(10), "good");
  assert.equal(levelDownlink(5), "good");
  assert.equal(levelDownlink(4.9), "warn");
  assert.equal(levelDownlink(1.5), "warn");
  assert.equal(levelDownlink(1.49), "bad");
  assert.equal(levelDownlink(0), "bad");
  assert.equal(levelDownlink(null), "na");
});

test("バッテリーは充電中なら残量にかかわらず良好", () => {
  assert.equal(levelBattery({ charging: true, level: 0.02 }), "good");
});

test("バッテリーは放電中なら 20% 超で良好、10% 超で注意、それ以下は不良", () => {
  assert.equal(levelBattery({ charging: false, level: 0.21 }), "good");
  assert.equal(levelBattery({ charging: false, level: 0.2 }), "warn");
  assert.equal(levelBattery({ charging: false, level: 0.11 }), "warn");
  assert.equal(levelBattery({ charging: false, level: 0.1 }), "bad");
  assert.equal(levelBattery({ charging: false, level: 0 }), "bad");
});

test("バッテリー情報がなければ判定なし", () => {
  assert.equal(levelBattery(null), "na");
});

test("放電中で残量が取れない場合は不良として扱う", () => {
  assert.equal(levelBattery({ charging: false }), "bad");
});

// ---------- 整形 ----------
test("HTML に使われる文字をエスケープする", () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert('1')">`),
    "&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;");
  assert.equal(escapeHtml("A&B"), "A&amp;B");
});

test("文字列以外を渡してもエスケープが落ちない", () => {
  assert.equal(escapeHtml(123), "123");
  assert.equal(escapeHtml(null), "null");
});

test("バイト数は単位を繰り上げ、100以上と B は小数を出さない", () => {
  assert.equal(fmtBytes(0), "0 B");
  assert.equal(fmtBytes(1023), "1023 B");
  assert.equal(fmtBytes(1024), "1.0 KB");
  assert.equal(fmtBytes(1536), "1.5 KB");
  assert.equal(fmtBytes(1024 * 150), "150 KB");
  assert.equal(fmtBytes(1024 ** 4), "1.0 TB");
  assert.equal(fmtBytes(1024 ** 5), "1024 TB"); // TB より上の単位は使わない
  assert.equal(fmtBytes(null), null);
});

test("残り時間は60秒未満をまとめ、分から時間へ繰り上げる", () => {
  assert.equal(fmtDuration(0), "1分未満");
  assert.equal(fmtDuration(59), "1分未満");
  assert.equal(fmtDuration(60), "1分");
  assert.equal(fmtDuration(90), "2分"); // 四捨五入
  assert.equal(fmtDuration(3599), "1時間0分"); // 「1時間60分」にしない
  assert.equal(fmtDuration(3600), "1時間0分");
  assert.equal(fmtDuration(7260), "2時間1分");
});

test("残り時間が不明なら null", () => {
  assert.equal(fmtDuration(null), null);
  assert.equal(fmtDuration(Infinity), null); // 放電時間が未算出のときの値
  assert.equal(fmtDuration(NaN), null);
});

test("時刻は2桁ゼロ埋めで表示する", () => {
  assert.equal(fmtTime(new Date(2026, 8, 19, 9, 5, 3)), "09:05:03");
  assert.equal(fmtTime(new Date(2026, 8, 19, 0, 0, 0)), "00:00:00");
  assert.equal(fmtTime(new Date(2026, 8, 19, 23, 59, 59)), "23:59:59");
});

test("ミリ秒は整数に丸める", () => {
  assert.equal(fmtMs(12.4), "12 ms");
  assert.equal(fmtMs(12.5), "13 ms");
});

test("回線種別と回線品質は日本語表記に置き換える", () => {
  assert.equal(connTypeLabel({ type: "wifi" }), "Wi-Fi");
  assert.equal(effectiveTypeLabel({ effectiveType: "4g" }), "4G相当以上");
});

test("未知の回線種別・回線品質はそのまま表示する", () => {
  assert.equal(connTypeLabel({ type: "satellite" }), "satellite");
  assert.equal(effectiveTypeLabel({ effectiveType: "5g" }), "5g");
});

test("Network Information API 非対応なら回線の表記は取得不可", () => {
  assert.equal(connTypeLabel(null), null);
  assert.equal(connTypeLabel({}), null);
  assert.equal(effectiveTypeLabel(null), null);
  assert.equal(effectiveTypeLabel({}), null);
});

test("バッテリーの残り時間は充電中と放電中で文言を変える", () => {
  assert.equal(batteryTimeText({ charging: true, chargingTime: 0 }), "満充電");
  assert.equal(batteryTimeText({ charging: true, chargingTime: 1800 }), "満充電まで 30分");
  assert.equal(batteryTimeText({ charging: true, chargingTime: Infinity }), "充電中（時間不明）");
  assert.equal(batteryTimeText({ charging: false, dischargingTime: 7200 }), "あと 2時間0分");
  assert.equal(batteryTimeText({ charging: false, dischargingTime: Infinity }), "計算中");
  assert.equal(batteryTimeText(null), null);
});

// ---------- 接続イベント ----------
test("計測に失敗した時だけ失敗を記録し、連続した失敗は記録しない", () => {
  assert.deepEqual(latencyEventFor("good", null),
    { level: "bad", tag: "失敗", message: "応答時間の計測に失敗した（タイムアウトまたは通信エラー）" });
  assert.equal(latencyEventFor("na", null), null);
});

test("応答が不良に入った時だけ遅延を記録する", () => {
  assert.deepEqual(latencyEventFor("good", 500),
    { level: "warn", tag: "遅延", message: "応答が遅くなった（500 ms）" });
  assert.equal(latencyEventFor("bad", 500), null);
});

test("失敗や不良から戻った時に復旧を記録する", () => {
  assert.deepEqual(latencyEventFor("na", 50),
    { level: "good", tag: "復旧", message: "応答が正常に戻った（50 ms）" });
  assert.deepEqual(latencyEventFor("bad", 200),
    { level: "good", tag: "復旧", message: "応答が正常に戻った（200 ms）" });
});

test("良好と注意の間の揺れは記録しない", () => {
  assert.equal(latencyEventFor("good", 150), null);
  assert.equal(latencyEventFor("warn", 50), null);
});

test("初回の計測は、失敗していなければ記録しない", () => {
  assert.equal(latencyEventFor(null, 50), null);
  assert.deepEqual(latencyEventFor(null, null),
    { level: "bad", tag: "失敗", message: "応答時間の計測に失敗した（タイムアウトまたは通信エラー）" });
});

test("回線の変化は種別・品質・帯域の判定レベルが変わった分だけ挙げる", () => {
  const prev = { type: "Wi-Fi", effective: "4G相当以上", dlLevel: "good", downlink: 10 };
  const now = { type: "モバイル回線", effective: "3G相当", dlLevel: "bad", downlink: 0.8 };
  assert.deepEqual(connChanges(prev, now), [
    "回線種別 Wi-Fi → モバイル回線",
    "回線品質 4G相当以上 → 3G相当",
    "推定下り帯域 10 → 0.8 Mbps",
  ]);
});

test("帯域が揺れても判定レベルが同じなら記録しない", () => {
  const prev = { type: "Wi-Fi", effective: "4G相当以上", dlLevel: "good", downlink: 10 };
  const now = { type: "Wi-Fi", effective: "4G相当以上", dlLevel: "good", downlink: 9.5 };
  assert.deepEqual(connChanges(prev, now), []);
});

test("回線の情報が取れない側は「不明」と表記する", () => {
  const prev = { type: null, effective: null, dlLevel: "na", downlink: undefined };
  const now = { type: "Wi-Fi", effective: "4G相当以上", dlLevel: "good", downlink: 10 };
  assert.deepEqual(connChanges(prev, now), [
    "回線種別 不明 → Wi-Fi",
    "回線品質 不明 → 4G相当以上",
    "推定下り帯域 — → 10 Mbps",
  ]);
});

test("比較対象がなければ変化を記録しない", () => {
  assert.deepEqual(connChanges(null, { type: "Wi-Fi" }), []);
  assert.deepEqual(connChanges({ type: "Wi-Fi" }, null), []);
});

// ---------- 応答時間の統計 ----------
test("統計は成功サンプルだけで計算し、失敗を数える", () => {
  const s = latencyStats([10, null, 30, 20]);
  assert.equal(s.fail, 1);
  assert.equal(s.min, 10);
  assert.equal(s.max, 30);
  assert.equal(s.avg, 20);
});

test("ジッターは連続する成功サンプルの差の平均", () => {
  // 10→30 が 20、30→20 が 10。平均 15
  assert.equal(latencyStats([10, 30, 20]).jit, 15);
});

test("失敗を挟んでも、その前後の成功サンプルを連続として扱う", () => {
  // 計測が飛んだ区間を無かったことにするため、null を除いた隣り合う値で差を取る
  assert.equal(latencyStats([10, null, 100]).jit, 90);
  assert.equal(latencyStats([10, null, 30, 20]).jit, 15);
});

test("成功が1件ならジッターは出ない", () => {
  assert.equal(latencyStats([10]).jit, null);
});

test("成功が0件でも統計が壊れない", () => {
  assert.deepEqual(latencyStats([null, null]),
    { ok: [], fail: 2, min: null, avg: null, max: null, jit: null });
  assert.deepEqual(latencyStats([]),
    { ok: [], fail: 0, min: null, avg: null, max: null, jit: null });
});

test("グラフのY軸上限は値が収まる最小の区切りを選ぶ", () => {
  assert.equal(niceMax(0), 10);
  assert.equal(niceMax(11), 20);
  assert.equal(niceMax(50), 50);
  assert.equal(niceMax(51), 100);
  assert.equal(niceMax(10000), 10000);
  assert.equal(niceMax(10001), 20000); // 区切りを超えたら1万単位で繰り上げる
});

test("中央値は偶数個なら中央2つの平均", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

test("軸の上限は速い回線でも張り付かない刻みを選ぶ", () => {
  // 5〜15ms の回線。上限50msだと線が下に潰れる
  assert.equal(axisMax([5, 8, 12, 15]), 20);
  assert.equal(axisMax([2, 3, 4]), 10);
});

test("突発的な遅延は軸の決定から外す", () => {
  // 中央値20ms の3倍(60ms)を超える800msは外れ値。上限は平常値に合わせる
  assert.equal(axisMax([18, 20, 22, 800]), 30);
});

test("全体が遅い場合は外れ値扱いにせず全部を収める", () => {
  assert.equal(axisMax([400, 450, 500]), 500);
});

test("サンプルが失敗だけ、または空でも軸が決まる", () => {
  assert.equal(axisMax([null, null]), 10);
  assert.equal(axisMax([]), 10);
});

// ---------- 回線速度の測定 ----------
test("速度は桁に応じて表示の細かさを変える", () => {
  assert.equal(fmtMbps(253.7), "254 Mbps");
  assert.equal(fmtMbps(42.35), "42.4 Mbps");
  assert.equal(fmtMbps(3.456), "3.46 Mbps");
  assert.equal(fmtMbps(null), null);
});

test("速度は 100Mbps 以上で良好、30Mbps 以上で注意、それ未満は不良", () => {
  assert.equal(levelSpeed(100), "good");
  assert.equal(levelSpeed(99), "warn");
  assert.equal(levelSpeed(30), "warn");
  assert.equal(levelSpeed(29), "bad");
  assert.equal(levelSpeed(null), "na");
});

test("記録器は同じ区間の受信をまとめ、区間の境界で区切る", () => {
  const r = createRecorder(250);
  r.add(10, 1000);
  r.add(100, 2000);   // 同じ区間（0〜250ms）なのでまとめる
  r.add(260, 4000);   // 次の区間に入ったので前の区間を確定する
  r.add(300, 1000);
  r.flush(600);
  assert.deepEqual(r.records, [
    { at: 0, bytes: 3000 },
    { at: 260, bytes: 5000 },
  ]);
});

test("記録器は溜まった分を測定終了時に取りこぼさない", () => {
  const r = createRecorder(250);
  r.add(10, 1234);
  assert.deepEqual(r.records, []); // 区間が終わるまでは積まない
  r.flush(200);
  assert.deepEqual(r.records, [{ at: 0, bytes: 1234 }]);
});

test("記録器は受信がなければ空の記録を作らない", () => {
  const r = createRecorder(250);
  r.flush(100);
  r.add(300, 0);
  r.flush(400);
  assert.deepEqual(r.records, []);
});

test("記録器の記録は集計にそのまま渡せる", () => {
  // 250ms 区間ごとに 1,000,000 バイト = 32Mbps
  const r = createRecorder(250);
  for (let i = 0; i < 12; i++) r.add(i * 250 + 10, 1_000_000);
  r.flush(3010);
  assert.equal(Math.round(summarizeSpeed(r.records).peakMbps), 32);
});

test("記録器は0バイトの通知で区間を進めない", () => {
  // 区間だけ進むと、集計時に最終区間の判定がずれる
  const r = createRecorder(250);
  r.add(10, 1000);
  r.add(300, 0);
  r.flush(400);
  assert.deepEqual(r.records, [{ at: 0, bytes: 1000 }]);
});

test("所要時間を渡せば平均速度がそれを分母にする", () => {
  // 記録の at は区間の先頭側なので、渡さないと所要時間が短く出て平均速度が上振れする
  const records = [{ at: 0, bytes: 1_000_000 }, { at: 250, bytes: 1_000_000 }];
  assert.equal(summarizeSpeed(records).durationMs, 250);
  assert.equal(summarizeSpeed(records, { durationMs: 500 }).durationMs, 500);
  assert.equal(summarizeSpeed(records, { durationMs: 500 }).avgMbps, 32); // 2MB=16Mbit を 0.5秒
});

test("途中で受信が止まった測定は、止まっていた時間も所要時間に含める", () => {
  // 1MB 受信後に無反応のまま5秒で打ち切られた場合。受信時刻を分母にすると 80Mbps と出てしまう
  const r = summarizeSpeed([{ at: 0, bytes: 1_000_000 }], { durationMs: 5000 });
  assert.equal(r.avgMbps, 1.6);
  assert.equal(r.peakMbps, 1.6); // 使える区間がなければ平均で代用する
});

test("所要時間を渡しても最終区間の除外はずれない", () => {
  const r = createRecorder(250);
  for (let i = 0; i < 12; i++) r.add(i * 250 + 10, i === 11 ? 4_000_000 : 1_000_000);
  r.flush(3010);
  // 最終区間(4Mbps分)は途中で終わっている可能性があるので最高速度に含めない
  assert.equal(Math.round(summarizeSpeed(r.records, { durationMs: 3010 }).peakMbps), 32);
});

test("最高速度は立ち上がりと未完了の区間を除いた 0.25 秒ごとの最大値", () => {
  // 0.25秒ごとに 1,000,000 バイト＝32Mbps。1.25秒台だけ倍の 64Mbps
  const records = [];
  for (let i = 0; i < 12; i++) records.push({ at: i * 250 + 10, bytes: i === 5 ? 2_000_000 : 1_000_000 });
  const r = summarizeSpeed(records);
  assert.equal(Math.round(r.peakMbps), 64);
  assert.equal(r.totalBytes, 13_000_000);
});

test("立ち上がり区間の速い値は最高速度に含めない", () => {
  // 最初の1秒だけ極端に速いが、立ち上がり扱いで無視される
  const records = [
    { at: 10, bytes: 10_000_000 },
    { at: 1010, bytes: 1_000_000 },
    { at: 1260, bytes: 1_000_000 },
    { at: 1510, bytes: 1_000_000 },
  ];
  assert.equal(Math.round(summarizeSpeed(records).peakMbps), 32);
});

test("最後の区間は途中で終わっている可能性があるため最高速度から外す", () => {
  // 最終区間(key=8)だけ 4倍速い。これを採ると実際より速い値になる
  const records = [];
  for (let i = 0; i < 9; i++) records.push({ at: i * 250 + 10, bytes: i === 8 ? 4_000_000 : 1_000_000 });
  assert.equal(Math.round(summarizeSpeed(records).peakMbps), 32);
});

test("区間の幅と立ち上がりの除外時間は変更できる", () => {
  const records = [
    { at: 10, bytes: 5_000_000 },   // 立ち上がり扱いで除外
    { at: 510, bytes: 1_000_000 },  // 16Mbps
    { at: 1010, bytes: 2_000_000 }, // 32Mbps
    { at: 1600, bytes: 1_000_000 }, // 最終区間として除外
  ];
  const r = summarizeSpeed(records, { windowMs: 500, ignoreMs: 500 });
  assert.equal(Math.round(r.peakMbps), 32);
});

test("平均速度は受信量全体を所要時間で割る", () => {
  const r = summarizeSpeed([{ at: 1000, bytes: 1_000_000 }, { at: 2000, bytes: 1_000_000 }]);
  assert.equal(r.avgMbps, 8); // 2,000,000バイト = 16Mbit を 2秒
  assert.equal(r.durationMs, 2000);
});

test("区間が足りなければ最高速度は平均速度で代用する", () => {
  const r = summarizeSpeed([{ at: 300, bytes: 1_000_000 }]);
  assert.equal(r.peakMbps, r.avgMbps);
});

test("1バイトも受信できなければ速度は出さない", () => {
  assert.deepEqual(summarizeSpeed([]), { peakMbps: null, avgMbps: null, totalBytes: 0, durationMs: 0 });
  assert.deepEqual(summarizeSpeed([{ at: 100, bytes: 0 }]),
    { peakMbps: null, avgMbps: null, totalBytes: 0, durationMs: 100 });
});

// ---------- ページ読み込みの内訳 ----------
// PerformanceNavigationTiming の必要な値だけを持つ代用オブジェクト
const navEntry = (over = {}) => ({
  domainLookupStart: 0, domainLookupEnd: 10,
  connectStart: 10, secureConnectionStart: 20, connectEnd: 40,
  requestStart: 40, responseStart: 90, responseEnd: 120,
  domContentLoadedEventEnd: 200, loadEventEnd: 300,
  nextHopProtocol: "h2", transferSize: 2048,
  ...over,
});

test("読み込みの内訳を各区間に分ける", () => {
  const t = computeTiming(navEntry());
  assert.deepEqual(t.phases, [
    ["DNS 名前解決", 10],
    ["TCP 接続", 10],
    ["TLS 暗号化", 20],
    ["サーバー応答待ち", 50],
    ["受信", 30],
    ["画面の組み立て", 80],
  ]);
  assert.equal(t.total, 300);
  assert.equal(t.protocol, "h2");
  assert.equal(t.transferSize, 2048);
});

test("暗号化されていない接続では TLS を 0 とし、接続時間に含めない", () => {
  const t = computeTiming(navEntry({ secureConnectionStart: 0 }));
  assert.deepEqual(t.phases[1], ["TCP 接続", 30]);
  assert.deepEqual(t.phases[2], ["TLS 暗号化", 0]);
});

test("接続を再利用した場合は接続関連が 0 になる", () => {
  const t = computeTiming(navEntry({ connectStart: 10, connectEnd: 10, secureConnectionStart: 0 }));
  assert.deepEqual(t.phases[1], ["TCP 接続", 0]);
  assert.deepEqual(t.phases[2], ["TLS 暗号化", 0]);
});

test("読み込みが完了していなければ完了時間は null", () => {
  assert.equal(computeTiming(navEntry({ loadEventEnd: 0 })).total, 200);
  assert.equal(computeTiming(navEntry({ loadEventEnd: 0, domContentLoadedEventEnd: 0 })).total, null);
});

test("Navigation Timing が取れなければ内訳なし", () => {
  assert.equal(computeTiming(undefined), null);
});

test("内訳の各行を読める表記に整える", () => {
  const rows = timingRows(computeTiming(navEntry({ nextHopProtocol: "h3" })));
  assert.deepEqual(rows[0], ["読み込み完了まで", "300 ms"]);
  assert.deepEqual(rows[1], ["通信プロトコル", "HTTP/3"]);
  assert.equal(rows[2][1], "2.0 KB");
});

test("転送サイズが 0 なら注記を添える", () => {
  const rows = timingRows(computeTiming(navEntry({ transferSize: 0 })));
  assert.equal(rows[2][1], "0 B");
  assert.match(rows[2][2], /通信が発生しなかった/);
});

test("転送サイズがブラウザから返らなければ取得不可", () => {
  const rows = timingRows(computeTiming(navEntry({ transferSize: undefined })));
  assert.equal(rows[2][1], null);
  assert.equal(rows[2][2], undefined);
});

test("内訳が未取得なら全項目が取得不可", () => {
  assert.deepEqual(timingRows(null).map((r) => r[1]), [null, null, null]);
});

// ---------- グローバルIP ----------
test("プロバイダ表記を AS 番号と社名に分ける", () => {
  const rows = ipRows({ ip: "203.0.113.10", org: "AS2516 KDDI CORPORATION", city: "Tokyo", region: "Tokyo", country: "JP", hostname: "example.jp" });
  assert.deepEqual(rows[0], ["グローバルIP", "203.0.113.10"]);
  assert.deepEqual(rows[1], ["プロバイダ", "KDDI CORPORATION"]);
  assert.deepEqual(rows[2], ["AS 番号", "AS2516"]);
  assert.equal(rows[3][1], "Tokyo, Tokyo, JP");
  assert.deepEqual(rows[4], ["ホスト名", "example.jp"]);
});

test("AS 番号のない表記はそのままプロバイダ名にする", () => {
  const rows = ipRows({ org: "Example Networks" });
  assert.deepEqual(rows[1], ["プロバイダ", "Example Networks"]);
  assert.deepEqual(rows[2], ["AS 番号", null]);
});

test("地域が部分的にしか返らなくても連結する", () => {
  assert.equal(ipRows({ country: "JP" })[3][1], "JP");
  assert.equal(ipRows({})[3][1], null);
});

test("応答が空やオブジェクト以外でも全項目が取得不可になるだけ", () => {
  for (const bad of [{}, null, undefined, "error", 42]) {
    assert.deepEqual(ipRows(bad).map((r) => r[1]), [null, null, null, null, null]);
  }
});
