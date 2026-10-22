<p align="center">
  <img src="assets/readme/shinobu-readme-banner-soft.png" alt="ShinobuTranslator - 浏览器中的漫画翻译扩展">
</p>

<h1 align="center">ShinobuTranslator</h1>

<p align="center">
  在浏览器里直接翻译漫画图片的 Chromium / Firefox 扩展与网页版。
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/pgehhpbnifjlalmmnpiebkjhphojffef"><img alt="Chrome Web Store" src="https://img.shields.io/badge/Chrome%20Web%20Store-安装-4285F4?style=flat-square"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/License-GPL--3.0-blue?style=flat-square"></a>
  <a href="https://github.com/zyddnys/manga-image-translator"><img alt="基于 manga-image-translator" src="https://img.shields.io/badge/基于-manga--image--translator-green?style=flat-square"></a>
  <a href="https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_rec_onnx"><img alt="OCR PP-OCRv6 medium" src="https://img.shields.io/badge/OCR-PP--OCRv6%20medium-blue?style=flat-square"></a>
  <a href="https://huggingface.co/mayocream/aot-inpainting"><img alt="模型 AOT Inpaint" src="https://img.shields.io/badge/模型-AOT%20Inpaint-orange?style=flat-square"></a>
  <a href="https://huggingface.co/huyvux3005/manga109-segmentation-bubble"><img alt="模型 YOLO11n Bubble" src="https://img.shields.io/badge/模型-YOLO11n%20Bubble-orange?style=flat-square"></a>
</p>

一款漫画翻译扩展程序，识别/去字等模型仅在浏览器本地运行，无需单独服务器。主要支持日文漫画场景，自动进行识别、翻译、嵌字全流程。同时提供基于Nano Banana的翻译模式，可以利用Gemini订阅对各种类型漫画进行端到端翻译。对于 X / Pixiv / eHentai / GoMuRaw 做了专门适配，其他网站均可使用右键/键盘快捷键进行截图翻译。

## 快速开始

### Chrome Web Store

> 项目版本更新较快，Chrome Web Store 需等待审核，可能落后于最新版本。如需体验最新功能，建议使用下方的手动安装。

[![Chrome Web Store](https://developer.chrome.com/static/docs/webstore/branding/image/UV4C4ybeBTsZt43U4xis.png)](https://chromewebstore.google.com/detail/pgehhpbnifjlalmmnpiebkjhphojffef)

### 手动安装

1. 前往 [Releases](../../releases) 下载当前版本对应浏览器的压缩包：Chromium 使用 `ShinobuTranslator-chromium-v*.zip`，Firefox 使用 `ShinobuTranslator-firefox-v*.zip`
2. 解压到本地文件夹
3. Chrome / Edge：打开扩展管理页，启用「开发者模式」，选择「加载已解压的扩展程序」
4. Firefox Desktop 140+：打开 `about:debugging#/runtime/this-firefox`，选择「临时载入附加组件」，再选择解压目录中的 `manifest.json`

## 效果展示

<table>
<thead>
<tr>
<th align="center" width="50%">原始图片</th>
<th align="center" width="50%">翻译后图片</th>
</tr>
</thead>
<tbody>
<tr>
<td align="center" width="50%">
  <a href="https://user-images.githubusercontent.com/31543482/232265329-6a560438-e887-4f7f-b6a1-a61b8648f781.png">
    <img src="https://user-images.githubusercontent.com/31543482/232265329-6a560438-e887-4f7f-b6a1-a61b8648f781.png">
  </a>
  <br>
  <a href="https://twitter.com/09ra_19ra/status/1647079591109103617/photo/1">Source @09ra_19ra</a>
</td>
<td align="center" width="50%">
  <a href="assets/readme/translated1.png">
    <img src="assets/readme/translated1.png">
  </a>
</td>
</tr>
<tr>
<td align="center" width="50%">
  <a href="https://user-images.githubusercontent.com/31543482/232265794-5ea8a0cb-42fe-4438-80b7-3bf7eaf0ff2c.png">
    <img src="https://user-images.githubusercontent.com/31543482/232265794-5ea8a0cb-42fe-4438-80b7-3bf7eaf0ff2c.png">
  </a>
  <br>
  <a href="https://twitter.com/rikak/status/1642727617886556160/photo/1">Source @rikak</a>
</td>
<td align="center" width="50%">
  <a href="assets/readme/translated4.png">
    <img src="assets/readme/translated4.png">
  </a>
</td>
</tr>
</tbody>
</table>

## 工作流程

### 本地 OCR 翻译流程

```text
图片获取 -> 文本检测 -> 气泡检测 -> OCR 识别 -> 文本翻译 -> 蒙版细化 -> 去字修复 -> 自动排版 -> 译图展示
```

本地流程适合常规漫画翻译：视觉模型在浏览器端完成检测、识别、去字和排版，只把识别出的文本交给谷歌翻译或大模型翻译。

### Nano Banana 图像翻译流程

```text
图片获取 -> 发送图片与提示词 -> 多模态理解和翻译 -> 去字重绘和嵌字 -> 译图展示
```

Nano Banana 流程不走本地 OCR、去字和自动排版链路，而是把图片交给 Nano Banana 进行端到端图像翻译。对于有拟声词和手写字体的漫画翻译效果更佳，而且可以支持英文、韩文等各种语言，但是会对漫画内容本身有一定的影响。

## 功能特性

| 模块 | 说明 |
| --- | --- |
| 文本检测 | 自动识别漫画图中的文字区域 |
| 气泡检测 | 辅助定位对白区域，让去字和嵌字更自然 |
| OCR 识别 | 使用浏览器端 ONNX 模型识别日文漫画文字 |
| 翻译 | 支持谷歌翻译、DeepSeek、GLM、Kimi、Qwen（阿里云百炼）、Doubao（火山方舟）、MiniMax、MiMo、OpenAI、自定义供应商 |
| Nano Banana | 支持使用 Gemini 订阅的 Nano Banana 图像翻译流程，用于端到端翻译和嵌字 |
| 去字修复 | 使用本地去字模型擦除原文 |
| 自动排版 | 根据文字区域、方向、颜色和气泡空间自动嵌入译文 |
| 原图切换 | 支持原图和译图切换查看 |
| 截图翻译 | 通过快捷键或右键菜单选择页面区域翻译 |

## 设置界面

Qwen（阿里云百炼）使用北京地域的 API Key 和固定的官方兼容接口，模型预设为 `qwen3.8-max`、`qwen3.8-flash`。文本翻译默认关闭思考，也可选择 Low、Medium 或 XHigh。请求参数遵循百炼的 [Chat Completions API](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions) 与 [思考模式说明](https://help.aliyun.com/zh/model-studio/deep-thinking)。

<table>
<tr>
<td align="center" width="50%">
  <img src="assets/readme/popup-settings-deepseek-rounded.png" alt="DeepSeek 设置">
  <br>
  文本翻译设置
</td>
<td align="center" width="50%">
  <img src="assets/readme/popup-settings-nano-banana-rounded.png" alt="Nano Banana 设置">
  <br>
  Nano Banana 图像翻译设置
</td>
</tr>
</table>

## 使用方式

### PDF 翻譯（本機修改版）

安裝或重新載入擴充功能後，直接開啟 PDF 網址會自動切換至 **Anderson Index for PDF 翻譯** 閱讀器。
同時支援以 `Content-Type: application/pdf` 提供、沒有 `.pdf` 副檔名的網址；附件下載不會自動切換。
閱讀器提供翻頁、指定頁碼，以及底部「翻譯當前頁／翻譯全部」按鈕，沿用擴充功能的翻譯設定。
PDF 以本地打包的 PDF.js 逐頁轉為影像，再交給既有 OCR、翻譯及去字排版流程。
原始 PDF 不會因閱讀而整份上傳；文字／影像翻譯的傳送方式依原有設定而定。

#### Batch 省費模式與通知

閱讀器的「翻譯模式」可選 **即時翻譯** 或 **Batch 省費模式**。Batch 使用 OpenAI 官方 Files／Batches API 與 `gpt-5-mini`（low reasoning），需要設定中的 OpenAI API Key；不使用 ChatGPT 訂閱登入。依官方 Batch API 計價，相同模型的 API 費用較一般請求低 50%，完成窗口為 24 小時。

1. 選擇 PDF，切換 Batch，按「整份 PDF 背景翻譯」。準備期間請保持分頁開啟。支援 1–500 頁，準備資料上限 200 MB；大檔請拆分。
2. 程式逐頁擷取影像與前後頁來源文字，以最多 8 MB 的 JSONL 檔分組送出，已有快取的頁面會略過。掃描 PDF 也由模型直接辨識圖片並翻譯，不呼叫即時 OCR 引擎。
3. 完成準備並送出後可關閉 PDF 分頁。擴充功能透過每分鐘的 alarm 查詢並自動寫入本機頁面快取；關閉瀏覽器時暫停本機查詢，重新開啟後繼續。準備被中斷時，重新選取同一 PDF 可接續。
4. 全部完成或部分完成時顯示 **Chrome 桌面通知**，包含成功與失敗頁數。點擊通知開啟工作狀態；重新選取原本 PDF 後即可讀取快取。請允許瀏覽器與作業系統通知；若通知失敗，閱讀器會顯示提示。工作通知成功後不會重複彈出。
5. 「取消 Batch 工作」會請求 OpenAI 停止尚未完成的工作（可能需 10 分鐘，已處理請求仍可能收費），並保留成功譯頁。部分失敗可再次按背景翻譯，只送出缺少快取的頁面。「清除此 PDF 快取」會取消相應未完成工作並停止匯入其後續結果。

Batch 的頁面影像及相鄰頁來源文字會上傳 OpenAI，批次內頁面可平行執行，因此上下文參考使用來源文字，沒有依序等待前頁譯文。模型回傳段落座標與譯文後，以白底文字區塊覆蓋原文；複雜彩色背景與直排版面效果可能與即時去字排版不同。結果在閱讀器顯示，不會回寫原 PDF。

工作編號、準備資料與進度保存在擴充功能本機 IndexedDB，不包含 API Key；Key 僅由背景讀取既有憑據設定。程式不會在送出狀態不明時盲目重送付費 Batch，而會用工作 metadata 找回遠端工作。上傳到 OpenAI 的批次檔案依該服務的資料保留規則處理，本機清除快取不等同刪除遠端檔案。

驗證：`node tests/browser/pdfBatch.smoke.mjs`（使用模擬 OpenAI 回應，不產生實際模型費用）。

#### Batch 工作清單

從閱讀器工具列或擴充功能彈出頁按 **Batch 工作清單**，即使未開啟 PDF 也可查看所有工作。清單提供檔名／工作編號搜尋與狀態篩選，顯示模型、目標語言、建立／完成時間、準備頁數、OpenAI 回報已處理頁數、已寫入快取頁數及失敗頁數。展開「頁面明細與工作編號」可查看失敗頁碼、原因及遠端 Batch 編號。工作紀錄保存在本機，重新開啟瀏覽器後仍可查閱。

- **取消工作**：可從清單取消任一份 PDF 的準備或背景處理，遠端取消尚未完成時顯示「取消中」並暫停重試。
- **重試失敗頁面**：保留失敗頁原圖及相鄰來源文字，只重送尚無有效快取的失敗頁，不需重新選擇原 PDF；模型與語言沿用原工作。重試建立獨立工作，原始完成／失敗紀錄不被覆寫，可由「查看重試工作」追蹤後續結果。重複點擊會指向同一重試工作，避免重複送出。
- 成功頁原圖在完成後釋放；失敗頁原圖保留至建立重試工作的準備資料，然後轉由新工作持有。完成通知會帶上 PDF 檔名並開啟工作清單。
- 舊版工作沒有保存檔名、完成時間或逐頁失敗原圖，會以舊工作編號識別；缺少原圖時需重新選擇原 PDF，再透過背景翻譯補送未完成頁面。

驗證：`node tests/browser/pdfBatchJobs.smoke.mjs`，涵蓋多文件進度、取消、重新開啟後的完成紀錄、無 PDF 分頁的失敗頁重試、篩選搜尋與譯頁快取。OpenAI 回應使用模擬資料，不送出真實付費工作。

#### YomiToku 本機 OCR 選項

OCR 選單新增 **YomiToku（本機服務）**，保留 PaddleOCR 與 OpenAI OCR。先執行專案根目錄的 `啟動YomiToku.cmd`：首次會在 `.build-tools/yomitoku-env` 建立 Python 環境並安裝 CPU PyTorch／YomiToku，模型首次載入需要下載。需 Python 3.10–3.13。出現 `YomiToku ready` 後即可使用；關閉服務視窗即停止。服務僅綁定 `127.0.0.1:8766`，辨識圖片在本機處理，不送到 YomiToku 雲端。文字翻譯仍依您選擇的翻譯供應商傳送；Batch 模式使用上方獨立流程。

YomiToku 是可選的外部 Python 依賴，使用 `dbnetv2` 偵測與 `parseq-tiny-dynw-v4` 辨識模型。依 [官方專案](https://github.com/kotaro-kinoshita/yomitoku) 採 CC BY-NC-SA 4.0 授權；不屬於本專案 MIT 授權範圍。

- PDF 預設「適應高度」，使用工具列下方到視窗底部的可用空間；也可切換「整頁適應畫面」、「適合寬度」或「全螢幕」。翻譯按鈕及模式選單位於上方工具列。
- Chromium 的影像處理、字型與排版管線移至專用 Worker；翻譯期間可翻頁，並可按「停止翻譯」。
  首次模型／GPU 初始化仍可能造成短暫畫面停頓，實際速度受硬體影響。
- LLM 翻譯會附上本頁、前後頁可擷取的 PDF 文字，以及最多三個已完成前頁的原文與譯文。
  掃描 PDF 沒有文字層時，以本頁 OCR 及已完成前頁的 OCR／譯文作為上下文；這些參考文字會隨 LLM 請求送給所選服務。
- 已完成譯頁存入本機 IndexedDB；相同 PDF 內容與設定再次開啟時直接還原，批次翻譯也會跳過有效快取。
- Chrome PDF 閱讀器的「翻譯全部」預設每組並行 2 頁，上方「同時處理」可改為 1 頁節省記憶體。
  每頁完成立即快取；下一組等前一組完成後，帶入最多三個已完成前頁的原文與譯文。同組頁面仍保留本頁／相鄰頁文字，但不等待彼此尚未產出的譯文。
  背景以最多兩個獨立 Worker 處理圖片；其他不支援多 Worker 的宿主會沿用單頁佇列。
  快取以 SHA-256 綁定 PDF 內容與不含憑證的設定，最多保留 256 MiB／500 頁，超出後移除較舊紀錄。
  「清除此 PDF 快取」清除目前 PDF／設定組合的快取。清除瀏覽器擴充功能資料或移除擴充功能亦會清除資料。
- OpenAI 模型選單包含 `gpt-4o-mini`；請選「API Key」認證。GPT-4o／4.1 請求不帶不相容的 `reasoning_effort` 參數。
  API／OCR 失敗時，閱讀器會顯示失敗階段或供應商錯誤。

本機 PDF 可由擴充功能彈出頁的「開啟 PDF 翻譯閱讀器」進入，再按「選擇 PDF」。
直接開啟 `file:///` PDF 時，需先在 Chrome 擴充功能詳細資料開啟「允許存取檔案網址」；
未授權、需要登入、或無法重新下載的 PDF，請先下載，再用選檔方式開啟。
加密 PDF 會提示輸入密碼。可按「使用原始 PDF 閱讀器」返回原本的瀏覽器閱讀器。
目前處理結果顯示在閱讀器內，不會回寫或匯出為新的 PDF。

驗證：`npx vitest run tests/background/pdfNavigation.test.ts tests/extension/manifest.test.ts tests/content/core/readingModeController.test.ts`。
先執行 `npm run build:extension` 並準備 Playwright Chromium，之後可執行
`node tests/browser/pdfReader.smoke.mjs`，驗證選檔、翻頁、畫面適配、持久快取、PDF 自動偵測與本地翻譯。
OpenAI 整合測試使用合成測試金鑰及背景 fetch 模擬，不會使用個人 API Key 或產生實際模型費用。

### 已适配站点

在 X 、Pixiv、E-Hentai 的已适配页面中，在大图页面会直接显示翻译按钮。

Pixiv 漫画阅读模式与 GoMuRaw（`gomuraw.onl`、`gomuraw.wiki`、`gomuraw.link`，含 `www` 域名）章节页提供底部按钮，可翻译当前可见页或全部页面。GoMuRaw 整章最多支持 500 页。

### 通用网页翻译

在其他网页中，可以使用以下方式翻译漫画图片：

| 操作 | 默认快捷键 | 说明 |
| --- | --- | --- |
| 右键翻译图片 | - | 对右键位置的图片发起翻译 |
| 截图翻译 | `Alt+Q` | 手动框选页面区域并翻译 |
| 翻译悬停元素 | `Alt+W` | 翻译鼠标当前悬停的图片或区域 |

快捷键可在浏览器的扩展快捷键页面中调整。

## 翻译配置

扩展弹出页提供以下常用配置：

| 配置 | 说明 |
| --- | --- |
| 翻译服务 | 谷歌翻译或大模型翻译 |
| 大模型提供商 | DeepSeek、Nano Banana、GLM、Kimi、MiniMax、MiMo、OpenAI、自定义提供商 |
| OCR 引擎（模式选项） | PaddleOCR（本机）或 OpenAI OCR（API Key） |
| 模型 | 可使用内置模型列表，也可填写自定义模型名 |
| 目标语言 | 简体中文或繁体中文 |
| 处理模式 | 翻译、仅去字、排版原文 |
| 调试选项 | 阶段耗时、排版调试、去字调试、日志下载 |

使用大模型翻译时，需要填写对应提供商的 API Key。API Key 由用户在扩展设置中输入，项目仓库不包含任何密钥。

### OpenAI OCR 与翻译

1. 在扩展弹出页将翻译服务切换为「大模型翻译」，提供商选择「OpenAI」。
2. 认证方式选择「API Key」，输入自己的 OpenAI API Key。
3. 模型选择 `gpt-4.1-mini`、`gpt-4.1`，或填写自己可用的视觉模型名称。
4. 在「模式」选项中将「OCR 引擎」切换为「OpenAI OCR（API Key）」。OCR 与翻译沿用同一个 OpenAI Key 和模型。
5. 目标语言选择繁体中文或其他需要的语言，再翻译图片。

OpenAI OCR 会把检测到的文字区域图片发送到 OpenAI，翻译会发送识别后的文字，均可能产生 API 费用。文字检测、气泡检测、去字和排版仍沿用原有流程及模型。Key 使用现有的扩展凭据存储，不写入图片记录或导出配置。

原有选项全部保留：OCR 随时可切回「PaddleOCR（本机）」；翻译仍可选择谷歌翻译或其他大模型提供商。使用本机 OCR 时，也可搭配 OpenAI 翻译。

## 本地模型与运行时

ShinobuTranslator 使用 `onnxruntime-web` 在浏览器端运行视觉模型。运行时会按环境尝试 WebGPU、WebNN 或 WASM，实际速度取决于浏览器版本、硬件和系统支持情况。

当前模型资源包括：

| 模型 | 用途 |
| --- | --- |
| `detector` | 文本检测（`detector.ort`） |
| `bubble` | YOLO11n 气泡实例分割（`bubble.onnx`） |
| `paddleocr_v6_medium_rec` | PP-OCRv6 medium OCR 识别（`PP-OCRv6_medium_rec.onnx` + `paddleocr_v6_dict.txt`） |
| `inpaint` | AOT 去字修复（`aot_inpaint_512.onnx`） |

## 从源码运行

需要 Node.js、npm，以及 Chrome / Edge 109+ 或 Firefox Desktop 140+。先安装依赖：

```bash
npm install
```

### 扩展

```bash
npm run dev:extension          # Chromium
npm run dev:extension:firefox  # Firefox
npm run build:extension        # 构建并校验两个目标
npm run lint:firefox --workspace=@shinobu/extension # 构建后审计 Firefox 警告
```

普通 UI 改动不需要更新 Firefox lint 基线：检查器通过临时源映射核对已审计警告的第三方源码和原始位置，映射文件不会进入发布包。依赖或警告变化时需要重新审计；Manifest 与独立运行时文件仍校验整文件哈希。

### 网页版

```bash
npm run dev:web
npm run build:web
```

### 检查与模型

```bash
npm run check            # 完整质量门控
npm run models:download  # 下载缺少的 ONNX 模型
```

## 项目结构

```text
apps/
  extension/        Chromium/Firefox 扩展、入口、专属实现与构建配置
  web/              网页版、历史、PWA 与项目包
  model-gateway/    Cloudflare Workers 私有 R2 模型网关
packages/
  translator-core/  扩展与网页版共用的任务核心
  browser-runtime/  Worker 宿主与浏览器运行时 Adapter
  diagnostics/      扩展与网页版共用的诊断与性能记录
  image-pipeline/   检测、OCR、翻译、去字与排版流水线
  model-runtime/    模型加载、推理后端与共享 ONNX Worker
  shared-config/    网页版配置 Schema、默认值与迁移
  text-translation/ 文本翻译供应商与传输协议
  model-manifest/   网页版与网关共用的内容哈希模型清单
public/
  models/           浏览器端 ONNX 模型资源
  icons/            扩展与网页版图标
assets/
  readme/           README 展示图、设置截图与演示视频
docs/
  agents/           Agent 协作所需的领域、Issue 与分诊约定
benchmark/
  perf/             性能与浏览器端 smoke 测试
  typeset/          排版基准测试
```

## 隐私与安全

- 项目不包含任何内置 API Key 或密钥
- 用户填写的 API Key 保存在浏览器扩展存储中
- 本地视觉流水线在浏览器端运行，不依赖个人服务器
- 使用 Google Web、LLM 或 Nano Banana 时，请自行确认对应服务的隐私政策、费用和使用条款
- 扩展权限以 `apps/extension/manifest.ts` 生成的目标 manifest 为准
- 网页版隐私边界、Cloudflare 元数据和本地存储规则见 [PRIVACY_POLICY.md](PRIVACY_POLICY.md)

## 致谢

本项目的灵感与部分模型处理思路来自：

- [zyddnys/manga-image-translator](https://github.com/zyddnys/manga-image-translator)
- [manga-image-translator 相关油猴脚本](https://greasyfork.org/scripts/437569)
- [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)
- [ONNX Runtime Web](https://onnxruntime.ai/)

第三方模型、脚本和许可证说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
npm 生产依赖精确版本与许可证快照见
[THIRD_PARTY_DEPENDENCIES.json](THIRD_PARTY_DEPENDENCIES.json)。

## 许可证

本项目基于 [GPL-3.0](LICENSE) 许可证开源。

## 免责声明

ShinobuTranslator 仅用于个人学习、研究和合法授权内容的辅助翻译。使用者应自行确认对输入图片、翻译结果和后续传播行为拥有合法权利，并遵守所在地法律法规、平台规则和第三方服务条款。翻译结果由模型或第三方服务生成，可能存在错误，请在发布或二次使用前自行校对。

## Star History

<a href="https://www.star-history.com/?type=date&repos=DonutShinobu%2FShinobuTranslator">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=DonutShinobu/ShinobuTranslator&type=date&theme=dark&legend=top-left&sealed_token=_sAHU9p_GIu8YRV4B1NUeFz_jiIPnpUA45CXVeha2WML7vAOrj2RNdn0U_HwonQp0os2_7btrkuqTaS_oYbD05lru-v-5FngnxpQ8dxLhVBA63qPeU3Dlw" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=DonutShinobu/ShinobuTranslator&type=date&legend=top-left&sealed_token=_sAHU9p_GIu8YRV4B1NUeFz_jiIPnpUA45CXVeha2WML7vAOrj2RNdn0U_HwonQp0os2_7btrkuqTaS_oYbD05lru-v-5FngnxpQ8dxLhVBA63qPeU3Dlw" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=DonutShinobu/ShinobuTranslator&type=date&legend=top-left&sealed_token=_sAHU9p_GIu8YRV4B1NUeFz_jiIPnpUA45CXVeha2WML7vAOrj2RNdn0U_HwonQp0os2_7btrkuqTaS_oYbD05lru-v-5FngnxpQ8dxLhVBA63qPeU3Dlw" />
 </picture>
</a>
