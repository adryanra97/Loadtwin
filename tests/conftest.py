import pytest

from loadtwin import Measurement, Spec


@pytest.fixture
def measured():
    return Spec(vcpu=4, ram_gb=8, nodes=2, thread_pool=100, conn_pool=30, timeout_ms=3000)


@pytest.fixture
def target():
    return Spec(vcpu=4, ram_gb=8, nodes=3, thread_pool=120, conn_pool=30, timeout_ms=2000)


@pytest.fixture
def measurement():
    return Measurement(tps=40, cpu_pct=62, p95_ms=420, mem_pct=58, payload_kb=4)
