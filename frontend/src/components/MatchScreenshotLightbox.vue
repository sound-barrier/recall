<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'

// Fullscreen screenshot viewer. Opened by clicking the inline
// preview img in MatchCardExpanded's sources block; closes via
// the × button (top-left), the Escape key, or a click on the
// backdrop around the image.
//
// Stacks above the detail panel via z-index. While open the panel
// underneath becomes `inert` (App.vue wires the prop) so Tab
// can't reach panel controls and clicks fall through to the
// lightbox backdrop, not panel UI.
//
// Escape handling uses a capture-phase document listener so it
// fires BEFORE useModalFocusTrap's bubble-phase Escape on the
// detail panel — without that order, a single Esc would close
// both modals at once.

const props = defineProps<{
  // Filename of the screenshot being viewed; null = closed.
  filename: string | null
  // Pre-computed src URL (App.vue's screenshotURL helper). null
  // when filename is null.
  src: string | null
}>()

const emit = defineEmits<{ close: [] }>()

const closeBtnRef = ref<HTMLButtonElement | null>(null)
const lastFocus = ref<HTMLElement | null>(null)

function onKeydown(e: KeyboardEvent) {
  if (props.filename == null) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopImmediatePropagation()
    emit('close')
  }
}

watch(
  () => props.filename,
  async (next, prev) => {
    if (next != null && prev == null) {
      lastFocus.value =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      // Capture phase wins over the panel's bubble-phase Escape
      // handlers, so the lightbox absorbs Esc before the panel can
      // see it. Without capture, both modals would close on a
      // single press.
      document.addEventListener('keydown', onKeydown, true)
      await nextTick()
      closeBtnRef.value?.focus()
    } else if (next == null && prev != null) {
      document.removeEventListener('keydown', onKeydown, true)
      await nextTick()
      lastFocus.value?.focus()
      lastFocus.value = null
    }
  },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, true)
})

function onBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) emit('close')
}
</script>

<template>
  <transition name="lightbox-fade">
    <div
      v-if="filename && src"
      class="lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      :aria-label="`Screenshot preview: ${filename}`"
      @click="onBackdropClick"
    >
      <button
        ref="closeBtnRef"
        type="button"
        class="lightbox-close"
        title="Close (Esc)"
        aria-label="Close screenshot preview"
        @click="emit('close')"
      >
        <span aria-hidden="true">×</span>
      </button>
      <img :src="src" :alt="filename" class="lightbox-img">
    </div>
  </transition>
</template>

<style scoped>
.lightbox-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgb(0 0 0 / 92%);
  display: grid;
  place-items: center;
  padding: 1.5rem;
  cursor: zoom-out;
}

.lightbox-close {
  position: absolute;
  top: 0.8rem;
  left: 0.8rem;
  width: 2.4rem;
  height: 2.4rem;
  background: rgb(0 0 0 / 65%);
  border: 1px solid var(--border);
  color: var(--text);
  font-family: var(--mono);
  font-size: 1.4rem;
  line-height: 1;
  cursor: pointer;
  display: grid;
  place-items: center;
  border-radius: 4px;
  transition: background 160ms ease, color 160ms ease, border-color 160ms ease;
}

.lightbox-close:hover {
  background: var(--accent-soft);
  color: var(--accent-bright, var(--accent));
  border-color: var(--accent);
}

.lightbox-close:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.lightbox-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  box-shadow: 0 8px 32px rgb(0 0 0 / 50%);
  cursor: default;
}

.lightbox-fade-enter-active,
.lightbox-fade-leave-active {
  transition: opacity 180ms ease;
}

.lightbox-fade-enter-from,
.lightbox-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .lightbox-fade-enter-active,
  .lightbox-fade-leave-active {
    transition: none;
  }
}
</style>
