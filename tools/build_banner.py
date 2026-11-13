"""Render the SVG banner of the GitHub profile: a sketch of protein space, as a still.

The drawing uses the site's colors. Each family of related proteins grows as a tree
of smooth branches that fork twice, set apart from its neighbors, over a thin dust of unlinked
points. It is decoration from a seeded generator, not data.
"""

import math
import pathlib
import random
import sys
from collections import defaultdict

WIDTH, HEIGHT = 1280, 380
TEAL, AMBER, VIOLET, SKY, DUST = (94, 234, 212), (251, 182, 94), (169, 156, 245), (125, 211, 252), (205, 214, 228)
PALETTE = [TEAL, AMBER, TEAL, VIOLET, TEAL, TEAL, AMBER, TEAL, SKY, TEAL, VIOLET, TEAL, AMBER, TEAL]
ANGLE, TILT, CAMERA, REACH = 0.4, 0.22, 420.0, 100.0
STRETCH = 2.05  # the banner is wide, so the cloud is drawn as an ellipsoid
CENTER_X, CENTER_Y, SCALE = 925.0, 190.0, 1.62
LEVELS = 6
STEP, FORKS = 2.3, 2  # the length of one step along a branch, and how many times a branch forks

Point = tuple[float, float, float, tuple[int, int, int], float]


Direction = tuple[float, float, float]


def bent(rng: random.Random, direction: Direction, amount: float) -> Direction:
    """Turn a direction by a random amount and return it as a unit vector."""
    x, y, z = (part + amount * rng.gauss(0, 1) for part in direction)
    length = math.sqrt(x * x + y * y + z * z) or 1.0
    return x / length, y / length, z / length


def grow(
    rng: random.Random,
    points: list[Point],
    links: list[tuple[int, int]],
    start: int,
    direction: Direction,
    level: int,
) -> None:
    """Grow one branch: a run of short steps that drifts, sheds a side branch now and then, and ends in a fork.

    Only forks and tips get a dot, so the lines stay clean.
    """
    color = points[start][3]
    steps = (7, 5, 3)[level] + rng.randrange(4)
    at = start
    for step in range(steps):
        direction = bent(rng, direction, 0.19)
        x, y, z = points[at][:3]
        points.append((x + direction[0] * STEP, y + direction[1] * STEP, z + direction[2] * STEP, color, 0.0))
        links.append((at, len(points) - 1))
        at = len(points) - 1
        if level < FORKS and 1 < step < steps - 2 and rng.random() < 0.16:
            grow(rng, points, links, at, bent(rng, direction, 0.95), level + 1)
    if level < FORKS:
        points[at] = (*points[at][:4], 0.85)
        grow(rng, points, links, at, bent(rng, direction, 0.7), level + 1)
        grow(rng, points, links, at, bent(rng, direction, 0.7), level + 1)
    else:
        points[at] = (*points[at][:4], 1.2)


def build(rng: random.Random) -> tuple[list[Point], list[tuple[int, int]]]:
    points: list[Point] = []
    links: list[tuple[int, int]] = []
    for _ in range(170):
        radius, theta, lift = 112 * rng.random() ** (1 / 3), math.tau * rng.random(), 2 * rng.random() - 1
        flat = math.sqrt(1 - lift * lift)
        points.append((radius * flat * math.cos(theta), radius * lift, radius * flat * math.sin(theta), DUST, 0.2 + 0.25 * rng.random()))
    for family, color in enumerate(PALETTE):
        # Centers sit on a golden-angle spiral, so the families fill the sphere evenly.
        height = 1 - (2 * (family + 0.5)) / len(PALETTE)
        ring, turn = math.sqrt(1 - height * height), family * 2.39996
        shell = 46 + 22 * rng.random()
        points.append((shell * ring * math.cos(turn), shell * height, shell * ring * math.sin(turn), color, 2.2))
        root = len(points) - 1
        first = bent(rng, (0.0, 0.0, 0.0), 1.0)
        for trunk in range(3 + rng.randrange(2)):
            # Trunks leave the root in well separated directions.
            away = first if trunk == 0 else bent(rng, (-first[0], -first[1], -first[2]), 1.1)
            grow(rng, points, links, root, away, 0)
    return points, links


def project(point: Point) -> tuple[float, float, float]:
    x0, y0, z0 = point[:3]
    x = x0 * math.cos(ANGLE) + z0 * math.sin(ANGLE)
    z = z0 * math.cos(ANGLE) - x0 * math.sin(ANGLE)
    y = y0 * math.cos(TILT) - z * math.sin(TILT)
    depth = y0 * math.sin(TILT) + z * math.cos(TILT)
    perspective = CAMERA / (CAMERA - depth)
    near = min(1.0, max(0.0, (depth + REACH) / (2 * REACH)))
    return CENTER_X + x * STRETCH * perspective * SCALE, CENTER_Y + y * perspective * SCALE, near


def main(target: str) -> None:
    points, links = build(random.Random(11))
    flat = [project(point) for point in points]

    link_paths: dict[tuple[tuple[int, int, int], int], list[str]] = defaultdict(list)
    for a, b in links:
        near = (flat[a][2] + flat[b][2]) / 2
        level = min(LEVELS - 1, int(near * LEVELS))
        link_paths[(points[b][3], level)].append(f"M{flat[a][0]:.1f} {flat[a][1]:.1f}L{flat[b][0]:.1f} {flat[b][1]:.1f}")
    dot_paths: dict[tuple[tuple[int, int, int], int, int], list[str]] = defaultdict(list)
    for point, (x, y, near) in zip(points, flat):
        if point[4] == 0:
            continue
        level = min(LEVELS - 1, int(near * LEVELS))
        dot_paths[(point[3], level, min(3, int(point[4] * 2)))].append(f"M{x:.1f} {y:.1f}h0")

    shapes = []
    for (color, level), parts in sorted(link_paths.items(), key=lambda item: item[0][1]):
        near = (level + 0.5) / LEVELS
        shapes.append(
            f'<path d="{"".join(parts)}" stroke="rgb{color}" stroke-opacity="{0.95 * (0.15 + 0.85 * near * near):.2f}" '
            f'stroke-width="{0.7 * (0.7 + 1.7 * near) * 0.75:.2f}"/>'
        )
    for (color, level, size), parts in sorted(dot_paths.items(), key=lambda item: item[0][1]):
        near = (level + 0.5) / LEVELS
        radius = (size + 0.5) / 2 * (0.5 + 1.5 * near) * 0.75
        shapes.append(
            f'<path d="{"".join(parts)}" stroke="rgb{color}" stroke-opacity="{0.26 + 0.74 * near:.2f}" stroke-width="{2 * radius:.2f}"/>'
        )

    serif = "Georgia, 'Times New Roman', serif"
    mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-label="Logan Hallee. I build models that learn the structure of the protein universe, and I check they are not cheating. Beside the words is a sketch of protein space, with related proteins growing into families.">
<defs>
<radialGradient id="glow" cx="72%" cy="48%" r="60%"><stop offset="0" stop-color="#5eead4" stop-opacity="0.13"/><stop offset="1" stop-color="#5eead4" stop-opacity="0"/></radialGradient>
<linearGradient id="fade" x1="0" x2="1"><stop offset="0.36" stop-color="#07090d"/><stop offset="0.56" stop-color="#07090d" stop-opacity="0"/></linearGradient>
<linearGradient id="ink" x1="0" x2="1"><stop offset="0" stop-color="#5eead4"/><stop offset="1" stop-color="#fbb65e"/></linearGradient>
<clipPath id="frame"><rect width="{WIDTH}" height="{HEIGHT}" rx="18"/></clipPath>
</defs>
<g clip-path="url(#frame)">
<rect width="{WIDTH}" height="{HEIGHT}" fill="#07090d"/>
<rect width="{WIDTH}" height="{HEIGHT}" fill="url(#glow)"/>
<g fill="none" stroke-linecap="round">
{chr(10).join(shapes)}
</g>
<rect width="{WIDTH}" height="{HEIGHT}" fill="url(#fade)"/>
<text x="64" y="92" font-family="{mono}" font-size="15" letter-spacing="3.2" fill="#5eead4">LOGAN HALLEE</text>
<text font-family="{serif}" font-size="38" fill="#f2f4f8" letter-spacing="-0.4">
<tspan x="64" y="158">I build models that learn the</tspan>
<tspan x="64" y="206">structure of the protein universe,</tspan>
<tspan x="64" y="254">and I check they are <tspan font-style="italic" fill="url(#ink)">not cheating</tspan>.</tspan>
</text>
<text x="64" y="312" font-family="{mono}" font-size="13" letter-spacing="1.6" fill="#8b93a3">A sketch of protein space, not data</text>
</g>
<rect x="0.5" y="0.5" width="{WIDTH - 1}" height="{HEIGHT - 1}" rx="18" fill="none" stroke="#ffffff" stroke-opacity="0.08"/>
</svg>
"""
    path = pathlib.Path(target)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(svg, encoding="utf-8", newline="\n")
    print(path, len(svg), "bytes", len(points), "points", len(links), "links")


if __name__ == "__main__":
    main(sys.argv[1])
