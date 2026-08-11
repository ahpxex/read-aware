import type { Locale } from "./i18n";

/**
 * The landing page's copy, one object per locale — the same shape the
 * changelog uses, so the three language versions can never drift apart
 * structurally. `HomePage` renders whichever entry its route hands it.
 */
export type HomeContent = {
  metaTitle: string;
  metaDescription: string;
  heroTitle: string;
  heroLead: string;
  /** The quiet line beside the download button; `tag` is the release tag. */
  freeLine: (tag: string | null) => string;
  shelfAlt: string;
  shelfCaption: string;
  readerTitle: string;
  readerBody: string;
  readerAlt: string;
  readerCaption: string;
  memoryTitle: string;
  memoryBody: string;
  contextAlt: string;
  contextCaption: string;
  inShortTitle: string;
  notes: { title: string; body: string }[];
  download: {
    title: string;
    intro: string;
    latest: (tag: string) => string;
    yourPlatform: string;
    comingSoon: string;
    download: string;
    downloadFor: (name: string) => string;
    choosePlatform: string;
    signingNote: string;
  };
};

export const HOME: Record<Locale, HomeContent> = {
  en: {
    metaTitle: "ReadAware — Reading that remembers",
    metaDescription:
      "An AI-native reading workspace. Context-rich reading and AI-assisted understanding for EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML, and PDF — local-first and private.",
    heroTitle: "Reading that remembers",
    heroLead:
      "ReadAware reads alongside you. It builds memory across your books, highlights, and conversations, so every page arrives with the context it deserves.",
    freeLine: (tag) => `Free and local-first${tag ? `. ${tag}.` : "."}`,
    shelfAlt:
      "The ReadAware library — a grid of book covers across many languages and formats.",
    shelfCaption: "Your library — every format in one place.",
    readerTitle: "A calm place to read anything",
    readerBody:
      "Import a file and start reading. There is no conversion and no cloud upload; your highlights, notes, and place in the book stay with the original text. When you want more focus, read sentence by sentence — the page holds back, a floating strip steps you through, and read-aloud can follow along.",
    readerAlt:
      "A page of Atomic Habits in the ReadAware reader, one sentence held in focus while the rest of the page recedes.",
    readerCaption: "Reading Atomic Habits one sentence at a time.",
    memoryTitle: "It remembers what you read",
    memoryBody:
      "Ask about a passage, a book, or your whole shelf. ReadAware draws on your highlights, notes, and earlier conversations, and keeps a durable memory of what matters, so it picks up where you left off.",
    contextAlt:
      "The ReadAware assistant surveying the reader's shelf and recent reading, and naming the thread that runs through it.",
    contextCaption: "The assistant, answering from your own shelf.",
    inShortTitle: "In short",
    notes: [
      {
        title: "One engine, every format",
        body: "EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML, and PDF open in the same reader, with the same selection, highlights, and progress. Nothing is converted; the original file is what you keep.",
      },
      {
        title: "Memory, not transcripts",
        body: "Reading becomes memory the app can hold onto. ReadAware keeps what matters and brings it back when it's relevant, instead of replaying a long chat history.",
      },
      {
        title: "Extended from the inside",
        body: "Sandboxed plugins from the built-in marketplace add read-aloud voices, dictionaries, reading themes, feeds that read like books — and new tools the assistant picks up and uses.",
      },
      {
        title: "Local-first and private",
        body: "Your library and your memory live on your device. You bring your own API key, and the cloud is only there to sync between machines.",
      },
    ],
    download: {
      title: "Get ReadAware",
      intro:
        "Free and local-first. Bring your own API key; your library and memory stay on your device.",
      latest: (tag) => ` The latest release is ${tag}.`,
      yourPlatform: "— your platform",
      comingSoon: "Coming soon",
      download: "Download",
      downloadFor: (name) => `Download for ${name}`,
      choosePlatform: "Choose a platform",
      signingNote:
        "Desktop builds aren't code-signed yet; macOS and Windows may ask you to confirm the app on first launch.",
    },
  },
  zh: {
    metaTitle: "ReadAware — 记得住的阅读",
    metaDescription:
      "AI 原生的阅读工作台。为 EPUB、MOBI、AZW3、FB2、CBZ、CBR、TXT、HTML、PDF 提供带上下文的阅读与 AI 辅助理解——本地优先，数据归你。",
    heroTitle: "记得住的阅读",
    heroLead:
      "ReadAware 陪着你读。它在你的书、划线和对话之间建立记忆，让每一页翻开时都带着应有的上下文。",
    freeLine: (tag) => `免费、本地优先${tag ? `，当前版本 ${tag}。` : "。"}`,
    shelfAlt: "ReadAware 书架——多语言、多格式的书籍封面网格。",
    shelfCaption: "你的书架——所有格式都在一处。",
    readerTitle: "安静地读任何书",
    readerBody:
      "导入文件就能开始读。没有格式转换，也没有云端上传；划线、笔记和阅读位置都附着在原文上。想更专注时，可以逐句阅读——页面退后一步，浮动条带你逐句前进，朗读也能跟着走。",
    readerAlt: "ReadAware 阅读器中的《掌控习惯》，一句话保持聚焦，其余文字退后。",
    readerCaption: "逐句阅读《掌控习惯》。",
    memoryTitle: "它记得你读过什么",
    memoryBody:
      "问一段话、一本书，或整个书架。ReadAware 会调用你的划线、笔记和过往对话，把重要的沉淀为持久记忆——从你上次停下的地方接着来。",
    contextAlt: "ReadAware 智能助理扫过书架与近期阅读，点出贯穿其中的那条线索。",
    contextCaption: "智能助理，凭你自己的书架作答。",
    inShortTitle: "简而言之",
    notes: [
      {
        title: "一个引擎，全部格式",
        body: "EPUB、MOBI、AZW3、FB2、CBZ、CBR、TXT、HTML、PDF 在同一个阅读器里打开，共用同一套选择、划线和进度。不做转换，你保留的就是原始文件。",
      },
      {
        title: "记忆，而非聊天记录",
        body: "阅读会变成应用能留住的记忆。ReadAware 记下重要的部分，在相关的时刻带回来，而不是回放冗长的聊天历史。",
      },
      {
        title: "从内部生长",
        body: "内置市场里的沙箱插件带来朗读声音、词典、阅读主题、像书一样读的订阅源——以及智能助理立刻会用的新工具。",
      },
      {
        title: "本地优先，数据归你",
        body: "书架和记忆都在你的设备上。API key 由你自己带，云端只负责在设备之间同步。",
      },
    ],
    download: {
      title: "获取 ReadAware",
      intro: "免费、本地优先。自带 API key；书架和记忆都留在你的设备上。",
      latest: (tag) => `当前版本 ${tag}。`,
      yourPlatform: "——你的平台",
      comingSoon: "即将推出",
      download: "下载",
      downloadFor: (name) => `下载 ${name} 版`,
      choosePlatform: "选择平台",
      signingNote:
        "桌面构建暂未代码签名；macOS 和 Windows 首次启动时可能需要你确认。",
    },
  },
  ja: {
    metaTitle: "ReadAware — 覚えている読書",
    metaDescription:
      "AIネイティブな読書ワークスペース。EPUB・MOBI・AZW3・FB2・CBZ・CBR・TXT・HTML・PDFに、文脈のある読書とAIによる理解を。ローカルファーストでプライベート。",
    heroTitle: "覚えている読書",
    heroLead:
      "ReadAwareはあなたと一緒に読みます。本・ハイライト・会話のあいだに記憶を育て、どのページにもふさわしい文脈を添えます。",
    freeLine: (tag) => `無料・ローカルファースト${tag ? `。最新版は ${tag}。` : "。"}`,
    shelfAlt: "ReadAwareのライブラリ——多言語・多形式の表紙が並ぶグリッド。",
    shelfCaption: "あなたのライブラリ——あらゆる形式をひとつの場所に。",
    readerTitle: "何でも静かに読める場所",
    readerBody:
      "ファイルを取り込めばすぐ読み始められます。変換もクラウドへのアップロードもなく、ハイライトやメモ、読書位置は原文に付いたまま。集中したいときは一文ずつ——ページは一歩引き、フローティングバーが文を進め、読み上げも並走します。",
    readerAlt:
      "ReadAwareのリーダーで開いた『Atomic Habits』。一文に焦点が当たり、残りの文章は後ろに引く。",
    readerCaption: "『Atomic Habits』を一文ずつ読む。",
    memoryTitle: "読んだことを覚えている",
    memoryBody:
      "一節でも、一冊でも、棚全体でも聞いてください。ReadAwareはあなたのハイライト・メモ・過去の会話を手がかりに、大事なことを持続する記憶として保ち、前回の続きから応えます。",
    contextAlt:
      "ReadAwareのアシスタントが棚と最近の読書を見渡し、そこを貫く一本の糸を言い当てる。",
    contextCaption: "アシスタントは、あなた自身の棚から答える。",
    inShortTitle: "要するに",
    notes: [
      {
        title: "ひとつのエンジン、すべての形式",
        body: "EPUB・MOBI・AZW3・FB2・CBZ・CBR・TXT・HTML・PDFが同じリーダーで開き、選択・ハイライト・進捗を共有します。変換はせず、手元に残るのは元のファイルです。",
      },
      {
        title: "履歴ではなく、記憶",
        body: "読書はアプリが保てる記憶になります。ReadAwareは大事なことを覚えておき、長いチャット履歴を再生する代わりに、関係する瞬間に持ち戻します。",
      },
      {
        title: "内側から広がる",
        body: "内蔵マーケットプレイスのサンドボックス化されたプラグインが、読み上げボイス・辞書・読書テーマ・本のように読めるフィード、そしてアシスタントがすぐ使いこなす新しいツールを加えます。",
      },
      {
        title: "ローカルファースト、プライベート",
        body: "ライブラリも記憶もあなたのデバイスに。APIキーは自分で用意し、クラウドはデバイス間の同期のためだけにあります。",
      },
    ],
    download: {
      title: "ReadAwareを入手",
      intro:
        "無料・ローカルファースト。APIキーは自分で用意し、ライブラリと記憶はデバイスに残ります。",
      latest: (tag) => `最新版は ${tag}。`,
      yourPlatform: "——お使いのプラットフォーム",
      comingSoon: "近日公開",
      download: "ダウンロード",
      downloadFor: (name) => `${name}版をダウンロード`,
      choosePlatform: "プラットフォームを選ぶ",
      signingNote:
        "デスクトップ版はまだコード署名されていません。macOSとWindowsでは初回起動時に確認を求められることがあります。",
    },
  },
};
