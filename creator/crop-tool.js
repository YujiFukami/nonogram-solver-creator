'use strict';

/**
 * crop-tool.js — 画像上にドラッグ可能なトリミング枠を描画する
 *
 * 使い方:
 *   const tool = new CropTool(overlayCanvas, onChange);
 *   tool.setImage(img, dispW, dispH);
 *   const rect = tool.getCropRect(); // {x, y, w, h} 元画像ピクセル座標
 */
class CropTool {
  constructor(canvas, onChange) {
    this._canvas   = canvas;
    this._ctx      = canvas.getContext('2d');
    this._onChange = onChange;
    this._img      = null;

    // トリミング枠 (canvas 表示座標)
    this._cx = 0; this._cy = 0; this._cw = 0; this._ch = 0;

    this._drag     = null;   // {type, startX, startY, origRect}
    this._HS       = 9;      // ハンドルサイズ px

    this._bindEvents();
  }

  /** 画像セット・初期化（全体をデフォルトトリミング） */
  setImage(img, dispW, dispH) {
    this._img  = img;
    this._canvas.width  = dispW;
    this._canvas.height = dispH;
    this._cx = 0; this._cy = 0; this._cw = dispW; this._ch = dispH;
    this.render();
  }

  /** トリミング枠を元画像ピクセル座標で返す */
  getCropRect() {
    if (!this._img) return { x: 0, y: 0, w: 1, h: 1 };
    const sx = this._img.naturalWidth  / this._canvas.width;
    const sy = this._img.naturalHeight / this._canvas.height;
    return {
      x: Math.round(this._cx * sx),
      y: Math.round(this._cy * sy),
      w: Math.max(1, Math.round(this._cw * sx)),
      h: Math.max(1, Math.round(this._ch * sy)),
    };
  }

  /** トリミング枠を元画像ピクセル座標で設定する */
  setCrop(rect) {
    if (!this._img) return;
    const sx = this._img.naturalWidth  / this._canvas.width;
    const sy = this._img.naturalHeight / this._canvas.height;
    this._cw = Math.max(20, Math.round(rect.w / sx));
    this._ch = Math.max(20, Math.round(rect.h / sy));
    this._cx = Math.max(0, Math.min(Math.round(rect.x / sx), this._canvas.width  - this._cw));
    this._cy = Math.max(0, Math.min(Math.round(rect.y / sy), this._canvas.height - this._ch));
    this.render();
  }

  /** トリミング枠のアスペクト比 (w/h) を canvas 座標で返す */
  getCropAspect() {
    return this._ch > 0 ? this._cw / this._ch : 1;
  }

  render() {
    const ctx = this._ctx;
    const W = this._canvas.width, H = this._canvas.height;
    const { _cx: x, _cy: y, _cw: w, _ch: h, _HS: hs } = this;

    ctx.clearRect(0, 0, W, H);

    // 枠外を暗くする
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, W, y);
    ctx.fillRect(0, y + h, W, H - y - h);
    ctx.fillRect(0, y, x, h);
    ctx.fillRect(x + w, y, W - x - w, h);

    // 枠の境界線
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    // 三分割補助線
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth   = 0.5;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(x + w * i / 3, y); ctx.lineTo(x + w * i / 3, y + h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y + h * i / 3); ctx.lineTo(x + w, y + h * i / 3); ctx.stroke();
    }

    // コーナーハンドル
    ctx.fillStyle = '#fff';
    [[x, y], [x + w - hs, y], [x, y + h - hs], [x + w - hs, y + h - hs]]
      .forEach(([hx, hy]) => ctx.fillRect(hx, hy, hs, hs));

    // 辺中央ハンドル
    [[x + w / 2 - hs / 2, y], [x + w / 2 - hs / 2, y + h - hs],
     [x, y + h / 2 - hs / 2], [x + w - hs, y + h / 2 - hs / 2]]
      .forEach(([hx, hy]) => ctx.fillRect(hx, hy, hs, hs));
  }

  // ─── イベント ───────────────────────────────────────────────

  _bindEvents() {
    const c = this._canvas;
    c.addEventListener('mousedown',  e => this._onDown(e));
    c.addEventListener('mousemove',  e => this._onMove(e));
    c.addEventListener('mouseup',    () => this._onUp());
    c.addEventListener('mouseleave', () => this._onUp());
    c.addEventListener('touchstart', e => { e.preventDefault(); this._onDown(this._te(e)); }, { passive: false });
    c.addEventListener('touchmove',  e => { e.preventDefault(); this._onMove(this._te(e)); }, { passive: false });
    c.addEventListener('touchend',   () => this._onUp());
  }

  _te(e) { return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY }; }

  _pos(e) {
    const r = this._canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _hitType(px, py) {
    const { _cx: x, _cy: y, _cw: w, _ch: h, _HS: hs } = this;
    const nr = (a, b) => Math.abs(a - b) <= hs;
    if (nr(px, x)   && nr(py, y))   return 'nw';
    if (nr(px, x+w) && nr(py, y))   return 'ne';
    if (nr(px, x)   && nr(py, y+h)) return 'sw';
    if (nr(px, x+w) && nr(py, y+h)) return 'se';
    if (nr(py, y)   && px > x && px < x+w) return 'n';
    if (nr(py, y+h) && px > x && px < x+w) return 's';
    if (nr(px, x)   && py > y && py < y+h) return 'w';
    if (nr(px, x+w) && py > y && py < y+h) return 'e';
    if (px > x && px < x+w && py > y && py < y+h) return 'move';
    return null;
  }

  _cursor(t) {
    return { nw:'nw-resize', ne:'ne-resize', sw:'sw-resize', se:'se-resize',
             n:'n-resize',   s:'s-resize',   w:'w-resize',   e:'e-resize',
             move:'move' }[t] || 'default';
  }

  _onDown(e) {
    const { x, y } = this._pos(e);
    const type = this._hitType(x, y);
    if (!type) return;
    this._drag = { type, startX: x, startY: y,
      origRect: { x: this._cx, y: this._cy, w: this._cw, h: this._ch } };
    this._canvas.style.cursor = this._cursor(type);
  }

  _onMove(e) {
    const { x, y } = this._pos(e);
    if (!this._drag) {
      const t = this._hitType(x, y);
      this._canvas.style.cursor = t ? this._cursor(t) : 'crosshair';
      return;
    }
    const dx = x - this._drag.startX;
    const dy = y - this._drag.startY;
    const { x: ox, y: oy, w: ow, h: oh } = this._drag.origRect;
    const W = this._canvas.width, H = this._canvas.height;
    const MIN = 20;
    const t = this._drag.type;
    let nx = ox, ny = oy, nw = ow, nh = oh;

    if (t === 'move')      { nx = ox + dx; ny = oy + dy; }
    if (t.includes('e'))   { nw = ow + dx; }
    if (t.includes('s'))   { nh = oh + dy; }
    if (t.includes('w'))   { nx = ox + dx; nw = ow - dx; }
    if (t.includes('n'))   { ny = oy + dy; nh = oh - dy; }

    if (nw < MIN) { if (t.includes('w')) nx = ox + ow - MIN; nw = MIN; }
    if (nh < MIN) { if (t.includes('n')) ny = oy + oh - MIN; nh = MIN; }
    nx = Math.max(0, Math.min(nx, W - nw));
    ny = Math.max(0, Math.min(ny, H - nh));
    nw = Math.min(nw, W - nx);
    nh = Math.min(nh, H - ny);

    this._cx = nx; this._cy = ny; this._cw = nw; this._ch = nh;
    this.render();
    this._onChange();
  }

  _onUp() {
    this._drag = null;
    this._canvas.style.cursor = 'crosshair';
  }
}
