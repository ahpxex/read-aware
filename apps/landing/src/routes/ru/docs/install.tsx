import { createFileRoute } from "@tanstack/react-router";
import { useLatestRelease } from "../../../hooks/useLatestRelease";
import { RELEASES_URL } from "../../../lib/releases";

export const Route = createFileRoute("/ru/docs/install")({
  head: () => ({
    meta: [
      { title: "Скачать и установить — Документация ReadAware" },
      {
        name: "description",
        content:
          "Установите ReadAware на macOS, Windows, Linux, Android или iOS, включая примечания по первому запуску неподписанных сборок.",
      },
    ],
  }),
  component: InstallPage,
});

function InstallPage() {
  const release = useLatestRelease();

  return (
    <article className="doc-prose">
      <h1>Скачать и установить</h1>
      <p className="lead">
        ReadAware бесплатен. Каждый выпуск поставляется с установщиками для macOS, Windows,
        Linux и Android{release.tag ? `; текущий выпуск — ${release.tag}` : ""}.
        Все версии, прошлые и настоящие, находятся на{" "}
        <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
          странице релизов GitHub
        </a>
        .
      </p>

      <h2>Загрузки</h2>
      <ul>
        {release.downloads.map((download) => {
          if (download.comingSoon) return null;
          const links = [
            ...(download.primary ? [download.primary] : []),
            ...download.extras,
          ];
          return (
            <li key={download.id}>
              <strong>{download.name}</strong>
              {download.id === release.platform ? " (ваша платформа)" : ""} —{" "}
              {links.map((link, index) => (
                <span key={link.url}>
                  {index > 0 ? " · " : ""}
                  <a href={link.url}>{link.label}</a>
                </span>
              ))}
            </li>
          );
        })}
      </ul>

      <h2>macOS</h2>
      <p>
        Скачайте <code>.dmg</code> для вашего Mac — Apple Silicon для машин серии M,
        Intel для более старых — откройте его и перетащите ReadAware в
        Программы.
      </p>
      <p>
        Настольные сборки пока не нотаризованы Apple, поэтому первый запуск
        блокируется предупреждением о том, что приложение не может быть проверено. Чтобы открыть его
        в любом случае:
      </p>
      <ol>
        <li>Попробуйте открыть ReadAware один раз и закройте предупреждение.</li>
        <li>
          Откройте Системные настройки → Конфиденциальность и безопасность, прокрутите вниз до
          уведомления о том, что ReadAware был заблокирован, и выберите <strong>Открыть
          в любом случае</strong>.
        </li>
      </ol>
      <p>
        Альтернативно, снимите флаг карантина один раз из Терминала и запускайте
        нормально:
      </p>
      <pre>
        <code>xattr -cr /Applications/ReadAware.app</code>
      </pre>

      <h2>Windows</h2>
      <p>
        Скачайте и запустите установщик (<code>-setup.exe</code>). Поскольку
        сборка еще не подписана кодом, Microsoft Defender SmartScreen может
        вмешаться; выберите <strong>Подробнее</strong>, затем{" "}
        <strong>Выполнить в любом случае</strong>.
      </p>
      <p>
        Пакет <code>.msi</code> доступен для управляемых установок, а
        портативный <code>.zip</code> запускается без установки чего-либо — распакуйте его
        и запустите <code>ReadAware.exe</code>.
      </p>

      <h2>Linux</h2>
      <p>
        <code>.AppImage</code> запускается на большинстве дистрибутивов без
        установки — сделайте его исполняемым и запустите:
      </p>
      <pre>
        <code>{`chmod +x ReadAware-*-linux-x64.AppImage
./ReadAware-*-linux-x64.AppImage`}</code>
      </pre>
      <p>
        AppImages требуют FUSE; на дистрибутивах без него (некоторые минималистичные или очень
        свежие) сначала установите пакет <code>libfuse2</code> вашего дистрибутива.
        Также доступны нативные пакеты:
      </p>
      <pre>
        <code>{`# Debian / Ubuntu
sudo apt install ./ReadAware-*-linux-x64.deb

# Fedora / RHEL
sudo dnf install ./ReadAware-*-linux-x64.rpm`}</code>
      </pre>

      <h2>Android</h2>
      <p>
        Скачайте <code>.apk</code> (arm64) на вашем устройстве и откройте его. APK
        подписан; Android все равно попросит вас разрешить установку из вашего
        браузера или файлового менеджера в первый раз, так как он не поступает из
        магазина.
      </p>

      <h2>iOS</h2>
      <p>
        ReadAware пока нет в App Store. Каждый выпуск содержит
        неподписанный <code>.ipa</code> на{" "}
        <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
          странице релизов
        </a>{" "}
        для sideloading: инструменты вроде AltStore, SideStore или Sideloadly переподписывают
        его вашим собственным Apple ID и устанавливают на ваше устройство. Этот путь
        для людей, уже знакомых с sideloading; релиз в магазине появится позже.
      </p>

      <h2>Оставаться в актуальном состоянии</h2>
      <p>
        Настольное приложение обновляется само: оно проверяет новые релизы, скачивает
        обновление в фоновом режиме и применяет его при перезапуске. Пакеты обновлений
        криптографически подписаны и проверяются по ключу, встроенному
        в приложение, независимо от подписи кода ОС. На Android и iOS
        устанавливайте новые версии вручную со страницы релизов пока что.
      </p>
      <p>
        Когда появляется обновление, небольшое диалоговое окно представляет что изменилось — примечания
        к релизу, на вашем языке, показанные прямо в приложении. Его закрытие
        является постоянным для этой версии, и диалог можно полностью отключить
        в Настройках → Общие.
      </p>
    </article>
  );
}
