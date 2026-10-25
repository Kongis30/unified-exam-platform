#!/usr/bin/env python3
"""Restore imported SAT material images from the legacy SAT upload host."""

import argparse
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import pymysql


def connect_database():
    return pymysql.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USERNAME", "root"),
        password=os.getenv("DB_PASSWORD", ""),
        database=os.getenv("DB_NAME", "unified_exam_platform"),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )


def material_urls(connection):
    """读取目标库仍引用旧 SAT 上传路径的唯一图片地址。"""
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT DISTINCT file_url
            FROM sat_materials
            WHERE file_url LIKE '/sat-api/uploads/materials/%'
        """)
        return [row["file_url"] for row in cursor.fetchall()]


def restore_assets(urls, source_base_url, destination):
    """将缺失图片恢复到当前后端目录，保留数据库中的原始资源路径。"""
    destination.mkdir(parents=True, exist_ok=True)
    restored = 0
    missing = []
    for asset_url in urls:
        filename = Path(asset_url).name
        if not filename or filename in {".", ".."}:
            missing.append(asset_url)
            continue
        target = destination / filename
        if target.is_file() and target.stat().st_size:
            continue
        request = Request(f"{source_base_url.rstrip('/')}{asset_url}", headers={"User-Agent": "SAT-asset-recovery/1.0"})
        try:
            with urlopen(request, timeout=30) as response:
                content_type = response.headers.get_content_type()
                content = response.read()
            if content_type not in {"image/png", "image/jpeg", "image/webp", "image/gif"}:
                raise ValueError(f"unexpected content type: {content_type}")
            if not content:
                raise ValueError("empty response")
            target.write_bytes(content)
            restored += 1
        except (HTTPError, URLError, TimeoutError, ValueError) as error:
            missing.append(f"{asset_url} ({error})")
    return restored, missing


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-base-url", default=os.getenv("SAT_SOURCE_BASE_URL", "https://sat.jinbesttutoring.com"))
    parser.add_argument("--destination", default="backend/uploads/sat-import/materials")
    args = parser.parse_args()

    with connect_database() as connection:
        urls = material_urls(connection)
    restored, missing = restore_assets(urls, args.source_base_url, Path(args.destination))
    print(f"Referenced assets: {len(urls)}; restored now: {restored}; unavailable: {len(missing)}")
    if missing:
        for item in missing:
            print(f"Unavailable: {item}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
