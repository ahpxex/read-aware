import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/zh/docs/getting-started")({
  head: () => ({
    meta: [
      { title: "快速上手 — ReadAware 文档" },
      {
        name: "description",
        content:
          "导入书籍、阅读与标注、连接 AI 提供方，并了解你的数据存放在哪里。",
      },
    ],
  }),
  component: GettingStartedPage,
});

function GettingStartedPage() {
  return (
    <article className="doc-prose">
      <h1>快速上手</h1>
      <p className="lead">
        ReadAware
        直接打开你自己的文件，并把它学到的一切留在你的设备上。本页带你走过最初一小时：导入书籍、阅读与标注，以及（可选地）连接
        AI。
      </p>

      <h2>添加书籍</h2>
      <p>
        在书架上导入文件。ReadAware 直接读取{" "}
        <strong>EPUB、MOBI、AZW3、FB2 和 PDF</strong>
        ——没有转换步骤，也没有云端上传。你导入的文件就是你保留的文件；高亮、笔记和阅读位置都附着在原文之上。
      </p>
      <p>
        受 DRM 保护的文件无法打开。如果一本书拒绝导入，几乎总是 DRM
        的缘故；ReadAware 会明确告知，而不是悄无声息地失败。
      </p>

      <h2>阅读</h2>
      <p>
        每种格式都在同一个阅读器里打开，用同一套控件。阅读器的外观设置中提供三种阅读模式：
      </p>
      <ul>
        <li>
          <strong>连续滚动</strong>——默认模式；全书连成一栏流动。
        </li>
        <li>
          <strong>单页</strong>——一次一页，像纸书一样翻动。
        </li>
        <li>
          <strong>双页</strong>——宽屏上呈现书本式的对页。
        </li>
      </ul>
      <p>
        阅读位置按书保存；目录始终在阅读器顶栏，一次点击即可打开。
      </p>

      <h2>标注</h2>
      <p>选中任意一段文字，一个安静的操作菜单随即出现：</p>
      <ul>
        <li>
          <strong>高亮</strong>——有几种颜色可选，也可以只用下划线。
        </li>
        <li>
          <strong>笔记</strong>——把你自己的话附在这段文字上。
        </li>
        <li>
          <strong>查词</strong>
          ——内置词典会结合词语所在的句子来解释它，而不只给出抽象释义，并把它存入你的词汇表。（使用你配置的
          AI。）
        </li>
      </ul>
      <p>
        你标记的一切都按书收集，并汇入应用的记忆——标注不是归档，而是助手会去阅读的材料。
      </p>

      <h2>连接 AI</h2>
      <p>
        ReadAware
        的全部智能都运行在你自带的密钥上。没有密钥，阅读、标注和书库依然完整可用；助手、词典和记忆则需要它。
      </p>
      <ol>
        <li>打开“设置 → AI”。</li>
        <li>
          选择一个提供方——OpenAI、Anthropic、Google、OpenRouter、DeepSeek、xAI、Groq、Mistral、Moonshot、Z.ai，或通过
          <strong>自定义</strong>接入任何 OpenAI 兼容端点。
        </li>
        <li>粘贴你的 API 密钥并选择模型。</li>
      </ol>
      <p>
        ReadAware 区分 <strong>Smart</strong> 模型（对话与综合）和{" "}
        <strong>Fast</strong>{" "}
        模型（查词、摘要、记忆维护）；每个提供方都预填了合理的默认值。你的密钥存储在你的设备上，请求直接发往你的提供方——中间没有
        ReadAware 的服务器。
      </p>

      <h2>提问</h2>
      <p>
        每本书都有一个持续存在的对话——阅读时打开对话面板，就这段文字、这一章或整本书提问。在
        <strong>上下文</strong>页面，你可以跨整个书架交谈，线程数量不限。
      </p>
      <p>
        助手基于你的阅读来工作：你的高亮、笔记、既往对话，以及它长期维护的一份记忆——记录你读过什么、在意什么。这份记忆和其他一切一样，都在本地构建和存储。
      </p>

      <h2>快捷操作</h2>
      <p>
        命令面板（macOS 上 <code>Cmd K</code>，其他平台 <code>Ctrl K</code>
        ——可在设置中重新绑定）可以触达每一个操作：打开书籍、切换视图、运行插件命令。
      </p>

      <h2>你的数据存放在哪里</h2>
      <p>
        书籍、标注、对话和记忆都存储在你的设备上。网络只用于向你自己的提供方发起
        AI 请求，除此之外别无他用——应用可以完全离线使用你的本地书库。
      </p>
    </article>
  );
}
