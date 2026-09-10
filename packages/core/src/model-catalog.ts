export type ModelCatalogQuery = {
  provider: string;
  search?: string;
  offset?: number;
  limit?: number;
  revision?: number;
};
export type ModelCatalogPage = {
  provider: string;
  revision: number;
  refreshing: boolean;
  checkedAt: number | null;
  errorCode: string | null;
  models: Array<{
    id: string; name: string; reasoning: boolean;
    input: Array<"text" | "image">;
    contextWindow: number; maxOutputTokens: number;
  }>;
  total: number;
  offset: number;
  nextOffset: number | null;
};
