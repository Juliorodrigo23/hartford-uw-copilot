from unittest.mock import AsyncMock

import pandas as pd
import pytest

from app.ml.features import FEATURE_NAMES, build_feature_frame
from app.tools import safer_lookup as safer_module


@pytest.mark.parametrize("dot", ["../../outside", "/tmp/profile", "12/34", "123456789", "１２３", ""])  # noqa: RUF001
async def test_invalid_dot_cannot_reach_filesystem_or_network(monkeypatch, dot):
    network = AsyncMock(side_effect=AssertionError("network must not be used"))
    monkeypatch.setattr(safer_module, "_lookup_qcmobile", network)
    assert await safer_module.safer_lookup(dot) is None
    network.assert_not_awaited()
    with pytest.raises(ValueError):
        safer_module._cache_path(dot)


def test_missing_optional_features_keep_the_original_row_index():
    frame = pd.DataFrame({"fleet_size":[10,20],"oos_vehicle":[0.1,0.2],"oos_driver":[0.01,0.02],"commodity":["tank","general_freight"]},index=[10,30])
    result = build_feature_frame(frame)
    assert list(result.columns) == FEATURE_NAMES
    assert list(result.index) == [10,30]
    assert result["tractor_share"].tolist() == [0.8,0.8]
    assert result["n_states"].tolist() == [1.0,1.0]
    assert result["crashes_24mo_total"].tolist() == [0.0,0.0]
    assert not result.isna().any().any()
