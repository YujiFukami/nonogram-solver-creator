# Nonogram Solver & Creator

**お絵かきロジック（イラストロジック・ピクロス・ノノグラム）の自動解答＆問題作成 Web アプリ**

Free online nonogram (picross / griddlers / hanjie) solver and puzzle creator with step-by-step visualization.

[![Live Demo](https://img.shields.io/badge/demo-Live%20App-blue)](https://nonogram-solver-creator.vercel.app/)

**🌐 Web App: https://nonogram-solver-creator.vercel.app/**

---

## Features / 機能

### Solver / 自動解答
- Automatic puzzle solving with constraint propagation + intensive line solving
- Step-by-step visualization of the solving process
- Supports puzzles up to 300×300
- File import/export (.txt format)
- Image export (with or without hint numbers)

### Creator / 問題作成
- Convert any image to a nonogram puzzle
- Adjustable threshold, brightness, contrast, edge boost
- Multiple conversion modes: threshold, adaptive, dither, outline
- Post-processing: closing, isolated cell removal, minimum blob size
- Manual grid editing with variable brush sizes
- Reference image overlay for fine-tuning
- Puzzle validation (unique solution check with progress bar)
- Project save/load (.ncp.json)
- Print-ready PDF output (auto portrait/landscape)

### QR Code / QRコード問題生成
- Generate nonogram puzzles from QR codes
- Diagonal bridge correction with expansion ratio
- Outer border fill, noise injection for improved solvability
- Manual grid editing and validation
- Transfer to solver tab for verification

### Internationalization / 多言語対応 (12 languages)

| Language | Local Name | Puzzle Name |
|----------|-----------|-------------|
| Japanese | 日本語 | お絵かきロジック / イラストロジック / ピクロス |
| English | English | Nonogram / Picross / Griddlers |
| Russian | Русский | Японский кроссворд |
| Korean | 한국어 | 네모로직 / 노노그램 |
| French | Français | Logimage |
| Italian | Italiano | Crucipixel |
| German | Deutsch | Nonogramm / Japanisches Rätsel |
| Spanish | Español | Nonograma / Crucigrama japonés |
| Turkish | Türkçe | Kare Karalamaca |
| Simplified Chinese | 简体中文 | 数织 / 逻辑拼图 |
| Traditional Chinese | 繁體中文 | 數織 / 數圖 |
| Polish | Polski | Japońska krzyżówka |

---

## Demo / デモ

**[https://yujifukami.github.io/nonogram-solver-creator/](https://yujifukami.github.io/nonogram-solver-creator/)**

---

## Tech Stack / 技術スタック

- **Pure HTML/CSS/JavaScript** — No frameworks, no build step
- **Solver algorithm**: Forward/Backward DP constraint propagation + intensive line solving (probe-based)
- **Canvas-based rendering** for grid display and image processing
- **Web Worker** for non-blocking solver execution
- **i18n**: Custom lightweight engine with `data-i18n` attributes

---

## Getting Started / 使い方

### Online
Visit the [demo site](https://yujifukami.github.io/nonogram-solver-creator/).

### Local
```bash
# Clone the repository
git clone https://github.com/YujiFukami/nonogram-solver-creator.git
cd nonogram-solver-creator

# Serve the web directory (any static server works)
npx serve web -p 5501

# Open http://localhost:5501
```

No build step required — just serve the `web/` directory.

---

## File Format / ファイル形式

### Puzzle file (.txt)
```
rows,cols
row_hint_1
row_hint_2
...
col_hint_1
col_hint_2
...
```

### Project file (.ncp.json)
JSON containing image data, crop position, settings, and grid state for the Creator tab.

---

## Algorithm / アルゴリズム

The solver implements a VBA-origin algorithm with three layers:

1. **Line Solve** (`lineSolve`): Forward/Backward DP to compute `canBeBlack`/`canBeWhite` for each cell in O(n×m)
2. **Intensive Line Solve** (`intensiveLineSolve`): For stuck lines, probes each unknown cell as BLACK/WHITE, runs lineSolve, and extracts common results
3. **Full Solver** (`NonogramSolver.solve`): Iterates line solve across all rows/columns, falls back to intensive solve on stagnation, terminates after 2 consecutive stalls

No backtracking/guessing — purely logical deduction.

---

## License / ライセンス

MIT License

---

## Author

Yuji Fukami

---

<sub>Also known as: Nonogram, Picross, Griddlers, Hanjie, Paint by Numbers, Japanese Crossword, お絵かきロジック, イラストロジック, ピクロス, ノノグラム, ロジックアート, Японский кроссворд, 네모로직, Logimage, Crucipixel, Nonogramm, Nonograma, Kare Karalamaca, 数织, 數織, Malowane Liczbami</sub>
