"""Build the data behind the hero: the human proteome arranged by predicted interactions.

The input is the human map of the Synteract paper, a folder that holds, for the 19,226 proteins
of STRING's human proteome,

    knn.npz       each protein's 20 nearest others under the distance 1 - P, where P is the
                  model's probability that the two proteins interact
    layout.npz    the minimum spanning tree of that neighbor graph (arrays s and t)
    clusters.csv  each protein's cluster, from k-means on its row of P
    summary.json  the order that sets similar clusters side by side

The script lays the neighbor graph out in three dimensions with UMAP, keeps the tree as the
branches to draw, and orders the proteins outward from the middle of the tree so that the page
can grow the drawing along its branches. Three choices serve the drawing and not the data. UMAP
sets a few islands far from the rest, at distances that carry no meaning, and each one is moved
next to the main body without changing its shape, so the whole map fits the frame at a readable
size. The map is turned so that its longest axis stands upright, which suits a frame that is
taller than it is wide. The page leaves the longest tenth of the branches undrawn, because they
cross the cloud. It needs NumPy, SciPy, and umap-learn.

Usage:

    python tools/build_universe.py MAP_FOLDER assets/data/universe_human.js
"""

import base64
import csv
import json
import pathlib
import sys
from collections import deque

import numpy as np
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree
from umap.umap_ import find_ab_params, fuzzy_simplicial_set, simplicial_set_embedding


# One legend label for each cluster, as the paper's figure names them.
LABELS = {
    5: "Transcription activation",
    13: "Zinc-finger transcription factors",
    7: "Microtubule cytoskeleton",
    11: "Innate and antiviral defense",
    15: "Ubiquitin-like conjugation",
    0: "Vesicle and protein transport",
    8: "Actin cytoskeleton and junctions",
    3: "Secreted immune mediators",
    12: "Extracellular matrix",
    2: "Ion channels and transporters",
    14: "GPCRs and olfactory receptors",
    4: "mRNA processing",
    1: "Translation and ncRNA",
    9: "Glycoprotein biosynthesis",
    6: "Lipid metabolism",
    10: "Small-molecule metabolism",
}
NEIGHBORS = 15
MIN_DIST = 0.08
SEED = 7
EPOCHS = 400
LONG = 90.0  # branches longer than this percentile of branch length join far regions and are not drawn
UNIT = 30000
# Both are shares of the median distance from the middle. Points nearer than LINK belong to one
# body, and an island apart from the main body is moved until GAP separates the two.
LINK, GAP = 0.2, 0.2


def encode(values: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(values).tobytes()).decode("ascii")


def layout(indices: np.ndarray, distances: np.ndarray) -> np.ndarray:
    """Lay the neighbor graph out in three dimensions and return centered coordinates."""
    count = len(indices)
    random_state = np.random.RandomState(SEED)
    # UMAP's two steps are called directly, because they take the neighbors as given. The graph is
    # connected, so the placeholder for the vectors behind the neighbors is never read.
    placeholder = np.zeros((count, 1), dtype=np.float32)
    graph, _, _ = fuzzy_simplicial_set(
        placeholder,
        NEIGHBORS,
        random_state,
        "precomputed",
        knn_indices=indices[:, :NEIGHBORS],
        knn_dists=distances[:, :NEIGHBORS],
    )
    a, b = find_ab_params(1.0, MIN_DIST)
    embedding, _ = simplicial_set_embedding(
        placeholder, graph, 3, 1.0, a, b, 1.0, 5, EPOCHS, "spectral", random_state, "euclidean", {}, False, {}, False
    )
    points = gather(np.asarray(embedding, dtype=np.float64))  # (count, 3)
    # The longest axis of the map becomes the page's vertical axis, the one the drawing turns about.
    points -= points.mean(0)
    _, _, axes = np.linalg.svd(points, full_matrices=False)  # (3, 3), longest axis first
    points = points @ axes[[1, 0, 2]].T
    return points - middle(points)


def gather(points: np.ndarray) -> np.ndarray:
    """Move each island that sits apart from the main body to just beside it, shape unchanged."""
    points = points - np.median(points, axis=0)
    size = np.median(np.linalg.norm(points, axis=1))
    tree = cKDTree(points)
    graph = tree.sparse_distance_matrix(tree, LINK * size, output_type="coo_matrix")
    count, label = connected_components(graph, directed=False)
    main = int(np.argmax(np.bincount(label)))
    body = cKDTree(points[label == main])
    moved = points.copy()
    for name in range(count):
        if name == main:
            continue
        rows = np.flatnonzero(label == name)
        center = points[rows].mean(0)
        far = np.linalg.norm(center)
        # The island slides toward the middle. The gap shrinks as it goes, so bisection finds the stop.
        low, high = 0.0, far
        for _ in range(40):
            step = (low + high) / 2
            gap = body.query(points[rows] - center / far * step)[0].min()
            low, high = (step, high) if gap > GAP * size else (low, step)
        moved[rows] = points[rows] - center / far * low
    return moved


def middle(points: np.ndarray) -> np.ndarray:
    """Approximate the center of the smallest ball that holds every point."""
    center = points.mean(0)
    for step in range(1, 2001):
        farthest = points[np.argmax(np.linalg.norm(points - center, axis=1))]
        center = center + (farthest - center) / (step + 1)
    return center


def outward(count: int, s: np.ndarray, t: np.ndarray, points: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Walk the tree breadth first from the protein nearest the middle.

    Returns the proteins in the order reached and, for each protein, the protein it was reached from.
    """
    neighbors: list[list[int]] = [[] for _ in range(count)]
    for a, b in zip(s.tolist(), t.tolist()):
        neighbors[a].append(b)
        neighbors[b].append(a)
    root = int(np.argmin(np.linalg.norm(points, axis=1)))
    parent = np.full(count, -1, dtype=np.int64)
    order = [root]
    parent[root] = root
    queue = deque([root])
    while queue:
        node = queue.popleft()
        for other in neighbors[node]:
            if parent[other] < 0:
                parent[other] = node
                order.append(other)
                queue.append(other)
    assert len(order) == count, "the branches do not form one tree"
    return np.array(order), parent


def main(folder: str, out_path: str) -> None:
    root = pathlib.Path(folder)
    knn = np.load(root / "knn.npz")
    tree = np.load(root / "layout.npz")
    with open(root / "clusters.csv", newline="", encoding="utf-8") as handle:
        clusters = np.array([int(row["cluster"]) for row in csv.DictReader(handle)])  # (count,)
    count = len(clusters)
    assert knn["indices"].shape[0] == count and len(tree["s"]) == count - 1 and count < 65536
    assert set(clusters.tolist()) == set(LABELS)

    points = layout(knn["indices"], knn["distances"])  # (count, 3)
    order, parent = outward(count, tree["s"], tree["t"], points)
    rank = np.empty(count, dtype=np.int64)
    rank[order] = np.arange(count)

    scale = UNIT / np.linalg.norm(points, axis=1).max()
    local = np.clip(np.round(points[order] * scale), -32767, 32767).astype("<i2")  # (count, 3), in drawing order
    lengths = np.linalg.norm(points[order] - points[parent[order]], axis=1) * scale / UNIT  # (count,)
    names = sorted(LABELS)
    # The paper orders the clusters so that similar ones sit side by side, and the page colors them in that order.
    cluster_order = json.loads((root / "summary.json").read_text(encoding="utf-8"))["cluster_order"]
    assert sorted(cluster_order) == names
    data = {
        "source": "The human map of the Synteract paper",
        "count": count,
        "unit": UNIT,
        "labels": [LABELS[name] for name in names],
        "order": [cluster_order.index(name) for name in names],
        "longest": round(float(np.percentile(lengths, LONG)), 4),
        "points": encode(local),
        "parent": encode(rank[parent[order]].astype("<u2")),
        "cluster": encode(np.searchsorted(names, clusters[order]).astype("u1")),
    }
    note = (
        "/* The human proteome arranged by predicted interactions: a three-dimensional layout of each "
        "protein's nearest neighbors, the tree that joins them, and each protein's cluster. Positions are "
        "int16 with `unit` at the edge of the drawing, in the order the tree is drawn. Generated by "
        "tools/build_universe.py. */\n"
    )
    text = note + "window.UNIVERSE = " + json.dumps(data, separators=(",", ":")) + ";\n"
    pathlib.Path(out_path).write_text(text, encoding="utf-8", newline="\n")
    print(
        f"{count} proteins, {len(names)} clusters, branch length median {np.median(lengths):.4f} "
        f"and 99th percentile {np.percentile(lengths, 99):.4f} of the drawing's radius, {len(text) / 1024:.0f} KB"
    )


if __name__ == "__main__":
    assert len(sys.argv) == 3, __doc__
    main(sys.argv[1], sys.argv[2])
