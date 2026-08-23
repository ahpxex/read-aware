import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/zh-hant/docs/plugins/develop")({
  head: () => ({
    meta: [
      { title: "建置外掛 — ReadAware 文件" },
      { name: "description", content: "使用公開的 TypeScript 範本建立、驗證、安裝、遷移並測試 ReadAware 外掛。" },
    ],
  }),
  component: DevelopPluginPage,
});

function DevelopPluginPage() {
  return (
    <article className="doc-prose">
      <h1>建置外掛</h1>
      <p className="lead">從公開的 TypeScript 範本開始，宣告最小的能力集合，並在 ReadAware 桌面應用程式中執行建置後的套件。宿主負責生命週期、權限、呈現和回復；外掛負責自己的行為和私有資料。</p>
      <h2>前置條件</h2>
      <ul>
        <li>ReadAware 桌面應用程式，並可存取「設定 → 外掛」。</li>
        <li><a href="https://bun.sh" target="_blank" rel="noopener noreferrer">Bun</a>，用於執行儲存庫指令碼。</li>
        <li><a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">readaware-plugins 儲存庫</a>的複本或 fork。</li>
      </ul>
      <h2>建立套件</h2>
      <ol>
        <li>將 <code>template/</code> 複製到 <code>plugins/&lt;your-plugin-id&gt;/</code>。</li>
        <li>保持資料夾名稱、manifest 的 <code>id</code> 和執行階段命名空間完全一致。</li>
        <li>編輯 <code>manifest.json</code> 和 <code>src/main.ts</code>。</li>
        <li>刪除不使用的範本貢獻，並移除對應權限。</li>
        <li>建置 ReadAware 將載入的自包含 <code>main.js</code>。</li>
      </ol>
      <pre><code>{"bun run build\nbun run typecheck\nbun test\nbun run validate"}</code></pre>
      <h2>先設計 manifest，再實作</h2>
      <p>依照以下順序檢查 manifest：</p>
      <ol>
        <li><strong>身分</strong>：穩定 ID、名稱、套件版本、作者和最低應用程式版本。</li>
        <li><strong>資料</strong>：正整數 <code>schemaVersion</code> 和遷移路徑。</li>
        <li><strong>相容性</strong>：為每個使用的 API 和 schema 在 <code>requires</code> 中寫入 semver 範圍。</li>
        <li><strong>授權</strong>：語意 <code>permissions</code> 和精確的 <code>settingsAccess</code> 授權。</li>
        <li><strong>宣告</strong>：設定、排程任務、主題、字型和進入模組。</li>
      </ol>
      <p>安裝前使用<Link to="/zh-hant/docs/plugins/capabilities">能力瀏覽器和權限預覽</Link>。要求是相容性宣告，不是使用者授權；即使能力不需要權限，只要外掛依賴其契約，也必須寫入 <code>requires</code>。</p>
      <h2>選擇正確的能力</h2>
      <ol>
        <li>ReadAware 擁有某種狀態或行為時，使用<strong>領域</strong>。</li>
        <li>提供選擇、動作或供應商時，使用<strong>貢獻</strong>。</li>
        <li>需要受限的宿主操作時，使用<strong>服務</strong>。</li>
        <li>外掛儲存只用於外掛擁有的資料。</li>
        <li>現有形態都不合適時，請求新的型別化宿主能力。</li>
      </ol>
      <p>不要把書籍、進度、標註、設定或記憶複製到外掛儲存。影子狀態會繞過產品不變條件、已提交事件、投影重建、同步語意和助理上下文。</p>
      <h2>讓啟用保持宣告式</h2>
      <p>在 <code>activate(ctx)</code> 期間檢查環境，並註冊動作、命令、供應商、訂閱和排程任務。不要執行業務寫入或外部工作。宿主會一直暫存每項註冊，直到啟用 RPC 完成且 Worker 回覆健康檢查。</p>
      <p>晉升後，從已註冊的處理常式啟動執行階段工作。如果處理常式回傳 promise，讓宿主顯示載入和失敗狀態。只有在可選的 <code>deactivate()</code> 必須關閉外部資源時，才保留這些資源的參照；宿主註冊和訂閱會自動釋放。</p>
      <h2>明確為私有資料建立版本</h2>
      <p><code>schemaVersion</code> 為外掛 KV 和文件集合建立版本；它獨立於套件版本。只有私有資料形態改變時才修改它。在 schema 提交後，為每個支援的升級和降級匯出 <code>migrate(storageCtx, change)</code>。</p>
      <ul>
        <li>遷移只能接收儲存：不能使用領域、設定、金鑰、網路、UI、LLM 或貢獻。</li>
        <li>讓每次轉換都具備確定性和冪等性。</li>
        <li>測試部分寫入後發生失敗的情況；宿主必須精確恢復 KV、文件、檔案和 schema 中繼資料。</li>
        <li>不要用套件版本檢查取代資料 schema。</li>
      </ul>
      <h2>安裝工作資料夾</h2>
      <ol>
        <li>執行建置和檢查。</li>
        <li>開啟 ReadAware → 設定 → 外掛 → 安裝外掛。</li>
        <li>選擇建置出的外掛資料夾並檢查同意摘要。</li>
        <li>在桌面應用程式中執行實際功能。</li>
        <li>重新建置並安裝，以測試更新。</li>
      </ol>
      <p>一般瀏覽器無法驗證外掛安裝、Worker IPC、SQLite 持久性、原始書籍存取、閱讀器整合或回復。請測試用於發佈的 Tauri 應用程式。</p>
      <h2>測試生命週期，而不只是成功路徑</h2>
      <ul>
        <li>全新安裝、啟用、停用，以及不重新啟動應用程式再次啟用。</li>
        <li>使用真實資料完成成功更新和降級。</li>
        <li>啟用逾時、處理常式拒絕、遷移失敗和精確回復。</li>
        <li>解除安裝清理：不殘留動作、監聽器、排程、供應商或 Worker。</li>
        <li>更新期間移除權限和擴充權限。</li>
        <li>長標籤、空狀態、鍵盤導覽和所有宿主主題。</li>
      </ul>
      <h2>了解目前限制</h2>
      <p>ReadAware 開啟期間，排程任務至少按宣告的頻率執行，逾期時會在啟動時補執行。它們不是持久任務：應用程式關閉時不會執行，沒有持久佇列、重試／退避契約或當機恢復保證。</p>
      <p>UI 只在現有的型別化貢獻點可用。缺少掛載位置時，需要宿主持有的貢獻點和消費者；不會為了走捷徑加入任意 HTML 或通用原生 invoke API。</p>
      <h2>下一步</h2>
      <p>把<Link to="/zh-hant/docs/plugins/api">API 參考</Link>放在編輯器旁邊，然後在準備註冊表 pull request 前閱讀<Link to="/zh-hant/docs/plugins/publishing">發佈外掛</Link>。</p>
    </article>
  );
}




