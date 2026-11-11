-- 修正 PSAT 试卷的满分与总分：旧系统用 SAT 量表给 PSAT 卷判分，导致
-- attempt_results.max_points 存成 SAT 的 1600，总分也按 SAT 表虚高。
--
-- 各考试类型的 raw -> scaled 换算表是固定的赋分制，满分因此固定：
--   SAT  1600（单科 800）、PSAT 1520（单科 760）、SHSAT 720（ELA/MATH 各 360）。
-- 凡与所属评分表不符的历史记录，按该表重算，使系统内成绩自洽。
--
-- 口径：仅处理已有 attempt_results 且 ungraded_count = 0 的作答。
-- source_score_json 保留旧系统原始封存值作为审计证据，不在此覆盖；
-- 应用层 SatAttemptScoreCalculator 会拒绝越界的旧量表分并回退重算。

UPDATE attempt_results r
JOIN attempts a ON a.id = r.attempt_id
JOIN exams e ON e.id = a.exam_id
JOIN papers p ON p.id = e.paper_id
JOIN sat_paper_settings s ON s.paper_id = p.id
JOIN sat_attempt_details d ON d.attempt_id = a.id
JOIN (
    SELECT
        d2.attempt_id,
        COALESCE(d2.rw_module1_raw, 0) + COALESCE(d2.rw_module2_raw, 0) AS rw_raw,
        COALESCE(d2.math_module1_raw, 0) + COALESCE(d2.math_module2_raw, 0) AS math_raw
    FROM sat_attempt_details d2
) AS module_raw ON module_raw.attempt_id = a.id
JOIN (
        SELECT 'RW' AS subject, 0 AS raw_score, 160 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 1 AS raw_score, 170 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 2 AS raw_score, 180 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 3 AS raw_score, 190 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 4 AS raw_score, 200 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 5 AS raw_score, 210 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 6 AS raw_score, 220 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 7 AS raw_score, 230 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 8 AS raw_score, 240 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 9 AS raw_score, 250 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 10 AS raw_score, 260 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 11 AS raw_score, 270 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 12 AS raw_score, 290 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 13 AS raw_score, 300 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 14 AS raw_score, 310 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 15 AS raw_score, 320 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 16 AS raw_score, 340 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 17 AS raw_score, 350 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 18 AS raw_score, 360 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 19 AS raw_score, 370 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 20 AS raw_score, 390 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 21 AS raw_score, 400 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 22 AS raw_score, 420 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 23 AS raw_score, 430 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 24 AS raw_score, 450 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 25 AS raw_score, 460 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 26 AS raw_score, 470 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 27 AS raw_score, 480 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 28 AS raw_score, 490 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 29 AS raw_score, 500 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 30 AS raw_score, 510 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 31 AS raw_score, 520 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 32 AS raw_score, 530 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 33 AS raw_score, 540 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 34 AS raw_score, 550 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 35 AS raw_score, 560 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 36 AS raw_score, 570 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 37 AS raw_score, 580 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 38 AS raw_score, 590 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 39 AS raw_score, 600 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 40 AS raw_score, 610 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 41 AS raw_score, 620 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 42 AS raw_score, 630 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 43 AS raw_score, 640 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 44 AS raw_score, 650 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 45 AS raw_score, 660 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 46 AS raw_score, 670 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 47 AS raw_score, 680 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 48 AS raw_score, 690 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 49 AS raw_score, 700 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 50 AS raw_score, 710 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 51 AS raw_score, 720 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 52 AS raw_score, 730 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 53 AS raw_score, 750 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 54 AS raw_score, 760 AS scaled_score
        UNION ALL
        SELECT 'Math', 0, 160
        UNION ALL
        SELECT 'Math', 1, 180
        UNION ALL
        SELECT 'Math', 2, 190
        UNION ALL
        SELECT 'Math', 3, 200
        UNION ALL
        SELECT 'Math', 4, 210
        UNION ALL
        SELECT 'Math', 5, 240
        UNION ALL
        SELECT 'Math', 6, 260
        UNION ALL
        SELECT 'Math', 7, 280
        UNION ALL
        SELECT 'Math', 8, 300
        UNION ALL
        SELECT 'Math', 9, 310
        UNION ALL
        SELECT 'Math', 10, 330
        UNION ALL
        SELECT 'Math', 11, 340
        UNION ALL
        SELECT 'Math', 12, 350
        UNION ALL
        SELECT 'Math', 13, 360
        UNION ALL
        SELECT 'Math', 14, 370
        UNION ALL
        SELECT 'Math', 15, 390
        UNION ALL
        SELECT 'Math', 16, 400
        UNION ALL
        SELECT 'Math', 17, 410
        UNION ALL
        SELECT 'Math', 18, 420
        UNION ALL
        SELECT 'Math', 19, 430
        UNION ALL
        SELECT 'Math', 20, 450
        UNION ALL
        SELECT 'Math', 21, 460
        UNION ALL
        SELECT 'Math', 22, 470
        UNION ALL
        SELECT 'Math', 23, 480
        UNION ALL
        SELECT 'Math', 24, 490
        UNION ALL
        SELECT 'Math', 25, 500
        UNION ALL
        SELECT 'Math', 26, 510
        UNION ALL
        SELECT 'Math', 27, 520
        UNION ALL
        SELECT 'Math', 28, 530
        UNION ALL
        SELECT 'Math', 29, 540
        UNION ALL
        SELECT 'Math', 30, 550
        UNION ALL
        SELECT 'Math', 31, 560
        UNION ALL
        SELECT 'Math', 32, 570
        UNION ALL
        SELECT 'Math', 33, 590
        UNION ALL
        SELECT 'Math', 34, 600
        UNION ALL
        SELECT 'Math', 35, 610
        UNION ALL
        SELECT 'Math', 36, 620
        UNION ALL
        SELECT 'Math', 37, 640
        UNION ALL
        SELECT 'Math', 38, 650
        UNION ALL
        SELECT 'Math', 39, 660
        UNION ALL
        SELECT 'Math', 40, 680
        UNION ALL
        SELECT 'Math', 41, 690
        UNION ALL
        SELECT 'Math', 42, 720
        UNION ALL
        SELECT 'Math', 43, 750
        UNION ALL
        SELECT 'Math', 44, 760
) AS psat_rw ON psat_rw.subject = 'RW' AND psat_rw.raw_score = LEAST(module_raw.rw_raw, 54)
JOIN (
        SELECT 'RW' AS subject, 0 AS raw_score, 160 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 1 AS raw_score, 170 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 2 AS raw_score, 180 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 3 AS raw_score, 190 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 4 AS raw_score, 200 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 5 AS raw_score, 210 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 6 AS raw_score, 220 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 7 AS raw_score, 230 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 8 AS raw_score, 240 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 9 AS raw_score, 250 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 10 AS raw_score, 260 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 11 AS raw_score, 270 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 12 AS raw_score, 290 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 13 AS raw_score, 300 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 14 AS raw_score, 310 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 15 AS raw_score, 320 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 16 AS raw_score, 340 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 17 AS raw_score, 350 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 18 AS raw_score, 360 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 19 AS raw_score, 370 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 20 AS raw_score, 390 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 21 AS raw_score, 400 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 22 AS raw_score, 420 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 23 AS raw_score, 430 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 24 AS raw_score, 450 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 25 AS raw_score, 460 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 26 AS raw_score, 470 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 27 AS raw_score, 480 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 28 AS raw_score, 490 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 29 AS raw_score, 500 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 30 AS raw_score, 510 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 31 AS raw_score, 520 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 32 AS raw_score, 530 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 33 AS raw_score, 540 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 34 AS raw_score, 550 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 35 AS raw_score, 560 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 36 AS raw_score, 570 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 37 AS raw_score, 580 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 38 AS raw_score, 590 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 39 AS raw_score, 600 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 40 AS raw_score, 610 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 41 AS raw_score, 620 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 42 AS raw_score, 630 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 43 AS raw_score, 640 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 44 AS raw_score, 650 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 45 AS raw_score, 660 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 46 AS raw_score, 670 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 47 AS raw_score, 680 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 48 AS raw_score, 690 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 49 AS raw_score, 700 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 50 AS raw_score, 710 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 51 AS raw_score, 720 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 52 AS raw_score, 730 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 53 AS raw_score, 750 AS scaled_score
        UNION ALL
        SELECT 'RW' AS subject, 54 AS raw_score, 760 AS scaled_score
        UNION ALL
        SELECT 'Math', 0, 160
        UNION ALL
        SELECT 'Math', 1, 180
        UNION ALL
        SELECT 'Math', 2, 190
        UNION ALL
        SELECT 'Math', 3, 200
        UNION ALL
        SELECT 'Math', 4, 210
        UNION ALL
        SELECT 'Math', 5, 240
        UNION ALL
        SELECT 'Math', 6, 260
        UNION ALL
        SELECT 'Math', 7, 280
        UNION ALL
        SELECT 'Math', 8, 300
        UNION ALL
        SELECT 'Math', 9, 310
        UNION ALL
        SELECT 'Math', 10, 330
        UNION ALL
        SELECT 'Math', 11, 340
        UNION ALL
        SELECT 'Math', 12, 350
        UNION ALL
        SELECT 'Math', 13, 360
        UNION ALL
        SELECT 'Math', 14, 370
        UNION ALL
        SELECT 'Math', 15, 390
        UNION ALL
        SELECT 'Math', 16, 400
        UNION ALL
        SELECT 'Math', 17, 410
        UNION ALL
        SELECT 'Math', 18, 420
        UNION ALL
        SELECT 'Math', 19, 430
        UNION ALL
        SELECT 'Math', 20, 450
        UNION ALL
        SELECT 'Math', 21, 460
        UNION ALL
        SELECT 'Math', 22, 470
        UNION ALL
        SELECT 'Math', 23, 480
        UNION ALL
        SELECT 'Math', 24, 490
        UNION ALL
        SELECT 'Math', 25, 500
        UNION ALL
        SELECT 'Math', 26, 510
        UNION ALL
        SELECT 'Math', 27, 520
        UNION ALL
        SELECT 'Math', 28, 530
        UNION ALL
        SELECT 'Math', 29, 540
        UNION ALL
        SELECT 'Math', 30, 550
        UNION ALL
        SELECT 'Math', 31, 560
        UNION ALL
        SELECT 'Math', 32, 570
        UNION ALL
        SELECT 'Math', 33, 590
        UNION ALL
        SELECT 'Math', 34, 600
        UNION ALL
        SELECT 'Math', 35, 610
        UNION ALL
        SELECT 'Math', 36, 620
        UNION ALL
        SELECT 'Math', 37, 640
        UNION ALL
        SELECT 'Math', 38, 650
        UNION ALL
        SELECT 'Math', 39, 660
        UNION ALL
        SELECT 'Math', 40, 680
        UNION ALL
        SELECT 'Math', 41, 690
        UNION ALL
        SELECT 'Math', 42, 720
        UNION ALL
        SELECT 'Math', 43, 750
        UNION ALL
        SELECT 'Math', 44, 760
) AS psat_math ON psat_math.subject = 'Math' AND psat_math.raw_score = LEAST(module_raw.math_raw, 44)
SET r.max_points = 1520,
    r.total_points = psat_rw.scaled_score + psat_math.scaled_score
WHERE s.scoring_table_code = 'PSAT'
  AND r.max_points <> 1520
  AND COALESCE(r.ungraded_count, 0) = 0;
