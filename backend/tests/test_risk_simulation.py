from app.ml.risk_simulation import aggregate_loss_distribution


def test_simulation_shape():
    res = aggregate_loss_distribution(
        lambda_claims=2.0,
        severity_mu_log=11.0,
        severity_sigma_log=1.0,
        n_sims=500,
        seed=1,
    )
    assert res.samples.shape == (500,)
    assert res.var95 >= res.mean
    assert res.tvar95 >= res.var95
    assert res.var99 >= res.var95
