#!/bin/bash
# sync-copies.sh — viewer 家族共用：前端＋route 同步到 InProgress 鏡像，並驗證借來的共用件。
#
# **這支腳本在六個 repo 裡是 byte-identical 的同一份**（docx-viewer / html-viewer /
# pptx-viewer / xlsx-viewer / rare-glyph / svg-style），照家族 A 類共用件慣例——
# 改任何一份都要六份一起同步（`md5` 應為單一 hash）。它靠**自己所在的 repo 目錄名**
# 決定要同步哪一支，所以六份不需要各自改參數（同 scripts/make-icons.py 的做法）。
#
# ⚠️ **兩個絕對不覆蓋的東西**（家族 canon，見 WORKFLOW.md Path A 的 A4）：
#   ① **`routes/upload.js`**：InProgress 的是加強版（雙鍵信封等），獨立版是最小版。
#      往回蓋會弄壞孵化器上所有 app 的上傳。本腳本只同步 `routes/<app>.js`。
#   ② **`public/upload/`**：使用者實際上傳的檔案，不是程式碼。本腳本從不觸碰。
#   ③ **該 app 的「活資料」登錄檔**（見下面的 LIVE_FILE）：repo 那份是可 clone 即跑的
#      **種子**，InProgress 那份是 owner 真正的資料，由前端的存檔端點寫回。
#      ⚠️⚠️ **2026-09-07 真的被這支腳本炸過一次**：第 ① 步是 `rsync -a` **整個目錄**，
#      `rare-glyph/glyphs.js` 因此從 **61 筆被蓋回 6 筆的種子**。
#      ⚠️ 當時兩個訊號都在說「不是這支腳本做的」——`mtime` 停在 06-29（`rsync -a` 保留來源
#      mtime）、腳本裡 `grep glyphs` **0 命中**（它不點名檔案，是整夾同步）。
#      **拆穿它的是 `ctime`**（rsync 設不了）。`markdown-library` 的 `library.js` 與
#      `web-launcher` 的 `sites.js` 早就學過同一課（樹根 CLAUDE.md v2.51／v2.60），
#      而這支**六份共用**的腳本一直沒有跟上。
#   （`app.js` 同理不同步——InProgress 是多 app monolith，結構本來就不同。）
#
# **回灌不是一次性的**：GitHub 版是權威，之後每次改前端都要再跑一次，
# 否則 3001 上跑的是舊版。這支腳本存在的理由就是「別靠記性」——
# faber-castell-color 曾因為同步腳本放在暫存區、暫存區被清掉而漏同步過一次。
#
# 用法：bash scripts/sync-copies.sh
set -u
REPO=$(cd "$(dirname "$0")/.." && pwd)
APP=$(basename "$REPO")
G=/Users/Shared/nodeapp/GitHub
I=/Users/Shared/nodeapp/InProgress
SRC=$REPO/public/apps/$APP
DST=$I/public/apps/$APP
FAIL=0

case "$APP" in
  docx-viewer|html-viewer|pptx-viewer|xlsx-viewer|rare-glyph|svg-style) ;;
  *) echo "$APP 不在 viewer 六支名單裡 —— 不同步（這支腳本認 repo 目錄名）"; exit 2 ;;
esac

# ⚠️ 這支 app 的「活資料」登錄檔（沒有就留空）。**加一支有寫入端的 app 時要回來加一行**
#    ——漏了的話，它的活資料會在下一次同步時被種子蓋掉，而畫面上看起來完全正常。
case "$APP" in
  rare-glyph) LIVE_FILE=glyphs.js ;;   # 缺字登錄，由 POST /api/rare-glyph/registry 寫回
  *)          LIVE_FILE= ;;
esac

EXCLUDE=(--exclude=.bak --exclude=.DS_Store)
DIFFX=(-x '.bak' -x '.DS_Store')
if [ -n "$LIVE_FILE" ]; then
  EXCLUDE+=(--exclude="$LIVE_FILE")
  DIFFX+=(-x "$LIVE_FILE")
fi

echo "=== [$APP] ① 前端 → InProgress 鏡像（排除 .bak／.DS_Store${LIVE_FILE:+／$LIVE_FILE}）==="
mkdir -p "$DST"
rsync -a "${EXCLUDE[@]}" "$SRC/" "$DST/"
if diff -rq "${DIFFX[@]}" "$SRC" "$DST" > /dev/null; then
  n=$(find "$SRC" -type f -not -path '*/.bak/*' ${LIVE_FILE:+-not -name "$LIVE_FILE"} | wc -l | tr -d ' ')
  echo "  OK  與獨立版逐檔相同（$n 個檔${LIVE_FILE:+，不含 $LIVE_FILE}）"
else
  echo "  MISMATCH  以下有差異："
  diff -rq "${DIFFX[@]}" "$SRC" "$DST"
  FAIL=1
fi

if [ -n "$LIVE_FILE" ]; then
  echo "=== ①b $LIVE_FILE 護欄（應為「兩邊不同」——**相同才要擔心**）==="
  if [ ! -f "$DST/$LIVE_FILE" ]; then
    echo "  NOTE  InProgress 還沒有 $LIVE_FILE；第一次回灌，複製一份種子過去"
    cp "$SRC/$LIVE_FILE" "$DST/$LIVE_FILE"
  elif diff -q "$SRC/$LIVE_FILE" "$DST/$LIVE_FILE" > /dev/null 2>&1; then
    echo "  ⚠️  兩邊的 $LIVE_FILE 一模一樣。若 InProgress 本來有你的資料，它可能已被覆蓋——"
    echo "      請確認 $DST/$LIVE_FILE 仍是你的資料，而不是 repo 的種子（$DST/.bak/ 有歷次備份）。"
  else
    echo "  OK  兩邊不同（repo $(wc -c < "$SRC/$LIVE_FILE" | tr -d ' ') B ／ InProgress $(wc -c < "$DST/$LIVE_FILE" | tr -d ' ') B）"
  fi
fi

echo "=== ② route → InProgress（**只搬 $APP.js，絕不碰 upload.js**）==="
cp "$REPO/routes/$APP.js" "$I/routes/$APP.js"
if diff -q "$REPO/routes/$APP.js" "$I/routes/$APP.js" > /dev/null; then
  echo "  OK  routes/$APP.js 相同"
else
  echo "  MISMATCH  routes/$APP.js"; FAIL=1
fi
if [ -f "$REPO/routes/upload.js" ]; then
  if diff -q "$REPO/routes/upload.js" "$I/routes/upload.js" > /dev/null 2>&1; then
    echo "  ⚠️  本 repo 與 InProgress 的 routes/upload.js 一模一樣——"
    echo "      InProgress 應為加強版；請確認它沒有被誰用最小版蓋掉。"
  else
    echo "  OK  routes/upload.js 兩邊本就不同（最小版 vs 加強版），未觸碰"
  fi
fi
echo "  註：route 有變更時 **3001 常駐 server 要重啟**（純靜態改動則不必）。"

echo "=== ③ 借來的共用件：與權威版比對（只驗不抓；本 app 沒有的自動略過）==="
check() {  # $1=檔名  $2=權威版絕對路徑  $3=權威版說明
  [ -f "$SRC/$1" ] || return 0            # 這支 app 沒用到就不比
  local a b
  a=$(md5 -q "$SRC/$1"); b=$(md5 -q "$2" 2>/dev/null) || b=MISSING
  if [ "$a" = "$b" ]; then
    printf "  OK        %-22s %s\n" "$1" "$a"
  else
    printf "  MISMATCH  %-22s local=%s auth=%s\n" "$1" "$a" "$b"
    printf "            ← 權威版：%s\n" "$3"
    FAIL=1
  fi
}
FAM=$G/nodeapp-webapp-family
check materialize-dark.css "$FAM/materialize-dark.css" "nodeapp-webapp-family（§5.1）"
check side-tool.css        "$FAM/side-tool.css"        "nodeapp-webapp-family（§5.5）"
check side-tool.js         "$FAM/side-tool.js"         "nodeapp-webapp-family（§5.5）"
check i18n.js              "$FAM/i18n.js"              "nodeapp-webapp-family（locales/*.js 本 app 自維護，不比）"
check mermaid-elk.js       "$FAM/mermaid-elk.js"       "nodeapp-webapp-family（§4.3）"
check thinking-dot.css     "$G/thinking-dot/public/apps/thinking-dot/thinking-dot.css" "thinking-dot repo（§4.6 權威版與調校台）"
check filter-clear.css     "$G/local-reader/public/apps/local-reader/filter-clear.css" "local-reader（家族 §5.12）"
check filter-clear.js      "$G/local-reader/public/apps/local-reader/filter-clear.js"  "local-reader（家族 §5.12）"

echo "=== ④ icon 產生器：六份應為單一 hash ==="
h=$(for r in docx-viewer html-viewer pptx-viewer xlsx-viewer rare-glyph svg-style; do
      md5 -q "$G/$r/scripts/make-icons.py" 2>/dev/null; done | sort -u)
n=$(printf '%s\n' "$h" | grep -c .)
if [ "$n" = "1" ]; then echo "  OK  make-icons.py 六份單一 hash（$h）"
else echo "  MISMATCH  make-icons.py 有 $n 種版本，應為 1"; FAIL=1; fi

echo
if [ "$FAIL" -eq 0 ]; then echo "全部通過。"; else
  echo "有項目不一致（見上），未自動修正——請到權威版那側同步。"; fi
exit "$FAIL"
