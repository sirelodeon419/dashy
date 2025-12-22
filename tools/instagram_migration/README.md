# Instagram Save Migration Utilities

Two standalone Python scripts to help migrate Instagram saved posts:

- **App 1 – sort_instagram.py**: Parse an Instagram data export JSON file, extract saved post URLs, and split them into `photos.csv` and `videos.csv`.
- **App 2 – analyze_images.py**: Pull down Instagram images from a CSV of URLs, send them to an AI vision provider, and save structured descriptions to `analyzed_photos.csv` with resume and error logging.

Both scripts are designed for non-destructive, repeatable runs and include guardrails for malformed data, rate limiting, and crash-safe progress.

## Prerequisites

- Python 3.10+
- An Instagram data export JSON file (from **Settings → Your activity → Download your information**)
- API key for your chosen vision provider (Anthropic or OpenAI)
- Optional: Instagram credentials for accessing private or rate-limited posts

Create a virtual environment and install dependencies:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r tools/instagram_migration/requirements.txt
```

Copy the environment template and fill in credentials:

```bash
cp tools/instagram_migration/.env.example .env
```

## App 1: Parse and Sort Saved Post URLs

Command:

```bash
python tools/instagram_migration/sort_instagram.py ~/Downloads/instagram-data.json \
  --photos output/photos.csv --videos output/videos.csv
```

What it does:

1. Loads the provided JSON (up to ~50 MB).
2. Recursively extracts any string that looks like an Instagram post URL.
3. Categorizes URLs: `/p/` → photo, `/reel/` or `/tv/` → video; anything else is treated as `other`.
4. Writes `photos.csv` and `videos.csv` (and optionally `other.csv`) with one URL per row and prints summary counts.

Flags:

- `--photos`, `--videos`, `--other`: Override output paths.
- `--dedupe/--no-dedupe`: Enable or disable duplicate removal (on by default).
- `--verbose`: Show details about skipped or malformed entries.

Common issues:

- **Malformed JSON**: The script surfaces friendly errors; fix the file then re-run.
- **Unexpected structure**: The parser searches nested keys (`url`, `uri`, `href`) and any string containing `instagram.com/`. If your export nests URLs under a different key, use `--verbose` to confirm extraction.

## App 2: Analyze Instagram Photos with AI Vision

Command (Anthropic example):

```bash
python tools/instagram_migration/analyze_images.py output/photos.csv \
  --provider anthropic --output output/analyzed_photos.csv --sleep 2
```

What it does:

1. Loads URLs from a CSV (`url` or `original_url` column).
2. Uses Instaloader to resolve the post and fetch the first photo frame.
3. Sends the image to your configured AI provider with a structured prompt.
4. Streams progress with a counter (and tqdm if available), writes results incrementally to `analyzed_photos.csv`, and logs errors to a file.
5. Resumes automatically: existing rows in the output file are skipped unless `--force` is set.
6. Deduplicates input URLs before processing to save API calls.

Key arguments:

- `--provider {anthropic,openai}`: Which AI backend to use.
- `--output`: Destination CSV (defaults to `analyzed_photos.csv` next to the input file).
- `--log-file`: Path for a detailed log (default: `analyze_images.log`).
- `--sleep`: Seconds to wait between AI calls to respect rate limits (default: 2).
- `--force`: Reprocess URLs even if they already exist in the output file.
- `--timeout`: Network timeout (seconds) for image fetches (default: 15).

Environment variables (see `.env.example`):

- `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` (default: `claude-3-5-sonnet-20241022`)
- `OPENAI_API_KEY` / `OPENAI_MODEL` (default: `gpt-4o-mini`)
- `INSTAGRAM_USERNAME` and `INSTAGRAM_PASSWORD` (optional, for private posts or higher rate limits)
- `REQUEST_TIMEOUT` (overrides `--timeout`)

Resume behavior:

- If the output CSV already exists, the script loads it and skips any URL present in `original_url` unless `--force` is provided.
- Rows are appended as they are processed, so a crash or Ctrl+C will not lose completed work.

Error handling:

- Per-URL failures are captured with `status=error` and an `error_message` describing the cause (e.g., deleted post, video-only post, auth failure, API timeout).
- A log file records stack traces to help with debugging without interrupting the main run.

### Selecting an Instagram access method

- **Public posts**: No login required, but light rate limiting (`--sleep 2`) is recommended.
- **Private/saved posts**: Provide `INSTAGRAM_USERNAME` and `INSTAGRAM_PASSWORD`. Credentials are only read from environment variables or a local `.env` file (which is ignored by git).

### Cost and rate limits

- Anthropic Claude 3.5 Sonnet: ≈$0.01 per image → ~$5 for 500 images (see `cost_estimate.md`).
- OpenAI GPT-4o: similar magnitude; adjust via `--provider` and `OPENAI_MODEL`.
- Set `--sleep` to reduce the chance of Instagram or API rate limits; increase if you see repeated 429/403 errors.

## Outputs

- `photos.csv`, `videos.csv`, and optional `other.csv` from App 1
- `analyzed_photos.csv` from App 2 with columns:
  - `original_url`, `description`, `category`, `tags`, `mood`, `status`, `error_message`

Sample CSVs are included for quick validation.

## Troubleshooting

- **Login required**: Ensure credentials are correct and 2FA is disabled for the session. If login fails, the script continues with public access where possible.
- **Private/deleted posts**: These will be marked as errors with an explanatory message; the run continues.
- **API key missing**: The script exits with a clear message if the selected provider key is not set.
- **SSL or network errors**: Increase `--timeout` or retry after a short delay; errors are logged per URL.

## Notes and Terms

- Use these tools responsibly and in line with Instagram and API provider Terms of Service.
- The scripts avoid downloading videos; App 2 expects photo posts. Video URLs will be tagged with an error in the output.
