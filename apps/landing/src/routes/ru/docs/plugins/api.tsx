import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/ru/docs/plugins/api")({
  head: () => ({
    meta: [
      { title: "Справка по API плагинов — Документация ReadAware" },
      {
        name: "description",
        content:
          "Контракт разработки плагинов ReadAware: манифест, жизненный цикл, разрешения, производные от домена, API данных, вклады, представления и события.",
      },
    ],
  }),
  component: PluginApiPage,
});

function PluginApiPage() {
  return (
    <article className="doc-prose">
      <h1>Справка по API плагинов</h1>
      <p className="lead">
        Плагин — это папка, содержащая <code>manifest.json</code> и один
        JavaScript-модуль. Эта страница — контракт разработки; тот же
        контракт поставляется как файл объявления TypeScript
        (<code>types/plugin-api.d.ts</code>) в{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          репозитории каталога
        </a>
        , поэтому редакторы автодополняют всё нижеописанное.
      </p>

      <h2>Анатомия</h2>
      <pre>
        <code>{`my-plugin/
  manifest.json
  main.js        # один самодостаточный ES-модуль`}</code>
      </pre>
      <p>
        <code>main.js</code> экспортирует по умолчанию объект жизненного цикла. Всё, что может достичь
        плагин, приходит через контекст, переданный в{" "}
        <code>activate</code>; каждый <code>register*</code> и{" "}
        <code>on</code> вызов возвращает одноразовый объект, который приложение освобождает, когда
        плагин отключен или удален, поэтому <code>deactivate</code> нужно только
        освобождать собственные внешние ресурсы плагина.
      </p>
      <pre>
        <code>{`export default {
  activate(ctx) {
    // регистрировать вклады через ctx
  },
  deactivate() {
    // опционально: закрыть сокеты, сбросить очереди
  },
};`}</code>
      </pre>
      <p>
        Включение и отключение вступают в силу немедленно — без перезапуска приложения. Пишите
        на TypeScript, если хотите (рекомендуется; см.{" "}
        <Link to="/ru/docs/plugins/publishing">Публикация</Link>) — что приложение
        загружает, всегда является собранным <code>main.js</code>.
      </p>

      <h2>manifest.json</h2>
      <pre>
        <code>{`{
  "id": "anki-sync",
  "name": "Anki Sync",
  "version": "0.1.0",
  "minAppVersion": "0.3.0",
  "description": "Отправка просмотренных слов в Anki.",
  "author": "вы",
  "permissions": ["service:network", "annotations:read"],
  "main": "main.js"
}`}</code>
      </pre>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Поле</th>
              <th>Значение</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>id</code>
              </td>
              <td>
                Строчные буквы, цифры, дефисы (макс. 64). Должен совпадать с
                именем папки; пространство имён для хранилища и инструментов плагина.
              </td>
            </tr>
            <tr>
              <td>
                <code>name</code>, <code>version</code>
              </td>
              <td>Показываются в Настройки → Плагины и в каталоге.</td>
            </tr>
            <tr>
              <td>
                <code>minAppVersion</code>
              </td>
              <td>
                Самая низкая версия приложения, которую поддерживает плагин. Этот контракт требует{" "}
                <code>0.3.0</code> или новее.
              </td>
            </tr>
            <tr>
              <td>
                <code>permissions</code>
              </td>
              <td>
                Что использует плагин (таблица ниже). Показывается пользователю перед
                установкой.
              </td>
            </tr>
            <tr>
              <td>
                <code>main</code>
              </td>
              <td>
                Входной модуль относительно папки; по умолчанию{" "}
                <code>main.js</code>.
              </td>
            </tr>
            <tr>
              <td>
                <code>settings</code>
              </td>
              <td>
                Опциональные декларативные настройки (те же формы полей, что и представления форм,
                плюс <code>secret</code>). Приложение отображает их как
                собственный раздел плагина в Настройках и сохраняет значения как
                один объект под ключом хранилища <code>settings</code> — см.{" "}
                <a href="#storage-and-settings">Хранилище и настройки</a>.
              </td>
            </tr>
            <tr>
              <td>
                <code>schedules</code>
              </td>
              <td>
                Опциональные повторяющиеся задачи, объявленные так, чтобы пользователи видели их перед
                установкой — см. <a href="#scheduled-work">Запланированная работа</a>.
              </td>
            </tr>
            <tr>
              <td>
                <code>themes</code>, <code>fonts</code>
              </td>
              <td>
                Опциональные декларативные темы и встроенные шрифты (требует{" "}
                <code>ui:themes</code>) — см.{" "}
                <a href="#themes-and-bundled-fonts">
                  Темы и встроенные шрифты
                </a>
                .
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Доменная модель</h2>
      <p>
        Поверхность данных производна от доменной модели приложения, а не
        описывается где-то рядом с ней. Каждый домен — <code>shelf</code> (всё управление
        библиотекой: книги, коллекции, статистика чтения),{" "}
        <code>annotations</code>, <code>conversations</code> — это пространство имён
        на <code>ctx</code>, предоставляющее три вещи:
      </p>
      <ul>
        <li>
          <strong>чтения</strong> — модели чтения домена (что отображают собственные
          поверхности приложения);
        </li>
        <li>
          <strong>записи</strong> — команды под <code>.write</code>, которые
          точно отражают глаголы событий домена и проходят через собственный
          путь записи событий приложения, с отметкой{" "}
          <code>plugin:&lt;id&gt;</code> в журнале событий, поэтому каждая запись
          плагина атрибутируема;
        </li>
        <li>
          <strong>подписки</strong> — <code>.on(event, handler)</code>{" "}
          на события домена под их каноническими именами (
          <code>book.starred</code>, <code>highlight.created</code>, …) — тот же
          словарь, который записывает само приложение.
        </li>
      </ul>
      <p>
        Разрешения следуют той же форме: <code>&lt;domain&gt;:read</code> /{" "}
        <code>&lt;domain&gt;:write</code>, и внутри домена{" "}
        <strong>запись подразумевает чтение</strong>. Локальное состояние устройства (предпочтения
        представления, внешний вид ридера, внутренности синхронизации) и свободный
        рендеринг намеренно не являются поверхностью плагинов — UI идет через
        декларативные представления ниже.
      </p>

      <h2>Разрешения</h2>
      <p>
        Группы возможностей на <code>ctx</code> просто отсутствуют, если их
        разрешение не объявлено — гейтинг на уровне API против случайного превышения полномочий.
        Хранилище с пространством имён, вклады в UI, события сеанса и навигация ридера
        не являются разрешениями; каждый плагин имеет их.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Разрешение</th>
              <th>Предоставляет</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>shelf:read</code>
              </td>
              <td>
                <code>ctx.shelf</code> — книги (включая оглавление книги и
                текст главы), коллекции и членство, и
                статистику чтения (<code>stats.forBook</code> /{" "}
                <code>stats.list</code> / <code>stats.overview</code> — у статистики
                нет лица записи: их события — записанные факты активности читателя,
                а не пользовательские команды).
              </td>
            </tr>
            <tr>
              <td>
                <code>shelf:write</code>
              </td>
              <td>
                <code>ctx.shelf.books.write</code> — импортировать файлы, редактировать
                метаданные, отмечать звездой, отмечать как завершенную, удалять; поставщики контента и
                виртуальные книги. <code>ctx.shelf.collections.write</code> —
                создавать, переименовывать, удалять, назначать книги.
              </td>
            </tr>
            <tr>
              <td>
                <code>annotations:read</code> / <code>annotations:write</code>
              </td>
              <td>
                <code>ctx.annotations</code> — выделения, заметки и заданные
                вопросы; создавать, перекрашивать, редактировать и удалять выделения и
                заметки (вопросы — записанные агентом, только для чтения).
              </td>
            </tr>
            <tr>
              <td>
                <code>conversations:read</code>
              </td>
              <td>
                <code>ctx.conversations</code> — потоки AI по книгам и глобальные
                потоки (только для чтения).
              </td>
            </tr>
            <tr>
              <td>
                <code>ui:themes</code>
              </td>
              <td>
                Декларативные поля манифеста <code>themes</code> / <code>fonts</code>{" "}
                (ниже) — темы приложения и ридера со встроенными
                шрифтами. Единственный вклад в UI за разрешением: он имеет
                визуальный авторитет над всем приложением, поэтому согласие на установку
                должно его раскрывать.
              </td>
            </tr>
            <tr>
              <td>
                <code>agent:tools</code>
              </td>
              <td>
                <code>ctx.agent.registerTool</code> — инструменты для читательского
                ассистента.
              </td>
            </tr>
            <tr>
              <td>
                <code>service:network</code>
              </td>
              <td>
                <code>ctx.network.fetch</code> — исходящий HTTP через
                нативный клиент приложения (без ограничений CORS).
              </td>
            </tr>
            <tr>
              <td>
                <code>service:llm</code>
              </td>
              <td>
                <code>ctx.llm.ask</code> — одноразовые вызовы модели на настроенной
                учетной записи пользователя. Без потока, без памяти, без инструментов; поддерживает
                структурированный JSON-вывод через <code>schema</code> и потоковую передачу
                через <code>onText</code>.
              </td>
            </tr>
            <tr>
              <td>
                <code>service:clipboard</code>
              </td>
              <td>
                <code>ctx.clipboard.writeText</code>.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        (<code>reader:modes</code> — режимы управляемого чтения, отображаемые хостом — в настоящее время
        зарезервированы для встроенных первичных плагинов, пока этот
        привилегированный контракт не устоится.)
      </p>

      <h2>Вклады</h2>

      <h3>Действия с выделением</h3>
      <p>
        Записи в меню выделения и аннотаций ридера. Обработчик
        получает выделенный текст, его диапазон CFI, главу и книгу.
        Когда доступен, <code>context</code> содержит окружающий фрагмент.
        Внутри ридера действие либо выполняется молча (вернуть toast), либо
        открывает диалог (вернуть представление) — это единственные два исхода.
        Объявите <code>presentation: "dialog"</code>, когда обработчик асинхронен:
        хост открывает свою оболочку загрузки немедленно и заполняет тот же запрос,
        когда <code>run</code> разрешается.
        Действие в стиле словаря может объявить <code>role: "lookup"</code>; хост
        тогда направляет свою существующую команду клавиатуры Look up на это действие
        плагина вместо поддержания второго встроенного пути lookup.
      </p>
      <pre>
        <code>{`ctx.ui.registerSelectionAction({
  id: "save-quote",
  title: "Сохранить цитату",
  icon: "quotes",
  presentation: "dialog",
  run: (input) => {
    // input: { text, context?, cfiRange, chapterHref, book, source }
    return { toast: "Цитата сохранена." };
  },
});`}</code>
      </pre>

      <h3>Действия в шапке</h3>
      <p>
        Кнопка-иконка на верхней панели. На поверхности ридера представление открывается как
        закрепленное всплывающее окно; на полке оно открывается как всплывающее окно или полная страница,
        согласно <code>presentation</code>. Ридер никогда не позволяет полностраничные
        прерывания.
      </p>
      <pre>
        <code>{`ctx.ui.registerHeaderAction({
  id: "reading-report",
  title: "Отчет о чтении",
  icon: "chart-line-up",
  surface: "shelf",
  presentation: "page",
  view: async () => ({
    kind: "markdown",
    title: "На этой неделе",
    markdown: "Вы читали **4ч 12м** в 3 книгах.",
  }),
});`}</code>
      </pre>

      <h3>Команды</h3>
      <p>
        Запись в палитре команд. Все действия плагинов также появляются в палитре
        автоматически; явные команды для действий без кнопки.
      </p>
      <pre>
        <code>{`ctx.ui.registerCommand({
  id: "sync-now",
  title: "Anki Sync: синхронизировать сейчас",
  run: async () => ({ toast: "Синхронизировано." }),
});`}</code>
      </pre>

      <h3>Инструменты агента</h3>
      <p>
        Инструменты, которые читательский ассистент может вызывать во время чата (требует{" "}
        <code>agent:tools</code>). <code>parameters</code> — это обычная JSON
        Schema для объекта аргументов; опустите её для инструмента без аргументов. Инструменты
        имеют пространство имён <code>plugin_&lt;pluginId&gt;_&lt;name&gt;</code> перед тем, как
        они достигнут модели, и вызовы видны пользователю как шаги инструмента
        в чате.
      </p>
      <pre>
        <code>{`ctx.agent?.registerTool({
  name: "search_deck",
  label: "Поиск в вашей колоде Anki",
  description: "Поиск коллекции Anki пользователя по термину.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  execute: async ({ query }) => {
    const res = await ctx.network.fetch("http://127.0.0.1:8765", {
      method: "POST",
      body: JSON.stringify({ action: "findNotes", query }),
    });
    return res.json();
  },
});`}</code>
      </pre>

      <h3>Поставщики голосов</h3>
      <p>
        <code>ctx.audio.registerVoiceProvider</code> подключает движок текст-в-речь
        в чтение вслух ридера. Плагин только превращает текст в
        закодированные аудиобайты (mp3/wav — всё, что декодирует webview); приложение
        владеет воспроизведением, темпом предложений, предзагрузкой и подсветкой
        следования. Регистрация не требует собственного разрешения — что бы ни
        требовалось провайдеру для синтеза (сеть, ключи), уже закрыто его
        другими разрешениями.
      </p>
      <pre>
        <code>{`ctx.audio.registerVoiceProvider({
  id: "voices",
  label: "Мой TTS",
  listVoices: () => [{ id: "default", label: "Мой TTS · теплый" }],
  synthesize: async ({ text, voiceId }) => {
    const res = await ctx.network.fetch("http://127.0.0.1:8880/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: text, response_format: "mp3" }),
    });
    return res.arrayBuffer();
  },
});`}</code>
      </pre>
      <p>
        Зарегистрированный голос принимается автоматически — включение вашего
        плагина пользователем — это опт-ин, нет отдельного выбора на стороне хоста — и
        неудавшийся вызов синтеза возвращается к системному голосу для этого
        предложения, поэтому чтение деградирует вместо того, чтобы молчать. Голоса
        перечисляются заново всякий раз, когда настройки плагина изменяются.
      </p>

      <h3 id="scheduled-work">Запланированная работа</h3>
      <p>
        Манифест объявляет повторяющиеся задачи; <code>activate</code> привязывает
        работу. Приложение выполняет каждое расписание КАК МИНИМУМ каждые{" "}
        <code>everyMinutes</code> (округлено до 15), пока оно открыто, с
        догоняющим запуском вскоре после запуска, когда просрочено — никогда в точные времена,
        и никогда, пока приложение закрыто. Перекрывающиеся запуски одного расписания
        пропускаются; неудавшийся запуск просто ждет следующего такта.
      </p>
      <pre>
        <code>{`// manifest.json
"schedules": [{ "id": "refresh", "label": "Обновить ленты", "everyMinutes": 60 }]

// main.js
ctx.schedule.on("refresh", async () => {
  // получить, согласовать, записать через API доменов
});`}</code>
      </pre>

      <h3 id="themes-and-bundled-fonts">Темы и встроенные шрифты</h3>
      <p>
        С <code>ui:themes</code>, манифест может объявлять темы для двух
        независимых точек монтирования — хром приложения и страницу книги — плюс
        файлы шрифтов, которые поставляются внутри папки плагина. Этот вклад —
        чисто данные: приложение проверяет каждое значение и генерирует весь CSS само,
        и ничего не применяется, пока пользователь не выберет тему в Настройках →
        Внешний вид или в контроле цвета страницы ридера. <code>main.js</code> плагина только для темы — это просто{" "}
        <code>{"export default { activate() {} }"}</code>.
      </p>
      <pre>
        <code>{`{
  "permissions": ["ui:themes"],
  "fonts": [
    {
      "id": "my-serif",
      "family": "My Serif",
      "kind": "serif",
      "files": [{ "path": "assets/my-serif-400.woff2", "weight": 400 }]
    }
  ],
  "themes": [
    {
      "id": "dusk",
      "name": { "default": "Сумерки", "translations": { "zh-Hans": "暮色" } },
      "polarity": "dark",
      "app": { "paper": "#14171e", "fg": "#e3e6ec" },
      "reader": {
        "palette": {
          "bg": "#161a22", "text": "#ccd2dd",
          "selection": "rgba(154, 162, 177, 0.28)",
          "rule": "rgba(204, 210, 221, 0.18)",
          "faint": "rgba(204, 210, 221, 0.07)",
          "muted": "rgba(204, 210, 221, 0.55)"
        },
        "typography": { "fontFamily": "plugin:my-serif", "fontSize": "large" }
      }
    }
  ]
}`}</code>
      </pre>
      <ul>
        <li>
          <code>polarity</code> — читается ли тема как светлая или темная.
          Управляет <code>color-scheme</code>, значениями по умолчанию полярности для токенов приложения,
          которые тема оставляет неустановленными, и как разрешается автоматический цвет страницы ридера, пока тема активна.
        </li>
        <li>
          <code>app</code> — переопределения на фиксированном словаре токенов приложения
          (холст, текстовые ярусы, поверхности, заливки, границы — см.{" "}
          <code>PluginAppThemeTokens</code> в типизации). Неустановленные токены сохраняют
          собственные значения полярности.
        </li>
        <li>
          <code>reader</code> — та же шестицветная палитра, которую используют встроенные цвета
          страницы (все шесть обязательны), плюс опциональная типографская предустановка,
          применяемая один раз, когда пользователь выбирает тему; пользователь может настраивать
          всё потом.
        </li>
        <li>
          <code>fonts</code> — <code>.woff2</code>/<code>.woff</code>/
          <code>.ttf</code>/<code>.otf</code> лица, обслуживаемые прямо из
          папки плагина; каждое появляется в выборе шрифта ридера, пока
          плагин включен. Тема ссылается на свои собственные шрифты как{" "}
          <code>plugin:&lt;fontId&gt;</code>. Плагины каталога должны перечислять
          файлы шрифтов в <code>files</code> записи реестра.
        </li>
        <li>
          Цвета проверяются по строгим грамматикам — простой hex или{" "}
          <code>rgb()</code>/<code>rgba()</code>/<code>hsl()</code>/
          <code>hsla()</code>; ключевые слова, <code>var()</code> и{" "}
          <code>url()</code> отклоняются.
        </li>
      </ul>

      <h2>Представления</h2>
      <p>
        Плагины объявляют дерево компонентов хоста; приложение отображает каждый визуальный
        примитив и контрол. Плагины никогда не предоставляют JSX, HTML, CSS или классы.
      </p>
      <ul>
        <li>
          <code>markdown</code> — строка markdown, набранная приложением.
        </li>
        <li>
          <code>list</code> — списки хоста с поиском и фиксированной задержкой,
          ключевыми словами, аксессуарами и пустыми состояниями. <code>timeline</code> добавляет
          фильтры Сегодня / На этой неделе / В этом месяце / Все и группировку по локальной дате;
          элемент может использовать <code>presentation: "dialog"</code>, чтобы показать своё
          возвращенное представление над списком вместо открытия дочерней страницы. <code>actions</code> уровня списка —
          кнопки-иконки, отображаемые хостом; временные шкалы размещают
          их в крайнем правом углу строки вкладок.
        </li>
        <li>
          <code>form</code> — контролы text, textarea, number, select, choice, checkbox
          и toggle из библиотеки компонентов ReadAware, плюс{" "}
          <code>onSubmit</code>.
        </li>
        <li>
          <code>detail</code> — первичный контент в стиле Raycast, метаданные и
          контролы и действия, отображаемые хостом. Семантические контролы выбора остаются возле
          заголовка контента; диалоги сохраняют происхождение, даты и теги в
          тихой строке под ним, в то время как действия сидят рядом с кнопкой Закрыть хоста
          в фиксированном футере.
        </li>
        <li>
          <code>blocks</code> — типография хоста, markdown, контент словаря,
          метаданные, цитаты, действия, метрики, прогресс, теги, оповещения, разделы,
          группы и адаптивные <code>columns</code>. Колонки предоставляют только
          ограниченный вес, интервал, предустановки минимальной ширины и семантическое
          выравнивание. Точный CSS и обтекание остаются внутри дизайн-системы;
          объявления проверяются во время выполнения, а вложенность ограничена.
        </li>
      </ul>
      <p>
        Обработчики (<code>run</code>, <code>onSelect</code>,{" "}
        <code>onSubmit</code>) все возвращают ту же форму результата:
      </p>
      <ul>
        <li>
          ничего — поверхность остается такой, какая она есть;
        </li>
        <li>
          <code>{"{ toast: \"…\" }"}</code> — временное уведомление;
        </li>
        <li>
          <code>{"{ view }"}</code> — открыть или поместить на поверхность;
        </li>
        <li>
          <code>{'{ view, navigation: "replace" | "reset" }'}</code> —
          заменить текущее представление или вернуться к новому корневому представлению;
        </li>
        <li>
          <code>{"{ close: true }"}</code> — закрыть поверхность (компонуется
          с <code>toast</code>);
        </li>
        <li>
          <code>{"{ fieldErrors }"}</code> — из отправки формы: остаться на
          форме и показать ошибки под полями.
        </li>
      </ul>
      <p>
        Асинхронная работа — не событие: верните промис, и приложение покажет
        состояние загрузки. Иконки выбираются по имени из курированного набора Phosphor приложения — без пользовательских SVG.
      </p>

      <h2>Данные домена</h2>
      <p>
        Каждое предоставленное пространство имен домена предлагает чтения, канонические подписки на события
        и (с разрешением на запись) команды. Кратко:
      </p>
      <ul>
        <li>
          <code>ctx.shelf.books</code> — <code>list()</code>,{" "}
          <code>get(id)</code>, <code>getToc(id)</code>,{" "}
          <code>getChapterText(id, index)</code>; запись: <code>import</code>,{" "}
          <code>editMetadata</code>, <code>setStarred</code>,{" "}
          <code>setFinished</code>, <code>remove</code>, плюс поставщики контента
          (ниже).
        </li>
        <li>
          <code>ctx.shelf.collections</code> — <code>list()</code>,{" "}
          <code>booksIn(id)</code>; запись: <code>create</code>,{" "}
          <code>rename</code>, <code>remove</code>,{" "}
          <code>assignBooks(bookIds, collectionId | null)</code>.
        </li>
        <li>
          <code>ctx.shelf.stats</code> — <code>forBook(bookId)</code>,{" "}
          <code>list()</code>, <code>overview()</code> (позиции, статусы
          и активное время чтения; только для чтения для каждого актора).
        </li>
        <li>
          <code>ctx.annotations</code> —{" "}
          <code>list({"{ bookId?, kind?, query? }"})</code> возвращает
          дискриминированное объединение выделений, заметок и вопросов; запись:{" "}
          <code>createHighlight</code>, <code>recolorHighlight</code>,{" "}
          <code>removeHighlight</code>, <code>createNote</code>,{" "}
          <code>updateNote</code>, <code>removeNote</code>.
        </li>
        <li>
          <code>ctx.conversations</code> — <code>getBookThread(bookId)</code>,{" "}
          <code>listThreads()</code>, <code>getThread(id)</code>; подписаться через{" "}
          <code>on</code> (<code>aiConversation.started</code>,{" "}
          <code>aiMessage.appended</code>, <code>aiMessage.removed</code>,{" "}
          <code>aiConversation.cleared</code>).
        </li>
      </ul>

      <h2>События</h2>
      <p>
        Два класса, намеренно отдельных. <strong>События домена</strong> —
        факты, которые записывает приложение; подписывайтесь по домену, под каноническими именами,
        с разрешением на чтение домена. Каждая доставка —{" "}
        <code>{"{ type, payload, createdAt, origin }"}</code> — origin говорит,
        какой программный актор произвел факт (<code>user</code>,{" "}
        <code>agent</code>, <code>system</code> или{" "}
        <code>plugin:&lt;id&gt;</code>).
      </p>
      <pre>
        <code>{`ctx.annotations?.on("highlight.created", ({ payload, origin }) => {
  // payload: { highlightId, bookId, text, color?, … }
});
ctx.shelf?.on("book.removed", ({ payload }) => { /* { bookId } */ });
`}</code>
      </pre>
      <p>
        <strong>Факты сеанса</strong> описывают, что на экране прямо сейчас.
        Они никогда не входят в журнал событий и не требуют разрешения:{" "}
        <code>ctx.session.on(event, handler)</code>.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Событие сеанса</th>
              <th>Payload</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>book-opened</code>
              </td>
              <td>
                <code>{"{ book: { id, title, author? } }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>book-closed</code>
              </td>
              <td>
                <code>{"{ bookId }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>chapter-changed</code>
              </td>
              <td>
                <code>{"{ bookId, chapterHref }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>reading-progress</code>
              </td>
              <td>
                <code>{"{ bookId, fraction }"}</code> — срабатывает при перелистывании страниц,
                дробь 0..1
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Поставщики контента и виртуальные книги</h2>
      <p>
        С <code>shelf:write</code>, плагин может размещать реальные книги на
        полке. <code>import</code> принимает байты файла. Поставщики контента
        полностью пропускают файл: зарегистрируйте провайдера, добавьте виртуальные книги, связанные с
        ним, и обслуживайте HTML-секции, когда книга открыта. Ридер
        пагинирует, аннотирует и отслеживает прогресс на них, как на любой книге — RSS-лента
        как книга — это именно это.
      </p>
      <pre>
        <code>{`ctx.shelf?.books.write?.registerContentProvider({
  id: "rss",
  async load(key) {
    const feed = await fetchFeed(key); // ваш код, через ctx.network.fetch
    return {
      title: feed.title,
      sections: feed.items.map((item) => ({
        title: item.title,
        html: item.contentHtml,
      })),
    };
  },
});

await ctx.shelf?.books.write?.addVirtualBook({
  providerId: "rss",
  key: "https://example.com/feed.xml",
  title: "Example Weekly",
});`}</code>
      </pre>

      <h2 id="storage-and-settings">Хранилище и настройки</h2>
      <p>
        <code>ctx.storage</code> — это хранилище ключ-значение с пространством имён, сохраняемое с
        локальными данными приложения — <code>get</code>, <code>set</code>,{" "}
        <code>remove</code>. Если манифест объявляет поля <code>settings</code>,
        приложение отображает их как собственный раздел плагина в Настройках,
        а значения приходят в <code>ctx.storage.get("settings")</code> как
        один объект. Читательский ассистент также может просматривать и изменять эти настройки
        (поля, отмеченные <code>agentHidden</code>, остаются вне его поля зрения).
        Три возможности полей выходят за рамки простой формы:
      </p>
      <ul>
        <li>
          <code>visibleWhen: {"{ field, equals }"}</code> показывает поле только
          пока другое поле содержит одно из указанных значений. Скрытые поля
          сохраняют свои сохраненные значения — один объект настроек может нести значение,
          установленное для каждого варианта (плагин TTS сохраняет один голос для каждого провайдера таким
          образом).
        </li>
        <li>
          <code>select</code> с <code>dynamicOptions: true</code>{" "}
          разрешает свои опции во время выполнения: привяжите источник в{" "}
          <code>activate</code> с{" "}
          <code>ctx.settings.provideOptions(fieldId, async (values) =&gt;
          [...])</code>. Когда источник ничего не выдает (пока нет учетных данных,
          конечная точка недостижима), поле возвращается к вводу свободного текста —
          перечисление — это удобство, никогда не ворота.
        </li>
        <li>
          <code>kind: "secret"</code> объявляет учетные данные: приложение отображает
          ввод пароля, записывающий в зашифрованное секретное хранилище — id поля
          ЯВЛЯЕТСЯ ключом <code>ctx.secrets</code>, который ваш код читает обратно — никогда в
          простые настройки и никогда в каталог ассистента. Сохраненное
          значение никогда не отображается; поле показывает настроенное состояние и
          доступность очистки.
        </li>
      </ul>
      <p>
        Для структурированных данных <code>ctx.storage.collection(name)</code> открывает
        именованную коллекцию документов — <code>put</code> / <code>get</code> /{" "}
        <code>delete</code> / <code>list</code> над записями документов, с
        опциональным происхождением <code>bookId</code> / <code>anchor</code>, по которому вы можете
        фильтровать. Происхождение — это индекс, а не владение: документы выживают
        удалению ссылающейся книги, и жизненный цикл коллекции принадлежит
        плагину (удаление очищает её). Встроенный плагин Словарь и
        его хронология сохраненных слов полностью построены на этом уровне.
      </p>

      <h2>Внешний контекст</h2>
      <p>Всегда доступен, разрешение не требуется:</p>
      <ul>
        <li>
          <code>ctx.manifest</code>, <code>ctx.appVersion</code>,{" "}
          <code>ctx.locale</code> (текущая локаль BCP-47 UI приложения — читайте
          её во время использования, она отслеживает языковую настройку в реальном времени);
        </li>
        <li>
          <code>ctx.ui.showToast(message)</code>;
        </li>
        <li>
          <code>ctx.ui.exportFile({"{ filename, content, mimeType? }"})</code>{" "}
          открывает поток сохранения хоста для генерированного текста (CSV, JSON, Markdown) или
          бинарных байт;
        </li>
        <li>
          <code>ctx.secrets</code> — зашифрованное хранилище учетных данных, с пространством имён
          для каждого плагина (токены API и подобное); живет вне SQLite и
          резервных копий и выживает удалению;
        </li>
        <li>
          <code>ctx.session.on(…)</code> — факты сеанса выше;
        </li>
        <li>
          <code>ctx.reader.openBook(bookId)</code> и{" "}
          <code>ctx.reader.goTo({"{ bookId?, cfi?, href? }"})</code> — навигация
          ридером (пользовательский контроль, без раскрытия данных).
        </li>
      </ul>

      <h2>Стабильность</h2>
      <p>
        Это контракт v2, поставленный в приложении 0.3.0 — намеренная ломающая
        перестройка, которая вывела всю поверхность из доменной модели (манифесты v1
        не проходят установку с читаемой ошибкой). Отсюда API
        растет аддитивно: новые домены, новые имена событий, новые виды блоков —
        декларативные темы (<code>ui:themes</code>) — первое такое
        дополнение. Ломающие изменения в том, что здесь задокументировано, рассматриваются как
        ошибки. Объявляйте <code>minAppVersion</code> для всего, что зависит от
        недавнего дополнения.
      </p>
    </article>
  );
}
