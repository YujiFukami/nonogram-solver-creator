#!/usr/bin/env node
'use strict';

/**
 * tools/build-pages.js — 検索エンジン向けの静的ページを生成する（依存なし・Node のみ）
 *
 *   node tools/build-pages.js
 *
 * 生成するもの
 *   1. 言語別のアプリページ   /en/ /ko/ /zh-CN/ … （index.html をひな形に、各言語の文字を書き込んだ静的 HTML）
 *   2. index.html（日本語 /）の hreflang ブロック
 *   3. 解説ページ             /guide/ /algorithm/ /faq/ と /en/guide/ … （本文は content/{ja,en}/*.html）
 *   4. sitemap.xml / robots.txt
 *
 * index.html・i18n/*.js・content/ を直したら、このスクリプトを実行してからコミットする。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://nonogram-solver-creator.vercel.app/';
const LANGS = ['ja', 'en', 'ru', 'ko', 'fr', 'it', 'de', 'es', 'tr', 'zh-CN', 'zh-TW', 'pl'];
const OG_LOCALE = {
  ja: 'ja_JP', en: 'en_US', ru: 'ru_RU', ko: 'ko_KR', fr: 'fr_FR', it: 'it_IT', de: 'de_DE',
  es: 'es_ES', tr: 'tr_TR', 'zh-CN': 'zh_CN', 'zh-TW': 'zh_TW', pl: 'pl_PL',
};
const DOC_PAGES = ['guide', 'algorithm', 'faq', 'links', 'changelog'];
const NAV_PAGES = ['guide', 'algorithm', 'faq', 'links'];       // ヘッダーに並べるページ（更新履歴はバージョン表示から）
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8'));
const DOC_LANGS = ['ja', 'en'];
const TODAY = new Date().toISOString().slice(0, 10);

// ─── 翻訳の読み込み（i18n/*.js をそのまま実行して辞書を取り出す） ───
function loadLocales() {
  const dicts = {};
  const sandbox = { I18n: { register: (lang, dict) => { dicts[lang] = Object.assign(dicts[lang] || {}, dict); } } };
  vm.createContext(sandbox);
  for (const lang of LANGS) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'i18n', lang + '.js'), 'utf8'), sandbox, { filename: lang + '.js' });
  }
  return dicts;
}
const DICTS = loadLocales();
/** I18n.t と同じ: その言語 → 日本語 → キー の順 */
const t = (lang, key) => (DICTS[lang] && DICTS[lang][key]) || DICTS.ja[key] || key;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const appUrl = lang => SITE + (lang === 'ja' ? '' : lang + '/');
const docUrl = (lang, slug) => SITE + (lang === 'ja' ? '' : lang + '/') + slug + '/';

function write(rel, content) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return rel;
}

function replaceOnce(html, re, to, label) {
  if (!re.test(html)) throw new Error('見つかりません: ' + label);
  return html.replace(re, to);
}

// ─── 1・2. アプリページ ───────────────────────────────────────

/** バージョン（version.json）を画面・構造化データに書き込む */
function withVersion(html) {
  const v = VERSION.version;
  html = replaceOnce(html, /(<a[^>]*id="app-version"[^>]*>)[^<]*(<\/a>)/, `$1v${v}$2`, 'app-version');
  html = replaceOnce(html, /(<span id="footer-version">)[^<]*(<\/span>)/, `$1v${v}$2`, 'footer-version');
  html = replaceOnce(html, /"softwareVersion": "[^"]*"/, `"softwareVersion": "${v}"`, 'softwareVersion');
  return html;
}

function hreflangBlock() {
  const lines = LANGS.map(l => `  <link rel="alternate" hreflang="${l}" href="${appUrl(l)}">`);
  lines.push(`  <link rel="alternate" hreflang="x-default" href="${SITE}">`);
  return lines.join('\n');
}

function withHreflang(html) {
  return replaceOnce(html,
    /<!-- hreflang:start[^>]*-->[\s\S]*?<!-- hreflang:end -->/,
    m => m.replace(/(-->)[\s\S]*?(<!-- hreflang:end -->)/, `$1\n${hreflangBlock()}\n  $2`),
    'hreflang ブロック');
}

function buildAppPage(template, lang) {
  let h = template;
  const meta = t(lang, 'meta.title');
  const desc = t(lang, 'meta.description');

  h = replaceOnce(h, /<html lang="[^"]*">/, `<html lang="${lang}">`, 'html lang');
  // 相対パス（CSS・JS・Worker・画像・解説ページへのリンク）をサイトの先頭基準にする
  h = replaceOnce(h, /<meta charset="UTF-8">/, '<meta charset="UTF-8">\n  <base href="../">', 'charset');
  h = replaceOnce(h, /<title>[^<]*<\/title>/, `<title>${esc(meta)}</title>`, 'title');
  h = replaceOnce(h, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`, 'description');
  h = replaceOnce(h, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${appUrl(lang)}">`, 'canonical');
  h = replaceOnce(h, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${appUrl(lang)}">`, 'og:url');
  h = replaceOnce(h, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(meta)}">`, 'og:title');
  h = replaceOnce(h, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(desc)}">`, 'og:description');
  h = replaceOnce(h, /<meta property="og:locale" content="[^"]*">/, `<meta property="og:locale" content="${OG_LOCALE[lang]}">`, 'og:locale');
  h = h.replace(/"url": "https:\/\/nonogram-solver-creator\.vercel\.app\/"/, `"url": "${appUrl(lang)}"`);

  // 画面の文字（data-i18n）をその言語で書き込む。中に子要素があるものは実行時に JS が置き換える
  h = h.replace(/<(\w+)([^>]*?\sdata-i18n="([^"]+)"[^>]*)>([^<]*)<\/\1>/g,
    (all, tag, attrs, key) => `<${tag}${attrs}>${esc(t(lang, key))}</${tag}>`);
  h = h.replace(/<(\w+)([^>]*\sdata-i18n-placeholder="([^"]+)"[^>]*)>/g,
    (all, tag, attrs, key) => `<${tag}${attrs.replace(/\splaceholder="[^"]*"/, ` placeholder="${esc(t(lang, key))}"`)}>`);
  h = h.replace(/<(\w+)([^>]*\sdata-i18n-title="([^"]+)"[^>]*)>/g,
    (all, tag, attrs, key) => `<${tag}${attrs.replace(/\stitle="[^"]*"/, ` title="${esc(t(lang, key))}"`)}>`);

  // 「アプリ」はその言語のページへ。解説ページは日本語と英語のみなので、日本語以外からは英語版へ
  h = h.replace(/(<a[^>]*\sdata-nav="(\w+)"[^>]*\shref=")[^"]*(")/g,
    (all, a, slug, b) => `${a}${slug === 'app' ? lang + '/' : 'en/' + slug + '/'}${b}`);
  return h;
}

// ─── 3. 解説ページ ─────────────────────────────────────────

function readDoc(lang, slug) {
  const src = fs.readFileSync(path.join(ROOT, 'content', lang, slug + '.html'), 'utf8');
  const m = src.match(/^<!--([\s\S]*?)-->\s*([\s\S]*)$/);
  if (!m) throw new Error(`content/${lang}/${slug}.html の先頭に <!-- title: … --> がありません`);
  const meta = {};
  m[1].split('\n').forEach(line => {
    const mm = line.match(/^\s*(\w+)\s*:\s*(.+?)\s*$/);
    if (mm) meta[mm[1]] = mm[2];
  });
  return { ...meta, body: m[2].trim() };
}

const stripTags = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function faqJsonLd(body) {
  const items = [];
  const re = /<details class="faq"[^>]*>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g;
  let m;
  while ((m = re.exec(body))) {
    items.push({ '@type': 'Question', name: stripTags(m[1]),
      acceptedAnswer: { '@type': 'Answer', text: stripTags(m[2]) } });
  }
  return items.length ? { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items } : null;
}

function buildDocPage(lang, slug) {
  const doc = readDoc(lang, slug);
  const up = lang === 'ja' ? '../' : '../../';          // サイトの先頭への相対パス
  const appHref = lang === 'ja' ? up : up + 'en/';
  const docHref = s => (lang === 'ja' ? up : up + 'en/') + s + '/';
  const other = lang === 'ja' ? 'en' : 'ja';
  const appName = t(lang, 'app.title');

  const ld = [{
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: appName, item: appUrl(lang) },
      { '@type': 'ListItem', position: 2, name: doc.h1, item: docUrl(lang, slug) },
    ],
  }];
  const faq = slug === 'faq' ? faqJsonLd(doc.body) : null;
  if (faq) ld.push(faq);
  if (slug === 'algorithm') {
    ld.push({ '@context': 'https://schema.org', '@type': 'TechArticle', headline: doc.h1, description: doc.description,
      inLanguage: lang, url: docUrl(lang, slug),
      author: { '@type': 'Organization', name: 'SOFTEX CELWARE', url: 'https://www.softex-celware.com/' } });
  }

  const cur = s => (s === slug ? ' aria-current="page"' : '');
  const nav = [`<a href="${appHref}">${esc(t(lang, 'nav.app'))}</a>`]
    .concat(NAV_PAGES.map(s => `<a href="${docHref(s)}"${cur(s)}>${esc(t(lang, 'nav.' + s))}</a>`))
    .concat(`<a class="pg-consult" href="https://www.softex-celware.com/contact-3" target="_blank" rel="noopener">${esc(t(lang, 'nav.consult'))}</a>`)
    .join('\n        ');

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(doc.title)}</title>
  <meta name="description" content="${esc(doc.description)}">
  <meta name="author" content="SOFTEX CELWARE">
  <link rel="canonical" href="${docUrl(lang, slug)}">
  <link rel="alternate" hreflang="ja" href="${docUrl('ja', slug)}">
  <link rel="alternate" hreflang="en" href="${docUrl('en', slug)}">
  <link rel="alternate" hreflang="x-default" href="${docUrl('ja', slug)}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${docUrl(lang, slug)}">
  <meta property="og:title" content="${esc(doc.title)}">
  <meta property="og:description" content="${esc(doc.description)}">
  <meta property="og:image" content="${SITE}img/og-image.png">
  <meta property="og:locale" content="${OG_LOCALE[lang]}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" type="image/svg+xml" href="${up}favicon.svg">
  <link rel="icon" type="image/png" sizes="32x32" href="${up}favicon-32.png">
  <link rel="apple-touch-icon" sizes="180x180" href="${up}apple-touch-icon.png">
  <link rel="stylesheet" href="${up}css/pages.css">
  <script type="application/ld+json">
${JSON.stringify(ld.length === 1 ? ld[0] : ld, null, 2)}
  </script>
</head>
<body>
  <!-- アプリと同じヘッダー（今いるページを強調） -->
  <header class="pg-header">
    <div class="pg-left">
      <a class="pg-brand" href="${appHref}">${esc(appName)}</a>
      <a class="pg-version" href="${docHref('changelog')}"${cur('changelog')} title="${esc(t(lang, 'nav.changelog'))}">v${VERSION.version}</a>
      <nav class="pg-nav" aria-label="Help">
        ${nav}
      </nav>
    </div>
    <div class="pg-right">
      <a class="pg-lang" href="${lang === 'ja' ? up + 'en/' + slug + '/' : up + slug + '/'}" hreflang="${other}" lang="${other}">${other === 'en' ? 'English' : '日本語'}</a>
      <a class="pg-logo" href="https://www.softex-celware.com/" target="_blank" rel="noopener" title="SOFTEX CELWARE"><img src="${up}img/softex-celware-logo.svg" alt="SOFTEX CELWARE"></a>
    </div>
  </header>

  <main class="pg-main">
    <nav class="pg-crumbs"><a href="${appHref}">${esc(appName)}</a> › <span>${esc(doc.h1)}</span></nav>
    <h1>${esc(doc.h1)}</h1>
${doc.body}
    <p class="pg-cta"><a class="pg-btn pg-primary" href="${appHref}">${lang === 'ja' ? '▶ アプリを使う（無料）' : '▶ Open the solver (free)'}</a></p>
  </main>

  <footer class="pg-footer">
    <p><strong>${esc(t(lang, 'footer.dev'))}</strong> ${esc(t(lang, 'footer.offer'))}</p>
    <p class="pg-footer-links">
      <a class="pg-btn pg-primary" href="https://www.softex-celware.com/contact-3" target="_blank" rel="noopener">${esc(t(lang, 'footer.contact'))}</a>
      <a class="pg-btn" href="https://coconala.com/users/737430" target="_blank" rel="noopener">${esc(t(lang, 'footer.coconala'))}</a>
      <a class="pg-btn" href="https://www.softex-celware.com/" target="_blank" rel="noopener">${esc(t(lang, 'footer.site'))}</a>
    </p>
  </footer>
</body>
</html>
`;
}

// ─── 4. sitemap.xml / robots.txt ───────────────────────────

function sitemap() {
  const urls = [];
  for (const l of LANGS) {
    const alts = LANGS.map(x => `    <xhtml:link rel="alternate" hreflang="${x}" href="${appUrl(x)}"/>`)
      .concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}"/>`).join('\n');
    urls.push(`  <url>\n    <loc>${appUrl(l)}</loc>\n    <lastmod>${TODAY}</lastmod>\n${alts}\n  </url>`);
  }
  for (const s of DOC_PAGES) for (const l of DOC_LANGS) {
    const alts = DOC_LANGS.map(x => `    <xhtml:link rel="alternate" hreflang="${x}" href="${docUrl(x, s)}"/>`)
      .concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${docUrl('ja', s)}"/>`).join('\n');
    urls.push(`  <url>\n    <loc>${docUrl(l, s)}</loc>\n    <lastmod>${TODAY}</lastmod>\n${alts}\n  </url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`;
}

// ─── 実行 ─────────────────────────────────────────────────

function main() {
  const out = [];
  const indexFile = path.join(ROOT, 'index.html');
  const template = withVersion(withHreflang(fs.readFileSync(indexFile, 'utf8')));
  fs.writeFileSync(indexFile, template, 'utf8');
  out.push(`index.html（hreflang・バージョン v${VERSION.version}）`);

  for (const lang of LANGS) {
    if (lang === 'ja') continue;
    out.push(write(`${lang}/index.html`, buildAppPage(template, lang)));
  }
  for (const lang of DOC_LANGS) for (const slug of DOC_PAGES) {
    out.push(write(`${lang === 'ja' ? '' : lang + '/'}${slug}/index.html`, buildDocPage(lang, slug)));
  }
  out.push(write('sitemap.xml', sitemap()));
  out.push(write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`));

  console.log(`生成しました（${out.length}件）:\n  ` + out.join('\n  '));
}

main();
