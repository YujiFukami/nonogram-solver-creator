'use strict';

/**
 * layout.js — 画面レイアウトの共通操作
 *
 *   1. 左メニュー（各タブの操作パネル）の開閉
 *      - PC: パネル右側の細いバーで開閉。状態は localStorage に保存
 *      - スマホ幅: 最初は閉じた状態。開くと盤面の上に重ねて表示
 *   2. パネル内の区画（.panel-section の見出し）の折りたたみ
 *      - 見出しの data-i18n キーで区画を識別し、開閉状態を保存
 *
 * 開閉でメイン領域の広さが変わったときは、各タブの盤面を合わせ直す。
 */
const Layout = (() => {

  const MOBILE_QUERY = window.matchMedia('(max-width: 700px)');

  const PANELS = [
    { id: 'side-panel',    tab: 'solver'  },
    { id: 'creator-panel', tab: 'creator' },
    { id: 'qr-panel',      tab: 'qr'      },
  ];

  // 最初から閉じておく区画（あまり使わないもの）
  const DEFAULT_COLLAPSED_SECTIONS = [
    'solver.cellColor',
    'creator.postProcess',
    'creator.display',
  ];

  // ─── localStorage（使えない環境でも動くように） ───────────

  function _load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function _save(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* 保存できなくても動作は続ける */ }
  }

  function isMobile() { return MOBILE_QUERY.matches; }

  function _t(key, fallback) {
    if (typeof I18n === 'undefined') return fallback;
    const s = I18n.t(key);
    return s === key ? fallback : s;
  }

  // ─── 1. 左メニューの開閉 ──────────────────────────────────

  const _panelStates = [];

  function _initPanels() {
    PANELS.forEach(p => {
      const panel = document.getElementById(p.id);
      if (!panel) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'panel-toggle';
      btn.setAttribute('aria-controls', p.id);
      panel.after(btn);
      panel.parentElement.classList.add('has-side-panel');

      const key = 'layout.panelCollapsed.' + p.id;
      const state = {
        panel, btn, tab: p.tab,
        collapsed: isMobile() ? true : _load(key, '0') === '1',
      };

      state.apply = () => {
        panel.classList.toggle('panel-collapsed', state.collapsed);
        btn.classList.toggle('is-collapsed', state.collapsed);
        btn.textContent = state.collapsed ? '▶' : '◀';
        const label = state.collapsed
          ? _t('layout.openMenu', 'メニューを開く')
          : _t('layout.closeMenu', 'メニューをたたむ');
        btn.title = label;
        btn.setAttribute('aria-label', label);
        btn.setAttribute('aria-expanded', String(!state.collapsed));
      };

      state.set = (collapsed) => {
        if (state.collapsed === collapsed) return;
        state.collapsed = collapsed;
        if (!isMobile()) _save(key, collapsed ? '1' : '0');
        state.apply();
        // スマホ幅では重ねて表示するだけなので、盤面の広さは変わらない
        if (!isMobile()) _notifyResize(p.tab);
      };

      btn.addEventListener('click', () => state.set(!state.collapsed));
      state.apply();
      _panelStates.push(state);
    });

    // PC幅⇔スマホ幅の切り替え時
    MOBILE_QUERY.addEventListener('change', () => {
      _panelStates.forEach(s => {
        s.collapsed = isMobile() ? true : _load('layout.panelCollapsed.' + s.panel.id, '0') === '1';
        s.apply();
      });
      _notifyResize(null);
    });

    // スマホ幅: パネルの外をタップしたら閉じる
    document.addEventListener('pointerdown', e => {
      if (!isMobile()) return;
      _panelStates.forEach(s => {
        if (s.collapsed) return;
        if (s.panel.contains(e.target) || s.btn.contains(e.target)) return;
        s.set(true);
      });
    });

    document.addEventListener('langchange', () => _panelStates.forEach(s => s.apply()));
  }

  /** 盤面の広さが変わったことを各タブに知らせる */
  function _notifyResize(tab) {
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('layoutresize', { detail: { tab } }));
    });
  }

  // ─── 2. 区画の折りたたみ ───────────────────────────────────

  function _initSections() {
    PANELS.forEach(p => {
      const panel = document.getElementById(p.id);
      if (!panel) return;

      panel.querySelectorAll('.panel-section').forEach((section, idx) => {
        const h3 = section.querySelector(':scope > h3');
        if (!h3) return;

        const id  = h3.getAttribute('data-i18n') || (p.id + '-' + idx);
        const key = 'layout.sectionCollapsed.' + id;
        const def = DEFAULT_COLLAPSED_SECTIONS.includes(id) ? '1' : '0';

        section.classList.add('is-collapsible');
        h3.setAttribute('role', 'button');
        h3.setAttribute('tabindex', '0');

        const apply = (collapsed) => {
          section.classList.toggle('sec-collapsed', collapsed);
          h3.setAttribute('aria-expanded', String(!collapsed));
        };
        apply(_load(key, def) === '1');

        const toggle = () => {
          const collapsed = !section.classList.contains('sec-collapsed');
          apply(collapsed);
          _save(key, collapsed ? '1' : '0');
        };
        h3.addEventListener('click', toggle);
        h3.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });
      });
    });
  }

  // ─── 盤面の合わせ直し（解答タブ） ──────────────────────────

  function _initSolverRefit() {
    window.addEventListener('layoutresize', e => {
      const tab = e.detail && e.detail.tab;
      if (tab && tab !== 'solver') return;
      // タブを戻しただけのときは、利用者が決めたズームを保つ
      if (e.detail && e.detail.reason === 'tab') return;
      // 解答タブが表示されていないときは測れない
      const solverTab = document.getElementById('tab-solver');
      if (!solverTab || !solverTab.classList.contains('active')) return;
      if (typeof autoZoomFit === 'function') autoZoomFit();
    });
  }

  function init() {
    _initPanels();
    _initSections();
    _initSolverRefit();
  }

  return { init, isMobile };
})();

document.addEventListener('DOMContentLoaded', () => Layout.init());
