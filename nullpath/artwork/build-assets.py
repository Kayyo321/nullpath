"""Generate Mozilla branding assets from the supplied Nullpath artwork.

Run with a Python that has Pillow, passing a prepared branding directory:
  python nullpath/artwork/build-assets.py librewolf-156.0.1-1/browser/branding/nullpath
The generated files live in nullpath/branding and are copied by the overlay.
"""

from base64 import b64encode
from pathlib import Path
from PIL import Image
import io
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
TEMPLATE = Path(sys.argv[1]).resolve()
OUT = ROOT / "nullpath/branding"
ICON = Image.open(HERE / "LogoIcon.png").convert("RGBA")
ICON_DARK = Image.open(HERE / "LogoIconDark.png").convert("RGBA")
WORDMARK = Image.open(HERE / "Logo.png").convert("RGBA")
WORDMARK_DARK = Image.open(HERE / "LogoDark.png").convert("RGBA")
RESAMPLE = Image.Resampling.LANCZOS


def contain(source, size, margin=0.05, background=None):
    w, h = size
    canvas = Image.new("RGBA", size, background or (0, 0, 0, 0))
    # Crop the transparent margins before fitting.
    source = source.crop(source.getbbox())
    available = (max(1, int(w * (1 - 2 * margin))), max(1, int(h * (1 - 2 * margin))))
    fitted = source.copy()
    fitted.thumbnail(available, RESAMPLE)
    canvas.alpha_composite(fitted, ((w - fitted.width) // 2, (h - fitted.height) // 2))
    return canvas


def save_asset(relative, image, fmt=None):
    target = OUT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    if fmt in {"JPEG", "BMP"}:
        image = image.convert("RGB")
    if fmt == "ICO":
        image.save(target, format=fmt, sizes=[(16, 16), (24, 24), (32, 32),
                                              (48, 48), (64, 64), (128, 128), (256, 256)])
    else:
        image.save(target, format=fmt)


for template in TEMPLATE.rglob("*"):
    if not template.is_file() or template.suffix.lower() not in {".png", ".ico", ".jpg", ".bmp", ".icns"}:
        continue
    relative = template.relative_to(TEMPLATE)
    with Image.open(template) as original:
        size = original.size
    name = template.name.lower()
    source = WORDMARK if "wordmark" in name else ICON
    if template.suffix.lower() == ".ico":
        # ICO sizes cover shell, taskbar, and Explorer uses.
        save_asset(relative, contain(source, (256, 256)), "ICO")
    elif template.suffix.lower() == ".icns":
        save_asset(relative, contain(source, (1024, 1024)), "ICNS")
    elif template.suffix.lower() in {".jpg", ".bmp"}:
        # Installer backgrounds are opaque. Use a quiet light field.
        save_asset(relative, contain(source, size, margin=0.25, background="white"),
                   "JPEG" if template.suffix.lower() == ".jpg" else "BMP")
    else:
        save_asset(relative, contain(source, size), "PNG")


def embedded_svg(source, width=512, height=512, contextual=False):
    stream = io.BytesIO()
    source.save(stream, format="PNG")
    encoded = b64encode(stream.getvalue()).decode("ascii")
    image = f'<image width="{width}" height="{height}" href="data:image/png;base64,{encoded}"/>'
    if contextual:
        image = (f'<mask id="art" mask-type="alpha">{image}</mask>'
                 f'<rect width="{width}" height="{height}" fill="context-fill" mask="url(#art)"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
            f'viewBox="0 0 {width} {height}">{image}</svg>\n')


for relative in ["content/about-logo.svg", "file.svg", "file_librewolf.svg", "file_pdf.svg"]:
    target = OUT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(embedded_svg(ICON), encoding="utf-8")
for relative in ["content/about-wordmark.svg", "content/firefox-wordmark.svg"]:
    target = OUT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    # The supplied full logo contains the original custom letterforms below
    # the mark. Keep those letterforms for browser wordmark placements.
    letters = WORDMARK.crop((97, 906, 1102, 1182))
    letters = contain(letters, (350, 96), margin=0)
    target.write_text(embedded_svg(letters, 350, 96, contextual=True), encoding="utf-8")


def filled_icon(source):
    """White mark with every enclosed hole inside the ring filled black."""
    import numpy as np
    from scipy import ndimage
    labels, _ = ndimage.label(np.array(source.getchannel("A")) < 128)
    edge = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    holes = (labels > 0) & ~np.isin(labels, edge)
    # Grow under the antialiased edges so no transparent seam remains.
    holes = ndimage.binary_dilation(holes, iterations=3)
    filled = Image.new("RGBA", source.size, (0, 0, 0, 0))
    filled.paste((0, 0, 0, 255), mask=Image.fromarray((holes * 255).astype("uint8")))
    filled.alpha_composite(source)
    return filled


# Windows shell icons (exe, taskbar, file associations, jump list) read on
# any background.
ICON_FILLED = filled_icon(ICON_DARK)
ICON_FILLED.save(HERE / "LogoIconFilled.png", optimize=True)
ico = contain(ICON_FILLED, (256, 256), margin=0.02)
for relative in ["firefox.ico", "firefox64.ico", "document.ico", "document_pdf.ico",
                 "newtab.ico", "newwindow.ico", "pbmode.ico"]:
    save_asset(relative, ico, "ICO")

for relative in [
    "browser/themes/shared/preferences/category-librewolf.svg",
    "browser/themes/shared/sidebar/librewolf.svg",
]:
    target = ROOT / "nullpath/tree-overrides" / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(embedded_svg(contain(ICON, (64, 64), margin=0), 64, 64,
                                   contextual=True), encoding="utf-8")

for name, art in [("logo-mark-light.svg", ICON), ("logo-mark-dark.svg", ICON_DARK)]:
    target = ROOT / "nullpath/tree-overrides/browser/themes/shared/nullpath" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(embedded_svg(contain(art, (512, 512), margin=0), 512, 512), encoding="utf-8")
for name, art in [("logo-wordmark-light.svg", WORDMARK), ("logo-wordmark-dark.svg", WORDMARK_DARK)]:
    letters = art.crop((97, 906, 1102, 1182))
    letters = contain(letters, (350, 96), margin=0)
    target = ROOT / "nullpath/tree-overrides/browser/themes/shared/nullpath" / name
    target.write_text(embedded_svg(letters, 350, 96), encoding="utf-8")

print(f"Generated Nullpath branding assets in {OUT}")
