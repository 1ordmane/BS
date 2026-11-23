"""Turn the logo animation video into sprite sheets for the scroll-driven header logo.

The header script needs to show the frame that matches the page scroll position, so
the frames are extracted in their original order and packed into a grid.

The animation is one turn of the lettering ring around a static "BS" and outer
circle, but the video turns it unevenly (slow at both ends, still at the start and
end, and every fifth frame repeats the one before). So the script measures the ring's
angle in every frame, keeps at most MAX_FRAMES frames spread evenly over the turn, and
writes a mask of the ring. The header script maps scroll to an angle, shows the
frame closest to it, and turns that frame's ring by the small remaining angle.

Usage (needs Python 3 with Pillow, and ffmpeg; on macOS without ffmpeg the frames are
read with scripts/video-frames.swift, which needs the Xcode command line tools):
    python3 scripts/logo-frames.py

Reads  public/logo/business-stand-logo.mp4
Writes public/logo/logo-frames-<size>.webp, public/logo/logo-poster.webp,
       public/logo/logo-ring-mask.png and src/data/logo-frames.json
       (frame count, grid layout, ring geometry and the angle of every frame).
"""

import bisect
import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'public/logo/business-stand-logo.mp4'
OUT_DIR = ROOT / 'public/logo'
META = ROOT / 'src/data/logo-frames.json'

# Where the mark sits in the 1080 x 1080 video, in pixels measured from its frames:
# the outer circle spans 195–869 horizontally and 231–906 vertically (edges included),
# and the video has black bars along the top and bottom that must be cut off.
MARK_CENTRE = (532.5, 569.0)
# Half the side of the square cut around the mark: the outer circle (radius 338) stays
# inside it with a thin band of background around it.
MARK_HALF = 377
# Frames are cut and scaled to this square before anything else.
WORK = 400
SCALE = WORK / (2 * MARK_HALF)

# Two sheets: a lighter one for the small mobile logo, a sharper one for desktop.
SIZES = (224, 320)
COLUMNS = 16
QUALITY = 80
# Ten rows of sixteen: the sheets stay as small as with the earlier animation, which
# matters for phone memory. The header script turns the ring between frames anyway.
MAX_FRAMES = 160

# Ring geometry in WORK pixels. In the video the lettering lies between radius 238 and
# 295 around the centre, the outer circle starts at 308, and the corners of "BS" reach 237.
CENTRE = WORK / 2 - 0.5
RING_INNER = 235.5 * SCALE
RING_OUTER = 301.5 * SCALE


def video_frames():
    """Every frame of the video, cut to the square around the mark and scaled to WORK."""
    with tempfile.TemporaryDirectory() as folder:
        if shutil.which('ffmpeg'):
            command = ['ffmpeg', '-v', 'error', '-i', str(SOURCE), '-fps_mode', 'passthrough', f'{folder}/frame%04d.png']
        elif sys.platform == 'darwin' and shutil.which('swift'):
            command = ['swift', '-suppress-warnings', str(ROOT / 'scripts/video-frames.swift'), str(SOURCE), folder]
        else:
            sys.exit('Install ffmpeg to read the logo video.')
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL)

        cx, cy = MARK_CENTRE
        box = (cx - MARK_HALF, cy - MARK_HALF, cx + MARK_HALF, cy + MARK_HALF)
        frames = []
        for path in sorted(Path(folder).glob('frame*.png')):
            with Image.open(path) as image:
                frames.append(image.convert('RGB').resize((WORK, WORK), Image.LANCZOS, box=box))
    if not frames:
        sys.exit(f'No frames read from {SOURCE}')
    return frames


def ring_mask(full):
    """The lettering ring, minus the static "BS" where its corners reach into the ring."""
    always = full[0].convert('L')
    for frame in full:
        always = ImageChops.lighter(always, frame.convert('L'))
    # Pixels dark in every frame inside the ring are the corners of "BS"; keep them out.
    letters = always.point(lambda v: 255 if v < 170 else 0).filter(ImageFilter.MaxFilter(5))

    scale = 4
    ring = Image.new('L', (WORK * scale, WORK * scale), 0)
    draw = ImageDraw.Draw(ring)
    c = (CENTRE + 0.5) * scale
    draw.ellipse([c - RING_OUTER * scale, c - RING_OUTER * scale, c + RING_OUTER * scale, c + RING_OUTER * scale], fill=255)
    draw.ellipse([c - RING_INNER * scale, c - RING_INNER * scale, c + RING_INNER * scale, c + RING_INNER * scale], fill=0)
    ring = ring.resize((WORK, WORK), Image.LANCZOS)
    # Only the "BS" corners inside the ring matter; the rest of the letters lie inside RING_INNER.
    return ImageChops.subtract(ring, letters)


def ring_turns(full, mask):
    """Angle of the ring in each frame, as a share of the full turn (0 … 1)."""
    grey = [frame.convert('L') for frame in full]

    def error(frame, target, angle):
        turned = frame.rotate(angle, resample=Image.BICUBIC, center=(CENTRE, CENTRE))
        return ImageStat.Stat(ImageChops.difference(turned, target), mask).mean[0]

    total, angles = 0.0, [0.0]
    for frame, target in zip(grey, grey[1:]):
        best = min((error(frame, target, a / 2), a / 2) for a in range(-2, 19))[1]
        for step in (0.1, 0.02):
            best = min((error(frame, target, best + i * step), best + i * step) for i in range(-5, 6))[1]
        total += max(0.0, best)
        angles.append(total)
    return [a / total for a in angles], total


def spread(turns):
    """Indices of at most MAX_FRAMES frames spread evenly over the turn, first and last included."""
    picked = set()
    for k in range(MAX_FRAMES):
        at = k / (MAX_FRAMES - 1)
        i = min(bisect.bisect_left(turns, at), len(turns) - 1)
        if i > 0 and at - turns[i - 1] < turns[i] - at:
            i -= 1
        picked.add(i)
    return sorted(picked)


def background_colour(frames):
    """Median colour of the corners, which lie outside the mark in every frame."""
    corner = 40
    strip = Image.new('RGB', (corner * 4, corner * len(frames)))
    for row, frame in enumerate(frames):
        for col, (x, y) in enumerate([(0, 0), (WORK - corner, 0), (0, WORK - corner), (WORK - corner, WORK - corner)]):
            strip.paste(frame.crop((x, y, x + corner, y + corner)), (col * corner, row * corner))
    return '#%02x%02x%02x' % tuple(ImageStat.Stat(strip).median)


def main() -> None:
    full = video_frames()
    mask = ring_mask(full)
    turns, total = ring_turns(full, mask)

    keep = spread(turns)
    frames = [full[i] for i in keep]
    turns = [round(turns[i], 5) for i in keep]

    count = len(frames)
    rows = math.ceil(count / COLUMNS)
    sheets = []

    for size in SIZES:
        sheet = Image.new('RGB', (COLUMNS * size, rows * size))
        for index, frame in enumerate(frames):
            cell = frame.resize((size, size), Image.LANCZOS)
            sheet.paste(cell, ((index % COLUMNS) * size, (index // COLUMNS) * size))
        name = f'logo-frames-{size}.webp'
        sheet.save(OUT_DIR / name, quality=QUALITY, method=6)
        sheets.append({'src': f'/logo/{name}', 'size': size})

    frames[0].resize((SIZES[-1], SIZES[-1]), Image.LANCZOS).save(
        OUT_DIR / 'logo-poster.webp', quality=QUALITY, method=6
    )

    alpha = mask.resize((SIZES[-1], SIZES[-1]), Image.LANCZOS)
    white = Image.new('RGBA', alpha.size, (255, 255, 255, 0))
    white.putalpha(alpha)
    white.save(OUT_DIR / 'logo-ring-mask.png', optimize=True)

    META.write_text(
        json.dumps(
            {
                'frames': count,
                'columns': COLUMNS,
                'poster': '/logo/logo-poster.webp',
                'sheets': sheets,
                # The lettering ring, in fractions of a frame: centre and the mask that covers it.
                'ring': {'centre': round((CENTRE + 0.5) / WORK, 5), 'mask': '/logo/logo-ring-mask.png'},
                # The ring turns counter-clockwise; turns[i] is how far frame i is through the turn.
                'turns': turns,
                # Background colour of the source frames, used behind the canvas.
                'background': background_colour(full),
            },
            indent=2,
        )
        + '\n'
    )
    print(f'{len(full)} video frames, kept {count}: {rows} rows x {COLUMNS} columns, sheets: {[s["src"] for s in sheets]}')
    print(f'measured ring turn: {total:.2f}°')


if __name__ == '__main__':
    main()
