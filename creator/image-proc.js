'use strict';

/**
 * image-proc.js — 画像処理ユーティリティ
 * 変換モード: threshold / adaptive / dither / outline
 * 後処理: closing / isolate / minBlob
 */
const ImageProcessor = (() => {

  function pixelToGray(r, g, b) { return r * 0.299 + g * 0.587 + b * 0.114; }
  function clamp(v) { return Math.max(0, Math.min(255, v)); }

  function adjustPixel(gray, brightness, contrast) {
    const factor = contrast >= 0
      ? (259 * (contrast + 255)) / (255 * (259 - contrast))
      : (259 * (255 + contrast)) / (255 * (259 + contrast));
    return clamp(Math.round(factor * (gray - 128) + 128 + brightness * 2.55));
  }

  // ─── エッジ強調（Sobel） ──────────────────────────────────────

  function applyEdgeBoost(gray, W, H, strength) {
    if (strength <= 0) return new Float32Array(gray);
    const result = new Float32Array(W * H);
    const factor = strength / 100;
    for (let r = 1; r < H - 1; r++) {
      for (let c = 1; c < W - 1; c++) {
        const gx =
          -gray[(r-1)*W+(c-1)] + gray[(r-1)*W+(c+1)]
          -2*gray[r*W+(c-1)]   + 2*gray[r*W+(c+1)]
          -gray[(r+1)*W+(c-1)] + gray[(r+1)*W+(c+1)];
        const gy =
          -gray[(r-1)*W+(c-1)] - 2*gray[(r-1)*W+c] - gray[(r-1)*W+(c+1)]
          +gray[(r+1)*W+(c-1)] + 2*gray[(r+1)*W+c] + gray[(r+1)*W+(c+1)];
        result[r*W+c] = clamp(gray[r*W+c] - Math.sqrt(gx*gx+gy*gy) * factor);
      }
    }
    for (let c = 0; c < W; c++) { result[c] = gray[c]; result[(H-1)*W+c] = gray[(H-1)*W+c]; }
    for (let r = 0; r < H; r++) { result[r*W] = gray[r*W]; result[r*W+W-1] = gray[r*W+W-1]; }
    return result;
  }

  // ─── 適応的閾値（積分画像で高速化） ─────────────────────────

  function adaptiveThreshold(gray, W, H, blockSize, thresholdOffset) {
    // 積分画像
    const integral = new Float64Array((W+1) * (H+1));
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        integral[(r+1)*(W+1)+(c+1)] =
          gray[r*W+c] +
          integral[r*(W+1)+(c+1)] +
          integral[(r+1)*(W+1)+c] -
          integral[r*(W+1)+c];
      }
    }
    const half = Math.floor(blockSize / 2);
    const result = [];
    for (let r = 0; r < H; r++) {
      const row = new Uint8Array(W);
      for (let c = 0; c < W; c++) {
        const r1 = Math.max(0, r - half), r2 = Math.min(H-1, r + half);
        const c1 = Math.max(0, c - half), c2 = Math.min(W-1, c + half);
        const count = (r2-r1+1) * (c2-c1+1);
        const sum =
          integral[(r2+1)*(W+1)+(c2+1)] -
          integral[r1*(W+1)+(c2+1)] -
          integral[(r2+1)*(W+1)+c1] +
          integral[r1*(W+1)+c1];
        const mean = sum / count;
        // 高い閾値 → より多くが黒、低い閾値 → より少なく黒（通常モードと同方向）
        row[c] = gray[r*W+c] < (mean + thresholdOffset) ? 1 : 0;
      }
      result.push(row);
    }
    return result;
  }

  // ─── ディザリング（Floyd-Steinberg） ─────────────────────────

  function floydSteinbergDither(gray, W, H, brightness, contrast) {
    const buf = new Float32Array(W * H);
    for (let i = 0; i < gray.length; i++) {
      buf[i] = adjustPixel(gray[i], brightness, contrast);
    }
    const grid = Array.from({ length: H }, () => new Uint8Array(W));
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const idx = r * W + c;
        const oldVal = clamp(buf[idx]);
        const newVal = oldVal < 128 ? 0 : 255;
        const error  = oldVal - newVal;
        grid[r][c]   = newVal < 128 ? 1 : 0;
        if (c+1 < W)         buf[idx+1]          += error * 7/16;
        if (r+1 < H) {
          if (c > 0)          buf[(r+1)*W+(c-1)] += error * 3/16;
                              buf[(r+1)*W+c]     += error * 5/16;
          if (c+1 < W)        buf[(r+1)*W+(c+1)] += error * 1/16;
        }
      }
    }
    return grid;
  }

  // ─── 輪郭抽出（Sobel magnitude → threshold） ─────────────────

  function extractOutlines(gray, W, H, brightness, contrast, threshold) {
    const mag = new Float32Array(W * H);
    for (let r = 1; r < H-1; r++) {
      for (let c = 1; c < W-1; c++) {
        const gx =
          -gray[(r-1)*W+(c-1)] + gray[(r-1)*W+(c+1)]
          -2*gray[r*W+(c-1)]   + 2*gray[r*W+(c+1)]
          -gray[(r+1)*W+(c-1)] + gray[(r+1)*W+(c+1)];
        const gy =
          -gray[(r-1)*W+(c-1)] - 2*gray[(r-1)*W+c] - gray[(r-1)*W+(c+1)]
          +gray[(r+1)*W+(c-1)] + 2*gray[(r+1)*W+c] + gray[(r+1)*W+(c+1)];
        mag[r*W+c] = Math.sqrt(gx*gx + gy*gy);
      }
    }
    let maxMag = 1;
    for (let i = 0; i < mag.length; i++) if (mag[i] > maxMag) maxMag = mag[i];

    const grid = [];
    for (let r = 0; r < H; r++) {
      const row = new Uint8Array(W);
      for (let c = 0; c < W; c++) {
        // エッジが強い → 暗い（黒）、エッジなし → 明るい（白）
        const invNorm = 255 - (mag[r*W+c] / maxMag * 255);
        const adjusted = adjustPixel(invNorm, brightness, contrast);
        // 通常モードと同方向：閾値が高い → より多くの弱いエッジも黒
        row[c] = adjusted < threshold ? 1 : 0;
      }
      grid.push(row);
    }
    return grid;
  }

  // ─── モルフォロジー処理 ──────────────────────────────────────

  function dilateGrid(grid, radius) {
    if (radius <= 0) return grid;
    const rows = grid.length, cols = rows > 0 ? grid[0].length : 0;
    const result = grid.map(r => new Uint8Array(r));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (result[r][c] === 1) continue;
        outer: for (let dr = -radius; dr <= radius; dr++) {
          for (let dc = -radius; dc <= radius; dc++) {
            if (Math.abs(dr)+Math.abs(dc) > radius) continue;
            const nr = r+dr, nc = c+dc;
            if (nr<0||nr>=rows||nc<0||nc>=cols) continue;
            if (grid[nr][nc] === 1) { result[r][c] = 1; break outer; }
          }
        }
      }
    }
    return result;
  }

  function erodeGrid(grid, radius) {
    if (radius <= 0) return grid;
    const rows = grid.length, cols = rows > 0 ? grid[0].length : 0;
    const result = grid.map(r => new Uint8Array(r));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (result[r][c] === 0) continue;
        outer: for (let dr = -radius; dr <= radius; dr++) {
          for (let dc = -radius; dc <= radius; dc++) {
            if (Math.abs(dr)+Math.abs(dc) > radius) continue;
            const nr = r+dr, nc = c+dc;
            if (nr<0||nr>=rows||nc<0||nc>=cols) continue;
            if (grid[nr][nc] === 0) { result[r][c] = 0; break outer; }
          }
        }
      }
    }
    return result;
  }

  function closingGrid(grid, radius) {
    if (radius <= 0) return grid;
    return erodeGrid(dilateGrid(grid, radius), radius);
  }

  // ─── 後処理フィルタ ──────────────────────────────────────────

  function removeIsolated(grid, minNeighbors) {
    if (minNeighbors <= 0) return grid;
    const rows = grid.length, cols = rows > 0 ? grid[0].length : 0;
    let cur = grid.map(r => new Uint8Array(r));
    for (let pass = 0; pass < 10; pass++) {
      let changed = false;
      const next = cur.map(r => new Uint8Array(r));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (cur[r][c] === 0) continue;
          let cnt = 0;
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            if (dr===0&&dc===0) continue;
            const nr=r+dr,nc=c+dc;
            if (nr>=0&&nr<rows&&nc>=0&&nc<cols&&cur[nr][nc]===1) cnt++;
          }
          if (cnt < minNeighbors) { next[r][c] = 0; changed = true; }
        }
      }
      cur = next;
      if (!changed) break;
    }
    return cur;
  }

  function removeSmallComponents(grid, minSize) {
    if (minSize <= 1) return grid;
    const rows = grid.length, cols = rows > 0 ? grid[0].length : 0;
    const visited = Array.from({ length: rows }, () => new Uint8Array(cols));
    const result  = grid.map(r => new Uint8Array(r));
    for (let sr = 0; sr < rows; sr++) {
      for (let sc = 0; sc < cols; sc++) {
        if (grid[sr][sc] === 0 || visited[sr][sc]) continue;
        const cells = [], queue = [[sr, sc]];
        visited[sr][sc] = 1;
        while (queue.length) {
          const [r, c] = queue.shift();
          cells.push([r, c]);
          for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++) {
            if (dr===0&&dc===0) continue;
            const nr=r+dr,nc=c+dc;
            if (nr<0||nr>=rows||nc<0||nc>=cols) continue;
            if (grid[nr][nc]===1&&!visited[nr][nc]) { visited[nr][nc]=1; queue.push([nr,nc]); }
          }
        }
        if (cells.length < minSize) for (const [r,c] of cells) result[r][c] = 0;
      }
    }
    return result;
  }

  // ─── コアパイプライン ─────────────────────────────────────────

  function _toGrayF32(data, W, H) {
    const gray = new Float32Array(W * H);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      gray[j] = pixelToGray(data[i], data[i+1], data[i+2]);
    }
    return gray;
  }

  /**
   * opts:
   *   mode       : 'threshold' | 'adaptive' | 'dither' | 'outline'
   *   threshold  : 0..255 (128)
   *   brightness : -100..100 (0)
   *   contrast   : -100..100 (0)
   *   edgeBoost  : 0..100 (0)   ※threshold/outline のみ
   *   closing    : 0..3 (0)
   *   isolate    : 0..4 (0)
   *   minBlob    : 0..30 (0)
   */
  function _grayToGrid(gray, W, H, opts) {
    const {
      mode = 'threshold',
      threshold = 128, brightness = 0, contrast = 0,
      edgeBoost = 0,
      closing = 0, isolate = 0, minBlob = 0,
    } = opts;

    let grid;

    if (mode === 'adaptive') {
      const g = new Float32Array(W * H);
      for (let i = 0; i < gray.length; i++) g[i] = adjustPixel(gray[i], brightness, contrast);
      let blockSize = Math.max(5, Math.round(Math.min(W, H) * 0.2));
      if (blockSize % 2 === 0) blockSize++;
      const offset = threshold - 128;
      grid = adaptiveThreshold(g, W, H, blockSize, offset);

    } else if (mode === 'dither') {
      grid = floydSteinbergDither(gray, W, H, brightness, contrast);

    } else if (mode === 'outline') {
      grid = extractOutlines(gray, W, H, brightness, contrast, threshold);

    } else {
      // threshold（デフォルト）
      let g = applyEdgeBoost(new Float32Array(gray), W, H, edgeBoost);
      grid = [];
      for (let r = 0; r < H; r++) {
        const row = new Uint8Array(W);
        for (let c = 0; c < W; c++) {
          row[c] = adjustPixel(g[r*W+c], brightness, contrast) < threshold ? 1 : 0;
        }
        grid.push(row);
      }
    }

    // 共通後処理
    grid = closingGrid(grid, closing);
    grid = removeIsolated(grid, isolate);
    grid = removeSmallComponents(grid, minBlob);
    return grid;
  }

  // ─── 公開関数 ─────────────────────────────────────────────────

  function processGrid(img, crop, cols, rows, opts) {
    const off = document.createElement('canvas');
    off.width = cols; off.height = rows;
    const ctx = off.getContext('2d');
    ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, cols, rows);
    const { data } = ctx.getImageData(0, 0, cols, rows);
    return _grayToGrid(_toGrayF32(data, cols, rows), cols, rows, opts);
  }

  function renderPreview(img, crop, dest, opts) {
    const W = dest.width, H = dest.height;
    const ctx = dest.getContext('2d');
    ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, W, H);
    const imgData = ctx.getImageData(0, 0, W, H);
    const grid = _grayToGrid(_toGrayF32(imgData.data, W, H), W, H, opts);
    const { data } = imgData;
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const i = (r*W+c)*4;
        const bw = grid[r][c] ? 0 : 255;
        data[i] = data[i+1] = data[i+2] = bw; data[i+3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  function generateHints(grid) {
    const rows = grid.length, cols = rows > 0 ? grid[0].length : 0;
    const rowHints = grid.map(row => {
      const h = []; let cnt = 0;
      for (let c = 0; c < cols; c++) {
        if (row[c]) cnt++;
        else if (cnt) { h.push(cnt); cnt = 0; }
      }
      if (cnt) h.push(cnt);
      return h.length ? h : [0];
    });
    const colHints = [];
    for (let c = 0; c < cols; c++) {
      const h = []; let cnt = 0;
      for (let r = 0; r < rows; r++) {
        if (grid[r][c]) cnt++;
        else if (cnt) { h.push(cnt); cnt = 0; }
      }
      if (cnt) h.push(cnt);
      colHints.push(h.length ? h : [0]);
    }
    return { rowHints, colHints };
  }

  return { processGrid, renderPreview, generateHints };
})();
