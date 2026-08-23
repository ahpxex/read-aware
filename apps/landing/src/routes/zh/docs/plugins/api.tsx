import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/zh/docs/plugins/api")({
  head: () => ({
    meta: [
      { title: "插件 API 参考 — ReadAware 文档" },
      {
        name: "description",
        content:
          "当前 ReadAware 插件契约：manifest、能力、领域、贡献、服务、声明式 UI、生命周期和迁移。",
      },
    ],
  }),
  component: PluginApiPage,
});

function PluginApiPage() {
  return (
    <article className="doc-prose">
      <h1>插件 API 参考</h1>
      <p className="lead">
        插件是一个包含 <code>manifest.json</code>和已构建 ES 模块的文件夹。完整的公开 TypeScript 契约以{" "}
        <code>types/plugin-api.d.ts</code> in the{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          readaware-plugins 仓库
        </a>发布。本页说明各部分如何配合。
      </p>

      <h2>软件包结构</h2>
      <pre><code>{`my-plugin/
  manifest.json
  main.js
  src/main.ts       # 推荐提交以供审核
  assets/           # 可选，市场安装时需明确列出`}</code></pre>
      <p>
        <code>main.js</code> 默认导出一个生命周期对象。ReadAware 在专用模块 Worker 中运行它，并向<code>activate</code>提供 actor 作用域的上下文。
      </p>
      <pre><code>{`export default {
  activate(ctx) {
    // 检查并注册。此阶段会阻止副作用。
  },
  migrate(storageCtx, change) {
    // 可选：转换插件私有 KV 和文档。
  },
  deactivate() {
    // 可选：释放插件自己的外部资源。
  },
};`}</code></pre>

      <h2>Manifest 清单</h2>
      <pre><code>{`{
  "id": "theme-schedule",
  "name": "主题计划",
  "version": "0.1.0",
  "schemaVersion": 1,
  "minAppVersion": "0.3.0",
  "requires": {
    "domains": { "settings": "^1.0.0" },
    "contributions": {
      "commands": "^1.0.0",
      "settingsOptions": "^1.0.0"
    },
    "services": {
      "storage": "^1.0.0",
      "schedules": "^1.0.0",
      "ui": "^1.0.0"
    },
    "schemas": { "settings": "^1.0.0" }
  },
  "settingsAccess": {
    "discover": ["appearance.theme", "reading.theme"],
    "write": ["appearance.theme", "reading.theme"]
  },
  "main": "main.js"
}`}</code></pre>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>字段</th><th>契约</th></tr></thead>
          <tbody>
            <tr><td><code>id</code></td><td>小写字母、数字和连字符，最长 64 个字符。它是永久命名空间，且必须与文件夹名一致。</td></tr>
            <tr><td><code>name</code>, <code>version</code></td><td>面向用户的名称和软件包版本。</td></tr>
            <tr><td><code>schemaVersion</code></td><td>插件私有 KV 和文档数据所需的正整数。独立于软件包版本。</td></tr>
            <tr><td><code>requires</code></td><td>按领域、贡献、服务和 schema 分组的能力 ID 到 semver 范围的必填映射。</td></tr>
            <tr><td><code>permissions</code></td><td>可选的语义授权请求，需经用户同意。未知值会导致校验失败。</td></tr>
            <tr><td><code>settingsAccess</code></td><td>可选的 discover/read/write 授权，用于精确设置路径或明确的 <code>section.*</code> 分组。</td></tr>
            <tr><td><code>minAppVersion</code></td><td>可选的最低应用版本。软件包依赖新发布能力时使用。</td></tr>
            <tr><td><code>settings</code></td><td>可选的由宿主渲染的插件设置字段。</td></tr>
            <tr><td><code>schedules</code></td><td>可选的周期任务，在绑定处理器前声明。</td></tr>
            <tr><td><code>themes</code>, <code>fonts</code></td><td>可选的声明式主题和字体贡献；需要 <code>ui:themes</code>.</td></tr>
            <tr><td><code>main</code></td><td>相对于文件夹的入口模块；默认为 <code>main.js</code>.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        使用<Link to="/zh/docs/plugins/capabilities">能力浏览器</Link>{" "}
        查看完整清单和权限词汇。要求始终是兼容性声明，绝不会授予权限。
      </p>

      <h2>运行时上下文</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>命名空间</th><th>包含</th></tr></thead>
          <tbody>
            <tr><td><code>ctx.manifest</code></td><td>经过校验的只读 manifest。</td></tr>
            <tr><td><code>ctx.appVersion</code>, <code>ctx.locale</code></td><td>宿主版本和当前 UI 区域设置。</td></tr>
            <tr><td><code>ctx.lifecycle.phase</code></td><td><code>activating</code>, <code>migrating</code>, 或 <code>active</code>.</td></tr>
            <tr><td><code>ctx.capabilities</code></td><td>仅对此插件 actor 可见的能力版本。</td></tr>
            <tr><td><code>ctx.domains</code></td><td>已授予的 ReadAware 状态和行为。</td></tr>
            <tr><td><code>ctx.contributions</code></td><td>插件可以向其中提供实现的注册表。</td></tr>
            <tr><td><code>ctx.services</code></td><td>受限的宿主操作和插件私有基础设施。</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        未获授权时，受权限控制的命名空间不会出现。每次 Worker 调用也会在宿主侧授权；隐藏方法不是唯一检查。注册会返回可释放对象，激活失败或插件停用时按相反顺序回收。
      </p>

      <h2>领域</h2>
      <p>
        领域公开 <code>queries</code>，可选 <code>commands</code>，以及已提交的 <code>events.subscribe</code>。命令使用与 ReadAware 相同的事件溯源写入路径，并归属于{" "}
        <code>plugin:&lt;id&gt;</code>. 写入权限包含读取权限。
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>领域</th><th>查询和命令</th><th>权限</th></tr></thead>
          <tbody>
            <tr>
              <td><code>library</code></td>
              <td>书籍、元数据、原始章节文本、目录、集合；导入、编辑、加星、移除、虚拟书籍和集合命令。</td>
              <td><code>library:read</code> / <code>library:write</code></td>
            </tr>
            <tr>
              <td><code>reading</code></td>
              <td>按书籍和汇总的阅读统计；标记完成、打开书籍并导航到 CFI 或 href。</td>
              <td><code>reading:read</code> / <code>reading:write</code></td>
            </tr>
            <tr>
              <td><code>annotations</code></td>
              <td>筛选高亮、笔记和被动提问轨迹；创建、编辑、重新着色并移除高亮或笔记。</td>
              <td><code>annotations:read</code> / <code>annotations:write</code></td>
            </tr>
            <tr>
              <td><code>conversations</code></td>
              <td>读取书籍线程、列出全局线程并读取线程。写入仍由聊天运行时负责。</td>
              <td><code>conversations:read</code></td>
            </tr>
            <tr>
              <td><code>settings</code></td>
              <td>发现获准的目录条目、读取解析后的值、更新受支持的目标并订阅已提交的变更。</td>
              <td>精确 <code>settingsAccess</code> grants</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        没有 <code>shelf</code> 或 <code>appearance</code> 领域。
        书库数据和当前阅读行为彼此分离。外观是设置中的一个分区。
      </p>

      <h3>设置访问</h3>
      <p>
        <code>discover</code>、<code>read</code> 和 <code>write</code>彼此独立。尽可能授予精确路径；仅在功能确实需要整个分区时，才使用例如 <code>appearance.*</code>。更新会经过目录校验、目标策略、持久化和提交后效果。
      </p>
      <pre><code>{`const entries = await ctx.domains.settings.queries.discover({
  section: "appearance",
});

await ctx.domains.settings.commands.update([
  {
    path: "appearance.theme",
    value: "dark",
    target: { kind: "global" },
  },
]);`}</code></pre>

      <h2>贡献</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>注册表</th><th>插件提供</th><th>权限</th></tr></thead>
          <tbody>
            <tr><td><code>selectionActions</code></td><td>选区动作及返回提示或宿主渲染视图的处理器。</td><td>无</td></tr>
            <tr><td><code>headerActions</code></td><td>阅读器或书库动作、位置元数据和视图回调。</td><td>无</td></tr>
            <tr><td><code>commands</code></td><td>命令元数据和处理器。</td><td>无</td></tr>
            <tr><td><code>settingsOptions</code></td><td>一个已声明插件字段的动态选项。</td><td>无</td></tr>
            <tr><td><code>voiceProviders</code></td><td>声音列表和编码音频合成。</td><td>无</td></tr>
            <tr><td><code>contentProviders</code></td><td>虚拟书籍键的章节。</td><td>无</td></tr>
            <tr><td><code>readerModes</code></td><td>受限阅读器分段模式；目前仅限内置插件。</td><td><code>reader:modes</code></td></tr>
            <tr><td><code>agentTools</code></td><td>工具 schema、用户可读标签、描述和执行器。</td><td><code>agent:tools</code></td></tr>
            <tr><td><code>agentContextProviders</code></td><td>受限的当前轮次参考区块。</td><td><code>agent:context</code></td></tr>
            <tr><td><code>agentRetrievalProviders</code></td><td>来自插件数据的搜索结果。</td><td><code>agent:retrieval</code></td></tr>
            <tr><td><code>memoryCandidateProviders</code></td><td>可能持久化的事实、偏好、洞察或摘要。</td><td><code>agent:memory</code></td></tr>
            <tr><td><code>themes</code>, <code>fonts</code></td><td>manifest 声明的语义主题和字体数据。</td><td><code>ui:themes</code></td></tr>
          </tbody>
        </table>
      </div>
      <p>
        每个贡献 ID 都按插件划分命名空间，每次注册都有归属且可检查，过期的可释放对象不能移除较新的替代项。新的贡献类型仍需宿主有意提供消费者；之后任何兼容插件都能注册，无需在应用中逐一列出。
      </p>

      <h3>助手扩展边界</h3>
      <ul>
        <li><strong>上下文提供方</strong>运行一轮。宿主添加来源、限制大小，并将输出序列化为不可信参考数据。</li>
        <li><strong>检索提供方</strong>成为命名空间工具，带有宿主拥有的 <code>query</code>/<code>limit</code> schema 和裁剪后的结果。</li>
        <li><strong>记忆候选提供方</strong>在一轮之后提出受限候选；宿主校验范围、去重并执行任何持久写入。</li>
      </ul>
      <p>
        插件永远不会收到 Memory 端口，不能注入系统规则，也不能直接写入长期记忆。
      </p>

      <h2>宿主服务</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>服务</th><th>契约</th><th>权限</th></tr></thead>
          <tbody>
            <tr><td><code>storage</code></td><td>命名空间 KV、文档集合和外部变更通知。</td><td>无</td></tr>
            <tr><td><code>secrets</code></td><td>命名空间加密凭据槽。</td><td>无</td></tr>
            <tr><td><code>ui</code></td><td>宿主提示和保存/导出流程。</td><td>无</td></tr>
            <tr><td><code>schedules</code></td><td>将处理器绑定到 manifest 声明的频率。</td><td>无</td></tr>
            <tr><td><code>session</code></td><td>订阅受限的阅读会话事实。</td><td>无</td></tr>
            <tr><td><code>network</code></td><td>宿主中介的 HTTP。</td><td><code>service:network</code></td></tr>
            <tr><td><code>llm</code></td><td>使用用户配置进行一次性文本或 JSON schema 约束的模型调用。</td><td><code>service:llm</code></td></tr>
            <tr><td><code>clipboard</code></td><td>向系统剪贴板写入文本。</td><td><code>service:clipboard</code></td></tr>
          </tbody>
        </table>
      </div>

      <h3>存储</h3>
      <p>
        使用 KV 存储小型设置和检查点。使用命名文档集合保存具有稳定 ID 且可选包含{" "}
        <code>bookId</code>/<code>anchor</code>来源信息的插件记录。来源信息是索引而非所有权；引用书籍被删除后文档仍可保留。卸载会清空文档集合，但保留 KV、密钥槽和已提交的 schema 元数据，以便重新安装和迁移。
      </p>

      <h3>定时任务</h3>
      <p>
        manifest 声明 <code>{`{ id, label, everyMinutes }`}</code>，激活通过
        <code>ctx.services.schedules.bind</code>绑定处理器。最短频率为 15
        分钟。应用打开时至少按此频率运行，逾期会在启动后补跑，任务不会重叠。这不是持久后台任务，也不保证精确时间。
      </p>

      <h2>声明式 UI 和设置</h2>
      <p>
        插件返回版本化的视图数据，而不是可执行 UI。视图语法包括 markdown、可搜索列表、表单、详情布局、词典结果和受限区块树。处理器可以保留界面、显示提示、打开或替换视图、重置导航、关闭界面或返回字段错误。宿主负责 promise 的加载和失败状态。
      </p>
      <p>
        Manifest 设置使用宿主控件支持文本、文本域、数字、时间、选择、选项、复选框、开关和密钥字段。条件字段使用 <code>visibleWhen</code>；动态选择使用已注册的 <code>settingsOptions</code> 提供方。密钥字段直接写入加密密钥槽，永远不会进入普通设置对象或助手可见目录。
      </p>

      <h2>主题和字体</h2>
      <p>
        主题插件在 manifest 中声明语义数据。应用主题覆盖固定的宿主令牌词汇；阅读器主题提供所需的六色页面调色板和可选排版默认值。宿主校验值、生成 CSS、加载获批准的本地字体文件，并在用户选择前不应用任何内容。
      </p>
      <p>
        提供选项需要 <code>ui:themes</code>。选择主题需要精确的设置写入授权，例如 <code>appearance.theme</code> 或{" "}
        <code>reading.theme</code>。二者并不相互推导。
      </p>

      <h2>生命周期阶段</h2>
      <ol>
        <li><strong>激活中：</strong> 可使用查询和插件私有读取；注册会暂存；副作用被阻止。</li>
        <li><strong>迁移中：</strong> 只能使用插件 KV 和文档集合。</li>
        <li><strong>已激活：</strong> 已晋升的处理器可以使用获准的领域、贡献和服务。</li>
      </ol>
      <p>
        宿主会排空激活 RPC、检查 Worker 健康状态、运行数据迁移，然后在一个明确的时点晋升全部暂存项。激活失败会释放暂存工作，不替换当前运行时。
      </p>

      <h2>Worker 环境</h2>
      <p>
        没有 React、Jotai、DOM、WebView、Tauri、SQLite、文件系统或进程访问。环境中的 <code>fetch</code>、WebSocket、EventSource、XMLHttpRequest、BroadcastChannel、IndexedDB 和 Cache Storage 均已禁用。网络、持久化和所有宿主交互都必须使用类型化上下文。
      </p>

      <h2>兼容性和稳定性</h2>
      <p>
        领域、贡献、服务和声明式 schema 各自拥有独立的语义版本。未知 ID、无效 semver 范围、无法访问的必需能力和不兼容的宿主版本都会阻止激活。兼容的新增内容提升所属能力的版本，而不是一个全局插件 API 编号。
      </p>
      <p>
        当前生态是官方插件，因此当前由注册表支持的契约就是基线。不要依赖早期的 <code>shelf</code>,{" "}
        <code>appearance</code> 或注册表之前的形态。
      </p>
    </article>
  );
}
