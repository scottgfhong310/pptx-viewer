#!/usr/bin/env python3
"""make-icons — viewer 家族共用模板：由母版參數產出整套 icon（SVG / PNG / .ico / manifest）。

**這支腳本在六個 repo 裡是 byte-identical 的同一份**（docx-viewer / html-viewer /
pptx-viewer / xlsx-viewer / rare-glyph / svg-style），照家族 A 類共用件慣例——
改任何一份都要六份一起同步（`md5` 應為單一 hash）。它靠**自己所在的 repo 目錄名**
決定要產哪一支的 icon，所以六份不需要各自改參數。

**共用的是 tile 系統，不是圖案**：同樣的圓角方塊、同樣的「紙」與同樣的 accent
（`#90caf9`——這六支的 `--accent` 本來就相同），所以它們一眼是一套。
差異只在裡面那枚**純幾何標記**，各自扣住那支在做什麼：

    docx-viewer   段落橫線（文字文件）
    xlsx-viewer   3×3 網格＋深色表頭（試算表）
    pptx-viewer   16:9 實心區塊＋導覽條（投影片）
    html-viewer   一對角括號（HTML 片段）
    svg-style     一個圓左右分明暗（同一張圖同時適應 dark / light —— 它的全部目的）
    rare-glyph    外框內左窄右寬兩塊（⿰ 組字式 —— 缺字是「拼出來」的）

**刻意不用副檔名字樣**（`.docx` 這種）：六支裡有兩支根本不是文件檢視器，
套上去會說謊；純幾何也省掉字型依賴（PyMuPDF 光柵化時不必內嵌字型）。

⚠️ PyMuPDF 的兩個限制（faber-castell-color / copic-color / thangka-trace 都踩過）：
  ① **不渲染 linearGradient**，會整片退成黑色 → 母版一律純色底。
  ② **以 SVG 宣告的 width/height 為渲染基準、不是 viewBox** → 倍率要用
     「目標 ÷ 實際 page 寬」反推，寫死 size/100 會得到完全錯誤的尺寸。

用法：python3 scripts/make-icons.py
"""
import json
import os
import fitz
from PIL import Image

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
APP = os.path.basename(REPO)
OUT = os.path.join(REPO, 'public', 'apps', APP, 'icons')

ACCENT = '#90caf9'   # 六支共用的 --accent
INK = '#4a6b8a'      # accent 的深色親戚：表頭 / 暗半邊
PAPER = '#eef2f7'    # 「紙」
DARK_TILE = '#151a24'
DARK_EDGE = '#10131a'
LIGHT_TILE = '#f6f8fa'
LIGHT_EDGE = '#ffffff'

MANIFEST_NAMES = {
    'docx-viewer':  ('DOCX', 'View Word (.docx) documents in the browser.'),
    'xlsx-viewer':  ('XLSX', 'View spreadsheets (.xlsx/.csv) in the browser.'),
    'pptx-viewer':  ('PPTX', 'View PowerPoint (.pptx) decks in the browser.'),
    'html-viewer':  ('HTML', 'View Claude conversation HTML fragments in the browser.'),
    'svg-style':    ('SVG style', 'Make exported SVGs adapt to both dark and light themes.'),
    'rare-glyph':   ('Rare glyph', 'Curate rare/missing glyphs from classical texts (IDS).'),
}


def sheet(x, y, w, h, rx=5):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{PAPER}"/>'


def mark(app, big):
    """回傳該 app 的幾何標記。big=True 為母版，False 為 favicon（放大簡化，16px 才不糊）。"""
    if big:
        sx, sy, sw, sh = 24, 16, 52, 68     # 紙
        pad, lw = 9, 5                       # 內縮、線粗
    else:
        sx, sy, sw, sh = 16, 10, 68, 80
        pad, lw = 11, 8
    ix, iy, iw, ih = sx + pad, sy + pad, sw - pad * 2, sh - pad * 2
    s = sheet(sx, sy, sw, sh)

    if app == 'docx-viewer':
        rows = 4 if big else 3
        gap = ih / (rows * 2 - 1)
        for i in range(rows):
            y = round(iy + i * gap * 2, 1)
            w = round(iw * (0.55 if i == rows - 1 else 1), 1)
            s += (f'<rect x="{ix}" y="{y}" width="{w}" height="{round(gap, 1)}" '
                  f'rx="{round(gap / 2, 1)}" fill="{ACCENT}"/>')

    elif app == 'xlsx-viewer':
        n = 3 if big else 2
        g = 1.6 if big else 2.2
        cw = round((iw - g * (n - 1)) / n, 2)
        ch = round((ih - g * (n - 1)) / n, 2)
        for r in range(n):
            for c in range(n):
                s += (f'<rect x="{round(ix + c * (cw + g), 2)}" y="{round(iy + r * (ch + g), 2)}" '
                      f'width="{cw}" height="{ch}" rx="1" '
                      f'fill="{INK if r == 0 else ACCENT}"/>')

    elif app == 'pptx-viewer':
        bh = round(ih * 0.66, 1)
        s += (f'<rect x="{ix}" y="{iy}" width="{iw}" height="{bh}" rx="2" fill="{ACCENT}"/>'
              f'<rect x="{round(ix + iw * 0.25, 1)}" y="{round(iy + ih - lw, 1)}" '
              f'width="{round(iw * 0.5, 1)}" height="{lw}" rx="{lw / 2}" fill="{INK}"/>')

    elif app == 'html-viewer':
        cx, cy = ix + iw / 2, iy + ih / 2
        dx, dy = iw * 0.30, ih * 0.26
        for sgn in (-1, 1):
            # 尖端朝**外**才是 `<` 與 `>`；朝內會讀成一個 ✕（第一版就踩了這個）
            xo = round(cx + sgn * iw * 0.44, 1)          # 外側＝尖端
            xi = round(cx + sgn * (iw * 0.44 - dx), 1)   # 內側＝開口
            s += (f'<polyline points="{xi},{round(cy - dy, 1)} {xo},{round(cy, 1)} '
                  f'{xi},{round(cy + dy, 1)}" fill="none" stroke="{ACCENT}" '
                  f'stroke-width="{lw}" stroke-linecap="round" stroke-linejoin="round"/>')

    elif app == 'svg-style':
        r = round(min(iw, ih) / 2, 1)
        cx, cy = round(ix + iw / 2, 1), round(iy + ih / 2, 1)
        # 左半亮、右半暗：同一個形狀在兩種主題下都成立
        s += (f'<path d="M {cx} {round(cy - r, 1)} A {r} {r} 0 0 0 {cx} {round(cy + r, 1)} Z" '
              f'fill="{ACCENT}"/>'
              f'<path d="M {cx} {round(cy - r, 1)} A {r} {r} 0 0 1 {cx} {round(cy + r, 1)} Z" '
              f'fill="{INK}"/>')

    elif app == 'rare-glyph':
        sw2 = lw * 0.8
        s += (f'<rect x="{ix}" y="{iy}" width="{iw}" height="{ih}" rx="2" fill="none" '
              f'stroke="{ACCENT}" stroke-width="{sw2}"/>')
        # 框內左右兩塊＝⿰；中間留明顯的縫，否則縮小後會糊成一整塊
        m = sw2 * 1.8                      # 框與塊的間距
        gap = sw2 * 1.4                    # 兩塊之間的縫
        bx, by = round(ix + m, 1), round(iy + m, 1)
        bh = round(ih - m * 2, 1)
        tw = iw - m * 2 - gap
        lw2 = round(tw * 0.42, 1)          # 左窄
        s += (f'<rect x="{bx}" y="{by}" width="{lw2}" height="{bh}" fill="{INK}"/>'
              f'<rect x="{round(bx + lw2 + gap, 1)}" y="{by}" '
              f'width="{round(tw - lw2, 1)}" height="{bh}" fill="{ACCENT}"/>')
    else:
        raise SystemExit(f'{APP} 不在 viewer 模板的名單裡 —— 不產出（不亂套一個圖案）')
    return s


def tile(size, inner, bg, edge, hairline=False):
    hl = ('<rect x="0.6" y="0.6" width="98.8" height="98.8" rx="22" fill="none" '
          'stroke="#d4dae2" stroke-width="1.2"/>') if hairline else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" '
            f'width="{size}" height="{size}">'
            f'<rect width="100" height="100" rx="22.5" fill="{bg}"/>{hl}'
            f'<g stroke="{edge}" stroke-width="1.2">{inner}</g></svg>')


def build_svgs():
    m, f = mark(APP, True), mark(APP, False)
    files = {
        f'{APP}-icon.svg':       tile(512, m, DARK_TILE, DARK_EDGE),
        f'{APP}-icon-light.svg': tile(512, m, LIGHT_TILE, LIGHT_EDGE, True),
        'favicon.svg':           tile(64, f, DARK_TILE, DARK_EDGE),
        'favicon-light.svg':     tile(64, f, LIGHT_TILE, LIGHT_EDGE, True),
    }
    for name, svg in files.items():
        open(os.path.join(OUT, name), 'w').write(svg)
    return list(files)


def build_pngs():
    src = {16: 'favicon.svg', 32: 'favicon.svg', 48: 'favicon.svg'}
    for s in (64, 128, 180, 192, 256, 512):
        src[s] = f'{APP}-icon.svg'
    for size, f in sorted(src.items()):
        page = fitz.open(os.path.join(OUT, f))[0]
        z = size / page.rect.width          # ⚠️ 由實際 page 寬反推，不可寫死 size/100
        pm = page.get_pixmap(alpha=True, matrix=fitz.Matrix(z, z))
        assert pm.width == size == pm.height, f'{size} → {pm.width}x{pm.height}'
        pm.save(os.path.join(OUT, f'icon-{size}.png'))
    Image.open(os.path.join(OUT, 'icon-48.png')).convert('RGBA').save(
        os.path.join(OUT, 'favicon.ico'), format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])


def build_manifest():
    short, desc = MANIFEST_NAMES[APP]
    m = {
        "name": APP,
        "short_name": short,
        "description": desc,
        "start_url": f"/apps/{APP}/",
        "scope": f"/apps/{APP}/",
        "display": "standalone",
        "background_color": "#0f1115",
        "theme_color": "#0f1115",
        "icons": [
            {"src": "icon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "icon-512.png", "sizes": "512x512", "type": "image/png"},
            {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }
    open(os.path.join(OUT, 'manifest.json'), 'w').write(
        json.dumps(m, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    if APP not in MANIFEST_NAMES:
        raise SystemExit(f'{APP} 不在 viewer 模板的名單裡 —— 不產出（不亂套一個圖案）')
    os.makedirs(OUT, exist_ok=True)
    print(f'{APP} :', ', '.join(build_svgs()))
    build_pngs()
    build_manifest()
    print('產出       :', len(os.listdir(OUT)), '個檔於 icons/')
