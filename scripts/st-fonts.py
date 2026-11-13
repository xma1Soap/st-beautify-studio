"""
Makes the fonts the preview's chat page uses, from SillyTavern's own copies (public/webfonts in a SillyTavern
checkout), so text in the preview is drawn with the same font files as in SillyTavern, also on computers that don't
have Noto Sans installed.

SillyTavern's chat text is Noto Sans (weight 500, names 700, times 400) and its code Noto Sans Mono 500. Each face is
cut in two: "core" (the common Latin letters, digits and punctuation, including the “ ” … — that Chinese text uses)
and "ext" (the rest of the font: accented and other Latin, Greek, Cyrillic, IPA, more symbols; not Devanagari). The
preview puts a face's core into its page always and its ext only when the message has a character from it, so a
page stays small. Kerning and other OpenType features are kept.

Needs Python with fontTools and brotli. Usage:
    python scripts/st-fonts.py <SillyTavern>/public/webfonts
Writes src/assets/st-fonts/*.woff2 and faces.json. The fonts are under the SIL Open Font License 1.1 (OFL.txt there).
"""
import json
import os
import sys

from fontTools import subset

OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets', 'st-fonts')

# (family, weight, style, file under webfonts) — the faces SillyTavern declares for these weights
FACES = [
    ('Noto Sans', 400, 'normal', 'NotoSans/NotoSans-Regular.woff2'),
    ('Noto Sans', 400, 'italic', 'NotoSans/NotoSans-Italic.woff2'),
    ('Noto Sans', 500, 'normal', 'NotoSans/NotoSans-Medium.woff2'),
    ('Noto Sans', 500, 'italic', 'NotoSans/NotoSans-MediumItalic.woff2'),
    ('Noto Sans', 700, 'normal', 'NotoSans/NotoSans-Bold.woff2'),
    ('Noto Sans', 700, 'italic', 'NotoSans/NotoSans-BoldItalic.woff2'),
    ('Noto Sans Mono', 400, 'normal', 'NotoSansMono/noto-sans-mono-v30-regular.woff2'),
    ('Noto Sans Mono', 500, 'normal', 'NotoSansMono/noto-sans-mono-v30-500.woff2'),
    ('Noto Sans Mono', 700, 'normal', 'NotoSansMono/noto-sans-mono-v30-700.woff2'),
]

# like Google Fonts' "latin" slice, plus the general punctuation block (“ ” ‘ ’ … — • ※) and ℃ №
CORE = [(0x0000, 0x00FF), (0x0131, 0x0131), (0x0152, 0x0153), (0x02BB, 0x02BC), (0x02C6, 0x02C6), (0x02DA, 0x02DA),
        (0x02DC, 0x02DC), (0x0304, 0x0304), (0x0308, 0x0308), (0x0329, 0x0329), (0x2000, 0x206F), (0x20AC, 0x20AC),
        (0x2103, 0x2103), (0x2116, 0x2116), (0x2122, 0x2122), (0x2190, 0x2193), (0x2212, 0x2212), (0x2215, 0x2215),
        (0xFEFF, 0xFEFF), (0xFFFD, 0xFFFD)]
# left out: Devanagari, Vedic extensions, Devanagari extended
SKIP = [(0x0900, 0x097F), (0x1CD0, 0x1CFF), (0xA8E0, 0xA8FF)]


def inside(c, ranges):
    return any(a <= c <= b for a, b in ranges)


def to_ranges(cps):
    out = []
    for c in sorted(cps):
        if out and out[-1][1] == c - 1:
            out[-1][1] = c
        else:
            out.append([c, c])
    return ', '.join(f'U+{a:04X}' if a == b else f'U+{a:04X}-{b:04X}' for a, b in out)


def cut(src, dst, cps):
    o = subset.Options()
    o.flavor = 'woff2'
    o.layout_features = ['*']
    o.legacy_kern = True
    o.name_IDs = ['*']
    o.name_languages = ['*']
    o.notdef_outline = True
    font = subset.load_font(src, o)
    s = subset.Subsetter(o)
    s.populate(unicodes=cps)
    s.subset(font)
    subset.save_font(font, dst, o)


def main(webfonts):
    os.makedirs(OUT, exist_ok=True)
    faces = []
    for family, weight, style, rel in FACES:
        src = os.path.join(webfonts, rel)
        font = subset.load_font(src, subset.Options())
        have = set(font.getBestCmap())
        parts = {
            'core': {c for c in have if inside(c, CORE)},
            'ext': {c for c in have if not inside(c, CORE) and not inside(c, SKIP) and c > 0x20},
        }
        for part, cps in parts.items():
            name = f"{family.replace(' ', '')}-{weight}{'i' if style == 'italic' else ''}-{part}.woff2"
            cut(src, os.path.join(OUT, name), cps)
            faces.append({'family': family, 'weight': weight, 'style': style, 'part': part, 'file': name, 'range': to_ranges(cps)})
            print(name, len(cps), os.path.getsize(os.path.join(OUT, name)))
    with open(os.path.join(OUT, 'faces.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(faces, f, ensure_ascii=False, indent=1)
        f.write('\n')


if __name__ == '__main__':
    main(sys.argv[1])
