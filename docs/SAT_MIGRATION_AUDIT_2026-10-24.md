# SAT/PSAT Migration Audit — 2026-10-24 (updated 2026-10-25)

## Scope

This read-only audit rechecked the imported SAT data against the local `sat_exam` source database. It did not modify either database. The preflight JSON generated during the audit is at `/tmp/sat-parity-audit-latest.json`.

## Import run

- Source: `sat_exam`
- Target: `unified_exam_platform`
- Source system: `SAT_V1`
- Completed import run: `3` (`COMPLETED`, finished 2026-10-15 12:30:58)
- Current preflight: no username, class-name, or paper-code conflicts; all expected ID mappings from the completed run match the current source row counts.
- Migration script: `scripts/migrate_sat_to_unified.py`, SHA-256 `90252da1a92469f1d74d4f226d1573096c0aea4ca23c41644f138282d4a8ecbf`.
- Completed run 3 in `sat_import_runs`: started `2026-10-15 12:30:55.031372`, completed `2026-10-15 12:30:58.420383`.

## Source rows and completed-run mappings

| Source data | Source rows | Target mappings | Result |
| --- | ---: | ---: | --- |
| Accounts | 19 | 19 users | Match |
| Classes | 3 | 3 | Match |
| Paper groups | 3 | 3 | Match |
| Question types | 159 | 318 category mappings | Derived mapping; count is not one-to-one |
| Materials | 1,141 | 1,141 | Match |
| Questions | 1,389 | 1,389 questions | Match |
| Paper-question links | 1,389 | 1,389 | Match |
| Papers | 14 | 14 | Match |
| Paper modules | 56 | 56 | Match |
| Exams | 30 | 30 | Match |
| Exam targets | 126 | 126 | Match |
| Exam records | 174 | 174 | Match |
| Answers | 7,745 | 7,745 | Match |
| Historical score records | 63 | 63 | Match |
| Exam live-presence records | 2 | 2 | Match |
| Practice archives | — | 12 | Imported archive mappings |

The remaining source tables reported zero rows: scoring versions, module scoring, score-skill analysis, exam reports, operation logs, and system config. The migration preflight reported no orphan paper-question links, question types, enrollments, answers, or material links, and no mismatched formal attempts.

## Current target field checks

Read-only comparisons against the current target data found:

- All 14 papers and 56 modules match source titles, types, statuses, module order, difficulty, time limits, and question counts (1,389 questions).
- The source's denormalized question-count fields are not reliable: 52 of 56 module rows across 13 papers disagree with their actual `paper_question` relations, and paper 11 declares 98 total questions while its relation contains 115 distinct questions. The unified target retains the actual linked structure; the migration preflight now reports both paper- and module-level count discrepancies instead of treating stale summary values as item authority. This source-data inconsistency remains for review.
- All 1,389 question records match source stems, options, answers, explanations, scores, and SAT question-type metadata. All 1,114 question-to-material links that have a target material match their source material and reference.
- All 1,141 materials match source title, type, text content, source, and file URL after normalizing empty file URLs to `NULL`.
- The 170 still-present imported attempts match their source attempt metrics. Their 62 score records and 7,620 answers match source score fields, responses, correctness, time spent, and review marks.
- A browser report check of source attempt `243` / target attempt `493` found and fixed two report-layer issues: imported summaries now use the source system's saved raw/scaled values and module times, and the report query explicitly uses `ResultSetExtractor` so its first answer row is not skipped. The source/target/history/report now agree on 98 answers, 90 correct, raw `90/98`, and scaled `1530/1600` for this sample. Broader SAT/PSAT report samples remain to be checked.
- All 19 accounts match imported identity fields. All 113 source exam targets under still-present exams match target assignment, sign-in, absence, and seat data. The remaining 13 source targets belong to the two missing exams. The three source classes' original settings snapshots match the source; their current names/order have later target-side edits and are not migration mismatches.

Three mapped source attempts (records `246`, `247`, and `250`) no longer exist in the current target; they contain 125 source answers and one source score. Their two parent exams (source IDs `29` and `32`, target IDs `96` and `99`) are also absent. The migration preflight initially missed this drift because it checked mapping counts but not whether mapped target rows still existed. It now reports a `missing_target_mappings` field, which found both missing exams, all three missing attempts, one associated live-presence record, and the score for source record 246. No corresponding `audit_events` rows exist, so the audit cannot establish whether these were intentionally deleted after import. The source records remain intact. Do not automatically re-import them: exam deletion is a supported operation that is supposed to cascade through attempts and answers, but the historical deletion reason is not recorded.

## Exceptions and remaining checks

- Old exam-record ID `63` has no student association. It is retained in `sat_import_orphan_attempts`; no student identity was fabricated.
- At the time of the 2026-10-24 audit, the source contained 350 distinct referenced material-image URLs and the files had not yet been recovered. On 2026-10-25, all 350 files were recovered from the standalone SAT upload host into the ignored local directory `backend/uploads/sat-import/materials/`. Every distinct database reference matched exactly one file by basename (350 found, 0 missing, 0 extra); HTTP checks through both the backend and Vite proxy returned valid image content, and checksums matched the recovered files. `scripts/recover_sat_material_assets.py` now provides a repeatable recovery process for a target environment. The imported database URLs remain unchanged. The local upload directory is intentionally excluded from Git, so each deployment must run the recovery script before cutover. English missing-image placeholders remain as a fallback.
- This audit verifies row counts, mapping counts, relationship integrity, and the fields listed above. It does not yet compare every migrated field or inspect a broader set of representative paper content and scoring values.
- Follow-up on 2026-10-25 found source database snapshots in `../.local-db-backups/20260921-before-jin-sync/`. `sat_exam.sql` is 471,059 bytes (SHA-256 `4df7ba55aa883bccd805cc861afd1091b5b25e86c3e4753337933d0b13d38514`); `jin-sat_exam.sql` is 1,613,665 bytes (SHA-256 `f371f07f7093102da649ddbd56a051d42a27a6ddbe6160100822af40965fb1d4`). Restored `sat_exam.sql` into an isolated temporary schema and verified 21 tables / 3,915 rows, then removed the schema. These files predate the 2026-10-15 import by several weeks and are not confirmed as the exact source snapshot or target rollback point used for that import. The raw preflight report is `/tmp/sat-parity-audit-latest.json`; it is intentionally not committed because it may contain account-level details. A sanitized audit summary is maintained here and in the parity checklist.
- On 2026-10-25, streamed a fresh local target database dump into an isolated temporary schema, restored all 54 base tables, and compared each table's row count; table sets and counts matched exactly. The temporary schema and dump were removed after verification. This confirms a current local backup/restore path, not a timestamped pre-import or production-cutover recovery point. The migration audit summary is preserved in this document and the parity checklist; the raw preflight JSON remains temporary and may contain account-level details, so it is not committed.
- Historical note: the 2026-10-24 media search extended across project workspaces and reachable objects in the standalone SAT Git repository, but found no matches. The 2026-10-25 recovery from the source upload host supersedes that search result; the old statement is retained only to explain the original audit gap.

## Result

The completed import's original row and mapping counts match. Field comparisons pass for the current target data, and all 350 referenced material images have since been recovered and verified locally. Two source exams and their dependent records are absent from the target following recorded deletion transactions; their business reason is not recorded, so they were not restored. Remaining orphan-content review, representative paper inspection, and backup/restore verification remain open; this audit does not qualify the migration for cutover.
