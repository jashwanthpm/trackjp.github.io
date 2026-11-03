from pathlib import Path
from PIL import Image

# Normalize the existing brand mark to a true RGBA PNG. Tauri's icon
# generator then produces platform-native .ico/.icns and PNG variants.
repo_root = Path(__file__).resolve().parents[2]
source = repo_root / "icon-512.png"
output = Path(__file__).resolve().parents[1] / "src-tauri" / "icon-source.png"
output.parent.mkdir(parents=True, exist_ok=True)

with Image.open(source) as original:
    image = original.convert("RGBA")
    if image.size != (1024, 1024):
        image = image.resize((1024, 1024), Image.Resampling.LANCZOS)
    image.save(output, format="PNG", optimize=True)

print(f"Prepared RGBA Tauri icon: {output} ({image.size})")
