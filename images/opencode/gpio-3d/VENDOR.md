# gpio-3d vendored copy

Vendored from the gpio-companion monorepo (`native/gpio-3d`), lock date 2026-10-08.
Upstream lives at `/home/shpaw415/gpio-companion/native/gpio-3d` and is documented in
OpenViking (`viking://resources/gpio-companion/s04-gpio-3d.md`). This copy is not
built from the gpio-companion repo; syncs are manual. The 2026-10-08 sync brought
the improvement-report batch: text `face`/`valign`, air-cut and enclosed-void
warnings, the named recipe library (`.gpio-3d/`, `--save`/`--patch`/`build last`),
the `inspect` subcommand, and bbox on every write.

## Divergence from upstream

- `constants.FITS` also accepts `custom` so parts unrelated to the 2.54 mm
  companion/Arduino headers can declare `fits: ["custom"]` (open-bot has no
  companion hardware). `export.part_fits` error strings updated to match.
- The gpio-companion update/venv install scripts (`install_gpio_3d`) are not
  vendored; the Dockerfile creates the venv and wrapper directly.

Everything else (mesh, recipe, text, export, CLI) is byte-identical to upstream
at lock date. When syncing a new upstream revision, re-apply the `custom` fits
patch and update the lock date here.
