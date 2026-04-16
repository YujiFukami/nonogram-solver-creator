'use strict';

/**
 * file-io.js — VBA版テキストファイル互換の読み書き
 *
 * テキストファイル形式（VBA版 Mod03_テキスト出力.bas / Mod06_問題読込.bas と互換）:
 *
 *   行1:   縦マス数,列ヒント幅,横マス数,行ヒント幅
 *   行2〜横マス数+1:  各列のヒント（左詰め、カンマ区切り）
 *   行横マス数+2〜:   各行のヒント（左詰め、カンマ区切り）
 *
 * 空値 / "0" はヒントなしとして扱う。
 */

const FileIO = (() => {

  // ─── パース（テキスト → ヒント配列） ────────────────────

  /**
   * VBA互換テキストファイルをパース
   * @param {string} text  ファイルの全文字列
   * @returns {{ rows, cols, rowHints, colHints } | { error: string }}
   */
  function parseTextFile(text) {
    try {
      // 改行コードを正規化
      const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

      // 空行を除去
      const nonEmpty = lines.filter(l => l.trim() !== '');
      if (nonEmpty.length === 0) return { error: 'ファイルが空です' };

      // 行1: 縦マス数,列ヒント幅,横マス数,行ヒント幅
      const header = nonEmpty[0].split(',').map(s => parseInt(s.trim(), 10));
      if (header.length < 3) return { error: 'ヘッダー行の形式が正しくありません' };

      const rows        = header[0]; // 縦マス数
      const colHintWidth = header[1]; // 列ヒント幅（使用するが必須ではない）
      const cols        = header[2]; // 横マス数
      const rowHintWidth = header[3] || 0; // 行ヒント幅

      if (isNaN(rows) || isNaN(cols) || rows <= 0 || cols <= 0) {
        return { error: 'マス数が正しくありません' };
      }
      if (rows > 300 || cols > 300) {
        return { error: 'マス数が上限(300)を超えています' };
      }

      // 行2〜cols+1: 列ヒント
      const colHints = [];
      for (let c = 0; c < cols; c++) {
        const lineIdx = 1 + c;
        if (lineIdx >= nonEmpty.length) {
          colHints.push([]);
          continue;
        }
        colHints.push(_parseHintLine(nonEmpty[lineIdx]));
      }

      // 行cols+2〜cols+rows+1: 行ヒント
      const rowHints = [];
      for (let r = 0; r < rows; r++) {
        const lineIdx = 1 + cols + r;
        if (lineIdx >= nonEmpty.length) {
          rowHints.push([]);
          continue;
        }
        rowHints.push(_parseHintLine(nonEmpty[lineIdx]));
      }

      return { rows, cols, rowHints, colHints };

    } catch (e) {
      return { error: 'パースエラー: ' + e.message };
    }
  }

  /**
   * ヒント行をパース（例: "3,1,2," → [3, 1, 2]）
   * @param {string} line
   * @returns {number[]}
   */
  function _parseHintLine(line) {
    return line.split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n) && n > 0);
  }

  // ─── 生成（ヒント配列 → テキスト） ─────────────────────

  /**
   * VBA互換テキストファイルを生成
   * @param {number}     rows      縦マス数
   * @param {number}     cols      横マス数
   * @param {number[][]} rowHints  行ヒント配列
   * @param {number[][]} colHints  列ヒント配列
   * @returns {string} テキストファイル内容
   */
  function generateTextFile(rows, cols, rowHints, colHints) {
    // ヒント幅（最大ヒント数）を算出
    const colHintWidth = Math.max(1, ...colHints.map(h => h.length));
    const rowHintWidth = Math.max(1, ...rowHints.map(h => h.length));

    const lines = [];

    // ヘッダー行
    lines.push(`${rows},${colHintWidth},${cols},${rowHintWidth}`);

    // 列ヒント（横マス数行）
    for (let c = 0; c < cols; c++) {
      const hints = colHints[c] || [];
      lines.push(_formatHintLine(hints, colHintWidth));
    }

    // 行ヒント（縦マス数行）
    for (let r = 0; r < rows; r++) {
      const hints = rowHints[r] || [];
      lines.push(_formatHintLine(hints, rowHintWidth));
    }

    return lines.join('\r\n') + '\r\n';
  }

  /**
   * ヒント配列を1行のテキストにフォーマット（例: [3,1] width=4 → "3,1,0,0"）
   * @param {number[]} hints
   * @param {number}   width  列数（パディング用）
   * @returns {string}
   */
  function _formatHintLine(hints, width) {
    const arr = [...hints];
    while (arr.length < width) arr.push(0);
    return arr.slice(0, width).join(',');
  }

  // ─── ファイルダウンロード ────────────────────────────────

  /**
   * テキスト内容をファイルとしてダウンロード
   * @param {string} content   ファイル内容
   * @param {string} filename  ファイル名
   */
  function downloadTextFile(content, filename) {
    // Shift-JIS で保存（VBA版互換）するか UTF-8 で保存するかを選択
    // ここでは UTF-8 BOM 付きで保存（Excel でも文字化けしにくい）
    const bom = '\uFEFF';
    const blob = new Blob([bom + content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─── ファイル読み込み（File API） ────────────────────────

  /**
   * File オブジェクトをテキストとして読み込み、パース結果を返す
   * @param {File} file
   * @returns {Promise<{ rows, cols, rowHints, colHints } | { error: string }>}
   */
  function readTextFile(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        let text = e.target.result;
        // BOM を除去
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        resolve(parseTextFile(text));
      };

      reader.onerror = () => {
        resolve({ error: 'ファイルの読み込みに失敗しました' });
      };

      // まず UTF-8 で試みる
      reader.readAsText(file, 'UTF-8');
    });
  }

  // ─── JSON 形式（拡張保存用） ─────────────────────────────

  /**
   * JSON 形式で問題データを生成（ウェブ独自フォーマット）
   */
  function generateJSON(rows, cols, rowHints, colHints, name = '') {
    return JSON.stringify({ name, rows, cols, rowHints, colHints }, null, 2);
  }

  /**
   * JSON 形式から問題データを読み込む
   */
  function parseJSON(text) {
    try {
      const data = JSON.parse(text);
      if (!data.rows || !data.cols || !data.rowHints || !data.colHints) {
        return { error: 'JSONの形式が正しくありません' };
      }
      return data;
    } catch (e) {
      return { error: 'JSONパースエラー: ' + e.message };
    }
  }

  // ─── 公開API ─────────────────────────────────────────────
  return {
    parseTextFile,
    generateTextFile,
    downloadTextFile,
    readTextFile,
    generateJSON,
    parseJSON,
  };
})();
