from __future__ import annotations

import argparse
import json
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def find_font(candidates: list[str], size: int):
    for candidate in candidates:
        path = Path(candidate)
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


TITLE_FONT = find_font(
    [
        "C:/Windows/Fonts/georgiab.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
    ],
    48,
)
BODY_FONT = find_font(
    [
        "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ],
    28,
)


def find_cover(pack_dir: Path) -> Path | None:
    covers_dir = pack_dir / "covers"
    if not covers_dir.exists():
        return None

    candidates = sorted(
        path
        for path in covers_dir.iterdir()
        if path.is_file() and path.name.lower().startswith("cover-") and path.suffix.lower() in {".png", ".jpg", ".jpeg"}
    )
    return candidates[0] if candidates else None


def create_teaser(source: Path, out_path: Path, title: str, subtitle: str, *, size: tuple[int, int]) -> None:
    width, height = size
    canvas = Image.new("RGB", (width, height), "#F6F4F0")
    draw = ImageDraw.Draw(canvas)
    preview = Image.open(source).convert("RGB")
    preview.thumbnail((width - 120, int(height * 0.52)))
    preview_x = (width - preview.width) // 2
    preview_y = 80
    canvas.paste(preview, (preview_x, preview_y))

    current_y = preview_y + preview.height + 50
    for line in textwrap.wrap(title, width=26 if width < 1200 else 38):
        draw.text((60, current_y), line, font=TITLE_FONT, fill="#1E1B18")
        current_y += 58
    for line in textwrap.wrap(subtitle, width=36 if width < 1200 else 56):
        draw.text((60, current_y + 10), line, font=BODY_FONT, fill="#6C655E")
        current_y += 36

    draw.rounded_rectangle((60, height - 120, 360, height - 56), radius=22, fill="#8A7767")
    draw.text((92, height - 100), "Available on Gumroad", font=BODY_FONT, fill="#F6F4F0")
    canvas.save(out_path)


def build_caption(pack: dict) -> str:
    return "\n".join(
        [
            pack["title"],
            "",
            pack["shortDescription"],
            "",
            f"Price test: ${pack['suggestedPrice']}",
            f"Link: {pack.get('productUrl', 'Publish on Gumroad next')}",
        ]
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-file", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    state_file = Path(args.state_file).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    packs = json.loads(state_file.read_text(encoding="utf-8"))
    marketing_manifest: list[dict[str, str]] = []

    for pack in packs:
        if pack["status"] not in {"published", "ready_for_upload"}:
            continue

        pack_dir = Path(pack["outputDir"])
        cover = find_cover(pack_dir)
        if cover is None:
            continue

        pack_output = output_dir / pack["id"]
        pack_output.mkdir(parents=True, exist_ok=True)
        landscape = pack_output / "teaser-landscape.png"
        square = pack_output / "teaser-square.png"
        story = pack_output / "teaser-story.png"
        create_teaser(cover, landscape, pack["title"], pack["shortDescription"], size=(1600, 900))
        create_teaser(cover, square, pack["title"], pack["shortDescription"], size=(1200, 1200))
        create_teaser(cover, story, pack["title"], pack["shortDescription"], size=(1080, 1920))

        caption_path = pack_output / "captions.md"
        caption_path.write_text(build_caption(pack) + "\n", encoding="utf-8")

        marketing_manifest.append(
            {
                "packId": pack["id"],
                "title": pack["title"],
                "landscape": str(landscape),
                "square": str(square),
                "story": str(story),
                "captions": str(caption_path),
            }
        )

    (output_dir / "manifest.json").write_text(json.dumps(marketing_manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"outputDir": str(output_dir), "assetCount": len(marketing_manifest)}, indent=2))


if __name__ == "__main__":
    main()
