//go:build serveronly

package main

func main() {
	runServer(NewApp())
}
