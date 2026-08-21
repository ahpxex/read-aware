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
  pluginTitle: string;
  pluginBody: string;
  pluginAlt: string;
  pluginCaption: string;
  syncTitle: string;
  syncBody: string;
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
    metaTitle: "ReadAware — Free, Open-Source Ebook Reader That's Aware of You",
    metaDescription:
      "A free, open-source ebook reader for Windows, macOS, Linux, and Android. One reader for EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML, and PDF that builds memory from your reading, grows through plugins, and syncs end-to-end encrypted — local-first and private.",
    heroTitle: "An ebook reader that's aware of you — and yours to extend",
    heroLead:
      "Ask about any passage — ReadAware already knows what you've highlighted, wondered about, and read, across every book on your shelf. That awareness lives on your device, grows through plugins, and follows you — encrypted — to every machine.",
    freeLine: (tag) => `Free, open source, local-first${tag ? `. ${tag}.` : "."}`,
    shelfAlt:
      "The ReadAware library — a grid of book covers across many languages and formats.",
    shelfCaption: "Your library — every format in one place.",
    readerTitle: "A calm place to read anything",
    readerBody:
      "Import a file and start reading. There is no conversion and no cloud upload; your highlights, notes, and place in the book stay with the original text. When you want more focus, read sentence by sentence — the page holds back, a floating strip steps you through, and read-aloud can follow along.",
    readerAlt:
      "A page of Pride and Prejudice in the ReadAware reader, one sentence held in focus while the rest of the page recedes.",
    readerCaption: "Reading Pride and Prejudice one sentence at a time.",
    memoryTitle: "It's aware of what you've read",
    memoryBody:
      "Ask about a passage, a book, or your whole shelf. ReadAware answers from your own reading — the line you marked three books ago, the question you asked last week, the thread that runs through everything on your shelf. It doesn't replay a chat history; it keeps a durable memory of what matters and brings it back at the moment it's relevant.",
    contextAlt:
      "The ReadAware assistant surveying the reader's shelf and recent reading, and naming the thread that runs through it.",
    contextCaption: "The assistant, answering from your own shelf.",
    pluginTitle: "Extended from the inside",
    pluginBody:
      "Sandboxed plugins from the built-in marketplace add read-aloud voices, dictionaries, reading themes, feeds that read like books. And they reach deeper than features: a plugin can hand the assistant a new tool, and it simply starts using it. The reader doesn't just gain buttons — it learns new skills.",
    pluginAlt:
      "The ReadAware plugin panel — dictionary, themes, and RSS reader installed, each in its own sandbox, some handing the assistant new tools.",
    pluginCaption: "Voices, dictionaries, themes, feeds — and tools the assistant picks up.",
    syncTitle: "Your reading follows you",
    syncBody:
      "Open ReadAware on another machine and everything is already there — your books, your highlights, your place in each of them, and the memory built from all of it. Sync is end-to-end encrypted: the relay only ever stores ciphertext, so nobody in the middle can read what you read. Desktop and Android today; iOS is on the way.",
    inShortTitle: "In short",
    notes: [
      {
        title: "One engine, every format",
        body: "EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML, and PDF open in the same reader, with the same selection, highlights, and progress. Nothing is converted; the original file is what you keep.",
      },
      {
        title: "Aware, not archival",
        body: "Reading becomes memory the app can act on. ReadAware keeps what matters and surfaces it when it's relevant — it's there in the moment, not filed away.",
      },
      {
        title: "Plugins teach it new skills",
        body: "Marketplace plugins add voices, dictionaries, themes, and feeds — and hand the assistant tools it picks up and uses.",
      },
      {
        title: "Open source, local-first, encrypted sync",
        body: "The code is public under AGPL-3.0, and everything lives on your device. Bring your own API key; the cloud is only an encrypted relay between your machines.",
      },
    ],
    download: {
      title: "Get ReadAware",
      intro:
        "Free, open source, and local-first. Bring your own API key; your library and memory stay on your device.",
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
    metaTitle: "ReadAware — 懂你的免费开源电子书阅读器",
    metaDescription:
      "免费开源的电子书阅读器，支持 Windows、macOS、Linux 和 Android。一个阅读器读遍 EPUB、MOBI、AZW3、FB2、CBZ、CBR、TXT、HTML、PDF，从你的阅读中长出记忆，靠插件生长，端到端加密同步——本地优先，数据归你。",
    heroTitle: "懂你的电子书阅读器，由你扩展",
    heroLead:
      "问任何一段文字——ReadAware 早已知道你在整个书架上划过什么、问过什么、读过什么。这份「懂」留在你的设备上，靠插件生长，也会加密着跟你到每一台机器。",
    freeLine: (tag) => `免费开源、本地优先${tag ? `，当前版本 ${tag}。` : "。"}`,
    shelfAlt: "ReadAware 书架——多语言、多格式的书籍封面网格。",
    shelfCaption: "你的书架——所有格式都在一处。",
    readerTitle: "安静地读任何书",
    readerBody:
      "导入文件就能开始读。没有格式转换，也没有云端上传；划线、笔记和阅读位置都附着在原文上。想更专注时，可以逐句阅读——页面退后一步，浮动条带你逐句前进，朗读也能跟着走。",
    readerAlt: "ReadAware 阅读器中的《傲慢与偏见》，一句话保持聚焦，其余文字退后。",
    readerCaption: "逐句阅读《傲慢与偏见》。",
    memoryTitle: "它知道你读过什么",
    memoryBody:
      "问一段话、一本书，或整个书架。ReadAware 用你自己的阅读来回答——三本书之前你划下的那句话、上周你问过的那个问题、贯穿整个书架的那条线索。它不回放聊天记录，而是把重要的沉淀为持久记忆，在相关的时刻带回来。",
    contextAlt: "ReadAware 智能助理扫过书架与近期阅读，点出贯穿其中的那条线索。",
    contextCaption: "智能助理，凭你自己的书架作答。",
    pluginTitle: "从内部生长",
    pluginBody:
      "内置市场里的沙箱插件带来朗读声音、词典、阅读主题、像书一样读的订阅源。而且插件能到得更深：它可以交给智能助理一个新工具，助理拿起来就用。这个阅读器长出的不只是按钮——是新本事。",
    pluginAlt:
      "ReadAware 插件面板——词典、主题、RSS 阅读器各自装在沙箱里，有的还给智能助理带来新工具。",
    pluginCaption: "声音、词典、主题、订阅源——还有交到助理手里的新工具。",
    syncTitle: "你的阅读跟着你走",
    syncBody:
      "在另一台机器上打开 ReadAware，一切已经就位——你的书、划线、每本书读到的位置，以及由此长出的记忆。同步是端到端加密的：中继服务器只存密文，路上没有任何人能看到你读了什么。桌面和 Android 现已可用；iOS 在路上。",
    inShortTitle: "简而言之",
    notes: [
      {
        title: "一个引擎，全部格式",
        body: "EPUB、MOBI、AZW3、FB2、CBZ、CBR、TXT、HTML、PDF 在同一个阅读器里打开，共用同一套选择、划线和进度。不做转换，你保留的就是原始文件。",
      },
      {
        title: "懂你，而非存档",
        body: "阅读会变成应用能使用的记忆。ReadAware 记下重要的部分，在相关的时刻拿出来——它在场，而不是躺在档案里。",
      },
      {
        title: "插件教它新本事",
        body: "市场里的插件带来声音、词典、主题和订阅源——还会把新工具交到智能助理手里，它拿起来就用。",
      },
      {
        title: "开源、本地优先，加密同步",
        body: "代码以 AGPL-3.0 公开，一切都在你的设备上。API key 由你自己带；云端只是设备之间的一条加密中继。",
      },
    ],
    download: {
      title: "获取 ReadAware",
      intro: "免费开源、本地优先。自带 API key；书架和记忆都留在你的设备上。",
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
    metaTitle: "ReadAware — あなたを知る無料・オープンソースの電子書籍リーダー",
    metaDescription:
      "無料・オープンソースの電子書籍リーダー。Windows・macOS・Linux・Androidに対応し、EPUB・MOBI・AZW3・FB2・CBZ・CBR・TXT・HTML・PDFをひとつのリーダーで読み、読書から記憶を育て、プラグインで広がり、エンドツーエンド暗号化で同期。ローカルファーストでプライベート。",
    heroTitle: "あなたを知り、あなたが広げる電子書籍リーダー",
    heroLead:
      "どの一節について聞いても——ReadAwareは、棚のすべての本であなたが引いたライン、抱いた問い、読んだページをすでに知っています。その「知っている」はあなたのデバイスに宿り、プラグインで育ち、暗号化されたままどのマシンにもついてきます。",
    freeLine: (tag) => `無料・オープンソース・ローカルファースト${tag ? `。最新版は ${tag}。` : "。"}`,
    shelfAlt: "ReadAwareのライブラリ——多言語・多形式の表紙が並ぶグリッド。",
    shelfCaption: "あなたのライブラリ——あらゆる形式をひとつの場所に。",
    readerTitle: "何でも静かに読める場所",
    readerBody:
      "ファイルを取り込めばすぐ読み始められます。変換もクラウドへのアップロードもなく、ハイライトやメモ、読書位置は原文に付いたまま。集中したいときは一文ずつ——ページは一歩引き、フローティングバーが文を進め、読み上げも並走します。",
    readerAlt:
      "ReadAwareのリーダーで開いた『高慢と偏見』。一文に焦点が当たり、残りの文章は後ろに引く。",
    readerCaption: "『高慢と偏見』を一文ずつ読む。",
    memoryTitle: "読んだことを、知っている",
    memoryBody:
      "一節でも、一冊でも、棚全体でも聞いてください。ReadAwareはあなた自身の読書から答えます——三冊前に引いたあの一行、先週の問い、棚全体を貫く一本の糸。チャット履歴を再生するのではなく、大事なことを持続する記憶として保ち、関係する瞬間に持ち戻します。",
    contextAlt:
      "ReadAwareのアシスタントが棚と最近の読書を見渡し、そこを貫く一本の糸を言い当てる。",
    contextCaption: "アシスタントは、あなた自身の棚から答える。",
    pluginTitle: "内側から広がる",
    pluginBody:
      "内蔵マーケットプレイスのサンドボックス化されたプラグインが、読み上げボイス・辞書・読書テーマ・本のように読めるフィードを加えます。しかもプラグインはもっと深くまで届きます。アシスタントに新しいツールを手渡せば、アシスタントはすぐに使い始める——このリーダーが増やすのはボタンではなく、できることそのものです。",
    pluginAlt:
      "ReadAwareのプラグインパネル——辞書・テーマ・RSSリーダーがそれぞれサンドボックスで動き、アシスタントに新しいツールを渡すものもある。",
    pluginCaption: "ボイス・辞書・テーマ・フィード——そしてアシスタントの手に渡るツール。",
    syncTitle: "あなたの読書は、ついてくる",
    syncBody:
      "別のマシンでReadAwareを開けば、すべてがもうそこにあります——本、ハイライト、それぞれの読みかけの位置、そこから育った記憶まで。同期はエンドツーエンドで暗号化され、中継サーバーには暗号文しか置かれません。途中の誰にも、あなたが何を読んでいるかは見えません。デスクトップとAndroidは今日から、iOSはまもなく。",
    inShortTitle: "要するに",
    notes: [
      {
        title: "ひとつのエンジン、すべての形式",
        body: "EPUB・MOBI・AZW3・FB2・CBZ・CBR・TXT・HTML・PDFが同じリーダーで開き、選択・ハイライト・進捗を共有します。変換はせず、手元に残るのは元のファイルです。",
      },
      {
        title: "知っている。しまい込まない。",
        body: "読書はアプリが使える記憶になります。ReadAwareは大事なことを覚えておき、関係する瞬間に差し出します——アーカイブに眠らせるのではなく、その場にいるのです。",
      },
      {
        title: "プラグインが新しい技を教える",
        body: "マーケットプレイスのプラグインがボイス・辞書・テーマ・フィードを加え、アシスタントには新しいツールを手渡します。アシスタントはそれをすぐ使いこなします。",
      },
      {
        title: "オープンソース、ローカルファースト、暗号化同期",
        body: "コードはAGPL-3.0で公開され、すべてはあなたのデバイスに。APIキーは自分で用意し、クラウドはマシン間の暗号化された中継にすぎません。",
      },
    ],
    download: {
      title: "ReadAwareを入手",
      intro:
        "無料・オープンソース・ローカルファースト。APIキーは自分で用意し、ライブラリと記憶はデバイスに残ります。",
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
  "zh-hant": {
    freeLine: (tag) =>
      tag ? `免費開源且本地優先。最新版本是 ${tag}。` : "免費開源且本地優先。",
    "metaTitle": "ReadAware — 懂你的免費開源電子書閱讀器",
    "metaDescription": "免費開源的電子書閱讀器，支援 Windows、macOS、Linux 和 Android。一個閱讀器讀遍 EPUB、MOBI、AZW3、FB2、CBZ、CBR、TXT、HTML 和 PDF，從你的閱讀中長出記憶，靠外掛生長，端對端加密同步——本地優先且注重隱私。",
    "heroTitle": "懂你的電子書閱讀器，由你擴充",
    "heroLead": "問任何一段文字——ReadAware 早已知道你在整個書架上劃過什麼、問過什麼、讀過什麼。這份「懂」留在你的裝置上，靠外掛生長，也會加密著跟你到每一台機器。",
    "shelfAlt": "ReadAware 書架——一個包含多種語言和格式的書籍封面格線。",
    "shelfCaption": "你的書架——所有格式，一個地方。",
    "readerTitle": "一個平靜的地方，讀任何東西",
    "readerBody": "匯入檔案就開始讀。不需要轉檔，也不會上傳到雲端；你的劃線、筆記和閱讀進度都留在原始文字裡。想更專注時，可以逐句閱讀——頁面退到一旁，一個浮動列帶你一步步前進，朗讀也可以跟隨。",
    "readerAlt": "ReadAware 閱讀器中的《傲慢與偏見》頁面，一個句子被聚焦，頁面其餘部分退到背景。",
    "readerCaption": "逐句閱讀《傲慢與偏見》。",
    "memoryTitle": "它知道你讀過什麼",
    "memoryBody": "問一段文字、一本書，或整個書架。ReadAware 用你自己的閱讀來回答——三本書之前你劃下的那句話、上週你問過的那個問題、貫穿整個書架的那條線索。它不重播聊天紀錄，而是把重要的沉澱為持久記憶，在相關的時刻帶回來。",
    "contextAlt": "ReadAware 智慧助理檢視讀者的書架和最近的閱讀，並指出貫穿其中的脈絡。",
    "contextCaption": "智慧助理，從你自己的書架上回答。",
    "pluginTitle": "從內部生長",
    "pluginBody": "內建市場的沙盒外掛帶來朗讀語音、字典、閱讀主題、像書一樣讀的訂閱源。而且外掛能走得更深：它可以交給智慧助理一個新工具，助理拿起來就用。這個閱讀器長出的不只是按鈕——是新本事。",
    "pluginAlt": "ReadAware 外掛面板——字典、主題、RSS 閱讀器各自裝在沙盒裡，有的還給智慧助理帶來新工具。",
    "pluginCaption": "語音、字典、主題、訂閱源——還有交到助理手裡的新工具。",
    "syncTitle": "你的閱讀跟著你走",
    "syncBody": "在另一台機器上打開 ReadAware，一切已經就位——你的書、劃線、每本書讀到的位置，以及由此長出的記憶。同步是端對端加密的：中繼伺服器只存密文，路上沒有任何人能看到你讀了什麼。桌面與 Android 現已可用；iOS 即將到來。",
    "inShortTitle": "簡單來說",
    "notes": [
      {
        "title": "一個引擎，支援所有格式",
        "body": "EPUB、MOBI、AZW3、FB2、CBZ、CBR、TXT、HTML 和 PDF 都在同一個閱讀器中開啟，使用相同的選取、劃線和進度。什麼都不會轉換；你保留的就是原始檔案。"
      },
      {
        "title": "懂你，而非存檔",
        "body": "閱讀會變成應用程式能使用的記憶。ReadAware 記下重要的部分，在相關的時刻拿出來——它在場，而不是躺在檔案櫃裡。"
      },
      {
        "title": "外掛教它新本事",
        "body": "市場裡的外掛帶來語音、字典、主題和訂閱源——還會把新工具交到智慧助理手裡，它拿起來就用。"
      },
      {
        "title": "開源、本地優先，加密同步",
        "body": "程式碼以 AGPL-3.0 公開，一切都在你的裝置上。API 金鑰由你自備；雲端只是裝置之間的一條加密中繼。"
      }
    ],
    "download": {
      latest: (tag) => `最新版本是 ${tag}。`,
      downloadFor: (name) => `下載 ${name} 版`,
      "title": "取得 ReadAware",
      "intro": "免費開源且本地優先。自備 API 金鑰；你的書架和記憶都留在你的裝置上。",
      "yourPlatform": "— 你的平台",
      "comingSoon": "即將推出",
      "download": "下載",
      "choosePlatform": "選擇平台",
      "signingNote": "桌面版尚未代碼簽名；macOS 和 Windows 可能會在首次啟動時要求你確認此應用程式。"
    }
    },
  fr: {
    freeLine: (tag) =>
      tag ? `Gratuit, open source et local d'abord. La dernière version est ${tag}.` : "Gratuit, open source et local d'abord.",
    "metaTitle": "ReadAware — Lecteur d'ebooks gratuit et open source qui vous connaît",
    "metaDescription": "Un lecteur d'ebooks gratuit et open source pour Windows, macOS, Linux et Android. Un seul lecteur pour EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML et PDF, qui construit une mémoire à partir de vos lectures, grandit par les plugins et se synchronise chiffré de bout en bout — local d'abord et privé.",
    "heroTitle": "Un lecteur d'ebooks qui vous connaît — et que vous étendez",
    "heroLead": "Interrogez n'importe quel passage — ReadAware sait déjà ce que vous avez surligné, questionné et lu, à travers tous les livres de votre bibliothèque. Cette connaissance vit sur votre appareil, grandit par les plugins et vous suit, chiffrée, sur chaque machine.",
    "shelfAlt": "La bibliothèque ReadAware — une grille de couvertures de livres dans de nombreuses langues et formats.",
    "shelfCaption": "Votre bibliothèque — tous les formats au même endroit.",
    "readerTitle": "Un endroit calme pour lire n'importe quoi",
    "readerBody": "Importez un fichier et commencez à lire. Pas de conversion ni d'envoi dans le cloud ; vos surlignages, notes et position dans le livre restent avec le texte original. Pour plus de concentration, lisez phrase par phrase — la page s'efface, une bande flottante vous guide, et la lecture à voix haute peut suivre.",
    "readerAlt": "Une page d'Orgueil et Préjugés dans le lecteur ReadAware, une phrase en focus pendant que le reste de la page s'efface.",
    "readerCaption": "Lire Orgueil et Préjugés une phrase à la fois.",
    "memoryTitle": "Il sait ce que vous avez lu",
    "memoryBody": "Interrogez un passage, un livre ou toute votre bibliothèque. ReadAware répond à partir de votre propre lecture — la ligne marquée trois livres plus tôt, la question posée la semaine dernière, le fil qui traverse toute votre étagère. Il ne rejoue pas un historique de discussion : il garde une mémoire durable de ce qui compte et la fait revenir au moment où c'est pertinent.",
    "contextAlt": "L'assistant ReadAware qui examine la bibliothèque et les lectures récentes du lecteur, et nomme le fil qui les traverse.",
    "contextCaption": "L'assistant, répondant à partir de votre propre bibliothèque.",
    "pluginTitle": "Étendu de l'intérieur",
    "pluginBody": "Les plugins sandboxés du marketplace intégré ajoutent des voix de lecture, des dictionnaires, des thèmes, des flux qui se lisent comme des livres. Et ils vont plus loin que les fonctionnalités : un plugin peut confier un nouvel outil à l'assistant, qui se met simplement à l'utiliser. Le lecteur ne gagne pas des boutons — il apprend de nouveaux savoir-faire.",
    "pluginAlt": "Le panneau de plugins de ReadAware — dictionnaire, thèmes et lecteur RSS, chacun dans son bac à sable, certains confiant de nouveaux outils à l'assistant.",
    "pluginCaption": "Voix, dictionnaires, thèmes, flux — et des outils que l'assistant adopte.",
    "syncTitle": "Votre lecture vous suit",
    "syncBody": "Ouvrez ReadAware sur une autre machine et tout est déjà là — vos livres, vos surlignages, votre position dans chacun d'eux, et la mémoire construite à partir de tout cela. La synchronisation est chiffrée de bout en bout : le relais ne stocke que du chiffré, personne en chemin ne peut lire ce que vous lisez. Bureau et Android aujourd'hui ; iOS arrive.",
    "inShortTitle": "En bref",
    "notes": [
      {
        "title": "Un seul moteur, tous les formats",
        "body": "EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML et PDF s'ouvrent dans le même lecteur, avec la même sélection, les mêmes surlignages et la même progression. Rien n'est converti ; le fichier original est ce que vous gardez."
      },
      {
        "title": "Attentif, pas archiviste",
        "body": "La lecture devient une mémoire que l'application peut mobiliser. ReadAware garde ce qui compte et le ressort quand c'est pertinent — présent sur le moment, pas rangé dans un tiroir."
      },
      {
        "title": "Les plugins lui apprennent de nouveaux tours",
        "body": "Les plugins du marketplace ajoutent voix, dictionnaires, thèmes et flux — et confient à l'assistant des outils qu'il adopte aussitôt."
      },
      {
        "title": "Open source, local d'abord, synchronisation chiffrée",
        "body": "Le code est public sous licence AGPL-3.0, et tout vit sur votre appareil. Apportez votre clé API ; le cloud n'est qu'un relais chiffré entre vos machines."
      }
    ],
    "download": {
      latest: (tag) => `La dernière version est ${tag}.`,
      downloadFor: (name) => `Télécharger pour ${name}`,
      "title": "Obtenir ReadAware",
      "intro": "Gratuit, open source et local d'abord. Apportez votre propre clé API ; votre bibliothèque et votre mémoire restent sur votre appareil.",
      "yourPlatform": "— votre plateforme",
      "comingSoon": "Bientôt disponible",
      "download": "Télécharger",
      "choosePlatform": "Choisissez une plateforme",
      "signingNote": "Les builds de bureau ne sont pas encore signés ; macOS et Windows peuvent vous demander de confirmer l'application au premier lancement."
    }
    },
  de: {
    freeLine: (tag) =>
      tag ? `Kostenlos, Open Source und Local-First. Die neueste Version ist ${tag}.` : "Kostenlos, Open Source und Local-First.",
    "metaTitle": "ReadAware — Kostenloser Open-Source-E-Book-Reader, der dich kennt",
    "metaDescription": "Ein kostenloser Open-Source-E-Book-Reader für Windows, macOS, Linux und Android. Ein Reader für EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML und PDF, der aus deinem Lesen Erinnerung aufbaut, durch Plugins wächst und Ende-zu-Ende-verschlüsselt synchronisiert — Local-First und privat.",
    "heroTitle": "Ein E-Book-Reader, der dich kennt — und den du erweiterst",
    "heroLead": "Frag nach irgendeiner Passage — ReadAware weiß bereits, was du markiert, gefragt und gelesen hast, über jedes Buch in deinem Regal hinweg. Dieses Wissen lebt auf deinem Gerät, wächst durch Plugins und folgt dir — verschlüsselt — auf jede Maschine.",
    "shelfAlt": "Die ReadAware-Bibliothek — ein Raster aus Buchcovern in vielen Sprachen und Formaten.",
    "shelfCaption": "Deine Bibliothek — alle Formate an einem Ort.",
    "readerTitle": "Ein ruhiger Ort, um alles zu lesen",
    "readerBody": "Importiere eine Datei und lies los. Es gibt keine Konvertierung und keinen Cloud-Upload; deine Markierungen, Notizen und dein Lesezeichen bleiben beim Originaltext. Wenn du dich besser konzentrieren willst, lies Satz für Satz — die Seite tritt zurück, ein schwebender Streifen führt dich durch, und das Vorlesen kann folgen.",
    "readerAlt": "Eine Seite von „Stolz und Vorurteil“ im ReadAware-Reader, ein Satz im Fokus, während der Rest der Seite zurücktritt.",
    "readerCaption": "„Stolz und Vorurteil“ Satz für Satz lesen.",
    "memoryTitle": "Es weiß, was du gelesen hast",
    "memoryBody": "Frag nach einer Passage, einem Buch oder deinem ganzen Regal. ReadAware antwortet aus deiner eigenen Lektüre — die Zeile, die du vor drei Büchern markiert hast, die Frage von letzter Woche, der Faden, der sich durch dein ganzes Regal zieht. Es spielt keine Chat-Historie ab; es behält eine dauerhafte Erinnerung an das Wichtige und bringt sie genau dann zurück, wenn sie relevant ist.",
    "contextAlt": "Der ReadAware-Assistent, der das Regal und die letzten Lesefortschritte des Lesers betrachtet und den roten Faden benennt.",
    "contextCaption": "Der Assistent, der aus deinem eigenen Regal antwortet.",
    "pluginTitle": "Von innen erweitert",
    "pluginBody": "Sandbox-Plugins aus dem eingebauten Marktplatz bringen Vorlesestimmen, Wörterbücher, Lesethemen, Feeds, die sich wie Bücher lesen. Und sie reichen tiefer als Features: Ein Plugin kann dem Assistenten ein neues Werkzeug in die Hand geben — und er benutzt es einfach. Der Reader bekommt nicht bloß Knöpfe dazu, er lernt Neues.",
    "pluginAlt": "Das Plugin-Panel von ReadAware — Wörterbuch, Themes und RSS-Reader, jedes in seiner Sandbox, manche geben dem Assistenten neue Werkzeuge.",
    "pluginCaption": "Stimmen, Wörterbücher, Themes, Feeds — und Werkzeuge für den Assistenten.",
    "syncTitle": "Dein Lesen folgt dir",
    "syncBody": "Öffne ReadAware auf einer anderen Maschine, und alles ist schon da — deine Bücher, deine Markierungen, deine Stelle in jedem von ihnen und die daraus gewachsene Erinnerung. Die Synchronisierung ist Ende-zu-Ende-verschlüsselt: Das Relay speichert ausschließlich Chiffretext, niemand dazwischen kann lesen, was du liest. Desktop und Android heute; iOS ist unterwegs.",
    "inShortTitle": "Kurz gesagt",
    "notes": [
      {
        "title": "Eine Engine, jedes Format",
        "body": "EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML und PDF öffnen sich im selben Reader, mit derselben Auswahl, denselben Markierungen und demselben Fortschritt. Nichts wird konvertiert; die Originaldatei ist das, was du behältst."
      },
      {
        "title": "Aufmerksam, nicht archivierend",
        "body": "Lesen wird zu Erinnerung, mit der die App arbeiten kann. ReadAware behält das Wichtige und holt es hervor, wenn es relevant ist — präsent im Moment, nicht abgelegt."
      },
      {
        "title": "Plugins bringen ihm Neues bei",
        "body": "Marktplatz-Plugins ergänzen Stimmen, Wörterbücher, Themen und Feeds — und geben dem Assistenten Werkzeuge in die Hand, die er aufgreift und nutzt."
      },
      {
        "title": "Open Source, Local-First, verschlüsselte Synchronisierung",
        "body": "Der Code ist unter AGPL-3.0 öffentlich, und alles lebt auf deinem Gerät. Bring deinen eigenen API-Schlüssel mit; die Cloud ist nur ein verschlüsseltes Relay zwischen deinen Maschinen."
      }
    ],
    "download": {
      latest: (tag) => `Die neueste Version ist ${tag}.`,
      downloadFor: (name) => `Download für ${name}`,
      "title": "ReadAware herunterladen",
      "intro": "Kostenlos, Open Source und Local-First. Bring deinen eigenen API-Schlüssel mit; deine Bibliothek und Erinnerung bleiben auf deinem Gerät.",
      "yourPlatform": "— deine Plattform",
      "comingSoon": "Bald verfügbar",
      "download": "Download",
      "choosePlatform": "Plattform wählen",
      "signingNote": "Desktop-Builds sind noch nicht code-signiert; macOS und Windows bitten dich beim ersten Start möglicherweise, die App zu bestätigen."
    }
    },
  ru: {
    freeLine: (tag) =>
      tag ? `Бесплатно, открытый код и local-first. Последний выпуск — ${tag}.` : "Бесплатно, открытый код и local-first.",
    "metaTitle": "ReadAware — Бесплатная читалка электронных книг с открытым кодом",
    "metaDescription": "Бесплатная читалка электронных книг с открытым исходным кодом для Windows, macOS, Linux и Android. Один ридер для EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML и PDF, который выстраивает память из вашего чтения, растёт благодаря плагинам и синхронизируется со сквозным шифрованием — локальный подход (local-first) и приватность.",
    "heroTitle": "Ридер электронных книг, который вас знает — и который вы расширяете",
    "heroLead": "Спросите о любом фрагменте — ReadAware уже знает, что вы выделяли, о чём спрашивали и что читали, по всем книгам на вашей полке. Это знание живёт на вашем устройстве, растёт благодаря плагинам и следует за вами — в зашифрованном виде — на каждую машину.",
    "shelfAlt": "Библиотека ReadAware — сетка обложек книг на разных языках и в разных форматах.",
    "shelfCaption": "Ваша библиотека — все форматы в одном месте.",
    "readerTitle": "Спокойное место для чтения чего угодно",
    "readerBody": "Импортируйте файл и начинайте читать. Никакой конвертации и загрузки в облако; ваши выделения, заметки и место в книге остаются с исходным текстом. Когда захочется больше сосредоточенности, читайте по предложениям — страница отступает на второй план, плавающая полоса ведёт вас дальше, а чтение вслух может следовать за ней.",
    "readerAlt": "Страница «Гордости и предубеждения» в ридере ReadAware: одно предложение в фокусе, остальная страница отступает.",
    "readerCaption": "Чтение «Гордости и предубеждения» по одному предложению за раз.",
    "memoryTitle": "Он знает, что вы читали",
    "memoryBody": "Спросите о фрагменте, книге или всей полке. ReadAware отвечает из вашего собственного чтения — строка, отмеченная три книги назад, вопрос прошлой недели, нить, проходящая через всю полку. Он не проигрывает историю чата: он хранит устойчивую память о важном и возвращает её именно в тот момент, когда она уместна.",
    "contextAlt": "Ассистент ReadAware обозревает полку читателя и недавнее чтение, называя нить, которая их связывает.",
    "contextCaption": "Ассистент отвечает, используя вашу собственную полку.",
    "pluginTitle": "Расширение изнутри",
    "pluginBody": "Песочные плагины из встроенного каталога добавляют голоса для чтения вслух, словари, темы оформления, ленты, читаемые как книги. И они идут глубже функций: плагин может вручить ассистенту новый инструмент — и тот просто начинает им пользоваться. Ридер получает не кнопки, а новые умения.",
    "pluginAlt": "Панель плагинов ReadAware — словарь, темы и RSS-ридер, каждый в своей песочнице; некоторые вручают ассистенту новые инструменты.",
    "pluginCaption": "Голоса, словари, темы, ленты — и инструменты для ассистента.",
    "syncTitle": "Ваше чтение следует за вами",
    "syncBody": "Откройте ReadAware на другой машине — и всё уже на месте: книги, выделения, позиция в каждой из них и память, выросшая из всего этого. Синхронизация зашифрована сквозным образом: ретранслятор хранит только шифротекст, и никто по пути не может прочитать, что вы читаете. Настольные системы и Android — уже сегодня; iOS на подходе.",
    "inShortTitle": "Короче говоря",
    "notes": [
      {
        "title": "Один движок — все форматы",
        "body": "EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML и PDF открываются в одном ридере с одинаковым выделением, заметками и прогрессом. Ничего не конвертируется; вы сохраняете исходный файл."
      },
      {
        "title": "Знает, а не архивирует",
        "body": "Чтение становится памятью, с которой приложение может работать. ReadAware хранит важное и достаёт его в нужный момент — оно рядом, а не в архиве."
      },
      {
        "title": "Плагины учат его новому",
        "body": "Плагины из каталога добавляют голоса, словари, темы и ленты — и вручают ассистенту инструменты, которые он подхватывает и использует."
      },
      {
        "title": "Открытый код, local-first, зашифрованная синхронизация",
        "body": "Код открыт под лицензией AGPL-3.0, и всё живёт на вашем устройстве. Приносите свой API-ключ; облако — лишь зашифрованный ретранслятор между вашими машинами."
      }
    ],
    "download": {
      latest: (tag) => `Последний выпуск — ${tag}.`,
      downloadFor: (name) => `Скачать для ${name}`,
      "title": "Скачать ReadAware",
      "intro": "Бесплатно, открытый код и local-first. Принесите свой API-ключ; библиотека и память остаются на вашем устройстве.",
      "yourPlatform": "— ваша платформа",
      "comingSoon": "Скоро",
      "download": "Скачать",
      "choosePlatform": "Выберите платформу",
      "signingNote": "Настольные сборки пока не подписаны кодом; macOS и Windows могут попросить подтвердить приложение при первом запуске."
    }
    },
  es: {
    freeLine: (tag) =>
      tag ? `Gratis, de código abierto y local primero (local-first). La última versión es ${tag}.` : "Gratis, de código abierto y local primero (local-first).",
    "metaTitle": "ReadAware — Lector de ebooks gratuito y de código abierto que te conoce",
    "metaDescription": "Un lector de ebooks gratuito y de código abierto para Windows, macOS, Linux y Android. Un solo lector para EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML y PDF que construye memoria a partir de tu lectura, crece con plugins y sincroniza cifrado de extremo a extremo: local primero (local-first) y privado.",
    "heroTitle": "Un lector de ebooks que te conoce — y que tú extiendes",
    "heroLead": "Pregunta por cualquier pasaje: ReadAware ya sabe qué subrayaste, qué preguntaste y qué leíste, en todos los libros de tu estantería. Ese conocimiento vive en tu dispositivo, crece con los plugins y te sigue —cifrado— a cada máquina.",
    "shelfAlt": "La biblioteca de ReadAware: una cuadrícula de portadas de libros en varios idiomas y formatos.",
    "shelfCaption": "Tu biblioteca: todos los formatos en un solo lugar.",
    "readerTitle": "Un lugar tranquilo para leer cualquier cosa",
    "readerBody": "Importa un archivo y empieza a leer. No hay conversión ni carga en la nube; tus subrayados, notas y tu posición en el libro permanecen con el texto original. Cuando quieras más concentración, lee frase a frase: la página se retira, una franja flotante te guía y la lectura en voz alta puede seguir el ritmo.",
    "readerAlt": "Una página de Orgullo y prejuicio en el lector de ReadAware, con una frase en foco mientras el resto de la página se atenúa.",
    "readerCaption": "Leyendo Orgullo y prejuicio frase a frase.",
    "memoryTitle": "Sabe lo que has leído",
    "memoryBody": "Pregunta por un pasaje, un libro o toda tu estantería. ReadAware responde desde tu propia lectura: la línea que marcaste hace tres libros, la pregunta de la semana pasada, el hilo que atraviesa toda tu estantería. No reproduce un historial de chat; guarda una memoria duradera de lo que importa y la trae de vuelta justo cuando es relevante.",
    "contextAlt": "El asistente de ReadAware revisando la estantería del lector y sus lecturas recientes, y nombrando el hilo que las une.",
    "contextCaption": "El asistente, respondiendo desde tu propia estantería.",
    "pluginTitle": "Extendido desde adentro",
    "pluginBody": "Los plugins en sandbox del marketplace integrado añaden voces de lectura, diccionarios, temas, fuentes que se leen como libros. Y llegan más hondo que las funciones: un plugin puede poner una nueva herramienta en manos del asistente, y este simplemente empieza a usarla. El lector no gana botones: aprende nuevas habilidades.",
    "pluginAlt": "El panel de plugins de ReadAware: diccionario, temas y lector RSS, cada uno en su sandbox; algunos ponen nuevas herramientas en manos del asistente.",
    "pluginCaption": "Voces, diccionarios, temas, fuentes — y herramientas que el asistente adopta.",
    "syncTitle": "Tu lectura te sigue",
    "syncBody": "Abre ReadAware en otra máquina y todo está ya ahí: tus libros, tus subrayados, tu posición en cada uno y la memoria construida a partir de todo ello. La sincronización está cifrada de extremo a extremo: el relay solo guarda texto cifrado, y nadie en el camino puede leer lo que lees. Escritorio y Android hoy; iOS está en camino.",
    "inShortTitle": "En resumen",
    "notes": [
      {
        "title": "Un solo motor, todos los formatos",
        "body": "EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML y PDF se abren en el mismo lector, con la misma selección, subrayados y progreso. Nada se convierte; el archivo original es lo que conservas."
      },
      {
        "title": "Atento, no archivador",
        "body": "La lectura se convierte en memoria que la app puede usar. ReadAware guarda lo que importa y lo saca cuando es relevante: está presente en el momento, no guardado en un cajón."
      },
      {
        "title": "Los plugins le enseñan trucos nuevos",
        "body": "Los plugins del marketplace añaden voces, diccionarios, temas y fuentes — y ponen en manos del asistente herramientas que adopta y usa."
      },
      {
        "title": "Código abierto, local primero, sincronización cifrada",
        "body": "El código es público bajo AGPL-3.0, y todo vive en tu dispositivo. Aporta tu propia clave API; la nube es solo un relay cifrado entre tus máquinas."
      }
    ],
    "download": {
      latest: (tag) => `La última versión es ${tag}.`,
      downloadFor: (name) => `Descargar para ${name}`,
      "title": "Obtén ReadAware",
      "intro": "Gratis, de código abierto y local primero (local-first). Aporta tu propia clave API; tu biblioteca y tu memoria permanecen en tu dispositivo.",
      "yourPlatform": "— tu plataforma",
      "comingSoon": "Próximamente",
      "download": "Descargar",
      "choosePlatform": "Elige una plataforma",
      "signingNote": "Las versiones de escritorio aún no están firmadas con código; macOS y Windows pueden pedirte que confirmes la app al primer inicio."
    }
    },
};
