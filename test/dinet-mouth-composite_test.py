"""Exercise compositor pixels without loading neural models or an OpenGL context."""
import ast
from pathlib import Path
import unittest

import cv2
import numpy as np

worker = Path(__file__).resolve().parents[1] / 'scripts/dinet_worker.py'
tree = ast.parse(worker.read_text())
renderer = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'PersistentDINetRenderer')
namespace = {'np': np, 'cv2': cv2}
for name in ['_composite_narrow_mouth', '_complete_lip_mask', '_restore_source_lip_color', '_resize_face_for_output']:
    method = next(n for n in renderer.body if isinstance(n, ast.FunctionDef) and n.name == name)
    method.decorator_list = []
    exec(compile(ast.Module(body=[method], type_ignores=[]), str(worker), 'exec'), namespace)
composite = namespace['_composite_narrow_mouth']
complete_mask = namespace['_complete_lip_mask']
restore_color = namespace['_restore_source_lip_color']


class MouthCoverageTest(unittest.TestCase):
    def setUp(self):
        self.source = np.full((184, 184, 3), 150, np.uint8)
        self.face = np.full_like(self.source, 90)
        self.mask = np.zeros((184, 184), np.uint8)
        cv2.ellipse(self.mask, (92, 90), (36, 8), 0, 0, 360, 255, 2)
        self.source[self.mask > 18] = [220, 20, 40]
        self.profile = dict(mouthWidthScale=.9, mouthHeightScale=.97,
                            compositeCenterX=.5, compositeCenterY=.39)

    def test_old_lip_perimeter_is_fully_replaced(self):
        out = composite(None, self.face, self.source, self.profile, self.mask)
        np.testing.assert_array_equal(out[self.mask > 18], self.face[self.mask > 18])

    def test_cavity_does_not_show_original_closed_mouth(self):
        self.source[87:94, 70:115] = 0
        out = composite(None, self.face, self.source, self.profile, self.mask)
        np.testing.assert_array_equal(out[87:94, 70:115], self.face[87:94, 70:115])

    def test_distant_skin_unchanged_and_all_scales_safe(self):
        for sx in [.65, .9, 1, 1.1]:
            for sy in [.75, .97, 1.15]:
                profile = {**self.profile, 'mouthWidthScale': sx, 'mouthHeightScale': sy}
                out = composite(None, self.face, self.source, profile, self.mask)
                self.assertEqual(out.shape, self.source.shape)
                np.testing.assert_array_equal(out[:40], self.source[:40])
                np.testing.assert_array_equal(out[self.mask > 18], self.face[self.mask > 18])

    def test_empty_mask_preserves_source(self):
        out = composite(None, self.face, self.source, self.profile, self.mask * 0)
        np.testing.assert_array_equal(out, self.source)

    def test_dark_corners_outside_colour_mask_are_replaced(self):
        corners = np.array([[42, 78], [90, 84], [138, 90], [92, 101]], np.float32)
        mask = complete_mask(self.mask, corners)
        self.source[78, 42] = [15, 15, 15]
        self.source[90, 138] = [15, 15, 15]
        out = composite(None, self.face, self.source, self.profile, mask)
        np.testing.assert_array_equal(out[78, 42], self.face[78, 42])
        np.testing.assert_array_equal(out[90, 138], self.face[90, 138])

    def test_geometry_survives_absent_colour_detection(self):
        corners = np.array([[42, 78], [90, 84], [138, 90], [92, 101]], np.float32)
        mask = complete_mask(self.mask * 0, corners)
        self.assertEqual(int(mask[78, 42]), 255)
        self.assertEqual(int(mask[90, 138]), 255)
        self.assertEqual(int(mask[90, 90]), 255)
        self.assertEqual(int(mask[0, 0]), 0)

    def test_colour_correction_preserves_teeth_cavity_and_skin(self):
        face = self.face.copy()
        source = self.source.copy()
        face[80:103, 60:125] = [150, 65, 95]
        source[80:103, 60:125] = [180, 80, 75]
        face[88:92, 70:80] = [220, 220, 220]
        face[91:94, 85:100] = [20, 15, 15]
        profile = dict(lipColorStrength=.45, upperLipColorStrength=0,
                       lipBrightnessOffset=0, lipColorCenterY=.48)
        mask = np.zeros_like(self.mask);mask[78:105, 58:127] = 255
        out = restore_color(None, face, source, profile, mask)
        np.testing.assert_array_equal(out[88:92, 70:80], face[88:92, 70:80])
        np.testing.assert_array_equal(out[91:94, 85:100], face[91:94, 85:100])
        np.testing.assert_array_equal(out[:60], face[:60])
        self.assertTrue(np.any(out[80:85, 65:120] != face[80:85, 65:120]))
        original_l = cv2.cvtColor(face, cv2.COLOR_RGB2LAB)[:, :, 0].astype(float)
        output_l = cv2.cvtColor(out, cv2.COLOR_RGB2LAB)[:, :, 0].astype(float)
        self.assertLessEqual(np.max(np.abs(original_l - output_l)), 2)

    def test_reference_lips_restore_warmth_without_flattening_shading(self):
        source = np.full_like(self.source, [190, 165, 150])
        face = source.copy()
        mask = np.zeros_like(self.mask)
        mask[72:106, 55:130] = 255
        source[76:84, 65:120] = [190, 105, 100]
        source[94:102, 65:120] = [205, 110, 70]
        face[76:84, 65:120] = [165, 85, 110]
        face[94:102, 65:120] = [175, 95, 120]
        face[97:102, 65:120] += 8  # Existing lip highlight must survive.
        profile = dict(lipColorStrength=.9, lipIdentityStrength=1,
                       upperLipColorStrength=0, lipBrightnessOffset=0,
                       lipColorCenterY=.481)
        out = restore_color(None, face, source, profile, mask)
        before = cv2.cvtColor(face, cv2.COLOR_RGB2LAB).astype(float)
        after = cv2.cvtColor(out, cv2.COLOR_RGB2LAB).astype(float)
        target = cv2.cvtColor(source, cv2.COLOR_RGB2LAB).astype(float)
        for y in [80, 95]:
            self.assertLess(np.linalg.norm(after[y,90,1:]-target[y,90,1:]),
                            np.linalg.norm(before[y,90,1:]-target[y,90,1:]))
        self.assertGreater(after[99,90,0], after[95,90,0])
        # Different original upper/lower colours are still different after correction.
        self.assertGreater(after[95,90,2], after[80,90,2])
        np.testing.assert_array_equal(out[:60], face[:60])

    def test_reference_colour_gradient_and_cavity_are_preserved(self):
        source = np.full_like(self.source, [190, 165, 150])
        face = source.copy()
        mask = np.zeros_like(self.mask);mask[72:110, 55:130] = 255
        source[92:103, 60:125] = [190, 90, 105]
        source[92:103, 82:103] = [210, 110, 65]  # Warm centre, pinker edges.
        face[95:107, 60:125] = [170, 85, 110]  # Lip moved down as it opens.
        face[85:91, 75:110] = [20, 15, 15]
        face[87:89, 85:100] = [220, 220, 215]
        profile = dict(lipColorStrength=.9, lipIdentityStrength=1,
                       upperLipColorStrength=0, lipBrightnessOffset=0,
                       lipColorCenterY=.481)
        out = restore_color(None, face, source, profile, mask)
        lab = cv2.cvtColor(out, cv2.COLOR_RGB2LAB)
        self.assertGreater(int(lab[99,92,2]), int(lab[99,68,2]) + 3)
        np.testing.assert_array_equal(out[85:91, 75:110], face[85:91, 75:110])
        np.testing.assert_array_equal(out[:60], face[:60])


class TeethDetailTest(unittest.TestCase):
    def setUp(self):
        self.face = np.full((184, 184, 3), [180, 120, 100], np.uint8)
        self.mask = np.zeros((184, 184), np.uint8)
        self.mask[70:110, 45:140] = 255
        self.face[70:110, 45:140] = [170, 55, 75]
        self.face[84:98, 65:120] = [24, 18, 20]
        self.face[86:92, 70:115] = [160, 153, 142]
        self.face[86:92, 80:82] = [100, 94, 86]
        self.resize = namespace['_resize_face_for_output']

    def test_disabled_matches_previous_output_exactly(self):
        for size in [(102, 102), (368, 368)]:
            expected = cv2.resize(self.face, size)
            actual = self.resize(self.face, size, {'teethDetailStrength': 0}, self.mask)
            np.testing.assert_array_equal(actual, expected)

    def test_detail_changes_are_local_and_bounded(self):
        for size in [(102, 102), (368, 368)]:
            baseline = cv2.resize(self.face, size)
            actual = self.resize(self.face, size, {'teethDetailStrength': .65}, self.mask)
            delta = actual.astype(float) - baseline.astype(float)
            self.assertTrue(np.any(delta))
            self.assertLessEqual(np.max(np.abs(delta)), 5)
            np.testing.assert_array_equal(actual[:size[1]//3], baseline[:size[1]//3])
            # Saturated lip surfaces remain exactly on the approved baseline.
            lip_pixels = (baseline[:, :, 0] > 150) & (baseline[:, :, 1] < 65)
            np.testing.assert_array_equal(actual[lip_pixels], baseline[lip_pixels])

    def test_closed_mouth_does_not_create_teeth(self):
        self.face[84:98, 65:120] = [24, 18, 20]
        actual = self.resize(self.face, (102, 102), {'teethDetailStrength': .65}, self.mask)
        np.testing.assert_array_equal(actual, cv2.resize(self.face, (102, 102)))

    def test_empty_mask_is_identity(self):
        actual = self.resize(self.face, (102, 102), {'teethDetailStrength': .65}, self.mask * 0)
        np.testing.assert_array_equal(actual, cv2.resize(self.face, (102, 102)))


if __name__ == '__main__':
    unittest.main()
