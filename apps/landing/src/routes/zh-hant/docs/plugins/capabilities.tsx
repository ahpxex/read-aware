import { createFileRoute } from "@tanstack/react-router";
import { PluginCapabilityBrowser, type PluginCapabilityBrowserCopy } from "../../../../components/PluginCapabilityBrowser";
import { PluginPermissionPreview, type PluginPermissionPreviewCopy } from "../../../../components/PluginPermissionPreview";

export const Route = createFileRoute("/zh-hant/docs/plugins/capabilities")({
  head: () => ({ meta: [
    { title: "外掛能力 — ReadAware 文件" },
    { name: "description", content: "瀏覽每個版本化的 ReadAware 外掛能力，並預覽外掛 manifest 請求的授權。" },
  ] }),
  component: PluginCapabilitiesPage,
});

const capabilityCopy: PluginCapabilityBrowserCopy = {
  searchLabel: "搜尋能力", searchPlaceholder: "ID、權限或用途", familyLabel: "能力類別", authorityLabel: "授權類型",
  allFamilies: "所有類別", allAuthorities: "所有授權",
  familyNames: { domains: "領域", contributions: "貢獻", services: "服務", schemas: "Schema" },
  authorityNames: { permission: "需要權限", "permission-free": "無需額外權限", "settings-grant": "精確設定授權" },
  permissionFree: "無", versionLabel: "v", permissionLabel: "授權", capabilityLabel: "能力", purposeLabel: "外掛可以", hostOwnsLabel: "宿主負責",
  result: (count) => count + " 項能力", noResults: "沒有能力符合這些篩選條件。",
  descriptions: {
    "domains:library": { purpose: "讀取書籍、檔案、元資料、目錄、集合，以及匯入或移除書庫項目。", hostOwns: "書庫不變條件、事件溯源寫入、檔案和投影。" },
    "domains:reading": { purpose: "檢視目前會話，並導覽、更新位置、進度和閱讀時間。", hostOwns: "閱讀器生命週期、進度語意和已提交事件。" },
    "domains:annotations": { purpose: "透過標準命令讀取或更改反白和筆記。", hostOwns: "驗證、歸屬、持久性和事件順序。" },
    "domains:conversations": { purpose: "讀取書籍和全域執行緒摘要。", hostOwns: "對話寫入、提示語組裝和記憶。" },
    "domains:settings": { purpose: "發現、讀取、更新並訂閱明確授權的設定路徑。", hostOwns: "目錄、目標、驗證、持久性和變更效果。" },
    "contributions:selectionActions": { purpose: "向選取區和標註選單加入命令。", hostOwns: "選單位置、呼叫介面、載入和無障礙。" },
    "contributions:headerActions": { purpose: "加入閱讀器或書庫工具列動作，並顯示由宿主算繪的檢視。", hostOwns: "位置、導覽、彈出層、頁面和焦點。" },
    "contributions:commands": { purpose: "加入顯式的命令面板命令。", hostOwns: "註冊表、面板、快速鍵和結果呈現。" },
    "contributions:settingsOptions": { purpose: "為一個已宣告的外掛設定解析動態選項。", hostOwns: "表單算繪、備用輸入和數值驗證。" },
    "contributions:voiceProviders": { purpose: "列出聲音並合成用於朗讀的編碼音訊。", hostOwns: "播放、節奏、預先擷取、反白和備援。" },
    "contributions:contentProviders": { purpose: "為 RSS 等虛擬書籍載入章節。", hostOwns: "書庫繫結、閱讀模型、導覽和呈現。" },
    "contributions:readerModes": { purpose: "提供受限的句子或段落分段。目前僅限內建外掛。", hostOwns: "閱讀器控制項、生命週期、算繪和導覽。" },
    "contributions:agentTools": { purpose: "註冊閱讀助理可以呼叫的命名空間工具。", hostOwns: "編排、工具可見性、核准和對話介面。" },
    "contributions:agentContextProviders": { purpose: "為目前使用者輪次回傳受限的參考區塊。", hostOwns: "來源、裁切、提示語位置和生命週期。" },
    "contributions:agentRetrievalProviders": { purpose: "將可搜尋的外掛來源公開為命名空間助理工具。", hostOwns: "查詢 schema、限制、結果裁切和工具描述。" },
    "contributions:memoryCandidateProviders": { purpose: "在一輪對話後提出事實、偏好、洞察或摘要。", hostOwns: "範圍檢查、去重、接納和持久記憶寫入。" },
    "contributions:themes": { purpose: "提供語意化應用程式和閱讀器主題資料。", hostOwns: "驗證、CSS 產生、選取和套用。" },
    "contributions:fonts": { purpose: "提供獲核准的字型元資料和內建字型資源。", hostOwns: "檔案驗證、載入、選取器項目和目前選取。" },
    "services:storage": { purpose: "使用外掛專屬範圍的 KV 和文件集合。", hostOwns: "命名空間隔離、持久性、快照和變更事件。" },
    "services:secrets": { purpose: "在外掛專屬範圍的金鑰槽中存取憑證。", hostOwns: "加密、不揭露和命名空間隔離。" },
    "services:ui": { purpose: "顯示宿主提示，或開啟宿主儲存/匯出流程。", hostOwns: "呈現、路徑選取和平台整合。" },
    "services:schedules": { purpose: "將工作繫結到 manifest 宣告的週期任務。", hostOwns: "頻率、啟動時補執行、防止重疊和釋放。" },
    "services:session": { purpose: "訂閱目前閱讀會話的受限事實。", hostOwns: "事件來源、資料範圍和訂閱生命週期。" },
    "services:network": { purpose: "透過原生宿主客戶端發出 HTTP 請求。", hostOwns: "權限強制、傳輸和回應橋接。" },
    "services:llm": { purpose: "進行受限的一次性文字或結構化模型呼叫。", hostOwns: "供應商設定、憑證、schema 處理和限制。" },
    "services:clipboard": { purpose: "向系統剪貼簿寫入文字。", hostOwns: "平台呼叫和權限強制。" },
    "schemas:views": { purpose: "回傳 markdown、清單、表單、詳情和受限區塊樹。", hostOwns: "元件、HTML 安全、版面、無障礙和導覽。" },
    "schemas:settings": { purpose: "宣告由宿主算繪的外掛設定欄位。", hostOwns: "表單行為、驗證、儲存路由和金鑰處理。" },
    "schemas:themes": { purpose: "宣告語意主題權杖和內建字型元資料。", hostOwns: "語法驗證、產生 CSS、載入和選取。" },
  },
};

const permissionCopy: PluginPermissionPreviewCopy = {
  inputLabel: "manifest.json", inputHint: "只在此頁面解析，不會上傳任何內容。", previewLabel: "審核預覽",
  noAuthority: "此 manifest 未請求語意權限或設定授權。", invalidJson: "請輸入有效的 JSON 物件。", issuesTitle: "審核備註",
  permissionsTitle: "使用者授權 · 語意權限", settingsTitle: "使用者授權 · 精確設定授權", requirementsTitle: "相容性 · 不是權限",
  declarationsTitle: "執行宣告 · 不是權限", none: "未宣告", schemaVersion: "私有資料 schema",
  schedules: (count) => count + " 個週期任務", themes: (count) => count + " 個主題", fonts: (count) => count + " 個內建字型宣告",
  unknownPermission: (permission) => "未知權限：" + permission, missingField: (field) => "缺少必要欄位：" + field,
  invalidSchemaVersion: "schemaVersion 必須是正整數。", invalidPermissions: "permissions 必須是陣列。",
  invalidSettingsAccess: "settingsAccess 必須是物件。",
  unknownSettingsOperation: (operation) => "未知設定操作：" + operation,
  invalidSettingsGrant: (operation) => operation + " 必須包含精確路徑或 section.* 分組。",
  sectionGrantWarning: (path) => path + " 授予整個設定分類；請盡可能使用精確路徑。",
  permissionDescriptions: {
    "library:read": "讀取書籍、原文、元資料、目錄和集合。", "library:write": "更改書庫；寫入包含讀取。",
    "reading:read": "讀取目前會話、位置、進度和閱讀時間。", "reading:write": "導覽並更改閱讀狀態；寫入包含讀取。",
    "annotations:read": "讀取反白和筆記。", "annotations:write": "建立、編輯和移除標註；寫入包含讀取。",
    "conversations:read": "讀取書籍和全域對話摘要。", "reader:modes": "註冊引導式閱讀模式；目前僅限內建外掛。",
    "agent:tools": "註冊閱讀助理可以呼叫的工具。", "agent:context": "向一輪對話加入受限的非可信參考區塊。",
    "agent:retrieval": "向助理公開可搜尋的外掛來源。", "agent:memory": "提出由宿主審核的持久記憶候選。",
    "ui:themes": "提供應用程式主題、閱讀器主題和內建字型。", "service:network": "發出由宿主中介的網路請求。",
    "service:llm": "使用已設定的模型進行受限的一次性呼叫。", "service:clipboard": "向系統剪貼簿寫入文字。",
  },
  operationLabels: { discover: "發現", read: "讀取", write: "寫入" },
  familyLabels: { domains: "領域", contributions: "貢獻", services: "服務", schemas: "Schema" },
};

const sampleManifest = `{
  "id": "research-notes",
  "name": "研究筆記",
  "version": "0.1.0",
  "schemaVersion": 1,
  "requires": {
    "domains": { "annotations": "^1.0.0", "settings": "^1.0.0" },
    "contributions": {
      "commands": "^1.0.0",
      "agentRetrievalProviders": "^1.0.0"
    },
    "services": {
      "storage": "^1.0.0",
      "schedules": "^1.0.0",
      "network": "^1.0.0"
    },
    "schemas": { "settings": "^1.0.0" }
  },
  "permissions": [
    "annotations:read",
    "agent:retrieval",
    "service:network"
  ],
  "settingsAccess": {
    "discover": ["appearance.theme"],
    "read": ["appearance.theme"]
  },
  "schedules": [
    { "id": "refresh", "label": "重新整理來源", "everyMinutes": 60 }
  ],
  "main": "main.js"
}`;

function PluginCapabilitiesPage() {
  return (
    <article className="doc-prose">
      <h1>能力瀏覽器</h1>
      <p className="lead">設計外掛前，搜尋完整的公開目錄。每項能力都獨立版本化；每項依賴都必須寫入 manifest 的 <code>requires</code> 部分。</p>
      <PluginCapabilityBrowser copy={capabilityCopy} />
      <h2>如何閱讀目錄</h2>
      <ul>
        <li><strong>授權</strong>表示呼叫時需要的權限或精確設定授權。</li>
        <li><strong>無</strong>表示不需要額外的安裝權限，並不代表存在未記錄的環境能力。</li>
        <li><strong>宿主負責</strong>標記外掛無法替換或繞過的邊界。</li>
        <li>每項能力旁的版本直接來自宿主的標準能力目錄。</li>
      </ul>
      <p><code>readerModes</code> 在特權閱讀器契約確定前仍僅限內建外掛。manifest 只能指名目錄中的能力；宿主仍會根據 actor、權限、版本和生命週期階段篩選可見的執行時檢視。</p>
      <h2>權限預覽</h2>
      <p>貼上 manifest，將使用者授權與相容性及執行宣告分開。它反映安裝同意的意義，但不能替代儲存庫驗證器，也不能證明外掛可以啟用。</p>
      <PluginPermissionPreview copy={permissionCopy} sampleManifest={sampleManifest} />
      <h2>安裝對話框實際授予什麼</h2>
      <p>語意 <code>permissions</code> 和精確的 <code>settingsAccess</code> 項目授予權限。正式的同意對話框會用直白的語言呈現二者。能力要求、排程任務、schema 版本、主題和字型可作為審核上下文，但不會被悄悄重新標記為權限。</p>
      <p>此預覽刻意保持本機且無狀態。下一步開發工具是在應用程式內提供 actor 檢視和生命週期檢查器，使用相同的執行時目錄，並顯示更新時的權限差異和能力無法使用的確切原因。</p>
    </article>
  );
}


