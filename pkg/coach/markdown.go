package coach

import (
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

// The note grammar, rendered to HTML for the exported ledger.
//
// This is one of TWO implementations (the other is
// frontend/src/match/markdown/render-markdown.ts, for the in-app surfaces).
// They are pinned to identical output by one shared table,
// testdata/markdown_cases.json, which both test suites read. Add a case
// there first, then make both sides pass it.
//
// Everything is escaped BEFORE any markup is produced, so a <script> in a
// note is text on every surface. The output is a fixed vocabulary of tags
// with no attributes except an <ol start>.

// The space set, written out rather than spelled `\s`. Go's `\s` is
// ASCII-only and JavaScript's is Unicode-aware, so a non-breaking space
// pasted out of a word processor would open a heading on one renderer and
// stay literal on the other. Two implementations of one grammar cannot
// disagree about what a space is.
const markdownSpace = " \t\r\n"

func isMarkdownSpace(b byte) bool {
	return strings.IndexByte(markdownSpace, b) >= 0
}

var textEscaper = strings.NewReplacer(
	"&", "&amp;",
	"<", "&lt;",
	">", "&gt;",
	`"`, "&#34;",
	"'", "&#39;",
)

type inlineMarker struct {
	open string
	tags []string
}

// Longest run first: `***bold italic***` must not match as `**` plus a stray
// `*`, which is exactly what the toolbar produces when you bold an italic run.
var inlineMarkers = []inlineMarker{
	{open: "***", tags: []string{"strong", "em"}},
	{open: "**", tags: []string{"strong"}},
	{open: "~~", tags: []string{"del"}},
	{open: "*", tags: []string{"em"}},
}

// closeOf returns the index of the marker closing one opened at from, or -1.
func closeOf(text string, from int, marker string) int {
	for k := from + 1; k+len(marker) <= len(text); k++ {
		if !strings.HasPrefix(text[k:], marker) {
			continue
		}
		// A marker must hug its content: the close cannot follow a space,
		// which is what keeps `ult_economy` and a lone `-5` literal.
		if isMarkdownSpace(text[k-1]) {
			continue
		}
		return k
	}
	return -1
}

func openAt(text string, i int) (inlineMarker, int, bool) {
	for _, marker := range inlineMarkers {
		if !strings.HasPrefix(text[i:], marker.open) {
			continue
		}
		bodyStart := i + len(marker.open)
		if bodyStart < len(text) && isMarkdownSpace(text[bodyStart]) {
			continue
		}
		end := closeOf(text, bodyStart, marker.open)
		if end > bodyStart {
			return marker, end, true
		}
	}
	return inlineMarker{}, 0, false
}

// renderInline applies emphasis to already-escaped text.
//
// A recursive scan rather than one global replace per marker: sequential
// passes emit crossed tags for interleaved markers (`**a *b** c*` came out
// `<strong>a <em>b</strong> c</em>`), and a browser then re-shapes that into
// a DOM neither renderer described. Scanning left to right and recursing into
// each body can only ever produce well-nested output.
func renderInline(escaped string) string {
	var out strings.Builder
	for i := 0; i < len(escaped); {
		marker, end, ok := openAt(escaped, i)
		if !ok {
			out.WriteByte(escaped[i])
			i++
			continue
		}
		body := renderInline(escaped[i+len(marker.open) : end])
		for _, tag := range marker.tags {
			fmt.Fprintf(&out, "<%s>", tag)
		}
		out.WriteString(body)
		for _, v := range slices.Backward(marker.tags) {
			fmt.Fprintf(&out, "</%s>", v)
		}
		i = end + len(marker.open)
	}
	return out.String()
}

var (
	headingRe  = regexp.MustCompile(`^(#{1,2})[ \t]+(.*)$`)
	bulletRe   = regexp.MustCompile(`^[-*][ \t]+(.*)$`)
	numberedRe = regexp.MustCompile(`^([0-9]{1,9})[.)][ \t]+(.*)$`)
)

// Trimmed explicitly for the same reason markdownSpace is spelled out: Go's
// TrimSpace strips U+0085 where JS `trim()` does not, and JS strips a
// byte-order mark where Go does not.
const markdownEdgeSpace = " \t\r"

type blockKind int

const (
	blockParagraph blockKind = iota
	blockHeading
	blockBullets
	blockNumbers
)

type markdownBlock struct {
	kind  blockKind
	level int
	lines []string
	start int
}

// markdownBlocks groups the source into blocks. A blank line always closes
// whatever is open; a heading is its own block; consecutive bullets or
// numbers gather into one list; everything else accumulates into a paragraph
// whose single newlines become soft breaks.
func markdownBlocks(source string) []markdownBlock {
	var blocks []markdownBlock
	var open *markdownBlock
	closeOpen := func() {
		if open != nil {
			blocks = append(blocks, *open)
			open = nil
		}
	}

	for raw := range strings.SplitSeq(strings.ReplaceAll(source, "\r\n", "\n"), "\n") {
		line := strings.Trim(raw, markdownEdgeSpace)
		if line == "" {
			closeOpen()
			continue
		}
		next := classifyLine(line)
		if next.kind == blockHeading {
			closeOpen()
			blocks = append(blocks, next)
			continue
		}
		if open == nil || open.kind != next.kind {
			closeOpen()
			open = &next
			continue
		}
		open.lines = append(open.lines, next.lines...)
	}
	closeOpen()
	return blocks
}

// classifyLine returns what a line starts, carrying that line's content.
func classifyLine(line string) markdownBlock {
	if m := headingRe.FindStringSubmatch(line); m != nil {
		return markdownBlock{kind: blockHeading, level: len(m[1]), lines: []string{m[2]}}
	}
	if m := bulletRe.FindStringSubmatch(line); m != nil {
		return markdownBlock{kind: blockBullets, lines: []string{m[1]}}
	}
	if m := numberedRe.FindStringSubmatch(line); m != nil {
		start, _ := strconv.Atoi(m[1])
		return markdownBlock{kind: blockNumbers, lines: []string{m[2]}, start: start}
	}
	return markdownBlock{kind: blockParagraph, lines: []string{line}}
}

// topHeadingLevel is the note's shallowest heading, which becomes its h3.
//
// Notes render inside a section that already owns an h2, so the top heading
// is an h3 — and a note that only ever uses `##` must still start at h3
// rather than skipping a level, which is what an a11y pass reports. The
// toolbar offers Subheading on its own, so that note is one click away.
func topHeadingLevel(blocks []markdownBlock) int {
	top := 2
	for _, b := range blocks {
		if b.kind == blockHeading && b.level < top {
			top = b.level
		}
	}
	return top
}

func renderBlock(b markdownBlock, topLevel int) string {
	switch b.kind {
	case blockHeading:
		tag := fmt.Sprintf("h%d", 3+b.level-topLevel)
		return fmt.Sprintf("<%s>%s</%s>", tag, renderInline(textEscaper.Replace(b.lines[0])), tag)
	case blockBullets:
		return "<ul>" + renderItems(b.lines) + "</ul>"
	case blockNumbers:
		start := ""
		if b.start != 1 {
			start = fmt.Sprintf(" start=%q", strconv.Itoa(b.start))
		}
		return "<ol" + start + ">" + renderItems(b.lines) + "</ol>"
	default:
		parts := make([]string, 0, len(b.lines))
		for _, line := range b.lines {
			parts = append(parts, renderInline(textEscaper.Replace(line)))
		}
		return "<p>" + strings.Join(parts, "<br>") + "</p>"
	}
}

func renderItems(items []string) string {
	var out strings.Builder
	for _, item := range items {
		out.WriteString("<li>" + renderInline(textEscaper.Replace(item)) + "</li>")
	}
	return out.String()
}

// RenderMarkdown renders a note's markdown to the fixed HTML vocabulary.
func RenderMarkdown(source string) string {
	blocks := markdownBlocks(source)
	topLevel := topHeadingLevel(blocks)
	parts := make([]string, 0, len(blocks))
	for _, b := range blocks {
		parts = append(parts, renderBlock(b, topLevel))
	}
	return strings.Join(parts, "")
}
