'use strict';

/**
 * solver.js — イラストロジック（ノノグラム）ソルバー v2
 *
 * VBA版のアルゴリズムを忠実に移植:
 *   cls数字       → lineSolve 内のパターン列挙 + canBeBlack/canBeWhite
 *   cls1ライン解答 → lineSolve (制約伝播) + intensiveLineSolve (詰め処理)
 *   cls全体解      → NonogramSolver クラス
 *   Mod01_解答処理 → NonogramSolver.solve()
 *
 * 重要: VBA版は再帰的バックトラックを行わない。
 *        詰め処理はライン単位の「仮定→矛盾チェック→共通解抽出」。
 */

// マス状態定数
const UNKNOWN = -1;
const WHITE   =  0;
const BLACK   =  1;

// ─────────────────────────────────────────────────────────────
// ラインソルバー（1行/1列の制約伝播）
// VBA版 cls1ライン解答.F_追加解 + cls数字 に相当
// ─────────────────────────────────────────────────────────────

/**
 * 1本のラインを解いて確定マスを増やす（基本制約伝播・DP版）。
 *
 * Forward/Backward DP により各ブロックの有効配置範囲を算出し、
 * canBeBlack/canBeWhite を O(n×m) で決定する。
 *
 * @param {number[]} hints  ヒント数字配列（例: [3, 1, 2]）
 * @param {number[]} line   現在のマス状態配列
 * @returns {number[]|null} 更新後のマス状態配列。矛盾時 null。
 */
function lineSolve(hints, line) {
  const n = line.length;

  // ヒントなし → すべて白
  const effectiveHints = hints.filter(h => h > 0);
  if (effectiveHints.length === 0) {
    if (line.some(c => c === BLACK)) return null;
    return new Array(n).fill(WHITE);
  }

  const m = effectiveHints.length;

  // 必要最小セル数チェック
  const minNeeded = effectiveHints.reduce((s, h) => s + h, 0) + (m - 1);
  if (minNeeded > n) return null;

  // WHITE セルの累積和（範囲内に WHITE があるか O(1) 判定）
  const prefW = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) prefW[i + 1] = prefW[i] + (line[i] === WHITE ? 1 : 0);
  const noWhite = (a, b) => prefW[b] === prefW[a]; // [a, b) に WHITE なし

  // ── Forward DP ──
  // fwd[j][i] = ブロック 0..j-1 を配置済み、次の空き位置が i
  const fwd = [];
  for (let j = 0; j <= m; j++) fwd.push(new Uint8Array(n + 1));

  fwd[0][0] = 1;
  for (let j = 0; j <= m; j++) {
    // ギャップ拡張（WHITE 互換セルをスキップ）
    for (let i = 0; i < n; i++) {
      if (fwd[j][i] && line[i] !== BLACK) fwd[j][i + 1] = 1;
    }
    // ブロック j を配置
    if (j < m) {
      const h = effectiveHints[j];
      for (let i = 0; i <= n - h; i++) {
        if (!fwd[j][i]) continue;
        if (!noWhite(i, i + h)) continue;
        const after = i + h;
        if (after === n) {
          fwd[j + 1][n] = 1;
        } else if (line[after] !== BLACK) {
          fwd[j + 1][after + 1] = 1;
        }
      }
    }
  }

  if (!fwd[m][n]) return null; // 有効な配置なし

  // ── Backward DP ──
  // bwd[j][i] = ブロック j..m-1 をセル i..n-1 に配置可能
  const bwd = [];
  for (let j = 0; j <= m; j++) bwd.push(new Uint8Array(n + 1));

  bwd[m][n] = 1;
  for (let j = m; j >= 0; j--) {
    // ギャップ拡張（右→左）
    for (let i = n - 1; i >= 0; i--) {
      if (bwd[j][i + 1] && line[i] !== BLACK) bwd[j][i] = 1;
    }
    // ブロック j-1 を配置（逆方向）
    if (j > 0) {
      const h = effectiveHints[j - 1];
      for (let i = n - h; i >= 0; i--) {
        if (!noWhite(i, i + h)) continue;
        const after = i + h;
        let ok = false;
        if (after === n) {
          ok = !!bwd[j][n];
        } else if (line[after] !== BLACK) {
          ok = !!bwd[j][after + 1];
        }
        if (ok) bwd[j - 1][i] = 1;
      }
    }
  }

  // ── canBeBlack / canBeWhite 判定 ──
  const canBeBlack = new Uint8Array(n);
  const canBeWhite = new Uint8Array(n);

  // canBeWhite: セル i がギャップ（ブロック間/前/後の白マス）
  for (let i = 0; i < n; i++) {
    if (line[i] === BLACK) continue;
    for (let j = 0; j <= m; j++) {
      if (fwd[j][i] && bwd[j][i + 1]) { canBeWhite[i] = 1; break; }
    }
  }

  // canBeBlack: セル i がブロック j（開始位置 s）の一部
  for (let j = 0; j < m; j++) {
    const h = effectiveHints[j];
    for (let s = 0; s <= n - h; s++) {
      if (!fwd[j][s]) continue;
      if (!noWhite(s, s + h)) continue;
      const after = s + h;
      let ok = false;
      if (after === n) {
        ok = !!bwd[j + 1][n];
      } else if (line[after] !== BLACK) {
        ok = !!bwd[j + 1][after + 1];
      }
      if (ok) {
        for (let k = s; k < s + h; k++) canBeBlack[k] = 1;
        // ブロック直後の必須ギャップも白マスとして記録
        if (after < n) canBeWhite[after] = 1;
      }
    }
  }

  // 結果生成
  const result = line.slice();
  for (let i = 0; i < n; i++) {
    if (line[i] !== UNKNOWN) continue;
    if (canBeBlack[i] && !canBeWhite[i])      result[i] = BLACK;
    else if (!canBeBlack[i] && canBeWhite[i])  result[i] = WHITE;
    else if (!canBeBlack[i] && !canBeWhite[i]) return null; // 矛盾
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// 詰め処理（ライン単位の仮定→矛盾チェック→共通解抽出）
// VBA版 cls1ライン解答.F_追加解_詰め処理 に相当
// ─────────────────────────────────────────────────────────────

/**
 * 通常の lineSolve では進展しないラインに対して、
 * 各未確定マスを BLACK/WHITE に仮定して lineSolve を実行し、
 * 矛盾するなら逆の状態を確定、両方有効なら共通解を抽出する。
 *
 * @param {number[]} hints  ヒント数字配列
 * @param {number[]} line   現在のマス状態配列
 * @returns {number[]|null} 更新後のマス状態配列。矛盾時 null。
 */
function intensiveLineSolve(hints, line) {
  const n = line.length;
  const result = line.slice();

  // まず通常の lineSolve を実行
  const base = lineSolve(hints, result);
  if (base === null) return null;

  // 通常の結果を反映
  for (let i = 0; i < n; i++) {
    if (result[i] === UNKNOWN && base[i] !== UNKNOWN) {
      result[i] = base[i];
    }
  }

  // 未確定マスのインデックスを収集
  const unknowns = [];
  for (let i = 0; i < n; i++) {
    if (result[i] === UNKNOWN) unknowns.push(i);
  }

  if (unknowns.length === 0) return result;

  // 既知のセルに隣接する未確定マスを優先的にプローブ
  // （VBA版の「推理元となる黒マス」に相当する効率化）
  const probeOrder = unknowns.filter(i => {
    if (i > 0 && result[i - 1] !== UNKNOWN) return true;
    if (i < n - 1 && result[i + 1] !== UNKNOWN) return true;
    return false;
  });
  // 隣接マスがなければ全部
  const toProbe = probeOrder.length > 0 ? probeOrder : unknowns;

  let changed = false;

  for (const idx of toProbe) {
    if (result[idx] !== UNKNOWN) continue; // 途中で確定した場合スキップ

    // BLACK を仮定
    const tryB = result.slice();
    tryB[idx] = BLACK;
    const resultB = lineSolve(hints, tryB);

    // WHITE を仮定
    const tryW = result.slice();
    tryW[idx] = WHITE;
    const resultW = lineSolve(hints, tryW);

    if (resultB === null && resultW === null) {
      return null; // 矛盾
    }

    if (resultB === null) {
      // BLACK が矛盾 → WHITE 確定
      result[idx] = WHITE;
      changed = true;
      continue;
    }

    if (resultW === null) {
      // WHITE が矛盾 → BLACK 確定
      result[idx] = BLACK;
      changed = true;
      continue;
    }

    // 両方有効 → 共通解を抽出
    for (let j = 0; j < n; j++) {
      if (result[j] !== UNKNOWN) continue;
      if (resultB[j] !== UNKNOWN && resultB[j] === resultW[j]) {
        result[j] = resultB[j];
        changed = true;
      }
    }
  }

  // 変更があった場合、もう一度 lineSolve で伝播
  if (changed) {
    const final = lineSolve(hints, result);
    if (final === null) return null;
    for (let i = 0; i < n; i++) {
      if (result[i] === UNKNOWN && final[i] !== UNKNOWN) {
        result[i] = final[i];
      }
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// メインソルバー（パズル全体）
// VBA版 cls全体解 + Mod01_解答処理 に相当
// ─────────────────────────────────────────────────────────────

class NonogramSolver {
  constructor(rowHints, colHints) {
    this.rowHints = rowHints;
    this.colHints = colHints;
    this.rows = rowHints.length;
    this.cols = colHints.length;
    this.grid = Array.from({ length: this.rows },
      () => new Array(this.cols).fill(UNKNOWN));
    this.contradiction = false;
    this._onProgress = null;
  }

  setProgressCallback(fn) { this._onProgress = fn; }
  setGrid(grid) { this.grid = grid.map(row => [...row]); }

  solveRate() {
    let known = 0;
    const total = this.rows * this.cols;
    for (const row of this.grid)
      for (const c of row) if (c !== UNKNOWN) known++;
    return known / total;
  }

  isSolved() {
    return this.grid.every(row => row.every(c => c !== UNKNOWN));
  }

  /**
   * 1パス実行（VBA版: cls全体解.S_追加解）
   * 列→行の順（VBA版と同じ）
   * @returns {number} 確定マス数。矛盾時 -1。
   */
  step() {
    let resolved = 0;

    // 全列を解く（VBA版は縦が先）
    for (let c = 0; c < this.cols; c++) {
      const col = this.grid.map(row => row[c]);
      const newCol = lineSolve(this.colHints[c], col);
      if (newCol === null) { this.contradiction = true; return -1; }
      for (let r = 0; r < this.rows; r++) {
        if (this.grid[r][c] === UNKNOWN && newCol[r] !== UNKNOWN) {
          this.grid[r][c] = newCol[r];
          resolved++;
        }
      }
    }

    // 全行を解く
    for (let r = 0; r < this.rows; r++) {
      const newRow = lineSolve(this.rowHints[r], this.grid[r]);
      if (newRow === null) { this.contradiction = true; return -1; }
      for (let c = 0; c < this.cols; c++) {
        if (this.grid[r][c] === UNKNOWN && newRow[c] !== UNKNOWN) {
          this.grid[r][c] = newRow[c];
          resolved++;
        }
      }
    }

    return resolved;
  }

  /**
   * 詰め処理パス（VBA版: cls全体解.S_追加解_詰め処理）
   * 各ラインに intensiveLineSolve を適用
   * @returns {number} 確定マス数。矛盾時 -1。
   */
  intensiveStep() {
    let resolved = 0;

    // 全列
    for (let c = 0; c < this.cols; c++) {
      const col = this.grid.map(row => row[c]);

      // 未確定マスがあるラインのみ
      if (col.every(v => v !== UNKNOWN)) continue;

      const newCol = intensiveLineSolve(this.colHints[c], col);
      if (newCol === null) { this.contradiction = true; return -1; }
      for (let r = 0; r < this.rows; r++) {
        if (this.grid[r][c] === UNKNOWN && newCol[r] !== UNKNOWN) {
          this.grid[r][c] = newCol[r];
          resolved++;
        }
      }
    }

    // 全行
    for (let r = 0; r < this.rows; r++) {
      if (this.grid[r].every(v => v !== UNKNOWN)) continue;

      const newRow = intensiveLineSolve(this.rowHints[r], this.grid[r]);
      if (newRow === null) { this.contradiction = true; return -1; }
      for (let c = 0; c < this.cols; c++) {
        if (this.grid[r][c] === UNKNOWN && newRow[c] !== UNKNOWN) {
          this.grid[r][c] = newRow[c];
          resolved++;
        }
      }
    }

    return resolved;
  }

  /**
   * 完全解答（VBA版: Mod01_解答処理.S_解答処理全体 のメインループ）
   *
   * 処理フロー:
   *   1. 通常伝播 (step) をループ
   *   2. 停滞したら詰め処理 (intensiveStep) を1回実行
   *   3. 2回連続停滞で終了（解けない）
   *
   * @param {number} [maxIterations=500]
   */
  solve(maxIterations = 500) {
    let iterations = 0;
    let stuckCount = 0;

    while (!this.isSolved() && !this.contradiction && iterations < maxIterations) {
      const resolved = this.step();
      iterations++;

      if (this._onProgress) {
        this._onProgress({ solveRate: this.solveRate(), iterations });
      }

      if (resolved === -1) break; // 矛盾

      if (resolved === 0) {
        stuckCount++;

        if (stuckCount >= 2) {
          // 2回連続停滞 → 解けない（VBA版と同じ終了条件）
          break;
        }

        // 詰め処理（VBA版: S_追加解_詰め処理）
        const intensiveResolved = this.intensiveStep();

        if (this._onProgress) {
          this._onProgress({ solveRate: this.solveRate(), iterations });
        }

        if (intensiveResolved === -1) break;

        if (intensiveResolved > 0) {
          // 詰め処理で進展あり → 通常伝播に戻る
          stuckCount = 0;
        }
        // intensiveResolved === 0 → 次のループで stuckCount が 2 になり終了
      } else {
        stuckCount = 0;
      }
    }

    return {
      grid: this.grid,
      solved: this.isSolved(),
      contradiction: this.contradiction,
      iterations,
      solveRate: this.solveRate(),
    };
  }

  cloneGrid() {
    return this.grid.map(row => [...row]);
  }
}

// ─────────────────────────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────────────────────────

function parseHints(str) {
  return str.trim().split(/[\s,]+/)
    .map(s => parseInt(s, 10))
    .filter(n => !isNaN(n) && n > 0);
}

function hintsToString(hints) {
  if (!hints || hints.length === 0) return '';
  return hints.join(' ');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { UNKNOWN, WHITE, BLACK, lineSolve, intensiveLineSolve, NonogramSolver, parseHints, hintsToString };
}
