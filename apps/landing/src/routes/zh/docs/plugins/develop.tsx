import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/zh/docs/plugins/develop")({
  head: () => ({
    meta: [
      { title: "构建插件 — ReadAware 文档" },
      { name: "description", content: "使用公开的 TypeScript 模板创建、校验、安装、迁移并测试 ReadAware 插件。" },
    ],
  }),
  component: DevelopPluginPage,
});

function DevelopPluginPage() {
  return (
    <article className="doc-prose">
      <h1>构建插件</h1>
      <p className="lead">从公开的 TypeScript 模板开始，声明最小的能力集合，并在 ReadAware 桌面应用中运行构建后的软件包。宿主负责生命周期、权限、展示和回滚；插件负责自己的行为和私有数据。</p>
      <h2>前置条件</h2>
      <ul>
        <li>ReadAware 桌面应用，并能访问“设置 → 插件”。</li>
        <li><a href="https://bun.sh" target="_blank" rel="noopener noreferrer">Bun</a>，用于运行仓库脚本。</li>
        <li><a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">readaware-plugins 仓库</a>的检出版本或 fork。</li>
      </ul>
      <h2>创建软件包</h2>
      <ol>
        <li>将 <code>template/</code> 复制到 <code>plugins/&lt;your-plugin-id&gt;/</code>。</li>
        <li>保持文件夹名、manifest 的 <code>id</code> 和运行时命名空间完全一致。</li>
        <li>编辑 <code>manifest.json</code> 和 <code>src/main.ts</code>。</li>
        <li>删除不使用的模板贡献，并移除对应权限。</li>
        <li>构建 ReadAware 将要加载的自包含 <code>main.js</code>。</li>
      </ol>
      <pre><code>{"bun run build\nbun run typecheck\nbun test\nbun run validate"}</code></pre>
      <h2>先设计 manifest，再实现</h2>
      <p>按以下顺序检查 manifest：</p>
      <ol>
        <li><strong>身份</strong>：稳定 ID、名称、软件包版本、作者和最低应用版本。</li>
        <li><strong>数据</strong>：正整数 <code>schemaVersion</code> 和迁移路径。</li>
        <li><strong>兼容性</strong>：为每个使用的 API 和 schema 在 <code>requires</code> 中写入 semver 范围。</li>
        <li><strong>授权</strong>：语义 <code>permissions</code> 和精确的 <code>settingsAccess</code> 授权。</li>
        <li><strong>声明</strong>：设置、定时任务、主题、字体和入口模块。</li>
      </ol>
      <p>安装前使用<Link to="/zh/docs/plugins/capabilities">能力浏览器和权限预览</Link>。要求是兼容性声明，不是用户授权；即使能力不需要权限，只要插件依赖其契约，也必须写入 <code>requires</code>。</p>
      <h2>选择正确的能力</h2>
      <ol>
        <li>ReadAware 拥有某种状态或行为时，使用<strong>领域</strong>。</li>
        <li>提供选择、动作或提供方时，使用<strong>贡献</strong>。</li>
        <li>需要受限的宿主操作时，使用<strong>服务</strong>。</li>
        <li>插件存储只用于插件拥有的数据。</li>
        <li>现有形态都不合适时，请求新的类型化宿主能力。</li>
      </ol>
      <p>不要把书籍、进度、标注、设置或记忆复制到插件存储。影子状态会绕过产品不变量、已提交事件、投影重建、同步语义和助手上下文。</p>
      <h2>让激活保持声明式</h2>
      <p>在 <code>activate(ctx)</code> 期间检查环境，并注册动作、命令、提供方、订阅和定时任务。不要执行业务写入或外部工作。宿主会一直暂存每项注册，直到激活 RPC 完成且 Worker 回复健康检查。</p>
      <p>晋升后，从已注册的处理器启动运行时工作。如果处理器返回 promise，让宿主展示加载和失败状态。只有在可选的 <code>deactivate()</code> 必须关闭外部资源时，才保留这些资源的引用；宿主注册和订阅会自动释放。</p>
      <h2>明确给私有数据做版本控制</h2>
      <p><code>schemaVersion</code> 为插件 KV 和文档集合版本控制；它独立于软件包版本。只有私有数据形态改变时才修改它。在 schema 提交后，为每个支持的升级和降级导出 <code>migrate(storageCtx, change)</code>。</p>
      <ul>
        <li>迁移只能接收存储：不能使用领域、设置、密钥、网络、UI、LLM 或贡献。</li>
        <li>让每次转换都具备确定性和幂等性。</li>
        <li>测试部分写入后发生失败的情况；宿主必须精确恢复 KV、文档、文件和 schema 元数据。</li>
        <li>不要用软件包版本检查替代数据 schema。</li>
      </ul>
      <h2>安装工作文件夹</h2>
      <ol>
        <li>运行构建和检查。</li>
        <li>打开 ReadAware → 设置 → 插件 → 安装插件。</li>
        <li>选择构建出的插件文件夹并检查同意摘要。</li>
        <li>在桌面应用中运行真实功能。</li>
        <li>重新构建并安装，以测试更新。</li>
      </ol>
      <p>普通浏览器无法验证插件安装、Worker IPC、SQLite 持久化、原始书籍访问、阅读器集成或回滚。请测试用于发布的 Tauri 应用。</p>
      <h2>测试生命周期，而不只是成功路径</h2>
      <ul>
        <li>全新安装、启用、停用，以及不重启应用再次启用。</li>
        <li>使用真实数据完成成功更新和降级。</li>
        <li>激活超时、处理器拒绝、迁移失败和精确回滚。</li>
        <li>卸载清理：不残留动作、监听器、定时任务、提供方或 Worker。</li>
        <li>更新期间移除权限和扩展权限。</li>
        <li>长标签、空状态、键盘导航和所有宿主主题。</li>
      </ul>
      <h2>了解当前限制</h2>
      <p>ReadAware 打开期间，定时任务至少按声明的频率运行，过期时会在启动时补跑。它们不是持久任务：应用关闭时不会执行，没有持久队列、重试/退避契约或崩溃恢复保证。</p>
      <p>UI 只在现有的类型化贡献点可用。缺少挂载位置时，需要宿主拥有的贡献点和消费者；不会为了走捷径添加任意 HTML 或通用原生 invoke API。</p>
      <h2>下一步</h2>
      <p>把<Link to="/zh/docs/plugins/api">API 参考</Link>放在编辑器旁边，然后在准备注册表 pull request 前阅读<Link to="/zh/docs/plugins/publishing">发布插件</Link>。</p>
    </article>
  );
}
