#!/usr/bin/env python3
"""将独立 SHSAT V2 数据导入统一考试平台；默认仅预检，不写库。"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import shutil
import subprocess
import sys
import uuid
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

try:
    import pymysql
    from pymysql.cursors import DictCursor
except ImportError:
    pymysql = None
    DictCursor = None


SOURCE_SYSTEM = "SHSAT_V2"
ENTITY_KEYS = {
    "user": "user_id", "class": "class_id", "student": "student_id",
    "group": "paper_group_id", "paper": "paper_id", "part": "part_id",
    "subtype": "sub_type_id", "material": "material_id", "question": "question_id",
    "profile": "scoring_profile_id", "exam": "exam_id", "attempt": "attempt_id",
    "answer": "answer_id", "snapshot": "snapshot_id", "solution": "solution_id",
    "wrong_task": "task_id", "wrong_assignment": "assignment_id",
}


def json_value(value: Any) -> Any:
    """把数据库 JSON 字段转成可安全重写的 Python 对象。"""
    if value is None or isinstance(value, (dict, list, int, float, bool)):
        return value
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8")
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def json_text(value: Any) -> str | None:
    """序列化 MySQL JSON 参数；保留来源结构，不裁剪字段。"""
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        value = value.isoformat()
    return json.dumps(value, ensure_ascii=False, default=str, separators=(",", ":"))


def fingerprint(row: dict[str, Any]) -> str:
    """为每个源记录生成稳定指纹，供重跑时识别源数据是否发生变化。"""
    raw = json.dumps(row, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class Migration:
    """编排导入和 ID 映射；所有数据库写入处于一个目标库事务中。"""

    def __init__(self, source, target, args: argparse.Namespace):
        self.source = source
        self.target = target
        self.args = args
        self.run_id: int | None = None
        self.maps: dict[tuple[str, int], int] = {}
        self.account_map = self._read_account_map(args.account_map)
        self.created_files: list[Path] = []
        self.asset_cache: dict[str, str] = {}
        self.asset_index: dict[str, list[Path]] | None = None
        self.system_user_id: int | None = args.system_user_id
        self.last_preflight_report: dict[str, Any] | None = None

    @staticmethod
    def _read_account_map(path: str | None) -> dict[int, int]:
        result: dict[int, int] = {}
        if not path:
            return result
        with open(path, newline="", encoding="utf-8-sig") as handle:
            for row in csv.DictReader(handle):
                source_id, target_id = row.get("source_user_id", "").strip(), row.get("target_user_id", "").strip()
                if not source_id or not target_id or source_id.startswith("#"):
                    continue
                key, value = int(source_id), int(target_id)
                if key in result:
                    raise ValueError(f"Duplicate source_user_id in account map: {key}")
                result[key] = value
        return result

    def rows(self, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        with self.source.cursor() as cursor:
            cursor.execute(sql, params)
            return list(cursor.fetchall())

    def target_rows(self, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        with self.target.cursor() as cursor:
            cursor.execute(sql, params)
            return list(cursor.fetchall())

    def one(self, sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
        rows = self.rows(sql, params)
        return rows[0] if rows else None

    def insert(self, sql: str, params: tuple[Any, ...]) -> int:
        with self.target.cursor() as cursor:
            cursor.execute(sql, params)
            return int(cursor.lastrowid)

    def update(self, sql: str, params: tuple[Any, ...]) -> int:
        with self.target.cursor() as cursor:
            return cursor.execute(sql, params)

    def mapped(self, entity: str, source_id: int) -> int:
        try:
            return self.maps[(entity, int(source_id))]
        except KeyError as exc:
            raise ValueError(f"Missing ID mapping: {entity} source ID {source_id}") from exc

    def save_mapping(self, entity: str, source_id: int, target_id: int, row: dict[str, Any]) -> None:
        self.maps[(entity, int(source_id))] = target_id
        if not self.args.execute:
            return
        self.insert("""INSERT INTO shsat_import_id_map
            (source_system, entity_type, source_id, target_id, source_fingerprint, migration_run_id)
            VALUES (%s,%s,%s,%s,%s,%s)""",
            (SOURCE_SYSTEM, entity, source_id, target_id, fingerprint(row), self.run_id))

    def existing_map(self, entity: str, source_id: int, source_row: dict[str, Any] | None = None) -> int | None:
        found = self.target_rows("""SELECT target_id, source_fingerprint FROM shsat_import_id_map
            WHERE source_system=%s AND entity_type=%s AND source_id=%s""", (SOURCE_SYSTEM, entity, source_id))
        if not found:
            return None
        if source_row is not None and found[0]["source_fingerprint"] != fingerprint(source_row):
            raise ValueError(f"Source {entity} {source_id} changed since its prior import; reconcile it manually before rerunning.")
        return int(found[0]["target_id"])

    def preflight(self) -> dict[str, Any]:
        """只读检查完整性、帐号冲突、目标表版本和引用文件，不改写数据。"""
        self.load_existing_maps()
        required_target = {"shsat_import_id_map", "shsat_migration_runs", "shsat_attempt_item_snapshots",
                           "shsat_attempt_answer_details", "shsat_class_metadata", "shsat_paper_metadata",
                           "shsat_paper_materials", "shsat_attempt_record_details"}
        present = {r["TABLE_NAME"] for r in self.target_rows("""SELECT TABLE_NAME FROM information_schema.TABLES
            WHERE TABLE_SCHEMA=DATABASE()""")}
        missing = sorted(required_target - present)
        if missing:
            raise ValueError("Target schema is missing V12 migration tables; apply Flyway migrations first: " + ", ".join(missing))

        source_counts = {}
        for table in ("users", "classes", "class_students", "paper_group", "paper", "paper_part", "paper_sub_type",
                      "material", "question", "scoring_profile", "scoring_scale_row", "paper_solution", "exam",
                      "attempt", "attempt_answer", "attempt_question_snapshot", "wrong_answer_task", "wrong_answer_task_assignment"):
            source_counts[table] = int(self.one(f"SELECT COUNT(*) AS n FROM `{table}`")["n"])

        existing_usernames = {r["username"].casefold(): int(r["id"]) for r in self.target_rows("SELECT id, username FROM users")}
        collisions = []
        source_users = self.rows("SELECT user_id, username FROM users ORDER BY user_id")
        for user in source_users:
            source_id = int(user["user_id"])
            if ("user", source_id) in self.maps:
                continue
            target_id = existing_usernames.get(user["username"].casefold())
            if target_id is not None:
                mapped_target = self.account_map.get(source_id)
                if mapped_target != target_id:
                    collisions.append({"source_user_id": source_id, "username": user["username"],
                                       "target_user_id": target_id, "mapped_target_user_id": mapped_target})
            elif int(user["user_id"]) in self.account_map:
                mapped_target = self.account_map[int(user["user_id"])]
                if not self.target_rows("SELECT id FROM users WHERE id=%s", (mapped_target,)):
                    raise ValueError(f"Account map points to missing target user ID {mapped_target}")

        mapped_source_classes = {int(row["source_id"]) for row in self.target_rows("""SELECT source_id FROM shsat_import_id_map
            WHERE source_system=%s AND entity_type='class'""", (SOURCE_SYSTEM,))}
        target_class_names = {row["name"].casefold() for row in self.target_rows("SELECT name FROM classes")}
        class_collisions = [row["class_name"] for row in self.rows("SELECT class_id,class_name FROM classes")
                            if row["class_name"].casefold() in target_class_names and int(row["class_id"]) not in mapped_source_classes]
        mapped_source_papers = {int(row["source_id"]) for row in self.target_rows("""SELECT source_id FROM shsat_import_id_map
            WHERE source_system=%s AND entity_type='paper'""", (SOURCE_SYSTEM,))}
        existing_paper_keys = {(row["paper_code"].casefold(), int(row["version_no"])) for row in self.target_rows(
            "SELECT paper_code,version_no FROM papers WHERE exam_type_code='SHSAT'")}
        paper_collisions = []
        for row in self.rows("SELECT paper_id,root_paper_id,version_number FROM paper"):
            key = (f"SHSAT-V2-{row['root_paper_id'] or row['paper_id']}".casefold(), int(row["version_number"]))
            if key in existing_paper_keys and int(row["paper_id"]) not in mapped_source_papers:
                paper_collisions.append({"source_paper_id": int(row["paper_id"]), "paper_code": key[0], "version_no": key[1]})

        dangling_students = int(self.one("""SELECT COUNT(*) AS n FROM users u LEFT JOIN class_students s
            ON s.student_id=u.student_id WHERE u.role='STUDENT' AND u.student_id IS NOT NULL AND s.student_id IS NULL""")["n"])
        missing_student_accounts = int(self.one("""SELECT COUNT(*) AS n FROM class_students s
            LEFT JOIN users u ON u.student_id=s.student_id WHERE u.user_id IS NULL""")["n"])
        dangling_answers = int(self.one("""SELECT COUNT(*) AS n FROM attempt_answer a LEFT JOIN attempt t ON t.attempt_id=a.attempt_id
            WHERE t.attempt_id IS NULL""")["n"])
        if dangling_students or missing_student_accounts or dangling_answers:
            raise ValueError(f"Source has broken references: users.student_id={dangling_students}, class_students without account={missing_student_accounts}, attempt_answer.attempt_id={dangling_answers}")

        assets = self._asset_references()
        missing_assets = []
        ambiguous_assets = []
        for url in assets:
            matches = self._find_asset(url, allow_ambiguous=True)
            if not matches:
                missing_assets.append(url)
            elif len(matches) > 1 and len({self._file_hash(p) for p in matches}) > 1:
                ambiguous_assets.append({"url": url, "matches": [str(p) for p in matches[:5]]})

        report = {"source_database": self.args.source_database, "target_database": self.args.target_database,
                  "source_counts": source_counts, "username_collisions": collisions,
                  "class_name_collisions": class_collisions,
                  "paper_code_collisions": paper_collisions,
                  "missing_assets": missing_assets, "ambiguous_assets": ambiguous_assets,
                  "unlinked_student_accounts": dangling_students,
                  "class_students_without_accounts": missing_student_accounts}
        self.last_preflight_report = report
        if collisions:
            raise ValueError("Account collisions require explicit source_user_id,target_user_id mappings in --account-map: " +
                             ", ".join(f"{r['username']} (source {r['source_user_id']} -> target {r['target_user_id']})" for r in collisions))
        if class_collisions:
            raise ValueError("Class name collisions require manual review before import: " + ", ".join(class_collisions))
        if paper_collisions:
            raise ValueError(f"Target already has {len(paper_collisions)} SHSAT paper code/version collisions; review before import.")
        if (missing_assets and not self.args.allow_missing_assets) or ambiguous_assets:
            raise ValueError(f"Asset preflight failed: {len(missing_assets)} missing and {len(ambiguous_assets)} ambiguous files. See --report-json output; use --allow-missing-assets only when missing references should be retained.")
        too_long_parts = [row for row in self.rows("SELECT part_id,part_name FROM paper_part WHERE CHAR_LENGTH(part_name)>100")]
        if too_long_parts:
            raise ValueError(f"Target question_categories.name limit is 100 characters; {len(too_long_parts)} SHSAT part names exceed it.")
        return report

    def _asset_references(self) -> list[str]:
        values = self.rows("SELECT asset_url FROM material WHERE asset_url IS NOT NULL AND asset_url <> ''")
        values += self.rows("SELECT asset_url FROM attempt_question_snapshot WHERE asset_url IS NOT NULL AND asset_url <> ''")
        values += self.rows("SELECT file_path AS asset_url FROM paper_solution WHERE file_path IS NOT NULL AND file_path <> ''")
        return sorted({str(r["asset_url"]) for r in values})

    @staticmethod
    def _file_hash(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
        return digest.hexdigest()

    def _find_asset(self, url: str, allow_ambiguous: bool = False) -> list[Path]:
        root = Path(self.args.source_asset_root).resolve() if self.args.source_asset_root else None
        if root is None:
            return []
        parsed = urlparse(url)
        relative = unquote(parsed.path).lstrip("/")
        candidates = [root / relative]
        if relative.startswith("uploads/"):
            candidates.append(root / relative.removeprefix("uploads/"))
        found = [p.resolve() for p in candidates if p.is_file() and p.resolve().is_relative_to(root)]
        if not found:
            basename = Path(relative).name
            if self.asset_index is None:
                self.asset_index = self._index_assets(root)
            found = self.asset_index.get(basename, [])
        unique = list(dict.fromkeys(found))
        if not allow_ambiguous and len({self._file_hash(p) for p in unique}) > 1:
            raise ValueError(f"More than one source asset matches {url}; supply an unambiguous source asset root.")
        return unique

    @staticmethod
    def _index_assets(root: Path) -> dict[str, list[Path]]:
        """一次遍历资源根目录建立文件名索引，避免每个附件都递归扫描整个工作区。"""
        ignored = {".git", "node_modules", ".venv", "venv", "target", "dist", "build"}
        index: dict[str, list[Path]] = defaultdict(list)
        for current, directories, filenames in os.walk(root):
            directories[:] = [name for name in directories if name not in ignored]
            for filename in filenames:
                index[filename].append(Path(current) / filename)
        return index

    def copy_asset(self, url: str) -> str:
        if url in self.asset_cache:
            return self.asset_cache[url]
        sources = self._find_asset(url)
        if not sources and self.args.allow_missing_assets:
            self.asset_cache[url] = url
            return url
        source = sources[0]
        digest = self._file_hash(source)
        safe_name = source.name.replace("/", "_")
        relative_key = f"shsat-import/{digest[:2]}/{digest}_{safe_name}"
        if not self.args.execute:
            self.asset_cache[url] = relative_key
            return relative_key
        target_root = Path(self.args.target_asset_root).resolve()
        target_path = target_root / relative_key
        if not target_path.exists():
            target_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target_path)
            self.created_files.append(target_path)
        self.asset_cache[url] = relative_key
        return relative_key

    def create_run(self, summary: dict[str, Any]) -> None:
        if self.args.execute:
            self.run_id = self.insert("""INSERT INTO shsat_migration_runs
                (source_system, source_database, status, started_at, summary_json)
                VALUES (%s,%s,'RUNNING',CURRENT_TIMESTAMP(6),CAST(%s AS JSON))""",
                (SOURCE_SYSTEM, self.args.source_database, json_text(summary)))

    def load_existing_maps(self) -> None:
        for row in self.target_rows("""SELECT entity_type, source_id, target_id FROM shsat_import_id_map
            WHERE source_system=%s""", (SOURCE_SYSTEM,)):
            self.maps[(row["entity_type"], int(row["source_id"]))] = int(row["target_id"])

    def import_all(self) -> dict[str, int]:
        """按外键依赖顺序导入账户、试卷内容、发布考试和全部历史记录。"""
        self.target.begin()
        self.load_existing_maps()
        summary = self.preflight()
        self.create_run(summary)
        admin = self.system_user_id or self._find_admin()
        if not admin:
            raise ValueError("Target needs an active ADMIN account; pass --system-user-id if automatic selection is ambiguous.")
        self.system_user_id = admin
        self._import_users()
        self._import_classes_and_students()
        self._import_groups_and_profiles()
        self._import_papers_and_content()
        self._import_exams()
        self._import_attempts()
        self._import_wrong_answer_tasks()
        self._verify_import()
        if self.args.execute:
            self.update("UPDATE shsat_migration_runs SET status='COMPLETED', finished_at=CURRENT_TIMESTAMP(6), summary_json=CAST(%s AS JSON) WHERE id=%s",
                        (json_text({"source_counts": summary["source_counts"], "mapped_entities": self._map_counts()}), self.run_id))
            self.target.commit()
        else:
            self.target.rollback()
        return self._map_counts()

    def _find_admin(self) -> int | None:
        rows = self.target_rows("SELECT id FROM users WHERE role_code='ADMIN' AND status='ACTIVE' ORDER BY id")
        if len(rows) == 1:
            return int(rows[0]["id"])
        return None

    def _save_or_existing(self, entity: str, source: dict[str, Any], new_id: int) -> None:
        source_id = int(source[ENTITY_KEYS[entity]])
        self.save_mapping(entity, source_id, new_id, source)

    def _already(self, entity: str, source: dict[str, Any]) -> bool:
        source_id = int(source[ENTITY_KEYS[entity]])
        target_id = self.existing_map(entity, source_id, source)
        if target_id is None:
            return False
        self.maps[(entity, source_id)] = target_id
        return True

    def _import_users(self) -> None:
        target_by_id = {int(r["id"]): r for r in self.target_rows("SELECT id, username, role_code FROM users")}
        target_by_name = {r["username"].casefold(): int(r["id"]) for r in target_by_id.values()}
        for row in self.rows("SELECT * FROM users ORDER BY user_id"):
            if self._already("user", row):
                continue
            source_id = int(row["user_id"])
            mapped_id = self.account_map.get(source_id)
            target_id = target_by_name.get(row["username"].casefold())
            if target_id is not None:
                if mapped_id != target_id:
                    raise ValueError(f"Unresolved account collision for {row['username']} (source user {source_id}).")
                target_user = target_by_id[target_id]
                if target_user["role_code"] != row["role"]:
                    raise ValueError(f"Mapped account role mismatch for {row['username']}; resolve manually before import.")
                self._save_or_existing("user", row, target_id)
                continue
            if mapped_id is not None:
                target_user = target_by_id.get(mapped_id)
                if not target_user or target_user["role_code"] != row["role"]:
                    raise ValueError(f"Account map target mismatch for source user {source_id}.")
                self._save_or_existing("user", row, mapped_id)
                continue
            target_id = self.insert("""INSERT INTO users
                (username,password_hash,real_name,role_code,email,status,last_login_at,created_at,updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (row["username"], row["password_hash"], row["real_name"], row["role"], row["email"],
                 "ACTIVE" if row["is_active"] else "DISABLED", row["last_login_at"], row["created_at"], row["updated_at"]))
            target_by_id[target_id] = {"id": target_id, "username": row["username"], "role_code": row["role"]}
            target_by_name[row["username"].casefold()] = target_id
            self._save_or_existing("user", row, target_id)

    def _import_classes_and_students(self) -> None:
        for row in self.rows("SELECT * FROM classes ORDER BY class_id"):
            if self._already("class", row):
                continue
            created = self.insert("""INSERT INTO classes (name,description,status,sort_order,created_at,updated_at)
                VALUES (%s,%s,%s,%s,%s,%s)""",
                (row["class_name"], row["class_description"], "ACTIVE" if row["is_active"] else "ARCHIVED",
                 row["display_order"], row["created_at"], row["updated_at"]))
            self._save_or_existing("class", row, created)
            teacher_id = row.get("teacher_user_id")
            self.insert("""INSERT INTO shsat_class_metadata
                (class_id,teacher_name,teacher_email,grade_level,academic_year,source_counts_json)
                VALUES (%s,%s,%s,%s,%s,CAST(%s AS JSON))""",
                (created, row["teacher_name"], row["teacher_email"], row["grade_level"], row["academic_year"],
                 json_text({"student_count": row["student_count"], "participated_exam_count": row["participated_exam_count"],
                            "average_score": row["average_score"], "teacher_user_id": teacher_id,
                            "mapped_teacher_user_id": self.maps.get(("user", int(teacher_id))) if teacher_id else None})))

        class_students = self.rows("SELECT * FROM class_students ORDER BY student_id")
        user_by_student = {int(row["student_id"]): row for row in self.rows(
            "SELECT user_id, student_id FROM users WHERE student_id IS NOT NULL")}
        student_classes: dict[int, list[int]] = {}
        for row in class_students:
            student_classes.setdefault(int(row["student_id"]), []).append(int(row["class_id"]))
            source_user = user_by_student.get(int(row["student_id"]))
            if source_user:
                user_id = self.mapped("user", source_user["user_id"])
                if not self._already("student", row):
                    self._save_or_existing("student", row, user_id)
                for source_class_id in student_classes[int(row["student_id"])]:
                    class_id = self.mapped("class", source_class_id)
                    self.update("""INSERT IGNORE INTO class_memberships (class_id,student_user_id,joined_at,left_at)
                        VALUES (%s,%s,%s,%s)""",
                        (class_id, user_id, row["joined_at"], None if row["is_active"] else row["updated_at"]))
                self.update("""INSERT IGNORE INTO shsat_student_profiles
                    (student_user_id,gender,notes,student_number,source_metadata_json)
                    VALUES (%s,%s,%s,%s,CAST(%s AS JSON))""",
                    (user_id, row["gender"], row["notes"], row["student_number"],
                     json_text({"source_student_id": row["student_id"], "average_score": row["average_score"], "exam_count": row["exam_count"]})))
                if row["time_multiplier"] is not None:
                    self.update("""INSERT IGNORE INTO shsat_student_accommodations (student_user_id,time_multiplier)
                        VALUES (%s,%s)""",
                        (user_id, row["time_multiplier"]))

    def _import_groups_and_profiles(self) -> None:
        for row in self.rows("SELECT * FROM paper_group ORDER BY paper_group_id"):
            if self._already("group", row):
                continue
            match = self.target_rows("SELECT id FROM paper_groups WHERE exam_type_code='SHSAT' AND name=%s", (row["group_name"],))
            if match:
                raise ValueError(f"Paper group name collision requires review: {row['group_name']}")
            target_id = self.insert("""INSERT INTO paper_groups (exam_type_code,name,description,sort_order,created_at,updated_at)
                VALUES ('SHSAT',%s,%s,%s,%s,%s)""",
                (row["group_name"], row["group_desc"], row["display_order"], row["created_at"], row["updated_at"]))
            self._save_or_existing("group", row, target_id)

        for row in self.rows("SELECT * FROM scoring_profile ORDER BY scoring_profile_id"):
            if self._already("profile", row):
                continue
            existing = self.target_rows("""SELECT COALESCE(MAX(version_no),0) AS latest_version FROM scoring_profiles
                WHERE exam_type_code='SHSAT' AND profile_code=%s""", (row["profile_code"],))
            version_no = int(existing[0]["latest_version"]) + 1 if existing else 1
            config = {"sourceProfileId": row["scoring_profile_id"], "scoringMode": row["scoring_mode"],
                      "scaleVersion": row["scale_version"], "source": row["source"],
                      "sectionConfig": json_value(row["section_config"]), "compositeMaxScore": row["composite_max_score"]}
            target_id = self.insert("""INSERT INTO scoring_profiles
                (exam_type_code,profile_code,version_no,name,algorithm_code,config_json,is_estimated,sealed_at,created_at)
                VALUES ('SHSAT',%s,%s,%s,%s,CAST(%s AS JSON),%s,%s,%s)""",
                (row["profile_code"], version_no, row["profile_name"], row["scoring_mode"], json_text(config),
                 bool(row["is_estimated"]), row["created_at"], row["created_at"]))
            self._save_or_existing("profile", row, target_id)
            for scale in self.rows("SELECT * FROM scoring_scale_row WHERE scoring_profile_id=%s", (row["scoring_profile_id"],)):
                self.update("""INSERT INTO scoring_scale_rows (scoring_profile_id,section_code,variant_code,raw_score,scaled_score)
                    VALUES (%s,%s,'DEFAULT',%s,%s) ON DUPLICATE KEY UPDATE scaled_score=VALUES(scaled_score)""",
                    (target_id, scale["section_code"], scale["raw_score"], scale["scaled_score"]))

    def _import_papers_and_content(self) -> None:
        published_paper_ids = {int(row["paper_id"]) for row in self.rows("SELECT DISTINCT paper_id FROM exam WHERE is_published=1 AND deleted_at IS NULL")}
        for row in self.rows("SELECT * FROM paper ORDER BY paper_id"):
            if self._already("paper", row):
                continue
            group_id = self.maps.get(("group", int(row["paper_group_id"]))) if row["paper_group_id"] else None
            profile_id = self.maps.get(("profile", int(row["default_scoring_profile_id"]))) if row["default_scoring_profile_id"] else None
            status = row["status"] if row["status"] in ("DRAFT", "READY", "ARCHIVED") else "DRAFT"
            if int(row["paper_id"]) in published_paper_ids and status == "DRAFT":
                status = "READY"
            sealed = None if status == "DRAFT" else row["updated_at"]
            code = f"SHSAT-V2-{row['root_paper_id'] or row['paper_id']}"
            target_id = self.insert("""INSERT INTO papers
                (exam_type_code,group_id,paper_code,version_no,title,description,status,default_duration_seconds,
                 source_paper_id,created_by,sealed_at,created_at,updated_at,default_scoring_profile_id)
                VALUES ('SHSAT',%s,%s,%s,%s,%s,%s,%s,NULL,%s,%s,%s,%s,%s)""",
                (group_id, code, row["version_number"], row["paper_name"], row["paper_description"], status,
                 int(row["default_duration"]) * 60, self.system_user_id, sealed, row["created_at"], row["updated_at"], profile_id))
            self._save_or_existing("paper", row, target_id)
            self.insert("""INSERT INTO shsat_paper_metadata
                (paper_id,source_paper_id,root_source_paper_id,version_label,total_parts,total_questions,total_score,
                 is_online,display_order,source_metadata_json)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,CAST(%s AS JSON))""",
                (target_id, row["paper_id"], row["root_paper_id"], row["version_label"], row["total_parts"],
                 row["total_questions"], row["total_score"], bool(row["is_online"]), row["display_order"],
                 json_text(json_value(row["metadata"]))))
        # 第二轮关联版本父试卷，避免自引用父记录尚未插入。
        for row in self.rows("SELECT paper_id,source_paper_id,root_paper_id FROM paper"):
            target_id = self.maps.get(("paper", int(row["paper_id"])))
            parent_source = row["source_paper_id"] or row["root_paper_id"]
            if target_id and parent_source and int(parent_source) != int(row["paper_id"]):
                parent_target = self.maps.get(("paper", int(parent_source)))
                if parent_target:
                    self.update("UPDATE papers SET source_paper_id=%s WHERE id=%s", (parent_target, target_id))

        for row in self.rows("SELECT * FROM paper_part ORDER BY paper_id,display_order,part_id"):
            if self._already("part", row):
                self.maps[("part_category", int(row["part_id"]))] = int(self.target_rows(
                    "SELECT id FROM question_categories WHERE exam_type_code='SHSAT' AND code=%s",
                    (f"SHSAT_PART_{row['part_id']}",))[0]["id"])
                continue
            paper_id = self.mapped("paper", row["paper_id"])
            code = row["part_code"] or f"PART_{row['part_id']}"
            settings = {"sourcePartId": row["part_id"], "partNumber": row["part_number"], "partCode": row["part_code"],
                        "questionRange": row["question_range"], "questionCount": row["question_count"]}
            section = self.insert("""INSERT INTO paper_sections
                (paper_id,section_code,section_kind,title,sort_order,instructions,settings_json,created_at,updated_at)
                VALUES (%s,%s,'PART',%s,%s,%s,CAST(%s AS JSON),%s,%s)""",
                (paper_id, code, row["part_name"], row["display_order"], row["part_intro"], json_text(settings), row["created_at"], row["updated_at"]))
            self._save_or_existing("part", row, section)
            category_id = self.insert("""INSERT INTO question_categories (exam_type_code,code,name)
                VALUES ('SHSAT',%s,%s)""", (f"SHSAT_PART_{row['part_id']}", row["part_name"]))
            self.maps[("part_category", int(row["part_id"]))] = category_id

        for row in self.rows("SELECT * FROM paper_sub_type ORDER BY paper_id,display_order,sub_type_id"):
            if self._already("subtype", row):
                self.maps[("subtype_category", int(row["sub_type_id"]))] = int(self.target_rows(
                    "SELECT id FROM question_categories WHERE exam_type_code='SHSAT' AND code=%s",
                    (f"SHSAT_SUBTYPE_{row['sub_type_id']}",))[0]["id"])
                continue
            parent_id = self.mapped("part", row["part_id"])
            paper_id = self.mapped("paper", row["paper_id"])
            code = f"SUBTYPE_{row['sub_type_id']}"
            settings = {"sourceSubtypeId": row["sub_type_id"], "subtypeCode": row["sub_type_code"],
                        "questionRange": row["question_range"], "questionCount": row["question_count"]}
            section = self.insert("""INSERT INTO paper_sections
                (paper_id,parent_section_id,section_code,section_kind,title,sort_order,instructions,settings_json,created_at,updated_at)
                VALUES (%s,%s,%s,'SUBTYPE',%s,%s,%s,CAST(%s AS JSON),%s,%s)""",
                (paper_id, parent_id, code, row["sub_type_name"], row["display_order"], row["sub_type_intro"], json_text(settings), row["created_at"], row["updated_at"]))
            self._save_or_existing("subtype", row, section)
            category_id = self.insert("""INSERT INTO question_categories (exam_type_code,parent_id,code,name)
                VALUES ('SHSAT',%s,%s,%s)""", (self.maps[("part_category", int(row["part_id"]))],
                                                   f"SHSAT_SUBTYPE_{row['sub_type_id']}", row["sub_type_name"]))
            self.maps[("subtype_category", int(row["sub_type_id"]))] = category_id

        referenced_material_sections: dict[int, set[int]] = defaultdict(set)
        for question in self.rows("""SELECT material_id,part_id,sub_type_id FROM question
            WHERE material_id IS NOT NULL ORDER BY question_id"""):
            section = self.maps.get(("subtype", int(question["sub_type_id"]))) if question["sub_type_id"] else None
            section = section or (self.maps.get(("part", int(question["part_id"]))) if question["part_id"] else None)
            if section is not None:
                referenced_material_sections[int(question["material_id"])].add(section)

        for row in self.rows("SELECT * FROM material ORDER BY material_id"):
            if self._already("material", row):
                continue
            section_id = self.maps.get(("subtype", int(row["sub_type_id"]))) if row["sub_type_id"] else None
            section_id = section_id or (self.maps.get(("part", int(row["part_id"]))) if row["part_id"] else None)
            if section_id is None:
                referenced_sections = referenced_material_sections.get(int(row["material_id"]), set())
                if len(referenced_sections) > 1:
                    raise ValueError(f"SHSAT material {row['material_id']} is referenced from multiple paper sections")
                if referenced_sections:
                    section_id = referenced_sections.pop()
                else:
                    target_id = self.insert("""INSERT INTO shsat_paper_materials
                        (paper_id,source_material_id,material_type,category,title,content,asset_key,sort_order,
                         source_metadata_json,created_at,updated_at)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,CAST(%s AS JSON),%s,%s)""",
                        (self.mapped("paper", row["paper_id"]), row["material_id"], row["material_type"],
                         row["material_category"], row["material_title"], row["material_content"],
                         self.copy_asset(row["asset_url"]) if row["asset_url"] else None, row["display_order"],
                         json_text({"sourceAssetUrl": row["asset_url"], "legacyMaterialId": row["legacy_material_id"]}),
                         row["created_at"], row["updated_at"]))
                    self._save_or_existing("material", row, target_id)
                    continue
            asset_key = self.copy_asset(row["asset_url"]) if row["asset_url"] else None
            target_id = self.insert("""INSERT INTO shsat_section_materials
                (section_id,material_type,category,title,content,asset_key,sort_order,created_at,updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (section_id, row["material_type"], row["material_category"], row["material_title"], row["material_content"],
                 asset_key, row["display_order"], row["created_at"], row["updated_at"]))
            self._save_or_existing("material", row, target_id)

        for row in self.rows("SELECT * FROM question ORDER BY paper_id,question_number,question_id"):
            if self._already("question", row):
                question_id = self.mapped("question", row["question_id"])
                item = self.target_rows("SELECT id FROM paper_items WHERE question_id=%s ORDER BY id LIMIT 1", (question_id,))
                if not item:
                    raise ValueError(f"Imported question {row['question_id']} has no mapped paper item")
                self.maps[("paper_item", int(row["question_id"]))] = int(item[0]["id"])
                continue
            render = {"options": json_value(row["options"]), "questionConfig": json_value(row["question_config"]),
                      "validationRules": json_value(row["validation_rules"]), "sourceQuestionId": row["question_id"],
                      "sourceScoringSectionCode": row["scoring_section_code"],
                      "sourceDifficulty": row["difficulty"], "legacyCorrectAnswer": row["correct_answer"]}
            if row["material_id"]:
                render["materialId"] = self.mapped("material", row["material_id"])
            question_id = self.insert("""INSERT INTO questions
                (question_type_code,stem,render_json,answer_key_json,grading_json,explanation,created_at,updated_at)
                VALUES (%s,%s,CAST(%s AS JSON),CAST(%s AS JSON),CAST(%s AS JSON),%s,%s,%s)""",
                (row["question_type"], row["stem"] or "", json_text(render), json_text(json_value(row["correct_answer_data"])) or "{}",
                 json_text(json_value(row["scoring_rules"])), None, row["created_at"], row["updated_at"]))
            self._save_or_existing("question", row, question_id)
            subtype_id = self.maps.get(("subtype", int(row["sub_type_id"]))) if row["sub_type_id"] else None
            part_id = self.maps.get(("part", int(row["part_id"]))) if row["part_id"] else None
            section_id = subtype_id or part_id
            category_id = self.maps.get(("subtype_category", int(row["sub_type_id"]))) if row["sub_type_id"] else None
            category_id = category_id or (self.maps.get(("part_category", int(row["part_id"]))) if row["part_id"] else None)
            item_id = self.insert("""INSERT INTO paper_items
                (section_id,question_id,category_id,sort_order,display_number,max_points,scoring_section_code)
                VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (section_id, question_id, category_id, row["display_order"], row["question_number"], row["score"], row["scoring_section_code"]))
            self.maps[("paper_item", int(row["question_id"]))] = item_id
            if row["question_config"]:
                config = json_value(row["question_config"])
                skill = config.get("shsatSkillTag", {}) if isinstance(config, dict) else {}
                self.update("""INSERT INTO shsat_question_metadata (question_id,skill_tag_code,extra_json)
                    VALUES (%s,%s,CAST(%s AS JSON))""",
                    (question_id, skill.get("skillCode") if isinstance(skill, dict) else None,
                     json_text({"sourceQuestionConfig": config, "sourceQuestionId": row["question_id"]})))

        for row in self.rows("SELECT * FROM paper_solution ORDER BY solution_id"):
            if self._already("solution", row):
                continue
            asset_key = self.copy_asset(row["file_path"])
            solution_id = self.insert("""INSERT INTO shsat_paper_solutions
                (paper_id,original_file_name,asset_key,file_size,file_type,description,is_active,uploaded_by,created_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (self.mapped("paper", row["paper_id"]), row["original_file_name"], asset_key, row["file_size"],
                 row["file_type"], row["description"], bool(row["is_active"]), self.maps.get(("user", int(row["uploaded_by"]))) if row.get("uploaded_by") else None,
                 row["created_at"]))
            self._save_or_existing("solution", row, solution_id)

    def _import_exams(self) -> None:
        for row in self.rows("SELECT * FROM exam ORDER BY exam_id"):
            if self._already("exam", row):
                continue
            status = "CANCELLED" if row["deleted_at"] else ("PUBLISHED" if row["is_published"] else "DRAFT")
            target_type = row["target_type"]
            target_scope = "ALL_STUDENTS" if target_type == "ALL_STUDENTS" else "SELECTED"
            strategy = {"ALWAYS": "ALWAYS", "AFTER_SUBMIT": "AFTER_SUBMIT", "AFTER_END_TIME": "AFTER_CLOSE", "NEVER": "NEVER"}
            exam_id = self.insert("""INSERT INTO exams
                (paper_id,scoring_profile_id,title,description,status,target_scope,opens_at,closes_at,duration_seconds,
                 attempt_limit,answer_visibility,score_visibility,auto_submit,allow_review,created_by,published_at,archived_at,created_at,updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (self.mapped("paper", row["paper_id"]), self.maps.get(("profile", int(row["scoring_profile_id"]))) if row["scoring_profile_id"] else None,
                 row["exam_title"], row["exam_description"], status, target_scope, row["start_time"], row["end_time"], int(row["duration"]) * 60,
                 row["attempt_limit"], strategy[row["show_answer_strategy"]], strategy[row["show_score_strategy"]], bool(row["auto_submit"]),
                 bool(row["allow_review"]), self.maps.get(("user", int(row["created_by"]))) if row["created_by"] else self.system_user_id,
                 row["published_at"], row["deleted_at"], row["created_at"], row["updated_at"]))
            self._save_or_existing("exam", row, exam_id)
            target_json = json_value(row["target"]) or []
            if target_type == "SPECIFIC_CLASSES":
                for source_class in target_json:
                    self.update("INSERT IGNORE INTO exam_target_classes (exam_id,class_id) VALUES (%s,%s)",
                                (exam_id, self.mapped("class", int(source_class))))
            elif target_type == "SPECIFIC_STUDENTS":
                student_lookup = {int(r["student_id"]): int(r["user_id"]) for r in self.rows(
                    "SELECT student_id,user_id FROM users WHERE student_id IS NOT NULL")}
                for source_student in target_json:
                    user_row = student_lookup.get(int(source_student))
                    if user_row is None:
                        raise ValueError(f"Exam {row['exam_id']} targets unknown source student {source_student}")
                    user_id = self.mapped("user", user_row)
                    self.update("INSERT IGNORE INTO exam_target_students (exam_id,student_user_id) VALUES (%s,%s)", (exam_id, user_id))
            if row["is_published"] and not row["deleted_at"]:
                self._populate_exam_participants(exam_id, target_scope)

    def _populate_exam_participants(self, exam_id: int, target_scope: str) -> None:
        """还原发布考试的当前目标成员；历史作答者会在 attempt 导入时补齐。"""
        self.update("""INSERT IGNORE INTO exam_participants (exam_id,student_user_id)
            SELECT %s, ts.student_user_id FROM exam_target_students ts
            JOIN users u ON u.id=ts.student_user_id AND u.role_code='STUDENT' AND u.status='ACTIVE'
            WHERE ts.exam_id=%s
            UNION
            SELECT %s, cm.student_user_id FROM exam_target_classes tc
            JOIN classes c ON c.id=tc.class_id AND c.status='ACTIVE'
            JOIN class_memberships cm ON cm.class_id=c.id AND cm.left_at IS NULL
            JOIN users u ON u.id=cm.student_user_id AND u.role_code='STUDENT' AND u.status='ACTIVE'
            WHERE tc.exam_id=%s""", (exam_id, exam_id, exam_id, exam_id))
        if target_scope == "ALL_STUDENTS":
            self.update("""INSERT IGNORE INTO exam_participants (exam_id,student_user_id)
                SELECT %s,id FROM users WHERE role_code='STUDENT' AND status='ACTIVE'""", (exam_id,))

    def _import_attempts(self) -> None:
        attempts = self.rows("SELECT * FROM attempt ORDER BY attempt_id")
        newly_imported = set()
        student_lookup = {int(r["student_id"]): int(r["user_id"]) for r in self.rows(
            "SELECT student_id,user_id FROM users WHERE student_id IS NOT NULL")}
        for row in attempts:
            exam_id = self.mapped("exam", row["exam_id"])
            user_id = self.mapped("user", row["user_id"])
            participant = self.target_rows("SELECT 1 FROM exam_participants WHERE exam_id=%s AND student_user_id=%s", (exam_id, user_id))
            if not participant:
                self.update("""INSERT INTO exam_participants (exam_id,student_user_id,assigned_at)
                    VALUES (%s,%s,%s)""", (exam_id, user_id, row["created_at"]))
            if self._already("attempt", row):
                continue
            source_student = int(row["student_id"])
            if student_lookup.get(source_student) != int(row["user_id"]):
                raise ValueError(f"Attempt {row['attempt_id']} has mismatched user and student references")
            status = "SUBMITTED" if row["status"] == "COMPLETED" else row["status"]
            target_id = self.insert("""INSERT INTO attempts
                (exam_id,student_user_id,attempt_no,is_practice,status,started_at,submitted_at,expires_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,NULL)""",
                (exam_id, user_id, row["attempt_number"], bool(row["is_practice"]), status,
                 row["started_at"], row["submitted_at"]))
            self._save_or_existing("attempt", row, target_id)
            newly_imported.add(int(row["attempt_id"]))
            self._insert_result(row, target_id)
            self._insert_attempt_items(row, target_id)

        for row in attempts:
            if int(row["attempt_id"]) not in newly_imported:
                continue
            target_attempt = self.mapped("attempt", row["attempt_id"])
            if (row["attempt_progress_state"] or row["score_details"] or row["current_question_number"]
                    or row["current_open_material_id"] or row["focus_violation_count"]):
                runtime = {"attemptProgressState": json_value(row["attempt_progress_state"]),
                           "currentQuestionNumber": row["current_question_number"],
                           "currentQuestionEnteredAt": row["current_question_entered_at"],
                           "lastSeenAt": row["last_seen_at"], "focusViolationCount": row["focus_violation_count"],
                           "maxAccessibleQuestionNumber": row["max_accessible_question_number"],
                           "currentOpenMaterialId": row["current_open_material_id"]}
                progress = json_value(row["attempt_progress_state"])
                active_section = progress.get("currentSectionCode") if isinstance(progress, dict) else None
                self.update("""INSERT INTO shsat_attempt_state
                    (attempt_id,active_section_code,active_question_number,flow_json)
                    VALUES (%s,%s,%s,CAST(%s AS JSON))""",
                    (target_attempt, active_section, row["current_question_number"], json_text(runtime)))
            self.update("""INSERT INTO shsat_attempt_record_details
                (attempt_id,source_attempt_id,source_class_id,elapsed_seconds,completion_rate,accuracy,correct_count,wrong_count,
                 unanswered_count,auto_submitted,score_details_json,runtime_state_json,source_metadata_json)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,CAST(%s AS JSON),CAST(%s AS JSON),CAST(%s AS JSON))""",
                (target_attempt, row["attempt_id"], row["class_id"], row["time_used"], row["completion_rate"], row["accuracy"],
                 row["correct_count"], row["wrong_count"], row["unanswered_count"], bool(row["is_auto_submitted"]),
                 json_text(json_value(row["score_details"])), json_text({"effectiveDurationMinutes": row["effective_duration"],
                    "practiceSourceAttemptId": row["practice_source_attempt_id"], "practiceQuestionNumbers": json_value(row["practice_question_numbers"]),
                    "practiceTaskAssignmentId": row["practice_task_assignment_id"]}), json_text({"sourceStudentId": row["student_id"],
                    "sourcePaperId": row["paper_id"], "legacyExamResultId": row["legacy_exam_result_id"],
                    "legacyRecordId": row["legacy_record_id"], "sourceStatus": row["status"]})))

    def _insert_result(self, attempt: dict[str, Any], target_attempt: int) -> None:
        if attempt["status"] not in ("COMPLETED", "SUBMITTED", "EXPIRED"):
            return
        breakdown = {"sourceScoreDetails": json_value(attempt["score_details"]),
                     "section1Raw": str(attempt["section1_score"]), "section2Raw": str(attempt["section2_score"]),
                     "section1Scaled": attempt["section1_scaled_score"], "section2Scaled": attempt["section2_scaled_score"],
                     "totalScaled": attempt["total_scaled_score"], "completionRate": str(attempt["completion_rate"]),
                     "accuracy": str(attempt["accuracy"])}
        profile_id = self.maps.get(("profile", int(json_value(attempt["score_details"]).get("scoringProfileId")))) if attempt["score_details"] and isinstance(json_value(attempt["score_details"]), dict) and json_value(attempt["score_details"]).get("scoringProfileId") else None
        source_max = self.one("SELECT COALESCE(SUM(score),0) AS n FROM question WHERE paper_id=%s", (attempt["paper_id"],))["n"]
        self.update("""INSERT INTO attempt_results (attempt_id,scoring_profile_id,algorithm_version,total_points,max_points,
            ungraded_count,breakdown_json,graded_at) VALUES (%s,%s,%s,%s,%s,%s,CAST(%s AS JSON),%s)""",
            (target_attempt, profile_id, "SHSAT_V2", attempt["total_score"], source_max, attempt["unanswered_count"],
             json_text(breakdown), attempt["submitted_at"] or attempt["updated_at"]))
        self._import_breakdowns(attempt, target_attempt)

    def _import_breakdowns(self, attempt: dict[str, Any], target_attempt: int) -> None:
        for code, name, raw in (("ELA", "ELA", attempt["section1_score"]), ("MATH", "Math", attempt["section2_score"])):
            self.update("""INSERT INTO attempt_result_breakdowns
                (attempt_id,breakdown_code,dimension_kind,display_name,sort_order,raw_score,metrics_json)
                VALUES (%s,%s,'SECTION',%s,%s,%s,CAST(%s AS JSON))""",
                (target_attempt, code, name, 10 if code == "ELA" else 20, raw,
                 json_text({"scaledScore": attempt["section1_scaled_score"] if code == "ELA" else attempt["section2_scaled_score"]})))
        detail = json_value(attempt["score_details"])
        sections = detail.get("sections", {}) if isinstance(detail, dict) else {}
        for code, section in sections.items():
            normalized = str(code).upper()
            if normalized not in ("ELA", "MATH"):
                continue
            for subtype_code, subtype in (section.get("subtypes", {}) or {}).items():
                breakdown_code = f"{normalized}:{subtype_code}"
                self.update("""INSERT INTO attempt_result_breakdowns
                    (attempt_id,breakdown_code,parent_breakdown_code,dimension_kind,display_name,sort_order,raw_score,raw_max_score,scaled_score,metrics_json)
                    VALUES (%s,%s,%s,'SUBTYPE',%s,30,%s,%s,%s,CAST(%s AS JSON))""",
                    (target_attempt, breakdown_code, normalized, subtype.get("name", subtype_code), subtype.get("raw"),
                     subtype.get("maxRaw"), subtype.get("scaled"), json_text(subtype)))

    def _insert_attempt_items(self, attempt: dict[str, Any], target_attempt: int) -> None:
        question_rows = self.rows("""SELECT question_id,question_number FROM question WHERE paper_id=%s
            ORDER BY display_order,question_number,question_id""", (attempt["paper_id"],))
        attempt_item_ids: set[int] = set()
        for served, question in enumerate(question_rows, 1):
            item_id = self.maps[("paper_item", int(question["question_id"]))]
            attempt_item_ids.add(item_id)
            self.update("INSERT INTO attempt_items (attempt_id,paper_item_id,served_order) VALUES (%s,%s,%s)",
                        (target_attempt, item_id, served))
        snapshots = self.rows("SELECT * FROM attempt_question_snapshot WHERE attempt_id=%s ORDER BY question_number", (attempt["attempt_id"],))
        for snapshot in snapshots:
            item_id = self.maps.get(("paper_item", int(snapshot["question_id"])))
            if item_id not in attempt_item_ids:
                item_id = None
            payload = {key: json_value(value) if key in ("options", "question_config", "validation_rules", "scoring_rules", "correct_answer_data") else value
                       for key, value in snapshot.items()}
            payload["materialAssetKey"] = self.copy_asset(snapshot["asset_url"]) if snapshot["asset_url"] else None
            self.update("""INSERT INTO shsat_attempt_item_snapshots
                (attempt_id,source_snapshot_id,source_question_id,question_number,target_paper_item_id,snapshot_json)
                VALUES (%s,%s,%s,%s,%s,CAST(%s AS JSON))""",
                (target_attempt, snapshot["snapshot_id"], snapshot["question_id"], snapshot["question_number"],
                 item_id, json_text(payload)))
            self.save_mapping("snapshot", snapshot["snapshot_id"], item_id or target_attempt, snapshot)
        answers = self.rows("SELECT * FROM attempt_answer WHERE attempt_id=%s ORDER BY question_number", (attempt["attempt_id"],))
        for answer in answers:
            item_id = self.maps.get(("paper_item", int(answer["question_id"])))
            if item_id not in attempt_item_ids:
                item_id = None
            answer_json = json_value(answer["answer_data"])
            if answer_json is None:
                answer_json = {"legacyAnswer": answer["selected_answer"]}
            if item_id is not None:
                self.update("""INSERT INTO attempt_answers
                    (attempt_id,paper_item_id,answer_json,is_correct,awarded_points,time_spent_seconds,answered_at)
                    VALUES (%s,%s,CAST(%s AS JSON),%s,%s,%s,%s)""",
                    (target_attempt, item_id, json_text(answer_json), answer["is_correct"], answer["score"], answer["time_spent"],
                     answer["answered_at"] or answer["updated_at"] or answer["created_at"]))
            self.update("""INSERT INTO shsat_attempt_answer_details
                (attempt_id,source_answer_id,source_question_id,target_paper_item_id,answer_json,source_metadata_json)
                VALUES (%s,%s,%s,%s,CAST(%s AS JSON),CAST(%s AS JSON))""",
                (target_attempt, answer["answer_id"], answer["question_id"], item_id, json_text(answer_json),
                 json_text({key: json_value(value) for key, value in answer.items()})))
            self.save_mapping("answer", answer["answer_id"], item_id or target_attempt, answer)

    def _import_wrong_answer_tasks(self) -> None:
        for row in self.rows("SELECT * FROM wrong_answer_task ORDER BY task_id"):
            if self._already("wrong_task", row):
                continue
            task_id = self.insert("""INSERT INTO shsat_wrong_answer_tasks
                (exam_id,class_id,title,description,starts_at,ends_at,status,created_by,created_at,updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (self.mapped("exam", row["exam_id"]), self.mapped("class", row["class_id"]), row["title"], row["description"],
                 row["start_at"], row["due_at"], "ENDED" if row["status"] in ("CLOSED", "ENDED") else "PUBLISHED",
                 self.maps.get(("user", int(row["created_by"]))) if row["created_by"] else None, row["created_at"], row["updated_at"]))
            self._save_or_existing("wrong_task", row, task_id)
        for row in self.rows("SELECT * FROM wrong_answer_task_assignment ORDER BY assignment_id"):
            if self._already("wrong_assignment", row):
                continue
            user_row = self.rows("SELECT user_id FROM users WHERE student_id=%s", (row["student_id"],))
            if not user_row:
                raise ValueError(f"Wrong-answer assignment {row['assignment_id']} has no linked student account")
            assignment_id = self.insert("""INSERT INTO shsat_wrong_answer_assignments
                (task_id,student_user_id,source_attempt_id,question_numbers_json,status,practice_attempt_id,created_at,updated_at)
                VALUES (%s,%s,%s,CAST(%s AS JSON),%s,%s,%s,%s)""",
                (self.mapped("wrong_task", row["task_id"]), self.mapped("user", user_row[0]["user_id"]),
                 self.maps.get(("attempt", int(row["source_attempt_id"]))) if row["source_attempt_id"] else None,
                 json_text(json_value(row["question_numbers"]) or []), row["status"],
                 self.maps.get(("attempt", int(row["practice_attempt_id"]))) if row["practice_attempt_id"] else None,
                 row["created_at"], row["updated_at"]))
            self._save_or_existing("wrong_assignment", row, assignment_id)

    def _verify_import(self) -> None:
        # 外键确保本次数据的关联有效；这里额外核对核心对象映射数量。
        for entity, table in (("user", "users"), ("paper", "paper"), ("exam", "exam"), ("attempt", "attempt")):
            expected = int(self.one(f"SELECT COUNT(*) AS n FROM `{table}`")["n"])
            mapped = sum(1 for key in self.maps if key[0] == entity)
            if mapped != expected:
                raise ValueError(f"Verification failed for {entity}: mapped {mapped}, source has {expected}")

    def _map_counts(self) -> dict[str, int]:
        result: dict[str, int] = {}
        for entity, _ in self.maps:
            result[entity] = result.get(entity, 0) + 1
        return result


def connect(prefix: str, database: str):
    """按独立源/目标环境变量建连；密码只从环境读取，不进入命令行参数。"""
    if pymysql is None:
        raise RuntimeError("Install migration dependencies first: pip install -r scripts/requirements-migration.txt")
    return pymysql.connect(host=os.getenv(f"{prefix}_DB_HOST", "127.0.0.1"),
                           port=int(os.getenv(f"{prefix}_DB_PORT", "3306")),
                           user=os.getenv(f"{prefix}_DB_USER", "root"),
                           password=os.getenv(f"{prefix}_DB_PASSWORD", ""), database=database,
                           charset="utf8mb4", autocommit=False, cursorclass=DictCursor,
                           connect_timeout=10, read_timeout=120, write_timeout=120)


def backup_target(args: argparse.Namespace) -> None:
    """正式写入前通过 mysqldump 保存目标库；凭据仅通过子进程环境传递。"""
    if not args.execute:
        return
    if not args.backup_file:
        raise ValueError("--execute requires --backup-file so the target database is backed up first.")
    output = Path(args.backup_file).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [os.getenv("MYSQLDUMP_BIN", "mysqldump"), "--single-transaction", "--routines", "--triggers",
               "--host", os.getenv("TARGET_DB_HOST", "127.0.0.1"), "--port", os.getenv("TARGET_DB_PORT", "3306"),
               "--user", os.getenv("TARGET_DB_USER", "root"), args.target_database]
    env = os.environ.copy()
    if env.get("TARGET_DB_PASSWORD"):
        env["MYSQL_PWD"] = env["TARGET_DB_PASSWORD"]
    try:
        with output.open("wb") as backup:
            subprocess.run(command, stdout=backup, stderr=subprocess.PIPE, check=True, env=env)
    except (OSError, subprocess.CalledProcessError) as exc:
        output.unlink(missing_ok=True)
        reason = exc.stderr.decode("utf-8", "replace").strip() if isinstance(exc, subprocess.CalledProcessError) else str(exc)
        raise ValueError(f"Target backup failed; migration was not started: {reason}") from exc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="写入目标数据库；省略时在事务中演练后回滚")
    parser.add_argument("--source-database", default=os.getenv("SOURCE_DB_NAME", "shsat_exam_v2"))
    parser.add_argument("--target-database", default=os.getenv("TARGET_DB_NAME", "unified_exam_platform"))
    parser.add_argument("--account-map", help="人工核对的 source_user_id,target_user_id CSV")
    parser.add_argument("--source-asset-root", default=os.getenv("SOURCE_ASSET_ROOT"), help="源上传目录或可定位历史素材的根目录")
    parser.add_argument("--target-asset-root", default=os.getenv("TARGET_ASSET_ROOT", "backend/uploads"))
    parser.add_argument("--system-user-id", type=int, help="创建归档试卷时使用的平台管理员 ID")
    parser.add_argument("--allow-missing-assets", action="store_true",
                        help="缺失附件不阻止迁移；保留来源引用路径并在报告中列出")
    parser.add_argument("--backup-file", help="--execute 必填，写入前备份目标库的 .sql 文件")
    parser.add_argument("--report-json", help="预检报告文件路径")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.source_asset_root:
        raise SystemExit("Set SOURCE_ASSET_ROOT or pass --source-asset-root to locate SHSAT uploads.")
    source = connect("SOURCE", args.source_database)
    target = connect("TARGET", args.target_database)
    migration = Migration(source, target, args)
    try:
        summary = migration.preflight()
        if args.report_json:
            Path(args.report_json).write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        backup_target(args)
        counts = migration.import_all()
        mode = "executed" if args.execute else "dry-run; target transaction rolled back"
        print(json.dumps({"mode": mode, "source_database": args.source_database,
                          "target_database": args.target_database, "mapped_entities": counts,
                          "preflight": summary}, ensure_ascii=False, indent=2, default=str))
        return 0
    except Exception as exc:
        if os.getenv("SHSAT_MIGRATION_DEBUG") == "1":
            import traceback
            traceback.print_exc()
        target.rollback()
        for path in migration.created_files:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
        if args.report_json:
            Path(args.report_json).write_text(json.dumps({"preflight": migration.last_preflight_report, "error": str(exc)},
                                                         ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Migration stopped: {exc}", file=sys.stderr)
        return 1
    finally:
        source.close()
        target.close()


if __name__ == "__main__":
    raise SystemExit(main())
