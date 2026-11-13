"""Build the data behind the site's map of E. coli K-12 against the human cell.

The map draws two cells from Synthyra's public Atlas pages. Each protein sits where the
page puts it, inside its compartment. The drawing then adds the predicted contacts between
a bacterial membrane protein and a human membrane protein, and it moves the membrane proteins
that take part to the two sides that face each other, so that every contact crosses only the
gap between the cells. A move is a swap with the membrane protein that held that place, so
each protein stays in its own compartment. Secreted proteins are left out.

The data also holds the contacts that the page animates as moving signals. In each cell a tree
of the page's own contacts grows inward from every facing membrane protein, each protein taking
its best-scored partners off the membrane that no other branch has claimed. A signal climbs one
E. coli tree to its membrane protein, crosses the gap, and runs down the human trees it lands on.

Inputs, saved from synthyra.com:

    ECOLI_PAGE  https://synthyra.com/atlas/tmap/model-organisms/escherichia-coli-k12/swissbiopics.html
    INTER_PAGE  https://synthyra.com/atlas/tmap/inter-actomes/escherichia-coli-k12-homo-sapiens/swissbiopics_ecoli_human_inter.html

Usage:

    python tools/build_interactome.py ECOLI_PAGE INTER_PAGE assets/data/interactome_ecoli_human.js
"""

import base64
import json
import pathlib
import re
import sys

import numpy as np


ECOLI_URL = "https://synthyra.com/atlas/tmap/model-organisms/escherichia-coli-k12/swissbiopics.html"
INTER_URL = (
    "https://synthyra.com/atlas/tmap/inter-actomes/escherichia-coli-k12-homo-sapiens/"
    "swissbiopics_ecoli_human_inter.html"
)
MEMBRANE = "Cell membrane"
SECRETED = "Secreted"
SCORE_FLOOR = 99  # contacts are scored 0 to 100, and the page keeps those at 90 or higher
GATES = {"ecoli": 90, "human": 130}  # membrane proteins drawn on each facing side
INTRA_KEPT = {"ecoli": 380, "human": 1500}  # contacts drawn inside each cell
INTRA_REACH = {"ecoli": 0.07, "human": 0.045}  # longest such contact, as a share of the cell's size
INTRA_DEGREE = 3  # most threads drawn at any one protein
FLOW_FAN = {"ecoli": (3, 2, 2), "human": (3, 2, 2, 2)}  # partners a protein passes a signal to, by depth
# The longest contact a signal follows at each depth, as a share of the cell's size. The first step
# leaves the membrane for a compartment inside, so it reaches farther than the steps after it.
FLOW_REACH = {"ecoli": (0.4, 0.2, 0.2), "human": (0.5, 0.14, 0.14, 0.14)}
FACING_SHARE = 0.3  # E. coli: how far past the cell's middle a membrane place must sit
FACING_ANGLE = 58.0  # human: half-width in degrees of the membrane arc that faces E. coli
ORDER_STARTS = 24
ORDER_SWEEPS = 40
UNIT = 32000


def payload(html: str, name: str) -> dict:
    found = re.search(rf'<script id="{name}" type="application/json">(.*?)</script>', html, re.S)
    assert found is not None, f"no {name} payload in the page"
    return json.loads(found.group(1))


def decode(text: str, dtype: str) -> np.ndarray:
    return np.frombuffer(base64.b64decode(text), dtype=dtype)


def encode(values: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(values).tobytes()).decode("ascii")


def cell(atlas: dict) -> dict:
    """Read one cell page: positions, compartments, and the page's own contacts."""
    count = atlas["nodeCount"]
    points = decode(atlas["arrays"]["xyU16"], "<u2").reshape(-1, 2).astype(np.float64) / 65535  # (nodes, 2)
    terms = decode(atlas["arrays"]["termsU16"], "<u2").astype(np.int64)  # (nodes,)
    pairs = decode(atlas["arrays"]["ppiEdgesU32"], "<u4").reshape(-1, 2).astype(np.int64)  # (contacts, 2)
    scores = decode(atlas["arrays"]["ppiScoresU8"], "u1").astype(np.int64)  # (contacts,)
    labels = [region["label"] for region in atlas["regions"]]
    assert len(points) == len(terms) == count and len(pairs) == len(scores)
    assert pairs.max() < count and terms.max() < len(labels)
    assert MEMBRANE in labels and SECRETED in labels
    return {
        "name": atlas["organismName"],
        "count": count,
        "labels": labels,
        "points": points,
        "terms": terms,
        "pairs": pairs,
        "scores": scores,
        "accessions": atlas["proteinMetadata"]["accessions"],
    }


def membrane_contacts(inter: dict, ecoli: dict, human: dict) -> np.ndarray:
    """List (E. coli row, human row, score) for contacts with both proteins in a cell membrane."""
    row = {accession: index for index, accession in enumerate(ecoli["accessions"])}
    e_membrane = ecoli["labels"].index(MEMBRANE)
    h_membrane = human["labels"].index(MEMBRANE)
    found = []
    for protein in inter["foreignProteins"]:
        source = row[protein["accession"]]
        if ecoli["terms"][source] != e_membrane:
            continue
        for target, score in protein["targets"]:
            if human["terms"][target] == h_membrane:
                found.append((source, target, score))
    return np.array(found, dtype=np.int64)  # (contacts, 3)


def busiest(values: np.ndarray, kept: int) -> np.ndarray:
    """Return the `kept` most frequent values, ties broken by the smaller value."""
    names, counts = np.unique(values, return_counts=True)
    order = np.lexsort((names, -counts))
    return names[order[:kept]]


def choose(contacts: np.ndarray) -> np.ndarray:
    """Keep the top-scored contacts among the most connected membrane proteins of each cell."""
    top = contacts[contacts[:, 2] >= SCORE_FLOOR]  # (top, 3)
    humans = busiest(top[:, 1], GATES["human"])
    top = top[np.isin(top[:, 1], humans)]
    bacteria = busiest(top[:, 0], GATES["ecoli"])
    top = top[np.isin(top[:, 0], bacteria)]
    return top


def ranks(values: np.ndarray) -> np.ndarray:
    out = np.empty(len(values))
    out[np.argsort(values, kind="stable")] = np.arange(len(values))
    return out / max(1, len(values) - 1)


def order(links: np.ndarray, left_count: int, right_count: int) -> tuple[np.ndarray, np.ndarray, float]:
    """Order both sides so that linked proteins sit at similar heights.

    Each sweep moves every protein to the mean height of its partners. The best of several
    starts wins, measured by the summed height difference along the links.
    """
    weights = np.zeros((left_count, right_count))  # (left, right)
    weights[links[:, 0], links[:, 1]] = 1.0
    left_degree = weights.sum(1)  # (left,)
    right_degree = weights.sum(0)  # (right,)
    assert left_degree.min() > 0 and right_degree.min() > 0
    random = np.random.default_rng(7)
    best = None
    for _ in range(ORDER_STARTS):
        right = ranks(random.random(right_count))
        for _ in range(ORDER_SWEEPS):
            left = ranks(weights @ right / left_degree)
            right = ranks(weights.T @ left / right_degree)
        cost = float(np.abs(left[links[:, 0]] - right[links[:, 1]]).sum())
        if best is None or cost < best[2]:
            best = (left, right, cost)
    return best


def spread(key: np.ndarray, height: np.ndarray, kept: int) -> np.ndarray:
    """Pick `kept` places evenly along `key`, the outermost one (largest `height`) in each stretch."""
    assert len(key) >= kept, (len(key), kept)
    along = np.argsort(key, kind="stable")
    groups = np.array_split(along, kept)
    return np.array([group[np.argmax(height[group])] for group in groups])


def trade(points: np.ndarray, proteins: np.ndarray, coordinates: np.ndarray) -> None:
    """Put each protein at its coordinate, sending whoever sat there to the protein's old spot."""
    for protein, target in zip(proteins, coordinates):
        holder = int(np.flatnonzero((points == target).all(1))[0])
        points[[protein, holder]] = points[[holder, protein]]


def threads(organism: dict, points: np.ndarray, drawn: np.ndarray, kept: int, reach: float) -> np.ndarray:
    """Choose the contacts drawn inside one cell: the best-scored ones that stay local."""
    pairs, scores = organism["pairs"], organism["scores"]
    inside = drawn[pairs[:, 0]] & drawn[pairs[:, 1]]  # (contacts,)
    size = np.ptp(points[drawn], axis=0).max()
    length = np.linalg.norm(points[pairs[:, 0]] - points[pairs[:, 1]], axis=1) / size  # (contacts,)
    usable = np.flatnonzero(inside & (length <= reach) & (length > 0.004))
    jitter = np.random.default_rng(11).random(len(usable))
    ranked = usable[np.lexsort((jitter, -scores[usable]))]
    # No protein holds more than INTRA_DEGREE threads, which spreads the web over the whole cell.
    held = np.zeros(organism["count"], dtype=np.int64)
    taken = []
    for contact in ranked:
        a, b = pairs[contact]
        if held[a] < INTRA_DEGREE and held[b] < INTRA_DEGREE:
            held[a] += 1
            held[b] += 1
            taken.append(contact)
            if len(taken) == kept:
                break
    assert len(taken) == kept, (len(taken), kept)
    return pairs[np.array(taken)]  # (kept, 2)


def forest(
    organism: dict,
    points: np.ndarray,
    drawn: np.ndarray,
    gates: np.ndarray,
    fan: tuple[int, ...],
    reach: tuple[float, ...],
) -> np.ndarray:
    """Grow a tree of the cell's own contacts inward from each gate, all trees one level at a time.

    A protein at depth d takes its fan[d] best-scored partners that sit off the membrane, within
    reach[d], and in no tree yet. Returns (parent, child) rows in the order reached, so a parent
    always comes before its children.
    """
    assert len(fan) == len(reach)
    pairs, scores = organism["pairs"], organism["scores"]
    inner = drawn & (organism["terms"] != organism["labels"].index(MEMBRANE))  # (nodes,)
    size = np.ptp(points[drawn], axis=0).max()
    length = np.linalg.norm(points[pairs[:, 0]] - points[pairs[:, 1]], axis=1) / size  # (contacts,)
    usable = np.flatnonzero((length <= max(reach)) & (length > 0.004))
    jitter = np.random.default_rng(13).random(len(usable))
    near: dict[int, list[tuple[int, float]]] = {}
    for contact in usable[np.lexsort((jitter, -scores[usable]))]:
        a, b = int(pairs[contact, 0]), int(pairs[contact, 1])
        if inner[b]:
            near.setdefault(a, []).append((b, float(length[contact])))
        if inner[a]:
            near.setdefault(b, []).append((a, float(length[contact])))
    claimed = {int(gate) for gate in gates}
    front = [int(gate) for gate in gates]
    found = []
    for most, limit in zip(fan, reach):
        reached = []
        for node in front:
            fresh = [other for other, far in near.get(node, []) if far <= limit and other not in claimed][:most]
            claimed.update(fresh)
            reached.extend(fresh)
            found.extend((node, other) for other in fresh)
        front = reached
    return np.array(found, dtype=np.int64).reshape(-1, 2)  # (branches, 2)


def pack(organism: dict, points: np.ndarray, drawn: np.ndarray, gates: np.ndarray, intra: np.ndarray) -> tuple[dict, np.ndarray]:
    """Renumber the drawn proteins and write one cell in a frame centered on its middle."""
    index = np.full(organism["count"], -1, dtype=np.int64)
    index[drawn] = np.arange(drawn.sum())
    shown = points[drawn]  # (drawn, 2)
    low, high = shown.min(0), shown.max(0)
    half = (high - low) / 2
    scale = UNIT / half.max()
    local = np.round((shown - (low + high) / 2) * scale).astype("<i2")  # (drawn, 2)
    assert drawn.sum() < 65536 and (index[gates] >= 0).all() and (index[intra] >= 0).all()
    block = {
        "name": organism["name"],
        "count": organism["count"],
        "drawn": int(drawn.sum()),
        "half": [int(round(half[0] * scale)), int(round(half[1] * scale))],
        "regions": organism["labels"],
        "membrane": organism["labels"].index(MEMBRANE),
        "points": encode(local),
        "terms": encode(organism["terms"][drawn].astype("u1")),
        "gates": encode(index[gates].astype("<u2")),
        "intra": encode(index[intra].astype("<u2")),
    }
    return block, index


def main(ecoli_page: str, inter_page: str, out_path: str) -> None:
    ecoli = cell(payload(pathlib.Path(ecoli_page).read_text(encoding="utf-8"), "atlas-data"))
    inter_html = pathlib.Path(inter_page).read_text(encoding="utf-8")
    human = cell(payload(inter_html, "atlas-data"))
    inter = payload(inter_html, "interactome-data")
    assert len(inter["foreignProteins"]) == ecoli["count"] and inter["humanNodeCount"] == human["count"]

    contacts = membrane_contacts(inter, ecoli, human)  # (contacts, 3)
    chosen = choose(contacts)  # (chosen, 3)
    e_gates, e_slot = np.unique(chosen[:, 0], return_inverse=True)
    h_gates, h_slot = np.unique(chosen[:, 1], return_inverse=True)
    e_rank, h_rank, cost = order(np.stack([e_slot, h_slot], 1), len(e_gates), len(h_gates))
    e_gates = e_gates[np.argsort(e_rank, kind="stable")]  # top of the drawing first
    h_gates = h_gates[np.argsort(h_rank, kind="stable")]

    # E. coli is turned a quarter so that the rod's long side faces the human cell on its right.
    e_points = np.stack([-ecoli["points"][:, 1], ecoli["points"][:, 0]], 1)  # (nodes, 2)
    h_points = human["points"].copy()  # (nodes, 2)
    e_membrane = np.flatnonzero(ecoli["terms"] == ecoli["labels"].index(MEMBRANE))
    h_membrane = np.flatnonzero(human["terms"] == human["labels"].index(MEMBRANE))

    offset = e_points[e_membrane] - e_points[e_membrane].mean(0)  # (membrane, 2)
    facing = np.flatnonzero(offset[:, 0] > FACING_SHARE * offset[:, 0].max())
    places = spread(offset[facing, 1], offset[facing, 0], len(e_gates))
    trade(e_points, e_gates, e_points[e_membrane[facing[places]]].copy())

    offset = h_points[h_membrane] - h_points[h_membrane].mean(0)  # (membrane, 2)
    angle = np.degrees(np.arctan2(offset[:, 1], -offset[:, 0]))  # zero points at E. coli, on the left
    facing = np.flatnonzero(np.abs(angle) < FACING_ANGLE)
    places = spread(angle[facing], np.linalg.norm(offset[facing], axis=1), len(h_gates))
    trade(h_points, h_gates, h_points[h_membrane[facing[places]]].copy())

    e_drawn = ecoli["terms"] != ecoli["labels"].index(SECRETED)
    h_drawn = human["terms"] != human["labels"].index(SECRETED)
    e_block, e_index = pack(
        ecoli, e_points, e_drawn, e_gates, threads(ecoli, e_points, e_drawn, INTRA_KEPT["ecoli"], INTRA_REACH["ecoli"])
    )
    h_block, h_index = pack(
        human, h_points, h_drawn, h_gates, threads(human, h_points, h_drawn, INTRA_KEPT["human"], INTRA_REACH["human"])
    )
    edges = np.stack([e_index[chosen[:, 0]], h_index[chosen[:, 1]]], 1)  # (chosen, 2)
    assert edges.min() >= 0

    # The contacts a moving signal follows: a tree in each cell, rooted at every facing membrane protein.
    e_flow = e_index[forest(ecoli, e_points, e_drawn, e_gates, FLOW_FAN["ecoli"], FLOW_REACH["ecoli"])]  # (branches, 2)
    h_flow = h_index[forest(human, h_points, h_drawn, h_gates, FLOW_FAN["human"], FLOW_REACH["human"])]  # (branches, 2)
    assert e_flow.min() >= 0 and h_flow.min() >= 0
    e_block["flow"] = encode(e_flow.astype("<u2"))
    h_block["flow"] = encode(h_flow.astype("<u2"))

    data = {
        "source": [ECOLI_URL, INTER_URL],
        "model": inter["source"]["modelPath"],
        "scoreFloor": SCORE_FLOOR,
        "membraneContacts": int(len(contacts)),
        "ecoli": e_block,
        "human": h_block,
        "edgeCount": int(len(edges)),
        "edges": encode(edges.astype("<u2")),
        "scores": encode(chosen[:, 2].astype("u1")),
    }
    note = (
        "/* Atlas E. coli K-12 against the human cell: protein positions by compartment, the contacts "
        "drawn inside each cell, the top-scored membrane-to-membrane contacts between the two, and the trees "
        "of contacts that the moving signals follow. "
        "Positions are int16 in each cell's own frame. Generated by tools/build_interactome.py from "
        "the public pages named in source. */\n"
    )
    text = note + "window.INTERACTOME = " + json.dumps(data, separators=(",", ":")) + ";\n"
    pathlib.Path(out_path).write_text(text, encoding="utf-8", newline="\n")
    print(
        f"membrane-to-membrane contacts {len(contacts)}, drawn {len(edges)} "
        f"between {len(e_gates)} E. coli and {len(h_gates)} human proteins, "
        f"mean height difference {cost / len(edges):.3f}, "
        f"drawn proteins {e_block['drawn']} and {h_block['drawn']}, "
        f"signal trees of {len(e_flow)} contacts under {len(np.intersect1d(e_flow[:, 0], e_index[e_gates]))} "
        f"E. coli membrane proteins and {len(h_flow)} under {len(np.intersect1d(h_flow[:, 0], h_index[h_gates]))} "
        f"human ones, {len(text) / 1024:.0f} KB"
    )


if __name__ == "__main__":
    assert len(sys.argv) == 4, __doc__
    main(sys.argv[1], sys.argv[2], sys.argv[3])
