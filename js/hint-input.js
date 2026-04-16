'use strict';

/**
 * hint-input.js — ヒント入力UI管理 (v3)
 *
 * 構造:
 *   ・ヒント表示: グリッド上/左に数字をグリッド線付きで表示（読み取り専用）
 *   ・入力パネル: パズル上部の専用入力欄（VBAルールで入力→表示に反映）
 *   ・クリック選択: ヒント表示をクリックして対象行/列を選択
 *
 * VBA版入力ルール（Mod05_問題入力.bas 互換）
 */
class HintInput {
  constructor(options) {
    this.rowContainer   = options.rowContainer;
    this.colContainer   = options.colContainer;
    this.inputField     = options.inputField;     // <input> for typing
    this.inputLabel     = options.inputLabel;      // <span> for "行 X のヒント:"
    this.inputCurrent   = options.inputCurrent;    // <span> for current hints display
    this.rows           = options.rows;
    this.cols           = options.cols;
    this.cellSize       = options.cellSize || 24;
    this.onChange       = options.onChange       || (() => {});
    this.onLayoutChange = options.onLayoutChange || (() => {});

    this.numCellW = options.cellSize || 24; // 行ヒント: 1数字あたりの幅(px)、セルサイズに連動

    this.rowHints = Array.from({ length: this.rows }, () => []);
    this.colHints = Array.from({ length: this.cols }, () => []);

    // 現在選択中の行/列
    this._editType  = 'row'; // 'row' or 'col'
    this._editIndex = 0;

    // DOM キャッシュ
    this._rowCells = []; // <div> per row (表示用)
    this._colCells = []; // <div> per col (表示用)

    this._build();
    this._bindInputPanel();
    this._selectLine('row', 0);
  }

  // ─────────────────────────────────────────────────────────────
  //  構築（グリッド線付き表示セル）
  // ─────────────────────────────────────────────────────────────

  _build() {
    this._buildRowCells();
    this._buildColCells();
    this._recalcLayout();
  }

  /** 行ヒント表示セル（左側・グリッド線付き） */
  _buildRowCells() {
    this.rowContainer.innerHTML = '';
    this._rowCells = [];
    const cs = this.cellSize;

    for (let r = 0; r < this.rows; r++) {
      const cell = document.createElement('div');
      cell.className = 'rh-cell';
      cell.style.height = cs + 'px';
      if (r % 5 === 0 && r > 0) cell.classList.add('rh-sep5');
      cell.dataset.row = r;
      cell.addEventListener('click', () => this._selectLine('row', r));
      this.rowContainer.appendChild(cell);
      this._rowCells.push(cell);
    }
  }

  /** 列ヒント表示セル（上側・グリッド線付き、数字縦積み） */
  _buildColCells() {
    this.colContainer.innerHTML = '';
    this._colCells = [];
    const cs = this.cellSize;

    for (let c = 0; c < this.cols; c++) {
      const cell = document.createElement('div');
      cell.className = 'ch-cell';
      cell.style.width = cs + 'px';
      if (c % 5 === 0 && c > 0) cell.classList.add('ch-sep5');
      cell.dataset.col = c;
      cell.addEventListener('click', () => this._selectLine('col', c));
      this.colContainer.appendChild(cell);
      this._colCells.push(cell);
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  ヒント表示の描画
  // ─────────────────────────────────────────────────────────────

  _renderRowCell(r) {
    const cell = this._rowCells[r];
    if (!cell) return;
    const h = this.rowHints[r] || [];
    const w = this.numCellW;
    const fs = Math.max(7, Math.min(12, Math.floor(w * 0.65))) + 'px';
    cell.innerHTML = '';
    h.forEach(n => {
      const s = document.createElement('span');
      s.className = 'rh-num';
      s.style.width = w + 'px';
      s.style.fontSize = fs;
      s.textContent = n;
      cell.appendChild(s);
    });
  }

  _renderColCell(c) {
    const cell = this._colCells[c];
    if (!cell) return;
    const cs = this.cellSize;
    const fs = Math.max(7, Math.min(12, Math.floor(cs * 0.65))) + 'px';
    const h = this.colHints[c] || [];
    cell.innerHTML = '';
    h.forEach(n => {
      const s = document.createElement('span');
      s.className = 'ch-num';
      s.textContent = n;
      s.style.height = cs + 'px';
      s.style.lineHeight = cs + 'px';
      s.style.fontSize = fs;
      cell.appendChild(s);
    });
  }

  _renderAll() {
    for (let r = 0; r < this.rows; r++) this._renderRowCell(r);
    for (let c = 0; c < this.cols; c++) this._renderColCell(c);
  }

  // ─────────────────────────────────────────────────────────────
  //  入力パネル
  // ─────────────────────────────────────────────────────────────

  _bindInputPanel() {
    if (!this.inputField) return;

    this.inputField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const raw = this.inputField.value.trim();
        this._commitInput();
        // 0 入力 or 空入力のとき次の行/列へ移動。数字があれば同じ行/列に留まる
        if (raw === '0' || raw === '') this._moveNextLine();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this._commitInput();
        this._moveLine(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._commitInput();
        this._moveLine(1);
      }
    });
  }

  _selectLine(type, index) {
    // ハイライト除去
    this._rowCells.forEach(c => c.classList.remove('selected'));
    this._colCells.forEach(c => c.classList.remove('selected'));

    this._editType = type;
    this._editIndex = index;

    // ハイライト追加
    if (type === 'row' && this._rowCells[index]) {
      this._rowCells[index].classList.add('selected');
    } else if (type === 'col' && this._colCells[index]) {
      this._colCells[index].classList.add('selected');
    }

    // ラベル更新（i18n対応）
    const labelKey = type === 'row' ? 'solver.hintLabel.row' : 'solver.hintLabel.col';
    const label = (typeof I18n !== 'undefined')
      ? I18n.t(labelKey, { n: index + 1 })
      : (type === 'row' ? `行 ${index + 1} のヒント:` : `列 ${index + 1} のヒント:`);
    if (this.inputLabel) this.inputLabel.textContent = label;

    // 現在値表示
    const hints = type === 'row' ? this.rowHints[index] : this.colHints[index];
    if (this.inputCurrent) {
      this.inputCurrent.textContent = hints && hints.length > 0
        ? `[${hints.join(', ')}]` : '';
    }

    // 入力欄クリア＆フォーカス
    if (this.inputField) {
      this.inputField.value = '';
      this.inputField.focus();
    }
  }

  _commitInput() {
    if (!this.inputField) return;
    const raw = this.inputField.value.trim();
    if (raw === '') return;

    const type = this._editType;
    const idx  = this._editIndex;
    const maxSize = type === 'row' ? this.cols : this.rows;
    const current = type === 'row' ? this.rowHints[idx] : this.colHints[idx];

    const newHints = this._applyInputRule(raw, current || [], maxSize);

    if (type === 'row') {
      this.rowHints[idx] = newHints;
      this._renderRowCell(idx);
    } else {
      this.colHints[idx] = newHints;
      this._renderColCell(idx);
    }

    this.onChange(type, idx, newHints);
    this._recalcLayout();

    // 入力欄クリア、現在値更新
    this.inputField.value = '';
    if (this.inputCurrent) {
      this.inputCurrent.textContent = newHints.length > 0
        ? `[${newHints.join(', ')}]` : '';
    }
  }

  _moveNextLine() {
    this._moveLine(1);
  }

  _moveLine(delta) {
    const type = this._editType;
    let idx = this._editIndex + delta;
    const max = type === 'row' ? this.rows : this.cols;
    if (idx < 0) idx = 0;
    if (idx >= max) {
      // 行→列 or 列→行 に切り替え
      if (type === 'row') {
        this._selectLine('col', 0);
      } else {
        this._selectLine('row', 0);
      }
      return;
    }
    this._selectLine(type, idx);
  }

  // ─────────────────────────────────────────────────────────────
  //  VBA版入力ルール
  // ─────────────────────────────────────────────────────────────

  _applyInputRule(value, currentHints, maxSize) {
    // スペース区切りの複数数字（直接編集）
    if (/^\s*\d+(\s+\d+)*\s*$/.test(value)) {
      const nums = value.trim().split(/\s+/).map(Number).filter(n => n > 0);
      if (nums.length > 1) return nums;
    }

    let hints = [...currentHints];

    if (value === '..') return [];
    if (value === '.')  { hints.pop(); return hints; }
    if (value === '0')  return hints; // 次行移動（commitInput後にmoveNextLineで処理）

    const digits = value.replace(/[^0-9]/g, '');
    if (digits.length === 0) return hints;

    const num = parseInt(digits, 10);
    if (isNaN(num) || num <= 0) return hints;

    if (digits.length === 1) {
      hints.push(num);
    } else if (digits.length <= 3 && num <= maxSize) {
      hints.push(num);
    } else {
      for (const ch of digits) {
        const d = parseInt(ch, 10);
        if (d > 0) hints.push(d);
      }
    }
    return hints;
  }

  // ─────────────────────────────────────────────────────────────
  //  レイアウト計算
  // ─────────────────────────────────────────────────────────────

  _maxColHintCount() {
    return Math.max(1, ...this.colHints.map(h => h.length));
  }
  _maxRowHintCount() {
    return Math.max(1, ...this.rowHints.map(h => h.length));
  }

  _recalcLayout() {
    const cs = this.cellSize;
    const maxCol = this._maxColHintCount();
    const maxRow = this._maxRowHintCount();

    const colHintHeight = maxCol * cs;
    const rowHintWidth  = maxRow * this.numCellW + 4;

    // 列エリア高さ
    this.colContainer.style.height = colHintHeight + 'px';
    this._colCells.forEach(cell => {
      cell.style.height = colHintHeight + 'px';
    });

    // 行エリア幅
    this.rowContainer.style.width = rowHintWidth + 'px';

    this.onLayoutChange({ colHintHeight, rowHintWidth });
  }

  // ─────────────────────────────────────────────────────────────
  //  外部API
  // ─────────────────────────────────────────────────────────────

  setHints(rowHints, colHints) {
    this.rowHints = Array.from({ length: this.rows }, (_, r) =>
      r < rowHints.length ? [...rowHints[r]] : []);
    this.colHints = Array.from({ length: this.cols }, (_, c) =>
      c < colHints.length ? [...colHints[c]] : []);
    this._renderAll();
    this._recalcLayout();
    this._selectLine(this._editType, this._editIndex);
  }

  clearAll() {
    this.rowHints = Array.from({ length: this.rows }, () => []);
    this.colHints = Array.from({ length: this.cols }, () => []);
    this._renderAll();
    this._recalcLayout();
    this._selectLine('row', 0);
  }

  getRowHints() { return this.rowHints.map(h => [...h]); }
  getColHints() { return this.colHints.map(h => [...h]); }

  resize(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    while (this.rowHints.length < rows) this.rowHints.push([]);
    this.rowHints.length = rows;
    while (this.colHints.length < cols) this.colHints.push([]);
    this.colHints.length = cols;
    this._build();
    this._selectLine('row', 0);
  }

  setCellSize(cellSize) {
    this.cellSize = cellSize;
    this.numCellW = cellSize; // 行ヒント幅もセルサイズに連動
    // 行セル高さ更新
    this._rowCells.forEach(cell => { cell.style.height = cellSize + 'px'; });
    // 列セル幅更新
    this._colCells.forEach(cell => { cell.style.width = cellSize + 'px'; });
    // セルサイズが小さすぎる場合は数字テキストを非表示（4px未満）
    const tinyMode = cellSize < 4;
    this.rowContainer.classList.toggle('hints-text-hidden', tinyMode);
    this.colContainer.classList.toggle('hints-text-hidden', tinyMode);
    // 数字を再描画（幅・フォントサイズを更新）
    for (let r = 0; r < this.rows; r++) this._renderRowCell(r);
    for (let c = 0; c < this.cols; c++) this._renderColCell(c);
    this._recalcLayout();
  }
}
