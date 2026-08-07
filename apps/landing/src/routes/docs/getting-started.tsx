import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/docs/getting-started")({
  head: () => ({
    meta: [
      { title: "Getting started — ReadAware Docs" },
      {
        name: "description",
        content:
          "Import your books, read and annotate, connect an AI provider, and learn where your data lives.",
      },
    ],
  }),
  component: GettingStartedPage,
});

function GettingStartedPage() {
  return (
    <article className="doc-prose">
      <h1>Getting started</h1>
      <p className="lead">
        ReadAware opens your own files and keeps everything it learns on your
        device. This page walks the first hour: importing books, reading and
        annotating, and — optionally — connecting an AI.
      </p>

      <h2>Add your books</h2>
      <p>
        Import files from the shelf. ReadAware reads{" "}
        <strong>EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML, and PDF</strong>{" "}
        directly — there is no
        conversion step and no cloud upload. The file you import is the file
        you keep; highlights, notes, and your position attach to the original
        text.
      </p>
      <p>
        DRM-protected files cannot be opened — a book bought from a store that
        locks its files stays locked. If a book refuses to open and the format
        is supported, that is almost always why.
      </p>

      <h2>Read</h2>
      <p>
        Every format opens in the same reader with the same controls. Three
        reading modes are available from the reader's appearance settings:
      </p>
      <ul>
        <li>
          <strong>Continuous scroll</strong> — the default; the book flows as
          one column.
        </li>
        <li>
          <strong>Single page</strong> — one page at a time, turned like paper.
        </li>
        <li>
          <strong>Two pages</strong> — a book-like spread on wide screens.
        </li>
      </ul>
      <p>
        Your position is saved per book, and the table of contents is always a
        click away in the reader's top bar.
      </p>
      <p>
        The same appearance settings carry the typography: font, size, weight,
        line spacing, paragraph spacing, margins, and page color. Text
        alignment defaults to <strong>As published</strong> — whatever the
        book's own stylesheet asked for — and can be forced left or justified
        if you'd rather it were uniform everywhere.
      </p>

      <h2>Listen</h2>
      <p>
        Any book can be read aloud. Read-aloud rides the same sentence and
        paragraph navigator you read by — start the navigator, then press play
        in its bar, and the book advances one unit at a time with the spoken
        text marked as it goes.
      </p>
      <p>
        Out of the box this speaks with your device's own voice, which needs no
        key and no network. Enabling a voice plugin — the bundled{" "}
        <strong>TTS Voices</strong> plugin, or any other — is itself the choice to
        speak through that engine instead; which voice it uses is configured in
        that plugin's own settings, alongside its provider and any custom
        endpoint. There is no separate voice picker to keep in sync.
      </p>

      <h2>Annotate</h2>
      <p>Select any passage and a quiet action menu appears:</p>
      <ul>
        <li>
          <strong>Highlight</strong> — in a few colors, or as an underline.
        </li>
        <li>
          <strong>Note</strong> — attach your own words to the passage.
        </li>
        <li>
          <strong>Look up</strong> — the built-in dictionary explains the word
          in its sentence, not just in the abstract, and saves it to the
          Dictionary timeline. (Uses your configured AI.)
        </li>
      </ul>
      <p>
        Everything you mark is collected per book and feeds the app's memory —
        annotations are not an archive, they are material the assistant reads.
      </p>

      <h2>Connect an AI</h2>
      <p>
        All of ReadAware's intelligence runs on a key you bring. Reading,
        annotating, and the library work fully without one; the assistant,
        dictionary, and memory need it.
      </p>
      <ol>
        <li>Open Settings → AI.</li>
        <li>
          Pick a provider — OpenAI, Anthropic, Google, OpenRouter, DeepSeek,
          xAI, Groq, Mistral, Moonshot, Z.ai, or any OpenAI-compatible endpoint
          via <strong>Custom</strong>.
        </li>
        <li>Paste your API key and choose a model.</li>
      </ol>
      <p>
        ReadAware distinguishes a <strong>smart</strong> model (chat and
        synthesis) from a <strong>fast</strong> one (dictionary look-ups,
        summaries, memory upkeep); sensible defaults are filled in per
        provider. Your key is stored on your device and requests go directly
        to your provider — there is no ReadAware server in between.
      </p>

      <h2>Ask</h2>
      <p>
        Each book has one persistent conversation — open the chat panel while
        reading and ask about the passage, the chapter, or the book. On the{" "}
        <strong>Context</strong> page you can talk across your whole shelf in
        as many threads as you like.
      </p>
      <p>
        The assistant works from your reading: your highlights, notes, earlier
        conversations, and a long-term memory it maintains about what you read
        and care about. That memory is built and stored locally, like
        everything else.
      </p>

      <h2>Move fast</h2>
      <p>
        The command palette (<code>Cmd K</code> on macOS, <code>Ctrl K</code>{" "}
        elsewhere — rebindable in Settings) reaches every action: open books,
        switch views, run plugin commands.
      </p>

      <h2>Where your data lives</h2>
      <p>
        Books, annotations, conversations, and memory are stored on your
        device. The network is used for AI requests to your own provider and
        nothing else — the app is fully usable offline against your local
        library.
      </p>
    </article>
  );
}
