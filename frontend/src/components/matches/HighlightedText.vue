<script lang="ts">
import { computed, defineComponent, h, type PropType } from 'vue'

import { highlightSubstrings } from '@/match-helpers'

// Renders `text` with a <mark class="search-hl"> around every
// case-insensitive occurrence of any `term`. Terms are the already
// lower-cased search values from the narrow query — bare-clause values
// for plain surfaces (map / hero), `highlightTermsFor(field)` for a
// scoped surface (tags). No terms / no hit → the plain text, no marks.
//
// A render function (not a <template>) so adjacent segments carry no
// stray whitespace and the Vue template-formatting lints don't fight
// the whitespace-sensitive output. The `.search-hl` rule lives in
// app.css (a shared, cross-component treatment).
export default defineComponent({
  name: 'HighlightedText',
  props: {
    text: { type: String, required: true },
    terms: { type: Array as PropType<string[]>, required: true },
  },
  setup(props) {
    const segments = computed(() => highlightSubstrings(props.text, props.terms))
    return () =>
      segments.value.map((seg) =>
        seg.hit ? h('mark', { class: 'search-hl' }, seg.text) : seg.text,
      )
  },
})
</script>
