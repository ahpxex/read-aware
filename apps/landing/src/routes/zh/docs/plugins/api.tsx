import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/zh/docs/plugins/api")({
  head: () => ({
    meta: [
      { title: "API 参考 — ReadAware 文档" },
      {
        name: "description",
        content:
          "ReadAware 插件编写契约：manifest、生命周期、领域派生的权限、数据 API、贡献点、视图与事件。",
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
        插件是一个文件夹，里面有一份 <code>manifest.json</code> 和一个
        JavaScript 模块。本页就是编写契约；同一份契约以 TypeScript
        声明文件（<code>types/plugin-api.d.ts</code>）的形式随
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          插件市场仓库
        </a>
        一起发布，编辑器可以对下文的一切自动补全。
      </p>

      <h2>结构</h2>
      <pre>
        <code>{`my-plugin/
  manifest.json
  main.js        # 单个自包含的 ES module`}</code>
      </pre>
      <p>
        <code>main.js</code>{" "}
        默认导出一个生命周期对象。插件能触及的一切都来自传给{" "}
        <code>activate</code> 的上下文；每个 <code>register*</code> 与{" "}
        <code>on</code> 调用都返回一个
        disposable，插件被停用或卸载时由应用统一回收，因此{" "}
        <code>deactivate</code> 只需释放插件自己的外部资源。
      </p>
      <pre>
        <code>{`export default {
  activate(ctx) {
    // 通过 ctx 注册贡献点
  },
  deactivate() {
    // 可选：关闭套接字、清空队列
  },
};`}</code>
      </pre>
      <p>
        启用与停用立即生效——无需重启应用。愿意的话可以用 TypeScript
        编写（推荐；见<Link to="/zh/docs/plugins/publishing">发布上架</Link>）——应用加载的始终是构建出的{" "}
        <code>main.js</code>。
      </p>

      <h2>manifest.json</h2>
      <pre>
        <code>{`{
  "id": "anki-sync",
  "name": "Anki Sync",
  "version": "0.1.0",
  "minAppVersion": "0.3.0",
  "description": "Send looked-up words to Anki.",
  "author": "you",
  "permissions": ["service:network", "vocabulary:read"],
  "main": "main.js"
}`}</code>
      </pre>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>字段</th>
              <th>含义</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>id</code>
              </td>
              <td>
                小写字母、数字和连字符（最长
                64）。必须与文件夹名一致；作为插件存储与工具的命名空间。
              </td>
            </tr>
            <tr>
              <td>
                <code>name</code>、<code>version</code>
              </td>
              <td>显示在“设置 → 插件”和插件市场中。</td>
            </tr>
            <tr>
              <td>
                <code>minAppVersion</code>
              </td>
              <td>
                插件支持的最低应用版本。本契约要求 <code>0.3.0</code>{" "}
                或更新的版本。
              </td>
            </tr>
            <tr>
              <td>
                <code>permissions</code>
              </td>
              <td>
                插件使用的能力（见下表）。会在安装前展示给用户。
              </td>
            </tr>
            <tr>
              <td>
                <code>main</code>
              </td>
              <td>
                相对于插件文件夹的入口模块；默认为 <code>main.js</code>。
              </td>
            </tr>
            <tr>
              <td>
                <code>settings</code>
              </td>
              <td>
                可选的声明式设置表单（字段形态与表单视图相同）。应用会在插件面板中渲染它，并把所有值作为一个对象持久化在存储键{" "}
                <code>settings</code> 下。
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>领域模型</h2>
      <p>
        数据表面派生自应用的领域模型，而不是在它旁边另行编写。每个领域——{" "}
        <code>books</code>、<code>collections</code>、
        <code>annotations</code>、<code>reading</code>、
        <code>vocabulary</code>、<code>conversations</code>——都是{" "}
        <code>ctx</code> 上的一个命名空间，暴露三样东西：
      </p>
      <ul>
        <li>
          <strong>读取</strong>——该领域的读模型（应用自己的界面渲染的正是它们）；
        </li>
        <li>
          <strong>写入</strong>——<code>.write</code>{" "}
          下的命令，与该领域的事件动词严格一一对应，并走应用自己的事件溯源写入路径，在事件日志中标记为{" "}
          <code>plugin:&lt;id&gt;</code>
          ，因此每一次插件写入都可追溯；
        </li>
        <li>
          <strong>订阅</strong>——<code>.on(event, handler)</code>
          ，以规范名称（<code>book.starred</code>、
          <code>highlight.created</code>
          ……）订阅该领域的事件——与应用自身记录事实所用的是同一套词汇。
        </li>
      </ul>
      <p>
        权限遵循同样的形态：<code>&lt;domain&gt;:read</code> /{" "}
        <code>&lt;domain&gt;:write</code>，且在一个领域内，
        <strong>写权限蕴含读权限</strong>
        。设备本地状态（视图偏好、阅读器外观、同步内部数据）与自由渲染刻意不属于插件表面——UI
        一律经由下文的声明式视图。
      </p>

      <h2>权限</h2>
      <p>
        没有声明对应权限时，<code>ctx</code>{" "}
        上的能力组干脆不存在——在 API
        层面防范无意的越界。命名空间存储、UI
        贡献点、会话事件和阅读器导航不是权限；每个插件都拥有它们。
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>权限</th>
              <th>授予</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>books:read</code>
              </td>
              <td>
                <code>ctx.books</code>
                ——书架上的书、一本书的目录与章节文本。
              </td>
            </tr>
            <tr>
              <td>
                <code>books:write</code>
              </td>
              <td>
                <code>ctx.books.write</code>
                ——导入文件、编辑元数据、星标、移除；以及内容提供方与虚拟书籍。
              </td>
            </tr>
            <tr>
              <td>
                <code>collections:read</code> / <code>collections:write</code>
              </td>
              <td>
                <code>ctx.collections</code>
                ——书架上用户自定义的分组：列表与归属；创建、重命名、移除、为书籍指派分组。
              </td>
            </tr>
            <tr>
              <td>
                <code>annotations:read</code> / <code>annotations:write</code>
              </td>
              <td>
                <code>ctx.annotations</code>
                ——高亮、笔记与提问；创建、改色、编辑、删除高亮与笔记（提问由助手写入，只读）。
              </td>
            </tr>
            <tr>
              <td>
                <code>reading:read</code>
              </td>
              <td>
                <code>ctx.reading</code>
                ——阅读位置、阅读状态与阅读时长。设计上即只读：它的事件是阅读器活动被记录下来的事实，而非用户命令。
              </td>
            </tr>
            <tr>
              <td>
                <code>vocabulary:read</code> / <code>vocabulary:write</code>
              </td>
              <td>
                <code>ctx.vocabulary</code>
                ——阅读器词典保存词条所用的那个词汇表。
              </td>
            </tr>
            <tr>
              <td>
                <code>conversations:read</code>
              </td>
              <td>
                <code>ctx.conversations</code>
                ——每本书的 AI 线程与全局线程（只读）。
              </td>
            </tr>
            <tr>
              <td>
                <code>agent:tools</code>
              </td>
              <td>
                <code>ctx.agent.registerTool</code>——为阅读助手注册工具。
              </td>
            </tr>
            <tr>
              <td>
                <code>service:network</code>
              </td>
              <td>
                <code>ctx.network.fetch</code>——对外的 HTTP 请求。
              </td>
            </tr>
            <tr>
              <td>
                <code>service:llm</code>
              </td>
              <td>
                <code>ctx.llm.ask</code>
                ——使用用户配置的账号发起一次性模型调用。没有线程、没有记忆、没有工具。
              </td>
            </tr>
            <tr>
              <td>
                <code>service:dictionary</code>
              </td>
              <td>
                <code>ctx.dictionary.lookUp</code>
                ——应用的词典（与阅读器共享缓存；使用用户的 AI）。
              </td>
            </tr>
            <tr>
              <td>
                <code>service:clipboard</code>
              </td>
              <td>
                <code>ctx.clipboard.writeText</code>。
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>贡献点</h2>

      <h3>选区动作</h3>
      <p>
        阅读器选区菜单与标注菜单中的条目。处理函数会收到选中的文本、它的 CFI
        范围、所在章节和书籍。在阅读器内，一个动作要么静默执行（返回
        toast），要么打开对话框（返回视图）——只有这两种结果。
      </p>
      <pre>
        <code>{`ctx.ui.registerSelectionAction({
  id: "save-quote",
  title: "Save quote",
  icon: "quotes",
  run: (input) => {
    // input: { text, cfiRange, chapterHref, book, source }
    return { toast: "Quote saved." };
  },
});`}</code>
      </pre>

      <h3>顶栏动作</h3>
      <p>
        顶栏上的一个图标按钮。在阅读器界面，视图以锚定的弹出层打开；在书架上，则依{" "}
        <code>presentation</code>{" "}
        以弹出层或完整页面打开。阅读器永远不允许整页打断。
      </p>
      <pre>
        <code>{`ctx.ui.registerHeaderAction({
  id: "reading-report",
  title: "Reading report",
  icon: "chart-line-up",
  surface: "shelf",
  presentation: "page",
  view: async () => ({
    kind: "markdown",
    title: "This week",
    markdown: "You read **4h 12m** across 3 books.",
  }),
});`}</code>
      </pre>

      <h3>命令</h3>
      <p>
        命令面板中的一个条目。所有插件动作都会自动出现在面板里；显式命令用于那些没有按钮的动作。
      </p>
      <pre>
        <code>{`ctx.ui.registerCommand({
  id: "sync-now",
  title: "Anki Sync: sync now",
  run: async () => ({ toast: "Synced." }),
});`}</code>
      </pre>

      <h3>助手工具</h3>
      <p>
        阅读助手在对话中可以调用的工具（需要 <code>agent:tools</code>{" "}
        权限）。<code>parameters</code> 是描述参数对象的普通 JSON
        Schema；无参数的工具可以省略。工具在送达模型之前会被命名空间化为{" "}
        <code>plugin_&lt;pluginId&gt;_&lt;name&gt;</code>
        ，调用过程会以工具步骤的形式在对话中对用户可见。
      </p>
      <pre>
        <code>{`ctx.agent?.registerTool({
  name: "search_deck",
  label: "Searching your Anki deck",
  description: "Search the user's Anki collection for a term.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  execute: async ({ query }) => {
    const res = await ctx.network.fetch("http://127.0.0.1:8765", {
      method: "POST",
      body: JSON.stringify({ action: "findNotes", query }),
    });
    return res.json();
  },
});`}</code>
      </pre>

      <h2>视图</h2>
      <p>
        插件以声明的方式描述界面，由应用负责渲染。共四种：
      </p>
      <ul>
        <li>
          <code>markdown</code>——一个 markdown 字符串，由应用排版。
        </li>
        <li>
          <code>list</code>——条目为{" "}
          <code>{"{ id, title, subtitle?, icon?, onSelect? }"}</code>；
          <code>onSelect</code> 可以返回另一个视图，逐层深入。
        </li>
        <li>
          <code>form</code>——字段（text、textarea、number、select、toggle）加上{" "}
          <code>onSubmit</code>
          ；后者接收表单值，可返回结果视图或字段错误。
        </li>
        <li>
          <code>blocks</code>
          ——有序的区块序列：markdown、标题、词典词条、键值行、引文、动作按钮、分隔线，或内嵌的列表/表单。这是通往更丰富页面的成长路径。
        </li>
      </ul>
      <p>
        处理函数（<code>run</code>、<code>onSelect</code>、
        <code>onSubmit</code>）都返回同一种结果形态：
      </p>
      <ul>
        <li>
          什么都不返回——界面保持原样；
        </li>
        <li>
          <code>{"{ toast: \"…\" }"}</code>——一条短暂的提示；
        </li>
        <li>
          <code>{"{ view }"}</code>——打开界面，或在其上推入一层新视图；
        </li>
        <li>
          <code>{"{ close: true }"}</code>——关闭界面（可与{" "}
          <code>toast</code> 组合）；
        </li>
        <li>
          <code>{"{ fieldErrors }"}</code>
          ——来自表单提交：停留在表单上，并在字段下方显示错误。
        </li>
      </ul>
      <p>
        异步工作不值一提：返回一个
        promise，应用会显示加载状态。图标按名称从应用精选的 Phosphor
        集合中选取——不支持自定义 SVG。
      </p>

      <h2>领域数据</h2>
      <p>
        每个已授权的领域命名空间都提供读取、规范事件订阅，以及（拥有写权限时）命令。概览：
      </p>
      <ul>
        <li>
          <code>ctx.books</code>——<code>list()</code>、<code>get(id)</code>、
          <code>getToc(id)</code>、<code>getChapterText(id, index)</code>
          ；写入：<code>import</code>、<code>editMetadata</code>、
          <code>setStarred</code>、<code>remove</code>
          ，外加内容提供方（见下文）。
        </li>
        <li>
          <code>ctx.collections</code>——<code>list()</code>、
          <code>booksIn(id)</code>；写入：<code>create</code>、
          <code>rename</code>、<code>remove</code>、
          <code>assignBooks(bookIds, collectionId | null)</code>。
        </li>
        <li>
          <code>ctx.annotations</code>——{" "}
          <code>list({"{ bookId?, kind?, query? }"})</code>{" "}
          返回由高亮、笔记与提问构成的可辨识联合；写入：{" "}
          <code>createHighlight</code>、<code>recolorHighlight</code>、
          <code>removeHighlight</code>、<code>createNote</code>、
          <code>updateNote</code>、<code>removeNote</code>。
        </li>
        <li>
          <code>ctx.reading</code>——<code>getState(bookId)</code>、
          <code>listStates()</code>、<code>getTime(bookId)</code>。
        </li>
        <li>
          <code>ctx.vocabulary</code>——<code>list(filter?)</code>；写入：{" "}
          <code>add</code>、<code>remove</code>
          ——与阅读器词典保存词条所用的同一个词汇表。
        </li>
        <li>
          <code>ctx.conversations</code>——<code>getBookThread(bookId)</code>、
          <code>listThreads()</code>、<code>getThread(id)</code>；通过{" "}
          <code>on</code> 订阅（<code>aiConversation.started</code>、
          <code>aiMessage.appended</code>、<code>aiMessage.removed</code>、
          <code>aiConversation.cleared</code>）。
        </li>
      </ul>

      <h2>事件</h2>
      <p>
        两类事件，刻意分开。<strong>领域事件</strong>
        是应用记录下来的事实；按领域订阅，使用规范名称，需要该领域的读权限。每次投递的形态是{" "}
        <code>{"{ type, payload, createdAt, origin }"}</code>——origin
        表明是哪个软件行动者产生了这条事实（<code>user</code>、
        <code>agent</code>、<code>system</code>，或{" "}
        <code>plugin:&lt;id&gt;</code>）。
      </p>
      <pre>
        <code>{`ctx.annotations?.on("highlight.created", ({ payload, origin }) => {
  // payload: { highlightId, bookId, text, color?, … }
});
ctx.books?.on("book.removed", ({ payload }) => { /* { bookId } */ });
ctx.vocabulary?.on("vocabulary.added", ({ payload }) => { /* { term, … } */ });`}</code>
      </pre>
      <p>
        <strong>会话事实</strong>
        描述此刻屏幕上正在发生的事。它们从不进入事件日志，也无需任何权限：{" "}
        <code>ctx.session.on(event, handler)</code>。
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>会话事件</th>
              <th>载荷</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>book-opened</code>
              </td>
              <td>
                <code>{"{ book: { id, title, author? } }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>book-closed</code>
              </td>
              <td>
                <code>{"{ bookId }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>chapter-changed</code>
              </td>
              <td>
                <code>{"{ bookId, chapterHref }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>reading-progress</code>
              </td>
              <td>
                <code>{"{ bookId, fraction }"}</code>——翻页时触发，fraction
                取值 0..1
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>内容提供方与虚拟书籍</h2>
      <p>
        声明 <code>books:write</code> 后，插件可以把真正的书放上书架。
        <code>import</code>{" "}
        接收文件字节。内容提供方则完全跳过文件：注册一个提供方，添加绑定到它的虚拟书籍，并在书被打开时提供
        HTML
        章节。阅读器会像对待任何书一样为它们分页、标注、记录进度——“把 RSS
        订阅源当书读”正是这么实现的。
      </p>
      <pre>
        <code>{`ctx.books?.write?.registerContentProvider({
  id: "rss",
  async load(key) {
    const feed = await fetchFeed(key); // 你的代码，经由 ctx.network.fetch
    return {
      title: feed.title,
      sections: feed.items.map((item) => ({
        title: item.title,
        html: item.contentHtml,
      })),
    };
  },
});

await ctx.books?.write?.addVirtualBook({
  providerId: "rss",
  key: "https://example.com/feed.xml",
  title: "Example Weekly",
});`}</code>
      </pre>

      <h2>存储与设置</h2>
      <p>
        <code>ctx.storage</code>{" "}
        是随应用本地数据一起持久化的命名空间键值存储——<code>get</code>、
        <code>set</code>、<code>remove</code>。如果 manifest 声明了{" "}
        <code>settings</code> 字段，应用会渲染设置表单，所有值会以一个对象出现在{" "}
        <code>ctx.storage.get("settings")</code>。
      </p>

      <h2>常驻上下文</h2>
      <p>始终可用，无需任何权限：</p>
      <ul>
        <li>
          <code>ctx.manifest</code>、<code>ctx.appVersion</code>；
        </li>
        <li>
          <code>ctx.ui.showToast(message)</code>；
        </li>
        <li>
          <code>ctx.session.on(…)</code>——上文的会话事实；
        </li>
        <li>
          <code>ctx.reader.openBook(bookId)</code> 与{" "}
          <code>ctx.reader.goTo({"{ bookId?, cfi?, href? }"})</code>
          ——导航阅读器（用户可见的控制，不暴露数据）。
        </li>
      </ul>

      <h2>稳定性</h2>
      <p>
        这是契约 v2，随应用 0.3.0
        发布——一次有意为之的破坏性重建，把整个插件表面从领域模型派生出来（v1
        的 manifest 会安装失败，并给出可读的错误信息）。自此 API
        只做加法式增长：新的领域、新的事件名、新的区块类型。对本页已记载内容的破坏性变更会被当作
        bug 处理。任何依赖较新增能力的插件，请声明{" "}
        <code>minAppVersion</code>。
      </p>
    </article>
  );
}
