import { createFileRoute } from "@tanstack/react-router";
import { BlogPost } from "../../../components/BlogPost";
import { getPost } from "../../../lib/posts";

const SLUG = "local-first";

export const Route = createFileRoute("/zh/blog/local-first")({
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
        ReadAware
        把你的书、你的批注，以及它围绕你的阅读建立起来的记忆，都存储在你的设备上。不是“本地缓存一份、云端才是正本”——而是就存在这里，作为唯一的事实来源，放在一个由应用直接读写的本地数据库里。
      </p>
      <p>
        对一个现代应用来说，这已经罕见到值得解释一番，因为这不是实现细节，这就是设计本身。
      </p>

      <h2>阅读应用知道得太多</h2>
      <p>
        书库是一个人最私密的数据集之一。你读什么、画下什么、凌晨一点对着一段难懂的文字问了什么——一个看着你阅读的应用，握着的东西更接近日记，而不是媒体收藏。
      </p>
      <p>
        ReadAware
        的整个前提让这件事更加尖锐。这个产品做的就是记忆：它把你的高亮和对话提炼成一份持久的画像——你读了什么、你如何思考。把这样的东西建立起来，再默认送到别人的服务器上，说得客气一点，是一笔做错的交易。所以规则很简单：数据跟着你，应用必须完全可离线使用。导入、阅读、批注、搜索——没有一样需要碰网络。
      </p>

      <h2>网络用来做什么</h2>
      <p>两件事，都是可选的：</p>
      <ul>
        <li>
          <strong>推理。</strong>助手用你自己带来的 API
          密钥运行。请求从你的机器直接发往你选择的服务商——OpenAI、Anthropic、Google，或者一个局域网端点。中间没有
          ReadAware
          的服务器，这也意味着没有人计量你的用量、向你推销，或记录你的提问。
        </li>
        <li>
          <strong>同步，在不远的将来。</strong>
          多设备同步正在路上，它的设计遵循同一条规则：服务器只是一个哑中继，转发端到端加密的变更日志。合并发生在你的设备之间；服务器存的是它自己也读不懂的密文。既然没有任何服务端功能需要你的明文，也就没有什么可以拿去交换。
        </li>
      </ul>

      <h2>安静的好处</h2>
      <p>
        隐私是那个一句话就能讲完的理由，但与一个本地优先的应用朝夕相处，日常感受到的多半是别的东西。一切都很快，因为每一次读取都是本地读取，没有转圈等待。飞机上能用，信号盲区能用，十年之后也能用——就算我们明天消失了，你的书库和里面的每一条笔记依然能在你的机器上打开，你的书也依然是你当初导入的那些原始文件。
      </p>
      <p>
        你赖以思考的软件，结构上就应该像一件你拥有的东西，而不是一件你租来的东西。ReadAware
        正是如此。
      </p>
    </BlogPost>
  ),
});
