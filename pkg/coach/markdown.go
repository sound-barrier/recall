package coach

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// The note grammar, rendered to HTML for the exported ledger.
//
// A note is prose a player or a coach typed, so the grammar is exactly what
// the note toolbar can write and nothing else: paragraphs, two heading
// levels, bulleted and numbered lists, bold, italic, strikethrough. No
// links, no images, no tables, no raw HTML.
//
// This is one of TWO implementations (the other is
// frontend/src/match/markdown/render-markdown.ts, for every in-app reading
// surface). They are pinned to identical output by one shared table,
// testdata/markdown_cases.json, which both test suites read. Add a case
// there first, then make both sides pass it.
//
// Everything is escaped BEFORE any markup is produced, and the output is a
// fixed vocabulary of tags with no attributes except an <ol start> — so the
// result is safe to drop into the ledger template as template.HTML without
// a sanitizer standing behind it.

var (
	headingRe  = regexp.MustCompile(`^(#{1,2})\s+(.*)$`)
	bulletRe   = regexp.MustCompile(`^[-*]\s+(.*)$`)
	numberedRe = regexp.MustCompile(`^(\d{1,9})[.)]\s+(.*)$`)

	// Longest marker first so **bold** never matches as two italics. The
	// \S anchors are what keep ult_economy and a lone -5 literal: a marker
	// must hug its content.
	inlineRules = []struct {
		re  *regexp.Regexp
		tag string
	}{
		{regexp.MustCompile(`\*\*(\S(?:(?s).*?\S)?)\*\*`), "strong"},
		{regexp.MustCompile(`~~(\S(?:(?s).*?\S)?)~~`), "del"},
		{regexp.MustCompile(`\*(\S(?:(?s).*?\S)?)\*`), "em"},
	}
)

// escapeText mirrors the TS side's escape set exactly — including the
// numeric entities for quotes, which is what Go's html/template also emits.
var textEscaper = strings.NewReplacer(
	"&", "&amp;",
	"<", "&lt;",
	">", "&gt;",
	`"`, "&#34;",
	"'", "&#39;",
)

func escapeText(raw string) string { return textEscaper.Replace(raw) }

func renderInline(escaped string) string {
	out := escaped
	for _, rule := range inlineRules {
		out = rule.re.ReplaceAllString(out, "<"+rule.tag+">$1</"+rule.tag+">")
	}
	return out
}

type blockKind int

const (
	blockParagraph blockKind = iota
	blockHeading
	blockBullets
	blockNumbers
)

type mdBlock struct {
	kind  blockKind
	level int      // heading level, 1 or 2
	start int      // numbered-list first number
	lines []string // paragraph lines or list items or the heading's text
}

// RenderMarkdown renders a note's markdown to the fixed HTML vocabulary.
func RenderMarkdown(source string) string {
	var out strings.Builder
	for _, b := range markdownBlocks(source) {
		out.WriteString(renderBlock(b))
	}
	return out.String()
}

// markdownBlocks groups the source. A blank line always closes whatever is
// open; a heading is its own block; consecutive bullets or numbers gather
// into one list; everything else accumulates into a paragraph whose single
// newlines become soft breaks.
func markdownBlocks(source string) []mdBlock {
	var blocks []mdBlock
	var open *mdBlock
	closeOpen := func() {
		if open != nil {
			blocks = append(blocks, *open)
			open = nil
		}
	}
	for raw := range strings.SplitSeq(strings.ReplaceAll(source, "\r\n", "\n"), "\n") {
		line := strings.TrimSpace(raw)
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
		// Same kind as what is open → the line joins it; otherwise it starts one.
		if open == nil || open.kind != next.kind {
			closeOpen()
			fresh := next
			open = &fresh
			continue
		}
		open.lines = append(open.lines, next.lines[0])
	}
	closeOpen()
	return blocks
}

// classifyLine reports what a line starts, as a fresh block carrying that
// line's content. Mirrors classify() in render-markdown.ts.
func classifyLine(line string) mdBlock {
	if m := headingRe.FindStringSubmatch(line); m != nil {
		return mdBlock{kind: blockHeading, level: len(m[1]), lines: []string{m[2]}}
	}
	if m := bulletRe.FindStringSubmatch(line); m != nil {
		return mdBlock{kind: blockBullets, lines: []string{m[1]}}
	}
	if m := numberedRe.FindStringSubmatch(line); m != nil {
		start, _ := strconv.Atoi(m[1])
		return mdBlock{kind: blockNumbers, start: start, lines: []string{m[2]}}
	}
	return mdBlock{kind: blockParagraph, lines: []string{line}}
}

func renderBlock(b mdBlock) string {
	switch b.kind {
	case blockParagraph:
		parts := make([]string, 0, len(b.lines))
		for _, l := range b.lines {
			parts = append(parts, renderInline(escapeText(l)))
		}
		return "<p>" + strings.Join(parts, "<br>") + "</p>"
	case blockHeading:
		// A note's "title" is an h3: these render inside a card that already
		// owns the page's h2, so starting at h1 would break heading order.
		tag := fmt.Sprintf("h%d", b.level+2)
		return "<" + tag + ">" + renderInline(escapeText(b.lines[0])) + "</" + tag + ">"
	case blockBullets:
		return "<ul>" + renderItems(b.lines) + "</ul>"
	case blockNumbers:
		start := ""
		if b.start != 1 {
			start = fmt.Sprintf(" start=%q", strconv.Itoa(b.start))
		}
		return "<ol" + start + ">" + renderItems(b.lines) + "</ol>"
	}
	return ""
}

func renderItems(items []string) string {
	var out strings.Builder
	for _, it := range items {
		out.WriteString("<li>" + renderInline(escapeText(it)) + "</li>")
	}
	return out.String()
}
