import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/zh-hant/docs/plugins/")({
  head: () => ({
    meta: [
      { title: "外掛系統 — ReadAware 文件" },
      {
        name: "description",
        content:
          "ReadAware 外掛能做什麼、信任模型如何運作，以及如何安裝外掛。",
      },
    ],
  }),
  component: PluginsOverviewPage,
});

function PluginsOverviewPage() {
  return (
    <article className="doc-prose">
      <h1>外掛系統</h1>
      <p className="lead">
        外掛為 ReadAware
        帶來新的動作、新的頁面，以及——最重要的——供閱讀助理使用的新工具。外掛是一個小小的
        JavaScript
        模組；它的介面始終由應用程式自己的設計系統渲染，因此外掛功能在觀感上與原生無異。
      </p>

      <h2>外掛可以貢獻什麼</h2>
      <ul>
        <li>
          <strong>選取動作</strong>——閱讀器文字選取選單中的條目。把一個單詞送進
          Anki、翻譯一個段落、把摘錄儲存到任何地方。
        </li>
        <li>
          <strong>頂欄按鈕</strong>
          ——閱讀器或書架頂欄上的圖示按鈕，點按後開啟一個彈出層，或（在書架上）開啟一個完整頁面。
        </li>
        <li>
          <strong>命令</strong>
          ——命令面板中的條目。每個外掛動作都會自動出現在那裡；顯式命令用來補充沒有按鈕的動作。
        </li>
        <li>
          <strong>助理工具</strong>
          ——閱讀助理在對話中可以呼叫的函數。這是上限最高的掛載點：外掛可以讓助理查詢你的
          Anki 牌組、你的 RSS 積壓，或你使用的任何服務。
        </li>
        <li>
          <strong>內容供應商</strong>——章節由外掛按需提供的虛擬書籍。一個
          RSS
          訂閱源可以躺在你的書架上，像任何一本書那樣被閱讀、標註和討論。
        </li>
        <li>
          <strong>朗讀聲音</strong>——為閱讀頁朗讀接入 TTS
          引擎。外掛負責合成音訊，應用程式負責播放，單句失敗時退回系統語音。
        </li>
        <li>
          <strong>設定與排程任務</strong>——宣告式設定會成為外掛在「設定」裡的專屬分類（含
          API 金鑰，加密儲存）；宣告的週期任務會在應用程式開啟期間定時執行。
        </li>
      </ul>

      <h2>原生外觀，是構造出來的</h2>
      <p>
        外掛從不渲染自己的
        HTML。它們用一小套詞彙宣告檢視——markdown、清單、表單和少量結構化區塊——由應用程式用自己的元件渲染出來。外掛作者放棄對像素的控制，換來的是零設計工作量，以及一個永遠保持一致的應用程式。
      </p>

      <h2>信任模型</h2>
      <p>
        外掛執行在應用程式內部，與應用程式共享同一個 JavaScript
        上下文——與 Obsidian
        相同，而不同於瀏覽器擴充功能的沙箱。有兩層務實的保護：
      </p>
      <ul>
        <li>
          <strong>權限</strong>——外掛的 manifest
          宣告它要使用什麼（網路、閱讀資料、AI、剪貼簿……），API
          只暴露已宣告的部分。這防範的是無意的越界。
        </li>
        <li>
          <strong>安裝本身就是那次信任決定。</strong>
          在任何檔案被複製或執行之前，應用程式會用平實的語言逐條展示外掛申請的權限，並等待你的同意。請像安裝軟體一樣對待外掛的安裝。
        </li>
      </ul>
      <p>
        應用程式自身的架構也限定了影響範圍：外掛儲存被命名空間隔離在應用程式的資料目錄內，桌面外殼不授予任意的檔案系統存取。
      </p>

      <h2>安裝外掛</h2>
      <ul>
        <li>
          <strong>外掛市集</strong>——「設定 → 外掛 →
          外掛市集」列出來自公開
          <a
            href={MARKETPLACE_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            外掛儲存庫
          </a>
          的社群外掛；安裝只需一次點按，並會先展示權限摘要。
        </li>
        <li>
          <strong>從資料夾安裝</strong>——「設定 →
          外掛」可以安裝任何本機外掛資料夾。這就是開發循環：把它指向你的工作目錄，改動後重新安裝即可。
        </li>
      </ul>

      <h2>版面由你掌控</h2>
      <p>
        外掛貢獻能力；按鈕放在哪裡由你決定。「設定 →
        自訂」可以編排每個介面（書架頂欄、閱讀器頂欄、選取選單）：在顯示區與更多選單之間拖曳條目、調整順序，或恢復預設。新的外掛動作會安靜地落在更多選單裡，而一切始終可以從命令面板觸達。
      </p>

      <h2 id="read-aloud-tts">用任意 TTS 聲音朗讀</h2>
      <p>
        內建的 <strong>TTS Voices</strong> 外掛把朗讀接到你選擇的引擎上——
        ElevenLabs、Fish Audio、OpenAI，或任何 OpenAI 相容端點（Kokoro、
        LocalAI、Edge TTS 橋接……）。一切都在<strong>設定 → TTS Voices</strong>
        裡完成：選定供應商，它的欄位隨之出現——API
        金鑰直接寫入加密的金鑰儲存；供應商能列舉聲音時，聲音欄位就是一個下拉清單（列不出來時也隨時可以手動輸入名稱）。
      </p>
      <p>
        一個流行的免費方案是透過{" "}
        <a
          href="https://github.com/travisvn/openai-edge-tts"
          target="_blank"
          rel="noopener noreferrer"
        >
          openai-edge-tts
        </a>{" "}
        使用微軟 Edge 的類神經網路語音——它是一個說 OpenAI 音訊 API 的本機小服務：
      </p>
      <ol>
        <li>
          在本機跑起服務——例如{" "}
          <code>docker run -d -p 5050:5050 travisvn/openai-edge-tts</code>
          （預設無需 API 金鑰）。
        </li>
        <li>
          在「設定 → TTS Voices」裡，把供應商設為
          <em>自訂 / 本機（OpenAI 相容）</em>，端點填{" "}
          <code>http://127.0.0.1:5050/v1/audio/speech</code>。
        </li>
        <li>
          從清單裡挑一個聲音——應用程式會讀取伺服器端目錄，完整的 Edge 音色（如{" "}
          <code>zh-CN-XiaoxiaoNeural</code>、<code>en-US-AriaNeural</code>
          ）會和 OpenAI 風格的別名一起出現。
        </li>
      </ol>
      <p>
        然後開啟一本書開始朗讀：句子經由你選的聲音播出，目前句播放時下一句已在預先擷取；某一句合成失敗會退回系統語音，朗讀不會中斷。
      </p>

      <h2>自己寫一個</h2>
      <p>
        外掛就是一個包含 <code>manifest.json</code> 和單個 <code>main.js</code>{" "}
        的資料夾。<Link to="/zh-hant/docs/plugins/api">API 參考</Link>
        覆蓋了完整的契約，
        <Link to="/zh-hant/docs/plugins/publishing">發佈上架</Link>
        介紹如何把它發到外掛市集。
      </p>
    </article>
  );
}
