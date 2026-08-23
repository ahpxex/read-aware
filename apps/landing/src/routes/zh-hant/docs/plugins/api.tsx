import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/zh-hant/docs/plugins/api")({
  head: () => ({
    meta: [
      { title: "外掛 API 參考 — ReadAware 文件" },
      {
        name: "description",
        content:
          "目前 ReadAware 外掛契約：manifest、能力、領域、貢獻、服務、宣告式 UI、生命週期和遷移。",
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
        外掛是一個包含 <code>manifest.json</code>和已建置 ES 模組的資料夾。完整的公開 TypeScript 契約以{" "}
        <code>types/plugin-api.d.ts</code> in the{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          readaware-plugins 儲存庫
        </a>發佈。本頁說明各部分如何配合。
      </p>

      <h2>套件結構</h2>
      <pre><code>{`my-plugin/
  manifest.json
  main.js
  src/main.ts       # 推薦提交以供審核
  assets/           # 可選，市集安裝時需明確列出`}</code></pre>
      <p>
        <code>main.js</code> 預設匯出一個生命週期物件。ReadAware 在專用模組 Worker 中執行它，並向<code>activate</code>提供具 actor 範圍的上下文。
      </p>
      <pre><code>{`export default {
  activate(ctx) {
    // 檢查並註冊。此階段會阻止副作用。
  },
  migrate(storageCtx, change) {
    // 可選：轉換外掛私有 KV 和文件。
  },
  deactivate() {
    // 可選：釋放外掛自己的外部資源。
  },
};`}</code></pre>

      <h2>Manifest 清單</h2>
      <pre><code>{`{
  "id": "theme-schedule",
  "name": "主題排程",
  "version": "0.1.0",
  "schemaVersion": 1,
  "minAppVersion": "0.3.0",
  "requires": {
    "domains": { "settings": "^1.0.0" },
    "contributions": {
      "commands": "^1.0.0",
      "settingsOptions": "^1.0.0"
    },
    "services": {
      "storage": "^1.0.0",
      "schedules": "^1.0.0",
      "ui": "^1.0.0"
    },
    "schemas": { "settings": "^1.0.0" }
  },
  "settingsAccess": {
    "discover": ["appearance.theme", "reading.theme"],
    "write": ["appearance.theme", "reading.theme"]
  },
  "main": "main.js"
}`}</code></pre>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>欄位</th><th>契約</th></tr></thead>
          <tbody>
            <tr><td><code>id</code></td><td>小寫字母、數字和連字元，最長 64 個字元。它是永久命名空間，且必須與資料夾名一致。</td></tr>
            <tr><td><code>name</code>, <code>version</code></td><td>面向使用者的名稱和套件版本。</td></tr>
            <tr><td><code>schemaVersion</code></td><td>外掛私有 KV 和文件資料所需的正整數。獨立於套件版本。</td></tr>
            <tr><td><code>requires</code></td><td>按領域、貢獻、服務和 schema 群組的能力 ID 到 semver 範圍的必填對映。</td></tr>
            <tr><td><code>permissions</code></td><td>可選的語意權限請求，需經使用者同意。未知值會導致驗證失敗。</td></tr>
            <tr><td><code>settingsAccess</code></td><td>可選的 discover/read/write 授權，用於精確設定路徑或明確的 <code>section.*</code> 群組。</td></tr>
            <tr><td><code>minAppVersion</code></td><td>可選的最低應用程式版本。套件相依新發佈能力時使用。</td></tr>
            <tr><td><code>settings</code></td><td>可選的由宿主算繪的外掛設定欄位。</td></tr>
            <tr><td><code>schedules</code></td><td>可選的週期任務，在綁定處理常式前宣告。</td></tr>
            <tr><td><code>themes</code>, <code>fonts</code></td><td>可選的宣告式主題和字型貢獻；需要 <code>ui:themes</code>.</td></tr>
            <tr><td><code>main</code></td><td>相對於資料夾的進入點模組；預設為 <code>main.js</code>.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        使用<Link to="/zh-hant/docs/plugins/capabilities">能力瀏覽器</Link>{" "}
        查看完整清單和權限詞彙。要求始終是相容性宣告，絕不會授予權限。
      </p>

      <h2>執行時上下文</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>命名空間</th><th>包含</th></tr></thead>
          <tbody>
            <tr><td><code>ctx.manifest</code></td><td>經過驗證的唯讀 manifest。</td></tr>
            <tr><td><code>ctx.appVersion</code>, <code>ctx.locale</code></td><td>宿主版本和目前 UI 區域設定。</td></tr>
            <tr><td><code>ctx.lifecycle.phase</code></td><td><code>activating</code>, <code>migrating</code>, 或 <code>active</code>.</td></tr>
            <tr><td><code>ctx.capabilities</code></td><td>僅對此外掛 actor 可見的能力版本。</td></tr>
            <tr><td><code>ctx.domains</code></td><td>已授予的 ReadAware 狀態和行為。</td></tr>
            <tr><td><code>ctx.contributions</code></td><td>外掛可以向其中提供實作的註冊表。</td></tr>
            <tr><td><code>ctx.services</code></td><td>受限的宿主操作和外掛私有基礎設施。</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        未獲授權時，受權限控制的命名空間不會出現。每次 Worker 呼叫也會在宿主側授權；隱藏方法不是唯一檢查。註冊會回傳可釋放物件，啟用失敗或外掛停用時按相反順序回收。
      </p>

      <h2>領域</h2>
      <p>
        領域提供 <code>queries</code>、可選的 <code>commands</code>，以及已提交的 <code>events.subscribe</code>。命令使用與 ReadAware 相同的事件溯源寫入路徑，並歸屬於{" "}
        <code>plugin:&lt;id&gt;</code>. 寫入權限包含讀取權限。
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>領域</th><th>查詢和命令</th><th>授權</th></tr></thead>
          <tbody>
            <tr>
              <td><code>library</code></td>
              <td>書籍、元資料、原始章節文字、目錄、集合；匯入、編輯、加星、移除、虛擬書籍和集合命令。</td>
              <td><code>library:read</code> / <code>library:write</code></td>
            </tr>
            <tr>
              <td><code>reading</code></td>
              <td>按書籍和匯總的閱讀統計；標記完成、開啟書籍並導覽到 CFI 或 href。</td>
              <td><code>reading:read</code> / <code>reading:write</code></td>
            </tr>
            <tr>
              <td><code>annotations</code></td>
              <td>篩選反白、筆記和被動提問軌跡；建立、編輯、重新著色並移除反白或筆記。</td>
              <td><code>annotations:read</code> / <code>annotations:write</code></td>
            </tr>
            <tr>
              <td><code>conversations</code></td>
              <td>讀取書籍執行緒、列出全域執行緒並讀取執行緒。寫入仍由聊天執行時負責。</td>
              <td><code>conversations:read</code></td>
            </tr>
            <tr>
              <td><code>settings</code></td>
              <td>發現獲准的目錄項目、讀取解析後的值、更新受支援的目標並訂閱已提交的變更。</td>
              <td>精確 <code>settingsAccess</code> grants</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        沒有 <code>shelf</code> 或 <code>appearance</code> 領域。
        書庫資料和目前閱讀行為彼此分離。外觀是設定中的一個分類。
      </p>

      <h3>設定存取</h3>
      <p>
        <code>discover</code>、<code>read</code> 和 <code>write</code>彼此獨立。盡可能授予精確路徑；僅在功能確實需要整個分類時，才使用例如 <code>appearance.*</code>。更新會經過目錄驗證、目標策略、持久性和提交後效果。
      </p>
      <pre><code>{`const entries = await ctx.domains.settings.queries.discover({
  section: "appearance",
});

await ctx.domains.settings.commands.update([
  {
    path: "appearance.theme",
    value: "dark",
    target: { kind: "global" },
  },
]);`}</code></pre>

      <h2>貢獻</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>註冊表</th><th>外掛提供</th><th>權限</th></tr></thead>
          <tbody>
            <tr><td><code>selectionActions</code></td><td>選區動作及回傳提示或宿主算繪檢視的處理常式。</td><td>無</td></tr>
            <tr><td><code>headerActions</code></td><td>閱讀器或書庫動作、位置元資料和檢視回呼。</td><td>無</td></tr>
            <tr><td><code>commands</code></td><td>命令元資料和處理常式。</td><td>無</td></tr>
            <tr><td><code>settingsOptions</code></td><td>一個已宣告外掛欄位的動態選項。</td><td>無</td></tr>
            <tr><td><code>voiceProviders</code></td><td>聲音清單和編碼音頻合成。</td><td>無</td></tr>
            <tr><td><code>contentProviders</code></td><td>虛擬書籍鍵的章節。</td><td>無</td></tr>
            <tr><td><code>readerModes</code></td><td>受限閱讀器分段模式；目前僅限內建外掛。</td><td><code>reader:modes</code></td></tr>
            <tr><td><code>agentTools</code></td><td>工具 schema、使用者可讀標籤、描述和執行器。</td><td><code>agent:tools</code></td></tr>
            <tr><td><code>agentContextProviders</code></td><td>受限的目前輪次參考區塊。</td><td><code>agent:context</code></td></tr>
            <tr><td><code>agentRetrievalProviders</code></td><td>來自外掛資料的搜尋結果。</td><td><code>agent:retrieval</code></td></tr>
            <tr><td><code>memoryCandidateProviders</code></td><td>可能持久性的事實、偏好、洞察或摘要。</td><td><code>agent:memory</code></td></tr>
            <tr><td><code>themes</code>, <code>fonts</code></td><td>manifest 宣告的語意主題和字型資料。</td><td><code>ui:themes</code></td></tr>
          </tbody>
        </table>
      </div>
      <p>
        每個貢獻 ID 都按外掛劃分命名空間，每次註冊都有歸屬且可檢查，過期的可釋放物件不能移除較新的替代項。新的貢獻類型仍需宿主有意提供消費者；之後任何相容外掛都能註冊，無需在應用程式中逐一列出。
      </p>

      <h3>助理擴充邊界</h3>
      <ul>
        <li><strong>上下文提供者</strong>執行一輪。宿主添加來源、限制大小，並將輸出序列化為不受信任參考資料。</li>
        <li><strong>檢索提供者</strong>成為命名空間工具，帶有宿主擁有的 <code>query</code>/<code>limit</code> schema 和裁切後的結果。</li>
        <li><strong>記憶候選提供者</strong>在一輪之後提出受限候選；宿主驗證範圍、去重並執行任何持久寫入。</li>
      </ul>
      <p>
        外掛永遠不會收到 Memory 連接埠，不能注入系統規則，也不能直接寫入長期記憶。
      </p>

      <h2>宿主服務</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>服務</th><th>契約</th><th>權限</th></tr></thead>
          <tbody>
            <tr><td><code>storage</code></td><td>命名空間 KV、文件集合和外部變更通知。</td><td>無</td></tr>
            <tr><td><code>secrets</code></td><td>命名空間加密憑證槽。</td><td>無</td></tr>
            <tr><td><code>ui</code></td><td>宿主提示和儲存/匯出流程。</td><td>無</td></tr>
            <tr><td><code>schedules</code></td><td>將處理常式綁定到 manifest 宣告的頻率。</td><td>無</td></tr>
            <tr><td><code>session</code></td><td>訂閱受限的閱讀會話事實。</td><td>無</td></tr>
            <tr><td><code>network</code></td><td>宿主中介的 HTTP。</td><td><code>service:network</code></td></tr>
            <tr><td><code>llm</code></td><td>使用使用者設定進行一次性文字或 JSON schema 約束的模型呼叫。</td><td><code>service:llm</code></td></tr>
            <tr><td><code>clipboard</code></td><td>向系統剪貼板寫入文字。</td><td><code>service:clipboard</code></td></tr>
          </tbody>
        </table>
      </div>

      <h3>儲存</h3>
      <p>
        使用 KV 儲存小型設定和檢查點。使用命名文件集合儲存具有穩定 ID 且可選包含{" "}
        <code>bookId</code>/<code>anchor</code>來源資訊的外掛記錄。來源資訊是索引而非所有權；引用書籍被刪除後檔案仍可保留。解除安裝會清空文件集合，但保留 KV、金鑰槽和已提交的 schema 元資料，以便重新安裝和遷移。
      </p>

      <h3>排程任務</h3>
      <p>
        manifest 宣告 <code>{`{ id, label, everyMinutes }`}</code>，啟用透過
        <code>ctx.services.schedules.bind</code>綁定處理常式。最短頻率為 15
        分鐘。應用程式開啟時至少按此頻率執行，逾時會在啟動後補跑，任務不會重疊。這不是持久背景工作，也不保證精確時間。
      </p>

      <h2>宣告式 UI 和設定</h2>
      <p>
        外掛回傳版本化的檢視資料，而非可執行 UI。檢視語法包括 markdown、可搜尋清單、表單、詳細版面、字典結果和受限區塊樹。處理常式可以保留介面、顯示提示、開啟或取代檢視、重置導覽、關閉介面或回傳欄位錯誤。宿主負責 promise 的載入和失敗狀態。
      </p>
      <p>
        Manifest 設定使用宿主控制項支援文字、文字域、數字、時間、選取、選項、核取方塊、切換開關和金鑰欄位。條件欄位使用 <code>visibleWhen</code>；動態選取使用已註冊的 <code>settingsOptions</code> 提供方。金鑰欄位直接寫入加密金鑰槽，永遠不會進入一般設定物件或助理可見目錄。
      </p>

      <h2>主題和字型</h2>
      <p>
        主題外掛在 manifest 中宣告語意資料。應用程式主題覆蓋固定的宿主權杖詞匯；閱讀器主題提供所需的六色頁面調色盤和可選排版預設值。宿主驗證值、產生 CSS、載入獲核准的本機字型檔案，並在使用者選取前不套用任何內容。
      </p>
      <p>
        提供選項需要 <code>ui:themes</code>。選取主題需要精確的設定寫入授權，例如 <code>appearance.theme</code> 或{" "}
        <code>reading.theme</code>。二者並不相互推導。
      </p>

      <h2>生命週期階段</h2>
      <ol>
        <li><strong>啟用中：</strong> 可使用查詢和外掛私有讀取；註冊會暫存；副作用被阻止。</li>
        <li><strong>遷移中：</strong> 只能使用外掛 KV 和文件集合。</li>
        <li><strong>已啟用：</strong> 已晉升的處理常式可以使用獲准的領域、貢獻和服務。</li>
      </ol>
      <p>
        宿主會排空啟用 RPC、檢查 Worker 健康狀態、執行資料遷移，然後在一個明確的時點晉升全部暫存項。啟用失敗會釋放暫存工作，不取代目前執行時。
      </p>

      <h2>Worker 環境</h2>
      <p>
        無法存取 React、Jotai、DOM、WebView、Tauri、SQLite、檔案系統或作業系統處理程序。環境中的 <code>fetch</code>、WebSocket、EventSource、XMLHttpRequest、BroadcastChannel、IndexedDB 和 Cache Storage 均已停用。網路、持久性和所有宿主互動都必須使用型別化上下文。
      </p>

      <h2>相容性和穩定性</h2>
      <p>
        領域、貢獻、服務和宣告式 schema 各自擁有獨立的語意版本。未知 ID、無效 semver 範圍、無法存取的必要能力和不相容的宿主版本都會阻止啟用。相容的新增內容提升所屬能力的版本，而非一個全域外掛 API 編號。
      </p>
      <p>
        目前生態是官方外掛，因此目前由註冊表支援的契約就是基線。不要相依早期的 <code>shelf</code>,{" "}
        <code>appearance</code> 或註冊表之前的形態。
      </p>
    </article>
  );
}
