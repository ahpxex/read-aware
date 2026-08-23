import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/zh-hant/docs/plugins/publishing")({
  head: () => ({
    meta: [
      { title: "發佈外掛 — ReadAware 文件" },
      { name: "description", content: "準備、驗證、審核並向公開市集儲存庫提交 ReadAware 外掛。" },
    ],
  }),
  component: PublishingPage,
});

function PublishingPage() {
  return (
    <article className="doc-prose">
      <h1>發佈外掛</h1>
      <p className="lead">市集套件存放在公開的 <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">readaware-plugins 儲存庫</a>中，並透過審核進入。目前目錄由官方外掛組成；這套流程也是未來接受外部提交時的契約。</p>
      <h2>準備可審核的套件</h2>
      <p>推薦使用 TypeScript。讓 <code>src/</code> 與建置出的自包含 <code>main.js</code> 並列，方便審核者比較原始碼和產物。提交每一項執行階段資源。不要載入遠端程式碼，不要把行為藏在產生的 blob 中，也不要依賴套件之外的檔案。</p>
      <pre><code>{"plugins/my-plugin/\n  manifest.json\n  main.js\n  package.json\n  tsconfig.json\n  src/main.ts\n  assets/…"}</code></pre>
      <h2>執行儲存庫檢查</h2>
      <pre><code>{"bun run build\nbun run typecheck\nbun test\nbun run validate"}</code></pre>
      <p>驗證會檢查註冊表與 manifest 的一致性、ID、版本、能力要求、權限、宣告檔案和套件形態。這些檢查是必要條件而非充分條件：提交前還要在 ReadAware 桌面應用程式中執行建置出的資料夾。</p>
      <h2>提交</h2>
      <ol>
        <li>Fork 公開儲存庫。</li>
        <li>將範本複製到 <code>plugins/&lt;plugin-id&gt;/</code>，並保持資料夾名等於 manifest ID。</li>
        <li>加入套件和所有必要的執行階段資源。</li>
        <li>在 <code>registry.json</code> 中加入匹配且按 ID 排序的項目。</li>
        <li>執行根目錄的四項檢查，並從建置出的資料夾測試本機安裝。</li>
        <li>發起 pull request，說明行為、私有資料、外部服務，以及每項權限和設定授權的理由。</li>
      </ol>
      <h2>審核清單</h2>
      <ul>
        <li>功能使用現有最窄的領域、貢獻和服務能力。</li>
        <li><code>requires</code> 為每個使用的契約寫出有依據的 semver 範圍。</li>
        <li>權限和 <code>settingsAccess</code> 與實際執行階段呼叫一致，不包含推測性的授權。</li>
        <li><code>activate()</code> 註冊行為，但不執行任何業務或外部副作用。</li>
        <li>外掛私有資料擁有穩定 schema，每次版本轉換都有經過測試的遷移。</li>
        <li>用面向使用者的語言說明網路端點、LLM 使用、憑證、排程任務和資料保留。</li>
        <li>宿主算繪的檢視支援鍵盤導覽、長文字、空資料以及淺色和深色主題。</li>
        <li>原始碼可讀、產生產物可複現，且不存在分析、追蹤、混淆或遠端程式碼載入。</li>
      </ul>
      <p><Link to="/zh-hant/docs/plugins/capabilities">權限預覽</Link>適合作為提交前檢查。儲存庫驗證和人工審核仍是正式檢查。</p>
      <h2>更新和資料遷移</h2>
      <p>同時提升 <code>manifest.json</code> 和 <code>registry.json</code> 中的套件版本。只有私有 KV 或資料形態變化時才提升 <code>schemaVersion</code>，並在同一候選版本中提供相應的 <code>migrate()</code>。</p>
      <p>使用真實資料測試更新和刻意降級。ReadAware 會暫存並健康檢查候選版本、快照外掛檔案和資料、暫停舊執行階段以遷移，並只在成功後晉升。更新失敗必須讓之前的套件和資料仍可使用。</p>
      <h2>權限變化</h2>
      <p>把新增授權當作產品變更，而非 manifest 雜務。說明原本的權限集合為何不足、哪些使用者資料或外部操作變得可存取，以及使用者拒絕時會發生什麼。移除程式碼不再使用的權限。</p>
      <h2>目前的散佈信任</h2>
      <p>Worker 隔離和能力強制執行會減少越權，但安裝仍然是信任決策。在開放廣泛的第三方市集前，ReadAware 仍需要發佈者身分、確定性打包、簽名和完整性驗證、審核來源、撤銷機制、權限差異審核和安全回應路徑。</p>
      <p>這些控制上線前，合併的儲存庫項目只能是審核證據，並不能從數學上保證任意惡意程式碼安全。</p>
      <h2>發起 pull request 前</h2>
      <p>重新閱讀<Link to="/zh-hant/docs/plugins/develop">建置外掛</Link>，在<Link to="/zh-hant/docs/plugins/capabilities">能力工具</Link>中比較最終 manifest，並確認套件遵循目前<Link to="/zh-hant/docs/plugins/api">API 契約</Link>，而非舊的 <code>shelf</code> 或 <code>appearance</code> 範例。</p>
    </article>
  );
}
