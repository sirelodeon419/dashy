#!/usr/bin/env python3
"""
App 1: Parse an Instagram data export JSON file and categorize saved post URLs.
Outputs photos.csv and videos.csv (and optionally other.csv).
"""

import argparse
import csv
import json
import re
import sys
from pathlib import Path
from typing import Iterable, List, Set, Tuple


URL_PATTERN = re.compile(
    r"https?://(?:www\\.)?instagram\\.com/(?P<path>[^\\s\"'<>]+)", re.IGNORECASE
)


def extract_urls(obj) -> Iterable[str]:
    """Recursively walk JSON-like data and yield any string that looks like an Instagram URL."""
    if isinstance(obj, dict):
        for value in obj.values():
            yield from extract_urls(value)
    elif isinstance(obj, list):
        for item in obj:
            yield from extract_urls(item)
    elif isinstance(obj, str):
        match = URL_PATTERN.search(obj)
        if match:
            yield f"https://www.instagram.com/{match.group('path').split('?')[0].strip('/')}/"


def categorize_url(url: str) -> str:
    """Return category based on path segment."""
    lower = url.lower()
    if "/p/" in lower:
        return "photo"
    if "/reel/" in lower or "/tv/" in lower:
        return "video"
    return "other"


def write_csv(urls: Iterable[str], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["url"])
        for url in urls:
            writer.writerow([url])


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Parse Instagram export JSON and split saved post URLs into photos/videos."
    )
    parser.add_argument("json_file", type=Path, help="Path to Instagram export JSON")
    parser.add_argument("--photos", type=Path, default=Path("photos.csv"), help="Output CSV for photos")
    parser.add_argument("--videos", type=Path, default=Path("videos.csv"), help="Output CSV for videos")
    parser.add_argument("--other", type=Path, default=None, help="Optional CSV for uncategorized URLs")
    parser.add_argument("--dedupe", action=argparse.BooleanOptionalAction, default=True, help="Remove duplicate URLs (default: on)")
    parser.add_argument("--verbose", action="store_true", help="Show details about categories and skipped entries")
    args = parser.parse_args(argv)

    if not args.json_file.exists():
        print(f"Error: {args.json_file} does not exist", file=sys.stderr)
        return 1

    try:
        with args.json_file.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as exc:
        print(f"Error: Failed to parse JSON - {exc}", file=sys.stderr)
        return 1

    photos: List[str] = []
    videos: List[str] = []
    other: List[str] = []
    seen: Set[str] = set()

    for url in extract_urls(data):
        clean_url = url.strip()
        if args.dedupe and clean_url in seen:
            continue
        seen.add(clean_url)
        category = categorize_url(clean_url)
        if category == "photo":
            photos.append(clean_url)
        elif category == "video":
            videos.append(clean_url)
        else:
            other.append(clean_url)

    write_csv(photos, args.photos)
    write_csv(videos, args.videos)
    if args.other is not None:
        write_csv(other, args.other)

    photo_count, video_count, other_count = map(len, (photos, videos, other))
    summary = f"Found {photo_count} photos, {video_count} videos"
    if args.other is not None:
        summary += f", {other_count} other"
    print(summary)

    if args.verbose:
        print(f"Wrote photos to: {args.photos}")
        print(f"Wrote videos to: {args.videos}")
        if args.other is not None:
            print(f"Wrote other to:  {args.other}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
