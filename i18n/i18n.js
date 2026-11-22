'use strict';

/**
 * i18n.js — 軽量 i18n エンジン
 *
 * 使い方:
 *   HTML: <span data-i18n="key">フォールバック</span>
 *         <input data-i18n-placeholder="key" placeholder="...">
 *         <button data-i18n-title="key" title="...">
 *   JS:   I18n.t('key')            → 翻訳文字列
 *         I18n.t('key', {n: 5})    → テンプレート置換 "{{n}}" → "5"
 */
const I18n = (() => {
  const _locales = {};
  let _lang = 'ja';

  /** ロケール登録 */
  function register(lang, dict) {
    _locales[lang] = Object.assign(_locales[lang] || {}, dict);
  }

  /** 使用可能言語リスト */
  function available() {
    return Object.keys(_locales);
  }

  /** 現在の言語 */
  function getLang() { return _lang; }

  /** 言語切替 + DOM更新 */
  function setLang(lang) {
    if (!_locales[lang]) return;
    _lang = lang;
    document.documentElement.lang = lang.replace('-', '-');
    localStorage.setItem('i18n-lang', lang);
    applyToDOM();
    _updateTitle();
    // カスタムイベント発火（JS 側で動的テキストを更新するため）
    document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
  }

  /** 翻訳取得 (キー → 文字列) */
  function t(key, params) {
    let s = (_locales[_lang] && _locales[_lang][key])
         || (_locales['ja'] && _locales['ja'][key])
         || key;
    if (params) {
      Object.keys(params).forEach(k => {
        s = s.replace(new RegExp('\\{\\{' + k + '\\}\\}', 'g'), params[k]);
      });
    }
    return s;
  }

  /** DOM 全走査して data-i18n* 属性を翻訳反映 */
  function applyToDOM() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = t(el.getAttribute('data-i18n-title'));
    });
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
  }

  /** <title> タグ更新 */
  function _updateTitle() {
    const title = t('meta.title');
    if (title && title !== 'meta.title') document.title = title;
  }

  // ─── 言語別 URL ───────────────────────────────────────────
  //   日本語は /、ほかの言語は /en/ /ko/ … （tools/build-pages.js が生成）
  //   言語ページには <base href="../"> があるので、相対 URL はどのページからでもサイトの先頭を基準に解決される

  /** ページ自体の言語（<html lang>） */
  function pageLang() {
    const l = document.documentElement.getAttribute('lang') || 'ja';
    return _locales[l] ? l : 'ja';
  }

  /** その言語のページの URL */
  function urlFor(lang) {
    return new URL(lang === 'ja' ? './' : lang + '/', document.baseURI).href;
  }

  /** 言語セレクタから: 選んだ言語を覚えて、その言語のページへ移動 */
  function goToLang(lang) {
    if (!_locales[lang]) return;
    try { localStorage.setItem('i18n-lang', lang); } catch (e) { /* 保存できなくても移動する */ }
    if (lang === pageLang()) { setLang(lang); return; }
    location.href = urlFor(lang);
  }

  /** 利用者の言語（選んだことがあればそれ、なければブラウザの言語） */
  function _preferredLang() {
    try {
      const saved = localStorage.getItem('i18n-lang');
      if (saved && _locales[saved]) return saved;
    } catch (e) { /* なし */ }
    const nav = (navigator.language || '').toLowerCase();
    return available().find(l => nav.startsWith(l.toLowerCase()))
        || available().find(l => nav.startsWith(l.split('-')[0]))
        || null;
  }

  /** 利用者の言語とページの言語が違うとき、案内バーを出す（自動では移動しない） */
  function _showSuggestion() {
    const bar = document.getElementById('lang-suggest');
    if (!bar) return;
    const want = _preferredLang();
    if (!want || want === pageLang()) return;
    try { if (localStorage.getItem('i18n-suggest-closed') === want) return; } catch (e) { /* なし */ }
    const dict = _locales[want] || {};
    document.getElementById('lang-suggest-text').textContent = dict['lang.suggest'] || '';
    const link = document.getElementById('lang-suggest-link');
    link.textContent = dict['lang.open'] || want;
    link.href = urlFor(want);
    link.lang = want;
    link.addEventListener('click', () => { try { localStorage.setItem('i18n-lang', want); } catch (e) { /* なし */ } });
    document.getElementById('lang-suggest-close').addEventListener('click', () => {
      bar.hidden = true;
      try { localStorage.setItem('i18n-suggest-closed', want); } catch (e) { /* なし */ }
    });
    bar.hidden = false;
  }

  /** 初期化: いつもページ自体の言語で表示する（URL ごとに言語が決まる） */
  function init() {
    _lang = pageLang();
    applyToDOM();
    _updateTitle();
    document.dispatchEvent(new CustomEvent('langchange', { detail: { lang: _lang } }));
    _showSuggestion();
  }

  return { register, available, getLang, setLang, t, applyToDOM, init, pageLang, urlFor, goToLang };
})();
