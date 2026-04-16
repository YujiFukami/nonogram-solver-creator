'use strict';

/**
 * print-puzzle.js — ノノグラム問題を印刷用ウィンドウで開く
 */
const PrintPuzzle = (() => {

  /**
   * @param {number[][]} rowHints
   * @param {number[][]} colHints
   * @param {string} [name]
   */
  function open(rowHints, colHints, name) {
    const rows = rowHints.length;
    const cols = colHints.length;
    if (!rows || !cols) return;
    name = name || 'Nonogram';

    const maxColDepth = Math.max(...colHints.map(h => h.length), 1);
    const maxRowDepth = Math.max(...rowHints.map(h => h.length), 1);

    // 横長かどうか判定して印刷向きを決定
    // 横長（cols/rows > 1.15）なら landscape、それ以外は portrait
    const landscape = (cols / rows) > 1.15;
    // A4 印刷域: portrait=750×1000px / landscape=1000×750px
    const printW = landscape ? 1000 : 750;
    const printH = landscape ? 750  : 1000;
    const tentW = (printW - maxRowDepth * 12) / cols;
    const tentH = (printH - maxColDepth * 14) / rows;
    const cs    = Math.max(7, Math.min(28, Math.floor(Math.min(tentW, tentH))));

    const fs      = Math.max(6, Math.min(11, Math.floor(cs * 0.65)));
    const cellHH  = fs + 3;   // 列ヒント1行の高さ
    const cellHW  = fs + 5;   // 行ヒント1列の幅
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
    ctx.font      = `bold ${fs}px sans-serif`;
    ctx.fillStyle = '#000';

    // ── 列ヒント ──────────────────────────────────────────
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    for (let c = 0; c < cols; c++) {
      const h = colHints[c];
      const x = rowHintW + c * cs + cs / 2;
      for (let i = 0; i < h.length; i++) {
        const y = (maxColDepth - h.length + i) * cellHH + cellHH / 2;
        ctx.fillText(String(h[i]), x, y);
      }
    }

    // ── 行ヒント ──────────────────────────────────────────
    ctx.textAlign = 'right';
    for (let r = 0; r < rows; r++) {
      const h = rowHints[r];
      const y = colHintH + r * cs + cs / 2;
      for (let i = 0; i < h.length; i++) {
        const x = (maxRowDepth - h.length + i + 1) * cellHW;
        ctx.fillText(String(h[i]), x, y);
      }
    }

    // ── グリッド線 ────────────────────────────────────────
    const gx = rowHintW, gy = colHintH;
    for (let r = 0; r <= rows; r++) {
      ctx.lineWidth   = r % 5 === 0 ? 1.5 : 0.5;
      ctx.strokeStyle = '#000';
      ctx.beginPath();
      ctx.moveTo(gx, gy + r * cs);
      ctx.lineTo(gx + cols * cs, gy + r * cs);
      ctx.stroke();
    }
    for (let c = 0; c <= cols; c++) {
      ctx.lineWidth   = c % 5 === 0 ? 1.5 : 0.5;
      ctx.strokeStyle = '#000';
      ctx.beginPath();
      ctx.moveTo(gx + c * cs, gy);
      ctx.lineTo(gx + c * cs, gy + rows * cs);
      ctx.stroke();
    }

    // 外枠・ヒント境界
    ctx.lineWidth = 2; ctx.strokeStyle = '#000';
    ctx.strokeRect(gx, gy, cols * cs, rows * cs);
    ctx.beginPath(); ctx.moveTo(0, gy);  ctx.lineTo(gx, gy);  ctx.stroke();
    ctx.beginPath(); ctx.moveTo(gx, 0);  ctx.lineTo(gx, gy);  ctx.stroke();

    const dataUrl = canvas.toDataURL('image/png');

    // ── 印刷ウィンドウ ────────────────────────────────────
    const winW = landscape ? Math.min(1200, W + 80) : Math.min(960,  W + 80);
    const winH = landscape ? Math.min(900,  H + 140): Math.min(1120, H + 140);
    const win = window.open('', '_blank', `width=${winW},height=${winH}`);
    if (!win) { alert('ポップアップがブロックされました。ブラウザの設定で許可してください。'); return; }

    win.document.write(`<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="UTF-8">
<title>${_esc(name)}</title>
<style>
  *    { box-sizing:border-box; margin:0; padding:0; }
  body { padding:14px; font-family:sans-serif; background:#fff; }
  h2   { font-size:13px; margin-bottom:8px; color:#333; }
  img  { display:block; max-width:100%; height:auto; }
  .toolbar { margin-top:10px; font-size:11px; color:#888; }
  .toolbar button { padding:4px 14px; cursor:pointer; margin-right:8px; }
  @media print {
    @page { size:A4 ${landscape ? 'landscape' : 'portrait'}; margin:10mm; }
    body  { padding:0; }
    h2    { margin-bottom:6px; }
    .toolbar { display:none; }
  }
</style>
</head><body>
<h2>${_esc(name)}&ensp;<span style="font-weight:normal;font-size:11px;color:#666;">${rows}行 × ${cols}列</span></h2>
<img src="${dataUrl}" alt="nonogram puzzle">
<div class="toolbar">
  <button onclick="window.print()">🖨 印刷</button>
  印刷ダイアログが出ない場合はこのボタンを押してください
</div>
<script>window.addEventListener('load', () => window.print());<\/script>
</body></html>`);
    win.document.close();
  }

  function _esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { open };
})();
