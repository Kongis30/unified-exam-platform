import unittest

from migrate_shsat_v2_to_unified import source_answer_metadata


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


if __name__ == "__main__":
    unittest.main()
