package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"OWMetrics/backend/db"
)

type Item struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Data string `json:"data"`
}

// App struct
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	dataDir, err := os.UserConfigDir()
	if err != nil {
		log.Fatal("could not find config dir:", err)
	}
	appDir := filepath.Join(dataDir, "OWMetrics")
	if err := os.MkdirAll(appDir, 0700); err != nil {
		log.Fatal("could not create app dir:", err)
	}
	if err := db.Init(filepath.Join(appDir, "owmetrics.db")); err != nil {
		log.Fatal("could not init db:", err)
	}
}

// Greet returns a greeting for the given name
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}

func (a *App) GetItems() ([]Item, error) {
	rows, err := db.DB.Query(`SELECT id, name, data FROM items ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []Item
	for rows.Next() {
		var it Item
		if err := rows.Scan(&it.ID, &it.Name, &it.Data); err != nil {
			return nil, err
		}
		items = append(items, it)
	}
	return items, rows.Err()
}

func (a *App) SaveItem(name string, data string) error {
	_, err := db.DB.Exec(`INSERT INTO items (name, data) VALUES (?, ?)`, name, data)
	return err
}
