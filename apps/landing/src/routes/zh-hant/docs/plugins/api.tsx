import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/zh-hant/docs/plugins/api")({
  head: () => ({
    meta: [
      { title: "API 參考 — ReadAware 文件" },
      {
        name: "description",
        content:
          "ReadAware 外掛編寫契約：manifest、生命週期、領域衍生的權限、資料 API、貢獻點、檢視與事件。",
      },
    ],
  }),
  component: PluginApiPage,
});

function PluginApiPage() {
  return (
    <article className="doc-prose">
      <h1>外掛 API 參考</h1>
      <p className="lead">
        外掛是一個資料夾，裡面有一份 <code>manifest.json</code> 和一個
        JavaScript 模組。本頁就是編寫契約；同一份契約以 TypeScript
        宣告檔案（<code>types/plugin-api.d.ts</code>）的形式隨
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          外掛市集儲存庫
        </a>
        一起發佈，編輯器可以對下文的一切自動補全。
      </p>

      <h2>結構</h2>
      <pre>
        <code>{`my-plugin/
  manifest.json
  main.js        # 單個自包含的 ES module`}</code>
      </pre>
      <p>
        <code>main.js</code>{" "}
        預設匯出一個生命週期物件。外掛能觸及的一切都來自傳給{" "}
        <code>activate</code> 的上下文；每個 <code>register*</code> 與{" "}
        <code>on</code> 呼叫都回傳一個
        disposable，外掛被停用或解除安裝時由應用程式統一回收，因此{" "}
        <code>deactivate</code> 只需釋放外掛自己的外部資源。
      </p>
      <pre>
        <code>{`export default {
  activate(ctx) {
    // 透過 ctx 註冊貢獻點
  },
  deactivate() {
    // 可選：關閉通訊端、清空佇列
  },
};`}</code>
      </pre>
      <p>
        啟用與停用立即生效——無需重新啟動應用程式。願意的話可以用
        TypeScript
        編寫（推薦；見<Link to="/zh-hant/docs/plugins/publishing">發佈上架</Link>）——應用程式載入的始終是組建出的{" "}
        <code>main.js</code>。
      </p>

      <h2>manifest.json</h2>
      <pre>
        <code>{`{
  "id": "anki-sync",
  "name": "Anki Sync",
  "version": "0.1.0",
  "minAppVersion": "0.3.0",
  "description": "Send looked-up words to Anki.",
  "author": "you",
  "permissions": ["service:network", "annotations:read"],
  "main": "main.js"
}`}</code>
      </pre>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>欄位</th>
              <th>含義</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>id</code>
              </td>
              <td>
                小寫字母、數字和連字號（最長
                64）。必須與資料夾名稱一致；作為外掛儲存與工具的命名空間。
              </td>
            </tr>
            <tr>
              <td>
                <code>name</code>、<code>version</code>
              </td>
              <td>顯示在「設定 → 外掛」和外掛市集中。</td>
            </tr>
            <tr>
              <td>
                <code>minAppVersion</code>
              </td>
              <td>
                外掛支援的最低應用程式版本。本契約要求 <code>0.3.0</code>{" "}
                或更新的版本。
              </td>
            </tr>
            <tr>
              <td>
                <code>permissions</code>
              </td>
              <td>
                外掛使用的能力（見下表）。會在安裝前展示給使用者。
              </td>
            </tr>
            <tr>
              <td>
                <code>main</code>
              </td>
              <td>
                相對於外掛資料夾的入口模組；預設為 <code>main.js</code>。
              </td>
            </tr>
            <tr>
              <td>
                <code>settings</code>
              </td>
              <td>
                可選的宣告式設定（欄位形態與表單檢視相同，另有{" "}
                <code>secret</code>）。應用程式會把它渲染成外掛自己的設定分類，並把所有值作為一個物件持久化在儲存鍵{" "}
                <code>settings</code> 下——見{" "}
                <a href="#storage-and-settings">儲存與設定</a>。
              </td>
            </tr>
            <tr>
              <td>
                <code>schedules</code>
              </td>
              <td>
                可選的週期任務，宣告在此以便使用者安裝前可見——見{" "}
                <a href="#scheduled-work">排程任務</a>。
              </td>
            </tr>
            <tr>
              <td>
                <code>themes</code>、<code>fonts</code>
              </td>
              <td>
                可選的宣告式主題與自帶字型（需要 <code>ui:themes</code>{" "}
                權限）——見<a href="#themes-and-bundled-fonts">主題與自帶字型</a>。
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>領域模型</h2>
      <p>
        資料表面衍生自應用程式的領域模型，而不是在它旁邊另行編寫。每個領域——{" "}
        <code>shelf</code>（書庫管理的全部：書目、分組與閱讀統計）、
        <code>annotations</code>、<code>conversations</code>——都是{" "}
        <code>ctx</code> 上的一個命名空間，暴露三樣東西：
      </p>
      <ul>
        <li>
          <strong>讀取</strong>——該領域的讀模型（應用程式自己的介面渲染的正是它們）；
        </li>
        <li>
          <strong>寫入</strong>——<code>.write</code>{" "}
          下的命令，與該領域的事件動詞嚴格一一對應，並走應用程式自己的事件溯源寫入路徑，在事件日誌中標記為{" "}
          <code>plugin:&lt;id&gt;</code>
          ，因此每一次外掛寫入都可追溯；
        </li>
        <li>
          <strong>訂閱</strong>——<code>.on(event, handler)</code>
          ，以規範名稱（<code>book.starred</code>、
          <code>highlight.created</code>
          ……）訂閱該領域的事件——與應用程式自身記錄事實所用的是同一套詞彙。
        </li>
      </ul>
      <p>
        權限遵循同樣的形態：<code>&lt;domain&gt;:read</code> /{" "}
        <code>&lt;domain&gt;:write</code>，且在一個領域內，
        <strong>寫入權限蘊含讀取權限</strong>
        。裝置本機狀態（檢視偏好、閱讀器外觀、同步內部資料）與自由渲染刻意不屬於外掛表面——UI
        一律經由下文的宣告式檢視。
      </p>

      <h2>權限</h2>
      <p>
        沒有宣告對應權限時，<code>ctx</code>{" "}
        上的能力組乾脆不存在——在 API
        層面防範無意的越界。命名空間儲存、UI
        貢獻點、工作階段事件和閱讀器導覽不是權限；每個外掛都擁有它們。
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>權限</th>
              <th>授予</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>shelf:read</code>
              </td>
              <td>
                <code>ctx.shelf</code>
                ——書目（含一本書的目錄與章節文字）、分組與歸屬，以及閱讀統計（
                <code>stats.forBook</code> / <code>stats.list</code> /{" "}
                <code>stats.overview</code>
                ——統計沒有寫入面：它的事件是閱讀器活動被記錄下來的事實，而非使用者命令）。
              </td>
            </tr>
            <tr>
              <td>
                <code>shelf:write</code>
              </td>
              <td>
                <code>ctx.shelf.books.write</code>
                ——匯入檔案、編輯中繼資料、標星、標記讀完、移除；以及內容供應商與虛擬書籍。
                <code>ctx.shelf.collections.write</code>
                ——建立、重新命名、移除、為書籍指派分組。
              </td>
            </tr>
            <tr>
              <td>
                <code>annotations:read</code> / <code>annotations:write</code>
              </td>
              <td>
                <code>ctx.annotations</code>
                ——螢光標示、筆記與提問；建立、改色、編輯、刪除螢光標示與筆記（提問由助理寫入，唯讀）。
              </td>
            </tr>
            <tr>
              <td>
                <code>conversations:read</code>
              </td>
              <td>
                <code>ctx.conversations</code>
                ——每本書的 AI 討論串與全域討論串（唯讀）。
              </td>
            </tr>
            <tr>
              <td>
                <code>ui:themes</code>
              </td>
              <td>
                manifest 中宣告式的 <code>themes</code> / <code>fonts</code>{" "}
                欄位（見下文）——應用程式與閱讀頁主題，可附帶字型。它是唯一需要權限的
                UI 貢獻點：它對整個應用程式有視覺影響力，安裝確認必須把它亮出來。
              </td>
            </tr>
            <tr>
              <td>
                <code>ui:appearance</code>
              </td>
              <td>
                <code>ctx.appearance</code> —— 列出兩個外觀面目前提供的全部主題、讀目前外觀、切換應用程式主題或閱讀頁配色。與{" "}
                <code>ui:themes</code> 刻意分開：提供主題是被動的，切換主題不是。
              </td>
            </tr>
            <tr>
              <td>
                <code>agent:tools</code>
              </td>
              <td>
                <code>ctx.agent.registerTool</code>——為閱讀助理註冊工具。
              </td>
            </tr>
            <tr>
              <td>
                <code>service:network</code>
              </td>
              <td>
                <code>ctx.network.fetch</code>——對外的 HTTP
                請求，走應用程式的原生用戶端（沒有 CORS 約束）。
              </td>
            </tr>
            <tr>
              <td>
                <code>service:llm</code>
              </td>
              <td>
                <code>ctx.llm.ask</code>
                ——使用使用者設定的帳號發起一次性模型呼叫。沒有討論串、沒有記憶、沒有工具；支援以{" "}
                <code>schema</code> 輸出結構化 JSON，或以 <code>onText</code>{" "}
                串流接收文字。
              </td>
            </tr>
            <tr>
              <td>
                <code>service:clipboard</code>
              </td>
              <td>
                <code>ctx.clipboard.writeText</code>。
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        （<code>reader:modes</code>
        ——宿主渲染的引導式閱讀模式——在這份特權契約穩定下來之前，暫時僅限隨應用程式內建的第一方外掛使用。）
      </p>

      <h2>貢獻點</h2>

      <h3>選取動作</h3>
      <p>
        閱讀器選取選單與標註選單中的條目。處理函數會收到選取的文字、它的
        CFI
        範圍、所在章節和書籍；當閱讀器能夠恢復時，<code>context</code>{" "}
        還帶有選取周圍的上下文段落。在閱讀器內，一個動作要麼靜默執行（回傳
        toast），要麼開啟對話框（回傳檢視）——只有這兩種結果。
        非同步動作宣告 <code>presentation: "dialog"</code> 後，宿主會立刻開啟
        載入狀態對話框，並在 <code>run</code> 完成時把結果填入同一次請求。
        字典類動作可以宣告 <code>role: "lookup"</code>：宿主會把現有的
        「查詢」鍵盤命令路由到該外掛動作，而不是維護第二條內建查詞路徑。
      </p>
      <pre>
        <code>{`ctx.ui.registerSelectionAction({
  id: "save-quote",
  title: "Save quote",
  icon: "quotes",
  presentation: "dialog",
  run: (input) => {
    // input: { text, context?, cfiRange, chapterHref, book, source }
    return { toast: "Quote saved." };
  },
});`}</code>
      </pre>

      <h3>頂欄動作</h3>
      <p>
        頂欄上的一個圖示按鈕。在閱讀器介面，檢視以錨定的彈出層開啟；在書架上，則依{" "}
        <code>presentation</code>{" "}
        以彈出層或完整頁面開啟。閱讀器永遠不允許整頁打斷。
      </p>
      <pre>
        <code>{`ctx.ui.registerHeaderAction({
  id: "reading-report",
  title: "Reading report",
  icon: "chart-line-up",
  surface: "shelf",
  presentation: "page",
  view: async () => ({
    kind: "markdown",
    title: "This week",
    markdown: "You read **4h 12m** across 3 books.",
  }),
});`}</code>
      </pre>

      <h3>命令</h3>
      <p>
        命令面板中的一個條目。所有外掛動作都會自動出現在面板裡；顯式命令用於那些沒有按鈕的動作。
      </p>
      <pre>
        <code>{`ctx.ui.registerCommand({
  id: "sync-now",
  title: "Anki Sync: sync now",
  run: async () => ({ toast: "Synced." }),
});`}</code>
      </pre>

      <h3>助理工具</h3>
      <p>
        閱讀助理在對話中可以呼叫的工具（需要 <code>agent:tools</code>{" "}
        權限）。<code>parameters</code> 是描述參數物件的普通 JSON
        Schema；無參數的工具可以省略。工具在送達模型之前會被命名空間化為{" "}
        <code>plugin_&lt;pluginId&gt;_&lt;name&gt;</code>
        ，呼叫過程會以工具步驟的形式在對話中對使用者可見。
      </p>
      <pre>
        <code>{`ctx.agent?.registerTool({
  name: "search_deck",
  label: "Searching your Anki deck",
  description: "Search the user's Anki collection for a term.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  execute: async ({ query }) => {
    const res = await ctx.network.fetch("http://127.0.0.1:8765", {
      method: "POST",
      body: JSON.stringify({ action: "findNotes", query }),
    });
    return res.json();
  },
});`}</code>
      </pre>

      <h3>朗讀聲音供應商</h3>
      <p>
        <code>ctx.audio.registerVoiceProvider</code>{" "}
        把一個文字轉語音引擎接進閱讀頁的朗讀功能。外掛只負責把文字變成編碼後的音訊位元組（mp3/wav——webview
        能解碼的都行）；播放、逐句推進、預先擷取與跟讀標示全部由應用程式負責。註冊本身不需要權限——合成所需的能力（網路、金鑰）已由外掛自己的其他權限門控。
      </p>
      <pre>
        <code>{`ctx.audio.registerVoiceProvider({
  id: "voices",
  label: "My TTS",
  listVoices: () => [{ id: "default", label: "My TTS · warm" }],
  synthesize: async ({ text, voiceId }) => {
    const res = await ctx.network.fetch("http://127.0.0.1:8880/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: text, response_format: "mp3" }),
    });
    return res.arrayBuffer();
  },
});`}</code>
      </pre>
      <p>
        註冊的聲音會被自動採用——使用者啟用你的外掛即是選擇，宿主不再另設選擇器；某一句合成失敗時會退回系統語音，朗讀只會降級、不會中斷。外掛設定變化時會重新列舉聲音。
      </p>

      <h3 id="scheduled-work">排程任務</h3>
      <p>
        manifest 負責宣告週期任務，<code>activate</code>{" "}
        負責繫結實際工作。應用程式在開啟期間至少每 <code>everyMinutes</code>{" "}
        分鐘（下限 15）執行一次，逾期未跑的會在啟動後補一次——從不承諾精確時刻，應用程式關閉時也不會執行。同一任務的重疊執行會被跳過；失敗的一次只需等待下個週期。
      </p>
      <pre>
        <code>{`// manifest.json
"schedules": [{ "id": "refresh", "label": "Refresh feeds", "everyMinutes": 60 }]

// main.js
ctx.schedule.on("refresh", async () => {
  // 擷取、比對，經由領域 API 寫回
});`}</code>
      </pre>

      <h3 id="themes-and-bundled-fonts">主題與自帶字型</h3>
      <p>
        宣告 <code>ui:themes</code> 後，manifest
        可以為兩個相互獨立的掛載點——應用程式介面與書頁——宣告主題，並附帶隨外掛資料夾分發的字型檔案。這類貢獻是純資料：應用程式校驗每一個值並自行產生全部
        CSS，且在使用者於「設定 →
        外觀」或閱讀器的頁面顏色控制項裡選取之前，什麼都不會生效。純主題外掛的{" "}
        <code>main.js</code> 只需{" "}
        <code>{"export default { activate() {} }"}</code>。
      </p>
      <pre>
        <code>{`{
  "permissions": ["ui:themes"],
  "fonts": [
    {
      "id": "my-serif",
      "family": "My Serif",
      "kind": "serif",
      "files": [{ "path": "assets/my-serif-400.woff2", "weight": 400 }]
    }
  ],
  "themes": [
    {
      "id": "dusk",
      "name": { "default": "Dusk", "translations": { "zh-Hans": "暮色" } },
      "polarity": "dark",
      "app": { "paper": "#14171e", "fg": "#e3e6ec" },
      "reader": {
        "palette": {
          "bg": "#161a22", "text": "#ccd2dd",
          "selection": "rgba(154, 162, 177, 0.28)",
          "rule": "rgba(204, 210, 221, 0.18)",
          "faint": "rgba(204, 210, 221, 0.07)",
          "muted": "rgba(204, 210, 221, 0.55)"
        },
        "typography": { "fontFamily": "plugin:my-serif", "fontSize": "large" }
      }
    }
  ]
}`}</code>
      </pre>
      <ul>
        <li>
          <code>polarity</code>——主題讀起來偏亮還是偏暗。它驅動{" "}
          <code>color-scheme</code>、主題未覆寫的應用程式 token
          所繼承的明暗預設值，以及主題生效期間閱讀器「自動」頁面顏色的解析。
        </li>
        <li>
          <code>app</code>——對應用程式固定 token
          詞彙（畫布、文字層級、表面、填充、邊框——見型別宣告中的{" "}
          <code>PluginAppThemeTokens</code>）的覆寫。未覆寫的 token
          保持對應明暗極性自己的值。
        </li>
        <li>
          <code>reader</code>——與內建頁面顏色同一套的六色調色盤（六色缺一不可），外加一個可選的排版預設：在使用者選取主題的那一刻一次性套用，之後使用者可以隨意調整。
        </li>
        <li>
          <code>fonts</code>——<code>.woff2</code>/<code>.woff</code>/
          <code>.ttf</code>/<code>.otf</code>{" "}
          字型直接從外掛資料夾提供服務；外掛啟用期間，每個字體都會出現在閱讀器的字體選擇器裡。主題以{" "}
          <code>plugin:&lt;fontId&gt;</code>{" "}
          引用自己的字型。上架市集的外掛必須把字型檔案列進 registry 條目的{" "}
          <code>files</code>。
        </li>
        <li>
          顏色值按嚴格語法校驗——純 hex 或 <code>rgb()</code>/
          <code>rgba()</code>/<code>hsl()</code>/<code>hsla()</code>
          ；關鍵字、<code>var()</code> 與 <code>url()</code> 一律拒絕。
        </li>
      </ul>

      <h2>檢視</h2>
      <p>
        外掛宣告的是宿主元件樹，由應用程式渲染所有視覺原語和控制項；外掛不能提供 JSX、HTML、CSS 或 className。
      </p>
      <ul>
        <li>
          <code>markdown</code>——一個 markdown 字串，由應用程式排版。
        </li>
        <li>
          <code>list</code>——宿主提供固定 debounce 的搜尋、keywords、
          accessories 與空狀態；<code>timeline</code> 提供今天／本週／本月／
          全部篩選和本機日期分組，條目可用 <code>presentation: "dialog"</code>
          在清單上方開啟回傳檢視，而不是下鑽成子頁面。
        </li>
        <li>
          <code>form</code>——使用 ReadAware 元件庫的 text、textarea、number、time、select、choice、checkbox、toggle，加上{" "}
          <code>onSubmit</code>
          ；後者接收表單值，可回傳結果檢視或欄位錯誤。
        </li>
        <li>
          <code>detail</code>——Raycast 式主內容、metadata 與宿主 actions；宿主把 actions 渲染成內容標題右側的圖示按鈕，把來源、日期和 tags 等 metadata 收進安靜的內容底部。
        </li>
        <li>
          <code>blocks</code>
          ——宿主 typography、markdown、字典、metadata、引文、動作、指標、進度、標籤、提示、section、group 與響應式 <code>columns</code>。columns 只開放相對 weight、間距檔位、最小寬度檔位和語義對齊，具體 CSS 與換行仍歸設計系統；所有宣告都會在執行時校驗並限制巢狀深度。
        </li>
      </ul>
      <p>
        處理函數（<code>run</code>、<code>onSelect</code>、
        <code>onSubmit</code>）都回傳同一種結果形態：
      </p>
      <ul>
        <li>
          什麼都不回傳——介面保持原樣；
        </li>
        <li>
          <code>{"{ toast: \"…\" }"}</code>——一條短暫的提示；
        </li>
        <li>
          <code>{"{ view }"}</code>——開啟介面，或在其上推入一層新檢視；
        </li>
        <li>
          <code>{'{ view, navigation: "replace" | "reset" }'}</code>
          ——替換目前檢視，或回到一棵新的根檢視；
        </li>
        <li>
          <code>{"{ close: true }"}</code>——關閉介面（可與{" "}
          <code>toast</code> 組合）；
        </li>
        <li>
          <code>{"{ fieldErrors }"}</code>
          ——來自表單提交：停留在表單上，並在欄位下方顯示錯誤。
        </li>
      </ul>
      <p>
        非同步工作不值一提：回傳一個
        promise，應用程式會顯示載入狀態。圖示按名稱從應用程式精選的 Phosphor
        集合中選取——不支援自訂 SVG。
      </p>

      <h2>領域資料</h2>
      <p>
        每個已授權的領域命名空間都提供讀取、規範事件訂閱，以及（擁有寫入權限時）命令。概覽：
      </p>
      <ul>
        <li>
          <code>ctx.shelf.books</code>——<code>list()</code>、
          <code>get(id)</code>、<code>getToc(id)</code>、
          <code>getChapterText(id, index)</code>
          ；寫入：<code>import</code>、<code>editMetadata</code>、
          <code>setStarred</code>、<code>setFinished</code>、
          <code>remove</code>，外加內容供應商（見下文）。
        </li>
        <li>
          <code>ctx.shelf.collections</code>——<code>list()</code>、
          <code>booksIn(id)</code>；寫入：<code>create</code>、
          <code>rename</code>、<code>remove</code>、
          <code>assignBooks(bookIds, collectionId | null)</code>。
        </li>
        <li>
          <code>ctx.shelf.stats</code>——<code>forBook(bookId)</code>、
          <code>list()</code>、<code>overview()</code>
          （閱讀位置、閱讀狀態與實際閱讀時長；對任何行動者都唯讀）。
        </li>
        <li>
          <code>ctx.annotations</code>——{" "}
          <code>list({"{ bookId?, kind?, query? }"})</code>{" "}
          回傳由螢光標示、筆記與提問構成的可辨別聯集；寫入：{" "}
          <code>createHighlight</code>、<code>recolorHighlight</code>、
          <code>removeHighlight</code>、<code>createNote</code>、
          <code>updateNote</code>、<code>removeNote</code>。
        </li>
        <li>
          <code>ctx.conversations</code>——<code>getBookThread(bookId)</code>、
          <code>listThreads()</code>、<code>getThread(id)</code>；透過{" "}
          <code>on</code> 訂閱（<code>aiConversation.started</code>、
          <code>aiMessage.appended</code>、<code>aiMessage.removed</code>、
          <code>aiConversation.cleared</code>）。
        </li>
      </ul>

      <h2>事件</h2>
      <p>
        兩類事件，刻意分開。<strong>領域事件</strong>
        是應用程式記錄下來的事實；按領域訂閱，使用規範名稱，需要該領域的讀取權限。每次投遞的形態是{" "}
        <code>{"{ type, payload, createdAt, origin }"}</code>——origin
        表明是哪個軟體行動者產生了這一事實（<code>user</code>、
        <code>agent</code>、<code>system</code>，或{" "}
        <code>plugin:&lt;id&gt;</code>）。
      </p>
      <pre>
        <code>{`ctx.annotations?.on("highlight.created", ({ payload, origin }) => {
  // payload: { highlightId, bookId, text, color?, … }
});
ctx.shelf?.on("book.removed", ({ payload }) => { /* { bookId } */ });`}</code>
      </pre>
      <p>
        <strong>工作階段事實</strong>
        描述此刻螢幕上正在發生的事。它們從不進入事件日誌，也無需任何權限：{" "}
        <code>ctx.session.on(event, handler)</code>。
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>工作階段事件</th>
              <th>承載</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>book-opened</code>
              </td>
              <td>
                <code>{"{ book: { id, title, author? } }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>book-closed</code>
              </td>
              <td>
                <code>{"{ bookId }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>chapter-changed</code>
              </td>
              <td>
                <code>{"{ bookId, chapterHref }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>reading-progress</code>
              </td>
              <td>
                <code>{"{ bookId, fraction }"}</code>——翻頁時觸發，fraction
                取值 0..1
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>內容供應商與虛擬書籍</h2>
      <p>
        宣告 <code>shelf:write</code> 後，外掛可以把真正的書放上書架。
        <code>import</code>{" "}
        接收檔案位元組。內容供應商則完全跳過檔案：註冊一個供應商，新增繫結到它的虛擬書籍，並在書被開啟時提供
        HTML
        章節。閱讀器會像對待任何書一樣為它們分頁、標註、記錄進度——「把
        RSS
        訂閱源當書讀」正是這麼實作的。
      </p>
      <pre>
        <code>{`ctx.shelf?.books.write?.registerContentProvider({
  id: "rss",
  async load(key) {
    const feed = await fetchFeed(key); // 你的程式碼，經由 ctx.network.fetch
    return {
      title: feed.title,
      sections: feed.items.map((item) => ({
        title: item.title,
        html: item.contentHtml,
      })),
    };
  },
});

await ctx.shelf?.books.write?.addVirtualBook({
  providerId: "rss",
  key: "https://example.com/feed.xml",
  title: "Example Weekly",
});`}</code>
      </pre>

      <h2 id="storage-and-settings">儲存與設定</h2>
      <p>
        <code>ctx.storage</code>{" "}
        是隨應用程式本機資料一起持久化的命名空間鍵值儲存——<code>get</code>、
        <code>set</code>、<code>remove</code>。如果 manifest 宣告了{" "}
        <code>settings</code>{" "}
        欄位，應用程式會把它們渲染成外掛自己的設定分類，所有值會以一個物件出現在{" "}
        <code>ctx.storage.get("settings")</code>
        。閱讀助理也能查看和修改這些設定（標記{" "}
        <code>agentHidden</code> 的欄位對它不可見）。有三種超出普通表單的欄位能力：
      </p>
      <ul>
        <li>
          <code>visibleWhen: {"{ field, equals }"}</code>{" "}
          讓欄位只在另一欄位取給定值時顯示。隱藏欄位的存量值會保留——一個設定物件即可按變體各存一套值（TTS
          外掛正是這樣為每個供應商各記一個聲音）。
        </li>
        <li>
          <code>select</code> 配合 <code>dynamicOptions: true</code>{" "}
          可以在執行時解析選項：在 <code>activate</code> 裡用{" "}
          <code>ctx.settings.provideOptions(fieldId, async (values) =&gt;
          [...])</code>{" "}
          繫結來源。來源給不出選項時（還沒設定金鑰、端點不可達），欄位會退回自由文字輸入——清單是便利，絕不是門檻。
        </li>
        <li>
          <code>kind: "secret"</code>{" "}
          宣告一個憑證欄位：應用程式渲染密碼輸入框並直寫加密的
          secret store——欄位 id 就是你程式碼裡 <code>ctx.secrets</code>{" "}
          讀回的鍵名——絕不進明文設定，也不進助理的目錄。存量值從不回顯；欄位以「已設定」狀態展示，並提供清除入口。
        </li>
      </ul>
      <p>
        對於結構化資料，<code>ctx.storage.collection(name)</code>{" "}
        會開啟一個具名的文件集合——對逐條文件記錄進行 <code>put</code> /{" "}
        <code>get</code> / <code>delete</code> / <code>list</code>
        ，記錄可選攜帶 <code>bookId</code> / <code>anchor</code>{" "}
        出處資訊，並可據此篩選。出處是索引而非所有權：被引用的書刪除後，文件依然存在；而集合的生命週期歸屬於外掛（解除安裝即清空）。內建的詞彙表外掛正是完全建構在這一層之上。
      </p>

      <h2>常駐上下文</h2>
      <p>始終可用，無需任何權限：</p>
      <ul>
        <li>
          <code>ctx.manifest</code>、<code>ctx.appVersion</code>、
          <code>ctx.locale</code>（應用程式介面目前的 BCP-47
          語言標籤——用時再讀，它隨語言設定即時變化）；
        </li>
        <li>
          <code>ctx.ui.showToast(message)</code>；
        </li>
        <li>
          <code>ctx.ui.exportFile({"{ filename, content, mimeType? }"})</code>
          ——開啟宿主的儲存流程，匯出生成的文字（CSV、JSON、Markdown）或二進位位元組；
        </li>
        <li>
          <code>ctx.secrets</code>——按外掛命名空間隔離的加密憑證儲存（API
          權杖等）；存放在 SQLite 與備份之外，解除安裝後依然保留；
        </li>
        <li>
          <code>ctx.session.on(…)</code>——上文的工作階段事實；
        </li>
        <li>
          <code>ctx.reader.openBook(bookId)</code> 與{" "}
          <code>ctx.reader.goTo({"{ bookId?, cfi?, href? }"})</code>
          ——導覽閱讀器（使用者可見的控制，不暴露資料）。
        </li>
      </ul>

      <h2>穩定性</h2>
      <p>
        這是契約 v2，隨應用程式 0.3.0
        發佈——一次有意為之的破壞性重建，把整個外掛表面從領域模型衍生出來（v1
        的 manifest 會安裝失敗，並給出可讀的錯誤訊息）。自此
        API
        只做加法式增長：新的領域、新的事件名、新的區塊類型——宣告式主題（
        <code>ui:themes</code>
        ）就是第一個這樣的新增。對本頁已記載內容的破壞性變更會被當作
        bug 處理。任何依賴較新能力的外掛，請宣告 <code>minAppVersion</code>。
      </p>
    </article>
  );
}
