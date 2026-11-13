# lhallee.github.io

The source of [lhallee.github.io](https://lhallee.github.io/), Logan Hallee's personal site. It covers research, open source software, Synthyra, the Minds and Molecules essays, and academic work.

## Layout

- `index.html` is the whole site. It is plain HTML with no build step and no dependencies beyond Google Fonts.
- `assets/css/site.css` holds the styles. The site is dark only, and the color tokens sit at the top of the file.
- `assets/js/site.js` draws every visual from code. That covers the map of the human proteome in the hero, the small visual beside each research thread, the turning structure in the Design thread, the map of E. coli against the human cell in the Synthyra section, the sketch beside the essays, and the filter on the Academic work list.
- `assets/data/universe_human.js` holds the hero's map, which is a three-dimensional layout of the 19,226 proteins of the human proteome by predicted interactions, the tree that joins them, and each protein's cluster.
- `assets/data/complex_1yy9.js` holds the C-alpha trace of PDB 1YY9, the EGFR extracellular domain bound by the cetuximab Fab.
- `assets/data/interactome_ecoli_human.js` holds the Atlas map of E. coli K-12 against the human cell, which is each protein's position in its cell, a sample of the contacts inside each cell, the top-scored contacts between the two cell membranes, and the trees of contacts that the moving signals follow. The page draws no contact until a signal runs along it, and the Show contacts button draws them all.
- `assets/logan_hallee_cv.pdf` is the CV that the site and the GitHub profile link to.
- `assets/img/` holds the portrait and the favicon. The page carries no figures by design.
- `tools/` holds the scripts that generate files, described under Updating.
- `_config.yml` keeps this file and `tools/` out of the published site. The Pages workflow in `.github/workflows/` copies everything else as it is.

The stylesheet and the script also carry the styles and the starfield for an essay page. That page returns as `vision.html` once the essay is finished.

## Keeping it fast and aligned

- Every animation stops when it leaves the screen or the tab is hidden, and turns at a rate set in seconds, so it looks the same at any frame rate.
- The hero is drawn with WebGL and falls back to the 2D canvas. The other drawings batch their marks by depth and color, so a frame makes a few dozen draw calls. Keep a new drawing under about 2 ms of script a frame on a fast machine.
- A canvas is cleared one unit past each edge. On a screen scaled to 150 percent, a clear that stops at the layout size leaves the last row and column of pixels untouched, and they collect color.
- Cards that sit in a row share their rows through CSS subgrid, so names, text, numbers, and links line up across the row. The invited talks are one grid, so every card has the same width and height.
- The live map from synthyra.com is framed at the layout its page needs and scaled down to the stage by `initLiveMap`, because that page is built for a full window.

## Preview

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/`.

## Updating

- **After any change under `assets/`.** Run `python tools/stamp_assets.py`. It stamps each stylesheet and script link in `index.html` with a hash of its file, so a browser that still holds the old file fetches the new one. Without the stamp a reload can keep showing the old script for an hour or more.
- **A new essay on Substack.** Copy one `<li>` in the `essays` list in the Writing section of `index.html`, newest first, and use the post's own title and subtitle. The `data-art` attribute names the sketch shown beside the list while that essay is in focus. Reuse one of the sketches in `initEssayArt` in `assets/js/site.js`, or add a new one there and name it in `makers`. The sketches carry no caption.
- **A new paper, talk, poster, or abstract.** Copy one `<li>` in the `academic-list` list, newest first. Set `data-kind` to `publication`, `preprint`, `talk` (which also covers posters), or `abstract`, because the filter buttons read it. Author lists follow the source, with `<b>Hallee L</b>` in bold.
- **A new invited talk.** Copy one `<div class="talk">` in the block under the list. A talk with public materials is an `<a class="talk">` that links to them, as the workshop card does.
- **A new CV.** Replace `assets/logan_hallee_cv.pdf` and keep the file name, because the GitHub profile links to it.
- **A new record or download count.** The SpeedrunningPLMs and rule30-open numbers come from those repositories' READMEs, and the download counts come from the Hugging Face API, so update them from there.
- **The hero.** The map comes from the human map of the Synteract paper, a folder that holds `knn.npz`, `layout.npz`, `clusters.csv`, and `summary.json`. That folder is not in this repository. The script needs Python with NumPy, SciPy, and umap-learn, and the caption in `index.html` repeats its protein and cluster counts.

```bash
python tools/build_universe.py MAP_FOLDER assets/data/universe_human.js
```

- **The structure.** Download a PDB file from the RCSB and run the script, which needs Python with NumPy.

```bash
python tools/build_structure.py 1YY9.pdb assets/data/complex_1yy9.js
```

- **The map.** Save two of Synthyra's public pages, the [E. coli cell](https://synthyra.com/atlas/tmap/model-organisms/escherichia-coli-k12/swissbiopics.html) and the [E. coli proteins against the human cell](https://synthyra.com/atlas/tmap/inter-actomes/escherichia-coli-k12-homo-sapiens/swissbiopics_ecoli_human_inter.html), and run the script on the saved files. It needs Python with NumPy, and it prints the number of contacts drawn, which the figure caption in `index.html` repeats.

```bash
python tools/build_interactome.py ecoli_cell.html ecoli_human_inter.html assets/data/interactome_ecoli_human.js
```

- **The profile banner.** The script draws a sketch of protein space as a still SVG for the `lhallee/lhallee` repository. The sketch comes from a seeded generator and not from data, and the banner says so.

```bash
python tools/build_banner.py ../lhallee/assets/banner.svg
```

Every number on the site comes from a paper, a public repository, or a public data page, and its source is linked beside the claim. Keep it that way.
