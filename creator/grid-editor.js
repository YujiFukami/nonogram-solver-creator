'use strict';

/**
 * grid-editor.js — ノノグラムグリッドの表示・手動編集（Canvas ベース）
 * - クリック/ドラッグで黒/白を切り替え（ブラシサイズ対応）
 * - 参照画像オーバーレイ表示
 * - ズームモード: ホイールでマウス位置中心ズーム
 */
class GridEditor {
  constructor(container) {
    this._container  = container;
    this._canvas     = document.createElement('canvas');
    this._canvas.style.display = 'block';
    this._canvas.style.cursor  = 'crosshair';
    container.appendChild(this._canvas);

    this._grid     = [];
    this._rows     = 0;
    this._cols     = 0;
    this._rowHints = [];
    this._colHints = [];
    this._showHints        = true;
    this._zoomScale        = 1.0;
    this._cellSizeOverride = null;  // null=auto, N=絶対px指定
    this._brushSize        = 1;
    this._zoomMode         = false; // ホイールズームON/OFF

    // 参照画像オーバーレイ
    this._refImg     = null;
    this._refCrop    = null;
    this._refOpacity = 0;

    // 検証オーバーレイ
    this._overlayMask  = null;
    this._overlayColor = 'rgba(255,102,0,0.55)';

    this._painting = null;

    // セルサイズ変更通知コールバック
    this.onCellSizeChange = null;

    this._bindEvents();
  }

  // ─── 公開 API ────────────────────────────────────────────────

  setGrid(grid, rowHints, colHints) {
    this._rows     = grid.length;
    this._cols     = this._rows > 0 ? grid[0].length : 0;
    this._grid     = grid.map(r => Uint8Array.from(r));
    this._rowHints = rowHints.map(h => [...h]);
    this._colHints = colHints.map(h => [...h]);
    this._calcLayout();
    this.render();
  }

  setShowHints(visible) {
    this._showHints = visible;
    this._calcLayout();
    this.render();
  }

  setZoom(scale) {
    this._zoomScale = scale;
    if (this._cellSizeOverride === null) {
      this._calcLayout();
      this.render();
    }
  }

  /** 絶対セルサイズ(px)で指定。null でオート復帰 */
  setCellSizeOverride(px) {
    this._cellSizeOverride = (px > 0) ? Math.max(1, Math.min(40, px)) : null;
    this._calcLayout();
    this.render();
  }

  setBrushSize(size) { this._brushSize = Math.max(1, size); }

  setReferenceImage(img, crop) {
    this._refImg  = img;
    this._refCrop = crop;
    this.render();
  }

  setRefOpacity(opacity) {
    this._refOpacity = Math.max(0, Math.min(1, opacity));
    this.render();
  }

  /** ホイールズームモードのON/OFF */
  setZoomMode(enabled) {
    this._zoomMode = enabled;
    this._canvas.style.cursor = enabled ? 'zoom-in' : 'crosshair';
  }

  setValidationOverlay(mask, color) {
    this._overlayMask  = mask;
    this._overlayColor = color || 'rgba(255,102,0,0.55)';
    this.render();
  }

  clearValidationOverlay() {
    this._overlayMask = null;
    this.render();
  }

  getCellSize() { return this._cs || 0; }
  getGrid()     { return this._grid; }
  getHints()    { return ImageProcessor.generateHints(this._grid); }

  // ─── レイアウト計算 ──────────────────────────────────────────

  _calcLayout() {
    if (!this._rows || !this._cols) return;

    this._hintCols = this._showHints ? Math.max(1, ...this._rowHints.map(h => h.length)) : 0;
    this._hintRows = this._showHints ? Math.max(1, ...this._colHints.map(h => h.length)) : 0;

    const contW = this._container.clientWidth  || 700;
    const contH = this._container.clientHeight || 450;

    const HCW = this._showHints ? 18 : 0;
    const HRH = this._showHints ? 14 : 0;

    const availW = contW - (this._hintCols * HCW) - 4;
    const availH = contH - (this._hintRows * HRH) - 4;
    const autoCs = Math.max(4, Math.min(28,
      Math.floor(Math.min(availW / this._cols, availH / this._rows))
    ));

    // セルサイズ決定：絶対指定 > zoomScale > auto
    let cs;
    if (this._cellSizeOverride !== null) {
      cs = this._cellSizeOverride;
    } else if (this._zoomScale) {
      cs = Math.max(1, Math.round(autoCs * this._zoomScale));
    } else {
      cs = autoCs;
    }
    this._cs = cs;

    const effectiveHints = this._showHints && cs >= 4;
    this._hintCols = effectiveHints ? Math.max(1, ...this._rowHints.map(h => h.length)) : 0;
    this._hintRows = effectiveHints ? Math.max(1, ...this._colHints.map(h => h.length)) : 0;
    this._effectiveHints = effectiveHints;

    this._HCW = effectiveHints ? (HCW || cs) : 0;
    this._HRH = effectiveHints ? (HRH || cs) : 0;

    this._offX = this._hintCols * this._HCW;
    this._offY = this._hintRows * this._HRH;

    const totalW = this._offX + this._cols * cs;
    const totalH = this._offY + this._rows * cs;
    this._canvas.width  = totalW;
    this._canvas.height = totalH;
    this._canvas.style.width  = totalW + 'px';
    this._canvas.style.height = totalH + 'px';
  }

  // ─── 描画 ────────────────────────────────────────────────────

  render() {
    if (!this._rows || !this._cols) return;
    const ctx = this._canvas.getContext('2d');
    const { _cs: cs, _offX: ox, _offY: oy } = this;
    const W = this._canvas.width, H = this._canvas.height;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#f8f8f8';
    ctx.fillRect(0, 0, W, H);

    if (this._effectiveHints) {
      ctx.fillStyle = '#e8f0fe';
      ctx.fillRect(0, 0, ox, H);
      ctx.fillRect(0, 0, W, oy);
      ctx.fillStyle = '#c7d9fd';
      ctx.fillRect(0, 0, ox, oy);
    }

    // セル
    for (let r = 0; r < this._rows; r++) {
      for (let c = 0; c < this._cols; c++) {
        ctx.fillStyle = this._grid[r][c] ? '#1a1a1a' : '#ffffff';
        ctx.fillRect(ox + c * cs, oy + r * cs, cs, cs);
      }
    }

    // 参照画像オーバーレイ
    if (this._refImg && this._refCrop && this._refOpacity > 0) {
      const crop = this._refCrop;
      ctx.globalAlpha = this._refOpacity;
      ctx.drawImage(this._refImg, crop.x, crop.y, crop.w, crop.h,
        ox, oy, this._cols * cs, this._rows * cs);
      ctx.globalAlpha = 1;
    }

    // 検証オーバーレイ
    if (this._overlayMask) {
      ctx.fillStyle = this._overlayColor;
      for (let r = 0; r < this._rows; r++) {
        if (!this._overlayMask[r]) continue;
        for (let c = 0; c < this._cols; c++) {
          if (this._overlayMask[r][c])
            ctx.fillRect(ox + c * cs, oy + r * cs, cs, cs);
        }
      }
    }

    // グリッド線
    for (let r = 0; r <= this._rows; r++) {
      const y = oy + r * cs, big = r % 5 === 0;
      ctx.strokeStyle = big ? '#888' : '#ddd';
      ctx.lineWidth   = big ? 1 : 0.5;
      ctx.beginPath(); ctx.moveTo(ox, y); ctx.lineTo(W, y); ctx.stroke();
    }
    for (let c = 0; c <= this._cols; c++) {
      const x = ox + c * cs, big = c % 5 === 0;
      ctx.strokeStyle = big ? '#888' : '#ddd';
      ctx.lineWidth   = big ? 1 : 0.5;
      ctx.beginPath(); ctx.moveTo(x, oy); ctx.lineTo(x, H); ctx.stroke();
    }

    // ヒント数字
    if (this._effectiveHints) {
      const fontSize = Math.max(8, Math.min(12, cs - 2));
      ctx.font = `${fontSize}px sans-serif`;
      ctx.fillStyle = '#333';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const { _HCW: hcw, _HRH: hrh } = this;

      for (let r = 0; r < this._rows; r++) {
        const hints = this._rowHints[r];
        const startCol = this._hintCols - hints.length;
        hints.forEach((v, i) => {
          if (v === 0) return;
          ctx.fillText(v, (startCol+i)*hcw + hcw/2, oy + r*cs + cs/2);
        });
      }
      for (let c = 0; c < this._cols; c++) {
        const hints = this._colHints[c];
        const startRow = this._hintRows - hints.length;
        hints.forEach((v, i) => {
          if (v === 0) return;
          ctx.fillText(v, ox + c*cs + cs/2, (startRow+i)*hrh + hrh/2);
        });
      }

      ctx.strokeStyle = '#93c5fd';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(W, oy); ctx.stroke();
    }
  }

  // ─── イベント ────────────────────────────────────────────────

  _bindEvents() {
    const c = this._canvas;
    c.addEventListener('mousedown',   e => this._onDown(e));
    c.addEventListener('mousemove',   e => this._onMove(e));
    c.addEventListener('mouseup',     () => { this._painting = null; });
    c.addEventListener('mouseleave',  () => { this._painting = null; });
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('wheel',       e => this._onWheel(e), { passive: false });
  }

  // ─── ホイールズーム ──────────────────────────────────────────

  _onWheel(e) {
    if (!this._zoomMode) return; // zoom mode OFF → スクロールに任せる

    e.preventDefault();

    const canvasRect = this._canvas.getBoundingClientRect();
    const scrollEl   = document.getElementById('cr-grid-section') ||
                       this._container.parentElement;
    if (!scrollEl) return;

    const scrollRect = scrollEl.getBoundingClientRect();

    // マウスのキャンバス上の位置 (CSS px)
    const mouseX = e.clientX - canvasRect.left;
    const mouseY = e.clientY - canvasRect.top;

    const oldCs = this._cs;
    const delta = e.deltaY > 0 ? -1 : 1;
    const newCs = Math.max(1, Math.min(40, oldCs + delta));
    if (newCs === oldCs) return;

    // スクロールコンテンツ内でのキャンバス左上座標（リサイズ前）
    const canvasOffX = canvasRect.left - scrollRect.left + scrollEl.scrollLeft;
    const canvasOffY = canvasRect.top  - scrollRect.top  + scrollEl.scrollTop;

    // リサイズ適用
    this._cellSizeOverride = newCs;
    this._calcLayout();
    this.render();

    // マウス位置が変わらないようにスクロールを調整
    const scale = newCs / oldCs;
    scrollEl.scrollLeft = Math.max(0, canvasOffX + mouseX * scale - (e.clientX - scrollRect.left));
    scrollEl.scrollTop  = Math.max(0, canvasOffY + mouseY * scale - (e.clientY - scrollRect.top));

    if (this.onCellSizeChange) this.onCellSizeChange(newCs);
  }

  // ─── ペイント操作 ────────────────────────────────────────────

  _cellAt(e) {
    const rect   = this._canvas.getBoundingClientRect();
    const scaleX = this._canvas.width  / rect.width;
    const scaleY = this._canvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top)  * scaleY;
    const c  = Math.floor((px - this._offX) / this._cs);
    const r  = Math.floor((py - this._offY) / this._cs);
    if (r < 0 || r >= this._rows || c < 0 || c >= this._cols) return null;
    return { r, c };
  }

  _applyPaint(r, c) {
    const half = Math.floor(this._brushSize / 2);
    let changed = false;
    for (let dr = -half; dr <= half; dr++) {
      for (let dc = -half; dc <= half; dc++) {
        const nr = r+dr, nc = c+dc;
        if (nr < 0 || nr >= this._rows || nc < 0 || nc >= this._cols) continue;
        if (this._grid[nr][nc] !== this._painting) {
          this._grid[nr][nc] = this._painting;
          changed = true;
        }
      }
    }
    if (changed) {
      const { rowHints, colHints } = ImageProcessor.generateHints(this._grid);
      this._rowHints = rowHints;
      this._colHints = colHints;
      this._overlayMask = null;
      this.render();
    }
  }

  _onDown(e) {
    const cell = this._cellAt(e);
    if (!cell) return;
    this._painting = e.button === 2
      ? 1
      : (this._grid[cell.r][cell.c] === 1 ? 0 : 1);
    this._applyPaint(cell.r, cell.c);
  }

  _onMove(e) {
    if (this._painting === null) return;
    const cell = this._cellAt(e);
    if (cell) this._applyPaint(cell.r, cell.c);
  }
}
