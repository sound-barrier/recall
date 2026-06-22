// Command onnx-rec is a Tier A feasibility spike: run the PaddleOCR PP-OCRv3
// recognition model in-process in Go via onnxruntime_go (CGo) — no Python, no
// sidecar — on the fine-tune spike's held-out OW number crops. It proves the
// distribution mechanics (does onnxruntime-go link + run a PP-OCR model?) and
// the real footprint, with the actual reads as a bonus.
//
// Assets (gitignored) come from the RapidOCR venv:
//
//	spike/onnx/assets/libonnxruntime.dylib
//	spike/onnx/assets/rec.onnx          (ch_PP-OCRv3_rec_infer.onnx)
//	spike/onnx/assets/ppocr_keys.txt    (6623-char dict from the model metadata)
package main

import (
	"bufio"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"os/exec"
	"regexp"
	"strings"

	ort "github.com/yalue/onnxruntime_go"
	"golang.org/x/image/draw"
)

const (
	recH       = 48
	recW       = 320
	recT       = recW / 8 // PP-OCRv3 rec downsamples width by 8 -> 40 timesteps
	numClasses = 6625     // blank + 6623 dict chars + space
	assets     = "spike/onnx/assets"
	evalList   = "spike/finetune/train/list.eval"
	sampleN    = 12
)

var digits = regexp.MustCompile(`\d+`)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run() error {
	dict, err := loadLines(assets + "/ppocr_keys.txt")
	if err != nil {
		return err
	}
	ort.SetSharedLibraryPath(assets + "/libonnxruntime.dylib")
	if err := ort.InitializeEnvironment(); err != nil {
		return err
	}
	defer ort.DestroyEnvironment()

	in, err := ort.NewEmptyTensor[float32](ort.NewShape(1, 3, recH, recW))
	if err != nil {
		return err
	}
	defer in.Destroy()
	out, err := ort.NewEmptyTensor[float32](ort.NewShape(1, recT, numClasses))
	if err != nil {
		return err
	}
	defer out.Destroy()
	session, err := ort.NewAdvancedSession(assets+"/rec.onnx",
		[]string{"x"}, []string{"softmax_5.tmp_0"},
		[]ort.ArbitraryTensor{in}, []ort.ArbitraryTensor{out}, nil)
	if err != nil {
		return err
	}
	defer session.Destroy()

	crops, err := sampleCrops()
	if err != nil {
		return err
	}
	fmt.Printf("%-26s %-8s %-10s %-10s\n", "crop", "gt", "ppocr(go)", "tesseract")
	var okOnnx, okTess int
	for _, c := range crops {
		gt, _ := readFile(c + ".gt.txt")
		gt = strings.TrimSpace(gt)
		img, err := loadImage(c + ".png")
		if err != nil {
			return err
		}
		copy(in.GetData(), preprocess(img))
		if err := session.Run(); err != nil {
			return err
		}
		got := digitsOnly(ctcDecode(out.GetData(), dict))
		tess := digitsOnly(tesseract(c + ".png"))
		if got == gt {
			okOnnx++
		}
		if tess == gt {
			okTess++
		}
		fmt.Printf("%-26s %-8s %-10s %-10s\n", baseName(c), gt, got, tess)
	}
	n := len(crops)
	fmt.Printf("\nexact reads: ppocr(go) %d/%d, tesseract %d/%d\n", okOnnx, n, okTess, n)
	fmt.Println("ships in-process via CGo; footprint = this binary + " +
		"libonnxruntime (~29 MB) + rec.onnx (~11 MB).")
	return nil
}

// preprocess builds the PP-OCR rec input [3,48,320]: resize to height 48 (aspect,
// capped at 320 wide), BGR, normalize (x/255-0.5)/0.5, zero-pad the right.
func preprocess(img image.Image) []float32 {
	b := img.Bounds()
	w := b.Dx() * recH / b.Dy()
	if w > recW {
		w = recW
	}
	if w < 1 {
		w = 1
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, recH))
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, b, draw.Over, nil)

	buf := make([]float32, 3*recH*recW)
	for y := 0; y < recH; y++ {
		for x := 0; x < w; x++ {
			r, g, bl, _ := dst.At(x, y).RGBA()
			for ch, v := range [3]uint32{bl, g, r} { // BGR, matching cv2/PaddleOCR
				buf[ch*recH*recW+y*recW+x] = (float32(v>>8)/255 - 0.5) / 0.5
			}
		}
	}
	return buf
}

// ctcDecode is greedy CTC: argmax per timestep, collapse repeats, drop blank(0).
func ctcDecode(logits []float32, dict []string) string {
	var sb strings.Builder
	prev := -1
	for t := 0; t < recT; t++ {
		best, bestVal := 0, logits[t*numClasses]
		for c := 1; c < numClasses; c++ {
			if v := logits[t*numClasses+c]; v > bestVal {
				best, bestVal = c, v
			}
		}
		if best != 0 && best != prev && best-1 < len(dict) {
			sb.WriteString(dict[best-1])
		}
		prev = best
	}
	return sb.String()
}

func tesseract(path string) string {
	out, _ := exec.Command("tesseract", path, "stdout", "--psm", "7", //nolint:gosec
		"-c", "tessedit_char_whitelist=0123456789").Output()
	return string(out)
}

func digitsOnly(s string) string { return strings.Join(digits.FindAllString(s, -1), "") }

func sampleCrops() ([]string, error) {
	lines, err := loadLines(evalList)
	if err != nil {
		return nil, err
	}
	var crops []string
	for _, l := range lines {
		if l = strings.TrimSpace(l); l != "" {
			crops = append(crops, strings.TrimSuffix(l, ".lstmf"))
		}
		if len(crops) == sampleN {
			break
		}
	}
	return crops, nil
}

func loadImage(path string) (image.Image, error) {
	f, err := os.Open(path) //nolint:gosec
	if err != nil {
		return nil, err
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	return img, err
}

func loadLines(path string) ([]string, error) {
	f, err := os.Open(path) //nolint:gosec
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var lines []string
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1024*1024), 1024*1024)
	for sc.Scan() {
		lines = append(lines, sc.Text())
	}
	return lines, sc.Err()
}

func readFile(path string) (string, error) {
	b, err := os.ReadFile(path) //nolint:gosec
	return string(b), err
}

func baseName(p string) string {
	if i := strings.LastIndexByte(p, '/'); i >= 0 {
		return p[i+1:]
	}
	return p
}
