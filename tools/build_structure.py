"""Write the C-alpha trace of PDB 1YY9 (EGFR with the cetuximab Fab) as a small JavaScript data file."""

import json
import pathlib
import sys

import numpy as np

THREE_TO_ONE = {
    "ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C", "GLN": "Q", "GLU": "E", "GLY": "G",
    "HIS": "H", "ILE": "I", "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F", "PRO": "P", "SER": "S",
    "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V",
}
CHAIN_NAMES = {"A": "EGFR extracellular domain", "C": "cetuximab Fab light chain", "D": "cetuximab Fab heavy chain"}


def main(pdb_path: str, out_path: str) -> None:
    chains: dict[str, list[tuple[int, str, list[float]]]] = {}
    seen: set[tuple[str, int, str]] = set()
    for line in pathlib.Path(pdb_path).read_text().splitlines():
        if line.startswith("ENDMDL"):
            break
        if not line.startswith("ATOM") or line[12:16].strip() != "CA":
            continue
        if line[16] not in (" ", "A"):
            continue
        chain = line[21]
        key = (chain, int(line[22:26]), line[26])
        if key in seen:
            continue
        seen.add(key)
        residue = line[17:20]
        assert residue in THREE_TO_ONE, residue
        xyz = [float(line[30:38]), float(line[38:46]), float(line[46:54])]
        chains.setdefault(chain, []).append((key[1], THREE_TO_ONE[residue], xyz))
    assert set(chains) == set(CHAIN_NAMES), sorted(chains)

    coords = np.array([atom[2] for atoms in chains.values() for atom in atoms])  # (n, 3)
    centered = coords - coords.mean(axis=0)  # (n, 3)
    _, vectors = np.linalg.eigh(centered.T @ centered)  # (3, 3), ascending eigenvalues
    # Longest axis becomes y (vertical on screen), the next x, the shortest z.
    frame = np.stack([vectors[:, 1], vectors[:, 2], vectors[:, 0]], axis=1)  # (3, 3)
    if np.linalg.det(frame) < 0:
        frame[:, 2] *= -1
    rotated = centered @ frame  # (n, 3)

    output = {"source": "PDB 1YY9", "chains": []}
    start = 0
    for chain_id in sorted(chains):
        atoms = chains[chain_id]
        block = rotated[start:start + len(atoms)]
        start += len(atoms)
        output["chains"].append({
            "id": chain_id,
            "name": CHAIN_NAMES[chain_id],
            "first": atoms[0][0],
            "sequence": "".join(atom[1] for atom in atoms),
            "ca": [int(round(value * 10)) for value in block.reshape(-1)],
        })
    text = "/* C-alpha trace of PDB 1YY9, EGFR extracellular domain with the cetuximab Fab. Coordinates are in tenths of an angstrom, centered, longest axis on y. Generated from the RCSB entry. */\nwindow.COMPLEX_1YY9 = " + json.dumps(output, separators=(",", ":")) + ";\n"
    pathlib.Path(out_path).write_text(text, encoding="utf-8", newline="\n")
    extent = np.abs(rotated).max(axis=0)
    print({chain["id"]: len(chain["sequence"]) for chain in output["chains"]}, "extent (A)", extent.round(1), "bytes", len(text))
    print(output["chains"][0]["first"], output["chains"][0]["sequence"][:90])


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
