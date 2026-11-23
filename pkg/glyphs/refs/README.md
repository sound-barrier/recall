# Reference cuts

Pixels the `glyphs` matchers compare screenshots against, embedded in the
binary. Every file is cut by a human from a corpus screenshot, never from
parser output. `glyphs.Load` reads this tree and refuses a PNG outside it:

| Path | Holds |
| --- | --- |
| `digit/<digit>/<name>.png` | one glyph of `<digit>`, 0 to 9, tight or with background margin |

`<name>` is free: several cuts of one label (1080p and 1440p, two screens'
fonts) all count, and the best of them scores. Files without a `.png`
extension, this one included, are skipped.
