'use strict';

/**
 * puzzle-search-worker.js — 「解ける問題」の探索を画面とは別のスレッドで行う
 *
 *   受信: { id, kind: 'qr'|'image', params }  /  { type: 'cancel' }
 *   送信: { id, type: 'progress', done, total } / { id, type: 'done', result } / { id, type: 'error', message }
 */
importScripts(
  './solver.js',
  '../creator/image-proc.js',
  '../qr/qrcode-lib.js',
  '../qr/jsQR.js',
  './puzzle-search.js'
);

let _cancelled = false;

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'cancel') { _cancelled = true; return; }

  _cancelled = false;
  const { id, kind, params } = m;
  const onProgress = (done, total) => self.postMessage({ id, type: 'progress', done, total });
  try {
    const fn = kind === 'qr' ? PuzzleSearch.searchQR : PuzzleSearch.searchImage;
    const result = await fn(params, onProgress, () => _cancelled);
    self.postMessage({ id, type: 'done', result });
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err && err.message ? err.message : String(err) });
  }
};
