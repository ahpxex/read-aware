import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/zh/docs/plugins/publishing")({
  head: () => ({
    meta: [
      { title: "发布上架 — ReadAware 文档" },
      {
        name: "description",
        content:
          "如何向 ReadAware 插件市场提交插件：仓库结构、校验流程与审核要求。",
      },
    ],
  }),
  component: PublishingPage,
});

function PublishingPage() {
  return (
    <article className="doc-prose">
      <h1>发布插件</h1>
      <p className="lead">
        插件市场的运作方式与 Raycast 的扩展仓库类似：你的插件存放在公开的{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          readaware-plugins
        </a>{" "}
        仓库里，通过 pull request 进入。合并之后，它就会出现在应用的“设置 →
        插件 → 插件市场”中，一键即可安装。
      </p>

      <h2>用 TypeScript 编写</h2>
      <p>
        推荐使用 TypeScript。仓库自带一个 <code>template/</code>
        ，已经接好类型化的 API（<code>types/plugin-api.d.ts</code>
        ）——复制它，编写 <code>src/main.ts</code>
        ，再构建为单个自包含模块：
      </p>
      <pre>
        <code>bun build src/main.ts --outfile main.js --format esm</code>
      </pre>
      <p>
        最终上架的始终是构建出的 <code>main.js</code>；请保留{" "}
        <code>src/</code> 的提交，让审阅者能读到真实代码。纯 JavaScript
        同样被接受。<code>plugins/</code>{" "}
        里的官方插件就是这样写成的——把它们当作活的范例。
      </p>

      <h2>提交</h2>
      <ol>
        <li>Fork 这个仓库。</li>
        <li>
          把 <code>template/</code> 复制为{" "}
          <code>plugins/&lt;your-plugin-id&gt;/</code>，至少包含{" "}
          <code>manifest.json</code> 和 <code>main.js</code>。文件夹名必须与
          manifest 的 <code>id</code> 一致。
        </li>
        <li>
          在 <code>registry.json</code> 中添加对应条目，保持数组按 id 排序。
        </li>
        <li>
          在本地运行与 CI 相同的检查：
          <pre>
            <code>{`node scripts/validate.mjs
npx tsc --noEmit`}</code>
          </pre>
        </li>
        <li>
          发起 pull
          request，说明插件做什么，以及它声明的每一项权限为什么是必要的。
        </li>
      </ol>
      <p>
        CI 会强制检查 registry 与 manifest 的一致性、id
        的格式、权限白名单和文件存在性，并对每个 TypeScript
        插件做类型检查。
      </p>

      <h2>更新</h2>
      <p>
        流程相同：在同一个 pull request 里同时提升 <code>manifest.json</code>{" "}
        和 <code>registry.json</code> 中的 <code>version</code>
        。注意应用通过 CDN 读取
        registry，合并后的更新可能要过一小段时间才会出现在插件市场标签页里。
      </p>

      <h2>审核要求</h2>
      <ul>
        <li>
          只声明最小权限。声明的权限超出代码实际使用时，pull request
          会被退回——参见
          <Link to="/zh/docs/plugins/api">权限表</Link>。
        </li>
        <li>
          <code>main.js</code> 必须可读，或附带打包它的源码。
        </li>
        <li>不接受混淆代码，不接受数据分析或跟踪，不接受远程代码加载。</li>
      </ul>
      <p>
        插件运行在应用内部，拥有与应用本身相同的访问能力。安装是用户对每个插件逐一做出的信任决定，而这道审核是社区的第一道防线——请写出那种即使来自陌生人、你自己也放心安装的插件。
      </p>
    </article>
  );
}
