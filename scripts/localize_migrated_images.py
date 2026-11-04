#!/usr/bin/env python3
"""将已迁移试卷正文中的历史图片复制到统一系统的持久化目录。"""

import argparse
import hashlib
import json
import os
import re
import shutil
from collections import defaultdict
from pathlib import Path

import pymysql

URL = re.compile(r"(?<![A-Za-z0-9])/(?:sat-api/)?uploads/[A-Za-z0-9_./%\-]+")
QUERIES = {
    "sat": [
        "SELECT content,file_url FROM sat_materials",
        "SELECT q.stem,q.explanation,q.render_json,q.answer_key_json,q.grading_json FROM questions q JOIN sat_import_id_map m ON m.target_id=q.id AND m.entity_type='question' AND m.source_system='SAT_V1'",
    ],
    "shsat": [
        "SELECT content,asset_key FROM shsat_section_materials",
        "SELECT content,asset_key FROM shsat_paper_materials",
        "SELECT q.stem,q.explanation,q.render_json,q.answer_key_json,q.grading_json FROM questions q JOIN shsat_import_id_map m ON m.target_id=q.id AND m.entity_type='question' AND m.source_system='SHSAT_V2'",
        "SELECT extra_json FROM shsat_question_metadata WHERE CAST(extra_json AS CHAR) LIKE '%/uploads/%'",
        "SELECT snapshot_json FROM shsat_attempt_item_snapshots WHERE CAST(snapshot_json AS CHAR) LIKE '%/uploads/%'",
    ],
}


def digest(path):
    """流式计算哈希，用于避免同名文件误覆盖。"""
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def index_files(root):
    """按文件名索引源素材；忽略构建产物以减少同名干扰。"""
    index = defaultdict(list)
    for directory, subdirs, files in os.walk(root):
        subdirs[:] = [name for name in subdirs if name not in {".git", "node_modules", "target", "dist", "venv", ".venv"}]
        for name in files:
            index[name].append(Path(directory) / name)
    return index


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sat-source", required=True)
    parser.add_argument("--shsat-source", required=True)
    parser.add_argument("--uploads", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--allow-missing", action="store_true")
    args = parser.parse_args()
    uploads = Path(args.uploads).resolve()
    sources = {"sat": index_files(args.sat_source), "shsat": index_files(args.shsat_source)}
    target = pymysql.connect(host=os.environ["TARGET_DB_HOST"], port=int(os.environ["TARGET_DB_PORT"]),
                             user=os.environ["TARGET_DB_USER"], password=os.environ["TARGET_DB_PASSWORD"],
                             database=os.getenv("TARGET_DB_NAME", "unified_exam_platform"), charset="utf8mb4")
    try:
        urls = {"sat": set(), "shsat": set()}
        with target.cursor() as cursor:
            for system, queries in QUERIES.items():
                for sql in queries:
                    cursor.execute(sql)
                    for row in cursor:
                        for value in row:
                            if value:
                                urls[system].update(URL.findall(str(value)))
        plan = {}
        missing = []
        for system, values in urls.items():
            for url in sorted(values):
                if system == "sat" and url.startswith("/uploads/sat-import/materials/"):
                    destination = uploads / "sat-import/materials" / Path(url).name
                    prefix = Path(url).name.split("_", 1)[0]
                    if not destination.is_file() or not digest(destination).startswith(prefix):
                        missing.append(url)
                    continue
                if system == "sat" and url.startswith(("/sat-api/uploads/materials/", "/uploads/materials/")):
                    destination = uploads / "sat-import/materials" / Path(url).name
                elif system == "shsat" and url.startswith("/uploads/images/"):
                    destination = uploads / url.removeprefix("/uploads/")
                elif system == "shsat" and url.startswith("/uploads/paper-materials/"):
                    destination = uploads / url.removeprefix("/uploads/")
                else:
                    raise ValueError(f"Unsupported {system} image URL: {url}")
                destination = destination.resolve()
                if not destination.is_relative_to(uploads) or ".." in Path(url).parts:
                    raise ValueError(f"Invalid image URL: {url}")
                candidates = sources[system].get(Path(url).name, [])
                # 已迁移的散列文件无需再依赖旧系统同名文件。
                if not candidates and destination.is_file() and "_" in destination.name:
                    prefix = destination.name.split("_", 1)[0]
                    if re.fullmatch(r"[0-9a-f]{16,64}", prefix) and digest(destination).startswith(prefix):
                        continue
                if not candidates:
                    missing.append(url)
                    continue
                hashes = {digest(path) for path in candidates}
                if len(hashes) != 1:
                    raise ValueError(f"Different source files share a name: {url}")
                source = candidates[0]
                source_hash = hashes.pop()
                if destination.exists() and digest(destination) != source_hash:
                    raise ValueError(f"Destination contains different content: {destination}")
                previous = plan.get(destination)
                if previous and previous[1] != source_hash:
                    raise ValueError(f"Multiple images target the same path: {destination}")
                plan[destination] = (source, source_hash)
        report = {"url_counts": {key: len(value) for key, value in urls.items()},
                  "files_to_copy": sum(not path.exists() for path in plan), "missing": sorted(set(missing))}
        Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        if missing and not args.allow_missing:
            raise ValueError(f"Missing {len(set(missing))} image references; see the report.")
        if not args.execute:
            print(json.dumps(report, ensure_ascii=False))
            return
        for destination, (source, source_hash) in plan.items():
            if destination.exists():
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
            os.chmod(destination, 0o644)
            if digest(destination) != source_hash:
                raise ValueError(f"Copied image checksum mismatch: {destination}")
        old = uploads / "shsat-import"
        new = uploads / "paper-materials/shsat-import"
        if old.exists() and new.exists():
            raise ValueError("Both SHSAT import directories exist; inspect before moving.")
        if old.exists():
            new.parent.mkdir(parents=True, exist_ok=True)
            old.rename(new)
        if not new.is_dir():
            raise ValueError("SHSAT imported image directory is missing.")
        with target.cursor() as cursor:
            cursor.execute("UPDATE sat_materials SET file_url=CONCAT('/sat-api/uploads/materials/', SUBSTRING(file_url, LENGTH('/uploads/sat-import/materials/') + 1)) WHERE file_url LIKE '/uploads/sat-import/materials/%'")
            report["updated_sat_materials"] = cursor.rowcount
        target.commit()
        report["executed"] = True
        Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False))
    except Exception:
        target.rollback()
        raise
    finally:
        target.close()


if __name__ == "__main__":
    main()
