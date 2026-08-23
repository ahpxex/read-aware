import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/zh/docs/plugins/publishing")({
  head: () => ({
    meta: [
      { title: "发布插件 — ReadAware 文档" },
      { name: "description", content: "准备、校验、审核并向公开市场仓库提交 ReadAware 插件。" },
    ],
  }),
  component: PublishingPage,
});

function PublishingPage() {
  return (
    <article className="doc-prose">
      <h1>发布插件</h1>
      <p className="lead">市场软件包存放在公开的 <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">readaware-plugins 仓库</a>中，并通过审核进入。当前目录由官方插件组成；这套流程也是未来接受外部提交时的契约。</p>
      <h2>准备可审核的软件包</h2>
      <p>推荐使用 TypeScript。让 <code>src/</code> 与构建出的自包含 <code>main.js</code> 并列，方便审核者比较源代码和产物。提交每一项运行时资源。不要加载远程代码，不要把行为藏在生成的 blob 中，也不要依赖软件包之外的文件。</p>
      <pre><code>{"plugins/my-plugin/\n  manifest.json\n  main.js\n  package.json\n  tsconfig.json\n  src/main.ts\n  assets/…"}</code></pre>
      <h2>运行仓库检查</h2>
      <pre><code>{"bun run build\nbun run typecheck\nbun test\nbun run validate"}</code></pre>
      <p>校验会检查注册表与 manifest 的一致性、ID、版本、能力要求、权限、声明文件和软件包形态。这些检查是必要条件而非充分条件：提交前还要在 ReadAware 桌面应用中运行构建出的文件夹。</p>
      <h2>提交</h2>
      <ol>
        <li>Fork 公开仓库。</li>
        <li>将模板复制到 <code>plugins/&lt;plugin-id&gt;/</code>，并保持文件夹名等于 manifest ID。</li>
        <li>加入软件包和所有必需的运行时资源。</li>
        <li>在 <code>registry.json</code> 中加入匹配且按 ID 排序的条目。</li>
        <li>运行根目录的四项检查，并从构建出的文件夹测试本地安装。</li>
        <li>发起 pull request，说明行为、私有数据、外部服务，以及每项权限和设置授权的理由。</li>
      </ol>
      <h2>审核清单</h2>
      <ul>
        <li>功能使用现有最窄的领域、贡献和服务能力。</li>
        <li><code>requires</code> 为每个使用的契约写出有依据的 semver 范围。</li>
        <li>权限和 <code>settingsAccess</code> 与实际运行时调用一致，不包含推测性的授权。</li>
        <li><code>activate()</code> 注册行为，但不执行任何业务或外部副作用。</li>
        <li>插件私有数据拥有稳定 schema，每次版本转换都有经过测试的迁移。</li>
        <li>用面向用户的语言说明网络端点、LLM 使用、凭据、定时任务和数据保留。</li>
        <li>宿主渲染的视图支持键盘导航、长文本、空数据以及浅色和深色主题。</li>
        <li>源代码可读、生成产物可复现，且不存在分析、跟踪、混淆或远程代码加载。</li>
      </ul>
      <p><Link to="/zh/docs/plugins/capabilities">权限预览</Link>适合作为提交前检查。仓库校验和人工审核仍是正式检查。</p>
      <h2>更新和数据迁移</h2>
      <p>同时提升 <code>manifest.json</code> 和 <code>registry.json</code> 中的软件包版本。只有私有 KV 或文档形态变化时才提升 <code>schemaVersion</code>，并在同一候选版本中提供相应的 <code>migrate()</code>。</p>
      <p>使用真实数据测试更新和有意降级。ReadAware 会暂存并健康检查候选版本、快照插件文件和数据、暂停旧运行时以迁移，并只在成功后晋升。更新失败必须让之前的软件包和数据仍可使用。</p>
      <h2>权限变化</h2>
      <p>把新增授权当作产品变更，而不是 manifest 杂务。说明原来的权限集合为何不足、哪些用户数据或外部操作变得可访问，以及用户拒绝时会发生什么。移除代码不再使用的权限。</p>
      <h2>当前的分发信任</h2>
      <p>Worker 隔离和能力强制执行会减少越权，但安装仍然是信任决策。在开放广泛的第三方市场前，ReadAware 仍需要发布者身份、确定性打包、签名和完整性校验、审核来源、撤销机制、权限差异审核和安全响应路径。</p>
      <p>这些控制上线前，合并的仓库条目只能是审核证据，并不能从数学上保证任意恶意代码安全。</p>
      <h2>发起 pull request 前</h2>
      <p>重新阅读<Link to="/zh/docs/plugins/develop">构建插件</Link>，在<Link to="/zh/docs/plugins/capabilities">能力工具</Link>中比较最终 manifest，并确认软件包遵循当前<Link to="/zh/docs/plugins/api">API 契约</Link>，而不是旧的 <code>shelf</code> 或 <code>appearance</code> 示例。</p>
    </article>
  );
}
