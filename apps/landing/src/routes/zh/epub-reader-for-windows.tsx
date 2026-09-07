import { createFileRoute, Link } from "@tanstack/react-router";
import { TopicPage, type TopicFaq } from "../../components/TopicPage";
import { Plate } from "../../components/Plate";
import { RELEASES_URL } from "../../lib/releases";

export const Route = createFileRoute("/zh/epub-reader-for-windows")({
  head: () => ({
    meta: [
      { title: "ReadAware Windows EPUB 阅读器：免费开源，支持 PDF 与漫画" },
      {
        name: "description",
        content:
          "在 Windows 上用 ReadAware 阅读 EPUB、MOBI、AZW3、PDF、CBZ 和 CBR。直接下载 x64 安装程序、MSI 或便携版，了解 SmartScreen 提示、离线批注与安卓加密同步。",
      },
    ],
  }),
  component: () => (
    <TopicPage
      locale="zh"
      platform="windows"
      title="ReadAware Windows EPUB 阅读器"
      lead="一款免费开源的桌面阅读器，直接打开自己的电子书。阅读、划线和笔记在本地完成，可选 AI 帮你结合上下文理解正在读的内容。"
      faqs={FAQS}
    >
      <h2>电子书、文档和漫画放在同一个书架</h2>
      <p>
        ReadAware 直接读取 EPUB、MOBI、AZW3、FB2、TXT、HTML、PDF、CBZ 和
        CBR，无需转换。可重排电子书能调整字体、行距和页边距；PDF
        和漫画保留原有固定版式。所有格式共用书架、批注和阅读进度，受 DRM
        保护的文件除外。
      </p>
      <div className="my-8">
        <Plate
          base="reader"
          alt="ReadAware 桌面阅读界面，展示正文、工具栏和阅读进度。"
          caption="ReadAware 桌面版实际阅读界面。"
        />
      </div>
      <h2>安装程序、MSI 和便携包怎么选</h2>
      <p>
        普通安装选 x64 EXE；需要通过 Windows Installer 管理安装时选
        MSI；只想解压启动则选便携
        ZIP。便携包是免安装的程序分发形式，不代表阅读数据自动随程序目录一起移动。各版本都从
        <a href={RELEASES_URL}>官方 Release</a>下载，完整步骤见
        <Link to="/zh/docs/install">安装指南</Link>。
      </p>
      <h2>关于 Windows SmartScreen</h2>
      <p>
        当前 Windows
        构建尚未代码签名，系统可能提示无法识别发布者。先检查下载来源和文件是否与官方发行一致，不要对来历不明的安装包绕过安全警告。macOS
        版本已签名并公证，不能把两个平台的提示混为一谈。
      </p>
      <h2>离线先读，需要时再连接</h2>
      <p>
        无需账号或订阅即可导入、阅读和批注。可选端到端加密同步让你在
        <Link to="/zh/epub-reader-for-android">Android 手机</Link>
        继续阅读；免费账户有 50 MB 同步额度，付费方案扩容并可包含内置 AI。
      </p>
      <p>
        AI 需要联网，并把相关选文、问题和上下文交给所选模型服务商。自带 API Key
        不向 ReadAware 付 AI 订阅费，服务商调用费用另计。参见
        <Link to="/zh/pricing">方案价格</Link>和
        <Link to="/zh/privacy">隐私说明</Link>。
      </p>
    </TopicPage>
  ),
});

const FAQS: TopicFaq[] = [
  {
    question: "可以打开 Kindle 的书吗？",
    answer:
      "支持未加密的 MOBI 和 AZW3 文件，不移除或绕过 DRM。购买自书店的受保护文件可能无法打开。",
  },
  {
    question: "有 Windows ARM64 安装包吗？",
    answer:
      "当前 Windows 发行包为 x64，没有单独的原生 ARM64 安装包。不要把 ARM64 系统的兼容运行能力等同于原生支持保证。",
  },
  {
    question: "不配置 AI 也能正常阅读吗？",
    answer:
      "可以。导入、阅读、搜索、划线和笔记都在本地完成。只有选用远程 AI 和同步时才需要相应网络服务。",
  },
];
