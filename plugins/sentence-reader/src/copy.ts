import type {
  PluginLocalizedText,
  PluginReaderModeCopy,
  PluginReaderTextUnit,
} from "@read-aware/plugin-types";

type UnitCopy = {
  label: string;
  previous: string;
  next: string;
  toggle?: string;
};

type LocaleCopy = {
  title: string;
  enable: string;
  exit: string;
  returnToCurrent: string;
  showToolbars: string;
  moreActions: string;
  collapseActions: string;
  menuLabel: string;
  shortcutDescription: string;
  volumeKeys: string;
  sentence: UnitCopy;
  paragraph: UnitCopy;
};

const COPY = {
  en: {
    title: "Read by sentence or paragraph",
    enable: "Start reading by sentence or paragraph",
    exit: "Exit reading by sentence or paragraph",
    returnToCurrent: "Back to current sentence",
    showToolbars: "Show toolbars",
    moreActions: "More actions",
    collapseActions: "Collapse actions",
    menuLabel: "Sentence navigator",
    shortcutDescription:
      "Active while reading by sentence or paragraph. The selection shortcuts also act on the current sentence or paragraph.",
    volumeKeys: "Step sentences with the volume keys",
    sentence: {
      label: "By sentence",
      previous: "Previous sentence",
      next: "Next sentence",
    },
    paragraph: {
      label: "By paragraph",
      previous: "Previous paragraph",
      next: "Next paragraph",
      toggle: "Paragraph mode",
    },
  },
  "zh-Hans": {
    title: "逐句/逐段阅读",
    enable: "开启逐句/逐段阅读",
    exit: "退出逐句/逐段阅读",
    returnToCurrent: "回到阅读处",
    showToolbars: "显示工具栏",
    moreActions: "更多操作",
    collapseActions: "收起操作",
    menuLabel: "逐句导航",
    shortcutDescription:
      "逐句/逐段阅读开启时可用；选中文本的快捷键也会作用于当前句子或段落。",
    volumeKeys: "用音量键逐句移动",
    sentence: { label: "逐句", previous: "上一句", next: "下一句" },
    paragraph: { label: "逐段", previous: "上一段", next: "下一段", toggle: "逐段模式" },
  },
  "zh-Hant": {
    title: "逐句/逐段閱讀",
    enable: "開啟逐句/逐段閱讀",
    exit: "退出逐句/逐段閱讀",
    returnToCurrent: "回到閱讀處",
    showToolbars: "顯示工具列",
    moreActions: "更多操作",
    collapseActions: "收起操作",
    menuLabel: "逐句導覽",
    shortcutDescription:
      "逐句/逐段閱讀開啟時可用；選取文字的快捷鍵也會作用於目前句子或段落。",
    volumeKeys: "用音量鍵逐句移動",
    sentence: { label: "逐句", previous: "上一句", next: "下一句" },
    paragraph: { label: "逐段", previous: "上一段", next: "下一段", toggle: "逐段模式" },
  },
  ja: {
    title: "文・段落ナビゲーター",
    enable: "文・段落ナビゲーターをオンにする",
    exit: "文・段落ナビゲーターを終了",
    returnToCurrent: "現在の文に戻る",
    showToolbars: "ツールバーを表示",
    moreActions: "その他の操作",
    collapseActions: "操作を折りたたむ",
    menuLabel: "文ナビゲーター",
    shortcutDescription:
      "文・段落ナビゲーターがオンの間に有効です。選択のショートカットは現在の文や段落にも作用します。",
    volumeKeys: "音量キーで文を移動",
    sentence: { label: "文ごと", previous: "前の文", next: "次の文" },
    paragraph: {
      label: "段落ごと",
      previous: "前の段落",
      next: "次の段落",
      toggle: "段落モード",
    },
  },
  fr: {
    title: "Lire par phrase ou paragraphe",
    enable: "Commencer la lecture par phrase ou paragraphe",
    exit: "Quitter la lecture par phrase ou paragraphe",
    returnToCurrent: "Revenir à la phrase actuelle",
    showToolbars: "Afficher les barres d’outils",
    moreActions: "Plus d’actions",
    collapseActions: "Réduire les actions",
    menuLabel: "Navigateur",
    shortcutDescription:
      "Actif lorsque la lecture par phrase ou paragraphe est activée. Les raccourcis de sélection agissent aussi sur la phrase ou le paragraphe courant.",
    volumeKeys: "Parcourir les phrases avec les touches de volume",
    sentence: { label: "Par phrase", previous: "Phrase précédente", next: "Phrase suivante" },
    paragraph: {
      label: "Par paragraphe",
      previous: "Paragraphe précédent",
      next: "Paragraphe suivant",
      toggle: "Mode paragraphe",
    },
  },
  de: {
    title: "Satz- oder absatzweise lesen",
    enable: "Satz- oder absatzweises Lesen starten",
    exit: "Satz- oder absatzweises Lesen beenden",
    returnToCurrent: "Zurück zum aktuellen Satz",
    showToolbars: "Symbolleisten einblenden",
    moreActions: "Weitere Aktionen",
    collapseActions: "Aktionen einklappen",
    menuLabel: "Satznavigator",
    shortcutDescription:
      "Aktiv, solange satz- oder absatzweises Lesen eingeschaltet ist. Die Auswahl-Kurzbefehle wirken dann auf den aktuellen Satz oder Absatz.",
    volumeKeys: "Sätze mit den Lautstärketasten durchgehen",
    sentence: { label: "Satzweise", previous: "Vorheriger Satz", next: "Nächster Satz" },
    paragraph: {
      label: "Absatzweise",
      previous: "Vorheriger Absatz",
      next: "Nächster Absatz",
      toggle: "Absatzmodus",
    },
  },
  ru: {
    title: "Чтение по предложениям или абзацам",
    enable: "Включить чтение по предложениям или абзацам",
    exit: "Выйти из чтения по предложениям или абзацам",
    returnToCurrent: "Вернуться к текущему предложению",
    showToolbars: "Показать панели",
    moreActions: "Ещё действия",
    collapseActions: "Свернуть действия",
    menuLabel: "Навигатор",
    shortcutDescription:
      "Работает, пока включено чтение по предложениям или абзацам. Сочетания клавиш выделения действуют на текущее предложение или абзац.",
    volumeKeys: "Листать предложения кнопками громкости",
    sentence: {
      label: "По предложениям",
      previous: "Предыдущее предложение",
      next: "Следующее предложение",
    },
    paragraph: {
      label: "По абзацам",
      previous: "Предыдущий абзац",
      next: "Следующий абзац",
      toggle: "Режим абзацев",
    },
  },
  es: {
    title: "Leer por frase o párrafo",
    enable: "Empezar a leer por frase o párrafo",
    exit: "Salir de la lectura por frase o párrafo",
    returnToCurrent: "Volver a la frase actual",
    showToolbars: "Mostrar barras de herramientas",
    moreActions: "Más acciones",
    collapseActions: "Contraer acciones",
    menuLabel: "Navegador",
    shortcutDescription:
      "Activo mientras la lectura por frase o párrafo está encendida. Los atajos de selección también actúan sobre la frase o el párrafo actual.",
    volumeKeys: "Recorrer frases con las teclas de volumen",
    sentence: { label: "Por frase", previous: "Frase anterior", next: "Frase siguiente" },
    paragraph: {
      label: "Por párrafo",
      previous: "Párrafo anterior",
      next: "Párrafo siguiente",
      toggle: "Modo párrafo",
    },
  },
} satisfies Record<string, LocaleCopy>;

function localized(select: (copy: LocaleCopy) => string): PluginLocalizedText {
  const translations = Object.fromEntries(
    Object.entries(COPY)
      .filter(([locale]) => locale !== "en")
      .map(([locale, copy]) => [locale, select(copy)]),
  );
  return { default: select(COPY.en), translations };
}

export const sentenceReaderUnits: PluginReaderTextUnit[] = [
  {
    id: "sentence",
    label: localized((copy) => copy.sentence.label),
    previousLabel: localized((copy) => copy.sentence.previous),
    nextLabel: localized((copy) => copy.sentence.next),
  },
  {
    id: "paragraph",
    label: localized((copy) => copy.paragraph.label),
    previousLabel: localized((copy) => copy.paragraph.previous),
    nextLabel: localized((copy) => copy.paragraph.next),
    toggleLabel: localized((copy) => copy.paragraph.toggle ?? copy.paragraph.label),
    icon: "paragraph",
  },
];

export const sentenceReaderCopy: PluginReaderModeCopy = {
  title: localized((copy) => copy.title),
  enable: localized((copy) => copy.enable),
  exit: localized((copy) => copy.exit),
  returnToCurrent: localized((copy) => copy.returnToCurrent),
  showToolbars: localized((copy) => copy.showToolbars),
  moreActions: localized((copy) => copy.moreActions),
  collapseActions: localized((copy) => copy.collapseActions),
  menuLabel: localized((copy) => copy.menuLabel),
  shortcuts: {
    description: localized((copy) => copy.shortcutDescription),
    volumeKeys: localized((copy) => copy.volumeKeys),
  },
};
