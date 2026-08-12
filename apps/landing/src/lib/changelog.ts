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
    version: "0.4.2",
    date: "2026-08-12",
    text: {
      en: {
        summary:
          "A patch that opens the front door: book files open straight from your file manager, drag-and-drop imports, and every illustration gets a full-screen viewer.",
        groups: [
          {
            kind: "new",
            items: [
              {
                title: "Open with ReadAware",
                body: "Make ReadAware the default app for your book files and double-clicking one lands directly in the reader, with the book added to your shelf on the way. If the app is already running, the existing window takes over — no second copy.",
              },
              {
                title: "Drop books to import",
                body: "Drag book files anywhere onto the window and they import on the spot.",
              },
              {
                title: "A closer look at illustrations",
                body: "Tap an image in any book to view it full screen. Zoom around the cursor with the wheel or a pinch, drag to pan, double-click to toggle fit, and a small toolbar covers zoom, rotation, copying to the clipboard, and closing.",
              },
            ],
          },
        ],
      },
      zh: {
        summary:
          "一个打开前门的小更新：书籍文件可直接从文件管理器打开、拖拽导入，每张插图都有了全屏查看器。",
        groups: [
          {
            kind: "new",
            items: [
              {
                title: "用 ReadAware 打开",
                body: "把 ReadAware 设为书籍文件的默认应用，双击文件即可直接进入阅读器，书会自动加入书架。如果应用已在运行，则复用现有窗口，不会打开第二个副本。",
              },
              {
                title: "拖拽导入书籍",
                body: "将书籍文件拖放到窗口任意位置，即可立即导入。",
              },
              {
                title: "细看插图",
                body: "点击书中的图片即可全屏查看。用滚轮或双指缩放，拖动即可平移，双击切换适应窗口，小工具栏提供缩放、旋转、复制到剪贴板和关闭功能。",
              },
            ],
          },
        ],
      },
      "zh-hant": {
        summary:
          "這次更新打開了前門：書籍檔案可以直接從檔案管理員開啟、拖曳匯入，每一張插圖都能全螢幕檢視。",
        groups: [
          {
            kind: "new",
            items: [
              {
                title: "用 ReadAware 開啟",
                body: "把 ReadAware 設為書籍檔案的預設應用程式後，雙擊檔案就會直接進入閱讀器，書也會同時加入書架。如果應用程式已經在執行，會沿用既有的視窗，不會另開一個副本。",
              },
              {
                title: "拖曳匯入書籍",
                body: "將書籍檔案拖曳到視窗的任何位置，就會立刻完成匯入。",
              },
              {
                title: "細看插圖",
                body: "點選書中的圖片，就能以全螢幕檢視。用滾輪或雙指縮放貼近游標放大，拖曳可平移，雙擊切換符合視窗大小，小工具列提供縮放、旋轉、複製到剪貼簿和關閉功能。",
              },
            ],
          },
        ],
      },
      ja: {
        summary:
          "入口を開くパッチです。書籍ファイルがファイルマネージャーから直接開けるようになり、ドラッグ＆ドロップでのインポートに対応し、すべての挿絵に全画面ビューアーが付きました。",
        groups: [
          {
            kind: "new",
            items: [
              {
                title: "ReadAware で開く",
                body: "ReadAware を書籍ファイルのデフォルトアプリに設定すると、ダブルクリックした書籍がそのままリーダーで開き、同時に本棚にも追加されます。アプリがすでに起動している場合は既存のウィンドウが引き継ぐため、二重に開くことはありません。",
              },
              {
                title: "ドロップで書籍をインポート",
                body: "書籍ファイルをウィンドウのどこかにドラッグすると、その場でインポートされます。",
              },
              {
                title: "挿絵を詳しく見る",
                body: "本の中の画像をタップすると全画面で表示されます。ホイールやピンチでカーソル位置を中心にズーム、ドラッグでパン、ダブルクリックでフィット表示を切り替え、小さなツールバーでズーム、回転、クリップボードへのコピー、閉じる操作ができます。",
              },
            ],
          },
        ],
      },
      fr: {
        summary:
          "Un patch qui ouvre la porte d'entrée : les fichiers de livres s'ouvrent directement depuis votre gestionnaire de fichiers, l'import par glisser-déposer est disponible, et chaque illustration dispose d'une visionneuse plein écran.",
        groups: [
          {
            kind: "new",
            items: [
              {
                title: "Ouvrir avec ReadAware",
                body: "Faites de ReadAware l'application par défaut pour vos fichiers de livres : un double-clic ouvre directement le lecteur, en ajoutant le livre à votre bibliothèque au passage. Si l'application est déjà ouverte, la fenêtre existante prend le relais — pas de seconde copie.",
              },
              {
                title: "Importer des livres par glisser-déposer",
                body: "Faites glisser des fichiers de livres n'importe où sur la fenêtre et ils sont importés sur-le-champ.",
              },
              {
                title: "Un regard plus attentif sur les illustrations",
                body: "Appuyez sur une image dans un livre pour l'afficher en plein écran. Zoomez autour du curseur avec la molette ou un pincement, faites glisser pour vous déplacer, double-cliquez pour basculer en mode ajustement, et une petite barre d'outils couvre le zoom, la rotation, la copie dans le presse-papiers et la fermeture.",
              },
            ],
          },
        ],
      },
      de: {
        summary:
          "Ein Patch, der die Haustür öffnet: Buchdateien öffnen direkt aus deinem Dateimanager, Import per Drag-and-drop, und jede Illustration bekommt einen Vollbild-Viewer.",
        groups: [
          {
            kind: "new",
            items: [
              {
                title: "Mit ReadAware öffnen",
                body: "Mach ReadAware zur Standard-App für deine Buchdateien, und ein Doppelklick auf eine Datei führt direkt in den Reader — das Buch wird dabei ins Regal aufgenommen. Wenn die App bereits läuft, übernimmt das bestehende Fenster — keine zweite Kopie.",
              },
              {
                title: "Bücher per Drag-and-drop importieren",
                body: "Zieh Buchdateien an eine beliebige Stelle im Fenster und sie werden sofort importiert.",
              },
              {
                title: "Ein genauerer Blick auf Illustrationen",
                body: "Tippe auf ein Bild in einem beliebigen Buch, um es im Vollbild zu betrachten. Zoome mit dem Mausrad oder einer Pinch-Geste um den Cursor, ziehe zum Verschieben, doppelklicke zum Umschalten der Ansicht, und eine kleine Symbolleiste deckt Zoomen, Drehen, Kopieren in die Zwischenablage und Schließen ab.",
              },
            ],
          },
        ],
      },
      ru: {
        summary:
          "Патч, который открывает входную дверь: файлы книг открываются прямо из файлового менеджера, импорт перетаскиванием, и у каждой иллюстрации теперь есть полноэкранный просмотрщик.",
        groups: [
          {
            kind: "new",
            items: [
              {
                title: "Открыть с помощью ReadAware",
                body: "Сделайте ReadAware приложением по умолчанию для файлов книг — двойной клик по файлу сразу открывает его в читалке, попутно добавляя книгу на вашу полку. Если приложение уже запущено, открытие происходит в существующем окне — без второго экземпляра.",
              },
              {
                title: "Перетащите книги для импорта",
                body: "Перетащите файлы книг в любую область окна, и они импортируются на месте.",
              },
              {
                title: "Ближе к иллюстрациям",
                body: "Нажмите на изображение в любой книге, чтобы просмотреть его в полноэкранном режиме. Масштабируйте колесом мыши или щипком (зум следует за курсором), перетаскивайте для панорамирования, двойной клик переключает режим «по размеру окна», а небольшая панель инструментов отвечает за зум, поворот, копирование в буфер обмена и закрытие.",
              },
            ],
          },
        ],
      },
      es: {
        summary:
          "Un parche que abre la puerta de entrada: los archivos de libros se abren directamente desde tu gestor de archivos, importación por arrastrar y soltar, y cada ilustración tiene un visor a pantalla completa.",
        groups: [
          {
            kind: "new",
            items: [
              {
                title: "Abrir con ReadAware",
                body: "Haz de ReadAware la aplicación predeterminada para tus archivos de libros y, al hacer doble clic en uno, entras directamente al lector, con el libro añadido a tu biblioteca de paso. Si la aplicación ya está abierta, la ventana existente se hace cargo — sin copias duplicadas.",
              },
              {
                title: "Arrastra libros para importar",
                body: "Arrastra archivos de libros a cualquier parte de la ventana y se importarán al instante.",
              },
              {
                title: "Una mirada más de cerca a las ilustraciones",
                body: "Toca una imagen en cualquier libro para verla a pantalla completa. Haz zoom alrededor del cursor con la rueda o con un pellizco, arrastra para desplazarte, haz doble clic para alternar el ajuste, y una pequeña barra de herramientas cubre el zoom, la rotación, copiar al portapapeles y cerrar.",
              },
            ],
          },
        ],
      },
    },
  },
  {
    version: "0.4.1",
    date: "2026-08-11",
    text: {
      en: {
        summary:
          "A patch for the statistics page and the sentence reader: charts you can tap, and a plugin that finally keeps its settings — plus a progress readout and a session timer — under its own roof.",
        groups: [
          {
            kind: "new",
            items: [
              {
                title: "Tap the charts",
                body: "The reading-stats bars now hand the ink highlight to whichever bar you tap — daily, weekday, and time-of-day charts alike — and it stays where you put it.",
              },
              {
                title: "The sentence reader keeps its own settings",
                body: "Step unit, tap to advance, and swipe to step moved into the plugin's own settings page, joined by two new options: a chapter position readout (12 / 87) and a session timer that restarts on every entry and is never saved. Both live on a small floating chip you can drag anywhere.",
              },
            ],
          },
          {
            kind: "improved",
            items: [
              {
                body: "Chart tooltips traded their floating card for a quiet ink label pinned above the bars.",
              },
              {
                body: "The About page shows the series codename beside the version.",
              },
            ],
          },
          {
            kind: "fixed",
            items: [
              {
                body: "The Total time headline no longer overflows on phones, and tapping a chart no longer draws a focus ring.",
              },
              {
                body: "Turning the readouts off in settings applies without restarting the app.",
              },
              {
                body: "iOS no longer shows two selection menus at once in the reader.",
              },
            ],
          },
        ],
      },
      zh: {
        summary:
          "一个属于统计页和逐句阅读的补丁：图表可以点了，插件的设置终于搬进了自己家——还带来了章内进度读数和本次阅读计时。",
        groups: [
          {
            kind: "new",
            items: [
              {
                title: "点得动的图表",
                body: "阅读统计的柱状图现在点到哪根，墨色高亮就跟到哪根——每日、按星期、按时段的图都一样，而且停在你点的位置。",
              },
              {
                title: "逐句阅读的独立设置页",
                body: "步进单位、点按前进、滑动步进搬进了插件自己的设置页，还多了两个新选项：本章位置读数（12 / 87）和每次进入重新计时、不做保存的阅读计时。两者都显示在一个可以随手拖动的小浮签上。",
              },
            ],
          },
          {
            kind: "improved",
            items: [
              {
                body: "图表提示从追着指针跑的卡片，换成了钉在柱子上方的墨色小标签。",
              },
              {
                body: "「关于」页在版本号旁边显示所属系列的代号。",
              },
            ],
          },
          {
            kind: "fixed",
            items: [
              {
                body: "手机上「总时长」不再溢出，点按图表也不再出现对焦外框。",
              },
              {
                body: "关闭读数开关无需重启应用即可生效。",
              },
              {
                body: "iOS 阅读器不再同时弹出两个选择菜单。",
              },
            ],
          },
        ],
      },
      ja: {
        summary:
          "統計ページと文・段落ナビゲーターのためのパッチです。グラフはタップに応え、プラグインは自分の設定ページを持ちました——章内の位置表示とセッションタイマーも一緒に。",
        groups: [
          {
            kind: "new",
            items: [
              {
                title: "タップできるグラフ",
                body: "読書統計の棒グラフは、タップした棒にインクのハイライトが移り、そのまま留まるようになりました。日別・曜日別・時間帯別のどのグラフでも同じです。",
              },
              {
                title: "文・段落ナビゲーターの設定ページ",
                body: "ステップ単位・タップで進む・スワイプで移動がプラグイン自身の設定ページに移り、新たに章内の位置表示（12 / 87）と、入るたびにリセットされ保存されないセッションタイマーが加わりました。どちらも自由にドラッグできる小さなフロートに表示されます。",
              },
            ],
          },
          {
            kind: "improved",
            items: [
              {
                body: "グラフのツールチップは、ポインターを追いかけるカードから棒の上に固定された墨色のラベルになりました。",
              },
              {
                body: "「情報」ページでバージョンの横にシリーズのコードネームを表示します。",
              },
            ],
          },
          {
            kind: "fixed",
            items: [
              {
                body: "スマートフォンで合計時間がはみ出す問題と、グラフのタップでフォーカス枠が出る問題を修正しました。",
              },
              {
                body: "表示の切り替えがアプリの再起動なしで反映されるようになりました。",
              },
              {
                body: "iOSのリーダーで選択メニューが二重に表示される問題を修正しました。",
              },
            ],
          },
        ],
      },
      "zh-hant": {
        "summary": "針對統計頁面和逐句閱讀的修補：可以點選的圖表，以及一個終於能把設定——包含進度顯示和本次閱讀計時——收在自己底下的外掛。",
        "groups": [
          {
            "kind": "new",
            "items": [
              {
                "title": "點選圖表",
                "body": "閱讀統計的長條圖現在會把墨色高亮標記放到你點選的那一根——無論是每日、星期幾還是時段圖表——而且它會停在你放的位置。"
              },
              {
                "title": "逐句閱讀保留自己的設定",
                "body": "步進單位、點擊前進和滑動步進，都移到了外掛自己的設定頁，並加入兩個新選項：章節位置顯示（12 / 87）和每次進入都會重新開始且永不儲存的本次閱讀計時。兩者都位於一個可以拖到任何地方的小型浮動晶片上。"
              }
            ]
          },
          {
            "kind": "improved",
            "items": [
              {
                "body": "圖表提示框原本的浮動卡片，換成了固定在長條上方的低調墨色標籤。"
              },
              {
                "body": "關於頁面在版本號旁邊顯示系列代號。"
              }
            ]
          },
          {
            "kind": "fixed",
            "items": [
              {
                "body": "總時間大標題不再在手機上溢出，點選圖表也不再畫出焦點框。"
              },
              {
                "body": "在設定中關閉顯示，不需要重新啟動應用程式就會生效。"
              },
              {
                "body": "iOS 上的閱讀器不再同時顯示兩個選取功能表。"
              }
            ]
          }
        ]
      },
      fr: {
        "summary": "Un correctif pour la page de statistiques et le lecteur de phrases : des graphiques tactiles, et un plugin qui garde enfin ses réglages — plus un affichage de progression et une minuterie de session — sous son propre toit.",
        "groups": [
          {
            "kind": "new",
            "items": [
              {
                "title": "Touchez les graphiques",
                "body": "Les barres de statistiques de lecture remettent maintenant l'encre de surlignage à la barre que vous touchez — quotidiens, hebdomadaires et horaires — et elle reste là où vous l'avez mise."
              },
              {
                "title": "Le lecteur de phrases garde ses propres réglages",
                "body": "L'unité de pas, le toucher pour avancer et le glissement pour passer sont déplacés dans la page de réglages du plugin, accompagnés de deux nouvelles options : un affichage de position dans le chapitre (12 / 87) et une minuterie de session qui redémarre à chaque entrée et n'est jamais enregistrée. Les deux vivent sur une petite puce flottante que vous pouvez déplacer n'importe où."
              }
            ]
          },
          {
            "kind": "improved",
            "items": [
              {
                "body": "Les infobulles des graphiques ont échangé leur carte flottante contre une étiquette d'encre discrète épinglée au-dessus des barres."
              },
              {
                "body": "La page À propos affiche le nom de code de la série à côté de la version."
              }
            ]
          },
          {
            "kind": "fixed",
            "items": [
              {
                "body": "Le titre « Temps total » ne déborde plus sur les téléphones, et toucher un graphique ne dessine plus d'anneau de focus."
              },
              {
                "body": "Désactiver les affichages dans les réglages s'applique sans redémarrer l'application."
              },
              {
                "body": "iOS n'affiche plus deux menus de sélection à la fois dans le lecteur."
              }
            ]
          }
        ]
      },
      de: {
        "summary": "Ein Patch für die Statistikseite und den Satz-Reader: Diagramme, die du antippen kannst, und ein Plugin, das seine Einstellungen endlich unter einem eigenen Dach behält — plus eine Fortschrittsanzeige und einen Sitzungstimer.",
        "groups": [
          {
            "kind": "new",
            "items": [
              {
                "title": "Diagramme antippen",
                "body": "Die Balken der Lesestatistik geben den Tinten-Highlight jetzt an den Balken weiter, den du antippst — bei Tages-, Wochentags- und Tageszeit-Diagrammen gleichermaßen — und er bleibt dort, wo du ihn platziert hast."
              },
              {
                "title": "Der Satz-Reader behält seine eigenen Einstellungen",
                "body": "Schrittgröße, Tippen zum Weitergehen und Wischen zum Schalten sind in die eigene Einstellungsseite des Plugins gewandert, ergänzt um zwei neue Optionen: eine Kapitel-Positionsanzeige (12 / 87) und einen Sitzungstimer, der bei jedem Eintritt neu startet und nie gespeichert wird. Beide leben auf einem kleinen schwebenden Chip, den du ziehen kannst."
              }
            ]
          },
          {
            "kind": "improved",
            "items": [
              {
                "body": "Diagramm-Tooltips haben ihre schwebende Karte gegen ein dezentes Tinten-Label direkt über den Balken getauscht."
              },
              {
                "body": "Die Über-Seite zeigt neben der Version den Codenamen der Serie."
              }
            ]
          },
          {
            "kind": "fixed",
            "items": [
              {
                "body": "Die Überschrift „Gesamtzeit“ läuft auf Telefonen nicht mehr über, und das Antippen eines Diagramms zeichnet keinen Fokusring mehr."
              },
              {
                "body": "Das Deaktivieren der Anzeigen in den Einstellungen greift ohne Neustart der App."
              },
              {
                "body": "Unter iOS erscheinen im Reader nicht mehr zwei Auswahlmenüs gleichzeitig."
              }
            ]
          }
        ]
      },
      ru: {
        "summary": "Патч для страницы статистики и по предложениям: диаграммы, по которым можно нажимать, и плагин, который наконец хранит свои настройки — плюс индикатор прогресса и таймер сессии — под своей крышей.",
        "groups": [
          {
            "kind": "new",
            "items": [
              {
                "title": "Нажимайте на диаграммы",
                "body": "Полосы статистики чтения теперь передают чернильное выделение той полосе, на которую вы нажимаете — на диаграммах по дням, будням и времени суток — и оно остаётся, где вы его оставили."
              },
              {
                "title": "По предложениям хранит собственные настройки",
                "body": "Шаг, нажатие для продолжения и свайп для шага переехали на собственную страницу настроек плагина, к ним добавились две новые опции: индикатор позиции в главе (12 / 87) и таймер сессии, который перезапускается при каждом входе и никогда не сохраняется. Оба живут на небольшом плавающем чипе, который можно перетаскивать куда угодно."
              }
            ]
          },
          {
            "kind": "improved",
            "items": [
              {
                "body": "Всплывающие подсказки диаграмм обменяли свою плавающую карточку на тихую чернильную метку, закреплённую над полосами."
              },
              {
                "body": "На странице «О программе» рядом с версией показывается кодовое имя серии."
              }
            ]
          },
          {
            "kind": "fixed",
            "items": [
              {
                "body": "Заголовок «Общее время» больше не переполняется на телефонах, а нажатие на диаграмму больше не рисует кольцо фокуса."
              },
              {
                "body": "Отключение индикаторов в настройках применяется без перезапуска приложения."
              },
              {
                "body": "iOS больше не показывает два меню выделения одновременно в ридере."
              }
            ]
          }
        ]
      },
      es: {
        "summary": "Un parche para la página de estadísticas y el lector de frases: gráficos que puedes tocar, y un plugin que por fin mantiene sus ajustes — además de un indicador de progreso y un temporizador de sesión — bajo su propio techo.",
        "groups": [
          {
            "kind": "new",
            "items": [
              {
                "title": "Toca los gráficos",
                "body": "Las barras de estadísticas de lectura ahora pasan el subrayado de tinta a la barra que toques — tanto en los gráficos diarios, por día de la semana y por hora del día — y se queda donde lo pongas."
              },
              {
                "title": "El lector de frases guarda sus propios ajustes",
                "body": "Unidad de paso, tocar para avanzar y deslizar para avanzar se movieron a la página de ajustes del propio plugin, junto con dos opciones nuevas: un indicador de posición en el capítulo (12 / 87) y un temporizador de sesión que se reinicia en cada entrada y nunca se guarda. Ambos viven en una pequeña pastilla flotante que puedes arrastrar a cualquier lugar."
              }
            ]
          },
          {
            "kind": "improved",
            "items": [
              {
                "body": "Las descripciones emergentes de los gráficos cambiaron su tarjeta flotante por una etiqueta de tinta discreta fijada sobre las barras."
              },
              {
                "body": "La página Acerca de muestra el nombre en clave de la serie junto a la versión."
              }
            ]
          },
          {
            "kind": "fixed",
            "items": [
              {
                "body": "El encabezado de Tiempo total ya no se desborda en teléfonos, y tocar un gráfico ya no dibuja un anillo de enfoque."
              },
              {
                "body": "Desactivar los indicadores en los ajustes se aplica sin reiniciar la app."
              },
              {
                "body": "iOS ya no muestra dos menús de selección a la vez en el lector."
              }
            ]
          }
        ]
      },
    },
  },
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
      "zh-hant": {
        "summary": "El Alto 系列的第一個版本，也是關於「距離」的版本：閱讀時需要的操作移到了句子本身，值得開啟的面板移到一指之遙，而智慧助理也不再繞路才回答。",
        "groups": [
          {
            "kind": "new",
            "items": [
              {
                "title": "點選句子",
                "body": "在逐句或逐段閱讀時，點選被標記的句子，操作就會出現在那裡——複製、劃線、底線、筆記、詢問 AI、字典——不用伸手去按底部的工具列。"
              },
              {
                "title": "用門取代工具列",
                "body": "浮動導覽列可以一指開啟目錄、你的筆記、閱讀外觀或聊天，並在手機上自動分頁，永遠保持在一行內。"
              },
              {
                "title": "更新會自我介紹",
                "body": "應用程式更新後，一個低調的連結會用你的語言開啟這份更新日誌。你可以關掉它，或讓它兩天後自己淡出。"
              }
            ]
          },
          {
            "kind": "improved",
            "items": [
              {
                "body": "閱讀智慧助理會用你輸入的語言回答，以小時和分鐘回報閱讀時間（而非原始計數器），而且在回答書籍相關問題前，不再盤點你的統計資料。"
              },
              {
                "body": "劇透保護現在也限制了智慧助理對知名小說可能已知的資訊——除了你的閱讀位置之外，什麼都不知道，除非你明確要求被劇透。"
              }
            ]
          },
          {
            "kind": "fixed",
            "items": [
              {
                "body": "外部連結——關於面板、「有什麼新玩意」的門——現在真的會開啟你的瀏覽器了。"
              },
              {
                "body": "貼上的 API 金鑰會被拒絕，不會回顯到對話中。"
              },
              {
                "body": "書籍卡片不會再於一次回覆中被呈現兩次。"
              }
            ]
          }
        ]
      },
      fr: {
        "summary": "La première version de la série El Alto, et une version sur la distance : les actions nécessaires pendant la lecture sont déplacées sur la phrase elle-même, les panneaux qui valent la peine d'être ouverts sont à un toucher, et l'assistant a cessé de faire des détours avant de répondre.",
        "groups": [
          {
            "kind": "new",
            "items": [
              {
                "title": "Touchez la phrase",
                "body": "En lecture phrase ou paragraphe, toucher la phrase surlignée ouvre ses actions juste là — copier, surligner, souligner, note, demander à l'IA, dictionnaire — au lieu d'atteindre la barre du bas."
              },
              {
                "title": "Des portes au lieu d'une barre d'outils",
                "body": "La bande de navigation flottante ouvre la table des matières, vos notes, l'apparence de lecture ou le chat en un toucher, et se pagine sur les téléphones pour tenir sur une seule rangée."
              },
              {
                "title": "Les mises à jour se présentent",
                "body": "Après la mise à jour de l'application, un lien discret ouvre ce journal des modifications dans votre langue. Fermez-le, ou laissez-le disparaître tout seul après deux jours."
              }
            ]
          },
          {
            "kind": "improved",
            "items": [
              {
                "body": "L'assistant de lecture répond dans la langue dans laquelle vous écrivez, rapporte le temps de lecture en heures et minutes plutôt qu'en compteurs bruts, et n'inventorie plus vos statistiques avant de répondre à une question sur le livre."
              },
              {
                "body": "La protection contre les spoilers encadre désormais aussi ce que l'assistant pourrait déjà savoir d'un roman célèbre — rien au-delà de votre position de lecture, sauf si vous demandez explicitement à être spoilé."
              }
            ]
          },
          {
            "kind": "fixed",
            "items": [
              {
                "body": "Les liens externes — le panneau À propos, la porte des nouveautés — ouvrent maintenant réellement votre navigateur."
              },
              {
                "body": "Une clé API collée est refusée sans être renvoyée en écho dans la conversation."
              },
              {
                "body": "Les cartes de livre ne peuvent plus être présentées deux fois dans une même réponse."
              }
            ]
          }
        ]
      },
      de: {
        "summary": "Die erste Version der El-Alto-Serie, und eine Version über Distanz: Die Aktionen, die du beim Lesen brauchst, sind auf den Satz selbst gewandert, die Panels, die sich lohnen, sind einen Tipp entfernt, und der Assistent macht keine Umwege mehr vor der Antwort.",
        "groups": [
          {
            "kind": "new",
            "items": [
              {
                "title": "Tippe auf den Satz",
                "body": "Beim Satz- oder Absatz-Lesen öffnet das Antippen des hervorgehobenen Satzes seine Aktionen direkt dort — kopieren, markieren, unterstreichen, Notiz, KI fragen, Wörterbuch — statt eines Griffes zur unteren Leiste."
              },
              {
                "title": "Türen statt einer Symbolleiste",
                "body": "Der schwebende Navigationsstreifen öffnet das Inhaltsverzeichnis, deine Notizen, das Lese-Erscheinungsbild oder den Chat in einem Tipp und paginiert auf Telefonen, sodass er immer in eine Zeile passt."
              },
              {
                "title": "Updates stellen sich vor",
                "body": "Nach einem App-Update öffnet ein dezenter Link dieses Änderungsprotokoll in deiner Sprache. Schließe es oder lass es nach zwei Tagen von selbst verblassen."
              }
            ]
          },
          {
            "kind": "improved",
            "items": [
              {
                "body": "Der Lese-Assistent antwortet in der Sprache, in der du schreibst, meldet die Lesezeit in Stunden und Minuten statt in rohen Zählern und inventarisiert deine Statistiken nicht mehr, bevor er eine Frage zum Buch beantwortet."
              },
              {
                "body": "Der Spoiler-Schutz begrenzt jetzt auch, was der Assistent über einen berühmten Roman bereits wissen darf — nichts über deinen Lesestand hinaus, es sei denn, du fragst ausdrücklich nach Spoiler."
              }
            ]
          },
          {
            "kind": "fixed",
            "items": [
              {
                "body": "Externe Links — das Über-Panel, die Was-ist-neu-Tür — öffnen jetzt wirklich deinen Browser."
              },
              {
                "body": "Ein eingefügter API-Schlüssel wird abgelehnt, ohne ins Gespräch zurückgegeben zu werden."
              },
              {
                "body": "Buchkarten können nicht mehr zweimal in einer Antwort präsentiert werden."
              }
            ]
          }
        ]
      },
      ru: {
        "summary": "Первый выпуск серии El Alto, и выпуск о дистанции: действия, которые нужны при чтении, переехали прямо на само предложение, панели, которые стоит открывать, оказались в одном нажатии, а ассистент перестал делать крюки перед ответом.",
        "groups": [
          {
            "kind": "new",
            "items": [
              {
                "title": "Нажмите на предложение",
                "body": "В режиме по предложениям или абзацам нажатие на выделенное предложение открывает его действия прямо здесь — копировать, выделить, подчеркнуть, заметка, спросить ИИ, словарь — вместо потягивания к нижней панели."
              },
              {
                "title": "Двери вместо панели инструментов",
                "body": "Плавающая полоса навигации открывает оглавление, ваши заметки, внешний вид чтения или чат одним нажатием и сама разбивается на страницы на телефонах, чтобы всегда помещаться в одну строку."
              },
              {
                "title": "Обновления представляются",
                "body": "После обновления приложения тихая ссылка открывает этот журнал изменений на вашем языке. Закройте её или дайте ей исчезнуть через два дня."
              }
            ]
          },
          {
            "kind": "improved",
            "items": [
              {
                "body": "Ассистент чтения отвечает на языке, на котором вы пишете, сообщает время чтения в часах и минутах, а не сырыми счётчиками, и больше не перечисляет вашу статистику перед ответом на вопрос о книге."
              },
              {
                "body": "Защита от спойлеров теперь также ограничивает то, что ассистент может уже знать о знаменитом романе — ничего за пределами вашей позиции чтения, если вы явно не попросите спойлеры."
              }
            ]
          },
          {
            "kind": "fixed",
            "items": [
              {
                "body": "Внешние ссылки — панель «О программе», дверь «Что нового» — теперь действительно открывают ваш браузер."
              },
              {
                "body": "Вставленный API-ключ отклоняется без отображения в разговоре."
              },
              {
                "body": "Карточки книг больше нельзя показать дважды в одном ответе."
              }
            ]
          }
        ]
      },
      es: {
        "summary": "La primera versión de la serie El Alto, y una versión sobre la distancia: las acciones que necesitas al leer se movieron a la propia frase, los paneles que vale la pena abrir quedaron a un toque de distancia, y el asistente dejó de tomar desvíos antes de responder.",
        "groups": [
          {
            "kind": "new",
            "items": [
              {
                "title": "Toca la frase",
                "body": "En la lectura frase a frase o párrafo a párrafo, tocar la frase resaltada abre sus acciones justo ahí — copiar, subrayar, subrayar, nota, preguntar a IA, diccionario — en lugar de estirarte hacia la barra inferior."
              },
              {
                "title": "Puertas en lugar de una barra de herramientas",
                "body": "La franja flotante de navegación abre el índice, tus notas, la apariencia de lectura o el chat con un toque, y se pagina sola en teléfonos para que siempre quepa en una fila."
              },
              {
                "title": "Las actualizaciones se presentan solas",
                "body": "Después de que la app se actualice, un enlace discreto abre este registro de cambios en tu idioma. Ciérralo o déjalo que se desvanezca solo después de dos días."
              }
            ]
          },
          {
            "kind": "improved",
            "items": [
              {
                "body": "El asistente de lectura responde en el idioma en que escribes, informa el tiempo de lectura en horas y minutos en lugar de contadores directos, y ya no inventaría tus estadísticas antes de responder una pregunta sobre el libro."
              },
              {
                "body": "La protección de spoilers ahora también delimita lo que el asistente pueda saber ya sobre una novela famosa — nada más allá de tu posición de lectura, a menos que pidas explícitamente que te lo revelen."
              }
            ]
          },
          {
            "kind": "fixed",
            "items": [
              {
                "body": "Los enlaces externos — el panel Acerca de, la puerta de novedades — ahora sí abren tu navegador."
              },
              {
                "body": "Una clave API pegada se rechaza sin que se devuelva en la conversación."
              },
              {
                "body": "Las tarjetas de libro ya no se pueden presentar dos veces en una sola respuesta."
              }
            ]
          }
        ]
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
      "zh-hant": {
        "summary": "這個版本關於 PDF，也關於閱讀器的外殼知道何時該讓路。PDF 頁面是一張圖片，所以頁面顏色永遠到不了它，而每個固定版面的書籍在深色應用程式裡都停留在白紙上——這已修正，同時也修正了那些書籍提供但無法兌現的控制項。",
        "groups": [
          {
            "kind": "new",
            "items": [
              {
                "title": "PDF 跟隨頁面顏色",
                "body": "淺色調色盤會在繪製頁面時為紙張上色，讓每個墨跡和照片都保持原樣。深色調色盤則會以兩種色調重繪頁面，讓文字保持可讀，而不是在深色紙上呈現黑色墨水。"
              },
              {
                "title": "頁面彩現",
                "body": "讓一本書保持原始顏色，而其餘一切都跟隨你的調色盤。每個書本個別記憶，適用於顏色本身就是重點的藝術和攝影書籍。"
              }
            ]
          },
          {
            "kind": "improved",
            "items": [
              {
                "body": "固定版面的書籍不再提供它們無法兌現的排版選項。PDF 或漫畫是一系列別人已經排好版的頁面，所以這些書籍的字型、大小、粗細、間距、對齊和邊距選項都不見了。頁面顏色和閱讀模式保留下來，因為兩者都仍能看到效果。"
              }
            ]
          },
          {
            "kind": "fixed",
            "items": [
              {
                "body": "閱讀器的工具列不再在你點選頁面後閃現然後隨即消失。任何會重新流排文字的東西——軟體鍵盤、旋轉裝置、改變字型大小——之前都會被誤認為是翻頁。"
              },
              {
                "body": "聊天輸入框在你開啟面板時取得游標，而不是每次工具列重新出現時。在手機上，這曾導致鍵盤彈出，蓋過你只是想看一眼的頁面。"
              }
            ]
          }
        ]
      },
      fr: {
        "summary": "Une version sur les PDF, et sur le chrome du lecteur qui sait quand s'effacer. Une page PDF est une image, donc la couleur de page ne l'atteignait jamais et chaque livre à mise en page fixe restait sur du papier blanc dans une application sombre — c'est corrigé, ainsi que les contrôles que ces livres proposaient mais ne pouvaient pas honorer.",
        "groups": [
          {
            "kind": "new",
            "items": [
              {
                "title": "Les PDF suivent la couleur de page",
                "body": "Une palette claire teinte le papier pendant le dessin de la page, laissant chaque encre et photographie exactement comme imprimé. Une palette sombre redessine la page en deux tons, pour que le texte reste lisible au lieu de se trouver en encre noire sur une feuille sombre."
              },
              {
                "title": "Rendu de page",
                "body": "Gardez un livre dans ses couleurs originales pendant que tout le reste suit votre palette. Mémorisé par livre, pour l'art et la photographie où la couleur est essentielle."
              }
            ]
          },
          {
            "kind": "improved",
            "items": [
              {
                "body": "Les livres à mise en page fixe ne proposent plus de typographie qu'ils ne peuvent pas honorer. Un PDF ou une BD est une séquence de pages déjà mis en pages par quelqu'un d'autre, donc la police, la taille, le poids, l'espacement, l'alignement et les marges sont supprimés pour ces livres. La couleur de page et le mode de lecture restent, car les deux font encore un travail visible."
              }
            ]
          },
          {
            "kind": "fixed",
            "items": [
              {
                "body": "La barre d'outils du lecteur ne clignote plus et ne disparaît plus un instant après avoir touché la page. Tout ce qui re-flux le texte — le clavier logiciel, la rotation de l'appareil, le changement de taille de police — était pris pour un tour de page."
              },
              {
                "body": "Le compositeur de chat prend le curseur lorsque vous ouvrez le panneau, pas à chaque réapparition de la barre d'outils. Sur un téléphone qui jetait le clavier sur une page que vous souhaitiez simplement regarder."
              }
            ]
          }
        ]
      },
      de: {
        "summary": "Eine Version über PDFs und darüber, dass die Reader-Umgebung weiß, wann sie sich zurücknehmen soll. Eine PDF-Seite ist ein Bild, also erreichte die Seitenfarbe sie nie, und jedes feste Layout blieb in einer dunklen App auf weißem Papier — das ist behoben, zusammen mit den Bedienelementen, die diese Bücher anboten, aber nicht einhalten konnten.",
        "groups": [
          {
            "kind": "new",
            "items": [
              {
                "title": "PDFs folgen der Seitenfarbe",
                "body": "Eine helle Palette färbt das Papier, während die Seite gezeichnet wird, und lässt jede Tinte und jedes Foto exakt wie gedruckt. Eine dunkle Palette zeichnet die Seite in zwei Tönen neu, damit der Text lesbar bleibt, statt als schwarze Tinte auf dunklem Blatt zu sitzen."
              },
              {
                "title": "Seitenwiedergabe",
                "body": "Behalte ein Buch in den Originalfarben, während alles andere deiner Palette folgt. Pro Buch gespeichert, für die Kunst und Fotografie, bei denen es auf die Farbe ankommt."
              }
            ]
          },
          {
            "kind": "improved",
            "items": [
              {
                "body": "Bücher mit festem Layout bieten keine Typografie mehr an, die sie nicht einhalten können. Ein PDF oder Comic ist eine Abfolge von Seiten, die jemand anderes bereits gesetzt hat, daher sind Schriftart, -größe, -stärke, Zeilenabstand, Ausrichtung und Ränder für diese Bücher verschwunden. Seitenfarbe und Lesemodus bleiben, weil beide sichtbare Arbeit leisten."
              }
            ]
          },
          {
            "kind": "fixed",
            "items": [
              {
                "body": "Die Reader-Symbolleiste erscheint nicht mehr kurz und verschwindet einen Moment nach dem Antippen der Seite. Alles, was den Text neu fließen lässt — die Soft-Tastatur, das Drehen des Geräts, die Änderung der Schriftgröße — wurde fälschlich für einen Seitenwechsel gehalten."
              },
              {
                "body": "Der Chat-Editor übernimmt den Cursor, wenn du das Panel öffnest, nicht jedes Mal, wenn die Symbolleiste wieder erscheint. Auf einem Telefon, das die Tastatur über eine Seite geworfen hatte, die du nur ansehen wolltest."
              }
            ]
          }
        ]
      },
      ru: {
        "summary": "Выпуск о PDF и о том, как хром ридера учится уступать дорогу. Страница PDF — это картинка, поэтому цвет страницы до неё не доходил, и каждая книга с фиксированной вёрсткой оставалась на белой бумаге внутри тёмного приложения — это исправлено, вместе с элементами управления, которые такие книги предлагали, но не могли выполнить.",
        "groups": [
          {
            "kind": "new",
            "items": [
              {
                "title": "PDF следуют за цветом страницы",
                "body": "Светлая палитра подкрашивает бумагу при отрисовке страницы, оставляя каждые чернила и фотографии точно как напечатано. Тёмная палитра перерисовывает страницу в двух тонах, чтобы текст оставался читаемым, а не лежал чёрными чернилами на тёмном листе."
              },
              {
                "title": "Отрисовка страницы",
                "body": "Держите книгу на исходных цветах, пока всё остальное следует вашей палитре. Запоминается для каждой книги, для искусства и фотографии, где цвет и есть суть."
              }
            ]
          },
          {
            "kind": "improved",
            "items": [
              {
                "body": "Книги с фиксированной вёрсткой больше не предлагают типографику, которую не могут выполнить. PDF или комикс — это последовательность страниц, которые кто-то уже свёрстал, поэтому шрифт, размер, насыщенность, интервалы, выравнивание и поля исчезают для таких книг. Цвет страницы и режим чтения остаются, потому что оба по-прежнему выполняют видимую работу."
              }
            ]
          },
          {
            "kind": "fixed",
            "items": [
              {
                "body": "Панель инструментов ридера больше не мигает и не исчезает через мгновение после нажатия на страницу. Всё, что переформатирует текст — мягкая клавиатура, поворот устройства, изменение размера шрифта — раньше принималось за перелистывание страницы."
              },
              {
                "body": "Поле ввода чата берёт каретку при открытии панели, а не каждый раз, когда панель инструментов появляется снова. На телефоне, который раньше выбрасывал клавиатуру поверх страницы, которую вы хотели лишь мельком увидеть."
              }
            ]
          }
        ]
      },
      es: {
        "summary": "Una versión sobre PDFs, y sobre el marco del lector sabiendo cuándo apartarse. Una página PDF es una imagen, así que el color de página nunca llegaba a ella y todo libro de diseño fijo permanecía en papel blanco dentro de una app oscura — eso está corregido, junto con los controles que esos libros ofrecían pero no podían honrar.",
        "groups": [
          {
            "kind": "new",
            "items": [
              {
                "title": "Los PDFs siguen el color de página",
                "body": "Una paleta clara tiñe el papel mientras se dibuja la página, dejando cada tinta y fotografía exactamente como se imprimió. Una paleta oscura redibuja la página en dos tonos, para que el texto siga siendo legible en lugar de quedar como tinta negra sobre una hoja oscura."
              },
              {
                "title": "Renderizado de página",
                "body": "Mantén un libro en sus colores originales mientras todo lo demás sigue tu paleta. Se recuerda por libro, para el arte y la fotografía donde el color es el punto."
              }
            ]
          },
          {
            "kind": "improved",
            "items": [
              {
                "body": "Los libros de diseño fijo ya no ofrecen tipografía que no pueden honrar. Un PDF o un cómic es una secuencia de páginas que alguien más ya maquetó, así que fuente, tamaño, peso, espaciado, alineación y márgenes desaparecen para esos libros. El color de página y el modo de lectura permanecen, porque ambos siguen haciendo un trabajo visible."
              }
            ]
          },
          {
            "kind": "fixed",
            "items": [
              {
                "body": "La barra de herramientas del lector ya no parpadea y desaparece un momento después de tocar la página. Cualquier cosa que refluya el texto — el teclado suave, girar el dispositivo, cambiar el tamaño de fuente — se confundía con un paso de página."
              },
              {
                "body": "El compositor de chat toma el cursor cuando abres el panel, no cada vez que reaparece la barra de herramientas. En un teléfono que había estado lanzando el teclado sobre una página que solo querías mirar."
              }
            ]
          }
        ]
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
      "zh-hant": {
        "summary": "這個版本中，應用程式不再是一組固定的功能，而是變成你可以擴充的東西。外掛在真正的沙盒中執行，為幾乎每個介面貢獻功能，並透過外掛市場發佈。智慧助理增加了工具和軌跡，閱讀器增加了結局，而且書籍和對話都讓你自由排版。",
        "groups": [
          {
            "kind": "new",
            "items": [
              {
                "title": "外掛",
                "body": "完整的外掛系統：具有權限控管功能的沙盒工作執行緒、TypeScript 優先的創作路徑，以及安裝時徵求同意之外掛市場。外掛可以貢獻閱讀器選單、頁首、命令面板項目、整個頁面、AI 工具、字典查詢、主題和內建字型、語音引擎、排程任務，甚至可以貢獻像其他書籍一樣住在你書架上的虛擬書籍。五個外掛內建——字典、RSS 閱讀器、逐句閱讀、TTS 語音和編輯主題。"
              },
              {
                "title": "朗讀",
                "body": "閱讀器會說話，並跟隨你閱讀時使用的相同逐句和逐段導覽。任何 TTS 引擎都可以接入，支援每個供應商的語音和自訂端點。"
              },
              {
                "title": "一個結局",
                "body": "讀完一本書現在會進入一個書末畫面，而不是直接停住，並伴隨智慧助理寫的選擇性回顧。"
              },
              {
                "title": "智慧助理成為目的地",
                "body": "智慧助理有自己的主頁面，包含多個對話執行緒、以你在書中的實際位置為基礎、可展開的執行軌跡，以及能安全讀取和變更你設定的工具。"
              },
              {
                "title": "更多格式",
                "body": "CBZ、CBR、TXT 和 HTML 加入了 EPUB、MOBI、AZW3、FB2 和 PDF。封面和中繼資料會在匯入時填入。"
              },
              {
                "title": "打造你的專屬",
                "body": "主導覽和每個選單介面都可以拖曳排列。命令面板在閱讀時也能使用，Mod+1..9 可以在目的地之間跳轉。"
              },
              {
                "title": "為應用程式排版，不只是為書",
                "body": "聊天回覆、筆記和外掛檢視都有自己的字型、大小和行距——預設跟隨你的閱讀設定，如果你願意，也可以獨立出來。文字對齊也變成一個閱讀設定，預設跟隨出版者的選擇。"
              }
            ]
          },
          {
            "kind": "improved",
            "items": [
              {
                "body": "閱讀器頁首的進度列是可以拖曳的 scrubber。"
              },
              {
                "body": "固定版面的書籍（PDF、漫畫）可以接受標註和滑動翻頁。"
              },
              {
                "body": "AI 供應商設定更簡單，會記住每個供應商的模型，並支援智慧型和快速模型的分層思考力度。"
              },
              {
                "body": "你的 API 金鑰會加密儲存，AI 請求也改走原生 HTTP 而非 webview。"
              },
              {
                "body": "所有狀態變更都以事件溯源：投影會從 append-only 日誌重建，並可與之驗證。"
              },
              {
                "body": "書架格線會填滿寬視窗，從檔案名稱取得的書名也乾淨了。"
              },
              {
                "body": "桌面版應用程式會繼承你的 macOS 系統代理設定。"
              },
              {
                "body": "開發版有自己獨立的身分和資料目錄，不再與正式版共用書架。"
              },
              {
                "body": "readaware.app 上的文件和部落格現在提供英文、簡體中文和日文版本。"
              }
            ]
          },
          {
            "kind": "fixed",
            "items": [
              {
                "body": "樣式表鎖定近黑色文字顏色的書籍，不再在深色頁面顏色下隱形——一整類由 calibre 轉換的 EPUB 在深色模式下無法閱讀。"
              },
              {
                "body": "EPUB 3 的內聯註腳主體會保持隱藏，並在彈出視窗中開啟，而不是把一整章的註解倒進正文裡。"
              },
              {
                "body": "行距設定現在對那些在段落上宣告自己行高的書籍也有效，之前是完全沒作用。"
              },
              {
                "body": "真實世界 .txt 檔案中的章節標題可以被辨識。"
              },
              {
                "body": "Android 內建外掛隨附出貨，並用實際使用的 scheme 提供外掛資源。"
              },
              {
                "body": "外掛市場會記住最後一個可用的鏡像。"
              },
              {
                "body": "在觸控裝置上，閱讀器進度列上的零星點擊不再觸發跳轉。"
              },
              {
                "body": "外掛頁面像頁面一樣捲動，當上方內容改變時虛擬行會重新測量，開啟的設定表單會採用外部寫入而非遮蔽它們。"
              },
              {
                "body": "外掛市場的檔案路徑經過允許清單驗證，封閉了 Windows 磁碟機相對路徑繞過的漏洞。"
              }
            ]
          }
        ]
      },
      fr: {
        "summary": "La version où l'application cesse d'être un ensemble fixe de fonctionnalités et devient quelque chose que vous étendez. Les plugins tournent dans de vrais sandbox, contribuent à presque toutes les surfaces et sont distribués via un marketplace. L'agent gagne des outils et des traces, le lecteur gagne une fin, et le livre comme la conversation sont désormais à vous de composer.",
        "groups": [
          {
            "kind": "new",
            "items": [
              {
                "title": "Plugins",
                "body": "Un système de plugins complet : des workers sandboxés avec des capacités contrôlées par permissions, un chemin de création TypeScript-first, et un marketplace avec consentement à l'installation. Les plugins contribuent aux menus du lecteur, aux en-têtes, aux entrées de la palette de commandes, à des pages entières, à des outils IA, à des recherches dans le dictionnaire, à des thèmes et polices groupées, à des moteurs de voix, à des tâches planifiées, et même à des livres virtuels qui vivent sur votre étagère comme tout autre titre. Cinq sont inclus — Dictionnaire, Lecteur RSS, Lecteur de phrases, Voix TTS et Thèmes éditoriaux."
              },
              {
                "title": "Lecture à voix haute",
                "body": "Le lecteur parle, en suivant le même navigateur de phrases et de paragraphes que vous utilisez pour lire. N'importe quel moteur TTS peut se brancher, avec des voix par fournisseur et des points de terminaison personnalisés."
              },
              {
                "title": "Une fin",
                "body": "Terminer un livre mène maintenant à un écran de fin de livre au lieu d'un arrêt brutal, avec un regard en arrière optionnel écrit par l'agent."
              },
              {
                "title": "L'agent comme destination",
                "body": "L'agent obtient sa propre page principale avec plusieurs fils de discussion, un ancrage dans l'endroit où vous en êtes réellement dans le livre, des traces d'exécution dépliables et des outils qui peuvent lire et modifier vos réglages en toute sécurité."
              },
              {
                "title": "Plus de formats",
                "body": "CBZ, CBR, TXT et HTML rejoignent EPUB, MOBI, AZW3, FB2 et PDF. Les couvertures et métadonnées se remplissent à l'importation."
              },
              {
                "title": "Faites-le vôtre",
                "body": "La navigation principale et toutes les surfaces de menu sont réorganisables par glisser-déposer. La palette de commandes fonctionne pendant la lecture, et Mod+1..9 saute entre les destinations."
              },
              {
                "title": "Typographie pour l'application, pas seulement pour le livre",
                "body": "Les réponses du chat, les notes et les vues de plugin obtiennent leur propre police, taille et interligne — suivant vos réglages de lecture par défaut, ou détachés si vous préférez. L'alignement du texte devient aussi un réglage de lecture, par défaut selon le choix de l'éditeur."
              }
            ]
          },
          {
            "kind": "improved",
            "items": [
              {
                "body": "La barre de progression dans l'en-tête du lecteur est un curseur que vous pouvez faire glisser."
              },
              {
                "body": "Les livres à mise en page fixe (PDF, BD) acceptent les annotations et les balayages pour tourner les pages."
              },
              {
                "body": "La configuration du fournisseur IA est plus simple, mémorise un modèle par fournisseur et prend en charge l'effort de réflexion par niveau pour les modèles intelligents et rapides."
              },
              {
                "body": "Votre clé API est chiffrée au repos, et les requêtes IA passent par HTTP natif au lieu de la webview."
              },
              {
                "body": "Tous les changements d'état sont event-sourcés : les projections se reconstruisent à partir d'un journal append-only et peuvent être vérifiées par rapport à celui-ci."
              },
              {
                "body": "La grille de l'étagère remplit les fenêtres larges, et les titres de livres issus de noms de fichiers sortent propres."
              },
              {
                "body": "L'application de bureau hérite du proxy système macOS."
              },
              {
                "body": "Les builds de développement ont leur propre identité et répertoire de données, afin de ne plus partager la bibliothèque de l'application de version."
              },
              {
                "body": "Les docs et le blog sur readaware.app sont maintenant disponibles en anglais, chinois simplifié et japonais."
              }
            ]
          },
          {
            "kind": "fixed",
            "items": [
              {
                "body": "Les livres dont les feuilles de style fixent une couleur de texte quasi noire ne sont plus invisibles sur la couleur de page sombre — toute une classe d'EPUB convertis avec calibre était illisible en mode sombre."
              },
              {
                "body": "Les corps de notes de bas de page en ligne EPUB 3 restent cachés et s'ouvrent dans une popover, au lieu de déverser un chapitre de notes dans la prose."
              },
              {
                "body": "Le réglage d'interligne fonctionne maintenant sur les livres qui déclarent leur propre hauteur de ligne sur les paragraphes, où il ne faisait auparavant rien du tout."
              },
              {
                "body": "Les titres de chapitres dans les vrais fichiers .txt sont reconnus."
              },
              {
                "body": "Android est livré avec ses plugins intégrés et sert les ressources des plugins via le schéma qu'il utilise réellement."
              },
              {
                "body": "Le marketplace se souvient du dernier miroir qui a fonctionné."
              },
              {
                "body": "Les touchers parasites sur la barre de progression du lecteur ne cherchent plus sur les appareils tactiles."
              },
              {
                "body": "Les pages de plugin défilent comme des pages, les rangées virtuelles se re-mesurent lorsque le contenu au-dessus change, et les formulaires de réglages ouverts adoptent les écritures externes au lieu de les masquer."
              },
              {
                "body": "Les chemins de fichiers du marketplace sont validés par liste blanche, fermant un contournement de chemin relatif au lecteur Windows."
              }
            ]
          }
        ]
      },
      de: {
        "summary": "Die Version, in der die App aufhört, eine feste Reihe von Funktionen zu sein, und etwas wird, das du erweiterst. Plugins laufen in echten Sandboxen, tragen zu fast jeder Oberfläche bei und werden über einen Marktplatz ausgeliefert. Der Agent bekommt Werkzeuge und Ablaufspuren, der Reader bekommt ein Ende, und sowohl das Buch als auch das Gespräch gehören jetzt dir zum Setzen.",
        "groups": [
          {
            "kind": "new",
            "items": [
              {
                "title": "Plugins",
                "body": "Ein vollständiges Plugin-System: Sandbox-Worker mit permission-gesteuerten Fähigkeiten, ein TypeScript-First-Autorenpfad und ein Marktplatz mit Zustimmung bei der Installation. Plugins tragen zu Lesermenüs, Kopfzeilen, Befehlspaletten-Einträgen, ganzen Seiten, KI-Werkzeugen, Wörterbuch-Lookups, Themen und gebündelten Schriftarten, Sprach-Engines, geplanten Aufgaben und sogar virtuellen Büchern bei, die wie jeder andere Titel in deinem Regal leben. Fünf sind eingebaut — Wörterbuch, RSS-Reader, Satz-Reader, TTS-Stimmen und Redaktionelle Themen."
              },
              {
                "title": "Vorlesen",
                "body": "Der Reader spricht und folgt dabei demselben Satz- und Absatz-Navigator, mit dem du liest. Jede TTS-Engine kann sich anschließen, mit anbieterabhängigen Stimmen und benutzerdefinierten Endpunkten."
              },
              {
                "title": "Ein Ende",
                "body": "Ein Buch zu beenden, führt jetzt zu einem Bildschirm nach dem Buch statt zu einem toten Stopp, mit einem optionalen Rückblick, der vom Agenten geschrieben wurde."
              },
              {
                "title": "Agent als Ziel",
                "body": "Der Agent bekommt eine eigene primäre Seite mit mehreren Threads, Erdung in deinem tatsächlichen Stand im Buch, erweiterbaren Ausführungs-Traces und Werkzeugen, die deine Einstellungen sicher lesen und ändern können."
              },
              {
                "title": "Mehr Formate",
                "body": "CBZ, CBR, TXT und HTML gesellen sich zu EPUB, MOBI, AZW3, FB2 und PDF. Cover und Metadaten werden beim Import ausgefüllt."
              },
              {
                "title": "Mach es zu deinem",
                "body": "Die primäre Navigation und jede Menüfläche sind per Drag-and-Drop anordenbar. Die Befehlspalette funktioniert beim Lesen, und Mod+1..9 springt zwischen Zielen."
              },
              {
                "title": "Typografie für die App, nicht nur für das Buch",
                "body": "Chat-Antworten, Notizen und Plugin-Ansichten bekommen ihre eigene Schriftart, -größe und Zeilenabstand — standardmäßig deinen Leseeinstellungen folgend oder davon gelöst, wenn du es lieber magst. Textausrichtung wird ebenfalls zu einer Leseeinstellung, standardmäßig so, wie der Herausgeber es gewählt hat."
              }
            ]
          },
          {
            "kind": "improved",
            "items": [
              {
                "body": "Die Fortschrittsleiste im Reader-Kopf ist jetzt ein ziehbarer Scrubber."
              },
              {
                "body": "Bücher mit festem Layout (PDF, Comics) akzeptieren Anmerkungen und Wisch-Seitenwechsel."
              },
              {
                "body": "Die KI-Anbieter-Einrichtung ist einfacher, merkt sich ein Modell pro Anbieter und unterstützt stufenbezogenes Denkaufwand für Smart- und Fast-Modelle."
              },
              {
                "body": "Dein API-Schlüssel wird verschlüsselt gespeichert, und KI-Anfragen laufen über natives HTTP statt über die Webview."
              },
              {
                "body": "Alle Zustandsänderungen sind Event-sourced: Projektionen werden aus einem Append-Only-Log neu aufgebaut und können gegen dieses verifiziert werden."
              },
              {
                "body": "Das Regal-Raster füllt breite Fenster, und Buchtitel aus Dateinamen kommen sauber heraus."
              },
              {
                "body": "Die Desktop-App übernimmt den macOS-Systemproxy."
              },
              {
                "body": "Dev-Builds bekommen eine eigene Identität und ein eigenes Datenverzeichnis, sodass sie die Bibliothek der Release-App nicht mehr teilen."
              },
              {
                "body": "Dokumentation und Blog auf readaware.app sind jetzt auf Englisch, vereinfachtem Chinesisch und Japanisch verfügbar."
              }
            ]
          },
          {
            "kind": "fixed",
            "items": [
              {
                "body": "Bücher, deren Stylesheets eine fast schwarze Textfarbe festnageln, sind auf der dunklen Seitenfarbe nicht mehr unsichtbar — eine ganze Klasse von Calibre-konvertierten EPUBs war im dunklen Modus unlesbar."
              },
              {
                "body": "Inline-Fußnoten in EPUB 3 bleiben verborgen und öffnen sich in einem Popover, statt Kapitelweise Notizen in den Fließtext zu kippen."
              },
              {
                "body": "Die Zeilenabstand-Einstellung funktioniert jetzt auch bei Büchern, die ihre eigene Zeilenhöhe für Absätze deklarieren, wo sie vorher gar nichts tat."
              },
              {
                "body": "Kapitelüberschriften in echten .txt-Dateien werden erkannt."
              },
              {
                "body": "Android wird mit seinen eingebauten Plugins ausgeliefert und serviert Plugin-Assets über das Schema, das es tatsächlich verwendet."
              },
              {
                "body": "Der Marktplatz merkt sich den letzten funktionierenden Spiegel."
              },
              {
                "body": "Versehentliche Tipps auf die Fortschrittsleiste des Readers lösen auf Touch-Geräten keine Suche mehr aus."
              },
              {
                "body": "Plugin-Seiten scrollen als Seiten, virtuelle Zeilen werden neu gemessen, wenn sich Inhalte darüber ändern, und offene Einstellungsformulare übernehmen externe Schreibvorgänge, statt sie zu überblenden."
              },
              {
                "body": "Marktplatz-Dateipfade werden gegen eine Zulassungsliste validiert, wodurch ein Windows-Laufwerks-relativer Pfad-Bypass geschlossen wird."
              }
            ]
          }
        ]
      },
      ru: {
        "summary": "Выпуск, где приложение перестаёт быть фиксированным набором функций и становится чем-то, что вы расширяете. Плагины работают в настоящих песочницах, вносят вклад почти во все поверхности и распространяются через каталог. Агент получает инструменты и трассировки, ридер получает концовку, и теперь и книга, и разговор — ваши для оформления.",
        "groups": [
          {
            "kind": "new",
            "items": [
              {
                "title": "Плагины",
                "body": "Полноценная система плагинов: песочные воркеры с разрешениями, путь разработки с приоритетом TypeScript, и каталог с согласием при установке. Плагины добавляют меню ридера, заголовки, записи палитры команд, целые страницы, ИИ-инструменты, словарные запросы, темы и встроенные шрифты, голосовые движки, запланированные задачи и даже виртуальные книги, живущие на вашей полке как любые другие. Пять встроенных — Словарь, RSS-ридер, По предложениям, TTS-голоса и Редакционные темы."
              },
              {
                "title": "Чтение вслух",
                "body": "Ридер говорит, следуя тому же навигатору по предложениям и абзацам, которым вы читаете. Любой TTS-движок может подключиться, с голосами провайдера и настраиваемыми конечными точками."
              },
              {
                "title": "Концовка",
                "body": "Завершение книги теперь приводит на экран конца книги вместо тупика, с необязательным взглядом назад, написанным агентом."
              },
              {
                "title": "Агент как назначение",
                "body": "Агент получает собственную основную страницу с несколькими ветками, привязкой к вашему фактическому месту в книге, разворачиваемыми трассировками выполнения и инструментами, которые могут безопасно читать и менять ваши настройки."
              },
              {
                "title": "Больше форматов",
                "body": "CBZ, CBR, TXT и HTML присоединяются к EPUB, MOBI, AZW3, FB2 и PDF. Обложки и метаданные заполняются при импорте."
              },
              {
                "title": "Сделайте своим",
                "body": "Основная навигация и все меню перетаскиваются. Палитра команд работает во время чтения, а Mod+1..9 переключает между назначениями."
              },
              {
                "title": "Типографика для приложения, не только для книги",
                "body": "Ответы в чате, заметки и виды плагинов получают свой шрифт, размер и межстрочный интервал — по умолчанию следуя вашим настройкам чтения, или отдельно, если хотите. Выравнивание текста тоже становится настройкой чтения, по умолчанию — как выбрал издатель."
              }
            ]
          },
          {
            "kind": "improved",
            "items": [
              {
                "body": "Полоса прогресса в шапке ридера — ползунок, который можно перетаскивать."
              },
              {
                "body": "Книги с фиксированной вёрсткой (PDF, комиксы) принимают аннотации и свайпы для перелистывания."
              },
              {
                "body": "Настройка ИИ-провайдера проще, запоминает модель для каждого провайдера и поддерживает усилия мышления по уровням для умных и быстрых моделей."
              },
              {
                "body": "Ваш API-ключ шифруется в покое, и ИИ-запросы идут через нативный HTTP вместо веб-вью."
              },
              {
                "body": "Все изменения состояния основаны на событиях: проекции перестраиваются из журнала добавлений и могут быть проверены против него."
              },
              {
                "body": "Сетка полки заполняет широкие окна, а названия книг из имён файлов получаются чистыми."
              },
              {
                "body": "Настольное приложение наследует системный прокси macOS."
              },
              {
                "body": "Dev-сборки получают собственную идентичность и каталог данных, так что больше не делят библиотеку с релизным приложением."
              },
              {
                "body": "Документация и блог на readaware.app теперь доступны на английском, упрощённом китайском и японском."
              }
            ]
          },
          {
            "kind": "fixed",
            "items": [
              {
                "body": "Книги, чьи таблицы стилей задают почти чёрный цвет текста, больше не невидимы на тёмном цвете страницы — целый класс EPUB, конвертированных через calibre, был нечитаем в тёмном режиме."
              },
              {
                "body": "Внутренние сноски EPUB 3 остаются скрытыми и открываются в поповере, вместо того чтобы вываливать главу заметок в текст."
              },
              {
                "body": "Настройка межстрочного интервала теперь работает на книгах, которые задают собственный размер строки в абзацах, где раньше она вообще не действовала."
              },
              {
                "body": "Заголовки глав в реальных .txt-файлах распознаются."
              },
              {
                "body": "Android поставляется со встроенными плагинами и обслуживает ресурсы плагинов по схеме, которую реально использует."
              },
              {
                "body": "Каталог плагинов запоминает последнее работающее зеркало."
              },
              {
                "body": "Случайные нажатия на полосу прогресса ридера больше не вызывают перемотку на сенсорных устройствах."
              },
              {
                "body": "Страницы плагинов прокручиваются как страницы, виртуальные строки перемеряются при изменении контента выше, а открытые формы настроек принимают внешние записи вместо их затенения."
              },
              {
                "body": "Пути файлов в каталоге плагинов проверяются по белому списку, закрывая обход Windows-относительных путей."
              }
            ]
          }
        ]
      },
      es: {
        "summary": "La versión donde la app deja de ser un conjunto fijo de funciones y se convierte en algo que puedes ampliar. Los plugins corren en sandboxes reales, contribuyen en casi todas las superficies y se distribuyen a través de un marketplace. El agente gana herramientas y trazados, el lector gana un final, y tanto el libro como la conversación son ahora tuyos para maquetar.",
        "groups": [
          {
            "kind": "new",
            "items": [
              {
                "title": "Plugins",
                "body": "Un sistema de plugins completo: workers en sandbox con capacidades limitadas por permisos, un camino de autoría centrado en TypeScript, y un marketplace con consentimiento en la instalación. Los plugins contribuyen menús de lector, encabezados, entradas de paleta de comandos, páginas completas, herramientas de IA, búsquedas en diccionario, temas y fuentes incluidas, motores de voz, tareas programadas e incluso libros virtuales que viven en tu estantería como cualquier otro título. Cinco vienen integrados: Diccionario, Lector RSS, Lector de Frases, Voces TTS y Temas Editoriales."
              },
              {
                "title": "Lectura en voz alta",
                "body": "El lector habla, siguiendo el mismo navegador de frases y párrafos por el que lees. Cualquier motor TTS puede conectarse, con voces por proveedor y endpoints personalizados."
              },
              {
                "title": "Un final",
                "body": "Terminar un libro ahora aterriza en una pantalla de fin de libro en lugar de un alto seco, con una mirada retrospectiva opcional escrita por el agente."
              },
              {
                "title": "El agente como destino",
                "body": "El agente tiene su propia página principal con múltiples hilos, anclaje en dónde estás realmente en el libro, trazados de ejecución expandibles y herramientas que pueden leer y cambiar tus ajustes de forma segura."
              },
              {
                "title": "Más formatos",
                "body": "CBZ, CBR, TXT y HTML se unen a EPUB, MOBI, AZW3, FB2 y PDF. Las portadas y metadatos se completan al importar."
              },
              {
                "title": "Hazlo tuyo",
                "body": "La navegación principal y cada superficie de menú se pueden reorganizar arrastrando. La paleta de comandos funciona mientras lees, y Mod+1..9 salta entre destinos."
              },
              {
                "title": "Tipografía para la app, no solo para el libro",
                "body": "Las respuestas de chat, notas y vistas de plugins tienen su propia fuente, tamaño e interlineado — siguiendo tus ajustes de lectura por defecto, o separados si prefieres. La alineación del texto también se convierte en un ajuste de lectura, con el valor por defecto que eligió el editor."
              }
            ]
          },
          {
            "kind": "improved",
            "items": [
              {
                "body": "La barra de progreso en el encabezado del lector es un control deslizante que puedes arrastrar."
              },
              {
                "body": "Los libros de diseño fijo (PDF, cómics) aceptan anotaciones y pasos de página con deslizamiento."
              },
              {
                "body": "La configuración del proveedor de IA es más simple, recuerda un modelo por proveedor y admite esfuerzo de pensamiento por nivel para modelos inteligentes y rápidos."
              },
              {
                "body": "Tu clave API está cifrada en reposo, y las solicitudes de IA se enrutan a través de HTTP nativo en lugar del webview."
              },
              {
                "body": "Todos los cambios de estado se registran por eventos: las proyecciones se reconstruyen desde un registro de solo añadido y se pueden verificar contra él."
              },
              {
                "body": "La cuadrícula de la estantería llena ventanas anchas, y los títulos de libros desde nombres de archivo salen limpios."
              },
              {
                "body": "La app de escritorio hereda el proxy del sistema macOS."
              },
              {
                "body": "Las versiones de desarrollo tienen su propia identidad y directorio de datos, así que ya no comparten la biblioteca de la versión de lanzamiento."
              },
              {
                "body": "La documentación y el blog en readaware.app están ahora disponibles en inglés, chino simplificado y japonés."
              }
            ]
          },
          {
            "kind": "fixed",
            "items": [
              {
                "body": "Los libros cuyas hojas de estilo fijan un color de texto casi negro ya no son invisibles sobre el color de página oscuro — toda una clase de EPUBs convertidos con calibre era ilegible en modo oscuro."
              },
              {
                "body": "Los cuerpos de notas al pie en línea de EPUB 3 permanecen ocultos y se abren en un popover, en lugar de volcar un capítulo entero de notas en la prosa."
              },
              {
                "body": "El ajuste de interlineado ahora funciona en libros que declaran su propia altura de línea en los párrafos, donde antes no hacía nada."
              },
              {
                "body": "Se reconocen los encabezados de capítulo en archivos .txt del mundo real."
              },
              {
                "body": "Android incluye sus plugins integrados y sirve los recursos de los plugins a través del esquema que realmente usa."
              },
              {
                "body": "El marketplace recuerda el último espejo que funcionó."
              },
              {
                "body": "Los toques sueltos en la barra de progreso del lector ya no buscan en dispositivos táctiles."
              },
              {
                "body": "Las páginas de plugins se desplazan como páginas, las filas virtuales se re-miden cuando el contenido superior cambia, y los formularios de ajustes abiertos adoptan escrituras externas en lugar de ocultarlas."
              },
              {
                "body": "Las rutas de archivo del marketplace se validan con listas blancas, cerrando un bypass de ruta relativa a unidad en Windows."
              }
            ]
          }
        ]
      },
    },
  },
];
