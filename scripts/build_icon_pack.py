from __future__ import annotations

import argparse
import json
import math
import textwrap
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageFilter, ImageFont


ICON_SIZE = 512
BASE_CONCEPTS = ["home", "user", "mail", "search", "chart", "settings", "lock", "rocket", "cloud", "folder"]
VARIANTS = [
    ("pearl", "#F5F7FA", "#D7DEE9", "#4C5868"),
    ("smoke", "#EEF2F5", "#C2CBD6", "#2E3642"),
    ("cobalt", "#EEF3FF", "#AFC2F5", "#3856A4"),
    ("amber", "#FFF5E8", "#F0C388", "#96612B"),
    ("mint", "#ECFAF5", "#9ED9C3", "#2B7B65"),
    ("blush", "#FFF1F3", "#F0BCC4", "#A14C63"),
    ("graphite", "#F1F3F6", "#BBC3CF", "#434B57"),
    ("frost", "#F7F9FB", "#D8E4EF", "#61748A"),
]


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


def draw_background(draw: ImageDraw.ImageDraw, palette: tuple[str, str, str, str]) -> None:
    _, background, secondary, _ = palette
    draw.rounded_rectangle((48, 48, 464, 464), radius=126, fill=background)
    draw.rounded_rectangle((68, 68, 444, 444), radius=108, outline=secondary, width=10)


def draw_home(draw: ImageDraw.ImageDraw, color: str, secondary: str) -> None:
    draw.polygon([(150, 250), (256, 150), (362, 250)], outline=color, width=26)
    draw.rounded_rectangle((182, 250, 330, 356), radius=18, outline=color, width=26)
    draw.rounded_rectangle((238, 286, 274, 356), radius=12, fill=secondary)


def draw_user(draw: ImageDraw.ImageDraw, color: str, secondary: str) -> None:
    draw.ellipse((184, 126, 328, 270), outline=color, width=24)
    draw.arc((132, 238, 380, 402), start=200, end=340, fill=color, width=24)
    draw.arc((160, 252, 352, 392), start=205, end=335, fill=secondary, width=12)


def draw_mail(draw: ImageDraw.ImageDraw, color: str, secondary: str) -> None:
    draw.rounded_rectangle((128, 164, 384, 340), radius=24, outline=color, width=24)
    draw.line((144, 186, 256, 270, 368, 186), fill=color, width=24)
    draw.line((148, 324, 232, 250), fill=secondary, width=16)
    draw.line((364, 324, 280, 250), fill=secondary, width=16)


def draw_search(draw: ImageDraw.ImageDraw, color: str, secondary: str) -> None:
    draw.ellipse((146, 124, 322, 300), outline=color, width=26)
    draw.line((300, 276, 376, 352), fill=color, width=30)
    draw.arc((172, 150, 296, 274), start=210, end=320, fill=secondary, width=12)


def draw_chart(draw: ImageDraw.ImageDraw, color: str, secondary: str) -> None:
    bars = [(146, 244, 198, 356), (224, 198, 276, 356), (302, 146, 354, 356)]
    for left, top, right, bottom in bars:
        draw.rounded_rectangle((left, top, right, bottom), radius=14, fill=secondary)
    draw.line((136, 324, 224, 252, 278, 286, 364, 178), fill=color, width=22, joint="curve")


def draw_settings(draw: ImageDraw.ImageDraw, color: str, secondary: str) -> None:
    draw.ellipse((178, 178, 334, 334), outline=color, width=22)
    draw.ellipse((228, 228, 284, 284), fill=secondary)
    for index in range(8):
        angle = math.radians(index * 45)
        x0 = 256 + math.cos(angle) * 126
        y0 = 256 + math.sin(angle) * 126
        x1 = 256 + math.cos(angle) * 166
        y1 = 256 + math.sin(angle) * 166
        draw.line((x0, y0, x1, y1), fill=color, width=18)


def draw_lock(draw: ImageDraw.ImageDraw, color: str, secondary: str) -> None:
    draw.arc((172, 118, 340, 290), start=180, end=360, fill=color, width=24)
    draw.rounded_rectangle((150, 236, 362, 378), radius=28, outline=color, width=24)
    draw.ellipse((232, 280, 280, 328), fill=secondary)
    draw.rounded_rectangle((246, 316, 266, 356), radius=8, fill=secondary)


def draw_rocket(draw: ImageDraw.ImageDraw, color: str, secondary: str) -> None:
    draw.polygon([(256, 120), (332, 252), (256, 388), (180, 252)], outline=color, width=22)
    draw.ellipse((226, 196, 286, 256), fill=secondary)
    draw.polygon([(180, 252), (140, 314), (202, 306)], fill=secondary)
    draw.polygon([(332, 252), (372, 314), (310, 306)], fill=secondary)
    draw.polygon([(238, 388), (274, 388), (256, 430)], fill=color)


def draw_cloud(draw: ImageDraw.ImageDraw, color: str, secondary: str) -> None:
    draw.ellipse((148, 220, 268, 320), fill=secondary)
    draw.ellipse((216, 180, 336, 320), fill=secondary)
    draw.ellipse((292, 220, 396, 320), fill=secondary)
    draw.rounded_rectangle((168, 258, 370, 340), radius=32, outline=color, width=20)
    draw.arc((142, 212, 266, 322), start=180, end=360, fill=color, width=20)
    draw.arc((214, 172, 338, 322), start=180, end=360, fill=color, width=20)
    draw.arc((290, 212, 394, 322), start=180, end=360, fill=color, width=20)


def draw_folder(draw: ImageDraw.ImageDraw, color: str, secondary: str) -> None:
    draw.rounded_rectangle((128, 184, 392, 356), radius=28, outline=color, width=22)
    draw.rounded_rectangle((150, 150, 260, 214), radius=18, fill=secondary)
    draw.line((158, 214, 382, 214), fill=color, width=20)


DRAWERS = {
    "home": draw_home,
    "user": draw_user,
    "mail": draw_mail,
    "search": draw_search,
    "chart": draw_chart,
    "settings": draw_settings,
    "lock": draw_lock,
    "rocket": draw_rocket,
    "cloud": draw_cloud,
    "folder": draw_folder,
}


SVG_SHAPES = {
    "home": """
<path d="M150 250 L256 150 L362 250" stroke="{stroke}" stroke-width="24" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="182" y="250" width="148" height="106" rx="18" stroke="{stroke}" stroke-width="24" fill="none"/>
<rect x="238" y="286" width="36" height="70" rx="10" fill="{secondary}"/>
""",
    "user": """
<circle cx="256" cy="198" r="72" stroke="{stroke}" stroke-width="24" fill="none"/>
<path d="M150 336 C176 282 220 254 256 254 C292 254 336 282 362 336" stroke="{stroke}" stroke-width="24" fill="none" stroke-linecap="round"/>
<path d="M174 338 C200 294 230 278 256 278 C282 278 312 294 338 338" stroke="{secondary}" stroke-width="12" fill="none" stroke-linecap="round"/>
""",
    "mail": """
<rect x="128" y="164" width="256" height="176" rx="24" stroke="{stroke}" stroke-width="24" fill="none"/>
<path d="M144 186 L256 270 L368 186" stroke="{stroke}" stroke-width="24" fill="none" stroke-linecap="round"/>
<path d="M148 324 L232 250" stroke="{secondary}" stroke-width="16" fill="none" stroke-linecap="round"/>
<path d="M364 324 L280 250" stroke="{secondary}" stroke-width="16" fill="none" stroke-linecap="round"/>
""",
    "search": """
<circle cx="234" cy="212" r="88" stroke="{stroke}" stroke-width="26" fill="none"/>
<path d="M300 278 L376 354" stroke="{stroke}" stroke-width="30" fill="none" stroke-linecap="round"/>
<path d="M176 190 C196 160 236 146 280 164" stroke="{secondary}" stroke-width="12" fill="none" stroke-linecap="round"/>
""",
    "chart": """
<rect x="146" y="244" width="52" height="112" rx="14" fill="{secondary}"/>
<rect x="224" y="198" width="52" height="158" rx="14" fill="{secondary}"/>
<rect x="302" y="146" width="52" height="210" rx="14" fill="{secondary}"/>
<path d="M136 324 L224 252 L278 286 L364 178" stroke="{stroke}" stroke-width="22" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
""",
    "settings": """
<circle cx="256" cy="256" r="78" stroke="{stroke}" stroke-width="22" fill="none"/>
<circle cx="256" cy="256" r="28" fill="{secondary}"/>
<path d="M256 90 L256 128 M256 384 L256 422 M90 256 L128 256 M384 256 L422 256 M146 146 L172 172 M340 340 L366 366 M366 146 L340 172 M146 366 L172 340" stroke="{stroke}" stroke-width="18" stroke-linecap="round"/>
""",
    "lock": """
<path d="M172 204 C172 148 208 118 256 118 C304 118 340 148 340 204" stroke="{stroke}" stroke-width="24" fill="none" stroke-linecap="round"/>
<rect x="150" y="236" width="212" height="142" rx="28" stroke="{stroke}" stroke-width="24" fill="none"/>
<circle cx="256" cy="304" r="24" fill="{secondary}"/>
<rect x="246" y="316" width="20" height="40" rx="8" fill="{secondary}"/>
""",
    "rocket": """
<path d="M256 120 C312 172 332 220 332 252 C332 320 288 374 256 388 C224 374 180 320 180 252 C180 220 200 172 256 120Z" stroke="{stroke}" stroke-width="22" fill="none"/>
<circle cx="256" cy="226" r="28" fill="{secondary}"/>
<path d="M180 252 L140 314 L202 306Z" fill="{secondary}"/>
<path d="M332 252 L372 314 L310 306Z" fill="{secondary}"/>
<path d="M238 388 L274 388 L256 430Z" fill="{stroke}"/>
""",
    "cloud": """
<circle cx="208" cy="270" r="62" fill="{secondary}"/>
<circle cx="276" cy="238" r="70" fill="{secondary}"/>
<circle cx="340" cy="270" r="54" fill="{secondary}"/>
<path d="M168 336 H370" stroke="{stroke}" stroke-width="20" stroke-linecap="round"/>
<path d="M148 270 C150 236 178 214 210 214 C224 184 252 168 280 168 C314 168 344 188 354 220 C380 222 400 242 400 270" stroke="{stroke}" stroke-width="20" fill="none" stroke-linecap="round"/>
""",
    "folder": """
<rect x="128" y="184" width="264" height="172" rx="28" stroke="{stroke}" stroke-width="22" fill="none"/>
<path d="M150 184 V168 C150 156 160 150 172 150 H244 C252 150 258 152 264 158 L282 184" fill="{secondary}"/>
<path d="M158 214 H382" stroke="{stroke}" stroke-width="20" stroke-linecap="round"/>
""",
}


def render_png(concept: str, palette: tuple[str, str, str, str], out_path: Path) -> None:
    _, background, secondary, stroke = palette
    image = Image.new("RGBA", (ICON_SIZE, ICON_SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw_background(draw, palette)
    highlight = Image.new("RGBA", image.size, (0, 0, 0, 0))
    highlight_draw = ImageDraw.Draw(highlight)
    highlight_draw.ellipse((88, 74, 408, 244), fill=(255, 255, 255, 44))
    highlight = highlight.filter(ImageFilter.GaussianBlur(radius=24))
    image.alpha_composite(highlight)
    DRAWERS[concept](draw, stroke, secondary)
    image.convert("RGB").save(out_path, format="PNG")


def render_svg(concept: str, palette: tuple[str, str, str, str], out_path: Path) -> None:
    _, background, secondary, stroke = palette
    markup = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{ICON_SIZE}" height="{ICON_SIZE}" viewBox="0 0 {ICON_SIZE} {ICON_SIZE}" fill="none">
  <rect x="48" y="48" width="416" height="416" rx="126" fill="{background}"/>
  <rect x="68" y="68" width="376" height="376" rx="108" stroke="{secondary}" stroke-width="10"/>
  <ellipse cx="248" cy="160" rx="160" ry="84" fill="white" fill-opacity="0.22"/>
  {SVG_SHAPES[concept].format(stroke=stroke, secondary=secondary)}
</svg>
"""
    out_path.write_text(markup, encoding="utf-8")


def create_preview_board(source_paths: list[Path], out_path: Path) -> None:
    canvas = Image.new("RGB", (1800, 1200), "#F5F7FA")
    draw = ImageDraw.Draw(canvas)
    positions = [
        (120, 120), (420, 120), (720, 120), (1020, 120), (1320, 120),
        (120, 420), (420, 420), (720, 420), (1020, 420), (1320, 420),
    ]
    for index, position in enumerate(positions):
        sample = Image.open(source_paths[index]).convert("RGB").resize((240, 240))
        canvas.paste(sample, position)
    draw.text((120, 760), "Icon preview board", font=TITLE_FONT, fill="#1F2430")
    draw.text((120, 840), "PNG and SVG assets for product interfaces, launches, and UI systems.", font=BODY_FONT, fill="#5E6776")
    canvas.save(out_path)


def create_cover(source_paths: list[Path], out_path: Path, title: str, subtitle: str, *, square: bool = False) -> None:
    width, height = (1200, 1200) if square else (1536, 1024)
    canvas = Image.new("RGB", (width, height), "#F7F9FB")
    draw = ImageDraw.Draw(canvas)
    thumb_size = 160 if square else 180
    gap = 34
    total_w = thumb_size * 4 + gap * 3
    start_x = (width - total_w) // 2
    top_y = 120 if square else 140
    for index, path in enumerate(source_paths[:4]):
        sample = Image.open(path).convert("RGB").resize((thumb_size, thumb_size))
        x = start_x + index * (thumb_size + gap)
        canvas.paste(sample, (x, top_y))

    title_lines = textwrap.wrap(title, width=26 if square else 34)
    current_y = 390 if square else 420
    for line in title_lines:
        draw.text((110, current_y), line, font=TITLE_FONT, fill="#1C222B")
        current_y += 66

    for line in textwrap.wrap(subtitle, width=42 if square else 54):
        draw.text((110, current_y + 10), line, font=BODY_FONT, fill="#637081")
        current_y += 38

    draw.rounded_rectangle((110, height - 150, 700, height - 80), radius=24, fill="#42556D")
    draw.text((145, height - 128), "80 icons in PNG and SVG", font=BODY_FONT, fill="#F5F7FA")
    canvas.save(out_path)


def write_license(out_path: Path) -> None:
    out_path.write_text(
        "\n".join(
            [
                "ImonEngine icon license",
                "",
                "You may use these icons in your own projects and in client work.",
                "You may modify, recolor, and combine them into shipped interfaces.",
                "You may not resell or redistribute the original icon source files as a competing icon pack.",
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
    manifest_path = pack_dir / "manifest.json"
    pack = json.loads(manifest_path.read_text(encoding="utf-8"))

    png_dir = pack_dir / "assets" / "final" / "png"
    svg_dir = pack_dir / "assets" / "final" / "svg"
    covers_dir = pack_dir / "covers"
    gumroad_dir = pack_dir / "gumroad"
    product_files_dir = gumroad_dir / "product-files"
    for directory in [png_dir, svg_dir, covers_dir, gumroad_dir, product_files_dir]:
        directory.mkdir(parents=True, exist_ok=True)

    rendered_pngs: list[Path] = []
    all_entries: list[tuple[str, tuple[str, str, str, str]]] = []
    for concept in BASE_CONCEPTS:
        for variant in VARIANTS:
            all_entries.append((concept, variant))

    for concept, palette in all_entries:
        variant_name = palette[0]
        base_name = f"{concept}-{variant_name}"
        png_path = png_dir / f"{base_name}.png"
        svg_path = svg_dir / f"{base_name}.svg"
        render_png(concept, palette, png_path)
        render_svg(concept, palette, svg_path)
        rendered_pngs.append(png_path)

    preview_board = product_files_dir / "icon-preview-board.png"
    create_preview_board(rendered_pngs, preview_board)

    cover_one = covers_dir / "cover-01.png"
    cover_two = covers_dir / "cover-02.png"
    thumb = covers_dir / "thumbnail-square.png"
    subtitle = str(pack.get("shortDescription", "Modern icon assets for dashboards, SaaS UI, and launch materials."))
    create_cover(rendered_pngs[:4], cover_one, pack["title"], subtitle, square=False)
    create_cover(rendered_pngs[4:8], cover_two, pack["title"], "Eight frosted variants across ten product-ready concepts.", square=False)
    create_cover(rendered_pngs[:4], thumb, pack["title"], f"{pack['packSize']} icons in PNG and SVG.", square=True)

    license_path = product_files_dir / "LICENSE.txt"
    write_license(license_path)

    zip_path = gumroad_dir / f"{slugify(str(pack['title']))}.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(preview_board, arcname=preview_board.name)
        archive.write(license_path, arcname=license_path.name)
        for png in png_dir.glob("*.png"):
            archive.write(png, arcname=f"png/{png.name}")
        for svg in svg_dir.glob("*.svg"):
            archive.write(svg, arcname=f"svg/{svg.name}")

    pack.update(
        {
            "deliverables": [
                "80 icons in PNG format",
                "80 icons in SVG format",
                "Preview board image",
                "2 Gumroad cover images and 1 square thumbnail",
                "Simple icon license note",
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
                "iconCount": len(rendered_pngs),
                "previewBoard": str(preview_board),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
