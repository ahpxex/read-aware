import { createFileRoute, Link } from "@tanstack/react-router";
import { AndroidReaderPlate } from "../../components/AndroidReaderPlate";
import { TopicPage, type TopicFaq } from "../../components/TopicPage";
import { RELEASES_URL } from "../../lib/releases";

export const Route = createFileRoute("/zh/epub-reader-for-android")({
  head: () => ({
    meta: [
      { title: "ReadAware 安卓 EPUB 阅读器：免费离线阅读与 APK 下载" },
      {
        name: "description",
        content:
          "下载 ReadAware Android APK，离线阅读 EPUB、MOBI、AZW3、PDF 和漫画。支持批注、笔记与加密同步；了解 ARM64 设备要求、WebView 更新和免费同步额度。",
      },
    ],
  }),
  component: () => (
    <TopicPage
      locale="zh"
      platform="android"
      title="ReadAware 安卓 EPUB 阅读器"
      lead="把自己的书带到手机上。免费、开源、无需注册即可离线阅读；需要时，再把书籍、批注和阅读进度加密同步到电脑。"
      faqs={FAQS}
    >
      <h2>读自己的文件，不必进入书店</h2>
      <p>
        ReadAware 直接读取 EPUB、MOBI、AZW3、FB2、PDF、TXT、HTML、CBZ 和
        CBR，无需转换格式。书架、划线、笔记和阅读进度保存在设备上；没有广告，也不需要为了打开一本书注册账号。受
        DRM 保护的书籍不支持导入。
      </p>
      <AndroidReaderPlate locale="zh" />
      <h2>安装前先看设备要求</h2>
      <p>
        当前 APK 适用于 Android 7.0（API 24）及以上的 ARM64 设备，不提供 32 位
        ARM 或 x86 安装包。旧系统还需要保持 Android System WebView
        更新；系统版本满足最低要求，并不代表旧 WebView 已支持全部阅读功能。
      </p>
      <p>
        请从<a href={RELEASES_URL}>官方 GitHub Release</a>下载签名
        APK。打开安装包时，Android
        可能要求允许当前浏览器或文件管理器安装未知来源应用。只为你确认来自官方的安装包启用该权限，安装后可关闭。详细步骤见
        <Link to="/zh/docs/install">安装指南</Link>。
      </p>
      <h2>手机与电脑，接着读同一段</h2>
      <p>
        可选同步使用端到端加密，传输书籍、批注、笔记和阅读进度。免费账户有 50 MB
        同步额度，Sync 付费方案扩容；Pro 和 Max 还包含内置
        AI。请妥善保管加密口令，服务端无法代你恢复。桌面端支持
        <Link to="/zh/epub-reader-for-windows">Windows</Link>、macOS 和 Linux。
      </p>
      <h2>本地阅读与远程 AI 分开选择</h2>
      <p>
        离线阅读不需要订阅。AI 功能需要联网，可自带 API
        Key，也可使用付费方案的内置
        AI；相关选文、问题和上下文会发送给模型服务商。自带 Key 不向 ReadAware 付
        AI 订阅费，但服务商可能收取调用费用。参见
        <Link to="/zh/pricing">价格与额度</Link>及
        <Link to="/zh/privacy">隐私政策</Link>。
      </p>
    </TopicPage>
  ),
});

const FAQS: TopicFaq[] = [
  {
    question: "可以从 Google Play 下载吗？",
    answer:
      "目前通过官方 GitHub Release 提供 APK，尚未上架 Google Play。本页下载按钮直接指向最新稳定版 Android 安装包。",
  },
  {
    question: "Android 12 能用吗？",
    answer:
      "Android 12 满足最低系统版本要求，还需要 ARM64 设备和可用的 Android System WebView。若导入失败，请先更新 ReadAware 和 WebView，再通过应用内诊断报告提供问题信息；不能仅凭系统版本保证所有设备都正常。",
  },
  {
    question: "离线阅读和同步都免费吗？",
    answer:
      "离线阅读、划线和笔记免费，不需要账号。免费账户提供 50 MB 加密同步额度；更大同步空间和内置 AI 由可选付费方案提供。",
  },
  {
    question: "截图是真实 Android 界面吗？",
    answer:
      "是。页面截图来自安装官方 ReadAware 0.5.4 APK 的 Android 16 Pixel 7 模拟器，展示真实导入的《傲慢与偏见》。它不是 Android 12 兼容性测试结果。",
  },
];
