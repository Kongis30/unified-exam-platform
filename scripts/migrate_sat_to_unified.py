#!/usr/bin/env python3
"""将独立 SAT/PSAT 数据迁入统一平台；默认只预检并回滚事务。"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

import pymysql

SOURCE_SYSTEM = "SAT_V1"
MAPPED_TARGET_TABLES = {
    "category": "question_categories",
    "class": "classes",
    "class_workspace": "classes",
    "inferred_attempt_class": "attempts",
    "exam": "exams",
    "exam_live_presence": "attempts",
    "exam_record": "attempts",
    "exam_report": "attempts",
    "group": "paper_groups",
    "material": "sat_materials",
    "paper": "papers",
    "paper_module": "paper_sections",
    "paper_question": "paper_items",
    "practice_archive": "exams",
    "question": "questions",
    "score_record": "attempts",
    "score_skill_analysis": "attempts",
    "user": "users",
    "user_answer": "paper_items",
}
SOURCE_TABLES = (
    "user", "class", "paper_group", "question_type", "material", "question", "paper",
    "paper_module", "paper_question", "exam", "user_exam", "exam_record", "user_answer",
    "scoring_version", "module_scoring", "score_record", "score_skill_analysis", "exam_report",
    "exam_live_presence", "sys_operation_log", "sys_config",
)


def json_value(value: Any) -> Any:
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8")
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def json_text(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False, default=str, separators=(",", ":"))


def fingerprint(row: dict[str, Any]) -> str:
    raw = json.dumps(row, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def table_name(value: str) -> str:
    return f"`{value}`"


class SatMigration:
    """将 SAT 行转换为共享主表，并在 SAT 扩展表保留专属状态。"""

    def __init__(self, source, target, args: argparse.Namespace):
        self.source = source
        self.target = target
        self.args = args
        self.account_map = self.read_account_map(args.account_map)
        self.paper_type_map = self.read_paper_type_map(args.paper_type_map)
        self.class_type_map = self.read_class_type_map(args.class_type_map)
        self.run_id: int | None = None
        self.maps: dict[tuple[str, str], int | None] = {}
        self.paper_types: dict[int, str] = {}
        self.paper_items: dict[int, list[tuple[int, int]]] = defaultdict(list)
        self.question_scores: dict[int, Decimal] = {}
        self.target_users: dict[int, int] = {}
        self.target_classes: dict[int, list[int]] = {}
        self.target_materials: dict[int, int] = {}
        self.target_questions: dict[int, int] = {}
        self.target_papers: dict[int, int] = {}
        self.target_exams: dict[int, int] = {}
        self.target_sections: dict[tuple[int, int], int] = {}
        self.target_paper_items: dict[int, int] = {}
        self.target_attempts: dict[int, int] = {}
        self.asset_cache: dict[str, str] = {}
        self.asset_index: dict[str, list[Path]] | None = None
        self.created_files: list[Path] = []

    @staticmethod
    def read_account_map(path: str | None) -> dict[int, int]:
        mapped: dict[int, int] = {}
        if not path:
            return mapped
        with open(path, newline="", encoding="utf-8-sig") as handle:
            for row in csv.DictReader(handle):
                source_id = row.get("source_user_id", "").strip()
                target_id = row.get("target_user_id", "").strip()
                if source_id and target_id and not source_id.startswith("#"):
                    key, value = int(source_id), int(target_id)
                    if key in mapped:
                        raise ValueError(f"Duplicate source_user_id in account map: {key}")
                    mapped[key] = value
        return mapped

    @staticmethod
    def read_paper_type_map(path: str | None) -> dict[int, str]:
        """读取人工核定的试卷类型，缺项时禁止猜测归属。"""
        if not path:
            raise ValueError("An explicit --paper-type-map is required for every source paper.")
        mapped: dict[int, str] = {}
        with open(path, newline="", encoding="utf-8-sig") as handle:
            for row in csv.DictReader(handle):
                source_id = int(row["source_paper_id"])
                exam_type = row["exam_type"].strip().upper()
                if source_id in mapped or exam_type not in {"SAT", "PSAT"}:
                    raise ValueError(f"Invalid or duplicate paper type mapping for {source_id}.")
                mapped[source_id] = exam_type
        return mapped

    @staticmethod
    def read_class_type_map(path: str) -> dict[int, set[str]]:
        """读取旧班级的明确归属；两个模块均需保留时分别创建班级。"""
        mapped: dict[int, set[str]] = defaultdict(set)
        with open(path, newline="", encoding="utf-8-sig") as handle:
            for row in csv.DictReader(handle):
                source_id = int(row["source_class_id"])
                exam_type = row["exam_type"].strip().upper()
                if exam_type not in {"SAT", "PSAT"} or exam_type in mapped[source_id]:
                    raise ValueError(f"Invalid or duplicate class type mapping for {source_id}.")
                mapped[source_id].add(exam_type)
        return dict(mapped)

    def source_rows(self, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        with self.source.cursor() as cursor:
            cursor.execute(sql, params)
            return list(cursor.fetchall())

    def target_rows(self, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        with self.target.cursor() as cursor:
            cursor.execute(sql, params)
            return list(cursor.fetchall())

    def source_count(self, table: str) -> int:
        with self.source.cursor() as cursor:
            cursor.execute(f"SELECT COUNT(*) AS n FROM {table_name(table)}")
            return int(cursor.fetchone()["n"])

    def insert(self, sql: str, params: tuple[Any, ...]) -> int:
        with self.target.cursor() as cursor:
            cursor.execute(sql, params)
            return int(cursor.lastrowid)

    def update(self, sql: str, params: tuple[Any, ...]) -> int:
        with self.target.cursor() as cursor:
            return cursor.execute(sql, params)

    def one(self, sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
        rows = self.target_rows(sql, params)
        return rows[0] if rows else None

    def source_one(self, sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
        rows = self.source_rows(sql, params)
        return rows[0] if rows else None

    def save_map(self, entity: str, source_id: Any, target_id: int | None, row: dict[str, Any]) -> None:
        key = str(source_id)
        self.maps[(entity, key)] = target_id
        self.insert("""INSERT INTO sat_import_id_map
            (source_system, entity_type, source_id, target_id, source_fingerprint, import_run_id)
            VALUES (%s,%s,%s,%s,%s,%s)""",
            (SOURCE_SYSTEM, entity, key, target_id, fingerprint(row), self.run_id))

    def mapped(self, entity: str, source_id: Any) -> int:
        key = (entity, str(source_id))
        if key not in self.maps or self.maps[key] is None:
            raise ValueError(f"Missing target mapping for {entity} source ID {source_id}")
        return int(self.maps[key])

    def asset_references(self) -> list[str]:
        rows = self.source_rows("SELECT file_url FROM material WHERE file_url IS NOT NULL AND TRIM(file_url)<>''")
        return sorted({str(row["file_url"]) for row in rows})

    def find_asset(self, url: str) -> Path | None:
        if self.args.source_asset_root is None:
            return None
        root = Path(self.args.source_asset_root).expanduser().resolve()
        parsed_path = unquote(urlparse(url).path)
        suffix = parsed_path.split("/uploads/", 1)[-1] if "/uploads/" in parsed_path else Path(parsed_path).name
        direct = (root / "uploads" / suffix).resolve()
        if direct.is_file() and direct.is_relative_to(root):
            return direct
        if self.asset_index is None:
            self.asset_index = defaultdict(list)
            if root.is_dir():
                for path in root.rglob("*"):
                    if path.is_file() and "node_modules" not in path.parts and ".git" not in path.parts:
                        self.asset_index[path.name].append(path)
        matches = self.asset_index.get(Path(suffix).name, [])
        return matches[0] if matches else None

    def preflight(self) -> dict[str, Any]:
        required_tables = {
            "sat_import_runs", "sat_import_id_map", "sat_class_settings", "sat_exam_settings",
            "sat_attempt_details", "sat_answer_details", "sat_import_orphan_attempts",
            "sat_paper_settings", "sat_materials", "sat_question_materials", "sat_practice_papers",
            "sat_practice_paper_templates",
        }
        existing = {row["TABLE_NAME"] for row in self.target_rows("""SELECT TABLE_NAME FROM information_schema.TABLES
            WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'""")}
        absent = sorted(required_tables - existing)
        if absent:
            raise ValueError("Apply the current Flyway migrations before SAT import; missing tables: " + ", ".join(absent))
        type_codes = {row["code"] for row in self.target_rows("SELECT code FROM exam_types WHERE code IN ('SAT','PSAT')")}
        if type_codes != {"SAT", "PSAT"}:
            raise ValueError("Target must contain both SAT and PSAT exam types before import.")

        counts = {name: self.source_count(name) for name in SOURCE_TABLES}
        saved = self.one("SELECT COUNT(*) AS n FROM sat_import_id_map WHERE source_system=%s", (SOURCE_SYSTEM,))
        latest_run_id = None
        if int(saved["n"]):
            latest_run = self.one("""SELECT id,status FROM sat_import_runs
                WHERE source_database=%s ORDER BY id DESC LIMIT 1""", (self.args.source_database,))
            if not latest_run or latest_run["status"] != "COMPLETED":
                raise ValueError("SAT import mappings exist without a completed run; manual reconciliation is required.")
            latest_run_id = int(latest_run["id"])
            mapped_counts = {row["entity_type"]: int(row["n"]) for row in self.target_rows("""
                SELECT entity_type,COUNT(*) AS n FROM sat_import_id_map
                WHERE source_system=%s AND import_run_id=%s GROUP BY entity_type""",
                (SOURCE_SYSTEM, latest_run["id"]))}
            expected_mappings = {
                "user": counts["user"], "class": counts["class"], "paper": counts["paper"],
                "paper_module": counts["paper_module"], "paper_question": counts["paper_question"],
                "question": counts["question"], "material": counts["material"], "exam": counts["exam"],
                "user_exam": counts["user_exam"], "exam_record": counts["exam_record"],
                "user_answer": counts["user_answer"],
            }
            mapping_mismatches = {entity: (mapped_counts.get(entity, 0), expected)
                                  for entity, expected in expected_mappings.items()
                                  if mapped_counts.get(entity, 0) != expected}
            if mapping_mismatches:
                raise ValueError(f"Completed SAT import mapping counts do not match source data: {mapping_mismatches}")
        prior_mappings = self.target_rows("""SELECT entity_type,source_id,target_id FROM sat_import_id_map
            WHERE source_system=%s AND target_id IS NOT NULL""", (SOURCE_SYSTEM,))
        prior_targets = {(row["entity_type"], str(row["source_id"])): int(row["target_id"])
                         for row in prior_mappings}
        source_users = self.source_rows("SELECT id, username, real_name, role FROM `user` ORDER BY id")
        target_users = self.target_rows("SELECT id, username, real_name, role_code FROM users")
        by_username = {str(row["username"]).casefold(): row for row in target_users}
        name_roles: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
        for row in target_users:
            name_roles[(str(row["real_name"]).strip().casefold(), str(row["role_code"]).upper())].append(row)
        user_conflicts = []
        for row in source_users:
            source_id = int(row["id"])
            username_target = by_username.get(str(row["username"]).casefold())
            name_targets = name_roles.get((str(row["real_name"]).strip().casefold(), str(row["role"]).upper()), [])
            if username_target or name_targets:
                proposed = self.account_map.get(source_id, prior_targets.get(("user", str(source_id))))
                matching = username_target or (name_targets[0] if len(name_targets) == 1 else None)
                if not matching or proposed != int(matching["id"]):
                    user_conflicts.append({"source_user_id": source_id, "target_user_ids": [int(x["id"]) for x in ([username_target] if username_target else name_targets)],
                                           "username_collision": bool(username_target), "name_role_collision": bool(name_targets)})
            elif source_id in self.account_map:
                target_id = self.account_map[source_id]
                mapped = next((user for user in target_users if int(user["id"]) == target_id), None)
                if not mapped or mapped["role_code"] != str(row["role"]).upper():
                    raise ValueError(f"Account map for source user {source_id} does not point to an existing same-role account.")

        source_classes = self.source_rows("SELECT id,class_name FROM `class` ORDER BY id")
        source_class_ids = {int(row["id"]) for row in source_classes}
        if source_class_ids != set(self.class_type_map):
            raise ValueError(f"Class type mapping must match source classes; missing={sorted(source_class_ids - set(self.class_type_map))}, extra={sorted(set(self.class_type_map) - source_class_ids)}")
        if latest_run_id:
            expected_class_keys = {f"{source_id}:{exam_type}" for source_id, types in self.class_type_map.items() for exam_type in types}
            class_links = self.target_rows("""SELECT m.source_id,m.target_id,cw.exam_type_code
                FROM sat_import_id_map m LEFT JOIN class_exam_workspaces cw
                    ON cw.class_id=m.target_id AND cw.exam_type_code=SUBSTRING_INDEX(m.source_id,':',-1)
                WHERE m.source_system=%s AND m.entity_type='class_workspace' AND m.import_run_id=%s""",
                (SOURCE_SYSTEM, latest_run_id))
            if ({row["source_id"] for row in class_links} != expected_class_keys
                    or any(row["exam_type_code"] is None for row in class_links)
                    or len({row["target_id"] for row in class_links}) != len(class_links)):
                raise ValueError("Imported class workspace mappings do not match the confirmed separate class assignments.")
        target_classes = self.target_rows("SELECT id,name FROM classes")
        target_classes_by_name: dict[str, set[int]] = defaultdict(set)
        for row in target_classes:
            target_classes_by_name[str(row["name"]).casefold()].add(int(row["id"]))
        class_conflicts = []
        for row in source_classes:
            matching_targets = target_classes_by_name.get(str(row["class_name"]).casefold(), set())
            mapped_target = prior_targets.get(("class", str(row["id"])))
            if matching_targets and mapped_target not in matching_targets:
                class_conflicts.append(int(row["id"]))

        source_papers = self.source_rows("SELECT id,paper_code,paper_name,status FROM paper ORDER BY id")
        source_paper_ids = {int(row["id"]) for row in source_papers}
        if source_paper_ids != set(self.paper_type_map):
            raise ValueError(f"Paper type mapping must match the source papers; missing={sorted(source_paper_ids - set(self.paper_type_map))}, extra={sorted(set(self.paper_type_map) - source_paper_ids)}")
        paper_conflicts = []
        existing_papers = {(row["exam_type_code"], str(row["paper_code"]).casefold(), int(row["version_no"])): int(row["id"])
                           for row in self.target_rows("SELECT id,exam_type_code,paper_code,version_no FROM papers")}
        for row in source_papers:
            code = self.paper_type_map[int(row["id"])]
            key = (code, str(row["paper_code"]).casefold(), 1)
            mapped_target = prior_targets.get(("paper", str(row["id"])))
            if key in existing_papers and mapped_target != existing_papers[key]:
                paper_conflicts.append({"source_paper_id": int(row["id"]), "exam_type_code": code, "paper_code": row["paper_code"]})
            if len(str(row["paper_code"])) > 80:
                raise ValueError(f"Source paper code exceeds target limit: source paper {row['id']}.")

        missing_target_mappings = self.missing_target_mappings(latest_run_id) if latest_run_id else {}
        # 旧库里题量汇总字段可能落后于实际关联关系；预检报告保留两者，避免导入时误按过期数量删题。
        paper_question_count_mismatches = self.source_rows("""SELECT p.id AS source_paper_id, p.paper_name,
                COALESCE(p.total_questions, 0) AS declared_question_count,
                COUNT(pq.id) AS linked_question_count,
                COUNT(DISTINCT pq.question_id) AS unique_question_count
            FROM paper p LEFT JOIN paper_question pq ON pq.paper_id = p.id
            GROUP BY p.id, p.paper_name, p.total_questions
            HAVING COALESCE(p.total_questions, 0) <> COUNT(pq.id)
            ORDER BY p.id""")
        module_question_count_mismatches = self.source_rows("""SELECT p.id AS source_paper_id, p.paper_name,
                pm.id AS source_module_id, pm.module_name,
                COALESCE(pm.question_count, 0) AS declared_question_count,
                COUNT(pq.id) AS linked_question_count,
                COUNT(DISTINCT pq.question_id) AS unique_question_count
            FROM paper_module pm JOIN paper p ON p.id = pm.paper_id
            LEFT JOIN paper_question pq ON pq.paper_id = p.id AND pq.module_id = pm.id
            GROUP BY p.id, p.paper_name, pm.id, pm.module_name, pm.question_count
            HAVING COALESCE(pm.question_count, 0) <> COUNT(pq.id)
            ORDER BY p.id, pm.sort_order, pm.id""")

        invalid_links = {
            "orphan_paper_questions": int(self.source_one("""SELECT COUNT(*) n FROM paper_question pq
                LEFT JOIN paper p ON p.id=pq.paper_id LEFT JOIN question q ON q.id=pq.question_id
                WHERE p.id IS NULL OR q.id IS NULL""")["n"]),
            "orphan_question_types": int(self.source_one("""SELECT COUNT(*) n FROM question q
                LEFT JOIN question_type qt ON qt.id=q.type_id WHERE qt.id IS NULL""")["n"]),
            "orphan_user_enrollments": int(self.source_one("""SELECT COUNT(*) n FROM user_exam ue
                LEFT JOIN `user` u ON u.id=ue.user_id LEFT JOIN exam e ON e.id=ue.exam_id
                WHERE u.id IS NULL OR e.id IS NULL""")["n"]),
            "orphan_attempt_users": int(self.source_one("""SELECT COUNT(*) n FROM exam_record er
                LEFT JOIN user_exam ue ON ue.id=er.user_exam_id
                LEFT JOIN `user` direct_user ON direct_user.id=er.student_id
                LEFT JOIN `user` enrolled_user ON enrolled_user.id=ue.user_id
                WHERE COALESCE(direct_user.id,enrolled_user.id) IS NULL""")["n"]),
            "orphan_answers": int(self.source_one("""SELECT COUNT(*) n FROM user_answer ua
                LEFT JOIN exam_record er ON er.id=ua.record_id LEFT JOIN question q ON q.id=ua.question_id
                WHERE er.id IS NULL OR q.id IS NULL""")["n"]),
            "orphan_material_links": int(self.source_one("""SELECT COUNT(*) n FROM question q
                LEFT JOIN material m ON m.id=q.material_id WHERE q.material_id IS NOT NULL AND m.id IS NULL""")["n"]),
            "mismatched_formal_attempts": int(self.source_one("""SELECT COUNT(*) n FROM exam_record er
                JOIN user_exam ue ON ue.id=er.user_exam_id JOIN exam e ON e.id=ue.exam_id
                WHERE (er.student_id IS NOT NULL AND er.student_id<>ue.user_id)
                   OR (er.paper_id IS NOT NULL AND er.paper_id<>e.paper_id)""")["n"]),
            "orphan_class_teachers": int(self.source_one("""SELECT COUNT(*) n FROM `class` c
                LEFT JOIN `user` u ON u.id=c.teacher_id WHERE c.teacher_id IS NOT NULL AND u.id IS NULL""")["n"]),
        }
        orphan_records = self.source_rows("""SELECT er.id FROM exam_record er
            LEFT JOIN user_exam ue ON ue.id=er.user_exam_id
            LEFT JOIN `user` direct_user ON direct_user.id=er.student_id
            LEFT JOIN `user` enrolled_user ON enrolled_user.id=ue.user_id
            WHERE COALESCE(direct_user.id,enrolled_user.id) IS NULL ORDER BY er.id""")
        hard_errors = {key: count for key, count in invalid_links.items() if key != "orphan_attempt_users" and count}
        if hard_errors:
            raise ValueError(f"Source integrity check failed: {hard_errors}")

        asset_refs = self.asset_references()
        missing_assets = [url for url in asset_refs if self.find_asset(url) is None]
        existing_import = int(saved["n"])
        report = {
            "source_database": self.args.source_database,
            "target_database": self.args.target_database,
            "source_counts": counts,
            "paper_types": self.paper_type_map,
            "class_types": {key: sorted(value) for key, value in self.class_type_map.items()},
            "username_and_identity_conflicts": user_conflicts,
            "class_name_conflicts": class_conflicts,
            "paper_code_conflicts": paper_conflicts,
            "asset_references": len(asset_refs),
            "missing_assets": missing_assets,
            "invalid_links": invalid_links,
            "archived_orphan_record_ids": [int(row["id"]) for row in orphan_records],
            "previously_imported_rows": existing_import,
            "missing_target_mappings": missing_target_mappings,
            "paper_question_count_mismatches": paper_question_count_mismatches,
            "module_question_count_mismatches": module_question_count_mismatches,
        }
        if user_conflicts:
            raise ValueError("Account conflicts need an explicit --account-map after manual identity review.")
        if class_conflicts:
            raise ValueError("Class-name conflicts need manual review before SAT import.")
        if paper_conflicts:
            raise ValueError("Paper-code/version conflicts need manual review before SAT import.")
        if missing_assets and not self.args.allow_missing_assets:
            raise ValueError("Some source image files are missing. Review --report-json, then use --allow-missing-assets to retain their source references.")
        return report

    def missing_target_mappings(self, import_run_id: int) -> dict[str, list[dict[str, Any]]]:
        """Report imported targets removed or otherwise missing since the completed run."""
        missing: dict[str, list[dict[str, Any]]] = {}
        for entity, target_table in MAPPED_TARGET_TABLES.items():
            rows = self.target_rows(f"""SELECT m.source_id,m.target_id
                FROM sat_import_id_map m LEFT JOIN `{target_table}` t ON t.id=m.target_id
                WHERE m.source_system=%s AND m.entity_type=%s AND m.import_run_id=%s
                    AND m.target_id IS NOT NULL AND t.id IS NULL ORDER BY m.source_id""",
                (SOURCE_SYSTEM, entity, import_run_id))
            if rows:
                missing[entity] = [{"source_id": str(row["source_id"]), "target_id": int(row["target_id"])}
                                   for row in rows]
        return missing

    def save_mapping_if_new(self, entity: str, source_id: Any, target_id: int | None, row: dict[str, Any]) -> int | None:
        existing = self.one("SELECT target_id,source_fingerprint FROM sat_import_id_map WHERE source_system=%s AND entity_type=%s AND source_id=%s",
                            (SOURCE_SYSTEM, entity, str(source_id)))
        if existing:
            if existing["source_fingerprint"] != fingerprint(row):
                raise ValueError(f"Source {entity} {source_id} changed after its previous import; reconcile manually.")
            value = int(existing["target_id"]) if existing["target_id"] is not None else None
            self.maps[(entity, str(source_id))] = value
            return value
        self.save_map(entity, source_id, target_id, row)
        return target_id

    def map_users(self) -> None:
        target_by_source: dict[int, int] = {}
        for row in self.source_rows("SELECT * FROM `user` ORDER BY id"):
            source_id = int(row["id"])
            key = str(source_id)
            existing = self.one("SELECT target_id,source_fingerprint FROM sat_import_id_map WHERE source_system=%s AND entity_type='user' AND source_id=%s",
                                (SOURCE_SYSTEM, key))
            if existing:
                if existing["source_fingerprint"] != fingerprint(row):
                    raise ValueError(f"Source user {source_id} changed after its previous import.")
                target_id = int(existing["target_id"])
            elif source_id in self.account_map:
                target_id = self.account_map[source_id]
                self.save_map("user", source_id, target_id, row)
            else:
                target_id = self.insert("""INSERT INTO users
                    (username,password_hash,real_name,role_code,email,phone,status,created_at,updated_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (row["username"], row["password"], row["real_name"], str(row["role"]).upper(),
                     row.get("email"), row.get("phone"), "ACTIVE" if int(row["status"]) else "DISABLED",
                     row["create_time"], row["update_time"]))
                self.save_map("user", source_id, target_id, row)
            target_by_source[source_id] = target_id
        self.target_users = target_by_source

    def map_classes(self) -> None:
        for row in self.source_rows("SELECT * FROM `class` ORDER BY id"):
            source_id = int(row["id"])
            self.target_classes[source_id] = []
            for exam_type in sorted(self.class_type_map[source_id], key=lambda value: value != "SAT"):
                target_id = self.insert("""INSERT INTO classes (name,description,status,sort_order,created_at,updated_at)
                VALUES (%s,%s,%s,%s,%s,%s)""",
                (row["class_name"], None, "ACTIVE" if int(row["is_active"]) else "ARCHIVED", int(row["sort"]),
                 row["create_time"], row["update_time"]))
                if not self.target_classes[source_id]:
                    self.save_map("class", source_id, target_id, row)
                self.target_classes[source_id].append(target_id)
                self.save_map("class_workspace", f"{source_id}:{exam_type}", target_id, row)
                self.update("INSERT INTO class_exam_workspaces (class_id,exam_type_code) VALUES (%s,%s)", (target_id, exam_type))
                teacher = self.target_users.get(int(row["teacher_id"])) if row.get("teacher_id") is not None else None
                metadata = {key: row.get(key) for key in ("id", "class_name", "teacher_id", "start_date", "end_date", "is_active", "student_count", "sort", "create_time", "update_time")}
                self.update("""INSERT INTO sat_class_settings
                (class_id,teacher_user_id,starts_on,ends_on,source_status,source_student_count,source_sort_order,source_metadata_json)
                VALUES (%s,%s,%s,%s,%s,%s,%s,CAST(%s AS JSON))""",
                (target_id, teacher, row.get("start_date"), row.get("end_date"), int(row["is_active"]),
                 row.get("student_count"), int(row["sort"]), json_text(metadata)))
        for row in self.source_rows("SELECT id,class_id,create_time,update_time FROM `user` WHERE role='student' AND class_id IS NOT NULL ORDER BY id"):
            if int(row["class_id"]) not in self.target_classes:
                raise ValueError(f"Student source user {row['id']} references missing class {row['class_id']}.")
            for class_id in self.target_classes[int(row["class_id"])]:
                self.update("""INSERT INTO class_memberships (class_id,student_user_id,joined_at)
                    VALUES (%s,%s,%s)""", (class_id, self.target_users[int(row["id"])], row["create_time"]))

    def derive_paper_types(self) -> None:
        self.paper_types = dict(self.paper_type_map)

    def map_groups(self) -> None:
        usages: dict[int, set[str]] = defaultdict(set)
        for row in self.source_rows("SELECT id,group_id FROM paper WHERE group_id IS NOT NULL"):
            usages[int(row["group_id"])].add(self.paper_types[int(row["id"])])
        for row in self.source_rows("SELECT * FROM paper_group ORDER BY id"):
            group_id = int(row["id"])
            types = usages.get(group_id) or {"SAT"}
            for exam_type in sorted(types):
                key = f"{exam_type}:{group_id}"
                target_id = self.insert("""INSERT INTO paper_groups (exam_type_code,name,sort_order,created_at,updated_at)
                    VALUES (%s,%s,%s,%s,%s)""",
                    (exam_type, row["group_name"], int(row["sort"]), row["create_time"], row["update_time"]))
                self.maps[("group", key)] = target_id
                self.save_map("group", key, target_id, row)

    def copy_asset(self, url: str) -> str:
        if url in self.asset_cache:
            return self.asset_cache[url]
        source_path = self.find_asset(url)
        if source_path is None:
            self.asset_cache[url] = url
            return url
        digest = hashlib.sha256(source_path.read_bytes()).hexdigest()
        target_root = Path(self.args.target_asset_root).expanduser().resolve()
        target_path = target_root / "sat-import" / "materials" / f"{digest[:16]}_{source_path.name}"
        target_path.parent.mkdir(parents=True, exist_ok=True)
        if not target_path.exists():
            shutil.copy2(source_path, target_path)
            self.created_files.append(target_path)
        public_url = f"/sat-api/uploads/materials/{target_path.name}"
        self.asset_cache[url] = public_url
        return public_url

    def map_materials(self) -> None:
        for row in self.source_rows("SELECT * FROM material ORDER BY id"):
            source_id = int(row["id"])
            file_url = self.copy_asset(str(row["file_url"])) if row.get("file_url") else None
            kind = str(row["material_type"])
            # 目标 SAT 素材表只声明 text/image/mixed；表格按 mixed 保留原 HTML 内容。
            target_kind = kind if kind in {"text", "image", "mixed"} else "mixed"
            if not row.get("content") and not file_url:
                # 空记录无法满足目标素材约束，保留在迁移映射中，不伪造可编辑素材。
                self.save_map("material", source_id, None, row)
                continue
            target_id = self.insert("""INSERT INTO sat_materials
                (title,material_type,content,file_url,source,created_at,updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (row["material_name"] or f"Imported material {source_id}", target_kind, row.get("content"),
                 file_url, row.get("source"), row["create_time"], row["update_time"]))
            self.target_materials[source_id] = target_id
            self.save_map("material", source_id, target_id, row)

    def map_categories(self) -> None:
        rows = self.source_rows("SELECT * FROM question_type ORDER BY id")
        for exam_type in ("SAT", "PSAT"):
            pending = list(rows)
            while pending:
                remaining = []
                progressed = False
                for row in pending:
                    source_id = int(row["id"])
                    source_parent = int(row["parent_id"] or 0)
                    parent_key = f"{exam_type}:{source_parent}"
                    if source_parent not in (0, source_id) and ("category", parent_key) not in self.maps:
                        remaining.append(row)
                        continue
                    parent_id = self.maps.get(("category", parent_key)) if source_parent not in (0, source_id) else None
                    name = str(row["type_name"] or f"Question type {source_id}")[:100]
                    code = f"LEGACY_TYPE_{source_id}"
                    target_id = self.insert("""INSERT INTO question_categories
                        (exam_type_code,parent_id,code,name,created_at) VALUES (%s,%s,%s,%s,%s)""",
                        (exam_type, parent_id, code, name, datetime.now()))
                    key = f"{exam_type}:{source_id}"
                    self.maps[("category", key)] = target_id
                    self.save_map("category", key, target_id, row)
                    progressed = True
                if not progressed:
                    unresolved = [int(row["id"]) for row in remaining]
                    raise ValueError(f"Cannot resolve source SAT question type parents: {unresolved[:10]}")
                pending = remaining

    def map_questions(self) -> None:
        used = {int(row["question_id"]) for row in self.source_rows("SELECT DISTINCT question_id FROM paper_question")}
        for row in self.source_rows("SELECT * FROM question ORDER BY id"):
            source_id = int(row["id"])
            options = json_value(row.get("options"))
            if not isinstance(options, dict):
                options = {}
            options = {str(k): v if isinstance(v, str) else json_text(v) or "" for k, v in options.items()}
            source_type = self.source_one("SELECT type_name FROM question_type WHERE id=%s", (row["type_id"],))
            subject = "RW" if row["subject"] == "RW" else "Math"
            render = {"options": options, "sat": {
                "subject": subject, "typeId": int(row["type_id"]),
                "typeName": source_type["type_name"] if source_type else "Multiple Choice",
                "difficulty": str(row["difficulty"] or "Medium"), "tags": row.get("tags") or "",
                "sourceQuestionId": source_id, "sourceMaterialRef": row.get("material_ref"),
            }}
            answer = {"correctAnswer": row["correct_answer"]}
            grading = {"score": row["score"], "sourceDifficulty": row["difficulty"]}
            has_options = bool(options)
            target_id = self.insert("""INSERT INTO questions
                (question_type_code,payload_schema_version,stem,render_json,answer_key_json,grading_json,explanation,sealed_at,created_at,updated_at)
                VALUES (%s,1,%s,CAST(%s AS JSON),CAST(%s AS JSON),CAST(%s AS JSON),%s,%s,%s,%s)""",
                ("SAT_MULTIPLE_CHOICE" if has_options else "SAT_FILL_IN_BLANK", row["content"],
                 json_text(render), json_text(answer), json_text(grading), row.get("analysis"),
                 row["update_time"] if source_id in used else None, row["create_time"], row["update_time"]))
            self.target_questions[source_id] = target_id
            self.question_scores[source_id] = Decimal(str(row["score"] or 0))
            self.save_map("question", source_id, target_id, row)
            source_material = row.get("material_id")
            if source_material is not None and int(source_material) in self.target_materials:
                self.update("""INSERT INTO sat_question_materials (question_id,material_id,material_ref)
                    VALUES (%s,%s,%s)""", (target_id, self.target_materials[int(source_material)], row.get("material_ref")))

    def map_papers(self) -> None:
        admin_source = self.source_one("SELECT id FROM `user` WHERE role='admin' ORDER BY id LIMIT 1")
        if not admin_source:
            raise ValueError("Source SAT database has no admin account to own imported papers and exams.")
        created_by = self.target_users[int(admin_source["id"])]
        papers = {int(row["id"]): row for row in self.source_rows("SELECT * FROM paper ORDER BY id")}
        modules_by_paper: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for module in self.source_rows("SELECT * FROM paper_module ORDER BY paper_id,sort_order,id"):
            modules_by_paper[int(module["paper_id"])].append(module)
        for row in papers.values():
            source_id = int(row["id"])
            exam_type = self.paper_types[source_id]
            group_id = self.maps.get(("group", f"{exam_type}:{row['group_id']}")) if row.get("group_id") is not None else None
            status = str(row["status"]).lower()
            target_status = "DRAFT" if status == "draft" else "ARCHIVED" if status in {"offline", "obsolete"} else "READY"
            sealed_at = None if target_status == "DRAFT" else row["update_time"] or row["create_time"]
            duration = sum(duration_seconds(module["time_limit"]) for module in modules_by_paper.get(int(row["id"]), [])) + 600
            target_id = self.insert("""INSERT INTO papers
                (exam_type_code,group_id,paper_code,version_no,title,description,status,default_duration_seconds,created_by,sealed_at,created_at,updated_at)
                VALUES (%s,%s,%s,1,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (exam_type, group_id, row["paper_code"], row["paper_name"], row.get("source"), target_status,
                 duration, created_by, sealed_at, row["create_time"], row["update_time"]))
            self.target_papers[source_id] = target_id
            self.save_map("paper", source_id, target_id, row)
            metadata = {"sourcePaperId": source_id, "subject": row["subject"], "totalQuestions": row["total_questions"],
                        "totalScore": row["total_score"], "source": row.get("source"), "sourceStatus": row["status"],
                        "sourceSort": row["sort"], "sourceGroupId": row.get("group_id")}
            # Paper-level settings keep the SAT/PSAT score scale and legacy metadata intact.
            self.update("""INSERT INTO sat_paper_settings (paper_id,scoring_table_code,adaptive_mode,rest_time_seconds,settings_json)
                VALUES (%s,%s,TRUE,600,CAST(%s AS JSON))""",
                (target_id, exam_type, json_text(metadata)))

        for source_paper_id, paper in papers.items():
            module_rows = modules_by_paper.get(source_paper_id, [])
            for row in module_rows:
                module_id = int(row["id"])
                subject = "RW" if row["subject"] == "RW" else "Math"
                seconds = duration_seconds(row["time_limit"])
                module_number = int(row["module_type"])
                code = f"{subject.upper()}_{module_number}"
                settings = {"subject": subject, "moduleNumber": module_number,
                            "moduleDifficulty": str(row.get("module_difficulty") or "Mid"),
                            "timeLimitSeconds": seconds, "sourceModule": row}
                sort_order = max(0, int(row["sort_order"]) - 1)
                section_id = self.insert("""INSERT INTO paper_sections
                    (paper_id,section_code,section_kind,title,sort_order,instructions,settings_json,created_at,updated_at)
                    VALUES (%s,%s,'MODULE',%s,%s,%s,CAST(%s AS JSON),%s,%s)""",
                    (self.target_papers[source_paper_id], code, row["module_name"], sort_order,
                     row.get("instructions") or row.get("module_description"), json_text(settings),
                     row["create_time"], row["update_time"]))
                self.target_sections[(source_paper_id, module_id)] = section_id
                self.save_map("paper_module", module_id, section_id, row)

        question_rows = {int(row["id"]): row for row in self.source_rows("SELECT id,type_id FROM question")}
        source_items = self.source_rows("SELECT * FROM paper_question ORDER BY paper_id,module_id,sort,id")
        grouped: dict[tuple[int, int | None], list[dict[str, Any]]] = defaultdict(list)
        for row in source_items:
            grouped[(int(row["paper_id"]), int(row["module_id"]) if row.get("module_id") is not None else None)].append(row)
        for (source_paper_id, module_id), items in grouped.items():
            if module_id is None:
                paper = papers[source_paper_id]
                section_code = "LEGACY_UNASSIGNED"
                section_id = self.insert("""INSERT INTO paper_sections
                    (paper_id,section_code,section_kind,title,sort_order,settings_json)
                    VALUES (%s,%s,'MODULE','Imported questions without a source module',99,CAST(%s AS JSON))""",
                    (self.target_papers[source_paper_id], section_code,
                     json_text({"subject": "RW", "moduleNumber": 1, "moduleDifficulty": "Mid", "timeLimitSeconds": 0})))
                self.target_sections[(source_paper_id, -1)] = section_id
            else:
                section_id = self.target_sections[(source_paper_id, module_id)]
            for display_index, row in enumerate(items):
                question_id = int(row["question_id"])
                source_question = question_rows[question_id]
                exam_type = self.paper_types[source_paper_id]
                category_id = self.maps.get(("category", f"{exam_type}:{int(source_question['type_id'])}"))
                target_id = self.insert("""INSERT INTO paper_items
                    (section_id,question_id,category_id,sort_order,display_number,max_points,scoring_section_code,created_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                (section_id, self.target_questions[question_id], category_id, display_index,
                     int(row["sort"]), self.question_scores[question_id], f"{section_code_for(row, module_id)}", datetime.now()))
                self.target_paper_items[int(row["id"])] = target_id
                self.paper_items[source_paper_id].append((int(row["id"]), target_id))
                self.save_map("paper_question", int(row["id"]), target_id, row)
            self.paper_items[source_paper_id].sort(key=lambda pair: (self._source_item_order(pair[0]), pair[0]))

    def _source_item_order(self, source_item_id: int) -> int:
        row = self.source_one("""SELECT pm.sort_order AS module_order,p.sort FROM paper_question p
            LEFT JOIN paper_module pm ON pm.id=p.module_id WHERE p.id=%s""", (source_item_id,))
        return (int(row["module_order"] or 0) * 10000) + int(row["sort"] or 0) if row else 0

    def map_exams(self) -> None:
        admin_source = self.source_one("SELECT id FROM `user` WHERE role='admin' ORDER BY id LIMIT 1")
        created_by = self.target_users[int(admin_source["id"])]
        for row in self.source_rows("SELECT * FROM exam ORDER BY id"):
            source_id = int(row["id"])
            source_status = str(row["status"]).lower()
            status = "DRAFT" if source_status == "draft" else "CLOSED" if source_status == "finished" else "PUBLISHED"
            opens = row["start_time"]
            closes = row["end_time"]
            if closes <= opens:
                raise ValueError(f"Source exam {source_id} has an invalid time window.")
            target_id = self.insert("""INSERT INTO exams
                (paper_id,title,description,status,target_scope,opens_at,closes_at,duration_seconds,attempt_limit,
                 answer_visibility,score_visibility,auto_submit,allow_review,created_by,published_at,created_at,updated_at)
                VALUES (%s,%s,NULL,%s,'SELECTED',%s,%s,%s,1,'AFTER_CLOSE','AFTER_CLOSE',TRUE,TRUE,%s,%s,%s,%s)""",
                (self.target_papers[int(row["paper_id"])], row["exam_name"], status, opens, closes,
                 sum(duration_seconds(row[name]) for name in ("rw_module1_time", "rw_module2_time", "math_module1_time", "math_module2_time"))
                 + duration_seconds(row["rest_time"]), created_by,
                 row["create_time"] if status != "DRAFT" else None, row["create_time"], row["update_time"]))
            self.target_exams[source_id] = target_id
            self.save_map("exam", source_id, target_id, row)
            self.add_exam_settings(target_id, row, False)

    def add_exam_settings(self, target_exam_id: int, row: dict[str, Any], practice: bool) -> None:
        settings = {"sourceExamId": row.get("id"), "sourceExamName": row.get("exam_name"),
                    "sourcePaperId": row.get("paper_id"), "sourceExamType": row.get("exam_type"),
                    "sourceWindow": [row.get("start_time"), row.get("end_time")], "practiceArchive": practice}
        self.update("""INSERT INTO sat_exam_settings
            (exam_id,source_exam_type,rw_module1_seconds,rw_module2_seconds,math_module1_seconds,math_module2_seconds,
             rest_time_seconds,max_students,source_student_count,source_status,is_practice_archive,source_metadata_json)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,CAST(%s AS JSON))""",
            (target_exam_id, str(row.get("exam_type") or "adaptive"),
             duration_seconds(row.get("rw_module1_time")), duration_seconds(row.get("rw_module2_time")),
             duration_seconds(row.get("math_module1_time")), duration_seconds(row.get("math_module2_time")),
             duration_seconds(row.get("rest_time")), row.get("max_student"), row.get("student_count"),
             str(row.get("status") or "practice"), practice, json_text(settings)))

    def map_enrollments(self) -> None:
        for row in self.source_rows("SELECT * FROM user_exam ORDER BY id"):
            source_id = int(row["id"])
            exam_id = self.target_exams[int(row["exam_id"])]
            user_id = self.target_users[int(row["user_id"])]
            absent = str(row["status"]).lower() == "absent"
            self.update("""INSERT INTO exam_target_students (exam_id,student_user_id) VALUES (%s,%s)""", (exam_id, user_id))
            self.update("""INSERT INTO exam_participants
                (exam_id,student_user_id,assigned_at,signed_in_at,absent_marked_at,seat_no)
                VALUES (%s,%s,%s,%s,%s,%s)""",
                (exam_id, user_id, row["create_time"], row.get("signin_time"), row["update_time"] if absent else None, row.get("seat_no")))
            self.save_map("user_exam", source_id, None, row)

    def prepare_practice_archives(self, records: list[dict[str, Any]]) -> dict[int, int]:
        papers = sorted({int(row["paper_id"]) for row in records if row.get("paper_id") is not None})
        practice_exams: dict[int, int] = {}
        source_status = "practice"
        for source_paper_id in papers:
            history = [row for row in records if str(row["mode"]).lower() == "practice" and int(row.get("paper_id") or 0) == source_paper_id]
            if not history:
                continue
            existing = self.one("SELECT target_id FROM sat_import_id_map WHERE source_system=%s AND entity_type='practice_archive' AND source_id=%s",
                                (SOURCE_SYSTEM, str(source_paper_id)))
            if existing:
                archive_id = int(existing["target_id"])
            else:
                starts = [r["start_time"] for r in history if r.get("start_time")]
                ends = [r.get("end_time") or (r["start_time"] + timedelta(hours=4)) for r in history if r.get("start_time")]
                opens = min(starts) - timedelta(seconds=1)
                closes = max(ends) + timedelta(seconds=1)
                paper = self.source_one("SELECT paper_name FROM paper WHERE id=%s", (source_paper_id,))
                exam_type = self.paper_types[source_paper_id]
                admin_source = self.source_one("SELECT id FROM `user` WHERE role='admin' ORDER BY id LIMIT 1")
                archive_id = self.insert("""INSERT INTO exams
                    (paper_id,title,description,status,target_scope,opens_at,closes_at,duration_seconds,attempt_limit,
                     answer_visibility,score_visibility,auto_submit,allow_review,created_by,published_at,created_at,updated_at)
                    VALUES (%s,%s,%s,'CLOSED','SELECTED',%s,%s,NULL,%s,'AFTER_CLOSE','AFTER_CLOSE',TRUE,TRUE,%s,%s,%s,%s)""",
                    (self.target_papers[source_paper_id], f"Imported practice history · {paper['paper_name']}",
                     "Archived practice attempts imported from the independent SAT system.", opens, closes,
                     max(1, len(history)), self.target_users[int(admin_source["id"])], closes, opens, closes))
                source_record = {"id": source_paper_id, "exam_name": f"Imported practice history · {paper['paper_name']}",
                                 "paper_id": source_paper_id, "exam_type": "practice", "status": "finished",
                                 "start_time": opens, "end_time": closes, "rw_module1_time": 0, "rw_module2_time": 0,
                                 "math_module1_time": 0, "math_module2_time": 0, "rest_time": 0,
                                 "max_student": None, "student_count": len({r.get("student_id") for r in history})}
                self.save_map("practice_archive", source_paper_id, archive_id, source_record)
                self.add_exam_settings(archive_id, source_record, True)
            self.update("INSERT IGNORE INTO sat_practice_papers (paper_id,practice_exam_id) VALUES (%s,%s)",
                        (self.target_papers[source_paper_id], archive_id))
            practice_exams[source_paper_id] = archive_id
        return practice_exams

    def map_attempts(self) -> None:
        records = self.source_rows("SELECT * FROM exam_record ORDER BY start_time,id")
        source_classes = {int(row["id"]): row["class_id"] for row in self.source_rows(
            "SELECT id,class_id FROM `user` WHERE role='student' AND class_id IS NOT NULL")}
        practice_exam_by_paper = self.prepare_practice_archives(records)
        enrollments = {int(row["id"]): row for row in self.source_rows("SELECT * FROM user_exam")}
        formal_exams = {int(row["id"]): row for row in self.source_rows("SELECT * FROM exam")}
        answers_by_record: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for answer in self.source_rows("SELECT * FROM user_answer ORDER BY record_id,id"):
            answers_by_record[int(answer["record_id"])].append(answer)
        score_by_record = {int(row["record_id"]): row for row in self.source_rows("SELECT * FROM score_record")}
        skills_by_score: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for row in self.source_rows("SELECT * FROM score_skill_analysis ORDER BY id"):
            skills_by_score[int(row["score_id"])].append(row)
        reports_by_score: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for row in self.source_rows("SELECT * FROM exam_report ORDER BY id"):
            reports_by_score[int(row["score_id"])].append(row)
        presence_by_record = {int(row["record_id"]): row for row in self.source_rows("SELECT * FROM exam_live_presence")}
        attempt_numbers: dict[tuple[int, int], int] = defaultdict(int)

        source_question_by_item: dict[tuple[int, int], int] = {}
        for row in self.source_rows("SELECT id,paper_id,question_id FROM paper_question"):
            source_question_by_item[(int(row["paper_id"]), int(row["question_id"]))] = int(row["id"])

        for row in records:
            source_record_id = int(row["id"])
            enrollment = enrollments.get(int(row["user_exam_id"])) if row.get("user_exam_id") is not None else None
            direct_user_exists = row.get("student_id") is not None and int(row["student_id"]) in self.target_users
            enrollment_user_exists = enrollment is not None and int(enrollment["user_id"]) in self.target_users
            if not direct_user_exists and not enrollment_user_exists:
                orphan_answers = answers_by_record.get(source_record_id, [])
                orphan_score = score_by_record.get(source_record_id)
                reason = "Source student account and enrollment no longer exist."
                self.update("""INSERT INTO sat_import_orphan_attempts
                    (source_record_id,import_run_id,archive_reason,source_record_json,source_score_json,source_answers_json)
                    VALUES (%s,%s,%s,CAST(%s AS JSON),CAST(%s AS JSON),CAST(%s AS JSON))""",
                    (source_record_id, self.run_id, reason, json_text(row), json_text(orphan_score), json_text(orphan_answers)))
                self.save_map("exam_record", source_record_id, None, row)
                for answer in orphan_answers:
                    self.save_map("user_answer", answer["id"], None, answer)
                if orphan_score:
                    self.save_map("score_record", orphan_score["id"], None, orphan_score)
                    for skill in skills_by_score.get(int(orphan_score["id"]), []):
                        self.save_map("score_skill_analysis", skill["id"], None, skill)
                    for report in reports_by_score.get(int(orphan_score["id"]), []):
                        self.save_map("exam_report", report["id"], None, report)
                continue
            source_user_id = int(row["student_id"]) if direct_user_exists else int(enrollment["user_id"])
            user_id = self.target_users[source_user_id]
            source_paper_id = int(row["paper_id"]) if row.get("paper_id") is not None else int(formal_exams[int(enrollment["exam_id"])]["paper_id"])
            if str(row["mode"]).lower() == "practice":
                exam_id = practice_exam_by_paper[source_paper_id]
                is_practice = True
            else:
                source_exam_id = int(enrollment["exam_id"])
                exam_id = self.target_exams[source_exam_id]
                is_practice = False
            participant = self.one("SELECT 1 AS present FROM exam_participants WHERE exam_id=%s AND student_user_id=%s", (exam_id, user_id))
            if not participant:
                self.update("""INSERT INTO exam_target_students (exam_id,student_user_id) VALUES (%s,%s)""", (exam_id, user_id))
                self.update("""INSERT INTO exam_participants (exam_id,student_user_id,assigned_at)
                    VALUES (%s,%s,%s)""", (exam_id, user_id, row["create_time"]))
            attempt_numbers[(exam_id, user_id)] += 1
            attempt_no = attempt_numbers[(exam_id, user_id)]
            submitted = str(row["status"]).lower() != "ongoing"
            status = "SUBMITTED" if submitted else "IN_PROGRESS"
            submitted_at = row.get("end_time") or (row["update_time"] if submitted else None)
            attempt_id = self.insert("""INSERT INTO attempts
                (exam_id,student_user_id,attempt_no,is_practice,status,started_at,expires_at,submitted_at)
                VALUES (%s,%s,%s,%s,%s,%s,NULL,%s)""",
                (exam_id, user_id, attempt_no, is_practice, status, row["start_time"], submitted_at))
            self.target_attempts[source_record_id] = attempt_id
            self.save_map("exam_record", source_record_id, attempt_id, row)
            # 旧系统仅保存当前班级；只有明确批准时才推断正式考试的班级归属。
            source_class_id = source_classes.get(source_user_id)
            if self.args.infer_class_attribution and not is_practice and source_class_id is not None:
                class_id = self.maps.get(("class_workspace", f"{source_class_id}:{self.paper_types[source_paper_id]}"))
                if class_id is not None:
                    self.update("INSERT INTO attempt_classes (attempt_id,class_id) VALUES (%s,%s)", (attempt_id, class_id))
                    self.save_map("inferred_attempt_class", f"{source_record_id}:{class_id}", attempt_id, row)

            item_order: dict[int, int] = {}
            for served_order, (source_link_id, target_item_id) in enumerate(self.paper_items[source_paper_id]):
                item_order[source_link_id] = served_order
                self.update("INSERT INTO attempt_items (attempt_id,paper_item_id,served_order) VALUES (%s,%s,%s)",
                            (attempt_id, target_item_id, served_order))
            for answer in answers_by_record.get(source_record_id, []):
                qid = int(answer["question_id"])
                source_link_id = source_question_by_item.get((source_paper_id, qid))
                if source_link_id is None:
                    raise ValueError(f"Answer {answer['id']} references question {qid} outside source paper {source_paper_id}.")
                target_item_id = self.target_paper_items[source_link_id]
                response = answer.get("user_answer")
                self.update("""INSERT INTO attempt_answers
                    (attempt_id,paper_item_id,answer_json,is_correct,awarded_points,time_spent_seconds,answered_at,is_marked_for_review)
                    VALUES (%s,%s,CAST(%s AS JSON),%s,%s,%s,%s,%s)""",
                    (attempt_id, target_item_id, json_text({"value": response}), answer.get("is_correct"),
                     self.question_scores.get(qid, Decimal("0")) if answer.get("is_correct") == 1 else Decimal("0"),
                     int(answer.get("spend_seconds") or 0), answer.get("answer_time") or row["start_time"], bool(answer.get("is_marked"))))
                self.update("""INSERT INTO sat_answer_details
                    (attempt_id,paper_item_id,source_answer_id,source_question_id,source_is_marked,source_answer_time)
                    VALUES (%s,%s,%s,%s,%s,%s)""",
                    (attempt_id, target_item_id, int(answer["id"]), qid, bool(answer.get("is_marked")), answer.get("answer_time")))
                self.save_map("user_answer", answer["id"], target_item_id, answer)

            score = score_by_record.get(source_record_id)
            score_json = None
            report_json = None
            if score:
                score_json = {key: value for key, value in score.items() if key not in {"id", "record_id"}}
                skill_rows = skills_by_score.get(int(score["id"]), [])
                report_rows = reports_by_score.get(int(score["id"]), [])
                report_json = {"skillAnalysis": skill_rows, "reports": report_rows}
                target_paper = self.source_one("SELECT total_score FROM paper WHERE id=%s", (source_paper_id,))
                answer_count = len(answers_by_record.get(source_record_id, []))
                ungraded = sum(1 for answer in answers_by_record.get(source_record_id, []) if answer.get("is_correct") is None)
                breakdown = {"schema": "SAT_LEGACY", "sourceScore": score_json,
                             "sourceAttemptMetrics": self.attempt_metrics(row),
                             "skillAnalysis": skill_rows, "reports": report_rows}
                self.update("""INSERT INTO attempt_results
                    (attempt_id,algorithm_version,total_points,max_points,ungraded_count,is_estimated,breakdown_json,graded_at)
                    VALUES (%s,'SAT_LEGACY',%s,%s,%s,FALSE,CAST(%s AS JSON),%s)""",
                    (attempt_id, score.get("total_score") or 0, target_paper["total_score"] if target_paper else 1600,
                     ungraded, json_text(breakdown), score["update_time"]))
                self.save_map("score_record", score["id"], attempt_id, score)
                for skill in skill_rows:
                    self.save_map("score_skill_analysis", skill["id"], attempt_id, skill)
                for report in report_rows:
                    self.save_map("exam_report", report["id"], attempt_id, report)

            live = presence_by_record.get(source_record_id)
            details = {key: row.get(key) for key in row.keys() if key not in {"id"}}
            self.update("""INSERT INTO sat_attempt_details
                (attempt_id,source_record_id,source_mode,source_status,source_current_module_id,source_current_module_started_at,
                 rw_module2_difficulty,math_module2_difficulty,rw_module1_seconds,rw_module2_seconds,math_module1_seconds,math_module2_seconds,
                 rw_module1_raw,rw_module2_raw,math_module1_raw,math_module2_raw,abnormal_count,source_score_json,source_report_json,
                 source_live_presence_json,source_metadata_json)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,CAST(%s AS JSON),CAST(%s AS JSON),CAST(%s AS JSON),CAST(%s AS JSON))""",
                (attempt_id, source_record_id, row["mode"], row["status"], row.get("current_module_id"),
                 row.get("current_module_start"), row.get("rw_module2_diff"), row.get("math_module2_diff"),
                 row.get("rw_module1_spend"), row.get("rw_module2_spend"), row.get("math_module1_spend"), row.get("math_module2_spend"),
                 row.get("rw_module1_raw"), row.get("rw_module2_raw"), row.get("math_module1_raw"), row.get("math_module2_raw"),
                 int(row.get("abnormal_count") or 0), json_text(score_json), json_text(report_json), json_text(live), json_text(details)))
        for row in self.source_rows("SELECT * FROM exam_live_presence"):
            self.save_map("exam_live_presence", row["record_id"],
                          self.target_attempts.get(int(row["record_id"])), row)

    @staticmethod
    def attempt_metrics(row: dict[str, Any]) -> dict[str, Any]:
        fields = ("rw_module1_spend", "rw_module2_spend", "math_module1_spend", "math_module2_spend",
                  "rw_module1_raw", "rw_module2_raw", "math_module1_raw", "math_module2_raw",
                  "rw_module2_diff", "math_module2_diff", "abnormal_count")
        return {field: row.get(field) for field in fields}

    def run_import(self, report: dict[str, Any]) -> dict[str, Any]:
        previous = int(report["previously_imported_rows"])
        if previous:
            complete = self.one("SELECT id,status,summary_json FROM sat_import_runs WHERE status='COMPLETED' ORDER BY id DESC LIMIT 1")
            if not complete:
                raise ValueError("SAT import mappings exist without a completed run; manual reconciliation is required.")
            report["already_imported"] = True
            report["previous_run_id"] = int(complete["id"])
            return report

        self.target.begin()
        try:
            self.run_id = self.insert("INSERT INTO sat_import_runs (source_database,status) VALUES (%s,'RUNNING')",
                                      (self.args.source_database,))
            self.map_users()
            self.map_classes()
            for user_id in self.target_users.values():
                for workspace in ("SAT", "PSAT", "SHSAT"):
                    self.update("INSERT IGNORE INTO user_workspace_access (user_id,workspace_code) VALUES (%s,%s)", (user_id, workspace))
            self.derive_paper_types()
            self.map_groups()
            self.map_materials()
            self.map_categories()
            self.map_questions()
            self.map_papers()
            self.map_exams()
            self.map_enrollments()
            self.map_attempts()
            self.verify(report["source_counts"])
            summary = {"source_counts": report["source_counts"], "mapped_entities": self.map_counts(),
                       "missing_assets": report["missing_assets"], "copied_assets": len(self.created_files)}
            self.update("UPDATE sat_import_runs SET status='COMPLETED',finished_at=CURRENT_TIMESTAMP(6),summary_json=CAST(%s AS JSON) WHERE id=%s",
                        (json_text(summary), self.run_id))
            if self.args.execute:
                self.target.commit()
            else:
                self.target.rollback()
                self.remove_created_files()
            report["mapped_entities"] = summary["mapped_entities"]
            report["copied_assets"] = summary["copied_assets"]
            report["run_id"] = self.run_id
            return report
        except Exception:
            self.target.rollback()
            self.remove_created_files()
            raise

    def map_counts(self) -> dict[str, int]:
        rows = self.target_rows("""SELECT entity_type,COUNT(*) AS n FROM sat_import_id_map
            WHERE source_system=%s AND import_run_id=%s GROUP BY entity_type ORDER BY entity_type""",
            (SOURCE_SYSTEM, self.run_id))
        return {row["entity_type"]: int(row["n"]) for row in rows}

    def verify(self, source_counts: dict[str, int]) -> None:
        expected = {
            "user": source_counts["user"], "class": source_counts["class"], "paper": source_counts["paper"],
            "paper_module": source_counts["paper_module"], "paper_question": source_counts["paper_question"],
            "question": source_counts["question"], "material": source_counts["material"], "exam": source_counts["exam"],
            "user_exam": source_counts["user_exam"], "exam_record": source_counts["exam_record"],
            "user_answer": source_counts["user_answer"],
        }
        actual = self.map_counts()
        expected["class_workspace"] = sum(len(types) for types in self.class_type_map.values())
        missing = {entity: (actual.get(entity, 0), count) for entity, count in expected.items()
                   if actual.get(entity, 0) != count}
        if missing:
            raise ValueError(f"Imported source row counts do not match: {missing}")
        target_types = self.target_rows("SELECT exam_type_code,COUNT(*) AS n FROM papers WHERE exam_type_code IN ('SAT','PSAT') GROUP BY exam_type_code")
        if sum(int(row["n"]) for row in target_types) < source_counts["paper"]:
            raise ValueError("Target SAT/PSAT paper verification failed.")

    def remove_created_files(self) -> None:
        for path in reversed(self.created_files):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
        self.created_files.clear()


def duration_seconds(value: Any) -> int:
    if value is None:
        return 0
    seconds = int(value)
    return seconds * 60 if 0 < seconds <= 180 else seconds


def section_code_for(item: dict[str, Any], module_id: int | None) -> str:
    return f"LEGACY_MODULE_{module_id}" if module_id is not None else "LEGACY_UNASSIGNED"


def env_required(name: str, default: str | None = None) -> str:
    value = os.getenv(name, default)
    if value is None:
        raise ValueError(f"Set required environment variable {name}.")
    return value


def connect(prefix: str, database: str):
    return pymysql.connect(host=os.getenv(f"{prefix}_DB_HOST", "127.0.0.1"),
                           port=int(os.getenv(f"{prefix}_DB_PORT", "3306")),
                           user=env_required(f"{prefix}_DB_USER", "root"),
                           password=env_required(f"{prefix}_DB_PASSWORD", ""), database=database,
                           charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor, autocommit=False)


def backup_target(args: argparse.Namespace) -> None:
    backup = Path(args.backup_file).expanduser().resolve()
    if backup.exists():
        raise ValueError(f"Backup path already exists; choose a new file: {backup}")
    backup.parent.mkdir(parents=True, exist_ok=True)
    config = "[client]\n" + "host=" + os.getenv("TARGET_DB_HOST", "127.0.0.1") + "\n"
    config += "port=" + os.getenv("TARGET_DB_PORT", "3306") + "\n"
    config += "user=" + env_required("TARGET_DB_USER", "root") + "\n"
    config += "password=" + env_required("TARGET_DB_PASSWORD", "") + "\n"
    fd, config_path = tempfile.mkstemp(prefix="sat-import-mysqldump-", suffix=".cnf")
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(config)
    try:
        result = subprocess.run(["mysqldump", f"--defaults-extra-file={config_path}", "--single-transaction",
                                 "--routines", "--triggers", args.target_database],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        if result.returncode:
            backup.unlink(missing_ok=True)
            raise ValueError("Target database backup failed: " + result.stderr.decode("utf-8", "replace")[-1200:])
        backup.write_bytes(result.stdout)
        if not backup.stat().st_size:
            backup.unlink(missing_ok=True)
            raise ValueError("Target database backup is empty; SAT import was not started.")
    finally:
        Path(config_path).unlink(missing_ok=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="Commit the import after a verified backup.")
    parser.add_argument("--allow-missing-assets", action="store_true", help="Keep the original URL for missing SAT uploads.")
    parser.add_argument("--account-map", help="CSV with source_user_id,target_user_id after manual identity review.")
    parser.add_argument("--paper-type-map", required=True, help="CSV with source_paper_id,exam_type for every source paper.")
    parser.add_argument("--class-type-map", required=True, help="CSV with source_class_id,exam_type for every source class; repeat an ID to split its class.")
    parser.add_argument("--infer-class-attribution", action="store_true", help="Explicitly attribute formal attempts to the source student's current class, recording the inference.")
    parser.add_argument("--source-database", default=os.getenv("SOURCE_DB_NAME", "sat_exam"))
    parser.add_argument("--target-database", default=os.getenv("TARGET_DB_NAME", "unified_exam_platform"))
    parser.add_argument("--source-asset-root", default=os.getenv("SOURCE_ASSET_ROOT"), help="SAT_BACK root containing uploads/.")
    parser.add_argument("--target-asset-root", default=os.getenv("TARGET_ASSET_ROOT", "backend/uploads"))
    parser.add_argument("--backup-file", help="Required for --execute; must not already exist.")
    parser.add_argument("--report-json", help="Write the preflight/import report to this path.")
    args = parser.parse_args()
    if args.execute and not args.backup_file:
        parser.error("--execute requires --backup-file")
    return args


def main() -> int:
    args = parse_args()
    source = target = None
    migration: SatMigration | None = None
    try:
        source = connect("SOURCE", args.source_database)
        target = connect("TARGET", args.target_database)
        migration = SatMigration(source, target, args)
        report = migration.preflight()
        if args.execute and not report["previously_imported_rows"]:
            backup_target(args)
        report = migration.run_import(report)
        if args.report_json:
            path = Path(args.report_json).expanduser()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
        return 0
    except Exception as error:
        if migration:
            migration.remove_created_files()
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=__import__("sys").stderr)
        return 1
    finally:
        if source:
            source.close()
        if target:
            target.close()


if __name__ == "__main__":
    raise SystemExit(main())
