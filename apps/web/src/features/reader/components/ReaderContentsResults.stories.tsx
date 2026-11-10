import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Bookmark, BookLocationHit } from "@read-aware/core";
import { ScrollArea } from "@read-aware/ui";
import type { Annotation } from "../../annotations";
import type { ContentsSearchState } from "../hooks/useContentsSearch";
import type { TocEntry } from "../lib/reader-types";
import { ReaderContentsResults } from "./ReaderContentsResults";

const entries: TocEntry[] = [
  "第八章 寂静的春天",
  "第九章 红岸之一",
  "第十章 宇宙闪烁之二",
  "第十二章 三体、墨子、烈焰",
  "第十三章 红岸之二",
  "第二十九章 第二红岸基地",
].map((label, index) => ({ id: `t${index}`, href: `part${index}.xhtml`, label, depth: 1, spineIndex: index }));

const chapterOf = (sectionIndex: number) => entries[sectionIndex]?.label;

let seq = 0;
function hit(sectionIndex: number, pre: string, match: string, post: string): BookLocationHit {
  seq += 1;
  const range = { bookId: "book-1", contentVersion: "v1", cfi: `epubcfi(/6/${sectionIndex * 2}!/4/${seq})` };
  return { id: `${sectionIndex}:${seq}`, sectionIndex, excerpt: { pre, match, post }, location: { ...range }, range };
}

const hits: BookLocationHit[] = [
  hit(
    1,
    "“肯定是的，这还用证实吗？”戴眼镜的军人拿走了杂志，然后介绍说，“这位是",
    "红岸",
    "基地的雷志成政委。我是杨卫宁，基地的总工程师。离降落还有一会儿，你休息吧。”",
  ),
  hit(
    1,
    "“我的杨总啊，这责你负得了吗？你一头钻在技术里，‘",
    "红岸",
    "’可是与其他国防重点项目不同，它的复杂，是复杂在技术之外的。”",
  ),
  hit(1, "“中国人民解放军第二炮兵，", "红岸", "工程第147次常规发射，授权确认完毕，30秒倒数！”"),
  hit(2, "“最近才知道，她那二十多年，是在", "红岸", "基地度过的。”"),
  hit(
    2,
    "“大部分是真的。",
    "红岸",
    "自译解系统的一名研制者移民到欧洲，去年写了一本书，你所说的传说大多来自于那本书，据我了解是真的。",
  ),
  hit(3, "“您是说", "红岸", "基地吗？”"),
  hit(
    3,
    "…大家都喜欢念念叨叨地回忆往事，但都希望别人听自己的，而对别人说的都厌烦。",
    "红岸",
    "那些事，也就你感兴趣了。”",
  ),
  hit(4, "刚进入", "红岸", "基地时，叶文洁没有被分配固定工作，只是在一名安全人员的监视下干一些技术上的杂事。"),
  hit(
    4,
    "…她同导师一起调试国内第一台小型射电望远镜，又积累了不少这方面的经验。没有想到，她的这些知识竟在",
    "红岸",
    "基地派到了用场。",
  ),
  hit(
    4,
    "…但走到这个位置的另一个原因却令她百思不得其解：",
    "红岸",
    "基地至少在她接触的部分，没有什么真正意义上的先进技术…",
  ),
];

const at = "2026-06-20T10:00:00.000Z";
const bookmarks: Bookmark[] = [
  {
    id: "b1",
    bookId: "book-1",
    name: "红岸基地大门",
    kind: "location",
    target: { contentVersion: "v1", href: "part1.xhtml" },
    createdAt: at,
    updatedAt: at,
  },
];
const marks: Annotation[] = [
  {
    id: "m1",
    bookId: "book-1",
    type: "note",
    content: "红岸的真实目的在这里第一次露出来。",
    text: "它的复杂，是复杂在技术之外的。",
    cfiRange: "epubcfi(/6/2!/4/8)",
    chapterHref: "part1.xhtml",
    createdAt: at,
    updatedAt: at,
  },
  {
    id: "m2",
    bookId: "book-1",
    type: "highlight",
    color: "yellow",
    text: "红岸系统就是一台大微波炉",
    cfiRange: "epubcfi(/6/8!/4/20)",
    chapterHref: "part4.xhtml",
    createdAt: at,
    updatedAt: at,
  },
];

const done = (found: BookLocationHit[]): ContentsSearchState => ({
  pages: [],
  chapterOf,
  text: {
    status: "done",
    hits: found,
    scannedSections: 91,
    totalSections: 91,
    textStatus: "available",
    truncated: false,
  },
});

/**
 * The book search's results: chapters, pages, bookmarks and marks that answer
 * the query, then the book's text under the chapter each hit is in. Rendered
 * in the header popup's box, which bounds the height; the list scrolls inside.
 */
const meta = {
  title: "Interface/Reader/ReaderContentsResults",
  component: ReaderContentsResults,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="flex max-h-[36rem] w-[28rem] flex-col overflow-hidden rounded-md border border-border bg-[var(--ra-main-surface-color)]">
        <ScrollArea className="min-h-0 flex-1">
          <div className="pb-2">
            <Story />
          </div>
        </ScrollArea>
      </div>
    ),
  ],
  args: {
    query: "红岸",
    entries,
    matches: { chapters: [1, 4, 5], bookmarks: [], marks: [] },
    search: done(hits),
    onChapter: () => {},
    onBookmark: () => {},
    onMark: () => {},
    onLocation: () => {},
  },
} satisfies Meta<typeof ReaderContentsResults>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Chapters named by the query, then the text hits under their chapters. */
export const ChaptersAndText: Story = {};

/** Every kind of result at once. */
export const AllGroups: Story = {
  args: {
    matches: { chapters: [1, 4, 5], bookmarks, marks },
    search: {
      ...done(hits),
      pages: [
        {
          index: 41,
          sectionIndex: 1,
          label: "42",
          labelTruncated: false,
          linear: true,
          location: { bookId: "book-1", contentVersion: "v1", href: "part1.xhtml" },
        },
      ],
    },
  },
};

/** No chapter is named by the query: the text hits alone. */
export const TextOnly: Story = {
  args: { matches: { chapters: [], bookmarks: [], marks: [] } },
};

/** Hits stream in while the rest of the book is searched. */
export const Searching: Story = {
  args: {
    search: {
      pages: [],
      chapterOf,
      text: {
        status: "searching",
        hits: hits.slice(0, 3),
        scannedSections: 14,
        totalSections: 91,
        textStatus: "available",
        truncated: false,
      },
    },
  },
};

/** The query names chapters but is nowhere in the text. */
export const NoTextHits: Story = {
  args: { search: done([]) },
};

/** A long result scrolls inside the popup's height cap. */
export const ManyHits: Story = {
  args: {
    search: done(
      Array.from({ length: 60 }, (_, index) => {
        const source = hits[index % hits.length]!;
        return hit(
          Math.floor(index / 8) % entries.length,
          source.excerpt.pre,
          source.excerpt.match,
          source.excerpt.post,
        );
      }),
    ),
  },
};
