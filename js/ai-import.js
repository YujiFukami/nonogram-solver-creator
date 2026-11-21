'use strict';

/**
 * ai-import.js — 画像を各自のAI（ChatGPT / Gemini / Claude など）に読ませて
 *                作った問題データを貼り付けて読み込む機能
 *
 * 流れ:
 *   ① 専用プロンプトをコピー → ② AIを開いて「プロンプト＋問題の画像」を送る
 *   → ③ AIが返したコードブロックをコピー → ④ ここに貼り付けて読み込む
 *
 * データ形式（AI向け。行番号付きで、行の飛ばし・ずれを防ぐ）:
 *
 *   NONOGRAM
 *   ROWS: 50
 *   COLS: 45
 *   [ROW HINTS]
 *   R1: 40 3
 *   R2: 39 2 2
 *   ...
 *   [COL HINTS]
 *   C1: 8 6
 *   ...
 *
 *   - ヒントなしの行・列は 0、読めない数字は ? と書く
 *   - 前後の説明文、``` 記号、全角数字、カンマ区切りなどは読み込み時に吸収する
 *   - 従来の .txt 形式（VBA版互換）を貼り付けても読み込める
 */

// ═══════════════════════════════════════════════════════════
//  解析・検証（DOM に依存しない。Node からも使える）
// ═══════════════════════════════════════════════════════════
const AiImportCore = (() => {

  const MAX_SIZE = 300;

  /** 全角英数・記号を半角にし、改行をそろえる */
  function normalize(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[０-９Ａ-Ｚａ-ｚ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/[：]/g, ':')
      .replace(/[？]/g, '?')
      .replace(/[，、､]/g, ',')
      .replace(/[［]/g, '[').replace(/[］]/g, ']')
      .replace(/　/g, ' ');
  }

  /** "3 1 ?" / "3,1" / "3・1" などをヒント配列へ。0 や空はヒントなし */
  function parseHintTokens(str) {
    const tokens = str.split(/[\s,・/|]+/).map(t => t.trim()).filter(Boolean);
    const nums = [];
    let unknown = 0;
    const bad = [];
    tokens.forEach(t => {
      if (t === '?') { unknown++; return; }
      if (/^\d+$/.test(t)) {
        const n = parseInt(t, 10);
        if (n > 0) nums.push(n);
        return;
      }
      bad.push(t);
    });
    return { nums, unknown, bad };
  }

  /**
   * 貼り付けられた文字列を解析する
   * @returns {{ ok, format, rows, cols, rowHints, colHints, rowUnknown, colUnknown, errors, warnings }}
   */
  function parse(rawText) {
    const text = normalize(rawText);
    const errors = [];
    const warnings = [];

    if (!text.trim()) {
      return { ok: false, errors: [{ msg: '貼り付けられたデータがありません' }], warnings };
    }

    // ラベル付きの行（R1: / C1: / 行1: / 列1:）があれば新形式として読む
    const labeled = /^\s*(R|C|行|列)\s*0*\d+\s*[:.)]/im.test(text);
    if (!labeled) {
      const legacy = _parseLegacy(text);
      if (legacy) return legacy;
    }

    let declRows = null, declCols = null;
    const rowMap = new Map();
    const colMap = new Map();
    let section = null; // 'row' | 'col'
    const seqRow = [], seqCol = []; // ラベルなし行（セクション内の連番として扱う）

    text.split('\n').forEach((line, i) => {
      const lineNo = i + 1;
      const s = line.replace(/`/g, '').trim();
      if (!s) return;

      let m;
      if ((m = s.match(/^(ROWS|行数|縦)\s*[:=]\s*(\d+)/i)))  { declRows = parseInt(m[2], 10); return; }
      if ((m = s.match(/^(COLS|COLUMNS|列数|横)\s*[:=]\s*(\d+)/i))) { declCols = parseInt(m[2], 10); return; }
      if ((m = s.match(/^SIZE\s*[:=]?\s*(\d+)\s*[x×*]\s*(\d+)/i))) {
        // SIZE: 列x行（横×縦）
        declCols = parseInt(m[1], 10); declRows = parseInt(m[2], 10); return;
      }
      if (/^\[?\s*(ROW\s*HINTS?|ROWS?\s*\]|行ヒント|左のヒント)/i.test(s)) { section = 'row'; return; }
      if (/^\[?\s*(COL(UMN)?\s*HINTS?|COLS?\s*\]|列ヒント|上のヒント)/i.test(s)) { section = 'col'; return; }

      if ((m = s.match(/^(R|C|行|列)\s*0*(\d+)\s*[:.)]\s*(.*)$/i))) {
        const kind = /^(R|行)$/i.test(m[1]) ? 'row' : 'col';
        const idx = parseInt(m[2], 10);
        const body = m[3].replace(/[#;].*$/, '');  // 行末コメントは無視
        const hint = parseHintTokens(body);
        const map = kind === 'row' ? rowMap : colMap;
        const label = (kind === 'row' ? 'R' : 'C') + idx;
        if (hint.bad.length) {
          errors.push({ line: lineNo, msg: `${label}: 数字として読めない文字があります（${hint.bad.join(' ')}）` });
        }
        if (map.has(idx)) {
          errors.push({ line: lineNo, msg: `${label} が2回書かれています` });
        }
        map.set(idx, { ...hint, line: lineNo });
        return;
      }

      // セクション内のラベルなし数字行
      if (section && /^[\d?\s,・/|]+$/.test(s)) {
        (section === 'row' ? seqRow : seqCol).push({ ...parseHintTokens(s), line: lineNo });
      }
    });

    // ラベルなしで並んでいた場合は連番として補う
    if (rowMap.size === 0 && seqRow.length) seqRow.forEach((h, i) => rowMap.set(i + 1, h));
    if (colMap.size === 0 && seqCol.length) seqCol.forEach((h, i) => colMap.set(i + 1, h));

    if (rowMap.size === 0 && colMap.size === 0) {
      return { ok: false, errors: [{ msg: 'ヒントの行（R1: … / C1: …）が見つかりません。AIの出力したコードブロックを丸ごと貼り付けてください' }], warnings };
    }

    const maxRowIdx = rowMap.size ? Math.max(...rowMap.keys()) : 0;
    const maxColIdx = colMap.size ? Math.max(...colMap.keys()) : 0;
    const rows = declRows || maxRowIdx;
    const cols = declCols || maxColIdx;

    if (!declRows || !declCols) {
      warnings.push({ msg: `ROWS / COLS の記載がないため、番号の最大値から ${rows}行 × ${cols}列 としました` });
    }
    if (rows < 1 || cols < 1 || rows > MAX_SIZE || cols > MAX_SIZE) {
      errors.push({ msg: `マス数が範囲外です（${rows}行 × ${cols}列、上限 ${MAX_SIZE}）` });
      return { ok: false, rows, cols, errors, warnings };
    }

    const rowHints = [], colHints = [], rowUnknown = [], colUnknown = [];
    _collect(rowMap, rows, 'R', rowHints, rowUnknown, errors);
    _collect(colMap, cols, 'C', colHints, colUnknown, errors);

    if (maxRowIdx > rows) errors.push({ line: rowMap.get(maxRowIdx).line, msg: `R${maxRowIdx} があります（ROWS は ${rows}）。行数か番号が合っていません` });
    if (maxColIdx > cols) errors.push({ line: colMap.get(maxColIdx).line, msg: `C${maxColIdx} があります（COLS は ${cols}）。列数か番号が合っていません` });

    const result = { ok: false, format: 'ai', rows, cols, rowHints, colHints, rowUnknown, colUnknown, errors, warnings,
                     rowLines: _lines(rowMap, rows), colLines: _lines(colMap, cols) };
    validate(result);
    return result;
  }

  function _lines(map, n) {
    const a = [];
    for (let i = 1; i <= n; i++) a.push(map.has(i) ? map.get(i).line : null);
    return a;
  }

  function _collect(map, n, prefix, hints, unknown, errors) {
    const missing = [];
    for (let i = 1; i <= n; i++) {
      const h = map.get(i);
      if (!h) { missing.push(prefix + i); hints.push([]); unknown.push(0); continue; }
      hints.push(h.nums);
      unknown.push(h.unknown);
    }
    if (missing.length) {
      const list = missing.length > 8 ? missing.slice(0, 8).join(', ') + ` ほか${missing.length - 8}件` : missing.join(', ');
      errors.push({ msg: `${prefix === 'R' ? '行' : '列'}ヒントが足りません: ${list}` });
    }
  }

  /** ルール上の矛盾を調べ、result.errors / warnings に追加して ok を決める */
  function validate(result) {
    const { rows, cols, rowHints, colHints, rowUnknown, colUnknown, errors, warnings } = result;

    // 読めない数字（?）
    const unk = [];
    rowUnknown.forEach((u, i) => { if (u) unk.push('R' + (i + 1)); });
    colUnknown.forEach((u, i) => { if (u) unk.push('C' + (i + 1)); });
    if (unk.length) {
      errors.push({ msg: `読めない数字（?）があります: ${unk.join(', ')}。画像を見て数字に直してください` });
    }

    // 1行（1列）にヒントが収まるか
    const overflow = (hints, len, prefix, lines) => {
      hints.forEach((h, i) => {
        if (!h.length) return;
        const need = h.reduce((a, b) => a + b, 0) + h.length - 1;
        if (need > len) {
          errors.push({ line: lines && lines[i], msg: `${prefix}${i + 1}: ヒント（${h.join(' ')}）が ${len} マスに収まりません（必要 ${need} マス）` });
        }
      });
    };
    overflow(rowHints, cols, 'R', result.rowLines);
    overflow(colHints, rows, 'C', result.colLines);

    // 行ヒントの合計 = 列ヒントの合計
    const sum = hs => hs.reduce((a, h) => a + h.reduce((x, y) => x + y, 0), 0);
    const rs = sum(rowHints), cs = sum(colHints);
    result.rowSum = rs;
    result.colSum = cs;
    if (rs !== cs && !unk.length) {
      errors.push({ msg: `行ヒントの合計（${rs}）と列ヒントの合計（${cs}）が一致しません。どこかの数字が読み違えられています（差 ${Math.abs(rs - cs)}）` });
    }

    const emptyRows = rowHints.filter(h => !h.length).length;
    const emptyCols = colHints.filter(h => !h.length).length;
    if (emptyRows === rows || emptyCols === cols) {
      errors.push({ msg: 'すべてのヒントが空です' });
    }

    result.ok = errors.length === 0;
    return result;
  }

  /** 従来の .txt 形式（1行目: 縦,列ヒント幅,横,行ヒント幅） */
  function _parseLegacy(text) {
    const first = text.split('\n').find(l => l.trim());
    if (!first || !/^\s*\d+\s*,\s*\d+\s*,\s*\d+/.test(first)) return null;
    if (typeof FileIO === 'undefined') return null;
    const r = FileIO.parseTextFile(text);
    if (r.error) return { ok: false, errors: [{ msg: r.error }], warnings: [] };
    const result = {
      ok: false, format: 'legacy', rows: r.rows, cols: r.cols,
      rowHints: r.rowHints, colHints: r.colHints,
      rowUnknown: r.rowHints.map(() => 0), colUnknown: r.colHints.map(() => 0),
      errors: [], warnings: [{ msg: '従来の .txt 形式として読み込みました' }],
    };
    validate(result);
    return result;
  }

  /** ヒント配列を AI 形式の文字列にする（確認・修正用） */
  function format(rows, cols, rowHints, colHints) {
    const out = ['NONOGRAM', `ROWS: ${rows}`, `COLS: ${cols}`, '[ROW HINTS]'];
    rowHints.forEach((h, i) => out.push(`R${i + 1}: ${h.length ? h.join(' ') : 0}`));
    out.push('[COL HINTS]');
    colHints.forEach((h, i) => out.push(`C${i + 1}: ${h.length ? h.join(' ') : 0}`));
    return out.join('\n');
  }

  return { normalize, parse, validate, format };
})();

// ═══════════════════════════════════════════════════════════
//  AIに渡すプロンプト
// ═══════════════════════════════════════════════════════════
const AiImportPrompt = (() => {

  const JA = `あなたは「お絵かきロジック（イラストロジック・ノノグラム）」の問題画像から、ヒントの数字を正確に書き写すアシスタントです。
添付した画像の問題について、ヒントの数字をすべて読み取り、下の形式で出力してください。画像が複数枚ある場合は、同じ1つの問題を分けて撮ったものです（例: 上のヒントと左のヒント）。

【読み取りの手順】
1. 盤面（マス目の部分）の列数（横のマス数）と行数（縦のマス数）を数えてください。5マスごとの太線を目安にすると正確に数えられます。
2. 左側のヒント（行ヒント）を、いちばん上の行から順に、各行の左から右へ読んでください。
3. 上側のヒント（列ヒント）を、いちばん左の列から順に、各列の上から下へ読んでください。
4. 1つのマスに書かれた数字は、2桁（10、24 など）でも1つの数です。小さい文字の2桁を「1 0」のように分けないでください。
5. ヒントのない行・列は 0 と書いてください。どうしても読めない数字は推測せず ? と書いてください。
6. 出力する前に必ず確かめてください。
   - 行は ROWS 個、列は COLS 個、番号の抜けや重複がないこと
   - 各行の「ヒントの合計＋(ヒントの個数−1)」が列数以下、各列も同様に行数以下であること
   - 行ヒントすべての合計と、列ヒントすべての合計が一致すること
   合わない場合は、該当しそうな箇所を画像で読み直してから出力してください。

【出力形式】次の形式のコードブロックを1つだけ出力してください（コピーしやすいように）。
NONOGRAM
ROWS: 行数
COLS: 列数
[ROW HINTS]
R1: 3 1
R2: 5
（R1 から R行数 まで、上の行から順に）
[COL HINTS]
C1: 2 2
C2: 0
（C1 から C列数 まで、左の列から順に）

コードブロックの後に、行ヒントの合計・列ヒントの合計と、自信のない箇所（あれば）を1〜2行で書いてください。`;

  const EN = `You are an assistant that accurately transcribes the clue numbers of a nonogram (picross / griddlers / paint-by-numbers) puzzle from an image.
Read every clue number of the puzzle in the attached image(s) and output them in the format below. If there are several images, they are parts of the same puzzle (e.g. the top clues and the left clues).

[How to read]
1. Count the number of columns and rows of the grid. The thick lines every 5 cells help you count accurately.
2. Read the left clues (row clues) from the top row down, each row from left to right.
3. Read the top clues (column clues) from the leftmost column to the right, each column from top to bottom.
4. A number written in one cell is a single number even if it has two digits (10, 24, ...). Do not split small two-digit numbers into "1 0".
5. Write 0 for a row/column without clues. If a number is unreadable, write ? instead of guessing.
6. Before answering, check that:
   - there are exactly ROWS rows and COLS columns, with no missing or duplicated numbers
   - for each row, (sum of clues + number of clues - 1) <= number of columns; likewise for each column
   - the total of all row clues equals the total of all column clues
   If something does not match, re-read the suspicious part of the image before answering.

[Output format] Output exactly one code block in this format (so it is easy to copy):
NONOGRAM
ROWS: number of rows
COLS: number of columns
[ROW HINTS]
R1: 3 1
R2: 5
(R1 to the last row, from the top)
[COL HINTS]
C1: 2 2
C2: 0
(C1 to the last column, from the left)

After the code block, write in one or two lines the row-clue total, the column-clue total, and any part you are unsure about. Write those lines in the user's language.`;

  function get(lang) {
    return (lang || 'ja') === 'ja' ? JA : EN;
  }

  return { get };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AiImportCore, AiImportPrompt };
}

// ═══════════════════════════════════════════════════════════
//  画面（ブラウザのみ）
// ═══════════════════════════════════════════════════════════
if (typeof document !== 'undefined') {
  const AiImportUI = (() => {

    const AI_LINKS = [
      { name: 'ChatGPT', url: 'https://chatgpt.com/' },
      { name: 'Gemini',  url: 'https://gemini.google.com/app' },
      { name: 'Claude',  url: 'https://claude.ai/new' },
    ];

    const DRAFT_KEY = 'aiImport.draft';
    let _el = {};
    let _last = null;
    let _timer = 0;

    function init() {
      _el = {
        overlay:   document.getElementById('ai-import-overlay'),
        close:     document.getElementById('ai-import-close'),
        open:      document.getElementById('btn-ai-import'),
        copy:      document.getElementById('ai-import-copy'),
        copyMsg:   document.getElementById('ai-import-copy-msg'),
        promptBox: document.getElementById('ai-import-prompt'),
        links:     document.getElementById('ai-import-links'),
        paste:     document.getElementById('ai-import-paste-btn'),
        text:      document.getElementById('ai-import-text'),
        result:    document.getElementById('ai-import-result'),
        load:      document.getElementById('ai-import-load'),
      };
      if (!_el.overlay || !_el.open) return;

      AI_LINKS.forEach(a => {
        const link = document.createElement('a');
        link.href = a.url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.className = 'ai-link';
        link.textContent = a.name + ' ↗';
        _el.links.appendChild(link);
      });

      _el.open.addEventListener('click', open);
      _el.close.addEventListener('click', close);
      _el.overlay.addEventListener('click', e => { if (e.target === _el.overlay) close(); });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && _el.overlay.style.display !== 'none') close();
      });

      _el.copy.addEventListener('click', copyPrompt);
      _el.paste.addEventListener('click', pasteFromClipboard);
      _el.text.addEventListener('input', () => {
        clearTimeout(_timer);
        _timer = setTimeout(check, 250);
        try { localStorage.setItem(DRAFT_KEY, _el.text.value); } catch (e) { /* 保存できなくても続ける */ }
      });
      _el.load.addEventListener('click', loadIntoSolver);
      _el.result.addEventListener('click', e => {
        const li = e.target.closest('[data-line]');
        if (li) _selectLine(parseInt(li.dataset.line, 10));
      });

      document.addEventListener('langchange', _renderPrompt);
    }

    function _lang() {
      return (typeof I18n !== 'undefined') ? I18n.getLang() : 'ja';
    }

    function _renderPrompt() {
      if (_el.promptBox) _el.promptBox.textContent = AiImportPrompt.get(_lang());
    }

    function open() {
      _renderPrompt();
      try {
        const draft = localStorage.getItem(DRAFT_KEY);
        if (draft && !_el.text.value) _el.text.value = draft;
      } catch (e) { /* なし */ }
      _el.overlay.style.display = 'flex';
      check();
    }

    function close() {
      _el.overlay.style.display = 'none';
    }

    async function copyPrompt() {
      const text = AiImportPrompt.get(_lang());
      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch (e) {
        // http や古いブラウザ向けの代替手段
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
        ta.remove();
      }
      _el.copyMsg.textContent = ok ? '✔ コピーしました' : 'コピーできませんでした。下の文を選択してコピーしてください';
      _el.copyMsg.className = 'ai-copy-msg ' + (ok ? 'ok' : 'ng');
      setTimeout(() => { _el.copyMsg.textContent = ''; }, 4000);
    }

    async function pasteFromClipboard() {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          _el.text.value = text;
          try { localStorage.setItem(DRAFT_KEY, text); } catch (e) { /* なし */ }
          check();
        }
      } catch (e) {
        _el.text.focus();
        _renderMessages([{ msg: 'ブラウザがクリップボードの読み取りを許可しませんでした。欄をクリックして Ctrl+V（スマホは長押し→貼り付け）で貼り付けてください' }], [], null);
      }
    }

    function check() {
      if (!_el.text.value.trim()) {
        _last = null;
        _el.result.innerHTML = '<div class="ai-result-empty">AIの答え（コードブロック）を貼り付けると、ここに確認結果が出ます。</div>';
        _el.load.disabled = true;
        return;
      }
      _last = AiImportCore.parse(_el.text.value);
      _renderMessages(_last.errors || [], _last.warnings || [], _last);
      _el.load.disabled = !(_last && _last.rowHints && _last.colHints && _last.rows && _last.cols);
    }

    function _renderMessages(errors, warnings, r) {
      const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      let html = '';
      if (r && r.rows && r.cols && r.rowHints) {
        const sumInfo = (r.rowSum !== undefined) ? `　行ヒント合計 ${r.rowSum} ／ 列ヒント合計 ${r.colSum}` : '';
        html += `<div class="ai-result-summary ${errors.length ? 'ng' : 'ok'}">`
              + (errors.length ? '⚠ ' : '✔ ')
              + `${r.rows}行 × ${r.cols}列${sumInfo}`
              + (errors.length ? '' : '　— 問題なし。読み込めます')
              + '</div>';
      }
      if (errors.length) {
        html += '<ul class="ai-result-list ng">' + errors.map(e =>
          `<li${e.line ? ` data-line="${e.line}" title="クリックで該当行を選択"` : ''}>${esc(e.msg)}${e.line ? ` <span class="ai-line">(${e.line}行目)</span>` : ''}</li>`
        ).join('') + '</ul>';
      }
      if (warnings.length) {
        html += '<ul class="ai-result-list warn">' + warnings.map(w => `<li>${esc(w.msg)}</li>`).join('') + '</ul>';
      }
      _el.result.innerHTML = html;
    }

    /** 貼り付け欄の n 行目を選択して見せる */
    function _selectLine(n) {
      const lines = _el.text.value.split('\n');
      let start = 0;
      for (let i = 0; i < n - 1 && i < lines.length; i++) start += lines[i].length + 1;
      const end = start + (lines[n - 1] || '').length;
      _el.text.focus();
      _el.text.setSelectionRange(start, end);
      const lh = parseFloat(getComputedStyle(_el.text).lineHeight) || 18;
      _el.text.scrollTop = Math.max(0, (n - 4) * lh);
    }

    function loadIntoSolver() {
      const r = _last;
      if (!r || !r.rowHints) return;
      if (r.errors.length) {
        const ok = confirm(`確認で ${r.errors.length} 件の問題が見つかっています。\n` +
          '読み込んだあと、解答タブのヒント入力で直すこともできます。\nこのまま読み込みますか？\n（? の数字は読み込まれません）');
        if (!ok) return;
      }
      if (typeof applyPuzzleData !== 'function') return;
      applyPuzzleData(r.rows, r.cols, r.rowHints, r.colHints, 'ai-import',
        r.errors.length
          ? `AIの読み取りデータを読み込みました（${r.rows}×${r.cols}）。確認で見つかった問題を直してください`
          : `AIの読み取りデータを読み込みました（${r.rows}×${r.cols}）。「解答実行」で解けるか確かめられます`,
        r.errors.length ? 'error' : 'success');
      close();
    }

    return { init, open };
  })();

  document.addEventListener('DOMContentLoaded', () => AiImportUI.init());
}
