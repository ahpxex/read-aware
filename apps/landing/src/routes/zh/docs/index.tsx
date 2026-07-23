import { Link, createFileRoute } from "@tanstack/react-router";
import { REPO_URL } from "../../../lib/releases";
import { DISCORD_URL } from "../../../lib/site";

export const Route = createFileRoute("/zh/docs/")({
  head: () => ({
    meta: [
      { title: "文档 — ReadAware" },
      {
        name: "description",
        content:
          "如何安装 ReadAware、开始阅读，以及用插件扩展这款应用。",
      },
    ],
  }),
  component: DocsOverview,
});

function DocsOverview() {
  return (
    <article className="doc-prose">
      <h1>文档</h1>
      <p className="lead">
        ReadAware 是一款 AI 原生阅读应用：用同一个阅读器打开 EPUB、MOBI、AZW3、FB2
        和 PDF，并在你的书籍、高亮与对话之间持续构建记忆。它免费、本地优先，使用你自己的
        AI 密钥。
      </p>

      <h2>从这里开始</h2>
      <ul>
        <li>
          <Link to="/zh/docs/install">下载安装</Link>——macOS、Windows、Linux 和
          Android 的安装包，以及当操作系统提示应用未签名时该怎么办。
        </li>
        <li>
          <Link to="/zh/docs/getting-started">快速上手</Link>
          ——导入书籍、阅读与标注、连接 AI 提供方，并了解你的数据存放在哪里。
        </li>
      </ul>

      <h2>扩展应用</h2>
      <ul>
        <li>
          <Link to="/zh/docs/plugins">插件系统</Link>
          ——插件能做什么，以及信任模型如何运作。
        </li>
        <li>
          <Link to="/zh/docs/plugins/api">API 参考</Link>
          ——完整的插件编写契约：manifest、生命周期、权限、贡献点与视图。
        </li>
        <li>
          <Link to="/zh/docs/plugins/publishing">发布上架</Link>
          ——如何把你的插件上架到应用内的插件市场。
        </li>
      </ul>

      <h2>更多去处</h2>
      <p>
        这款应用在{" "}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>{" "}
        上公开开发。有疑问、想报告 bug，或想展示你做出的东西，欢迎加入{" "}
        <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
          Discord
        </a>{" "}
        或提交 issue。
      </p>
    </article>
  );
}
