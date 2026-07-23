import { Link, createFileRoute } from "@tanstack/react-router";
import { BlogPost } from "../../components/BlogPost";
import { getPost } from "../../lib/posts";

const SLUG = "reading-that-remembers";

export const Route = createFileRoute("/blog/reading-that-remembers")({
  head: () => {
    const post = getPost(SLUG);
    return {
      meta: [
        { title: `${post.text.en.title} — ReadAware Blog` },
        { name: "description", content: post.text.en.description },
      ],
    };
  },
  component: () => (
    <BlogPost slug={SLUG}>
      <p>
        ReadAware 0.1 is out today, for macOS, Windows, and Linux. It is a
        reading app — another one — and this post is about why we thought the
        world needed it anyway.
      </p>

      <h2>Highlights go nowhere</h2>
      <p>
        Every serious reader we know has the same ritual. You read, you mark
        the passages that matter, and the marks accumulate somewhere you will
        honestly never look again. The highlight was the point of contact — the
        moment a book actually changed what you were thinking — and the
        software treats it as an archive entry.
      </p>
      <p>
        The AI chat era made this stranger, not better. You can now paste a
        chapter into a chatbot and have a genuinely good conversation about it.
        But the conversation evaporates. Next book, next chat, blank slate. The
        assistant that discussed Meditations with you last month has no idea it
        ever happened.
      </p>

      <h2>Memory, not transcripts</h2>
      <p>
        ReadAware is built around one idea: the unit of intelligence in a
        reading app is not the book, it is your reading — the trail of
        highlights, notes, questions, and conversations you leave across
        books. So the app is designed memory-first:
      </p>
      <ul>
        <li>
          Every book has one continuous conversation. You never manage chat
          threads inside a book; you just keep talking.
        </li>
        <li>
          The assistant does not reread an ever-growing transcript. What
          matters is distilled into durable memory — what you are reading, what
          you asked, what you keep coming back to — and recalled when it is
          relevant.
        </li>
        <li>
          Your highlights and notes are not an archive. They are material the
          assistant actually works from.
        </li>
      </ul>
      <p>
        Ask "how does this connect to the last book I read?" and that question
        makes sense here. That is the product.
      </p>

      <h2>One reader, every format</h2>
      <p>
        The mundane half of the product had to be right, too. EPUB, MOBI,
        AZW3, FB2, and PDF all open in the same reader with the same
        selection, annotation, and progress model. Nothing is converted —
        the file you import is the file you keep. DRM-locked files are the one
        thing we cannot open, and the app says so plainly instead of
        pretending.
      </p>

      <h2>Yours, on your machine</h2>
      <p>
        Your library, annotations, and the memory the app builds all live on
        your device. AI runs on a key you bring, talking directly to your
        provider. There is no account and no server reading your books. More
        on this in a coming post — it is a deliberate architecture, not a
        temporary state.
      </p>
      <p>
        ReadAware is free, and it is young — 0.1 means 0.1. If you read
        seriously and want your reading to accumulate into something,{" "}
        <Link to="/docs/install">install it</Link> and tell us what breaks.
      </p>
    </BlogPost>
  ),
});
