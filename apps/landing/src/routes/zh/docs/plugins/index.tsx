import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/zh/docs/plugins/")({
  head: () => ({
    meta: [
      { title: "插件系统 — ReadAware 文档" },
      {
        name: "description",
        content:
          "ReadAware 插件能做什么、信任模型如何运作，以及如何安装插件。",
      },
    ],
  }),
  component: PluginsOverviewPage,
});

function PluginsOverviewPage() {
  return (
    <article className="doc-prose">
      <h1>插件系统</h1>
      <p className="lead">
        插件为 ReadAware
        带来新的动作、新的页面，以及——最重要的——供阅读助手使用的新工具。插件是一个小小的
        JavaScript
        模块；它的界面始终由应用自己的设计系统渲染，因此插件功能在观感上与原生无异。
      </p>

      <h2>插件可以贡献什么</h2>
      <ul>
        <li>
          <strong>选区动作</strong>——阅读器文本选择菜单中的条目。把一个单词发进
          Anki、翻译一个段落、把摘录保存到任何地方。
        </li>
        <li>
          <strong>顶栏按钮</strong>
          ——阅读器或书架顶栏上的图标按钮，点击后打开一个弹出层，或（在书架上）打开一个完整页面。
        </li>
        <li>
          <strong>命令</strong>
          ——命令面板中的条目。每个插件动作都会自动出现在那里；显式命令用来补充没有按钮的动作。
        </li>
        <li>
          <strong>助手工具</strong>
          ——阅读助手在对话中可以调用的函数。这是上限最高的挂载点：插件可以让助手查询你的
          Anki 牌组、你的 RSS 积压，或你使用的任何服务。
        </li>
        <li>
          <strong>内容提供方</strong>——章节由插件按需提供的虚拟书籍。一个 RSS
          订阅源可以躺在你的书架上，像任何一本书那样被阅读、标注和讨论。
        </li>
      </ul>

      <h2>原生外观，是构造出来的</h2>
      <p>
        插件从不渲染自己的
        HTML。它们用一小套词汇声明视图——markdown、列表、表单和少量结构化区块——由应用用自己的组件渲染出来。插件作者放弃对像素的控制，换来的是零设计工作量，以及一个永远保持一致的应用。
      </p>

      <h2>信任模型</h2>
      <p>
        插件运行在应用内部，与应用共享同一个 JavaScript 上下文——与 Obsidian
        相同，而不同于浏览器扩展的沙箱。有两层务实的保护：
      </p>
      <ul>
        <li>
          <strong>权限</strong>——插件的 manifest
          声明它要使用什么（网络、阅读数据、AI、剪贴板……），API
          只暴露已声明的部分。这防范的是无意的越界。
        </li>
        <li>
          <strong>安装本身就是那次信任决定。</strong>
          在任何文件被复制或执行之前，应用会用平实的语言逐条展示插件申请的权限，并等待你的同意。请像安装软件一样对待插件的安装。
        </li>
      </ul>
      <p>
        应用自身的架构也限定了影响范围：插件存储被命名空间隔离在应用的数据目录内，桌面外壳不授予任意的文件系统访问。
      </p>

      <h2>安装插件</h2>
      <ul>
        <li>
          <strong>插件市场</strong>——“设置 → 插件 →
          插件市场”列出来自公开
          <a
            href={MARKETPLACE_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            插件仓库
          </a>
          的社区插件；安装只需一次点击，并会先展示权限摘要。
        </li>
        <li>
          <strong>从文件夹安装</strong>——“设置 →
          插件”可以安装任何本地插件文件夹。这就是开发循环：把它指向你的工作目录，改动后重新安装即可。
        </li>
      </ul>

      <h2>布局由你掌控</h2>
      <p>
        插件贡献能力；按钮放在哪里由你决定。“设置 →
        自定义”可以编排每个界面（书架顶栏、阅读器顶栏、选区菜单）：在显示区与更多菜单之间拖动条目、调整顺序，或恢复默认。新的插件动作会安静地落在更多菜单里，而一切始终可以从命令面板触达。
      </p>

      <h2>自己写一个</h2>
      <p>
        插件就是一个包含 <code>manifest.json</code> 和单个 <code>main.js</code>{" "}
        的文件夹。<Link to="/zh/docs/plugins/api">API 参考</Link>
        覆盖了完整的契约，
        <Link to="/zh/docs/plugins/publishing">发布上架</Link>
        介绍如何把它发到插件市场。
      </p>
    </article>
  );
}
