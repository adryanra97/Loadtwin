"""LoadTwin: a discrete-event digital twin that tells you whether a service survives its load.

Calibrate from load-test measurements, scale to the target environment, simulate it with SimPy,
and get a verdict, the limiting resource, the capacity, a breach probability, the cheapest cluster
that fits, how the service rides spikes and failures, and which input matters most.
"""

__version__ = "0.3.0"

from loadtwin.autosize import MachineType, Pools, autosize  # noqa: E402
from loadtwin.calibration import Database, Measurement, calibrate  # noqa: E402
from loadtwin.capacity import capacity  # noqa: E402
from loadtwin.engine import Fault, Profile, SimulationResult, Spec, simulate, usl_factor  # noqa: E402
from loadtwin.evaluate import Load, evaluate  # noqa: E402
from loadtwin.faults import run_fault  # noqa: E402
from loadtwin.loadtest import Point, validate  # noqa: E402
from loadtwin.montecarlo import replicate  # noqa: E402
from loadtwin.sensitivity import sensitivity  # noqa: E402
from loadtwin.sla import SLA  # noqa: E402
from loadtwin.traffic import Pattern, run_pattern  # noqa: E402

__all__ = [
    "SLA",
    "Database",
    "Fault",
    "Load",
    "MachineType",
    "Measurement",
    "Pattern",
    "Point",
    "Pools",
    "Profile",
    "SimulationResult",
    "Spec",
    "autosize",
    "calibrate",
    "capacity",
    "evaluate",
    "replicate",
    "run_fault",
    "run_pattern",
    "sensitivity",
    "simulate",
    "usl_factor",
    "validate",
    "__version__",
]
