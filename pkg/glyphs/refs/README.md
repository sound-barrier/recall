# Reference cuts

Pixels the `glyphs` matchers compare screenshots against, embedded in the
binary. Every file is cut by a human from a corpus screenshot, never from
parser output. `glyphs.Load` reads this tree and refuses a PNG outside it:

| Path | Holds |
| --- | --- |
| `digit/<digit>/<name>.png` | one glyph of `<digit>`, 0 to 9, tight or with background margin |

`<name>` is free to `Load`: several cuts of one label (1080p and 1440p, two
screens' fonts) all count, and the best of them scores. Files without a `.png`
extension, this one and `manifest.yaml` included, are skipped.

## Where the cuts come from

`manifest.yaml` is the record: for each cut its kind, label, screen, source
fixture and `[x, y, width, height]` rect, written by a person looking at the
screenshot: a digit's label is the glyph as seen. The PNG files are generated
from it, never edited by hand:
`task cut-references` cuts each rect out of the
[`recall-testdata`](https://github.com/sound-barrier/recall-testdata) corpus
and names it `digit/<digit>/<screen>.png`, then `<screen>-2.png` and so on for
repeat cuts of one digit from one screen, in manifest order.

To add a reference: find the rect (`RECALL_REFS_PROPOSE=<fixture>
RECALL_REFS_REGION=x,y,w,h go test -run TestProposeSegmentation -v
./pkg/glyphs/` prints the glyph boxes the matcher would segment there), view
the cut, label it from the pixels, add the manifest row, run
`task cut-references`. The golden-corpus lane fails when a committed PNG is not
a fresh cut of its rect, and every run reads each cut back as its own label.
