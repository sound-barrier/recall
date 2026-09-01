<script setup lang="ts">
import { computed } from 'vue'

import { renderInlineMarkdown, renderMarkdown, renderMarkdownWithHits } from '@/match/markdown/render-markdown'

// A note's prose, rendered. Every surface that READS a note goes through
// this one component, so `v-html` appears in exactly one file in the app
// and the safety argument is made once: renderMarkdown escapes its input
// before producing any markup and emits a fixed tag vocabulary with no
// attributes but `<ol start>` — there is no path from note text to an
// attribute, a script, or a URL — and the highlighting path escapes through
// the same helper, so a search term cannot open one either.
//
// The prose styling lives in styles/note-prose.css rather than a scoped block
// here, because the WYSIWYG editor wears the same class: the surface you write
// on and the surface you read back have to paint identically, and sharing one
// sheet is how that stays true without anyone remembering to keep it true.
const props = defineProps<{
  text: string
  /** Search terms to light, if the surface showing this note has a search. */
  highlight?: readonly string[]
  /**
   * A CAPTION rather than prose — a moment beside its clock, a focus item
   * beside its bullet. Same grammar and same escaping, but inline only: a
   * caption must not grow a paragraph, a heading, or a list. Captions carry
   * no search highlighting today, so the two options do not combine.
   */
  inline?: boolean
}>()

const html = computed(() => {
  if (props.inline) return renderInlineMarkdown(props.text)
  return props.highlight?.length
    ? renderMarkdownWithHits(props.text, props.highlight)
    : renderMarkdown(props.text)
})
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- renderMarkdown escapes first and emits a fixed tag set; see the note above -->
  <span v-if="inline" class="note-inline" v-html="html" />
  <!-- eslint-disable-next-line vue/no-v-html -- same escaper, same fixed tag set -->
  <div v-else class="note-prose" v-html="html" />
</template>
