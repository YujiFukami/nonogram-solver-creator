'use strict';

/**
 * puzzle-search.js — 「解ける問題」を探す処理（画像・QRコード共通）
 *
 * 考え方: 解けない問題を後から直すより、同じ見た目・同じ意味になる候補を
 *         たくさん作り、ソルバーで解ける割合を測って最良のものを選ぶ。
 *
 *   QR  : マスク8種 × 誤り訂正 × URL末尾 #1〜#15（開くページは同じ）を試し、
 *         完全に解けて、jsQR で実際に読み取れるものを選ぶ
 *   画像: しきい値（明るさの分位点）× ならし × 閉包 × 孤立除去 × 最小塊 を試し、
 *         完全に解ける候補を、黒の割合が半分に近い順に並べる
 *
 * 依存（グローバル）: NonogramSolver, ImageProcessor, qrcode, jsQR(任意)
 * Web Worker（puzzle-search-worker.js）からも、画面側からも同じコードを使う。
 */
const PuzzleSearch = (() => {

  const EC_ORDER = ['L', 'M', 'Q', 'H'];
  const MAX_SUFFIX = 15;

  const tick = () => new Promise(r => setTimeout(r, 0));

  /** 盤面をソルバーで解き、解ける割合と完全に解けたかを返す */
  function solveGrid(grid) {
    const { rowHints, colHints } = ImageProcessor.generateHints(grid);
    const solver = new NonogramSolver(rowHints, colHints);
    const res = solver.solve();
    return { rate: res.solveRate, solved: !!res.solved && !res.contradiction };
  }

  // ─── QR ────────────────────────────────────────────────

  function makeQR(text, ec, mask) {
    const q = qrcode(0, ec);
    q.addData(text, 'Byte');
    q.setMaskPattern(mask);
    q.make();
    const n = q.getModuleCount();
    const grid = [];
    for (let r = 0; r < n; r++) {
      const row = new Uint8Array(n);
      for (let c = 0; c < n; c++) row[c] = q.isDark(r, c) ? 1 : 0;
      grid.push(row);
    }
    return { grid, n };
  }

  /** jsQR で読み取れるか（jsQR が無い環境では null = 未確認） */
  function decodeOk(grid, text) {
    if (typeof jsQR !== 'function') return null;
    const scale = 6, qz = 4, n = grid.length, size = (n + qz * 2) * scale;
    const data = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (!grid[r][c]) continue;
      for (let y = 0; y < scale; y++) {
        let i = (((r + qz) * scale + y) * size + (c + qz) * scale) * 4;
        for (let x = 0; x < scale; x++, i += 4) { data[i] = data[i + 1] = data[i + 2] = 0; }
      }
    }
    const res = jsQR(data, size, size, { inversionAttempts: 'dontInvert' });
    return !!res && res.data === text;
  }

  /** URL の末尾に #数字 を付けても開くページが変わらないか（すでに # があるものは対象外） */
  function canAddSuffix(text) {
    return /^https?:\/\/\S+$/i.test(text) && !text.includes('#');
  }

  /**
   * @param {{text, minEc, allowSuffix}} p
   * @returns {{found, text, suffix, ec, mask, n, rate, solved, decoded, tried, total, ms, suffixAllowed}}
   */
  async function searchQR(p, onProgress, isCancelled) {
    const t0 = Date.now();
    const text = String(p.text || '');
    const ecs = EC_ORDER.slice(Math.max(0, EC_ORDER.indexOf(p.minEc || 'M')));
    const suffixAllowed = !!p.allowSuffix && canAddSuffix(text);
    const suffixes = [''];
    if (suffixAllowed) for (let k = 1; k <= MAX_SUFFIX; k++) suffixes.push('#' + k);

    const total = suffixes.length * ecs.length * 8;
    let tried = 0, best = null, lastYield = Date.now();

    for (const sfx of suffixes) {
      const solvedHere = [];
      for (const ec of ecs) {
        for (let mask = 0; mask < 8; mask++) {
          if (Date.now() - lastYield > 60) {
            await tick();
            lastYield = Date.now();
            if (isCancelled && isCancelled()) return { cancelled: true, tried, total };
            if (onProgress) onProgress(tried, total);
          }
          const t = text + sfx;
          const q = makeQR(t, ec, mask);
          const r = solveGrid(q.grid);
          tried++;
          const cand = { text: t, suffix: sfx, ec, mask, n: q.n, rate: r.rate, solved: r.solved };
          if (r.solved) {
            const d = decodeOk(q.grid, t);
            if (d !== false) solvedHere.push({ ...cand, decoded: d });
          }
          if (!best || r.rate > best.rate + 1e-9 ||
              (Math.abs(r.rate - best.rate) < 1e-9 && EC_ORDER.indexOf(ec) > EC_ORDER.indexOf(best.ec))) {
            best = cand;
          }
        }
      }
      if (solvedHere.length) {
        // 誤り訂正が強いもの（読み取りに強い）→ 小さいもの を優先
        solvedHere.sort((a, b) => EC_ORDER.indexOf(b.ec) - EC_ORDER.indexOf(a.ec) || a.n - b.n);
        return { found: true, ...solvedHere[0], tried, total, ms: Date.now() - t0, suffixAllowed };
      }
    }
    const q = makeQR(best.text, best.ec, best.mask);
    return { found: false, ...best, decoded: decodeOk(q.grid, best.text), tried, total, ms: Date.now() - t0, suffixAllowed };
  }

  // ─── 画像 ──────────────────────────────────────────────

  function sortedCopy(arr) { return Float32Array.from(arr).sort(); }
  function percentileOf(sorted, p) { return sorted[Math.floor((sorted.length - 1) * p)]; }

  /**
   * @param {{gray: Float32Array, W, H, maxResults}} p
   * @returns {{candidates: [{settings, rate, solved, blackRatio, grid}], tried, solvedCount, ms, reduced}}
   */
  async function searchImage(p, onProgress, isCancelled) {
    const t0 = Date.now();
    const { W, H } = p;
    const gray = p.gray instanceof Float32Array ? p.gray : Float32Array.from(p.gray);
    const reduced = W * H > 15000; // 大きい問題は試す数を減らす
    const PS      = reduced ? [0.4, 0.5, 0.6] : [0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65];
    const MINBLOB = reduced ? [0] : [0, 3];

    const sorted = { false: sortedCopy(gray), true: sortedCopy(ImageProcessor.smoothGray(gray, W, H)) };
    const configs = [];
    for (const smooth of [false, true]) for (const pp of PS)
      for (const closing of [0, 1]) for (const isolate of [0, 2]) for (const minBlob of MINBLOB) {
        const thr = Math.max(1, Math.min(254, Math.round(percentileOf(sorted[smooth], pp))));
        configs.push({ mode: 'threshold', threshold: thr, smooth, closing, isolate, minBlob,
                       brightness: 0, contrast: 0, edgeBoost: 0 });
      }

    const seen = new Set();
    const results = [];
    let tried = 0, lastYield = Date.now();
    for (const s of configs) {
      if (Date.now() - lastYield > 60) {
        await tick();
        lastYield = Date.now();
        if (isCancelled && isCancelled()) return { cancelled: true, tried, total: configs.length };
        if (onProgress) onProgress(tried, configs.length);
      }
      tried++;
      const grid = ImageProcessor.grayToGrid(gray, W, H, s);
      let black = 0;
      for (const row of grid) for (const v of row) black += v;
      const blackRatio = black / (W * H);
      if (blackRatio < 0.12 || blackRatio > 0.88) continue;  // ほぼ真っ白・真っ黒は除く
      const key = grid.map(r => r.join('')).join('|');
      if (seen.has(key)) continue;                           // 同じ盤面は1つだけ
      seen.add(key);
      const r = solveGrid(grid);
      results.push({ settings: s, rate: r.rate, solved: r.solved, blackRatio, grid });
    }

    results.sort((a, b) =>
      (b.solved - a.solved) || (b.rate - a.rate) || (Math.abs(a.blackRatio - 0.5) - Math.abs(b.blackRatio - 0.5)));
    // 見た目の違う候補を並べるため、しきい値とならしの組み合わせごとに最良の1つだけ残す
    const picked = [], looks = new Set();
    for (const x of results) {
      const look = x.settings.threshold + (x.settings.smooth ? 's' : '');
      if (looks.has(look)) continue;
      looks.add(look);
      picked.push(x);
      if (picked.length >= (p.maxResults || 6)) break;
    }
    return {
      candidates: picked,
      tried, total: configs.length,
      solvedCount: results.filter(x => x.solved).length,
      ms: Date.now() - t0, reduced,
    };
  }

  return { searchQR, searchImage, solveGrid, canAddSuffix };
})();

// ═══════════════════════════════════════════════════════════
//  画面側から使う窓口: Web Worker で実行（使えない環境では画面側で実行）
// ═══════════════════════════════════════════════════════════
if (typeof document !== 'undefined') {
  // eslint-disable-next-line no-unused-vars
  var PuzzleSearchClient = (() => {
    let _seq = 0;

    /**
     * @param {'qr'|'image'} kind
     * @returns {{ promise: Promise, cancel: Function }}
     */
    function run(kind, params, onProgress) {
      let cancelled = false;
      let worker = null;
      const id = ++_seq;

      const runHere = () => {
        const fn = kind === 'qr' ? PuzzleSearch.searchQR : PuzzleSearch.searchImage;
        return fn(params, onProgress, () => cancelled);
      };

      const promise = new Promise((resolve, reject) => {
        try {
          worker = new Worker('js/puzzle-search-worker.js');
        } catch (e) {
          worker = null;
        }
        if (!worker) { runHere().then(resolve, reject); return; }

        let started = false;
        worker.onmessage = (e) => {
          const m = e.data;
          if (m.id !== id) return;
          started = true;
          if (m.type === 'progress' && onProgress) onProgress(m.done, m.total);
          else if (m.type === 'done')  { worker.terminate(); resolve(m.result); }
          else if (m.type === 'error') { worker.terminate(); reject(new Error(m.message)); }
        };
        worker.onerror = (e) => {
          // file:// などで Worker を読み込めないときは画面側で実行する
          e.preventDefault();
          worker.terminate();
          if (!started) runHere().then(resolve, reject);
          else reject(new Error(e.message || 'worker error'));
        };
        worker.postMessage({ id, kind, params });
      });

      return {
        promise,
        cancel() {
          cancelled = true;
          if (worker) { worker.postMessage({ type: 'cancel' }); }
        },
      };
    }

    return { run };
  })();
}
