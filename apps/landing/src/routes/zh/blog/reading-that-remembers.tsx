import { Link, createFileRoute } from "@tanstack/react-router";
import { BlogPost } from "../../../components/BlogPost";
import { getPost } from "../../../lib/posts";

const SLUG = "reading-that-remembers";

export const Route = createFileRoute("/zh/blog/reading-that-remembers")({
  head: () => {
    const post = getPost(SLUG);
    return {
      meta: [
        { title: `${post.text.zh.title} — ReadAware 博客` },
        { name: "description", content: post.text.zh.description },
      ],
    };
  },
  component: () => (
    <BlogPost slug={SLUG} locale="zh">
      <p>
        ReadAware 0.1 今天发布了，支持 macOS、Windows 和
        Linux。它是一个阅读应用——又一个——这篇文章想说的是，为什么我们仍然觉得世界需要它。
      </p>

      <h2>划线没有去处</h2>
      <p>
        我们认识的每一位认真的读者都有同一套仪式：读书，把重要的段落画下来，然后这些划线堆积在一个你其实永远不会再看的地方。划下那一笔的瞬间，正是一本书真正改变你想法的时刻——而软件只把它当作一条归档记录。
      </p>
      <p>
        AI
        聊天的时代让这件事变得更奇怪，而不是更好。你现在可以把一章书粘贴进聊天机器人，得到一场真正不错的讨论。但讨论会蒸发。下一本书、下一次对话，一切从零开始。上个月陪你聊《沉思录》的助手，完全不记得那件事发生过。
      </p>

      <h2>记忆，而不是聊天记录</h2>
      <p>
        ReadAware
        围绕一个想法构建：阅读应用里智能的单位不是书，而是你的阅读——你在一本本书之间留下的划线、笔记、提问和对话的轨迹。所以这个应用以记忆为先来设计：
      </p>
      <ul>
        <li>
          每本书只有一条连续的对话。你不需要在书里管理聊天线程，只管继续聊下去。
        </li>
        <li>
          助手不会反复重读一份不断膨胀的聊天记录。重要的内容被提炼成持久的记忆——你在读什么、问过什么、总在绕回哪里——并在相关的时刻被想起。
        </li>
        <li>
          你的高亮和笔记不是档案，而是助手真正拿来工作的材料。
        </li>
      </ul>
      <p>
        在这里，问一句“这和我上一本读的书有什么联系？”是成立的。这就是这个产品。
      </p>

      <h2>一个阅读器，读所有格式</h2>
      <p>
        产品里平凡的那一半也必须做对。EPUB、MOBI、AZW3、FB2 和 PDF
        都在同一个阅读器里打开，共用同一套选区、批注和进度模型。没有任何格式转换——你导入的文件就是你保留的文件。DRM
        加锁的文件是我们唯一打不开的东西，应用会坦白地告诉你，而不是装作可以。
      </p>

      <h2>属于你，在你的机器上</h2>
      <p>
        你的书库、批注，以及应用建立起来的记忆，全都存在你的设备上。AI
        用你自己带来的密钥运行，直接与你的服务商通信。没有账号，也没有任何服务器在读你的书。之后会有一篇文章细谈这一点——这是刻意的架构选择，不是暂时的状态。
      </p>
      <p>
        ReadAware 是免费的，也还年轻——0.1 就是字面意义上的
        0.1。如果你认真读书，希望阅读能沉淀成一些东西，
        <Link to="/zh/docs/install">装上它</Link>，然后告诉我们哪里坏了。
      </p>
    </BlogPost>
  ),
});
