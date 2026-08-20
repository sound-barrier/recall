<script setup lang="ts">
import { computed } from 'vue'

import { renderMarkdown } from '@/match/markdown/render-markdown'

// A note's prose, rendered. Every surface that READS a note goes through
// this one component, so `v-html` appears in exactly one file in the app
// and the safety argument is made once: renderMarkdown escapes its input
// before producing any markup and emits a fixed tag vocabulary with no
// attributes but `<ol start>` — there is no path from note text to an
// attribute, a script, or a URL.
const props = defineProps<{ text: string }>()

const html = computed(() => renderMarkdown(props.text))
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- renderMarkdown escapes first and emits a fixed tag set; see the note above -->
  <div class="note-prose" v-html="html" />
</template>

<style scoped>
/* The blocks carry their own rhythm; the container only trims the ends so a
   note sits flush in whatever card holds it. */
.note-prose {
  font-size: inherit;
  line-height: 1.5;
}

.note-prose :deep(> :first-child) { margin-top: 0; }
.note-prose :deep(> :last-child) { margin-bottom: 0; }
.note-prose :deep(p) { margin: 0 0 0.5rem; }

/* A note's "title" is an h3/h4 inside a card that owns the page's h2 — sized
   as emphasis, not as page furniture. */
.note-prose :deep(h3),
.note-prose :deep(h4) {
  margin: 0.55rem 0 0.25rem;
  font-family: inherit;
  font-size: var(--type-lg);
  font-weight: 700;
  letter-spacing: normal;
  text-transform: none;
}

.note-prose :deep(ul),
.note-prose :deep(ol) {
  margin: 0 0 0.5rem;
  padding-left: 1.15rem;
}

.note-prose :deep(li) { margin: 0.1rem 0; }
</style>
