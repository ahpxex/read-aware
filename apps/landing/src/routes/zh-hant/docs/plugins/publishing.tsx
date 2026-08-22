import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/zh-hant/docs/plugins/publishing")({
  head: () => ({
    meta: [
      { title: "發佈上架 — ReadAware 文件" },
      {
        name: "description",
        content:
          "如何向 ReadAware 外掛市集提交外掛：儲存庫結構、校驗流程與審核要求。",
      },
    ],
  }),
  component: PublishingPage,
});

function PublishingPage() {
  return (
    <article className="doc-prose">
      <h1>發佈外掛</h1>
      <p className="lead">
        外掛市集的運作方式與 Raycast 的擴充功能儲存庫類似：你的外掛存放在公開的{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          readaware-plugins
        </a>{" "}
        儲存庫裡，透過 pull request 進入。合併之後，它就會出現在應用程式的「設定
        → 外掛 → 外掛市集」中，一鍵即可安裝。
      </p>

      <h2>用 TypeScript 編寫</h2>
      <p>
        建議使用 TypeScript。儲存庫自帶一個 <code>template/</code>
        ，已經接好型別化的 API（<code>types/plugin-api.d.ts</code>
        ）——複製它，編寫 <code>src/main.ts</code>
        ，再組建為單個自包含模組：
      </p>
      <pre>
        <code>bun build src/main.ts --outfile main.js --format esm</code>
      </pre>
      <p>
        最終上架的始終是組建出的 <code>main.js</code>；請保留{" "}
        <code>src/</code> 的提交，讓審閱者能讀到真實程式碼。純 JavaScript
        同樣被接受。<code>plugins/</code>{" "}
        裡的官方外掛就是這樣寫成的——把它們當作活的範例。
      </p>

      <h2>提交</h2>
      <ol>
        <li>Fork 這個儲存庫。</li>
        <li>
          把 <code>template/</code> 複製為{" "}
          <code>plugins/&lt;your-plugin-id&gt;/</code>，至少包含{" "}
          <code>manifest.json</code> 和 <code>main.js</code>。資料夾名稱必須與
          manifest 的 <code>id</code> 一致。
        </li>
        <li>
          在 <code>registry.json</code> 中新增對應條目，保持陣列按 id 排序。
        </li>
        <li>
          在本機執行與 CI 相同的檢查：
          <pre>
            <code>{`node scripts/validate.mjs
npx tsc --noEmit`}</code>
          </pre>
        </li>
        <li>
          發起 pull
          request，說明外掛做什麼，以及它宣告的每一項權限為什麼是必要的。
        </li>
      </ol>
      <p>
        CI 會強制檢查 registry 與 manifest 的一致性、id
        的格式、權限白名單和檔案存在性，並對每個 TypeScript
        外掛做型別檢查。
      </p>

      <h2>更新</h2>
      <p>
        流程相同：在同一個 pull request 裡同時提升 <code>manifest.json</code>{" "}
        和 <code>registry.json</code> 中的 <code>version</code>
        。注意應用程式透過 CDN 讀取
        registry，合併後的更新可能要過一小段時間才會出現在外掛市集分頁裡。
      </p>

      <h2>審核要求</h2>
      <ul>
        <li>
          只宣告最小權限。宣告的權限超出程式碼實際使用時，pull
          request 會被退回——參見
          <Link to="/zh-hant/docs/plugins/api">權限表</Link>。
        </li>
        <li>
          <code>main.js</code> 必須可讀，或附帶打包它的原始碼。
        </li>
        <li>不接受混淆程式碼，不接受資料分析或追蹤，不接受遠端程式碼載入。</li>
      </ul>
      <p>
        外掛執行在應用程式內部，擁有與應用程式本身相同的存取能力。安裝是使用者對每個外掛逐一做出的信任決定，而這道審核是社群的第一道防線——請寫出那種即使來自陌生人、你自己也放心安裝的外掛。
      </p>
    </article>
  );
}
