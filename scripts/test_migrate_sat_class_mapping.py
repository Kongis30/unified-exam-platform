import unittest
from unittest.mock import Mock

from migrate_sat_to_unified import SatMigration


class SatClassMappingTest(unittest.TestCase):
    def test_one_source_class_creates_separate_classes_and_copies_members(self):
        migration = SatMigration.__new__(SatMigration)
        migration.class_type_map = {3: {"SAT", "PSAT"}}
        migration.target_classes = {}
        migration.target_users = {7: 70}
        class_row = {"id": 3, "class_name": "Default", "is_active": 1, "sort": 0,
                     "create_time": None, "update_time": None, "teacher_id": None,
                     "start_date": None, "end_date": None, "student_count": 1}
        member_row = {"id": 7, "class_id": 3, "create_time": None, "update_time": None}
        migration.source_rows = Mock(side_effect=[[class_row], [member_row]])
        migration.insert = Mock(side_effect=[101, 102])
        migration.save_map = Mock()
        migration.update = Mock()

        migration.map_classes()

        self.assertEqual([101, 102], migration.target_classes[3])
        memberships = [call.args[1] for call in migration.update.call_args_list
                       if "INSERT INTO class_memberships" in call.args[0]]
        self.assertEqual([(101, 70, None), (102, 70, None)], memberships)
        workspaces = [call.args[1] for call in migration.update.call_args_list
                      if "INSERT INTO class_exam_workspaces" in call.args[0]]
        self.assertEqual([(101, "SAT"), (102, "PSAT")], workspaces)


if __name__ == "__main__":
    unittest.main()
