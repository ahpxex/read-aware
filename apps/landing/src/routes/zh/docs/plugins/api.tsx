import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/zh/docs/plugins/api")({
  head: () => ({
    meta: [
      { title: "API 参考 — ReadAware 文档" },
      {
        name: "description",
        content:
          "ReadAware 插件编写契约：manifest、生命周期、权限、贡献点、视图与事件。",
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
        <code>activate</code> 的上下文；每个 <code>register*</code>{" "}
        调用都返回一个
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
  "minAppVersion": "0.2.0",
  "description": "Send looked-up words to Anki.",
  "author": "you",
  "permissions": ["network", "reading-data"],
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
              <td>插件支持的最低应用版本。</td>
            </tr>
            <tr>
              <td>
                <code>permissions</code>
              </td>
              <td>
                插件使用的能力域（见下表）。会在安装前展示给用户。
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

      <h2>权限</h2>
      <p>
        没有声明对应权限时，<code>ctx</code>{" "}
        上的能力组干脆不存在——在 API
        层面防范无意的越界。命名空间存储不是权限；每个插件都拥有它。
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
                <code>reading-data</code>
              </td>
              <td>
                <code>ctx.reading</code>
                ——书籍（读取）、标注（创建/删除）、章节文本，以及内置的词汇表。
                <code>annotation-*</code> 事件也需要此权限。
              </td>
            </tr>
            <tr>
              <td>
                <code>library-write</code>
              </td>
              <td>
                <code>ctx.library</code>
                ——导入书籍文件，以及提供虚拟书籍（内容提供方）。
              </td>
            </tr>
            <tr>
              <td>
                <code>network</code>
              </td>
              <td>
                <code>ctx.fetch</code>——对外的 HTTP 请求。
              </td>
            </tr>
            <tr>
              <td>
                <code>ai</code>
              </td>
              <td>
                <code>ctx.ai.registerTool</code>——为阅读助手注册工具。
              </td>
            </tr>
            <tr>
              <td>
                <code>dictionary</code>
              </td>
              <td>
                <code>ctx.dictionary.lookUp</code>
                ——应用的词典（与阅读器共享缓存；使用用户的 AI）。
              </td>
            </tr>
            <tr>
              <td>
                <code>llm</code>
              </td>
              <td>
                <code>ctx.llm.ask</code>
                ——使用用户配置的账号发起一次性模型调用。没有线程、没有记忆、没有工具。
              </td>
            </tr>
            <tr>
              <td>
                <code>clipboard</code>
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
        阅读助手在对话中可以调用的工具（需要 <code>ai</code> 权限）。
        <code>parameters</code> 是描述参数对象的普通 JSON
        Schema；无参数的工具可以省略。工具在送达模型之前会被命名空间化为{" "}
        <code>plugin_&lt;pluginId&gt;_&lt;name&gt;</code>
        ，调用过程会以工具步骤的形式在对话中对用户可见。
      </p>
      <pre>
        <code>{`ctx.ai?.registerTool({
  name: "search_deck",
  label: "Searching your Anki deck",
  description: "Search the user's Anki collection for a term.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  execute: async ({ query }) => {
    const res = await ctx.fetch("http://127.0.0.1:8765", {
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

      <h2>事件</h2>
      <p>
        <code>ctx.events.on(event, handler)</code> 返回一个 disposable。
        <code>annotation-*</code> 事件需要 <code>reading-data</code>{" "}
        权限；其余事件无需权限。
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>事件</th>
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
            <tr>
              <td>
                <code>book-removed</code>
              </td>
              <td>
                <code>{"{ bookId }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>annotation-created</code>
              </td>
              <td>
                <code>{"{ annotation }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>annotation-deleted</code>
              </td>
              <td>
                <code>{"{ id }"}</code>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>阅读数据</h2>
      <p>
        声明 <code>reading-data</code> 后，<code>ctx.reading</code>{" "}
        暴露用户的阅读轨迹：
      </p>
      <ul>
        <li>
          <code>listBooks()</code>、<code>listAnnotations(filter?)</code>；
        </li>
        <li>
          <code>createHighlight(…)</code>、<code>createNote(…)</code>、
          <code>updateNote(…)</code>、<code>recolorHighlight(…)</code>、
          <code>deleteAnnotation(id)</code>；
        </li>
        <li>
          <code>getToc(bookId)</code> 与{" "}
          <code>getChapterText(bookId, index)</code>
          ——书籍的章节列表和纯文本（按需抽取）；
        </li>
        <li>
          <code>vocabulary.list / add / remove</code>
          ——与阅读器词典保存词条所用的同一个词汇表。
        </li>
      </ul>

      <h2>书库与虚拟书籍</h2>
      <p>
        声明 <code>library-write</code> 后，插件可以把真正的书放上书架。
        <code>importBook</code>{" "}
        接收文件字节。内容提供方则完全跳过文件：注册一个提供方，添加绑定到它的虚拟书籍，并在书被打开时提供
        HTML
        章节。阅读器会像对待任何书一样为它们分页、标注、记录进度——“把 RSS
        订阅源当书读”正是这么实现的。
      </p>
      <pre>
        <code>{`ctx.library?.registerContentProvider({
  id: "rss",
  async load(key) {
    const feed = await fetchFeed(key); // 你的代码，经由 ctx.fetch
    return {
      title: feed.title,
      sections: feed.items.map((item) => ({
        title: item.title,
        html: item.contentHtml,
      })),
    };
  },
});

await ctx.library?.addVirtualBook({
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
          <code>ctx.reader.openBook(bookId)</code> 与{" "}
          <code>ctx.reader.goTo({"{ bookId?, cfi?, href? }"})</code>
          ——导航阅读器（用户可见的控制，不暴露数据）。
        </li>
      </ul>

      <h2>稳定性</h2>
      <p>
        API
        表面刻意保持小巧，只做加法式的增长——新的区块类型、新的事件、新的能力组。对本页已记载内容的破坏性变更会被当作
        bug 处理。任何依赖较新增能力的插件，请声明{" "}
        <code>minAppVersion</code>。
      </p>
    </article>
  );
}
