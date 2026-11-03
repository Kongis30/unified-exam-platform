import unittest
from datetime import datetime

from migrate_shsat_v2_to_unified import (
    attempt_section_breakdown,
    imported_shsat_ungraded_count,
    practice_question_numbers,
    source_answer_metadata,
    source_question_metadata,
    source_shsat_datetime,
)


class SourceShsatDatetimeTest(unittest.TestCase):
    def test_restores_source_service_local_time_from_utc_database_value(self):
        self.assertEqual(
            source_shsat_datetime(datetime(2026, 9, 30, 8, 11)),
            datetime(2026, 9, 30, 16, 11),
        )

    def test_preserves_null_timestamps(self):
        self.assertIsNone(source_shsat_datetime(None))


class SourceAnswerMetadataTest(unittest.TestCase):
    def test_keeps_legacy_text_answers_as_strings(self):
        answer = {
            "selected_answer": "42.0",
            "correct_answer": "1",
            "answer_data": '{"value":42}',
            "correct_answer_data": "true",
            "scoring_details": '{"points":1}',
        }

        metadata = source_answer_metadata(answer)

        self.assertEqual(metadata["selected_answer"], "42.0")
        self.assertEqual(metadata["correct_answer"], "1")
        self.assertEqual(metadata["answer_data"], {"value": 42})
        self.assertIs(metadata["correct_answer_data"], True)
        self.assertEqual(metadata["scoring_details"], {"points": 1})


class SourceQuestionMetadataTest(unittest.TestCase):
    def test_preserves_legacy_id_and_structured_source_config(self):
        metadata = source_question_metadata({
            "question_id": 2230,
            "legacy_question_id": 817,
            "question_config": '{"inlineText":"Choose","blanks":[]}',
        })

        self.assertEqual(metadata["sourceQuestionId"], 2230)
        self.assertEqual(metadata["legacyQuestionId"], 817)
        self.assertEqual(metadata["sourceQuestionConfig"], {"inlineText": "Choose", "blanks": []})


class PracticeQuestionNumbersTest(unittest.TestCase):
    def test_keeps_the_source_practice_order_and_subset(self):
        attempt = {
            "attempt_id": 254,
            "is_practice": 1,
            "practice_task_assignment_id": 3,
            "practice_question_numbers": "[1,2,4]",
        }

        self.assertEqual(practice_question_numbers(attempt), [1, 2, 4])

    def test_does_not_filter_regular_attempts(self):
        self.assertIsNone(practice_question_numbers({"is_practice": 0, "practice_question_numbers": "[1]"}))

    def test_rejects_duplicate_question_numbers(self):
        with self.assertRaisesRegex(ValueError, "repeats a question number"):
            practice_question_numbers({
                "attempt_id": 1,
                "is_practice": 1,
                "practice_task_assignment_id": 2,
                "practice_question_numbers": [1, 1],
            })

    def test_allows_questions_without_a_legacy_id_or_config(self):
        metadata = source_question_metadata({"question_id": 42, "legacy_question_id": None, "question_config": None})

        self.assertEqual(metadata, {
            "sourceQuestionId": 42,
            "legacyQuestionId": None,
            "sourceQuestionConfig": None,
        })


class AttemptSectionBreakdownTest(unittest.TestCase):
    def test_preserves_raw_and_scaled_section_denominators(self):
        attempt = {
            "section1_score": 29,
            "section1_scaled_score": 234,
            "score_details": '{"sections":{"ELA":{"maxRaw":50,"scaled":234,"maxScaled":360}}}',
        }

        result = attempt_section_breakdown(attempt, "ELA")

        self.assertEqual(result, {
            "rawScore": 29,
            "rawMaxScore": 50,
            "scaledScore": 234,
            "scaledMaxScore": 360,
        })

    def test_unanswered_questions_are_not_pending_grading(self):
        self.assertEqual(imported_shsat_ungraded_count(), 0)

    def test_uses_question_snapshot_total_when_raw_max_is_missing(self):
        attempt = {"section2_score": 14, "section2_scaled_score": 159, "score_details": None}

        result = attempt_section_breakdown(attempt, "MATH", snapshot_raw_max=50)

        self.assertEqual(result, {
            "rawScore": 14,
            "rawMaxScore": 50,
            "scaledScore": 159,
            "scaledMaxScore": None,
        })


if __name__ == "__main__":
    unittest.main()
