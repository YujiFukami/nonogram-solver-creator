'use strict';

/**
 * tab.js — タブ切り替え管理
 */

function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => {
    el.classList.toggle('active', el.id === 'tab-' + tabId);
  });
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  // 表示されたタブが盤面の大きさを測り直せるよう知らせる
  requestAnimationFrame(() => {
    window.dispatchEvent(new CustomEvent('layoutresize', { detail: { tab: tabId, reason: 'tab' } }));
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
});
