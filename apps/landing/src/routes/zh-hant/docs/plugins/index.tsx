import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/zh-hant/docs/plugins/")({
  head: () => ({
    meta: [
      { title: "外掛系統 — ReadAware 文件" },
      {
        name: "description",
        content:
          "ReadAware 外掛如何擴充產品領域、貢獻新能力、使用宿主服務，並處於明確的信任邊界內。",
      },
    ],
  }),
  component: PluginsOverviewPage,
});

function PluginsOverviewPage() {
  return (
    <article className="doc-prose">
      <h1>外掛系統</h1>
      <p className="lead">ReadAware 外掛可以處理閱讀資料、加入原生動作和供應商、擴充閱讀助理，並向宿主請求受限服務。已安裝的套件會動態載入；應用程式不必為每個外掛 ID 個別加入開關。</p>

      <h2>一個模型，三類能力</h2>
      <p>每個可執行的外掛能力都屬於以下三種形態之一。選擇正確的形態，是撰寫外掛時的第一項決策。</p>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>類別</th><th>適用情境</th><th>範例</th></tr></thead>
          <tbody>
            <tr><td><strong>領域</strong></td><td>ReadAware 已經擁有該狀態或行為。</td><td>書庫、閱讀、標註、對話、設定</td></tr>
            <tr><td><strong>貢獻</strong></td><td>外掛提供新的選擇或實作。</td><td>動作、命令、聲音、內容、主題、助理供應商</td></tr>
            <tr><td><strong>服務</strong></td><td>宿主必須執行受限的外部操作。</td><td>儲存、金鑰、排程任務、網路、LLM、剪貼簿</td></tr>
          </tbody>
        </table>
      </div>
      <p>宣告式檢視、設定和主題 schema 與這些類別並列。它們描述由宿主算繪的資料，並不會授予另一種授權來源。</p>

      <h2>設定屬於一個領域</h2>
      <p>外觀是設定中的一個分類，而非獨立的外掛 API。改變所選主題的外掛請求的是例如 <code>appearance.theme</code> 的精確設定路徑。提供新主題的外掛使用 <code>themes</code> 貢獻。選擇和提供是刻意分開的權限。</p>

      <h2>外掛可以加入什麼</h2>
      <ul>
        <li>選取動作和頂欄動作、命令面板命令，以及由宿主算繪的檢視。</li>
        <li>聲音、虛擬書籍內容供應商、閱讀模式、主題和字型。</li>
        <li>助理工具、每輪上下文、可搜尋的私有來源，以及記憶候選。</li>
        <li>外掛設定、動態選項、週期性工作、儲存和加密金鑰。</li>
        <li>在獲授權的產品領域中讀取資料、執行命令並訂閱已提交的事件。</li>
      </ul>
      <p>在<Link to="/zh-hant/docs/plugins/capabilities">能力瀏覽器</Link>中查看完整的版本化清單。它也會預覽 <code>manifest.json</code> 所請求的權限。</p>

      <h2>原生 UI，源於構造</h2>
      <p>外掛不會掛載 React、HTML、CSS、iframe 或任意 DOM。它們回傳經過驗證的檢視資料和回呼；ReadAware 負責版面、導覽、無障礙、主題相容性、載入狀態和清理。新的視覺自由度只能透過受限 schema 或真正的宿主貢獻點加入，而非透過通用 webview 逃生口。</p>

      <h2>信任邊界</h2>
      <p>每個外掛都執行在自己的模組 Worker 中。它無法存取 DOM、Tauri、SQLite、檔案系統或作業系統處理程序，環境網路和瀏覽器持久性 API 也已停用。宿主呼叫跨越訊息邊界，並根據外掛的 actor 範圍能力檢視解析。</p>
      <p>這會限制意外越權和直接越權，但安裝仍然是軟體信任決策。在程式碼執行前，ReadAware 會呈現語意權限和精確的設定授權。能力要求會獨立檢查：權限回答「它可以做這件事嗎？」，版本要求回答「它能正確使用這份契約嗎？」</p>

      <h2>啟用和更新都是交易性的</h2>
      <p><code>activate()</code> 是讀取並宣告的階段。在宿主排空呼叫並完成 Worker 健康檢查之前，註冊內容都不可見；寫入、金鑰、網路、LLM、剪貼簿、UI 效果和導覽都會被阻止。持久資料變化稍後透過僅限儲存的 <code>migrate()</code> 執行。只有健康且完成遷移的候選版本才會晉升。</p>
      <p>更新會對檔案、外掛 KV、文件集合和已提交的 schema 中繼資料做快照。啟用或遷移失敗時，會恢復之前的檔案和資料，並在需要時重新啟動之前的執行階段。</p>

      <h2>目前生態系</h2>
      <p>目前發佈的外掛都是內建的官方外掛：Dictionary、Editorial Themes、RSS Reader、Sentence Reader、TTS Voices 和 Theme Schedule。公開的{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">readaware-plugins 儲存庫</a>{" "}
        包含撰寫範本、公開宣告、驗證和市集註冊表。沒有需要保留的舊版第三方 API；目前契約就是基線。
      </p>

      <h2>開始建置</h2>
      <p>按照<Link to="/zh-hant/docs/plugins/develop">建置外掛</Link>完成本機循環，實作時參考<Link to="/zh-hant/docs/plugins/api">API 參考</Link>，提交市集變更前閱讀<Link to="/zh-hant/docs/plugins/publishing">發佈外掛</Link>。</p>
    </article>
  );
}
