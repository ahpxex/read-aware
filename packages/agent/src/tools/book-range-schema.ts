import { obj, opt, str } from "@earendil-works/pi-schema";

export const bookRangeSchema = obj({
  bookId: str({ minLength: 1, maxLength: 512 }),
  contentVersion: str({ minLength: 1, maxLength: 256 }),
  cfi: str({ minLength: 1, maxLength: 8192 }),
  textQuote: opt(
    obj({
      exact: str({ minLength: 1, maxLength: 12000 }),
      prefix: opt(str({ maxLength: 2000 })),
      suffix: opt(str({ maxLength: 2000 })),
    }),
  ),
});
