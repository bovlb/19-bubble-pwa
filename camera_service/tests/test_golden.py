from camera_service.tools.evaluate_golden import match_centers


def test_center_matching_is_one_to_one_and_rejects_distant_candidates():
    gold = [{"x": 10, "y": 10, "radius": 20},
            {"x": 50, "y": 10, "radius": 20}]
    predicted = [{"x": 11, "y": 10}, {"x": 12, "y": 10},
                 {"x": 51, "y": 10}, {"x": 90, "y": 10}]
    assert match_centers(gold, predicted) == {0: 0, 1: 2}
