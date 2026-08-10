import type { Locale } from "./i18n";

/**
 * The changelog registry — one entry per shipped version, in all three
 * locales, rendered by `/changelog` and its `/zh` and `/ja` mirrors.
 *
 * Deliberately hand-written rather than pulled from the GitHub releases API
 * at build time. Two reasons: release notes are English-only, and this list
 * is for readers rather than for the record — it can drop the internal churn
 * a release inevitably carries and keep what someone would actually notice.
 * The GitHub release stays the complete account; this is the readable one.
 *
 * Adding a version means one entry here (all three locales) — no route files,
 * since the page renders the whole list. Newest first; the order in this
 * array is the order on the page.
 */

/**
 * `title` is the bolded lead-in a headline change gets ("Plugins."); items
 * without one read as a plain sentence, which is what Improved and Fixed
 * entries are. Group headings are not stored per entry — they are chrome,
 * and live in UI_STRINGS.
 */
export type ChangelogItem = { title?: string; body: string };

export type ChangelogGroupKind = "new" | "improved" | "fixed";

export type ChangelogGroup = {
  kind: ChangelogGroupKind;
  items: ChangelogItem[];
};

export type ChangelogText = {
  /** One paragraph on what this release is about, above the groups. */
  summary: string;
  groups: ChangelogGroup[];
};

export type ChangelogEntry = {
  /** Bare version, no leading "v" — the release tag is derived from it. */
  version: string;
  /** The minor series' verbal codename (0.4 = El Alto); shown beside the
   *  version on the first release of a series. Locale-invariant. */
  codename?: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  text: Record<Locale, ChangelogText>;
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.4.0",
    codename: "El Alto",
    date: "2026-08-10",
    text: {
      en: {
        summary:
          "The first release of the El Alto series, and a release about distance: the actions you need while reading moved onto the sentence itself, the panels worth opening moved one tap away, and the assistant stopped taking detours before answering.",
        groups: [
          {
            kind: "new",
            items: [
              {
                title: "Tap the sentence",
                body: "In sentence or paragraph reading, tapping the highlighted sentence opens its actions right there — copy, highlight, underline, note, ask AI, dictionary — instead of a reach for the bottom bar.",
              },
              {
                title: "Doors instead of a toolbar",
                body: "The floating navigator strip opens the table of contents, your notes, reading appearance, or chat in one tap, and pages itself on phones so it always fits one row.",
              },
              {
                title: "Updates introduce themselves",
                body: "After the app updates, a quiet link opens this changelog in your language. Dismiss it, or let it fade on its own after two days.",
              },
            ],
          },
          {
            kind: "improved",
            items: [
              {
                body: "The reading assistant answers in the language you write in, reports reading time in hours and minutes rather than raw counters, and no longer inventories your stats before answering a question about the book.",
              },
              {
                body: "Spoiler protection now also fences what the assistant may already know about a famous novel — nothing beyond your reading position, unless you explicitly ask to be spoiled.",
              },
            ],
          },
          {
            kind: "fixed",
            items: [
              {
                body: "External links — the About panel, the what's-new door — actually open your browser now.",
              },
              {
                body: "A pasted API key is refused without being echoed back into the conversation.",
              },
              { body: "Book cards can no longer be presented twice in one reply." },
            ],
          },
        ],
      },
      zh: {
        summary:
          "El Alto 系列的第一版，一个关于「距离」的版本：阅读时要用的动作长到了句子上，值得打开的面板一步直达，智能助理回答前也不再绕路。",
        groups: [
          {
            kind: "new",
            items: [
              {
                title: "点一下句子",
                body: "逐句/逐段阅读时，点按当前高亮的句子，复制、高亮、下划线、笔记、问 AI、词典就在句子旁弹出——不用再伸手够底部工具栏。",
              },
              {
                title: "工具栏变成几扇门",
                body: "浮动导航条可一步打开目录、笔记、阅读外观或对话；手机上自动分页，始终一行放得下。",
              },
              {
                title: "更新会自我介绍",
                body: "应用更新后会出现一条安静的入口，按你的语言打开这份更新日志。可以随手关掉，也可以放两天让它自己消失。",
              },
            ],
          },
          {
            kind: "improved",
            items: [
              {
                body: "智能助理用你提问的语言回答，阅读时长以小时分钟呈现而不是原始计数，回答书的问题前也不再先盘点一遍你的统计数据。",
              },
              {
                body: "防剧透现在同样约束助理自己「读过」的名著记忆——不越过你的阅读位置半步，除非你明确要求剧透。",
              },
            ],
          },
          {
            kind: "fixed",
            items: [
              { body: "外部链接（关于页、更新日志入口）现在真的会打开浏览器了。" },
              { body: "粘贴 API 密钥请求保存时会被拒绝，且密钥不会被复述回对话里。" },
              { body: "同一条回复里不会再出现重复的书籍卡片。" },
            ],
          },
        ],
      },
      ja: {
        summary:
          "El Alto シリーズ最初のリリース。テーマは「距離」——読書中に使う操作は文そのものの上へ、開きたいパネルはワンタップ先へ、そしてアシスタントは回り道をせずに答えるようになりました。",
        groups: [
          {
            kind: "new",
            items: [
              {
                title: "文をタップ",
                body: "文・段落ナビゲーターで、ハイライト中の文をタップするとその場でアクションが開きます——コピー、ハイライト、下線、メモ、AI に質問、辞書。下部バーまで手を伸ばす必要はもうありません。",
              },
              {
                title: "ツールバーは扉に",
                body: "フローティングのナビゲーターバーから目次・メモ・表示設定・チャットをワンタップで開けます。スマートフォンでは自動でページ分割され、常に一行に収まります。",
              },
              {
                title: "アップデートの自己紹介",
                body: "アプリの更新後、静かなリンクが現れ、アプリの言語に合わせてこの更新履歴を開きます。閉じてもよし、二日ほどで自然に消えるのを待ってもよし。",
              },
            ],
          },
          {
            kind: "improved",
            items: [
              {
                body: "リーディングアシスタントは質問と同じ言語で答え、読書時間を生のカウンターではなく時間と分で伝え、本についての質問に答える前に統計を棚卸しすることもなくなりました。",
              },
              {
                body: "ネタバレ保護は、アシスタント自身が「知っている」有名作品の記憶にも柵をかけます——明示的にネタバレを求めない限り、読書位置より先には踏み込みません。",
              },
            ],
          },
          {
            kind: "fixed",
            items: [
              { body: "外部リンク（About パネル、更新履歴の入口）が実際にブラウザで開くようになりました。" },
              { body: "API キーの保存依頼は、キーを会話に復唱することなく断られます。" },
              { body: "同じ返信の中で本のカードが二度表示されることはなくなりました。" },
            ],
          },
        ],
      },
    },
  },
  {
    version: "0.3.1",
    date: "2026-08-10",
    text: {
      en: {
        summary:
          "A release about PDFs, and about the reader chrome knowing when to get out of the way. A PDF page is a picture, so the page color never reached it and every fixed-layout book stayed on white paper inside a dark app — that is fixed, along with the controls those books were offering but could not honor.",
        groups: [
          {
            kind: "new",
            items: [
              {
                title: "PDFs follow the page color",
                body: "A light palette tints the paper as the page is drawn, leaving every ink and photograph exactly as printed. A dark palette redraws the page in two tones, so the text stays readable instead of sitting as black ink on a dark sheet.",
              },
              {
                title: "Page Rendering",
                body: "Keep a book on its original colors while everything else follows your palette. Remembered per book, for the art and photography where the color is the point.",
              },
            ],
          },
          {
            kind: "improved",
            items: [
              {
                body: "Fixed-layout books no longer offer typography they cannot honor. A PDF or comic is a sequence of pages someone else already typeset, so font, size, weight, spacing, alignment and margins are gone for those books. Page color and reading mode stay, because both still do visible work.",
              },
            ],
          },
          {
            kind: "fixed",
            items: [
              {
                body: "The reader toolbar no longer flashes up and vanishes a moment after you tap the page. Anything that re-flows the text — the soft keyboard, rotating the device, changing the font size — was being mistaken for a page turn.",
              },
              {
                body: "The chat composer takes the caret when you open the panel, not every time the toolbar reappears. On a phone that had been throwing the keyboard over a page you only meant to glance at.",
              },
            ],
          },
        ],
      },
      zh: {
        summary:
          "这一版关于 PDF，也关于阅读界面知道什么时候该让开。PDF 的页面是一张图，页面颜色一直进不去，深色主题下固定版式书籍始终是一张白纸——这次修好了，那些书里给了却根本不生效的设置也一并收掉。",
        groups: [
          {
            kind: "new",
            items: [
              {
                title: "PDF 跟随页面颜色",
                body: "浅色主题在绘制时直接染纸，墨色和照片与印刷时一模一样；深色主题把整页重绘为双色调，文字保持可读，而不是黑字压在深色纸上。",
              },
              {
                title: "页面渲染",
                body: "让某本书保持原有色彩，其余书籍照常跟随主题。按书记住，留给色彩本身就是内容的画册和摄影集。",
              },
            ],
          },
          {
            kind: "improved",
            items: [
              {
                body: "固定版式书籍不再提供无法生效的排版设置。PDF 和漫画是别人排好的一页页图像，字体、字号、字重、间距、对齐和页边距因此在这些书里隐去。页面颜色和阅读模式保留，因为它们确实还起作用。",
              },
            ],
          },
          {
            kind: "fixed",
            items: [
              {
                body: "点击页面后工具栏不再一闪而过。任何让正文重排的动作——软键盘弹起、旋转屏幕、调整字号——此前都会被误判成翻页。",
              },
              {
                body: "对话输入框只在你主动打开面板时获得焦点，而不是每次唤出工具栏都抢一次。在手机上，那意味着键盘会盖住你只是想看一眼的页面。",
              },
            ],
          },
        ],
      },
      ja: {
        summary:
          "PDF についての、そして読書画面が引くべきタイミングを覚えるためのリリースです。PDF のページは画像なのでページカラーが届かず、ダークテーマでも固定レイアウトの本は白い紙のままでした。今回それを直し、あわせて効かない設定を出していた箇所も片付けています。",
        groups: [
          {
            kind: "new",
            items: [
              {
                title: "PDF がページカラーに従う",
                body: "明るいパレットは描画時に紙そのものを染めるため、インクも写真も印刷どおりに残ります。暗いパレットではページを2階調で描き直すので、暗い紙に黒い文字が乗ったままにならず読めます。",
              },
              {
                title: "ページの描画",
                body: "ほかの本はパレットに従わせたまま、その本だけ元の色を保てます。設定は本ごとに記憶されるので、色そのものが作品である画集や写真集に向いています。",
              },
            ],
          },
          {
            kind: "improved",
            items: [
              {
                body: "固定レイアウトの本では、効かない組版設定を出さなくなりました。PDF やコミックは他者が組み終えたページの連なりなので、フォント・サイズ・ウェイト・行間・揃え・余白は非表示になります。ページカラーと読書モードは実際に効くため残ります。",
              },
            ],
          },
          {
            kind: "fixed",
            items: [
              {
                body: "ページをタップした直後にツールバーが一瞬で消えなくなりました。ソフトキーボード、画面の回転、文字サイズの変更——本文が再流し込みされる操作が、これまではページ送りと誤認されていました。",
              },
              {
                body: "チャットの入力欄は、パネルを開いたときだけカーソルを受け取ります。ツールバーを出すたびに奪うことはありません。スマートフォンでは、少し眺めたいだけのページにキーボードがかぶさっていました。",
              },
            ],
          },
        ],
      },
    },
  },
  {
    version: "0.3.0",
    date: "2026-08-07",
    text: {
      en: {
        summary:
          "The release where the app stops being a fixed set of features and becomes something you extend. Plugins run in real sandboxes, contribute to almost every surface, and ship through a marketplace. The agent grows tools and traces, the reader grows an ending, and both the book and the conversation are now yours to typeset.",
        groups: [
          {
            kind: "new",
            items: [
              {
                title: "Plugins",
                body: "A full plugin system: sandboxed workers with permission-gated capabilities, a TypeScript-first authoring path, and a marketplace with install-time consent. Plugins contribute reader menus, headers, command-palette entries, whole pages, AI tools, dictionary lookups, themes and bundled fonts, voice engines, scheduled tasks, and even virtual books that live on your shelf like any other title. Five ship built in — Dictionary, RSS Reader, Sentence Reader, TTS Voices, and Editorial Themes.",
              },
              {
                title: "Read-aloud",
                body: "The reader speaks, following the same sentence and paragraph navigator you read by. Any TTS engine can plug in, with per-provider voices and custom endpoints.",
              },
              {
                title: "An ending",
                body: "Finishing a book now lands on an end-of-book screen instead of a dead stop, with an optional look back written by the agent.",
              },
              {
                title: "Agent as a destination",
                body: "The agent gets its own primary page with multiple threads, grounding in where you actually are in the book, expandable execution traces, and tools that can safely read and change your settings.",
              },
              {
                title: "More formats",
                body: "CBZ, CBR, TXT, and HTML join EPUB, MOBI, AZW3, FB2, and PDF. Covers and metadata fill in at import.",
              },
              {
                title: "Make it yours",
                body: "Primary navigation and every menu surface are drag-arrangeable. The command palette works while reading, and Mod+1..9 jumps between destinations.",
              },
              {
                title: "Typography for the app, not just the book",
                body: "Chat replies, notes, and plugin views get their own font, size, and line spacing — following your reading settings by default, or detached if you'd rather. Text alignment becomes a reading setting too, defaulting to whatever the publisher chose.",
              },
            ],
          },
          {
            kind: "improved",
            items: [
              { body: "The progress bar in the reader header is a scrubber you can drag." },
              { body: "Fixed-layout books (PDF, comics) take annotations and swipe page turns." },
              {
                body: "AI provider setup is simpler, remembers a model per provider, and supports per-tier thinking effort for smart and fast models.",
              },
              {
                body: "Your API key is encrypted at rest, and AI requests route through native HTTP instead of the webview.",
              },
              {
                body: "All state changes are event-sourced: projections rebuild from an append-only log and can be verified against it.",
              },
              { body: "The shelf grid fills wide windows, and book titles from file names come out clean." },
              { body: "The desktop app inherits your macOS system proxy." },
              {
                body: "Dev builds get their own identity and data directory, so they no longer share the release app's library.",
              },
              {
                body: "Docs and blog on readaware.app are now available in English, Simplified Chinese, and Japanese.",
              },
            ],
          },
          {
            kind: "fixed",
            items: [
              {
                body: "Books whose stylesheets pin a near-black text color are no longer invisible on the dark page color — a whole class of calibre-converted EPUBs was unreadable in dark mode.",
              },
              {
                body: "EPUB 3 inline footnote bodies stay hidden and open in a popover, instead of dumping a chapter's worth of notes into the prose.",
              },
              {
                body: "The line-spacing setting now works on books that declare their own line height on paragraphs, where it previously did nothing at all.",
              },
              { body: "Chapter headings in real-world .txt files are recognized." },
              {
                body: "Android ships with its built-in plugins, and serves plugin assets over the scheme it actually uses.",
              },
              { body: "The marketplace remembers the last mirror that worked." },
              { body: "Stray taps on the reader's progress bar no longer seek on touch devices." },
              {
                body: "Plugin pages scroll as pages, virtual rows re-measure when content above them changes, and open settings forms adopt external writes instead of shadowing them.",
              },
              {
                body: "Marketplace file paths are allowlist-validated, closing a Windows drive-relative path bypass.",
              },
            ],
          },
        ],
      },
      zh: {
        summary:
          "ReadAware 从「一组固定功能」变成「你可以扩展的东西」的那一版。插件跑在真正的沙箱里，能贡献到几乎每一个界面，并通过市场分发。智能助理长出了工具与执行轨迹，阅读器长出了结尾，而书与对话的排版，现在都归你说了算。",
        groups: [
          {
            kind: "new",
            items: [
              {
                title: "插件系统",
                body: "一套完整的插件体系 —— 沙箱化 worker、按权限放行的能力面、TypeScript 优先的开发路径，以及带安装前授权确认的插件市场。插件可以贡献阅读器菜单、页首、命令面板条目、整张页面、AI 工具、词典查询、主题与自带字体、语音引擎、定时任务，甚至是像普通书一样躺在书架上的虚拟书。五个内置插件随包发布 —— 词典、RSS Reader、Sentence Reader、TTS Voices、Editorial Themes。",
              },
              {
                title: "朗读",
                body: "阅读器会开口。朗读搭在你阅读时用的逐句／逐段导航之上，任何 TTS 引擎都能接入，支持按提供方配置声音和自定义端点。",
              },
              {
                title: "一个结尾",
                body: "读完一本书不再是戛然而止，而是落在书末页上，可以让智能助理为你写一份回顾。",
              },
              {
                title: "智能助理成为主目的地",
                body: "助理有了自己的主页面，支持多线程；它知道你此刻读到哪里，执行轨迹可以展开查看，还有一组能安全读写你设置的工具。",
              },
              {
                title: "更多格式",
                body: "CBZ、CBR、TXT、HTML 加入 EPUB、MOBI、AZW3、FB2、PDF 的行列。封面与元信息在导入时补全。",
              },
              {
                title: "按你的习惯摆",
                body: "主导航和每一处菜单界面都能拖拽排列。命令面板在阅读时也能用，Mod+1..9 直接跳到第 N 个主目的地。",
              },
              {
                title: "应用本身也有排版了，不只是书",
                body: "对话回复、笔记、插件视图有了自己的字体、字号和行距 —— 默认跟随你的阅读设置，也可以断开单独调。对齐方式同样成为阅读设置的一项，默认遵从原书。",
              },
            ],
          },
          {
            kind: "improved",
            items: [
              { body: "阅读器顶栏的进度条成了可以拖动的进度滑块。" },
              { body: "固定版式的书（PDF、漫画）支持标注和滑动翻页。" },
              {
                body: "AI 提供方配置更简单，会按提供方分别记住模型，Smart 与 Fast 模型可分别设置思考强度。",
              },
              { body: "API 密钥加密存储，AI 请求走原生 HTTP 而非 webview。" },
              { body: "所有状态变更都是事件溯源的：投影可以从只追加的日志重建，并与日志比对校验。" },
              { body: "书架网格会填满宽窗口，从文件名生成的书名也干净了。" },
              { body: "桌面端会继承 macOS 的系统代理设置。" },
              { body: "开发版有了独立的身份标识和数据目录，不再和正式版共用书库。" },
              { body: "readaware.app 的文档与博客现已提供英文、简体中文和日文三个版本。" },
            ],
          },
          {
            kind: "fixed",
            items: [
              {
                body: "样式表把文字颜色钉死成近黑色的书，在深色页面配色下不再是一片漆黑 —— 一大批 calibre 转换出来的 EPUB 此前在深色模式下完全无法阅读。",
              },
              {
                body: "EPUB 3 的内联注释体会正确隐藏并在弹层中打开，不再把整章注文倾泻进正文。",
              },
              {
                body: "行距设置在那些自己给段落声明了行高的书上终于生效了 —— 此前完全无动于衷。",
              },
              { body: "能识别真实 .txt 文件里的章节标题了。" },
              { body: "Android 端会随包携带内置插件，并按它实际使用的协议提供插件资源。" },
              { body: "插件市场会记住上一次可用的镜像。" },
              { body: "触摸设备上误触阅读器进度条不再跳转位置。" },
              {
                body: "插件页面按整页滚动；上方内容变化时虚拟列表行会重新测量；已打开的设置表单会接受外部写入而不是把它盖掉。",
              },
              { body: "插件市场的文件路径改为白名单校验，堵上了 Windows 盘符相对路径的绕过。" },
            ],
          },
        ],
      },
      ja: {
        summary:
          "アプリが「決まった機能の集まり」であることをやめ、あなたが拡張できるものになった版です。プラグインは本物のサンドボックスで動き、ほぼすべての画面に機能を追加でき、マーケットプレイスから配布されます。エージェントはツールと実行トレースを、リーダーは終わりを手に入れ、本も会話も、組版はあなたが決めるものになりました。",
        groups: [
          {
            kind: "new",
            items: [
              {
                title: "プラグイン",
                body: "本格的な仕組みが入りました。サンドボックス化されたワーカー、権限で制御される能力、TypeScriptを前提とした開発体験、そしてインストール時に同意を求めるマーケットプレイス。プラグインはリーダーのメニュー、ヘッダー、コマンドパレットの項目、ページ全体、AIツール、辞書検索、テーマと同梱フォント、音声エンジン、定期実行タスク、さらには本棚に普通の本と同じように並ぶ仮想書籍まで提供できます。5つが内蔵として同梱されます — Dictionary、RSS Reader、Sentence Reader、TTS Voices、Editorial Themes。",
              },
              {
                title: "読み上げ",
                body: "リーダーが声を持ちました。読み上げは、読むときに使う文単位・段落単位のナビゲーターに乗ります。どのTTSエンジンも接続でき、プロバイダーごとの音声とカスタムエンドポイントに対応します。",
              },
              {
                title: "終わり",
                body: "本を読み終えたとき、ぷつりと途切れる代わりに読了画面に着きます。エージェントによる振り返りを書かせることもできます。",
              },
              {
                title: "エージェントが主要な行き先に",
                body: "エージェント専用のページができ、複数スレッドに対応します。あなたが本のどこにいるかを踏まえて答え、実行トレースは展開して確認でき、設定を安全に読み書きするツールを備えています。",
              },
              {
                title: "対応形式の追加",
                body: "CBZ、CBR、TXT、HTMLが、EPUB、MOBI、AZW3、FB2、PDFに加わりました。表紙とメタ情報はインポート時に補完されます。",
              },
              {
                title: "自分の並びにする",
                body: "主要ナビゲーションとすべてのメニュー画面をドラッグで並べ替えられます。コマンドパレットは読書中にも使え、Mod+1..9で行き先を切り替えられます。",
              },
              {
                title: "本だけでなく、アプリ自体にも組版を",
                body: "チャットの返信、ノート、プラグインの表示に、独自のフォント・サイズ・行間が入りました。既定では読書設定に追従し、切り離して個別に調整することもできます。行揃えも読書設定の一項目になり、既定は原書のままです。",
              },
            ],
          },
          {
            kind: "improved",
            items: [
              { body: "リーダーのヘッダーにある進捗バーが、ドラッグできるスクラバーになりました。" },
              { body: "固定レイアウトの本（PDF、コミック）で注釈とスワイプめくりが使えます。" },
              {
                body: "AIプロバイダーの設定が簡単になり、プロバイダーごとにモデルを記憶し、スマートモデルと高速モデルで思考の深さを別々に設定できます。",
              },
              {
                body: "APIキーは暗号化して保存され、AIリクエストはwebviewではなくネイティブHTTPを経由します。",
              },
              {
                body: "状態の変更はすべてイベントソーシングされます。投影は追記専用ログから再構築でき、ログと突き合わせて検証できます。",
              },
              { body: "本棚のグリッドが広いウィンドウを埋めるようになり、ファイル名由来の書名も整いました。" },
              { body: "デスクトップ版がmacOSのシステムプロキシ設定を引き継ぎます。" },
              {
                body: "開発ビルドが独自の識別子とデータディレクトリを持つようになり、リリース版とライブラリを共有しなくなりました。",
              },
              {
                body: "readaware.appのドキュメントとブログが、英語・簡体字中国語・日本語で読めるようになりました。",
              },
            ],
          },
          {
            kind: "fixed",
            items: [
              {
                body: "スタイルシートが文字色をほぼ黒に固定している本が、暗いページ色で見えなくなることはなくなりました。calibreで変換されたEPUBの多くが、ダークモードでは全く読めない状態でした。",
              },
              {
                body: "EPUB 3のインライン脚注本文は隠されたままポップオーバーで開きます。章まるごとの注釈が本文に流れ込むことはなくなりました。",
              },
              {
                body: "段落に独自の行高を指定している本でも、行間の設定が効くようになりました。以前はまったく反応しませんでした。",
              },
              { body: "実際の.txtファイルにある章見出しを認識します。" },
              {
                body: "Android版が内蔵プラグインを同梱し、実際に使うスキームでプラグインのアセットを配信します。",
              },
              { body: "マーケットプレイスが、最後に成功したミラーを記憶します。" },
              { body: "タッチ端末で進捗バーに誤って触れても、位置が飛ばなくなりました。" },
              {
                body: "プラグインのページはページ全体としてスクロールし、上の内容が変わると仮想リストの行が測り直され、開いている設定フォームは外部からの書き込みを上書きせず受け入れます。",
              },
              {
                body: "マーケットプレイスのファイルパスを許可リストで検証し、Windowsのドライブ相対パスによる回避を塞ぎました。",
              },
            ],
          },
        ],
      },
    },
  },
];
