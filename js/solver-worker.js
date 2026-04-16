'use strict';

/**
 * solver-worker.js — Web Worker エントリポイント
 * UIスレッドをブロックせずにソルバーを実行する
 *
 * メッセージプロトコル:
 *   受信: { type: 'solve',   rowHints, colHints, grid? }
 *   受信: { type: 'cancel' }
 *   送信: { type: 'progress', solveRate, iterations }
 *   送信: { type: 'done',    grid, solved, contradiction, iterations, solveRate }
 *   送信: { type: 'error',   message }
 */

// solver.js を importScripts で読み込む
importScripts('./solver.js');

let _cancelled = false;

self.onmessage = function (e) {
  const msg = e.data;

  if (msg.type === 'cancel') {
    _cancelled = true;
    return;
  }

  if (msg.type === 'solve') {
    _cancelled = false;
    try {
      runSolver(msg);
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  }
};

function runSolver(msg) {
  const { rowHints, colHints, grid } = msg;

  const solver = new NonogramSolver(rowHints, colHints);

  if (grid) {
    solver.setGrid(grid);
  }

  // 進捗コールバック
  solver.setProgressCallback(({ solveRate, iterations }) => {
    self.postMessage({ type: 'progress', solveRate, iterations });

    // キャンセル要求があれば例外で脱出（Worker内での唯一の中断手段）
    if (_cancelled) throw new Error('CANCELLED');
  });

  let result;
  try {
    result = solver.solve();
  } catch (err) {
    if (err.message === 'CANCELLED') {
      self.postMessage({ type: 'cancelled' });
      return;
    }
    throw err;
  }

  self.postMessage({
    type: 'done',
    grid:          result.grid,
    solved:        result.solved,
    contradiction: result.contradiction,
    iterations:    result.iterations,
    solveRate:     result.solveRate,
  });
}
