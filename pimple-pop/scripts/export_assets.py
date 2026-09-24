"""Export the approved v002 PSD into the game's runtime textures.

Run from any directory with Python 3, Pillow and psd-tools installed.
Source artwork remains untouched. Face layers keep their shared canvas;
pimple cuts use original layer opacity, transparent padding and soft edges.
"""
from collections import deque
from pathlib import Path
import math
import json
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


# Hurt art uses screen-side names on a wider canvas. Align each transparent
# cutout to its matching normal feature's alpha center without stretching it.
HURT_ANCHORS = {
    'Eye_L_hurt': 'EyeWhite_R', 'Eye_R_hurt': 'EyeWhite_L',
    'Brow_L_hurt': 'Brow_R', 'Brow_R_hurt': 'Brow_L', 'Mouth_hurt': 'Mouth',
}


def export_hurt(layers, canvas_size):
    for name, anchor in HURT_ANCHORS.items():
        source = Image.open(ROOT / 'face hurt' / f'{name}.png').convert('RGBA')
        cutout = source.crop(source.getchannel('A').getbbox())
        left, top, right, bottom = layers[anchor].topil().getchannel('A').getbbox()
        position = (round((left + right - cutout.width) / 2),
                    round((top + bottom - cutout.height) / 2))
        canvas = Image.new('RGBA', canvas_size)
        canvas.paste(cutout, position)
        canvas.resize((1024, 1024), Image.Resampling.LANCZOS).save(
            OUTPUT / f'{name}.webp', lossless=True, exact=True)


BURST_SOURCE = ROOT / 'Pimple_Burst_Animations_v001_20260923'
# Reviewed centers of the initial opaque emission in frame 01. The same pivot
# is retained across all nine full rectangular frames; never recenter a frame.
BURST_ORIGINS = {1: (262, 63), 2: (44, 118), 3: (51, 202), 5: (71, 261), 6: (43, 154)}


def export_bursts(layers):
    info = json.loads((BURST_SOURCE / 'Import_Info.json').read_text())
    for group in info['groups']:
        number = int(group['pimple_id'].split('_')[1])
        width, height = group['canvas_size_px']
        count = group['frame_count']
        sheet = Image.new('RGBA', (width * count, height))
        origin_x, origin_y = BURST_ORIGINS[number]
        frames = {}
        for index in range(count):
            source = BURST_SOURCE / group['folder'] / group['file_pattern'].format(frame=index + 1)
            image = Image.open(source).convert('RGBA')
            if image.size != (width, height):
                raise ValueError(f'Unexpected animation frame size: {source}')
            sheet.paste(image, (index * width, 0))
            frames[f'{index + 1:02}'] = {
                'frame': {'x': index * width, 'y': 0, 'w': width, 'h': height},
                'rotated': False, 'trimmed': False,
                'pivot': {'x': origin_x / width, 'y': origin_y / height},
            }
        left, top, right, bottom = layers[f'Pimple_{number:02}'].topil().getchannel('A').getbbox()
        # Match original source pixels to the existing 160-pixel padded pimple export.
        scale = min(1, 152 / max(right - left, bottom - top)) / 160
        sheet.save(OUTPUT / f'Burst_{number}.webp', lossless=True, exact=True)
        atlas = {'frames': frames, 'meta': {'frameRate': info['suggested_playback_fps'],
                 'frameCount': count, 'scalePerDisplayUnit': scale}}
        (OUTPUT / f'Burst_{number}.json').write_text(json.dumps(atlas, indent=2) + '\n')


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
    export_hurt(layers, psd.size)
    export_bursts(layers)
    print(f'Exported 5 burst atlases, 5 aligned hurt features, {len(FACE_LAYERS)} aligned face layers and 6 pimple variants from {SOURCE.name}')


if __name__ == '__main__':
    main()
