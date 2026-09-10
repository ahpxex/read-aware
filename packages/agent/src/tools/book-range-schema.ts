import { Type } from "@earendil-works/pi-ai";

export const bookRangeSchema = Type.Object({
  bookId: Type.String({ minLength: 1, maxLength: 512 }),
  contentVersion: Type.String({ minLength: 1, maxLength: 256 }),
  cfi: Type.String({ minLength: 1, maxLength: 8192 }),
  textQuote: Type.Optional(Type.Object({ exact: Type.String({ minLength: 1, maxLength: 12000 }),
    prefix: Type.Optional(Type.String({ maxLength: 2000 })), suffix: Type.Optional(Type.String({ maxLength: 2000 })) }, { additionalProperties: false })),
}, { additionalProperties: false });
