'use strict';

/**
 * qr-creator.js — QRコード → ノノグラム変換タブ
 */
const QrCreator = (() => {

  // ─── 状態 ──────────────────────────────────────────────
  let _qrGrid  = null;  // Uint8Array[] 二値グリッド
  let _hints   = null;  // { rowHints, colHints }
  let _gridEditor = null;
  let _lastSolverResult = null;  // 検証結果（未解決部分追加用）
  let _validating       = false; // 検証実行中フラグ
  let _cancelValidation = false; // キャンセル要求フラグ

  // ─── DOM 参照 ──────────────────────────────────────────
  const $q = id => document.getElementById(id);
  let el = {};

  // ─── 初期化 ───────────────────────────────────────────
  function init() {
    el = {
      urlInput:      $q('qr-url-input'),
      generateBtn:   $q('qr-generate-btn'),
      ecBtns:        document.querySelectorAll('input[name="qr-ec"]'),
      quietZone:     $q('qr-quiet-zone'),
      diagBridge:    $q('qr-diag-bridge'),
      diagSize:      $q('qr-diag-size'),
      diagSizeRow:   $q('qr-diag-size-row'),
      borderFill:    $q('qr-border-fill'),
      noiseEnabled:   $q('qr-noise-enabled'),
      noisePct:       $q('qr-noise-pct'),
      noiseRow:       $q('qr-noise-row'),
      btnValidate:    $q('qr-btn-validate'),
      validateColor:  $q('qr-validate-color'),
      validateResult: $q('qr-validate-result'),
      puzzleName:    $q('qr-puzzle-name'),
      sendBtn:       $q('qr-send-btn'),
      saveBtn:       $q('qr-save-btn'),
      printBtn:      $q('qr-print-btn'),
      btnFillUnsolved:   $q('qr-btn-fill-unsolved'),
      fillPct:           $q('qr-fill-pct'),
      btnValidateCancel: $q('qr-btn-validate-cancel'),
      validateProgress:  $q('qr-validate-progress'),
      validateBar:       $q('qr-validate-bar'),
      validatePct:       $q('qr-validate-pct'),
      qrCanvas:      $q('qr-preview-canvas'),
      infoText:      $q('qr-info-text'),
      gridWrap:      $q('qr-grid-wrap'),
    };

    el.generateBtn.addEventListener('click', generate);
    el.urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') generate(); });
    el.sendBtn.addEventListener('click', sendToSolver);
    el.saveBtn.addEventListener('click', saveAsTxt);
    el.printBtn.addEventListener('click', () => {
      const hints = _gridEditor ? _gridEditor.getHints() : _hints;
      if (!hints) return;
      const name = el.puzzleName.value.trim() || 'qr-nonogram';
      PrintPuzzle.open(hints.rowHints, hints.colHints, name);
    });

    // スライダー等変更時に自動再生成
    el.ecBtns.forEach(btn => btn.addEventListener('change', () => { if (_qrGrid) generate(); }));
    el.quietZone.addEventListener('change', () => { if (_qrGrid) generate(); });

    // 斜め接続補正
    el.diagBridge.addEventListener('change', () => {
      el.diagSizeRow.style.display = el.diagBridge.checked ? '' : 'none';
      if (_qrGrid) generate();
    });
    el.diagSize.addEventListener('change', () => { if (_qrGrid && el.diagBridge.checked) generate(); });

    // 外枠黒塗り
    el.borderFill.addEventListener('change', () => { if (_qrGrid) generate(); });

    // ノイズ追加
    el.noiseEnabled.addEventListener('change', () => {
      el.noiseRow.style.display = el.noiseEnabled.checked ? '' : 'none';
      if (_qrGrid) generate();
    });
    el.noisePct.addEventListener('change', () => { if (_qrGrid && el.noiseEnabled.checked) generate(); });

    // 検証
    el.btnValidate.addEventListener('click', _validatePuzzle);
    el.btnValidateCancel.addEventListener('click', () => { _cancelValidation = true; });

    // 未解決部分に黒マス追加
    el.btnFillUnsolved.addEventListener('click', _fillUnsolved);
  }

  // ─── 選択中の誤り訂正レベル ────────────────────────────
  function getEC() {
    for (const btn of el.ecBtns) {
      if (btn.checked) return btn.value;
    }
    return 'M';
  }

  // ─── QRコード生成 ─────────────────────────────────────
  function generate() {
    const url = el.urlInput.value.trim();
    if (!url) {
      el.infoText.textContent = 'URLを入力してください';
      el.infoText.style.color = 'var(--color-danger)';
      return;
    }

    let qr;
    try {
      qr = qrcode(0, getEC());   // type 0 = 自動
      qr.addData(url, 'Byte');
      qr.make();
    } catch (e) {
      el.infoText.textContent = `生成エラー: ${e.message}`;
      el.infoText.style.color = 'var(--color-danger)';
      return;
    }

    const moduleCount = qr.getModuleCount();
    const qz = el.quietZone.checked ? 4 : 0;   // クワイエットゾーン
    const total = moduleCount + qz * 2;

    // 二値グリッド生成
    _qrGrid = [];
    for (let r = 0; r < total; r++) {
      const row = new Uint8Array(total);
      for (let c = 0; c < total; c++) {
        const mr = r - qz, mc = c - qz;
        if (mr >= 0 && mr < moduleCount && mc >= 0 && mc < moduleCount) {
          row[c] = qr.isDark(mr, mc) ? 1 : 0;
        }
        // else: クワイエットゾーン = 白(0)
      }
      _qrGrid.push(row);
    }

    // 斜め接続補正（拡張率）
    let qzOff  = qz;   // 最終的なクワイエットゾーンオフセット（セル単位）
    let factor = 1;    // 拡張率（ノイズの最小距離計算にも使用）
    if (el.diagBridge.checked) {
      factor = Math.max(1, Math.min(5, parseInt(el.diagSize.value) || 2));
      if (factor > 1) {
        _qrGrid = _scaleGrid(_qrGrid, factor);
        qzOff   = qz * factor;
      }
      _qrGrid = _bridgeDiagonals(_qrGrid, factor * factor);
    }

    // 外枠黒塗り（余白を除いたQRデータ領域の最外1行/列を黒に）
    if (el.borderFill.checked) {
      _qrGrid = _fillOuterBorder(_qrGrid, qzOff);
    }

    // 白マスへのノイズ追加（QRデータ領域のみ・既存黒マスに非隣接・ランダム配置）
    if (el.noiseEnabled.checked) {
      const pct = Math.max(1, Math.min(30, parseInt(el.noisePct.value) || 5));
      _qrGrid = _addNoiseCells(_qrGrid, pct, qzOff);
    }

    // ヒント生成
    _hints = ImageProcessor.generateHints(_qrGrid);

    // プレビュー描画
    _renderQrCanvas(qr, moduleCount, qz);
    _renderGrid();

    const finalSize = _qrGrid.length;
    if (finalSize !== total) {
      el.infoText.textContent =
        `QR: ${total}×${total} → ${finalSize}×${finalSize} マス (モジュール数: ${moduleCount})`;
    } else {
      el.infoText.textContent = `${total}×${total} マス (モジュール数: ${moduleCount})`;
    }
    el.infoText.style.color = 'var(--color-success)';
    el.sendBtn.disabled     = false;
    el.saveBtn.disabled     = false;
    el.printBtn.disabled    = false;
    el.btnValidate.disabled = false;
    el.validateResult.textContent = '';
    el.validateResult.className   = '';
    _lastSolverResult = null;
    el.btnFillUnsolved.disabled = true;
  }

  // ─── QRプレビュー描画 ─────────────────────────────────
  function _renderQrCanvas(qr, moduleCount, qz) {
    const canvas = el.qrCanvas;
    const total  = moduleCount + qz * 2;
    const sz     = 240;
    const cell   = sz / total;
    canvas.width = canvas.height = sz;
    const ctx = canvas.getContext('2d');

    // 背景白
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sz, sz);

    // モジュール描画
    ctx.fillStyle = '#1a1a1a';
    for (let r = 0; r < moduleCount; r++) {
      for (let c = 0; c < moduleCount; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect((c + qz) * cell, (r + qz) * cell, cell, cell);
        }
      }
    }

    // グリッド線（薄く）
    ctx.strokeStyle = 'rgba(180,180,180,0.4)';
    ctx.lineWidth   = 0.3;
    for (let i = 0; i <= total; i++) {
      ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, sz); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(sz, i * cell); ctx.stroke();
    }
  }

  // ─── ノノグラムグリッドプレビュー ─────────────────────
  function _renderGrid() {
    if (!_qrGrid || !_hints) return;

    if (!_gridEditor) {
      _gridEditor = new GridEditor(el.gridWrap);
    }
    _gridEditor.setGrid(_qrGrid, _hints.rowHints, _hints.colHints);
  }

  // ─── 解答タブへ渡す ───────────────────────────────────
  function sendToSolver() {
    const hints = _gridEditor ? _gridEditor.getHints() : _hints;
    if (!hints) return;
    const grid = _gridEditor ? _gridEditor.getGrid() : _qrGrid;
    const rows = grid.length;
    const cols = grid[0].length;

    if (typeof App !== 'undefined' && App.hintInput) {
      App.rows = rows;
      App.cols = cols;
      document.getElementById('input-rows').value = rows;
      document.getElementById('input-cols').value = cols;
      App.gridCanvas.resize(rows, cols);
      App.hintInput.resize(rows, cols);
      App.hintInput.setHints(hints.rowHints, hints.colHints);
      App.hintInput.setCellSize(App.gridCanvas.cellSize);
      App.puzzleName = el.puzzleName.value.trim() || 'qr-nonogram';
      if (typeof updateSolveRate === 'function') updateSolveRate(0);
      if (typeof setStatus === 'function') setStatus('QRコードの問題をセットしました', 'success');
      if (typeof switchTab === 'function') switchTab('solver');
    }
  }

  // ─── .txt 保存 ────────────────────────────────────────
  function saveAsTxt() {
    const hints = _gridEditor ? _gridEditor.getHints() : _hints;
    if (!hints) return;
    const grid = _gridEditor ? _gridEditor.getGrid() : _qrGrid;
    const rows = grid.length;
    const cols = grid[0].length;
    const name = el.puzzleName.value.trim() || 'qr-nonogram';
    const content = FileIO.generateTextFile(rows, cols, hints.rowHints, hints.colHints);
    FileIO.downloadTextFile(content, name + '.txt');
  }

  // ─── 外枠黒塗り ──────────────────────────────────────────
  // qzOff: クワイエットゾーン分のセル数（拡張率込み）
  // QRデータ領域 [qzOff .. rows-1-qzOff] の最外1行/列を黒で塗りつぶす
  function _fillOuterBorder(grid, qzOff) {
    const rows = grid.length;
    const cols = grid[0].length;
    const rS = qzOff,         rE = rows - 1 - qzOff;
    const cS = qzOff,         cE = cols - 1 - qzOff;
    if (rS >= rE || cS >= cE) return grid;

    // 上辺・下辺
    for (let c = cS; c <= cE; c++) { grid[rS][c] = 1; grid[rE][c] = 1; }
    // 左辺・右辺（角は上下で塗り済み）
    for (let r = rS + 1; r < rE; r++) { grid[r][cS] = 1; grid[r][cE] = 1; }
    return grid;
  }

  // ─── グリッド拡張 ────────────────────────────────────────
  // 各セルを factor×factor のブロックに拡大する
  function _scaleGrid(grid, factor) {
    const rows = grid.length;
    const cols = grid[0].length;
    const out  = Array.from({length: rows * factor}, () => new Uint8Array(cols * factor));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] !== 1) continue;
        for (let dr = 0; dr < factor; dr++) {
          for (let dc = 0; dc < factor; dc++) {
            out[r * factor + dr][c * factor + dc] = 1;
          }
        }
      }
    }
    return out;
  }

  // ─── 斜め接続補正 ────────────────────────────────────────
  // 斜めにしか隣接していない黒マスペアの間にブリッジセルを追加する。
  // どちらかのグループのサイズが maxGroupSize 以下の場合に補正を適用。
  function _bridgeDiagonals(grid, maxGroupSize) {
    const rows = grid.length;
    const cols = grid[0].length;

    // 4連結ラベリング（BFS）
    const labels = Array.from({length: rows}, () => new Int32Array(cols).fill(-1));
    const groupSizes = [];
    let nextLabel = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] !== 1 || labels[r][c] !== -1) continue;
        const queue = [[r, c]];
        labels[r][c] = nextLabel;
        let size = 0, head = 0;
        while (head < queue.length) {
          const [cr, cc] = queue[head++];
          size++;
          for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const nr = cr+dr, nc = cc+dc;
            if (nr>=0 && nr<rows && nc>=0 && nc<cols && grid[nr][nc]===1 && labels[nr][nc]===-1) {
              labels[nr][nc] = nextLabel;
              queue.push([nr, nc]);
            }
          }
        }
        groupSizes[nextLabel++] = size;
      }
    }

    // 元グリッドのコピーに追記
    const out = grid.map(r => new Uint8Array(r));

    // 下方向の対角隣接のみ検索（上下左右 2方向 × 右/左 = 重複なし）
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] !== 1) continue;
        const la = labels[r][c];

        for (const dc of [-1, 1]) {
          const nc = c + dc;
          if (nc < 0 || nc >= cols) continue;
          if (grid[r+1][nc] !== 1) continue;
          const lb = labels[r+1][nc];
          if (la === lb) continue; // 同グループ（すでに4連結）

          // どちらかが上限サイズ以下のときブリッジ
          if (groupSizes[la] > maxGroupSize && groupSizes[lb] > maxGroupSize) continue;

          // ブリッジ優先: (r, nc) → 次に (r+1, c)
          if (out[r][nc] === 0) {
            out[r][nc] = 1;
          } else if (out[r+1][c] === 0) {
            out[r+1][c] = 1;
          }
        }
      }
    }

    return out;
  }

  // ─── 白マスノイズ追加 ────────────────────────────────────
  // QRデータ領域（qzOff 内側）の、4近傍が全て白のセルから
  // noisePct% をランダムに黒にする（純粋ランダム・分散制約なし）
  function _addNoiseCells(grid, noisePct, qzOff) {
    const rows = grid.length;
    const cols = grid[0].length;
    const rS = qzOff, rE = rows - 1 - qzOff;
    const cS = qzOff, cE = cols - 1 - qzOff;
    if (rS >= rE || cS >= cE) return grid;

    // 候補: QRデータ領域内で 4近傍がすべて白の白マス
    const cands = [];
    for (let r = rS; r <= rE; r++) {
      for (let c = cS; c <= cE; c++) {
        if (grid[r][c] !== 0) continue;
        let ok = true;
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nr = r+dr, nc = c+dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] !== 0) {
            ok = false; break;
          }
        }
        if (ok) cands.push([r, c]);
      }
    }
    if (cands.length === 0) return grid;

    // Fisher-Yates シャッフル → 先頭 target 個を採用（純粋ランダム）
    for (let i = cands.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cands[i], cands[j]] = [cands[j], cands[i]];
    }

    const target = Math.round(cands.length * noisePct / 100);
    const out    = grid.map(r => new Uint8Array(r));
    for (let i = 0; i < Math.min(target, cands.length); i++) {
      out[cands[i][0]][cands[i][1]] = 1;
    }
    return out;
  }

  // ─── 解の検証（非同期・プログレスバー・キャンセル対応） ───
  async function _validatePuzzle() {
    if (_validating) return;
    const hints = _gridEditor ? _gridEditor.getHints() : _hints;
    if (!hints) return;

    _lastSolverResult = null;
    _cancelValidation = false;
    _validating = true;
    el.btnFillUnsolved.disabled = true;

    // UI 開始状態
    const res = el.validateResult;
    res.textContent = '検証中...';
    res.className   = 'validate-running';
    el.btnValidate.disabled        = true;
    el.btnValidateCancel.style.display = '';
    el.validateProgress.style.display  = '';
    el.validateBar.style.width = '0%';
    el.validatePct.textContent = '0%';
    if (_gridEditor) _gridEditor.clearValidationOverlay();

    const _updateBar = (rate) => {
      const p = Math.round(rate * 100);
      el.validateBar.style.width = p + '%';
      el.validatePct.textContent = p + '%';
    };

    try {
      const solver = new NonogramSolver(hints.rowHints, hints.colHints);
      let iterations = 0, stuckCount = 0;
      const maxIter = 500;

      // ソルバーを1イテレーションずつ実行し、間に yield して UI を更新
      mainLoop: while (!solver.isSolved() && !solver.contradiction && iterations < maxIter) {
        await new Promise(r => setTimeout(r, 0)); // UI 更新 & キャンセル確認
        if (_cancelValidation) {
          res.textContent = '⏹ 検証を中断しました';
          res.className   = '';
          break;
        }

        const resolved = solver.step();
        iterations++;
        _updateBar(solver.solveRate());
        if (resolved === -1) break;

        if (resolved === 0) {
          stuckCount++;
          if (stuckCount >= 2) break;

          // 詰め処理（重い場合があるので yield してから実行）
          await new Promise(r => setTimeout(r, 0));
          if (_cancelValidation) {
            res.textContent = '⏹ 検証を中断しました';
            res.className   = '';
            break mainLoop;
          }

          const intRes = solver.intensiveStep();
          _updateBar(solver.solveRate());
          if (intRes === -1) break;
          if (intRes > 0) stuckCount = 0;
        } else {
          stuckCount = 0;
        }
      }

      if (!_cancelValidation) {
        const pct = Math.round(solver.solveRate() * 100);
        _updateBar(solver.solveRate());

        if (solver.contradiction) {
          res.textContent = '❌ 矛盾あり（解なし）';
          res.className   = 'validate-error';
          _lastSolverResult = null;
          el.btnFillUnsolved.disabled = true;
          if (_gridEditor) _gridEditor.clearValidationOverlay();
        } else if (solver.isSolved()) {
          res.textContent = `✅ 唯一解あり（${iterations}パス）`;
          res.className   = 'validate-ok';
          _lastSolverResult = null;
          el.btnFillUnsolved.disabled = true;
          if (_gridEditor) _gridEditor.clearValidationOverlay();
        } else {
          const solveResult = { grid: solver.grid, solveRate: solver.solveRate(),
                                solved: false, contradiction: false, iterations };
          res.textContent = `⚠ 部分解のみ ${pct}%`;
          res.className   = 'validate-warn';
          _lastSolverResult = solveResult;
          el.btnFillUnsolved.disabled = false;
          if (_gridEditor) {
            const hex = el.validateColor.value || '#ff6600';
            const r2 = parseInt(hex.slice(1,3),16);
            const g2 = parseInt(hex.slice(3,5),16);
            const b2 = parseInt(hex.slice(5,7),16);
            const mask = solveResult.grid.map(row =>
              Array.from(row).map(v => v === -1 ? 1 : 0)
            );
            _gridEditor.setValidationOverlay(mask, `rgba(${r2},${g2},${b2},0.55)`);
          }
        }
      }
    } catch (e) {
      res.textContent = `エラー: ${e.message}`;
      res.className   = 'validate-error';
      _lastSolverResult = null;
      el.btnFillUnsolved.disabled = true;
    } finally {
      _validating = false;
      _cancelValidation = false;
      el.btnValidate.disabled            = false;
      el.btnValidateCancel.style.display = 'none';
      setTimeout(() => { el.validateProgress.style.display = 'none'; }, 800);
    }
  }

  // ─── 境界黒マス追加 ─────────────────────────────────────
  // ソルバーが未確定（-1）かつ、ソルバーが黒（1）と確定した隣接セルを持つセルを
  // 指定%だけランダムに黒にする（既解決黒マスから伸びて繋がるような補助）
  function _fillUnsolved() {
    if (!_lastSolverResult || !_gridEditor) return;

    const solverGrid = _lastSolverResult.grid;
    const editorGrid = _gridEditor.getGrid();
    const rows = editorGrid.length;
    const cols = editorGrid[0].length;
    const pct  = Math.max(0, Math.min(50, parseInt(el.fillPct.value) || 20));

    // 条件: 未確定(-1)かつ現在白 かつ 4近傍にソルバー確定黒(1)がある
    const cands = [];
    const DIR = [[-1,0],[1,0],[0,-1],[0,1]];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (solverGrid[r][c] !== -1) continue;
        if (editorGrid[r][c] !== 0)  continue;
        let adjBlack = false;
        for (const [dr, dc] of DIR) {
          const nr = r+dr, nc = c+dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && solverGrid[nr][nc] === 1) {
            adjBlack = true; break;
          }
        }
        if (adjBlack) cands.push([r, c]);
      }
    }

    if (cands.length === 0) {
      el.validateResult.textContent = '境界に追加可能な白マスがありません';
      el.validateResult.className   = '';
      return;
    }

    // Fisher-Yates シャッフル → 先頭 pct% を採用
    for (let i = cands.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cands[i], cands[j]] = [cands[j], cands[i]];
    }
    const count = Math.max(1, Math.round(cands.length * pct / 100));
    for (let i = 0; i < count; i++) {
      editorGrid[cands[i][0]][cands[i][1]] = 1;
    }

    // グリッドエディタに反映
    const newHints = ImageProcessor.generateHints(editorGrid);
    _gridEditor.setGrid(editorGrid, newHints.rowHints, newHints.colHints);
    _lastSolverResult = null;
    el.btnFillUnsolved.disabled = true;
    el.validateResult.textContent = `${count}マス追加しました（境界候補${cands.length}件中）。再度検証してください。`;
    el.validateResult.className   = '';
  }

  return { init };
})();
