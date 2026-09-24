"""Export the approved v002 PSD into the game's runtime textures.

Run from any directory with Python 3, Pillow and psd-tools installed.
Source artwork remains untouched. Face layers keep their shared canvas;
pimple cuts use original layer opacity, transparent padding and soft edges.
"""
from collections import deque
from pathlib import Path
import math
from PIL import Image
from psd_tools import PSDImage

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'Face_Assets_v002_20260922/Source/Face_Assets_v002_20260922.psd'
OUTPUT = ROOT / 'pimple-pop/public/assets'
FACE_LAYERS = ['Face_Base', 'Cheek_L', 'Cheek_R', 'EyeWhite_L', 'EyeWhite_R',
               'Pupil_L', 'Pupil_R', 'Brow_L', 'Brow_R', 'Nose', 'Mouth', 'Hair_Front']


def remove_outer_white(image):
    """Remove the edge-connected white export matte, never enclosed highlights."""
    pixels = image.load()
    width, height = image.size
    seen = set()
    queue = deque([(x, y) for x in range(width) for y in (0, height - 1)] +
                  [(x, y) for y in range(height) for x in (0, width - 1)])
    while queue:
        x, y = queue.popleft()
        if (x, y) in seen or not (0 <= x < width and 0 <= y < height):
            continue
        seen.add((x, y))
        r, g, b, a = pixels[x, y]
        if a and min(r, g, b) < 245:
            continue
        pixels[x, y] = (r, g, b, 0)
        queue.extend([(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)])


def pimple_texture(layer, number):
    image = layer.topil().convert('RGBA')
    image = image.crop(image.getchannel('A').getbbox())
    if number == 5:
        remove_outer_white(image)
    width, height = image.size
    pixels = image.load()
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            # Feather the outside of the cut, leaving its central artwork intact.
            radius = math.hypot((x + .5 - width / 2) / (width / 2),
                                (y + .5 - height / 2) / (height / 2))
            fade = min(1, max(0, (1 - radius) / .22))
            fade = fade * fade * (3 - 2 * fade)
            pixels[x, y] = (r, g, b, round(a * layer.opacity / 255 * fade))
    image.thumbnail((152, 152), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (160, 160))
    canvas.paste(image, ((160 - image.width) // 2, (160 - image.height) // 2))
    return canvas


def main():
    psd = PSDImage.open(SOURCE)
    layers = {layer.name.removesuffix('.png'): layer for layer in psd}
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name in FACE_LAYERS:
        layer = layers[name]
        canvas = Image.new('RGBA', psd.size)
        canvas.paste(layer.topil().convert('RGBA'), layer.offset)
        canvas = canvas.resize((1024, 1024), Image.Resampling.LANCZOS)
        canvas.save(OUTPUT / f'{name}.webp', lossless=True, exact=True)
    for number in range(1, 7):
        texture = pimple_texture(layers[f'Pimple_{number:02}'], number)
        texture.save(OUTPUT / f'Pimple_{number}.webp', lossless=True, exact=True)
    print(f'Exported {len(FACE_LAYERS)} aligned face layers and 6 pimple variants from {SOURCE.name}')


if __name__ == '__main__':
    main()
