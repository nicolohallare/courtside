"""Upload an album's web and thumbnail photos to Cloudflare R2.

Usage: python3 upload_r2.py <out-dir> <album-id>

Credentials come from the environment, never from files in this repo:
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (default mdp-photos)
The key only needs Object Read & Write on the one bucket.

Writes albums/<album-id>/web/<sha>.jpg and albums/<album-id>/thumb/<sha>.jpg with a one-year
immutable cache header (file names are content hashes, so they never change). Files already in
the bucket are skipped, so it is safe to re-run after an interruption.
"""
import os
import sys
from concurrent.futures import ThreadPoolExecutor

import boto3
from botocore.config import Config


def main(out, album_id):
    acct = os.environ["R2_ACCOUNT_ID"]
    bucket = os.environ.get("R2_BUCKET", "mdp-photos")
    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{acct}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
        config=Config(max_pool_connections=16, retries={"max_attempts": 5}),
    )
    prefix = f"albums/{album_id}/"
    existing = set()
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        existing.update(o["Key"] for o in page.get("Contents", []))

    jobs = []
    for kind in ("web", "thumb"):
        for f in sorted(os.listdir(os.path.join(out, kind))):
            key = f"{prefix}{kind}/{f}"
            if key not in existing:
                jobs.append((os.path.join(out, kind, f), key))
    print(f"{len(jobs)} to upload, {len(existing)} already there")

    def up(job):
        path, key = job
        s3.upload_file(path, bucket, key, ExtraArgs={
            "ContentType": "image/jpeg",
            "CacheControl": "public, max-age=31536000, immutable",
        })

    done = 0
    with ThreadPoolExecutor(16) as ex:
        for _ in ex.map(up, jobs):
            done += 1
            if done % 500 == 0:
                print(done, flush=True)
    print("done", done)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
