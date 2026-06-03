import { computed, type ComputedRef, type Ref } from 'vue'

import { parseSearchQuery, type SearchClause } from '../search-query'

// Tiny wrapper around `parseSearchQuery` that turns a reactive search-
// text source into a reactive parsed-clauses computed. Extracted from
// `useMatchFilters` (since-deleted) so the detail-panel hit-
// highlighter has a focused dependency — no whole-corpus filter
// machinery just to parse one ref.
//
// The narrow panel's `searchText` ref is the canonical source today;
// past iterations had a separate `matchQuery` ref that was bridge-
// synced. Folding both into one source is what the parent
// composable's tear-down enabled.

export interface SearchClausesApi {
  searchClauses: ComputedRef<SearchClause[]>
}

export function useSearchClauses(source: Readonly<Ref<string>>): SearchClausesApi {
  const searchClauses = computed(() => parseSearchQuery(source.value))
  return { searchClauses }
}
