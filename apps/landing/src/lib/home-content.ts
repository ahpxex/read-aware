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
  "zh-hant": {
    freeLine: (tag) =>
      tag ? `免費且本地優先。最新版本是 ${tag}。` : "免費且本地優先。",
    "metaTitle": "ReadAware — 會記得的閱讀",
    "metaDescription": "一個 AI 原生閱讀工作區。針對 EPUB、MOBI、AZW3、FB2、CBZ、CBR、TXT、HTML 和 PDF，提供富含上下文的閱讀與 AI 輔助理解——本地優先且注重隱私。",
    "heroTitle": "會記得的閱讀",
    "heroLead": "ReadAware 陪你一起讀。它會在你的書籍、劃線和對話之間建立記憶，讓每一頁都帶著它應有的上下文來到你面前。",
    "shelfAlt": "ReadAware 書架——一個包含多種語言和格式的書籍封面格線。",
    "shelfCaption": "你的書架——所有格式，一個地方。",
    "readerTitle": "一個平靜的地方，讀任何東西",
    "readerBody": "匯入檔案就開始讀。不需要轉檔，也不會上傳到雲端；你的劃線、筆記和閱讀進度都留在原始文字裡。想更專注時，可以逐句閱讀——頁面退到一旁，一個浮動列帶你一步步前進，朗讀也可以跟隨。",
    "readerAlt": "ReadAware 閱讀器中的《原子習慣》頁面，一個句子被聚焦，頁面其餘部分退到背景。",
    "readerCaption": "逐句閱讀《原子習慣》。",
    "memoryTitle": "它記得你讀過什麼",
    "memoryBody": "詢問某段文字、某本書，或你整個書架。ReadAware 會利用你的劃線、筆記和先前的對話，並對重要內容建立持久記憶，所以它能從你上次停下的地方繼續。",
    "contextAlt": "ReadAware 智慧助理檢視讀者的書架和最近的閱讀，並指出貫穿其中的脈絡。",
    "contextCaption": "智慧助理，從你自己的書架上回答。",
    "inShortTitle": "簡單來說",
    "notes": [
      {
        "title": "一個引擎，支援所有格式",
        "body": "EPUB、MOBI、AZW3、FB2、CBZ、CBR、TXT、HTML 和 PDF 都在同一個閱讀器中開啟，使用相同的選取、劃線和進度。什麼都不會轉換；你保留的就是原始檔案。"
      },
      {
        "title": "記憶，不是逐字稿",
        "body": "閱讀會變成應用程式能記住的記憶。ReadAware 保留重要的內容，並在相關時機帶回來，而不是重播一長串的對話歷史。"
      },
      {
        "title": "從內部擴充",
        "body": "來自內建外掛市場的沙盒外掛，可以加入朗讀語音、字典、閱讀主題、像書一樣閱讀的訂閱源——還有智慧助理會學習使用的新工具。"
      },
      {
        "title": "本地優先且注重隱私",
        "body": "你的書架和記憶都存在你的裝置上。你自備 API 金鑰，雲端只用來在裝置之間同步。"
      }
    ],
    "download": {
      latest: (tag) => `最新版本是 ${tag}。`,
      downloadFor: (name) => `下載 ${name} 版`,
      "title": "取得 ReadAware",
      "intro": "免費且本地優先。自備 API 金鑰；你的書架和記憶都留在你的裝置上。",
      "yourPlatform": "— 你的平台",
      "comingSoon": "即將推出",
      "download": "下載",
      "choosePlatform": "選擇平台",
      "signingNote": "桌面版尚未代碼簽名；macOS 和 Windows 可能會在首次啟動時要求你確認此應用程式。"
    }
    },
  fr: {
    freeLine: (tag) =>
      tag ? `Gratuit et local d'abord. La dernière version est ${tag}.` : "Gratuit et local d'abord.",
    "metaTitle": "ReadAware — Lire, en se souvenant",
    "metaDescription": "Un espace de lecture natif pour l'IA. Lecture contextuelle et compréhension assistée par l'IA pour EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML et PDF — local d'abord et privé.",
    "heroTitle": "Lire, en se souvenant",
    "heroLead": "ReadAware lit à vos côtés. Il construit une mémoire à travers vos livres, surlignages et conversations, pour que chaque page arrive avec le contexte qu'elle mérite.",
    "shelfAlt": "La bibliothèque ReadAware — une grille de couvertures de livres dans de nombreuses langues et formats.",
    "shelfCaption": "Votre bibliothèque — tous les formats au même endroit.",
    "readerTitle": "Un endroit calme pour lire n'importe quoi",
    "readerBody": "Importez un fichier et commencez à lire. Pas de conversion ni d'envoi dans le cloud ; vos surlignages, notes et position dans le livre restent avec le texte original. Pour plus de concentration, lisez phrase par phrase — la page s'efface, une bande flottante vous guide, et la lecture à voix haute peut suivre.",
    "readerAlt": "Une page d'Atomic Habits dans le lecteur ReadAware, une phrase en focus pendant que le reste de la page s'efface.",
    "readerCaption": "Lire Atomic Habits une phrase à la fois.",
    "memoryTitle": "Il se souvient de ce que vous lisez",
    "memoryBody": "Posez une question sur un passage, un livre ou toute votre bibliothèque. ReadAware s'appuie sur vos surlignages, notes et conversations précédentes, et garde une mémoire durable de ce qui compte, pour reprendre là où vous vous êtes arrêté.",
    "contextAlt": "L'assistant ReadAware qui examine la bibliothèque et les lectures récentes du lecteur, et nomme le fil qui les traverse.",
    "contextCaption": "L'assistant, répondant à partir de votre propre bibliothèque.",
    "inShortTitle": "En bref",
    "notes": [
      {
        "title": "Un seul moteur, tous les formats",
        "body": "EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML et PDF s'ouvrent dans le même lecteur, avec la même sélection, les mêmes surlignages et la même progression. Rien n'est converti ; le fichier original est ce que vous gardez."
      },
      {
        "title": "De la mémoire, pas des transcriptions",
        "body": "La lecture devient une mémoire que l'application peut retenir. ReadAware garde ce qui compte et le fait revenir quand c'est pertinent, au lieu de rejouer un long historique de discussion."
      },
      {
        "title": "Extensible de l'intérieur",
        "body": "Les plugins sandboxés du marketplace intégré ajoutent des voix de lecture à voix haute, des dictionnaires, des thèmes de lecture, des flux qui se lisent comme des livres — et de nouveaux outils que l'assistant peut utiliser."
      },
      {
        "title": "Local d'abord et privé",
        "body": "Votre bibliothèque et votre mémoire vivent sur votre appareil. Vous apportez votre propre clé API, et le cloud n'est là que pour synchroniser entre machines."
      }
    ],
    "download": {
      latest: (tag) => `La dernière version est ${tag}.`,
      downloadFor: (name) => `Télécharger pour ${name}`,
      "title": "Obtenir ReadAware",
      "intro": "Gratuit et local d'abord. Apportez votre propre clé API ; votre bibliothèque et votre mémoire restent sur votre appareil.",
      "yourPlatform": "— votre plateforme",
      "comingSoon": "Bientôt disponible",
      "download": "Télécharger",
      "choosePlatform": "Choisissez une plateforme",
      "signingNote": "Les builds de bureau ne sont pas encore signés ; macOS et Windows peuvent vous demander de confirmer l'application au premier lancement."
    }
    },
  de: {
    freeLine: (tag) =>
      tag ? `Kostenlos und Local-First. Die neueste Version ist ${tag}.` : "Kostenlos und Local-First.",
    "metaTitle": "ReadAware — Lesen, das sich erinnert",
    "metaDescription": "Ein KI-nativer Lese-Arbeitsbereich. Kontextreiches Lesen und KI-gestütztes Verstehen für EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML und PDF — Local-First und privat.",
    "heroTitle": "Lesen, das sich erinnert",
    "heroLead": "ReadAware liest mit dir. Es baut eine Erinnerung über deine Bücher, Markierungen und Gespräche auf, sodass jede Seite mit dem Kontext ankommt, den sie verdient.",
    "shelfAlt": "Die ReadAware-Bibliothek — ein Raster aus Buchcovern in vielen Sprachen und Formaten.",
    "shelfCaption": "Deine Bibliothek — alle Formate an einem Ort.",
    "readerTitle": "Ein ruhiger Ort, um alles zu lesen",
    "readerBody": "Importiere eine Datei und lies los. Es gibt keine Konvertierung und keinen Cloud-Upload; deine Markierungen, Notizen und dein Lesezeichen bleiben beim Originaltext. Wenn du dich besser konzentrieren willst, lies Satz für Satz — die Seite tritt zurück, ein schwebender Streifen führt dich durch, und das Vorlesen kann folgen.",
    "readerAlt": "Eine Seite von „Atomic Habits“ im ReadAware-Reader, ein Satz im Fokus, während der Rest der Seite zurücktritt.",
    "readerCaption": "„Atomic Habits“ Satz für Satz lesen.",
    "memoryTitle": "Es erinnert sich, was du gelesen hast",
    "memoryBody": "Frag nach einer Passage, einem Buch oder deinem gesamten Regal. ReadAware greift auf deine Markierungen, Notizen und früheren Gespräche zurück und behält eine dauerhafte Erinnerung an das, was wichtig ist, damit es dort weitermacht, wo du aufgehört hast.",
    "contextAlt": "Der ReadAware-Assistent, der das Regal und die letzten Lesefortschritte des Lesers betrachtet und den roten Faden benennt.",
    "contextCaption": "Der Assistent, der aus deinem eigenen Regal antwortet.",
    "inShortTitle": "Kurz gesagt",
    "notes": [
      {
        "title": "Eine Engine, jedes Format",
        "body": "EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML und PDF öffnen sich im selben Reader, mit derselben Auswahl, denselben Markierungen und demselben Fortschritt. Nichts wird konvertiert; die Originaldatei ist das, was du behältst."
      },
      {
        "title": "Erinnerung, keine Transkripte",
        "body": "Lesen wird zu einer Erinnerung, die die App festhalten kann. ReadAware behält, was wichtig ist, und bringt es zurück, wenn es relevant ist, anstatt eine lange Chat-Historie abzuspielen."
      },
      {
        "title": "Von innen erweiterbar",
        "body": "Sandbox-Plugins aus dem eingebauten Marktplatz fügen Vorlesestimmen, Wörterbücher, Lesethemen, Feeds, die sich wie Bücher lesen, und neue Werkzeuge hinzu, die der Assistent aufgreift und nutzt."
      },
      {
        "title": "Local-First und privat",
        "body": "Deine Bibliothek und deine Erinnerung leben auf deinem Gerät. Du bringst deinen eigenen API-Schlüssel mit, und die Cloud ist nur dazu da, um zwischen Geräten zu synchronisieren."
      }
    ],
    "download": {
      latest: (tag) => `Die neueste Version ist ${tag}.`,
      downloadFor: (name) => `Download für ${name}`,
      "title": "ReadAware herunterladen",
      "intro": "Kostenlos und Local-First. Bring deinen eigenen API-Schlüssel mit; deine Bibliothek und Erinnerung bleiben auf deinem Gerät.",
      "yourPlatform": "— deine Plattform",
      "comingSoon": "Bald verfügbar",
      "download": "Download",
      "choosePlatform": "Plattform wählen",
      "signingNote": "Desktop-Builds sind noch nicht code-signiert; macOS und Windows bitten dich beim ersten Start möglicherweise, die App zu bestätigen."
    }
    },
  ru: {
    freeLine: (tag) =>
      tag ? `Бесплатно и локальный подход (local-first). Последний выпуск — ${tag}.` : "Бесплатно и локальный подход (local-first).",
    "metaTitle": "ReadAware — Чтение, которое запоминает",
    "metaDescription": "AI-нативное рабочее пространство для чтения. Контекстное чтение и понимание с помощью ИИ для EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML и PDF — локальный подход (local-first) и приватность.",
    "heroTitle": "Чтение, которое запоминает",
    "heroLead": "ReadAware читает вместе с вами. Он выстраивает память по вашим книгам, выделениям и беседам, так что каждая страница приходит с заслуженным контекстом.",
    "shelfAlt": "Библиотека ReadAware — сетка обложек книг на разных языках и в разных форматах.",
    "shelfCaption": "Ваша библиотека — все форматы в одном месте.",
    "readerTitle": "Спокойное место для чтения чего угодно",
    "readerBody": "Импортируйте файл и начинайте читать. Никакой конвертации и загрузки в облако; ваши выделения, заметки и место в книге остаются с исходным текстом. Когда захочется больше сосредоточенности, читайте по предложениям — страница отступает на второй план, плавающая полоса ведёт вас дальше, а чтение вслух может следовать за ней.",
    "readerAlt": "Страница «Атомные привычки» в ридере ReadAware: одно предложение в фокусе, остальная страница отступает.",
    "readerCaption": "Чтение «Атомных привычек» по одному предложению за раз.",
    "memoryTitle": "Он помнит, что вы читали",
    "memoryBody": "Спрашивайте о фрагменте, книге или всей полке. ReadAware опирается на ваши выделения, заметки и прошлые разговоры и хранит устойчивую память о важном, так что продолжает с того места, где вы остановились.",
    "contextAlt": "Ассистент ReadAware обозревает полку читателя и недавнее чтение, называя нить, которая их связывает.",
    "contextCaption": "Ассистент отвечает, используя вашу собственную полку.",
    "inShortTitle": "Короче говоря",
    "notes": [
      {
        "title": "Один движок — все форматы",
        "body": "EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML и PDF открываются в одном ридере с одинаковым выделением, заметками и прогрессом. Ничего не конвертируется; вы сохраняете исходный файл."
      },
      {
        "title": "Память, а не расшифровки",
        "body": "Чтение превращается в память, которую приложение может удерживать. ReadAware сохраняет важное и возвращает его, когда это уместно, вместо проигрывания длинной истории чата."
      },
      {
        "title": "Расширение изнутри",
        "body": "Песочные плагины из встроенного каталога плагинов добавляют голоса для чтения вслух, словари, темы оформления, ленты, читаемые как книги, — и новые инструменты, которые ассистент подхватывает и использует."
      },
      {
        "title": "Локальный подход (local-first) и приватность",
        "body": "Ваша библиотека и память живут на вашем устройстве. Вы приносите свой API-ключ, а облако нужно только для синхронизации между машинами."
      }
    ],
    "download": {
      latest: (tag) => `Последний выпуск — ${tag}.`,
      downloadFor: (name) => `Скачать для ${name}`,
      "title": "Скачать ReadAware",
      "intro": "Бесплатно и локальный подход (local-first). Принесите свой API-ключ; библиотека и память остаются на вашем устройстве.",
      "yourPlatform": "— ваша платформа",
      "comingSoon": "Скоро",
      "download": "Скачать",
      "choosePlatform": "Выберите платформу",
      "signingNote": "Настольные сборки пока не подписаны кодом; macOS и Windows могут попросить подтвердить приложение при первом запуске."
    }
    },
  es: {
    freeLine: (tag) =>
      tag ? `Gratis y local primero (local-first). La última versión es ${tag}.` : "Gratis y local primero (local-first).",
    "metaTitle": "ReadAware — Lectura que recuerda",
    "metaDescription": "Un espacio de lectura con IA. Lectura rica en contexto y comprensión asistida por IA para EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML y PDF: local primero (local-first) y privado.",
    "heroTitle": "Lectura que recuerda",
    "heroLead": "ReadAware lee a tu lado. Construye memoria a través de tus libros, subrayados y conversaciones, para que cada página llegue con el contexto que merece.",
    "shelfAlt": "La biblioteca de ReadAware: una cuadrícula de portadas de libros en varios idiomas y formatos.",
    "shelfCaption": "Tu biblioteca: todos los formatos en un solo lugar.",
    "readerTitle": "Un lugar tranquilo para leer cualquier cosa",
    "readerBody": "Importa un archivo y empieza a leer. No hay conversión ni carga en la nube; tus subrayados, notas y tu posición en el libro permanecen con el texto original. Cuando quieras más concentración, lee frase a frase: la página se retira, una franja flotante te guía y la lectura en voz alta puede seguir el ritmo.",
    "readerAlt": "Una página de Atomic Habits en el lector de ReadAware, con una frase en foco mientras el resto de la página se atenúa.",
    "readerCaption": "Leyendo Atomic Habits frase a frase.",
    "memoryTitle": "Recuerda lo que lees",
    "memoryBody": "Pregunta por un pasaje, un libro o toda tu estantería. ReadAware recurre a tus subrayados, notas y conversaciones anteriores, y guarda una memoria duradera de lo que importa, para retomar justo donde lo dejaste.",
    "contextAlt": "El asistente de ReadAware revisando la estantería del lector y sus lecturas recientes, y nombrando el hilo que las une.",
    "contextCaption": "El asistente, respondiendo desde tu propia estantería.",
    "inShortTitle": "En resumen",
    "notes": [
      {
        "title": "Un solo motor, todos los formatos",
        "body": "EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML y PDF se abren en el mismo lector, con la misma selección, subrayados y progreso. Nada se convierte; el archivo original es lo que conservas."
      },
      {
        "title": "Memoria, no transcripciones",
        "body": "La lectura se convierte en memoria que la app puede conservar. ReadAware guarda lo que importa y lo trae de vuelta cuando es relevante, en lugar de reproducir un largo historial de chat."
      },
      {
        "title": "Extensible desde adentro",
        "body": "Los plugins en sandbox del marketplace integrado añaden voces para lectura en voz alta, diccionarios, temas de lectura, fuentes que se leen como libros — y nuevas herramientas que el asistente incorpora y utiliza."
      },
      {
        "title": "Local primero (local-first) y privado",
        "body": "Tu biblioteca y tu memoria viven en tu dispositivo. Tú aportas tu propia clave API, y la nube solo sirve para sincronizar entre máquinas."
      }
    ],
    "download": {
      latest: (tag) => `La última versión es ${tag}.`,
      downloadFor: (name) => `Descargar para ${name}`,
      "title": "Obtén ReadAware",
      "intro": "Gratis y local primero (local-first). Aporta tu propia clave API; tu biblioteca y tu memoria permanecen en tu dispositivo.",
      "yourPlatform": "— tu plataforma",
      "comingSoon": "Próximamente",
      "download": "Descargar",
      "choosePlatform": "Elige una plataforma",
      "signingNote": "Las versiones de escritorio aún no están firmadas con código; macOS y Windows pueden pedirte que confirmes la app al primer inicio."
    }
    },
};
