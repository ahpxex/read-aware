import { Body, DefinitionList, Display, Divider, Eyebrow } from "../../../components";

const contextCopy = {
  eyebrow: "Context",
  title: "Context stays nearby, but never louder than the text itself.",
  body: "Supporting material sits in a calm, editorial frame. The emphasis stays on comprehension, with just enough structure to orient the reader when they need it.",
  notes: [
    { label: "Placement", value: "Contextual details sit in sequence instead of competing side panels." },
    { label: "Tone", value: "The palette remains monochrome and warm, without gradients or accent glare." },
    { label: "Focus", value: "Each block is shortened to the essentials so interpretation feels effortless." },
  ],
};

export function ContextWorkspace() {
  return (
    <article className="ra-motion-page-enter mx-auto flex min-h-full max-w-screen-2xl flex-col justify-center px-6 py-16 sm:py-20 lg:py-24">
      <Eyebrow>{contextCopy.eyebrow}</Eyebrow>
      <Display as="h1" size="7xl" className="mt-6 max-w-4xl">
        {contextCopy.title}
      </Display>
      <Body size="lg" className="mt-8 max-w-2xl">
        {contextCopy.body}
      </Body>

      <Divider className="mt-16" />
      <DefinitionList
        items={contextCopy.notes}
        columns={3}
        className="pt-8"
      />
    </article>
  );
}
