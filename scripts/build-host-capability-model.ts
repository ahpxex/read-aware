import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { baselineCoverage, sources } from "../docs/host-capability-matrix.data";
import { evidence, refinements, scenarioCoverage, scenarios, units } from "../docs/host-capability-model.data";
import { validateModel } from "./host-capability-model-check";

const { rows, owners } = validateModel();
const title = "ReadAware 宿主能力统一模型";
const status = "目标模型与现状映射；不是 API 已实现声明";
const date = "2026-09-09";
const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const md = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");
const links = (ids: string[]) => ids.map(id => `[${id}](#${id})`).join(" · ");
const evidenceLinks = (ids: string[]) => ids.map(id => `[${id}](./host-capability-matrix.md#${id})`).join(" · ");
const baseline = readFileSync("docs/plugin-capability-baseline.md", "utf8");
const legacy = [...baseline.matchAll(/^\| (W\d{2}) \| (.*?) \| (.*?) \| (.*?) \|$/gm)];
if (JSON.stringify(legacy.map(m => m[1]).sort()) !== JSON.stringify(Object.keys(scenarioCoverage).sort())) throw new Error("Scenario roster drift");
const acceptanceIds = [...baseline.matchAll(/^\| ([A-R]\d{2}) \| [EPMB] \|/gm)].map(m => m[1]);
if (JSON.stringify(acceptanceIds.sort()) !== JSON.stringify(Object.keys(baselineCoverage).sort())) throw new Error("Baseline roster drift");

const conclusions = [
  "沿用三类能力：Domain 是宿主拥有的业务状态与行为，Contribution 是插件向宿主提供实现，Service 是有边界的平台操作。Schema 只约束声明，不是第四类权力。Agent 与插件是这套模型的两个消费维度，不是两套宿主模型。",
  "每项已盘点能力都已映射，但不宣称未知行为零遗漏或 API 全部可用。根因不是缺少一个万能 API，而是业务运行态未进域、生产/消费引用不闭合、接线与消费者分散、缺少行为级回归。",
  "本轮补出三组有真实消费者的设置遗漏：内容字体四字段、默认标注色、更新通道；细化模式位置恢复、聊天回合副作用与设备本地偏好；校正源码插件与编译内置插件的区别。",
  "不把每个 UI 按钮、临时计时器或内部 KV 都变成 API。先组合已有原语；仅补业务引用、状态/控制、授权、真实完成和生命周期等无法在插件可靠重建的部分。",
  "本文件是统一目标与取舍的入口；能力矩阵是当前接线事实，旧基线是验收条目与 GAP 证据。目标描述不能覆盖源码现状，原 GAP01–GAP18 没有因本轮文档关闭。",
];
const priorities = [
  ["P0", "真实效果与安全完成", "D5/S1/Q1–Q3", "修复/禁用十个无效果设置；写持久屏障、更新回滚、稳定错误、RPC 终态/配额、取消/撤权、过期结果和资源释放。安全缺口不能被丰富 API 掩盖。"],
  ["P1", "运行态闭合", "D1/D2/S3/V1", "统一 Location/Range、可定位 TOC/搜索、session 快照、导航完成和共享历史；然后接模式/朗读/临时强调与 UI。Jumper 作为组合验收，不把编号算法迁入宿主。"],
  ["P1", "已有行为对等接入", "D3–D6/S4/S9/S10", "补已有标注参数/ask 删除、聊天意图、真实设置字段、受权记忆读、资源选择/导出、同步状态和插件目录；不等于给模型开放每个底层方法。"],
  ["P2", "明确场景需要的扩展", "C1–C5/S8/V1", "补动态入口、计划可观察性、必要分页/树表格、类型化 provider 消费；词典/RSS 缺工具优先在插件补。无需求不建通用框架。"],
  ["独立产品工作", "宿主自身未完成功能", "D6/B1/OPS08", "画像实体投影、正式 context bundle、全量备份修复、Reveal；保留缺口，不要求先完成所有未来方向才能交付阅读插件。"],
];

let markdown = `# ${title}\n\n人读版：[统一模型与裁决](./host-capability-model.html)。现状：[宿主 × Agent × 插件能力矩阵](./host-capability-matrix.md)。验收证据：[旧基线与 GAP](./plugin-capability-baseline.md)。\n\n- 状态：**${status}**。\n- 最后核验日期：${date}。\n- 范围：当前 ReadAware Tauri 桌面宿主、已有第一方插件、产品内 Agent 工具与自动管线。排除外部 Coding Agent 的电脑权限、移动端遗留桥和未决定的新产品。\n- 事实源：本轮审计以 1d97e2e4 后工作区源码为准；目标源是 [host-capability-model.data.ts](./host-capability-model.data.ts)，接线源是 [host-capability-matrix.data.ts](./host-capability-matrix.data.ts)。\n- [代码] ${rows.length} 条现状证据映射到 ${units.length} 个责任单元；30 个当前 catalog 成员、129 个旧验收项、32 个旧场景全部反查。单元不是新 API 数，字段行不是独立产品功能。\n- [设计] 本文所有目标操作与分组迁移均未冒充现有 SDK；新 namespace 需在实现时经 catalog/permission/version/schema 统一落地。\n\n## 结论\n\n${conclusions.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n## 第一性原理\n\n插件能重建算法，不能重建宿主的事实与权力。书籍当前落点、真实持久成功、用户授权、焦点/播放所有权与跨设备合并是宿主事实。插件私自监听 DOM、复制数据库或猜一次 setTimeout 已完成，都会制造第二套真相。API 完备的目标是让这些事实有可组合契约，不是让沙箱拥有所有内部函数。\n\n[设计] 宿主行为集合 H 中，每个行为必须给出两端 disposition：直接操作、组合得到、自动消费、仅内部、明确拒绝、宿主未建。Agent 不必拥有每个方法的工具；插件不必拥有每个内部权限。两端共享 owner 和业务不变量，表达方式与审批策略可以不同。\n\n[代码] 旧架构的三类划分足以容纳当前行为；不足的是落实。reading 已在架构上拥有活跃阅读，却把实现留在 React/引擎闭包；services.session 只桥接未来事件，不能替代快照；Agent ports 和 plugin context 又各自选择性接线。文件中有类型/字段、Worker 可调用、host 消费和用户效果从未是同一证据。\n\n### 分类裁决\n\n| 问题 | 唯一语义所有权 | 例子 |\n| --- | --- | --- |\n| 产品已有的业务对象/状态/动作？ | Domain | reading 当前位置与播放，不因未持久化而改归 Service |\n| 插件提供新的实现/选择/内容？ | Contribution | TTS 合成、句段分段、RSS 内容、header action |\n| 请求宿主完成有边界的外部操作？ | Service | 文件选择、HTTP、密钥、宿主 UI 流程 |\n| 如何声明宿主呈现或配置？ | Schema，无新增权力 | 表单 onSubmit 仍经已授权 Domain/Service |\n| 各边界共同需要的执行规则？ | 跨切 Contract，不是新业务 namespace | revision、取消、lease、stable errors |\n| 是否应当完全开放？ | 明确 Boundary | 原始 SQL/密钥/事件写永不因“完备”而开放 |\n\n同一证据行可以含多个责任，例如书架布局偏好归 settings，当前选择集归 ui，书籍查询归 library；不能为追求一行一个分类把三者强行塞进 shelf 域。每个最终操作却只能有一个 owner。下面的单元只做责任分段，不新增平行 registry。\n\n## 共用契约\n\n[设计] 以下是实现验收要求，类型名是语义角色，不是本轮已经导出的 TypeScript 类型。\n\n| 契约 | 必须表达什么 | 不要求什么 |\n| --- | --- | --- |\n| 操作描述 | owner、稳定 ID/version、输入/输出 schema、actor scope/grant、风险、availability、消费者 | 每个 UI 按钮一个工具、每种算法一个宿主方法 |\n| Location/Range | bookId、内容版本、可由宿主验证的引擎定位载荷；Range 可无可渲染位置，但必须说明 | 替换 Foliate CFI 标准、插件自行编译定位器 |\n| 引用失效 | 不存在、无文本、不支持、stale、无权限区分；删书/重导向/换版本验证 | 旧 ordinal 在任意修订上永久有效 |\n| Session/资源 | sessionId/generation、owner、scope、availability；资源有 type/size 和有效性 | 可伪造的任意文件路径、DOM 引用、无限设备信息 |\n| 完成回执 | completed/result；cancelled；failed/AppError；受理与完成分开；业务空结果不是失败 | 导航派发就 opened:true；cancel 就全局回滚 |\n| 进度与取消 | 长任务进度可 unknown；abort/deadline/终态；跨 Worker 失联终结 pending | 所有短操作 TaskRef、全部任务耐久恢复 |\n| 观察 | snapshot + revision；本地/远端/外部变化失效；subscribe 竞态可重读收敛 | 通用事件日志重放、exactly-once 交付 |\n| 写入一致性 | commit 完成才确认；会丢修改的操作有版本条件；批次明确原子或逐项 | 暴露 SQLite transaction、任意跨插件分布式事务 |\n| 授权 | manifest 能力、对象/字段/资源范围、一次性用户批准分别建模；执行时复核 | UI 的 Yes 按钮等于权限票据、菜单可见就可调用 |\n| 生命周期 | plugin generation / view / task / provider session 有 owner；dispose 幂等 | 仅在整个插件 deactivate 时才清局部回调 |\n| 敏感信息 | 稳定错误 code；raw message 仅脱敏日志；未知费用/状态明确 unknown | 向模型或普通插件泄露 host key、log、token |\n\n## 统一责任模型\n\n每个单元的“目标操作、双端接入、限制、验收”均为 [设计]；对应 [代码] 现状在文末逐行反查。现有 catalog 的名称/版本仍以 packages/core 为准。\n`;
for (const u of units) {
  markdown += `\n### <a id="${u.id}"></a>${u.id} · ${u.family} · ${u.owner}\n\n**${u.title}**\n\n- 当前 catalog 身份：${u.catalog.map(c => `\`${c}\``).join("、") || "无对应现有 catalog 身份；目标责任或跨切边界，不是当前 API"}。\n- [设计] 操作：${u.operations}\n- [设计] Agent：${u.agent}\n- [设计] 插件：${u.plugin}\n- [设计] 限制/不建设：${u.limits}\n- [设计] 通过条件：${u.acceptance}\n- [代码] 现状证据：${evidenceLinks(u.refs)}。\n`;
}
markdown += `\n## 本轮深挖与收敛\n\n| 裁决 | 分类 | 证据 | 具体结论 |\n| --- | --- | --- | --- |\n${refinements.map(([id, kind, refs, text]) => `| ${id} | ${kind} | ${evidenceLinks(refs.split(" "))} | ${md(text)} |`).join("\n")}\n\n[代码] 本轮新增取证路径：\n\n${evidence.map(path => `- [${path}](../${path})`).join("\n")}\n\n[代码] CFG11/CFG12/CFG13 已在 settings 1.2 接通，九项新路径的双端和 macOS debug 效果证据见执行账本；未接通的其他目标操作仍是设计，不能只修改文档或 schema 当作实现。\n\n## 组合场景\n\n| 场景 | 责任单元 | 当前缺口与验收重点 |\n| --- | --- | --- |\n${scenarios.map(([name, ids, text]) => `| ${name} | ${links(ids.split(" "))} | ${md(text)} |`).join("\n")}\n\n### 旧 32 场景逐项保留\n\n[设计] 这些是验收用例，不是已经通过的测试；W12 的树/表仅补真实呈现需求，W14 不强迫提前建设正式 context bundle，W18 只做确有消费者的类型化组合。\n\n| 场景 | 名称 | 模型归属 | 原验收条件 |\n| --- | --- | --- | --- |\n${legacy.map(m => `| ${m[1]} | ${m[2]} | ${links(scenarioCoverage[m[1]])} | ${md(m[4])} |`).join("\n")}\n\n## 缺口分级与落地顺序\n\n| 优先级 | 工作 | 所有权 | 完成标准 |\n| --- | --- | --- | --- |\n${priorities.map(row => `| ${row.map(md).join(" | ")} |`).join("\n")}\n\n[设计] 不做大爆炸重写：先由现有 domains/registry 提炼业务控制器，再让宿主 UI、Agent port、plugin context 共用它；随单元迁移对应 tests/schema/catalog。reading 接管 session 事件，resources 接管文件字节/保存语义，版本化迁移所有第一方消费者，不长期维持新旧两套接口。本文新增四个目标入口（memory 域、resources/sync/plugins 服务）均来自已有数据或系统行为，不是要求现在全部实现。\n\n### 旧基线如何使用\n\n旧 E/P/M/B 是当时接口状态，不是本轮“必须新建”的裁决；以下 129 项全保留并映射。若目标规模与旧措辞不同，以本模型的限制列为准：任务不默认耐久、观察不默认重放、批次不默认全局事务、UI 不默认任意编辑器、组合不默认任意跨插件 RPC。GAP01–GAP18 是有源码证据的失败/安全问题，仍须实际修复和验收，不能用“避免过度设计”撤销。\n\n| 旧项 | 当前证据 | 统一模型归属 |\n| --- | --- | --- |\n${Object.entries(baselineCoverage).map(([id, refs]) => `| ${id} | ${evidenceLinks(refs)} | ${links([...new Set(refs.flatMap(ref => owners.get(ref)!))])} |`).join("\n")}\n\n## 双端现状反查\n\n[代码] 下表由同一事实源生成；“接通”表示已找到源码调用链，不代表本轮桌面验证。只要行内仍有缺口，不得用它的某个局部“接通”宣称整个功能完工。现有具体方法/消费者/源码与缺口全部保留，不把目标操作当当前接口。\n\n| 证据 | 能力/宿主 | Agent 当前 | 插件当前 | 消费者/缺口 | 模型 | 来源 |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows.map(r => `| ${r.id} | ${md(r.name)} / ${r.host} | ${r.agent.state}：${md(r.agent.via)} | ${r.plugin.state}：${md(r.plugin.via)} | ${md(r.consumers)}；${md(r.gap)} | ${links(owners.get(r.id)!)} | ${r.sources.map(key => `[${key}](../${sources[key]})`).join(" ")} |`).join("\n")}\n\n## 完备声明与验证边界\n\n能承诺的是：本次已识别的宿主行为、现有 catalog、旧验收条目都能在统一模型中找到 owner、双端 disposition 和边界。不能承诺未知源码行为已经被形式化穷尽，更不能承诺模型写完后任何插件无需宿主改动。只有目标原语真正实现、现有插件与 W01–W32 的相应成功/失败/并发/撤权路径通过，才可以对该范围承诺“新算法与组合不改宿主”。\n\n[代码/验证] 生成器验证证据/当前 catalog/旧验收与场景映射无孤项、catalog 单一 owner、两端目标/验收存在、来源路径有效与生成文档一致；反例测试覆盖漏项、重复归属、无效引用和空契约。它不解析所有 UI 语义，也不证明设计正确性或 product E2E。\n\n[环境] 本轮没有运行所有能力的真实 Tauri E2E、packaged CSP、跨设备同步、远端账号/支付/模型服务或用户插件安装态；已落地实现与 Jumper 等组合消费者的证据见执行账本，不把局部通过当作整体完成。静态 HTML 采用模板固定 CDN 字体/图标等资源，需要网络；无 Mermaid 图。文档浏览器验证只证明文档能读，不能证明产品能力。\n\n### 可复现检查\n\n\`\`\`sh\nbun scripts/build-host-capability-matrix.ts --check\nbun scripts/build-host-capability-model.ts --check\nbun test scripts/host-capability-model-check.test.ts\n\`\`\`\n\n编写新宿主行为时要同时运行两套检查；新增未映射行为必须评审分类与 actor disposition，不能仅把新 ID 加入数组以消除报错。新增插件算法先尝试以上场景链；缺口报告需要给出无法组合的宿主事实/权力以及最小缺失契约，而不是插件名称。\n`;

const detail = (id: string, label: string, body: string, terms = "") => `<details class="ep" id="${esc(id)}" data-search-section="${esc(terms)}"><summary>${esc(label)}</summary><div class="ep-body">${body}</div></details>`;
const sections = [
  ["model", "统一模型"], ["findings", "深挖与收敛"], ["scenarios", "组合场景"], ["priorities", "缺口顺序"], ["boundaries", "验证边界"],
];
const body = `<section id="model"><h2>统一模型</h2><p>Agent 与插件共用业务所有权，不共用所有权限。Schema 只描述呈现，Contract 只约束执行；两者都不是新增权力。</p>${["Domain", "Contribution", "Service", "Schema", "Contract", "Boundary"].map(family => `<h3>${family}</h3>${units.filter(u => u.family === family).map(u => detail(u.id, `${u.id} · ${u.title}`, `<p><strong>目标：</strong>${esc(u.operations)}</p><p><strong>边界：</strong>${esc(u.limits)}</p><p><a href="./host-capability-model.md#${u.id}">双端接入与通过条件</a></p>`, `${u.owner} ${u.agent} ${u.plugin} ${u.refs.join(" ")}`)).join("\n")}`).join("\n")}</section>
<section id="findings"><h2>深挖与收敛</h2>${refinements.map(([id, kind, refs, text]) => detail(id, `${kind} · ${text.split("；")[0].split("。")[0]}`, `<p>${esc(text)}</p><p><a href="./host-capability-matrix.html">现状证据：${esc(refs)}</a></p>`, `${kind} ${refs}`)).join("\n")}</section>
<section id="scenarios"><h2>组合场景</h2>${scenarios.map(([name, refs, text], i) => detail(`scenario-${i}`, name, `<p>${esc(text)}</p><p>${refs.split(" ").map(id => `<a href="#${id}" data-unit-link>${id}</a>`).join(" · ")}</p>`, `${name} ${refs}`)).join("\n")}</section>
<section id="priorities"><h2>缺口顺序</h2>${priorities.map(([p, name, refs, text], i) => detail(`priority-${i}`, `${p} · ${name}`, `<p>${esc(text)}</p><p>${esc(refs)}</p>`)).join("\n")}<p>先修效果、持久性和生命周期，再补运行态和对等入口。画像/实体投影、正式 context bundle 与完整备份是宿主独立工作，不是 Jumper 的前置条件。</p></section>
<section id="boundaries"><h2>验证边界</h2><p>${rows.length} 条证据、30 个当前 catalog 成员、129 个旧验收项、32 个旧场景都有模型归属；不等于所有未知行为零遗漏。</p><p>本轮仅完成源码审计、文档与映射检查；未修改宿主能力或实现 Jumper。未验证真实 Tauri 全能力、打包 CSP、跨设备同步、外部服务和用户插件安装态。</p><p>原 GAP01–GAP18 仍未关闭。静态文档浏览器检查不能替代产品验收；固定 CDN 字体/图标资源需要网络。本页无 Mermaid 图。</p></section>`;
const replacements: Record<string, string> = {
  TITLE: esc(title), STATUS: esc(status), DATE: date, BODY: body,
  NAV: sections.map(([id, label]) => `<a href="#${id}">${label}</a>`).join("\n"),
  CONCLUSION: esc(conclusions[0]),
};
let html = readFileSync("scripts/templates/host-capability-model.html", "utf8");
html = html.replace(/\{\{([A-Z]+)\}\}/g, (_, key) => {
  if (!(key in replacements)) throw new Error(`Unknown template token ${key}`);
  return replacements[key];
});
if (html.split("\n").length > 600) throw new Error("HTML line budget exceeded");
for (const [path, text] of Object.entries({ "docs/host-capability-model.md": markdown, "docs/host-capability-model.html": html })) {
  if (process.argv.includes("--check")) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== text) throw new Error(`Generated document drift: ${path}`);
  } else writeFileSync(path, text);
}
console.log(`${process.argv.includes("--check") ? "Verified" : "Generated"}: ${units.length} ownership units, ${rows.length} evidence rows, 30 catalog members, 129 acceptance items, ${legacy.length} scenarios.`);
