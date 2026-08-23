import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/zh/docs/plugins/")({
  head: () => ({
    meta: [
      { title: "插件系统 — ReadAware 文档" },
      {
        name: "description",
        content:
          "ReadAware 插件如何扩展产品领域、贡献新能力、使用宿主服务，并处于明确的信任边界内。",
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
        ReadAware 插件可以处理阅读数据、添加原生动作和提供方、扩展阅读助手，并向宿主请求受限服务。已安装的软件包会动态加载；应用无需为每个插件 ID 单独添加开关。
      </p>

      <h2>一个模型，三类能力</h2>
      <p>每个可执行的插件能力都属于以下三种形态之一。选择正确的形态，是编写插件时的第一项决策。</p>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>类别</th><th>适用场景</th><th>示例</th></tr></thead>
          <tbody>
            <tr><td><strong>领域</strong></td><td>ReadAware 已经拥有该状态或行为。</td><td>书库、阅读、标注、对话、设置</td></tr>
            <tr><td><strong>贡献</strong></td><td>插件提供新的选择或实现。</td><td>动作、命令、声音、内容、主题、助手提供方</td></tr>
            <tr><td><strong>服务</strong></td><td>宿主必须执行受限的外部操作。</td><td>存储、密钥、定时任务、网络、LLM、剪贴板</td></tr>
          </tbody>
        </table>
      </div>
      <p>声明式视图、设置和主题 schema 与这些类别并列。它们描述由宿主渲染的数据，并不会授予另一种授权来源。</p>

      <h2>设置属于一个领域</h2>
      <p>外观是设置中的一个分区，而不是单独的插件 API。改变所选主题的插件请求的是诸如 <code>appearance.theme</code> 的精确设置路径。提供新主题的插件使用 <code>themes</code> 贡献。选择和提供是刻意分开的权限。</p>

      <h2>插件可以添加什么</h2>
      <ul>
        <li>选区动作和顶栏动作、命令面板命令，以及由宿主渲染的视图。</li>
        <li>声音、虚拟书内容提供方、阅读模式、主题和字体。</li>
        <li>助手工具、每轮上下文、可搜索的私有来源，以及记忆候选。</li>
        <li>插件设置、动态选项、周期性工作、存储和加密密钥。</li>
        <li>在获授权的产品领域中读取数据、执行命令并订阅已提交的事件。</li>
      </ul>
      <p>在<Link to="/zh/docs/plugins/capabilities">能力浏览器</Link>中查看完整的版本化清单。它也会预览 <code>manifest.json</code> 所请求的权限。</p>

      <h2>原生 UI，源于构造</h2>
      <p>插件不会挂载 React、HTML、CSS、iframe 或任意 DOM。它们返回经过校验的视图数据和回调；ReadAware 负责布局、导航、无障碍、主题兼容性、加载状态和清理。新的视觉自由度只能通过受限 schema 或真正的宿主贡献点加入，而不是通过通用 webview 逃生口。</p>

      <h2>信任边界</h2>
      <p>每个插件都运行在自己的模块 Worker 中。它没有 DOM、Tauri、SQLite、文件系统或进程句柄，环境网络和浏览器持久化 API 也已禁用。宿主调用跨越消息边界，并根据插件的 actor 作用域能力视图解析。</p>
      <p>这会限制意外越权和直接越权，但安装仍然是软件信任决策。在代码运行前，ReadAware 会展示语义权限和精确的设置授权。能力要求会单独检查：权限回答“它可以做这件事吗？”，版本要求回答“它能正确使用这份契约吗？”</p>

      <h2>激活和更新都是事务性的</h2>
      <p><code>activate()</code> 是读取并声明的阶段。在宿主排空调用并完成 Worker 健康检查之前，注册内容都不可见；写入、密钥、网络、LLM、剪贴板、UI 效果和导航都会被阻止。持久数据变化稍后通过仅限存储的 <code>migrate()</code> 执行。只有健康且完成迁移的候选版本才会晋升。</p>
      <p>更新会对文件、插件 KV、文档集合和已提交的 schema 元数据做快照。激活或迁移失败时，会恢复之前的文件和数据，并在需要时重新启动之前的运行时。</p>

      <h2>当前生态</h2>
      <p>当前发布的插件都是内置的官方插件：Dictionary、Editorial Themes、RSS Reader、Sentence Reader、TTS Voices 和 Theme Schedule。公开的{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">readaware-plugins 仓库</a>{" "}
        包含编写模板、公开声明、校验和市场注册表。没有需要保留的旧版第三方 API；当前契约就是基线。
      </p>

      <h2>开始构建</h2>
      <p>按照<Link to="/zh/docs/plugins/develop">构建插件</Link>完成本地循环，实现时参考<Link to="/zh/docs/plugins/api">API 参考</Link>，提交市场变更前阅读<Link to="/zh/docs/plugins/publishing">发布插件</Link>。</p>
    </article>
  );
}
