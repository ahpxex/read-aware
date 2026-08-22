import { Link, createFileRoute } from "@tanstack/react-router";
import { REPO_URL } from "../../../lib/releases";
import { DISCORD_URL } from "../../../lib/site";

export const Route = createFileRoute("/zh-hant/docs/")({
  head: () => ({
    meta: [
      { title: "文件 — ReadAware" },
      {
        name: "description",
        content:
          "如何安裝 ReadAware、開始閱讀，以及用外掛擴充這款應用程式。",
      },
    ],
  }),
  component: DocsOverview,
});

function DocsOverview() {
  return (
    <article className="doc-prose">
      <h1>文件</h1>
      <p className="lead">
        ReadAware 是一款 AI 原生閱讀應用程式：用同一個閱讀器開啟
        EPUB、MOBI、AZW3、FB2、CBZ、CBR、TXT、HTML 和 PDF，並在你的書籍、螢光標示與對話之間持續建構記憶。它免費、本地優先，使用你自己的
        AI 金鑰。
      </p>

      <h2>從這裡開始</h2>
      <ul>
        <li>
          <Link to="/zh-hant/docs/install">下載安裝</Link>——macOS、Windows、Linux 和
          Android 的安裝套件，以及當作業系統提示應用程式未簽署時該怎麼辦。
        </li>
        <li>
          <Link to="/zh-hant/docs/getting-started">快速上手</Link>
          ——匯入書籍、閱讀與標註、連接 AI 供應商，並了解你的資料存放在哪裡。
        </li>
      </ul>

      <h2>擴充應用程式</h2>
      <ul>
        <li>
          <Link to="/zh-hant/docs/plugins">外掛系統</Link>
          ——外掛能做什麼，以及信任模型如何運作。
        </li>
        <li>
          <Link to="/zh-hant/docs/plugins/api">API 參考</Link>
          ——完整的外掛編寫契約：manifest、生命週期、權限、貢獻點與檢視。
        </li>
        <li>
          <Link to="/zh-hant/docs/plugins/publishing">發佈上架</Link>
          ——如何把你的外掛上架到應用程式內的外掛市集。
        </li>
      </ul>

      <h2>更多去處</h2>
      <p>
        這款應用程式在{" "}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>{" "}
        上公開開發。有疑問、想回報 bug，或想展示你做出的東西，歡迎加入{" "}
        <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
          Discord
        </a>{" "}
        或提交 issue。
      </p>
    </article>
  );
}
