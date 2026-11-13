"""LoadTwin: a discrete-event digital twin that tells you whether a service survives its load.

Calibrate from one load-test measurement, scale to the target environment, simulate normal, peak
and stress load with SimPy, and get a verdict, the limiting resource and the maximum capacity.
"""

from loadtwin.calibration import Measurement, calibrate
from loadtwin.capacity import capacity
from loadtwin.engine import Profile, SimulationResult, Spec, simulate, usl_factor
from loadtwin.evaluate import SLA, Database, Load, evaluate

__version__ = "0.1.0"

__all__ = [
    "SLA",
    "Database",
    "Load",
    "Measurement",
    "Profile",
    "SimulationResult",
    "Spec",
    "calibrate",
    "capacity",
    "evaluate",
    "simulate",
    "usl_factor",
    "__version__",
]
