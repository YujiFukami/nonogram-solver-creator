'use strict';

/**
 * creator.js — 問題作成タブのメインコントローラ
 */
const Creator = (() => {
  const $c = id => document.getElementById(id);

  let _img      = null;
  let _cropTool = null;
  let _editor   = null;
  let _showHints = true;
  let _lastSolverResult = null;
  let _validating       = false;
  let _cancelValidation = false;
  let _userZoomed       = false; // 利用者がセルサイズを手で決めたら true（自動拡大しない）

  const PREVIEW_H_KEY     = 'creator.previewHeight';
  const PREVIEW_H_DEFAULT = 300;

  let _settings = {
    mode:       'threshold',
    threshold:  128,
    brightness: 0,
    contrast:   0,
    edgeBoost:  0,
    closing:    0,
    isolate:    0,
    minBlob:    0,
    smooth:     false,
    zoomPx:     0,     // 0=未設定(auto), N=絶対px
    cols:       30,
    rows:       20,
    autoRows:   true,
    overlayOpacity: 0,
    brushSize:  1,
    zoomMode:   false,
  };

  let el = {};

  // ─── 初期化 ────────────────────────────────────────────────

  function init() {
    el = {
      dropZone:      $c('cr-drop-zone'),
      fileInput:     $c('cr-file-input'),
      btnImport:     $c('cr-btn-import'),
      fileName:      $c('cr-file-name'),
      origCanvas:    $c('cr-orig-canvas'),
      cropCanvas:    $c('cr-crop-canvas'),
      bwCanvas:      $c('cr-bw-canvas'),
      threshold:     $c('cr-threshold'),
      thresholdVal:  $c('cr-threshold-val'),
      brightness:    $c('cr-brightness'),
      brightnessVal: $c('cr-brightness-val'),
      contrast:      $c('cr-contrast'),
      contrastVal:   $c('cr-contrast-val'),
      edgeBoost:     $c('cr-edge-boost'),
      edgeBoostVal:  $c('cr-edge-boost-val'),
      edgeBoostRow:  $c('cr-edge-boost-row'),
      overlayOpacity:$c('cr-overlay-opacity'),
      overlayVal:    $c('cr-overlay-val'),
      zoom:          $c('cr-zoom'),
      zoomVal:       $c('cr-zoom-val'),
      closing:       $c('cr-closing'),
      closingVal:    $c('cr-closing-val'),
      isolate:       $c('cr-isolate'),
      isolateVal:    $c('cr-isolate-val'),
      minBlob:       $c('cr-min-blob'),
      minBlobVal:    $c('cr-min-blob-val'),
      btnValidate:    $c('cr-btn-validate'),
      validateColor:  $c('cr-validate-color'),
      validateResult: $c('cr-validate-result'),
      cols:          $c('cr-cols'),
      rows:          $c('cr-rows'),
      autoRows:      $c('cr-auto-rows'),
      showHints:     $c('cr-show-hints'),
      gridWrap:      $c('cr-grid-wrap'),
      puzzleName:    $c('cr-puzzle-name'),
      btnTransfer:      $c('cr-btn-transfer'),
      btnSave:          $c('cr-btn-save'),
      btnReset:         $c('cr-btn-reset'),
      btnZoomMode:      $c('cr-btn-zoom-mode'),
      btnTogglePreview: $c('cr-btn-toggle-preview'),
      resizeHandle:     $c('cr-resize-handle'),
      btnProjectSave:   $c('cr-btn-project-save'),
      btnProjectLoad:   $c('cr-btn-project-load'),
      projectInput:     $c('cr-project-input'),
      btnPrint:         $c('cr-btn-print'),
      btnFillUnsolved:   $c('cr-btn-fill-unsolved'),
      fillPct:           $c('cr-fill-pct'),
      btnValidateCancel: $c('cr-btn-validate-cancel'),
      validateProgress:  $c('cr-validate-progress'),
      validateBar:       $c('cr-validate-bar'),
      validatePct:       $c('cr-validate-pct'),
      smooth:            $c('cr-smooth'),
      ditherWarn:        $c('cr-dither-warn'),
      btnSearch:         $c('cr-btn-search'),
      btnSearchCancel:   $c('cr-btn-search-cancel'),
      searchProgress:    $c('cr-search-progress'),
      searchBar:         $c('cr-search-bar'),
      searchResult:      $c('cr-search-result'),
      searchCands:       $c('cr-search-cands'),
    };

    _editor = new GridEditor(el.gridWrap);

    // セルサイズ変更通知（ズームモードのホイール操作時）
    _editor.onCellSizeChange = (cs) => {
      _userZoomed = true;
      el.zoom.value = cs;
      _settings.zoomPx = cs;
      el.zoomVal.textContent = cs + 'px';
    };

    _cropTool = new CropTool(el.cropCanvas, _onCropChange);

    _restorePreviewHeight();
    _bindEvents();

    // 画面・左メニュー・タブの切り替えで表示領域が変わったら合わせ直す
    let _rafId = 0;
    const _onLayoutChange = (e) => {
      const tab = e && e.detail && e.detail.tab;
      if (tab && tab !== 'creator') return;
      cancelAnimationFrame(_rafId);
      _rafId = requestAnimationFrame(() => _relayout());
    };
    window.addEventListener('resize', _onLayoutChange);
    window.addEventListener('layoutresize', _onLayoutChange);
  }

  /** 問題作成タブが表示中なら、プレビューと問題の大きさを今の領域に合わせ直す */
  function _relayout() {
    const tab = document.getElementById('tab-creator');
    if (!tab || !tab.classList.contains('active') || !_img) return;
    _layoutPreviews(true);
    _refitGrid();
  }

  /** 自動拡大中なら、生成された問題を表示領域いっぱいに合わせる */
  function _refitGrid() {
    if (!_img || _userZoomed || !_editor.getGrid()) return;
    _editor.setCellSizeOverride(null);
    const cs = _editor.getCellSize();
    if (cs) {
      el.zoom.value    = cs;
      _settings.zoomPx = cs;
    }
    _updateZoomLabel();
  }

  // ─── イベントバインド ─────────────────────────────────────

  function _bindEvents() {
    // 画像インポート
    el.btnImport.addEventListener('click', () => el.fileInput.click());
    el.fileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      el.fileInput.value = '';
      if (file) _loadFile(file);
    });

    // ドラッグ＆ドロップ
    el.dropZone.addEventListener('dragover', e => {
      e.preventDefault();
      el.dropZone.classList.add('drag-over');
    });
    el.dropZone.addEventListener('dragleave', () => {
      el.dropZone.classList.remove('drag-over');
    });
    el.dropZone.addEventListener('drop', e => {
      e.preventDefault();
      el.dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) _loadFile(file);
    });

    // 変換モード
    document.querySelectorAll('input[name="cr-mode"]').forEach(radio => {
      radio.addEventListener('change', () => {
        _settings.mode = radio.value;
        _updateEdgeBoostVisibility();
        _update();
      });
    });

    // スライダー
    el.threshold.addEventListener('input', () => {
      _settings.threshold = parseInt(el.threshold.value);
      el.thresholdVal.textContent = _settings.threshold;
      _update();
    });
    el.brightness.addEventListener('input', () => {
      _settings.brightness = parseInt(el.brightness.value);
      el.brightnessVal.textContent = _settings.brightness;
      _update();
    });
    el.contrast.addEventListener('input', () => {
      _settings.contrast = parseInt(el.contrast.value);
      el.contrastVal.textContent = _settings.contrast;
      _update();
    });
    el.edgeBoost.addEventListener('input', () => {
      _settings.edgeBoost = parseInt(el.edgeBoost.value);
      el.edgeBoostVal.textContent = _settings.edgeBoost;
      _update();
    });
    el.closing.addEventListener('input', () => {
      _settings.closing = parseInt(el.closing.value);
      el.closingVal.textContent = _settings.closing;
      _update();
    });
    el.isolate.addEventListener('input', () => {
      _settings.isolate = parseInt(el.isolate.value);
      el.isolateVal.textContent = _settings.isolate;
      _update();
    });
    el.minBlob.addEventListener('input', () => {
      _settings.minBlob = parseInt(el.minBlob.value);
      el.minBlobVal.textContent = _settings.minBlob;
      _update();
    });

    // ならし
    if (el.smooth) el.smooth.addEventListener('change', () => {
      _settings.smooth = el.smooth.checked;
      _update();
    });

    // 解ける設定を探す
    if (el.btnSearch) el.btnSearch.addEventListener('click', _searchSolvable);
    if (el.btnSearchCancel) el.btnSearchCancel.addEventListener('click', () => { if (_search) _search.cancel(); });

    // 参照オーバーレイ
    el.overlayOpacity.addEventListener('input', () => {
      _settings.overlayOpacity = parseInt(el.overlayOpacity.value);
      el.overlayVal.textContent = _settings.overlayOpacity;
      _editor.setRefOpacity(_settings.overlayOpacity / 100);
    });

    // 倍率（1px単位）
    el.zoom.addEventListener('input', () => {
      _userZoomed = true;
      _settings.zoomPx = parseInt(el.zoom.value);
      _editor.setCellSizeOverride(_settings.zoomPx);
      el.zoomVal.textContent = _editor.getCellSize() + 'px';
    });

    // ブラシサイズ
    document.querySelectorAll('.cr-brush-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cr-brush-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _settings.brushSize = parseInt(btn.dataset.size);
        _editor.setBrushSize(_settings.brushSize);
      });
    });

    // グリッドサイズ
    el.cols.addEventListener('change', () => {
      _settings.cols = Math.max(1, Math.min(500, parseInt(el.cols.value) || 30));
      el.cols.value  = _settings.cols;
      _settings.zoomPx = 0; // サイズ変更時はautoに戻す
      _userZoomed = false;
      if (_settings.autoRows) _calcAutoRows();
      _update();
    });
    el.rows.addEventListener('change', () => {
      _settings.rows = Math.max(1, Math.min(500, parseInt(el.rows.value) || 20));
      el.rows.value  = _settings.rows;
      _settings.autoRows = false;
      el.autoRows.checked = false;
      _settings.zoomPx = 0;
      _userZoomed = false;
      _update();
    });
    el.autoRows.addEventListener('change', () => {
      _settings.autoRows = el.autoRows.checked;
      if (_settings.autoRows && _img) { _calcAutoRows(); _update(); }
    });

    // ヒント表示
    el.showHints.addEventListener('change', () => {
      _showHints = el.showHints.checked;
      _editor.setShowHints(_showHints);
    });

    // ズームモードトグル
    el.btnZoomMode.addEventListener('click', () => {
      _settings.zoomMode = !_settings.zoomMode;
      _editor.setZoomMode(_settings.zoomMode);
      _updateZoomModeBtn();
    });

    // プレビュー表示/非表示
    el.btnTogglePreview.addEventListener('click', () => {
      const visible = el.dropZone.style.display !== 'none';
      el.dropZone.style.display     = visible ? 'none' : '';
      el.resizeHandle.style.display = visible ? 'none' : '';
      el.btnTogglePreview.textContent = visible ? '▼ プレビュー' : '▲ 隠す';
      requestAnimationFrame(() => _relayout());
    });

    // リサイズハンドル（プレビュー↔グリッド境界のドラッグ）
    _bindResizeHandle();

    // 検証
    el.btnValidate.addEventListener('click', _validatePuzzle);
    el.btnValidateCancel.addEventListener('click', () => { _cancelValidation = true; });
    el.btnFillUnsolved.addEventListener('click', _fillUnsolved);

    // アクション
    el.btnTransfer.addEventListener('click', _transferToSolver);
    el.btnSave.addEventListener('click', _savePuzzle);
    el.btnReset.addEventListener('click', () => { if (_img) _update(); });

    // 印刷
    el.btnPrint.addEventListener('click', () => {
      if (!_img) { alert('先に画像を読み込んでください'); return; }
      const { rowHints, colHints } = _editor.getHints();
      const name = el.puzzleName.value.trim() || 'nonogram';
      PrintPuzzle.open(rowHints, colHints, name);
    });

    // プロジェクト保存/読込
    el.btnProjectSave.addEventListener('click', _saveProject);
    el.btnProjectLoad.addEventListener('click', () => el.projectInput.click());
    el.projectInput.addEventListener('change', e => {
      const file = e.target.files[0];
      el.projectInput.value = '';
      if (file) _loadProject(file);
    });
  }

  function _updateEdgeBoostVisibility() {
    if (el.ditherWarn) {
      el.ditherWarn.style.display = (_settings.mode === 'dither' || _settings.mode === 'outline') ? '' : 'none';
    }
    if (el.edgeBoostRow) {
      const show = _settings.mode === 'threshold' || _settings.mode === 'outline';
      el.edgeBoostRow.style.display = show ? '' : 'none';
    }
  }

  function _updateZoomModeBtn() {
    if (!el.btnZoomMode) return;
    if (_settings.zoomMode) {
      el.btnZoomMode.textContent = '🔍 ズームON';
      el.btnZoomMode.className   = 'btn-primary cr-zoom-mode-btn';
    } else {
      el.btnZoomMode.textContent = '🔍 ズーム';
      el.btnZoomMode.className   = 'btn-secondary cr-zoom-mode-btn';
    }
  }

  // ─── リサイズハンドル ─────────────────────────────────────

  /** 区切り線のドラッグで、上のプレビューと下の問題の高さを分ける（マウス・タッチ両対応） */
  function _bindResizeHandle() {
    const handle = el.resizeHandle;
    if (!handle) return;

    let startY = 0, startH = 0, pointerId = null, rafId = 0;

    handle.title = 'ドラッグで高さを調整（ダブルクリックで元に戻す）';

    handle.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button !== 0) return;
      pointerId = e.pointerId;
      startY    = e.clientY;
      startH    = el.dropZone.offsetHeight;
      try { handle.setPointerCapture(pointerId); } catch (err) { /* 取れなくてもドラッグは続ける */ }
      handle.classList.add('dragging');
      document.body.classList.add('is-row-resizing');
      e.preventDefault();
    });

    handle.addEventListener('pointermove', e => {
      if (pointerId === null || e.pointerId !== pointerId) return;
      _setPreviewHeight(startH + (e.clientY - startY));
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => _layoutPreviews(true));
    });

    const _end = e => {
      if (pointerId === null || e.pointerId !== pointerId) return;
      pointerId = null;
      handle.classList.remove('dragging');
      document.body.classList.remove('is-row-resizing');
      _savePreviewHeight();
      _relayout();
    };
    handle.addEventListener('pointerup', _end);
    handle.addEventListener('pointercancel', _end);

    // ダブルクリックで初期の高さへ
    handle.addEventListener('dblclick', () => {
      _setPreviewHeight(PREVIEW_H_DEFAULT);
      _savePreviewHeight();
      _relayout();
    });
  }

  function _previewMaxHeight() {
    const main  = el.dropZone.parentElement;
    const mainH = main ? main.clientHeight : 0;
    // 下の問題エリアに最低 120px は残す
    return mainH > 0 ? Math.max(80, mainH - 120) : 800;
  }

  function _setPreviewHeight(h) {
    const clamped = Math.round(Math.max(80, Math.min(_previewMaxHeight(), h)));
    el.dropZone.style.setProperty('--cr-preview-h', clamped + 'px');
  }

  function _savePreviewHeight() {
    try { localStorage.setItem(PREVIEW_H_KEY, String(el.dropZone.offsetHeight)); } catch (e) { /* 保存できなくても続ける */ }
  }

  function _restorePreviewHeight() {
    let h = PREVIEW_H_DEFAULT;
    try {
      const saved = parseInt(localStorage.getItem(PREVIEW_H_KEY), 10);
      if (saved > 0) h = saved;
    } catch (e) { /* 既定値を使う */ }
    el.dropZone.style.setProperty('--cr-preview-h', h + 'px');
  }

  // ─── 画像ロード ──────────────────────────────────────────

  function _loadFile(file) {
    el.fileName.textContent = file.name;
    el.puzzleName.value = file.name.replace(/\.[^.]+$/, '');
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => { _img = img; _setupPreviews(); };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function _setupPreviews() {
    const hint    = document.getElementById('cr-drop-hint');
    const preview = document.getElementById('cr-preview-row');
    if (hint)    hint.style.display    = 'none';
    if (preview) preview.style.display = 'flex';

    _layoutPreviews(false);

    _settings.zoomPx = 0; // 新画像読み込み時はauto
    _userZoomed = false;
    if (_settings.autoRows) _calcAutoRows();
    _update();
  }

  /** プレビュー1枚に使える幅と高さ（区切り線で決めた高さに合わせる） */
  function _previewArea() {
    const box    = el.origCanvas.closest('.cr-preview-box') || el.origCanvas.parentElement;
    const label  = box ? box.querySelector('.cr-preview-label') : null;
    const row    = document.getElementById('cr-preview-row');
    const zs     = getComputedStyle(el.dropZone);
    const padY   = parseFloat(zs.paddingTop) + parseFloat(zs.paddingBottom);
    const labelH = label ? label.offsetHeight + 4 : 0;

    const maxW = (box && box.clientWidth) || 380;
    let maxH = el.dropZone.clientHeight - padY - 2;
    // スマホ幅ではプレビューが縦に2枚並ぶ
    const stacked = row && getComputedStyle(row).flexDirection === 'column';
    if (stacked) maxH = Math.floor((maxH - 12) / 2);
    maxH -= labelH;
    return { maxW: Math.max(20, maxW), maxH: Math.max(20, maxH) };
  }

  /**
   * 元画像プレビューを表示領域に合わせて描き直す
   * @param {boolean} keepCrop  true なら今のトリミング枠を保ち、白黒プレビューも描き直す
   */
  function _layoutPreviews(keepCrop) {
    if (!_img) return;
    const crop = keepCrop ? _cropTool.getCropRect() : null;
    const { maxW, maxH } = _previewArea();
    const scale = Math.min(maxW / _img.naturalWidth, maxH / _img.naturalHeight);
    const dispW = Math.max(1, Math.round(_img.naturalWidth  * scale));
    const dispH = Math.max(1, Math.round(_img.naturalHeight * scale));

    const sizeChanged = el.origCanvas.width !== dispW || el.origCanvas.height !== dispH;
    if (!keepCrop || sizeChanged) {
      el.origCanvas.width  = dispW;
      el.origCanvas.height = dispH;
      el.origCanvas.getContext('2d').drawImage(_img, 0, 0, dispW, dispH);

      _cropTool.setImage(_img, dispW, dispH);
      if (crop) _cropTool.setCrop(crop);
    }

    if (keepCrop) _renderBwPreview();
  }

  /** 白黒プレビュー（トリミング範囲＋グリッド線）を描く */
  function _renderBwPreview() {
    if (!_img) return;
    const crop = _cropTool.getCropRect();
    const { maxW, maxH } = _previewArea();
    const cropAspect = crop.w / Math.max(1, crop.h);
    let bwW = maxW;
    let bwH = Math.round(bwW / cropAspect);
    if (bwH > maxH) { bwH = maxH; bwW = Math.round(bwH * cropAspect); }
    bwW = Math.max(1, bwW); bwH = Math.max(1, bwH);
    if (el.bwCanvas.width !== bwW || el.bwCanvas.height !== bwH) {
      el.bwCanvas.width  = bwW;
      el.bwCanvas.height = bwH;
    }
    ImageProcessor.renderPreview(_img, crop, el.bwCanvas, _settings);
    _drawGridOverlay(el.bwCanvas, _settings.cols, _settings.rows);
  }

  function _calcAutoRows() {
    if (!_img) return;
    const aspect = _cropTool.getCropAspect();
    const rows = Math.max(1, Math.min(500, Math.round(_settings.cols / aspect)));
    _settings.rows = rows;
    el.rows.value  = rows;
  }

  function _onCropChange() {
    if (_settings.autoRows) _calcAutoRows();
    _update();
  }

  // ─── 画像処理・グリッド更新 ──────────────────────────────

  function _update() {
    if (!_img) return;
    const crop = _cropTool.getCropRect();

    _renderBwPreview();

    // gridエディタにセルサイズ上書きを設定してから setGrid
    // （手でズームしていなければ毎回、表示領域いっぱいに自動拡大する）
    if (_userZoomed && _settings.zoomPx > 0) {
      _editor.setCellSizeOverride(_settings.zoomPx);
    } else {
      _editor.setCellSizeOverride(null); // auto
    }

    const grid = ImageProcessor.processGrid(
      _img, crop, _settings.cols, _settings.rows, _settings
    );
    const { rowHints, colHints } = ImageProcessor.generateHints(grid);
    _editor.setGrid(grid, rowHints, colHints);
    _editor.setShowHints(_showHints);
    _editor.setBrushSize(_settings.brushSize);
    _editor.setReferenceImage(_img, crop);
    _editor.setRefOpacity(_settings.overlayOpacity / 100);

    // 自動拡大のとき、実際のセルサイズをスライダーに反映
    if (!_userZoomed) {
      const cs = _editor.getCellSize();
      if (cs) {
        el.zoom.value = cs;
        _settings.zoomPx = cs;
      }
    }
    _updateZoomLabel();
  }

  function _updateZoomLabel() {
    const cs = _editor.getCellSize();
    el.zoomVal.textContent = cs ? cs + 'px' : '--';
  }

  function _drawGridOverlay(canvas, cols, rows) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.strokeStyle = 'rgba(0, 100, 255, 0.25)';
    ctx.lineWidth = 0.5;
    for (let c = 1; c < cols; c++) {
      const x = c * W / cols;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let r = 1; r < rows; r++) {
      const y = r * H / rows;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  }

  // ─── 解の検証 ────────────────────────────────────────────

  async function _validatePuzzle() {
    if (_validating) return;
    const { rowHints, colHints } = _editor.getHints();
    const res = el.validateResult;

    _lastSolverResult = null;
    _cancelValidation = false;
    _validating = true;
    el.btnFillUnsolved.disabled = true;

    // UI 開始状態
    res.textContent = '検証中...';
    res.className   = 'validate-running';
    el.btnValidate.disabled            = true;
    el.btnValidateCancel.style.display = '';
    el.validateProgress.style.display  = '';
    el.validateBar.style.width = '0%';
    el.validatePct.textContent = '0%';
    _editor.clearValidationOverlay();

    const _updateBar = (rate) => {
      const p = Math.round(rate * 100);
      el.validateBar.style.width = p + '%';
      el.validatePct.textContent = p + '%';
    };

    try {
      const solver = new NonogramSolver(rowHints, colHints);
      let iterations = 0, stuckCount = 0;
      const maxIter = 500;

      mainLoop: while (!solver.isSolved() && !solver.contradiction && iterations < maxIter) {
        await new Promise(r => setTimeout(r, 0));
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
          _editor.clearValidationOverlay();
        } else if (solver.isSolved()) {
          res.textContent = `✅ 唯一解あり（${iterations}パス）`;
          res.className   = 'validate-ok';
          _lastSolverResult = null;
          el.btnFillUnsolved.disabled = true;
          _editor.clearValidationOverlay();
        } else {
          const solveResult = { grid: solver.grid, solveRate: solver.solveRate(),
                                solved: false, contradiction: false, iterations };
          res.textContent = `⚠ 部分解のみ ${pct}%`;
          res.className   = 'validate-warn';
          _lastSolverResult = solveResult;
          el.btnFillUnsolved.disabled = false;
          const hex = (el.validateColor && el.validateColor.value) || '#ff6600';
          const r2 = parseInt(hex.slice(1,3),16);
          const g2 = parseInt(hex.slice(3,5),16);
          const b2 = parseInt(hex.slice(5,7),16);
          const unknownMask = solveResult.grid.map(row =>
            Array.from(row).map(v => (v === -1 ? 1 : 0))
          );
          _editor.setValidationOverlay(unknownMask, `rgba(${r2},${g2},${b2},0.55)`);
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

  function _fillUnsolved() {
    if (!_lastSolverResult || !_editor) return;

    const solverGrid = _lastSolverResult.grid;
    const editorGrid = _editor.getGrid();
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
    _editor.setGrid(editorGrid, newHints.rowHints, newHints.colHints);
    _editor.setShowHints(_showHints);
    _editor.setBrushSize(_settings.brushSize);
    _lastSolverResult = null;
    el.btnFillUnsolved.disabled = true;
    el.validateResult.textContent = `${count}マス追加しました（境界候補${cands.length}件中）。再度検証してください。`;
    el.validateResult.className   = '';
  }

  // ─── 出力 ────────────────────────────────────────────────

  function _transferToSolver() {
    if (!_img) { alert('先に画像を読み込んでください'); return; }
    const { rowHints, colHints } = _editor.getHints();
    const rows = _settings.rows;
    const cols = _settings.cols;
    const name = el.puzzleName.value.trim() || 'nonogram';

    switchTab('solver');

    App.rows = rows;
    App.cols = cols;
    document.getElementById('input-rows').value = rows;
    document.getElementById('input-cols').value = cols;
    App.gridCanvas.resize(rows, cols);
    App.hintInput.resize(rows, cols);
    App.hintInput.setHints(rowHints, colHints);
    App.puzzleName = name;
    updateSolveRate(0);
    setStatus(`「${name}」を読み込みました (${rows}×${cols})`, 'success');
    autoZoomFit();
  }

  function _savePuzzle() {
    if (!_img) { alert('先に画像を読み込んでください'); return; }
    const { rowHints, colHints } = _editor.getHints();
    const name    = el.puzzleName.value.trim() || 'nonogram';
    const content = FileIO.generateTextFile(_settings.rows, _settings.cols, rowHints, colHints);
    FileIO.downloadTextFile(content, name + '.txt');
  }

  // ─── プロジェクト保存/読込 ──────────────────────────────

  function _saveProject() {
    if (!_img) { alert('先に画像を読み込んでください'); return; }

    const name = el.puzzleName.value.trim() || 'nonogram';
    const crop = _cropTool.getCropRect();
    const grid = _editor.getGrid();

    // 画像を圧縮して base64 化（最大 1200px）
    const maxSz = 1200;
    const imgScale = Math.min(1, maxSz / Math.max(_img.naturalWidth, _img.naturalHeight));
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width  = Math.round(_img.naturalWidth  * imgScale);
    tmpCanvas.height = Math.round(_img.naturalHeight * imgScale);
    tmpCanvas.getContext('2d').drawImage(_img, 0, 0, tmpCanvas.width, tmpCanvas.height);
    const imageData = tmpCanvas.toDataURL('image/jpeg', 0.85);

    // crop 座標をスケール後の画像に合わせて変換
    const scaledCrop = {
      x: Math.round(crop.x * imgScale),
      y: Math.round(crop.y * imgScale),
      w: Math.max(1, Math.round(crop.w * imgScale)),
      h: Math.max(1, Math.round(crop.h * imgScale)),
    };

    const proj = {
      version:   1,
      type:      'nonogram-creator',
      name,
      settings:  { ..._settings },
      crop:      scaledCrop,
      grid:      Array.from(grid).map(r => Array.from(r)),
      imageData,
    };

    const blob = new Blob([JSON.stringify(proj)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = name + '.ncp.json'; a.click();
    URL.revokeObjectURL(url);
  }

  function _loadProject(file) {
    const reader = new FileReader();
    reader.onload = e => {
      let proj;
      try { proj = JSON.parse(e.target.result); }
      catch { alert('プロジェクトファイルの解析に失敗しました'); return; }

      if (proj.type !== 'nonogram-creator') {
        alert('このファイルは対応していない形式です'); return;
      }

      const img = new Image();
      img.onload = () => {
        _img = img;
        el.fileName.textContent = proj.name || 'プロジェクト';
        el.puzzleName.value = proj.name || 'nonogram';

        // プレビューキャンバスセットアップ（_update は呼ばない）
        const hint    = document.getElementById('cr-drop-hint');
        const preview = document.getElementById('cr-preview-row');
        if (hint)    hint.style.display    = 'none';
        if (preview) preview.style.display = 'flex';
        _layoutPreviews(false);

        // 設定を復元
        if (proj.settings) Object.assign(_settings, proj.settings);
        _applySettingsToUI(_settings);

        // クロップ位置を復元
        if (proj.crop) _cropTool.setCrop(proj.crop);

        // BW プレビューを描画
        const crop = _cropTool.getCropRect();
        _renderBwPreview();

        // 保存時のセルサイズは使わず、今の表示領域に合わせて自動拡大する
        _userZoomed = false;
        _settings.zoomPx = 0;

        // グリッドを復元
        if (proj.grid && proj.grid.length > 0) {
          _settings.rows = proj.grid.length;
          _settings.cols = proj.grid[0].length;
          el.rows.value = _settings.rows;
          el.cols.value = _settings.cols;
          const grid = proj.grid.map(r => Uint8Array.from(r));
          const { rowHints, colHints } = ImageProcessor.generateHints(grid);
          _editor.setCellSizeOverride(null);
          _editor.setGrid(grid, rowHints, colHints);
          _editor.setShowHints(_showHints);
          _editor.setBrushSize(_settings.brushSize);
          _editor.setZoomMode(_settings.zoomMode);
          _editor.setReferenceImage(_img, crop);
          _editor.setRefOpacity(_settings.overlayOpacity / 100);
        }

        _updateZoomModeBtn();
        _updateEdgeBoostVisibility();
        _refitGrid();
      };
      img.src = proj.imageData;
    };
    reader.readAsText(file);
  }

  // ─── 解ける設定を探す ─────────────────────────────────────

  let _search = null;

  function _searchSolvable() {
    if (!_img) { alert('先に画像を読み込んでください'); return; }
    if (_search) return;

    const crop = _cropTool.getCropRect();
    const W = _settings.cols, H = _settings.rows;
    const gray = ImageProcessor.grayCells(_img, crop, W, H);

    el.btnSearch.disabled = true;
    el.btnSearchCancel.style.display = '';
    el.searchProgress.style.display = '';
    el.searchBar.style.width = '0%';
    el.searchResult.className = 'ps-result';
    el.searchResult.textContent = `探しています…（${W}×${H}）`;
    el.searchCands.innerHTML = '';

    _search = PuzzleSearchClient.run('image', { gray, W, H, maxResults: 6 }, (done, total) => {
      el.searchBar.style.width = Math.round(done / total * 100) + '%';
    });

    _search.promise.then(res => {
      if (res.cancelled) {
        el.searchResult.className = 'ps-result';
        el.searchResult.textContent = '⏹ 中止しました';
        return;
      }
      el.searchBar.style.width = '100%';
      if (!res.candidates.length) {
        el.searchResult.className = 'ps-result ng';
        el.searchResult.textContent = '候補が見つかりませんでした（ほぼ真っ白・真っ黒の画像です）';
        return;
      }
      const solved = res.candidates.filter(c => c.solved).length;
      el.searchResult.className = 'ps-result ' + (solved ? 'ok' : 'warn');
      el.searchResult.innerHTML = (solved
        ? `✅ 答えが1つに決まる設定が見つかりました`
        : `⚠ 完全に解ける設定は見つかりませんでした。解ける割合の高い順に表示しています`)
        + `<span class="ps-sub">${res.tried}通りを試し、完全に解けるもの ${res.solvedCount}件（${(res.ms / 1000).toFixed(1)}秒）`
        + (res.reduced ? '。マス数が多いため試す数を減らしています' : '')
        + (solved ? '。下の候補から選べます' : '。マス数を減らすと見つかりやすくなります')
        + '</span>';
      _renderCandidates(res.candidates);
      _applyCandidate(res.candidates[0], 0);
      // 候補が下の「出力」欄に隠れないよう、見える位置までスクロール
      el.searchCands.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }).catch(err => {
      el.searchResult.className = 'ps-result ng';
      el.searchResult.textContent = 'エラー: ' + err.message;
    }).finally(() => {
      _search = null;
      el.btnSearch.disabled = false;
      el.btnSearchCancel.style.display = 'none';
      setTimeout(() => { el.searchProgress.style.display = 'none'; }, 600);
    });
  }

  function _renderCandidates(cands) {
    el.searchCands.innerHTML = '';
    cands.forEach((c, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ps-cand';
      const rows = c.grid.length, cols = c.grid[0].length;
      const px = Math.max(1, Math.floor(76 / Math.max(cols, rows)));
      const cv = document.createElement('canvas');
      cv.width = cols * px; cv.height = rows * px;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#1a1a1a';
      for (let r = 0; r < rows; r++) for (let x = 0; x < cols; x++) {
        if (c.grid[r][x]) ctx.fillRect(x * px, r * px, px, px);
      }
      const label = document.createElement('div');
      label.className = 'ps-cand-label';
      label.innerHTML = (c.solved ? '<span class="ok">✔ 解ける</span>' : `<span class="ng">${Math.floor(c.rate * 1000) / 10}%</span>`)
        + ` 黒${Math.round(c.blackRatio * 100)}%`;
      btn.title = `しきい値 ${c.settings.threshold}${c.settings.smooth ? '・ならし' : ''}・閉包 ${c.settings.closing}・孤立除去 ${c.settings.isolate}・最小塊 ${c.settings.minBlob}`;
      btn.append(cv, label);
      btn.addEventListener('click', () => _applyCandidate(c, i));
      el.searchCands.appendChild(btn);
    });
  }

  /** 候補の設定を反映して問題を作り直す */
  function _applyCandidate(c, index) {
    Object.assign(_settings, {
      mode: 'threshold', threshold: c.settings.threshold, smooth: c.settings.smooth,
      closing: c.settings.closing, isolate: c.settings.isolate, minBlob: c.settings.minBlob,
      brightness: 0, contrast: 0, edgeBoost: 0,
    });
    _applySettingsToUI(_settings);
    _updateEdgeBoostVisibility();
    _update();
    el.searchCands.querySelectorAll('.ps-cand').forEach((b, i) => b.classList.toggle('selected', i === index));

    _lastSolverResult = null;
    el.btnFillUnsolved.disabled = true;
    _editor.clearValidationOverlay();
    el.validateResult.textContent = c.solved ? '✅ 唯一解あり（探索で確認）' : `⚠ 部分解のみ ${Math.floor(c.rate * 100)}%（「解の検証」で未確定マスを確認できます）`;
    el.validateResult.className   = c.solved ? 'validate-ok' : 'validate-warn';
  }

  function _applySettingsToUI(s) {
    el.threshold.value      = s.threshold;    el.thresholdVal.textContent  = s.threshold;
    el.brightness.value     = s.brightness;   el.brightnessVal.textContent = s.brightness;
    el.contrast.value       = s.contrast;     el.contrastVal.textContent   = s.contrast;
    el.edgeBoost.value      = s.edgeBoost;    el.edgeBoostVal.textContent  = s.edgeBoost;
    el.closing.value        = s.closing;      el.closingVal.textContent    = s.closing;
    el.isolate.value        = s.isolate;      el.isolateVal.textContent    = s.isolate;
    el.minBlob.value        = s.minBlob;      el.minBlobVal.textContent    = s.minBlob;
    el.overlayOpacity.value = s.overlayOpacity; el.overlayVal.textContent  = s.overlayOpacity;
    el.zoom.value           = s.zoomPx || 8;
    el.cols.value           = s.cols;
    el.rows.value           = s.rows;
    el.autoRows.checked     = s.autoRows;
    if (el.smooth) el.smooth.checked = !!s.smooth;

    const radio = document.querySelector(`input[name="cr-mode"][value="${s.mode}"]`);
    if (radio) radio.checked = true;

    document.querySelectorAll('.cr-brush-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.size) === s.brushSize);
    });
  }

  return { init };
})();
