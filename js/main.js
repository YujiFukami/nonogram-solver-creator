'use strict';

/**
 * main.js — アプリ統合・イベント管理
 * GridCanvas / HintInput / FileIO / NonogramSolver を接続する
 */

// ─── アプリ状態 ────────────────────────────────────────────
const App = {
  rows: 15,
  cols: 15,
  gridCanvas: null,
  hintInput: null,
  worker: null,       // 実行中の Web Worker
  solving: false,
  puzzleName: 'nonogram',
};

// ─── DOM 参照 ──────────────────────────────────────────────
const $  = id => document.getElementById(id);
const el = {
  inputRows:       $('input-rows'),
  inputCols:       $('input-cols'),
  btnApplySize:    $('btn-apply-size'),
  btnLoad:         $('btn-load'),
  btnSave:         $('btn-save'),
  btnSaveImage:    $('btn-save-image'),
  chkSaveWithHints:$('chk-save-with-hints'),
  btnSolve:        $('btn-solve'),
  btnStep:         $('btn-step'),
  btnAutoStep:     $('btn-auto-step'),
  stepInterval:    $('step-interval'),
  btnResetGrid:    $('btn-reset-grid'),
  btnClearAll:     $('btn-clear-all'),
  btnZoomIn:       $('btn-zoom-in'),
  btnZoomOut:      $('btn-zoom-out'),
  btnZoomFit:      $('btn-zoom-fit'),
  fileInput:       $('file-input'),
  colorUnknown:    $('color-unknown'),
  colorBlack:      $('color-black'),
  colorWhite:      $('color-white'),
  btnResetColors:  $('btn-reset-colors'),
  solveRateDisplay:$('solve-rate-display'),
  progressBar:     $('progress-bar'),
  statusMessage:   $('status-message'),
  loadingOverlay:  $('loading-overlay'),
  loadingLabel:    $('loading-label'),
  cellSizeDisplay: $('cell-size-display'),
  rowHintsArea:    $('row-hints-area'),
  colHintsArea:    $('col-hints-area'),
  corner:          $('corner'),
  gridCanvas:      $('grid-canvas'),
  gridWrap:        $('grid-wrap'),
  puzzleScroll:    $('puzzle-scroll'),
};

// ─── 初期化 ───────────────────────────────────────────────
function init() {
  App.rows = parseInt(el.inputRows.value, 10) || 15;
  App.cols = parseInt(el.inputCols.value, 10) || 15;

  // GridCanvas 生成
  App.gridCanvas = new GridCanvas(el.gridCanvas, {
    rows: App.rows,
    cols: App.cols,
    onCellClick: (r, c, state) => {
      // 手動編集：ソルバー未実行中のみ
    },
    onCellSizeChange: (size) => {
      el.cellSizeDisplay.textContent = (typeof I18n !== 'undefined')
        ? I18n.t('solver.cellSize', { n: size })
        : `セルサイズ: ${size}px`;
      App.hintInput.setCellSize(size);
    },
  });

  // HintInput 生成
  App.hintInput = new HintInput({
    rowContainer: el.rowHintsArea,
    colContainer: el.colHintsArea,
    inputField:   $('hint-input-field'),
    inputLabel:   $('hint-input-label'),
    inputCurrent: $('hint-input-current'),
    rows: App.rows,
    cols: App.cols,
    cellSize: App.gridCanvas.cellSize,
    onChange: (type, index, hints) => {
      // ヒント変更時の処理（必要なら即時バリデーション等）
    },
    onLayoutChange: ({ colHintHeight, rowHintWidth }) => {
      // コーナーセルをヒントエリアサイズに同期
      el.corner.style.width  = rowHintWidth + 'px';
      el.corner.style.height = colHintHeight + 'px';
    },
  });

  bindEvents();

  // サンプル問題の読み込み
  loadSamplePuzzle();

  // 言語切替時に動的テキストを更新
  document.addEventListener('langchange', () => {
    const cs = App.gridCanvas ? App.gridCanvas.cellSize : 24;
    el.cellSizeDisplay.textContent = I18n.t('solver.cellSize', { n: cs });
    // ヒント入力ラベルを再描画
    if (App.hintInput) App.hintInput._selectLine(App.hintInput._editType, App.hintInput._editIndex);
    // サンプルバナーのテキスト更新
    updateSampleBannerText();
  });
}

// ─── サンプル問題読み込み ─────────────────────────────────
function loadSamplePuzzle() {
  if (typeof SamplePuzzle === 'undefined' || !SamplePuzzle.text) {
    setStatus((typeof I18n !== 'undefined') ? I18n.t('solver.status') : '問題のヒントを入力して「解答実行」を押してください');
    return;
  }

  const result = FileIO.parseTextFile(SamplePuzzle.text);
  if (result.error) {
    setStatus((typeof I18n !== 'undefined') ? I18n.t('solver.status') : '問題のヒントを入力して「解答実行」を押してください');
    return;
  }

  const { rows, cols, rowHints, colHints } = result;

  // サイズを適用
  App.rows = rows;
  App.cols = cols;
  el.inputRows.value = rows;
  el.inputCols.value = cols;

  App.gridCanvas.resize(rows, cols);
  App.hintInput.resize(rows, cols);
  App.hintInput.setHints(rowHints, colHints);
  updateSolveRate(0);

  App.puzzleName = SamplePuzzle.name || 'sample';
  App.isSampleLoaded = true;

  // サンプルバナー表示
  showSampleBanner();

  // 自動ズームフィット
  autoZoomFit();
}

function showSampleBanner() {
  const banner = document.getElementById('sample-banner');
  if (!banner) return;
  banner.style.display = 'flex';
  updateSampleBannerText();

  // 閉じるボタン
  const closeBtn = document.getElementById('sample-banner-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      banner.style.display = 'none';
    });
  }
}

function updateSampleBannerText() {
  const textEl = document.getElementById('sample-banner-text');
  const hintEl = document.getElementById('sample-banner-hint');
  if (!App.isSampleLoaded) return;
  if (!textEl || !hintEl) return;

  const name = SamplePuzzle.name || 'Sample';
  if (typeof I18n !== 'undefined') {
    textEl.textContent = I18n.t('solver.sampleLoaded', { name });
    hintEl.textContent = I18n.t('solver.sampleClearHint');
  } else {
    textEl.textContent = `📘 サンプル問題「${name}」が読み込まれています。「▶ 解答実行」で自動解答を開始できます。`;
    hintEl.textContent = '💡 新しい問題を入力する場合は「🗑 全クリア」を押してください。';
  }
}

// ─── イベントバインド ─────────────────────────────────────
function bindEvents() {
  // サイズ適用
  el.btnApplySize.addEventListener('click', applySize);
  el.inputRows.addEventListener('keydown', e => { if (e.key === 'Enter') applySize(); });
  el.inputCols.addEventListener('keydown', e => { if (e.key === 'Enter') applySize(); });

  // ファイル操作
  el.btnLoad.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', onFileSelected);
  el.btnSave.addEventListener('click', savePuzzle);
  el.btnSaveImage.addEventListener('click', saveImage);

  // 解答
  el.btnSolve.addEventListener('click', startSolve);
  el.btnStep.addEventListener('click', () => runStep());
  el.btnAutoStep.addEventListener('click', toggleAutoStep);

  // リセット
  el.btnResetGrid.addEventListener('click', resetGrid);
  el.btnClearAll.addEventListener('click', clearAll);

  // マス色設定
  el.colorUnknown.addEventListener('input', () => App.gridCanvas.setCellColor('UNKNOWN', el.colorUnknown.value));
  el.colorBlack.addEventListener('input',   () => App.gridCanvas.setCellColor('BLACK',   el.colorBlack.value));
  el.colorWhite.addEventListener('input',   () => App.gridCanvas.setCellColor('WHITE',    el.colorWhite.value));
  el.btnResetColors.addEventListener('click', () => {
    el.colorUnknown.value = '#f0f0f0';
    el.colorBlack.value   = '#1a1a1a';
    el.colorWhite.value   = '#b2ebf2';
    App.gridCanvas.setCellColor('UNKNOWN', '#f0f0f0');
    App.gridCanvas.setCellColor('BLACK',   '#1a1a1a');
    App.gridCanvas.setCellColor('WHITE',   '#b2ebf2');
  });

  // ズーム
  el.btnZoomIn.addEventListener('click',  () => App.gridCanvas.zoomIn());
  el.btnZoomOut.addEventListener('click', () => App.gridCanvas.zoomOut());
  el.btnZoomFit.addEventListener('click', autoZoomFit);
}

// ─── 自動ズームフィット ────────────────────────────────────
/**
 * 問題全体がスクロールなく表示されるようセルサイズを自動計算。
 * DOM レイアウト確定後に測定するため requestAnimationFrame を使用。
 */
function autoZoomFit() {
  // 2パスで測定：1回目ズーム後にヒントエリアが再描画されるので2回目で正確に合わせる
  const _fit = () => {
    const scroll        = el.puzzleScroll;
    const rowHintWidth  = el.rowHintsArea.offsetWidth  || 0;
    const colHintHeight = el.colHintsArea.offsetHeight || 0;
    const availW = scroll.clientWidth  - rowHintWidth  - 2;
    const availH = scroll.clientHeight - colHintHeight - 2;
    if (availW > 10 && availH > 10) {
      App.gridCanvas.zoomFit(availW, availH);
    }
  };
  requestAnimationFrame(() => {
    _fit();                          // 1パス目（ヒントエリアが旧サイズ）
    requestAnimationFrame(_fit);     // 2パス目（ヒントエリアが新セルサイズに合わせ再描画後）
  });
}

// ─── サイズ変更 ────────────────────────────────────────────
function applySize() {
  const newRows = parseInt(el.inputRows.value, 10);
  const newCols = parseInt(el.inputCols.value, 10);

  if (isNaN(newRows) || newRows < 1 || newRows > 300 ||
      isNaN(newCols) || newCols < 1 || newCols > 300) {
    setStatus('サイズは 1〜300 の範囲で入力してください', 'error');
    return;
  }

  if (newRows === App.rows && newCols === App.cols) return;

  if (!confirm(`サイズを ${newRows}×${newCols} に変更すると\n現在のデータがリセットされます。よろしいですか？`)) {
    el.inputRows.value = App.rows;
    el.inputCols.value = App.cols;
    return;
  }

  App.rows = newRows;
  App.cols = newCols;

  App.gridCanvas.resize(newRows, newCols);
  App.hintInput.resize(newRows, newCols);
  App.hintInput.setCellSize(App.gridCanvas.cellSize);
  updateSolveRate(0);
  setStatus(`サイズを ${newRows}×${newCols} に変更しました`);
}

// ─── ファイル読み込み ─────────────────────────────────────
async function onFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  el.fileInput.value = ''; // 同じファイルを再選択できるようにリセット

  setStatus('読み込み中...', '');
  const result = await FileIO.readTextFile(file);

  if (result.error) {
    setStatus(`読み込みエラー: ${result.error}`, 'error');
    return;
  }

  const { rows, cols, rowHints, colHints } = result;

  // サイズを適用
  App.rows = rows;
  App.cols = cols;
  el.inputRows.value = rows;
  el.inputCols.value = cols;

  App.gridCanvas.resize(rows, cols);
  App.hintInput.resize(rows, cols);
  App.hintInput.setHints(rowHints, colHints);
  updateSolveRate(0);

  // ファイル名（拡張子なし）を記憶
  App.puzzleName = file.name.replace(/\.[^.]+$/, '');
  setStatus(`「${App.puzzleName}」を読み込みました (${rows}×${cols})`, 'success');

  // 問題全体が見えるよう自動ズームフィット
  autoZoomFit();
}

// ─── 問題保存 ──────────────────────────────────────────────
function savePuzzle() {
  const rowHints = App.hintInput.getRowHints();
  const colHints = App.hintInput.getColHints();
  const content  = FileIO.generateTextFile(App.rows, App.cols, rowHints, colHints);
  FileIO.downloadTextFile(content, App.puzzleName + '.txt');
  setStatus(`「${App.puzzleName}.txt」として保存しました`, 'success');
}

// ─── 画像保存 ──────────────────────────────────────────────
function saveImage() {
  const name = App.puzzleName || 'nonogram';
  if (el.chkSaveWithHints && el.chkSaveWithHints.checked) {
    // ヒント数字込みの画像を生成してダウンロード
    const rowHints = App.hintInput.getRowHints();
    const colHints = App.hintInput.getColHints();
    const dataUrl  = _renderPuzzleWithHints(rowHints, colHints, App.gridCanvas.grid);
    const a = document.createElement('a');
    a.href = dataUrl; a.download = name + '-with-hints.png'; a.click();
  } else {
    App.gridCanvas.downloadAsPNG(name + '.png');
  }
  setStatus('画像を保存しました', 'success');
}

/**
 * ヒント数字＋グリッド状態を1枚の canvas に描いて dataURL を返す
 * grid: 2D array of UNKNOWN(-1) / WHITE(0) / BLACK(1)
 */
function _renderPuzzleWithHints(rowHints, colHints, grid) {
  const rows = rowHints.length;
  const cols = colHints.length;
  if (!rows || !cols) return '';

  const maxColDepth = Math.max(...colHints.map(h => h.length), 1);
  const maxRowDepth = Math.max(...rowHints.map(h => h.length), 1);

  // セルサイズ自動計算（最大 2000×2000px 相当に収める）
  const tentW = (1600 - maxRowDepth * 14) / cols;
  const tentH = (1600 - maxColDepth * 16) / rows;
  const cs    = Math.max(8, Math.min(32, Math.floor(Math.min(tentW, tentH))));

  const fs     = Math.max(7, Math.min(13, Math.floor(cs * 0.65)));
  const cellHH = fs + 4;
  const cellHW = fs + 6;
  const colHintH = maxColDepth * cellHH;
  const rowHintW = maxRowDepth * cellHW;

  const W = rowHintW + cols * cs + 1;
  const H = colHintH + rows * cs + 1;

  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // 背景
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  // グリッドセル（解答状態を描画）
  const gx = rowHintW, gy = colHintH;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = grid && grid[r] ? grid[r][c] : -1;
      if (v === 1)  ctx.fillStyle = '#1a1a1a';        // 黒マス
      else if (v === 0) ctx.fillStyle = '#b2ebf2';    // 白確定
      else ctx.fillStyle = '#f8f8f8';                  // 未確定
      ctx.fillRect(gx + c * cs, gy + r * cs, cs, cs);
    }
  }

  // ヒントエリア背景
  ctx.fillStyle = '#e8f0fe';
  ctx.fillRect(0, gy, rowHintW, rows * cs);   // 左帯
  ctx.fillRect(gx, 0, cols * cs, colHintH);   // 上帯
  ctx.fillStyle = '#c7d9fd';
  ctx.fillRect(0, 0, rowHintW, colHintH);     // 左上コーナー

  // 列ヒント
  ctx.font = `bold ${fs}px sans-serif`;
  ctx.fillStyle = '#222';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let c = 0; c < cols; c++) {
    const h = colHints[c];
    const x = gx + c * cs + cs / 2;
    for (let i = 0; i < h.length; i++) {
      const y = (maxColDepth - h.length + i) * cellHH + cellHH / 2;
      ctx.fillText(String(h[i]), x, y);
    }
  }

  // 行ヒント
  ctx.textAlign = 'right';
  for (let r = 0; r < rows; r++) {
    const h = rowHints[r];
    const y = gy + r * cs + cs / 2;
    for (let i = 0; i < h.length; i++) {
      const x = (maxRowDepth - h.length + i + 1) * cellHW;
      ctx.fillText(String(h[i]), x, y);
    }
  }

  // グリッド線（問題エリア）
  for (let r = 0; r <= rows; r++) {
    ctx.lineWidth   = r % 5 === 0 ? 1.5 : 0.5;
    ctx.strokeStyle = '#888';
    ctx.beginPath(); ctx.moveTo(gx, gy + r * cs); ctx.lineTo(gx + cols * cs, gy + r * cs); ctx.stroke();
  }
  for (let c = 0; c <= cols; c++) {
    ctx.lineWidth   = c % 5 === 0 ? 1.5 : 0.5;
    ctx.strokeStyle = '#888';
    ctx.beginPath(); ctx.moveTo(gx + c * cs, gy); ctx.lineTo(gx + c * cs, gy + rows * cs); ctx.stroke();
  }

  // ヒント領域のグリッド線（行ヒント左帯: 各行の区切り線）
  ctx.strokeStyle = '#93c5fd';
  for (let r = 0; r <= rows; r++) {
    ctx.lineWidth = r % 5 === 0 ? 1.2 : 0.4;
    ctx.beginPath(); ctx.moveTo(0, gy + r * cs); ctx.lineTo(gx, gy + r * cs); ctx.stroke();
  }
  // 行ヒント帯の各数字列の縦区切り
  ctx.lineWidth = 0.4;
  for (let d = 0; d <= maxRowDepth; d++) {
    ctx.beginPath(); ctx.moveTo(d * cellHW, gy); ctx.lineTo(d * cellHW, gy + rows * cs); ctx.stroke();
  }

  // 列ヒント上帯: 各列の区切り線
  for (let c = 0; c <= cols; c++) {
    ctx.lineWidth = c % 5 === 0 ? 1.2 : 0.4;
    ctx.beginPath(); ctx.moveTo(gx + c * cs, 0); ctx.lineTo(gx + c * cs, gy); ctx.stroke();
  }
  // 列ヒント帯の各数字行の横区切り
  ctx.lineWidth = 0.4;
  for (let d = 0; d <= maxColDepth; d++) {
    ctx.beginPath(); ctx.moveTo(gx, d * cellHH); ctx.lineTo(gx + cols * cs, d * cellHH); ctx.stroke();
  }

  // 外枠・ヒント境界
  ctx.lineWidth = 2; ctx.strokeStyle = '#333';
  ctx.strokeRect(gx, gy, cols * cs, rows * cs);
  ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(gx, gy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, gy); ctx.stroke();

  return canvas.toDataURL('image/png');
}

// ─── 自動解答（Web Worker） ───────────────────────────────
function startSolve() {
  if (App.solving) return;

  const rowHints = App.hintInput.getRowHints();
  const colHints = App.hintInput.getColHints();

  // バリデーション
  if (!validateHints(rowHints, colHints)) return;

  // グリッドをリセット（初期化）
  App.gridCanvas.reset();
  updateSolveRate(0);

  App.solving = true;
  setSolveUI(true);
  setStatus('解答中...', '');
  showLoading(true, '解答中...');

  // Web Worker を使用（ファイルプロトコルでは動作しない場合 → fallback）
  try {
    startSolveWorker(rowHints, colHints);
  } catch (e) {
    // Web Worker が使えない環境（file://等）ではメインスレッドで実行
    startSolveSync(rowHints, colHints);
  }
}

function startSolveWorker(rowHints, colHints) {
  if (App.worker) App.worker.terminate();

  App.worker = new Worker('js/solver-worker.js');

  App.worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'progress') {
      updateSolveRate(msg.solveRate);
      el.loadingLabel.textContent = `解答中... ${Math.round(msg.solveRate * 100)}%`;
    } else if (msg.type === 'done') {
      finishSolve(msg);
    } else if (msg.type === 'cancelled') {
      showLoading(false);
      setSolveUI(false);
      App.solving = false;
      setStatus('解答をキャンセルしました');
    } else if (msg.type === 'error') {
      showLoading(false);
      setSolveUI(false);
      App.solving = false;
      setStatus(`エラー: ${msg.message}`, 'error');
    }
  };

  App.worker.onerror = (e) => {
    // Worker エラー → メインスレッドで再試行
    App.worker = null;
    startSolveSync(rowHints, colHints);
  };

  App.worker.postMessage({ type: 'solve', rowHints, colHints });
}

function startSolveSync(rowHints, colHints) {
  // メインスレッドでの実行（Web Workerが使えない場合）
  // UIをブロックするが動作はする
  setTimeout(() => {
    try {
      const solver = new NonogramSolver(rowHints, colHints);
      solver.setProgressCallback(({ solveRate }) => {
        updateSolveRate(solveRate);
      });
      const result = solver.solve();
      finishSolve(result);
    } catch (e) {
      showLoading(false);
      setSolveUI(false);
      App.solving = false;
      setStatus(`エラー: ${e.message}`, 'error');
    }
  }, 10);
}

function finishSolve(result) {
  App.solving = false;
  showLoading(false);
  setSolveUI(false);

  if (App.worker) { App.worker.terminate(); App.worker = null; }

  // グリッドに反映
  App.gridCanvas.setGrid(result.grid);
  updateSolveRate(result.solveRate);

  if (result.contradiction) {
    setStatus(`矛盾を検出しました（ヒントを確認してください）`, 'error');
  } else if (result.solved) {
    setStatus(`解答完了！ (${result.iterations}パス)`, 'success');
  } else {
    const pct = Math.round(result.solveRate * 100);
    setStatus(`解答一部完了: ${pct}% 確定 (${result.iterations}パス)`, '');
  }
}

function cancelSolve() {
  if (App.worker) {
    App.worker.postMessage({ type: 'cancel' });
  }
}

// ─── ステップ実行 ──────────────────────────────────────────
let _stepSolver  = null;
let _stepStuck   = 0;     // 連続停滞カウント
let _autoTimer   = null;  // 自動ステップ用タイマー
let _autoRunning = false;

/** ソルバーを初期化して true を返す。バリデーション失敗時 false */
function _initStepSolver() {
  const rowHints = App.hintInput.getRowHints();
  const colHints = App.hintInput.getColHints();
  if (!validateHints(rowHints, colHints)) return false;
  App.gridCanvas.reset();
  _stepSolver = new NonogramSolver(rowHints, colHints);
  _stepStuck  = 0;
  updateSolveRate(0);
  return true;
}

/**
 * 1ステップ実行。完了・矛盾・停滞で true（終了）、継続中は false を返す。
 */
function runStep() {
  if (App.solving) return true;

  // 初回
  if (_stepSolver === null) {
    if (!_initStepSolver()) return true;
  }

  const resolved = _stepSolver.step();

  if (resolved === -1) {
    App.gridCanvas.setGrid(_stepSolver.grid);
    updateSolveRate(_stepSolver.solveRate());
    setStatus('矛盾を検出しました', 'error');
    _finishStep();
    return true;
  }

  App.gridCanvas.setGrid(_stepSolver.grid);
  updateSolveRate(_stepSolver.solveRate());

  if (_stepSolver.isSolved()) {
    setStatus(`解答完了！ (${Math.round(_stepSolver.solveRate() * 100)}%)`, 'success');
    _finishStep();
    return true;
  }

  if (resolved === 0) {
    // 停滞 → 詰め処理
    const intensive = _stepSolver.intensiveStep();
    App.gridCanvas.setGrid(_stepSolver.grid);
    updateSolveRate(_stepSolver.solveRate());

    if (intensive === -1) {
      setStatus('矛盾を検出しました', 'error');
      _finishStep();
      return true;
    }

    if (_stepSolver.isSolved()) {
      setStatus(`解答完了！ (${Math.round(_stepSolver.solveRate() * 100)}%)`, 'success');
      _finishStep();
      return true;
    }

    if (intensive === 0) {
      _stepStuck++;
      if (_stepStuck >= 2) {
        const pct = Math.round(_stepSolver.solveRate() * 100);
        setStatus(`進展なし（${pct}% 確定）`);
        _finishStep();
        return true;
      }
    } else {
      _stepStuck = 0;
      setStatus(`詰め処理: ${intensive}マス確定 (${Math.round(_stepSolver.solveRate() * 100)}%)`);
    }
  } else {
    _stepStuck = 0;
    setStatus(`${resolved}マス確定 (${Math.round(_stepSolver.solveRate() * 100)}%)`);
  }

  return false; // 継続中
}

/** ステップ終了後の後片付け */
function _finishStep() {
  _stepSolver  = null;
  _stepStuck   = 0;
  stopAutoStep();
}

// ─── 自動ステップ ─────────────────────────────────────────

function toggleAutoStep() {
  if (_autoRunning) {
    stopAutoStep();
  } else {
    startAutoStep();
  }
}

function startAutoStep() {
  if (App.solving || _autoRunning) return;
  _autoRunning = true;
  el.btnAutoStep.textContent = '自動ステップ ■';
  el.btnAutoStep.classList.add('btn-primary');
  el.btnAutoStep.classList.remove('btn-secondary');
  el.btnStep.disabled = true;
  el.btnSolve.disabled = true;

  const interval = Math.max(50, parseInt(el.stepInterval.value, 10) || 200);

  const tick = () => {
    if (!_autoRunning) return;
    const done = runStep();
    if (done) {
      stopAutoStep();
    } else {
      _autoTimer = setTimeout(tick, interval);
    }
  };
  tick();
}

function stopAutoStep() {
  _autoRunning = false;
  if (_autoTimer) { clearTimeout(_autoTimer); _autoTimer = null; }
  el.btnAutoStep.textContent = '自動ステップ ▶';
  el.btnAutoStep.classList.remove('btn-primary');
  el.btnAutoStep.classList.add('btn-secondary');
  el.btnStep.disabled = false;
  el.btnSolve.disabled = false;
}

// ─── リセット ─────────────────────────────────────────────
function resetGrid() {
  stopAutoStep();
  _stepSolver = null;
  App.gridCanvas.reset();
  updateSolveRate(0);
  setStatus('グリッドをリセットしました');
}

function clearAll() {
  if (!confirm('ヒントを含むすべてのデータをクリアします。よろしいですか？')) return;
  stopAutoStep();
  _stepSolver = null;
  App.gridCanvas.reset();
  App.hintInput.clearAll();
  updateSolveRate(0);
  App.puzzleName = 'nonogram';
  App.isSampleLoaded = false;
  // サンプルバナーを非表示
  const banner = document.getElementById('sample-banner');
  if (banner) banner.style.display = 'none';
  setStatus('データをクリアしました');
}

// ─── バリデーション ────────────────────────────────────────
function validateHints(rowHints, colHints) {
  // 行ヒントの合計 vs 列ヒントの合計が一致するかチェック
  const rowSum = rowHints.reduce((s, h) => s + h.reduce((a, b) => a + b, 0), 0);
  const colSum = colHints.reduce((s, h) => s + h.reduce((a, b) => a + b, 0), 0);

  if (rowSum !== colSum) {
    setStatus(`ヒントの合計が一致しません（行: ${rowSum}, 列: ${colSum}）`, 'error');
    return false;
  }

  // 各行ヒントの合計がマス数を超えないかチェック
  for (let r = 0; r < App.rows; r++) {
    const h = rowHints[r];
    const needed = h.reduce((s, v) => s + v, 0) + Math.max(0, h.length - 1);
    if (needed > App.cols) {
      setStatus(`行${r + 1} のヒント合計がマス数(${App.cols})を超えています`, 'error');
      return false;
    }
  }

  // 各列ヒントの合計がマス数を超えないかチェック
  for (let c = 0; c < App.cols; c++) {
    const h = colHints[c];
    const needed = h.reduce((s, v) => s + v, 0) + Math.max(0, h.length - 1);
    if (needed > App.rows) {
      setStatus(`列${c + 1} のヒント合計がマス数(${App.rows})を超えています`, 'error');
      return false;
    }
  }

  return true;
}

// ─── UI ヘルパー ──────────────────────────────────────────
function setSolveUI(solving) {
  el.btnSolve.disabled     = solving;
  el.btnStep.disabled      = solving;
  el.btnAutoStep.disabled  = solving;
  if (solving) stopAutoStep();
}

function showLoading(visible, label = '解答中...') {
  el.loadingOverlay.classList.toggle('visible', visible);
  el.loadingLabel.textContent = label;
}

function updateSolveRate(rate) {
  const pct = Math.round(rate * 100);
  const label = (typeof I18n !== 'undefined') ? I18n.t('app.solveRate') : '解決率:';
  el.solveRateDisplay.textContent = `${label} ${pct}%`;
  el.progressBar.style.width = pct + '%';
}

function setStatus(message, type = '') {
  el.statusMessage.textContent = message;
  el.statusMessage.className = type ? `status-${type}` : '';
  // CSS クラスで色を制御
  el.statusMessage.style.color =
    type === 'error'   ? 'var(--color-danger)'  :
    type === 'success' ? 'var(--color-success)' :
    'var(--color-muted)';
}

// ─── 起動 ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
