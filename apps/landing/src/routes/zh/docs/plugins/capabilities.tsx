import { createFileRoute } from "@tanstack/react-router";
import { PluginCapabilityBrowser, type PluginCapabilityBrowserCopy } from "../../../../components/PluginCapabilityBrowser";
import { PluginPermissionPreview, type PluginPermissionPreviewCopy } from "../../../../components/PluginPermissionPreview";

export const Route = createFileRoute("/zh/docs/plugins/capabilities")({
  head: () => ({ meta: [
    { title: "插件能力 — ReadAware 文档" },
    { name: "description", content: "浏览每个版本化的 ReadAware 插件能力，并预览插件 manifest 请求的授权。" },
  ] }),
  component: PluginCapabilitiesPage,
});

const capabilityCopy: PluginCapabilityBrowserCopy = {
  searchLabel: "搜索能力", searchPlaceholder: "ID、权限或用途", familyLabel: "能力类别", authorityLabel: "权限类型",
  allFamilies: "所有类别", allAuthorities: "所有授权",
  familyNames: { domains: "领域", contributions: "贡献", services: "服务", schemas: "Schema" },
  authorityNames: { permission: "需要权限", "permission-free": "无需额外权限", "settings-grant": "精确设置授权" },
  permissionFree: "无", versionLabel: "v", permissionLabel: "权限", capabilityLabel: "能力", purposeLabel: "插件可以", hostOwnsLabel: "宿主负责",
  result: (count) => count + " 项能力", noResults: "没有能力符合这些筛选条件。",
  descriptions: {
    "domains:library": { purpose: "读取书籍、文件、元数据、目录、集合，以及导入或移除书库项目。", hostOwns: "书库不变量、事件溯源写入、文件和投影。" },
    "domains:reading": { purpose: "查看当前会话，并导航、更新位置、进度和阅读时间。", hostOwns: "阅读器生命周期、进度语义和已提交事件。" },
    "domains:annotations": { purpose: "通过规范命令读取或更改高亮和笔记。", hostOwns: "校验、归属、持久化和事件顺序。" },
    "domains:conversations": { purpose: "读取书籍和全局线程摘要。", hostOwns: "对话写入、提示词组装和记忆。" },
    "domains:settings": { purpose: "发现、读取、更新并订阅明确授权的设置路径。", hostOwns: "目录、目标、校验、持久化和变更效果。" },
    "contributions:selectionActions": { purpose: "向选区和标注菜单添加命令。", hostOwns: "菜单位置、调用界面、加载和无障碍。" },
    "contributions:headerActions": { purpose: "添加阅读器或书库工具栏动作，并显示由宿主渲染的视图。", hostOwns: "位置、导航、弹出层、页面和焦点。" },
    "contributions:commands": { purpose: "添加显式的命令面板命令。", hostOwns: "注册表、面板、快捷键和结果展示。" },
    "contributions:settingsOptions": { purpose: "为一个已声明的插件设置解析动态选项。", hostOwns: "表单渲染、备用输入和值校验。" },
    "contributions:voiceProviders": { purpose: "列出声音并合成用于朗读的编码音频。", hostOwns: "播放、节奏、预取、高亮和回退。" },
    "contributions:contentProviders": { purpose: "为 RSS 等虚拟书籍加载章节。", hostOwns: "书库绑定、阅读模型、导航和展示。" },
    "contributions:readerModes": { purpose: "提供受限的句子或段落分段。目前仅限内置插件。", hostOwns: "阅读器控件、生命周期、渲染和导航。" },
    "contributions:agentTools": { purpose: "注册阅读助手可以调用的命名空间工具。", hostOwns: "编排、工具可见性、审批和对话界面。" },
    "contributions:agentContextProviders": { purpose: "为当前用户轮次返回受限的参考区块。", hostOwns: "来源、裁剪、提示词位置和生命周期。" },
    "contributions:agentRetrievalProviders": { purpose: "将可搜索的插件来源公开为命名空间助手工具。", hostOwns: "查询 schema、限制、结果裁剪和工具描述。" },
    "contributions:memoryCandidateProviders": { purpose: "在一轮对话后提出事实、偏好、洞察或摘要。", hostOwns: "范围检查、去重、接纳和持久记忆写入。" },
    "contributions:themes": { purpose: "提供语义化应用和阅读器主题数据。", hostOwns: "校验、CSS 生成、选择和应用。" },
    "contributions:fonts": { purpose: "提供获批准的字体元数据和内置字体资源。", hostOwns: "文件校验、加载、选择器条目和当前选择。" },
    "services:storage": { purpose: "使用插件作用域的 KV 和文档集合。", hostOwns: "命名空间隔离、持久化、快照和变更事件。" },
    "services:secrets": { purpose: "在插件作用域的密钥槽中存取凭据。", hostOwns: "加密、不披露和命名空间隔离。" },
    "services:ui": { purpose: "显示宿主提示，或打开宿主保存/导出流程。", hostOwns: "展示、路径选择和平台集成。" },
    "services:schedules": { purpose: "将工作绑定到 manifest 声明的周期任务。", hostOwns: "频率、启动补跑、防止重叠和释放。" },
    "services:session": { purpose: "订阅当前阅读会话的受限事实。", hostOwns: "事件来源、载荷边界和订阅生命周期。" },
    "services:network": { purpose: "通过原生宿主客户端发出 HTTP 请求。", hostOwns: "权限强制、传输和响应桥接。" },
    "services:llm": { purpose: "进行受限的一次性文本或结构化模型调用。", hostOwns: "提供方配置、凭据、schema 处理和限制。" },
    "services:clipboard": { purpose: "向系统剪贴板写入文本。", hostOwns: "平台调用和权限强制。" },
    "schemas:views": { purpose: "返回 markdown、列表、表单、详情和受限区块树。", hostOwns: "组件、HTML 安全、布局、无障碍和导航。" },
    "schemas:settings": { purpose: "声明由宿主渲染的插件设置字段。", hostOwns: "表单行为、校验、存储路由和密钥处理。" },
    "schemas:themes": { purpose: "声明语义主题令牌和内置字体元数据。", hostOwns: "语法校验、生成 CSS、加载和选择。" },
  },
};

const permissionCopy: PluginPermissionPreviewCopy = {
  inputLabel: "manifest.json", inputHint: "只在此页面解析，不会上传任何内容。", previewLabel: "审核预览",
  noAuthority: "此 manifest 未请求语义权限或设置授权。", invalidJson: "请输入有效的 JSON 对象。", issuesTitle: "审核备注",
  permissionsTitle: "用户授权 · 语义权限", settingsTitle: "用户授权 · 精确设置授权", requirementsTitle: "兼容性 · 不是权限",
  declarationsTitle: "运行声明 · 不是权限", none: "未声明", schemaVersion: "私有数据 schema",
  schedules: (count) => count + " 个周期任务", themes: (count) => count + " 个主题", fonts: (count) => count + " 个内置字体声明",
  unknownPermission: (permission) => "未知权限：" + permission, missingField: (field) => "缺少必需字段：" + field,
  invalidSchemaVersion: "schemaVersion 必须是正整数。", invalidPermissions: "permissions 必须是数组。",
  invalidSettingsAccess: "settingsAccess 必须是对象。",
  unknownSettingsOperation: (operation) => "未知设置操作：" + operation,
  invalidSettingsGrant: (operation) => operation + " 必须包含精确路径或 section.* 分组。",
  sectionGrantWarning: (path) => path + " 授予整个设置分区；请尽可能使用精确路径。",
  permissionDescriptions: {
    "library:read": "读取书籍、原文、元数据、目录和集合。", "library:write": "更改书库；写入包含读取。",
    "reading:read": "读取当前会话、位置、进度和阅读时间。", "reading:write": "导航并更改阅读状态；写入包含读取。",
    "annotations:read": "读取高亮和笔记。", "annotations:write": "创建、编辑和移除标注；写入包含读取。",
    "conversations:read": "读取书籍和全局对话摘要。", "reader:modes": "注册引导式阅读模式；目前仅限内置插件。",
    "agent:tools": "注册阅读助手可以调用的工具。", "agent:context": "向一轮对话添加受限的非可信参考区块。",
    "agent:retrieval": "向助手公开可搜索的插件来源。", "agent:memory": "提出由宿主审核的持久记忆候选。",
    "ui:themes": "提供应用主题、阅读器主题和内置字体。", "service:network": "发出由宿主中介的网络请求。",
    "service:llm": "使用已配置的模型进行受限的一次性调用。", "service:clipboard": "向系统剪贴板写入文本。",
  },
  operationLabels: { discover: "发现", read: "读取", write: "写入" },
  familyLabels: { domains: "领域", contributions: "贡献", services: "服务", schemas: "Schema" },
};

const sampleManifest = `{
  "id": "research-notes",
  "name": "研究笔记",
  "version": "0.1.0",
  "schemaVersion": 1,
  "requires": {
    "domains": { "annotations": "^1.0.0", "settings": "^1.0.0" },
    "contributions": {
      "commands": "^1.0.0",
      "agentRetrievalProviders": "^1.0.0"
    },
    "services": {
      "storage": "^1.0.0",
      "schedules": "^1.0.0",
      "network": "^1.0.0"
    },
    "schemas": { "settings": "^1.0.0" }
  },
  "permissions": [
    "annotations:read",
    "agent:retrieval",
    "service:network"
  ],
  "settingsAccess": {
    "discover": ["appearance.theme"],
    "read": ["appearance.theme"]
  },
  "schedules": [
    { "id": "refresh", "label": "刷新来源", "everyMinutes": 60 }
  ],
  "main": "main.js"
}`;

function PluginCapabilitiesPage() {
  return (
    <article className="doc-prose">
      <h1>能力浏览器</h1>
      <p className="lead">设计插件前，搜索完整的公开目录。每项能力都独立版本化；每项依赖都必须写入 manifest 的 <code>requires</code> 部分。</p>
      <PluginCapabilityBrowser copy={capabilityCopy} />
      <h2>如何阅读目录</h2>
      <ul>
        <li><strong>权限</strong>表示调用时需要的权限或精确设置授权。</li>
        <li><strong>无</strong>表示不需要额外的安装权限，并不代表存在未记录的环境能力。</li>
        <li><strong>宿主负责</strong>标记插件无法替换或绕过的边界。</li>
        <li>每条能力旁的版本直接来自宿主的规范能力目录。</li>
      </ul>
      <p><code>readerModes</code> 在特权阅读器契约确定前仍仅限内置插件。manifest 只能写入目录中的能力；宿主仍会根据 actor、权限、版本和生命周期阶段过滤可见的运行时视图。</p>
      <h2>权限预览</h2>
      <p>粘贴 manifest，将用户授权与兼容性及运行声明分开。它反映安装同意的含义，但不能替代仓库校验器，也不能证明插件可以激活。</p>
      <PluginPermissionPreview copy={permissionCopy} sampleManifest={sampleManifest} />
      <h2>安装对话框实际授予什么</h2>
      <p>语义 <code>permissions</code> 和精确的 <code>settingsAccess</code> 条目授予权限。正式的同意对话框会用直白的语言展示二者。能力要求、定时任务、schema 版本、主题和字体可作为审核上下文，但不会被悄悄重新标记为权限。</p>
      <p>此预览刻意保持本地且无状态。下一步开发工具是在应用内提供 actor 视图和生命周期检查器，使用相同的运行时目录，并显示更新时的权限差异和能力不可用的确切原因。</p>
    </article>
  );
}
