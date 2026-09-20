// 画面描画から独立した判定・整形のロジック。ブラウザAPIに触れないため単体テストできる

export const LEVEL_LABEL = { good: "良好", warn: "注意", bad: "不良", na: "—" };

export const EFFECTIVE_TYPE_LABEL = {
  "slow-2g": "非常に遅い (2G未満)", "2g": "2G相当", "3g": "3G相当", "4g": "4G相当以上",
};

export const CONN_TYPE_LABEL = {
  wifi: "Wi-Fi", ethernet: "有線LAN", cellular: "モバイル回線", bluetooth: "Bluetooth",
  wimax: "WiMAX", none: "未接続", other: "その他", unknown: "不明",
};

export const PROTOCOL_LABEL = {
  "h3": "HTTP/3", "h2": "HTTP/2", "http/1.1": "HTTP/1.1", "http/1.0": "HTTP/1.0",
};

// ---------- 判定 ----------
export function levelLatency(ms) {
  if (ms == null) return "na";
  return ms < 100 ? "good" : ms < 300 ? "warn" : "bad";
}

export function levelDownlink(mbps) {
  if (mbps == null) return "na";
  return mbps >= 5 ? "good" : mbps >= 1.5 ? "warn" : "bad";
}

export function levelBattery(b) {
  if (!b) return "na";
  if (b.charging) return "good";
  return b.level > 0.2 ? "good" : b.level > 0.1 ? "warn" : "bad";
}

// ---------- 整形 ----------
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function fmtBytes(n) {
  if (n == null) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtDuration(sec) {
  if (sec == null || !isFinite(sec)) return null;
  if (sec < 60) return "1分未満";
  // 先に分へ丸めてから時間に繰り上げる（「1時間60分」を防ぐ）
  const total = Math.round(sec / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}時間${m}分` : `${m}分`;
}

export function fmtTime(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function fmtMs(ms) {
  return `${Math.round(ms)} ms`;
}

export function connTypeLabel(conn) {
  return conn?.type ? CONN_TYPE_LABEL[conn.type] ?? conn.type : null;
}

export function effectiveTypeLabel(conn) {
  return conn?.effectiveType ? EFFECTIVE_TYPE_LABEL[conn.effectiveType] ?? conn.effectiveType : null;
}

export function batteryTimeText(b) {
  if (!b) return null;
  if (b.charging) {
    if (b.chargingTime === 0) return "満充電";
    const d = fmtDuration(b.chargingTime);
    return d ? `満充電まで ${d}` : "充電中（時間不明）";
  }
  const d = fmtDuration(b.dischargingTime);
  return d ? `あと ${d}` : "計算中";
}

// ---------- 接続イベント ----------
// 応答時間の状態が「失敗」「不良」に入った時と、そこから戻った時だけ記録する
// （しきい値付近の良好⇔注意の揺れまで記録すると一覧が埋まるため）
export function latencyEventFor(prevLevel, ms) {
  const level = levelLatency(ms);
  const troubled = (lv) => lv === "na" || lv === "bad";
  if (level === "na" && prevLevel !== "na") {
    return { level: "bad", tag: "失敗", message: "応答時間の計測に失敗した（タイムアウトまたは通信エラー）" };
  }
  if (level === "bad" && prevLevel !== "bad") {
    return { level: "warn", tag: "遅延", message: `応答が遅くなった（${ms} ms）` };
  }
  if (!troubled(level) && troubled(prevLevel)) {
    return { level: "good", tag: "復旧", message: `応答が正常に戻った（${ms} ms）` };
  }
  return null;
}

// 推定帯域は細かく揺れるので、判定レベルが変わった時だけ記録する
export function connChanges(prev, now) {
  if (!prev || !now) return [];
  const changes = [];
  if (prev.type !== now.type) changes.push(`回線種別 ${prev.type ?? "不明"} → ${now.type ?? "不明"}`);
  if (prev.effective !== now.effective) changes.push(`回線品質 ${prev.effective ?? "不明"} → ${now.effective ?? "不明"}`);
  if (prev.dlLevel !== now.dlLevel) changes.push(`推定下り帯域 ${prev.downlink ?? "—"} → ${now.downlink ?? "—"} Mbps`);
  return changes;
}

// ---------- 応答時間の統計 ----------
export function latencyStats(samples) {
  const ok = samples.filter((v) => v != null);
  const fail = samples.length - ok.length;
  if (!ok.length) return { ok, fail, min: null, avg: null, max: null, jit: null };
  const avg = ok.reduce((a, b) => a + b, 0) / ok.length;
  // ジッター = 連続する成功サンプル間の差の絶対値の平均
  let jit = null;
  if (ok.length >= 2) {
    let sum = 0;
    for (let i = 1; i < ok.length; i++) sum += Math.abs(ok[i] - ok[i - 1]);
    jit = sum / (ok.length - 1);
  }
  return { ok, fail, min: Math.min(...ok), avg, max: Math.max(...ok), jit };
}

// グラフのY軸上限。値が収まる最小の区切りを選ぶ
export function niceMax(v) {
  const steps = [10, 20, 30, 50, 100, 200, 300, 500, 1000, 2000, 5000, 10000];
  return steps.find((s) => s >= v) ?? Math.ceil(v / 10000) * 10000;
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// 突発的な遅延で平常時の変動が潰れないよう、中央値の3倍を超える値は軸の決定から外す。
// 外れた値はグラフ上端に印で示す（描画側の責務）
export function axisMax(samples) {
  const ok = samples.filter((v) => v != null);
  if (!ok.length) return niceMax(0);
  // 中央値以下の値は必ず残るので、inliers が空になることはない
  const cap = median(ok) * 3;
  const inliers = ok.filter((v) => v <= cap);
  return niceMax(Math.max(...inliers));
}

// ---------- 回線速度の測定 ----------
export function fmtMbps(mbps) {
  if (mbps == null) return null;
  return mbps >= 100 ? `${Math.round(mbps)} Mbps`
    : mbps >= 10 ? `${mbps.toFixed(1)} Mbps`
    : `${mbps.toFixed(2)} Mbps`;
}

export function levelSpeed(mbps) {
  if (mbps == null) return "na";
  return mbps >= 100 ? "good" : mbps >= 30 ? "warn" : "bad";
}

// 受信した塊をそのまま記録すると高速回線で数万件になるため、集計の区間（既定250ms）ごとにまとめる。
// 区間の境界に合わせて区切るので、まとめたバイト数が隣の区間へはみ出さない。
// 記録の at は「その区間で最初に受信した時刻」で、区間の境界そのものではない
export function createRecorder(windowMs = 250) {
  const records = [];
  let pending = 0;
  let pendingAt = 0;
  // 区間の切れ目（または測定終了時）に、溜まったバイト数を1件として積む
  const flush = (at) => {
    if (pending) records.push({ at: pendingAt, bytes: pending });
    pending = 0;
    pendingAt = at;
  };
  return {
    records,
    add(at, bytes) {
      // 0バイトの通知で区間だけ進むと、集計時に最終区間の判定がずれる
      if (bytes <= 0) return;
      if (Math.floor(at / windowMs) !== Math.floor(pendingAt / windowMs)) flush(at);
      pending += bytes;
    },
    flush,
  };
}

// records: { at: その区間で最初に受信した時刻（ミリ秒）, bytes: その区間に受信したバイト数 }
// durationMs には実際に測定していた時間を渡す。渡さないと記録の最後の at を所要時間とみなすが、
// それは最終区間の先頭時刻なので、平均速度が実際より高く出る。
// 接続の立ち上がり（既定で最初の1秒）は本来の速度が出ないため、最高速度の算出から外す。
// 最後の区間は途中で終わっている可能性があるので同様に外す
export function summarizeSpeed(records, { windowMs = 250, ignoreMs = 1000, durationMs: given } = {}) {
  const totalBytes = records.reduce((a, r) => a + r.bytes, 0);
  const durationMs = given ?? records.reduce((a, r) => Math.max(a, r.at), 0);
  if (!totalBytes || durationMs <= 0) return { peakMbps: null, avgMbps: null, totalBytes, durationMs };

  const avgMbps = (totalBytes * 8) / 1e6 / (durationMs / 1000);

  const buckets = new Map();
  for (const r of records) {
    const key = Math.floor(r.at / windowMs);
    buckets.set(key, (buckets.get(key) ?? 0) + r.bytes);
  }
  // 最後の区間は測定の打ち切りで途中までしか受信していない可能性があるため外す。
  // 所要時間ではなく記録そのものから決める（所要時間は受信が止まった時間も含むため）
  const lastKey = Math.max(...buckets.keys());
  const usable = [...buckets.entries()]
    .filter(([key]) => key * windowMs >= ignoreMs && key !== lastKey)
    .map(([, bytes]) => (bytes * 8) / 1e6 / (windowMs / 1000));

  return {
    peakMbps: usable.length ? Math.max(...usable) : avgMbps,
    avgMbps,
    totalBytes,
    durationMs,
  };
}

// ---------- ページ読み込みの内訳 ----------
// nav は PerformanceNavigationTiming。接続を再利用した場合は各区間が 0 になる
export function computeTiming(nav) {
  if (!nav) return null;
  const tlsStart = nav.secureConnectionStart > 0 ? nav.secureConnectionStart : null;
  return {
    phases: [
      ["DNS 名前解決", nav.domainLookupEnd - nav.domainLookupStart],
      ["TCP 接続", (tlsStart ?? nav.connectEnd) - nav.connectStart],
      ["TLS 暗号化", tlsStart ? nav.connectEnd - tlsStart : 0],
      ["サーバー応答待ち", nav.responseStart - nav.requestStart],
      ["受信", nav.responseEnd - nav.responseStart],
      ["画面の組み立て", (nav.domContentLoadedEventEnd || nav.responseEnd) - nav.responseEnd],
    ],
    total: nav.loadEventEnd || nav.domContentLoadedEventEnd || null,
    protocol: nav.nextHopProtocol || null,
    transferSize: nav.transferSize ?? null,
  };
}

export function timingRows(t) {
  return [
    ["読み込み完了まで", t?.total ? fmtMs(t.total) : null],
    ["通信プロトコル", t?.protocol ? PROTOCOL_LABEL[t.protocol] ?? t.protocol : null],
    ["転送サイズ", t?.transferSize != null
      ? (t.transferSize === 0 ? "0 B" : fmtBytes(t.transferSize))
      : null,
      t?.transferSize === 0 ? "キャッシュからの表示など、通信が発生しなかった場合は 0 になる" : undefined],
  ];
}

// ---------- グローバルIP ----------
// ipinfo の org は「AS2516 KDDI CORPORATION」の形式なので AS 番号と社名に分ける
export function ipRows(d) {
  const data = d && typeof d === "object" ? d : {};
  const m = /^(AS\d+)\s+(.+)$/.exec(data.org ?? "");
  const area = [data.city, data.region, data.country].filter(Boolean).join(", ");
  return [
    ["グローバルIP", data.ip ?? null],
    ["プロバイダ", m ? m[2] : data.org ?? null],
    ["AS 番号", m ? m[1] : null],
    ["おおよその地域", area || null, area ? "IPアドレスからの推定。実際の場所とずれることが多い" : undefined],
    ["ホスト名", data.hostname ?? null],
  ];
}
