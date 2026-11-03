"""보행 금지·자동차 전용·일방 보행과 좌표 연결의 보수적 해석을 확인한다."""
import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('walking', Path(__file__).resolve().parents[1] / 'scripts/build_walking.py')
WALK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WALK)


class WalkingTest(unittest.TestCase):
    def test_foot_restrictions_override_road_class(self):
        for highway in ('footway', 'steps', 'residential', 'pedestrian'):
            self.assertTrue(WALK.permitted({'highway': highway}))
            for restriction in ('no', 'private', 'use_sidepath'):
                self.assertFalse(WALK.permitted({'highway': highway, 'foot': restriction}))
        for highway in ('motorway', 'motorway_link', 'trunk', 'construction', 'proposed', 'cycleway'):
            self.assertFalse(WALK.permitted({'highway': highway}))
        self.assertTrue(WALK.permitted({'highway': 'cycleway', 'foot': 'yes'}))
        self.assertFalse(WALK.permitted({'highway': 'primary', 'motorroad': 'yes'}))

    def test_private_areas_and_unknown_conditional_access_are_excluded(self):
        self.assertFalse(WALK.permitted({'highway': 'service', 'access': 'private'}))
        self.assertTrue(WALK.permitted({'highway': 'service', 'access': 'private', 'foot': 'yes'}))
        self.assertFalse(WALK.permitted({'highway': 'path', 'foot:conditional': 'yes @ (08:00-18:00)'}))
        self.assertFalse(WALK.permitted({'highway': 'pedestrian', 'area': 'yes'}))
        self.assertTrue(WALK.blocked({'barrier': 'wall'}))
        self.assertFalse(WALK.blocked({'barrier': 'bollard'}))
        self.assertTrue(WALK.blocked({'foot': 'no'}))

    def test_pedestrian_direction_is_independent_of_car_direction(self):
        self.assertEqual(WALK.direction({'oneway': 'yes'}), 0)
        self.assertEqual(WALK.direction({'oneway:foot': 'yes'}), 1)
        self.assertEqual(WALK.direction({'oneway:foot': '-1'}), -1)
        self.assertIsNone(WALK.direction({'oneway:foot': 'reversible'}))


if __name__ == '__main__':
    unittest.main()
