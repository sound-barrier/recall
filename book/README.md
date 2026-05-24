# Recall — Documentation

Recall watches a folder of Overwatch screenshots, OCRs them with Tesseract,
and turns them into a personal match history you can browse, filter, and
chart. It's a Wails desktop app on macOS, Linux, and Windows; the same
binary also runs headless if you'd rather use it from a browser.

This is the user documentation. The chapters cover:

- **Installation** — getting Recall onto your machine, per platform.
- **Advanced usage** — running headless, deploying via Docker, and wiring
  the bundled Prometheus + Grafana stack for time-series charts.

For developers, see the [GitHub repository](https://github.com/sound-barrier/recall)
— `CONTRIBUTING.md` covers the build and the commit-message rules,
`RELEASES.md` covers the release workflow.

For the HTTP API surface (the routes the desktop app and the headless
server both speak), see the [API reference (Swagger UI)](/recall/api/).
