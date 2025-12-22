#!/usr/bin/env python3
"""
App 2: Fetch Instagram photo posts and analyze them with an AI vision provider.

Output CSV columns: original_url, description, category, tags, mood, status, error_message
"""

import argparse
import base64
import csv
import logging
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import requests
from dotenv import load_dotenv

try:
    import instaloader
except ImportError as exc:  # pragma: no cover - dependency should be present
    raise SystemExit("Instaloader is required. Please install dependencies from requirements.txt") from exc

try:
    from anthropic import Anthropic
except ImportError:
    Anthropic = None  # type: ignore

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None  # type: ignore

try:
    from tqdm import tqdm
except ImportError:  # pragma: no cover - optional
    tqdm = None

load_dotenv()


PROMPT = """Analyze this Instagram saved post image and provide structured information:

1. Description: Brief 1-2 sentence description of what's in the image
2. Category: Choose ONE primary category from: Fashion, Music/Studio, Interior Design, Food/Cooking, Nature/Outdoors, Art/Creative, Fitness/Wellness, Travel, Technology, Business, Education, Other
3. Tags: Provide 3-5 specific keywords/tags relevant to the image content
4. Mood: Describe the aesthetic/vibe in 1-3 words (e.g., moody, bright, minimal, cozy, industrial, etc.)

Format your response EXACTLY as:
Description: [your description]
Category: [category]
Tags: [tag1, tag2, tag3, tag4, tag5]
Mood: [mood description]
"""


@dataclass
class AnalysisResult:
    original_url: str
    description: str = ""
    category: str = ""
    tags: str = ""
    mood: str = ""
    status: str = "success"
    error_message: str = ""

    def to_row(self) -> List[str]:
        return [
            self.original_url,
            self.description,
            self.category,
            self.tags,
            self.mood,
            self.status,
            self.error_message,
        ]


def read_urls(path: Path) -> List[str]:
    urls: List[str] = []
    seen = set()
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            url = row.get("url") or row.get("original_url")
            if url:
                cleaned = url.strip()
                if cleaned and cleaned not in seen:
                    urls.append(cleaned)
                    seen.add(cleaned)
    return urls


def load_completed_rows(path: Path) -> Dict[str, AnalysisResult]:
    if not path.exists():
        return {}
    done: Dict[str, AnalysisResult] = {}
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            res = AnalysisResult(
                original_url=row.get("original_url", "").strip(),
                description=row.get("description", ""),
                category=row.get("category", ""),
                tags=row.get("tags", ""),
                mood=row.get("mood", ""),
                status=row.get("status", ""),
                error_message=row.get("error_message", ""),
            )
            if res.original_url:
                done[res.original_url] = res
    return done


def init_output(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(
            ["original_url", "description", "category", "tags", "mood", "status", "error_message"]
        )


def fetch_image_bytes(loader: "instaloader.Instaloader", url: str, timeout: int) -> bytes:
    try:
        shortcode = url.rstrip("/").split("/")[-1]
        post = instaloader.Post.from_shortcode(loader.context, shortcode)
        if post.is_video:
            raise ValueError("URL points to a video, not a photo")
        image_url = post.url
        resp = requests.get(image_url, timeout=timeout)
        resp.raise_for_status()
        return resp.content
    except Exception as exc:
        raise RuntimeError(f"Failed to fetch image: {exc}") from exc


def analyze_with_anthropic(image_bytes: bytes) -> Tuple[str, str, str, str]:
    if Anthropic is None:
        raise RuntimeError("Anthropic SDK not installed")
    client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    if not client.api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")

    model = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")
    encoded = base64.b64encode(image_bytes).decode("utf-8")
    message = client.messages.create(
        model=model,
        max_tokens=300,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": "image/jpeg", "data": encoded},
                    },
                    {"type": "text", "text": PROMPT},
                ],
            }
        ],
    )
    text = message.content[0].text if message.content else ""
    return parse_response_text(text)


def analyze_with_openai(image_bytes: bytes) -> Tuple[str, str, str, str]:
    if OpenAI is None:
        raise RuntimeError("OpenAI SDK not installed")
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")
    client = OpenAI(api_key=api_key)
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    encoded = base64.b64encode(image_bytes).decode("utf-8")
    completion = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": PROMPT},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{encoded}"}},
                ],
            }
        ],
        max_tokens=300,
    )
    if not completion.choices:
        raise RuntimeError("No choices returned from OpenAI")
    content_parts = completion.choices[0].message.content
    text = extract_text_from_openai_content(content_parts)
    return parse_response_text(text)


def extract_text_from_openai_content(content_parts) -> str:
    """Handle OpenAI SDK returning either a string or a list of typed content parts."""
    if isinstance(content_parts, str):
        return content_parts
    parts: List[str] = []
    for part in content_parts or []:
        if isinstance(part, str):
            parts.append(part)
        elif hasattr(part, "text"):
            parts.append(getattr(part, "text") or "")
        elif isinstance(part, dict):
            parts.append(part.get("text", ""))
    return " ".join(filter(None, parts))


def parse_response_text(text: str) -> Tuple[str, str, str, str]:
    description = ""
    category = ""
    tags = ""
    mood = ""
    for line in text.splitlines():
        if line.lower().startswith("description:"):
            description = line.split(":", 1)[1].strip()
        elif line.lower().startswith("category:"):
            category = line.split(":", 1)[1].strip()
        elif line.lower().startswith("tags:"):
            tags = line.split(":", 1)[1].strip().strip("[]")
        elif line.lower().startswith("mood:"):
            mood = line.split(":", 1)[1].strip()
    return description, category, tags, mood


def process_url(
    loader: "instaloader.Instaloader",
    url: str,
    provider: str,
    timeout: int,
) -> AnalysisResult:
    result = AnalysisResult(original_url=url)
    try:
        image_bytes = fetch_image_bytes(loader, url, timeout)
        if provider == "anthropic":
            description, category, tags, mood = analyze_with_anthropic(image_bytes)
        else:
            description, category, tags, mood = analyze_with_openai(image_bytes)
        result.description = description
        result.category = category
        result.tags = tags
        result.mood = mood
        result.status = "success"
    except Exception as exc:  # broad catch to continue processing
        result.status = "error"
        result.error_message = str(exc)
    return result


def save_result(path: Path, result: AnalysisResult) -> None:
    with path.open("a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(result.to_row())


def configure_instaloader(username: Optional[str], password: Optional[str]) -> "instaloader.Instaloader":
    loader = instaloader.Instaloader(download_pictures=False, quiet=True, download_videos=False)
    if username and password:
        try:
            loader.context.log("Logging in to Instagram...")
            loader.login(username, password)
        except Exception as exc:
            raise RuntimeError(f"Instagram login failed: {exc}") from exc
    return loader


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Analyze Instagram photo posts via AI vision and save structured metadata."
    )
    parser.add_argument("input_csv", type=Path, help="CSV containing Instagram URLs (url or original_url column)")
    parser.add_argument("--output", type=Path, help="Output CSV (default: analyzed_photos.csv next to input)")
    parser.add_argument("--provider", choices=["anthropic", "openai"], default="anthropic", help="AI provider")
    parser.add_argument("--sleep", type=float, default=2.0, help="Seconds to sleep between API calls")
    parser.add_argument("--log-file", type=Path, default=Path("analyze_images.log"), help="Path to write detailed logs")
    parser.add_argument("--timeout", type=int, default=int(os.getenv("REQUEST_TIMEOUT", "15")), help="Network timeout")
    parser.add_argument("--force", action="store_true", help="Reprocess URLs even if present in the output file")
    return parser.parse_args(argv)


def main(argv: List[str]) -> int:
    args = parse_args(argv)

    if not args.input_csv.exists():
        print(f"Error: {args.input_csv} not found", file=sys.stderr)
        return 1

    output_path = args.output or args.input_csv.with_name("analyzed_photos.csv")
    init_output(output_path)

    logging.basicConfig(
        filename=args.log_file,
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    urls = read_urls(args.input_csv)
    completed = load_completed_rows(output_path)

    username = os.getenv("INSTAGRAM_USERNAME")
    password = os.getenv("INSTAGRAM_PASSWORD")
    try:
        loader = configure_instaloader(username, password)
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    remaining: Iterable[str] = urls
    if not args.force:
        remaining = [url for url in urls if url not in completed]

    iterator = tqdm(remaining, desc="Processing") if tqdm else remaining
    processed = 0
    for url in iterator:
        processed += 1
        result = process_url(loader, url, provider=args.provider, timeout=args.timeout)
        save_result(output_path, result)
        logging.info("%s | %s", url, result.status if result.status else "unknown")
        if result.status == "error":
            logging.info("Error detail: %s", result.error_message)
        time.sleep(args.sleep)

    skipped = len(completed) if not args.force else 0
    print(f"Processing complete. Processed {processed} URLs, skipped {skipped}.")
    print(f"Results saved to {output_path}")
    print(f"Log written to {args.log_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
