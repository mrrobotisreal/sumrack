#!/usr/bin/env bash
# T91 art cut: split Mitch's elevator PNG into the lift's layers.
# Re-runnable: `bash apps/mobile/scripts/hotel-cut-doors.sh [source.png]`.
# Source default: the workspace asset (824x1342, Chrysler brass fan doors).
#
# Opening (measured on the source): x 112..712, y 120..1300. The centre seam
# is x 412, so left = [112,412) and right = [412,712): the halves meet with
# no gap and no overlap. Everything is cut at three densities for a 390 dp
# frame (@1x = 390 px, @2x = 780, @3x = 1170), exported as WebP q85.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MOBILE="$(cd "$HERE/.." && pwd)"
SRC="${1:-$MOBILE/../../../assets/elevator_doors.png}"
OUT="$MOBILE/assets/images/hotel"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

command -v magick >/dev/null || { echo "magick not found" >&2; exit 1; }
mkdir -p "$OUT"

SRC_W=824
SRC_H=1342
OPEN_X=112
OPEN_Y=120
OPEN_W=600
OPEN_H=1180
SEAM_X=412

# Alpha mask: opaque everywhere except the door opening, which becomes clear.
magick -size "${SRC_W}x${SRC_H}" xc:white -fill black \
  -draw "rectangle ${OPEN_X},${OPEN_Y} $((OPEN_X + OPEN_W - 1)),$((OPEN_Y + OPEN_H - 1))" \
  "$WORK/mask.png"

for k in 1 2 3; do
  W=$((390 * k))
  # Scale factor from the source pixels to this density.
  read -r X Y OW OH SX SEAMX < <(awk -v w="$W" -v s="$SRC_W" \
    -v ox="$OPEN_X" -v oy="$OPEN_Y" -v ow="$OPEN_W" -v oh="$OPEN_H" -v seam="$SEAM_X" \
    'BEGIN { f = w / s; printf "%d %d %d %d %.6f %d\n", ox*f+0.5, oy*f+0.5, ow*f+0.5, oh*f+0.5, f, seam*f+0.5 }')
  LEFT_W=$((SEAMX - X))
  RIGHT_W=$((X + OW - SEAMX))
  SUFFIX="@${k}x"

  # Frame: the full image scaled to W, opening made transparent.
  magick "$SRC" -resize "${W}x" "$WORK/scaled$k.png"
  magick "$WORK/scaled$k.png" \( "$WORK/mask.png" -resize "${W}x" \) \
    -alpha off -compose CopyOpacity -composite -quality 85 "$OUT/frame$SUFFIX.webp"

  # Doors: the opening split at the seam (two halves).
  magick "$WORK/scaled$k.png" -crop "${LEFT_W}x${OH}+${X}+${Y}" +repage -quality 85 "$OUT/door-left$SUFFIX.webp"
  magick "$WORK/scaled$k.png" -crop "${RIGHT_W}x${OH}+${SEAMX}+${Y}" +repage -quality 85 "$OUT/door-right$SUFFIX.webp"

  # Car: dark interior gradient with a faint brass light at the top.
  magick -size "${OW}x${OH}" gradient:'#1a0f0a-#0b0705' "$WORK/car$k.png"
  # Glow: a radial centred on the top edge, rendered at 2x height and cropped to the
  # top half (the bright centre sits on the top edge) so it fades over the full car height (no hard bottom edge).
  magick -size "${OW}x$((OH * 2))" radial-gradient:'rgba(200,150,80,0.22)-rgba(200,150,80,0)' \
    -crop "${OW}x${OH}+0+${OH}" +repage "$WORK/glow$k.png"
  magick "$WORK/car$k.png" "$WORK/glow$k.png" -compose screen -composite -quality 85 "$OUT/car$SUFFIX.webp"
done

du -ch "$OUT"/*.webp | tail -1
