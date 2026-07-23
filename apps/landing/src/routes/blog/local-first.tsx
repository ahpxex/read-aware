import { createFileRoute } from "@tanstack/react-router";
import { BlogPost } from "../../components/BlogPost";
import { getPost } from "../../lib/posts";

const SLUG = "local-first";

export const Route = createFileRoute("/blog/local-first")({
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
        ReadAware stores your books, your annotations, and the memory it
        builds about your reading on your device. Not cached locally with a
        cloud copy as the real one — stored, as the source of truth, in a
        local database the app reads and writes directly.
      </p>
      <p>
        This is unusual enough for a modern app that it deserves an
        explanation, because it is not an implementation detail. It is the
        design.
      </p>

      <h2>A reading app knows too much</h2>
      <p>
        A library is one of the more intimate datasets a person has. What you
        read, what you underline, what you ask about a difficult passage at
        1 a.m. — an app that watches you read holds something closer to a
        diary than to a media collection.
      </p>
      <p>
        ReadAware's whole premise makes this sharper. The product is memory:
        it distills your highlights and conversations into a durable profile
        of what you read and how you think. Building that and then shipping it
        to someone else's server by default seemed, to put it mildly, like the
        wrong trade. So the rule is simple: the data lives with you, and the
        app must be fully usable offline. Import, read, annotate, search —
        none of it touches a network.
      </p>

      <h2>What the network is for</h2>
      <p>Two things, both optional:</p>
      <ul>
        <li>
          <strong>Inference.</strong> The assistant runs on an API key you
          bring. Requests go from your machine to your provider — OpenAI,
          Anthropic, Google, a local-network endpoint, whoever you chose.
          There is no ReadAware server in the middle, which also means nobody
          to meter you, upsell you, or log your questions.
        </li>
        <li>
          <strong>Sync, eventually.</strong> Multi-device sync is coming, and
          its design follows the same rule: the server is a dumb relay for
          end-to-end encrypted change logs. Your devices reconcile; the server
          stores ciphertext it cannot read. Since there is no server-side
          feature that needs your plaintext, there is nothing to trade away.
        </li>
      </ul>

      <h2>The quiet benefits</h2>
      <p>
        Privacy is the argument that fits in a sentence, but daily life with a
        local-first app is mostly about other things. Everything is fast,
        because every read is a local read. Nothing spins. The app works on a
        plane, in a dead zone, and in ten years — if we disappeared tomorrow,
        your library and every note in it still open on your machine, and your
        books are still the original files you imported.
      </p>
      <p>
        Software you rely on for thinking should be structured like something
        you own, not something you rent. This one is.
      </p>
    </BlogPost>
  ),
});
