import { Link, createFileRoute } from "@tanstack/react-router";
import { REPO_URL } from "../../../lib/releases";
import { DISCORD_URL } from "../../../lib/site";

export const Route = createFileRoute("/ru/docs/")({
  head: () => ({
    meta: [
      { title: "Документация — ReadAware" },
      {
        name: "description",
        content:
          "Как установить ReadAware, начать чтение и расширить приложение с помощью плагинов.",
      },
    ],
  }),
  component: DocsOverview,
});

function DocsOverview() {
  return (
    <article className="doc-prose">
      <h1>Документация</h1>
      <p className="lead">
        ReadAware — это AI-нативное приложение для чтения: один ридер для EPUB, MOBI, AZW3,
        FB2, CBZ, CBR, TXT, HTML и PDF, который выстраивает память по вашим книгам,
        выделениям и разговорам. Оно бесплатное, локально ориентированное и работает на вашем собственном ключе AI.
      </p>

      <h2>Начать здесь</h2>
      <ul>
        <li>
          <Link to="/ru/docs/install">Скачать и установить</Link> — установщики
          для macOS, Windows, Linux и Android, а также что делать, когда ваша ОС
          предупреждает о неподписанном приложении.
        </li>
        <li>
          <Link to="/ru/docs/getting-started">Начало работы</Link> — импортируйте
          книги, читайте и делайте заметки, подключите AI-провайдера и узнайте,
          где хранятся ваши данные.
        </li>
      </ul>

      <h2>Расширьте приложение</h2>
      <ul>
        <li>
          <Link to="/ru/docs/plugins">Система плагинов</Link> — что могут делать
          плагины и как работает модель доверия.
        </li>
        <li>
          <Link to="/ru/docs/plugins/api">Справка по API</Link> — полный
          контракт разработки: манифест, жизненный цикл, разрешения, вклады
          и представления.
        </li>
        <li>
          <Link to="/ru/docs/plugins/publishing">Публикация</Link> — как опубликовать
          ваш плагин в каталоге внутри приложения.
        </li>
      </ul>

      <h2>Другие ресурсы</h2>
      <p>
        Приложение разрабатывается открыто на{" "}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        . По вопросам, сообщениям об ошибках или чтобы показать, что вы создали, присоединяйтесь к{" "}
        <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
          Discord
        </a>{" "}
        или создайте issue.
      </p>
    </article>
  );
}
