from __future__ import annotations

import argparse
import json
import random
import textwrap
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageChops, ImageColor, ImageDraw, ImageFilter, ImageFont


TEXTURE_SIZE = 2048


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


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
    56,
)
BODY_FONT = find_font(
    [
        "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ],
    28,
)


def slugify(value: str) -> str:
    return "-".join("".join(ch.lower() if ch.isalnum() else " " for ch in value).split())


PALETTES = [
    ("#F2EDE6", "#DDD0C2", "#B89E85"),
    ("#F4F1EC", "#D7CCC0", "#A58D79"),
    ("#EEE7DE", "#D1C2B0", "#9A8371"),
    ("#F7F3EE", "#D5C8BB", "#B49C84"),
    ("#EFEAE2", "#CBC0B5", "#8C7A69"),
    ("#F3EEE8", "#D2C7BB", "#AA9584"),
]


def make_noise(seed: int, accent: tuple[int, int, int]) -> Image.Image:
    random.seed(seed)
    image = Image.new("RGB", (TEXTURE_SIZE, TEXTURE_SIZE), color=accent)
    pixels = image.load()
    for y in range(TEXTURE_SIZE):
        for x in range(TEXTURE_SIZE):
            jitter = random.randint(-20, 20)
            base = pixels[x, y]
            pixels[x, y] = tuple(max(0, min(255, channel + jitter)) for channel in base)
    return image


def add_fiber_lines(image: Image.Image, seed: int, line_color: str) -> None:
    random.seed(seed + 100)
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for _ in range(180):
        x = random.randint(0, TEXTURE_SIZE)
        y = random.randint(0, TEXTURE_SIZE)
        width = random.randint(120, 480)
        curve = random.randint(-80, 80)
        draw.line(
            (x, y, min(TEXTURE_SIZE, x + width), max(0, min(TEXTURE_SIZE, y + curve))),
            fill=(*ImageColor.getrgb(line_color), random.randint(10, 22)),
            width=random.randint(1, 3),
        )
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=2))
    image.alpha_composite(overlay)


def add_soft_blocks(image: Image.Image, seed: int, accent_color: str) -> None:
    random.seed(seed + 200)
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for _ in range(10):
        x0 = random.randint(-200, TEXTURE_SIZE - 300)
        y0 = random.randint(-200, TEXTURE_SIZE - 300)
        width = random.randint(300, 900)
        height = random.randint(260, 720)
        draw.rounded_rectangle(
            (x0, y0, x0 + width, y0 + height),
            radius=random.randint(40, 120),
            fill=(*ImageColor.getrgb(accent_color), random.randint(12, 26)),
        )
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=36))
    image.alpha_composite(overlay)


def make_seamless(image: Image.Image) -> Image.Image:
    offset = ImageChops.offset(image.convert("RGB"), TEXTURE_SIZE // 2, TEXTURE_SIZE // 2)
    mask = Image.new("L", (TEXTURE_SIZE, TEXTURE_SIZE), color=0)
    draw = ImageDraw.Draw(mask)
    draw.rectangle((TEXTURE_SIZE // 2 - 120, 0, TEXTURE_SIZE // 2 + 120, TEXTURE_SIZE), fill=255)
    draw.rectangle((0, TEXTURE_SIZE // 2 - 120, TEXTURE_SIZE, TEXTURE_SIZE // 2 + 120), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=80))
    base = image.convert("RGB")
    return Image.composite(base, offset, mask)


def create_texture(out_path: Path, palette: tuple[str, str, str], seed: int) -> None:
    background, accent, fiber = palette
    base = make_noise(seed, ImageColor.getrgb(background)).convert("RGBA")
    add_soft_blocks(base, seed, accent)
    add_fiber_lines(base, seed, fiber)
    seamless = make_seamless(base)
    seamless.save(out_path, format="PNG")


def create_preview_sheet(source_paths: list[Path], out_path: Path) -> None:
    canvas = Image.new("RGB", (1800, 1200), "#F7F3EE")
    draw = ImageDraw.Draw(canvas)
    positions = [
        (120, 120), (660, 120), (1200, 120),
        (120, 520), (660, 520), (1200, 520),
    ]
    for index, position in enumerate(positions):
        sample = Image.open(source_paths[index]).convert("RGB").resize((420, 280))
        canvas.paste(sample, position)
        draw.rounded_rectangle(
            (position[0], position[1], position[0] + 420, position[1] + 280),
            radius=24,
            outline="#A48F7D",
            width=4,
        )
    draw.text((120, 930), "Texture preview sheet", font=TITLE_FONT, fill="#241E1A")
    draw.text((120, 1010), "Built for layered graphics, decks, mockups, and visual systems.", font=BODY_FONT, fill="#71675E")
    canvas.save(out_path)


def create_cover(source_paths: list[Path], out_path: Path, title: str, subtitle: str, *, square: bool = False) -> None:
    width, height = (1200, 1200) if square else (1536, 1024)
    canvas = Image.new("RGB", (width, height), "#F7F2EC")
    draw = ImageDraw.Draw(canvas)
    thumb_w = 240 if square else 260
    thumb_h = 240 if square else 260
    gap = 36
    total_w = thumb_w * 4 + gap * 3
    start_x = (width - total_w) // 2
    top_y = 120 if square else 140
    for index, path in enumerate(source_paths[:4]):
        sample = Image.open(path).convert("RGB").resize((thumb_w, thumb_h))
        x = start_x + index * (thumb_w + gap)
        canvas.paste(sample, (x, top_y))
        draw.rounded_rectangle((x, y := top_y, x + thumb_w, y + thumb_h), radius=22, outline="#9E8772", width=4)

    title_lines = textwrap.wrap(title, width=26 if square else 34)
    current_y = 410 if square else 450
    for line in title_lines:
        draw.text((110, current_y), line, font=TITLE_FONT, fill="#211C18")
        current_y += 66
    for line in textwrap.wrap(subtitle, width=44 if square else 56):
        draw.text((110, current_y + 8), line, font=BODY_FONT, fill="#6E655C")
        current_y += 38

    draw.rounded_rectangle((110, height - 150, 730, height - 80), radius=24, fill="#9C846F")
    draw.text((145, height - 128), "36 seamless PNG textures", font=BODY_FONT, fill="#F7F2EC")
    canvas.save(out_path)


def write_license(out_path: Path) -> None:
    out_path.write_text(
        "\n".join(
            [
                "ImonEngine texture license",
                "",
                "You may use these textures in personal and client design work.",
                "You may overlay, crop, and recolor them in finished creative assets.",
                "You may not redistribute or resell the original texture files as a competing texture pack.",
            ]
        ),
        encoding="utf-8",
    )


def update_pack_state(pack_dir: Path, pack_data: dict) -> None:
    runtime_dir = pack_dir.parent.parent
    state_path = runtime_dir / "state" / "assetPacks.json"
    if not state_path.exists():
        return
    packs = json.loads(state_path.read_text(encoding="utf-8"))
    for index, candidate in enumerate(packs):
        if candidate.get("id") == pack_data["id"]:
            packs[index] = pack_data
            break
    state_path.write_text(json.dumps(packs, indent=2) + "\n", encoding="utf-8")


def write_pack_artifacts(pack_dir: Path, pack_data: dict) -> None:
    listing_lines = [
        f"# {pack_data['title']}",
        "",
        f"Marketplace: {pack_data['marketplace']}",
        f"Status: {pack_data['status']}",
        f"Suggested price: ${pack_data['suggestedPrice']}",
        f"Price test points: {', '.join(f'${value}' for value in pack_data['priceVariants'])}",
        "",
        "## Summary",
        pack_data["shortDescription"],
        "",
        "## Description",
        pack_data["description"],
        "",
        "## Deliverables",
        *[f"- {item}" for item in pack_data["deliverables"]],
        "",
        "## Tags",
        ", ".join(f"`{tag}`" for tag in pack_data["tags"]),
    ]
    draft_lines = [
        f"# {pack_data['title']}",
        "",
        f"Suggested price: ${pack_data['suggestedPrice']}",
        f"Price tests: {', '.join(f'${value}' for value in pack_data['priceVariants'])}",
        "",
        "## Short Description",
        pack_data["shortDescription"],
        "",
        "## Full Description",
        pack_data["description"],
        "",
        "## Deliverables",
        *[f"- {item}" for item in pack_data["deliverables"]],
        "",
        "## Tags",
        ", ".join(pack_data["tags"]),
    ]
    (pack_dir / "manifest.json").write_text(json.dumps(pack_data, indent=2) + "\n", encoding="utf-8")
    (pack_dir / "listing.md").write_text("\n".join(listing_lines) + "\n", encoding="utf-8")
    (pack_dir / "gumroad" / "product-draft.md").write_text("\n".join(draft_lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pack-dir", required=True)
    args = parser.parse_args()

    pack_dir = Path(args.pack_dir).resolve()
    pack = json.loads((pack_dir / "manifest.json").read_text(encoding="utf-8"))

    textures_dir = pack_dir / "assets" / "final" / "textures"
    covers_dir = pack_dir / "covers"
    gumroad_dir = pack_dir / "gumroad"
    product_files_dir = gumroad_dir / "product-files"
    for directory in [textures_dir, covers_dir, gumroad_dir, product_files_dir]:
        directory.mkdir(parents=True, exist_ok=True)

    textures: list[Path] = []
    for index in range(pack["packSize"]):
        palette = PALETTES[index % len(PALETTES)]
        out_path = textures_dir / f"{pack['id']}-texture-{index + 1:02d}.png"
        create_texture(out_path, palette, seed=index + 1)
        textures.append(out_path)

    preview_sheet = product_files_dir / "texture-preview-sheet.png"
    create_preview_sheet(textures, preview_sheet)

    cover_one = covers_dir / "cover-01.png"
    cover_two = covers_dir / "cover-02.png"
    thumb = covers_dir / "thumbnail-square.png"
    subtitle = str(pack.get("shortDescription", "Quiet texture overlays for decks, posters, and creator graphics."))
    create_cover(textures[:4], cover_one, pack["title"], subtitle, square=False)
    create_cover(textures[4:8], cover_two, pack["title"], "Seamless PNG textures for layered design work.", square=False)
    create_cover(textures[:4], thumb, pack["title"], f"{pack['packSize']} seamless PNG textures.", square=True)

    license_path = product_files_dir / "LICENSE.txt"
    write_license(license_path)

    zip_path = gumroad_dir / f"{slugify(str(pack['title']))}.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(preview_sheet, arcname=preview_sheet.name)
        archive.write(license_path, arcname=license_path.name)
        for texture in textures:
            archive.write(texture, arcname=f"textures/{texture.name}")

    pack.update(
        {
            "deliverables": [
                f"{pack['packSize']} seamless textures in PNG format",
                "Preview sheet image",
                "2 Gumroad cover images and 1 square thumbnail",
                "Simple texture license note",
            ],
            "status": "ready_for_upload",
            "updatedAt": now_iso(),
        }
    )

    write_pack_artifacts(pack_dir, pack)
    update_pack_state(pack_dir, pack)
    print(
        json.dumps(
            {
                "packId": pack["id"],
                "status": pack["status"],
                "zipPath": str(zip_path),
                "textureCount": len(textures),
                "previewSheet": str(preview_sheet),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
