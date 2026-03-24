from __future__ import annotations

import argparse
import json
import math
import random
import textwrap
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageFilter, ImageFont


WIDTH = 3840
HEIGHT = 2160


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
        "C:/Windows/Fonts/arialbd.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
    ],
    64,
)
BODY_FONT = find_font(
    [
        "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ],
    32,
)


def palette_for_pack(pack: dict) -> list[tuple[str, str, str]]:
    niche = pack["niche"].lower()
    if "warm monochrome" in niche:
        return [
            ("#F6F0E8", "#D7C7B3", "#8A7767"),
            ("#F3ECE4", "#CBBBA7", "#6F645A"),
            ("#EFE4D8", "#D8C2AE", "#9B8471"),
            ("#F6F1EB", "#C4B09B", "#746558"),
            ("#F2EAE1", "#D6C7B7", "#847364"),
            ("#F7F2EC", "#B7A899", "#6B6055"),
        ]
    return [
        ("#EEF1F6", "#C8D1E0", "#495569"),
        ("#F4F6F9", "#D8DEE8", "#5E6674"),
        ("#EEF2F7", "#BBC6D8", "#424B5A"),
        ("#F2F4F8", "#D0D5DF", "#707887"),
        ("#E9EDF3", "#CBD6E3", "#5B6778"),
        ("#F5F7FA", "#DCE2EA", "#7B8491"),
    ]


def apply_vertical_gradient(image: Image.Image, top_color: str, bottom_color: str) -> None:
    draw = ImageDraw.Draw(image)
    top_rgb = ImageColor.getrgb(top_color)
    bottom_rgb = ImageColor.getrgb(bottom_color)
    for y in range(HEIGHT):
        ratio = y / max(HEIGHT - 1, 1)
        color = tuple(
            int(top_rgb[index] + (bottom_rgb[index] - top_rgb[index]) * ratio)
            for index in range(3)
        )
        draw.line((0, y, WIDTH, y), fill=color)


def add_soft_shapes(image: Image.Image, accent_color: str, seed: int) -> None:
    random.seed(seed)
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for index in range(5):
        x0 = random.randint(-400, WIDTH - 600)
        y0 = random.randint(-300, HEIGHT - 300)
        width = random.randint(900, 1800)
        height = random.randint(500, 1100)
        alpha = random.randint(28, 64)
        accent = ImageColor.getrgb(accent_color)
        fill = (*accent, alpha)
        if index % 2 == 0:
            draw.rounded_rectangle((x0, y0, x0 + width, y0 + height), radius=80, fill=fill)
        else:
            draw.ellipse((x0, y0, x0 + width, y0 + height), fill=fill)

    for band in range(4):
        y = 220 + band * 360 + random.randint(-40, 40)
        draw.rounded_rectangle((220, y, WIDTH - 220, y + 32), radius=18, fill=(255, 255, 255, 30))

    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=70))
    image.alpha_composite(overlay)


def add_shadow_geometry(image: Image.Image, seed: int) -> None:
    random.seed(seed + 100)
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for index in range(3):
        width = random.randint(1200, 1800)
        height = random.randint(700, 1100)
        x0 = random.randint(-300, WIDTH - width + 300)
        y0 = random.randint(-120, HEIGHT - height + 120)
        alpha = 32 + index * 10
        draw.polygon(
            [
                (x0, y0 + height * 0.2),
                (x0 + width * 0.8, y0),
                (x0 + width, y0 + height * 0.65),
                (x0 + width * 0.2, y0 + height),
            ],
            fill=(255, 255, 255, alpha),
        )
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=110))
    image.alpha_composite(overlay)


def create_wallpaper(path: Path, palette: tuple[str, str, str], seed: int) -> None:
    image = Image.new("RGBA", (WIDTH, HEIGHT), palette[0])
    apply_vertical_gradient(image, palette[0], palette[1])
    add_soft_shapes(image, palette[2], seed)
    add_shadow_geometry(image, seed)
    image.convert("RGB").save(path, format="PNG")


def create_contact_sheet(source_paths: list[Path], out_path: Path) -> None:
    canvas = Image.new("RGB", (1800, 1200), "#F5F2ED")
    draw = ImageDraw.Draw(canvas)
    thumb_w = 520
    thumb_h = 292
    positions = [
        (120, 110),
        (680, 110),
        (1240, 110),
        (120, 520),
        (680, 520),
        (1240, 520),
    ]

    for index, position in enumerate(positions):
        sample = Image.open(source_paths[index]).convert("RGB").resize((thumb_w, thumb_h))
        canvas.paste(sample, position)
        draw.rounded_rectangle(
            (position[0], position[1], position[0] + thumb_w, position[1] + thumb_h),
            radius=28,
            outline="#8B7A68",
            width=4,
        )

    draw.text((120, 950), "Wallpaper preview sheet", font=TITLE_FONT, fill="#2B2722")
    draw.text((120, 1030), "Included in the Gumroad desktop background bundle.", font=BODY_FONT, fill="#726A61")
    canvas.save(out_path)


def create_cover(source_paths: list[Path], out_path: Path, title: str, subtitle: str, *, square: bool = False) -> None:
    width, height = (1200, 1200) if square else (1536, 1024)
    canvas = Image.new("RGB", (width, height), "#F7F3EE")
    draw = ImageDraw.Draw(canvas)
    card_w = 260 if not square else 230
    card_h = 170 if not square else 150
    gap = 36
    total_w = len(source_paths[:4]) * card_w + 3 * gap
    start_x = (width - total_w) // 2
    top_y = 140 if square else 160

    for index, path in enumerate(source_paths[:4]):
        thumb = Image.open(path).convert("RGB").resize((card_w, card_h))
        x = start_x + index * (card_w + gap)
        y = top_y
        canvas.paste(thumb, (x, y))
        draw.rounded_rectangle((x, y, x + card_w, y + card_h), radius=26, outline="#7D6C5B", width=4)

    title_font = find_font(
        [
            "C:/Windows/Fonts/georgiab.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
        ],
        50 if square else 56,
    )
    body_font = find_font(
        [
            "C:/Windows/Fonts/arial.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ],
        24 if square else 28,
    )

    title_lines = textwrap.wrap(title, width=26 if square else 34)
    current_y = 420 if square else 470
    for line in title_lines:
        draw.text((110, current_y), line, font=title_font, fill="#1F1B17")
        current_y += 66

    for line in textwrap.wrap(subtitle, width=44 if square else 56):
        draw.text((110, current_y + 10), line, font=body_font, fill="#6B625B")
        current_y += 38

    badge_text = "High-resolution PNG wallpapers"
    draw.rounded_rectangle((110, height - 150, 740 if not square else 760, height - 82), radius=26, fill="#8A7767")
    draw.text((145, height - 130), badge_text, font=body_font, fill="#F7F3EE")
    canvas.save(out_path)


def write_license(out_path: Path) -> None:
    out_path.write_text(
        "\n".join(
            [
                "ImonEngine wallpaper license",
                "",
                "You may use these wallpapers on personal and client-owned devices or streams.",
                "You may not resell, redistribute, or bundle the source files as a competing wallpaper pack.",
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
    (pack_dir / "listing.md").write_text("\n".join(listing_lines) + "\n", encoding="utf-8")
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
    (pack_dir / "gumroad" / "product-draft.md").write_text("\n".join(draft_lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pack-dir", required=True)
    args = parser.parse_args()

    pack_dir = Path(args.pack_dir).resolve()
    manifest_path = pack_dir / "manifest.json"
    pack = json.loads(manifest_path.read_text(encoding="utf-8"))

    wallpapers_dir = pack_dir / "assets" / "final" / "wallpapers"
    covers_dir = pack_dir / "covers"
    gumroad_dir = pack_dir / "gumroad"
    product_files_dir = gumroad_dir / "product-files"
    for directory in [wallpapers_dir, covers_dir, gumroad_dir, product_files_dir]:
      directory.mkdir(parents=True, exist_ok=True)

    wallpapers: list[Path] = []
    palettes = palette_for_pack(pack)
    for index in range(pack["packSize"]):
        palette = palettes[index % len(palettes)]
        out_path = wallpapers_dir / f"{pack['id']}-wallpaper-{index + 1:02d}.png"
        create_wallpaper(out_path, palette, seed=index + 1)
        wallpapers.append(out_path)

    contact_sheet = product_files_dir / "preview-contact-sheet.png"
    create_contact_sheet(wallpapers, contact_sheet)

    cover_one = covers_dir / "cover-01.png"
    cover_two = covers_dir / "cover-02.png"
    thumb = covers_dir / "thumbnail-square.png"
    create_cover(
        wallpapers[:4],
        cover_one,
        pack["title"],
        "A calm wallpaper bundle for focused desktops and soft, low-noise screens.",
        square=False,
    )
    create_cover(
        wallpapers[4:8],
        cover_two,
        "Desktop Background Pack",
        "Designed for clean setups, studio machines, and daily work.",
        square=False,
    )
    create_cover(
        wallpapers[:4],
        thumb,
        pack["title"],
        "High-resolution PNG wallpapers.",
        square=True,
    )

    license_path = product_files_dir / "LICENSE.txt"
    write_license(license_path)

    zip_path = gumroad_dir / f"{pack['id']}.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(contact_sheet, arcname=contact_sheet.name)
        archive.write(license_path, arcname=license_path.name)
        for wallpaper in wallpapers:
            archive.write(wallpaper, arcname=f"wallpapers/{wallpaper.name}")

    suggested_price = 9
    pack.update(
        {
            "deliverables": [
                f"{pack['packSize']} desktop wallpapers in PNG format",
                "Preview contact sheet",
                "2 Gumroad cover images and 1 square thumbnail",
                "Simple wallpaper license note",
            ],
            "suggestedPrice": suggested_price,
            "priceVariants": [7, suggested_price, 12],
            "tags": [
                "desktop wallpaper",
                "minimal wallpaper",
                "gumroad digital download",
                "4k background pack",
                "creative workspace wallpaper" if "warm monochrome" in pack["niche"].lower() else "productivity background",
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
                "wallpaperCount": len(wallpapers),
                "contactSheet": str(contact_sheet),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
