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

  /** 初期化: localStorage or ブラウザ言語から自動判定 */
  function init() {
    const saved = localStorage.getItem('i18n-lang');
    if (saved && _locales[saved]) {
      setLang(saved);
      return;
    }
    // ブラウザ言語から自動判定
    const nav = (navigator.language || '').toLowerCase();
    const match = available().find(l => nav.startsWith(l.toLowerCase()))
               || available().find(l => nav.startsWith(l.split('-')[0]));
    setLang(match || 'ja');
  }

  return { register, available, getLang, setLang, t, applyToDOM, init };
})();
