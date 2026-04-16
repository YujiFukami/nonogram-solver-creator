'use strict';

/**
 * grid-canvas.js — Canvas ベースのグリッド描画と操作
 * 300×300 マスに対応した高パフォーマンス実装
 */

// UNKNOWN / WHITE / BLACK は solver.js で定義済み（グローバル参照）
// 単独利用のためのフォールバック
const _UNKNOWN = (typeof UNKNOWN !== 'undefined') ? UNKNOWN : -1;
const _WHITE   = (typeof WHITE   !== 'undefined') ? WHITE   :  0;
const _BLACK   = (typeof BLACK   !== 'undefined') ? BLACK   :  1;

// 色定数（デフォルト値）
const COLOR = {
  BLACK:      '#1a1a1a',
  WHITE:      '#b2ebf2',  // 解答確定「白マス」: シアン系（未確定と区別しやすい）
  UNKNOWN:    '#f0f0f0',
  GRID_LINE:  '#cccccc',
  GRID_BOLD:  '#888888',
  HOVER:      'rgba(100, 150, 255, 0.3)',
  BORDER:     '#444444',
};

class GridCanvas {
  /**
   * @param {HTMLCanvasElement} canvas  描画対象のcanvas要素
   * @param {object} options
   * @param {number} options.rows        縦マス数
   * @param {number} options.cols        横マス数
   * @param {number} [options.cellSize]  セルサイズ(px)。未指定時は自動計算
   * @param {Function} [options.onCellClick]   クリック時コールバック (row, col, newState)
   * @param {Function} [options.onCellSizeChange] セルサイズ変更コールバック (newSize)
   */
  constructor(canvas, options) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.rows = options.rows;
    this.cols = options.cols;
    this.onCellClick = options.onCellClick || (() => {});
    this.onCellSizeChange = options.onCellSizeChange || (() => {});

    // グリッドデータ（UNKNOWN で初期化）
    this.grid = Array.from({ length: this.rows },
      () => new Array(this.cols).fill(_UNKNOWN));

    // セルサイズ（自動計算 or 指定値）
    this.cellSize = options.cellSize || this._calcDefaultCellSize();

    // ホバー中のセル
    this._hoverCell = null;
    // ドラッグ描画中
    this._dragging = false;
    this._dragState = null; // ドラッグ中に設定するマス状態

    this._bindEvents();
    this.resize(this.rows, this.cols);
  }

  // ─── 初期化・リサイズ ────────────────────────────────────

  /** グリッドサイズ変更 */
  resize(rows, cols) {
    this.rows = rows;
    this.cols = cols;

    // グリッドデータをリセット
    this.grid = Array.from({ length: rows },
      () => new Array(cols).fill(_UNKNOWN));

    this._updateCanvasSize();
    this.render();
  }

  /** セルサイズを設定して再描画 */
  setCellSize(size) {
    const clamped = Math.max(2, Math.min(40, size));
    if (this.cellSize === clamped) return;
    this.cellSize = clamped;
    this._updateCanvasSize();
    this.render();
    this.onCellSizeChange(clamped);
  }

  _calcDefaultCellSize() {
    const maxSize = Math.max(this.rows, this.cols);
    if (maxSize <= 20)  return 24;
    if (maxSize <= 50)  return 14;
    if (maxSize <= 100) return  8;
    if (maxSize <= 200) return  4;
    return 2;
  }

  _updateCanvasSize() {
    const cs = this.cellSize;
    this.canvas.width  = this.cols * cs;
    this.canvas.height = this.rows * cs;
    // CSS サイズはスクロールコンテナに任せる（device pixel ratio 対応は省略）
    this.canvas.style.width  = (this.cols * cs) + 'px';
    this.canvas.style.height = (this.rows * cs) + 'px';
  }

  // ─── グリッドデータ更新 ──────────────────────────────────

  /** グリッド全体を設定して再描画 */
  setGrid(grid) {
    this.grid = grid.map(row => [...row]);
    this.render();
  }

  /** 1マスの状態を設定 */
  setCell(row, col, state) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return;
    this.grid[row][col] = state;
    this._renderCell(row, col);
  }

  /** グリッドを未確定状態にリセット */
  reset() {
    this.grid = Array.from({ length: this.rows },
      () => new Array(this.cols).fill(_UNKNOWN));
    this.render();
  }

  // ─── 描画 ────────────────────────────────────────────────

  /** グリッド全体を再描画 */
  render() {
    const ctx = this.ctx;
    const cs = this.cellSize;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // マスを塗る
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this._fillCell(r, c, ctx, cs);
      }
    }

    // グリッド線を引く
    this._drawGridLines(ctx, cs);

    // ホバー
    if (this._hoverCell && cs >= 4) {
      const { r, c } = this._hoverCell;
      ctx.fillStyle = COLOR.HOVER;
      ctx.fillRect(c * cs, r * cs, cs, cs);
    }
  }

  /** 1マスだけ再描画（部分更新用） */
  _renderCell(row, col) {
    const ctx = this.ctx;
    const cs = this.cellSize;
    this._fillCell(row, col, ctx, cs);
    // その周辺の線も再描画
    this._drawCellBorder(row, col, ctx, cs);
  }

  _fillCell(r, c, ctx, cs) {
    const state = this.grid[r][c];
    switch (state) {
      case _BLACK:   ctx.fillStyle = COLOR.BLACK;   break;
      case _WHITE:   ctx.fillStyle = COLOR.WHITE;   break;
      default:       ctx.fillStyle = COLOR.UNKNOWN; break;
    }
    ctx.fillRect(c * cs, r * cs, cs, cs);
  }

  _drawGridLines(ctx, cs) {
    ctx.beginPath();
    ctx.strokeStyle = COLOR.GRID_LINE;
    ctx.lineWidth = 0.5;

    // 横線
    for (let r = 0; r <= this.rows; r++) {
      const bold = (r % 5 === 0);
      ctx.strokeStyle = bold ? COLOR.GRID_BOLD : COLOR.GRID_LINE;
      ctx.lineWidth   = bold ? (cs >= 8 ? 1.5 : 1) : 0.5;
      ctx.beginPath();
      ctx.moveTo(0, r * cs);
      ctx.lineTo(this.cols * cs, r * cs);
      ctx.stroke();
    }
    // 縦線
    for (let c = 0; c <= this.cols; c++) {
      const bold = (c % 5 === 0);
      ctx.strokeStyle = bold ? COLOR.GRID_BOLD : COLOR.GRID_LINE;
      ctx.lineWidth   = bold ? (cs >= 8 ? 1.5 : 1) : 0.5;
      ctx.beginPath();
      ctx.moveTo(c * cs, 0);
      ctx.lineTo(c * cs, this.rows * cs);
      ctx.stroke();
    }

    // 外枠
    ctx.strokeStyle = COLOR.BORDER;
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, this.cols * cs, this.rows * cs);
  }

  _drawCellBorder(row, col, ctx, cs) {
    // セル周辺の線だけ再描画（効率化のため使用）
    // 実装簡略化のためフル再描画を使う場合もある
    this._drawGridLines(ctx, cs);
  }

  // ─── イベント処理 ────────────────────────────────────────

  _bindEvents() {
    const canvas = this.canvas;

    canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
    canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
    canvas.addEventListener('mouseup',   (e) => this._onMouseUp(e));
    canvas.addEventListener('mouseleave',() => this._onMouseLeave());
    canvas.addEventListener('wheel',     (e) => this._onWheel(e), { passive: false });

    // タッチ操作（モバイル対応）
    canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    canvas.addEventListener('touchmove',  (e) => this._onTouchMove(e),  { passive: false });
    canvas.addEventListener('touchend',   (e) => this._onTouchEnd(e));
  }

  _getCellFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    const cs = this.cellSize;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const c = Math.floor(x / cs);
    const r = Math.floor(y / cs);
    if (r >= 0 && r < this.rows && c >= 0 && c < this.cols) {
      return { r, c };
    }
    return null;
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    const cell = this._getCellFromEvent(e);
    if (!cell) return;

    // クリックでマス状態を切り替え: UNKNOWN → BLACK → WHITE → UNKNOWN
    const cur = this.grid[cell.r][cell.c];
    const next = cur === _UNKNOWN ? _BLACK
               : cur === _BLACK   ? _WHITE
               : _UNKNOWN;

    this._dragging = true;
    this._dragState = next;
    this.setCell(cell.r, cell.c, next);
    this.onCellClick(cell.r, cell.c, next);
  }

  _onMouseMove(e) {
    const cell = this._getCellFromEvent(e);

    // ドラッグ中はマスを塗る
    if (this._dragging && cell) {
      if (this.grid[cell.r][cell.c] !== this._dragState) {
        this.setCell(cell.r, cell.c, this._dragState);
        this.onCellClick(cell.r, cell.c, this._dragState);
      }
    }

    // ホバー表示（セルサイズが十分な場合のみ）
    if (this.cellSize >= 4) {
      const prev = this._hoverCell;
      this._hoverCell = cell;
      const changed = (!prev && cell) || (prev && !cell) ||
        (prev && cell && (prev.r !== cell.r || prev.c !== cell.c));
      if (changed) this.render();
    }
  }

  _onMouseUp(e) {
    this._dragging = false;
    this._dragState = null;
  }

  _onMouseLeave() {
    this._hoverCell = null;
    this._dragging = false;
    this.render();
  }

  _onWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -2 : 2;
    this.setCellSize(this.cellSize + delta);
  }

  // タッチイベント
  _onTouchStart(e) {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    const touch = e.touches[0];
    const fakeEvent = { clientX: touch.clientX, clientY: touch.clientY, button: 0 };
    this._onMouseDown(fakeEvent);
  }

  _onTouchMove(e) {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    const touch = e.touches[0];
    const fakeEvent = { clientX: touch.clientX, clientY: touch.clientY };
    this._onMouseMove(fakeEvent);
  }

  _onTouchEnd(e) {
    this._onMouseUp({});
  }

  // ─── ズーム関連 ──────────────────────────────────────────

  zoomIn()  { this.setCellSize(this.cellSize + 1); }
  zoomOut() { this.setCellSize(this.cellSize - 1); }
  zoomFit(containerWidth, containerHeight) {
    const cs = Math.min(
      Math.floor(containerWidth  / this.cols),
      Math.floor(containerHeight / this.rows),
      40
    );
    this.setCellSize(Math.max(2, cs));
  }

  // ─── 色設定 ──────────────────────────────────────────────

  /**
   * セル色を変更して再描画
   * @param {'BLACK'|'WHITE'|'UNKNOWN'} key
   * @param {string} colorValue  CSS色文字列
   */
  setCellColor(key, colorValue) {
    if (key in COLOR) {
      COLOR[key] = colorValue;
      this.render();
    }
  }

  // ─── ユーティリティ ──────────────────────────────────────

  /** PNG 画像として canvas を取得（blob URL） */
  toImageURL() {
    return this.canvas.toDataURL('image/png');
  }

  /** canvas の内容を PNG としてダウンロード */
  downloadAsPNG(filename = 'nonogram.png') {
    const a = document.createElement('a');
    a.href = this.toImageURL();
    a.download = filename;
    a.click();
  }
}
