import { Link, createFileRoute } from "@tanstack/react-router";
import { BlogPost } from "../../../components/BlogPost";
import { getPost } from "../../../lib/posts";
import { MARKETPLACE_REPO_URL } from "../../../lib/site";

const SLUG = "plugins-v1";

export const Route = createFileRoute("/zh/blog/plugins-v1")({
  head: () => {
    const post = getPost(SLUG);
    return {
      meta: [
        { title: `${post.text.zh.title} — ReadAware 博客` },
        { name: "description", content: post.text.zh.description },
      ],
    };
  },
  component: () => (
    <BlogPost slug={SLUG} locale="zh">
      <p>
        ReadAware
        现在有插件系统了。你可以用一个晚上写出一个插件，开发时直接从文件夹安装，写好后提交到社区市场，任何人都能一键装上。
      </p>

      <h2>你能构建什么</h2>
      <p>
        一个插件就是一个文件夹，里面有一份 manifest 和一个 JavaScript
        模块，它可以贡献：
      </p>
      <ul>
        <li>
          <strong>选区动作</strong>
          ——在任何一本书里选中文字并对它做点什么：把一个单词发进
          Anki，翻译一个段落，把一句摘录发到你的笔记应用。
        </li>
        <li>
          <strong>顶栏按钮与页面</strong>
          ——阅读器顶栏上的一个弹层，或书架上的一个完整页面。
        </li>
        <li>
          <strong>命令</strong>——所有这些都会自动出现在命令面板里。
        </li>
        <li>
          <strong>给助手的工具</strong>
          ——这是我们最在意的一项。插件可以把一件新工具交到阅读 agent 手里，由
          agent
          在对话中自行决定何时调用。“这些单词里哪些已经在我的 Anki
          牌组里了？”从此变成一个可以回答的问题。
        </li>
        <li>
          <strong>不是文件的书</strong>
          ——内容提供方按需提供章节，于是一个 RSS
          订阅源可以躺在你的书架上，像一本真正的书那样被阅读、高亮和讨论。
        </li>
      </ul>

      <h2>原生，是构造出来的</h2>
      <p>
        界面哲学我们取自 Raycast：插件不渲染自己的
        UI。它们声明视图——markdown、列表、表单、结构化区块——由应用用自己的设计系统渲染出来。插件页面和内置页面无从分辨，因为它们由同样的零件搭成。插件作者不用做任何设计工作；应用始终是一个安静的整体。
      </p>
      <p>
        而家具的摆放仍然由你做主：插件贡献能力，但哪个按钮出现在哪里、按什么顺序，由“设置
        → 自定义”决定。新插件的动作会先落在更多菜单里，而不是径直摆到你面前。
      </p>

      <h2>把信任讲清楚</h2>
      <p>
        信任模型和 Obsidian
        一样，我们直说：插件运行在应用内部，安装一个插件就是信任它的作者。manifest
        里声明权限——网络、读取数据、AI、剪贴板——API
        会强制执行这些权限，但它拦得住失误，拦不住恶意。所以在复制任何一个文件之前，应用会用平实的语言把每一项权限展示给你；市场对每一份提交做公开评审，并要求源码可读。没有暗角，也没有“已经沙箱化了”的表演。
      </p>

      <h2>从这里开始</h2>
      <p>
        <Link to="/zh/docs/plugins/api">API 参考</Link>记录了完整的契约，
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          插件市场仓库
        </a>
        里有一个 TypeScript
        模板，还有作为可运行示例的官方插件。写一个吧，写好之后
        <Link to="/zh/docs/plugins/publishing">提交上来</Link>
        ——设置里的插件市场标签页，正等着它的第一批社区插件。
      </p>
    </BlogPost>
  ),
});
