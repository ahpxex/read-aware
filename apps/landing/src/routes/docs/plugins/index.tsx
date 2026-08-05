import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../lib/site";

export const Route = createFileRoute("/docs/plugins/")({
  head: () => ({
    meta: [
      { title: "Plugin system — ReadAware Docs" },
      {
        name: "description",
        content:
          "What ReadAware plugins can do, how the trust model works, and how to install them.",
      },
    ],
  }),
  component: PluginsOverviewPage,
});

function PluginsOverviewPage() {
  return (
    <article className="doc-prose">
      <h1>Plugin system</h1>
      <p className="lead">
        Plugins extend ReadAware with new actions, pages, and — most
        importantly — new tools for the reading assistant. A plugin is a small
        JavaScript module; its interface is always rendered by the app's own
        design system, so plugin features look and feel native.
      </p>

      <h2>What a plugin can contribute</h2>
      <ul>
        <li>
          <strong>Selection actions</strong> — entries in the reader's
          text-selection menu. Send a word to Anki, translate a passage, save a
          quote anywhere.
        </li>
        <li>
          <strong>Header buttons</strong> — icon buttons on the reader or shelf
          top bar that open a popover, or (on the shelf) a full page.
        </li>
        <li>
          <strong>Commands</strong> — entries in the command palette. Every
          plugin action is reachable there automatically; explicit commands add
          more.
        </li>
        <li>
          <strong>Agent tools</strong> — functions the reading assistant can
          call during chat. This is the highest-ceiling mount point: a plugin
          can let the assistant query your Anki deck, your RSS backlog, or any
          service you use.
        </li>
        <li>
          <strong>Content providers</strong> — virtual books whose chapters the
          plugin supplies on demand. An RSS feed can sit on your shelf and be
          read, annotated, and discussed like any book.
        </li>
        <li>
          <strong>Read-aloud voices</strong> — TTS engines for the reader's
          read-aloud. The plugin synthesizes audio; the app owns playback and
          falls back to the system voice when a call fails.
        </li>
        <li>
          <strong>Settings and schedules</strong> — declared settings become
          the plugin's own section in Settings (API keys included, stored
          encrypted), and declared schedules run recurring work while the app
          is open.
        </li>
      </ul>

      <h2>Plugins look native, by construction</h2>
      <p>
        Plugins never render their own HTML. They declare views from a small
        vocabulary — markdown, lists, forms, and a few structured blocks — and
        the app renders them with its own components. Plugin authors give up
        pixel control and get zero design work and a permanently consistent
        app in return.
      </p>

      <h2>The trust model</h2>
      <p>
        Plugins run inside the app with the same JavaScript context — like
        Obsidian, and unlike a browser extension sandbox. Two honest layers of
        protection apply:
      </p>
      <ul>
        <li>
          <strong>Permissions</strong> — a plugin's manifest declares what it
          uses (network, reading data, AI, clipboard, …), and the API only
          exposes what was declared. This guards against accidental overreach.
        </li>
        <li>
          <strong>Installation is the trust decision.</strong> Before anything
          is copied or executed, the app shows exactly which permissions the
          plugin asks for, in plain language, and waits for your consent.
          Install plugins the way you would install software.
        </li>
      </ul>
      <p>
        The app's own architecture bounds the blast radius: plugin storage is
        namespaced inside the app's data directory, and the desktop shell
        grants no arbitrary filesystem access.
      </p>

      <h2>Installing plugins</h2>
      <ul>
        <li>
          <strong>Marketplace</strong> — Settings → Plugins → Marketplace lists
          community plugins from the public{" "}
          <a
            href={MARKETPLACE_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            registry
          </a>
          ; installation is one click, with the permission summary first.
        </li>
        <li>
          <strong>From a folder</strong> — Settings → Plugins can install any
          local plugin folder. This is the development loop: point it at your
          working directory, reinstall to pick up changes.
        </li>
      </ul>

      <h2>You control the layout</h2>
      <p>
        Plugins contribute capabilities; you decide where buttons live.
        Settings → Menus arranges each surface (shelf top bar, reader top bar,
        selection menu): drag items between the visible row and the overflow
        menu, reorder them, or reset to defaults. New plugin actions arrive in
        the overflow menu — quietly — and everything is always reachable from
        the command palette.
      </p>

      <h2 id="read-aloud-tts">Read aloud with any TTS voice</h2>
      <p>
        The bundled <strong>TTS Voices</strong> plugin routes read-aloud
        through the engine of your choice — ElevenLabs, Fish Audio, OpenAI, or
        any OpenAI-compatible endpoint (Kokoro, LocalAI, Edge TTS bridges…).
        Everything lives in <strong>Settings → TTS Voices</strong>: pick a
        provider, and its fields follow — API keys go straight to the
        encrypted secret store, and where the provider can enumerate voices
        the Voice field becomes a list (type a name yourself when it can't).
      </p>
      <p>
        A popular free setup is Microsoft's Edge neural voices via{" "}
        <a
          href="https://github.com/travisvn/openai-edge-tts"
          target="_blank"
          rel="noopener noreferrer"
        >
          openai-edge-tts
        </a>
        , a small local server that speaks the OpenAI audio API:
      </p>
      <ol>
        <li>
          Run the server locally — for example{" "}
          <code>docker run -d -p 5050:5050 travisvn/openai-edge-tts</code> (no
          API key required by default).
        </li>
        <li>
          In Settings → TTS Voices, set Provider to{" "}
          <em>Custom / local (OpenAI-compatible)</em> and the endpoint to{" "}
          <code>http://127.0.0.1:5050/v1/audio/speech</code>.
        </li>
        <li>
          Pick a voice from the list — the app reads the server's catalog, so
          the full Edge set (e.g. <code>zh-CN-XiaoxiaoNeural</code>,{" "}
          <code>en-US-AriaNeural</code>) appears alongside the OpenAI-style
          aliases.
        </li>
      </ol>
      <p>
        Then open a book and start read-aloud: sentences stream through your
        chosen voice, the next one prefetches while the current one plays, and
        any failed call falls back to the system voice instead of stopping the
        reading.
      </p>

      <h2>Write one</h2>
      <p>
        A plugin is a folder with a <code>manifest.json</code> and a single{" "}
        <code>main.js</code>. The <Link to="/docs/plugins/api">API
        reference</Link> covers the whole contract, and{" "}
        <Link to="/docs/plugins/publishing">Publishing</Link> shows how to ship
        it to the marketplace.
      </p>
    </article>
  );
}
