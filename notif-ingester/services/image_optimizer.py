"""
Image Optimizer
---------------
Utility to downscale and compress images prior to sending them to Vision LLMs.
Reduces token usage, payload size, and latency while preserving text clarity.
"""

import io
import logging
from typing import Tuple

logger = logging.getLogger(__name__)


def optimize_image_for_ai(
    image_bytes: bytes,
    mime_type: str = "image/png",
    max_dimension: int = 1024,
    quality: int = 80,
) -> Tuple[bytes, str]:
    """
    Downscales and compresses image bytes prior to sending to vision AI / OCR.
    
    - Scales image so max(width, height) <= max_dimension (aspect ratio preserved).
    - Converts RGBA/P/LA transparency to white background for clean JPEG export.
    - Compresses to JPEG with specified quality.
    - If image decoding fails (e.g. invalid bytes/mock data), returns original bytes.
    """
    if not image_bytes:
        return image_bytes, mime_type

    try:
        from PIL import Image

        with Image.open(io.BytesIO(image_bytes)) as im:
            orig_width, orig_height = im.size
            orig_size = len(image_bytes)

            # 1. Downscale if either dimension exceeds max_dimension
            if max(orig_width, orig_height) > max_dimension:
                scale = max_dimension / max(orig_width, orig_height)
                new_width = max(1, int(orig_width * scale))
                new_height = max(1, int(orig_height * scale))
                im = im.resize((new_width, new_height), Image.Resampling.LANCZOS)
            else:
                new_width, new_height = orig_width, orig_height

            # 2. Handle transparency & color modes for JPEG export
            if im.mode in ("RGBA", "LA", "P"):
                # Paste onto white background to avoid dark artifacts
                im_rgba = im.convert("RGBA")
                background = Image.new("RGB", im_rgba.size, (255, 255, 255))
                background.paste(im_rgba, mask=im_rgba.split()[3])
                im = background
            elif im.mode != "RGB":
                im = im.convert("RGB")

            # 3. Export to JPEG buffer
            out_buf = io.BytesIO()
            im.save(out_buf, format="JPEG", quality=quality, optimize=True)
            compressed_bytes = out_buf.getvalue()

            logger.info(
                f"[ImageOptimizer] Optimized image for AI: "
                f"({orig_width}x{orig_height}, {orig_size / 1024:.1f}KB) -> "
                f"({new_width}x{new_height}, {len(compressed_bytes) / 1024:.1f}KB)"
            )
            return compressed_bytes, "image/jpeg"

    except Exception as e:
        logger.warning(f"[ImageOptimizer] Could not optimize image (fallback to original): {e}")
        return image_bytes, mime_type
